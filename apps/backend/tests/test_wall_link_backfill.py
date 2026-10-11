"""Backfill eindeutiger Wandkopplungen (Phase 6a.3, ADR 0024).

* Probelauf ist Standard und aendert nichts.
* ``apply`` legt nur eindeutige Faelle als ``shared`` (``origin = backfill``) an,
  nie ``separate``; vorhandene Entscheidungen bleiben unberuehrt.
* Wiederholbar (zweiter Lauf: nichts Neues) und nach Abbruch fortsetzbar.
* Pruefsumme ueber Waende, Oeffnungen und Geraete sowie die Geraetebefunde
  bleiben gleich; eine Abweichung rollt das Projekt zurueck.
* ``completed``/``archived`` werden nur berichtet.
* Hoehenlagen werden nicht bestaetigt.

Synthetische Daten. Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
Der Befehl selbst wird hier nie gegen die Entwicklungsdatenbank ausgefuehrt.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.cli import cmd_wall_links_backfill
from app.core.projects.models import Floor
from app.modules.electrical import backfill
from app.modules.electrical.backfill import floor_checksum, format_report, run_backfill
from app.modules.electrical.device_rules import FloorDeviceCheck, baseline_of
from app.modules.electrical.models import ElectricalRoom, ElectricalWallLink
from tests import test_electrical_devices_api as geraete
from tests import test_electrical_rooms as raeume
from tests import test_electrical_wall_links as kopplung
from tests.conftest import auth_headers, requires_database

pytestmark = [requires_database, pytest.mark.database]

betrieb = raeume.betrieb
ereignisse = raeume.ereignisse
token = raeume.token
geschoss = raeume.geschoss


def _factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def _links(engine: Engine) -> list[ElectricalWallLink]:
    with _factory(engine)() as session:
        return list(session.execute(select(ElectricalWallLink)).scalars())


def _zustand(engine: Engine, organization_id: uuid.UUID, floor_id: str) -> tuple[str, Any]:
    """Pruefsumme und Geraetebefunde eines Geschosses."""
    with _factory(engine)() as session:
        summe = floor_checksum(session, organization_id, uuid.UUID(floor_id))
        state = FloorDeviceCheck(session, organization_id).state(uuid.UUID(floor_id), 2_500)
        return summe, ({} if state is None else baseline_of(state.findings))


def _bestand(api: TestClient, token: str, floor_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """Ein eindeutiges Paar mit Tuer und Geraet, dazu ein mehrdeutiges Paar (Staerke)."""
    a, b = kopplung._paar(api, token, floor_id)
    a = kopplung._tuer_in_a(api, token, floor_id, a)
    # Geraet in B neben der Tuer - zulaessig, Befunde gleich vorher/nachher.
    assert (
        kopplung._kontur(api, token, b, devices=[geraete._wandgeraet(b["walls"][3]["id"], 500)])
    ).status_code == 200
    # C ueber A mit abweichender Staerke an der gemeinsamen Wand.
    c = geraete._raum(api, token, floor_id, geraete._rechteck(4_000, 2_000, y=3_000), name="C")
    c = geraete._plan_raum(api, token, floor_id, c["id"])
    walls = geraete._waende(c)
    walls[0]["thickness_mm"] = 240
    assert kopplung._kontur(api, token, c, walls=walls).status_code == 200
    return a, b


def test_probelauf_aendert_nichts(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine, betrieb: uuid.UUID
) -> None:
    floor_id = geschoss["floor"]["id"]
    _bestand(api, token, floor_id)
    vorher = _zustand(engine, betrieb, floor_id)

    report = run_backfill(_factory(engine), apply=False)

    assert _links(engine) == []
    assert _zustand(engine, betrieb, floor_id) == vorher
    [projekt] = report.projects
    assert len(projekt.created) == 1
    assert [p.reasons for p in projekt.unclear] == [("Wandstaerken verschieden",)]
    zeilen = format_report(report)
    assert zeilen[0].endswith("PROBELAUF (nichts gespeichert)")
    assert any("wuerde angelegt" in zeile for zeile in zeilen)


def test_uebernahme_nur_eindeutig_und_wiederholbar(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine, betrieb: uuid.UUID
) -> None:
    floor_id = geschoss["floor"]["id"]
    a, b = _bestand(api, token, floor_id)
    vorher = _zustand(engine, betrieb, floor_id)
    versionen = (
        kopplung.raumversion(api, token, a["id"]),
        kopplung.raumversion(api, token, b["id"]),
    )

    erster = run_backfill(_factory(engine), apply=True)
    assert erster.failed == 0 and erster.created == 1
    [link] = _links(engine)
    assert (link.relation, link.origin, link.created_by_user_id) == ("shared", "backfill", None)
    assert {str(link.wall_a_id), str(link.wall_b_id)} == {a["walls"][1]["id"], b["walls"][3]["id"]}
    # Waende, Oeffnungen, Geraete und Befunde unveraendert; Raumversionen gezaehlt.
    assert _zustand(engine, betrieb, floor_id) == vorher
    assert kopplung.raumversion(api, token, a["id"]) != versionen[0]
    assert kopplung.raumversion(api, token, b["id"]) != versionen[1]
    # Keine Hoehenlage bestaetigt.
    with _factory(engine)() as session:
        assert not session.execute(select(Floor.elevation_confirmed)).scalar_one()

    zweiter = run_backfill(_factory(engine), apply=True)
    assert zweiter.created == 0
    assert zweiter.projects[0].existing == 1
    assert len(_links(engine)) == 1


def test_vorhandene_entscheidung_wird_nie_ueberschrieben(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor_id = geschoss["floor"]["id"]
    a, b = kopplung._paar(api, token, floor_id)
    kopplung._gekoppelt(api, token, floor_id, a["walls"][1]["id"], b["walls"][3]["id"], "separate")

    report = run_backfill(_factory(engine), apply=True)

    assert report.created == 0
    assert [(item.relation, item.origin, item.version) for item in _links(engine)] == [
        ("separate", "user", 1)
    ]


@pytest.mark.parametrize("status", ["completed", "archived"])
def test_abgeschlossene_projekte_werden_nur_berichtet(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine, status: str
) -> None:
    floor_id = geschoss["floor"]["id"]
    kopplung._paar(api, token, floor_id)
    projekt = geschoss["project"]
    schritte = (
        ("activate", "complete") if status == "completed" else ("activate", "complete", "archive")
    )
    for schritt in schritte:
        aktuell = api.get(f"/api/v1/projects/{projekt['id']}", headers=auth_headers(token)).json()
        api.post(
            f"/api/v1/projects/{projekt['id']}/{schritt}",
            headers={**auth_headers(token), "If-Match": str(aktuell["version"])},
        )

    report = run_backfill(_factory(engine), apply=True)

    [item] = report.projects
    assert item.read_only and item.status == status
    assert len(item.created) == 1  # berichtet ...
    assert _links(engine) == []  # ... aber nicht geschrieben
    assert "schreibgeschuetzt" in "\n".join(format_report(report))


def test_abweichung_rollt_zurueck_und_lauf_ist_fortsetzbar(
    api: TestClient,
    token: str,
    geschoss: dict[str, Any],
    engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Projekt 2 scheitert an der Pruefsumme; der naechste Lauf setzt dort fort."""
    erstes = geschoss["floor"]["id"]
    kopplung._paar(api, token, erstes)
    zweites = raeume._struktur(api, token, name="Zweites Projekt")
    kopplung._paar(api, token, zweites["floor"]["id"])

    gestoert = uuid.UUID(zweites["floor"]["id"])
    aufrufe: dict[uuid.UUID, int] = {}

    def stoerung(session: Session, organization_id: uuid.UUID, floor_id: uuid.UUID) -> str:
        aufrufe[floor_id] = aufrufe.get(floor_id, 0) + 1
        echt = floor_checksum(session, organization_id, floor_id)
        # Beim zweiten Aufruf (nachher) fuer das gestoerte Geschoss eine Abweichung.
        return echt + "x" if floor_id == gestoert and aufrufe[floor_id] == 2 else echt

    report = run_backfill(_factory(engine), apply=True, checksum=stoerung)
    assert report.failed == 1
    fehler = next(item for item in report.projects if item.error is not None)
    assert "zurueckgerollt" in (fehler.error or "")
    assert fehler.created == []
    with _factory(engine)() as session:
        gekoppelt = {
            room.floor_id
            for link in session.execute(select(ElectricalWallLink)).scalars()
            for room in session.execute(
                select(ElectricalRoom)
                .join_from(
                    ElectricalRoom,
                    backfill.ElectricalWall,
                    backfill.ElectricalWall.room_id == ElectricalRoom.id,
                )
                .where(backfill.ElectricalWall.id == link.wall_a_id)
            ).scalars()
        }
    assert gekoppelt == {uuid.UUID(erstes)}

    # Fortsetzen: Das erste Projekt hat nichts Neues, das zweite wird nachgeholt.
    weiter = run_backfill(_factory(engine), apply=True)
    assert weiter.failed == 0 and weiter.created == 1
    assert len(_links(engine)) == 2


def test_einzelnes_projekt_waehlbar(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    kopplung._paar(api, token, geschoss["floor"]["id"])
    zweites = raeume._struktur(api, token, name="Zweites Projekt")
    kopplung._paar(api, token, zweites["floor"]["id"])

    report = run_backfill(
        _factory(engine), apply=True, project_number=zweites["project"]["project_number"]
    )
    assert [p.project_number for p in report.projects] == [zweites["project"]["project_number"]]
    assert len(_links(engine)) == 1


def test_kommandozeile_lehnt_unbekannte_angaben_ab(capsys: pytest.CaptureFixture[str]) -> None:
    """Nur die Argumentpruefung - der Befehl laeuft hier nie gegen eine Datenbank."""
    assert cmd_wall_links_backfill(["--apply", "--irgendwas"]) == 2
    assert cmd_wall_links_backfill(["--project"]) == 2
    assert "Verwendung" in capsys.readouterr().out
