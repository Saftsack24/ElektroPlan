"""Benutzerverwaltung eines Betriebs (Phase 4.2, ADR 0015).

Geprueft ueber die HTTP-Schnittstelle gegen PostgreSQL: Berechtigungen,
Mandantentrennung, Liste und Pagination, Sperren und Reaktivieren, Rollen,
effektive Berechtigungen, sofortige Wirkung, letzter Administrator,
Selbstaussperrung und Protokoll.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select

from app.core.audit.models import AuditEntry
from app.core.auth.models import RefreshToken
from app.core.auth.service import _login_limiter
from app.core.module_registry.registry import ModuleRegistry
from app.core.organizations.models import OrganizationMember
from app.core.seed import seed_initial_data
from app.core.users.models import User
from tests.conftest import ADMIN_PASSWORD, auth_headers, login, requires_database
from tests.verwaltung_hilfen import (
    LESER_ROLLE,
    VERWALTER_ROLLE,
    admin_mitglied,
    fabrik,
    person_anlegen,
    rollen_fuer_tests_anlegen,
)

pytestmark = [requires_database, pytest.mark.database]

ADMIN = "admin@test.example"


@pytest.fixture(autouse=True)
def _limiter_zuruecksetzen() -> Iterator[None]:
    _login_limiter.clear()
    yield
    _login_limiter.clear()


@pytest.fixture
def betrieb(
    api: TestClient, engine: Engine, seeded_organization: dict[str, uuid.UUID]
) -> uuid.UUID:
    organization_id = seeded_organization["organization_id"]
    rollen_fuer_tests_anlegen(engine, organization_id)
    return organization_id


def _anmelden(api: TestClient, email: str) -> dict[str, str]:
    return auth_headers(login(api, email))


def _mitglied(api: TestClient, headers: dict[str, str], member_id: uuid.UUID) -> dict:
    response = api.get(f"/api/v1/members/{member_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _alle_seiten(api: TestClient, headers: dict[str, str], **query: str) -> list[dict]:
    eintraege: list[dict] = []
    cursor: str | None = None
    for _ in range(50):
        params = {"limit": "2", **query}
        if cursor:
            params["cursor"] = cursor
        response = api.get("/api/v1/members", headers=headers, params=params)
        assert response.status_code == 200, response.text
        seite = response.json()
        eintraege.extend(seite["items"])
        if not seite["has_more"]:
            return eintraege
        cursor = seite["next_cursor"]
    raise AssertionError("Pagination endet nicht")


# -------------------------------------------------------------- Berechtigungen


def test_ohne_leserecht_ist_die_verwaltung_verschlossen(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    monteur = person_anlegen(engine, betrieb, "monteur@test.example", ["monteur"])
    headers = _anmelden(api, monteur.email)
    admin = admin_mitglied(engine, betrieb, ADMIN)

    for methode, pfad in (
        ("GET", "/api/v1/members"),
        ("GET", f"/api/v1/members/{admin.member_id}"),
        ("GET", f"/api/v1/members/{admin.member_id}/permissions"),
        ("GET", "/api/v1/roles"),
        ("GET", "/api/v1/invitations/policy"),
    ):
        response = api.request(methode, pfad, headers=headers)
        assert response.status_code == 403, f"{methode} {pfad}: {response.status_code}"


def test_lesen_ohne_schreibrecht(api: TestClient, engine: Engine, betrieb: uuid.UUID) -> None:
    leser = person_anlegen(engine, betrieb, "leser@test.example", [LESER_ROLLE])
    ziel = person_anlegen(engine, betrieb, "ziel@test.example", ["planer"])
    headers = _anmelden(api, leser.email)

    assert api.get("/api/v1/members", headers=headers).status_code == 200
    assert api.get("/api/v1/roles", headers=headers).status_code == 200
    detail = _mitglied(api, headers, ziel.member_id)
    version = {"If-Match": str(detail["version"])}

    for pfad, koerper in (
        (f"/api/v1/members/{ziel.member_id}/suspend", None),
        (f"/api/v1/members/{ziel.member_id}/reactivate", None),
        ("/api/v1/invitations", {"email": "x@test.example", "role_keys": ["planer"]}),
    ):
        response = api.post(pfad, headers={**headers, **version}, json=koerper)
        assert response.status_code == 403, pfad
    response = api.put(
        f"/api/v1/members/{ziel.member_id}/roles",
        headers={**headers, **version},
        json={"role_keys": ["monteur"]},
    )
    assert response.status_code == 403


def test_einladen_verlangt_auch_das_recht_zur_rollenvergabe(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    """``user.account.write`` allein genuegt nicht: Die Einladung vergibt Rollen."""
    from tests.verwaltung_hilfen import eigene_rolle_anlegen

    session = fabrik(engine)()
    try:
        eigene_rolle_anlegen(
            session, betrieb, "nur_konten", ("user.account.read", "user.account.write")
        )
        session.commit()
    finally:
        session.close()
    person = person_anlegen(engine, betrieb, "konten@test.example", ["nur_konten"])
    response = api.post(
        "/api/v1/invitations",
        headers=_anmelden(api, person.email),
        json={"email": "neu@test.example", "role_keys": ["planer"]},
    )
    assert response.status_code == 403


# ------------------------------------------------------------- Liste und Detail


def test_liste_sucht_filtert_und_blaettert(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person_anlegen(engine, betrieb, "anna@test.example", ["planer"], name="Anna Albrecht")
    person_anlegen(engine, betrieb, "bernd@test.example", ["monteur"], name="Bernd Becker")
    person_anlegen(
        engine, betrieb, "carla@test.example", ["monteur"], name="Carla Clausen", status="disabled"
    )
    headers = _anmelden(api, ADMIN)
    for email in ("dora@test.example", "emil@test.example"):
        response = api.post(
            "/api/v1/invitations", headers=headers, json={"email": email, "role_keys": ["lager"]}
        )
        assert response.status_code == 201, response.text

    alle = _alle_seiten(api, headers)
    # Admin + drei Personen + zwei Einladungen - jeder genau einmal.
    assert len(alle) == 6
    assert len({eintrag["id"] for eintrag in alle}) == 6
    anzeigen = [(e["full_name"] or e["email"]).lower() for e in alle]
    assert anzeigen == sorted(anzeigen)

    eingeladen = _alle_seiten(api, headers, status="invited")
    assert {e["email"] for e in eingeladen} == {"dora@test.example", "emil@test.example"}
    assert all(e["kind"] == "invitation" and e["roles"][0]["key"] == "lager" for e in eingeladen)

    gesperrt = _alle_seiten(api, headers, status="disabled")
    assert [e["email"] for e in gesperrt] == ["carla@test.example"]

    aktiv = _alle_seiten(api, headers, status="active")
    assert {e["email"] for e in aktiv} == {ADMIN, "anna@test.example", "bernd@test.example"}

    treffer = _alle_seiten(api, headers, q="BECK")
    assert [e["email"] for e in treffer] == ["bernd@test.example"]
    treffer = _alle_seiten(api, headers, q="emil@")
    assert [e["kind"] for e in treffer] == ["invitation"]


def test_detail_zeigt_keine_globalen_kontodaten_ausser_name_und_email(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "planer@test.example", ["planer"])
    detail = _mitglied(api, _anmelden(api, ADMIN), person.member_id)
    assert set(detail) == {
        "id",
        "full_name",
        "email",
        "status",
        "roles",
        "is_administrator",
        "is_self",
        "joined_at",
        "last_login_at",
        "version",
    }
    assert detail["is_self"] is False
    assert detail["roles"] == [{"key": "planer", "name": "Planer"}]


def test_letzte_anmeldung_gilt_je_betrieb(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "planer@test.example", ["planer"])
    headers = _anmelden(api, ADMIN)
    assert _mitglied(api, headers, person.member_id)["last_login_at"] is None
    vorher = _mitglied(api, headers, person.member_id)["version"]
    login(api, person.email)
    danach = _mitglied(api, headers, person.member_id)
    assert danach["last_login_at"] is not None
    # Die Anmeldung zaehlt die Version der Mitgliedschaft nicht weiter.
    assert danach["version"] == vorher


# ------------------------------------------------------ Sperren / Reaktivieren


def test_sperren_und_reaktivieren_mit_if_match(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "planer@test.example", ["planer"])
    headers = _anmelden(api, ADMIN)
    pfad = f"/api/v1/members/{person.member_id}"
    version = _mitglied(api, headers, person.member_id)["version"]

    assert api.post(f"{pfad}/suspend", headers=headers).status_code == 428
    veraltet = api.post(f"{pfad}/suspend", headers={**headers, "If-Match": str(version + 1)})
    assert veraltet.status_code == 409
    assert veraltet.json()["type"].endswith("/version-conflict")

    gesperrt = api.post(f"{pfad}/suspend", headers={**headers, "If-Match": str(version)})
    assert gesperrt.status_code == 200, gesperrt.text
    assert gesperrt.json()["status"] == "disabled"
    assert gesperrt.json()["version"] == version + 1

    doppelt = api.post(f"{pfad}/suspend", headers={**headers, "If-Match": str(version + 1)})
    assert doppelt.status_code == 409

    frei = api.post(f"{pfad}/reactivate", headers={**headers, "If-Match": str(version + 1)})
    assert frei.status_code == 200
    assert frei.json()["status"] == "active"


def test_sperre_wirkt_sofort_auf_access_und_refresh(
    app: FastAPI, api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "planer@test.example", ["planer"])
    with TestClient(app, raise_server_exceptions=False) as zweiter:
        member_headers = auth_headers(login(zweiter, person.email))
        assert zweiter.get("/api/v1/me", headers=member_headers).status_code == 200

        headers = _anmelden(api, ADMIN)
        version = _mitglied(api, headers, person.member_id)["version"]
        response = api.post(
            f"/api/v1/members/{person.member_id}/suspend",
            headers={**headers, "If-Match": str(version)},
        )
        assert response.status_code == 200

        # Der vorhandene Access Token reicht nicht mehr.
        assert zweiter.get("/api/v1/me", headers=member_headers).status_code == 401
        assert zweiter.get("/api/v1/projects", headers=member_headers).status_code == 401
        # Der Refresh stellt keine neue Sitzung aus.
        assert zweiter.post("/api/v1/auth/refresh").status_code == 401
        # Eine neue Anmeldung ebenso wenig.
        anmeldung = zweiter.post(
            "/api/v1/auth/login", json={"email": person.email, "password": ADMIN_PASSWORD}
        )
        assert anmeldung.status_code != 200

    session = fabrik(engine)()
    try:
        offene = session.execute(
            select(RefreshToken).where(
                RefreshToken.user_id == person.user_id, RefreshToken.revoked_at.is_(None)
            )
        ).all()
        assert offene == []
        gruende = set(
            session.execute(
                select(RefreshToken.revoked_reason).where(RefreshToken.user_id == person.user_id)
            ).scalars()
        )
        assert gruende == {"membership_disabled"}
        # Das globale Konto bleibt aktiv.
        assert session.get(User, person.user_id).is_active is True  # type: ignore[union-attr]
    finally:
        session.close()


def test_sperre_betrifft_keinen_anderen_betrieb(
    app: FastAPI,
    api: TestClient,
    engine: Engine,
    betrieb: uuid.UUID,
    registry: ModuleRegistry,
) -> None:
    session = fabrik(engine)()
    try:
        zweiter_betrieb = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Zweitbetrieb GmbH",
            admin_email="admin@zweit.example",
            admin_password=ADMIN_PASSWORD,
        ).organization_id
        session.commit()
    finally:
        session.close()
    person = person_anlegen(engine, betrieb, "beide@test.example", ["planer"])
    person_anlegen(engine, zweiter_betrieb, "beide@test.example", ["planer"])

    with TestClient(app, raise_server_exceptions=False) as zweiter:
        andere_sitzung = auth_headers(login(zweiter, person.email, organization_id=zweiter_betrieb))

        headers = _anmelden(api, ADMIN)
        version = _mitglied(api, headers, person.member_id)["version"]
        response = api.post(
            f"/api/v1/members/{person.member_id}/suspend",
            headers={**headers, "If-Match": str(version)},
        )
        assert response.status_code == 200

        me = zweiter.get("/api/v1/me", headers=andere_sitzung)
        assert me.status_code == 200
        assert me.json()["organization"]["id"] == str(zweiter_betrieb)
        assert zweiter.post("/api/v1/auth/refresh").status_code == 200
        # Die Anmeldung waehlt jetzt ohne Rueckfrage den verbliebenen Betrieb.
        erneut = zweiter.post(
            "/api/v1/auth/login", json={"email": person.email, "password": ADMIN_PASSWORD}
        )
        assert erneut.status_code == 200
        assert erneut.json()["organization_id"] == str(zweiter_betrieb)


def test_selbstsperrung_ist_ausgeschlossen(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    ich = admin_mitglied(engine, betrieb, ADMIN)
    person_anlegen(engine, betrieb, "admin2@test.example", ["admin"])
    headers = _anmelden(api, ADMIN)
    version = _mitglied(api, headers, ich.member_id)["version"]
    response = api.post(
        f"/api/v1/members/{ich.member_id}/suspend", headers={**headers, "If-Match": str(version)}
    )
    assert response.status_code == 409
    assert response.json()["type"].endswith("/self-lockout")


def test_letzter_administrator_kann_nicht_gesperrt_werden(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    """Ein Verwalter ohne Administratorrolle darf den einzigen Administrator nicht sperren."""
    admin = admin_mitglied(engine, betrieb, ADMIN)
    verwalter = person_anlegen(engine, betrieb, "verwalter@test.example", [VERWALTER_ROLLE])
    headers = _anmelden(api, verwalter.email)
    version = _mitglied(api, headers, admin.member_id)["version"]
    response = api.post(
        f"/api/v1/members/{admin.member_id}/suspend",
        headers={**headers, "If-Match": str(version)},
    )
    assert response.status_code == 409
    assert response.json()["type"].endswith("/last-administrator")
    assert _mitglied(api, headers, admin.member_id)["status"] == "active"


def test_inaktives_globales_konto_zaehlt_nicht_als_administrator(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    admin = admin_mitglied(engine, betrieb, ADMIN)
    zweiter = person_anlegen(engine, betrieb, "admin2@test.example", ["admin"])
    verwalter = person_anlegen(engine, betrieb, "verwalter@test.example", [VERWALTER_ROLLE])
    session = fabrik(engine)()
    try:
        user = session.get(User, zweiter.user_id)
        assert user is not None
        user.is_active = False
        session.commit()
    finally:
        session.close()
    headers = _anmelden(api, verwalter.email)
    version = _mitglied(api, headers, admin.member_id)["version"]
    response = api.post(
        f"/api/v1/members/{admin.member_id}/suspend",
        headers={**headers, "If-Match": str(version)},
    )
    assert response.status_code == 409
    assert response.json()["type"].endswith("/last-administrator")


# -------------------------------------------------------------------- Rollen


def test_systemrollen_mit_zweck_und_bereichen(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    rollen = api.get("/api/v1/roles", headers=_anmelden(api, ADMIN)).json()
    schluessel = [r["key"] for r in rollen]
    # Nur die festen Systemrollen, nicht die Testrollen.
    assert schluessel == ["admin", "planer", "kalkulator", "monteur", "lager", "einkauf"]
    planer = next(r for r in rollen if r["key"] == "planer")
    assert "Planung" in planer["description"]
    bereiche = {p["area"] for p in planer["permissions"]}
    assert {"Projekte", "Kunden", "Elektroplanung"} <= bereiche
    admin = next(r for r in rollen if r["key"] == "admin")
    assert any(p["key"] == "role.assignment.write" for p in admin["permissions"])


def test_rollen_ersetzen_atomar_und_versioniert(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "planer@test.example", ["planer"])
    headers = _anmelden(api, ADMIN)
    pfad = f"/api/v1/members/{person.member_id}/roles"
    version = _mitglied(api, headers, person.member_id)["version"]

    assert api.put(pfad, headers=headers, json={"role_keys": ["monteur"]}).status_code == 428
    antwort = api.put(
        pfad,
        headers={**headers, "If-Match": str(version)},
        json={"role_keys": ["kalkulator", "monteur"]},
    )
    assert antwort.status_code == 200, antwort.text
    assert {r["key"] for r in antwort.json()["roles"]} == {"kalkulator", "monteur"}
    assert antwort.json()["version"] == version + 1

    veraltet = api.put(
        pfad, headers={**headers, "If-Match": str(version)}, json={"role_keys": ["lager"]}
    )
    assert veraltet.status_code == 409
    assert {r["key"] for r in _mitglied(api, headers, person.member_id)["roles"]} == {
        "kalkulator",
        "monteur",
    }


@pytest.mark.parametrize(
    ("role_keys", "code"),
    [
        (["chef"], "unknown_role"),
        ([VERWALTER_ROLLE], "unknown_role"),
        (["planer", "planer"], "duplicate_role"),
    ],
)
def test_nur_feste_systemrollen_sind_vergebbar(
    api: TestClient, engine: Engine, betrieb: uuid.UUID, role_keys: list[str], code: str
) -> None:
    person = person_anlegen(engine, betrieb, "planer@test.example", ["planer"])
    headers = _anmelden(api, ADMIN)
    version = _mitglied(api, headers, person.member_id)["version"]
    response = api.put(
        f"/api/v1/members/{person.member_id}/roles",
        headers={**headers, "If-Match": str(version)},
        json={"role_keys": role_keys},
    )
    assert response.status_code == 422
    assert response.json()["errors"][0]["code"] == code
    leer = api.put(
        f"/api/v1/members/{person.member_id}/roles",
        headers={**headers, "If-Match": str(version)},
        json={"role_keys": []},
    )
    assert leer.status_code == 422


def test_eigene_administratorrolle_nicht_entfernbar(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    ich = admin_mitglied(engine, betrieb, ADMIN)
    person_anlegen(engine, betrieb, "admin2@test.example", ["admin"])
    headers = _anmelden(api, ADMIN)
    version = _mitglied(api, headers, ich.member_id)["version"]
    response = api.put(
        f"/api/v1/members/{ich.member_id}/roles",
        headers={**headers, "If-Match": str(version)},
        json={"role_keys": ["planer"]},
    )
    assert response.status_code == 409
    assert response.json()["type"].endswith("/self-lockout")
    # Eigene weitere Rollen hinzufuegen ist erlaubt.
    ergaenzt = api.put(
        f"/api/v1/members/{ich.member_id}/roles",
        headers={**headers, "If-Match": str(version)},
        json={"role_keys": ["admin", "planer"]},
    )
    assert ergaenzt.status_code == 200


def test_letztem_administrator_kann_die_rolle_nicht_entzogen_werden(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    admin = admin_mitglied(engine, betrieb, ADMIN)
    verwalter = person_anlegen(engine, betrieb, "verwalter@test.example", [VERWALTER_ROLLE])
    headers = _anmelden(api, verwalter.email)
    version = _mitglied(api, headers, admin.member_id)["version"]
    response = api.put(
        f"/api/v1/members/{admin.member_id}/roles",
        headers={**headers, "If-Match": str(version)},
        json={"role_keys": ["planer"]},
    )
    assert response.status_code == 409
    assert response.json()["type"].endswith("/last-administrator")

    # Mit einem zweiten Administrator geht es.
    person_anlegen(engine, betrieb, "admin2@test.example", ["admin"])
    response = api.put(
        f"/api/v1/members/{admin.member_id}/roles",
        headers={**headers, "If-Match": str(version)},
        json={"role_keys": ["planer"]},
    )
    assert response.status_code == 200


def test_effektive_berechtigungen_mit_herkunft(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "doppelt@test.example", ["planer", "kalkulator"])
    antwort = api.get(
        f"/api/v1/members/{person.member_id}/permissions", headers=_anmelden(api, ADMIN)
    )
    assert antwort.status_code == 200
    rechte = {p["key"]: p for p in antwort.json()["permissions"]}
    assert {r["key"] for r in rechte["customer.record.read"]["granted_by"]} == {
        "planer",
        "kalkulator",
    }
    assert [r["key"] for r in rechte["project.record.write"]["granted_by"]] == ["planer"]
    assert [r["key"] for r in rechte["customer.record.write"]["granted_by"]] == ["kalkulator"]
    assert rechte["electrical.plan.write"]["area"] == "Elektroplanung"
    assert "user.account.write" not in rechte
    assert rechte["project.record.read"]["description"]


def test_rollenaenderung_wirkt_ohne_neue_anmeldung(
    app: FastAPI, api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "planer@test.example", ["planer"])
    with TestClient(app, raise_server_exceptions=False) as zweiter:
        member_headers = auth_headers(login(zweiter, person.email))
        kunde = {"name": "Synthetischer Kunde"}

        def kunde_anlegen() -> int:
            return zweiter.post("/api/v1/customers", headers=member_headers, json=kunde).status_code

        assert kunde_anlegen() == 403

        headers = _anmelden(api, ADMIN)
        version = _mitglied(api, headers, person.member_id)["version"]
        response = api.put(
            f"/api/v1/members/{person.member_id}/roles",
            headers={**headers, "If-Match": str(version)},
            json={"role_keys": ["planer", "kalkulator"]},
        )
        assert response.status_code == 200
        # Derselbe Access Token - neue Rechte wirken sofort.
        assert kunde_anlegen() == 201

        response = api.put(
            f"/api/v1/members/{person.member_id}/roles",
            headers={**headers, "If-Match": str(version + 1)},
            json={"role_keys": ["monteur"]},
        )
        assert response.status_code == 200
        assert kunde_anlegen() == 403
        assert zweiter.get("/api/v1/customers", headers=member_headers).status_code == 403


# --------------------------------------------------------- Mandantentrennung


def test_fremde_mitgliedschaften_bleiben_unerreichbar(
    api: TestClient, engine: Engine, betrieb: uuid.UUID, registry: ModuleRegistry
) -> None:
    session = fabrik(engine)()
    try:
        fremd = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Fremdbetrieb GmbH",
            admin_email="admin@fremd.example",
            admin_password=ADMIN_PASSWORD,
        ).organization_id
        session.commit()
    finally:
        session.close()
    fremde_person = person_anlegen(engine, fremd, "kollege@fremd.example", ["planer"])
    fremd_headers = _anmelden(api, "admin@fremd.example")
    einladung = api.post(
        "/api/v1/invitations",
        headers=fremd_headers,
        json={"email": "neu@fremd.example", "role_keys": ["planer"]},
    ).json()["invitation"]

    headers = _anmelden(api, ADMIN)
    mit_version = {**headers, "If-Match": "1"}
    member = fremde_person.member_id
    for methode, pfad, koerper in (
        ("GET", f"/api/v1/members/{member}", None),
        ("GET", f"/api/v1/members/{member}/permissions", None),
        ("POST", f"/api/v1/members/{member}/suspend", None),
        ("POST", f"/api/v1/members/{member}/reactivate", None),
        ("PUT", f"/api/v1/members/{member}/roles", {"role_keys": ["monteur"]}),
        ("GET", f"/api/v1/invitations/{einladung['id']}", None),
        ("POST", f"/api/v1/invitations/{einladung['id']}/revoke", None),
        ("POST", f"/api/v1/invitations/{einladung['id']}/reissue", None),
    ):
        response = api.request(methode, pfad, headers=mit_version, json=koerper)
        assert response.status_code == 404, f"{methode} {pfad}: {response.status_code}"
        assert "fremd" not in response.text.lower()

    eigene = {e["email"] for e in _alle_seiten(api, headers)}
    assert "kollege@fremd.example" not in eigene
    assert "neu@fremd.example" not in eigene
    # Unveraendert beim fremden Betrieb.
    assert _mitglied(api, fremd_headers, member)["status"] == "active"
    # Einladen einer Person aus einem fremden Betrieb verraet nichts.
    response = api.post(
        "/api/v1/invitations",
        headers=headers,
        json={"email": "kollege@fremd.example", "role_keys": ["planer"]},
    )
    assert response.status_code == 201


# -------------------------------------------------------------------- Audit


def test_protokoll_ohne_personenbezogene_daten(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    person = person_anlegen(engine, betrieb, "planer@test.example", ["planer"])
    headers = _anmelden(api, ADMIN)
    version = _mitglied(api, headers, person.member_id)["version"]
    pfad = f"/api/v1/members/{person.member_id}"
    api.put(
        f"{pfad}/roles",
        headers={**headers, "If-Match": str(version)},
        json={"role_keys": ["planer", "monteur"]},
    )
    api.post(f"{pfad}/suspend", headers={**headers, "If-Match": str(version + 1)})
    api.post(f"{pfad}/reactivate", headers={**headers, "If-Match": str(version + 2)})

    session = fabrik(engine)()
    try:
        eintraege = (
            session.execute(
                select(AuditEntry).where(
                    AuditEntry.entity_id == person.member_id,
                    AuditEntry.organization_id == betrieb,
                )
            )
            .scalars()
            .all()
        )
        aktionen = {eintrag.action for eintrag in eintraege}
        assert aktionen == {"member.roles_changed", "member.suspended", "member.reactivated"}
        rollen = next(e for e in eintraege if e.action == "member.roles_changed")
        assert rollen.data == {"added": ["monteur"], "removed": []}
        admin = admin_mitglied(engine, betrieb, ADMIN)
        assert all(e.actor_user_id == admin.user_id for e in eintraege)
        for eintrag in eintraege:
            text = f"{eintrag.summary} {eintrag.data}"
            assert "planer@test.example" not in text
    finally:
        session.close()


def test_mitglied_bleibt_in_der_datenbank_konsistent(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    """Keine Aktion der Verwaltung aendert das globale Konto."""
    person = person_anlegen(engine, betrieb, "planer@test.example", ["planer"])
    session = fabrik(engine)()
    try:
        vorher = session.get(User, person.user_id)
        assert vorher is not None
        hash_vorher, name_vorher = vorher.password_hash, vorher.full_name
    finally:
        session.close()
    headers = _anmelden(api, ADMIN)
    version = _mitglied(api, headers, person.member_id)["version"]
    api.post(
        f"/api/v1/members/{person.member_id}/suspend",
        headers={**headers, "If-Match": str(version)},
    )
    session = fabrik(engine)()
    try:
        user = session.get(User, person.user_id)
        member = session.get(OrganizationMember, person.member_id)
        assert user is not None and member is not None
        assert (user.password_hash, user.full_name, user.email, user.is_active) == (
            hash_vorher,
            name_vorher,
            person.email,
            True,
        )
        assert member.status == "disabled"
    finally:
        session.close()
