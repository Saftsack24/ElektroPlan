"""Bestehende Geraetekonflikte duerfen nicht groesser werden (Phase 5, ADR 0023).

Ein gleicher Fehlercode beweist nicht, dass ein bestehender Konflikt
unveraendert ist. Verglichen werden Identitaet (Geraet, Code, Partner) und
exaktes Ausmass vor und nach der Aenderung.

Die **Bestandsfehler** entstehen synthetisch direkt in der Datenbank - der
produktive Schreibweg laesst kein ungueltiges Geraet zu und wird dafuer nicht
geoeffnet. Jeder abgelehnte Fall prueft, dass nichts teilweise gespeichert
wurde.

Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import sessionmaker

from app.modules.electrical.device_rules import FloorDeviceCheck
from app.modules.electrical.models import (
    ElectricalDevice,
    ElectricalOpening,
    ElectricalRoom,
    ElectricalWall,
)
from tests import test_electrical_devices_api as geraete
from tests import test_electrical_rooms as raeume
from tests.conftest import auth_headers, requires_database

pytestmark = [requires_database, pytest.mark.database]

betrieb = raeume.betrieb
ereignisse = raeume.ereignisse
token = raeume.token
geschoss = raeume.geschoss
BASIS = raeume.BASIS
fehlercodes = raeume.fehlercodes
raumversion = raeume.raumversion

_raum_mit_plan = geraete._raum_mit_plan
_plan_raum = geraete._plan_raum
_speichern = geraete._speichern
_waende = geraete._waende
_geraete = geraete._geraete
_wandgeraet = geraete._wandgeraet

GROESSER = "Der bestehende Konflikt wuerde dadurch groesser."


# ------------------------------------------------------------------ Helfer


def _bestand(engine: Engine, model: type[Any], row_id: str, **werte: object) -> None:
    """Synthetischer Bestandsfehler: Zeile direkt aendern, am Service vorbei."""
    session = sessionmaker(bind=engine)()
    try:
        row = session.get(model, uuid.UUID(row_id))
        assert row is not None
        for name, wert in werte.items():
            setattr(row, name, wert)
        session.commit()
    finally:
        session.close()


def _zustand(engine: Engine) -> tuple[object, ...]:
    """Alles, was eine abgelehnte Aenderung nicht beruehren darf."""
    session = sessionmaker(bind=engine)()
    try:
        return (
            sorted(
                (str(r.id), r.height_mm, r.version)
                for r in session.execute(select(ElectricalRoom)).scalars()
            ),
            sorted(
                (str(w.id), w.x1_mm, w.y1_mm, w.x2_mm, w.y2_mm, w.version)
                for w in session.execute(select(ElectricalWall)).scalars()
            ),
            sorted(
                (str(o.id), o.offset_mm, o.width_mm, o.sill_height_mm, o.height_mm)
                for o in session.execute(select(ElectricalOpening)).scalars()
            ),
            sorted(
                (str(d.id), d.wall_id, d.center_offset_mm, d.center_height_mm, d.x_mm, d.y_mm)
                for d in session.execute(select(ElectricalDevice)).scalars()
            ),
        )
    finally:
        session.close()


def _befunde(engine: Engine, organization_id: uuid.UUID, floor_id: str) -> set[tuple[str, str]]:
    """Gespeicherte Befunde (Geraet, Code) - was der Editor als Konflikt anzeigt."""
    session = sessionmaker(bind=engine)()
    try:
        state = FloorDeviceCheck(session, organization_id).state(uuid.UUID(floor_id), 2_500)
        return set() if state is None else {(p.keys[0], p.code) for p in state.problems}
    finally:
        session.close()


def _raumhoehe(api: TestClient, token: str, room_id: str, hoehe: int) -> Any:
    return api.patch(
        f"{BASIS}/rooms/{room_id}",
        headers={**auth_headers(token), "If-Match": raumversion(api, token, room_id)},
        json={"height_mm": hoehe},
    )


def _meldungen(response: Any) -> list[str]:
    return [eintrag["message"] for eintrag in response.json().get("errors") or []]


# --------------------------------------------------------------- Raumhoehe


def test_raumhoehe_bei_bestehendem_hoehenkonflikt(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine, betrieb: uuid.UUID
) -> None:
    floor_id = geschoss["floor"]["id"]
    raum = _raum_mit_plan(api, token, floor_id, height_mm=2_500)
    schalter = _wandgeraet(raum["walls"][1]["id"], 2_000, 2_150, typ="switch_single")
    assert _speichern(api, token, raum, devices=[schalter]).status_code == 200
    # Bestand: Raumhoehe 2150, Schalter-Oberkante 2190 -> 40 mm Ueberstand.
    _bestand(engine, ElectricalRoom, raum["id"], height_mm=2_150)
    assert (schalter["id"], "device-exceeds-room-height") in _befunde(engine, betrieb, floor_id)

    # Weiter absenken: derselbe Code, groesserer Ueberstand -> abgelehnt, nichts gespeichert.
    vorher = _zustand(engine)
    tiefer = _raumhoehe(api, token, raum["id"], 2_100)
    assert tiefer.status_code == 422, tiefer.text
    assert fehlercodes(tiefer) == {"device-exceeds-room-height"}
    assert any(GROESSER in meldung for meldung in _meldungen(tiefer))
    assert _zustand(engine) == vorher

    # Teilweise anheben: erlaubt, der Restkonflikt (20 mm) bleibt sichtbar.
    teilweise = _raumhoehe(api, token, raum["id"], 2_170)
    assert teilweise.status_code == 200, teilweise.text
    assert (schalter["id"], "device-exceeds-room-height") in _befunde(engine, betrieb, floor_id)

    # Von hier aus wieder absenken - auch um 1 mm - bleibt abgelehnt.
    assert _raumhoehe(api, token, raum["id"], 2_169).status_code == 422

    # Ganz beheben: erlaubt, kein Befund mehr.
    behoben = _raumhoehe(api, token, raum["id"], 2_190)
    assert behoben.status_code == 200, behoben.text
    assert _befunde(engine, betrieb, floor_id) == set()

    # Das Geraet wurde nie verschoben.
    gespeichert = {str(g.id): g for g in geraete._geraete_in_db(engine)}
    assert gespeichert[schalter["id"]].center_height_mm == 2_150


# ------------------------------------------------------------ Wandverkuerzung


def test_wandverkuerzung_vergroessert_bestehenden_grenzkonflikt(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine, betrieb: uuid.UUID
) -> None:
    floor_id = geschoss["floor"]["id"]
    raum = _raum_mit_plan(api, token, floor_id)  # 5000 x 4000
    wand = raum["walls"][0]
    steckdose = _wandgeraet(wand["id"], 4_500)
    assert _speichern(api, token, raum, devices=[steckdose]).status_code == 200
    # Bestand: Mitte 4980, Breite 80 -> rechte Kante 5020, 20 mm ueber dem Wandende.
    _bestand(engine, ElectricalDevice, steckdose["id"], center_offset_mm=4_980)
    raum = _plan_raum(api, token, floor_id, raum["id"])

    def ecke(x: int) -> list[dict[str, Any]]:
        walls = _waende(raum)
        walls[0]["x2_mm"] = x
        walls[1]["x1_mm"] = x
        return walls

    # Wand um 10 mm kuerzen: 30 mm Ueberstand -> abgelehnt, nichts gespeichert.
    vorher = _zustand(engine)
    kuerzer = _speichern(api, token, raum, walls=ecke(4_990))
    assert kuerzer.status_code == 422, kuerzer.text
    assert fehlercodes(kuerzer) == {"device-outside-wall"}
    assert any(GROESSER in meldung for meldung in _meldungen(kuerzer))
    assert _zustand(engine) == vorher

    # Wand um 10 mm verlaengern: Teilverbesserung (10 mm) -> erlaubt, Rest sichtbar.
    laenger = _speichern(api, token, raum, walls=ecke(5_010))
    assert laenger.status_code == 200, laenger.text
    assert (steckdose["id"], "device-outside-wall") in _befunde(engine, betrieb, floor_id)


# -------------------------------------------- Oeffnung: Ausmass und Partner


def test_oeffnung_vergroessert_ueberdeckung_oder_bringt_neuen_partner(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor_id = geschoss["floor"]["id"]
    raum = _raum_mit_plan(api, token, floor_id)
    wand = raum["walls"][0]
    steckdose = _wandgeraet(wand["id"], 1_000)  # x 960..1040, Hoehe 260..340
    walls = _waende(raum)
    tuer_id = str(uuid.uuid4())
    walls[0]["openings"] = [
        {"id": tuer_id, "kind": "door", "offset_mm": 1_100, "width_mm": 900, "height_mm": 2_010}
    ]
    assert _speichern(api, token, raum, walls=walls, devices=[steckdose]).status_code == 200
    # Bestand: Tuer ab 1030 -> 10 mm x 80 mm Ueberdeckung.
    _bestand(engine, ElectricalOpening, tuer_id, offset_mm=1_030)
    raum = _plan_raum(api, token, floor_id, raum["id"])

    def mit_tuer(offset: int, breite: int, *weitere: dict[str, Any]) -> list[dict[str, Any]]:
        walls = _waende(raum)
        walls[0]["openings"] = [
            {**walls[0]["openings"][0], "offset_mm": offset, "width_mm": breite},
            *weitere,
        ]
        return walls

    vorher = _zustand(engine)
    # Tuer breiter ueber das Geraet: 20 mm statt 10 mm -> abgelehnt.
    breiter = _speichern(api, token, raum, walls=mit_tuer(1_020, 910))
    assert breiter.status_code == 422, breiter.text
    assert fehlercodes(breiter) == {"device-in-opening"}
    assert any(GROESSER in meldung for meldung in _meldungen(breiter))
    assert _zustand(engine) == vorher

    # Neuer Konfliktpartner: eine zweite Tuer ueberdeckt das Geraet -> abgelehnt,
    # obwohl derselbe Code fuer dieses Geraet schon bestand.
    zweite = {"id": str(uuid.uuid4()), "kind": "door", "offset_mm": 100, "width_mm": 865,
              "height_mm": 2_010}  # fmt: skip
    partner = _speichern(api, token, raum, walls=mit_tuer(1_030, 900, zweite))
    assert partner.status_code == 422, partner.text
    assert fehlercodes(partner) == {"device-in-opening"}
    eintraege = partner.json()["errors"]
    assert [e["keys"] for e in eintraege] == [[steckdose["id"], zweite["id"]]]
    assert _zustand(engine) == vorher

    # Ueberdeckung verkleinern (5 mm): erlaubt.
    schmaler = _speichern(api, token, raum, walls=mit_tuer(1_035, 895))
    assert schmaler.status_code == 200, schmaler.text


# ------------------------------------------ unabhaengig / direkt geaendert


def test_unabhaengige_aenderung_bei_bestandskonflikt_ist_erlaubt(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine, betrieb: uuid.UUID
) -> None:
    floor_id = geschoss["floor"]["id"]
    raum = _raum_mit_plan(api, token, floor_id, height_mm=2_500)
    schalter = _wandgeraet(raum["walls"][1]["id"], 2_000, 2_150, typ="switch_single")
    assert _speichern(api, token, raum, devices=[schalter]).status_code == 200
    _bestand(engine, ElectricalRoom, raum["id"], height_mm=2_150)
    raum = _plan_raum(api, token, floor_id, raum["id"])

    # Ein neues, gueltiges Geraet und ein Fenster an einer anderen Wand.
    walls = _waende(raum)
    walls[2]["openings"] = [
        {
            "id": str(uuid.uuid4()),
            "kind": "window",
            "offset_mm": 1_000,
            "width_mm": 1_000,
            "height_mm": 1_000,
            "sill_height_mm": 900,
        }
    ]
    neu = _wandgeraet(raum["walls"][0]["id"], 1_000)
    antwort = _speichern(api, token, raum, walls=walls, devices=[*_geraete(raum), neu])
    assert antwort.status_code == 200, antwort.text
    assert (schalter["id"], "device-exceeds-room-height") in _befunde(engine, betrieb, floor_id)
    # Umbenennen ohne Geometriewirkung: ebenfalls erlaubt.
    umbenannt = api.patch(
        f"{BASIS}/rooms/{raum['id']}",
        headers={**auth_headers(token), "If-Match": raumversion(api, token, raum["id"])},
        json={"name": "Wohnen"},
    )
    assert umbenannt.status_code == 200, umbenannt.text


def test_direkt_geaendertes_geraet_muss_ganz_gueltig_sein(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor_id = geschoss["floor"]["id"]
    raum = _raum_mit_plan(api, token, floor_id, height_mm=2_500)
    schalter = _wandgeraet(raum["walls"][1]["id"], 2_000, 2_150, typ="switch_single")
    assert _speichern(api, token, raum, devices=[schalter]).status_code == 200
    _bestand(engine, ElectricalRoom, raum["id"], height_mm=2_150)
    raum = _plan_raum(api, token, floor_id, raum["id"])

    vorher = _zustand(engine)
    # Verschieben entlang der Wand und sogar etwas tiefer - der Konflikt wird
    # kleiner, aber das geaenderte Geraet bleibt ungueltig -> abgelehnt.
    verschoben = [{**_geraete(raum)[0], "center_offset_mm": 2_100, "center_height_mm": 2_140}]
    antwort = _speichern(api, token, raum, devices=verschoben)
    assert antwort.status_code == 422, antwort.text
    assert fehlercodes(antwort) == {"device-exceeds-room-height"}
    assert _zustand(engine) == vorher

    # Ganz unter die Decke: erlaubt.
    gueltig = [{**_geraete(raum)[0], "center_height_mm": 2_100}]
    assert _speichern(api, token, raum, devices=gueltig).status_code == 200
