"""Anmeldung, Token-Rotation und Autorisierung end-to-end.

Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).

Der Refresh Token steht ausschliesslich im HttpOnly-Cookie. Kein Test liest ihn
aus dem Antwortkoerper - genau das soll ja unmoeglich sein.
"""

from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import sessionmaker

from app.core.auth.dependencies import REFRESH_COOKIE_NAME
from app.core.auth.models import RefreshToken, RefreshTokenRevocationReason
from app.core.auth.security import hash_password, hash_refresh_token
from app.core.authorization.models import Role
from app.core.authorization.service import assign_role
from app.core.module_registry.registry import ModuleRegistry
from app.core.organizations.models import (
    MEMBER_STATUS_DISABLED,
    Organization,
    OrganizationMember,
)
from app.core.seed import seed_initial_data
from app.core.users.models import User
from tests.conftest import ADMIN_PASSWORD, auth_headers, login, requires_database

pytestmark = [requires_database, pytest.mark.database]

ADMIN_EMAIL = "admin@test.example"
MONTEUR_EMAIL = "monteur@test.example"
MONTEUR_PASSWORT = "monteur-passwort-1234"
ALLOWED_ORIGIN = "http://localhost:5173"


@pytest.fixture
def betrieb(engine: Engine, registry: ModuleRegistry, clean_database: None) -> uuid.UUID:
    """Betrieb mit Administrator und Monteur."""
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        result = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Testbetrieb GmbH",
            admin_email=ADMIN_EMAIL,
            admin_password=ADMIN_PASSWORD,
        )
        monteur = User(
            email=MONTEUR_EMAIL,
            password_hash=hash_password(MONTEUR_PASSWORT),
            full_name="Max Monteur",
        )
        session.add(monteur)
        session.flush()
        member = OrganizationMember(organization_id=result.organization_id, user_id=monteur.id)
        session.add(member)
        session.flush()
        monteur_rolle = session.execute(
            select(Role).where(
                Role.organization_id == result.organization_id, Role.key == "monteur"
            )
        ).scalar_one()
        assign_role(
            session,
            organization_id=result.organization_id,
            member_id=member.id,
            role_id=monteur_rolle.id,
        )
        session.commit()
        return result.organization_id
    finally:
        session.close()


def refresh_cookie(client: TestClient) -> str:
    """Liest den Refresh Token aus dem Cookie-Jar des Testclients.

    Das ist serverseitiger Testcode, kein Browser-JavaScript - fuer JavaScript
    bleibt das Cookie unzugaenglich.
    """
    value = client.cookies.get(REFRESH_COOKIE_NAME)
    assert value, "Kein Refresh-Cookie gesetzt"
    return value


# ------------------------------------------------------------------ Anmeldung


