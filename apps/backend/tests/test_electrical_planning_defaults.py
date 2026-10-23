"""Kabelvorlagen, Planungsvorgaben und Prozentreserve ueber die API (Phase 6c V1, ADR 0027).

Sollwerte sind fachlich hergeleitet: Beispiel §6.4 (8 500 mm Weg) mit 20 % Reserve
(aufgerundet 1 700 mm) und Anschlusszugaben 500 + 200 mm ergibt 10 900 mm.

Alle Vorlagen und Werte sind **synthetische Testdaten** (``TEST-*``) - keine
Kabelstandards und keine Betriebsvorgabe. Jeder abgelehnte Fall prueft zusaetzlich, dass
nichts gespeichert wurde. Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select, text
from sqlalchemy.orm import sessionmaker

from app.modules.electrical.models import (
    ElectricalCable,
    ElectricalCircuitDevice,
    ElectricalProjectPlanningDefaults,
)
from app.modules.electrical.permissions import CIRCUIT_WRITE, PLAN_READ, PLAN_WRITE, ROUTE_WRITE
from app.modules.electrical.planning_defaults import defaults_lock_key
from tests import test_electrical_cables as kabel
from tests import test_electrical_rooms as raeume
from tests.conftest import auth_headers, login, requires_database

pytestmark = [requires_database, pytest.mark.database]

betrieb = raeume.betrieb
ereignisse = raeume.ereignisse
token = raeume.token
geschoss = raeume.geschoss
BASIS = raeume.BASIS
fehlercodes = raeume.fehlercodes

_szenario = kabel._szenario
_beispiel = kabel._beispiel
_anlegen = kabel._anlegen
_mit = kabel._mit


# ------------------------------------------------------------------ Aufbau


def _vorlage(api: TestClient, token: str, name: str, typ: str, leiter: int, quer: str) -> Any:
    response = api.post(
        f"{BASIS}/cable-templates",
        headers=auth_headers(token),
        json={
            "name": name,
            "cable_type": typ,
            "conductor_count": leiter,
            "cross_section_mm2": quer,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _betrieb_setzen(api: TestClient, token: str, version: int, **werte: Any) -> Any:
    koerper: dict[str, Any] = {
        "expected_version": version,
        "reserve_percent": None,
        "board_allowance_mm": None,
        "junction_allowance_mm": None,
        "device_allowance_mm": None,
        "default_cable_template_id": None,
        "device_type_templates": [],
    }
    koerper.update(werte)
    return api.put(f"{BASIS}/planning-defaults", headers=auth_headers(token), json=koerper)


def _projekt_setzen(api: TestClient, token: str, projekt: str, version: int, **werte: Any) -> Any:
    koerper: dict[str, Any] = {
        "expected_version": version,
        "reserve_percent": None,
        "board_allowance_mm": None,
        "junction_allowance_mm": None,
        "device_allowance_mm": None,
        "default_cable_template_id": None,
        "device_type_templates": [],
    }
    koerper.update(werte)
    return api.put(
        f"{BASIS}/projects/{projekt}/planning-defaults", headers=auth_headers(token), json=koerper
    )


def _wirksam(
    api: TestClient, token: str, projekt: str, sz: dict[str, Any] | None = None, **ziel: str
) -> Any:
    params: dict[str, str] = {}
    if sz is not None:
        params = {"circuit_id": sz["f1"]["id"], "start_device_id": sz["uv1"], **ziel}
        params.setdefault("end_device_id", sz["sd1"])
    response = api.get(
        f"{BASIS}/projects/{projekt}/planning-defaults/effective",
        headers=auth_headers(token),
        params=params,
    )
    assert response.status_code == 200, response.text
    return response.json()


def _aus_vorgaben(sz: dict[str, Any], wirksam: dict[str, Any], **extra: Any) -> dict[str, Any]:
    """§6.4-Leitung mit allen drei Wertegruppen aus der gelesenen Vorgabe."""
    fuer = wirksam["for_cable"]
    koerper = _beispiel(
        sz,
        cable_type=fuer["spec"]["cable_type"],
        conductor_count=fuer["spec"]["conductor_count"],
        cross_section_mm2=fuer["spec"]["cross_section_mm2"],
        start_allowance_mm=fuer["allowances"]["start_mm"],
        end_allowance_mm=fuer["allowances"]["end_mm"],
        reserve_mode="percent",
        reserve_percent=fuer["reserve"]["percent"],
        reserve_mm=0,
        spec_source="defaults",
        reserve_source="defaults",
        allowance_source="defaults",
        defaults_basis=fuer["basis"],
    )
    koerper.update(extra)
    return koerper


def _wege(cable: dict[str, Any]) -> list[dict[str, Any]]:
    """Wegpunkte einer gelesenen Leitung als Anfrage (ohne die leeren Felder der Antwort)."""
    return [{k: v for k, v in w.items() if v is not None} for w in cable["waypoints"]]


def _anzahl(engine: Engine, model: type[object]) -> int:
    session = sessionmaker(bind=engine)()
    try:
        return int(session.execute(select(func.count()).select_from(model)).scalar_one())
    finally:
        session.close()


@pytest.fixture
def vorgaben(api: TestClient, token: str, geschoss: dict[str, Any]) -> dict[str, Any]:
    """Szenario §6.4, zwei synthetische Vorlagen, Betriebsstandard 20 %, 500/150/200 mm."""
    sz = _szenario(api, token, geschoss)
    dose = _vorlage(api, token, "Test Dose", "TEST-A", 3, "1.5")
    standard = _vorlage(api, token, "Test Standard", "TEST-B", 5, "2.5")
    response = _betrieb_setzen(
        api,
        token,
        0,
        reserve_percent="20",
        board_allowance_mm=500,
        junction_allowance_mm=150,
        device_allowance_mm=200,
        default_cable_template_id=standard["id"],
        device_type_templates=[
            {"device_type_key": "socket_single", "cable_template_id": dose["id"]}
        ],
    )
    assert response.status_code == 200, response.text
    assert response.json()["version"] == 1
    return {"sz": sz, "dose": dose, "standard": standard, "projekt": geschoss["project"]["id"]}


# ------------------------------------------------------------------ Vorgaben lesen


def test_wirksame_vorgaben_mit_herkunft_und_basis(
    api: TestClient, token: str, vorgaben: dict[str, Any]
) -> None:
    sz, projekt = vorgaben["sz"], vorgaben["projekt"]
    wirksam = _wirksam(api, token, projekt, sz)
    assert wirksam["basis"]["office_version"] == 1
    assert wirksam["basis"]["project_version"] == 0  # 0 = noch keine Projektvorgabe
    assert wirksam["reserve"]["origin"] == "office_default"
    assert {(a["endpoint_kind"], a["value_mm"], a["origin"]) for a in wirksam["allowances"]} == {
        ("board", 500, "office_default"),
        ("junction", 150, "office_default"),
        ("device", 200, "office_default"),
    }
    assert wirksam["default_template"]["template"]["id"] == vorgaben["standard"]["id"]
    fuer = wirksam["for_cable"]
    # Stufe 3: Geraetetypvorlage der Zielsteckdose; der Stromkreisvorschlag (2,5) ist nur Hinweis.
    assert fuer["spec"] == {
        "origin": "device_type_template",
        "cable_type": "TEST-A",
        "conductor_count": 3,
        "cross_section_mm2": "1.50",
        "cable_template_id": vorgaben["dose"]["id"],
        "level": "office",
        "deciding_device_id": sz["sd1"],
    }
    assert [h["code"] for h in fuer["hints"]] == ["circuit-proposal-not-activated"]
    assert (fuer["allowances"]["start_mm"], fuer["allowances"]["end_mm"]) == (500, 200)
    assert fuer["basis"]["cable_template_id"] == vorgaben["dose"]["id"]
    assert fuer["basis"]["cable_template_version"] == vorgaben["dose"]["version"]


def test_projekt_vor_betrieb_und_ausdrueckliche_null(
    api: TestClient, token: str, vorgaben: dict[str, Any]
) -> None:
    sz, projekt = vorgaben["sz"], vorgaben["projekt"]
    eigen = _vorlage(api, token, "Test Projekt", "TEST-C", 3, "4")
    response = _projekt_setzen(
        api,
        token,
        projekt,
        0,
        reserve_percent="0",
        device_allowance_mm=0,
        device_type_templates=[
            {"device_type_key": "socket_single", "cable_template_id": eigen["id"]}
        ],
    )
    assert response.status_code == 200, response.text
    assert response.json()["version"] == 1
    fuer = _wirksam(api, token, projekt, sz)["for_cable"]
    # Ausdrueckliche 0 gewinnt gegen den Betrieb; nicht gesetzte Felder erben weiter.
    assert (fuer["reserve"]["percent"], fuer["reserve"]["origin"]) == ("0.00", "project_default")
    assert fuer["allowances"] == {
        "origin": "project_default",
        "start_mm": 500,
        "end_mm": 0,
        "start_origin": "office_default",
        "end_origin": "project_default",
    }
    assert (fuer["spec"]["level"], fuer["spec"]["cable_template_id"]) == ("project", eigen["id"])
    assert fuer["basis"]["project_version"] == 1


def test_aktivierter_stromkreisvorrang_ersetzt_das_ganze_tripel(
    api: TestClient, token: str, vorgaben: dict[str, Any]
) -> None:
    sz, projekt = vorgaben["sz"], vorgaben["projekt"]
    kreis = api.patch(
        f"{BASIS}/circuits/{sz['f1']['id']}",
        headers=_mit(auth_headers(token), sz["f1"]["version"]),
        json={"proposal_overrides_templates": True},
    )
    assert kreis.status_code == 200, kreis.text
    fuer = _wirksam(api, token, projekt, sz)["for_cable"]
    assert (fuer["spec"]["origin"], fuer["spec"]["cable_template_id"]) == ("circuit_override", None)
    assert (fuer["spec"]["cable_type"], fuer["spec"]["cross_section_mm2"]) == ("NYM-J", "2.50")
    assert fuer["basis"]["circuit_version"] == kreis.json()["version"]
    # Gespeichert mit Stromkreisbasis; eine spaetere Stromkreisaenderung macht sie veraltet.
    koerper = _aus_vorgaben(sz, _wirksam(api, token, projekt, sz))
    cable = _anlegen(api, token, sz, koerper)
    assert cable.status_code == 201, cable.text
    assert cable.json()["spec_origin"] == "circuit_override"
    geaendert = api.patch(
        f"{BASIS}/circuits/{sz['f1']['id']}",
        headers=_mit(auth_headers(token), kreis.json()["version"]),
        json={"name": "Neu"},
    )
    assert geaendert.status_code == 200, geaendert.text
    veraltet = _anlegen(api, token, sz, {**koerper, "label": "L2"})
    assert veraltet.status_code == 409, veraltet.text
    assert veraltet.json()["type"].endswith("planning-defaults-changed")


# ------------------------------------------------------------------ Speichern mit Vorgaben


def test_prozentreserve_10900_mit_herkunft_und_basis(
    api: TestClient, token: str, vorgaben: dict[str, Any], engine: Engine
) -> None:
    sz, projekt = vorgaben["sz"], vorgaben["projekt"]
    response = _anlegen(api, token, sz, _aus_vorgaben(sz, _wirksam(api, token, projekt, sz)))
    assert response.status_code == 201, response.text
    cable = response.json()
    # 8 500 + 500 + 200 + aufgerundet 20 % von 8 500 (1 700) = 10 900 mm.
    assert (cable["geometric_mm"], cable["connection_allowance_mm"]) == (8_500, 700)
    assert (cable["reserve_effective_mm"], cable["reserve_pending"]) == (1_700, False)
    assert (cable["allowance_mm"], cable["length_mm"]) == (2_400, 10_900)
    assert (cable["reserve_mode"], cable["reserve_percent"], cable["reserve_mm"]) == (
        "percent",
        "20.00",
        0,
    )
    assert (cable["spec_origin"], cable["reserve_origin"], cable["allowance_origin"]) == (
        "device_type_template",
        "office_default",
        "office_default",
    )
    assert (cable["cable_template_id"], cable["cable_template_version"]) == (
        vorgaben["dose"]["id"],
        vorgaben["dose"]["version"],
    )
    assert (cable["defaults_office_version"], cable["defaults_project_version"]) == (1, 0)

    # Mengenuebersicht: Reserve getrennt, nicht doppelt.
    summary = api.get(
        f"{BASIS}/buildings/{sz['building']}/cabling-summary", headers=auth_headers(token)
    ).json()
    eimer = summary["totals"]["confirmed"]
    assert (eimer["connection_allowance_mm"], eimer["reserve_mm"]) == (700, 1_700)
    assert eimer["allowance_mm"] == 2_400 and eimer["total_mm"] == 10_900
    assert eimer["reserve_pending_count"] == 0
    assert _anzahl(engine, ElectricalCable) == 1


def test_geaenderte_vorgaben_lehnen_veraltete_basis_ab_bestand_bleibt(
    api: TestClient, token: str, vorgaben: dict[str, Any], engine: Engine
) -> None:
    sz, projekt = vorgaben["sz"], vorgaben["projekt"]
    gelesen = _wirksam(api, token, projekt, sz)
    cable = _anlegen(api, token, sz, _aus_vorgaben(sz, gelesen)).json()
    # Betriebsstandard aendern: 25 %.
    neu = _betrieb_setzen(
        api,
        token,
        1,
        reserve_percent="25",
        board_allowance_mm=500,
        junction_allowance_mm=150,
        device_allowance_mm=200,
        default_cable_template_id=vorgaben["standard"]["id"],
        device_type_templates=[
            {"device_type_key": "socket_single", "cable_template_id": vorgaben["dose"]["id"]}
        ],
    )
    assert neu.status_code == 200 and neu.json()["version"] == 2
    # Bestehende Leitung unveraendert: Werte stehen an ihr.
    bestand = api.get(f"{BASIS}/buildings/{sz['building']}/cables", headers=auth_headers(token))
    (gespeichert,) = bestand.json()["cables"]
    assert (gespeichert["reserve_percent"], gespeichert["length_mm"]) == ("20.00", 10_900)
    assert gespeichert["defaults_office_version"] == 1

    # Neu anlegen und ersetzen mit der alten Basis: 409, nichts gespeichert.
    alt = _aus_vorgaben(sz, gelesen, label="L2")
    abgelehnt = _anlegen(api, token, sz, alt)
    assert abgelehnt.status_code == 409, abgelehnt.text
    assert abgelehnt.json()["type"].endswith("planning-defaults-changed")
    assert "defaults_basis.office_version" in {e["field"] for e in abgelehnt.json()["errors"]}
    ersetzt = api.put(
        f"{BASIS}/cables/{cable['id']}",
        headers=_mit(auth_headers(token), cable["version"]),
        json={
            **_aus_vorgaben(sz, gelesen),
            "waypoints": _wege(cable),
            "new_penetrations": [],
        },
    )
    assert ersetzt.status_code == 409, ersetzt.text
    assert _anzahl(engine, ElectricalCable) == 1
    nachher = api.get(f"{BASIS}/buildings/{sz['building']}/cables", headers=auth_headers(token))
    assert nachher.json()["cables"][0]["version"] == cable["version"]

    # Mit den neuen Vorgaben: 25 % von 8 500 = 2 125 -> 11 325 mm.
    frisch = _anlegen(
        api, token, sz, _aus_vorgaben(sz, _wirksam(api, token, projekt, sz), label="L2")
    )
    assert frisch.status_code == 201, frisch.text
    assert frisch.json()["length_mm"] == 8_500 + 700 + 2_125


def test_gesendete_werte_muessen_der_vorgabe_entsprechen(
    api: TestClient, token: str, vorgaben: dict[str, Any], engine: Engine
) -> None:
    sz, projekt = vorgaben["sz"], vorgaben["projekt"]
    wirksam = _wirksam(api, token, projekt, sz)
    # Client behauptet "aus Vorgaben", sendet aber andere Werte - der Server vertraut nicht.
    for falsch in (
        {"reserve_percent": "30"},
        {"cross_section_mm2": "2.5"},
        {"end_allowance_mm": 250},
    ):
        response = _anlegen(api, token, sz, _aus_vorgaben(sz, wirksam, **falsch))
        assert response.status_code == 409, (falsch, response.text)
        assert response.json()["type"].endswith("planning-defaults-changed")
    # Andere Vorlagenversion in der Basis.
    basis = {**wirksam["for_cable"]["basis"], "cable_template_version": 99}
    response = _anlegen(api, token, sz, _aus_vorgaben(sz, wirksam, defaults_basis=basis))
    assert response.status_code == 409, response.text
    assert _anzahl(engine, ElectricalCable) == 0


def test_manuell_gemischt_und_bisherige_clients(
    api: TestClient, token: str, vorgaben: dict[str, Any]
) -> None:
    sz, projekt = vorgaben["sz"], vorgaben["projekt"]
    wirksam = _wirksam(api, token, projekt, sz)
    # Kabelangaben aus Vorgaben, Reserve ausdruecklich manuell 12,5 %.
    koerper = _aus_vorgaben(sz, wirksam, reserve_source="manual", reserve_percent="12.5")
    cable = _anlegen(api, token, sz, koerper).json()
    assert (cable["spec_origin"], cable["reserve_origin"]) == ("device_type_template", "manual")
    assert cable["reserve_effective_mm"] == 1_063  # 8 500 * 12,5 % = 1 062,5 -> aufgerundet

    # Bisheriger Client ohne Herkunftsangaben, nur die Bezeichnung geaendert: Herkunft bleibt.
    alt = {
        k: v
        for k, v in koerper.items()
        if k not in {"spec_source", "reserve_source", "allowance_source", "defaults_basis"}
    }
    alt.update(label="L1a", waypoints=_wege(cable), new_penetrations=[])
    ersetzt = api.put(
        f"{BASIS}/cables/{cable['id']}", headers=_mit(auth_headers(token), 1), json=alt
    )
    assert ersetzt.status_code == 200, ersetzt.text
    neu = ersetzt.json()
    assert (neu["spec_origin"], neu["reserve_origin"], neu["allowance_origin"]) == (
        "device_type_template",
        "manual",
        "office_default",
    )
    assert neu["cable_template_id"] == vorgaben["dose"]["id"]
    # Geaenderte Zugabe ohne Angabe: diese Gruppe wird ausdruecklich (manual).
    alt.update(end_allowance_mm=300)
    zweite = api.put(
        f"{BASIS}/cables/{cable['id']}", headers=_mit(auth_headers(token), 2), json=alt
    )
    assert zweite.status_code == 200, zweite.text
    assert (zweite.json()["allowance_origin"], zweite.json()["spec_origin"]) == (
        "manual",
        "device_type_template",
    )


def test_bestandsleitung_bleibt_legacy_und_feste_reserve(
    api: TestClient, token: str, vorgaben: dict[str, Any], engine: Engine
) -> None:
    """Eine Leitung im Stand vor V1 (Herkunft ``legacy``) behaelt beim Speichern ihre Werte."""
    sz = vorgaben["sz"]
    cable = _anlegen(api, token, sz, _beispiel(sz, reserve_mm=300)).json()
    session = sessionmaker(bind=engine)()
    try:
        session.execute(
            text(
                "UPDATE electrical_cables SET spec_origin = 'legacy', reserve_origin = 'legacy', "
                "allowance_origin = 'legacy'"
            )
        )
        session.commit()
    finally:
        session.close()
    response = api.put(
        f"{BASIS}/cables/{cable['id']}",
        headers=_mit(auth_headers(token), 1),
        json=_beispiel(
            sz, reserve_mm=300, label="L1a", waypoints=_wege(cable), new_penetrations=[]
        ),
    )
    assert response.status_code == 200, response.text
    neu = response.json()
    assert (neu["spec_origin"], neu["reserve_origin"], neu["allowance_origin"]) == ("legacy",) * 3
    assert (neu["reserve_mode"], neu["reserve_mm"], neu["length_mm"]) == ("fixed", 300, 9_500)


def test_vorlage_aendern_deaktivieren_und_loeschschutz(
    api: TestClient, token: str, vorgaben: dict[str, Any], engine: Engine
) -> None:
    sz, projekt = vorgaben["sz"], vorgaben["projekt"]
    dose = vorgaben["dose"]
    cable = _anlegen(api, token, sz, _aus_vorgaben(sz, _wirksam(api, token, projekt, sz))).json()
    geaendert = api.patch(
        f"{BASIS}/cable-templates/{dose['id']}",
        headers=_mit(auth_headers(token), dose["version"]),
        json={"cross_section_mm2": "2.5"},
    )
    assert geaendert.status_code == 200, geaendert.text
    assert geaendert.json()["in_use"] is True
    # Bestehende Leitung behaelt ihre Angaben; die Basis meldet die neue Vorlagenversion.
    gespeichert = api.get(
        f"{BASIS}/buildings/{sz['building']}/cables", headers=auth_headers(token)
    ).json()["cables"][0]
    assert (gespeichert["cross_section_mm2"], gespeichert["cable_template_version"]) == (
        "1.50",
        dose["version"],
    )
    # Deaktivieren: nie mehr vorgeschlagen, sichtbarer Hinweis, Standardvorlage greift.
    aus = api.patch(
        f"{BASIS}/cable-templates/{dose['id']}",
        headers=_mit(auth_headers(token), geaendert.json()["version"]),
        json={"is_active": False},
    )
    assert aus.status_code == 200, aus.text
    fuer = _wirksam(api, token, projekt, sz)["for_cable"]
    assert (fuer["spec"]["origin"], fuer["spec"]["cable_template_id"]) == (
        "default_template",
        vorgaben["standard"]["id"],
    )
    assert "template-inactive" in {h["code"] for h in fuer["hints"]}
    # Loeschen einer genutzten Vorlage: 409, nichts geloescht.
    weg = api.delete(
        f"{BASIS}/cable-templates/{dose['id']}",
        headers=_mit(auth_headers(token), aus.json()["version"]),
    )
    assert weg.status_code == 409, weg.text
    assert "cable-template-in-use" in fehlercodes(weg)
    assert gespeichert["id"] == cable["id"]
    # Ungenutzte Vorlage laesst sich loeschen.
    frei = _vorlage(api, token, "Test frei", "TEST-D", 2, "1.5")
    assert (
        api.delete(
            f"{BASIS}/cable-templates/{frei['id']}",
            headers=_mit(auth_headers(token), frei["version"]),
        ).status_code
        == 204
    )


def test_inaktive_vorlage_neu_waehlen_und_eingabepruefung(
    api: TestClient, token: str, vorgaben: dict[str, Any]
) -> None:
    alt = _vorlage(api, token, "Test alt", "TEST-E", 2, "1.5")
    aus = api.patch(
        f"{BASIS}/cable-templates/{alt['id']}",
        headers=_mit(auth_headers(token), alt["version"]),
        json={"is_active": False},
    )
    assert aus.status_code == 200
    gueltig = {
        "default_cable_template_id": vorgaben["standard"]["id"],
        "device_type_templates": [
            {"device_type_key": "socket_single", "cable_template_id": vorgaben["dose"]["id"]}
        ],
    }
    faelle: list[tuple[dict[str, Any], str]] = [
        ({**gueltig, "default_cable_template_id": alt["id"]}, "cable-template-inactive"),
        ({**gueltig, "default_cable_template_id": str(uuid.uuid4())}, "cable-template-unknown"),
        (
            {
                **gueltig,
                "device_type_templates": [
                    {"device_type_key": "data_single", "cable_template_id": vorgaben["dose"]["id"]}
                ],
            },
            "device-type-not-assignable",
        ),
    ]
    for werte, code in faelle:
        response = _betrieb_setzen(api, token, 1, **werte)
        assert response.status_code == 422, response.text
        assert code in fehlercodes(response), (code, response.text)
    # Mehr als zwei Nachkommastellen / ueber 100 %: Schema lehnt ab.
    for prozent in ("12.345", "100.5", "-1"):
        assert _betrieb_setzen(api, token, 1, reserve_percent=prozent).status_code == 422
    # Veraltete Version: 409, Stand bleibt.
    veraltet = _betrieb_setzen(api, token, 0, reserve_percent="10")
    assert veraltet.status_code == 409, veraltet.text
    stand = api.get(f"{BASIS}/planning-defaults", headers=auth_headers(token)).json()
    assert (stand["version"], stand["reserve_percent"]) == (1, "20.00")


# ------------------------------------------------------------------ offene Leitung, Zuordnung


def test_leitung_ohne_endgeraet_ist_offen_ohne_prozentreserve(
    api: TestClient, token: str, vorgaben: dict[str, Any]
) -> None:
    sz = vorgaben["sz"]
    koerper = _beispiel(sz, end_device_id=None, reserve_mode="percent", reserve_percent="20")
    response = _anlegen(api, token, sz, koerper)
    assert response.status_code == 201, response.text
    cable = response.json()
    assert cable["status"] == "incomplete" and cable["length_mm"] is None
    assert "end-device-missing" in {p["code"] for p in cable["problems"]}
    assert (cable["reserve_effective_mm"], cable["reserve_pending"]) == (None, True)
    assert cable["known_mm"] == cable["geometric_mm"] + 700
    summary = api.get(
        f"{BASIS}/buildings/{sz['building']}/cabling-summary", headers=auth_headers(token)
    ).json()
    assert summary["totals"]["incomplete"]["reserve_pending_count"] == 1
    assert summary["totals"]["incomplete"]["reserve_mm"] == 0
    assert summary["totals"]["confirmed"]["count"] == 0


def _ohne_zuordnung(api: TestClient, token: str, sz: dict[str, Any], *frei: str) -> dict[str, Any]:
    """Nimmt ``frei`` aus F1 heraus; liefert den neuen Stand von F1."""
    kreis = api.get(f"{BASIS}/buildings/{sz['building']}/circuits", headers=auth_headers(token))
    f1 = next(c for c in kreis.json()["circuits"] if c["id"] == sz["f1"]["id"])
    rest = [d for d in f1["device_ids"] if d not in {sz[n] for n in frei}]
    response = raeume_zuordnen(api, token, f1, rest)
    assert response.status_code == 200, response.text
    return dict(response.json())


def raeume_zuordnen(api: TestClient, token: str, kreis: dict[str, Any], ids: list[str]) -> Any:
    return api.put(
        f"{BASIS}/circuits/{kreis['id']}/devices",
        headers=_mit(auth_headers(token), kreis["version"]),
        json={"device_ids": ids},
    )


def test_ausdrueckliche_zuordnung_beim_speichern(
    api: TestClient, token: str, vorgaben: dict[str, Any], engine: Engine
) -> None:
    sz = vorgaben["sz"]
    f1 = _ohne_zuordnung(api, token, sz, "sd1")
    vorher = _anzahl(engine, ElectricalCircuitDevice)
    # Ohne assign_devices: nicht zugeordnetes Endgeraet wird abgelehnt (wie bisher).
    ohne = _anlegen(api, token, sz, _beispiel(sz))
    assert ohne.status_code == 422, ohne.text
    # Veraltete Stromkreisversion: 409, nichts gespeichert, nichts zugeordnet.
    veraltet = _anlegen(
        api, token, sz, _beispiel(sz, assign_devices=[sz["sd1"]], expected_circuit_version=1)
    )
    assert veraltet.status_code == 409, veraltet.text
    assert "circuit-version-changed" in fehlercodes(veraltet)
    # Kein Endgeraet dieser Leitung: 422.
    fremd = _anlegen(
        api,
        token,
        sz,
        _beispiel(sz, assign_devices=[sz["sd_k"]], expected_circuit_version=f1["version"]),
    )
    assert fremd.status_code == 422 and "assign-device-not-endpoint" in fehlercodes(fremd)
    assert _anzahl(engine, ElectricalCable) == 0
    assert _anzahl(engine, ElectricalCircuitDevice) == vorher
    # Erfolgreich: Leitung und Zuordnung atomar.
    ok = _anlegen(
        api,
        token,
        sz,
        _beispiel(sz, assign_devices=[sz["sd1"]], expected_circuit_version=f1["version"]),
    )
    assert ok.status_code == 201, ok.text
    assert _anzahl(engine, ElectricalCircuitDevice) == vorher + 1
    kreis = api.get(f"{BASIS}/buildings/{sz['building']}/circuits", headers=auth_headers(token))
    neu = next(c for c in kreis.json()["circuits"] if c["id"] == sz["f1"]["id"])
    assert sz["sd1"] in neu["device_ids"] and neu["version"] == f1["version"] + 1


def test_zuordnung_nie_umhaengen_und_rechte(
    api: TestClient, token: str, betrieb: uuid.UUID, vorgaben: dict[str, Any], engine: Engine
) -> None:
    sz = vorgaben["sz"]
    f1 = _ohne_zuordnung(api, token, sz, "sd1")
    # Steckdose eines anderen Stromkreises: nie umgehaengt.
    fremd = _beispiel(
        sz,
        end_device_id=sz["sd_fremd"],
        assign_devices=[sz["sd_fremd"]],
        expected_circuit_version=f1["version"],
    )
    fremd["waypoints"] = fremd["waypoints"][:2]
    fremd["new_penetrations"] = []
    response = _anlegen(api, token, sz, fremd)
    assert response.status_code == 409, response.text
    assert "device-assigned-elsewhere" in fehlercodes(response)
    # Ohne circuit.write keine Zuordnung, auch mit route.write.
    raeume._mitglied_mit_permissions(engine, betrieb, "wege@v1.example", (PLAN_READ, ROUTE_WRITE))
    wege = login(api, "wege@v1.example")
    verboten = _anlegen(
        api,
        wege,
        sz,
        _beispiel(sz, assign_devices=[sz["sd1"]], expected_circuit_version=f1["version"]),
    )
    assert verboten.status_code == 403, verboten.text
    assert _anzahl(engine, ElectricalCable) == 0


def test_datendose_ist_nicht_zuordenbar(
    api: TestClient, token: str, vorgaben: dict[str, Any], engine: Engine
) -> None:
    sz = vorgaben["sz"]
    kueche = kabel._geraete_setzen(
        api,
        token,
        sz["floor"],
        sz["kueche"],
        [kabel._wandgeraet(sz["k"][0], 2_000, 300, typ="data_single")],
    )
    daten = next(g["id"] for g in kueche["devices"] if g["device_type_key"] == "data_single")
    f1 = api.get(f"{BASIS}/buildings/{sz['building']}/circuits", headers=auth_headers(token)).json()
    kreis = next(c for c in f1["circuits"] if c["id"] == sz["f1"]["id"])
    koerper = _beispiel(
        sz, end_device_id=daten, assign_devices=[daten], expected_circuit_version=kreis["version"]
    )
    response = _anlegen(api, token, sz, koerper)
    assert response.status_code == 422, response.text
    assert "circuit-device-not-assignable" in fehlercodes(response)
    assert _anzahl(engine, ElectricalCable) == 0


# ------------------------------------------------------------------ Rechte, Mandant, Schreibschutz


def test_rechte_betriebsstandard_nur_mit_defaults_manage(
    api: TestClient, token: str, betrieb: uuid.UUID, vorgaben: dict[str, Any], engine: Engine
) -> None:
    raeume._mitglied_mit_permissions(
        engine, betrieb, "planer@v1.example", (PLAN_READ, PLAN_WRITE, CIRCUIT_WRITE, ROUTE_WRITE)
    )
    planer = login(api, "planer@v1.example")
    dose = vorgaben["dose"]
    antworten = [
        api.post(
            f"{BASIS}/cable-templates",
            headers=auth_headers(planer),
            json={
                "name": "x",
                "cable_type": "TEST-X",
                "conductor_count": 3,
                "cross_section_mm2": "1.5",
            },
        ),
        api.patch(
            f"{BASIS}/cable-templates/{dose['id']}",
            headers=_mit(auth_headers(planer), dose["version"]),
            json={"name": "y"},
        ),
        api.delete(
            f"{BASIS}/cable-templates/{dose['id']}",
            headers=_mit(auth_headers(planer), dose["version"]),
        ),
        _betrieb_setzen(api, planer, 1, reserve_percent="5"),
    ]
    assert [r.status_code for r in antworten] == [403] * 4
    # Lesen und Projektvorgaben (route.write) duerfen Planer.
    assert api.get(f"{BASIS}/cable-templates", headers=auth_headers(planer)).status_code == 200
    assert api.get(f"{BASIS}/planning-defaults", headers=auth_headers(planer)).status_code == 200
    projekt = _projekt_setzen(api, planer, vorgaben["projekt"], 0, reserve_percent="10")
    assert projekt.status_code == 200, projekt.text
    # Nur lesend (plan.read): keine Projektvorgabe.
    raeume._mitglied_mit_permissions(engine, betrieb, "lesen@v1.example", (PLAN_READ,))
    lesen = login(api, "lesen@v1.example")
    assert (
        _projekt_setzen(api, lesen, vorgaben["projekt"], 1, reserve_percent="0").status_code == 403
    )


def test_fremde_vorlage_und_fremdes_projekt(
    api: TestClient, token: str, vorgaben: dict[str, Any], engine: Engine
) -> None:
    # Zweiter Betrieb mit eigener Vorlage.
    from app.core.seed import seed_initial_data
    from app.main import build_registry
    from tests.conftest import ADMIN_PASSWORD

    session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    try:
        seed_initial_data(
            session,
            build_registry(),
            organization_name="Fremd V1 GmbH",
            admin_email="admin@fremd-v1.example",
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
    finally:
        session.close()
    fremd = login(api, "admin@fremd-v1.example")
    fremde_vorlage = _vorlage(api, fremd, "Fremd", "TEST-F", 3, "1.5")
    # Fremde Vorlage in eigenen Vorgaben: 422, nichts gespeichert.
    response = _betrieb_setzen(api, token, 1, default_cable_template_id=fremde_vorlage["id"])
    assert response.status_code == 422 and "cable-template-unknown" in fehlercodes(response)
    # Fremdes Projekt: 404 beim Lesen und Schreiben, nichts angelegt.
    projekt = vorgaben["projekt"]
    assert (
        api.get(
            f"{BASIS}/projects/{projekt}/planning-defaults", headers=auth_headers(fremd)
        ).status_code
        == 404
    )
    assert _projekt_setzen(api, fremd, projekt, 0, reserve_percent="1").status_code == 404
    effective = api.get(
        f"{BASIS}/projects/{projekt}/planning-defaults/effective", headers=auth_headers(fremd)
    )
    assert effective.status_code == 404
    # Fremder Stromkreis in der Abfrage: 404.
    sz = vorgaben["sz"]
    eigen = api.get(
        f"{BASIS}/projects/{projekt}/planning-defaults/effective",
        headers=auth_headers(token),
        params={"circuit_id": str(uuid.uuid4()), "start_device_id": sz["uv1"]},
    )
    assert eigen.status_code == 404, eigen.text
    assert _anzahl(engine, ElectricalProjectPlanningDefaults) == 0
    # Fremde Vorlage bleibt fuer den eigenen Betrieb unsichtbar.
    eigene = api.get(f"{BASIS}/cable-templates", headers=auth_headers(token)).json()
    assert fremde_vorlage["id"] not in {t["id"] for t in eigene["templates"]}


@pytest.mark.parametrize("status", ["completed", "archived"])
def test_projektvorgaben_schreibgeschuetzt_betrieb_nicht(
    api: TestClient, token: str, vorgaben: dict[str, Any], engine: Engine, status: str
) -> None:
    projekt = vorgaben["projekt"]
    schritte = (
        ("activate", "complete") if status == "completed" else ("activate", "complete", "archive")
    )
    for schritt in schritte:
        aktuell = api.get(f"/api/v1/projects/{projekt}", headers=auth_headers(token)).json()
        response = api.post(
            f"/api/v1/projects/{projekt}/{schritt}",
            headers=_mit(auth_headers(token), aktuell["version"]),
        )
        assert response.status_code == 200, response.text
    response = _projekt_setzen(api, token, projekt, 0, reserve_percent="5")
    assert response.status_code == 409, response.text
    assert response.json()["type"].endswith(f"project-{status}")
    assert _anzahl(engine, ElectricalProjectPlanningDefaults) == 0
    # Lesen bleibt moeglich; der Betriebsstandard ist nicht projektgebunden.
    assert _wirksam(api, token, projekt)["project_status"] == status
    assert _betrieb_setzen(api, token, 1, reserve_percent="15").status_code == 200


def test_projektloeschung_entfernt_projektvorgaben(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    projekt = geschoss["project"]
    vorlage = _vorlage(api, token, "Test", "TEST-A", 3, "1.5")
    assert (
        _projekt_setzen(
            api,
            token,
            projekt["id"],
            0,
            device_type_templates=[
                {"device_type_key": "socket_single", "cable_template_id": vorlage["id"]}
            ],
        ).status_code
        == 200
    )
    pruefung = api.get(
        f"/api/v1/projects/{projekt['id']}/deletion-check", headers=auth_headers(token)
    )
    assert pruefung.status_code == 200, pruefung.text
    assert "Planungsvorgaben" in pruefung.text
    aktuell = api.get(f"/api/v1/projects/{projekt['id']}", headers=auth_headers(token)).json()
    weg = api.delete(
        f"/api/v1/projects/{projekt['id']}",
        headers=_mit(auth_headers(token), aktuell["version"]),
        params={"confirm_project_number": aktuell["project_number"]},
    )
    assert weg.status_code == 204, weg.text
    assert _anzahl(engine, ElectricalProjectPlanningDefaults) == 0
    # Die Vorlage gehoert dem Betrieb und bleibt.
    assert api.get(f"{BASIS}/cable-templates", headers=auth_headers(token)).json()["templates"]


# ------------------------------------------------------------------ Nebenlaeufigkeit


def _warten_auf_sperre(engine: Engine) -> None:
    """Bis eine andere Sitzung auf eine Advisory-Sperre wartet (hoechstens 10 s)."""
    ende = time.monotonic() + 10
    while time.monotonic() < ende:
        with engine.connect() as connection:
            wartend = connection.execute(
                text("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted")
            ).scalar_one()
        if wartend:
            return
        time.sleep(0.05)
    pytest.fail("Keine wartende Sitzung - die Sperre wird nicht genommen.")


def test_speichern_wartet_auf_laufende_betriebsaenderung_und_sieht_sie(
    api: TestClient, token: str, vorgaben: dict[str, Any], betrieb: uuid.UUID, engine: Engine
) -> None:
    """Betriebsaenderung haelt die Sperre exklusiv: Ein Speichern mit Vorgaben wartet und
    prueft danach gegen den **neuen** Stand (409) - nie gegen einen halb geschriebenen."""
    sz, projekt = vorgaben["sz"], vorgaben["projekt"]
    koerper = _aus_vorgaben(sz, _wirksam(api, token, projekt, sz))
    ergebnis: dict[str, Any] = {}
    with engine.connect() as connection, connection.begin():
        connection.execute(
            text("SELECT pg_advisory_xact_lock(:key)"), {"key": defaults_lock_key(betrieb)}
        )
        connection.execute(
            text(
                "UPDATE electrical_planning_defaults SET version = version + 1, "
                "reserve_percent = 30 WHERE organization_id = :org"
            ),
            {"org": betrieb},
        )
        faden = threading.Thread(
            target=lambda: ergebnis.setdefault("antwort", _anlegen(api, token, sz, koerper))
        )
        faden.start()
        _warten_auf_sperre(engine)
    faden.join(timeout=20)
    antwort = ergebnis["antwort"]
    assert antwort.status_code == 409, antwort.text
    assert antwort.json()["type"].endswith("planning-defaults-changed")
    assert _anzahl(engine, ElectricalCable) == 0


def test_betriebsaenderung_wartet_auf_laufendes_speichern(
    api: TestClient, token: str, vorgaben: dict[str, Any], betrieb: uuid.UUID, engine: Engine
) -> None:
    """Ein Speichern haelt die Sperre geteilt: Die Betriebsaenderung wartet, bis es fertig ist."""
    ergebnis: dict[str, Any] = {}
    with engine.connect() as connection, connection.begin():
        connection.execute(
            text("SELECT pg_advisory_xact_lock_shared(:key)"), {"key": defaults_lock_key(betrieb)}
        )
        faden = threading.Thread(
            target=lambda: ergebnis.setdefault(
                "antwort", _betrieb_setzen(api, token, 1, reserve_percent="10")
            )
        )
        faden.start()
        _warten_auf_sperre(engine)
        assert "antwort" not in ergebnis
    faden.join(timeout=20)
    assert ergebnis["antwort"].status_code == 200, ergebnis["antwort"].text
    assert ergebnis["antwort"].json()["version"] == 2
