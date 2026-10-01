"""Persoenliche Darstellungs- und Masseinstellungen (Phase 4e, ADR 0021).

Der Server ist die verbindliche Quelle; der Browser haelt nur einen Cache je
Mitgliedschaft. Gespeichert werden ausschliesslich drei typisierte Werte -
keine beliebige JSON-Ablage. Unbekannte Werte lehnt bereits die Datenbank ab.

**Je Mitgliedschaft, nicht je globalem Konto.** Jede mandantenbezogene Tabelle
traegt ``organization_id`` (ADR 0006); ein Datensatz gehoert deshalb genau einer
Mitgliedschaft. Gehoert ein Konto mehreren Betrieben an, hat es je Betrieb
eigene Einstellungen. Wird die Mitgliedschaft entfernt, verschwinden sie mit
ihr (Fremdschluessel ``ON DELETE CASCADE`` und ausdrueckliches Loeschen beim
Entfernen).
"""

from __future__ import annotations

import uuid

from sqlalchemy import CheckConstraint, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TenantScoped, Timestamped, UUIDPrimaryKey, Versioned, tenant_fk

THEME_MODES = ("system", "light", "dark")
#: Die stabilen Akzentschluessel der Oberflaeche (``core/theme/darstellung.ts``).
#: Ein neuer Akzent braucht eine Migration - beliebige Farben gibt es bewusst nicht.
ACCENTS = ("blue", "teal", "green", "violet", "orange")
LENGTH_UNITS = ("mm", "cm", "m")

DEFAULT_THEME_MODE = "system"
DEFAULT_ACCENT = "blue"
DEFAULT_LENGTH_UNIT = "cm"

#: Hoechstens ein Datensatz je Mitgliedschaft. Unter Parallelitaet (zwei Geraete
#: legen gleichzeitig an) entscheidet diese Constraint, nicht eine Vorabpruefung.
PREFERENCES_MEMBER_CONSTRAINT = "uq_user_preferences_member_id"


def _in(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


class UserPreferences(UUIDPrimaryKey, TenantScoped, Timestamped, Versioned, Base):
    """Darstellung, Akzentfarbe und Masseinheit eines Benutzers in einem Betrieb.

    ``version`` schuetzt vor stillem Ueberschreiben zwischen zwei Geraeten
    (``If-Match``). Laengen bleiben ueberall ganzzahlige Millimeter; die
    Masseinheit ist nur die Anzeige.
    """

    __tablename__ = "user_preferences"
    __table_args__ = (
        tenant_fk("member_id", "organization_members", ondelete="CASCADE"),
        UniqueConstraint("member_id"),
        CheckConstraint(f"theme_mode IN ({_in(THEME_MODES)})", name="theme_mode_known"),
        CheckConstraint(f"accent IN ({_in(ACCENTS)})", name="accent_known"),
        CheckConstraint(f"length_unit IN ({_in(LENGTH_UNITS)})", name="length_unit_known"),
    )

    member_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    theme_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    accent: Mapped[str] = mapped_column(String(16), nullable=False)
    length_unit: Mapped[str] = mapped_column(String(4), nullable=False)
