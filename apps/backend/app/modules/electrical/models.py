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
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    PrimaryKeyConstraint,
    SmallInteger,
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
#: Verlauf eines Steigwegabschnitts (ADR 0025, ``riser_course.py``).
RISER_OFFSET_MODES: tuple[str, ...] = ("orthogonal", "direct")
#: Name eines Steigwegs ist je Gebaeude eindeutig (Migration ``0010``).
RISER_NAME_CONSTRAINT = "uq_electrical_risers_organization_id_building_id_name"
#: Hoechstens ein Halt je Steigweg und Geschoss (Migration ``0010``).
RISER_STOP_FLOOR_CONSTRAINT = "uq_electrical_riser_stops_organization_id_riser_id_floor_id"
#: Code einer Verteilung ist je Gebaeude eindeutig (Phase 6b.0, Migration ``0012``).
BOARD_CODE_CONSTRAINT = "uq_el_boards_building_code"
#: Ein Geraet ist die Lage hoechstens einer Verteilung.
BOARD_PLACEMENT_CONSTRAINT = "uq_el_boards_placement_device"
#: Bezeichnung eines Stromkreises ist je Verteilung eindeutig.
CIRCUIT_DESIGNATION_CONSTRAINT = "uq_electrical_circuits_organization_id_board_id_designation"
#: Ein Geraet haengt an hoechstens einem Stromkreis (Primaerschluessel der Zuordnung).
CIRCUIT_DEVICE_PK = "pk_electrical_circuit_devices"
#: Halt und Steigweg gehoeren zusammen (Ziel der Wegpunkt-Fremdschluessel, 6b.3).
RISER_STOP_OF_RISER_CONSTRAINT = "uq_el_riser_stops_riser_id_id"
#: Reihenfolge der Wegpunkte einer Leitung ist eindeutig (6b.3).
CABLE_WAYPOINT_SEQ_CONSTRAINT = "uq_el_cable_waypoints_seq"
#: Wegpunktarten (Entwurf §3.3) - dieselben Schluessel wie die API.
CABLE_WAYPOINT_KINDS: tuple[str, ...] = (
    "wall",
    "ceiling",
    "floor",
    "penetration",
    "opening_crossing",
    "riser",
)
#: Obergrenze je Zugabe und Reserve in Millimetern (Entwurf §3.2).
MAX_CABLE_ALLOWANCE_MM = 20_000


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
    """Steigweg eines Gebaeudes (ADR 0025, seit Phase 6a.4 mit API und Service).

    Die Tabelle entstand mit Migration ``0010``. Fachliche Regeln (Halte im
    selben Gebaeude, Verlauf, Laengenstatus) stehen in ``risers.py`` und
    ``riser_course.py``; Laengen werden nie gespeichert.
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
    """Uebergabepunkt eines Steigwegs je Geschoss (ADR 0025).

    Hoechstens ein Halt je Steigweg und Geschoss. Keine eigene Version: Die
    Halteliste wird als Ganzes unter der Steigwegversion gespeichert; ein
    vorhandener Halt behaelt dabei seine ID und sein Geschoss.
    """

    __tablename__ = "electrical_riser_stops"
    __table_args__ = (
        tenant_identity(),
        tenant_fk("riser_id", "electrical_risers", ondelete="CASCADE"),
        tenant_fk("floor_id", "floors", ondelete="RESTRICT"),
        UniqueConstraint("organization_id", "riser_id", "floor_id"),
        # Ziel des Fremdschluessels der Leitungswegpunkte (6b.3, Migration 0013):
        # Ein Halt gehoert genau dem genannten Steigweg - auch auf Datenbankebene.
        UniqueConstraint("organization_id", "riser_id", "id", name=RISER_STOP_OF_RISER_CONSTRAINT),
        CheckConstraint(_coordinates_in_range("x_mm", "y_mm"), name="coordinates_in_range"),
        Index("ix_electrical_riser_stops_organization_id_floor_id", "organization_id", "floor_id"),
    )

    riser_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    floor_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    x_mm: Mapped[int] = mapped_column(Integer, nullable=False)
    y_mm: Mapped[int] = mapped_column(Integer, nullable=False)


# --------------------------------------------- Verteilungen, Stromkreise (6b.0)


class ElectricalDistributionBoard(UUIDPrimaryKey, TenantScoped, Timestamped, Versioned, Base):
    """Verteilung eines Gebaeudes (Phase 6b.0, ADR 0026) - elektrischer Bezugspunkt.

    Mehrere Verteilungen je Gebaeude; ``code`` (etwa ``UV1``) je Gebaeude
    eindeutig. Die **raeumliche Lage** ist kein eigenes Feld, sondern ein Geraet
    des Katalogtyps ``distribution_board`` (``placement_device_id``, optional,
    hoechstens eine Verteilung je Geraet). Das Geraet laesst sich nicht
    entfernen, solange es eine Verteilung platziert (``RESTRICT``; der Service
    antwortet vorher mit ``409``).
    """

    __tablename__ = "electrical_distribution_boards"
    __table_args__ = (
        tenant_identity(),
        tenant_fk("building_id", "buildings", ondelete="RESTRICT"),
        ForeignKeyConstraint(
            ["organization_id", "placement_device_id"],
            ["electrical_devices.organization_id", "electrical_devices.id"],
            name="fk_el_boards_placement_device",
            ondelete="RESTRICT",
        ),
        UniqueConstraint("organization_id", "building_id", "code", name=BOARD_CODE_CONSTRAINT),
        UniqueConstraint("organization_id", "placement_device_id", name=BOARD_PLACEMENT_CONSTRAINT),
    )

    building_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    code: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
    placement_device_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, default=None)


class ElectricalCircuit(UUIDPrimaryKey, TenantScoped, Timestamped, Versioned, Base):
    """Stromkreis an einer Verteilung (Phase 6b.0, ADR 0026).

    ``proposed_*`` sind **Vorschlaege** fuer neue Leitungen (6b.3) - keine
    Vorgabe, keine Vererbung, keine Pruefung. Schutzorgan, RCD-Gruppe und
    Phasenzahl sind manuelle Planungsangaben (docs/security.md, Abschnitt 17).
    Querschnitt als ``numeric(6,2)``, ueber die API als String (ADR 0005).
    Verteilung ``RESTRICT``: eine Verteilung mit Stromkreisen laesst sich nicht
    loeschen.
    """

    __tablename__ = "electrical_circuits"
    __table_args__ = (
        tenant_identity(),
        ForeignKeyConstraint(
            ["organization_id", "board_id"],
            [
                "electrical_distribution_boards.organization_id",
                "electrical_distribution_boards.id",
            ],
            name="fk_electrical_circuits_board",
            ondelete="RESTRICT",
        ),
        UniqueConstraint(
            "organization_id", "board_id", "designation", name=CIRCUIT_DESIGNATION_CONSTRAINT
        ),
        CheckConstraint(
            "proposed_conductor_count IS NULL OR proposed_conductor_count BETWEEN 1 AND 100",
            name="conductor_count_plausible",
        ),
        CheckConstraint(
            "proposed_cross_section_mm2 IS NULL OR proposed_cross_section_mm2 > 0",
            name="cross_section_positive",
        ),
        CheckConstraint(
            "phase_count IS NULL OR phase_count IN (1, 2, 3)", name="phase_count_known"
        ),
    )

    board_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    designation: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    proposed_cable_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    proposed_conductor_count: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    proposed_cross_section_mm2: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    protective_device: Mapped[str | None] = mapped_column(String(40), nullable=True)
    rcd_group: Mapped[str | None] = mapped_column(String(40), nullable=True)
    phase_count: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)


class ElectricalCircuitDevice(TenantScoped, Timestamped, Base):
    """Zuordnung eines Geraets zu einem Stromkreis (Phase 6b.0, ADR 0026).

    Primaerschluessel ``(organization_id, device_id)``: ein Geraet haengt an
    hoechstens einem Stromkreis. Keine eigene Version - die Zuordnungsliste
    steht unter der Stromkreisversion. Geraet und Stromkreis ``CASCADE``: Die
    Zuordnung ist ein reiner Verweis ohne eigene Bedeutung.
    """

    __tablename__ = "electrical_circuit_devices"
    __table_args__ = (
        PrimaryKeyConstraint("organization_id", "device_id", name=CIRCUIT_DEVICE_PK),
        ForeignKeyConstraint(
            ["organization_id", "device_id"],
            ["electrical_devices.organization_id", "electrical_devices.id"],
            name="fk_electrical_circuit_devices_device",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["organization_id", "circuit_id"],
            ["electrical_circuits.organization_id", "electrical_circuits.id"],
            name="fk_electrical_circuit_devices_circuit",
            ondelete="CASCADE",
        ),
        Index(
            "ix_electrical_circuit_devices_organization_id_circuit_id",
            "organization_id",
            "circuit_id",
        ),
    )

    device_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    circuit_id: Mapped[uuid.UUID] = mapped_column(nullable=False)


# ------------------------------------- Leitungen, Wegpunkte, Durchfuehrungen (6b.3)

#: Spalten einer Wegpunktart; alle uebrigen sind ``NULL`` (CHECK ``columns_match_kind``).
_WAYPOINT_COLUMNS: dict[str, tuple[str, ...]] = {
    "wall": ("wall_id", "offset_mm", "height_mm"),
    "area": ("room_id", "x_mm", "y_mm"),
    "penetration": ("penetration_id",),
    # ``opening_id`` ist nur der fachliche Bezug und darf nach bestaetigtem
    # Entfernen der Oeffnung ``NULL`` sein (Entwurf §5.6).
    "opening_crossing": ("wall_id", "offset_mm"),
    "riser": ("riser_id", "from_stop_id", "from_height_mm", "to_stop_id", "to_height_mm"),
}
_WAYPOINT_ALL = (
    "wall_id",
    "offset_mm",
    "height_mm",
    "room_id",
    "x_mm",
    "y_mm",
    "penetration_id",
    "opening_id",
    "riser_id",
    "from_stop_id",
    "from_height_mm",
    "to_stop_id",
    "to_height_mm",
)


def _waypoint_shape(kinds: str, group: str) -> str:
    present = _WAYPOINT_COLUMNS[group]
    optional = ("opening_id",) if group == "opening_crossing" else ()
    parts = [f"kind IN ({kinds})"]
    parts += [f"{column} IS NOT NULL" for column in present]
    parts += [
        f"{column} IS NULL"
        for column in _WAYPOINT_ALL
        if column not in present and column not in optional
    ]
    return "(" + " AND ".join(parts) + ")"


_WAYPOINT_SHAPES = " OR ".join(
    [
        _waypoint_shape("'wall'", "wall"),
        _waypoint_shape("'ceiling', 'floor'", "area"),
        _waypoint_shape("'penetration'", "penetration"),
        _waypoint_shape("'opening_crossing'", "opening_crossing"),
        _waypoint_shape("'riser'", "riser"),
    ]
)


class ElectricalWallPenetration(UUIDPrimaryKey, TenantScoped, Timestamped, Versioned, Base):
    """Durchfuehrung durch eine bestaetigte gemeinsame Bauwand (Phase 6b.3, ADR 0026).

    Einmal gespeichert an ``wall_a`` der Kopplung: ``offset_mm`` ab deren
    Wandanfang auf der Achse, ``height_mm`` ueber FFB. Die Gegenseite wird nie
    gespeichert, sondern ueber die exakte Abschnittstransformation abgeleitet
    (``cable_length.shared_sources`` + ``topology.transfer``). Kopplung
    ``RESTRICT``: eine Kopplung mit Durchfuehrung wird nicht still geloest
    (``409 wall-link-has-penetrations``). Gueltigkeit (aktives ``shared``,
    Hoehe, Oeffnungen) prueft der Service unter der Projektsperre.
    """

    __tablename__ = "electrical_wall_penetrations"
    __table_args__ = (
        tenant_identity(),
        # Ausdruecklicher Name: Nach der Konvention waere er laenger als 63 Zeichen.
        ForeignKeyConstraint(
            ["organization_id", "wall_link_id"],
            ["electrical_wall_links.organization_id", "electrical_wall_links.id"],
            name="fk_el_penetrations_wall_link",
            ondelete="RESTRICT",
        ),
        CheckConstraint(f"offset_mm BETWEEN 0 AND {MAX_COORDINATE_MM}", name="offset_plausible"),
        CheckConstraint(f"height_mm BETWEEN 0 AND {MAX_ROOM_HEIGHT_MM}", name="height_plausible"),
        Index(
            "ix_electrical_wall_penetrations_organization_id_wall_link_id",
            "organization_id",
            "wall_link_id",
        ),
    )

    wall_link_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    offset_mm: Mapped[int] = mapped_column(Integer, nullable=False)
    height_mm: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)


class ElectricalCable(UUIDPrimaryKey, TenantScoped, Timestamped, Versioned, Base):
    """Leitung eines Stromkreises mit ihren tatsaechlichen Kabelangaben (Phase 6b.3).

    Die Kabelangaben stehen **an der Leitung**; der Stromkreisvorschlag wird nie
    zur Laufzeit geerbt (Entwurf §3.2). ``start_device_id`` ist leer, solange die
    Verteilung des Stromkreises nicht platziert ist - die Leitung hat dann keinen
    Startpunkt und keine Laenge. **Keine gespeicherte Laenge**: Weg, Laenge und
    Status berechnet ``cable_length.analyse_cable`` bei jedem Lesen.

    Stromkreis ``CASCADE`` (Loeschen eines Stromkreises nimmt seine Leitungen
    mit), Endgeraete ``RESTRICT`` (``409 device-has-cables``).
    """

    __tablename__ = "electrical_cables"
    __table_args__ = (
        tenant_identity(),
        ForeignKeyConstraint(
            ["organization_id", "circuit_id"],
            ["electrical_circuits.organization_id", "electrical_circuits.id"],
            name="fk_electrical_cables_circuit",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["organization_id", "start_device_id"],
            ["electrical_devices.organization_id", "electrical_devices.id"],
            name="fk_electrical_cables_start_device",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["organization_id", "end_device_id"],
            ["electrical_devices.organization_id", "electrical_devices.id"],
            name="fk_electrical_cables_end_device",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "start_device_id IS NULL OR start_device_id <> end_device_id",
            name="endpoints_differ",
        ),
        CheckConstraint(
            "conductor_count IS NULL OR conductor_count BETWEEN 1 AND 100",
            name="conductor_count_plausible",
        ),
        CheckConstraint(
            "cross_section_mm2 IS NULL OR cross_section_mm2 > 0", name="cross_section_positive"
        ),
        CheckConstraint(
            f"start_allowance_mm BETWEEN 0 AND {MAX_CABLE_ALLOWANCE_MM} "
            f"AND end_allowance_mm BETWEEN 0 AND {MAX_CABLE_ALLOWANCE_MM} "
            f"AND reserve_mm BETWEEN 0 AND {MAX_CABLE_ALLOWANCE_MM}",
            name="allowances_plausible",
        ),
        Index("ix_electrical_cables_organization_id_circuit_id", "organization_id", "circuit_id"),
        Index(
            "ix_electrical_cables_organization_id_start_device_id",
            "organization_id",
            "start_device_id",
        ),
        Index(
            "ix_electrical_cables_organization_id_end_device_id",
            "organization_id",
            "end_device_id",
        ),
    )

    circuit_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    label: Mapped[str | None] = mapped_column(String(60), nullable=True, default=None)
    start_device_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, default=None)
    end_device_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    cable_type: Mapped[str | None] = mapped_column(String(40), nullable=True, default=None)
    conductor_count: Mapped[int | None] = mapped_column(SmallInteger, nullable=True, default=None)
    cross_section_mm2: Mapped[Decimal | None] = mapped_column(
        Numeric(6, 2), nullable=True, default=None
    )
    start_allowance_mm: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    end_allowance_mm: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    reserve_mm: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )


class ElectricalCableWaypoint(UUIDPrimaryKey, TenantScoped, Timestamped, Base):
    """Wegpunkt einer Leitung (Phase 6b.3, Entwurf §3.3) - die Liste wird als Ganzes ersetzt.

    Keine eigene Version: Die Wegpunkte stehen unter der Leitungsversion. Je Art
    genau die zugehoerigen Spalten (CHECK). Alle Bezuege ``RESTRICT``: Wand, Raum,
    Durchfuehrung, Oeffnung und Steigweg verschwinden nicht unter einer Leitung;
    der Service antwortet vorher verstaendlich (``409 wall-has-cables`` u. a.).
    Der Halt eines Steigwegs verweist ueber ``(organization_id, riser_id,
    stop_id)`` - er gehoert damit auch auf Datenbankebene zum genannten Steigweg.
    Der Bodenuebergang speichert seine Lage selbst (Quellwand, Abstand);
    ``opening_id`` ist nur der fachliche Bezug (Speicherstrategie §5.6).
    """

    __tablename__ = "electrical_cable_waypoints"
    __table_args__ = (
        tenant_identity(),
        tenant_fk("cable_id", "electrical_cables", ondelete="CASCADE"),
        tenant_fk("wall_id", "electrical_walls", ondelete="RESTRICT"),
        tenant_fk("room_id", "electrical_rooms", ondelete="RESTRICT"),
        ForeignKeyConstraint(
            ["organization_id", "penetration_id"],
            ["electrical_wall_penetrations.organization_id", "electrical_wall_penetrations.id"],
            name="fk_el_cable_waypoints_penetration",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["organization_id", "opening_id"],
            ["electrical_openings.organization_id", "electrical_openings.id"],
            name="fk_el_cable_waypoints_opening",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["organization_id", "riser_id"],
            ["electrical_risers.organization_id", "electrical_risers.id"],
            name="fk_el_cable_waypoints_riser",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["organization_id", "riser_id", "from_stop_id"],
            [
                "electrical_riser_stops.organization_id",
                "electrical_riser_stops.riser_id",
                "electrical_riser_stops.id",
            ],
            name="fk_el_cable_waypoints_from_stop",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["organization_id", "riser_id", "to_stop_id"],
            [
                "electrical_riser_stops.organization_id",
                "electrical_riser_stops.riser_id",
                "electrical_riser_stops.id",
            ],
            name="fk_el_cable_waypoints_to_stop",
            ondelete="RESTRICT",
        ),
        UniqueConstraint("organization_id", "cable_id", "seq", name=CABLE_WAYPOINT_SEQ_CONSTRAINT),
        CheckConstraint("seq >= 0", name="seq_not_negative"),
        CheckConstraint(f"kind IN ({_value_list(CABLE_WAYPOINT_KINDS)})", name="kind_known"),
        CheckConstraint(_WAYPOINT_SHAPES, name="columns_match_kind"),
        CheckConstraint(
            f"(offset_mm IS NULL OR offset_mm BETWEEN 0 AND {MAX_COORDINATE_MM}) "
            f"AND (height_mm IS NULL OR height_mm BETWEEN 0 AND {MAX_ROOM_HEIGHT_MM}) "
            f"AND (from_height_mm IS NULL OR from_height_mm BETWEEN 0 AND {MAX_ROOM_HEIGHT_MM}) "
            f"AND (to_height_mm IS NULL OR to_height_mm BETWEEN 0 AND {MAX_ROOM_HEIGHT_MM})",
            name="values_plausible",
        ),
        CheckConstraint(
            f"(x_mm IS NULL OR x_mm BETWEEN {MIN_COORDINATE_MM} AND {MAX_COORDINATE_MM}) AND "
            f"(y_mm IS NULL OR y_mm BETWEEN {MIN_COORDINATE_MM} AND {MAX_COORDINATE_MM})",
            name="coordinates_in_range",
        ),
        Index("ix_el_cable_waypoints_wall", "organization_id", "wall_id"),
        Index("ix_el_cable_waypoints_room", "organization_id", "room_id"),
        Index("ix_el_cable_waypoints_penetration", "organization_id", "penetration_id"),
        Index("ix_el_cable_waypoints_opening", "organization_id", "opening_id"),
        Index("ix_el_cable_waypoints_riser", "organization_id", "riser_id"),
    )

    cable_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    wall_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, default=None)
    offset_mm: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    height_mm: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    room_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, default=None)
    x_mm: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    y_mm: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    penetration_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, default=None)
    opening_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, default=None)
    riser_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, default=None)
    from_stop_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, default=None)
    from_height_mm: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    to_stop_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, default=None)
    to_height_mm: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
