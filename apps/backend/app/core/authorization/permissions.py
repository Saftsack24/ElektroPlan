"""Permission-Katalog des Core und die ausgelieferten Systemrollen.

Autorisiert wird ueber Permissions, nicht ueber Rollennamen. Rollen sind Daten
pro Organisation und koennen vom Betrieb angepasst werden; die hier
definierten Systemrollen sind lediglich der Startbestand.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.module_registry.descriptor import PermissionDef

# --------------------------------------------------------------- Permissions

ORGANIZATION_PROFILE_READ = "organization.profile.read"
ORGANIZATION_PROFILE_WRITE = "organization.profile.write"
ORGANIZATION_MEMBER_READ = "organization.member.read"
ORGANIZATION_MEMBER_WRITE = "organization.member.write"
USER_ACCOUNT_READ = "user.account.read"
USER_ACCOUNT_WRITE = "user.account.write"
ROLE_ASSIGNMENT_READ = "role.assignment.read"
ROLE_ASSIGNMENT_WRITE = "role.assignment.write"
AUDIT_ENTRY_READ = "audit.entry.read"
FILE_OBJECT_READ = "file.object.read"
FILE_OBJECT_WRITE = "file.object.write"
MODULE_REGISTRY_READ = "module.registry.read"

#: Namensraeume, die der Core beansprucht.
CORE_PERMISSION_NAMESPACES = ("organization", "user", "role", "audit", "file", "module")

CORE_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(ORGANIZATION_PROFILE_READ, "Betriebsdaten ansehen"),
    PermissionDef(ORGANIZATION_PROFILE_WRITE, "Betriebsdaten bearbeiten"),
    PermissionDef(ORGANIZATION_MEMBER_READ, "Mitarbeiter ansehen"),
    PermissionDef(ORGANIZATION_MEMBER_WRITE, "Mitarbeiter verwalten"),
    PermissionDef(USER_ACCOUNT_READ, "Benutzerkonten ansehen"),
    PermissionDef(USER_ACCOUNT_WRITE, "Benutzerkonten verwalten"),
    PermissionDef(ROLE_ASSIGNMENT_READ, "Rollen und Rechte ansehen"),
    PermissionDef(ROLE_ASSIGNMENT_WRITE, "Rollen und Rechte vergeben"),
    PermissionDef(AUDIT_ENTRY_READ, "Protokoll ansehen"),
    PermissionDef(FILE_OBJECT_READ, "Dateien herunterladen"),
    PermissionDef(FILE_OBJECT_WRITE, "Dateien hochladen"),
    PermissionDef(MODULE_REGISTRY_READ, "Aktive Module ansehen"),
)


# ------------------------------------------------------------- Systemrollen


@dataclass(frozen=True, slots=True)
class SystemRole:
    """Vorlage einer ausgelieferten Rolle."""

    key: str
    name: str
    description: str
    permissions: tuple[str, ...]


_BASE_READ = (
    ORGANIZATION_PROFILE_READ,
    MODULE_REGISTRY_READ,
    FILE_OBJECT_READ,
)

SYSTEM_ROLES: tuple[SystemRole, ...] = (
    SystemRole(
        key="admin",
        name="Administrator",
        description="Vollzugriff einschliesslich Benutzer- und Rechteverwaltung",
        permissions=tuple(permission.key for permission in CORE_PERMISSIONS),
    ),
    SystemRole(
        key="planer",
        name="Planer",
        description="Technische Planung",
        permissions=(*_BASE_READ, ORGANIZATION_MEMBER_READ, FILE_OBJECT_WRITE),
    ),
    SystemRole(
        key="kalkulator",
        name="Kalkulator",
        description="Kalkulation und Angebote",
        permissions=(*_BASE_READ, ORGANIZATION_MEMBER_READ),
    ),
    SystemRole(
        key="monteur",
        name="Monteur",
        description="Ausfuehrung auf der Baustelle",
        permissions=_BASE_READ,
    ),
    SystemRole(
        key="lager",
        name="Lager",
        description="Lagerverwaltung",
        permissions=_BASE_READ,
    ),
    SystemRole(
        key="einkauf",
        name="Einkauf",
        description="Beschaffung",
        permissions=_BASE_READ,
    ),
)

SYSTEM_ROLE_KEYS = tuple(role.key for role in SYSTEM_ROLES)
ADMIN_ROLE_KEY = "admin"
