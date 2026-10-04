"""Geraete ueber die API (Phase 5, ADR 0023).

Geraete werden mit dem Raumentwurf gespeichert (``PUT /rooms/{id}/contour``).
Jeder abgelehnte Fall prueft zusaetzlich den Datenbankzustand: Nach einem
Fehler sind Geraete, Waende und Raumversion unveraendert.

Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import sessionmaker

from app.core.events.models import DomainEventRecord
from app.core.module_registry.registry import ModuleRegistry
from app.core.seed import seed_initial_data
from app.modules.electrical.catalog import DEVICE_TYPE_CATALOG
from app.modules.electrical.events import PLAN_UPDATED
from app.modules.electrical.models import ElectricalDevice, ElectricalDeviceType
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
_mitglied_mit_permissions = raeume._mitglied_mit_permissions


# ------------------------------------------------------------------ Helfer


def _rechteck(breite: int, tiefe: int, x: int = 0, y: int = 0) -> list[dict[str, Any]]:
    ecken = [(x, y), (x + breite, y), (x + breite, y + tiefe), (x, y + tiefe)]
    return [
        {
            "id": str(uuid.uuid4()),
            "x1_mm": ecken[i][0],
            "y1_mm": ecken[i][1],
            "x2_mm": ecken[(i + 1) % 4][0],
            "y2_mm": ecken[(i + 1) % 4][1],
            "openings": [],
        }
        for i in range(4)
    ]


def _raum(
    api: TestClient,
    token: str,
    floor_id: str,
    walls: list[dict[str, Any]],
    name: str = "Wohnzimmer",
    **extra: object,
) -> dict[str, Any]:
    response = api.post(
        f"{BASIS}/floors/{floor_id}/rooms",
        headers=auth_headers(token),
        json={"name": name, "walls": walls, **extra},
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


def _plan_raum(api: TestClient, token: str, floor_id: str, room_id: str) -> dict[str, Any]:
    plan = api.get(f"{BASIS}/floors/{floor_id}/plan", headers=auth_headers(token))
    assert plan.status_code == 200, plan.text
    return next(r for r in plan.json()["rooms"] if r["id"] == room_id)


def _waende(raum: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "id": w["id"],
            "x1_mm": w["x1_mm"],
            "y1_mm": w["y1_mm"],
            "x2_mm": w["x2_mm"],
            "y2_mm": w["y2_mm"],
            "thickness_mm": w["thickness_mm"],
            "openings": [
                {
                    k: o[k]
                    for k in ("id", "kind", "offset_mm", "width_mm", "height_mm", "sill_height_mm")
                }
                for o in w["openings"]
            ],
        }
        for w in raum["walls"]
    ]


def _geraete(raum: dict[str, Any]) -> list[dict[str, Any]]:
    felder = (
        "id",
        "device_type_key",
        "mounting_surface",
        "wall_id",
        "center_offset_mm",
        "center_height_mm",
        "x_mm",
        "y_mm",
        "label",
    )
    return [{k: g[k] for k in felder} for g in raum["devices"]]


def _wandgeraet(
    wall_id: str,
    mitte: int,
    hoehe: int = 300,
    *,
    typ: str = "socket_single",
    flaeche: str = "wall_interior",
    **extra: object,
) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "device_type_key": typ,
        "mounting_surface": flaeche,
        "wall_id": wall_id,
        "center_offset_mm": mitte,
        "center_height_mm": hoehe,
        **extra,
    }


def _deckengeraet(x: int, y: int, *, typ: str = "light_ceiling") -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "device_type_key": typ,
        "mounting_surface": "ceiling",
        "x_mm": x,
        "y_mm": y,
    }


def _speichern(
    api: TestClient,
    token: str,
    raum: dict[str, Any],
    *,
    walls: list[dict[str, Any]] | None = None,
    devices: list[dict[str, Any]] | None = None,
    removed_devices: list[str] | None = None,
    version: str | None = None,
    ohne_geraete: bool = False,
) -> Any:
    body: dict[str, Any] = {
        "walls": walls if walls is not None else _waende(raum),
        "removed_opening_ids": [],
    }
    if not ohne_geraete:
        body["devices"] = devices if devices is not None else _geraete(raum)
        body["removed_device_ids"] = removed_devices or []
    return api.put(
        f"{BASIS}/rooms/{raum['id']}/contour",
        headers={
            **auth_headers(token),
            "If-Match": version if version is not None else raumversion(api, token, raum["id"]),
        },
        json=body,
    )


def _raum_mit_plan(
    api: TestClient, token: str, floor_id: str, breite: int = 5_000, tiefe: int = 4_000, **kw: Any
) -> dict[str, Any]:
    raum = _raum(
        api, token, floor_id, _rechteck(breite, tiefe, kw.pop("x", 0), kw.pop("y", 0)), **kw
    )
    return _plan_raum(api, token, floor_id, raum["id"])


def _geraete_in_db(engine: Engine) -> list[ElectricalDevice]:
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        return list(session.execute(select(ElectricalDevice)).scalars())
    finally:
        session.close()


# --------------------------------------------------------- Katalog und Seed


def test_katalog_ist_lesbar_und_vollstaendig(api: TestClient, token: str) -> None:
    response = api.get(f"{BASIS}/device-types", headers=auth_headers(token))
    assert response.status_code == 200, response.text
    typen = response.json()
    assert [t["key"] for t in typen] == [d.key for d in DEVICE_TYPE_CATALOG]
    aussen = next(t for t in typen if t["key"] == "light_outdoor")
    assert aussen["allows_wall_exterior"] and not aussen["allows_wall_interior"]
    assert all(t["is_active"] for t in typen)


def test_seed_ist_idempotent_und_deaktiviert_statt_zu_loeschen(
    engine: Engine, registry: ModuleRegistry, betrieb: uuid.UUID
) -> None:
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        # Ein Typ, den der Katalog nicht (mehr) kennt, und ein veraenderter.
        session.add(
            ElectricalDeviceType(
                key="legacy_type",
                label="Alt",
                category="socket",
                symbol_key="legacy_type",
                allows_wall_interior=True,
                allows_wall_exterior=False,
                allows_ceiling=False,
                default_center_height_mm=300,
                width_mm=80,
                height_mm=80,
                sort_order=999,
            )
        )
        geaendert = session.get(ElectricalDeviceType, "socket_single")
        assert geaendert is not None
        geaendert.label = "falsch"
        session.commit()

        erster = seed_initial_data(
            session, registry, admin_email="admin@elektro.example", admin_password=ADMIN_PASSWORD
        )
        session.commit()
        zweiter = seed_initial_data(
            session, registry, admin_email="admin@elektro.example", admin_password=ADMIN_PASSWORD
        )
        session.commit()

        assert [(r.created, r.updated, r.deactivated) for r in erster.reference_data] == [(0, 1, 1)]
        assert [(r.created, r.updated, r.deactivated) for r in zweiter.reference_data] == [
            (0, 0, 0)
        ]
        alle = list(session.execute(select(ElectricalDeviceType)).scalars())
        assert len(alle) == len(DEVICE_TYPE_CATALOG) + 1
        legacy = session.get(ElectricalDeviceType, "legacy_type")
        assert legacy is not None and legacy.is_active is False
    finally:
        session.close()


# ------------------------------------------------------ Anlegen und Lesen


def test_innen_und_aussen_an_derselben_wand_bleiben_getrennt(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor_id = geschoss["floor"]["id"]
    raum = _raum_mit_plan(api, token, floor_id)
    wand = raum["walls"][0]["id"]
    innen = _wandgeraet(wand, 2_000, 300)
    aussen = _wandgeraet(wand, 2_000, 2_000, typ="light_outdoor", flaeche="wall_exterior")
    response = _speichern(api, token, raum, devices=[innen, aussen])
    assert response.status_code == 200, response.text
    gespeichert = {g["id"]: g for g in response.json()["devices"]}
    assert gespeichert[innen["id"]]["mounting_surface"] == "wall_interior"
    assert gespeichert[aussen["id"]]["mounting_surface"] == "wall_exterior"
    assert gespeichert[aussen["id"]]["center_offset_mm"] == 2_000
    # Genau zwei Geraete, nichts gespiegelt, und nach dem Neuladen unveraendert.
    assert len(_geraete_in_db(engine)) == 2
    nachgeladen = _plan_raum(api, token, floor_id, raum["id"])
    assert sorted(_geraete(nachgeladen), key=lambda g: g["id"]) == sorted(
        _geraete(response.json()), key=lambda g: g["id"]
    )


def test_deckengeraet_folgt_der_raumhoehe(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor_id = geschoss["floor"]["id"]
    raum = _raum_mit_plan(api, token, floor_id, height_mm=2_700)
    leuchte = _deckengeraet(2_500, 2_000)
    assert _speichern(api, token, raum, devices=[leuchte]).status_code == 200
    raum = _plan_raum(api, token, floor_id, raum["id"])
    gespeichert = raum["devices"][0]
    # Keine gespeicherte Hoehe - die Montagehoehe ist die effektive Raumhoehe.
    assert gespeichert["center_height_mm"] is None and gespeichert["wall_id"] is None
    assert raum["effective_height_mm"] == 2_700
    # Die Decke darf sich aendern; das Deckengeraet folgt ohne eigene Hoehe.
    response = api.patch(
        f"{BASIS}/rooms/{raum['id']}",
        headers={**auth_headers(token), "If-Match": str(raum["version"])},
        json={"height_mm": 2_400},
    )
    assert response.status_code == 200, response.text


def test_raumtyp_ist_optional_und_aenderbar(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor_id = geschoss["floor"]["id"]
    ohne = _raum(api, token, floor_id, _rechteck(3_000, 3_000), name="Ohne")
    assert ohne["room_type"] is None
    mit = _raum(
        api, token, floor_id, _rechteck(3_000, 3_000, x=4_000), name="Kueche", room_type="kitchen"
    )
    assert mit["room_type"] == "kitchen"
    response = api.patch(
        f"{BASIS}/rooms/{mit['id']}",
        headers={**auth_headers(token), "If-Match": str(mit["version"])},
        json={"room_type": None},
    )
    assert response.status_code == 200 and response.json()["room_type"] is None
    falsch = api.post(
        f"{BASIS}/floors/{floor_id}/rooms",
        headers=auth_headers(token),
        json={"name": "X", "room_type": "ballroom"},
    )
    assert falsch.status_code == 422


# ------------------------------------------------------ Unzulaessige Lagen


@pytest.mark.parametrize(
    ("geraet", "code"),
    [
        (lambda w: _wandgeraet(w, 30), "device-outside-wall"),
        (lambda w: _wandgeraet(w, 2_000, 2_480), "device-exceeds-room-height"),
        (lambda w: _wandgeraet(w, 1_400, 1_000), "device-in-opening"),
        (lambda w: _wandgeraet(w, 2_000, typ="light_outdoor"), "device-surface-not-allowed"),
        (lambda w: _wandgeraet(w, 2_000, typ="light_ceiling"), "device-surface-not-allowed"),
    ],
    ids=["ausserhalb", "ueber-decke", "in-tuer", "aussenleuchte-innen", "decke-an-wand"],
)
def test_unzulaessige_wandlagen_werden_abgelehnt(
    api: TestClient,
    token: str,
    geschoss: dict[str, Any],
    engine: Engine,
    geraet: Any,
    code: str,
) -> None:
    floor_id = geschoss["floor"]["id"]
    walls = _rechteck(5_000, 4_000)
    walls[0]["openings"] = [
        {
            "id": str(uuid.uuid4()),
            "kind": "door",
            "offset_mm": 1_000,
            "width_mm": 900,
            "height_mm": 2_010,
        }
    ]
    raum = _plan_raum(api, token, floor_id, _raum(api, token, floor_id, walls)["id"])
    version = raumversion(api, token, raum["id"])
    response = _speichern(api, token, raum, devices=[geraet(raum["walls"][0]["id"])])
    assert response.status_code == 422, response.text
    assert code in fehlercodes(response)
    assert _geraete_in_db(engine) == []
    assert raumversion(api, token, raum["id"]) == version


def test_deckengeraet_im_l_raum_nur_innerhalb_der_echten_kontur(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor_id = geschoss["floor"]["id"]
    punkte = [(0, 0), (6_000, 0), (6_000, 3_000), (3_000, 3_000), (3_000, 6_000), (0, 6_000)]
    walls = [
        {
            "id": str(uuid.uuid4()),
            "x1_mm": punkte[i][0],
            "y1_mm": punkte[i][1],
            "x2_mm": punkte[(i + 1) % 6][0],
            "y2_mm": punkte[(i + 1) % 6][1],
            "openings": [],
        }
        for i in range(6)
    ]
    raum = _plan_raum(api, token, floor_id, _raum(api, token, floor_id, walls, name="Flur L")["id"])
    # Im umschliessenden Rechteck, aber in der Aussparung:
    abgelehnt = _speichern(api, token, raum, devices=[_deckengeraet(4_500, 4_500)])
    assert abgelehnt.status_code == 422 and "device-outside-room" in fehlercodes(abgelehnt)
    angenommen = _speichern(
        api, token, raum, devices=[_deckengeraet(1_500, 4_500), _deckengeraet(4_500, 1_500)]
    )
    assert angenommen.status_code == 200, angenommen.text


def test_abgeleitete_tuer_des_nachbarraums_blockiert_das_geraet(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor_id = geschoss["floor"]["id"]
    oben = _raum_mit_plan(api, token, floor_id, name="Kueche")
    # Der Nachbar darunter speichert die gemeinsame Tuer an seiner Wand (6000,0)->(0,0).
    unten_waende = [
        {
            "id": str(uuid.uuid4()),
            "x1_mm": 0,
            "y1_mm": -3_000,
            "x2_mm": 6_000,
            "y2_mm": -3_000,
            "openings": [],
        },
        {
            "id": str(uuid.uuid4()),
            "x1_mm": 6_000,
            "y1_mm": -3_000,
            "x2_mm": 6_000,
            "y2_mm": 0,
            "openings": [],
        },
        {
            "id": str(uuid.uuid4()),
            "x1_mm": 6_000,
            "y1_mm": 0,
            "x2_mm": 0,
            "y2_mm": 0,
            "openings": [],
        },
        {
            "id": str(uuid.uuid4()),
            "x1_mm": 0,
            "y1_mm": 0,
            "x2_mm": 0,
            "y2_mm": -3_000,
            "openings": [],
        },
    ]
    unten = _plan_raum(
        api, token, floor_id, _raum(api, token, floor_id, unten_waende, name="Flur")["id"]
    )
    wand_oben = oben["walls"][0]["id"]
    # Zuerst ein Geraet oben, dann die Tuer unten genau dort: die Tuer wird abgelehnt.
    assert _speichern(api, token, oben, devices=[_wandgeraet(wand_oben, 1_500)]).status_code == 200
    walls = _waende(unten)
    walls[2]["openings"] = [
        {
            "id": str(uuid.uuid4()),
            "kind": "door",
            "offset_mm": 4_000,
            "width_mm": 900,
            "height_mm": 2_010,
        }
    ]
    tuer = _speichern(api, token, unten, walls=walls, ohne_geraete=True)
    assert tuer.status_code == 422, tuer.text
    assert "device-in-opening" in fehlercodes(tuer)
    # Daneben passt die Tuer; ein neues Geraet in ihr waere dann unzulaessig.
    walls[2]["openings"][0]["offset_mm"] = 3_000  # x 2100..3000
    assert _speichern(api, token, unten, walls=walls, ohne_geraete=True).status_code == 200
    oben = _plan_raum(api, token, floor_id, oben["id"])
    neu = _speichern(api, token, oben, devices=[*_geraete(oben), _wandgeraet(wand_oben, 2_500)])
    assert neu.status_code == 422 and "device-in-opening" in fehlercodes(neu)
    # Aussen auf dem geteilten Stueck: abgelehnt.
    aussen = _speichern(
        api,
        token,
        oben,
        devices=[
            *_geraete(oben),
            _wandgeraet(wand_oben, 4_000, 1_800, typ="light_outdoor", flaeche="wall_exterior"),
        ],
    )
    assert aussen.status_code == 422 and "device-exterior-on-shared-wall" in fehlercodes(aussen)


# ------------------------------------------------- Geometrieaenderungen


def test_geometrieaenderungen_machen_kein_geraet_ungueltig(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor_id = geschoss["floor"]["id"]
    raum = _raum_mit_plan(api, token, floor_id)
    wand = raum["walls"][0]
    steckdose = _wandgeraet(wand["id"], 4_500)
    schalter = _wandgeraet(raum["walls"][1]["id"], 2_000, 2_150, typ="switch_single")
    leuchte = _deckengeraet(4_500, 3_500)
    assert _speichern(api, token, raum, devices=[steckdose, schalter, leuchte]).status_code == 200
    raum = _plan_raum(api, token, floor_id, raum["id"])

    # Wand kuerzen (Ecke verschieben): Steckdose laege ausserhalb, Leuchte ausserhalb.
    walls = _waende(raum)
    walls[0]["x2_mm"] = 4_000
    walls[1]["x1_mm"] = 4_000
    walls[1]["x2_mm"] = 4_000
    walls[2]["x1_mm"] = 4_000
    gekuerzt = _speichern(api, token, raum, walls=walls)
    assert gekuerzt.status_code == 422, gekuerzt.text
    assert {"device-outside-wall", "device-outside-room"} <= fehlercodes(gekuerzt)

    # Raumhoehe senken: Schalter-Oberkante 2190 > 2100.
    hoehe = api.patch(
        f"{BASIS}/rooms/{raum['id']}",
        headers={**auth_headers(token), "If-Match": str(raum["version"])},
        json={"height_mm": 2_100},
    )
    assert hoehe.status_code == 422 and "device-exceeds-room-height" in fehlercodes(hoehe)

    # Geschoss-Standardhoehe senken (Raum erbt): ebenfalls abgelehnt, mit Ortsangabe.
    geschosshoehe = api.patch(
        f"/api/v1/floors/{floor_id}",
        headers={**auth_headers(token), "If-Match": str(geschoss["floor"]["version"])},
        json={"default_ceiling_height_mm": 2_100},
    )
    assert geschosshoehe.status_code == 422, geschosshoehe.text
    assert "device-exceeds-room-height" in fehlercodes(geschosshoehe)
    assert "Schalter" in geschosshoehe.text or "Ausschalter" in geschosshoehe.text

    # Wand mit Geraet einzeln loeschen: 409.
    loeschen = api.delete(
        f"{BASIS}/walls/{wand['id']}",
        headers={**auth_headers(token), "If-Match": str(wand["version"])},
    )
    assert loeschen.status_code == 409

    # Nichts wurde verschoben oder geloescht.
    gespeichert = {str(g.id): g for g in _geraete_in_db(engine)}
    assert gespeichert[steckdose["id"]].center_offset_mm == 4_500
    assert gespeichert[leuchte["id"]].x_mm == 4_500
    assert len(gespeichert) == 3


def test_wand_mit_geraeten_im_entwurf_entfernen_braucht_ausdrueckliche_entfernung(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor_id = geschoss["floor"]["id"]
    raum = _raum_mit_plan(api, token, floor_id)
    geraet = _wandgeraet(raum["walls"][0]["id"], 2_000)
    assert _speichern(api, token, raum, devices=[geraet]).status_code == 200
    raum = _plan_raum(api, token, floor_id, raum["id"])
    ohne_wand = _waende(raum)[1:]
    # Ohne Geraeteliste: die Wand traegt noch ein Geraet.
    response = _speichern(api, token, raum, walls=ohne_wand, ohne_geraete=True)
    assert response.status_code == 409 and "wall-has-devices" in fehlercodes(response)
    # Geraet fehlt im Entwurf, ohne ausdrueckliche Entfernung: 422.
    fehlt = _speichern(api, token, raum, devices=[])
    assert fehlt.status_code == 422 and "device-missing" in fehlercodes(fehlt)
    # Ausdruecklich entfernt: Die Wand darf gehen.
    erlaubt = _speichern(
        api, token, raum, walls=ohne_wand, devices=[], removed_devices=[geraet["id"]]
    )
    assert erlaubt.status_code == 200, erlaubt.text
    assert erlaubt.json()["devices"] == []


def test_montageflaeche_wechselt_nicht_und_ids_bleiben_im_raum(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor_id = geschoss["floor"]["id"]
    a = _raum_mit_plan(api, token, floor_id, name="A")
    b = _raum_mit_plan(api, token, floor_id, name="B", x=10_000)
    geraet = _wandgeraet(a["walls"][0]["id"], 2_000, typ="socket_outdoor")
    assert _speichern(api, token, a, devices=[geraet]).status_code == 200
    a = _plan_raum(api, token, floor_id, a["id"])
    gewechselt = [{**_geraete(a)[0], "mounting_surface": "wall_exterior"}]
    response = _speichern(api, token, a, devices=gewechselt)
    assert response.status_code == 422 and "device-surface-changed" in fehlercodes(response)
    # Dieselbe ID im Raum B: fremd.
    fremd = _speichern(api, token, b, devices=[{**geraet, "wall_id": b["walls"][0]["id"]}])
    assert fremd.status_code == 422 and "device-foreign" in fehlercodes(fremd)
    # Wand eines anderen Raums: unbekannt.
    falsche_wand = _speichern(api, token, b, devices=[_wandgeraet(a["walls"][0]["id"], 1_000)])
    assert falsche_wand.status_code == 422 and "device-wall-unknown" in fehlercodes(falsche_wand)
    unbekannt = _speichern(
        api, token, b, devices=[_wandgeraet(b["walls"][0]["id"], 1_000, typ="nope")]
    )
    assert unbekannt.status_code == 422 and "device-type-unknown" in fehlercodes(unbekannt)


def test_deaktivierter_typ_nur_fuer_vorhandene_geraete(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor_id = geschoss["floor"]["id"]
    raum = _raum_mit_plan(api, token, floor_id)
    vorhanden = _wandgeraet(raum["walls"][0]["id"], 1_000, typ="data_double")
    assert _speichern(api, token, raum, devices=[vorhanden]).status_code == 200
    session = sessionmaker(bind=engine)()
    try:
        typ = session.get(ElectricalDeviceType, "data_double")
        assert typ is not None
        typ.is_active = False
        session.commit()
    finally:
        session.close()
    raum = _plan_raum(api, token, floor_id, raum["id"])
    # Das vorhandene Geraet darf bleiben und verschoben werden.
    verschoben = [{**_geraete(raum)[0], "center_offset_mm": 1_200}]
    assert _speichern(api, token, raum, devices=verschoben).status_code == 200
    raum = _plan_raum(api, token, floor_id, raum["id"])
    neu = _speichern(
        api,
        token,
        raum,
        devices=[*_geraete(raum), _wandgeraet(raum["walls"][0]["id"], 3_000, typ="data_double")],
    )
    assert neu.status_code == 422 and "device-type-inactive" in fehlercodes(neu)


# ------------------------------------------- Events, Schutz, Lebenszyklus


def test_nur_geraete_geaendert_erzeugt_devices_changed(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor_id = geschoss["floor"]["id"]
    raum = _raum_mit_plan(api, token, floor_id)
    assert _speichern(api, token, raum, devices=[_deckengeraet(1_000, 1_000)]).status_code == 200
    session = sessionmaker(bind=engine)()
    try:
        letztes = (
            session.execute(
                select(DomainEventRecord)
                .where(DomainEventRecord.event_type == PLAN_UPDATED)
                .order_by(DomainEventRecord.occurred_at.desc())
            )
            .scalars()
            .first()
        )
        assert letztes is not None
        assert letztes.payload["change_kind"] == "devices_changed"
        assert set(letztes.payload) == {"project_id", "floor_id", "room_id", "change_kind"}
    finally:
        session.close()


def test_if_match_und_versionskonflikt(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor_id = geschoss["floor"]["id"]
    raum = _raum_mit_plan(api, token, floor_id)
    alt = str(raum["version"])
    assert (
        _speichern(api, token, raum, devices=[_deckengeraet(1_000, 1_000)], version=alt).status_code
        == 200
    )
    konflikt = _speichern(api, token, raum, devices=[_deckengeraet(2_000, 1_000)], version=alt)
    assert konflikt.status_code == 409 and konflikt.json()["type"].endswith("version-conflict")
    ohne = api.put(
        f"{BASIS}/rooms/{raum['id']}/contour",
        headers=auth_headers(token),
        json={"walls": _waende(raum), "devices": []},
    )
    assert ohne.status_code == 428


def test_ohne_schreibrecht_lesbar_aber_nicht_aenderbar(
    api: TestClient, token: str, geschoss: dict[str, Any], betrieb: uuid.UUID, engine: Engine
) -> None:
    floor_id = geschoss["floor"]["id"]
    raum = _raum_mit_plan(api, token, floor_id)
    assert _speichern(api, token, raum, devices=[_deckengeraet(1_000, 1_000)]).status_code == 200
    _mitglied_mit_permissions(engine, betrieb, "leser@elektro.example", ("electrical.plan.read",))
    leser = login(api, "leser@elektro.example")
    assert api.get(f"{BASIS}/device-types", headers=auth_headers(leser)).status_code == 200
    plan = api.get(f"{BASIS}/floors/{floor_id}/plan", headers=auth_headers(leser))
    assert plan.status_code == 200 and len(plan.json()["rooms"][0]["devices"]) == 1
    raum = _plan_raum(api, token, floor_id, raum["id"])
    verboten = _speichern(api, leser, raum, devices=[])
    assert verboten.status_code == 403


@pytest.mark.parametrize("status", ["completed", "archived"])
def test_abgeschlossene_und_archivierte_projekte_sind_schreibgeschuetzt(
    api: TestClient, token: str, geschoss: dict[str, Any], status: str
) -> None:
    floor_id = geschoss["floor"]["id"]
    raum = _raum_mit_plan(api, token, floor_id)
    projekt = geschoss["project"]
    schritte = (
        ("activate", "complete") if status == "completed" else ("activate", "complete", "archive")
    )
    for schritt in schritte:
        aktuell = api.get(f"/api/v1/projects/{projekt['id']}", headers=auth_headers(token)).json()
        response = api.post(
            f"/api/v1/projects/{projekt['id']}/{schritt}",
            headers={**auth_headers(token), "If-Match": str(aktuell["version"])},
        )
        assert response.status_code == 200, response.text
    response = _speichern(api, token, raum, devices=[_deckengeraet(1_000, 1_000)])
    assert response.status_code == 409
    assert response.json()["type"].endswith(f"project-{status}")
    # Lesen bleibt moeglich.
    assert api.get(f"{BASIS}/device-types", headers=auth_headers(token)).status_code == 200


def test_raum_loeschen_nimmt_geraete_mit_und_projektinhalt_zaehlt_sie(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor_id = geschoss["floor"]["id"]
    raum = _raum_mit_plan(api, token, floor_id)
    assert (
        _speichern(
            api,
            token,
            raum,
            devices=[_deckengeraet(1_000, 1_000), _wandgeraet(raum["walls"][0]["id"], 1_000)],
        ).status_code
        == 200
    )
    projekt = geschoss["project"]["id"]
    inhalt = api.get(f"/api/v1/projects/{projekt}/deletion-check", headers=auth_headers(token))
    assert inhalt.status_code == 200, inhalt.text
    geraete = next(c for c in inhalt.json()["contents"] if c["code"] == "electrical.devices")
    assert geraete["count"] == 2 and geraete["label"] == "Geräte"
    response = api.delete(
        f"{BASIS}/rooms/{raum['id']}",
        headers={**auth_headers(token), "If-Match": raumversion(api, token, raum["id"])},
    )
    assert response.status_code == 204
    assert _geraete_in_db(engine) == []


def test_mandantentrennung_fremder_betrieb_sieht_und_nutzt_keine_geraete(
    api: TestClient,
    token: str,
    geschoss: dict[str, Any],
    engine: Engine,
    registry: ModuleRegistry,
) -> None:
    floor_id = geschoss["floor"]["id"]
    raum = _raum_mit_plan(api, token, floor_id)
    geraet = _deckengeraet(1_000, 1_000)
    assert _speichern(api, token, raum, devices=[geraet]).status_code == 200

    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        seed_initial_data(
            session,
            registry,
            organization_name="Fremdbetrieb GmbH",
            admin_email="fremd@elektro.example",
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
    finally:
        session.close()
    fremd = login(api, "fremd@elektro.example")
    assert (
        api.get(f"{BASIS}/floors/{floor_id}/plan", headers=auth_headers(fremd)).status_code == 404
    )
    fremd_geschoss = raeume._struktur(api, fremd, name="Fremdprojekt")
    fremd_raum = _raum_mit_plan(api, fremd, fremd_geschoss["floor"]["id"])
    # Die ID des fremden Geraets ist dort nicht verwendbar - ohne zu verraten, wem sie gehoert.
    response = _speichern(api, fremd, fremd_raum, devices=[{**geraet}])
    assert response.status_code == 422
    assert {str(g.id) for g in _geraete_in_db(engine)} == {geraet["id"]}
