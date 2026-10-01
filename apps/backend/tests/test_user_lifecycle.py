"""Benutzerlebenszyklus (Phase 4e, ADR 0021) ueber die HTTP-Schnittstelle.

Geprueft gegen PostgreSQL: Name und E-Mail aendern, sperren und entsperren mit
sofortiger Wirkung auf **jedes** bestehende Token, Passwortzuruecksetzung mit
Einmal-Link (nur Hash gespeichert), endgueltiges Entfernen als Tombstone,
Grenzen fuer eigene, letzte-Administrator- und geteilte Konten,
Mandantentrennung, Berechtigungen und Protokoll ohne personenbezogene Werte.

Ausschliesslich synthetische Personen unter ``.example``.
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from collections.abc import Iterator
from datetime import timedelta
from urllib.parse import urlsplit

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select, update

from app.config import Settings, get_settings
from app.core.audit.models import AuditEntry
from app.core.auth.models import RefreshToken
from app.core.auth.service import _login_limiter
from app.core.authorization.models import MemberRole, Permission, Role, RolePermission
from app.core.invitations.service import reset_acceptance_limiter
from app.core.module_registry.registry import ModuleRegistry
from app.core.organizations.models import OrganizationMember
from app.core.password_reset.models import PasswordResetToken
from app.core.password_reset.service import reset_password_reset_limiters
from app.core.preferences.models import UserPreferences
from app.core.seed import seed_initial_data
from app.core.users.models import User
from app.db.mixins import utcnow
from tests.conftest import ADMIN_PASSWORD, auth_headers, login, requires_database
from tests.verwaltung_hilfen import (
    Person,
    admin_mitglied,
    eigene_rolle_anlegen,
    fabrik,
    person_anlegen,
    token_aus_link,
)

pytestmark = [requires_database, pytest.mark.database]

ADMIN = "admin@test.example"
NEUES_PASSWORT = "ein-ganz-neues-passwort-2026"
ORIGIN = {"Origin": "http://localhost:5173"}


@pytest.fixture(autouse=True)
def _limiter_zuruecksetzen() -> Iterator[None]:
    _login_limiter.clear()
    reset_acceptance_limiter()
    reset_password_reset_limiters()
    yield
    _login_limiter.clear()
    reset_acceptance_limiter()
    reset_password_reset_limiters()


@pytest.fixture
def betrieb(api: TestClient, seeded_organization: dict[str, uuid.UUID]) -> uuid.UUID:
    return seeded_organization["organization_id"]


def _kopf(api: TestClient, email: str, passwort: str = ADMIN_PASSWORD) -> dict[str, str]:
    return auth_headers(login(api, email, passwort))


def _mitglied(api: TestClient, headers: dict[str, str], member_id: uuid.UUID) -> dict:
    response = api.get(f"/api/v1/members/{member_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _mit_version(headers: dict[str, str], version: int) -> dict[str, str]:
    return {**headers, "If-Match": str(version)}


def _anmeldung(client: TestClient, email: str, passwort: str = ADMIN_PASSWORD) -> int:
    return client.post(
        "/api/v1/auth/login", json={"email": email, "password": passwort}
    ).status_code


def _zweiter_betrieb(engine: Engine, registry: ModuleRegistry, name: str, admin: str) -> uuid.UUID:
    session = fabrik(engine)()
    try:
        result = seed_initial_data(
            session,
            registry,
            organization_name=name,
            admin_email=admin,
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
        return result.organization_id
    finally:
        session.close()


def _reset_ausloesen(api: TestClient, headers: dict[str, str], member_id: uuid.UUID) -> str:
    response = api.post(f"/api/v1/members/{member_id}/password-reset", headers=headers)
    assert response.status_code == 201, response.text
    return token_aus_link(response.json()["reset_url"])


def _protokolltext(engine: Engine, organization_id: uuid.UUID) -> str:
    session = fabrik(engine)()
    try:
        eintraege = session.execute(
            select(AuditEntry).where(AuditEntry.organization_id == organization_id)
        ).scalars()
        return " ".join(f"{e.action} {e.summary} {e.data}" for e in eintraege)
    finally:
        session.close()


# ------------------------------------------------------------------ Profil


def test_neuer_name_ohne_sitzungsende_mit_versionssprung(
    app: FastAPI, api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "nora@test.example", ["planer"], name="Nora Alt")
    with TestClient(app, raise_server_exceptions=False) as zweiter:
        eigene = _kopf(zweiter, person.email)
        headers = _kopf(api, ADMIN)
        vorher = _mitglied(api, headers, person.member_id)
        response = api.patch(
            f"/api/v1/members/{person.member_id}",
            headers=_mit_version(headers, vorher["version"]),
            json={"full_name": "  Nora Neu  "},
        )
        assert response.status_code == 200, response.text
        assert response.json()["full_name"] == "Nora Neu"
        assert response.json()["version"] == vorher["version"] + 1
        # Ein neuer Name allein beendet keine Sitzung.
        assert zweiter.get("/api/v1/me", headers=eigene).json()["full_name"] == "Nora Neu"
        assert zweiter.post("/api/v1/auth/refresh").status_code == 200

    protokoll = _protokolltext(engine, betrieb)
    assert "member.profile_updated" in protokoll
    assert "full_name" in protokoll
    assert "Nora Alt" not in protokoll and "Nora Neu" not in protokoll


def test_neue_email_beendet_jede_sitzung_und_gilt_allein_fuer_die_anmeldung(
    app: FastAPI, api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "otto@test.example", ["planer"])
    with TestClient(app, raise_server_exceptions=False) as zweiter:
        alte_sitzung = _kopf(zweiter, person.email)
        headers = _kopf(api, ADMIN)
        version = _mitglied(api, headers, person.member_id)["version"]
        response = api.patch(
            f"/api/v1/members/{person.member_id}",
            headers=_mit_version(headers, version),
            json={"email": "  Otto.Neu@Test.Example "},
        )
        assert response.status_code == 200, response.text
        assert response.json()["email"] == "otto.neu@test.example"

        # Bestehendes Access Token, Refresh und alte Adresse: alles vorbei.
        assert zweiter.get("/api/v1/me", headers=alte_sitzung).status_code == 401
        assert zweiter.get("/api/v1/projects", headers=alte_sitzung).status_code == 401
        assert zweiter.post("/api/v1/auth/refresh").status_code == 401
        assert _anmeldung(zweiter, "otto@test.example") == 401
        assert _anmeldung(zweiter, "otto.neu@test.example") == 200
        assert _anmeldung(zweiter, "OTTO.NEU@test.example") == 200

    session = fabrik(engine)()
    try:
        erste = session.execute(
            select(RefreshToken)
            .where(RefreshToken.user_id == person.user_id)
            .order_by(RefreshToken.created_at)
            .limit(1)
        ).scalar_one()
        assert erste.revoked_reason == "credentials_changed"
    finally:
        session.close()
    protokoll = _protokolltext(engine, betrieb)
    assert "otto" not in protokoll.lower().replace("auth.login", "")


def test_email_konflikt_mit_konto_und_offener_einladung(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "pia@test.example", ["planer"])
    person_anlegen(engine, betrieb, "belegt@test.example", ["monteur"])
    headers = _kopf(api, ADMIN)
    eingeladen = api.post(
        "/api/v1/invitations",
        headers=headers,
        json={"email": "eingeladen@test.example", "role_keys": ["planer"]},
    )
    assert eingeladen.status_code == 201
    version = _mitglied(api, headers, person.member_id)["version"]

    for adresse in ("belegt@test.example", "BELEGT@test.example", "eingeladen@test.example", ADMIN):
        response = api.patch(
            f"/api/v1/members/{person.member_id}",
            headers=_mit_version(headers, version),
            json={"email": adresse},
        )
        assert response.status_code == 409, adresse
        assert response.json()["type"].endswith("/email-unavailable")
    # Eine widerrufene Einladung belegt die Adresse nicht mehr.
    einladung = eingeladen.json()["invitation"]
    api.post(
        f"/api/v1/invitations/{einladung['id']}/revoke",
        headers=_mit_version(headers, einladung["version"]),
    )
    response = api.patch(
        f"/api/v1/members/{person.member_id}",
        headers=_mit_version(headers, version),
        json={"email": "eingeladen@test.example"},
    )
    assert response.status_code == 200, response.text


def test_profil_verlangt_if_match_und_aktuelle_version(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "quirin@test.example", ["planer"])
    headers = _kopf(api, ADMIN)
    pfad = f"/api/v1/members/{person.member_id}"
    version = _mitglied(api, headers, person.member_id)["version"]
    assert api.patch(pfad, headers=headers, json={"full_name": "Q"}).status_code == 428
    veraltet = api.patch(pfad, headers=_mit_version(headers, version + 1), json={"full_name": "Q"})
    assert veraltet.status_code == 409
    assert veraltet.json()["type"].endswith("/version-conflict")
    for koerper in (
        {},
        {"full_name": "   "},
        {"email": "kein-at"},
        {"full_name": "x" * 201},
        {"rolle": "admin"},
    ):
        assert (
            api.patch(pfad, headers=_mit_version(headers, version), json=koerper).status_code == 422
        ), koerper


def test_gesperrte_duerfen_bearbeitet_werden(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "rita@test.example", ["planer"], status="disabled")
    headers = _kopf(api, ADMIN)
    version = _mitglied(api, headers, person.member_id)["version"]
    response = api.patch(
        f"/api/v1/members/{person.member_id}",
        headers=_mit_version(headers, version),
        json={"full_name": "Rita R."},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "disabled"


def test_geteiltes_konto_ist_nicht_bearbeitbar_aber_sperrbar(
    api: TestClient, engine: Engine, registry: ModuleRegistry, betrieb: uuid.UUID
) -> None:
    anderer = _zweiter_betrieb(engine, registry, "Elektro Zweit GmbH", "admin@zweit.example")
    person = person_anlegen(engine, betrieb, "geteilt@test.example", ["planer"])
    person_anlegen(engine, anderer, "geteilt@test.example", ["planer"])
    headers = _kopf(api, ADMIN)
    detail = _mitglied(api, headers, person.member_id)
    assert detail["account_shared"] is True
    pfad = f"/api/v1/members/{person.member_id}"
    for response in (
        api.patch(
            pfad, headers=_mit_version(headers, detail["version"]), json={"full_name": "Neu"}
        ),
        api.post(f"{pfad}/password-reset", headers=headers),
    ):
        assert response.status_code == 409
        assert response.json()["type"].endswith("/account-shared")
        assert "Zweit" not in response.text
    gesperrt = api.post(
        f"{pfad}/suspend", json={}, headers=_mit_version(headers, detail["version"])
    )
    assert gesperrt.status_code == 200


# ---------------------------------------------------------- Sperren/Entsperren


def test_sperre_und_entsperren_alte_sitzungen_leben_nie_wieder_auf(
    app: FastAPI, api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "sven@test.example", ["planer", "monteur"])
    with TestClient(app, raise_server_exceptions=False) as zweiter:
        alt = _kopf(zweiter, person.email)
        praeferenz = zweiter.post(
            "/api/v1/me/preferences",
            headers=alt,
            json={"theme_mode": "dark", "accent": "teal", "length_unit": "m"},
        )
        assert praeferenz.status_code == 201
        headers = _kopf(api, ADMIN)
        version = _mitglied(api, headers, person.member_id)["version"]
        gesperrt = api.post(
            f"/api/v1/members/{person.member_id}/suspend",
            headers=_mit_version(headers, version),
            json={"reason": "  Urlaubsvertretung beendet "},
        )
        assert gesperrt.status_code == 200, gesperrt.text
        assert gesperrt.json()["lock_reason"] == "Urlaubsvertretung beendet"

        assert zweiter.get("/api/v1/me", headers=alt).status_code == 401
        assert zweiter.post("/api/v1/auth/refresh").status_code == 401
        assert _anmeldung(zweiter, person.email) != 200

        frei = api.post(
            f"/api/v1/members/{person.member_id}/reactivate",
            headers=_mit_version(headers, gesperrt.json()["version"]),
        )
        assert frei.status_code == 200
        assert frei.json()["status"] == "active"
        assert frei.json()["lock_reason"] is None
        assert {r["key"] for r in frei.json()["roles"]} == {"planer", "monteur"}
        # Entsperren belebt weder Access noch Refresh Token.
        assert zweiter.get("/api/v1/me", headers=alt).status_code == 401
        assert zweiter.post("/api/v1/auth/refresh").status_code == 401
        neu = _kopf(zweiter, person.email)
        assert zweiter.get("/api/v1/me", headers=neu).status_code == 200
        # Einstellungen sind erhalten.
        assert zweiter.get("/api/v1/me/preferences", headers=neu).json()["length_unit"] == "m"
    assert "Urlaubsvertretung" not in _protokolltext(engine, betrieb)


def test_sperrgrund_ist_kurz(api: TestClient, engine: Engine, betrieb: uuid.UUID) -> None:
    person = person_anlegen(engine, betrieb, "tim@test.example", ["planer"])
    headers = _kopf(api, ADMIN)
    version = _mitglied(api, headers, person.member_id)["version"]
    zu_lang = api.post(
        f"/api/v1/members/{person.member_id}/suspend",
        headers=_mit_version(headers, version),
        json={"reason": "x" * 201},
    )
    assert zu_lang.status_code == 422


# ------------------------------------------------------- Passwort zuruecksetzen


def test_reset_link_nur_als_hash_einmalig_und_beendet_alle_sitzungen(
    app: FastAPI,
    api: TestClient,
    engine: Engine,
    betrieb: uuid.UUID,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    person = person_anlegen(engine, betrieb, "ute@test.example", ["planer"])
    with TestClient(app, raise_server_exceptions=False) as zweiter:
        alt = _kopf(zweiter, person.email)
        headers = _kopf(api, ADMIN)
        antwort = api.post(f"/api/v1/members/{person.member_id}/password-reset", headers=headers)
        assert antwort.status_code == 201, antwort.text
        link = antwort.json()["reset_url"]
        assert urlsplit(link).path == "/passwort-zuruecksetzen"
        token = token_aus_link(link)
        # Das bisherige Passwort gilt, bis der Link verwendet wird.
        assert zweiter.get("/api/v1/me", headers=alt).status_code == 200

        session = fabrik(engine)()
        try:
            gespeichert = session.execute(select(PasswordResetToken)).scalars().one()
            assert gespeichert.token_hash == hashlib.sha256(token.encode()).hexdigest()
            assert token not in repr(gespeichert.__dict__)
        finally:
            session.close()

        oeffentlich = TestClient(app, raise_server_exceptions=False)
        assert (
            oeffentlich.post(
                "/api/v1/password-reset/preview", headers=ORIGIN, json={"token": token}
            ).status_code
            == 200
        )
        fertig = oeffentlich.post(
            "/api/v1/password-reset/complete",
            headers=ORIGIN,
            json={"token": token, "password": NEUES_PASSWORT},
        )
        assert fertig.status_code == 204, fertig.text

        assert zweiter.get("/api/v1/me", headers=alt).status_code == 401
        assert zweiter.post("/api/v1/auth/refresh").status_code == 401
        assert _anmeldung(zweiter, person.email) == 401
        assert _anmeldung(zweiter, person.email, NEUES_PASSWORT) == 200

        # Genau einmal verwendbar - danach die neutrale Antwort.
        nochmal = oeffentlich.post(
            "/api/v1/password-reset/complete",
            headers=ORIGIN,
            json={"token": token, "password": "noch-ein-passwort-1"},
        )
        assert nochmal.status_code == 404
        assert nochmal.json()["type"].endswith("/password-reset-invalid")

    protokoll = _protokolltext(engine, betrieb)
    assert "member.password_reset_issued" in protokoll
    assert "member.password_reset_completed" in protokoll
    for geheim in (token, link, NEUES_PASSWORT):
        assert geheim not in protokoll
        assert geheim not in caplog.text


def test_neuer_link_entwertet_den_alten_und_ablauf_wirkt(
    app: FastAPI, api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "vera@test.example", ["planer"])
    headers = _kopf(api, ADMIN)
    erster = _reset_ausloesen(api, headers, person.member_id)
    zweiter = _reset_ausloesen(api, headers, person.member_id)
    oeffentlich = TestClient(app, raise_server_exceptions=False)
    assert (
        oeffentlich.post(
            "/api/v1/password-reset/preview", headers=ORIGIN, json={"token": erster}
        ).status_code
        == 404
    )
    assert (
        oeffentlich.post(
            "/api/v1/password-reset/preview", headers=ORIGIN, json={"token": zweiter}
        ).status_code
        == 200
    )

    session = fabrik(engine)()
    try:
        session.execute(
            update(PasswordResetToken).values(expires_at=utcnow() - timedelta(seconds=1))
        )
        session.commit()
    finally:
        session.close()
    for pfad, koerper in (
        ("/api/v1/password-reset/preview", {"token": zweiter}),
        ("/api/v1/password-reset/complete", {"token": zweiter, "password": NEUES_PASSWORT}),
    ):
        response = oeffentlich.post(pfad, headers=ORIGIN, json=koerper)
        assert response.status_code == 404
        assert response.json()["type"].endswith("/password-reset-invalid")
    assert _anmeldung(oeffentlich, person.email) == 200


def test_ablauf_ist_konfiguriert(api: TestClient, engine: Engine, betrieb: uuid.UUID) -> None:
    person = person_anlegen(engine, betrieb, "willi@test.example", ["planer"])
    headers = _kopf(api, ADMIN)
    vorher = utcnow()
    antwort = api.post(f"/api/v1/members/{person.member_id}/password-reset", headers=headers).json()
    from datetime import datetime

    ablauf = datetime.fromisoformat(antwort["expires_at"])
    minuten = get_settings().password_reset_valid_minutes
    assert vorher + timedelta(minutes=minuten) - timedelta(seconds=5) <= ablauf
    assert ablauf <= utcnow() + timedelta(minutes=minuten)


def test_passwortregeln_verbrauchen_den_link_nicht(
    app: FastAPI, api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "xenia@test.example", ["planer"])
    token = _reset_ausloesen(api, _kopf(api, ADMIN), person.member_id)
    oeffentlich = TestClient(app, raise_server_exceptions=False)
    for schwach in ("kurz", "passwort"):
        response = oeffentlich.post(
            "/api/v1/password-reset/complete",
            headers=ORIGIN,
            json={"token": token, "password": schwach},
        )
        assert response.status_code == 422
        assert response.json()["errors"][0]["code"] == "password_policy"
    assert (
        oeffentlich.post(
            "/api/v1/password-reset/complete",
            headers=ORIGIN,
            json={"token": token, "password": NEUES_PASSWORT},
        ).status_code
        == 204
    )


def test_reset_oeffentlich_nur_mit_erlaubter_herkunft_und_begrenzt(
    app: FastAPI, api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    oeffentlich = TestClient(app, raise_server_exceptions=False)
    fremd = oeffentlich.post(
        "/api/v1/password-reset/preview",
        headers={"Origin": "https://boese.example"},
        json={"token": "x"},
    )
    assert fremd.status_code == 403
    antworten = [
        oeffentlich.post(
            "/api/v1/password-reset/preview", headers=ORIGIN, json={"token": f"falsch-{i}"}
        ).status_code
        for i in range(get_settings().password_reset_attempts_per_window + 1)
    ]
    assert set(antworten[:-1]) == {404}
    assert antworten[-1] == 429


def test_reset_ausloesen_ist_begrenzt(api: TestClient, engine: Engine, betrieb: uuid.UUID) -> None:
    person = person_anlegen(engine, betrieb, "yara@test.example", ["planer"])
    headers = _kopf(api, ADMIN)
    grenze = get_settings().password_reset_issue_per_window
    for _ in range(grenze):
        _reset_ausloesen(api, headers, person.member_id)
    zuviel = api.post(f"/api/v1/members/{person.member_id}/password-reset", headers=headers)
    assert zuviel.status_code == 429


def test_reset_ohne_zustellweg_legt_nichts_an(
    api: TestClient, engine: Engine, betrieb: uuid.UUID, monkeypatch: pytest.MonkeyPatch
) -> None:
    person = person_anlegen(engine, betrieb, "zora@test.example", ["planer"])
    headers = _kopf(api, ADMIN)
    monkeypatch.setattr(get_settings(), "password_reset_delivery", "none")
    response = api.post(f"/api/v1/members/{person.member_id}/password-reset", headers=headers)
    assert response.status_code == 503
    assert response.json()["type"].endswith("/password-reset-delivery-unavailable")
    session = fabrik(engine)()
    try:
        assert session.execute(select(PasswordResetToken)).first() is None
    finally:
        session.close()


def test_admin_link_ist_in_produktion_verboten() -> None:
    with pytest.raises(ValueError, match="PASSWORD_RESET_DELIVERY"):
        Settings(
            environment="production",
            jwt_secret="x" * 40,
            s3_secret_key="geheim",
            invitation_delivery="none",
            password_reset_delivery="admin_link",
        )


def test_gesperrte_koennen_zurueckgesetzt_werden_und_bleiben_gesperrt(
    app: FastAPI, api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "anton@test.example", ["planer"], status="disabled")
    token = _reset_ausloesen(api, _kopf(api, ADMIN), person.member_id)
    oeffentlich = TestClient(app, raise_server_exceptions=False)
    assert (
        oeffentlich.post(
            "/api/v1/password-reset/complete",
            headers=ORIGIN,
            json={"token": token, "password": NEUES_PASSWORT},
        ).status_code
        == 204
    )
    assert _anmeldung(oeffentlich, person.email, NEUES_PASSWORT) != 200


def _sperren_api(api: TestClient, headers: dict[str, str], person: Person) -> dict:
    version = _mitglied(api, headers, person.member_id)["version"]
    response = api.post(
        f"/api/v1/members/{person.member_id}/suspend",
        headers=_mit_version(headers, version),
        json={},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _entsperren_api(api: TestClient, headers: dict[str, str], person: Person) -> None:
    version = _mitglied(api, headers, person.member_id)["version"]
    response = api.post(
        f"/api/v1/members/{person.member_id}/reactivate", headers=_mit_version(headers, version)
    )
    assert response.status_code == 200, response.text


def _offene_links(engine: Engine, member_id: uuid.UUID) -> int:
    session = fabrik(engine)()
    try:
        return len(
            session.execute(
                select(PasswordResetToken).where(PasswordResetToken.member_id == member_id)
            ).all()
        )
    finally:
        session.close()


def _ungueltig(client: TestClient, token: str) -> None:
    for pfad, koerper in (
        ("/api/v1/password-reset/preview", {"token": token}),
        ("/api/v1/password-reset/complete", {"token": token, "password": NEUES_PASSWORT}),
    ):
        response = client.post(pfad, headers=ORIGIN, json=koerper)
        assert response.status_code == 404, response.text
        assert response.json()["type"].endswith("/password-reset-invalid")


def test_sperre_entwertet_offene_reset_links_und_entsperren_belebt_sie_nicht(
    app: FastAPI, api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    """Eine Sperre ist ein Sicherheitsstopp - auch fuer ausgestellte Reset-Links."""
    person = person_anlegen(engine, betrieb, "rosa@test.example", ["planer"])
    headers = _kopf(api, ADMIN)
    token = _reset_ausloesen(api, headers, person.member_id)
    assert _offene_links(engine, person.member_id) == 1

    _sperren_api(api, headers, person)
    assert _offene_links(engine, person.member_id) == 0
    oeffentlich = TestClient(app, raise_server_exceptions=False)
    _ungueltig(oeffentlich, token)

    _entsperren_api(api, headers, person)
    _ungueltig(oeffentlich, token)
    # Das alte Passwort gilt weiter - der alte Link hat nichts veraendert.
    assert _anmeldung(oeffentlich, person.email) == 200


def test_nach_der_sperre_neu_erzeugter_link_wirkt_die_sperre_bleibt(
    app: FastAPI,
    api: TestClient,
    engine: Engine,
    betrieb: uuid.UUID,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    person = person_anlegen(engine, betrieb, "sina@test.example", ["planer"])
    with TestClient(app, raise_server_exceptions=False) as zweiter:
        alt = _kopf(zweiter, person.email)
        headers = _kopf(api, ADMIN)
        alter_link = _reset_ausloesen(api, headers, person.member_id)
        _sperren_api(api, headers, person)

        # Fuer das gesperrte Mitglied darf bewusst ein neuer Link entstehen.
        antwort = api.post(f"/api/v1/members/{person.member_id}/password-reset", headers=headers)
        assert antwort.status_code == 201, antwort.text
        neuer_link = antwort.json()["reset_url"]
        neues_token = token_aus_link(neuer_link)
        oeffentlich = TestClient(app, raise_server_exceptions=False)
        fertig = oeffentlich.post(
            "/api/v1/password-reset/complete",
            headers=ORIGIN,
            json={"token": neues_token, "password": NEUES_PASSWORT},
        )
        assert fertig.status_code == 204, fertig.text
        assert _mitglied(api, headers, person.member_id)["status"] == "disabled"
        # Gesperrt: weder altes noch neues Passwort meldet an.
        assert _anmeldung(oeffentlich, person.email) != 200
        assert _anmeldung(oeffentlich, person.email, NEUES_PASSWORT) != 200

        _entsperren_api(api, headers, person)
        assert _anmeldung(oeffentlich, person.email) == 401
        assert _anmeldung(oeffentlich, person.email, NEUES_PASSWORT) == 200
        # Alte Sitzung und alter Link bleiben ungueltig.
        assert zweiter.get("/api/v1/me", headers=alt).status_code == 401
        assert zweiter.post("/api/v1/auth/refresh").status_code == 401
        _ungueltig(oeffentlich, alter_link)
        _ungueltig(oeffentlich, neues_token)

    protokoll = _protokolltext(engine, betrieb)
    for geheim in (alter_link, neues_token, neuer_link, NEUES_PASSWORT):
        assert geheim not in protokoll
        assert geheim not in caplog.text


def test_sperre_entwertet_nur_links_dieser_mitgliedschaft(
    api: TestClient, engine: Engine, registry: ModuleRegistry, betrieb: uuid.UUID
) -> None:
    fremd = _zweiter_betrieb(engine, registry, "Elektro Getrennt GmbH", "admin@getrennt.example")
    hier = person_anlegen(engine, betrieb, "hier@test.example", ["planer"])
    nebenan = person_anlegen(engine, betrieb, "nebenan@test.example", ["planer"])
    dort = person_anlegen(engine, fremd, "dort@getrennt.example", ["planer"])
    headers = _kopf(api, ADMIN)
    fremd_headers = _kopf(api, "admin@getrennt.example")
    _reset_ausloesen(api, headers, hier.member_id)
    _reset_ausloesen(api, headers, nebenan.member_id)
    _reset_ausloesen(api, fremd_headers, dort.member_id)

    _sperren_api(api, headers, hier)
    assert _offene_links(engine, hier.member_id) == 0
    assert _offene_links(engine, nebenan.member_id) == 1
    assert _offene_links(engine, dort.member_id) == 1
    # Ein fremder Betrieb kann die Mitgliedschaft nicht sperren und ihre Links nicht beruehren.
    version = _mitglied(api, fremd_headers, dort.member_id)["version"]
    versuch = api.post(
        f"/api/v1/members/{dort.member_id}/suspend",
        headers=_mit_version(headers, version),
        json={},
    )
    assert versuch.status_code == 404
    assert _offene_links(engine, dort.member_id) == 1


# ----------------------------------------------------------------- Entfernen


def _entfernen(
    api: TestClient, headers: dict[str, str], person: Person, bestaetigung: str | None = None
) -> dict:
    version = _mitglied(api, headers, person.member_id)["version"]
    response = api.post(
        f"/api/v1/members/{person.member_id}/remove",
        headers=_mit_version(headers, version),
        json={"confirm_email": bestaetigung or person.email},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_entfernen_ist_ein_endgueltiger_tombstone(
    app: FastAPI, api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(
        engine, betrieb, "berta@test.example", ["kalkulator", "planer"], name="Berta Beispiel"
    )
    with TestClient(app, raise_server_exceptions=False) as zweiter:
        alt = _kopf(zweiter, person.email)
        kunde = zweiter.post(
            "/api/v1/customers", headers=alt, json={"kind": "private", "name": "Kundin Synthetisch"}
        )
        assert kunde.status_code == 201, kunde.text
        zweiter.post(
            "/api/v1/me/preferences",
            headers=alt,
            json={"theme_mode": "dark", "accent": "green", "length_unit": "mm"},
        )
        headers = _kopf(api, ADMIN)
        _reset_ausloesen(api, headers, person.member_id)

        version = _mitglied(api, headers, person.member_id)["version"]
        falsch = api.post(
            f"/api/v1/members/{person.member_id}/remove",
            headers=_mit_version(headers, version),
            json={"confirm_email": "jemand@test.example"},
        )
        assert falsch.status_code == 422
        assert falsch.json()["errors"][0]["code"] == "confirmation_mismatch"
        ohne = api.post(
            f"/api/v1/members/{person.member_id}/remove",
            headers=headers,
            json={"confirm_email": person.email},
        )
        assert ohne.status_code == 428

        entfernt = _entfernen(api, headers, person, "  BERTA@test.example ")
        assert entfernt["status"] == "removed"
        assert entfernt["full_name"] is None and entfernt["email"] is None
        assert entfernt["roles"] == []

        assert zweiter.get("/api/v1/me", headers=alt).status_code == 401
        assert zweiter.post("/api/v1/auth/refresh").status_code == 401
        assert _anmeldung(zweiter, person.email) == 401

    session = fabrik(engine)()
    try:
        konto = session.get(User, person.user_id)
        assert konto is not None
        assert konto.email == f"removed-{person.user_id.hex}@removed.invalid"
        assert konto.full_name == "Entfernter Benutzer"
        assert konto.is_active is False
        assert not konto.password_hash.startswith("$argon2")
        assert "berta" not in f"{konto.email} {konto.full_name}".lower()
        assert (
            session.execute(
                select(MemberRole).where(MemberRole.member_id == person.member_id)
            ).first()
            is None
        )
        assert (
            session.execute(
                select(UserPreferences).where(UserPreferences.member_id == person.member_id)
            ).first()
            is None
        )
        assert (
            session.execute(
                select(PasswordResetToken).where(PasswordResetToken.member_id == person.member_id)
            ).first()
            is None
        )
        assert (
            session.execute(
                select(RefreshToken).where(
                    RefreshToken.user_id == person.user_id, RefreshToken.revoked_at.is_(None)
                )
            ).first()
            is None
        )
        # Die Zeile der Mitgliedschaft bleibt - als Tombstone.
        mitgliedschaft = session.get(OrganizationMember, person.member_id)
        assert mitgliedschaft is not None and mitgliedschaft.status == "removed"
    finally:
        session.close()

    # Bearbeiterangaben bleiben aufloesbar - neutral.
    detail = api.get(f"/api/v1/customers/{kunde.json()['id']}", headers=headers).json()
    assert detail["created_by"] == {"kind": "removed", "user_id": None, "display_name": None}
    # Nicht in der normalen Liste, wohl aber unter "Entfernt" - ohne Person.
    standard = api.get("/api/v1/members", headers=headers).json()["items"]
    assert str(person.member_id) not in {e["id"] for e in standard}
    entfernte = api.get("/api/v1/members", headers=headers, params={"status": "removed"}).json()[
        "items"
    ]
    assert [(e["id"], e["full_name"], e["email"], e["status"]) for e in entfernte] == [
        (str(person.member_id), None, None, "removed")
    ]
    assert (
        api.get(
            "/api/v1/members", headers=headers, params={"status": "removed", "q": "berta"}
        ).json()["items"]
        == []
    )

    protokoll = _protokolltext(engine, betrieb).lower()
    assert "member.removed" in protokoll
    assert "berta" not in protokoll


def test_entferntes_konto_ist_nicht_mehr_veraenderbar(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "carla@test.example", ["planer"])
    headers = _kopf(api, ADMIN)
    entfernt = _entfernen(api, headers, person)
    kopf = _mit_version(headers, entfernt["version"])
    pfad = f"/api/v1/members/{person.member_id}"
    for response in (
        api.post(f"{pfad}/reactivate", headers=kopf),
        api.post(f"{pfad}/suspend", headers=kopf, json={}),
        api.patch(pfad, headers=kopf, json={"full_name": "Wieder da"}),
        api.post(f"{pfad}/password-reset", headers=headers),
        api.post(f"{pfad}/remove", headers=kopf, json={"confirm_email": "carla@test.example"}),
        api.put(f"{pfad}/roles", headers=kopf, json={"role_keys": ["planer"]}),
    ):
        assert response.status_code == 409, response.text
        assert response.json()["type"].endswith("/member-removed")


def test_fruehere_email_kann_neu_eingeladen_werden(
    app: FastAPI, api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "dora@test.example", ["planer"])
    headers = _kopf(api, ADMIN)
    _entfernen(api, headers, person)
    einladung = api.post(
        "/api/v1/invitations",
        headers=headers,
        json={"email": "dora@test.example", "role_keys": ["monteur"]},
    )
    assert einladung.status_code == 201, einladung.text
    token = token_aus_link(einladung.json()["development_activation_url"])
    oeffentlich = TestClient(app, raise_server_exceptions=False)
    annahme = oeffentlich.post(
        "/api/v1/invitation-acceptance/new-account",
        headers=ORIGIN,
        json={"token": token, "full_name": "Dora Neu", "password": NEUES_PASSWORT},
    )
    assert annahme.status_code == 201, annahme.text
    assert _anmeldung(oeffentlich, "dora@test.example", NEUES_PASSWORT) == 200
    session = fabrik(engine)()
    try:
        neu = session.execute(select(User).where(User.email == "dora@test.example")).scalar_one()
        assert neu.id != person.user_id
    finally:
        session.close()


def test_selbst_entfernen_und_letzter_administrator_sind_ausgeschlossen(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    session = fabrik(engine)()
    try:
        eigene_rolle_anlegen(
            session,
            betrieb,
            "test_entferner",
            ("user.account.read", "user.account.remove", "user.account.lock"),
        )
        session.commit()
    finally:
        session.close()
    entferner = person_anlegen(engine, betrieb, "entferner@test.example", ["test_entferner"])
    admin = admin_mitglied(engine, betrieb, ADMIN)
    admin_headers = _kopf(api, ADMIN)
    eigene = api.post(
        f"/api/v1/members/{admin.member_id}/remove",
        headers=_mit_version(
            admin_headers, _mitglied(api, admin_headers, admin.member_id)["version"]
        ),
        json={"confirm_email": ADMIN},
    )
    assert eigene.status_code == 409
    assert eigene.json()["type"].endswith("/self-lockout")

    headers = _kopf(api, entferner.email)
    version = _mitglied(api, headers, admin.member_id)["version"]
    detail = _mitglied(api, headers, admin.member_id)
    assert detail["is_last_active_administrator"] is True
    for response in (
        api.post(
            f"/api/v1/members/{admin.member_id}/remove",
            headers=_mit_version(headers, version),
            json={"confirm_email": ADMIN},
        ),
        api.post(
            f"/api/v1/members/{admin.member_id}/suspend",
            headers=_mit_version(headers, version),
            json={},
        ),
    ):
        assert response.status_code == 409
        assert response.json()["type"].endswith("/last-administrator")


def test_geteiltes_konto_bleibt_im_anderen_betrieb_bestehen(
    api: TestClient, engine: Engine, registry: ModuleRegistry, betrieb: uuid.UUID
) -> None:
    anderer = _zweiter_betrieb(engine, registry, "Elektro Anders GmbH", "admin@anders.example")
    person = person_anlegen(engine, betrieb, "emil@test.example", ["planer"], name="Emil Zwei")
    person_anlegen(engine, anderer, "emil@test.example", ["planer"])
    headers = auth_headers(login(api, ADMIN))
    entfernt = _entfernen(api, headers, person)
    assert entfernt["full_name"] is None
    session = fabrik(engine)()
    try:
        konto = session.get(User, person.user_id)
        assert konto is not None and konto.email == "emil@test.example" and konto.is_active
    finally:
        session.close()
    # Im anderen Betrieb arbeitet die Person weiter.
    token = login(api, "emil@test.example")
    assert api.get("/api/v1/me", headers=auth_headers(token)).json()["organization"]["id"] == str(
        anderer
    )


def test_lebenszyklus_ist_mandantengetrennt(
    api: TestClient, engine: Engine, registry: ModuleRegistry, betrieb: uuid.UUID
) -> None:
    fremd = _zweiter_betrieb(engine, registry, "Elektro Fremd GmbH", "admin@fremd.example")
    fremde_person = person_anlegen(engine, fremd, "fritz@fremd.example", ["planer"])
    headers = _kopf(api, ADMIN)
    kopf = _mit_version(headers, 1)
    pfad = f"/api/v1/members/{fremde_person.member_id}"
    for response in (
        api.patch(pfad, headers=kopf, json={"full_name": "Uebernommen"}),
        api.post(f"{pfad}/suspend", headers=kopf, json={}),
        api.post(f"{pfad}/reactivate", headers=kopf),
        api.post(f"{pfad}/password-reset", headers=headers),
        api.post(f"{pfad}/remove", headers=kopf, json={"confirm_email": fremde_person.email}),
    ):
        assert response.status_code == 404, response.text
        assert "fremd" not in response.text.lower()
    assert _anmeldung(api, fremde_person.email) == 200


# ------------------------------------------------------------- Berechtigungen

NEUE_ADMINRECHTE = (
    "user.profile.write",
    "user.account.lock",
    "user.password.reset",
    "user.account.remove",
)


def test_neue_rechte_liegen_nach_dem_seed_nur_beim_administrator(
    engine: Engine, registry: ModuleRegistry, betrieb: uuid.UUID
) -> None:
    # Ein zweiter Seed-Lauf darf nichts verdoppeln oder entziehen.
    _zweiter_betrieb(engine, registry, "Elektro Testbetrieb GmbH", ADMIN)
    session = fabrik(engine)()
    try:
        zeilen = session.execute(
            select(Role.key, Permission.key)
            .join(RolePermission, RolePermission.role_id == Role.id)
            .join(Permission, Permission.id == RolePermission.permission_id)
            .where(Role.organization_id == betrieb)
        ).all()
        for recht in NEUE_ADMINRECHTE:
            assert {rolle for rolle, schluessel in zeilen if schluessel == recht} == {"admin"}, (
                recht
            )
        mit_einstellungen = {
            rolle for rolle, schluessel in zeilen if schluessel == "user.preferences.write"
        }
        assert mit_einstellungen == {"admin", "planer", "kalkulator", "monteur", "lager", "einkauf"}
        doppelt = len(zeilen) - len(set(zeilen))
        assert doppelt == 0
    finally:
        session.close()


def test_ohne_recht_verweigert_der_server_jede_lebenszyklusaktion(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    session = fabrik(engine)()
    try:
        # Lesen und einladen ja - aber keines der neuen Rechte.
        eigene_rolle_anlegen(
            session,
            betrieb,
            "test_alter_verwalter",
            ("user.account.read", "user.account.write", "role.assignment.write"),
        )
        session.commit()
    finally:
        session.close()
    verwalter = person_anlegen(engine, betrieb, "verwalter@test.example", ["test_alter_verwalter"])
    ziel = person_anlegen(engine, betrieb, "ziel@test.example", ["planer"])
    headers = _kopf(api, verwalter.email)
    kopf = _mit_version(headers, _mitglied(api, headers, ziel.member_id)["version"])
    pfad = f"/api/v1/members/{ziel.member_id}"
    for response in (
        api.patch(pfad, headers=kopf, json={"full_name": "X"}),
        api.post(f"{pfad}/suspend", headers=kopf, json={}),
        api.post(f"{pfad}/reactivate", headers=kopf),
        api.post(f"{pfad}/password-reset", headers=headers),
        api.post(f"{pfad}/remove", headers=kopf, json={"confirm_email": ziel.email}),
    ):
        assert response.status_code == 403, response.text


def test_entfernte_berechtigung_hinterlaesst_keine_rollenzuordnung(
    engine: Engine, betrieb: uuid.UUID
) -> None:
    session = fabrik(engine)()
    try:
        recht = session.execute(
            select(Permission).where(Permission.key == "user.password.reset")
        ).scalar_one()
        session.delete(recht)
        session.commit()
        verwaist = session.execute(
            select(RolePermission).where(RolePermission.permission_id == recht.id)
        ).first()
        assert verwaist is None
    finally:
        session.close()