def test_anmeldung_liefert_access_token(api: TestClient, betrieb: uuid.UUID) -> None:
    response = api.post(
        "/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["access_token"]
    assert body["organization_id"] == str(betrieb)
    assert body["token_type"] == "bearer"


def test_antwort_enthaelt_keinen_refresh_token(api: TestClient, betrieb: uuid.UUID) -> None:
    """Punkt 3: Der Refresh Token darf fuer JavaScript nicht lesbar sein."""
    response = api.post(
        "/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )

    assert "refresh_token" not in response.json()
    assert "refresh_token" not in response.text


def test_anmeldung_setzt_httponly_cookie(api: TestClient, betrieb: uuid.UUID) -> None:
    response = api.post(
        "/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )
    cookie = response.headers.get("set-cookie", "")

    assert "elektroplan_refresh" in cookie
    assert "HttpOnly" in cookie
    assert "SameSite=strict" in cookie.replace("samesite", "SameSite")
    assert "Path=/api/v1/auth" in cookie


def test_falsches_passwort_wird_abgelehnt(api: TestClient, betrieb: uuid.UUID) -> None:
    response = api.post(
        "/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": "falsch-falsch-1234"}
    )
    assert response.status_code == 401


def test_unbekanntes_konto_gibt_dieselbe_meldung(api: TestClient, betrieb: uuid.UUID) -> None:
    """Die Existenz eines Kontos darf nicht ableitbar sein."""
    unbekannt = api.post(
        "/api/v1/auth/login", json={"email": "niemand@test.example", "password": "egal-egal-1234"}
    )
    falsch = api.post(
        "/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": "falsch-falsch-1234"}
    )
    assert unbekannt.status_code == falsch.status_code == 401
    assert unbekannt.json()["title"] == falsch.json()["title"]


def test_email_ist_nicht_case_sensitiv(api: TestClient, betrieb: uuid.UUID) -> None:
    response = api.post(
        "/api/v1/auth/login",
        json={"email": ADMIN_EMAIL.upper(), "password": ADMIN_PASSWORD},
    )
    assert response.status_code == 200


# ----------------------------------------------------------------------- /me


def test_me_liefert_rollen_und_berechtigungen(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)

    body = api.get("/api/v1/me", headers=auth_headers(token)).json()

    assert body["email"] == ADMIN_EMAIL
    assert body["organization"]["id"] == str(betrieb)
    assert {rolle["key"] for rolle in body["roles"]} == {"admin"}
    assert "audit.entry.read" in body["permissions"]


def test_me_ohne_token_ist_401(api: TestClient, betrieb: uuid.UUID) -> None:
    assert api.get("/api/v1/me").status_code == 401


def test_aktive_module_werden_geliefert(api: TestClient, betrieb: uuid.UUID) -> None:
    """Alle registrierten Module - seit Phase 3 auch die Elektroplanung.

    Der Seed aktiviert jedes registrierte Modul fuer den Betrieb
    (docs/modules.md, Abschnitt 7). Kommt ein Modul hinzu, gehoert es hierher.
    """
    token = login(api, ADMIN_EMAIL)
    module = api.get("/api/v1/me/modules", headers=auth_headers(token)).json()
    assert {eintrag["id"] for eintrag in module} == {"core", "electrical"}
    assert all(eintrag["enabled"] for eintrag in module)


# ------------------------------------------------------------- Autorisierung


def test_monteur_darf_das_protokoll_nicht_lesen(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, MONTEUR_EMAIL, MONTEUR_PASSWORT)

    response = api.get("/api/v1/audit", headers=auth_headers(token))

    assert response.status_code == 403
    assert response.json()["type"].endswith("/permission-denied")


def test_admin_darf_das_protokoll_lesen(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    assert api.get("/api/v1/audit", headers=auth_headers(token)).status_code == 200


def test_monteur_darf_nicht_hochladen(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, MONTEUR_EMAIL, MONTEUR_PASSWORT)
    response = api.post(
        "/api/v1/files",
        headers=auth_headers(token),
        files={"upload": ("test.pdf", b"%PDF-1.7 test", "application/pdf")},
    )
    assert response.status_code == 403


# ------------------------------------------------------------ Token-Rotation


def test_refresh_nutzt_das_cookie(api: TestClient, betrieb: uuid.UUID) -> None:
    api.post("/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    vorher = refresh_cookie(api)

    erneuert = api.post("/api/v1/auth/refresh")

    assert erneuert.status_code == 200
    assert erneuert.json()["access_token"]
    assert "refresh_token" not in erneuert.json()
    assert refresh_cookie(api) != vorher


def test_refresh_ohne_cookie_ist_401(api: TestClient, betrieb: uuid.UUID) -> None:
    assert api.post("/api/v1/auth/refresh").status_code == 401


def test_wiederverwendung_beendet_die_familie(api: TestClient, betrieb: uuid.UUID) -> None:
    """Echte Wiederverwendung: Der alte Token ist laenger als das Toleranzfenster ersetzt."""
    api.post("/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    alt = refresh_cookie(api)

    assert api.post("/api/v1/auth/refresh").status_code == 200
    neu = refresh_cookie(api)
    assert neu != alt

    # Toleranzfenster fuer parallele Anfragen ausschalten und den alten Token
    # erneut vorlegen -> Diebstahlannahme.
    from app.config import get_settings

    settings = get_settings()
    original = settings.refresh_race_grace_seconds
    settings.refresh_race_grace_seconds = 0
    try:
        wiederverwendung = api.post(
            "/api/v1/auth/refresh", headers={"Cookie": f"{REFRESH_COOKIE_NAME}={alt}"}
        )
        assert wiederverwendung.status_code == 401

        danach = api.post(
            "/api/v1/auth/refresh", headers={"Cookie": f"{REFRESH_COOKIE_NAME}={neu}"}
        )
        assert danach.status_code == 401
    finally:
        settings.refresh_race_grace_seconds = original


def test_parallele_erneuerung_sperrt_die_sitzung_nicht(
    api: TestClient, app: FastAPI, betrieb: uuid.UUID
) -> None:
    """Punkt 4: Zwei gleichzeitige Anfragen mit demselben Token.

    Genau eine erzeugt den Nachfolger; die andere erhaelt einen Konflikt. Die
    Familie darf dabei nicht widerrufen werden.
    """
    api.post("/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    token = refresh_cookie(api)
    header = {"Cookie": f"{REFRESH_COOKIE_NAME}={token}"}
    barrier = threading.Barrier(2)

    def erneuern(_: int) -> tuple[int, str | None]:
        # Eigener Client je Thread -> echte parallele Datenbankzugriffe.
        with TestClient(app, raise_server_exceptions=False) as client:
            barrier.wait(timeout=15)
            response = client.post("/api/v1/auth/refresh", headers=header)
            return response.status_code, client.cookies.get(REFRESH_COOKIE_NAME)

    with ThreadPoolExecutor(max_workers=2) as pool:
        ergebnisse = list(pool.map(erneuern, range(2)))

    codes = sorted(code for code, _ in ergebnisse)
    assert codes == [200, 401], f"Genau ein Nachfolger erwartet, erhalten: {codes}"

    # Die Familie darf nicht widerrufen worden sein: Der Nachfolger des
    # erfolgreichen Laufs muss weiterhin funktionieren.
    nachfolger = next(cookie for code, cookie in ergebnisse if code == 200)
    assert nachfolger is not None
    weiter = api.post(
        "/api/v1/auth/refresh", headers={"Cookie": f"{REFRESH_COOKIE_NAME}={nachfolger}"}
    )
    assert weiter.status_code == 200, "Die parallele Anfrage hat die Sitzung gesperrt"


def test_logout_widerruft_die_sitzung(api: TestClient, betrieb: uuid.UUID) -> None:
    api.post("/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    alt = refresh_cookie(api)

    abmeldung = api.post("/api/v1/auth/logout")
    assert abmeldung.status_code == 204

    erneut = api.post("/api/v1/auth/refresh", headers={"Cookie": f"{REFRESH_COOKIE_NAME}={alt}"})
    assert erneut.status_code == 401


def test_unbekannter_refresh_token_ist_401(api: TestClient, betrieb: uuid.UUID) -> None:
    response = api.post(
        "/api/v1/auth/refresh", headers={"Cookie": f"{REFRESH_COOKIE_NAME}=erfunden"}
    )
    assert response.status_code == 401


# --------------------------------------------------- neue Rotationssemantik


def test_rotation_verknuepft_ueber_replaced_by_id(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    """Punkt 6 aus der Aufgabenliste: Nachfolger via ``replaced_by_id`` verknuepft."""
    api.post("/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    alt = refresh_cookie(api)

    assert api.post("/api/v1/auth/refresh").status_code == 200
    neu = refresh_cookie(api)

    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        vorgaenger = session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(alt))
        ).scalar_one()
        nachfolger = session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(neu))
        ).scalar_one()
    finally:
        session.close()

    assert vorgaenger.revoked_reason == RefreshTokenRevocationReason.ROTATED.value
    assert vorgaenger.replaced_by_id == nachfolger.id
    assert nachfolger.revoked_reason is None
    assert nachfolger.replaced_by_id is None
    assert vorgaenger.family_id == nachfolger.family_id


def test_logout_setzt_widerrufsgrund(api: TestClient, engine: Engine, betrieb: uuid.UUID) -> None:
    """Ein durch Logout widerrufener Token traegt eindeutig diesen Grund."""
    api.post("/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    token = refresh_cookie(api)

    assert api.post("/api/v1/auth/logout").status_code == 204

    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        stored = session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(token))
        ).scalar_one()
    finally:
        session.close()
    assert stored.revoked_reason == RefreshTokenRevocationReason.LOGOUT.value
    assert stored.replaced_by_id is None


def test_wiederverwendung_eines_gelogout_tokens_widerruft_nicht_erneut(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    """Ein Logout-Token bleibt selbst innerhalb des Toleranzfensters ungueltig
    und traegt weiterhin den Widerrufsgrund ``LOGOUT`` - nicht ``REUSE``."""
    api.post("/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    token = refresh_cookie(api)
    assert api.post("/api/v1/auth/logout").status_code == 204

    erneut = api.post("/api/v1/auth/refresh", headers={"Cookie": f"{REFRESH_COOKIE_NAME}={token}"})
    assert erneut.status_code == 401
    # Nicht der Diebstahls-Errortyp: kein Sammelwiderruf.
    assert not erneut.json()["title"].lower().startswith("die sitzung wurde")

    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        stored = session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(token))
        ).scalar_one()
    finally:
        session.close()
    assert stored.revoked_reason == RefreshTokenRevocationReason.LOGOUT.value


def test_reuse_setzt_widerrufsgrund_reuse_detected(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    """Nach echter Wiederverwendung traegt der Vorgaenger ``ROTATED``, alle
    anderen Tokens der Familie ``REUSE_DETECTED``."""
    from app.config import get_settings

    api.post("/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    alt = refresh_cookie(api)
    assert api.post("/api/v1/auth/refresh").status_code == 200
    neu = refresh_cookie(api)

    settings = get_settings()
    original = settings.refresh_race_grace_seconds
    settings.refresh_race_grace_seconds = 0
    try:
        wiederverwendung = api.post(
            "/api/v1/auth/refresh", headers={"Cookie": f"{REFRESH_COOKIE_NAME}={alt}"}
        )
        assert wiederverwendung.status_code == 401
    finally:
        settings.refresh_race_grace_seconds = original

    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        vorgaenger = session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(alt))
        ).scalar_one()
        nachfolger = session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(neu))
        ).scalar_one()
    finally:
        session.close()

    # Der Vorgaenger behaelt seinen Rotations-Grund - so bleibt die
    # Ursachenkette lesbar.
    assert vorgaenger.revoked_reason == RefreshTokenRevocationReason.ROTATED.value
    # Der Nachfolger wird als Teil des Sammelwiderrufs markiert.
    assert nachfolger.revoked_reason == RefreshTokenRevocationReason.REUSE_DETECTED.value


def test_wiederverwendung_nach_familienwiderruf_kein_zusaetzlicher_widerruf(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    """Ein bereits durch Familienwiderruf ungueltiger Token loest keinen
    weiteren Widerruf aus - die Ursache bleibt sichtbar."""
    api.post("/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    token = refresh_cookie(api)
    assert api.post("/api/v1/auth/logout").status_code == 204

    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        vorher = session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(token))
        ).scalar_one()
        vorher_reason = vorher.revoked_reason
    finally:
        session.close()

    assert (
        api.post(
            "/api/v1/auth/refresh", headers={"Cookie": f"{REFRESH_COOKIE_NAME}={token}"}
        ).status_code
        == 401
    )

    session = factory()
    try:
        nachher = session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(token))
        ).scalar_one()
    finally:
        session.close()
    assert nachher.revoked_reason == vorher_reason


