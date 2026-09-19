"""Kundenstamm: CRUD, Berechtigungen, optimistisches Sperren, Anonymisierung.

Phase 2 fuehrt die ersten personenbezogenen Daten ein. Getestet wird deshalb
nicht nur, dass Anlegen und Aendern funktionieren, sondern auch der
Anonymisierungspfad aus ``docs/security.md``, Abschnitt 13.

Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

from app.core.auth.security import hash_password
from app.core.authorization.permissions import SYSTEM_ROLES
from app.core.authorization.service import assign_role
from app.core.customers.models import Customer
from app.core.module_registry.registry import ModuleRegistry
from app.core.organizations.models import OrganizationMember
from app.core.seed import seed_initial_data
from app.core.users.models import User
from tests.conftest import ADMIN_PASSWORD, auth_headers, login, requires_database

pytestmark = [requires_database, pytest.mark.database]

ADMIN_EMAIL = "admin@kunden.example"
MONTEUR_EMAIL = "monteur@kunden.example"


@pytest.fixture
def betrieb(engine: Engine, registry: ModuleRegistry, clean_database: None) -> uuid.UUID:
    """Ein Betrieb mit Admin und einem Monteur (nur Lesen auf Projekte)."""
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        result = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Kunden GmbH",
            admin_email=ADMIN_EMAIL,
            admin_password=ADMIN_PASSWORD,
        )
        monteur = User(
            email=MONTEUR_EMAIL,
            password_hash=hash_password(ADMIN_PASSWORD),
            full_name="Max Monteur",
        )
        session.add(monteur)
        session.flush()
        mitgliedschaft = OrganizationMember(
            organization_id=result.organization_id, user_id=monteur.id
        )
        session.add(mitgliedschaft)
        session.flush()
        from app.core.authorization.models import Role

        rolle = (
            session.query(Role)
            .filter(Role.organization_id == result.organization_id, Role.key == "monteur")
            .one()
        )
        assign_role(
            session,
            organization_id=result.organization_id,
            member_id=mitgliedschaft.id,
            role_id=rolle.id,
        )
        session.commit()
        return result.organization_id
    finally:
        session.close()


def _create(api: TestClient, token: str, **overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {"name": "Familie Beispiel", "kind": "private"}
    payload.update(overrides)
    response = api.post("/api/v1/customers", headers=auth_headers(token), json=payload)
    assert response.status_code == 201, response.text
    return dict(response.json())


# ------------------------------------------------------------------- Anlegen


def test_anlegen_vergibt_kundennummer(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)

    erster = _create(api, token, name="Familie Ahrens")
    zweiter = _create(api, token, name="Bau GmbH", kind="company")

    assert erster["customer_number"] == "KD-00001"
    assert zweiter["customer_number"] == "KD-00002"
    assert erster["version"] == 1


def test_unbekanntes_feld_wird_abgelehnt(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)

    response = api.post(
        "/api/v1/customers",
        headers=auth_headers(token),
        json={"name": "Test", "customer_number": "KD-99999"},
    )

    assert response.status_code == 422


def test_ungueltige_art_wird_abgelehnt(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)

    response = api.post(
        "/api/v1/customers",
        headers=auth_headers(token),
        json={"name": "Test", "kind": "behoerde"},
    )

    assert response.status_code == 422


def test_ungueltige_email_wird_abgelehnt(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)

    response = api.post(
        "/api/v1/customers",
        headers=auth_headers(token),
        json={"name": "Test", "email": "keine-mail"},
    )

    assert response.status_code == 422


# ------------------------------------------------------------------- Aendern


def test_aendern_erhoeht_die_version(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    kunde = _create(api, token)

    response = api.patch(
        f"/api/v1/customers/{kunde['id']}",
        headers={**auth_headers(token), "If-Match": str(kunde["version"])},
        json={"billing_city": "Hannover"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["billing_city"] == "Hannover"
    assert body["version"] == 2
    assert body["customer_number"] == kunde["customer_number"]


def test_aendern_ohne_if_match_wird_abgelehnt(api: TestClient, betrieb: uuid.UUID) -> None:
    """Ein PATCH ohne Bedingung waere ein stilles Ueberschreiben."""
    token = login(api, ADMIN_EMAIL)
    kunde = _create(api, token)

    response = api.patch(
        f"/api/v1/customers/{kunde['id']}",
        headers=auth_headers(token),
        json={"billing_city": "Hannover"},
    )

    assert response.status_code == 428
    assert response.json()["type"].endswith("/precondition-required")


def test_veraltetes_if_match_liefert_409(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    kunde = _create(api, token)
    api.patch(
        f"/api/v1/customers/{kunde['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"billing_city": "Hannover"},
    )

    response = api.patch(
        f"/api/v1/customers/{kunde['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"billing_city": "Bremen"},
    )

    assert response.status_code == 409
    assert response.json()["type"].endswith("/version-conflict")


def test_if_match_akzeptiert_etag_schreibweise(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    kunde = _create(api, token)

    response = api.patch(
        f"/api/v1/customers/{kunde['id']}",
        headers={**auth_headers(token), "If-Match": '"1"'},
        json={"billing_city": "Celle"},
    )

    assert response.status_code == 200


def test_kundennummer_ist_nicht_aenderbar(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    kunde = _create(api, token)

    response = api.patch(
        f"/api/v1/customers/{kunde['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"customer_number": "KD-99999"},
    )

    assert response.status_code == 422


# ------------------------------------------------------- Auflisten und Suche


def test_liste_ist_paginiert(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    for index in range(5):
        _create(api, token, name=f"Kunde {index}")

    erste = api.get("/api/v1/customers", headers=auth_headers(token), params={"limit": 2}).json()

    assert len(erste["items"]) == 2
    assert erste["has_more"] is True
    assert erste["next_cursor"]

    zweite = api.get(
        "/api/v1/customers",
        headers=auth_headers(token),
        params={"limit": 2, "cursor": erste["next_cursor"]},
    ).json()

    assert len(zweite["items"]) == 2
    erste_ids = {item["id"] for item in erste["items"]}
    zweite_ids = {item["id"] for item in zweite["items"]}
    assert erste_ids.isdisjoint(zweite_ids)


def test_cursor_liefert_jeden_datensatz_genau_einmal(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    for index in range(7):
        _create(api, token, name=f"Kunde {index}")

    gesehen: list[str] = []
    cursor: str | None = None
    for _ in range(10):
        params: dict[str, object] = {"limit": 3}
        if cursor:
            params["cursor"] = cursor
        seite = api.get("/api/v1/customers", headers=auth_headers(token), params=params).json()
        gesehen.extend(item["id"] for item in seite["items"])
        cursor = seite["next_cursor"]
        if not seite["has_more"]:
            break

    assert len(gesehen) == 7
    assert len(set(gesehen)) == 7


def test_sortierung_nach_name(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    for name in ("Zeta Bau", "Alpha GmbH", "Mitte AG"):
        _create(api, token, name=name)

    body = api.get("/api/v1/customers", headers=auth_headers(token), params={"sort": "name"}).json()

    assert [item["name"] for item in body["items"]] == ["Alpha GmbH", "Mitte AG", "Zeta Bau"]


def test_suche_findet_ueber_name_nummer_und_ort(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    _create(api, token, name="Schmidt Bau", billing_city="Hameln")
    _create(api, token, name="Meier Haus", billing_city="Celle")

    def namen(query: str) -> set[str]:
        body = api.get("/api/v1/customers", headers=auth_headers(token), params={"q": query}).json()
        return {item["name"] for item in body["items"]}

    assert namen("schmidt") == {"Schmidt Bau"}
    assert namen("Celle") == {"Meier Haus"}
    assert namen("KD-0000") == {"Schmidt Bau", "Meier Haus"}


def test_filter_nach_art(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    _create(api, token, name="Privatkunde", kind="private")
    _create(api, token, name="Firmenkunde", kind="company")

    body = api.get(
        "/api/v1/customers", headers=auth_headers(token), params={"kind": "company"}
    ).json()

    assert [item["name"] for item in body["items"]] == ["Firmenkunde"]


def test_ungueltiger_cursor_ist_ein_eingabefehler(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)

    response = api.get(
        "/api/v1/customers", headers=auth_headers(token), params={"cursor": "kein-cursor"}
    )

    assert response.status_code == 422
    assert response.json()["type"].endswith("/validation-failed")


# ------------------------------------------------------ Loeschen und Schutz


def test_ausblenden_entfernt_aus_der_liste(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    kunde = _create(api, token)

    response = api.delete(
        f"/api/v1/customers/{kunde['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
    )

    assert response.status_code == 204
    body = api.get("/api/v1/customers", headers=auth_headers(token)).json()
    assert body["items"] == []
    assert api.get(f"/api/v1/customers/{kunde['id']}", headers=auth_headers(token)).status_code == (
        404
    )


def test_kunde_mit_projekt_laesst_sich_nicht_ausblenden(
    api: TestClient, betrieb: uuid.UUID
) -> None:
    token = login(api, ADMIN_EMAIL)
    kunde = _create(api, token)
    api.post(
        "/api/v1/projects",
        headers=auth_headers(token),
        json={"customer_id": kunde["id"], "name": "Neubau"},
    )

    response = api.delete(
        f"/api/v1/customers/{kunde['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
    )

    assert response.status_code == 409


# ---------------------------------------------------------- Anonymisierung


def test_anonymisieren_entfernt_personenbezug(
    api: TestClient, engine: Engine, betrieb: uuid.UUID
) -> None:
    """Art. 17 DSGVO: Personenbezug weg, Belegzuordnung bleibt."""
    token = login(api, ADMIN_EMAIL)
    kunde = _create(
        api,
        token,
        name="Erika Musterfrau",
        contact_person="Erika Musterfrau",
        email="erika@example.org",
        phone="0511 12345",
        billing_street="Musterweg 1",
        billing_postal_code="30159",
        billing_city="Hannover",
    )

    response = api.post(
        f"/api/v1/customers/{kunde['id']}/anonymize",
        headers={**auth_headers(token), "If-Match": "1"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["customer_number"] == kunde["customer_number"]
    assert body["anonymized_at"] is not None
    assert body["name"] != "Erika Musterfrau"
    assert body["email"] is None
    assert body["phone"] is None
    assert body["contact_person"] is None
    assert body["billing_street"] is None
    assert body["billing_city"] is None

    # Auch in der Datenbank steht nichts Personenbezogenes mehr.
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        gespeichert = session.get(Customer, uuid.UUID(str(kunde["id"])))
        assert gespeichert is not None
        assert "Musterfrau" not in gespeichert.name
        assert gespeichert.email is None
    finally:
        session.close()


def test_anonymisierung_wird_ohne_die_alten_werte_protokolliert(
    api: TestClient, betrieb: uuid.UUID
) -> None:
    """Das Protokoll darf die geloeschten Daten nicht konservieren."""
    token = login(api, ADMIN_EMAIL)
    kunde = _create(api, token, name="Erika Musterfrau", email="erika@example.org")

    api.post(
        f"/api/v1/customers/{kunde['id']}/anonymize",
        headers={**auth_headers(token), "If-Match": "1"},
    )

    protokoll = api.get(
        "/api/v1/audit", headers=auth_headers(token), params={"action": "customer.anonymized"}
    ).json()

    assert len(protokoll["items"]) == 1
    roh = str(protokoll["items"][0])
    assert "Musterfrau" not in roh
    assert "erika@example.org" not in roh


# ------------------------------------------------------------ Berechtigungen


def test_monteur_darf_keine_kunden_sehen(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, MONTEUR_EMAIL)

    response = api.get("/api/v1/customers", headers=auth_headers(token))

    assert response.status_code == 403
    assert response.json()["type"].endswith("/permission-denied")


def test_monteur_darf_keine_kunden_anlegen(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, MONTEUR_EMAIL)

    response = api.post(
        "/api/v1/customers", headers=auth_headers(token), json={"name": "Heimlich GmbH"}
    )

    assert response.status_code == 403


def test_nur_der_admin_darf_anonymisieren() -> None:
    """Die Anonymisierung ist nicht umkehrbar und gehoert keiner Fachrolle."""
    berechtigt = {
        role.key for role in SYSTEM_ROLES if "customer.record.anonymize" in role.permissions
    }
    assert berechtigt == {"admin"}


def test_anlegen_wird_protokolliert(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    kunde = _create(api, token)

    protokoll = api.get(
        "/api/v1/audit", headers=auth_headers(token), params={"action": "customer.created"}
    ).json()

    assert len(protokoll["items"]) == 1
    assert protokoll["items"][0]["entity_id"] == kunde["id"]


# --------------------------------------------- Ausdrueckliches null im PATCH


def test_pflichtfeld_laesst_sich_nicht_auf_null_setzen(api: TestClient, betrieb: uuid.UUID) -> None:
    """Ein ausdrueckliches ``null`` auf einem NOT-NULL-Feld ist ein
    Eingabefehler (422), kein Datenbankfehler (500)."""
    token = login(api, ADMIN_EMAIL)
    kunde = _create(api, token)

    response = api.patch(
        f"/api/v1/customers/{kunde['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"name": None},
    )

    assert response.status_code == 422
    assert response.json()["type"].endswith("/validation-failed")


def test_optionales_feld_laesst_sich_leeren(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    kunde = _create(api, token, billing_city="Hannover")

    response = api.patch(
        f"/api/v1/customers/{kunde['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"billing_city": None},
    )

    assert response.status_code == 200
    assert response.json()["billing_city"] is None


def test_anonymisierter_kunde_ist_nicht_mehr_aenderbar(api: TestClient, betrieb: uuid.UUID) -> None:
    """Sonst liessen sich die geloeschten Angaben wieder eintragen."""
    token = login(api, ADMIN_EMAIL)
    kunde = _create(api, token, name="Erika Musterfrau")
    anonym = api.post(
        f"/api/v1/customers/{kunde['id']}/anonymize",
        headers={**auth_headers(token), "If-Match": "1"},
    ).json()

    response = api.patch(
        f"/api/v1/customers/{kunde['id']}",
        headers={**auth_headers(token), "If-Match": str(anonym["version"])},
        json={"name": "Erika Musterfrau"},
    )

    assert response.status_code == 409


def test_zweimal_anonymisieren_wird_abgelehnt(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    kunde = _create(api, token)
    anonym = api.post(
        f"/api/v1/customers/{kunde['id']}/anonymize",
        headers={**auth_headers(token), "If-Match": "1"},
    ).json()

    response = api.post(
        f"/api/v1/customers/{kunde['id']}/anonymize",
        headers={**auth_headers(token), "If-Match": str(anonym["version"])},
    )

    assert response.status_code == 409


def test_veraltete_version_schlaegt_vor_dem_fachlichen_konflikt_durch(
    api: TestClient, betrieb: uuid.UUID
) -> None:
    """Beim Ausblenden wird zuerst die Version geprueft, dann der Projektbezug."""
    token = login(api, ADMIN_EMAIL)
    kunde = _create(api, token)
    api.post(
        "/api/v1/projects",
        headers=auth_headers(token),
        json={"customer_id": kunde["id"], "name": "Neubau", "site_country_code": "DE"},
    )

    response = api.delete(
        f"/api/v1/customers/{kunde['id']}",
        headers={**auth_headers(token), "If-Match": "99"},
    )

    assert response.status_code == 409
    assert response.json()["type"].endswith("/version-conflict")
