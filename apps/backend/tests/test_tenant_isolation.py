"""Mandantentrennung end-to-end (ADR 0006, Ebene 4).

Der Sweep-Test ist ein Exit-Kriterium von Phase 1: Fremde IDs muessen ueber
**alle** Routen ``404`` liefern - nie ``200`` mit Inhalt.

Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.core.audit import service as audit
from app.core.auth.security import hash_password
from app.core.authorization.models import MemberRole, Role
from app.core.customers.models import Customer
from app.core.files.models import FileRecord
from app.core.invitations.models import MemberInvitation
from app.core.module_registry.registry import ModuleRegistry
from app.core.organizations.models import OrganizationMember
from app.core.projects.models import Building, Floor, Project
from app.core.seed import seed_initial_data
from app.core.users.models import User
from app.db.mixins import utcnow
from app.modules.electrical.models import ElectricalOpening, ElectricalRoom, ElectricalWall
from tests.conftest import ADMIN_PASSWORD, auth_headers, login, requires_database
from tests.routes import all_routes

pytestmark = [requires_database, pytest.mark.database]


@dataclass(frozen=True, slots=True)
class Tenant:
    organization_id: uuid.UUID
    admin_email: str
    file_id: uuid.UUID
    audit_entry_id: uuid.UUID
    customer_id: uuid.UUID
    project_id: uuid.UUID
    building_id: uuid.UUID
    floor_id: uuid.UUID
    #: Planungsdaten des Fachmoduls ``electrical`` (Phase 3). Der Sweep
    #: braucht sie, weil sonst die neuen Routen ohne Testdaten dastehen -
    #: und dann meldet er sich als unabgedeckt.
    room_id: uuid.UUID
    wall_id: uuid.UUID
    opening_id: uuid.UUID
    #: Benutzerverwaltung (Phase 4.2): ein weiteres Mitglied und eine offene
    #: Einladung je Betrieb.
    member_id: uuid.UUID
    invitation_id: uuid.UUID


@pytest.fixture
def two_tenants(
    engine: Engine, registry: ModuleRegistry, clean_database: None
) -> tuple[Tenant, Tenant]:
    """Zwei vollstaendig getrennte Betriebe mit je einem Datensatz."""
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    tenants: list[Tenant] = []
    session = factory()
    try:
        for name, email in (
            ("Elektro Scholz GmbH", "admin@scholz.example"),
            ("Elektro Mueller GmbH", "admin@mueller.example"),
        ):
            result = seed_initial_data(
                session,
                registry,
                organization_name=name,
                admin_email=email,
                admin_password=ADMIN_PASSWORD,
            )
            kunde = Customer(
                organization_id=result.organization_id,
                customer_number="KD-00001",
                kind="company",
                name=f"Kunde von {name}",
            )
            session.add(kunde)
            session.flush()
            projekt = Project(
                organization_id=result.organization_id,
                customer_id=kunde.id,
                project_number="PR-2026-0001",
                name=f"Projekt von {name}",
            )
            session.add(projekt)
            session.flush()
            gebaeude = Building(
                organization_id=result.organization_id,
                project_id=projekt.id,
                name="Haupthaus",
            )
            session.add(gebaeude)
            session.flush()
            geschoss = Floor(
                organization_id=result.organization_id,
                building_id=gebaeude.id,
                name="Erdgeschoss",
                level=0,
            )
            session.add(geschoss)
            session.flush()
            raum = ElectricalRoom(
                organization_id=result.organization_id,
                floor_id=geschoss.id,
                name="Wohnzimmer",
            )
            session.add(raum)
            session.flush()
            wand = ElectricalWall(
                organization_id=result.organization_id,
                room_id=raum.id,
                x1_mm=0,
                y1_mm=0,
                x2_mm=5_000,
                y2_mm=0,
                sort_order=0,
            )
            session.add(wand)
            session.flush()
            oeffnung = ElectricalOpening(
                organization_id=result.organization_id,
                wall_id=wand.id,
                kind="door",
                offset_mm=1_000,
                width_mm=1_010,
                height_mm=2_010,
            )
            session.add(oeffnung)
            datei = FileRecord(
                organization_id=result.organization_id,
                project_id=projekt.id,
                storage_key=f"org/{result.organization_id}/{uuid.uuid4()}.pdf",
                filename="grundriss.pdf",
                content_type="application/pdf",
                size_bytes=1024,
                sha256="0" * 64,
            )
            session.add(datei)
            eintrag = audit.record(
                session,
                organization_id=result.organization_id,
                action="test.entry.created",
                entity_type="test",
                summary=f"Eintrag {name}",
            )
            kollege = User(
                email=f"kollege@{email.split('@')[1]}",
                password_hash=hash_password(ADMIN_PASSWORD),
                full_name=f"Kollege von {name}",
            )
            session.add(kollege)
            session.flush()
            mitglied = OrganizationMember(
                organization_id=result.organization_id, user_id=kollege.id, status="active"
            )
            session.add(mitglied)
            einladung = MemberInvitation(
                organization_id=result.organization_id,
                email=f"neu@{email.split('@')[1]}",
                token_hash=uuid.uuid4().hex + uuid.uuid4().hex,
                expires_at=utcnow() + timedelta(days=1),
            )
            session.add(einladung)
            session.flush()
            tenants.append(
                Tenant(
                    organization_id=result.organization_id,
                    admin_email=email,
                    file_id=datei.id,
                    audit_entry_id=eintrag.id,
                    customer_id=kunde.id,
                    project_id=projekt.id,
                    building_id=gebaeude.id,
                    floor_id=geschoss.id,
                    room_id=raum.id,
                    wall_id=wand.id,
                    opening_id=oeffnung.id,
                    member_id=mitglied.id,
                    invitation_id=einladung.id,
                )
            )
        session.commit()
    finally:
        session.close()
    return tenants[0], tenants[1]


def test_fremde_datei_liefert_404(api: TestClient, two_tenants: tuple[Tenant, Tenant]) -> None:
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)

    response = api.get(f"/api/v1/files/{scholz.file_id}", headers=auth_headers(token))

    assert response.status_code == 404
    assert response.json()["type"].endswith("/not-found")


def test_eigene_datei_ist_erreichbar(api: TestClient, two_tenants: tuple[Tenant, Tenant]) -> None:
    scholz, _ = two_tenants
    token = login(api, scholz.admin_email)

    response = api.get(f"/api/v1/files/{scholz.file_id}", headers=auth_headers(token))

    assert response.status_code == 200
    assert response.json()["filename"] == "grundriss.pdf"


def test_fremder_download_liefert_404(api: TestClient, two_tenants: tuple[Tenant, Tenant]) -> None:
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)

    response = api.get(
        f"/api/v1/files/{scholz.file_id}/download",
        headers=auth_headers(token),
        follow_redirects=False,
    )

    assert response.status_code == 404


def test_protokoll_zeigt_nur_eigene_eintraege(
    api: TestClient, two_tenants: tuple[Tenant, Tenant]
) -> None:
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)

    response = api.get("/api/v1/audit", headers=auth_headers(token))

    assert response.status_code == 200
    ids = {item["id"] for item in response.json()["items"]}
    assert str(scholz.audit_entry_id) not in ids
    assert str(mueller.audit_entry_id) in ids


def test_mandant_stammt_aus_dem_token_nicht_aus_der_anfrage(
    api: TestClient, two_tenants: tuple[Tenant, Tenant]
) -> None:
    """Ein mitgeschickter Organisationsbezug darf nichts bewirken."""
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)

    response = api.get(
        f"/api/v1/files/{scholz.file_id}",
        headers={
            **auth_headers(token),
            "X-Organization-Id": str(scholz.organization_id),
        },
        params={"organization_id": str(scholz.organization_id)},
    )

    assert response.status_code == 404


def test_me_liefert_den_eigenen_betrieb(
    api: TestClient, two_tenants: tuple[Tenant, Tenant]
) -> None:
    _, mueller = two_tenants
    token = login(api, mueller.admin_email)

    body = api.get("/api/v1/me", headers=auth_headers(token)).json()

    assert body["organization"]["id"] == str(mueller.organization_id)


#: Testdaten-Registry fuer den Sweep. Jeder Pfadparameter, der in einer Route
#: vorkommt, muss hier eine fremde ID bekommen. Kommt eine Route mit einem
#: unbekannten Parameter hinzu, schlaegt der Sweep fehl - er ueberspringt sie
#: nicht stillschweigend (Punkt 8 der Phase-1.1-Abnahme).
def fremde_ids(tenant: Tenant) -> dict[str, str]:
    return {
        "file_id": str(tenant.file_id),
        "entry_id": str(tenant.audit_entry_id),
        "organization_id": str(tenant.organization_id),
        "customer_id": str(tenant.customer_id),
        "project_id": str(tenant.project_id),
        "building_id": str(tenant.building_id),
        "floor_id": str(tenant.floor_id),
        "room_id": str(tenant.room_id),
        "wall_id": str(tenant.wall_id),
        "opening_id": str(tenant.opening_id),
        "member_id": str(tenant.member_id),
        "invitation_id": str(tenant.invitation_id),
    }


def test_sweep_ueber_alle_routen_mit_id_parameter(
    api: TestClient, app, two_tenants: tuple[Tenant, Tenant]
) -> None:
    """Automatischer Durchlauf: keine Route gibt fremde Daten heraus.

    Neue Routen mit Pfadparametern muessen ausdruecklich in ``fremde_ids``
    aufgenommen werden; andernfalls scheitert dieser Test.
    """
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)
    ids = fremde_ids(scholz)

    geprueft: list[str] = []
    verstoesse: list[str] = []
    nicht_abgedeckt: list[str] = []

    for path, route in all_routes(app):
        if "{" not in path:
            continue
        parameter = re.findall(r"{([^}]+)}", path)
        fehlend = [name for name in parameter if name not in ids]
        if fehlend:
            nicht_abgedeckt.append(f"{path} (ohne Testdaten fuer {fehlend})")
            continue

        konkreter_pfad = path
        for name in parameter:
            konkreter_pfad = konkreter_pfad.replace(f"{{{name}}}", ids[name])

        for methode in sorted(route.methods & {"GET", "POST", "PUT", "PATCH", "DELETE"}):
            response = api.request(
                methode, konkreter_pfad, headers=auth_headers(token), follow_redirects=False
            )
            geprueft.append(f"{methode} {konkreter_pfad}")
            # 404/403 sind in Ordnung; 422 ebenfalls, wenn ein Koerper fehlt -
            # entscheidend ist, dass keine fremden Daten herausgegeben werden.
            if response.status_code in (200, 201, 204, 307):
                verstoesse.append(f"{methode} {path} -> {response.status_code}")

    assert not nicht_abgedeckt, (
        "Routen ohne Tenant-Testdaten gefunden. Bitte in fremde_ids ergaenzen: "
        + ", ".join(nicht_abgedeckt)
    )
    assert geprueft, "Sweep hat keine Route geprueft - Testaufbau pruefen"
    assert not verstoesse, f"Routen mit Zugriff auf fremde Daten: {verstoesse}"


def test_schreibende_operation_kann_keine_fremde_organisation_einschleusen(
    api: TestClient, engine: Engine, two_tenants: tuple[Tenant, Tenant]
) -> None:
    """Ein mitgesendeter Organisationsbezug darf nichts bewirken."""
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)

    response = api.post(
        "/api/v1/files",
        headers=auth_headers(token),
        files={"upload": ("plan.pdf", b"%PDF-1.7 test", "application/pdf")},
        data={
            "organization_id": str(scholz.organization_id),
            "entity_type": "test",
        },
    )

    # Entweder wird das unbekannte Feld abgelehnt oder es wird ignoriert -
    # in keinem Fall darf der Datensatz beim fremden Mandanten landen.
    assert response.status_code in (201, 422)
    if response.status_code == 201:
        factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        session = factory()
        try:
            datei = session.get(FileRecord, uuid.UUID(response.json()["id"]))
            assert datei is not None
            assert datei.organization_id == mueller.organization_id
        finally:
            session.close()


def test_rollen_lassen_sich_nicht_mandantenuebergreifend_verbinden(
    engine: Engine, two_tenants: tuple[Tenant, Tenant]
) -> None:
    """Der zusammengesetzte Fremdschluessel greift in PostgreSQL selbst."""
    scholz, mueller = two_tenants
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        fremde_rolle = (
            session.query(Role).filter(Role.organization_id == scholz.organization_id).first()
        )
        eigenes_mitglied = (
            session.query(OrganizationMember)
            .filter(OrganizationMember.organization_id == mueller.organization_id)
            .first()
        )
        assert fremde_rolle is not None and eigenes_mitglied is not None

        session.add(
            MemberRole(
                organization_id=mueller.organization_id,
                member_id=eigenes_mitglied.id,
                role_id=fremde_rolle.id,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
    finally:
        session.close()


def test_fremder_kunde_liefert_404(api: TestClient, two_tenants: tuple[Tenant, Tenant]) -> None:
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)

    response = api.get(f"/api/v1/customers/{scholz.customer_id}", headers=auth_headers(token))

    assert response.status_code == 404


def test_kundenliste_zeigt_nur_eigene(api: TestClient, two_tenants: tuple[Tenant, Tenant]) -> None:
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)

    body = api.get("/api/v1/customers", headers=auth_headers(token)).json()

    ids = {item["id"] for item in body["items"]}
    assert str(mueller.customer_id) in ids
    assert str(scholz.customer_id) not in ids


def test_fremdes_projekt_liefert_404(api: TestClient, two_tenants: tuple[Tenant, Tenant]) -> None:
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)

    response = api.get(f"/api/v1/projects/{scholz.project_id}", headers=auth_headers(token))

    assert response.status_code == 404


def test_projektliste_zeigt_nur_eigene(api: TestClient, two_tenants: tuple[Tenant, Tenant]) -> None:
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)

    body = api.get("/api/v1/projects", headers=auth_headers(token)).json()

    ids = {item["id"] for item in body["items"]}
    assert str(mueller.project_id) in ids
    assert str(scholz.project_id) not in ids


def test_gesamtzahlen_zaehlen_nur_den_eigenen_betrieb(
    api: TestClient, two_tenants: tuple[Tenant, Tenant]
) -> None:
    """``total_items`` darf keine fremden Datensaetze mitzaehlen (ADR 0017).

    Beide Betriebe haben je genau einen Kunden und ein Projekt. Ein
    ungefilterter ``COUNT`` ergaebe 2 - und verriete damit den Umfang fremder
    Daten.
    """
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)

    kunden = api.get("/api/v1/customers", headers=auth_headers(token)).json()
    projekte = api.get("/api/v1/projects", headers=auth_headers(token)).json()
    laufend = api.get(
        "/api/v1/projects", headers=auth_headers(token), params={"status_group": "current"}
    ).json()

    assert (kunden["total_items"], kunden["total_pages"]) == (1, 1)
    assert (projekte["total_items"], projekte["total_pages"]) == (1, 1)
    assert laufend["total_items"] == 1
    assert {item["id"] for item in projekte["items"]} == {str(mueller.project_id)}
    assert str(scholz.project_id) not in {item["id"] for item in laufend["items"]}


def test_projektfilter_mit_fremder_kunden_id_liefert_nichts(
    api: TestClient, two_tenants: tuple[Tenant, Tenant]
) -> None:
    """Eine fremde Kunden-ID ergibt dieselbe Antwort wie eine unbekannte."""
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)

    fremd = api.get(
        "/api/v1/projects",
        headers=auth_headers(token),
        params={"customer_id": str(scholz.customer_id)},
    )
    unbekannt = api.get(
        "/api/v1/projects",
        headers=auth_headers(token),
        params={"customer_id": str(uuid.uuid4())},
    )

    assert fremd.status_code == unbekannt.status_code == 200
    assert fremd.json() == unbekannt.json()
    assert fremd.json()["total_items"] == 0


def test_projekt_kann_keinen_fremden_kunden_bekommen(
    api: TestClient, two_tenants: tuple[Tenant, Tenant]
) -> None:
    """Ein Kunde aus einem anderen Betrieb existiert fuer diesen Betrieb nicht."""
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)

    response = api.post(
        "/api/v1/projects",
        headers=auth_headers(token),
        json={"customer_id": str(scholz.customer_id), "name": "Fremdprojekt"},
    )

    assert response.status_code == 404


def test_fremdes_geschoss_ist_nicht_aenderbar(
    api: TestClient, two_tenants: tuple[Tenant, Tenant]
) -> None:
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)

    response = api.patch(
        f"/api/v1/floors/{scholz.floor_id}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"name": "Uebernommen"},
    )

    assert response.status_code == 404


def test_projekt_kann_nicht_mandantenuebergreifend_verweisen(
    engine: Engine, two_tenants: tuple[Tenant, Tenant]
) -> None:
    """Der zusammengesetzte Fremdschluessel greift in PostgreSQL selbst."""
    scholz, mueller = two_tenants
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        session.add(
            Project(
                organization_id=mueller.organization_id,
                customer_id=scholz.customer_id,
                project_number="PR-2026-9999",
                name="Verbotener Verweis",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
    finally:
        session.close()


# ------------------------------------------- Fachmodul electrical (Phase 3)

ELECTRICAL = "/api/v1/modules/electrical"


def test_fremder_raum_liefert_404(api: TestClient, two_tenants: tuple[Tenant, Tenant]) -> None:
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)

    response = api.get(f"{ELECTRICAL}/rooms/{scholz.room_id}", headers=auth_headers(token))

    assert response.status_code == 404
    assert response.json()["type"].endswith("/not-found")


def test_raumliste_eines_fremden_geschosses_liefert_404(
    api: TestClient, two_tenants: tuple[Tenant, Tenant]
) -> None:
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)

    response = api.get(f"{ELECTRICAL}/floors/{scholz.floor_id}/rooms", headers=auth_headers(token))

    assert response.status_code == 404


def test_raum_kann_nicht_auf_fremdem_geschoss_entstehen(
    api: TestClient, two_tenants: tuple[Tenant, Tenant]
) -> None:
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)

    response = api.post(
        f"{ELECTRICAL}/floors/{scholz.floor_id}/rooms",
        headers=auth_headers(token),
        json={"name": "Fremdraum"},
    )

    assert response.status_code == 404


def test_wand_kann_nicht_in_fremdem_raum_entstehen(
    api: TestClient, two_tenants: tuple[Tenant, Tenant]
) -> None:
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)

    response = api.post(
        f"{ELECTRICAL}/rooms/{scholz.room_id}/walls",
        headers=auth_headers(token),
        json={"x1_mm": 0, "y1_mm": 0, "x2_mm": 1_000, "y2_mm": 0},
    )

    assert response.status_code == 404


def test_oeffnung_kann_nicht_in_fremder_wand_entstehen(
    api: TestClient, two_tenants: tuple[Tenant, Tenant]
) -> None:
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)

    response = api.post(
        f"{ELECTRICAL}/walls/{scholz.wall_id}/openings",
        headers=auth_headers(token),
        json={"kind": "door", "offset_mm": 100, "width_mm": 1_010, "height_mm": 2_010},
    )

    assert response.status_code == 404


def test_fremde_wand_ist_nicht_aenderbar(
    api: TestClient, two_tenants: tuple[Tenant, Tenant]
) -> None:
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)

    response = api.patch(
        f"{ELECTRICAL}/walls/{scholz.wall_id}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"thickness_mm": 240},
    )

    assert response.status_code == 404


def test_raum_kann_nicht_mandantenuebergreifend_verweisen(
    engine: Engine, two_tenants: tuple[Tenant, Tenant]
) -> None:
    """Der zusammengesetzte Fremdschluessel greift in PostgreSQL selbst."""
    scholz, mueller = two_tenants
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        session.add(
            ElectricalRoom(
                organization_id=mueller.organization_id,
                floor_id=scholz.floor_id,
                name="Verbotener Verweis",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
    finally:
        session.close()


def test_wand_kann_nicht_mandantenuebergreifend_verweisen(
    engine: Engine, two_tenants: tuple[Tenant, Tenant]
) -> None:
    scholz, mueller = two_tenants
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        session.add(
            ElectricalWall(
                organization_id=mueller.organization_id,
                room_id=scholz.room_id,
                x1_mm=0,
                y1_mm=0,
                x2_mm=1_000,
                y2_mm=0,
                sort_order=9,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
    finally:
        session.close()


def test_oeffnung_kann_nicht_mandantenuebergreifend_verweisen(
    engine: Engine, two_tenants: tuple[Tenant, Tenant]
) -> None:
    scholz, mueller = two_tenants
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        session.add(
            ElectricalOpening(
                organization_id=mueller.organization_id,
                wall_id=scholz.wall_id,
                kind="door",
                offset_mm=0,
                width_mm=1_010,
                height_mm=2_010,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
    finally:
        session.close()


# ------------------------------------------- Grafischer Editor (Phase 4a)


def test_plan_eines_fremden_geschosses_liefert_404(
    api: TestClient, two_tenants: tuple[Tenant, Tenant]
) -> None:
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)

    response = api.get(f"{ELECTRICAL}/floors/{scholz.floor_id}/plan", headers=auth_headers(token))

    assert response.status_code == 404


def test_plan_zeigt_nur_eigene_raeume(api: TestClient, two_tenants: tuple[Tenant, Tenant]) -> None:
    _, mueller = two_tenants
    token = login(api, mueller.admin_email)

    response = api.get(f"{ELECTRICAL}/floors/{mueller.floor_id}/plan", headers=auth_headers(token))

    assert response.status_code == 200
    assert [raum["id"] for raum in response.json()["rooms"]] == [str(mueller.room_id)]
    assert response.json()["rooms"][0]["walls"][0]["id"] == str(mueller.wall_id)


def test_kontur_kann_keine_fremde_wand_oder_oeffnung_uebernehmen(
    api: TestClient, engine: Engine, two_tenants: tuple[Tenant, Tenant]
) -> None:
    """Fremde IDs im eigenen Konturspeichern: ``422``, der fremde Datensatz bleibt.

    Die fremde Wand-ID ist fuer den Mandanten unsichtbar; sie scheitert am
    Primaerschluessel und wird als vergebene ID abgelehnt - ohne zu verraten,
    wem sie gehoert.
    """
    scholz, mueller = two_tenants
    token = login(api, mueller.admin_email)
    kopf = auth_headers(token)
    raum = api.get(f"{ELECTRICAL}/rooms/{mueller.room_id}", headers=kopf).json()

    fremde_wand = api.put(
        f"{ELECTRICAL}/rooms/{mueller.room_id}/contour",
        headers={**kopf, "If-Match": str(raum["version"])},
        json={
            "walls": [
                {
                    "id": str(mueller.wall_id),
                    "x1_mm": 0,
                    "y1_mm": 0,
                    "x2_mm": 5_000,
                    "y2_mm": 0,
                    "openings": [
                        {
                            "id": str(mueller.opening_id),
                            "kind": "door",
                            "offset_mm": 1_000,
                            "width_mm": 1_010,
                            "height_mm": 2_010,
                        }
                    ],
                },
                {
                    "id": str(scholz.wall_id),
                    "x1_mm": 5_000,
                    "y1_mm": 0,
                    "x2_mm": 5_000,
                    "y2_mm": 4_000,
                },
            ]
        },
    )
    assert fremde_wand.status_code == 422, fremde_wand.text

    fremde_oeffnung = api.put(
        f"{ELECTRICAL}/rooms/{mueller.room_id}/contour",
        headers={**kopf, "If-Match": str(raum["version"])},
        json={
            "walls": [
                {
                    "id": str(mueller.wall_id),
                    "x1_mm": 0,
                    "y1_mm": 0,
                    "x2_mm": 5_000,
                    "y2_mm": 0,
                    "openings": [
                        {
                            "id": str(mueller.opening_id),
                            "kind": "door",
                            "offset_mm": 1_000,
                            "width_mm": 1_010,
                            "height_mm": 2_010,
                        }
                    ],
                },
            ],
            "removed_opening_ids": [str(scholz.opening_id)],
        },
    )
    assert fremde_oeffnung.status_code == 422, fremde_oeffnung.text
    assert "opening-foreign" in {e["code"] for e in fremde_oeffnung.json()["errors"]}

    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        wand = session.get(ElectricalWall, scholz.wall_id)
        assert wand is not None and wand.room_id == scholz.room_id
        assert wand.organization_id == scholz.organization_id
        assert session.get(ElectricalOpening, scholz.opening_id) is not None
        eigene = (
            session.execute(select(ElectricalWall).where(ElectricalWall.room_id == mueller.room_id))
            .scalars()
            .all()
        )
        assert [w.id for w in eigene] == [mueller.wall_id]
    finally:
        session.close()
