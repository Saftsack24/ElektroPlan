"""Einladung und Annahme (Phase 4.2, ADR 0015).

Schwerpunkt Sicherheit: Token nur als Hash, begrenzte Gueltigkeit, einmalige
Verwendung, Widerruf, Neuausstellung, kein Token in Protokoll und Logs, keine
Uebernahme eines bestehenden Kontos, keine vorgetaeuschte Zustellung.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import Engine, select, text, update

from app.config import Settings, get_settings
from app.core.audit.models import AuditEntry
from app.core.auth.service import LOGIN_REJECTED, _login_limiter
from app.core.invitations.models import MemberInvitation
from app.core.invitations.service import purge_invitations, reset_acceptance_limiter
from app.core.module_registry.registry import ModuleRegistry
from app.core.organizations.models import OrganizationMember
from app.core.seed import seed_initial_data
from app.core.users.models import User
from app.db.mixins import utcnow
from tests.conftest import ADMIN_PASSWORD, auth_headers, login, requires_database
from tests.verwaltung_hilfen import (
    fabrik,
    person_anlegen,
    rollen_fuer_tests_anlegen,
    token_aus_link,
)

pytestmark = [requires_database, pytest.mark.database]

ADMIN = "admin@test.example"
NEUES_PASSWORT = "neues-konto-passwort-2026"


@pytest.fixture(autouse=True)
def _limiter_zuruecksetzen() -> Iterator[None]:
    _login_limiter.clear()
    reset_acceptance_limiter()
    yield
    _login_limiter.clear()
    reset_acceptance_limiter()


@pytest.fixture
def betrieb(
    api: TestClient, engine: Engine, seeded_organization: dict[str, uuid.UUID]
) -> uuid.UUID:
    organization_id = seeded_organization["organization_id"]
    rollen_fuer_tests_anlegen(engine, organization_id)
    return organization_id


@pytest.fixture
def admin(api: TestClient, betrieb: uuid.UUID) -> dict[str, str]:
    return auth_headers(login(api, ADMIN))


def _einladen(
    api: TestClient,
    headers: dict[str, str],
    email: str = "neu@test.example",
    rollen: list[str] | None = None,
    name: str | None = "Nina Neu",
) -> dict[str, Any]:
    koerper: dict[str, Any] = {"email": email, "role_keys": rollen or ["planer"]}
    if name is not None:
        koerper["full_name"] = name
    response = api.post("/api/v1/invitations", headers=headers, json=koerper)
    assert response.status_code == 201, response.text
    ergebnis: dict[str, Any] = response.json()
    return ergebnis


def _vorschau(api: TestClient, token: str) -> Any:
    return api.post("/api/v1/invitation-acceptance/preview", json={"token": token})


def _neues_konto(api: TestClient, token: str, passwort: str = NEUES_PASSWORT) -> Any:
    return api.post(
        "/api/v1/invitation-acceptance/new-account",
        json={"token": token, "full_name": "Nina Neu", "password": passwort},
    )


def _bestehendes_konto(api: TestClient, token: str, passwort: str) -> Any:
    return api.post(
        "/api/v1/invitation-acceptance/existing-account",
        json={"token": token, "password": passwort},
    )


def _zweiter_betrieb(engine: Engine, registry: ModuleRegistry) -> uuid.UUID:
    session = fabrik(engine)()
    try:
        result = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Zweitbetrieb GmbH",
            admin_email="admin@zweit.example",
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
        return result.organization_id
    finally:
        session.close()


# ------------------------------------------------------------------- Anlegen


def test_einladung_anlegen_liefert_den_link_nur_einmal(
    api: TestClient, engine: Engine, admin: dict[str, str]
) -> None:
    ergebnis = _einladen(api, admin, email="  Neu@Test.Example ", rollen=["planer", "monteur"])
    einladung = ergebnis["invitation"]
    assert einladung["email"] == "neu@test.example"
    assert einladung["status"] == "pending"
    assert {r["key"] for r in einladung["roles"]} == {"planer", "monteur"}
    assert ergebnis["delivery"] == "development_link"
    link = ergebnis["development_activation_url"]
    assert link.startswith("http://localhost:5173/einladung#t=")
    token = token_aus_link(link)
    assert len(token) >= 43

    # Spaeter nicht mehr abrufbar - weder Token noch Link.
    detail = api.get(f"/api/v1/invitations/{einladung['id']}", headers=admin)
    assert detail.status_code == 200
    assert token not in detail.text
    assert "einladung#" not in detail.text
    liste = api.get("/api/v1/members", headers=admin, params={"status": "invited"})
    assert token not in liste.text


def test_token_wird_nur_als_hash_gespeichert(
    api: TestClient, engine: Engine, admin: dict[str, str]
) -> None:
    ergebnis = _einladen(api, admin)
    token = token_aus_link(ergebnis["development_activation_url"])
    session = fabrik(engine)()
    try:
        einladung = session.get(MemberInvitation, uuid.UUID(ergebnis["invitation"]["id"]))
        assert einladung is not None
        assert einladung.token_hash == hashlib.sha256(token.encode()).hexdigest()
        zeile = session.execute(
            text("SELECT row_to_json(e)::text FROM member_invitations e")
        ).scalar_one()
        assert token not in zeile
    finally:
        session.close()


def test_keine_token_in_protokoll_und_logs(
    api: TestClient, engine: Engine, admin: dict[str, str], capfd: pytest.CaptureFixture[str]
) -> None:
    ergebnis = _einladen(api, admin)
    erster = token_aus_link(ergebnis["development_activation_url"])
    neu = api.post(
        f"/api/v1/invitations/{ergebnis['invitation']['id']}/reissue",
        headers={**admin, "If-Match": str(ergebnis["invitation"]["version"])},
    ).json()
    zweiter = token_aus_link(neu["development_activation_url"])
    assert _vorschau(api, erster).status_code == 404
    assert _neues_konto(api, zweiter).status_code == 201

    ausgabe = capfd.readouterr()
    protokolliert = ausgabe.out + ausgabe.err
    # Gegenprobe: Die Zugriffsprotokolle wurden tatsaechlich mitgeschnitten.
    assert "/api/v1/invitation-acceptance/new-account" in protokolliert
    assert "invitation_rejected" in protokolliert
    for geheim in (erster, zweiter, NEUES_PASSWORT, "einladung#t="):
        assert geheim not in protokolliert

    session = fabrik(engine)()
    try:
        eintraege = session.execute(
            text("SELECT row_to_json(a)::text FROM audit_entries a")
        ).scalars()
        alles = "\n".join(eintraege)
        for geheim in (erster, zweiter, NEUES_PASSWORT, "neu@test.example", "einladung#"):
            assert geheim not in alles
        aktionen = set(session.execute(select(AuditEntry.action)).scalars())
        assert {"invitation.created", "invitation.reissued", "invitation.accepted"} <= aktionen
    finally:
        session.close()


def test_einladung_fuer_mitglied_oder_doppelt_wird_abgelehnt(
    api: TestClient, admin: dict[str, str]
) -> None:
    doppelt_mitglied = api.post(
        "/api/v1/invitations", headers=admin, json={"email": ADMIN, "role_keys": ["planer"]}
    )
    assert doppelt_mitglied.status_code == 409
    _einladen(api, admin)
    doppelt_offen = api.post(
        "/api/v1/invitations",
        headers=admin,
        json={"email": "NEU@test.example", "role_keys": ["planer"]},
    )
    assert doppelt_offen.status_code == 409


@pytest.mark.parametrize(
    "koerper",
    [
        {"email": "keine-mail", "role_keys": ["planer"]},
        {"email": "neu@test.example", "role_keys": []},
        {"email": "neu@test.example", "role_keys": ["chef"]},
        {"email": "neu@test.example", "role_keys": ["test_leser"]},
        {"email": "neu@test.example", "role_keys": ["planer"], "password": "x"},
    ],
)
def test_ungueltige_einladung_wird_abgelehnt(
    api: TestClient, engine: Engine, admin: dict[str, str], koerper: dict[str, Any]
) -> None:
    response = api.post("/api/v1/invitations", headers=admin, json=koerper)
    assert response.status_code == 422
    session = fabrik(engine)()
    try:
        assert session.execute(select(MemberInvitation)).first() is None
    finally:
        session.close()


def test_ohne_zustellweg_wird_nichts_angelegt(
    api: TestClient, engine: Engine, admin: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    offen = _einladen(api, admin, email="vorher@test.example")
    monkeypatch.setattr(get_settings(), "invitation_delivery", "none")
    assert api.get("/api/v1/invitations/policy", headers=admin).json()["delivery"] == "none"
    response = api.post(
        "/api/v1/invitations",
        headers=admin,
        json={"email": "spaeter@test.example", "role_keys": ["planer"]},
    )
    assert response.status_code == 503
    assert response.json()["type"].endswith("/invitation-delivery-unavailable")
    erneut = api.post(
        f"/api/v1/invitations/{offen['invitation']['id']}/reissue",
        headers={**admin, "If-Match": str(offen["invitation"]["version"])},
    )
    assert erneut.status_code == 503
    session = fabrik(engine)()
    try:
        emails = set(session.execute(select(MemberInvitation.email)).scalars())
        assert emails == {"vorher@test.example"}
    finally:
        session.close()


def test_entwicklungslink_ist_in_produktion_verboten(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ELEKTROPLAN_INVITATION_DELIVERY", raising=False)
    # Auch der Reset-Link-Zustellweg ist in Produktion verboten (Phase 4e) - hier neutral.
    monkeypatch.delenv("ELEKTROPLAN_PASSWORD_RESET_DELIVERY", raising=False)
    with pytest.raises(ValidationError, match="development_link"):
        Settings(
            environment="production",
            jwt_secret="x" * 40,
            s3_secret_key="geheim",
            invitation_delivery="development_link",
        )
    produktion = Settings(environment="production", jwt_secret="x" * 40, s3_secret_key="geheim")
    assert produktion.invitation_delivery == "none"
    assert produktion.password_reset_delivery == "none"


# -------------------------------------------------------- Widerruf / Neuausstellung


def test_widerruf_macht_das_token_wertlos(api: TestClient, admin: dict[str, str]) -> None:
    ergebnis = _einladen(api, admin)
    einladung = ergebnis["invitation"]
    token = token_aus_link(ergebnis["development_activation_url"])
    pfad = f"/api/v1/invitations/{einladung['id']}/revoke"

    assert api.post(pfad, headers=admin).status_code == 428
    assert api.post(pfad, headers={**admin, "If-Match": "99"}).status_code == 409
    widerrufen = api.post(pfad, headers={**admin, "If-Match": str(einladung["version"])})
    assert widerrufen.status_code == 200
    assert widerrufen.json()["status"] == "revoked"

    for antwort in (_vorschau(api, token), _neues_konto(api, token)):
        assert antwort.status_code == 404
        assert antwort.json()["type"].endswith("/invitation-invalid")
    # Aus der Liste verschwunden, erneutes Ausstellen nicht mehr moeglich.
    liste = api.get("/api/v1/members", headers=admin, params={"status": "invited"}).json()
    assert liste["items"] == []
    nochmal = api.post(
        f"/api/v1/invitations/{einladung['id']}/reissue",
        headers={**admin, "If-Match": str(einladung["version"] + 1)},
    )
    assert nochmal.status_code == 409
    # Die Adresse ist wieder frei fuer eine neue Einladung.
    _einladen(api, admin)


def test_neuausstellung_macht_das_alte_token_ungueltig(
    api: TestClient, admin: dict[str, str]
) -> None:
    ergebnis = _einladen(api, admin)
    alt = token_aus_link(ergebnis["development_activation_url"])
    neu_ergebnis = api.post(
        f"/api/v1/invitations/{ergebnis['invitation']['id']}/reissue",
        headers={**admin, "If-Match": str(ergebnis["invitation"]["version"])},
    )
    assert neu_ergebnis.status_code == 200
    neu = token_aus_link(neu_ergebnis.json()["development_activation_url"])
    assert neu != alt
    assert neu_ergebnis.json()["invitation"]["version"] == ergebnis["invitation"]["version"] + 1

    assert _vorschau(api, alt).status_code == 404
    assert _neues_konto(api, alt).status_code == 404
    assert _vorschau(api, neu).status_code == 200


def test_abgelaufenes_token_wird_abgelehnt_und_kann_neu_ausgestellt_werden(
    api: TestClient, engine: Engine, admin: dict[str, str]
) -> None:
    ergebnis = _einladen(api, admin)
    token = token_aus_link(ergebnis["development_activation_url"])
    session = fabrik(engine)()
    try:
        einladung = session.get(MemberInvitation, uuid.UUID(ergebnis["invitation"]["id"]))
        assert einladung is not None
        einladung.expires_at = utcnow() - timedelta(minutes=1)
        session.commit()
        version = einladung.version
    finally:
        session.close()

    assert _vorschau(api, token).status_code == 404
    assert _neues_konto(api, token).status_code == 404
    eintrag = api.get("/api/v1/members", headers=admin, params={"status": "invited"}).json()
    assert eintrag["items"][0]["invitation_expired"] is True

    neu = api.post(
        f"/api/v1/invitations/{ergebnis['invitation']['id']}/reissue",
        headers={**admin, "If-Match": str(version)},
    )
    assert neu.status_code == 200
    assert neu.json()["invitation"]["status"] == "pending"
    neues_token = token_aus_link(neu.json()["development_activation_url"])
    assert _vorschau(api, neues_token).status_code == 200


# ------------------------------------------------------------ Annahme: neu


def test_annahme_mit_neuem_konto_ist_atomar_und_einmalig(
    api: TestClient, engine: Engine, admin: dict[str, str], betrieb: uuid.UUID
) -> None:
    ergebnis = _einladen(api, admin, rollen=["planer", "monteur"])
    token = token_aus_link(ergebnis["development_activation_url"])

    vorschau = _vorschau(api, token)
    assert vorschau.status_code == 200
    assert vorschau.json() == {
        "organization_name": "Elektro Testbetrieb GmbH",
        "email": "neu@test.example",
        "full_name": "Nina Neu",
        "expires_at": vorschau.json()["expires_at"],
        "account_exists": False,
    }

    angenommen = _neues_konto(api, token)
    assert angenommen.status_code == 201, angenommen.text
    assert angenommen.json() == {
        "organization_name": "Elektro Testbetrieb GmbH",
        "email": "neu@test.example",
    }
    # Einmalig: Das Token ist verbraucht.
    zweites_mal = _neues_konto(api, token)
    assert zweites_mal.status_code == 404
    assert zweites_mal.json()["type"].endswith("/invitation-invalid")

    session = fabrik(engine)()
    try:
        user = session.execute(select(User).where(User.email == "neu@test.example")).scalar_one()
        member = session.execute(
            select(OrganizationMember).where(OrganizationMember.user_id == user.id)
        ).scalar_one()
        assert member.organization_id == betrieb
        assert member.status == "active"
        einladung = session.get(MemberInvitation, uuid.UUID(ergebnis["invitation"]["id"]))
        assert einladung is not None and einladung.accepted_at is not None
    finally:
        session.close()

    neu_headers = auth_headers(login(api, "neu@test.example", NEUES_PASSWORT))
    me = api.get("/api/v1/me", headers=neu_headers).json()
    assert {r["key"] for r in me["roles"]} == {"planer", "monteur"}
    assert "project.record.write" in me["permissions"]
    assert "user.account.read" not in me["permissions"]
    assert api.get("/api/v1/members", headers=neu_headers).status_code == 403


def test_passwortregeln_gelten_auch_bei_der_annahme(
    api: TestClient, engine: Engine, admin: dict[str, str]
) -> None:
    token = token_aus_link(_einladen(api, admin)["development_activation_url"])
    zu_kurz = _neues_konto(api, token, passwort="kurz")
    assert zu_kurz.status_code == 422
    assert zu_kurz.json()["errors"][0]["field"] == "password"
    # Nichts angelegt, Einladung weiter offen.
    assert _vorschau(api, token).status_code == 200
    session = fabrik(engine)()
    try:
        assert session.execute(select(User).where(User.email == "neu@test.example")).first() is None
    finally:
        session.close()


# ------------------------------------------------------- Annahme: bestehend


def test_deaktiviertes_konto_bei_der_annahme_wie_falsches_passwort(
    api: TestClient, engine: Engine, admin: dict[str, str], registry: ModuleRegistry
) -> None:
    """Auch die Pruefung bestehender Zugangsdaten verraet keinen Kontozustand."""
    fremd = _zweiter_betrieb(engine, registry)
    person_anlegen(
        engine, fremd, "ruhend@zweit.example", ["planer"], passwort="altes-passwort-1234"
    )
    session = fabrik(engine)()
    try:
        session.execute(
            update(User).where(User.email == "ruhend@zweit.example").values(is_active=False)
        )
        session.commit()
    finally:
        session.close()
    token = token_aus_link(
        _einladen(api, admin, email="ruhend@zweit.example", name="Ruhend")[
            "development_activation_url"
        ]
    )

    richtig = _bestehendes_konto(api, token, "altes-passwort-1234")
    falsch = _bestehendes_konto(api, token, "angreifer-passwort-99")
    for antwort in (richtig, falsch):
        assert antwort.status_code == 401
        assert antwort.json()["type"].endswith("/authentication-failed")
        assert antwort.json()["detail"] == LOGIN_REJECTED
    assert _vorschau(api, token).status_code == 200


def test_bestehendes_konto_wird_nie_uebernommen(
    api: TestClient, engine: Engine, admin: dict[str, str], registry: ModuleRegistry
) -> None:
    """Die Einladung einer Adresse mit Konto aendert weder Passwort noch Name."""
    fremd = _zweiter_betrieb(engine, registry)
    person_anlegen(
        engine,
        fremd,
        "profi@zweit.example",
        ["planer"],
        name="Paula Profi",
        passwort="altes-passwort-1234",
    )
    session = fabrik(engine)()
    try:
        vorher = session.execute(
            select(User).where(User.email == "profi@zweit.example")
        ).scalar_one()
        hash_vorher = vorher.password_hash
    finally:
        session.close()

    ergebnis = _einladen(api, admin, email="profi@zweit.example", name="Anderer Name")
    token = token_aus_link(ergebnis["development_activation_url"])
    assert _vorschau(api, token).json()["account_exists"] is True

    # Der Weg "neues Konto" setzt kein Passwort.
    uebernahme = _neues_konto(api, token, passwort="angreifer-passwort-99")
    assert uebernahme.status_code == 409
    assert uebernahme.json()["type"].endswith("/invitation-requires-login")
    # Falsches Passwort: dieselbe Meldung wie bei der Anmeldung.
    falsch = _bestehendes_konto(api, token, "angreifer-passwort-99")
    assert falsch.status_code == 401
    assert falsch.json()["detail"] == LOGIN_REJECTED

    session = fabrik(engine)()
    try:
        user = session.execute(select(User).where(User.email == "profi@zweit.example")).scalar_one()
        assert user.password_hash == hash_vorher
        assert user.full_name == "Paula Profi"
        mitgliedschaften = session.execute(
            select(OrganizationMember).where(OrganizationMember.user_id == user.id)
        ).all()
        assert len(mitgliedschaften) == 1
    finally:
        session.close()
    assert _vorschau(api, token).status_code == 200

    richtig = _bestehendes_konto(api, token, "altes-passwort-1234")
    assert richtig.status_code == 201, richtig.text

    session = fabrik(engine)()
    try:
        user = session.execute(select(User).where(User.email == "profi@zweit.example")).scalar_one()
        assert user.password_hash == hash_vorher
        assert user.full_name == "Paula Profi"
    finally:
        session.close()
    # Jetzt zwei Betriebe: Die Anmeldung verlangt eine Auswahl.
    anmeldung = api.post(
        "/api/v1/auth/login",
        json={"email": "profi@zweit.example", "password": "altes-passwort-1234"},
    )
    assert anmeldung.status_code == 409
    assert len(anmeldung.json()["organizations"]) == 2
    assert _bestehendes_konto(api, token, "altes-passwort-1234").status_code == 404


def test_bestehendes_konto_wird_nur_mit_der_eingeladenen_adresse_geprueft(
    api: TestClient, engine: Engine, admin: dict[str, str], betrieb: uuid.UUID
) -> None:
    """Das Passwort eines **anderen** Kontos nimmt die Einladung nicht an."""
    person_anlegen(engine, betrieb, "planer@test.example", ["planer"])
    token = token_aus_link(_einladen(api, admin)["development_activation_url"])
    # ``neu@test.example`` hat kein Konto; das Admin-Passwort hilft nicht.
    assert _bestehendes_konto(api, token, ADMIN_PASSWORD).status_code == 401
    assert _vorschau(api, token).status_code == 200


# -------------------------------------------------------------- Missbrauch


def test_fehlversuche_werden_begrenzt(api: TestClient, admin: dict[str, str]) -> None:
    grenze = get_settings().invitation_attempts_per_window
    for nummer in range(grenze):
        response = _vorschau(api, f"falsch-{nummer}")
        assert response.status_code == 404
    gesperrt = _vorschau(api, "falsch-letzter")
    assert gesperrt.status_code == 429
    # Auch ein gueltiges Token wird dann nicht mehr ausgewertet.
    token = token_aus_link(_einladen(api, admin)["development_activation_url"])
    assert _vorschau(api, token).status_code == 429


def test_fehler_sind_fuer_alle_ungueltigen_tokens_gleich(
    api: TestClient, admin: dict[str, str]
) -> None:
    ergebnis = _einladen(api, admin)
    token = token_aus_link(ergebnis["development_activation_url"])
    api.post(
        f"/api/v1/invitations/{ergebnis['invitation']['id']}/revoke",
        headers={**admin, "If-Match": str(ergebnis["invitation"]["version"])},
    )
    antworten = [_vorschau(api, t).json() for t in (token, "x" * 43, "x" * 400)]
    typen = {a["type"] for a in antworten[:2]}
    assert typen == {"https://elektroplan.internal/errors/invitation-invalid"}
    assert antworten[0]["detail"] == antworten[1]["detail"]
    # Ueberlange Tokens scheitern schon an der Eingabepruefung.
    assert antworten[2]["status"] == 422


def test_fremde_herkunft_wird_abgelehnt(api: TestClient, admin: dict[str, str]) -> None:
    token = token_aus_link(_einladen(api, admin)["development_activation_url"])
    response = api.post(
        "/api/v1/invitation-acceptance/preview",
        json={"token": token},
        headers={"Origin": "https://boese.example"},
    )
    assert response.status_code == 403


# ---------------------------------------------------------------- Aufraeumen


def test_alte_einladungen_werden_entfernt(
    api: TestClient, engine: Engine, admin: dict[str, str]
) -> None:
    ids = {
        email: uuid.UUID(_einladen(api, admin, email=email)["invitation"]["id"])
        for email in (
            "alt-angenommen@test.example",
            "alt-widerrufen@test.example",
            "alt-abgelaufen@test.example",
            "frisch-widerrufen@test.example",
            "offen@test.example",
        )
    }
    jetzt = utcnow()
    lange_her = jetzt - timedelta(days=45)
    session = fabrik(engine)()
    try:
        for email, einladung_id in ids.items():
            einladung = session.get(MemberInvitation, einladung_id)
            assert einladung is not None
            if email == "alt-angenommen@test.example":
                einladung.accepted_at = lange_her
            elif email == "alt-widerrufen@test.example":
                einladung.revoked_at = lange_her
            elif email == "alt-abgelaufen@test.example":
                einladung.expires_at = lange_her
            elif email == "frisch-widerrufen@test.example":
                einladung.revoked_at = jetzt - timedelta(days=2)
        session.commit()
        entfernt = purge_invitations(session, now=jetzt, retention_days=30)
        session.commit()
        assert entfernt == 3
        rest = set(session.execute(select(MemberInvitation.email)).scalars())
        assert rest == {"frisch-widerrufen@test.example", "offen@test.example"}
    finally:
        session.close()
