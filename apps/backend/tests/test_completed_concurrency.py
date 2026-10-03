"""Projektabschluss gegen gleichzeitige Schreibvorgaenge (Phase 4f).

Seit Phase 4f ist ``completed`` wie ``archived`` gegen fachliche Aenderungen
geschuetzt (ADR 0020, Erweiterung 4f). Die Invariante aus Phase 3.1 gilt damit
auch fuer den Abschluss:

    **Sobald ein Projekt abgeschlossen ist, committet keine Aenderung an ihm
    oder an einer untergeordneten Ressource mehr.**

Wie bei der Archivierung ist die Projektzeile die gemeinsame Sperrwurzel; der
Abschluss (``change_status``) sperrt sie ebenso wie jeder Schreibweg. Es gibt
genau zwei Ausgaenge: Die Fachaenderung committet vor dem Abschluss, oder der
Abschluss committet zuerst und die Fachaenderung erhaelt
``409 project-completed``.

Die Schreibwege und die Testwelt stammen aus ``test_archive_concurrency``.
``projekt-aendern`` fehlt bewusst: Er arbeitet mit der Projektversion ``1``,
die der vorgeschaltete Wechsel nach ``active`` bereits weiterzaehlt; der
Schutz der Stammdaten ist im API-Test von ``test_projects`` abgedeckt.

Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import threading

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.core.projects.models import PROJECT_STATUS_ACTIVE, PROJECT_STATUS_COMPLETED, Project
from app.core.projects.service import ProjectService
from app.errors import ProjectCompletedError
from tests.conftest import requires_database
from tests.test_archive_concurrency import (  # noqa: F401 - Fixtures
    SCHREIBWEGE,
    Fachaenderung,
    Welt,
    _bestand,
    factory,
    welt,
)
from tests.test_concurrency import ACTOR, gleichzeitig

pytestmark = [requires_database, pytest.mark.database]

WEGE = tuple((name, weg) for name, weg in SCHREIBWEGE if name != "projekt-aendern")


@pytest.fixture
def aktive_welt(factory: sessionmaker[Session], welt: Welt) -> Welt:  # noqa: F811
    """Dieselbe Welt, das Projekt aber ``active`` - nur so laesst es sich abschliessen."""
    session = factory()
    try:
        ProjectService(session, welt.organization_id).change_status(
            welt.project_id, PROJECT_STATUS_ACTIVE, expected_version=1, actor_user_id=ACTOR
        )
        session.commit()
    finally:
        session.close()
    return welt


def _abschliessen(session: Session, welt: Welt) -> None:  # noqa: F811
    """Schliesst ab - mit der Version, die **nach** der Sperre gilt."""
    projects = ProjectService(session, welt.organization_id)
    aktuell = projects.lock_project(welt.project_id)
    projects.change_status(
        welt.project_id,
        PROJECT_STATUS_COMPLETED,
        expected_version=aktuell.version,
        actor_user_id=ACTOR,
    )


def _status(factory: sessionmaker[Session], welt: Welt) -> str:  # noqa: F811
    session = factory()
    try:
        abfrage = select(Project.status).where(Project.id == welt.project_id)
        return str(session.execute(abfrage).scalar_one())
    finally:
        session.close()


@pytest.mark.parametrize(("bezeichnung", "aendern"), WEGE, ids=[n for n, _ in WEGE])
def test_abschluss_zuerst_dann_409(
    factory: sessionmaker[Session],  # noqa: F811
    aktive_welt: Welt,
    bezeichnung: str,
    aendern: Fachaenderung,
) -> None:
    """Wer nach dem Abschluss die Projektsperre erhaelt, wird abgewiesen.

    Der Abschluss haelt die Sperre und gibt erst danach die Barriere frei; die
    Fachaenderung laeuft in dieselbe Sperre, liest danach den neuen Status und
    erhaelt ``409 project-completed``. Im Datenbankzustand entsteht nichts.
    """
    vorher = _bestand(factory, aktive_welt)
    barriere = threading.Barrier(2, timeout=20)

    def arbeiten(session: Session, name: str) -> str:
        if name == "abschluss":
            _abschliessen(session, aktive_welt)
            barriere.wait()
        else:
            barriere.wait()
            aendern(session, aktive_welt)
        return name

    lauf = gleichzeitig(factory, arbeiten, namen=("abschluss", bezeichnung))

    assert lauf.erfolge == ["abschluss"], lauf.fehlerklassen
    assert len(lauf.fehler) == 1
    assert isinstance(lauf.fehler[0], ProjectCompletedError), lauf.fehlerklassen
    assert _status(factory, aktive_welt) == PROJECT_STATUS_COMPLETED
    assert _bestand(factory, aktive_welt) == vorher


@pytest.mark.parametrize(("bezeichnung", "aendern"), WEGE, ids=[n for n, _ in WEGE])
def test_fachaenderung_zuerst_dann_abschluss(
    factory: sessionmaker[Session],  # noqa: F811
    aktive_welt: Welt,
    bezeichnung: str,
    aendern: Fachaenderung,
) -> None:
    """Wer die Sperre zuerst hat, committet vollstaendig; der Abschluss wartet."""
    sperre_genommen = threading.Event()
    abschluss_durch = threading.Event()
    beobachtung: dict[str, bool] = {}

    def arbeiten(session: Session, name: str) -> str:
        if name == "abschluss":
            assert sperre_genommen.wait(timeout=20), "Die Fachaenderung kam nicht zustande."
            _abschliessen(session, aktive_welt)
            abschluss_durch.set()
        else:
            aendern(session, aktive_welt)
            sperre_genommen.set()
            beobachtung["abschluss_vorbei"] = abschluss_durch.wait(timeout=1.5)
        return name

    lauf = gleichzeitig(factory, arbeiten, namen=(bezeichnung, "abschluss"))

    assert beobachtung["abschluss_vorbei"] is False
    assert lauf.fehler == [], lauf.fehlerklassen
    assert lauf.erfolge == [bezeichnung, "abschluss"]
    assert _status(factory, aktive_welt) == PROJECT_STATUS_COMPLETED


@pytest.mark.parametrize(("bezeichnung", "aendern"), WEGE, ids=[n for n, _ in WEGE])
def test_abgeschlossenes_projekt_lehnt_jeden_schreibweg_ab(
    factory: sessionmaker[Session],  # noqa: F811
    aktive_welt: Welt,
    bezeichnung: str,
    aendern: Fachaenderung,
) -> None:
    """Ohne Rennen: Nach dem Abschluss scheitert jeder Weg, der Bestand bleibt."""
    session = factory()
    try:
        _abschliessen(session, aktive_welt)
        session.commit()
    finally:
        session.close()
    vorher = _bestand(factory, aktive_welt)

    session = factory()
    try:
        with pytest.raises(ProjectCompletedError):
            aendern(session, aktive_welt)
        session.rollback()
    finally:
        session.close()
    assert _bestand(factory, aktive_welt) == vorher, bezeichnung
