"""Audit-Log.

Eintraege werden an fachlich definierten Punkten explizit geschrieben, nicht
generisch ueber ORM-Hooks (docs/architecture-review.md, B-16c). Sie sind
unveraenderlich.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TenantScoped, UUIDPrimaryKey


class AuditEntry(UUIDPrimaryKey, TenantScoped, Base):
    """Wer hat was wann an welchem Objekt getan."""

    __tablename__ = "audit_entries"
    __table_args__ = (
        Index("ix_audit_entries_organization_id_created_at", "organization_id", "created_at"),
        Index("ix_audit_entries_entity_type_entity_id", "entity_type", "entity_id"),
    )

    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, default=None)
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(60), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, default=None)
    module_id: Mapped[str] = mapped_column(String(60), nullable=False, default="core")
    summary: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
