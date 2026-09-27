"""Einladungen in einen Betrieb (ADR 0015).

Eine offene Einladung ist **keine** Mitgliedschaft: Sie haengt an einer
E-Mail-Adresse, nicht an einem Benutzer - das globale Konto existiert
womoeglich noch gar nicht. Erst die Annahme erzeugt die Mitgliedschaft.

Gespeichert wird ausschliesslich der SHA-256-Hash des Einmal-Tokens. Der
Klartext verlaesst den Server genau einmal: in der Zustellung.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import (
    TenantScoped,
    Timestamped,
    UUIDPrimaryKey,
    Versioned,
    tenant_fk,
    tenant_identity,
)

INVITATION_STATUS_PENDING = "pending"
INVITATION_STATUS_EXPIRED = "expired"
INVITATION_STATUS_ACCEPTED = "accepted"
INVITATION_STATUS_REVOKED = "revoked"

#: Name des partiellen eindeutigen Index: je Betrieb und E-Mail hoechstens
#: eine offene Einladung. Unter Parallelitaet entscheidet er, nicht die
#: Vorabpruefung (docs/database.md, "Sperrreihenfolge und Nebenlaeufigkeit").
OPEN_INVITATION_INDEX = "uq_member_invitations_open_email"


class MemberInvitation(UUIDPrimaryKey, TenantScoped, Timestamped, Versioned, Base):
    """Einladung einer E-Mail-Adresse in einen Betrieb.

    Der Zustand ist abgeleitet, nicht gespeichert: angenommen
    (``accepted_at``), widerrufen (``revoked_at``), abgelaufen
    (``expires_at`` erreicht) oder offen. Eine erneute Ausstellung ersetzt
    ``token_hash`` und ``expires_at`` - das alte Token findet danach keinen
    Datensatz mehr.
    """

    __tablename__ = "member_invitations"
    __table_args__ = (
        tenant_identity(),
        UniqueConstraint("token_hash"),
        Index(
            OPEN_INVITATION_INDEX,
            "organization_id",
            "email",
            unique=True,
            postgresql_where=text("accepted_at IS NULL AND revoked_at IS NULL"),
        ),
    )

    #: Normalisiert: ohne Randleerzeichen, klein geschrieben.
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    #: Vorschlag fuer den Anzeigenamen. Ein bestehendes Konto behaelt seinen.
    full_name: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, default=None
    )
    accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    def status_at(self, now: datetime) -> str:
        """Abgeleiteter Zustand zum Zeitpunkt ``now``."""
        if self.accepted_at is not None:
            return INVITATION_STATUS_ACCEPTED
        if self.revoked_at is not None:
            return INVITATION_STATUS_REVOKED
        if self.expires_at <= now:
            return INVITATION_STATUS_EXPIRED
        return INVITATION_STATUS_PENDING

    @property
    def is_closed(self) -> bool:
        """Angenommen oder widerrufen - unabhaengig vom Ablauf."""
        return self.accepted_at is not None or self.revoked_at is not None


class MemberInvitationRole(TenantScoped, Base):
    """Vorgesehene Systemrolle einer Einladung.

    Zusammengesetzte Fremdschluessel: Einladung und Rolle gehoeren
    nachweislich zum selben Betrieb (ADR 0006).
    """

    __tablename__ = "member_invitation_roles"
    __table_args__ = (
        tenant_fk("invitation_id", "member_invitations", ondelete="CASCADE"),
        tenant_fk("role_id", "roles", ondelete="CASCADE"),
    )

    invitation_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    role_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
