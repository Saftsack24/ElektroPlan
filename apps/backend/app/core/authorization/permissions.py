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
#: Einladen, Einladungen widerrufen und neu ausstellen. Sperren ist seit
#: Phase 4e ein eigenes Recht (``user.account.lock``).
USER_ACCOUNT_WRITE = "user.account.write"
#: Name und E-Mail-Adresse eines Kontos aendern - nur Konten, die keinem
#: anderen Betrieb angehoeren (ADR 0021). **Nur Administrator.**
USER_PROFILE_WRITE = "user.profile.write"
#: Zugang sperren und entsperren. **Nur Administrator.**
USER_ACCOUNT_LOCK = "user.account.lock"
#: Einen Einmal-Link zum Zuruecksetzen des Passworts ausloesen. **Nur Administrator.**
USER_PASSWORD_RESET = "user.password.reset"  # noqa: S105 - Berechtigungsschluessel
#: Ein Mitglied endgueltig entfernen (Tombstone). **Nur Administrator.**
USER_ACCOUNT_REMOVE = "user.account.remove"
#: Die **eigenen** persoenlichen Einstellungen speichern. Jede Systemrolle.
USER_PREFERENCES_WRITE = "user.preferences.write"
ROLE_ASSIGNMENT_READ = "role.assignment.read"
ROLE_ASSIGNMENT_WRITE = "role.assignment.write"
CUSTOMER_RECORD_READ = "customer.record.read"
CUSTOMER_RECORD_WRITE = "customer.record.write"
#: Endgueltiges Loeschen eines Kunden ohne Projekte - **nur Administrator**
#: (ADR 0020). Ersetzt seit Phase 4d das Ausblenden und die Anonymisierung.
CUSTOMER_RECORD_DELETE = "customer.record.delete"
PROJECT_RECORD_READ = "project.record.read"
PROJECT_RECORD_WRITE = "project.record.write"
#: Endgueltiges Loeschen eines **leeren** Projekts (Entwurf oder in
#: Bearbeitung). Erhalten genau die Rollen, die Projekte bearbeiten duerfen.
PROJECT_RECORD_DELETE = "project.record.delete"
#: Endgueltiges Loeschen eines Projekts **mit Inhalt** - nur Administrator.
PROJECT_RECORD_PURGE = "project.record.purge"
#: ``completed -> active`` - nur Administrator (ADR 0020).
PROJECT_RECORD_REOPEN = "project.record.reopen"
AUDIT_ENTRY_READ = "audit.entry.read"
FILE_OBJECT_READ = "file.object.read"
FILE_OBJECT_WRITE = "file.object.write"
MODULE_REGISTRY_READ = "module.registry.read"

#: Namensraeume, die der Core beansprucht.
CORE_PERMISSION_NAMESPACES = (
    "organization",
    "user",
    "role",
    "customer",
    "project",
    "audit",
    "file",
    "module",
)

CORE_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(ORGANIZATION_PROFILE_READ, "Betriebsdaten ansehen"),
    PermissionDef(ORGANIZATION_PROFILE_WRITE, "Betriebsdaten bearbeiten"),
    PermissionDef(ORGANIZATION_MEMBER_READ, "Mitarbeiter ansehen"),
    PermissionDef(ORGANIZATION_MEMBER_WRITE, "Mitarbeiter verwalten"),
    PermissionDef(USER_ACCOUNT_READ, "Benutzerkonten ansehen"),
    PermissionDef(USER_ACCOUNT_WRITE, "Benutzer einladen und Einladungen verwalten"),
    PermissionDef(USER_PROFILE_WRITE, "Name und E-Mail-Adresse von Benutzern ändern"),
    PermissionDef(USER_ACCOUNT_LOCK, "Benutzer sperren und entsperren"),
    PermissionDef(USER_PASSWORD_RESET, "Passwortzurücksetzung für Benutzer auslösen"),
    PermissionDef(USER_ACCOUNT_REMOVE, "Benutzer endgültig entfernen"),
    PermissionDef(USER_PREFERENCES_WRITE, "Eigene Einstellungen speichern"),
    PermissionDef(ROLE_ASSIGNMENT_READ, "Rollen und Rechte ansehen"),
    PermissionDef(ROLE_ASSIGNMENT_WRITE, "Rollen und Rechte vergeben"),
    PermissionDef(CUSTOMER_RECORD_READ, "Kunden ansehen"),
    PermissionDef(CUSTOMER_RECORD_WRITE, "Kunden anlegen und bearbeiten"),
    PermissionDef(CUSTOMER_RECORD_DELETE, "Kunden ohne Projekte endgültig löschen"),
    PermissionDef(PROJECT_RECORD_READ, "Projekte ansehen"),
    PermissionDef(PROJECT_RECORD_WRITE, "Projekte anlegen und bearbeiten"),
    PermissionDef(PROJECT_RECORD_DELETE, "Leere Projekte endgültig löschen"),
    PermissionDef(PROJECT_RECORD_PURGE, "Projekte mit Inhalt endgültig löschen"),
    PermissionDef(PROJECT_RECORD_REOPEN, "Abgeschlossene Projekte wieder in Bearbeitung setzen"),
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
    # Kein Lesen, aber Grundausstattung jeder Rolle: die eigene Darstellung und
    # Masseinheit speichern (Phase 4e). Betrifft nur die eigene Mitgliedschaft.
    USER_PREFERENCES_WRITE,
)

