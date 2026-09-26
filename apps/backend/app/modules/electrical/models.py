"""Tabellen des Fachmoduls ``electrical`` (Phase 3).

``Geschoss -> Raum -> Wand -> Oeffnung``. Das Geschoss gehoert dem Core; alles
darunter gehoert diesem Modul. Der Verweis auf ``floors`` laeuft ueber den
zusammengesetzten Fremdschluessel ``(organization_id, floor_id)`` - ein
mandantenuebergreifender Verweis ist damit auf Datenbankebene unmoeglich
(ADR 0006). ``floors`` ist eine Core-Tabelle und als FK-Ziel ausdruecklich
erlaubt (docs/modules.md, Abschnitt 8).

**Was hier absichtlich nicht steht** (ADR 0013):

* kein ``project_id`` - es ergibt sich aus ``floor -> building -> project``
  und waere eine zweite Wahrheit,
* kein Polygonfeld auf dem Raum - die Kontur **sind** die Waende,
* keine Flaeche, kein Umfang, kein Konturzustand - alles drei wird aus der
  Geometrie berechnet,
* kein ``client_txn_id`` und kein ``sync_status``: Planungsdaten entstehen
  nicht offline (docs/offline-sync.md, Abschnitt 1).

Alle geometrischen Werte sind ganzzahlige Millimeter mit Suffix ``_mm``
(ADR 0007).
"""

from __future__ import annotations

import uuid

from sqlalchemy import CheckConstraint, Index, Integer, String, UniqueConstraint, text
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
from app.modules.electrical.geometry import (
    DEFAULT_WALL_THICKNESS_MM,
    MAX_COORDINATE_MM,
    MAX_ROOM_HEIGHT_MM,
    MAX_WALL_THICKNESS_MM,
    MIN_COORDINATE_MM,
    MIN_ROOM_HEIGHT_MM,
    MIN_WALL_THICKNESS_MM,
    OPENING_KINDS,
)

#: Name des eindeutigen Index auf die optionale Raumnummer. Kurz gehalten, weil
#: PostgreSQL Bezeichner bei 63 Zeichen abschneidet.
ROOM_NUMBER_CONSTRAINT = "uq_el_rooms_floor_room_number"
#: Name der eindeutigen Reihenfolge innerhalb eines Raums.
WALL_ORDER_CONSTRAINT = "uq_el_walls_room_sort_order"

_KIND_LIST = ", ".join(f"'{kind}'" for kind in OPENING_KINDS)


def _coordinates_in_range(*columns: str) -> str:
    """SQL-Bedingung: alle genannten Spalten liegen im Koordinatenbereich."""
    return " AND ".join(
        f"{column} BETWEEN {MIN_COORDINATE_MM} AND {MAX_COORDINATE_MM}" for column in columns
    )


class ElectricalRoom(UUIDPrimaryKey, TenantScoped, Timestamped, Versioned, Base):
    """Ein Raum auf einem Geschoss.

    ``height_mm`` ist optional: Ohne Angabe gilt die Standardhoehe des
    Geschosses (``floors.default_ceiling_height_mm``). Damit steht die Hoehe
    genau einmal im System, solange der Raum nicht von ihr abweicht.

    ``room_number`` ist optional. Ist sie gesetzt, muss sie innerhalb des
    Geschosses eindeutig sein - zwei Raeume "1.02" auf einem Geschoss waeren
    ein Erfassungsfehler. Raeume ohne Nummer bleiben unbeschraenkt, deshalb ein
    partieller Index und keine gewoehnliche Unique-Constraint.
    """

    __tablename__ = "electrical_rooms"
    __table_args__ = (
        tenant_identity(),
        # RESTRICT: Ein Geschoss mit Planungsdaten wird nicht stillschweigend
        # mitgeloescht. Der Core uebersetzt den Konflikt in einen 409.
        tenant_fk("floor_id", "floors", ondelete="RESTRICT"),
        CheckConstraint(
            f"height_mm IS NULL OR height_mm BETWEEN {MIN_ROOM_HEIGHT_MM} AND {MAX_ROOM_HEIGHT_MM}",
            name="height_plausible",
        ),
        Index("ix_electrical_rooms_organization_id_floor_id", "organization_id", "floor_id"),
        Index(
            ROOM_NUMBER_CONSTRAINT,
            "organization_id",
            "floor_id",
            "room_number",
            unique=True,
            postgresql_where=text("room_number IS NOT NULL"),
        ),
    )

    #: Verweis auf ``floors`` ueber ``(organization_id, floor_id)``.
    floor_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    room_number: Mapped[str | None] = mapped_column(String(30), nullable=True, default=None)
    #: Lichte Raumhoehe in Millimetern; ``NULL`` = Standardhoehe des Geschosses.
    height_mm: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)


