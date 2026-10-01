"""Loeschschutz-Protokoll Core - Registry - Fachmodule (Phase 4d, ADR 0020).

Geprueft wird der Vertrag, nicht ein einzelnes Modul:

* Teilnehmer werden ueber ``ModuleDescriptor.provides`` gebunden und in fester
  Reihenfolge (Modul-ID) gefunden - ohne Aenderung am Loeschdienst.
* Doppelte Bindung und fehlerhafte Teilnehmer verhindern den Start.
* Mehrere Teilnehmer melden ihre Inhalte; jeder loescht nur seine Daten.
* Scheitert ein Teilnehmer, wird die **gesamte** Loeschung zurueckgerollt.
* Berechtigungsinvarianten der Standardrollen.

Benoetigt fuer die Datenbankteile PostgreSQL.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.contracts.v1.project_lifecycle import (
    ProjectContentItem,
    ProjectContentParticipant,
    ProjectContentReport,
    ProjectContentRequest,
)
from app.core import module as core_module
from app.core.auth.security import hash_password
from app.core.authorization.permissions import (
    ADMIN_ONLY_PERMISSIONS,
    PROJECT_RECORD_DELETE,
    PROJECT_RECORD_PURGE,
    PROJECT_RECORD_WRITE,
    SYSTEM_ROLES,
)
from app.core.customers.schemas import CustomerCreate
from app.core.customers.service import CustomerService
from app.core.module_registry.descriptor import ModuleDescriptor, ModuleKind, bind_port
from app.core.module_registry.registry import ModuleRegistrationError, ModuleRegistry
from app.core.organizations.models import Organization
from app.core.projects.deletion import ProjectDeletionService, registered_participants
from app.core.projects.models import Project
from app.core.projects.schemas import ProjectCreate
from app.core.projects.service import ProjectService
from app.core.users.models import User
from app.errors import PermissionDeniedError, ProjectDeletionFailedError
from app.modules import REGISTERED_MODULES
from tests.conftest import requires_database

ACTOR = uuid.UUID("44444444-5555-6666-7777-888888888888")
ADMIN_RECHTE = frozenset({PROJECT_RECORD_DELETE, PROJECT_RECORD_PURGE})
PLANER_RECHTE = frozenset({PROJECT_RECORD_DELETE})

#: Mitschrift der Aufrufe aller Testteilnehmer.
AUFRUFE: list[str] = []


class LeererTeilnehmer:
    def describe_project_content(
        self, session: Session, request: ProjectContentRequest
    ) -> ProjectContentReport:
        AUFRUFE.append("leer.describe")
        return ProjectContentReport(module_id="alpha", has_content=False)

    def delete_project_content(self, session: Session, request: ProjectContentRequest) -> None:
        AUFRUFE.append("leer.delete")


class VollerTeilnehmer:
    """Meldet Inhalte, bis er sie geloescht hat."""

    geloescht = False

    def describe_project_content(
        self, session: Session, request: ProjectContentRequest
    ) -> ProjectContentReport:
        AUFRUFE.append("voll.describe")
        if VollerTeilnehmer.geloescht:
            return ProjectContentReport(module_id="beta", has_content=False)
        return ProjectContentReport(
            module_id="beta",
            has_content=True,
            items=(ProjectContentItem("beta.things", "Dinge", 3),),
        )

    def delete_project_content(self, session: Session, request: ProjectContentRequest) -> None:
        AUFRUFE.append("voll.delete")
        VollerTeilnehmer.geloescht = True


class KaputterTeilnehmer:
    def describe_project_content(
        self, session: Session, request: ProjectContentRequest
    ) -> ProjectContentReport:
        return ProjectContentReport(module_id="gamma", has_content=False)

    def delete_project_content(self, session: Session, request: ProjectContentRequest) -> None:
        raise RuntimeError("Modulfehler")


class FalscheSignatur:
    def describe_project_content(self, session: Session) -> ProjectContentReport:
        return ProjectContentReport(module_id="x", has_content=False)

    def delete_project_content(self, session: Session, request: ProjectContentRequest) -> None:
        return None


def _modul(module_id: str, *implementierungen: type) -> ModuleDescriptor:
    return ModuleDescriptor(
        id=module_id,
        name=module_id,
        version="1.0.0",
        kind=ModuleKind.DOMAIN,
        depends_on=("core",),
        table_prefix=f"{module_id}_",
        provides=tuple(
            bind_port(ProjectContentParticipant, implementierung)  # type: ignore[type-abstract]
            for implementierung in implementierungen
        ),
    )


# ---------------------------------------------------- Registry (ohne Datenbank)


def test_teilnehmer_in_fester_reihenfolge_nach_modul_id() -> None:
    registry = ModuleRegistry()
    registry.register(core_module.DESCRIPTOR)
    # Absichtlich in umgekehrter Reihenfolge registriert.
    registry.register(_modul("zeta", VollerTeilnehmer))
    registry.register(_modul("alpha", LeererTeilnehmer))
    registry.validate()

    gefunden = registry.port_implementations(ProjectContentParticipant)

    assert [module_id for module_id, _ in gefunden] == ["alpha", "zeta"]
    assert [type(impl).__name__ for _, impl in registered_participants(registry)] == [
        "LeererTeilnehmer",
        "VollerTeilnehmer",
    ]


def test_electrical_ist_als_teilnehmer_registriert(registry: ModuleRegistry) -> None:
    assert [module_id for module_id, _ in registered_participants(registry)] == ["electrical"]
    assert [module.id for module in REGISTERED_MODULES] == ["electrical"]


def test_doppelte_bindung_verhindert_den_start() -> None:
    registry = ModuleRegistry()
    registry.register(core_module.DESCRIPTOR)
    registry.register(_modul("doppelt", LeererTeilnehmer, VollerTeilnehmer))

    with pytest.raises(ModuleRegistrationError, match="mehrfach"):
        registry.validate()


def test_doppelte_modulregistrierung_wird_abgelehnt() -> None:
    registry = ModuleRegistry()
    registry.register(_modul("alpha", LeererTeilnehmer))

    with pytest.raises(ModuleRegistrationError, match="bereits vergeben"):
        registry.register(_modul("alpha", LeererTeilnehmer))


def test_fehlerhafter_teilnehmer_verhindert_den_start() -> None:
    registry = ModuleRegistry()
    registry.register(core_module.DESCRIPTOR)
    registry.register(_modul("kaputt", FalscheSignatur))

    with pytest.raises(ModuleRegistrationError):
        registry.validate()


def test_bericht_mit_inhalt_braucht_eine_inhaltsart() -> None:
    with pytest.raises(ValueError, match="Inhaltsart"):
        ProjectContentReport(module_id="x", has_content=True)


# ------------------------------------------------------ Berechtigungsinvarianten


def test_administratorrechte_hat_keine_andere_standardrolle(registry: ModuleRegistry) -> None:
    for role in SYSTEM_ROLES:
        if role.key == "admin":
            assert set(role.permissions) >= ADMIN_ONLY_PERMISSIONS
        else:
            assert not ADMIN_ONLY_PERMISSIONS & set(role.permissions), role.key
    for module in registry.modules:
        for permission in module.permissions:
            if permission.key in ADMIN_ONLY_PERMISSIONS:
                assert permission.default_roles == ()


def test_leere_projekte_loeschen_genau_die_projektbearbeiter() -> None:
    bearbeiter = {role.key for role in SYSTEM_ROLES if PROJECT_RECORD_WRITE in role.permissions}
    loescher = {role.key for role in SYSTEM_ROLES if PROJECT_RECORD_DELETE in role.permissions}

    assert loescher == bearbeiter == {"admin", "planer"}


@requires_database
@pytest.mark.database
def test_seed_vergibt_administratorrechte_nur_dem_administrator(
    engine: Engine, registry: ModuleRegistry, clean_database: None
) -> None:
    from app.core.authorization.models import Permission, Role, RolePermission
    from app.core.seed import seed_initial_data

    factory = sessionmaker(bind=engine)
    session = factory()
    try:
        seed_initial_data(
            session,
            registry,
            organization_name="Invariante GmbH",
            admin_email="admin@invariante.example",
            admin_password="test-passwort-1234",
        )
        session.commit()
        zeilen = session.execute(
            select(Role.key, Permission.key)
            .join(RolePermission, RolePermission.role_id == Role.id)
            .join(Permission, Permission.id == RolePermission.permission_id)
            .where(Permission.key.in_(ADMIN_ONLY_PERMISSIONS))
        ).all()
    finally:
        session.close()

    assert {rolle for rolle, _ in zeilen} == {"admin"}
    assert {recht for _, recht in zeilen} == set(ADMIN_ONLY_PERMISSIONS)


# ---------------------------------------------------------- mit Datenbank


@pytest.fixture
def factory(engine: Engine, clean_database: None) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture
def projekt(factory: sessionmaker[Session]) -> tuple[uuid.UUID, uuid.UUID]:
    AUFRUFE.clear()
    VollerTeilnehmer.geloescht = False
    session = factory()
    try:
        organization = Organization(name="Protokoll GmbH", slug="protokoll")
        session.add(organization)
        session.add(
            User(
                id=ACTOR,
                email="protokoll@test.example",
                password_hash=hash_password("test-passwort-1234"),
                full_name="Petra Protokoll",
            )
        )
        session.flush()
        kunde = CustomerService(session, organization.id).create(
            CustomerCreate(name="Bauherr"), actor_user_id=ACTOR
        )
        projekt = ProjectService(session, organization.id).create(
            ProjectCreate(customer_id=kunde.id, name="Neubau"), actor_user_id=ACTOR
        )
        session.commit()
        return organization.id, projekt.id
    finally:
        session.close()


def _existiert(factory: sessionmaker[Session], project_id: uuid.UUID) -> bool:
    session = factory()
    try:
        return bool(
            session.execute(select(func.count()).where(Project.id == project_id)).scalar_one()
        )
    finally:
        session.close()


@requires_database
@pytest.mark.database
def test_mehrere_teilnehmer_melden_und_loeschen(
    factory: sessionmaker[Session], projekt: tuple[uuid.UUID, uuid.UUID]
) -> None:
    organization_id, project_id = projekt
    teilnehmer = (("alpha", LeererTeilnehmer()), ("beta", VollerTeilnehmer()))
    session = factory()
    try:
        service = ProjectDeletionService(session, organization_id, teilnehmer)
        bewertung = service.assess(project_id, permissions=PLANER_RECHTE)
        assert [item.code for item in bewertung.items] == ["beta.things"]
        assert bewertung.can_delete is False

        with pytest.raises(PermissionDeniedError):
            service.delete(
                project_id,
                expected_version=1,
                permissions=PLANER_RECHTE,
                confirm_project_number=None,
            )
        session.rollback()
        assert "voll.delete" not in AUFRUFE

        nummer = service.projects.get(project_id).project_number
        AUFRUFE.clear()
        service.delete(
            project_id,
            expected_version=1,
            permissions=ADMIN_RECHTE,
            confirm_project_number=nummer,
        )
        session.commit()
    finally:
        session.close()

    # Pruefen - loeschen in Modulreihenfolge - nachkontrollieren.
    assert AUFRUFE == [
        "leer.describe",
        "voll.describe",
        "leer.delete",
        "voll.delete",
        "leer.describe",
        "voll.describe",
    ]
    assert not _existiert(factory, project_id)


@requires_database
@pytest.mark.database
def test_scheiternder_teilnehmer_rollt_alles_zurueck(
    factory: sessionmaker[Session], projekt: tuple[uuid.UUID, uuid.UUID]
) -> None:
    organization_id, project_id = projekt
    teilnehmer = (("alpha", LeererTeilnehmer()), ("gamma", KaputterTeilnehmer()))
    session = factory()
    try:
        service = ProjectDeletionService(session, organization_id, teilnehmer)
        with pytest.raises(ProjectDeletionFailedError):
            service.delete(
                project_id,
                expected_version=1,
                permissions=ADMIN_RECHTE,
                confirm_project_number=None,
            )
        session.rollback()
    finally:
        session.close()

    assert _existiert(factory, project_id)


@requires_database
@pytest.mark.database
def test_teilnehmer_der_inhalte_zuruecklaesst_bricht_ab(
    factory: sessionmaker[Session], projekt: tuple[uuid.UUID, uuid.UUID]
) -> None:
    class Stur(VollerTeilnehmer):
        def delete_project_content(self, session: Session, request: ProjectContentRequest) -> None:
            AUFRUFE.append("stur.delete")  # loescht nichts

    organization_id, project_id = projekt
    session = factory()
    try:
        service = ProjectDeletionService(session, organization_id, (("beta", Stur()),))
        nummer = service.projects.get(project_id).project_number
        with pytest.raises(ProjectDeletionFailedError):
            service.delete(
                project_id,
                expected_version=1,
                permissions=ADMIN_RECHTE,
                confirm_project_number=nummer,
            )
        session.rollback()
    finally:
        session.close()

    assert _existiert(factory, project_id)
