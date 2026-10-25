"""Betriebseigene Geraetetypen und Kategorie Geraeteanschluss (Phase 6c, K2, ADR 0030).

Schwerpunkte: ein Katalog mit Geltungsbereich (System + eigener Betrieb, nie fremde
Typen - in Pfad, Koerper und Verweisen), Datenbankregeln (Praefix und Eigentuemer,
zusammengesetzter Fremdschluessel, unveraenderlicher Schluessel/Eigentuemer), Rechte
(``electrical.device_types.manage`` nur fuer den Administrator), Versionen, Feldsperren
und Loeschschutz verwendeter Typen, Deaktivierung mit Bestandserhalt, Kategorie
``connection`` in Zuordnung, Leitungen und Kabelvorlagen, Nebenlaeufigkeit von Typaenderung
und erster Verwendung, Seed ohne Eingriff in eigene Typen.

Jeder abgelehnte Fall prueft, dass nichts gespeichert wurde. Synthetische Daten.
Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select, text
from sqlalchemy.exc import IntegrityError, InternalError
from sqlalchemy.orm import sessionmaker

from app.core.authorization.models import Permission, Role, RolePermission
from app.core.module_registry.registry import ModuleRegistry
from app.core.seed import seed_initial_data
from app.modules.electrical.catalog import CUSTOM_SYMBOL_KEYS, DEVICE_TYPE_CATALOG, SYMBOL_KEYS
from app.modules.electrical.models import ElectricalDeviceType
from app.modules.electrical.permissions import (
    CIRCUIT_WRITE,
    DEVICE_TYPES_MANAGE,
    PLAN_READ,
    PLAN_WRITE,
)
from app.modules.electrical.reference_data import ElectricalReferenceData
from tests import test_electrical_circuits as kreise
from tests import test_electrical_devices_api as geraete
from tests import test_electrical_planning_defaults as vorgaben
from tests import test_electrical_rooms as raeume
from tests.conftest import ADMIN_PASSWORD, auth_headers, login, requires_database

pytestmark = [requires_database, pytest.mark.database]

betrieb = raeume.betrieb
ereignisse = raeume.ereignisse
token = raeume.token
geschoss = raeume.geschoss
BASIS = raeume.BASIS
fehlercodes = raeume.fehlercodes


# ------------------------------------------------------------------ Helfer


def _typ_koerper(**extra: object) -> dict[str, Any]:
    koerper: dict[str, Any] = {
        "label": "Herdanschluss",
        "description": "Festanschluss Herd, Dose 3-polig",
        "category": "connection",
        "symbol_key": "connection_outlet",
        "allows_wall_interior": True,
        "allows_ceiling": False,
        "default_center_height_mm": 600,
        "width_mm": 120,
        "height_mm": 120,
    }
    koerper.update(extra)
    return koerper


def _anlegen(api: TestClient, token: str, **extra: object) -> Any:
    return api.post(
        f"{BASIS}/device-types", headers=auth_headers(token), json=_typ_koerper(**extra)
    )


def _angelegt(api: TestClient, token: str, **extra: object) -> dict[str, Any]:
    response = _anlegen(api, token, **extra)
    assert response.status_code == 201, response.text
    return dict(response.json())


def _aendern(api: TestClient, token: str, typ: dict[str, Any], **werte: object) -> Any:
    return api.patch(
        f"{BASIS}/device-types/{typ['key']}",
        headers={**auth_headers(token), "If-Match": str(typ["version"])},
        json=werte,
    )


def _katalog(api: TestClient, token: str) -> dict[str, dict[str, Any]]:
    response = api.get(f"{BASIS}/device-types", headers=auth_headers(token))
    assert response.status_code == 200, response.text
    return {row["key"]: row for row in response.json()}


def _typen_in_db(engine: Engine) -> list[ElectricalDeviceType]:
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        return list(session.execute(select(ElectricalDeviceType)).scalars())
    finally:
        session.close()


@pytest.fixture
def fremd(
    api: TestClient, engine: Engine, registry: ModuleRegistry, betrieb: uuid.UUID
) -> tuple[uuid.UUID, str]:
    """Ein zweiter Betrieb mit eigenem Administrator - synthetisch."""
    session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    try:
        result = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Fremdbetrieb GmbH",
            admin_email="admin@fremd.example",
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
    finally:
        session.close()
    return result.organization_id, login(api, "admin@fremd.example")


def _raum_mit_geraet(
    api: TestClient, token: str, floor: str, typ: str, **lage: int
) -> dict[str, Any]:
    raum = geraete._raum_mit_plan(api, token, floor)
    wand = raum["walls"][0]["id"]
    response = geraete._speichern(
        api,
        token,
        raum,
        devices=[
            geraete._wandgeraet(wand, lage.get("mitte", 1_000), lage.get("hoehe", 600), typ=typ)
        ],
    )
    assert response.status_code == 200, response.text
    return geraete._plan_raum(api, token, floor, raum["id"])


# ------------------------------------------------------- Katalog und Geltungsbereich


def test_seed_liefert_geraeteanschluss_und_laesst_eigene_typen_unberuehrt(
    api: TestClient, token: str, engine: Engine
) -> None:
    katalog = _katalog(api, token)
    anschluss = katalog["device_connection"]
    assert (anschluss["label"], anschluss["category"], anschluss["origin"]) == (
        "Geräteanschluss/Festanschluss",
        "connection",
        "system",
    )
    eigen = _angelegt(api, token)
    # Seed erneut: eigener Typ bleibt unveraendert und aktiv, Systemtypen idempotent.
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        ergebnis = ElectricalReferenceData().seed_reference_data(session)
        session.commit()
    finally:
        session.close()
    assert (ergebnis.created, ergebnis.updated, ergebnis.deactivated) == (0, 0, 0)
    nachher = _katalog(api, token)[eigen["key"]]
    assert nachher == eigen


def test_eigener_typ_erhaelt_serverschluessel_und_ist_nur_im_eigenen_betrieb_sichtbar(
    api: TestClient, token: str, fremd: tuple[uuid.UUID, str]
) -> None:
    eigen = _angelegt(api, token)
    assert eigen["key"].startswith("c_") and len(eigen["key"]) == 34
    assert (eigen["origin"], eigen["version"], eigen["device_count"]) == ("organization", 1, 0)
    _, fremd_token = fremd
    fremd_katalog = _katalog(api, fremd_token)
    assert eigen["key"] not in fremd_katalog
    assert "device_connection" in fremd_katalog
    # Fremder Typ im Pfad: dieselbe Antwort wie ein unbekannter Schluessel.
    for response in (
        _aendern(api, fremd_token, eigen, label="Uebernommen"),
        api.delete(
            f"{BASIS}/device-types/{eigen['key']}",
            headers={**auth_headers(fremd_token), "If-Match": "1"},
        ),
    ):
        assert response.status_code == 404, response.text
    assert _katalog(api, token)[eigen["key"]]["label"] == "Herdanschluss"


def test_systemtypen_sind_unveraenderlich_und_kein_client_vergibt_schluessel(
    api: TestClient, token: str
) -> None:
    system = _katalog(api, token)["socket_single"]
    geaendert = _aendern(api, token, system, label="Meine Steckdose")
    entfernt = api.delete(
        f"{BASIS}/device-types/socket_single", headers={**auth_headers(token), "If-Match": "1"}
    )
    for response in (geaendert, entfernt):
        assert response.status_code == 409, response.text
        assert fehlercodes(response) == {"device-type-system"}
    # Schluessel oder Betrieb im Koerper: unbekannte Felder werden abgelehnt.
    for feld in ({"key": "socket_mine"}, {"organization_id": str(uuid.uuid4())}):
        assert _anlegen(api, token, **feld).status_code == 422
    assert _katalog(api, token)["socket_single"]["label"] == "Steckdose"


def test_eingabepruefung(api: TestClient, token: str, engine: Engine) -> None:
    vorher = len(_typen_in_db(engine))
    faelle = {
        "distribution": _anlegen(api, token, category="distribution"),
        "symbol": _anlegen(api, token, symbol_key="mein_symbol"),
        # Ein eigener Typ sieht nie wie eine Verteilung aus.
        "verteilersymbol": _anlegen(api, token, symbol_key="distribution_board"),
        "flaeche": _anlegen(api, token, allows_wall_interior=False, allows_ceiling=False),
        "ungerade": _anlegen(api, token, width_mm=121),
        "zu_gross": _anlegen(api, token, height_mm=1_002),
        "leer": _anlegen(api, token, label="   "),
    }
    assert {name: r.status_code for name, r in faelle.items()} == dict.fromkeys(faelle, 422)
    assert fehlercodes(faelle["symbol"]) == {"device-type-symbol-unknown"}
    assert fehlercodes(faelle["verteilersymbol"]) == {"device-type-symbol-unknown"}
    assert fehlercodes(faelle["flaeche"]) == {"device-type-surface-missing"}
    assert fehlercodes(faelle["ungerade"]) == {"device-type-size-invalid"}
    assert fehlercodes(faelle["leer"]) == {"device-type-label-missing"}
    _angelegt(api, token)
    doppelt = _anlegen(api, token, label="herdanschluss")
    assert doppelt.status_code == 422
    assert fehlercodes(doppelt) == {"device-type-label-taken"}
    assert len(_typen_in_db(engine)) == vorher + 1


def test_symbolauswahl_entspricht_der_gemeinsamen_pruefdatei() -> None:
    """Backend und Oberflaeche kennen dieselben Zeichnungen (``testdata/katalog``)."""
    datei = Path(__file__).resolve().parents[3] / "testdata" / "katalog" / "symbole.v1.json"
    daten = json.loads(datei.read_text(encoding="utf-8"))
    assert daten["version"] == 1
    assert list(SYMBOL_KEYS) == daten["symbole"]
    assert {typ.symbol_key for typ in DEVICE_TYPE_CATALOG} <= set(SYMBOL_KEYS)
    assert set(SYMBOL_KEYS) - CUSTOM_SYMBOL_KEYS == {"distribution_board"}


def test_recht_nur_fuer_den_administrator(
    api: TestClient, token: str, betrieb: uuid.UUID, engine: Engine
) -> None:
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        rollen = set(
            session.execute(
                select(Role.key)
                .join(RolePermission, RolePermission.role_id == Role.id)
                .join(Permission, Permission.id == RolePermission.permission_id)
                .where(Permission.key == DEVICE_TYPES_MANAGE, Role.organization_id == betrieb)
            ).scalars()
        )
    finally:
        session.close()
    # Nur der Administrator - nie Planer, Kalkulator oder Monteur.
    assert rollen == {"admin"}
    eigen = _angelegt(api, token)
    raeume._mitglied_mit_permissions(
        engine, betrieb, "planer@typen.example", (PLAN_READ, PLAN_WRITE, CIRCUIT_WRITE)
    )
    planer = login(api, "planer@typen.example")
    assert eigen["key"] in _katalog(api, planer)
    antworten = [
        _anlegen(api, planer, label="Unerlaubt"),
        _aendern(api, planer, eigen, label="Unerlaubt"),
        api.delete(
            f"{BASIS}/device-types/{eigen['key']}",
            headers={**auth_headers(planer), "If-Match": "1"},
        ),
    ]
    assert [r.status_code for r in antworten] == [403, 403, 403]
    assert _katalog(api, token)[eigen["key"]]["label"] == "Herdanschluss"


# ------------------------------------------------------------- Datenbankregeln


def test_datenbank_bindet_praefix_eigentuemer_und_verweise(
    api: TestClient,
    token: str,
    betrieb: uuid.UUID,
    engine: Engine,
    fremd: tuple[uuid.UUID, str],
) -> None:
    eigen = _angelegt(api, token)
    fremd_org, fremd_token = fremd
    # Ein vollstaendiger Bestand im fremden Betrieb: Raum, Wand, Vorlage, Projektvorgabe.
    struktur = raeume._struktur(api, fremd_token, name="Fremdes Projekt")
    raum = geraete._raum_mit_plan(api, fremd_token, struktur["floor"]["id"])
    vorlage = vorgaben._vorlage(api, fremd_token, "NYM 5x2,5", "NYM-J", 5, "2.5")
    projektvorgabe = vorgaben._projekt_setzen(api, fremd_token, struktur["project"]["id"], 0)
    assert projektvorgabe.status_code == 200, projektvorgabe.text

    with engine.connect() as connection:
        projektvorgabe_id = connection.execute(
            text("SELECT id FROM electrical_project_defaults WHERE organization_id = :org"),
            {"org": fremd_org},
        ).scalar_one()

    def ausfuehren(sql: str, **werte: object) -> Exception | None:
        try:
            with engine.begin() as connection:
                connection.execute(text(sql), werte)
        except (IntegrityError, InternalError) as exc:
            return exc
        return None

    # Praefix und Eigentuemer gehoeren zusammen; Verteilung nie als eigener Typ.
    zeile = (
        "INSERT INTO electrical_device_types (key, organization_id, label, category, symbol_key, "
        "allows_wall_interior, allows_wall_exterior, allows_ceiling, width_mm, height_mm, "
        "sort_order) VALUES (:key, :org, 'X', :cat, 'socket_single', true, false, false, 80, 80, 0)"
    )
    for key, org, cat, regel in (
        ("c_" + "a" * 32, None, "socket", "key_scope"),
        ("socket_mine", betrieb, "socket", "key_scope"),
        ("c_" + "b" * 32, betrieb, "distribution", "custom_not_distribution"),
    ):
        fehler = ausfuehren(zeile, key=key, org=org, cat=cat)
        assert fehler is not None and regel in str(fehler), (key, fehler)
    # Schluessel und Eigentuemer sind unveraenderlich (auch unbenutzt).
    for sql in (
        "UPDATE electrical_device_types SET organization_id = :org WHERE key = :key",
        "UPDATE electrical_device_types SET key = 'c_' || repeat('c', 32) WHERE key = :key",
    ):
        fehler = ausfuehren(sql, org=fremd_org, key=eigen["key"])
        assert fehler is not None and "unveraenderlich" in str(fehler)

    # Fremdschluessel: Alle anderen Bezuege gehoeren dem fremden Betrieb - nur der Typ nicht.
    geraet = ausfuehren(
        "INSERT INTO electrical_devices (id, organization_id, room_id, device_type_key, "
        "mounting_surface, wall_id, center_offset_mm, center_height_mm) VALUES (:id, :org, :raum, "
        ":key, 'wall_interior', :wand, 3000, 600)",
        id=uuid.uuid4(),
        org=fremd_org,
        raum=raum["id"],
        key=eigen["key"],
        wand=raum["walls"][0]["id"],
    )
    assert geraet is not None and "fk_el_devices_device_type_scope" in str(geraet)
    betrieb_vorlage = ausfuehren(
        "INSERT INTO electrical_type_templates (organization_id, device_type_key, "
        "cable_template_id) VALUES (:org, :key, :vorlage)",
        org=fremd_org,
        key=eigen["key"],
        vorlage=vorlage["id"],
    )
    assert betrieb_vorlage is not None and "fk_el_type_templates_type_scope" in str(betrieb_vorlage)
    projekt_vorlage = ausfuehren(
        "INSERT INTO electrical_proj_type_templates (organization_id, project_defaults_id, "
        "device_type_key, cable_template_id) VALUES (:org, :pd, :key, :vorlage)",
        org=fremd_org,
        pd=projektvorgabe_id,
        key=eigen["key"],
        vorlage=vorlage["id"],
    )
    assert projekt_vorlage is not None and "fk_el_proj_type_templates_type_scope" in str(
        projekt_vorlage
    )
    # Gegenprobe: Mit einem Systemtyp gelingt dieselbe Zeile im fremden Betrieb.
    assert (
        ausfuehren(
            "INSERT INTO electrical_type_templates (organization_id, device_type_key, "
            "cable_template_id) VALUES (:org, 'socket_single', :vorlage)",
            org=fremd_org,
            vorlage=vorlage["id"],
        )
        is None
    )


def test_typbindung_im_schema_vorhanden(engine: Engine) -> None:
    """Die Fremdschluessel liegen tatsaechlich auf der berechneten Spalte (Gegenprobe Katalog)."""
    with engine.connect() as connection:
        namen = set(
            connection.execute(
                text(
                    "SELECT conname FROM pg_constraint WHERE contype = 'f' AND conname IN "
                    "('fk_el_devices_device_type_scope', 'fk_el_type_templates_type_scope', "
                    "'fk_el_proj_type_templates_type_scope')"
                )
            ).scalars()
        )
        trigger = connection.execute(
            text("SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_el_device_types_scope_fixed'")
        ).scalar_one()
    assert len(namen) == 3
    assert trigger == 1


# --------------------------------------------------- Verwendung und Bestandsschutz


def test_verwendeter_typ_sperrt_kategorie_und_mass_aber_nicht_bezeichnungen(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor = geschoss["floor"]["id"]
    eigen = _angelegt(api, token, allows_ceiling=True)
    raum = _raum_mit_geraet(api, token, floor, eigen["key"])
    geraet_vorher = raum["devices"][0]
    eigen = _katalog(api, token)[eigen["key"]]
    assert eigen["device_count"] == 1

    gesperrt = [
        _aendern(api, token, eigen, category="socket"),
        _aendern(api, token, eigen, width_mm=200),
        _aendern(api, token, eigen, height_mm=200),
    ]
    for response in gesperrt:
        assert response.status_code == 409, response.text
        assert fehlercodes(response) == {"device-type-in-use"}
    flaeche = _aendern(api, token, eigen, allows_wall_interior=False)
    assert flaeche.status_code == 409
    assert fehlercodes(flaeche) == {"device-type-surface-in-use"}

    frei = _aendern(
        api,
        token,
        eigen,
        label="Herd 400 V",
        symbol_key="socket_single",
        default_center_height_mm=700,
        allows_ceiling=False,
    )
    assert frei.status_code == 200, frei.text
    assert frei.json()["version"] == eigen["version"] + 1
    # Das Geraet bleibt, wo und was es war.
    geraet_nachher = geraete._plan_raum(api, token, floor, raum["id"])["devices"][0]
    assert geraet_nachher == geraet_vorher


def test_versionskonflikt_und_vorbedingung(api: TestClient, token: str) -> None:
    eigen = _angelegt(api, token)
    assert _aendern(api, token, eigen, label="Erste Aenderung").status_code == 200
    veraltet = _aendern(api, token, eigen, label="Zweite Aenderung")
    assert veraltet.status_code == 409
    assert veraltet.json()["type"].endswith("version-conflict")
    ohne = api.patch(
        f"{BASIS}/device-types/{eigen['key']}", headers=auth_headers(token), json={"label": "X"}
    )
    assert ohne.status_code == 428


def test_entfernen_nur_ohne_verweise(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor = geschoss["floor"]["id"]
    mit_geraet = _angelegt(api, token, label="Mit Geraet")
    _raum_mit_geraet(api, token, floor, mit_geraet["key"])
    mit_vorlage = _angelegt(api, token, label="Mit Vorlage")
    vorlage = vorgaben._vorlage(api, token, "NYM 5x2,5", "NYM-J", 5, "2.5")
    stand = api.get(f"{BASIS}/planning-defaults", headers=auth_headers(token)).json()
    gesetzt = vorgaben._betrieb_setzen(
        api,
        token,
        stand["version"],
        device_type_templates=[
            {"device_type_key": mit_vorlage["key"], "cable_template_id": vorlage["id"]}
        ],
    )
    assert gesetzt.status_code == 200, gesetzt.text
    frei = _angelegt(api, token, label="Ungenutzt")

    for typ in (mit_geraet, mit_vorlage):
        aktuell = _katalog(api, token)[typ["key"]]
        response = api.delete(
            f"{BASIS}/device-types/{typ['key']}",
            headers={**auth_headers(token), "If-Match": str(aktuell["version"])},
        )
        assert response.status_code == 409, response.text
        assert fehlercodes(response) == {"device-type-in-use"}
        assert "Deaktivieren" in response.json()["detail"]
    weg = api.delete(
        f"{BASIS}/device-types/{frei['key']}", headers={**auth_headers(token), "If-Match": "1"}
    )
    assert weg.status_code == 204
    katalog = _katalog(api, token)
    assert frei["key"] not in katalog
    assert {mit_geraet["key"], mit_vorlage["key"]} <= set(katalog)


def test_deaktivierter_typ_bleibt_am_bestand_und_wird_nicht_neu_platziert(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor = geschoss["floor"]["id"]
    eigen = _angelegt(api, token)
    raum = _raum_mit_geraet(api, token, floor, eigen["key"])
    eigen = _katalog(api, token)[eigen["key"]]
    assert _aendern(api, token, eigen, is_active=False).status_code == 200

    unveraendert = geraete._speichern(api, token, raum, devices=geraete._geraete(raum))
    assert unveraendert.status_code == 200, unveraendert.text
    raum = geraete._plan_raum(api, token, floor, raum["id"])
    neu = geraete._speichern(
        api,
        token,
        raum,
        devices=[
            *geraete._geraete(raum),
            geraete._wandgeraet(raum["walls"][0]["id"], 3_500, 600, typ=eigen["key"]),
        ],
    )
    assert neu.status_code == 422
    assert fehlercodes(neu) == {"device-type-inactive"}
    assert len(geraete._plan_raum(api, token, floor, raum["id"])["devices"]) == 1


def test_fremder_typ_im_raumentwurf_und_in_vorgaben_ist_unbekannt(
    api: TestClient, token: str, fremd: tuple[uuid.UUID, str]
) -> None:
    eigen = _angelegt(api, token)
    _, fremd_token = fremd
    fremd_struktur = raeume._struktur(api, fremd_token, name="Fremdes Projekt")
    raum = geraete._raum_mit_plan(api, fremd_token, fremd_struktur["floor"]["id"])
    response = geraete._speichern(
        api,
        fremd_token,
        raum,
        devices=[geraete._wandgeraet(raum["walls"][0]["id"], 1_000, 600, typ=eigen["key"])],
    )
    assert response.status_code == 422
    assert fehlercodes(response) == {"device-type-unknown"}
    # Die Meldung nennt den fremden Typ nicht.
    assert "Herdanschluss" not in response.text
    vorlage = vorgaben._vorlage(api, fremd_token, "NYM 3x1,5", "NYM-J", 3, "1.5")
    stand = api.get(f"{BASIS}/planning-defaults", headers=auth_headers(fremd_token)).json()
    vorgabe = vorgaben._betrieb_setzen(
        api,
        fremd_token,
        stand["version"],
        device_type_templates=[
            {"device_type_key": eigen["key"], "cable_template_id": vorlage["id"]}
        ],
    )
    assert vorgabe.status_code == 422
    assert fehlercodes(vorgabe) == {"device-type-unknown"}


# ------------------------------------------------------ Kategorie Geraeteanschluss


def test_geraeteanschluss_zuordenbar_mit_vorlage_und_leitungsendpunkt(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor = geschoss["floor"]["id"]
    haus = geschoss["building"]["id"]
    eigen = _angelegt(api, token)
    raum = geraete._raum_mit_plan(api, token, floor)
    wand = raum["walls"][0]["id"]
    gesetzt = geraete._speichern(
        api,
        token,
        raum,
        devices=[
            geraete._wandgeraet(wand, 3_500, 600, typ=eigen["key"]),
            geraete._wandgeraet(wand, 4_200, 600, typ="device_connection"),
        ],
    )
    assert gesetzt.status_code == 200, gesetzt.text
    raum = geraete._plan_raum(api, token, floor, raum["id"])
    ids = {g["device_type_key"]: g["id"] for g in raum["devices"]}
    uv = kreise._platziert(
        api, token, kreise._angelegte_verteilung(api, token, haus), raum, wand, 1_000, 1_400
    )
    f1 = kreise._angelegter_stromkreis(api, token, uv["id"])
    zuordnung = kreise._zuordnen(api, token, f1, [ids[eigen["key"]], ids["device_connection"]])
    assert zuordnung.status_code == 200, zuordnung.text

    vorlage = vorgaben._vorlage(api, token, "NYM 5x2,5 Herd", "NYM-J", 5, "2.5")
    stand = api.get(f"{BASIS}/planning-defaults", headers=auth_headers(token)).json()
    vorgabe = vorgaben._betrieb_setzen(
        api,
        token,
        stand["version"],
        device_allowance_mm=300,
        device_type_templates=[
            {"device_type_key": eigen["key"], "cable_template_id": vorlage["id"]}
        ],
    )
    assert vorgabe.status_code == 200, vorgabe.text
    wirksam = api.get(
        f"{BASIS}/projects/{geschoss['project']['id']}/planning-defaults/effective",
        headers=auth_headers(token),
        params={
            "circuit_id": f1["id"],
            "start_device_id": uv["placement_device_id"],
            "end_device_id": ids[eigen["key"]],
        },
    )
    assert wirksam.status_code == 200, wirksam.text
    leitung = wirksam.json()["for_cable"]
    assert leitung["spec"]["cable_template_id"] == vorlage["id"]
    assert leitung["spec"]["origin"] == "device_type_template"
    # Endpunkt Geraeteanschluss: Geraetezugabe wie bei jedem Verbraucher.
    assert leitung["allowances"]["end_mm"] == 300


def test_projekt_status_trennt_planung_von_betriebsweiter_typverwaltung(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    eigen = _angelegt(api, token)
    raum = geraete._raum_mit_plan(api, token, geschoss["floor"]["id"])
    projekt = geschoss["project"]
    for schritt in ("activate", "complete", "archive"):
        aktuell = api.get(f"/api/v1/projects/{projekt['id']}", headers=auth_headers(token)).json()
        assert (
            api.post(
                f"/api/v1/projects/{projekt['id']}/{schritt}",
                headers={**auth_headers(token), "If-Match": str(aktuell["version"])},
            ).status_code
            == 200
        )
    platziert = geraete._speichern(
        api,
        token,
        raum,
        devices=[geraete._wandgeraet(raum["walls"][0]["id"], 1_000, 600, typ=eigen["key"])],
    )
    assert platziert.status_code == 409
    assert platziert.json()["type"].endswith("project-archived")
    # Betriebsweite Verwaltung bleibt moeglich - der Typ ist unbenutzt.
    assert _aendern(api, token, eigen, width_mm=140).status_code == 200


# ------------------------------------------------------------- Nebenlaeufigkeit


def _warten_auf_wartende(engine: Engine) -> None:
    """Bis eine andere Sitzung auf eine Zeilensperre wartet (hoechstens 10 s)."""
    ende = time.monotonic() + 10
    while time.monotonic() < ende:
        with engine.connect() as connection:
            wartend = connection.execute(
                text("SELECT count(*) FROM pg_locks WHERE NOT granted")
            ).scalar_one()
        if wartend:
            return
        time.sleep(0.05)
    pytest.fail("Keine wartende Sitzung - die Sperre wird nicht genommen.")


def test_typaenderung_wartet_auf_laufende_erste_verwendung(
    api: TestClient, token: str, betrieb: uuid.UUID, engine: Engine, geschoss: dict[str, Any]
) -> None:
    """Erste Verwendung haelt die Typzeile (FOR KEY SHARE + Fremdschluessel) - die Aenderung
    wartet und sieht danach die Verwendung: Mass gesperrt, das Geraet bleibt unveraendert."""
    eigen = _angelegt(api, token)
    raum = geraete._raum_mit_plan(api, token, geschoss["floor"]["id"])
    ergebnis: dict[str, Any] = {}
    with engine.connect() as connection, connection.begin():
        connection.execute(
            text("SELECT key FROM electrical_device_types WHERE key = :key FOR KEY SHARE"),
            {"key": eigen["key"]},
        )
        connection.execute(
            text(
                "INSERT INTO electrical_devices (id, organization_id, room_id, device_type_key, "
                "mounting_surface, wall_id, center_offset_mm, center_height_mm) VALUES "
                "(:id, :org, :raum, :key, 'wall_interior', :wand, 1000, 600)"
            ),
            {
                "id": uuid.uuid4(),
                "org": betrieb,
                "raum": raum["id"],
                "key": eigen["key"],
                "wand": raum["walls"][0]["id"],
            },
        )
        faden = threading.Thread(
            target=lambda: ergebnis.setdefault("antwort", _aendern(api, token, eigen, width_mm=400))
        )
        faden.start()
        _warten_auf_wartende(engine)
    faden.join(timeout=20)
    antwort = ergebnis["antwort"]
    assert antwort.status_code == 409, antwort.text
    assert fehlercodes(antwort) == {"device-type-in-use"}
    assert _katalog(api, token)[eigen["key"]]["width_mm"] == 120


def test_erste_verwendung_wartet_auf_laufende_typaenderung_und_prueft_den_neuen_stand(
    api: TestClient, token: str, engine: Engine, geschoss: dict[str, Any]
) -> None:
    """Die Typaenderung haelt die Zeile FOR UPDATE - der Raumentwurf wartet, liest danach das
    neue Planungsmass und prueft dagegen (hier: zu breit fuer die Stelle - nichts gespeichert)."""
    eigen = _angelegt(api, token)
    raum = geraete._raum_mit_plan(api, token, geschoss["floor"]["id"])
    ergebnis: dict[str, Any] = {}
    with engine.connect() as connection, connection.begin():
        connection.execute(
            text("SELECT key FROM electrical_device_types WHERE key = :key FOR UPDATE"),
            {"key": eigen["key"]},
        )
        connection.execute(
            text(
                "UPDATE electrical_device_types SET width_mm = 1000, version = version + 1 "
                "WHERE key = :key"
            ),
            {"key": eigen["key"]},
        )
        faden = threading.Thread(
            target=lambda: ergebnis.setdefault(
                "antwort",
                geraete._speichern(
                    api,
                    token,
                    raum,
                    devices=[
                        geraete._wandgeraet(raum["walls"][0]["id"], 200, 600, typ=eigen["key"])
                    ],
                ),
            )
        )
        faden.start()
        _warten_auf_wartende(engine)
    faden.join(timeout=20)
    antwort = ergebnis["antwort"]
    assert antwort.status_code == 422, antwort.text
    assert "device-outside-wall" in fehlercodes(antwort)
    assert geraete._plan_raum(api, token, geschoss["floor"]["id"], raum["id"])["devices"] == []


def test_typaenderung_wartet_auf_laufende_vorlagenzuordnung(
    api: TestClient, token: str, betrieb: uuid.UUID, engine: Engine
) -> None:
    eigen = _angelegt(api, token)
    vorlage = vorgaben._vorlage(api, token, "NYM 5x2,5", "NYM-J", 5, "2.5")
    ergebnis: dict[str, Any] = {}
    with engine.connect() as connection, connection.begin():
        connection.execute(
            text(
                "INSERT INTO electrical_type_templates (organization_id, device_type_key, "
                "cable_template_id) VALUES (:org, :key, :vorlage)"
            ),
            {"org": betrieb, "key": eigen["key"], "vorlage": vorlage["id"]},
        )
        faden = threading.Thread(
            target=lambda: ergebnis.setdefault(
                "antwort", _aendern(api, token, eigen, category="socket")
            )
        )
        faden.start()
        _warten_auf_wartende(engine)
    faden.join(timeout=20)
    antwort = ergebnis["antwort"]
    assert antwort.status_code == 409, antwort.text
    assert fehlercodes(antwort) == {"device-type-in-use"}