class ElectricalWall(UUIDPrimaryKey, TenantScoped, Timestamped, Versioned, Base):
    """Ein gerichtetes Wandsegment der Raumkontur.

    Die Richtung ist fachlich bedeutsam: Der Abstand einer Oeffnung
    (``offset_mm``) zaehlt vom Startpunkt. ``sort_order`` legt die Reihenfolge
    innerhalb der Kontur fest - sie ist explizit und nicht aus der Geometrie
    abgeleitet, damit spaetere Synchronisation und Editor dieselbe Reihenfolge
    sehen (docs/offline-sync.md, Abschnitt 5).

    Die Eindeutigkeit der Reihenfolge ist **aufgeschoben** (``DEFERRABLE
    INITIALLY DEFERRED``): Beim Umordnen werden mehrere Zeilen in einer
    Transaktion getauscht; ein Zwischenstand darf kurzzeitig doppelt sein, das
    Ergebnis nicht.
    """

    __tablename__ = "electrical_walls"
    __table_args__ = (
        tenant_identity(),
        # CASCADE: Die Kontur gehoert zum Raum. Wird der Raum geloescht,
        # verschwinden seine Waende mit ihm.
        tenant_fk("room_id", "electrical_rooms", ondelete="CASCADE"),
        UniqueConstraint(
            "organization_id",
            "room_id",
            "sort_order",
            name=WALL_ORDER_CONSTRAINT,
            deferrable=True,
            initially="DEFERRED",
        ),
        CheckConstraint("x1_mm <> x2_mm OR y1_mm <> y2_mm", name="not_degenerate"),
        CheckConstraint(
            _coordinates_in_range("x1_mm", "y1_mm", "x2_mm", "y2_mm"),
            name="coordinates_in_range",
        ),
        CheckConstraint(
            f"thickness_mm BETWEEN {MIN_WALL_THICKNESS_MM} AND {MAX_WALL_THICKNESS_MM}",
            name="thickness_plausible",
        ),
        CheckConstraint("sort_order >= 0", name="sort_order_not_negative"),
        Index("ix_electrical_walls_organization_id_room_id", "organization_id", "room_id"),
    )

    #: Verweis auf ``electrical_rooms`` ueber ``(organization_id, room_id)``.
    room_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    x1_mm: Mapped[int] = mapped_column(Integer, nullable=False)
    y1_mm: Mapped[int] = mapped_column(Integer, nullable=False)
    x2_mm: Mapped[int] = mapped_column(Integer, nullable=False)
    y2_mm: Mapped[int] = mapped_column(Integer, nullable=False)
    thickness_mm: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=DEFAULT_WALL_THICKNESS_MM,
        server_default=text(str(DEFAULT_WALL_THICKNESS_MM)),
    )
    #: Position in der Kontur, beginnend bei 0, lueckenlos.
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ElectricalOpening(UUIDPrimaryKey, TenantScoped, Timestamped, Versioned, Base):
    """Tuer, Fenster oder Durchgang in einer Wand.

    Beschrieben ueber den Abstand vom Wandanfang, Breite, Hoehe und - beim
    Fenster - die Bruestungshoehe. Tuer und Fenster sind zusammengefasst, weil
    Geometrie und Bearbeitung identisch sind (docs/architecture-review.md,
    Abweichung a).
    """

    __tablename__ = "electrical_openings"
    __table_args__ = (
        tenant_identity(),
        # CASCADE nur fuer den Fall, dass die Wand mit ihrem Raum verschwindet.
        # Eine Wand mit Oeffnungen laesst der Service nicht einzeln loeschen.
        tenant_fk("wall_id", "electrical_walls", ondelete="CASCADE"),
        CheckConstraint(f"kind IN ({_KIND_LIST})", name="kind_known"),
        CheckConstraint("width_mm > 0 AND height_mm > 0", name="dimensions_positive"),
        CheckConstraint("offset_mm >= 0", name="offset_not_negative"),
        CheckConstraint("sill_height_mm >= 0", name="sill_not_negative"),
        Index("ix_electrical_openings_organization_id_wall_id", "organization_id", "wall_id"),
    )

    #: Verweis auf ``electrical_walls`` ueber ``(organization_id, wall_id)``.
    wall_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    #: Abstand vom Startpunkt der gerichteten Wand.
    offset_mm: Mapped[int] = mapped_column(Integer, nullable=False)
    width_mm: Mapped[int] = mapped_column(Integer, nullable=False)
    height_mm: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Unterkante ueber Fertigfussboden; ``0`` bei Tuer und Durchgang.
    sill_height_mm: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
