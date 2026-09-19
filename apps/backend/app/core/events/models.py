"""Persistiertes Event-Log.

Die Tabelle ist append-only; einzige erlaubte Aenderung ist ``handler_status``.
Sie dient der Nachvollziehbarkeit und ist zugleich eine fertige Outbox fuer
einen spaeteren Wechsel auf asynchrone Verarbeitung (ADR 0004).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TenantScoped, UUIDPrimaryKey

HANDLER_STATUS_PENDING = "pending"
HANDLER_STATUS_OK = "ok"
HANDLER_STATUS_PARTIAL = "partial"
HANDLER_STATUS_FAILED = "failed"


class DomainEventRecord(UUIDPrimaryKey, TenantScoped, Base):
    """Eine zugestellte Tatsache."""

    __tablename__ = "domain_events"
    __table_args__ = (
        Index("ix_domain_events_organization_id_occurred_at", "organization_id", "occurred_at"),
        Index("ix_domain_events_event_type", "event_type"),
    )

    event_type: Mapped[str] = mapped_column(String(120), nullable=False)
    event_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    aggregate_type: Mapped[str] = mapped_column(String(60), nullable=False)
    aggregate_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, default=None)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    handler_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=HANDLER_STATUS_PENDING
    )
    handler_error: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
