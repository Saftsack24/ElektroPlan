"""Modulbeschreibung des Core.

Der Core registriert sich ueber denselben Mechanismus wie jedes andere Modul.
Damit gibt es genau einen Weg, Permissions und Router bekannt zu machen.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.core.audit.api import router as audit_router
from app.core.auth.api import router as auth_router
from app.core.authorization.permissions import CORE_PERMISSION_NAMESPACES, CORE_PERMISSIONS
from app.core.files.api import router as files_router
from app.core.module_registry.api import router as modules_router
from app.core.module_registry.descriptor import ModuleDescriptor, ModuleKind

core_router = APIRouter()
core_router.include_router(auth_router)
core_router.include_router(modules_router)
core_router.include_router(audit_router)
core_router.include_router(files_router)

#: Tabellen des Core. Als Positivliste gefuehrt, weil der Core kein
#: Tabellenpraefix hat und ein Praefix wie ``core_`` in der Praxis nur
#: Rauschen im Schema erzeugen wuerde. Die statische Grenzpruefung in
#: :mod:`app.core.module_registry.boundaries` benutzt diese Liste, um
#: erlaubte FK-Ziele zu bestimmen (docs/database.md, Abschnitt 1).
CORE_TABLES: tuple[str, ...] = (
    "organizations",
    "users",
    "organization_members",
    "organization_modules",
    "roles",
    "permissions",
    "role_permissions",
    "member_roles",
    "refresh_tokens",
    "number_sequences",
    "files",
    "audit_entries",
    "domain_events",
)

DESCRIPTOR = ModuleDescriptor(
    id="core",
    name="Plattform",
    version="1.0.0",
    kind=ModuleKind.CORE,
    depends_on=(),
    table_prefix="",
    permissions=CORE_PERMISSIONS,
    permission_namespaces=CORE_PERMISSION_NAMESPACES,
    router=core_router,
    subscriptions=(),
    provides=(),
)
