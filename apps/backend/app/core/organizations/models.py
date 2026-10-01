"""Organisationen (Mandanten), Mitgliedschaften und Modulaktivierung."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import (
    SoftDeletable,
    TenantScoped,
    Timestamped,
    UUIDPrimaryKey,
    Versioned,
    tenant_identity,
)

MEMBER_STATUS_ACTIVE = "active"
#: Historisch vorgesehen, seit Phase 4.2 ungenutzt: Eine offene Einladung ist
#: keine Mitgliedschaft, sondern ein eigener Datensatz
#: (``organization_invitations``, ADR 0015).
MEMBER_STATUS_INVITED = "invited"
#: Zugang zu **diesem** Betrieb gesperrt ("gesperrt"). Das globale Konto bleibt
#: unberuehrt; Rollen, Praeferenzen und Bearbeiterreferenzen bleiben bestehen.
MEMBER_STATUS_DISABLED = "disabled"
#: Endgueltig entfernt (Phase 4e, ADR 0021). Ein Tombstone, kein Soft Delete:
#: Rollen, Praeferenzen, Sitzungen und Reset-Links sind geloescht bzw.
#: widerrufen; gehoert das Konto keinem anderen Betrieb, sind auch Name und
#: E-Mail des Kontos durch neutrale Platzhalter ersetzt. Es gibt keinen Weg
#: zurueck - die Person kann nur neu eingeladen werden.
MEMBER_STATUS_REMOVED = "removed"
MEMBER_STATUSES = (
    MEMBER_STATUS_ACTIVE,
    MEMBER_STATUS_INVITED,
    MEMBER_STATUS_DISABLED,
    MEMBER_STATUS_REMOVED,
)
#: Hoechstens eine **nicht entfernte** Mitgliedschaft je Betrieb und Konto.
#: Eine entfernte bleibt als Tombstone stehen; eine erneute Einladung derselben
#: Person legt daneben eine neue Mitgliedschaft an (ADR 0021).
CURRENT_MEMBERSHIP_INDEX = "uq_organization_members_current_user"
#: Laenge eines optionalen Sperrgrunds - bewusst kurz (Datenminimierung).
LOCK_REASON_MAX_LENGTH = 200


class Organization(UUIDPrimaryKey, Timestamped, SoftDeletable, Base):
    """Ein Elektrofachbetrieb. Zentrale Einheit der Mandantentrennung."""

    __tablename__ = "organizations"
    __table_args__ = (UniqueConstraint("slug"),)

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    legal_name: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)
    street: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)
    postal_code: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    city: Mapped[str | None] = mapped_column(String(120), nullable=True, default=None)
    country_code: Mapped[str] = mapped_column(String(2), nullable=False, default="DE")
    default_tax_rate: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("19.00")
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")


class OrganizationMember(UUIDPrimaryKey, TenantScoped, Timestamped, Versioned, Base):
    """Zugehoerigkeit einer Person zu einem Betrieb (ADR 0006).

    Benutzer sind global; Rollen haengen an dieser Mitgliedschaft, nicht am
    Benutzer. Damit ist Mehrfachmitgliedschaft ohne Migration moeglich.

    ``version`` ist die Version der **verwaltbaren** Mitgliedschaft: Status
    und Rollen. Eine Rollenaenderung zaehlt sie ebenfalls weiter, damit zwei
    Verwaltungsansichten sich nicht still ueberschreiben (ADR 0015).
    ``last_login_at`` gehoert bewusst nicht dazu und wird ohne
    Versionszaehlung geschrieben - sonst machte jede Anmeldung die geoeffnete
    Verwaltungsansicht eines Administrators ungueltig.

    **Kontostatus (Phase 4e, ADR 0021).** ``status`` ist die einzige
    Zustandsmaschine des Benutzerlebenszyklus in einem Betrieb:
    ``active <-> disabled`` (sperren/entsperren), ``active|disabled -> removed``
    (endgueltig). "Einladung ausstehend" ist keine Mitgliedschaft, sondern ein
    Datensatz in ``member_invitations``.

    **Sitzungsversion.** ``session_version`` steht in jedem Access Token und in
    jedem Refresh Token dieser Mitgliedschaft. Jede sicherheitsrelevante
    Aenderung (Sperren, Entsperren, Entfernen, neue E-Mail, neues Passwort)
    zaehlt sie hoch - danach ist **jedes** zuvor ausgestellte Token wertlos,
    auch eines, das eine gleichzeitige Erneuerung noch mit dem alten Stand
    ausgestellt hat. Keine prozesslokale Sperrliste.
    """

    __tablename__ = "organization_members"
    __table_args__ = (
        tenant_identity(),
        Index(
            CURRENT_MEMBERSHIP_INDEX,
            "organization_id",
            "user_id",
            unique=True,
            postgresql_where=text("status <> 'removed'"),
        ),
        CheckConstraint(
            "status IN ('active', 'invited', 'disabled', 'removed')", name="status_known"
        ),
        CheckConstraint(
            "lock_reason IS NULL OR status = 'disabled'", name="lock_reason_only_when_disabled"
        ),
        CheckConstraint("session_version >= 1", name="session_version_positive"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=MEMBER_STATUS_ACTIVE)
    #: Letzte Anmeldung **in diesem Betrieb**. Nicht ``users.last_login_at``:
    #: Das waere eine Auskunft ueber die Taetigkeit in anderen Betrieben.
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )
    #: Optionaler, kurzer Sperrgrund - nur solange gesperrt. Keine sensiblen
    #: Angaben; die Oberflaeche weist darauf hin.
    lock_reason: Mapped[str | None] = mapped_column(
        String(LOCK_REASON_MAX_LENGTH), nullable=True, default=None
    )
    session_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default=text("1")
    )

    @property
    def is_active(self) -> bool:
        return self.status == MEMBER_STATUS_ACTIVE

    @property
    def is_removed(self) -> bool:
        return self.status == MEMBER_STATUS_REMOVED


class OrganizationModule(Timestamped, Base):
    """Aktivierung eines Moduls fuer eine Organisation.

    Im MVP sind alle registrierten Module aktiv. Keine Lizenz- oder
    Abrechnungslogik (docs/modules.md, Abschnitt 7).
    """

    __tablename__ = "organization_modules"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
    )
    module_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
