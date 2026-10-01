"""Einmal-Links zum Zuruecksetzen eines Passworts (Phase 4e, ADR 0021).

Gespeichert wird ausschliesslich der SHA-256-Hash eines Tokens mit 256 Bit
Zufall. Ein Datensatz existiert nur, solange der Link offen ist: Die
Verwendung loescht ihn, ein neuer Link ersetzt ihn, das Entfernen der
Mitgliedschaft loescht ihn. Je Mitgliedschaft gibt es hoechstens einen.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TenantScoped, Timestamped, UUIDPrimaryKey, tenant_fk


class PasswordResetToken(UUIDPrimaryKey, TenantScoped, Timestamped, Base):
    """Ein offener Reset-Link fuer genau eine Mitgliedschaft.

    Bewusst getrennt von ``member_invitations``: Eine Einladung schafft eine
    Mitgliedschaft, ein Reset aendert das Passwort einer bestehenden. Gemeinsam
    sind nur die gepruefte Token-Erzeugung und das Hashing.
    """

    __tablename__ = "password_reset_tokens"
    __table_args__ = (
        tenant_fk("member_id", "organization_members", ondelete="CASCADE"),
        UniqueConstraint("token_hash"),
        UniqueConstraint("member_id"),
    )

    member_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, default=None
    )
