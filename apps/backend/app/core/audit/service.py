"""Audit-Service.

Eintraege werden an fachlich definierten Punkten explizit geschrieben. Es gibt
bewusst kein generisches ORM-Auditing: Das erzeugt Rauschen statt
Nachvollziehbarkeit (docs/architecture-review.md, B-16c).
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.core.audit.models import AuditEntry
from app.logging_config import request_id_var

# --- Aktionen, die protokolliert werden (docs/security.md, Abschnitt 9) ---
ACTION_LOGIN = "auth.login"
ACTION_LOGIN_FAILED = "auth.login_failed"
ACTION_LOGOUT = "auth.logout"
ACTION_TOKEN_REUSE = "auth.token_reuse_detected"  # noqa: S105 - Aktionsname
ACTION_ORGANIZATION_SWITCHED = "auth.organization_switched"
ACTION_ROLE_ASSIGNED = "authorization.role_assigned"
ACTION_ROLE_REVOKED = "authorization.role_revoked"
ACTION_FILE_UPLOADED = "file.uploaded"
ACTION_FILE_DOWNLOADED = "file.downloaded"


def record(
    session: Session,
    *,
    organization_id: uuid.UUID,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID | None = None,
    actor_user_id: uuid.UUID | None = None,
    summary: str = "",
    data: dict[str, Any] | None = None,
    module_id: str = "core",
) -> AuditEntry:
    """Schreibt einen unveraenderlichen Protokolleintrag.

    Der Aufrufer entscheidet ueber den Commit - der Eintrag gehoert zur selben
    Transaktion wie die protokollierte Aenderung.
    """
    entry = AuditEntry(
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        module_id=module_id,
        summary=summary[:255],
        data=data or {},
        request_id=request_id_var.get(),
    )
    session.add(entry)
    return entry


def query_entries(
    organization_id: uuid.UUID,
    *,
    action: str | None = None,
    entity_type: str | None = None,
) -> Select[tuple[AuditEntry]]:
    """Abfrage fuer die Protokollansicht - immer mandantengefiltert."""
    stmt = (
        select(AuditEntry)
        .where(AuditEntry.organization_id == organization_id)
        .order_by(AuditEntry.created_at.desc())
    )
    if action:
        stmt = stmt.where(AuditEntry.action == action)
    if entity_type:
        stmt = stmt.where(AuditEntry.entity_type == entity_type)
    return stmt
