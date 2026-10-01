"""Kommandozeilenwerkzeuge.

python -m app.cli seed
python -m app.cli check-modules
python -m app.cli export-openapi [pfad]
python -m app.cli purge-invitations
python -m app.cli storage-cleanup
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from app.config import get_settings
from app.core.files import cleanup
from app.core.files.storage import get_object_storage
from app.core.invitations.service import purge_invitations
from app.core.seed import seed_initial_data
from app.db.mixins import utcnow
from app.db.session import session_scope
from app.main import build_registry, create_app


def cmd_seed(args: list[str]) -> int:
    """Legt den Startbestand an (idempotent)."""
    password = args[0] if args else None
    registry = build_registry()
    with session_scope() as session:
        result = seed_initial_data(session, registry, admin_password=password)
    print(f"Organisation: {result.organization_id}")
    print(f"Administrator: {result.admin_user_id}")
    print(f"Neue Berechtigungen: {result.permissions_created}")
    return 0


def cmd_check_modules(_: list[str]) -> int:
    """Prueft die Modulkonfiguration ohne die Anwendung zu starten."""
    registry = build_registry()
    for module in registry.modules:
        print(
            f"{module.id:16} {module.kind:8} v{module.version} "
            f"({len(module.permissions)} Permissions)"
        )
    print(f"OK: {len(registry)} Module, Konfiguration gueltig.")
    return 0


def cmd_export_openapi(args: list[str]) -> int:
    """Schreibt das OpenAPI-Dokument - Grundlage des generierten API-Clients."""
    target = Path(args[0]) if args else Path("openapi.json")
    schema = create_app().openapi()
    target.write_text(json.dumps(schema, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"OpenAPI geschrieben: {target} ({len(schema['paths'])} Endpunkte)")
    return 0


def cmd_purge_invitations(_: list[str]) -> int:
    """Loescht abgeschlossene und abgelaufene Einladungen nach der Aufbewahrungsfrist."""
    days = get_settings().invitation_retention_days
    with session_scope() as session:
        removed = purge_invitations(session, now=utcnow(), retention_days=days)
    print(f"Entfernte Einladungen: {removed} (aelter als {days} Tage abgeschlossen)")
    return 0


def cmd_storage_cleanup(_: list[str]) -> int:
    """Arbeitet offene Storage-Aufraeumauftraege ab (ADR 0020).

    Idempotent: Erledigte Auftraege verschwinden, gescheiterte bleiben mit
    Versuchszaehler und letzter Meldung stehen. Rueckgabe 1, wenn danach noch
    Auftraege offen sind - damit ein Betriebsjob den Rest bemerkt.
    """
    with session_scope() as session:
        result = cleanup.process_jobs(session, get_object_storage())
        remaining = cleanup.pending_count(session)
    print(f"Entfernt: {result.removed}, fehlgeschlagen: {result.failed}, offen: {remaining}")
    return 1 if remaining else 0


COMMANDS = {
    "seed": cmd_seed,
    "check-modules": cmd_check_modules,
    "export-openapi": cmd_export_openapi,
    "purge-invitations": cmd_purge_invitations,
    "storage-cleanup": cmd_storage_cleanup,
}


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] not in COMMANDS:
        print(f"Verwendung: python -m app.cli [{' | '.join(COMMANDS)}]")
        return 2
    return COMMANDS[argv[0]](argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
