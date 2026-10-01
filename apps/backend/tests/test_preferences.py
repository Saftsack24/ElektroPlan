"""Persoenliche Einstellungen auf dem Server (Phase 4e, ADR 0021).

Lesen, erstmalig anlegen, versioniert aendern; gueltige und unbekannte Werte
(``mm``, ``cm``, ``m``); je Mitgliedschaft getrennt - fremde Einstellungen
sind nicht adressierbar; die Datenbank selbst laesst nur bekannte Werte und
hoechstens einen Datensatz je Mitgliedschaft zu.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.exc import IntegrityError

from app.core.auth.service import _login_limiter
from app.core.module_registry.registry import ModuleRegistry
from app.core.preferences.models import UserPreferences
from app.core.seed import seed_initial_data
from tests.conftest import ADMIN_PASSWORD, auth_headers, login, requires_database
from tests.verwaltung_hilfen import fabrik, person_anlegen

pytestmark = [requires_database, pytest.mark.database]

ADMIN = "admin@test.example"
PFAD = "/api/v1/me/preferences"
DUNKEL_METER = {"theme_mode": "dark", "accent": "teal", "length_unit": "m"}


@pytest.fixture(autouse=True)
def _limiter_zuruecksetzen() -> Iterator[None]:
    _login_limiter.clear()
    yield
    _login_limiter.clear()


@pytest.fixture
def betrieb(api: TestClient, seeded_organization: dict[str, uuid.UUID]) -> uuid.UUID:
    return seeded_organization["organization_id"]


def _kopf(api: TestClient, email: str, organization_id: uuid.UUID | None = None) -> dict[str, str]:
    return auth_headers(login(api, email, organization_id=organization_id))


def test_ohne_serverstand_kommen_die_standardwerte(api: TestClient, betrieb: uuid.UUID) -> None:
    response = api.get(PFAD, headers=_kopf(api, ADMIN))
    assert response.status_code == 200
    assert response.json() == {
        "stored": False,
        "theme_mode": "system",
        "accent": "blue",
        "length_unit": "cm",
        "version": 0,
    }


def test_anlegen_genau_einmal_dann_der_serverstand(api: TestClient, betrieb: uuid.UUID) -> None:
    headers = _kopf(api, ADMIN)
    angelegt = api.post(PFAD, headers=headers, json=DUNKEL_METER)
    assert angelegt.status_code == 201
    assert angelegt.json() == {"stored": True, **DUNKEL_METER, "version": 1}
    zweites = api.post(
        PFAD, headers=headers, json={"theme_mode": "light", "accent": "blue", "length_unit": "mm"}
    )
    assert zweites.status_code == 409
    assert zweites.json()["type"].endswith("/preferences-exist")
    # Der lokale Altbestand ueberschreibt den vorhandenen Serverstand nicht.
    assert api.get(PFAD, headers=headers).json() == {"stored": True, **DUNKEL_METER, "version": 1}


def test_aendern_nur_mit_aktueller_version(api: TestClient, betrieb: uuid.UUID) -> None:
    headers = _kopf(api, ADMIN)
    neu = {"theme_mode": "light", "accent": "orange", "length_unit": "mm"}
    assert api.put(PFAD, headers={**headers, "If-Match": "1"}, json=neu).status_code == 404
    api.post(PFAD, headers=headers, json=DUNKEL_METER)
    assert api.put(PFAD, headers=headers, json=neu).status_code == 428
    geaendert = api.put(PFAD, headers={**headers, "If-Match": "1"}, json=neu)
    assert geaendert.status_code == 200
    assert geaendert.json() == {"stored": True, **neu, "version": 2}
    veraltet = api.put(PFAD, headers={**headers, "If-Match": "1"}, json=DUNKEL_METER)
    assert veraltet.status_code == 409
    assert veraltet.json()["type"].endswith("/version-conflict")
    assert api.get(PFAD, headers=headers).json()["accent"] == "orange"


@pytest.mark.parametrize("einheit", ["mm", "cm", "m"])
def test_alle_drei_masseinheiten(api: TestClient, betrieb: uuid.UUID, einheit: str) -> None:
    headers = _kopf(api, ADMIN)
    response = api.post(
        PFAD,
        headers=headers,
        json={"theme_mode": "system", "accent": "blue", "length_unit": einheit},
    )
    assert response.status_code == 201
    assert api.get(PFAD, headers=headers).json()["length_unit"] == einheit


@pytest.mark.parametrize(
    "koerper",
    [
        {"theme_mode": "sepia", "accent": "blue", "length_unit": "cm"},
        {"theme_mode": "dark", "accent": "#ff00ff", "length_unit": "cm"},
        {"theme_mode": "dark", "accent": "blue", "length_unit": "km"},
        {"theme_mode": "dark", "accent": "blue", "length_unit": "M"},
        {"theme_mode": "dark", "accent": "blue"},
        {**DUNKEL_METER, "member_id": str(uuid.uuid4())},
        {**DUNKEL_METER, "organization_id": str(uuid.uuid4())},
    ],
)
def test_unbekannte_oder_beschaedigte_werte_werden_abgelehnt(
    api: TestClient, betrieb: uuid.UUID, koerper: dict[str, str]
) -> None:
    headers = _kopf(api, ADMIN)
    assert api.post(PFAD, headers=headers, json=koerper).status_code == 422
    assert api.get(PFAD, headers=headers).json()["stored"] is False


def test_jede_person_sieht_nur_ihre_eigenen_einstellungen(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    monteur = person_anlegen(engine, betrieb, "monti@test.example", ["monteur"])
    admin = _kopf(api, ADMIN)
    api.post(PFAD, headers=admin, json=DUNKEL_METER)
    eigene = _kopf(api, monteur.email)
    assert api.get(PFAD, headers=eigene).json()["stored"] is False
    # Auch die schwaechste Rolle darf ihre eigenen Einstellungen speichern.
    assert (
        api.post(
            PFAD,
            headers=eigene,
            json={"theme_mode": "light", "accent": "green", "length_unit": "mm"},
        ).status_code
        == 201
    )
    assert api.get(PFAD, headers=admin).json()["accent"] == "teal"
    assert api.get(PFAD, headers=eigene).json()["accent"] == "green"


def test_einstellungen_sind_je_betrieb_getrennt(
    api: TestClient, engine: Engine, registry: ModuleRegistry, betrieb: uuid.UUID
) -> None:
    session = fabrik(engine)()
    try:
        anderer = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Andere GmbH",
            admin_email="admin@andere.example",
            admin_password=ADMIN_PASSWORD,
        ).organization_id
        session.commit()
    finally:
        session.close()
    person_anlegen(engine, betrieb, "zwei@test.example", ["planer"])
    person_anlegen(engine, anderer, "zwei@test.example", ["planer"])
    hier = _kopf(api, "zwei@test.example", betrieb)
    dort = _kopf(api, "zwei@test.example", anderer)
    api.post(PFAD, headers=hier, json=DUNKEL_METER)
    assert api.get(PFAD, headers=dort).json()["stored"] is False
    session = fabrik(engine)()
    try:
        zeilen = session.execute(select(UserPreferences)).scalars().all()
        assert [(z.organization_id, z.length_unit) for z in zeilen] == [(betrieb, "m")]
    finally:
        session.close()


def test_datenbank_laesst_nur_bekannte_werte_und_einen_datensatz_zu(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "db@test.example", ["planer"])
    for werte in (
        {"theme_mode": "sepia", "accent": "blue", "length_unit": "cm"},
        {"theme_mode": "dark", "accent": "pink", "length_unit": "cm"},
        {"theme_mode": "dark", "accent": "blue", "length_unit": "inch"},
    ):
        session = fabrik(engine)()
        try:
            session.add(
                UserPreferences(organization_id=betrieb, member_id=person.member_id, **werte)
            )
            with pytest.raises(IntegrityError):
                session.flush()
        finally:
            session.rollback()
            session.close()
    session = fabrik(engine)()
    try:
        session.add(
            UserPreferences(organization_id=betrieb, member_id=person.member_id, **DUNKEL_METER)
        )
        session.flush()
        session.add(
            UserPreferences(organization_id=betrieb, member_id=person.member_id, **DUNKEL_METER)
        )
        with pytest.raises(IntegrityError):
            session.flush()
    finally:
        session.rollback()
        session.close()


def test_ohne_anmeldung_kein_zugriff(api: TestClient, betrieb: uuid.UUID) -> None:
    assert api.get(PFAD).status_code == 401
    assert api.post(PFAD, json=DUNKEL_METER).status_code == 401
    assert api.put(PFAD, headers={"If-Match": "1"}, json=DUNKEL_METER).status_code == 401
