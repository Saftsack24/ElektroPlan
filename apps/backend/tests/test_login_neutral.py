"""Neutrale Ablehnung der oeffentlichen Anmeldung (ADR 0021, Nachkorrektur).

Jeder abgelehnte Anmeldeversuch antwortet gleich - ``401``, derselbe Problemtyp,
dieselbe neutrale Meldung, kein Token, kein Cookie -, egal ob die Adresse
unbekannt, das Passwort falsch, das Konto deaktiviert, die Mitgliedschaft
gesperrt, entfernt oder gar nicht vorhanden ist oder der gewaehlte Betrieb keine
aktive Mitgliedschaft hat. Sonst verriete die Antwort, dass ein Passwort
stimmte. Jeder solche Versuch zaehlt fuer die Begrenzung je Konto und IP.

Benoetigt PostgreSQL. Ausschliesslich synthetische Personen unter ``.example``.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Iterator

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select, update

from app.config import get_settings
from app.core.audit.models import AuditEntry
from app.core.auth.security import hash_password
from app.core.auth.service import LOGIN_REJECTED, _login_limiter
from app.core.module_registry.registry import ModuleRegistry
from app.core.organizations.models import OrganizationMember
from app.core.seed import seed_initial_data
from app.core.users.models import User
from tests.conftest import ADMIN_PASSWORD, auth_headers, login, requires_database
from tests.verwaltung_hilfen import Person, fabrik, person_anlegen

pytestmark = [requires_database, pytest.mark.database]

ADMIN = "admin@test.example"
FALSCH = "voellig-falsches-passwort-1"
NEUTRAL = "Anmeldung nicht möglich. Bitte Zugangsdaten prüfen oder die Administration kontaktieren."


@pytest.fixture(autouse=True)
def _limiter_zuruecksetzen() -> Iterator[None]:
    _login_limiter.clear()
    yield
    _login_limiter.clear()


@pytest.fixture
def betrieb(api: TestClient, seeded_organization: dict[str, uuid.UUID]) -> uuid.UUID:
    return seeded_organization["organization_id"]


def _zweiter_betrieb(engine: Engine, registry: ModuleRegistry) -> uuid.UUID:
    session = fabrik(engine)()
    try:
        result = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Nebenan GmbH",
            admin_email="admin@nebenan.example",
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
        return result.organization_id
    finally:
        session.close()


def _anmelden(
    client: TestClient,
    email: str,
    passwort: str = ADMIN_PASSWORD,
    organization_id: uuid.UUID | None = None,
) -> httpx.Response:
    koerper: dict[str, str] = {"email": email, "password": passwort}
    if organization_id is not None:
        koerper["organization_id"] = str(organization_id)
    return client.post("/api/v1/auth/login", json=koerper)


def _status_setzen(engine: Engine, member_id: uuid.UUID, status: str) -> None:
    session = fabrik(engine)()
    try:
        session.execute(
            update(OrganizationMember)
            .where(OrganizationMember.id == member_id)
            .values(status=status, session_version=OrganizationMember.session_version + 1)
        )
        session.commit()
    finally:
        session.close()


def _konto_deaktivieren(engine: Engine, user_id: uuid.UUID) -> None:
    session = fabrik(engine)()
    try:
        session.execute(update(User).where(User.id == user_id).values(is_active=False))
        session.commit()
    finally:
        session.close()


def _ohne_mitgliedschaft(engine: Engine, email: str) -> uuid.UUID:
    session = fabrik(engine)()
    try:
        user = User(email=email, password_hash=hash_password(ADMIN_PASSWORD), full_name="Ohne")
        session.add(user)
        session.commit()
        return user.id
    finally:
        session.close()


def _neutral(response: httpx.Response) -> dict[str, object]:
    """Die eine Ablehnung - und nichts, was eine Sitzung ermoeglicht."""
    assert response.status_code == 401, response.text
    body = response.json()
    assert body["type"].endswith("/authentication-failed")
    assert body["title"] == "Nicht angemeldet"
    assert body["detail"] == NEUTRAL == LOGIN_REJECTED
    assert "access_token" not in body
    assert "elektroplan_refresh" not in response.headers.get("set-cookie", "")
    # Keine zustandsbezogenen Zusatzfelder; der Rest ist anfragebezogen.
    return {k: v for k, v in body.items() if k not in {"instance", "request_id"}}


def _protokoll(engine: Engine) -> list[AuditEntry]:
    session = fabrik(engine)()
    try:
        return list(session.execute(select(AuditEntry)).scalars())
    finally:
        session.close()


# ------------------------------------------------------- sieben gleiche Antworten


def test_jede_ablehnung_ist_identisch(
    api: TestClient,
    engine: Engine,
    registry: ModuleRegistry,
    betrieb: uuid.UUID,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    fremd = _zweiter_betrieb(engine, registry)
    deaktiviert = person_anlegen(engine, betrieb, "inaktiv@test.example", ["planer"])
    _konto_deaktivieren(engine, deaktiviert.user_id)
    gesperrt = person_anlegen(engine, betrieb, "gesperrt@test.example", ["planer"])
    _status_setzen(engine, gesperrt.member_id, "disabled")
    entfernt = person_anlegen(engine, betrieb, "entfernt@test.example", ["planer"])
    _status_setzen(engine, entfernt.member_id, "removed")
    _ohne_mitgliedschaft(engine, "ohne@test.example")
    aktiv = person_anlegen(engine, betrieb, "aktiv@test.example", ["planer"])

    faelle = {
        "unbekannt": _anmelden(api, "niemand@test.example"),
        "falsches_passwort": _anmelden(api, aktiv.email, FALSCH),
        "konto_deaktiviert": _anmelden(api, deaktiviert.email),
        "gesperrt": _anmelden(api, gesperrt.email),
        "entfernt": _anmelden(api, entfernt.email),
        "ohne_mitgliedschaft": _anmelden(api, "ohne@test.example"),
        "fremder_betrieb_gewaehlt": _anmelden(api, aktiv.email, organization_id=fremd),
    }
    antworten = {name: _neutral(response) for name, response in faelle.items()}
    erste = next(iter(antworten.values()))
    assert all(antwort == erste for antwort in antworten.values()), antworten

    # Kein Konto, keine E-Mail-Adresse in Protokoll oder Log.
    eintraege = _protokoll(engine)
    fehlversuche = [e for e in eintraege if e.action == "auth.login_failed"]
    assert fehlversuche
    for eintrag in fehlversuche:
        assert eintrag.summary == "Fehlgeschlagene Anmeldung"
        assert eintrag.entity_type == "user"
        assert eintrag.actor_user_id == eintrag.entity_id
    text = " ".join(f"{e.action} {e.summary} {e.data}" for e in eintraege)
    for person in ("niemand@", "aktiv@", "inaktiv@", "gesperrt@", "entfernt@", "ohne@"):
        assert person not in text
        assert person not in caplog.text


def test_gesperrte_mitgliedschaft_wird_protokolliert_nur_mit_konto_id(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    gesperrt = person_anlegen(engine, betrieb, "nur-id@test.example", ["planer"])
    _status_setzen(engine, gesperrt.member_id, "disabled")
    _neutral(_anmelden(api, gesperrt.email))

    eintraege = [e for e in _protokoll(engine) if e.action == "auth.login_failed"]
    assert len(eintraege) == 1
    assert eintraege[0].entity_id == gesperrt.user_id
    assert eintraege[0].actor_user_id == gesperrt.user_id
    assert "nur-id" not in f"{eintraege[0].summary} {eintraege[0].data}"


# ---------------------------------------------------------------- Begrenzung


def test_gesperrtes_konto_mit_richtigem_passwort_erreicht_dieselbe_begrenzung(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    """Kein unbegrenztes Pruefen, ob ein Passwort fuer ein gesperrtes Konto stimmt."""
    grenze = get_settings().login_attempts_per_window
    gesperrt = person_anlegen(engine, betrieb, "probe@test.example", ["planer"])
    _status_setzen(engine, gesperrt.member_id, "disabled")
    for _ in range(grenze):
        _neutral(_anmelden(api, gesperrt.email))
    gesperrt_429 = _anmelden(api, gesperrt.email)

    _login_limiter.clear()
    vergleich = person_anlegen(engine, betrieb, "vergleich@test.example", ["planer"])
    for _ in range(grenze):
        _neutral(_anmelden(api, vergleich.email, FALSCH))
    falsch_429 = _anmelden(api, vergleich.email, FALSCH)

    assert gesperrt_429.status_code == falsch_429.status_code == 429
    assert gesperrt_429.json()["type"] == falsch_429.json()["type"]
    assert gesperrt_429.json()["detail"] == falsch_429.json()["detail"]


def test_begrenzung_zaehlt_auch_je_ip(api: TestClient, engine: Engine, betrieb: uuid.UUID) -> None:
    """Wechselnde gesperrte Konten umgehen die Begrenzung je IP nicht."""
    grenze = get_settings().login_attempts_per_window
    personen = [
        person_anlegen(engine, betrieb, f"ip{nummer}@test.example", ["planer"])
        for nummer in range(grenze)
    ]
    for person in personen:
        _status_setzen(engine, person.member_id, "disabled")
        _neutral(_anmelden(api, person.email))
    assert _anmelden(api, ADMIN).status_code == 429


# --------------------------------------------------------- Entsperren, Sitzungen


def test_nach_dem_entsperren_gelingt_die_anmeldung_alte_sitzungen_bleiben_ungueltig(
    app: FastAPI, api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "zurueck@test.example", ["planer"])
    with TestClient(app, raise_server_exceptions=False) as zweiter:
        alt = auth_headers(login(zweiter, person.email))
        admin = auth_headers(login(api, ADMIN))

        version = api.get(f"/api/v1/members/{person.member_id}", headers=admin).json()["version"]
        gesperrt = api.post(
            f"/api/v1/members/{person.member_id}/suspend",
            headers={**admin, "If-Match": str(version)},
            json={},
        )
        assert gesperrt.status_code == 200, gesperrt.text
        _neutral(_anmelden(api, person.email))

        version = api.get(f"/api/v1/members/{person.member_id}", headers=admin).json()["version"]
        entsperrt = api.post(
            f"/api/v1/members/{person.member_id}/reactivate",
            headers={**admin, "If-Match": str(version)},
        )
        assert entsperrt.status_code == 200, entsperrt.text

        neu = _anmelden(api, person.email)
        assert neu.status_code == 200, neu.text
        assert neu.json()["access_token"]
        assert zweiter.get("/api/v1/me", headers=alt).status_code == 401
        assert zweiter.post("/api/v1/auth/refresh").status_code == 401


# ------------------------------------------------------------ mehrere Betriebe


def _konto_in_zwei_betrieben(
    engine: Engine, registry: ModuleRegistry, betrieb: uuid.UUID
) -> tuple[Person, Person, uuid.UUID]:
    fremd = _zweiter_betrieb(engine, registry)
    in_a = person_anlegen(engine, betrieb, "doppelt@test.example", ["planer"])
    in_b = person_anlegen(engine, fremd, "doppelt@test.example", ["planer"])
    return in_a, in_b, fremd


def test_aktiv_in_a_gesperrt_in_b(
    api: TestClient, engine: Engine, registry: ModuleRegistry, betrieb: uuid.UUID
) -> None:
    in_a, in_b, fremd = _konto_in_zwei_betrieben(engine, registry, betrieb)
    _status_setzen(engine, in_b.member_id, "disabled")

    # Ohne Wahl: die einzige aktive Mitgliedschaft wird genommen.
    ohne_wahl = _anmelden(api, in_a.email)
    assert ohne_wahl.status_code == 200, ohne_wahl.text
    assert ohne_wahl.json()["organization_id"] == str(betrieb)
    # A gewaehlt: gelingt.
    assert _anmelden(api, in_a.email, organization_id=betrieb).status_code == 200
    # B gewaehlt: dieselbe neutrale Ablehnung wie ein falsches Passwort.
    gewaehlt_b = _neutral(_anmelden(api, in_a.email, organization_id=fremd))
    assert gewaehlt_b == _neutral(_anmelden(api, in_a.email, FALSCH, organization_id=betrieb))


def test_mehrere_aktive_betriebe_verlangen_weiter_eine_auswahl(
    api: TestClient, engine: Engine, registry: ModuleRegistry, betrieb: uuid.UUID
) -> None:
    in_a, _, fremd = _konto_in_zwei_betrieben(engine, registry, betrieb)

    auswahl = _anmelden(api, in_a.email)
    assert auswahl.status_code == 409
    assert auswahl.json()["type"].endswith("/organization-selection-required")
    assert "access_token" not in auswahl.json()
    gewaehlt = _anmelden(api, in_a.email, organization_id=fremd)
    assert gewaehlt.status_code == 200
    assert gewaehlt.json()["organization_id"] == str(fremd)
    # Eine erfolgreiche Auswahl ist kein Fehlversuch.
    assert not [e for e in _protokoll(engine) if e.action == "auth.login_failed"]


# ---------------------------------------------- normale Mandantenendpunkte: 404


def test_geschuetzte_mandantenendpunkte_behalten_404(
    api: TestClient, engine: Engine, registry: ModuleRegistry, betrieb: uuid.UUID
) -> None:
    """Die Korrektur betrifft nur die Anmeldung, nicht die 404-Semantik."""
    fremd = _zweiter_betrieb(engine, registry)
    admin = auth_headers(login(api, ADMIN))
    wechsel = api.post(
        "/api/v1/auth/switch-organization",
        json={"organization_id": str(fremd)},
        headers=admin,
    )
    assert wechsel.status_code == 404
    fremdes_mitglied = api.get(f"/api/v1/members/{uuid.uuid4()}", headers=admin)
    assert fremdes_mitglied.status_code == 404