# ------------------------------------------------------------------- CSRF


def test_erlaubte_herkunft_wird_akzeptiert(api: TestClient, betrieb: uuid.UUID) -> None:
    response = api.post(
        "/api/v1/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"Origin": ALLOWED_ORIGIN},
    )
    assert response.status_code == 200


def test_fremde_herkunft_wird_abgelehnt(api: TestClient, betrieb: uuid.UUID) -> None:
    response = api.post(
        "/api/v1/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"Origin": "https://angreifer.example"},
    )
    assert response.status_code == 403
    assert response.json()["type"].endswith("/csrf-validation-failed")


def test_fremder_referer_wird_abgelehnt(api: TestClient, betrieb: uuid.UUID) -> None:
    api.post("/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})

    response = api.post(
        "/api/v1/auth/refresh", headers={"Referer": "https://angreifer.example/seite"}
    )
    assert response.status_code == 403


# ------------------------------------------------- Mehrmandanten-Anmeldung


@pytest.fixture
def zwei_betriebe(
    engine: Engine, registry: ModuleRegistry, clean_database: None
) -> list[uuid.UUID]:
    """Ein Benutzer mit aktiver Mitgliedschaft in zwei Betrieben."""
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    ids: list[uuid.UUID] = []
    try:
        for name in ("Betrieb Alpha GmbH", "Betrieb Beta GmbH"):
            result = seed_initial_data(
                session,
                registry,
                organization_name=name,
                admin_email=ADMIN_EMAIL,
                admin_password=ADMIN_PASSWORD,
            )
            ids.append(result.organization_id)
        session.commit()
        return ids
    finally:
        session.close()


def test_eine_mitgliedschaft_wird_automatisch_gewaehlt(api: TestClient, betrieb: uuid.UUID) -> None:
    response = api.post(
        "/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )
    assert response.status_code == 200
    assert response.json()["organization_id"] == str(betrieb)


def test_mehrere_mitgliedschaften_erzwingen_eine_auswahl(
    api: TestClient, zwei_betriebe: list[uuid.UUID]
) -> None:
    response = api.post(
        "/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )

    assert response.status_code == 409
    body = response.json()
    assert body["type"].endswith("/organization-selection-required")
    gewaehlt = {eintrag["id"] for eintrag in body["organizations"]}
    assert gewaehlt == {str(value) for value in zwei_betriebe}


def test_auswahl_eines_betriebs_funktioniert(
    api: TestClient, zwei_betriebe: list[uuid.UUID]
) -> None:
    ziel = zwei_betriebe[1]
    response = api.post(
        "/api/v1/auth/login",
        json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD,
            "organization_id": str(ziel),
        },
    )
    assert response.status_code == 200
    assert response.json()["organization_id"] == str(ziel)


def test_ohne_mitgliedschaft_kein_login(
    api: TestClient, engine: Engine, clean_database: None
) -> None:
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        session.add(
            User(
                email="ohne@test.example",
                password_hash=hash_password(ADMIN_PASSWORD),
                full_name="Ohne Betrieb",
            )
        )
        session.commit()
    finally:
        session.close()

    response = api.post(
        "/api/v1/auth/login", json={"email": "ohne@test.example", "password": ADMIN_PASSWORD}
    )
    assert response.status_code == 404


def test_deaktivierte_mitgliedschaft_zaehlt_nicht(
    api: TestClient, engine: Engine, zwei_betriebe: list[uuid.UUID]
) -> None:
    """Wird eine von zwei Mitgliedschaften deaktiviert, entfaellt die Auswahl."""
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        member = session.execute(
            select(OrganizationMember).where(OrganizationMember.organization_id == zwei_betriebe[0])
        ).scalar_one()
        member.status = MEMBER_STATUS_DISABLED
        session.commit()
    finally:
        session.close()

    response = api.post(
        "/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )
    assert response.status_code == 200
    assert response.json()["organization_id"] == str(zwei_betriebe[1])


def test_wechsel_nur_in_eigene_betriebe(
    api: TestClient, engine: Engine, zwei_betriebe: list[uuid.UUID], clean_database: None
) -> None:
    token = login(api, ADMIN_EMAIL, organization_id=zwei_betriebe[0])

    erlaubt = api.post(
        "/api/v1/auth/switch-organization",
        json={"organization_id": str(zwei_betriebe[1])},
        headers=auth_headers(token),
    )
    assert erlaubt.status_code == 200
    assert erlaubt.json()["organization_id"] == str(zwei_betriebe[1])

    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        fremd = Organization(name="Fremder Betrieb GmbH", slug="fremder-betrieb-gmbh")
        session.add(fremd)
        session.commit()
        fremd_id = fremd.id
    finally:
        session.close()

    verweigert = api.post(
        "/api/v1/auth/switch-organization",
        json={"organization_id": str(fremd_id)},
        headers=auth_headers(token),
    )
    assert verweigert.status_code == 404


# ---------------------------------------------------------------- Protokoll


def test_anmeldung_wird_protokolliert(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)

    eintraege = api.get(
        "/api/v1/audit", params={"action": "auth.login"}, headers=auth_headers(token)
    ).json()["items"]

    assert eintraege
    assert eintraege[0]["action"] == "auth.login"
    assert eintraege[0]["request_id"]
