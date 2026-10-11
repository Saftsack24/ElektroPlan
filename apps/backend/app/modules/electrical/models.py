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

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
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
from app.modules.electrical.catalog import (
    DEVICE_CATEGORIES,
    MAX_DEVICE_LABEL_LENGTH,
    MAX_DEVICE_SIZE_MM,
    MIN_DEVICE_SIZE_MM,
    MOUNTING_SURFACES,
    ROOM_TYPES,
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
#: Ein Raumwandpaar hoechstens einmal gekoppelt (Phase 6a, ADR 0024).
WALL_LINK_PAIR_CONSTRAINT = "uq_el_wall_links_pair"

#: Entscheidung einer Wandkopplung: eine Bauwand oder zwei Bauwaende (ADR 0024).
WALL_LINK_RELATIONS: tuple[str, ...] = ("shared", "separate")
#: Herkunft einer Wandkopplung: ausdruecklich angelegt oder Bestandsuebernahme.
WALL_LINK_ORIGINS: tuple[str, ...] = ("user", "backfill")
#: Verlauf eines Steigwegabschnitts (ADR 0025) - nur Schema-Vorbereitung.
RISER_OFFSET_MODES: tuple[str, ...] = ("orthogonal", "direct")


def _value_list(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


_KIND_LIST = _value_list(OPENING_KINDS)


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
        CheckConstraint(
            f"room_type IS NULL OR room_type IN ({_value_list(ROOM_TYPES)})",
            name="room_type_known",
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
    #: Raumtyp (T7, Phase 5) - nur zur Einordnung; ``NULL`` = nicht angegeben.
    room_type: Mapped[str | None] = mapped_column(String(30), nullable=True, default=None)


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


class ElectricalDeviceType(Base):
    """Geraetetyp des ausgelieferten Systemkatalogs (Phase 5, ADR 0023).

    **Global, ohne ``organization_id``:** Der Katalog ist fuer alle Betriebe
    gleich und wird nur vom idempotenten Seed gepflegt (``reference_data.py``).
    Er enthaelt keine Daten eines Mandanten. Betriebseigene Typen sind nicht
    Teil von Phase 5; kommen sie, braucht es einen eigenen ADR.

    Der stabile technische Schluessel ist der Primaerschluessel. Ein Typ wird
    nie geloescht, sondern deaktiviert (``is_active``) - Geraete verweisen mit
    ``RESTRICT`` auf ihn.
    """

    __tablename__ = "electrical_device_types"
    __table_args__ = (
        CheckConstraint(f"category IN ({_value_list(DEVICE_CATEGORIES)})", name="category_known"),
        CheckConstraint(
            "allows_wall_interior OR allows_wall_exterior OR allows_ceiling",
            name="has_surface",
        ),
        CheckConstraint(
            f"width_mm BETWEEN {MIN_DEVICE_SIZE_MM} AND {MAX_DEVICE_SIZE_MM} "
            f"AND height_mm BETWEEN {MIN_DEVICE_SIZE_MM} AND {MAX_DEVICE_SIZE_MM} "
            "AND width_mm % 2 = 0 AND height_mm % 2 = 0",
            name="size_plausible",
        ),
        CheckConstraint(
            "default_center_height_mm IS NULL OR default_center_height_mm BETWEEN 0 AND "
            f"{MAX_ROOM_HEIGHT_MM}",
            name="default_height_plausible",
        ),
    )

    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    symbol_key: Mapped[str] = mapped_column(String(40), nullable=False)
    allows_wall_interior: Mapped[bool] = mapped_column(Boolean, nullable=False)
    allows_wall_exterior: Mapped[bool] = mapped_column(Boolean, nullable=False)
    allows_ceiling: Mapped[bool] = mapped_column(Boolean, nullable=False)
    #: Startwert der Mitte ueber FFB fuer Wandgeraete - keine Normvorgabe.
    default_center_height_mm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Planungsmass (gerade mm): an der Wand Breite x Hoehe, an der Decke x und y.
    width_mm: Mapped[int] = mapped_column(Integer, nullable=False)
    height_mm: Mapped[int] = mapped_column(Integer, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )


class ElectricalDevice(UUIDPrimaryKey, TenantScoped, Timestamped, Base):
    """Geraet in einem Raum (Phase 5, ADR 0023).

    Gehoert immer zu einem Raum und wird mit dessen Entwurf gespeichert
    (``PUT /rooms/{id}/contour``); die **Raumversion** schuetzt es - ein
    eigener Versionszaehler waere eine zweite Wahrheit.

    Montageflaeche und Lage, je nach Flaeche genau eine Form (CHECK):

    * ``wall_interior`` / ``wall_exterior``: ``wall_id`` (eine Wand **dieses**
      Raums), ``center_offset_mm`` (Mitte ab Wandanfang),
      ``center_height_mm`` (Mitte ueber FFB),
    * ``ceiling``: ``x_mm``/``y_mm`` (Mitte in Geschosskoordinaten); **keine**
      gespeicherte Hoehe - sie ist immer die effektive Raumhoehe.

    Verweise: Raum ``CASCADE`` (Raum weg, Geraete weg), Wand ``CASCADE`` nur fuer
    den Fall, dass die Wand mit ihrem Raum verschwindet - eine einzelne Wand mit
    Geraeten laesst der Service nicht loeschen (``409``). Geraetetyp
    ``RESTRICT``.
    """

    __tablename__ = "electrical_devices"
    __table_args__ = (
        tenant_identity(),
        tenant_fk("room_id", "electrical_rooms", ondelete="CASCADE"),
        tenant_fk("wall_id", "electrical_walls", ondelete="CASCADE"),
        CheckConstraint(
            f"mounting_surface IN ({_value_list(MOUNTING_SURFACES)})", name="surface_known"
        ),
        CheckConstraint(
            "(mounting_surface = 'ceiling' AND wall_id IS NULL AND center_offset_mm IS NULL "
            "AND center_height_mm IS NULL AND x_mm IS NOT NULL AND y_mm IS NOT NULL) OR "
            "(mounting_surface <> 'ceiling' AND wall_id IS NOT NULL "
            "AND center_offset_mm IS NOT NULL AND center_height_mm IS NOT NULL "
            "AND x_mm IS NULL AND y_mm IS NULL)",
            name="position_matches_surface",
        ),
        CheckConstraint(
            f"(x_mm IS NULL OR x_mm BETWEEN {MIN_COORDINATE_MM} AND {MAX_COORDINATE_MM}) AND "
            f"(y_mm IS NULL OR y_mm BETWEEN {MIN_COORDINATE_MM} AND {MAX_COORDINATE_MM})",
            name="coordinates_in_range",
        ),
        CheckConstraint(
            f"(center_offset_mm IS NULL OR center_offset_mm BETWEEN 0 AND {MAX_COORDINATE_MM}) "
            "AND (center_height_mm IS NULL OR center_height_mm BETWEEN 0 AND "
            f"{MAX_ROOM_HEIGHT_MM})",
            name="wall_position_plausible",
        ),
        Index("ix_electrical_devices_organization_id_room_id", "organization_id", "room_id"),
        Index("ix_electrical_devices_organization_id_wall_id", "organization_id", "wall_id"),
        Index("ix_electrical_devices_device_type_key", "device_type_key"),
    )

    room_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    device_type_key: Mapped[str] = mapped_column(
        String(40),
        ForeignKey("electrical_device_types.key", ondelete="RESTRICT"),
        nullable=False,
    )
    mounting_surface: Mapped[str] = mapped_column(String(16), nullable=False)
    wall_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, default=None)
    center_offset_mm: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    center_height_mm: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    x_mm: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    y_mm: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    #: Kurze Beschriftung (z. B. "Bett links") - keine personenbezogenen Daten.
    label: Mapped[str | None] = mapped_column(
        String(MAX_DEVICE_LABEL_LENGTH), nullable=True, default=None
    )


class ElectricalWallLink(UUIDPrimaryKey, TenantScoped, Timestamped, Versioned, Base):
    """Wandkopplung: zwei Raumwaende verschiedener Raeume (Phase 6a, ADR 0024).

    Speichert **nur die Entscheidung** (``relation``): ``shared`` = eine Bauwand,
    ``separate`` = zwei Bauwaende auf derselben Achse. Lage, Laenge und Bereich
    werden immer aus den Raumwaenden abgeleitet (``topology.py``) - die Raumwand
    bleibt die einzige Geometriequelle. Ohne gemeinsamen Bereich ist eine
    Kopplung "unterbrochen": Sie bleibt gespeichert, wirkt aber nicht.

    Kanonisch ``wall_a_id < wall_b_id`` und je Paar hoechstens einmal. Beide
    Verweise ``CASCADE``: Verschwindet eine Wand mit ihrem Raum, verschwindet
    die Kopplung mit. Eine einzelne Wand mit Kopplung entfernt der Service nur
    ausdruecklich (``removed_wall_link_ids``, sonst ``409 wall-has-links``).

    Tabellenuebergreifende Regeln (selbes Geschoss, verschiedene Raeume, exakt
    kollinear mit positiver Ueberlappung, eindeutig) prueft der Service unter
    der Projektsperre.
    """

    __tablename__ = "electrical_wall_links"
    __table_args__ = (
        tenant_identity(),
        # Ausdrueckliche Namen: Nach der Namenskonvention hiessen beide
        # zusammengesetzten Fremdschluessel gleich (erste Spalte organization_id).
        ForeignKeyConstraint(
            ["organization_id", "wall_a_id"],
            ["electrical_walls.organization_id", "electrical_walls.id"],
            ondelete="CASCADE",
            name="fk_electrical_wall_links_wall_a_electrical_walls",
        ),
        ForeignKeyConstraint(
            ["organization_id", "wall_b_id"],
            ["electrical_walls.organization_id", "electrical_walls.id"],
            ondelete="CASCADE",
            name="fk_electrical_wall_links_wall_b_electrical_walls",
        ),
        UniqueConstraint(
            "organization_id", "wall_a_id", "wall_b_id", name=WALL_LINK_PAIR_CONSTRAINT
        ),
        CheckConstraint("wall_a_id < wall_b_id", name="pair_canonical"),
        CheckConstraint(f"relation IN ({_value_list(WALL_LINK_RELATIONS)})", name="relation_known"),
        CheckConstraint(f"origin IN ({_value_list(WALL_LINK_ORIGINS)})", name="origin_known"),
        Index("ix_electrical_wall_links_organization_id_wall_a_id", "organization_id", "wall_a_id"),
        Index("ix_electrical_wall_links_organization_id_wall_b_id", "organization_id", "wall_b_id"),
    )

    wall_a_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    wall_b_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    relation: Mapped[str] = mapped_column(String(16), nullable=False)
    origin: Mapped[str] = mapped_column(String(16), nullable=False)
    #: Wer die Kopplung angelegt hat; ``NULL`` bei der Bestandsuebernahme.
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, default=None
    )


class ElectricalRiser(UUIDPrimaryKey, TenantScoped, Timestamped, Versioned, Base):
    """Steigweg eines Gebaeudes (ADR 0025) - **nur Schema-Vorbereitung** (Phase 6a).

    Die Tabelle entsteht mit Migration ``0010``, damit diese spaeter nicht
    umgeschrieben werden muss. Es gibt in Phase 6a.0-6a.3 **keine** API, keinen
    Service, keine Oberflaeche und keine Daten. Fachliche Regeln (Halte im
    selben Gebaeude, Verlauf, Laengenstatus) entstehen erst mit 6a.4.
    """

    __tablename__ = "electrical_risers"
    __table_args__ = (
        tenant_identity(),
        tenant_fk("building_id", "buildings", ondelete="RESTRICT"),
        UniqueConstraint("organization_id", "building_id", "name"),
        CheckConstraint(
            f"offset_mode IN ({_value_list(RISER_OFFSET_MODES)})", name="offset_mode_known"
        ),
    )

    building_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
    offset_mode: Mapped[str] = mapped_column(String(16), nullable=False)


class ElectricalRiserStop(UUIDPrimaryKey, TenantScoped, Timestamped, Base):
    """Uebergabepunkt eines Steigwegs je Geschoss (ADR 0025) - **nur Schema-Vorbereitung**.

    Hoechstens ein Halt je Steigweg und Geschoss. Keine eigene Version: Die
    Halteliste wird spaeter als Ganzes unter der Steigwegversion gespeichert.
    """

    __tablename__ = "electrical_riser_stops"
    __table_args__ = (
        tenant_identity(),
        tenant_fk("riser_id", "electrical_risers", ondelete="CASCADE"),
        tenant_fk("floor_id", "floors", ondelete="RESTRICT"),
        UniqueConstraint("organization_id", "riser_id", "floor_id"),
        CheckConstraint(_coordinates_in_range("x_mm", "y_mm"), name="coordinates_in_range"),
        Index("ix_electrical_riser_stops_organization_id_floor_id", "organization_id", "floor_id"),
    )

    riser_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    floor_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    x_mm: Mapped[int] = mapped_column(Integer, nullable=False)
    y_mm: Mapped[int] = mapped_column(Integer, nullable=False)
