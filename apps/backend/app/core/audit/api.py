"""Endpunkte fuer das Audit-Protokoll."""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.audit import service as audit
from app.core.audit.models import AuditEntry
from app.core.auth.dependencies import CurrentUser, require_permission
from app.core.authorization.permissions import AUDIT_ENTRY_READ
from app.core.pagination import DEFAULT_LIMIT, Page, clamp_limit, decode_cursor, encode_cursor
from app.db.session import get_session

router = APIRouter(tags=["audit"])


class AuditEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    action: str
    entity_type: str
    entity_id: uuid.UUID | None
    module_id: str
    summary: str
    actor_user_id: uuid.UUID | None
    request_id: str | None
    created_at: datetime


@router.get(
    "/audit",
    response_model=Page[AuditEntryOut],
    operation_id="listAuditEntries",
    summary="Protokolleintraege",
)
def list_audit_entries(
    current_user: CurrentUser = Depends(require_permission(AUDIT_ENTRY_READ)),
    session: Session = Depends(get_session),
    action: str | None = Query(default=None, max_length=80),
    entity_type: str | None = Query(default=None, max_length=60),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=200),
    cursor: str | None = Query(default=None),
) -> Page[AuditEntryOut]:
    """Protokoll der eigenen Organisation, neueste zuerst."""
    page_size = clamp_limit(limit)
    stmt = audit.query_entries(current_user.organization_id, action=action, entity_type=entity_type)
    if cursor:
        created_at, entity_id = decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                AuditEntry.created_at < created_at,
                (AuditEntry.created_at == created_at) & (AuditEntry.id < entity_id),
            )
        )
    stmt = stmt.order_by(AuditEntry.created_at.desc(), AuditEntry.id.desc())
    rows = list(session.execute(stmt.limit(page_size + 1)).scalars().all())

    has_more = len(rows) > page_size
    visible = rows[:page_size]
    next_cursor = (
        encode_cursor(visible[-1].created_at, visible[-1].id) if has_more and visible else None
    )
    return Page[AuditEntryOut](
        items=[AuditEntryOut.model_validate(row) for row in visible],
        next_cursor=next_cursor,
        has_more=has_more,
    )
