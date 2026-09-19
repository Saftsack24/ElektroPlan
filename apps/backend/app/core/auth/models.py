"""Refresh-Token-Verwaltung mit Rotation und Diebstahlserkennung."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import Timestamped, UUIDPrimaryKey


class RefreshTokenRevocationReason(StrEnum):
    """Grund, warum ein Refresh Token widerrufen wurde.

    Nur ``ROTATED`` beschreibt einen normal ersetzten Token; jeder andere
    Wert steht fuer einen sofort und eindeutig ungueltigen Token
    (docs/security.md, Abschnitt 3).
    """

    #: Regulaere Rotation. Der Nachfolger steht in ``replaced_by_id``.
    ROTATED = "rotated"
    #: Der Benutzer hat sich abgemeldet.
    LOGOUT = "logout"
    #: Erneute Vorlage eines bereits ersetzten Tokens ausserhalb des
    #: Toleranzfensters -> Diebstahlannahme.
    REUSE_DETECTED = "reuse_detected"
    #: Der Token wurde als Teil einer widerrufenen Familie unwirksam
    #: gemacht (Kontosperrung, Sicherheitsereignis, Familienwiderruf).
    FAMILY_REVOKED = "family_revoked"


class RefreshToken(UUIDPrimaryKey, Timestamped, Base):
    """Ein Refresh-Token.

    Gespeichert wird ausschliesslich der Hash. Bei jeder Nutzung wird rotiert;
    die Wiederverwendung eines bereits ersetzten Tokens invalidiert die gesamte
    Familie (docs/security.md, Abschnitt 3).
    """

    __tablename__ = "refresh_tokens"
    __table_args__ = (UniqueConstraint("token_hash"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    family_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )
    #: Nur gesetzt, wenn ``revoked_at`` gesetzt ist. Erlaubt es der
    #: Refresh-Logik, eine regulaere Rotation von Logout, Reuse oder
    #: Familienwiderruf zu unterscheiden.
    revoked_reason: Mapped[str | None] = mapped_column(String(32), nullable=True, default=None)
    replaced_by_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, default=None)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)

    @property
    def is_revoked(self) -> bool:
        return self.revoked_at is not None

    @property
    def is_rotated(self) -> bool:
        """Nur ``True`` fuer einen regulaer durch Rotation ersetzten Token."""
        return self.revoked_reason == RefreshTokenRevocationReason.ROTATED.value
