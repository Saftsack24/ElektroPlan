"""Leitungen, Wegpunkte und Durchfuehrungen ueber die API (Phase 6b.3, ADR 0026).

Sollwerte sind fachlich hergeleitet, nicht aus einem zweiten Aufruf derselben
Funktion: Beispiel §6.4 (Diele -> Kueche durch eine Durchfuehrung: 800 + 3 700 +
2 100 + 1 900 = 8 500 mm, mit Zugaben 500 + 200 = 9 200 mm), Bodenuebergang
(300 + 1 500 + 400 + 500 + 1 500 + 300 = 4 500 mm), Steigweg (800 + 800 + 700 + 750
+ 300 + 300 = 3 650 mm). Dieselben Faelle stehen in ``testdata/geometry/leitung.v1.json``.

Jeder abgelehnte Fall prueft zusaetzlich, dass nichts gespeichert wurde.
Synthetische Daten. Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import sessionmaker

from app.modules.electrical.models import (
    ElectricalCable,
    ElectricalCableWaypoint,
    ElectricalWallPenetration,
)
from app.modules.electrical.permissions import CIRCUIT_WRITE, PLAN_READ, PLAN_WRITE, ROUTE_WRITE
from tests import test_electrical_circuits as kreise
from tests import test_electrical_devices_api as geraete
from tests import test_electrical_rooms as raeume
from tests.conftest import auth_headers, login, requires_database

pytestmark = [requires_database, pytest.mark.database]

betrieb = raeume.betrieb
ereignisse = raeume.ereignisse
token = raeume.token
geschoss = raeume.geschoss
BASIS = raeume.BASIS
fehlercodes = raeume.fehlercodes
raumversion = raeume.raumversion

_rechteck = geraete._rechteck
_raum = geraete._raum
_plan_raum = geraete._plan_raum
_waende = geraete._waende
_geraete = geraete._geraete
_wandgeraet = geraete._wandgeraet
_speichern = geraete._speichern


# ------------------------------------------------------------------ Aufbau


def _mit(headers: dict[str, str], version: int | str) -> dict[str, str]:
    return {**headers, "If-Match": str(version)}


def _geraete_setzen(
    api: TestClient, token: str, floor_id: str, raum: dict[str, Any], neu: list[dict[str, Any]]
) -> dict[str, Any]:
    response = _speichern(api, token, raum, devices=[*_geraete(raum), *neu])
    assert response.status_code == 200, response.text
    return _plan_raum(api, token, floor_id, raum["id"])


def _szenario(
    api: TestClient, token: str, geschoss: dict[str, Any], *, tuer: bool = False
) -> dict[str, Any]:
    """Diele (0,0)-(4200,3000) und Kueche (4200,0)-(8000,3000), Raumhoehe 2 500 (§6.4).

    Diele: Verteilung UV1 an der Suedwand (Mitte 500/1 400), Steckdosen Sued 3 500/300
    und 3 800/300, Aussenleuchte West. Kueche: Steckdose West 900/300 (y = 2 100),
    Steckdose Sued 500/300, Steckdose Nord 1 000/300 (anderer Stromkreis).
    ``tuer``: Tuer in Diele.ost bei 1 000, Breite 900 (Bodenuebergang).
    """
    floor = geschoss["floor"]["id"]
    diele_waende = _rechteck(4_200, 3_000)
    if tuer:
        diele_waende[1]["openings"] = [
            {
                "id": str(uuid.uuid4()),
                "kind": "door",
                "offset_mm": 1_000,
                "width_mm": 900,
                "height_mm": 2_000,
                "sill_height_mm": 0,
            }
        ]
    diele = _plan_raum(
        api, token, floor, _raum(api, token, floor, diele_waende, name="Diele")["id"]
    )
    kueche = _plan_raum(
        api,
        token,
        floor,
        _raum(api, token, floor, _rechteck(3_800, 3_000, x=4_200), name="Kueche")["id"],
    )
    d = [w["id"] for w in diele["walls"]]
    k = [w["id"] for w in kueche["walls"]]
    diele = _geraete_setzen(
        api,
        token,
        floor,
        diele,
        [
            _wandgeraet(d[0], 500, 1_400, typ="distribution_board"),
            _wandgeraet(d[0], 3_500, 300),
            _wandgeraet(d[0], 3_800, 300, label="Boden"),
            _wandgeraet(d[3], 1_500, 1_400, typ="light_outdoor", flaeche="wall_exterior"),
        ],
    )
    kueche = _geraete_setzen(
        api,
        token,
        floor,
        kueche,
        [
            _wandgeraet(k[3], 900, 300),
            _wandgeraet(k[0], 500, 300),
            _wandgeraet(k[2], 1_000, 300),
        ],
    )

    def geraet(raum: dict[str, Any], wand: str, mitte: int) -> str:
        return str(
            next(
                g["id"]
                for g in raum["devices"]
                if g["wall_id"] == wand and g["center_offset_mm"] == mitte
            )
        )

    link = api.post(
        f"{BASIS}/floors/{floor}/wall-links",
        headers=auth_headers(token),
        json={"wall_a_id": d[1], "wall_b_id": k[3], "relation": "shared"},
    )
    assert link.status_code == 201, link.text
    haus = geschoss["building"]["id"]
    ids = {
        "uv1": geraet(diele, d[0], 500),
        "sd_sued": geraet(diele, d[0], 3_500),
        "sd_boden": geraet(diele, d[0], 3_800),
        "aussen": geraet(diele, d[3], 1_500),
        "sd1": geraet(kueche, k[3], 900),
        "sd_k": geraet(kueche, k[0], 500),
        "sd_fremd": geraet(kueche, k[2], 1_000),
    }
    uv1 = kreise._angelegte_verteilung(api, token, haus, placement_device_id=ids["uv1"])
    f1 = kreise._angelegter_stromkreis(
        api,
        token,
        uv1["id"],
        "F1",
        proposed_cable_type="NYM-J",
        proposed_conductor_count=3,
        proposed_cross_section_mm2="2.5",
    )
    f2 = kreise._angelegter_stromkreis(api, token, uv1["id"], "F2")
    zu = kreise._zuordnen(
        api, token, f1, [ids[n] for n in ("sd_sued", "sd_boden", "aussen", "sd1", "sd_k")]
    )
    assert zu.status_code == 200, zu.text
    assert kreise._zuordnen(api, token, f2, [ids["sd_fremd"]]).status_code == 200
    return {
        **ids,
        "floor": floor,
        "building": haus,
        "diele": diele,
        "kueche": kueche,
        "d": d,
        "k": k,
        "link": link.json(),
        "board": uv1,
        "f1": api.get(f"{BASIS}/buildings/{haus}/circuits", headers=auth_headers(token)).json()[
            "circuits"
        ][0],
        "f2": f2,
    }


def _lage(sz: dict[str, Any], y_mm: int) -> int:
    """Abstand an ``wall_a`` der Kopplung fuer den Punkt ``y`` auf der Achse x = 4 200.

    Gespeichert wird an ``wall_a`` (kanonisch die kleinere ID): Diele.ost laeuft von
    y = 0 nach oben, Kueche.west von y = 3 000 nach unten.
    """
    return y_mm if sz["link"]["wall_a_id"] == sz["d"][1] else 3_000 - y_mm


def _beispiel(sz: dict[str, Any], **extra: object) -> dict[str, Any]:
    """§6.4: UV1 -> Steckdose Kueche durch eine neue Durchfuehrung bei y = 2 100, h = 2 200."""
    d = sz["d"]
    koerper: dict[str, Any] = {
        "label": "L1",
        "start_device_id": sz["uv1"],
        "end_device_id": sz["sd1"],
        "cable_type": "NYM-J",
        "conductor_count": 3,
        "cross_section_mm2": "1.5",
        "start_allowance_mm": 500,
        "end_allowance_mm": 200,
        "waypoints": [
            {"kind": "wall", "wall_id": d[0], "offset_mm": 500, "height_mm": 2_200},
            {"kind": "wall", "wall_id": d[0], "offset_mm": 4_200, "height_mm": 2_200},
            {"kind": "wall", "wall_id": d[1], "offset_mm": 0, "height_mm": 2_200},
            {"kind": "penetration", "new_penetration_key": "d1"},
        ],
        "new_penetrations": [
            {
                "key": "d1",
                "wall_link_id": sz["link"]["id"],
                "offset_mm": _lage(sz, 2_100),
                "height_mm": 2_200,
            }
        ],
    }
    koerper.update(extra)
    return koerper


def _anlegen(
    api: TestClient, token: str, sz: dict[str, Any], koerper: dict[str, Any], kreis: str = "f1"
) -> Any:
    return api.post(
        f"{BASIS}/circuits/{sz[kreis]['id']}/cables", headers=auth_headers(token), json=koerper
    )


def _leitungen(api: TestClient, token: str, sz: dict[str, Any]) -> list[dict[str, Any]]:
    response = api.get(f"{BASIS}/buildings/{sz['building']}/cables", headers=auth_headers(token))
    assert response.status_code == 200, response.text
    return list(response.json()["cables"])


def _db(engine: Engine) -> tuple[int, int, int]:
    """(Leitungen, Wegpunkte, Durchfuehrungen) in der Datenbank."""
    session = sessionmaker(bind=engine)()
    try:
        return (
            int(session.execute(select(func.count()).select_from(ElectricalCable)).scalar_one()),
            int(
                session.execute(
                    select(func.count()).select_from(ElectricalCableWaypoint)
                ).scalar_one()
            ),
            int(
                session.execute(
                    select(func.count()).select_from(ElectricalWallPenetration)
                ).scalar_one()
            ),
        )
    finally:
        session.close()


def _strecken(cable: dict[str, Any]) -> list[list[Any]]:
    return [[s["kind"], s["ref"], s["length_mm"]] for s in cable["segments"]]


# ------------------------------------------------------------------ Beispiel §6.4


def test_beispiel_8500_9200_mit_neuer_durchfuehrung(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    sz = _szenario(api, token, geschoss)
    response = _anlegen(api, token, sz, _beispiel(sz))
    assert response.status_code == 201, response.text
    cable = response.json()
    assert (cable["status"], cable["geometric_mm"], cable["allowance_mm"]) == (
        "confirmed",
        8_500,
        700,
    )
    assert (cable["length_mm"], cable["known_mm"]) == (9_200, 9_200)
    assert _strecken(cable) == [
        ["connection", "start", 800],
        ["wall", "w0-w1", 3_700],
        ["corner", "w1-w2", 0],
        ["wall", "w2-w3", 2_100],
        ["penetration", "w3", 0],
        ["connection", "end", 1_900],
    ]
    # Kabelangaben stehen an der Leitung; der Vorschlag (2,5) wird nicht ergaenzt.
    assert (cable["cable_type"], cable["conductor_count"], cable["cross_section_mm2"]) == (
        "NYM-J",
        3,
        "1.50",
    )
    assert cable["spec_complete"] and cable["deviates_from_proposal"]
    # Raumpunkte stetig ueber die Durchfuehrung: Diele bei y = 2 100 = Kueche bei 900.
    wand_ost = cable["segments"][3]["points"]
    anschluss = cable["segments"][5]["points"]
    assert wand_ost[-1] == anschluss[0] == {"x_mm": 4_200, "y_mm": 2_100, "z_mm": 2_200}
    assert anschluss[-1] == {"x_mm": 4_200, "y_mm": 2_100, "z_mm": 300}
    assert [w["kind"] for w in cable["waypoints"]] == ["wall", "wall", "wall", "penetration"]
    assert _db(engine) == (1, 4, 1)

    liste = _leitungen(api, token, sz)
    assert [c["id"] for c in liste] == [cable["id"]] and liste[0]["length_mm"] == 9_200
    durch = api.get(f"{BASIS}/floors/{sz['floor']}/penetrations", headers=auth_headers(token))
    assert durch.status_code == 200, durch.text
    (pen,) = durch.json()["penetrations"]
    assert pen["problem_code"] is None and pen["cable_ids"] == [cable["id"]]
    # Gegenlage an wall_b: Kueche.west bei 900 bzw. Diele.ost bei 2 100.
    gegen = 900 if sz["link"]["wall_a_id"] == sz["d"][1] else 2_100
    assert pen["opposite_offset"] == {"whole": gegen, "steps": 0, "rounded_mm": gegen}

    # Leitung entfernen: die Durchfuehrung bleibt sichtbar bestehen, nun ungenutzt.
    weg = api.delete(f"{BASIS}/cables/{cable['id']}", headers=_mit(auth_headers(token), 1))
    assert weg.status_code == 204, weg.text
    assert _db(engine) == (0, 0, 1)


def test_neue_durchfuehrung_und_leitung_entstehen_atomar(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    sz = _szenario(api, token, geschoss)
    # Durchfuehrung auf Raumhoehe: nicht unter beiden Raumhoehen.
    zu_hoch = _beispiel(sz)
    zu_hoch["new_penetrations"][0]["height_mm"] = 2_500
    response = _anlegen(api, token, sz, zu_hoch)
    assert response.status_code == 422, response.text
    assert fehlercodes(response) == {"penetration-height"}
    # Gueltige Durchfuehrung, aber unzulaessiger Weg: auch die Durchfuehrung entsteht nicht.
    schraeg = _beispiel(sz)
    # w0 auf 2 000, w1 auf 2 200: nur die Strecke w0-w1 ist schraeg.
    schraeg["waypoints"][0] = {
        "kind": "wall",
        "wall_id": sz["d"][0],
        "offset_mm": 500,
        "height_mm": 2_000,
    }
    response = _anlegen(api, token, sz, schraeg)
    assert response.status_code == 422, response.text
    assert fehlercodes(response) == {"wall-diagonal"}
    # Eine neue Durchfuehrung entsteht nur mit der Leitung, die sie nutzt.
    ungenutzt = _beispiel(sz)
    ungenutzt["new_penetrations"].append({**ungenutzt["new_penetrations"][0], "key": "d2"})
    response = _anlegen(api, token, sz, ungenutzt)
    assert response.status_code == 422, response.text
    assert fehlercodes(response) == {"penetration-unused"}
    assert _db(engine) == (0, 0, 0)


def test_unvollstaendig_wird_gespeichert_unzulaessig_nicht(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    sz = _szenario(api, token, geschoss)
    d, k = sz["d"], sz["k"]
    offen = _anlegen(
        api,
        token,
        sz,
        {
            "start_device_id": sz["uv1"],
            "end_device_id": sz["sd1"],
            "waypoints": [{"kind": "wall", "wall_id": d[0], "offset_mm": 500, "height_mm": 2_200}],
        },
    )
    assert offen.status_code == 201, offen.text
    leitung = offen.json()
    # Weg erreicht das Endgeraet nicht: unvollstaendig, nur die Teilsumme 800 ist bekannt.
    assert (leitung["status"], leitung["length_mm"], leitung["known_mm"]) == (
        "incomplete",
        None,
        800,
    )
    assert [(p["code"], p["kind"], p["ref"]) for p in leitung["problems"]] == [
        ("route-not-reaching-end", "missing", "end")
    ]
    assert not leitung["spec_complete"]
    raumwechsel = _anlegen(
        api,
        token,
        sz,
        {
            "start_device_id": sz["uv1"],
            "end_device_id": sz["sd1"],
            "waypoints": [
                {"kind": "wall", "wall_id": d[0], "offset_mm": 500, "height_mm": 2_200},
                {"kind": "wall", "wall_id": d[0], "offset_mm": 4_200, "height_mm": 2_200},
                {"kind": "wall", "wall_id": d[1], "offset_mm": 0, "height_mm": 2_200},
                {"kind": "wall", "wall_id": d[1], "offset_mm": 2_100, "height_mm": 2_200},
                {"kind": "wall", "wall_id": k[3], "offset_mm": 900, "height_mm": 2_200},
            ],
        },
    )
    assert raumwechsel.status_code == 422, raumwechsel.text
    assert fehlercodes(raumwechsel) == {"room-change-without-crossing"}
    assert _db(engine) == (1, 1, 0)


def test_endgeraete_gehoeren_zu_stromkreis_und_gebaeude(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    sz = _szenario(api, token, geschoss)
    garage = kreise._zweites_gebaeude(api, token, geschoss["project"]["id"])
    g_floor = garage["floor"]["id"]
    g_raum = _plan_raum(
        api, token, g_floor, _raum(api, token, g_floor, _rechteck(3_000, 3_000))["id"]
    )
    g_raum = _geraete_setzen(
        api, token, g_floor, g_raum, [_wandgeraet(g_raum["walls"][0]["id"], 1_000)]
    )
    fremde_steckdose = g_raum["devices"][0]["id"]
    wand = {"kind": "wall", "wall_id": sz["d"][0], "offset_mm": 3_500, "height_mm": 2_200}

    def versuch(**koerper: object) -> set[str]:
        response = _anlegen(api, token, sz, {"waypoints": [wand], **koerper})
        assert response.status_code == 422, response.text
        return fehlercodes(response)

    assert versuch(start_device_id=sz["uv1"], end_device_id=sz["sd_fremd"]) == {
        "cable-endpoint-not-in-circuit"
    }
    assert versuch(start_device_id=sz["uv1"], end_device_id=fremde_steckdose) == {
        "cable-endpoint-not-in-building"
    }
    assert versuch(start_device_id=None, end_device_id=sz["sd_sued"]) == {"cable-start-required"}
    assert versuch(start_device_id=sz["uv1"], end_device_id=sz["uv1"]) == {"cable-endpoints-equal"}
    assert versuch(start_device_id=sz["uv1"], end_device_id=sz["aussen"]) == {
        "cable-endpoint-exterior"
    }
    # Wegpunkt an einer Wand des anderen Gebaeudes: dieselbe Antwort wie fuer fremde IDs.
    response = _anlegen(
        api,
        token,
        sz,
        {
            "start_device_id": sz["uv1"],
            "end_device_id": sz["sd_sued"],
            "waypoints": [{**wand, "wall_id": g_raum["walls"][0]["id"]}],
        },
    )
    assert response.status_code == 422 and fehlercodes(response) == {"cable-reference-unknown"}
    assert _db(engine) == (0, 0, 0)


# ------------------------------------------------------------- Versionen, Rechte, Status


def test_versionen_und_vorbedingung(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    sz = _szenario(api, token, geschoss)
    cable = _anlegen(api, token, sz, _beispiel(sz)).json()
    ohne = api.put(f"{BASIS}/cables/{cable['id']}", headers=auth_headers(token), json=_beispiel(sz))
    assert ohne.status_code == 428
    koerper = _beispiel(sz, label="L1 neu", new_penetrations=[])
    koerper["waypoints"][3] = {"kind": "penetration", "penetration_id": cable["penetration_ids"][0]}
    neu = api.put(
        f"{BASIS}/cables/{cable['id']}", headers=_mit(auth_headers(token), 1), json=koerper
    )
    assert neu.status_code == 200, neu.text
    assert (neu.json()["version"], neu.json()["label"], neu.json()["length_mm"]) == (
        2,
        "L1 neu",
        9_200,
    )
    veraltet = api.put(
        f"{BASIS}/cables/{cable['id']}", headers=_mit(auth_headers(token), 1), json=koerper
    )
    assert veraltet.status_code == 409 and veraltet.json()["type"].endswith("version-conflict")
    weg = api.delete(f"{BASIS}/cables/{cable['id']}", headers=_mit(auth_headers(token), 1))
    assert weg.status_code == 409
    # Unveraendert gespeichert: keine neue Version.
    gleich = api.put(
        f"{BASIS}/cables/{cable['id']}", headers=_mit(auth_headers(token), 2), json=koerper
    )
    assert gleich.status_code == 200 and gleich.json()["version"] == 2
    assert _db(engine) == (1, 4, 1)


def test_rechte_sind_getrennt(
    api: TestClient, token: str, betrieb: uuid.UUID, engine: Engine, geschoss: dict[str, Any]
) -> None:
    sz = _szenario(api, token, geschoss)
    cable = _anlegen(api, token, sz, _beispiel(sz)).json()
    pen = cable["penetration_ids"][0]
    raeume._mitglied_mit_permissions(
        engine, betrieb, "kreise@kabel.example", (PLAN_READ, PLAN_WRITE, CIRCUIT_WRITE)
    )
    raeume._mitglied_mit_permissions(
        engine, betrieb, "wege@kabel.example", (PLAN_READ, ROUTE_WRITE)
    )
    kreise_token = login(api, "kreise@kabel.example")
    assert len(_leitungen(api, kreise_token, sz)) == 1
    antworten = [
        _anlegen(api, kreise_token, sz, _beispiel(sz)),
        api.put(
            f"{BASIS}/cables/{cable['id']}",
            headers=_mit(auth_headers(kreise_token), 1),
            json=_beispiel(sz),
        ),
        api.delete(f"{BASIS}/cables/{cable['id']}", headers=_mit(auth_headers(kreise_token), 1)),
        api.patch(
            f"{BASIS}/penetrations/{pen}",
            headers=_mit(auth_headers(kreise_token), 1),
            json={"note": "x"},
        ),
        api.delete(f"{BASIS}/penetrations/{pen}", headers=_mit(auth_headers(kreise_token), 1)),
        # Bestaetigen im Raumentwurf verlangt zusaetzlich route.write.
        api.put(
            f"{BASIS}/rooms/{sz['diele']['id']}/contour",
            headers=_mit(auth_headers(kreise_token), raumversion(api, token, sz["diele"]["id"])),
            json={
                "walls": _waende(sz["diele"]),
                "devices": _geraete(sz["diele"]),
                "acknowledged_cable_ids": [cable["id"]],
            },
        ),
    ]
    assert [r.status_code for r in antworten] == [403] * 6
    wege_token = login(api, "wege@kabel.example")
    vorschlag = api.post(
        f"{BASIS}/cables/{cable['id']}/apply-proposal",
        headers=_mit(auth_headers(wege_token), 1),
        json={"expected_circuit_version": sz["f1"]["version"]},
    )
    assert vorschlag.status_code == 403
    assert _db(engine) == (1, 4, 1)


@pytest.mark.parametrize("status", ["completed", "archived"])
def test_schreibschutz_fuer_alle_neuen_schreibwege(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine, status: str
) -> None:
    sz = _szenario(api, token, geschoss)
    cable = _anlegen(api, token, sz, _beispiel(sz)).json()
    pen = cable["penetration_ids"][0]
    projekt = geschoss["project"]
    for schritt in (
        ("activate", "complete") if status == "completed" else ("activate", "complete", "archive")
    ):
        aktuell = api.get(f"/api/v1/projects/{projekt['id']}", headers=auth_headers(token)).json()
        response = api.post(
            f"/api/v1/projects/{projekt['id']}/{schritt}",
            headers=_mit(auth_headers(token), aktuell["version"]),
        )
        assert response.status_code == 200, response.text
    antworten = [
        _anlegen(api, token, sz, _beispiel(sz)),
        api.put(
            f"{BASIS}/cables/{cable['id']}",
            headers=_mit(auth_headers(token), 1),
            json=_beispiel(sz),
        ),
        api.delete(f"{BASIS}/cables/{cable['id']}", headers=_mit(auth_headers(token), 1)),
        api.post(
            f"{BASIS}/cables/{cable['id']}/apply-proposal",
            headers=_mit(auth_headers(token), 1),
            json={"expected_circuit_version": sz["f1"]["version"]},
        ),
        api.patch(
            f"{BASIS}/penetrations/{pen}", headers=_mit(auth_headers(token), 1), json={"note": "x"}
        ),
        api.delete(f"{BASIS}/penetrations/{pen}", headers=_mit(auth_headers(token), 1)),
    ]
    for response in antworten:
        assert response.status_code == 409, response.text
        assert response.json()["type"].endswith(f"project-{status}")
    assert _db(engine) == (1, 4, 1)
    assert _leitungen(api, token, sz)[0]["version"] == 1


# ------------------------------------------------------------- Vorschlag uebernehmen


def test_vorschlag_nur_ausdruecklich_und_mit_versionen(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    sz = _szenario(api, token, geschoss)
    cable = _anlegen(api, token, sz, _beispiel(sz)).json()
    f1 = sz["f1"]
    # Vorschlag aendern: keine Wirkung auf die Leitung.
    geaendert = api.patch(
        f"{BASIS}/circuits/{f1['id']}",
        headers=_mit(auth_headers(token), f1["version"]),
        json={"proposed_cross_section_mm2": "4"},
    )
    assert geaendert.status_code == 200, geaendert.text
    f1 = geaendert.json()
    nach = _leitungen(api, token, sz)[0]
    assert (nach["cross_section_mm2"], nach["version"], nach["deviates_from_proposal"]) == (
        "1.50",
        1,
        True,
    )
    url = f"{BASIS}/cables/{cable['id']}/apply-proposal"
    ohne = api.post(
        url, headers=auth_headers(token), json={"expected_circuit_version": f1["version"]}
    )
    assert ohne.status_code == 428
    # Veraltete Leitungsversion (If-Match) oder veralteter Vorschlag: 409, nichts geaendert.
    alt = api.post(
        url, headers=_mit(auth_headers(token), 7), json={"expected_circuit_version": f1["version"]}
    )
    assert alt.status_code == 409 and alt.json()["type"].endswith("version-conflict"), alt.text
    alt_kreis = api.post(
        url,
        headers=_mit(auth_headers(token), 1),
        json={"expected_circuit_version": f1["version"] - 1},
    )
    assert alt_kreis.status_code == 409, alt_kreis.text
    assert fehlercodes(alt_kreis) == {"circuit-proposal-changed"}
    fremd = api.post(
        f"{BASIS}/cables/{uuid.uuid4()}/apply-proposal",
        headers=_mit(auth_headers(token), 1),
        json={"expected_circuit_version": f1["version"]},
    )
    assert fremd.status_code == 404
    assert _leitungen(api, token, sz)[0]["version"] == 1
    ok = api.post(
        url, headers=_mit(auth_headers(token), 1), json={"expected_circuit_version": f1["version"]}
    )
    assert ok.status_code == 200, ok.text
    neu = ok.json()
    # Genau Typ, Leiterzahl, Querschnitt; Weg, Zugaben, Bezeichnung unveraendert.
    assert (neu["cable_type"], neu["conductor_count"], neu["cross_section_mm2"]) == (
        "NYM-J",
        3,
        "4.00",
    )
    assert (neu["version"], neu["deviates_from_proposal"], neu["label"]) == (2, False, "L1")
    assert (neu["length_mm"], neu["start_allowance_mm"], neu["end_allowance_mm"]) == (
        9_200,
        500,
        200,
    )
    assert neu["waypoints"] == cable["waypoints"]


# ------------------------------------------------------------- Loeschschutz


def test_loeschschutz_fuer_alle_bezuege(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    sz = _szenario(api, token, geschoss)
    cable = _anlegen(api, token, sz, _beispiel(sz)).json()
    pen = cable["penetration_ids"][0]
    kueche = sz["kueche"]
    geraet_weg = _speichern(
        api,
        token,
        kueche,
        devices=[g for g in _geraete(kueche) if g["id"] != sz["sd1"]],
        removed_devices=[sz["sd1"]],
    )
    assert geraet_weg.status_code == 409 and fehlercodes(geraet_weg) == {"device-has-cables"}
    raum_weg = api.delete(
        f"{BASIS}/rooms/{kueche['id']}",
        headers=_mit(auth_headers(token), raumversion(api, token, kueche["id"])),
    )
    assert raum_weg.status_code == 409 and fehlercodes(raum_weg) == {"room-has-cables"}
    kopplung_weg = api.delete(
        f"{BASIS}/wall-links/{sz['link']['id']}",
        headers=_mit(auth_headers(token), sz["link"]["version"]),
    )
    assert kopplung_weg.status_code == 409 and fehlercodes(kopplung_weg) == {
        "wall-link-has-penetrations"
    }
    durch_weg = api.delete(f"{BASIS}/penetrations/{pen}", headers=_mit(auth_headers(token), 1))
    assert durch_weg.status_code == 409 and fehlercodes(durch_weg) == {"penetration-in-use"}
    f1 = sz["f1"]
    zuordnung_weg = kreise._zuordnen(api, token, f1, [sz["sd_sued"]])
    assert zuordnung_weg.status_code == 409 and fehlercodes(zuordnung_weg) == {
        "circuit-device-has-cables"
    }
    lage_weg = api.patch(
        f"{BASIS}/distribution-boards/{sz['board']['id']}",
        headers=_mit(auth_headers(token), sz["board"]["version"]),
        json={"placement_device_id": None},
    )
    assert lage_weg.status_code == 409 and fehlercodes(lage_weg) == {"board-placement-has-cables"}
    assert _db(engine) == (1, 4, 1)
    # Stromkreis loeschen nimmt die Leitung mit; die Durchfuehrung bleibt.
    kreis_weg = api.delete(
        f"{BASIS}/circuits/{f1['id']}", headers=_mit(auth_headers(token), f1["version"])
    )
    assert kreis_weg.status_code == 204, kreis_weg.text
    assert _db(engine) == (0, 0, 1)
    durch_weg = api.delete(f"{BASIS}/penetrations/{pen}", headers=_mit(auth_headers(token), 1))
    assert durch_weg.status_code == 204, durch_weg.text


def test_projektloeschung_entfernt_leitungen_und_durchfuehrungen(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    sz = _szenario(api, token, geschoss)
    assert _anlegen(api, token, sz, _beispiel(sz)).status_code == 201
    projekt = geschoss["project"]
    pruefung = api.get(
        f"/api/v1/projects/{projekt['id']}/deletion-check", headers=auth_headers(token)
    )
    inhalte = {item["code"]: item["count"] for item in pruefung.json()["contents"]}
    assert (inhalte["electrical.cables"], inhalte["electrical.penetrations"]) == (1, 1)
    aktuell = api.get(f"/api/v1/projects/{projekt['id']}", headers=auth_headers(token)).json()
    geloescht = api.delete(
        f"/api/v1/projects/{projekt['id']}",
        headers=_mit(auth_headers(token), aktuell["version"]),
        params={"confirm_project_number": aktuell["project_number"]},
    )
    assert geloescht.status_code == 204, geloescht.text
    assert _db(engine) == (0, 0, 0)


# ------------------------------------------------------------- Bodenuebergang


def _bodenleitung(sz: dict[str, Any], tuer_id: str | None) -> dict[str, Any]:
    d, k = sz["d"], sz["k"]
    return {
        "label": "LB",
        "start_device_id": sz["sd_boden"],
        "end_device_id": sz["sd_k"],
        "waypoints": [
            {"kind": "wall", "wall_id": d[0], "offset_mm": 3_800, "height_mm": 0},
            {"kind": "floor", "room_id": sz["diele"]["id"], "x_mm": 3_800, "y_mm": 0},
            {"kind": "floor", "room_id": sz["diele"]["id"], "x_mm": 3_800, "y_mm": 1_500},
            {
                "kind": "opening_crossing",
                "wall_id": d[1],
                "offset_mm": 1_500,
                "opening_id": tuer_id,
            },
            {"kind": "floor", "room_id": sz["kueche"]["id"], "x_mm": 4_700, "y_mm": 1_500},
            {"kind": "floor", "room_id": sz["kueche"]["id"], "x_mm": 4_700, "y_mm": 0},
            {"kind": "wall", "wall_id": k[0], "offset_mm": 500, "height_mm": 0},
        ],
    }


def test_entfernte_tuer_des_bodenuebergangs_nur_mit_genauer_bestaetigung(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    sz = _szenario(api, token, geschoss, tuer=True)
    tuer = sz["diele"]["walls"][1]["openings"][0]["id"]
    response = _anlegen(api, token, sz, _bodenleitung(sz, tuer))
    assert response.status_code == 201, response.text
    cable = response.json()
    assert (cable["status"], cable["length_mm"], cable["opening_crossings"]) == (
        "confirmed",
        4_500,
        1,
    )

    einzeln = api.delete(f"{BASIS}/openings/{tuer}", headers=_mit(auth_headers(token), 1))
    assert einzeln.status_code == 409 and fehlercodes(einzeln) == {"opening-has-cables"}

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
    assert ohne.status_code == 409, ohne.text
    assert [(e["code"], e["keys"]) for e in ohne.json()["errors"]] == [
        ("cables-would-break", [cable["id"]])
    ]
    falsch = speichern([str(uuid.uuid4())])
    assert falsch.status_code == 409 and fehlercodes(falsch) == {
        "cables-would-break",
        "cable-not-affected",
    }
    doppelt = speichern([cable["id"], cable["id"]])
    assert doppelt.status_code == 422 and fehlercodes(doppelt) == {"acknowledged-cable-duplicate"}
    # Nichts geaendert: Tuer und Bezug stehen noch.
    assert _leitungen(api, token, sz)[0]["waypoints"][3]["opening_id"] == tuer
    genau = speichern([cable["id"]])
    assert genau.status_code == 200, genau.text
    nach = _leitungen(api, token, sz)[0]
    # Speicherstrategie §5.6: Wegpunkt samt Lage bleibt, nur der Bezug faellt weg.
    assert nach["waypoints"][3] == {
        **cable["waypoints"][3],
        "opening_id": None,
    }
    assert (nach["status"], nach["length_mm"], nach["version"]) == ("conflict", None, 2)
    # Teilsumme der gueltigen Teile: 300 + 1 500 + 1 500 + 300.
    assert nach["known_mm"] == 3_600
    assert ("opening-crossing-opening-removed", "conflict", "w3") in {
        (p["code"], p["kind"], p["ref"]) for p in nach["problems"]
    }


# ------------------------------------------------------------- Wandaenderung, veralteter Entwurf


def test_veralteter_entwurf_gegen_neue_leitung_und_genaue_bestaetigung(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    """Die Diele wird auf 3 000 mm verkuerzt; ein Wegpunkt bei 3 500 laege ausserhalb."""
    sz = _szenario(api, token, geschoss)
    diele = sz["diele"]
    version_vorher = raumversion(api, token, diele["id"])
    d = sz["d"]
    cable = _anlegen(
        api,
        token,
        sz,
        {
            "label": "L-Diele",
            "start_device_id": sz["uv1"],
            "end_device_id": sz["sd_sued"],
            "waypoints": [
                {"kind": "wall", "wall_id": d[0], "offset_mm": 500, "height_mm": 2_200},
                {"kind": "wall", "wall_id": d[0], "offset_mm": 3_500, "height_mm": 2_200},
            ],
        },
    ).json()
    assert (cable["status"], cable["length_mm"]) == ("confirmed", 800 + 3_000 + 1_900)
    # Die Leitung zaehlt keine Raumversion weiter: der Entwurf ist versionsgleich, aber veraltet.
    assert raumversion(api, token, diele["id"]) == version_vorher
    kurz = _waende(diele)
    kurz[0].update(x2_mm=3_000)
    kurz[1].update(x1_mm=3_000, x2_mm=3_000)
    kurz[2].update(x1_mm=3_000)
    verschoben = [
        {**g, "center_offset_mm": 2_500} if g["id"] in (sz["sd_sued"],) else g
        for g in _geraete(diele)
        if g["id"] != sz["sd_boden"]
    ]

    def speichern(bestaetigt: list[str], version: str) -> Any:
        return api.put(
            f"{BASIS}/rooms/{diele['id']}/contour",
            headers=_mit(auth_headers(token), version),
            json={
                "walls": kurz,
                "devices": verschoben,
                "removed_device_ids": [sz["sd_boden"]],
                "acknowledged_cable_ids": bestaetigt,
            },
        )

    ohne = speichern([], version_vorher)
    assert ohne.status_code == 409, ohne.text
    assert [(e["code"], e["keys"]) for e in ohne.json()["errors"]] == [
        ("cables-would-break", [cable["id"]])
    ]
    assert "L-Diele" in ohne.json()["errors"][0]["message"]
    genau = speichern([cable["id"]], version_vorher)
    assert genau.status_code == 200, genau.text
    nach = _leitungen(api, token, sz)[0]
    assert (nach["status"], nach["length_mm"]) == ("conflict", None)
    assert ("waypoint-outside-wall", "w1") in {(p["code"], p["ref"]) for p in nach["problems"]}
    # Nichts verschoben: der Wegpunkt steht weiter bei 3 500.
    assert nach["waypoints"][1]["offset_mm"] == 3_500


def test_oeffnung_ueber_wandstrecke_ist_unzulaessig(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    sz = _szenario(api, token, geschoss)
    d = sz["d"]
    cable = _anlegen(
        api,
        token,
        sz,
        {
            "start_device_id": sz["uv1"],
            "end_device_id": sz["sd_sued"],
            "waypoints": [
                {"kind": "wall", "wall_id": d[0], "offset_mm": 500, "height_mm": 2_200},
                {"kind": "wall", "wall_id": d[0], "offset_mm": 3_500, "height_mm": 2_200},
            ],
        },
    ).json()
    tuer = {"kind": "door", "offset_mm": 1_500, "width_mm": 900, "height_mm": 2_300}
    einzeln = api.post(f"{BASIS}/walls/{d[0]}/openings", headers=auth_headers(token), json=tuer)
    assert einzeln.status_code == 422 and fehlercodes(einzeln) == {"opening-over-cable"}
    waende = _waende(sz["diele"])
    waende[0]["openings"] = [{**tuer, "id": str(uuid.uuid4()), "sill_height_mm": 0}]
    entwurf = api.put(
        f"{BASIS}/rooms/{sz['diele']['id']}/contour",
        headers=_mit(auth_headers(token), raumversion(api, token, sz["diele"]["id"])),
        json={
            "walls": waende,
            "devices": _geraete(sz["diele"]),
            "acknowledged_cable_ids": [cable["id"]],
        },
    )
    # Auch mit Bestaetigung: eine Oeffnung ueber einer Wandstrecke ist 422 (Entwurf §7).
    assert entwurf.status_code == 422 and fehlercodes(entwurf) == {"opening-over-cable"}
    # Eine niedrigere Tuer unter der Leitung ist zulaessig.
    niedrig = api.post(
        f"{BASIS}/walls/{d[0]}/openings",
        headers=auth_headers(token),
        json={**tuer, "height_mm": 2_100},
    )
    assert niedrig.status_code == 201, niedrig.text
    assert _leitungen(api, token, sz)[0]["status"] == "confirmed"


# ------------------------------------------------------------- Kopplung, Hoehe, Durchfuehrung


def test_kopplung_hoehe_und_durchfuehrung(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    sz = _szenario(api, token, geschoss)
    cable = _anlegen(api, token, sz, _beispiel(sz)).json()
    pen = cable["penetration_ids"][0]
    link = sz["link"]
    getrennt = api.patch(
        f"{BASIS}/wall-links/{link['id']}",
        headers=_mit(auth_headers(token), link["version"]),
        json={"relation": "separate", "acknowledged_cable_ids": [cable["id"]]},
    )
    # Durchfuehrungen sind hart geschuetzt - eine Bestaetigung umgeht das nicht.
    assert getrennt.status_code == 422 and fehlercodes(getrennt) == {
        "penetration-outside-shared-section"
    }
    diele = sz["diele"]
    niedriger = api.patch(
        f"{BASIS}/rooms/{diele['id']}",
        headers=_mit(auth_headers(token), raumversion(api, token, diele["id"])),
        json={"height_mm": 2_100},
    )
    assert niedriger.status_code == 422, niedriger.text
    assert "penetration-height" in fehlercodes(niedriger)
    stockwerk = geschoss["floor"]
    geschosshoehe = api.patch(
        f"/api/v1/floors/{sz['floor']}",
        headers=_mit(auth_headers(token), stockwerk["version"]),
        json={"default_ceiling_height_mm": 2_100},
    )
    assert geschosshoehe.status_code == 422, geschosshoehe.text

    # Durchfuehrung um 100 mm verschieben (y 2 100 -> 2 200): Weg bleibt waagerecht,
    # Laenge waechst sichtbar: Diele.ost 2 200 statt 2 100, Anschluss 100 + 1 900.
    schritt = 100 if link["wall_a_id"] == sz["d"][1] else -100
    verschoben = api.patch(
        f"{BASIS}/penetrations/{pen}",
        headers=_mit(auth_headers(token), 1),
        json={"offset_mm": _lage(sz, 2_100) + schritt},
    )
    assert verschoben.status_code == 200, verschoben.text
    nach = _leitungen(api, token, sz)[0]
    assert (nach["status"], nach["geometric_mm"], nach["length_mm"]) == ("confirmed", 8_700, 9_400)
    # Hoehe 2 000: Diele.ost 0/2 200 -> Durchfuehrung 2 000 waere schraeg - nur mit Bestaetigung.
    tiefer = api.patch(
        f"{BASIS}/penetrations/{pen}",
        headers=_mit(auth_headers(token), 2),
        json={"height_mm": 2_000},
    )
    assert tiefer.status_code == 409 and fehlercodes(tiefer) == {"cables-would-break"}
    ausserhalb = api.patch(
        f"{BASIS}/penetrations/{pen}",
        headers=_mit(auth_headers(token), 2),
        json={"offset_mm": 3_000, "height_mm": 2_600},
    )
    assert ausserhalb.status_code == 422, ausserhalb.text
    bestaetigt = api.patch(
        f"{BASIS}/penetrations/{pen}",
        headers=_mit(auth_headers(token), 2),
        json={"height_mm": 2_000, "acknowledged_cable_ids": [cable["id"]]},
    )
    assert bestaetigt.status_code == 200, bestaetigt.text
    nach = _leitungen(api, token, sz)[0]
    assert (nach["status"], nach["length_mm"]) == ("conflict", None)
    assert ("wall-diagonal", "w2-w3") in {(p["code"], p["ref"]) for p in nach["problems"]}


# ------------------------------------------------------------- Steigweg


def test_steigweg_halt_verschieben_entfernen_und_hoehenlage(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    eg = geschoss["floor"]
    haus = geschoss["building"]["id"]
    eg_aktuell = eg
    bestaetigt = api.patch(
        f"/api/v1/floors/{eg['id']}",
        headers=_mit(auth_headers(token), eg_aktuell["version"]),
        json={"elevation_mm": 0, "elevation_confirmed": True},
    )
    assert bestaetigt.status_code == 200, bestaetigt.text
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
    )
    assert og.status_code == 201, og.text
    og = og.json()
    hwr = _plan_raum(
        api, token, eg["id"], _raum(api, token, eg["id"], _rechteck(4_000, 3_400), name="HWR")["id"]
    )
    bad = _plan_raum(
        api, token, og["id"], _raum(api, token, og["id"], _rechteck(4_000, 4_000), name="Bad")["id"]
    )
    eg_nord, og_nord = hwr["walls"][2]["id"], bad["walls"][2]["id"]
    hwr = _geraete_setzen(
        api, token, eg["id"], hwr, [_wandgeraet(eg_nord, 2_000, 1_400, typ="distribution_board")]
    )
    bad = _geraete_setzen(api, token, og["id"], bad, [_wandgeraet(og_nord, 2_350, 300)])
    uv = hwr["devices"][0]["id"]
    sd_og = bad["devices"][0]["id"]
    board = kreise._angelegte_verteilung(api, token, haus, placement_device_id=uv)
    f1 = kreise._angelegter_stromkreis(api, token, board["id"])
    assert kreise._zuordnen(api, token, f1, [sd_og]).status_code == 200
    steigweg = api.post(
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
    )
    assert steigweg.status_code == 201, steigweg.text
    riser = steigweg.json()
    halt = {s["floor_id"]: s for s in riser["stops"]}
    cable = api.post(
        f"{BASIS}/circuits/{f1['id']}/cables",
        headers=auth_headers(token),
        json={
            "label": "LS",
            "start_device_id": uv,
            "end_device_id": sd_og,
            "waypoints": [
                {"kind": "wall", "wall_id": eg_nord, "offset_mm": 2_000, "height_mm": 2_200},
                {"kind": "wall", "wall_id": eg_nord, "offset_mm": 2_800, "height_mm": 2_200},
                {
                    "kind": "riser",
                    "riser_id": riser["id"],
                    "from_stop_id": halt[eg["id"]]["id"],
                    "from_height_mm": 2_200,
                    "to_stop_id": halt[og["id"]]["id"],
                    "to_height_mm": 0,
                },
                {"kind": "floor", "room_id": bad["id"], "x_mm": 1_650, "y_mm": 3_700},
                {"kind": "floor", "room_id": bad["id"], "x_mm": 1_650, "y_mm": 4_000},
                {"kind": "wall", "wall_id": og_nord, "offset_mm": 2_350, "height_mm": 0},
            ],
        },
    )
    assert cable.status_code == 201, cable.text
    cable = cable.json()
    # 800 + 800 + (2 900 - 2 200 + 450 + 300) + 300 + 300: der Steigweg zaehlt erst ab 2 200.
    assert (cable["status"], cable["length_mm"]) == ("confirmed", 3_650)
    assert [s["length_mm"] for s in cable["segments"] if s["kind"] == "riser"] == [1_450]

    def halte(og_y: int, mit_eg: bool = True) -> list[dict[str, Any]]:
        stops = [{"id": halt[og["id"]]["id"], "floor_id": og["id"], "x_mm": 1_650, "y_mm": og_y}]
        if mit_eg:
            stops.insert(
                0, {"id": halt[eg["id"]]["id"], "floor_id": eg["id"], "x_mm": 1_200, "y_mm": 3_400}
            )
        return stops

    def ersetzen(
        stops: list[dict[str, Any]], version: int, bestaetigt: list[str] | None = None
    ) -> Any:
        return api.put(
            f"{BASIS}/risers/{riser['id']}",
            headers=_mit(auth_headers(token), version),
            json={
                "name": "Schacht",
                "offset_mode": "orthogonal",
                "stops": stops,
                "acknowledged_cable_ids": bestaetigt or [],
            },
        )

    entfernt = ersetzen(halte(3_700, mit_eg=False), 1)
    assert entfernt.status_code == 409 and fehlercodes(entfernt) == {"riser-stop-in-use"}
    geloescht = api.delete(f"{BASIS}/risers/{riser['id']}", headers=_mit(auth_headers(token), 1))
    assert geloescht.status_code == 409 and fehlercodes(geloescht) == {"riser-in-use"}
    # Verschieben: der Fussbodenpunkt (1 650/3 700) laege nicht mehr am Halt.
    ohne = ersetzen(halte(3_600), 1)
    assert ohne.status_code == 409 and fehlercodes(ohne) == {"cables-would-break"}
    mit = ersetzen(halte(3_600), 1, [cable["id"]])
    assert mit.status_code == 200, mit.text
    nach = _leitungen(api, token, {"building": haus})[0]
    assert (nach["status"], nach["length_mm"]) == ("conflict", None)
    assert ("riser-transfer", "w2-w3") in {(p["code"], p["ref"]) for p in nach["problems"]}
    # Zurueck: wieder bestaetigt; danach Hoehenlage unbestaetigt -> unvollstaendig.
    zurueck = ersetzen(halte(3_700), 2)
    assert zurueck.status_code == 200, zurueck.text
    assert _leitungen(api, token, {"building": haus})[0]["length_mm"] == 3_650
    og_aktuell = og
    unbestaetigt = api.patch(
        f"/api/v1/floors/{og['id']}",
        headers=_mit(auth_headers(token), og_aktuell["version"]),
        json={"elevation_confirmed": False},
    )
    assert unbestaetigt.status_code == 200, unbestaetigt.text
    offen = _leitungen(api, token, {"building": haus})[0]
    assert (offen["status"], offen["length_mm"], offen["known_mm"]) == (
        "incomplete",
        None,
        800 + 800 + 750 + 300 + 300,
    )
