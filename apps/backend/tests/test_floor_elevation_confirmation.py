"""Bestaetigte Hoehenlage eines Geschosses (Phase 6a.0, ADR 0025).

* Standard ``false`` - auch das Erdgeschoss mit ``0``; nichts wird abgeleitet.
* ``0`` mit Bestaetigung ist ein zulaessiger Gebaeudebezug.
* Eine tatsaechliche Wertaenderung ohne erneute Bestaetigung im selben Request
  entzieht die Bestaetigung; ein unveraenderter Wert laesst sie stehen.
* Bestaetigung ohne Wertaenderung setzen und zuruecknehmen.
* ``If-Match``, Projektsperre und Schreibschutz gelten unveraendert.
* Der Fachmodul-Kontext (``FloorPlanningContext``) traegt das Feld additiv.

Synthetische Daten. Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

from app.core.projects.planning import FloorPlanningAccess
from tests import test_electrical_rooms as raeume
from tests.conftest import auth_headers, requires_database

pytestmark = [requires_database, pytest.mark.database]

betrieb = raeume.betrieb
ereignisse = raeume.ereignisse
token = raeume.token
geschoss = raeume.geschoss


def _patch(api: TestClient, token: str, floor: dict[str, Any], body: dict[str, Any]) -> Any:
    aktuell = _lesen(api, token, floor)
    return api.patch(
        f"/api/v1/floors/{floor['id']}",
        headers={**auth_headers(token), "If-Match": str(aktuell["version"])},
        json=body,
    )


def _lesen(api: TestClient, token: str, floor: dict[str, Any]) -> dict[str, Any]:
    liste = api.get(
        f"/api/v1/buildings/{floor['building_id']}/floors", headers=auth_headers(token)
    ).json()
    return dict(next(item for item in liste if item["id"] == floor["id"]))


def _bestaetigt(api: TestClient, token: str, floor: dict[str, Any]) -> tuple[int, bool]:
    aktuell = _lesen(api, token, floor)
    return aktuell["elevation_mm"], aktuell["elevation_confirmed"]


def test_neues_geschoss_ist_unbestaetigt_auch_mit_null(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor = geschoss["floor"]
    assert (floor["elevation_mm"], floor["elevation_confirmed"]) == (0, False)


def test_null_mit_bestaetigung_ist_ein_gueltiger_bezug(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    response = api.post(
        f"/api/v1/buildings/{geschoss['building']['id']}/floors",
        headers=auth_headers(token),
        json={"name": "Keller", "level": -1, "elevation_mm": -2_800, "elevation_confirmed": True},
    )
    assert response.status_code == 201, response.text
    assert response.json()["elevation_confirmed"] is True

    response = _patch(api, token, geschoss["floor"], {"elevation_confirmed": True})
    assert response.status_code == 200, response.text
    assert _bestaetigt(api, token, geschoss["floor"]) == (0, True)


def test_wertaenderung_ohne_erneute_bestaetigung_entzieht_sie(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor = geschoss["floor"]
    assert _patch(api, token, floor, {"elevation_confirmed": True}).status_code == 200

    response = _patch(api, token, floor, {"elevation_mm": 150})
    assert response.status_code == 200, response.text
    assert _bestaetigt(api, token, floor) == (150, False)


def test_wertaenderung_mit_bestaetigung_im_selben_request(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor = geschoss["floor"]
    response = _patch(api, token, floor, {"elevation_mm": 200, "elevation_confirmed": True})
    assert response.status_code == 200, response.text
    assert _bestaetigt(api, token, floor) == (200, True)
    # Neuer Wert und ausdrueckliches ``false`` bleiben unbestaetigt.
    assert (
        _patch(api, token, floor, {"elevation_mm": 300, "elevation_confirmed": False}).status_code
        == 200
    )
    assert _bestaetigt(api, token, floor) == (300, False)


def test_unveraenderter_wert_laesst_die_bestaetigung_stehen(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor = geschoss["floor"]
    assert _patch(api, token, floor, {"elevation_confirmed": True}).status_code == 200
    # Derselbe Wert erneut gesendet und eine andere Aenderung am Geschoss.
    response = _patch(api, token, floor, {"elevation_mm": 0, "name": "EG"})
    assert response.status_code == 200, response.text
    assert _bestaetigt(api, token, floor) == (0, True)
    response = _patch(api, token, floor, {"default_ceiling_height_mm": 2_600})
    assert response.status_code == 200, response.text
    assert _bestaetigt(api, token, floor) == (0, True)


def test_bestaetigung_ohne_wertaenderung_zuruecknehmen(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor = geschoss["floor"]
    assert _patch(api, token, floor, {"elevation_confirmed": True}).status_code == 200
    assert _patch(api, token, floor, {"elevation_confirmed": False}).status_code == 200
    assert _bestaetigt(api, token, floor) == (0, False)


def test_null_und_unbekannte_werte_werden_abgelehnt(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor = geschoss["floor"]
    assert _patch(api, token, floor, {"elevation_confirmed": None}).status_code == 422
    assert _patch(api, token, floor, {"elevation_confirmed": "ja"}).status_code == 422


def test_if_match_und_schreibschutz_gelten(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor = geschoss["floor"]
    ohne = api.patch(
        f"/api/v1/floors/{floor['id']}",
        headers=auth_headers(token),
        json={"elevation_confirmed": True},
    )
    assert ohne.status_code == 428
    veraltet = api.patch(
        f"/api/v1/floors/{floor['id']}",
        headers={**auth_headers(token), "If-Match": "99"},
        json={"elevation_confirmed": True},
    )
    assert veraltet.status_code == 409

    projekt = geschoss["project"]
    for schritt in ("activate", "complete"):
        aktuell = api.get(f"/api/v1/projects/{projekt['id']}", headers=auth_headers(token)).json()
        assert (
            api.post(
                f"/api/v1/projects/{projekt['id']}/{schritt}",
                headers={**auth_headers(token), "If-Match": str(aktuell["version"])},
            ).status_code
            == 200
        )
    gesperrt = _patch(api, token, floor, {"elevation_confirmed": True})
    assert gesperrt.status_code == 409
    assert gesperrt.json()["type"].endswith("/project-completed")
    assert _bestaetigt(api, token, floor) == (0, False)


def test_fachmodul_kontext_traegt_die_bestaetigung(
    api: TestClient,
    token: str,
    geschoss: dict[str, Any],
    engine: Engine,
    betrieb: uuid.UUID,
) -> None:
    floor = geschoss["floor"]
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        vorher = FloorPlanningAccess(session, betrieb).context(uuid.UUID(floor["id"]))
    finally:
        session.close()
    assert vorher.elevation_confirmed is False
    assert _patch(api, token, floor, {"elevation_confirmed": True}).status_code == 200
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        nachher = FloorPlanningAccess(session, betrieb).context(uuid.UUID(floor["id"]))
    finally:
        session.close()
    assert (nachher.elevation_mm, nachher.elevation_confirmed) == (0, True)