#: Wer plant oder kalkuliert, braucht Projekt- und Kundendaten lesend.
_BUSINESS_READ = (
    CUSTOMER_RECORD_READ,
    PROJECT_RECORD_READ,
)

SYSTEM_ROLES: tuple[SystemRole, ...] = (
    SystemRole(
        key="admin",
        name="Administrator",
        description=(
            "Für Inhaber und Büroleitung: voller Zugriff auf alle Bereiche, "
            "einschließlich Benutzer einladen, bearbeiten, sperren, entfernen und Rollen vergeben."
        ),
        permissions=tuple(permission.key for permission in CORE_PERMISSIONS),
    ),
    SystemRole(
        key="planer",
        name="Planer",
        description=(
            "Für die technische Planung: Projekte anlegen und bearbeiten, Pläne "
            "hochladen, Kunden und Kollegen ansehen."
        ),
        permissions=(
            *_BASE_READ,
            *_BUSINESS_READ,
            ORGANIZATION_MEMBER_READ,
            FILE_OBJECT_WRITE,
            PROJECT_RECORD_WRITE,
            # Wer Projekte bearbeitet, darf ein versehentlich angelegtes,
            # **leeres** Projekt wieder loeschen (ADR 0020).
            PROJECT_RECORD_DELETE,
        ),
    ),
    SystemRole(
        key="kalkulator",
        name="Kalkulator",
        description=(
            "Für Kalkulation und Angebote: Kunden anlegen und pflegen, Projekte und "
            "Kollegen ansehen."
        ),
        permissions=(
            *_BASE_READ,
            *_BUSINESS_READ,
            ORGANIZATION_MEMBER_READ,
            CUSTOMER_RECORD_WRITE,
        ),
    ),
    SystemRole(
        key="monteur",
        name="Monteur",
        description=(
            "Für die Ausführung auf der Baustelle: Projekte und Pläne ansehen, nichts verändern."
        ),
        permissions=(*_BASE_READ, PROJECT_RECORD_READ),
    ),
    SystemRole(
        key="lager",
        name="Lager",
        description=(
            "Für die Lagerverwaltung. Bis zum Lagermodul nur Grundzugriff auf "
            "Betriebsdaten und Dateien."
        ),
        permissions=_BASE_READ,
    ),
    SystemRole(
        key="einkauf",
        name="Einkauf",
        description=(
            "Für die Beschaffung. Bis zum Materialmodul nur Grundzugriff auf "
            "Betriebsdaten und Dateien."
        ),
        permissions=_BASE_READ,
    ),
)

SYSTEM_ROLE_KEYS = tuple(role.key for role in SYSTEM_ROLES)
ADMIN_ROLE_KEY = "admin"

#: Berechtigungen, die **ausschliesslich** die Administratorrolle erhalten darf.
#: Ein Architekturtest haelt fest, dass keine andere Systemrolle und kein
#: ``default_roles`` eines Moduls sie vergibt (ADR 0020).
ADMIN_ONLY_PERMISSIONS: frozenset[str] = frozenset(
    {
        PROJECT_RECORD_PURGE,
        PROJECT_RECORD_REOPEN,
        CUSTOMER_RECORD_DELETE,
        # Benutzerlebenszyklus (Phase 4e, ADR 0021)
        USER_PROFILE_WRITE,
        USER_ACCOUNT_LOCK,
        USER_PASSWORD_RESET,
        USER_ACCOUNT_REMOVE,
    }
)

#: Verstaendliche Bereichsnamen der Core-Berechtigungen, gebildet aus dem
#: ersten Teil des Schluessels. Berechtigungen eines Moduls tragen den Namen
#: ihres Moduls - der Core kennt dafuer keine Modulschluessel, er liest sie
#: aus der Module Registry.
CORE_PERMISSION_AREAS: dict[str, str] = {
    "organization": "Betrieb",
    "user": "Benutzerverwaltung",
    "role": "Benutzerverwaltung",
    "customer": "Kunden",
    "project": "Projekte",
    "file": "Dateien",
    "audit": "Protokoll",
    "module": "System",
}
