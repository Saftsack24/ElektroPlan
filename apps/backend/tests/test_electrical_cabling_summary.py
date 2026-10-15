"""Mengenuebersicht eines Gebaeudes ueber die API (Phase 6b.6, ADR 0026, Entwurf §6.5/§21).

Sollwerte sind fachlich hergeleitet, nicht aus einem zweiten Aufruf derselben Funktion:

* Diele/Kueche wie §6.4 (``test_electrical_cables._szenario``), Verteilung UV1 bei 500/1 400.
* L1 §6.4: 800 + 3 700 + 2 100 + 1 900 = 8 500 mm, Zugaben 500 + 200 -> 9 200 mm, NYM-J 3 x 1.5.
* L2 UV1 -> Steckdose Sued 3 500/300 auf 2 200: 800 + 3 000 + 1 900 = 5 700 mm, NYM-J 3 x "1.50".
* L3 UV1 -> Steckdose 3 800/300 auf 1 000: 400 + 3 300 + 700 = 4 400 mm, NYM-J 5 x 1.5.
* L4 UV1 -> Kueche Sued 500/300 durch dieselbe Durchfuehrung, Querschnitt fehlt:
  800 + 3 700 + 2 100 + (3 000 - 900) + 500 + 1 900 = 11 100 mm.
* L5 UV1 -> Kueche West, Weg endet bei 1 700: offen, Teilsumme 800 + 1 200 = 2 000 + Zugabe 100.

Synthetische Daten. Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import sessionmaker

from app.core.module_registry.registry import ModuleRegistry
from app.core.projects.models import Project
from app.core.seed import seed_initial_data
from app.modules.electrical.models import ElectricalCable
from app.modules.electrical.permissions import PLAN_WRITE, ROUTE_WRITE
from tests import test_electrical_cables as kabel
from tests import test_electrical_circuits as kreise
from tests import test_electrical_rooms as raeume
from tests.conftest import ADMIN_PASSWORD, auth_headers, login, requires_database

pytestmark = [requires_database, pytest.mark.database]

betrieb = raeume.betrieb
ereignisse = raeume.ereignisse
token = raeume.token
geschoss = raeume.geschoss
BASIS = raeume.BASIS
fehlercodes = raeume.fehlercodes
raumversion = raeume.raumversion

_szenario = kabel._szenario
_beispiel = kabel._beispiel
_anlegen = kabel._anlegen
_mit = kabel._mit
_lage = kabel._lage
_geraete_setzen = kabel._geraete_setzen
_wandgeraet = kabel._wandgeraet
_waende = kabel._waende
_geraete = kabel._geraete
_bodenleitung = kabel._bodenleitung


def _uebersicht(api: TestClient, token: str, haus: str) -> dict[str, Any]:
    response = api.get(f"{BASIS}/buildings/{haus}/cabling-summary", headers=auth_headers(token))
    assert response.status_code == 200, response.text
    return dict(response.json())


def _wand(sz: dict[str, Any], wall: str, offset: int, height: int) -> dict[str, Any]:
    return {
        "kind": "wall",
        "wall_id": sz[wall[0]][int(wall[1])],
        "offset_mm": offset,
        "height_mm": height,
    }


def _leitungen(api: TestClient, token: str, sz: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """L1 bis L5 wie im Modulkopf; L4 nutzt die Durchfuehrung von L1."""
    l1 = _anlegen(api, token, sz, _beispiel(sz))
    assert l1.status_code == 201, l1.text
    pen = l1.json()["penetration_ids"][0]
    koerper = {
        "L2": {
            "label": "L2",
            "start_device_id": sz["uv1"],
            "end_device_id": sz["sd_sued"],
            "cable_type": "NYM-J",
            "conductor_count": 3,
            # Numerisch gleich wie "1.5" an L1 - dieselbe Gruppe.
            "cross_section_mm2": "1.50",
            "waypoints": [_wand(sz, "d0", 500, 2_200), _wand(sz, "d0", 3_500, 2_200)],
        },
        "L3": {
            "label": "L3",
            "start_device_id": sz["uv1"],
            "end_device_id": sz["sd_boden"],
            "cable_type": "NYM-J",
            "conductor_count": 5,
            "cross_section_mm2": "1.5",
            "waypoints": [_wand(sz, "d0", 500, 1_000), _wand(sz, "d0", 3_800, 1_000)],
        },
        "L4": {
            "label": "L4",
            "start_device_id": sz["uv1"],
            "end_device_id": sz["sd_k"],
            "cable_type": "NYM-J",
            "conductor_count": 3,
            "waypoints": [
                _wand(sz, "d0", 500, 2_200),
                _wand(sz, "d0", 4_200, 2_200),
                _wand(sz, "d1", 0, 2_200),
                {"kind": "penetration", "penetration_id": pen},
                _wand(sz, "k3", 900, 2_200),
                _wand(sz, "k3", 3_000, 2_200),
                _wand(sz, "k0", 0, 2_200),
            ],
        },
        "L5": {
            "label": "L5",
            "start_device_id": sz["uv1"],
            "end_device_id": sz["sd1"],
            "cable_type": "NYM-J",
            "conductor_count": 3,
            "cross_section_mm2": "1.5",
            "start_allowance_mm": 100,
            "waypoints": [_wand(sz, "d0", 500, 2_200), _wand(sz, "d0", 1_700, 2_200)],
        },
    }
    angelegt = {"L1": l1.json()}
    for name, body in koerper.items():
        response = _anlegen(api, token, sz, body)
        assert response.status_code == 201, response.text
        angelegt[name] = response.json()
    status = {name: (c["status"], c["length_mm"], c["known_mm"]) for name, c in angelegt.items()}
    assert status == {
        "L1": ("confirmed", 9_200, 9_200),
        "L2": ("confirmed", 5_700, 5_700),
        "L3": ("confirmed", 4_400, 4_400),
        "L4": ("confirmed", 11_100, 11_100),
        "L5": ("incomplete", None, 2_100),
    }
    return angelegt


def _gruppen(uebersicht: dict[str, Any]) -> dict[tuple[str, int, str], dict[str, Any]]:
    return {
        (g["cable_type"], g["conductor_count"], g["cross_section_mm2"]): g
        for g in uebersicht["groups"]
    }


def _eimer(bucket: dict[str, Any]) -> tuple[int, int, int, int]:
    return (bucket["count"], bucket["geometric_mm"], bucket["allowance_mm"], bucket["total_mm"])


# ------------------------------------------------------------------ Gruppen und Status


def test_gruppen_nach_tatsaechlichen_angaben_und_getrennten_status(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    sz = _szenario(api, token, geschoss)
    angelegt = _leitungen(api, token, sz)
    u = _uebersicht(api, token, sz["building"])
    assert u["building_id"] == sz["building"]
    assert u["project_status"] == geschoss["project"]["status"]

    gruppen = _gruppen(u)
    # Der Vorschlag von F1 (NYM-J 3 x 2.5) bildet keine Gruppe - nur tatsaechliche Angaben.
    assert set(gruppen) == {("NYM-J", 3, "1.50"), ("NYM-J", 5, "1.50")}
    drei = gruppen[("NYM-J", 3, "1.50")]
    assert _eimer(drei["confirmed"]) == (2, 8_500 + 5_700, 700, 9_200 + 5_700)
    assert set(drei["confirmed"]["cable_ids"]) == {angelegt["L1"]["id"], angelegt["L2"]["id"]}
    # Offen: nie in der bestaetigten Menge; Zugabe genau einmal und getrennt ausgewiesen.
    assert _eimer(drei["incomplete"]) == (1, 2_000, 100, 2_100)
    assert _eimer(drei["conflict"]) == (0, 0, 0, 0)
    assert _eimer(gruppen[("NYM-J", 5, "1.50")]["confirmed"]) == (1, 4_400, 0, 4_400)

    # Geometrisch bestaetigt, aber Querschnitt fehlt: unvollstaendig spezifiziert, keine Gruppe.
    (l4,) = u["unspecified"]
    assert (l4["id"], l4["status"], l4["length_mm"], l4["missing_spec"]) == (
        angelegt["L4"]["id"],
        "confirmed",
        11_100,
        ["cross_section_mm2"],
    )
    assert (l4["cable_type"], l4["conductor_count"], l4["cross_section_mm2"]) == ("NYM-J", 3, None)
    # Summen nur ueber vollstaendig angegebene Leitungen - L4 steht gesondert.
    assert _eimer(u["totals"]["confirmed"]) == (3, 14_200 + 4_400, 700, 14_900 + 4_400)
    assert _eimer(u["totals"]["incomplete"]) == (1, 2_000, 100, 2_100)
    # Aufschluesselung bis zur Leitung.
    assert {c["label"] for c in u["cables"]} == {"L1", "L2", "L3", "L4", "L5"}

    # Durchfuehrung von L1 und L4 nach Identitaet einmal, mit beiden Leitungen.
    (pen,) = u["penetrations"]
    assert pen["used"] and set(pen["cable_ids"]) == {angelegt["L1"]["id"], angelegt["L4"]["id"]}
    assert u["crossings"] == []


def test_unterbrechung_bestaetigt_wechselt_in_den_konfliktbereich(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    """Tuer des Bodenuebergangs entfernen (Entwurf §5.6): nur mit Bestaetigung, danach Konflikt.

    Leitung LB 300 + 1 500 + 400 + 500 + 1 500 + 300 = 4 500 mm; nach dem Entfernen bleibt die
    Teilsumme der gueltigen Teile 300 + 1 500 + 1 500 + 300 = 3 600 mm.
    """
    sz = _szenario(api, token, geschoss, tuer=True)
    tuer = sz["diele"]["walls"][1]["openings"][0]["id"]
    body = {
        **_bodenleitung(sz, tuer),
        "cable_type": "NYM-J",
        "conductor_count": 3,
        "cross_section_mm2": "1.5",
    }
    response = _anlegen(api, token, sz, body)
    assert response.status_code == 201, response.text
    lb = response.json()
    vorher = _uebersicht(api, token, sz["building"])
    assert _eimer(_gruppen(vorher)[("NYM-J", 3, "1.50")]["confirmed"]) == (1, 4_500, 0, 4_500)
    assert [(c["opening_id"], c["uses"]) for c in vorher["crossings"]] == [(tuer, 1)]

    diele = sz["diele"]
    ohne_tuer = _waende(diele)
    ohne_tuer[1]["openings"] = []

    def speichern(bestaetigt: list[str]) -> Any:
        return api.put(
            f"{BASIS}/rooms/{diele['id']}/contour",
            headers=_mit(auth_headers(token), raumversion(api, token, diele["id"])),
            json={
                "walls": ohne_tuer,
                "removed_opening_ids": [tuer],
                "devices": _geraete(diele),
                "acknowledged_cable_ids": bestaetigt,
            },
        )

    ohne = speichern([])
    assert ohne.status_code == 409 and fehlercodes(ohne) == {"cables-would-break"}, ohne.text
    assert _uebersicht(api, token, sz["building"]) == vorher
    mit = speichern([lb["id"]])
    assert mit.status_code == 200, mit.text
    nachher = _uebersicht(api, token, sz["building"])
    gruppe = _gruppen(nachher)[("NYM-J", 3, "1.50")]
    # Aus der bestaetigten Menge in den Konfliktbereich - nie in die bestaetigte Summe.
    assert _eimer(gruppe["confirmed"]) == (0, 0, 0, 0)
    assert _eimer(gruppe["conflict"]) == (1, 3_600, 0, 3_600)
    assert gruppe["conflict"]["cable_ids"] == [lb["id"]]
    assert _eimer(nachher["totals"]["confirmed"]) == (0, 0, 0, 0)
    # Der Uebergang bleibt als Nutzung sichtbar - ohne Oeffnung (entfernt).
    assert [(c["opening_id"], c["uses"]) for c in nachher["crossings"]] == [(None, 1)]
    # Bestaetigte Trassen enthalten die Leitung nicht mehr, die vorlaeufigen schon.
    boden = {s["surface"]: s for s in nachher["surfaces"]}["floor"]
    assert (boden["confirmed_trace_mm"], boden["all_trace_mm"]) == (0, 1_500 + 1_500)


def test_aenderung_loeschung_und_vorschlag(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    sz = _szenario(api, token, geschoss)
    angelegt = _leitungen(api, token, sz)
    # Leitung entfernen: die Menge folgt sofort - nichts ist gespeichert.
    weg = api.delete(f"{BASIS}/cables/{angelegt['L2']['id']}", headers=_mit(auth_headers(token), 1))
    assert weg.status_code == 204, weg.text
    drei = _gruppen(_uebersicht(api, token, sz["building"]))[("NYM-J", 3, "1.50")]
    assert _eimer(drei["confirmed"]) == (1, 8_500, 700, 9_200)
    # Leitung aendern (Querschnitt 2.5): wechselt die Gruppe.
    body = {**_beispiel(sz), "cross_section_mm2": "2.5"}
    body["waypoints"] = [
        *body["waypoints"][:3],
        {"kind": "penetration", "penetration_id": angelegt["L1"]["penetration_ids"][0]},
    ]
    body["new_penetrations"] = []
    geaendert = api.put(
        f"{BASIS}/cables/{angelegt['L1']['id']}", headers=_mit(auth_headers(token), 1), json=body
    )
    assert geaendert.status_code == 200, geaendert.text
    gruppen = _gruppen(_uebersicht(api, token, sz["building"]))
    assert _eimer(gruppen[("NYM-J", 3, "2.50")]["confirmed"]) == (1, 8_500, 700, 9_200)
    assert ("NYM-J", 3, "1.50") in gruppen and _eimer(gruppen[("NYM-J", 3, "1.50")]["confirmed"])[
        0
    ] == 0
    # Stromkreisvorschlag aendern: die tatsaechlichen Angaben der Leitungen bleiben.
    f1 = sz["f1"]
    vorschlag = api.patch(
        f"{BASIS}/circuits/{f1['id']}",
        headers=_mit(auth_headers(token), f1["version"]),
        json={
            "proposed_cable_type": "NYY-J",
            "proposed_conductor_count": 5,
            "proposed_cross_section_mm2": "4",
        },
    )
    assert vorschlag.status_code == 200, vorschlag.text
    nachher = _gruppen(_uebersicht(api, token, sz["building"]))
    assert set(nachher) == set(gruppen)
    assert ("NYY-J", 5, "4.00") not in nachher


def test_keine_seiteneffekte_und_lesbar_bei_abgeschlossenem_projekt(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    sz = _szenario(api, token, geschoss)
    _leitungen(api, token, sz)
    session = sessionmaker(bind=engine)()
    try:
        vorher = (
            session.execute(select(Project.version)).scalars().all(),
            session.execute(select(ElectricalCable.version)).scalars().all(),
        )
    finally:
        session.close()
    erste = _uebersicht(api, token, sz["building"])
    assert _uebersicht(api, token, sz["building"]) == erste
    session = sessionmaker(bind=engine)()
    try:
        nachher = (
            session.execute(select(Project.version)).scalars().all(),
            session.execute(select(ElectricalCable.version)).scalars().all(),
        )
        projekt = session.execute(select(Project)).scalars().one()
        projekt.status = "completed"
        session.commit()
    finally:
        session.close()
    assert nachher == vorher
    abgeschlossen = _uebersicht(api, token, sz["building"])
    assert abgeschlossen["project_status"] == "completed"
    assert abgeschlossen["groups"] == erste["groups"]


# ------------------------------------------------------------------ Trassen


def test_trassen_einmal_leitungsmeter_je_leitung_und_getrennte_flaechen(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    """Entwurf §5.4: L1, L2 ueber 0-4 000, L3 ueber 1 000-3 000 -> Trasse 4 000, Leitungen 10 000.

    Geraete auf derselben Hoehe (2 200), damit die Anschlussstrecken die Laenge 0 haben. Dazu
    L4 in einem zweiten Stromkreis ueber den Fussboden (1 500) mit zwei senkrechten
    Wandanschluessen (je 300) - Fussboden und Wand sind getrennte Flaechen.
    """
    floor = geschoss["floor"]["id"]
    haus = geschoss["building"]["id"]
    raum = kabel._plan_raum(
        api,
        token,
        floor,
        kabel._raum(api, token, floor, kabel._rechteck(5_000, 3_000), name="Flur")["id"],
    )
    w = [x["id"] for x in raum["walls"]]
    raum = _geraete_setzen(
        api,
        token,
        floor,
        raum,
        [
            _wandgeraet(w[2], 2_500, 1_400, typ="distribution_board"),
            _wandgeraet(w[0], 500, 2_200),
            _wandgeraet(w[0], 4_500, 2_200),
            _wandgeraet(w[0], 1_500, 2_200),
            _wandgeraet(w[0], 3_500, 2_200),
            _wandgeraet(w[0], 2_500, 300),
            _wandgeraet(w[0], 4_000, 300),
        ],
    )
    nach_lage = {
        (g["wall_id"], g["center_offset_mm"], g["center_height_mm"]): g["id"]
        for g in raum["devices"]
    }
    a, b = nach_lage[(w[0], 500, 2_200)], nach_lage[(w[0], 4_500, 2_200)]
    c, d = nach_lage[(w[0], 1_500, 2_200)], nach_lage[(w[0], 3_500, 2_200)]
    g, h = nach_lage[(w[0], 2_500, 300)], nach_lage[(w[0], 4_000, 300)]
    board = kreise._angelegte_verteilung(
        api, token, haus, placement_device_id=nach_lage[(w[2], 2_500, 1_400)]
    )
    f1 = kreise._angelegter_stromkreis(api, token, board["id"], "F1")
    f2 = kreise._angelegter_stromkreis(api, token, board["id"], "F2")
    assert kreise._zuordnen(api, token, f1, [a, b, c, d]).status_code == 200
    assert kreise._zuordnen(api, token, f2, [g, h]).status_code == 200

    def leitung(kreis: dict[str, Any], start: str, ende: str, punkte: list[dict[str, Any]]) -> None:
        response = api.post(
            f"{BASIS}/circuits/{kreis['id']}/cables",
            headers=auth_headers(token),
            json={
                "start_device_id": start,
                "end_device_id": ende,
                "cable_type": "NYM-J",
                "conductor_count": 3,
                "cross_section_mm2": "1.5",
                "waypoints": punkte,
            },
        )
        assert response.status_code == 201, response.text
        assert response.json()["status"] == "confirmed", response.json()["problems"]

    def wand(offset: int, height: int) -> dict[str, Any]:
        return {"kind": "wall", "wall_id": w[0], "offset_mm": offset, "height_mm": height}

    leitung(f1, a, b, [wand(500, 2_200), wand(4_500, 2_200)])
    leitung(f1, a, b, [wand(500, 2_200), wand(4_500, 2_200)])
    leitung(f1, c, d, [wand(1_500, 2_200), wand(3_500, 2_200)])
    leitung(
        f2,
        g,
        h,
        [
            wand(2_500, 0),
            {"kind": "floor", "room_id": raum["id"], "x_mm": 2_500, "y_mm": 0},
            {"kind": "floor", "room_id": raum["id"], "x_mm": 4_000, "y_mm": 0},
            wand(4_000, 0),
        ],
    )
    flaechen = {s["surface"]: s for s in _uebersicht(api, token, haus)["surfaces"]}
    assert (flaechen["wall"]["confirmed_trace_mm"], flaechen["wall"]["confirmed_cable_mm"]) == (
        4_000 + 300 + 300,
        10_000 + 300 + 300,
    )
    assert (flaechen["floor"]["confirmed_trace_mm"], flaechen["floor"]["confirmed_cable_mm"]) == (
        1_500,
        1_500,
    )
    assert flaechen["ceiling"]["confirmed_trace_mm"] == flaechen["riser"]["confirmed_trace_mm"] == 0
    # Alles bestaetigt: keine vorlaeufigen Anteile.
    assert all(s["all_trace_mm"] == s["confirmed_trace_mm"] for s in flaechen.values())


def test_vorlaeufige_teilstrecken_getrennt_von_bestaetigten_trassen(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    """L5 (offen) liegt auf 500-1 700 unter L1/L2 (500-4 200 bzw. 500-3 500, Hoehe 2 200)."""
    sz = _szenario(api, token, geschoss)
    _leitungen(api, token, sz)
    flaechen = {s["surface"]: s for s in _uebersicht(api, token, sz["building"])["surfaces"]}
    wand = flaechen["wall"]
    # Die Trasse von L5 liegt vollstaendig in bestaetigten Trassen - keine zusaetzliche Trasse,
    # aber ihre Leitungsmeter (1 200 + 800 Anschluss) zaehlen nur mit vorlaeufigen Anteilen.
    assert wand["all_trace_mm"] == wand["confirmed_trace_mm"]
    assert wand["all_cable_mm"] == wand["confirmed_cable_mm"] + 1_200 + 800


def test_gemeinsam_genutzter_steigweganteil_einmal(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    """Zwei Leitungen EG -> OG ueber denselben Steigweg ab 2 200: Trasse 450 + 300 + 700 einmal."""
    eg = geschoss["floor"]
    haus = geschoss["building"]["id"]
    assert (
        api.patch(
            f"/api/v1/floors/{eg['id']}",
            headers=_mit(auth_headers(token), eg["version"]),
            json={"elevation_mm": 0, "elevation_confirmed": True},
        ).status_code
        == 200
    )
    og = api.post(
        f"/api/v1/buildings/{haus}/floors",
        headers=auth_headers(token),
        json={
            "name": "OG",
            "level": 1,
            "elevation_mm": 2_900,
            "elevation_confirmed": True,
            "default_ceiling_height_mm": 2_500,
        },
    ).json()
    hwr = kabel._plan_raum(
        api,
        token,
        eg["id"],
        kabel._raum(api, token, eg["id"], kabel._rechteck(4_000, 3_400), name="HWR")["id"],
    )
    bad = kabel._plan_raum(
        api,
        token,
        og["id"],
        kabel._raum(api, token, og["id"], kabel._rechteck(4_000, 4_000), name="Bad")["id"],
    )
    eg_nord, og_nord = hwr["walls"][2]["id"], bad["walls"][2]["id"]
    hwr = _geraete_setzen(
        api, token, eg["id"], hwr, [_wandgeraet(eg_nord, 2_000, 1_400, typ="distribution_board")]
    )
    bad = _geraete_setzen(
        api,
        token,
        og["id"],
        bad,
        [_wandgeraet(og_nord, 2_350, 300), _wandgeraet(og_nord, 2_350, 1_100)],
    )
    uv = hwr["devices"][0]["id"]
    ziele = [d["id"] for d in sorted(bad["devices"], key=lambda d: d["center_height_mm"])]
    board = kreise._angelegte_verteilung(api, token, haus, placement_device_id=uv)
    f1 = kreise._angelegter_stromkreis(api, token, board["id"])
    assert kreise._zuordnen(api, token, f1, ziele).status_code == 200
    riser = api.post(
        f"{BASIS}/buildings/{haus}/risers",
        headers=auth_headers(token),
        json={
            "name": "Schacht",
            "offset_mode": "orthogonal",
            "stops": [
                {"floor_id": eg["id"], "x_mm": 1_200, "y_mm": 3_400},
                {"floor_id": og["id"], "x_mm": 1_650, "y_mm": 3_700},
            ],
        },
    ).json()
    halt = {s["floor_id"]: s["id"] for s in riser["stops"]}
    for ziel in ziele:
        response = api.post(
            f"{BASIS}/circuits/{f1['id']}/cables",
            headers=auth_headers(token),
            json={
                "start_device_id": uv,
                "end_device_id": ziel,
                "waypoints": [
                    {"kind": "wall", "wall_id": eg_nord, "offset_mm": 2_000, "height_mm": 2_200},
                    {"kind": "wall", "wall_id": eg_nord, "offset_mm": 2_800, "height_mm": 2_200},
                    {
                        "kind": "riser",
                        "riser_id": riser["id"],
                        "from_stop_id": halt[eg["id"]],
                        "from_height_mm": 2_200,
                        "to_stop_id": halt[og["id"]],
                        "to_height_mm": 0,
                    },
                    {"kind": "floor", "room_id": bad["id"], "x_mm": 1_650, "y_mm": 3_700},
                    {"kind": "floor", "room_id": bad["id"], "x_mm": 1_650, "y_mm": 4_000},
                    {"kind": "wall", "wall_id": og_nord, "offset_mm": 2_350, "height_mm": 0},
                ],
            },
        )
        assert response.status_code == 201, response.text
        assert response.json()["status"] == "confirmed"
    flaechen = {s["surface"]: s for s in _uebersicht(api, token, haus)["surfaces"]}
    assert (flaechen["riser"]["confirmed_trace_mm"], flaechen["riser"]["confirmed_cable_mm"]) == (
        1_450,
        2_900,
    )
    assert flaechen["riser"]["confirmed_complete"]
    # Fussboden OG: dieselbe Strecke zweimal - Trasse 300 einmal, Leitungsmeter 600.
    assert (flaechen["floor"]["confirmed_trace_mm"], flaechen["floor"]["confirmed_cable_mm"]) == (
        300,
        600,
    )


# ------------------------------------------------------------------ Uebergaenge und Geraete


def test_durchfuehrung_ungenutzt_und_bodenuebergang_als_nutzung(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    sz = _szenario(api, token, geschoss, tuer=True)
    tuer = sz["diele"]["walls"][1]["openings"][0]["id"]
    for _ in range(2):
        response = _anlegen(api, token, sz, _bodenleitung(sz, tuer))
        assert response.status_code == 201, response.text
    # Neue Durchfuehrung mit Leitung anlegen und die Leitung wieder entfernen: bleibt, ungenutzt.
    mit = _anlegen(api, token, sz, _beispiel(sz))
    assert mit.status_code == 201, mit.text
    weg = api.delete(f"{BASIS}/cables/{mit.json()['id']}", headers=_mit(auth_headers(token), 1))
    assert weg.status_code == 204
    u = _uebersicht(api, token, sz["building"])
    (pen,) = u["penetrations"]
    assert (pen["used"], pen["cable_ids"]) == (False, [])
    (crossing,) = u["crossings"]
    # Zwei Nutzungen derselben Tuer - kein Bauteil, keine Stueckzahl.
    assert (crossing["opening_id"], crossing["uses"], len(crossing["cable_ids"])) == (tuer, 2, 2)


def test_geraete_je_stromkreis_nicht_zugeordnet_und_ohne_leitung(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    sz = _szenario(api, token, geschoss)
    kueche = _geraete_setzen(
        api,
        token,
        sz["floor"],
        sz["kueche"],
        [
            _wandgeraet(sz["k"][1], 1_000, 300),
            _wandgeraet(sz["k"][1], 2_000, 300, typ="data_single"),
        ],
    )
    frei = next(
        g["id"]
        for g in kueche["devices"]
        if g["wall_id"] == sz["k"][1] and g["device_type_key"] == "socket_single"
    )
    angelegt = _leitungen(api, token, sz)
    assert angelegt
    u = _uebersicht(api, token, sz["building"])
    # Nicht zugeordnet: nur die zuordenbare Steckdose - nicht die Datendose, nicht UV1.
    assert u["unassigned_device_ids"] == [frei]
    kreis = {c["designation"]: c for c in u["circuits"]}
    assert {t["type_key"]: t["count"] for t in kreis["F1"]["by_type"]} == {
        "light_outdoor": 1,
        "socket_single": 4,
    }
    # Ohne Leitung: Aussenleuchte (F1) und Steckdose Nord (F2) - keine Ausfuehrbarkeitsaussage.
    assert kreis["F1"]["devices_without_cable"] == [sz["aussen"]]
    assert kreis["F2"]["devices_without_cable"] == [sz["sd_fremd"]]


# ------------------------------------------------------------------ Rechte und Mandant


def test_rechte_mandant_und_fremdes_gebaeude(
    api: TestClient,
    token: str,
    betrieb: uuid.UUID,
    engine: Engine,
    geschoss: dict[str, Any],
    registry: ModuleRegistry,
) -> None:
    sz = _szenario(api, token, geschoss)
    _leitungen(api, token, sz)
    url = f"{BASIS}/buildings/{sz['building']}/cabling-summary"
    raeume._mitglied_mit_permissions(
        engine, betrieb, "ohne-lesen@menge.example", (PLAN_WRITE, ROUTE_WRITE)
    )
    ohne = login(api, "ohne-lesen@menge.example")
    assert api.get(url, headers=auth_headers(ohne)).status_code == 403
    unbekannt = api.get(
        f"{BASIS}/buildings/{uuid.uuid4()}/cabling-summary", headers=auth_headers(token)
    )
    assert unbekannt.status_code == 404
    session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    try:
        seed_initial_data(
            session,
            registry,
            organization_name="Fremdbetrieb GmbH",
            admin_email="fremd@menge.example",
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
    finally:
        session.close()
    fremd = login(api, "fremd@menge.example")
    # Fremder Betrieb: 404 wie bei einem unbekannten Gebaeude - nichts wird verraten.
    antwort = api.get(url, headers=auth_headers(fremd))
    assert antwort.status_code == 404 and antwort.json()["type"].endswith("/not-found")
    # Das eigene Gebaeude des fremden Betriebs ist leer, nicht mit fremden Mengen gefuellt.
    eigenes = raeume._struktur(api, fremd, name="Fremdprojekt")
    leer = _uebersicht(api, fremd, eigenes["building"]["id"])
    assert (leer["groups"], leer["cables"], leer["penetrations"], leer["circuits"]) == (
        [],
        [],
        [],
        [],
    )
