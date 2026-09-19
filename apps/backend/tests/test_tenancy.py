"""Mandantengefilterter Datenzugriff (ADR 0006, Ebene 3).

Diese Tests brauchen keine Datenbank: Sie pruefen, dass die Zugriffsschicht
gar nicht erst in die Lage kommt, ungefiltert zu lesen.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.audit.models import AuditEntry
from app.core.tenancy.repository import TenantRepository
from app.errors import MissingTenantContextError


class AuditRepository(TenantRepository[AuditEntry]):
    model = AuditEntry


def test_repository_ohne_organisationskontext_wirft() -> None:
    """Fehlender Kontext liefert einen Fehler - keine ungefilterten Daten."""
    with pytest.raises(MissingTenantContextError, match="ohne Organisationskontext"):
        AuditRepository(session=None, organization_id=None)  # type: ignore[arg-type]


def test_query_filtert_auf_die_organisation() -> None:
    organization_id = uuid.uuid4()
    repository = AuditRepository(session=None, organization_id=organization_id)  # type: ignore[arg-type]

    compiled = repository.query().compile(compile_kwargs={"literal_binds": True})
    sql = str(compiled)

    assert "WHERE audit_entries.organization_id =" in sql
    # SQLAlchemy rendert UUID-Literale ohne Bindestriche.
    assert organization_id.hex in sql or str(organization_id) in sql


def test_add_erzwingt_den_mandantenbezug() -> None:
    organization_id = uuid.uuid4()
    fremde_organisation = uuid.uuid4()

    class FakeSession:
        def __init__(self) -> None:
            self.added: list[object] = []

        def add(self, obj: object) -> None:
            self.added.append(obj)

    session = FakeSession()
    repository = AuditRepository(session=session, organization_id=organization_id)  # type: ignore[arg-type]

    eintrag = AuditEntry(organization_id=fremde_organisation, action="test", entity_type="test")
    with pytest.raises(MissingTenantContextError, match="gehoert zu Organisation"):
        repository.add(eintrag)
    assert session.added == []


def test_add_setzt_die_organisation_wenn_sie_fehlt() -> None:
    organization_id = uuid.uuid4()

    class FakeSession:
        def __init__(self) -> None:
            self.added: list[object] = []

        def add(self, obj: object) -> None:
            self.added.append(obj)

    session = FakeSession()
    repository = AuditRepository(session=session, organization_id=organization_id)  # type: ignore[arg-type]

    eintrag = AuditEntry(action="test", entity_type="test")
    repository.add(eintrag)

    assert eintrag.organization_id == organization_id
    assert session.added == [eintrag]
