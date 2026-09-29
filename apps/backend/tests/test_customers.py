"""Kundenstamm: CRUD, Berechtigungen, optimistisches Sperren, Anonymisierung.

Phase 2 fuehrt die ersten personenbezogenen Daten ein. Getestet wird deshalb
nicht nur, dass Anlegen und Aendern funktionieren, sondern auch der
Anonymisierungspfad aus ``docs/security.md``, Abschnitt 13.

Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import uuid
from typing import Any

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


def _seite(api: TestClient, token: str, **params: object) -> Any:
    response = api.get("/api/v1/customers", headers=auth_headers(token), params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _ids(seite: Any) -> list[str]:
    return [str(item["id"]) for item in seite["items"]]


def test_liste_liefert_nummerierte_seiten(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    for index in range(5):
        _create(api, token, name=f"Kunde {index}")

    erste = _seite(api, token, page_size=2)

    assert erste["page"] == 1
    assert erste["page_size"] == 2
    assert erste["total_items"] == 5
    assert erste["total_pages"] == 3
    assert len(erste["items"]) == 2
    assert "next_cursor" not in erste
    assert "has_more" not in erste


def test_letzte_seite_ist_teilweise_gefuellt(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    for index in range(5):
        _create(api, token, name=f"Kunde {index}")

    letzte = _seite(api, token, page_size=2, page=3)

    assert letzte["page"] == 3
    assert len(letzte["items"]) == 1


def test_alle_seiten_liefern_jeden_datensatz_genau_einmal(
    api: TestClient, betrieb: uuid.UUID
) -> None:
    token = login(api, ADMIN_EMAIL)
    for index in range(7):
        _create(api, token, name=f"Kunde {index}")

    gesehen = [
        kunde_id
        for nummer in (1, 2, 3)
        for kunde_id in _ids(_seite(api, token, page_size=3, page=nummer, sort="name"))
    ]

    assert len(gesehen) == 7
    assert len(set(gesehen)) == 7


def test_leere_liste_hat_keine_seiten(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)

    leer = _seite(api, token, page=4)

    assert leer == {"items": [], "page": 1, "page_size": 25, "total_items": 0, "total_pages": 0}


def test_seite_hinter_der_letzten_liefert_die_letzte(api: TestClient, betrieb: uuid.UUID) -> None:
    """Etwa nach dem Ausblenden des einzigen Eintrags der letzten Seite."""
    token = login(api, ADMIN_EMAIL)
    for index in range(3):
        _create(api, token, name=f"Kunde {index}")

    seite = _seite(api, token, page_size=2, page=99)

    assert seite["page"] == 2
    assert seite["total_pages"] == 2
    assert len(seite["items"]) == 1


@pytest.mark.parametrize(
    "params", [{"page": 0}, {"page": -1}, {"page_size": 0}, {"page_size": 101}]
)
def test_ungueltige_seitenangaben_sind_eingabefehler(
    api: TestClient, betrieb: uuid.UUID, params: dict[str, object]
) -> None:
    token = login(api, ADMIN_EMAIL)

    response = api.get("/api/v1/customers", headers=auth_headers(token), params=params)

    assert response.status_code == 422


def test_gleichnamige_kunden_bleiben_stabil_sortiert(api: TestClient, betrieb: uuid.UUID) -> None:
    """Gleicher Sortierwert: Die ID entscheidet - ueber Seitengrenzen hinweg."""
    token = login(api, ADMIN_EMAIL)
    erwartet = sorted(str(_create(api, token, name="Schmidt")["id"]) for _ in range(5))

    def durchblaettern() -> list[str]:
        return [
            kunde_id
            for nummer in (1, 2, 3)
            for kunde_id in _ids(_seite(api, token, sort="name", page_size=2, page=nummer))
        ]

    assert durchblaettern() == erwartet
    assert durchblaettern() == erwartet


def test_gesamtzahl_folgt_dem_suchfilter(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    for index in range(3):
        _create(api, token, name=f"Schmidt {index}")
    _create(api, token, name="Meier")

    seite = _seite(api, token, q="schmidt", page_size=2)

    assert seite["total_items"] == 3
    assert seite["total_pages"] == 2
    assert all("Schmidt" in item["name"] for item in seite["items"])


def test_ausgeblendete_kunden_zaehlen_nicht(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    _create(api, token, name="Bleibt")
    weg = _create(api, token, name="Weg")
    response = api.delete(
        f"/api/v1/customers/{weg['id']}", headers={**auth_headers(token), "If-Match": "1"}
    )
    assert response.status_code == 204

    seite = _seite(api, token)

    assert seite["total_items"] == 1
    assert [item["name"] for item in seite["items"]] == ["Bleibt"]


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


def test_nicht_ganzzahlige_seite_ist_ein_eingabefehler(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)

    response = api.get("/api/v1/customers", headers=auth_headers(token), params={"page": "zwei"})

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
