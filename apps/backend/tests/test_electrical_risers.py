"""Steigwege ueber die API (Phase 6a.4, ADR 0025).

Schwerpunkte: Beispiel 3.4 (orthogonal/direct), bestaetigte und unbestaetigte
Hoehenlagen, ausgelassene Geschosse, stabile IDs der Uebergabepunkte,
Gebaeudezugehoerigkeit, Aktualitaet nach Geschossaenderungen, ``If-Match``,
Rechte, Schreibschutz und Loeschwege.

Jeder abgelehnte Fall prueft zusaetzlich, dass nichts gespeichert wurde.
Synthetische Daten. Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import sessionmaker

from app.core.events.models import DomainEventRecord
from app.modules.electrical.models import ElectricalRiser, ElectricalRiserStop
from app.modules.electrical.permissions import PLAN_READ
from tests import test_electrical_rooms as raeume
from tests.conftest import auth_headers, login, requires_database

pytestmark = [requires_database, pytest.mark.database]

betrieb = raeume.betrieb
ereignisse = raeume.ereignisse
token = raeume.token
geschoss = raeume.geschoss
BASIS = raeume.BASIS
fehlercodes = raeume.fehlercodes


# ------------------------------------------------------------------ Helfer

#: Geschoss -> Gebaeude, damit ein Test die aktuelle Geschossversion findet.
_BUILDING: dict[str, str] = {}


def _geschoss(
    api: TestClient,
    token: str,
    building_id: str,
    name: str,
    level: int,
    elevation: int,
    *,
    confirmed: bool = True,
) -> dict[str, Any]:
    response = api.post(
        f"/api/v1/buildings/{building_id}/floors",
        headers=auth_headers(token),
        json={
            "name": name,
            "level": level,
            "elevation_mm": elevation,
            "elevation_confirmed": confirmed,
            "default_ceiling_height_mm": 2_500,
        },
    )
    assert response.status_code == 201, response.text
    _BUILDING[response.json()["id"]] = building_id
    return dict(response.json())


def _floor(api: TestClient, token: str, building_id: str, floor_id: str) -> dict[str, Any]:
    response = api.get(f"/api/v1/buildings/{building_id}/floors", headers=auth_headers(token))
    assert response.status_code == 200, response.text
    return dict(next(f for f in response.json() if f["id"] == floor_id))


def _floor_patch(api: TestClient, token: str, floor_id: str, **changes: object) -> dict[str, Any]:
    building_id = _BUILDING[floor_id]
    aktuell = _floor(api, token, building_id, floor_id)
    response = api.patch(
        f"/api/v1/floors/{floor_id}",
        headers={**auth_headers(token), "If-Match": str(aktuell["version"])},
        json=changes,
    )
    assert response.status_code == 200, response.text
    return dict(response.json())


@pytest.fixture
def haus(api: TestClient, token: str, geschoss: dict[str, Any]) -> dict[str, Any]:
    """Beispiel 3.4: KG -1/-2800, EG 0/0, OG 1/2900 - alle bestaetigt."""
    building_id = geschoss["building"]["id"]
    _BUILDING[geschoss["floor"]["id"]] = building_id
    eg = _floor_patch(api, token, geschoss["floor"]["id"], elevation_confirmed=True)
    kg = _geschoss(api, token, building_id, "Kellergeschoss", -1, -2_800)
    og = _geschoss(api, token, building_id, "Obergeschoss", 1, 2_900)
    return {
        "project": geschoss["project"],
        "building_id": building_id,
        "kg": kg,
        "eg": eg,
        "og": og,
    }


def _halt(floor: dict[str, Any], x: int, y: int, stop_id: str | None = None) -> dict[str, Any]:
    halt: dict[str, Any] = {"floor_id": floor["id"], "x_mm": x, "y_mm": y}
    if stop_id is not None:
        halt["id"] = stop_id
    return halt


def _beispiel_halte(haus: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        _halt(haus["og"], 1_650, 3_700),
        _halt(haus["kg"], 1_200, 3_400),
        _halt(haus["eg"], 1_200, 3_400),
    ]


def _anlegen(
    api: TestClient,
    token: str,
    building_id: str,
    stops: list[dict[str, Any]],
    *,
    name: str = "Installationsschacht Flur",
    offset_mode: str = "orthogonal",
    note: str | None = None,
) -> Any:
    return api.post(
        f"{BASIS}/buildings/{building_id}/risers",
        headers=auth_headers(token),
        json={"name": name, "note": note, "offset_mode": offset_mode, "stops": stops},
    )


def _angelegt(
    api: TestClient, token: str, building_id: str, stops: list[dict[str, Any]], **kw: Any
) -> dict[str, Any]:
    response = _anlegen(api, token, building_id, stops, **kw)
    assert response.status_code == 201, response.text
    return dict(response.json())


def _ersetzen(
    api: TestClient,
    token: str,
    riser: dict[str, Any],
    *,
    version: str | None = None,
    **changes: Any,
) -> Any:
    body = {
        "name": riser["name"],
        "note": riser["note"],
        "offset_mode": riser["offset_mode"],
        "stops": [
            {"id": s["id"], "floor_id": s["floor_id"], "x_mm": s["x_mm"], "y_mm": s["y_mm"]}
            for s in riser["stops"]
        ],
    }
    body.update(changes)
    return api.put(
        f"{BASIS}/risers/{riser['id']}",
        headers={
            **auth_headers(token),
            "If-Match": version if version is not None else str(riser["version"]),
        },
        json=body,
    )


def _liste(api: TestClient, token: str, building_id: str) -> list[dict[str, Any]]:
    response = api.get(f"{BASIS}/buildings/{building_id}/risers", headers=auth_headers(token))
    assert response.status_code == 200, response.text
    return list(response.json()["risers"])


def _einziger(api: TestClient, token: str, building_id: str) -> dict[str, Any]:
    risers = _liste(api, token, building_id)
    assert len(risers) == 1
    return risers[0]


def _db(engine: Engine) -> tuple[list[ElectricalRiser], list[ElectricalRiserStop]]:
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        return (
            list(session.execute(select(ElectricalRiser)).scalars()),
            list(session.execute(select(ElectricalRiserStop)).scalars()),
        )
    finally:
        session.close()


def _verlauf(section: dict[str, Any]) -> list[list[int]]:
    return [[p["x_mm"], p["y_mm"], p["z_mm"]] for p in section["course"]]


# ------------------------------------------------------- Verlauf und Laenge


def test_beispiel_orthogonal_bestaetigt(api: TestClient, token: str, haus: dict[str, Any]) -> None:
    riser = _angelegt(api, token, haus["building_id"], _beispiel_halte(haus), note="  Schacht  ")
    assert riser["note"] == "Schacht"
    assert [s["floor_id"] for s in riser["stops"]] == [
        haus["kg"]["id"],
        haus["eg"]["id"],
        haus["og"]["id"],
    ]
    kg_eg, eg_og = riser["sections"]
    assert _verlauf(kg_eg) == [[1_200, 3_400, -2_800], [1_200, 3_400, 0]]
    assert _verlauf(eg_og) == [
        [1_200, 3_400, 0],
        [1_200, 3_400, 2_900],
        [1_650, 3_400, 2_900],
        [1_650, 3_700, 2_900],
    ]
    assert (eg_og["vertical_mm"], eg_og["horizontal_mm"], eg_og["length_mm"]) == (2_900, 750, 3_650)
    assert (riser["status"], riser["length_mm"], riser["known_length_mm"]) == (
        "confirmed",
        6_450,
        6_450,
    )
    # Lesen liefert dieselbe Ableitung.
    assert _einziger(api, token, haus["building_id"]) == riser


def test_beispiel_direct_ohne_3d_diagonale(
    api: TestClient, token: str, haus: dict[str, Any]
) -> None:
    riser = _angelegt(api, token, haus["building_id"], _beispiel_halte(haus), offset_mode="direct")
    eg_og = riser["sections"][1]
    assert _verlauf(eg_og) == [[1_200, 3_400, 0], [1_200, 3_400, 2_900], [1_650, 3_700, 2_900]]
    assert eg_og["horizontal_mm"] == 541
    assert riser["length_mm"] == 6_241


def test_unbestaetigte_hoehe_liefert_nur_teilsumme_und_bestaetigung_aktualisiert(
    api: TestClient, token: str, haus: dict[str, Any]
) -> None:
    _floor_patch(api, token, haus["og"]["id"], elevation_confirmed=False)
    riser = _angelegt(api, token, haus["building_id"], _beispiel_halte(haus))
    eg_og = riser["sections"][1]
    assert eg_og["status"] == "elevation-unconfirmed"
    assert (eg_og["vertical_mm"], eg_og["length_mm"], eg_og["horizontal_mm"]) == (None, None, 750)
    assert (riser["status"], riser["length_mm"], riser["known_length_mm"]) == (
        "incomplete",
        None,
        3_550,
    )

    # Bestaetigen: dieselbe Abfrage liefert sofort die bestaetigte Laenge.
    _floor_patch(api, token, haus["og"]["id"], elevation_confirmed=True)
    assert _einziger(api, token, haus["building_id"])["length_mm"] == 6_450
    # Wert aendern ohne erneute Bestaetigung: wieder unbestaetigt, Teilsumme.
    _floor_patch(api, token, haus["og"]["id"], elevation_mm=3_000)
    nachher = _einziger(api, token, haus["building_id"])
    assert (nachher["status"], nachher["length_mm"], nachher["known_length_mm"]) == (
        "incomplete",
        None,
        3_550,
    )
    assert _verlauf(nachher["sections"][1])[1] == [1_200, 3_400, 3_000]
    # Neuer Wert bestaetigt: neue Laenge.
    _floor_patch(api, token, haus["og"]["id"], elevation_mm=3_000, elevation_confirmed=True)
    assert _einziger(api, token, haus["building_id"])["length_mm"] == 6_550


def test_widerspruechliche_hoehe_ist_konflikt(
    api: TestClient, token: str, haus: dict[str, Any]
) -> None:
    _floor_patch(api, token, haus["og"]["id"], elevation_mm=0, elevation_confirmed=True)
    riser = _angelegt(
        api, token, haus["building_id"], [_halt(haus["eg"], 0, 0), _halt(haus["og"], 0, 400)]
    )
    (abschnitt,) = riser["sections"]
    assert abschnitt["status"] == "elevation-inconsistent"
    assert (abschnitt["vertical_mm"], abschnitt["horizontal_mm"]) == (None, 400)
    assert (riser["status"], riser["length_mm"], riser["known_length_mm"]) == (
        "conflict",
        None,
        400,
    )


def test_reihenfolgeaenderung_wirkt_sofort(
    api: TestClient, token: str, haus: dict[str, Any]
) -> None:
    """Die Halte folgen der aktuellen Geschossebene, nicht der gespeicherten Reihenfolge."""
    riser = _angelegt(api, token, haus["building_id"], _beispiel_halte(haus))
    _floor_patch(api, token, haus["kg"]["id"], level=5, elevation_mm=6_000)
    nachher = _einziger(api, token, haus["building_id"])
    assert [s["floor_id"] for s in nachher["stops"]] == [
        haus["eg"]["id"],
        haus["og"]["id"],
        haus["kg"]["id"],
    ]
    # KG ist jetzt unbestaetigt (Wert geaendert) - Teilsumme.
    assert nachher["status"] == "incomplete"
    assert nachher["version"] == riser["version"]


def test_ausgelassenes_geschoss_wird_durchquert(
    api: TestClient, token: str, haus: dict[str, Any]
) -> None:
    riser = _angelegt(
        api,
        token,
        haus["building_id"],
        [_halt(haus["kg"], 1_200, 3_400), _halt(haus["og"], 1_650, 3_700)],
    )
    (abschnitt,) = riser["sections"]
    assert abschnitt["traversed_floor_ids"] == [haus["eg"]["id"]]
    assert (abschnitt["vertical_mm"], abschnitt["length_mm"]) == (5_700, 6_450)


def test_einzelner_und_kein_uebergabepunkt(
    api: TestClient, token: str, haus: dict[str, Any]
) -> None:
    einer = _angelegt(api, token, haus["building_id"], [_halt(haus["eg"], 0, 0)], name="A")
    keiner = _angelegt(api, token, haus["building_id"], [], name="B")
    assert (einer["status"], einer["sections"], einer["length_mm"]) == ("single-stop", [], None)
    assert (keiner["status"], keiner["known_length_mm"]) == ("no-stops", 0)


def test_hinweis_bei_kleinem_geschossabstand_aendert_keine_laenge(
    api: TestClient, token: str, haus: dict[str, Any]
) -> None:
    _floor_patch(api, token, haus["og"]["id"], elevation_mm=2_200, elevation_confirmed=True)
    riser = _angelegt(
        api, token, haus["building_id"], [_halt(haus["eg"], 0, 0), _halt(haus["og"], 0, 0)]
    )
    assert riser["sections"][0]["hints"] == ["floor-gap-below-ceiling-height"]
    assert (riser["status"], riser["length_mm"]) == ("confirmed", 2_200)
    _floor_patch(api, token, haus["eg"]["id"], default_ceiling_height_mm=2_100)
    nachher = _einziger(api, token, haus["building_id"])
    assert nachher["sections"][0]["hints"] == []
    assert (nachher["status"], nachher["length_mm"]) == ("confirmed", 2_200)


# ----------------------------------------------- Halte: IDs und Validierung


def test_stabile_ids_beim_verschieben_ergaenzen_und_entfernen(
    api: TestClient, token: str, haus: dict[str, Any], engine: Engine
) -> None:
    riser = _angelegt(
        api, token, haus["building_id"], [_halt(haus["kg"], 0, 0), _halt(haus["eg"], 0, 0)]
    )
    kg_id, eg_id = (s["id"] for s in riser["stops"])

    verschoben = _ersetzen(
        api,
        token,
        riser,
        stops=[
            _halt(haus["kg"], 100, 200, kg_id),
            _halt(haus["eg"], 0, 0, eg_id),
            _halt(haus["og"], 500, 0),
        ],
    )
    assert verschoben.status_code == 200, verschoben.text
    body = verschoben.json()
    assert body["version"] == riser["version"] + 1
    assert [s["id"] for s in body["stops"]][:2] == [kg_id, eg_id]
    assert body["stops"][0]["x_mm"] == 100
    og_id = body["stops"][2]["id"]
    assert og_id not in (kg_id, eg_id)

    entfernt = _ersetzen(
        api, token, body, stops=[_halt(haus["eg"], 0, 0, eg_id), _halt(haus["og"], 500, 0, og_id)]
    )
    assert entfernt.status_code == 200, entfernt.text
    assert [s["id"] for s in entfernt.json()["stops"]] == [eg_id, og_id]
    _, stops = _db(engine)
    assert sorted(str(s.id) for s in stops) == sorted([eg_id, og_id])


def test_unveraendertes_ersetzen_zaehlt_keine_version(
    api: TestClient, token: str, haus: dict[str, Any], ereignisse: Any
) -> None:
    riser = _angelegt(api, token, haus["building_id"], _beispiel_halte(haus))
    projekt_vorher = api.get(
        f"/api/v1/projects/{haus['project']['id']}", headers=auth_headers(token)
    ).json()
    response = _ersetzen(api, token, riser)
    assert response.status_code == 200, response.text
    assert response.json()["version"] == riser["version"]
    projekt_nachher = api.get(
        f"/api/v1/projects/{haus['project']['id']}", headers=auth_headers(token)
    ).json()
    assert projekt_nachher["updated_at"] == projekt_vorher["updated_at"]


def test_steigweg_sendet_kein_event(
    api: TestClient, token: str, haus: dict[str, Any], engine: Engine
) -> None:
    session = sessionmaker(bind=engine)()
    try:
        vorher = len(list(session.execute(select(DomainEventRecord)).scalars()))
    finally:
        session.close()
    riser = _angelegt(api, token, haus["building_id"], _beispiel_halte(haus))
    assert _ersetzen(api, token, riser, name="Neu").status_code == 200
    session = sessionmaker(bind=engine)()
    try:
        assert len(list(session.execute(select(DomainEventRecord)).scalars())) == vorher
    finally:
        session.close()


@pytest.mark.parametrize(
    ("fall", "code"),
    [
        ("doppeltes-geschoss", "riser-stop-floor-duplicate"),
        ("anderes-gebaeude", "riser-stop-floor-unknown"),
        ("anderes-projekt", "riser-stop-floor-unknown"),
        ("unbekanntes-geschoss", "riser-stop-floor-unknown"),
    ],
)
def test_ungueltige_halte_beim_anlegen(
    api: TestClient, token: str, haus: dict[str, Any], engine: Engine, fall: str, code: str
) -> None:
    if fall == "doppeltes-geschoss":
        stops = [_halt(haus["eg"], 0, 0), _halt(haus["eg"], 100, 0)]
    elif fall == "anderes-gebaeude":
        garage = api.post(
            f"/api/v1/projects/{haus['project']['id']}/buildings",
            headers=auth_headers(token),
            json={"name": "Garage"},
        ).json()
        fremd = _geschoss(api, token, garage["id"], "EG Garage", 0, 0)
        stops = [_halt(haus["eg"], 0, 0), _halt(fremd, 0, 0)]
    elif fall == "anderes-projekt":
        anderes = raeume._struktur(api, token, name="Anbau Musterweg 2")
        stops = [_halt(haus["eg"], 0, 0), _halt(anderes["floor"], 0, 0)]
    else:
        stops = [{"floor_id": str(uuid.uuid4()), "x_mm": 0, "y_mm": 0}]
    response = _anlegen(api, token, haus["building_id"], stops)
    assert response.status_code == 422, response.text
    assert fehlercodes(response) == {code}
    assert _db(engine) == ([], [])


def test_ungueltige_halte_beim_ersetzen(
    api: TestClient, token: str, haus: dict[str, Any], engine: Engine
) -> None:
    riser = _angelegt(
        api, token, haus["building_id"], [_halt(haus["kg"], 0, 0), _halt(haus["eg"], 0, 0)]
    )
    anderer = _angelegt(api, token, haus["building_id"], [_halt(haus["og"], 0, 0)], name="Zweiter")
    kg_id, eg_id = (s["id"] for s in riser["stops"])
    faelle = {
        "riser-stop-floor-changed": [
            _halt(haus["og"], 0, 0, kg_id),
            _halt(haus["eg"], 0, 0, eg_id),
        ],
        "riser-stop-unknown": [_halt(haus["og"], 0, 0, anderer["stops"][0]["id"])],
        "riser-stop-id-duplicate": [_halt(haus["kg"], 0, 0, kg_id), _halt(haus["eg"], 0, 0, kg_id)],
        "riser-stop-floor-duplicate": [_halt(haus["kg"], 0, 0, kg_id), _halt(haus["kg"], 5, 0)],
    }
    for code, stops in faelle.items():
        response = _ersetzen(api, token, riser, stops=stops)
        assert response.status_code == 422, (code, response.text)
        assert fehlercodes(response) == {code}
    assert _einziger_mit_namen(api, token, haus["building_id"], riser["name"]) == riser


def _einziger_mit_namen(api: TestClient, token: str, building_id: str, name: str) -> dict[str, Any]:
    return next(r for r in _liste(api, token, building_id) if r["name"] == name)


def test_alter_halt_entfaellt_und_neuer_auf_demselben_geschoss(
    api: TestClient, token: str, haus: dict[str, Any]
) -> None:
    """Ausdruecklich ohne ID: ein neuer Halt darf den entfernten auf demselben Geschoss ersetzen."""
    riser = _angelegt(api, token, haus["building_id"], [_halt(haus["eg"], 0, 0)])
    response = _ersetzen(api, token, riser, stops=[_halt(haus["eg"], 10, 10)])
    assert response.status_code == 200, response.text
    assert response.json()["stops"][0]["id"] != riser["stops"][0]["id"]


@pytest.mark.parametrize(
    "koerper",
    [
        {"name": "  ", "offset_mode": "direct"},
        {"name": "x" * 121, "offset_mode": "direct"},
        {"name": "A", "offset_mode": "diagonal"},
        {"name": "A", "offset_mode": "direct", "note": "n" * 501},
        {
            "name": "A",
            "offset_mode": "direct",
            "stops": [{"floor_id": str(uuid.uuid4()), "x_mm": 1_000_001, "y_mm": 0}],
        },
        {
            "name": "A",
            "offset_mode": "direct",
            "stops": [{"floor_id": str(uuid.uuid4()), "x_mm": 1.5, "y_mm": 0}],
        },
        {"name": "A", "offset_mode": "direct", "length_mm": 5},
    ],
)
def test_ungueltige_eingaben(
    api: TestClient, token: str, haus: dict[str, Any], koerper: dict[str, Any]
) -> None:
    response = api.post(
        f"{BASIS}/buildings/{haus['building_id']}/risers", headers=auth_headers(token), json=koerper
    )
    assert response.status_code == 422, response.text


def test_name_ist_je_gebaeude_eindeutig(api: TestClient, token: str, haus: dict[str, Any]) -> None:
    erster = _angelegt(api, token, haus["building_id"], [], name="Schacht")
    doppelt = _anlegen(api, token, haus["building_id"], [], name="Schacht")
    assert doppelt.status_code == 422
    assert fehlercodes(doppelt) == {"riser-name-taken"}
    zweiter = _angelegt(api, token, haus["building_id"], [], name="Schacht 2")
    umbenannt = _ersetzen(api, token, zweiter, name="Schacht")
    assert umbenannt.status_code == 422
    assert fehlercodes(umbenannt) == {"riser-name-taken"}
    # In einem anderen Gebaeude ist der Name frei.
    garage = api.post(
        f"/api/v1/projects/{haus['project']['id']}/buildings",
        headers=auth_headers(token),
        json={"name": "Garage"},
    ).json()
    assert _anlegen(api, token, garage["id"], [], name="Schacht").status_code == 201
    assert erster["name"] == "Schacht"


# ------------------------------------------------- If-Match und Loeschen


def test_if_match_beim_ersetzen_und_loeschen(
    api: TestClient, token: str, haus: dict[str, Any]
) -> None:
    riser = _angelegt(api, token, haus["building_id"], _beispiel_halte(haus))
    ohne = api.put(
        f"{BASIS}/risers/{riser['id']}",
        headers=auth_headers(token),
        json={"name": "X", "offset_mode": "direct", "stops": []},
    )
    assert ohne.status_code == 428
    assert _ersetzen(api, token, riser, name="Neu").status_code == 200
    veraltet = _ersetzen(api, token, riser, name="Noch neuer")
    assert veraltet.status_code == 409
    assert veraltet.json()["type"].endswith("version-conflict")
    loeschen_alt = api.delete(
        f"{BASIS}/risers/{riser['id']}",
        headers={**auth_headers(token), "If-Match": str(riser["version"])},
    )
    assert loeschen_alt.status_code == 409
    aktuell = _einziger(api, token, haus["building_id"])
    assert aktuell["name"] == "Neu"
    geloescht = api.delete(
        f"{BASIS}/risers/{riser['id']}",
        headers={**auth_headers(token), "If-Match": str(aktuell["version"])},
    )
    assert geloescht.status_code == 204
    assert _liste(api, token, haus["building_id"]) == []
    weg = _ersetzen(api, token, aktuell)
    assert weg.status_code == 404


def test_geschoss_und_gebaeude_mit_steigweg_lassen_sich_nicht_loeschen(
    api: TestClient, token: str, haus: dict[str, Any], engine: Engine
) -> None:
    riser = _angelegt(api, token, haus["building_id"], [_halt(haus["og"], 0, 0)])
    og = _floor(api, token, haus["building_id"], haus["og"]["id"])
    geschoss_weg = api.delete(
        f"/api/v1/floors/{og['id']}",
        headers={**auth_headers(token), "If-Match": str(og["version"])},
    )
    assert geschoss_weg.status_code == 409, geschoss_weg.text
    # Auch ohne Halt haelt der Steigweg das Gebaeude.
    leer = _ersetzen(api, token, riser, stops=[])
    assert leer.status_code == 200
    gebaeude = next(
        b
        for b in api.get(
            f"/api/v1/projects/{haus['project']['id']}/buildings", headers=auth_headers(token)
        ).json()
        if b["id"] == haus["building_id"]
    )
    gebaeude_weg = api.delete(
        f"/api/v1/buildings/{gebaeude['id']}",
        headers={**auth_headers(token), "If-Match": str(gebaeude["version"])},
    )
    assert gebaeude_weg.status_code == 409, gebaeude_weg.text
    risers, _ = _db(engine)
    assert len(risers) == 1
    # Jetzt ohne Halt: das Geschoss laesst sich loeschen.
    og = _floor(api, token, haus["building_id"], haus["og"]["id"])
    assert (
        api.delete(
            f"/api/v1/floors/{og['id']}",
            headers={**auth_headers(token), "If-Match": str(og["version"])},
        ).status_code
        == 204
    )


def test_projektloeschung_entfernt_steigwege(
    api: TestClient, token: str, haus: dict[str, Any], engine: Engine
) -> None:
    _angelegt(api, token, haus["building_id"], _beispiel_halte(haus))
    _angelegt(api, token, haus["building_id"], [], name="Ohne Halt")
    projekt = haus["project"]
    pruefung = api.get(
        f"/api/v1/projects/{projekt['id']}/deletion-check", headers=auth_headers(token)
    )
    assert pruefung.status_code == 200, pruefung.text
    inhalte = {item["code"]: item["count"] for item in pruefung.json()["contents"]}
    assert (inhalte["electrical.risers"], inhalte["electrical.riser_stops"]) == (2, 3)

    aktuell = api.get(f"/api/v1/projects/{projekt['id']}", headers=auth_headers(token)).json()
    geloescht = api.delete(
        f"/api/v1/projects/{projekt['id']}",
        headers={**auth_headers(token), "If-Match": str(aktuell["version"])},
        params={"confirm_project_number": aktuell["project_number"]},
    )
    assert geloescht.status_code == 204, geloescht.text
    assert _db(engine) == ([], [])


# ------------------------------------------------------- Rechte und Status


def test_leserecht_sieht_steigwege_aber_schreibt_nicht(
    api: TestClient, token: str, betrieb: uuid.UUID, engine: Engine, haus: dict[str, Any]
) -> None:
    riser = _angelegt(api, token, haus["building_id"], _beispiel_halte(haus))
    raeume._mitglied_mit_permissions(engine, betrieb, "leser@steigweg.example", (PLAN_READ,))
    leser = login(api, "leser@steigweg.example")
    assert [r["id"] for r in _liste(api, leser, haus["building_id"])] == [riser["id"]]
    neu = _anlegen(api, leser, haus["building_id"], [], name="Neu")
    ersetzen = _ersetzen(api, leser, riser, name="Neu")
    loeschen = api.delete(
        f"{BASIS}/risers/{riser['id']}", headers={**auth_headers(leser), "If-Match": "1"}
    )
    assert (neu.status_code, ersetzen.status_code, loeschen.status_code) == (403, 403, 403)


def test_ohne_leserecht_kein_zugriff(
    api: TestClient, token: str, betrieb: uuid.UUID, engine: Engine, haus: dict[str, Any]
) -> None:
    raeume._mitglied_mit_permissions(engine, betrieb, "fremd@steigweg.example", ())
    ohne = login(api, "fremd@steigweg.example")
    response = api.get(
        f"{BASIS}/buildings/{haus['building_id']}/risers", headers=auth_headers(ohne)
    )
    assert response.status_code == 403


@pytest.mark.parametrize("status", ["completed", "archived"])
def test_abgeschlossene_und_archivierte_projekte_sind_schreibgeschuetzt(
    api: TestClient, token: str, haus: dict[str, Any], engine: Engine, status: str
) -> None:
    riser = _angelegt(api, token, haus["building_id"], _beispiel_halte(haus))
    projekt = haus["project"]
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

    antworten = [
        _anlegen(api, token, haus["building_id"], [], name="Neu"),
        _ersetzen(api, token, riser, name="Neu"),
        api.delete(
            f"{BASIS}/risers/{riser['id']}", headers={**auth_headers(token), "If-Match": "1"}
        ),
    ]
    for response in antworten:
        assert response.status_code == 409, response.text
        assert response.json()["type"].endswith(f"project-{status}")
    risers, stops = _db(engine)
    assert [(r.name, r.version) for r in risers] == [(riser["name"], 1)]
    assert len(stops) == 3
    # Lesen bleibt moeglich.
    assert _einziger(api, token, haus["building_id"])["length_mm"] == 6_450
