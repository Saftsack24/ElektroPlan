"""Benutzer als globale Identitaet (ADR 0006)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import Timestamped, UUIDPrimaryKey


class User(UUIDPrimaryKey, Timestamped, Base):
    """Eine Person.

    Die E-Mail wird immer in Kleinbuchstaben gespeichert; die Eindeutigkeit
    wird dadurch ohne Datenbankerweiterung erreicht.
    """

    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("email"),)

    email: Mapped[str] = mapped_column(String(320), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )
