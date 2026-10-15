"""Mengenuebersicht und Schreibvorgaenge (Phase 6b.6, Entwurf §21): ein konsistenter Stand.

Jeder Schreibvorgang sperrt zuerst die Projektzeile exklusiv. Die Uebersicht nimmt eine
geteilte Sperre auf dieselbe Zeile, bevor sie liest - sie sieht also nie einen halb
geschriebenen Stand. Deterministisch geprueft ueber ``lock_timeout`` (keine Wartezeiten):

* haelt ein Schreibvorgang die Projektsperre, bekommt die Uebersicht sie nicht
  (``LockNotAvailable``) - sie liest nicht daran vorbei;
* nach dem Commit sieht die Uebersicht den neuen Stand vollstaendig;
* waehrend die Uebersicht liest, kann kein Schreibvorgang die Projektsperre nehmen.

Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import pytest
from psycopg.errors import LockNotAvailable
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from app.core.projects.service import ProjectService
from app.modules.electrical.cables import CableService
from tests.conftest import requires_database
from tests.test_archive_concurrency import Welt, factory, welt  # noqa: F401 - Fixtures
from tests.test_cable_concurrency import _aufbau, _leitung

pytestmark = [requires_database, pytest.mark.database]


def _kurz_warten(session: Session) -> None:
    session.execute(text("SET LOCAL lock_timeout = '200ms'"))


def test_uebersicht_liest_nie_an_einem_laufenden_schreibvorgang_vorbei(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    lw = _aufbau(factory, welt)
    schreiber = factory()
    leser = factory()
    try:
        # Schreibvorgang: Projekt sperren (wie jeder Schreibweg) und Leitung aendern - offen.
        ProjectService(schreiber, welt.organization_id).lock_project(welt.project_id)
        CableService(schreiber, welt.organization_id).replace(
            lw.cable, _leitung(lw.board_device, lw.socket, welt, bis=2_000), expected_version=1
        )
        _kurz_warten(leser)
        with pytest.raises(OperationalError) as fehler:
            CableService(leser, welt.organization_id).cabling_summary(welt.building_id)
        assert isinstance(fehler.value.orig, LockNotAvailable)
        leser.rollback()
        schreiber.commit()

        # Nach dem Commit: der neue Stand vollstaendig - neue Version und neuer Weg
        # (Wandpunkt bei 2 000 statt 3 000; die Laenge bleibt 800 + 2 000 + 1 900).
        _, summary = CableService(leser, welt.organization_id).cabling_summary(welt.building_id)
        (line,) = summary.cables
        assert line.cable.version == 2
        assert [s.ref for s in line.result.segments if s.kind.value == "wall"] == ["w0-w1"]
        assert line.result.length_mm == 4_700
        leser.rollback()
    finally:
        schreiber.close()
        leser.close()


def test_waehrend_der_uebersicht_kann_kein_schreibvorgang_committen(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    _aufbau(factory, welt)
    leser = factory()
    schreiber = factory()
    try:
        _, summary = CableService(leser, welt.organization_id).cabling_summary(welt.building_id)
        assert len(summary.cables) == 1
        # Die geteilte Sperre haelt bis zum Ende der Lesetransaktion.
        _kurz_warten(schreiber)
        with pytest.raises(OperationalError) as fehler:
            ProjectService(schreiber, welt.organization_id).lock_project(welt.project_id)
        assert isinstance(fehler.value.orig, LockNotAvailable)
        schreiber.rollback()
        leser.rollback()
        # Danach ist Schreiben wieder moeglich; die Uebersicht selbst hat nichts geaendert.
        ProjectService(schreiber, welt.organization_id).lock_project(welt.project_id)
        assert not schreiber.dirty and not schreiber.new
        schreiber.rollback()
    finally:
        leser.close()
        schreiber.close()
