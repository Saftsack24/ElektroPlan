"""Echte Parallelitaet bei Steigwegen (Phase 6a.4, ADR 0025).

Zwei Threads, zwei Sessions, PostgreSQL. Geprueft wird jeweils der
**Datenbankzustand** am Ende.

* Zwei Ersetzungen mit derselben Version: genau eine gewinnt, die andere
  erhaelt ``409 version-conflict``.
* Zwei gleichnamige Steigwege im selben Gebaeude: genau einer entsteht.
* Steigweg anlegen gegen das Loeschen des Geschosses, auf dem sein Halt liegt:
  Entweder der Steigweg entsteht und das Geschoss bleibt (``409``), oder das
  Geschoss ist weg und der Steigweg wird abgelehnt (``422``) - weil die
  Geschosse **nach** der Projektsperre frisch gelesen werden.

Abschluss und Archivierung gegen den Steigwegweg laufen in
``test_completed_concurrency.py`` und ``test_archive_concurrency.py``
(Schreibweg ``steigweg-anlegen``).

Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import threading
import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.projects.models import Floor
from app.core.projects.schemas import FloorCreate
from app.core.projects.service import ProjectService
from app.errors import ConflictError, ValidationFailedError, VersionConflictError
from app.modules.electrical.models import ElectricalRiser, ElectricalRiserStop
from app.modules.electrical.risers import RiserService
from app.modules.electrical.schemas import RiserCreate, RiserStopIn, RiserUpdate
from tests.conftest import requires_database
from tests.test_archive_concurrency import Welt, factory, welt  # noqa: F401 - Fixtures
from tests.test_concurrency import ACTOR, gleichzeitig

pytestmark = [requires_database, pytest.mark.database]


def _steigweg(factory: sessionmaker[Session], welt: Welt) -> tuple[uuid.UUID, int]:  # noqa: F811
    session = factory()
    try:
        view, _ = RiserService(session, welt.organization_id).create(
            welt.building_id,
            RiserCreate(
                name="Schacht",
                offset_mode="orthogonal",
                stops=[RiserStopIn(floor_id=welt.floor_id, x_mm=0, y_mm=0)],
            ),
        )
        session.commit()
        return view.riser.id, view.riser.version
    finally:
        session.close()


def _obergeschoss(factory: sessionmaker[Session], welt: Welt) -> uuid.UUID:  # noqa: F811
    session = factory()
    try:
        floor = ProjectService(session, welt.organization_id).create_floor(
            welt.building_id, FloorCreate(name="Obergeschoss", level=1), actor_user_id=ACTOR
        )
        session.commit()
        return floor.id
    finally:
        session.close()


def _anzahl(factory: sessionmaker[Session], stmt: object) -> int:  # noqa: F811
    session = factory()
    try:
        return int(session.execute(stmt).scalar_one())  # type: ignore[call-overload]
    finally:
        session.close()


def test_zwei_ersetzungen_mit_derselben_version(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    riser_id, version = _steigweg(factory, welt)
    barriere = threading.Barrier(2, timeout=20)

    def arbeit(session: Session, name: str) -> str:
        barriere.wait()
        RiserService(session, welt.organization_id).replace(
            riser_id,
            RiserUpdate(
                name=name,
                offset_mode="direct",
                stops=[RiserStopIn(floor_id=welt.floor_id, x_mm=100, y_mm=0)],
            ),
            expected_version=version,
        )
        return name

    lauf = gleichzeitig(factory, arbeit, namen=("Links", "Rechts"))

    assert len(lauf.erfolge) == 1, lauf.fehlerklassen
    assert lauf.fehlerklassen == [VersionConflictError]
    session = factory()
    try:
        riser = session.execute(select(ElectricalRiser)).scalar_one()
        assert (riser.name, riser.version) == (lauf.erfolge[0], version + 1)
        assert (
            session.execute(select(func.count()).select_from(ElectricalRiserStop)).scalar_one() == 1
        )
    finally:
        session.close()


def test_zwei_gleichnamige_steigwege(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    barriere = threading.Barrier(2, timeout=20)

    def arbeit(session: Session, name: str) -> str:
        barriere.wait()
        RiserService(session, welt.organization_id).create(
            welt.building_id, RiserCreate(name="Schacht", offset_mode="direct")
        )
        return name

    lauf = gleichzeitig(factory, arbeit, namen=("eins", "zwei"))

    assert len(lauf.erfolge) == 1, lauf.fehlerklassen
    assert lauf.fehlerklassen == [ValidationFailedError]
    assert _anzahl(factory, select(func.count()).select_from(ElectricalRiser)) == 1


def test_steigweg_gegen_loeschen_des_geschosses(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    og = _obergeschoss(factory, welt)
    barriere = threading.Barrier(2, timeout=20)

    def arbeit(session: Session, name: str) -> str:
        barriere.wait()
        if name == "steigweg":
            RiserService(session, welt.organization_id).create(
                welt.building_id,
                RiserCreate(
                    name="Schacht",
                    offset_mode="orthogonal",
                    stops=[
                        RiserStopIn(floor_id=welt.floor_id, x_mm=0, y_mm=0),
                        RiserStopIn(floor_id=og, x_mm=0, y_mm=0),
                    ],
                ),
            )
        else:
            ProjectService(session, welt.organization_id).delete_floor(
                og, expected_version=1, actor_user_id=ACTOR
            )
        return name

    lauf = gleichzeitig(factory, arbeit, namen=("steigweg", "geschoss-loeschen"))

    assert len(lauf.erfolge) == 1 and len(lauf.fehler) == 1, lauf.fehlerklassen
    risers = _anzahl(factory, select(func.count()).select_from(ElectricalRiser))
    floors = _anzahl(factory, select(func.count()).select_from(Floor).where(Floor.id == og))
    if lauf.erfolge == ["steigweg"]:
        assert lauf.fehlerklassen == [ConflictError]
        assert (risers, floors) == (1, 1)
    else:
        assert lauf.fehlerklassen == [ValidationFailedError]
        assert (risers, floors) == (0, 0)
