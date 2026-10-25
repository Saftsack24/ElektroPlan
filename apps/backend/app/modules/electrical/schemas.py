"""Ein- und Ausgabeschemas des Fachmoduls ``electrical``.

Pydantic ist die einzige Quelle der Wahrheit fuer den HTTP-Vertrag; der
TypeScript-Client wird daraus erzeugt (ADR 0009). Geometrie ist ganzzahliges
Millimeter (ADR 0007), Flaechen in Quadratmeter gehen als **String** ueber die
Leitung (ADR 0005) - sie sind eine Menge, und JSON-Zahlen wuerden im Browser
zu Fliesskomma.

Die Grenzen sind bauliche Plausibilitaetsgrenzen, keine Normvorgaben:
ElektroPlan trifft keine bauordnungsrechtlichen oder elektrotechnischen
Entscheidungen (docs/security.md, Abschnitt 17).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.validation import reject_explicit_null
from app.modules.electrical.catalog import (
    MAX_DEVICE_LABEL_LENGTH,
    MAX_DEVICE_SIZE_MM,
    MAX_DEVICE_TYPE_DESCRIPTION_LENGTH,
    MAX_DEVICE_TYPE_LABEL_LENGTH,
    MAX_DEVICES_PER_ROOM,
    MIN_DEVICE_SIZE_MM,
)
from app.modules.electrical.geometry import (
    DEFAULT_WALL_THICKNESS_MM,
    MAX_COORDINATE_MM,
    MAX_OPENING_SIZE_MM,
    MAX_OPENINGS_PER_WALL,
    MAX_ROOM_HEIGHT_MM,
    MAX_WALL_THICKNESS_MM,
    MAX_WALLS_PER_ROOM,
    MIN_COORDINATE_MM,
    MIN_OPENING_SIZE_MM,
    MIN_ROOM_HEIGHT_MM,
    MIN_WALL_THICKNESS_MM,
)

OpeningKindValue = Literal["door", "window", "passage"]
ContourStatusValue = Literal["draft", "valid"]
#: Raumtypen (T7, Phase 5) - dieselben Schluessel wie ``catalog.ROOM_TYPES``
#: (ein Test haelt beide gleich). Nur zur Einordnung.
RoomTypeValue = Literal[
    "living_room",
    "bedroom",
    "children_room",
    "kitchen",
    "bathroom",
    "hallway",
    "office",
    "utility_room",
    "technical_room",
    "basement",
    "garage",
    "other",
]
#: Wandkopplung (Phase 6a, ADR 0024) - dieselben Werte wie ``models.WALL_LINK_*``.
WallLinkRelationValue = Literal["shared", "separate"]
WallLinkOriginValue = Literal["user", "backfill"]
WallLinkStatusValue = Literal["active", "ambiguous", "broken"]
WallLinkCandidateKindValue = Literal["suggested", "decision-needed", "not-linkable"]
WallLinkCandidateReasonValue = Literal[
    "ambiguous", "thickness-differs", "contour-open", "openings-on-both-sides"
]
#: Tatsaechliche Montageflaeche eines Geraets (``catalog.MountingSurface``).
MountingSurfaceValue = Literal["wall_interior", "wall_exterior", "ceiling"]
DeviceCategoryValue = Literal[
    "socket", "switch", "light", "data", "distribution", "junction", "connection"
]
#: Kategorien eines betriebseigenen Typs (K2, ADR 0030) - nie ``distribution``.
CustomDeviceCategoryValue = Literal["socket", "switch", "light", "data", "junction", "connection"]
DeviceTypeOriginValue = Literal["system", "organization"]


def _coordinate(*, required: bool) -> Any:
    """Feldbeschreibung einer Koordinate in Millimetern.

    Als Fabrik, damit jedes Feld seine eigene ``FieldInfo`` erhaelt - eine
    gemeinsam genutzte Instanz waere ein geteilter Zustand.
    """
    if required:
        return Field(ge=MIN_COORDINATE_MM, le=MAX_COORDINATE_MM)
    return Field(default=None, ge=MIN_COORDINATE_MM, le=MAX_COORDINATE_MM)


class _Strict(BaseModel):
    """Unbekannte Felder werden abgelehnt, nicht stillschweigend verworfen."""

    model_config = ConfigDict(extra="forbid")


#: Hoechstzahl bestaetigter Leitungen je Vorgang (Phase 6b.3).
MAX_ACKNOWLEDGED_CABLES = 500


# ------------------------------------------------------- Kontur (Phase 4a)


class ContourOpeningIn(_Strict):
    """Oeffnung als Teil einer vollstaendigen Raumkontur.

    ``id`` fehlt oder ist neu: Die Oeffnung wird angelegt - mit genau dieser
    ID, wenn sie angegeben ist (clientseitig erzeugte UUID, ADR 0007). Ist die
    ID bereits eine Oeffnung **dieser** Wand, wird sie geaendert. Eine
    Oeffnung wechselt ihre Wand nicht.
    """

    id: uuid.UUID | None = None
    kind: OpeningKindValue
    offset_mm: int = Field(ge=0, le=MAX_COORDINATE_MM)
    width_mm: int = Field(ge=MIN_OPENING_SIZE_MM, le=MAX_OPENING_SIZE_MM)
    height_mm: int = Field(ge=MIN_OPENING_SIZE_MM, le=MAX_OPENING_SIZE_MM)
    sill_height_mm: int = Field(default=0, ge=0, le=MAX_OPENING_SIZE_MM)


class ContourWallIn(_Strict):
    """Wand als Teil einer vollstaendigen Raumkontur.

    Die **Position in der Liste** ist die Konturreihenfolge. ``id`` wie bei
    :class:`ContourOpeningIn`: bekannt heisst aendern, fehlend oder neu heisst
    anlegen. ``openings`` ist die vollstaendige Liste der Oeffnungen dieser
    Wand.
    """

    id: uuid.UUID | None = None
    x1_mm: int = _coordinate(required=True)
    y1_mm: int = _coordinate(required=True)
    x2_mm: int = _coordinate(required=True)
    y2_mm: int = _coordinate(required=True)
    thickness_mm: int = Field(
        default=DEFAULT_WALL_THICKNESS_MM,
        ge=MIN_WALL_THICKNESS_MM,
        le=MAX_WALL_THICKNESS_MM,
    )
    openings: list[ContourOpeningIn] = Field(default_factory=list, max_length=MAX_OPENINGS_PER_WALL)


class ContourDeviceIn(_Strict):
    """Geraet als Teil des Raumentwurfs (Phase 5, ADR 0023).

    ``id`` wie bei Oeffnungen: bekannt heisst aendern, fehlend oder neu heisst
    anlegen (clientseitig erzeugte UUID). Montageflaeche und Wand eines
    vorhandenen Geraets aendern sich nicht.

    Bezugspunkt ist die **Mitte** des Geraets:

    * Wand (``wall_interior``/``wall_exterior``): ``wall_id`` (eine Wand dieses
      Raums, auch eine im selben Entwurf neu angelegte), ``center_offset_mm``
      (Abstand ab Wandanfang der gerichteten Wand) und ``center_height_mm``
      (ueber Fertigfussboden),
    * Decke (``ceiling``): ``x_mm``/``y_mm`` in Geschosskoordinaten - **ohne**
      Hoehe; sie ist immer die effektive Raumhoehe.
    """

    id: uuid.UUID | None = None
    device_type_key: str = Field(min_length=1, max_length=40)
    mounting_surface: MountingSurfaceValue
    wall_id: uuid.UUID | None = None
    center_offset_mm: int | None = Field(default=None, ge=0, le=MAX_COORDINATE_MM)
    center_height_mm: int | None = Field(default=None, ge=0, le=MAX_ROOM_HEIGHT_MM)
    x_mm: int | None = _coordinate(required=False)
    y_mm: int | None = _coordinate(required=False)
    label: str | None = Field(default=None, min_length=1, max_length=MAX_DEVICE_LABEL_LENGTH)

    @model_validator(mode="after")
    def _position_matches_surface(self) -> ContourDeviceIn:
        wall_values = (self.wall_id, self.center_offset_mm, self.center_height_mm)
        ceiling_values = (self.x_mm, self.y_mm)
        if self.mounting_surface == "ceiling":
            if any(value is not None for value in wall_values) or None in ceiling_values:
                msg = "Ein Deckengeraet braucht x_mm und y_mm und keine Wandangaben."
                raise ValueError(msg)
        elif None in wall_values or any(value is not None for value in ceiling_values):
            msg = (
                "Ein Wandgeraet braucht wall_id, center_offset_mm und center_height_mm und "
                "keine Deckenlage."
            )
            raise ValueError(msg)
        return self


class RoomContourUpdate(_Strict):
    """Vollstaendiger Zielzustand des Raumentwurfs (``PUT /rooms/{id}/contour``).

    Ein Vorgang, eine Transaktion: Entweder gilt danach genau diese Kontur,
    oder es hat sich nichts geaendert. Waende, die in ``walls`` fehlen, werden
    entfernt. Oeffnungen verschwinden dagegen **nie** stillschweigend: Eine
    vorhandene Oeffnung muss entweder in ``walls`` stehen oder ausdruecklich
    in ``removed_opening_ids``. Sonst lehnt der Server ab.

    **Geraete (Phase 5):** ``devices`` ist - wenn angegeben - die vollstaendige
    Geraeteliste des Raums; fuer Geraete gilt dieselbe Regel wie fuer
    Oeffnungen (``removed_device_ids``). Fehlt ``devices`` (``null``), bleiben
    die gespeicherten Geraete unveraendert - und werden trotzdem gegen die neue
    Geometrie geprueft. Geometrie und Geraete werden immer **gemeinsam**
    gespeichert.
    """

    walls: list[ContourWallIn] = Field(max_length=MAX_WALLS_PER_ROOM)
    removed_opening_ids: list[uuid.UUID] = Field(
        default_factory=list, max_length=MAX_WALLS_PER_ROOM * MAX_OPENINGS_PER_WALL
    )
    devices: list[ContourDeviceIn] | None = Field(default=None, max_length=MAX_DEVICES_PER_ROOM)
    removed_device_ids: list[uuid.UUID] = Field(
        default_factory=list, max_length=MAX_DEVICES_PER_ROOM
    )
    #: Wandkopplungen entfallender Waende (Phase 6a, ADR 0024). Entfaellt eine
    #: gekoppelte Wand, muss **jede** ihrer Kopplungen hier stehen (sonst
    #: ``409 wall-has-links``); jede genannte Kopplung muss eine entfallende Wand
    #: dieses Raums betreffen (sonst ``422``). Nichts wird nebenbei geloest.
    removed_wall_link_ids: list[uuid.UUID] = Field(
        default_factory=list, max_length=MAX_WALLS_PER_ROOM * 4
    )
    #: Leitungen, deren Unterbrechung ausdruecklich bestaetigt wird (Phase 6b.3, D4). Muss
    #: **genau** die betroffenen Leitungen nennen (sonst ``409 cables-would-break``);
    #: verlangt zusaetzlich ``electrical.route.write``.
    acknowledged_cable_ids: list[uuid.UUID] = Field(
        default_factory=list, max_length=MAX_ACKNOWLEDGED_CABLES
    )


# ---------------------------------------------------------------------- Raum


class RoomCreate(_Strict):
    """Neuer Raum auf einem Geschoss.

    ``height_mm`` bleibt leer, wenn die Standardhoehe des Geschosses gilt.

    ``walls`` ist optional (Phase 4a): Der grafische Editor legt einen
    gezeichneten Raum **samt** Kontur in einem Vorgang an. Ohne diese Angabe
    entstuende ein Raum ohne Waende, wenn die zweite Anfrage scheitert. Die
    Liste folgt denselben Regeln wie ``PUT /rooms/{id}/contour``; eine leere
    Liste ist der bisherige Fall "Raum zuerst, Waende spaeter".
    """

    name: str = Field(min_length=1, max_length=120)
    room_number: str | None = Field(default=None, min_length=1, max_length=30)
    height_mm: int | None = Field(default=None, ge=MIN_ROOM_HEIGHT_MM, le=MAX_ROOM_HEIGHT_MM)
    #: Raumtyp (T7) - optional, nur zur Einordnung.
    room_type: RoomTypeValue | None = None
    walls: list[ContourWallIn] = Field(default_factory=list, max_length=MAX_WALLS_PER_ROOM)


class RoomUpdate(_Strict):
    """Teilaenderung eines Raums.

    Das Geschoss steht nicht hier: Ein Raum wechselt nicht das Geschoss - das
    waere ein neuer Raum. ``room_number`` und ``height_mm`` sind ausdruecklich
    leerbar (``null``), weil beide optional sind.
    """

    name: str | None = Field(default=None, min_length=1, max_length=120)
    room_number: str | None = Field(default=None, min_length=1, max_length=30)
    height_mm: int | None = Field(default=None, ge=MIN_ROOM_HEIGHT_MM, le=MAX_ROOM_HEIGHT_MM)
    #: Raumtyp (T7) - setzbar und ausdruecklich leerbar (``null``).
    room_type: RoomTypeValue | None = None
    #: Bestaetigte Leitungsunterbrechungen (Phase 6b.3), etwa nach Anheben der Raumhoehe.
    acknowledged_cable_ids: list[uuid.UUID] = Field(
        default_factory=list, max_length=MAX_ACKNOWLEDGED_CABLES
    )

    #: In der Datenbank ``NOT NULL`` - aenderbar, aber nicht leerbar.
    _not_nullable = field_validator("name")(reject_explicit_null)


class RoomOut(BaseModel):
    """Ein Raum samt abgeleiteten Konturwerten.

    Flaeche, Umfang, Wandzahl und Konturzustand sind **berechnet** und nicht
    gespeichert (ADR 0013). Sie fehlen (``null``), solange die Kontur nicht
    geschlossen ist.
    """

    id: uuid.UUID
    floor_id: uuid.UUID
    name: str
    room_number: str | None
    #: Eigene Raumhoehe; ``null`` bedeutet "Standardhoehe des Geschosses".
    height_mm: int | None
    #: Tatsaechlich geltende Hoehe - eigene Angabe oder Geschossstandard.
    effective_height_mm: int
    #: Raumtyp (T7); ``null`` = nicht angegeben. Loest nichts aus.
    room_type: RoomTypeValue | None
    contour_status: ContourStatusValue
    wall_count: int
    area_mm2: int | None
    #: Flaeche in Quadratmetern mit drei Nachkommastellen, als String.
    area_m2: str | None
    perimeter_mm: int | None
    version: int
    created_at: datetime
    updated_at: datetime


class GeometryProblemOut(BaseModel):
    """Ein Geometriefehler mit stabilem Code und deutscher Meldung."""

    code: str
    message: str
    #: IDs der betroffenen Waende, sofern zuordenbar.
    wall_ids: list[uuid.UUID] = Field(default_factory=list)


class RoomContourOut(BaseModel):
    """Pruefbericht zur Raumkontur.

    Reine Auskunft: Der Bericht aendert nichts. Der Zustand ``valid`` bedeutet,
    dass die Waende in ihrer Reihenfolge einen geschlossenen,
    ueberschneidungsfreien Polygonzug mit Flaeche bilden.
    """

    room_id: uuid.UUID
    contour_status: ContourStatusValue
    wall_count: int
    area_mm2: int | None
    area_m2: str | None
    perimeter_mm: int | None
    problems: list[GeometryProblemOut]


# ---------------------------------------------------------------------- Wand


class WallCreate(_Strict):
    """Neue Wand am Ende der Raumkontur.

    ``sort_order`` wird **nicht** entgegengenommen: Eine neue Wand haengt sich
    hinten an, Umordnen ist ein eigener Vorgang. Damit kann eine Anfrage keine
    Luecke und keine Dublette in der Reihenfolge erzeugen.
    """

    x1_mm: int = _coordinate(required=True)
    y1_mm: int = _coordinate(required=True)
    x2_mm: int = _coordinate(required=True)
    y2_mm: int = _coordinate(required=True)
    thickness_mm: int = Field(
        default=DEFAULT_WALL_THICKNESS_MM,
        ge=MIN_WALL_THICKNESS_MM,
        le=MAX_WALL_THICKNESS_MM,
    )


class WallUpdate(_Strict):
    """Teilaenderung einer Wand. Der Raum bleibt unveraendert."""

    x1_mm: int | None = _coordinate(required=False)
    y1_mm: int | None = _coordinate(required=False)
    x2_mm: int | None = _coordinate(required=False)
    y2_mm: int | None = _coordinate(required=False)
    thickness_mm: int | None = Field(
        default=None, ge=MIN_WALL_THICKNESS_MM, le=MAX_WALL_THICKNESS_MM
    )

    _not_nullable = field_validator("x1_mm", "y1_mm", "x2_mm", "y2_mm", "thickness_mm")(
        reject_explicit_null
    )


class WallOrder(_Strict):
    """Neue Reihenfolge der Waende eines Raums.

    Die Liste muss **alle** Waende des Raums genau einmal enthalten. Eine
    Teilliste waere mehrdeutig: Sie liesse offen, wohin die uebrigen Waende
    gehoeren.
    """

    wall_ids: list[uuid.UUID] = Field(min_length=1)


class WallOut(BaseModel):
    """Eine Wand samt ihrer gerundeten Laenge."""

    id: uuid.UUID
    room_id: uuid.UUID
    sort_order: int
    x1_mm: int
    y1_mm: int
    x2_mm: int
    y2_mm: int
    thickness_mm: int
    #: Laenge in ganzen Millimetern, kaufmaennisch gerundet (ADR 0013).
    length_mm: int
    opening_count: int
    version: int
    created_at: datetime
    updated_at: datetime


# ------------------------------------------------------------------ Oeffnung


class OpeningCreate(_Strict):
    """Neue Oeffnung in einer Wand."""

    kind: OpeningKindValue
    offset_mm: int = Field(ge=0, le=MAX_COORDINATE_MM)
    width_mm: int = Field(ge=MIN_OPENING_SIZE_MM, le=MAX_OPENING_SIZE_MM)
    height_mm: int = Field(ge=MIN_OPENING_SIZE_MM, le=MAX_OPENING_SIZE_MM)
    #: Nur beim Fenster groesser Null (docs/modules/electrical.md).
    sill_height_mm: int = Field(default=0, ge=0, le=MAX_OPENING_SIZE_MM)


class OpeningUpdate(_Strict):
    """Teilaenderung einer Oeffnung. Die Wand bleibt unveraendert."""

    kind: OpeningKindValue | None = None
    offset_mm: int | None = Field(default=None, ge=0, le=MAX_COORDINATE_MM)
    width_mm: int | None = Field(default=None, ge=MIN_OPENING_SIZE_MM, le=MAX_OPENING_SIZE_MM)
    height_mm: int | None = Field(default=None, ge=MIN_OPENING_SIZE_MM, le=MAX_OPENING_SIZE_MM)
    sill_height_mm: int | None = Field(default=None, ge=0, le=MAX_OPENING_SIZE_MM)

    _not_nullable = field_validator("kind", "offset_mm", "width_mm", "height_mm", "sill_height_mm")(
        reject_explicit_null
    )


class OpeningOut(BaseModel):
    """Eine Oeffnung in ihrer Wand."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    wall_id: uuid.UUID
    kind: OpeningKindValue
    offset_mm: int
    width_mm: int
    height_mm: int
    sill_height_mm: int
    version: int
    created_at: datetime
    updated_at: datetime


# -------------------------------------------------------- Planungsstand (4a)


class DeviceOut(BaseModel):
    """Ein gespeichertes Geraet (Phase 5). Bezugspunkt ist die Geraetemitte."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    room_id: uuid.UUID
    device_type_key: str
    mounting_surface: MountingSurfaceValue
    wall_id: uuid.UUID | None
    center_offset_mm: int | None
    center_height_mm: int | None
    x_mm: int | None
    y_mm: int | None
    label: str | None
    created_at: datetime
    updated_at: datetime


class DeviceTypeOut(BaseModel):
    """Ein Geraetetyp: Systemtyp oder betriebseigener Typ (K2, ADR 0030).

    ``width_mm``/``height_mm`` sind das **Planungsmass** fuer die
    Platzierungspruefung (an der Wand Breite x Hoehe, an der Decke in x und y)
    - keine Herstellerangabe. ``default_center_height_mm`` ist ein Startwert,
    keine Normvorgabe. ``is_active = false``: nicht mehr fuer neue Geraete.

    ``origin``: ``system`` (Seed, unveraenderlich) oder ``organization`` (eigener Typ).
    ``device_count``/``template_count``: Verweise **im eigenen Betrieb** - ein eigener Typ
    mit Verweisen ist „verwendet“ (Kategorie und Planungsmass gesperrt).
    """

    key: str
    origin: DeviceTypeOriginValue
    label: str
    description: str | None
    category: DeviceCategoryValue
    symbol_key: str
    allows_wall_interior: bool
    allows_wall_exterior: bool
    allows_ceiling: bool
    default_center_height_mm: int | None
    width_mm: int
    height_mm: int
    sort_order: int
    is_active: bool
    version: int
    device_count: int
    template_count: int


def _typtext(value: str | None) -> str | None:
    """Leerraum entfernen; ein leerer Text wird ``None`` (Name ist dann ungueltig)."""
    if value is None:
        return None
    value = value.strip()
    return value or None


class _DeviceTypeFields(_Strict):
    """Gemeinsame Angaben eines eigenen Geraetetyps (K2, ADR 0030).

    Symbol nur aus der mitgelieferten Liste, Planungsmass gerade Millimeter. Die
    Standardhoehe ist ein Startwert fuer Wandgeraete - keine Norm, keine Anschlussvorgabe.
    """

    label: str | None = Field(default=None, min_length=1, max_length=MAX_DEVICE_TYPE_LABEL_LENGTH)
    description: str | None = Field(default=None, max_length=MAX_DEVICE_TYPE_DESCRIPTION_LENGTH)
    category: CustomDeviceCategoryValue | None = None
    symbol_key: str | None = Field(default=None, min_length=1, max_length=40)
    allows_wall_interior: bool | None = None
    allows_wall_exterior: bool | None = None
    allows_ceiling: bool | None = None
    default_center_height_mm: int | None = Field(default=None, ge=0, le=MAX_ROOM_HEIGHT_MM)
    width_mm: int | None = Field(default=None, ge=MIN_DEVICE_SIZE_MM, le=MAX_DEVICE_SIZE_MM)
    height_mm: int | None = Field(default=None, ge=MIN_DEVICE_SIZE_MM, le=MAX_DEVICE_SIZE_MM)
    sort_order: int | None = Field(default=None, ge=0, le=100_000)
    is_active: bool | None = None

    _texte = field_validator("label", "description")(_typtext)


class DeviceTypeCreate(_DeviceTypeFields):
    """Neuer eigener Typ. Schluessel und Betrieb vergibt der Server."""

    label: str = Field(min_length=1, max_length=MAX_DEVICE_TYPE_LABEL_LENGTH)
    category: CustomDeviceCategoryValue
    symbol_key: str = Field(min_length=1, max_length=40)
    allows_wall_interior: bool = False
    allows_wall_exterior: bool = False
    allows_ceiling: bool = False
    width_mm: int = Field(ge=MIN_DEVICE_SIZE_MM, le=MAX_DEVICE_SIZE_MM)
    height_mm: int = Field(ge=MIN_DEVICE_SIZE_MM, le=MAX_DEVICE_SIZE_MM)
    sort_order: int = Field(default=1_000, ge=0, le=100_000)
    is_active: bool = True


class DeviceTypeUpdate(_DeviceTypeFields):
    """Teilaenderung (``If-Match``). Verwendete Typen: Kategorie und Planungsmass gesperrt."""

    _not_nullable = field_validator(
        "label",
        "category",
        "symbol_key",
        "allows_wall_interior",
        "allows_wall_exterior",
        "allows_ceiling",
        "width_mm",
        "height_mm",
        "sort_order",
        "is_active",
    )(reject_explicit_null)


class WallPlanOut(WallOut):
    """Wand im Planungsstand - mit ihren Oeffnungen, vom Wandanfang aus."""

    openings: list[OpeningOut]


class RoomPlanOut(RoomOut):
    """Raum im Planungsstand: gespeicherte Werte, berechnete Kontur, Waende.

    ``contour_problems`` ist derselbe Befund wie im Pruefbericht
    ``GET /rooms/{id}/contour`` - hier gleich mitgeliefert, damit der Editor
    die betroffenen Waende markieren kann, ohne je Raum nachzufragen.
    """

    walls: list[WallPlanOut]
    contour_problems: list[GeometryProblemOut]
    #: Geraete des Raums (Phase 5), nach ID sortiert.
    devices: list[DeviceOut]


# ------------------------------------------------------ Wandkopplung (6a)


class WallLinkCreate(_Strict):
    """Neue Wandkopplung zweier Raumwaende verschiedener Raeume (ADR 0024).

    Die Reihenfolge der beiden Waende ist beliebig; gespeichert wird kanonisch.
    ``separate`` wird nie vorgeschlagen - nur ausdruecklich angelegt.
    """

    wall_a_id: uuid.UUID
    wall_b_id: uuid.UUID
    relation: WallLinkRelationValue
    #: Bestaetigte Leitungsunterbrechungen (6b.3), etwa Bodenuebergang bei ``separate``.
    acknowledged_cable_ids: list[uuid.UUID] = Field(
        default_factory=list, max_length=MAX_ACKNOWLEDGED_CABLES
    )


class WallLinkUpdate(_Strict):
    """Entscheidung einer Kopplung aendern (``If-Match`` der Kopplungsversion)."""

    relation: WallLinkRelationValue
    acknowledged_cable_ids: list[uuid.UUID] = Field(
        default_factory=list, max_length=MAX_ACKNOWLEDGED_CABLES
    )


class WallLinkOut(BaseModel):
    """Eine gespeicherte Kopplung samt abgeleitetem Status.

    ``status``: ``active`` (wirkt), ``ambiguous`` (auf einem Teil liegt eine
    dritte Wand - dort konservativ), ``broken`` (unterbrochen: kein gemeinsamer
    Abschnitt, wirkt nirgends; bleibt gespeichert und wirkt wieder, sobald die
    Geometrie passt). Lage und Laenge werden nie gespeichert.
    """

    id: uuid.UUID
    wall_a_id: uuid.UUID
    wall_b_id: uuid.UUID
    relation: WallLinkRelationValue
    #: ``user`` = ausdruecklich angelegt, ``backfill`` = Bestandsuebernahme.
    origin: WallLinkOriginValue
    status: WallLinkStatusValue
    #: Nur bei ``shared``: die beiden Raumwaende sind verschieden stark erfasst.
    thickness_conflict: bool
    version: int
    created_at: datetime
    updated_at: datetime


class WallLinkCandidateOut(BaseModel):
    """Ein ungekoppeltes, exakt ueberlappendes Wandpaar verschiedener Raeume.

    ``suggested``: eindeutig, Vorschlag ``shared`` - es wird **nichts**
    automatisch gekoppelt. ``decision-needed``: koppelbar, aber nur
    ausdruecklich (``reasons``). ``not-linkable``: mehrdeutig (drei oder mehr
    Waende auf einem Stueck).
    """

    wall_a_id: uuid.UUID
    wall_b_id: uuid.UUID
    kind: WallLinkCandidateKindValue
    reasons: list[WallLinkCandidateReasonValue]


class WallLinkOverviewOut(BaseModel):
    """Kopplungen und Kandidaten eines Geschosses."""

    floor_id: uuid.UUID
    links: list[WallLinkOut]
    candidates: list[WallLinkCandidateOut]


class FloorPlanOut(BaseModel):
    """Vollstaendiger Planungsstand eines Geschosses in **einer** Antwort.

    Bewusst ohne Stammdaten des Geschosses oder Projekts: Die liefert der
    Core. Hier steht nur, was das Fachmodul besitzt - und die beiden IDs,
    an denen es haengt. Seit Phase 6a gehoeren die Wandkopplungen dazu, damit
    Editor, Geraetepruefung und 3D denselben Stand lesen.
    """

    floor_id: uuid.UUID
    project_id: uuid.UUID
    rooms: list[RoomPlanOut]
    wall_links: list[WallLinkOut]
    wall_link_candidates: list[WallLinkCandidateOut]


# ------------------------------------------------------- Steigwege (6a.4)

RiserOffsetModeValue = Literal["orthogonal", "direct"]
RiserSectionStatusValue = Literal["confirmed", "elevation-unconfirmed", "elevation-inconsistent"]
RiserStatusValue = Literal["confirmed", "incomplete", "conflict", "single-stop", "no-stops"]
RiserSectionHintValue = Literal["floor-gap-below-ceiling-height"]

#: Obergrenze der Halte je Steigweg - ein Gebaeude mit mehr Geschossen ist
#: ein Eingabefehler, kein Planungsfall.
MAX_RISER_STOPS = 100


class RiserStopIn(_Strict):
    """Uebergabepunkt eines Steigwegs auf einem Geschoss (ADR 0025).

    ``id`` weglassen heisst: neuer Halt, der Server vergibt die ID. Eine
    angegebene ``id`` muss ein vorhandener Halt **dieses** Steigwegs sein; er
    behaelt seine ID (spaetere Leitungswege verweisen darauf) und wechselt nie
    das Geschoss. Lage in ganzen Millimetern, Geschosskoordinaten, auf Hoehe
    des Fertigfussbodens.
    """

    id: uuid.UUID | None = None
    floor_id: uuid.UUID
    x_mm: int = _coordinate(required=True)
    y_mm: int = _coordinate(required=True)


class _RiserFields(_Strict):
    name: str = Field(min_length=1, max_length=120)
    note: str | None = Field(default=None, max_length=500)
    offset_mode: RiserOffsetModeValue
    #: Vollstaendige Halteliste; hoechstens ein Halt je Geschoss. Reihenfolge
    #: beliebig - massgeblich ist die Geschossebene.
    stops: list[RiserStopIn] = Field(default_factory=list, max_length=MAX_RISER_STOPS)

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            msg = "Der Name darf nicht leer sein."
            raise ValueError(msg)
        return value

    @field_validator("note")
    @classmethod
    def _note_trimmed(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class RiserCreate(_RiserFields):
    """Neuer Steigweg eines Gebaeudes."""


class RiserUpdate(_RiserFields):
    """Steigweg vollstaendig ersetzen (``If-Match`` der Steigwegversion).

    Halte, die in ``stops`` fehlen, werden entfernt; Halte mit ``id`` behalten
    sie. Ein von einer Leitung genutzter Halt laesst sich nicht entfernen
    (``409 riser-stop-in-use``); verschiebt sich ein genutzter Halt so, dass
    eine Leitung unterbrochen wuerde, braucht es ``acknowledged_cable_ids``.
    """

    acknowledged_cable_ids: list[uuid.UUID] = Field(
        default_factory=list, max_length=MAX_ACKNOWLEDGED_CABLES
    )


class RiserStopOut(BaseModel):
    id: uuid.UUID
    floor_id: uuid.UUID
    x_mm: int
    y_mm: int


class RiserCoursePointOut(BaseModel):
    """Punkt des Verlaufs: Geschosskoordinaten, ``z`` = Hoehenlage ueber Gebaeudebezug."""

    x_mm: int
    y_mm: int
    z_mm: int


class RiserSectionOut(BaseModel):
    """Abschnitt zwischen zwei aufeinanderfolgenden Halten - vereinfachter Planungsverlauf.

    ``course`` ist die einzige Quelle fuer Laenge und Darstellung. Bei
    ``elevation-unconfirmed`` ist er **vorlaeufig** (gespeicherte, nicht
    bestaetigte Hoehenlagen) und ``vertical_mm``/``length_mm`` fehlen; bei
    ``elevation-inconsistent`` ebenso. ``horizontal_mm`` ist immer bekannt.
    Keine Aussage ueber bauliche Machbarkeit, Brandschutz oder Normen.
    """

    lower_stop_id: uuid.UUID
    upper_stop_id: uuid.UUID
    lower_floor_id: uuid.UUID
    upper_floor_id: uuid.UUID
    traversed_floor_ids: list[uuid.UUID]
    status: RiserSectionStatusValue
    course: list[RiserCoursePointOut]
    vertical_mm: int | None
    horizontal_mm: int
    length_mm: int | None
    hints: list[RiserSectionHintValue]


class RiserOut(BaseModel):
    """Steigweg samt Halten (nach Geschossebene), Abschnitten und Laengenstatus.

    ``length_mm`` gibt es nur bei ``status = confirmed``. Sonst ist
    ``known_length_mm`` ausdruecklich eine **Teilsumme** der bekannten Teile -
    nie die Leitungslaenge.
    """

    id: uuid.UUID
    building_id: uuid.UUID
    name: str
    note: str | None
    offset_mode: RiserOffsetModeValue
    stops: list[RiserStopOut]
    sections: list[RiserSectionOut]
    status: RiserStatusValue
    known_length_mm: int
    length_mm: int | None
    version: int
    created_at: datetime
    updated_at: datetime


class RiserListOut(BaseModel):
    """Alle Steigwege eines Gebaeudes, nach Name sortiert."""

    building_id: uuid.UUID
    risers: list[RiserOut]


# ------------------------------------------ Verteilungen und Stromkreise (6b.0)

#: Querschnitt in mm² als Dezimalstring (ADR 0005): bis vier Vorkomma-, bis
#: zwei Nachkommastellen, Punkt als Trenner. Kein Fliesskomma auf der Leitung.
CROSS_SECTION_PATTERN = r"^[0-9]{1,4}(\.[0-9]{1,2})?$"
PhaseCountValue = Literal[1, 2, 3]
#: Obergrenze der Geraete je Stromkreis in einer Zuordnungsliste.
MAX_CIRCUIT_DEVICES = 300


def _trimmed(value: str | None) -> str | None:
    """Leerraum entfernen; ein leerer optionaler Text wird ``None``."""
    if value is None:
        return None
    value = value.strip()
    return value or None


def _required_text(value: str | None) -> str | None:
    """Pflichttext: getrimmt und nicht leer (``None`` bleibt fuer PATCH erhalten)."""
    if value is None:
        return None
    value = value.strip()
    if not value:
        msg = "Dieses Feld darf nicht leer sein."
        raise ValueError(msg)
    return value


class DistributionBoardCreate(_Strict):
    """Neue Verteilung eines Gebaeudes (ADR 0026).

    ``placement_device_id`` ist optional: ein Geraet des Typs
    ``distribution_board`` in diesem Gebaeude, das noch keine andere Verteilung
    platziert. Ohne Lage ist die Verteilung zulaessig.
    """

    code: str = Field(min_length=1, max_length=16)
    name: str = Field(min_length=1, max_length=120)
    note: str | None = Field(default=None, max_length=500)
    placement_device_id: uuid.UUID | None = None

    _required = field_validator("code", "name")(_required_text)
    _optional = field_validator("note")(_trimmed)


class DistributionBoardUpdate(_Strict):
    """Teilaenderung (``If-Match``). ``note`` und ``placement_device_id`` sind leerbar."""

    code: str | None = Field(default=None, min_length=1, max_length=16)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    note: str | None = Field(default=None, max_length=500)
    placement_device_id: uuid.UUID | None = None

    _not_nullable = field_validator("code", "name")(reject_explicit_null)
    _required = field_validator("code", "name")(_required_text)
    _optional = field_validator("note")(_trimmed)


class DistributionBoardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    building_id: uuid.UUID
    code: str
    name: str
    note: str | None
    #: Geraet ``distribution_board`` mit der raeumlichen Lage, sonst ``null``.
    placement_device_id: uuid.UUID | None
    version: int
    created_at: datetime
    updated_at: datetime


class DistributionBoardListOut(BaseModel):
    """Alle Verteilungen eines Gebaeudes, nach Code sortiert."""

    building_id: uuid.UUID
    boards: list[DistributionBoardOut]


class BoardPlacementUpdate(_Strict):
    """Lage einer Verteilung im Plan setzen oder aendern (Phase 6c, VP, ADR 0028).

    ``If-Match`` traegt die Version der **Verteilung**, ``expected_room_version`` die
    des Zielraums. Das Lagegeraet sitzt immer auf der Innenseite der Wand; Bezugspunkt
    ist seine Mitte (wie bei jedem Wandgeraet). Gleiche Wand: verschieben; andere Wand:
    umsetzen - nur ohne Leitungen am Lagegeraet (``409 board-placement-has-cables``).
    """

    room_id: uuid.UUID
    wall_id: uuid.UUID
    center_offset_mm: int = Field(ge=0, le=MAX_COORDINATE_MM)
    center_height_mm: int = Field(ge=0, le=MAX_ROOM_HEIGHT_MM)
    expected_room_version: int = Field(ge=1)


class PlacementRoomOut(BaseModel):
    """Ein durch die Platzierung geaenderter Raum mit seiner neuen Version."""

    id: uuid.UUID
    floor_id: uuid.UUID
    version: int


class BoardPlacementOut(BaseModel):
    """Verteilung (neue Version), Lagegeraet und betroffene Raeume (Zielraum zuerst)."""

    board: DistributionBoardOut
    device: DeviceOut
    rooms: list[PlacementRoomOut]


class _CircuitFields(_Strict):
    """Gemeinsame Felder eines Stromkreises.

    ``proposed_*`` sind **Vorschlaege fuer neue Leitungen** - sie gelten nicht
    automatisch fuer bereits geplante Leitungen und werden nicht geprueft.
    Alle Angaben sind manuelle Planungsangaben ohne Dimensionierung oder
    Normpruefung (docs/security.md, Abschnitt 17).
    """

    sort_order: int | None = Field(default=None, ge=0, le=10_000)
    proposed_cable_type: str | None = Field(default=None, max_length=40)
    proposed_conductor_count: int | None = Field(default=None, ge=1, le=100)
    proposed_cross_section_mm2: str | None = Field(
        default=None, pattern=CROSS_SECTION_PATTERN, examples=["1.5", "2.50"]
    )
    protective_device: str | None = Field(default=None, max_length=40)
    rcd_group: str | None = Field(default=None, max_length=40)
    phase_count: PhaseCountValue | None = None
    note: str | None = Field(default=None, max_length=500)
    #: "Fuer neue Leitungen dieses Stromkreises diese Kabelvorgabe verwenden" (Phase 6c,
    #: ADR 0027, F1). Nur dann gilt der Vorschlag als Stufe 2 der Vorgabenkette.
    proposal_overrides_templates: bool | None = None

    _optional = field_validator("proposed_cable_type", "protective_device", "rcd_group", "note")(
        _trimmed
    )

    @field_validator("proposed_cross_section_mm2")
    @classmethod
    def _positive(cls, value: str | None) -> str | None:
        if value is not None and Decimal(value) == 0:
            msg = "Der Querschnitt muss groesser als 0 sein."
            raise ValueError(msg)
        return value


class CircuitCreate(_CircuitFields):
    """Neuer Stromkreis an einer Verteilung."""

    designation: str = Field(min_length=1, max_length=16)
    name: str = Field(min_length=1, max_length=120)

    _required = field_validator("designation", "name")(_required_text)


class CircuitUpdate(_CircuitFields):
    """Teilaenderung (``If-Match``). Optionale Angaben sind mit ``null`` leerbar.

    Eine Aenderung der Vorschlaege aendert **keine** bestehende Leitung.
    """

    designation: str | None = Field(default=None, min_length=1, max_length=16)
    name: str | None = Field(default=None, min_length=1, max_length=120)

    _not_nullable = field_validator(
        "designation", "name", "sort_order", "proposal_overrides_templates"
    )(reject_explicit_null)
    _required = field_validator("designation", "name")(_required_text)


class CircuitDevicesUpdate(_Strict):
    """Vollstaendige Geraeteliste eines Stromkreises (``If-Match`` der Stromkreisversion)."""

    device_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_CIRCUIT_DEVICES)


class CircuitOut(BaseModel):
    """Stromkreis samt zugeordneten Geraeten (nach ID sortiert)."""

    id: uuid.UUID
    board_id: uuid.UUID
    designation: str
    name: str
    sort_order: int
    #: Vorschlag fuer neue Leitungen - ungeprueft, keine Vorgabe.
    proposed_cable_type: str | None
    proposed_conductor_count: int | None
    #: Dezimalstring mit zwei Nachkommastellen (ADR 0005), etwa ``"1.50"``.
    proposed_cross_section_mm2: str | None
    protective_device: str | None
    rcd_group: str | None
    phase_count: int | None
    note: str | None
    #: Vorschlag ist aktivierte Vorgabe fuer neue Leitungen (Stufe 2, F1); Bestand ``false``.
    proposal_overrides_templates: bool
    device_ids: list[uuid.UUID]
    version: int
    created_at: datetime
    updated_at: datetime


class CircuitListOut(BaseModel):
    """Alle Stromkreise eines Gebaeudes, nach Verteilung, Reihenfolge und Bezeichnung."""

    building_id: uuid.UUID
    circuits: list[CircuitOut]


# --------------------------------------- Leitungen und Durchfuehrungen (6b.3)

#: Grenzen je Leitung und Vorgang (Entwurf §10).
MAX_CABLE_WAYPOINTS = 500
MAX_CABLES_PER_CIRCUIT = 200
MAX_NEW_PENETRATIONS = 50
MAX_CABLE_ALLOWANCE_MM = 20_000

CableStatusValue = Literal["confirmed", "incomplete", "conflict"]
#: Prozentsatz 0-100 mit hoechstens zwei Nachkommastellen, als String (ADR 0005).
PERCENT_PATTERN = r"^(100(\.0{1,2})?|[0-9]{1,2}(\.[0-9]{1,2})?)$"
ReserveModeValue = Literal["fixed", "percent"]
#: ``manual``: die gesendeten Werte gelten als ausdrueckliche Angabe der Leitung.
#: ``defaults``: die Werte stammen aus der Vorgabenkette - der Server loest sie selbst auf
#: und prueft die Vorgabenbasis (``409 planning-defaults-changed``).
ValueSourceValue = Literal["manual", "defaults"]
CableValueOriginValue = Literal[
    "legacy",
    "manual",
    "circuit_override",
    "device_type_template",
    "default_template",
    "project_default",
    "office_default",
    "none",
]
#: Hoechstzahl der beim Speichern ausdruecklich zuzuordnenden Endgeraete.
MAX_ASSIGN_DEVICES = 2
CableProblemKindValue = Literal["conflict", "missing"]
CableSegmentKindValue = Literal[
    "connection",
    "wall",
    "corner",
    "wall-ceiling",
    "wall-floor",
    "ceiling",
    "floor",
    "penetration",
    "opening-crossing",
    "riser",
    "shaft",
]
CableWaypointKindValue = Literal[
    "wall", "ceiling", "floor", "penetration", "opening_crossing", "riser"
]


class WallWaypointIn(_Strict):
    """Punkt auf der Achse einer Raumwand: Abstand ab Wandanfang, Hoehe ueber FFB."""

    kind: Literal["wall"]
    wall_id: uuid.UUID
    offset_mm: int = Field(ge=0, le=MAX_COORDINATE_MM)
    height_mm: int = Field(ge=0, le=MAX_ROOM_HEIGHT_MM)


class AreaWaypointIn(_Strict):
    """Punkt in der Decke (Raumhoehe) oder im Fussboden (FFB) eines Raums, Geschoss-x/y."""

    kind: Literal["ceiling", "floor"]
    room_id: uuid.UUID
    x_mm: int = _coordinate(required=True)
    y_mm: int = _coordinate(required=True)


class PenetrationWaypointIn(_Strict):
    """Durchfuehrung: vorhandene (``penetration_id``) oder neu im selben Vorgang angelegte
    (``new_penetration_key`` aus ``new_penetrations``) - genau eins von beiden."""

    kind: Literal["penetration"]
    penetration_id: uuid.UUID | None = None
    new_penetration_key: str | None = Field(default=None, min_length=1, max_length=40)

    @model_validator(mode="after")
    def _exactly_one(self) -> PenetrationWaypointIn:
        if (self.penetration_id is None) == (self.new_penetration_key is None):
            msg = "Genau eins von penetration_id und new_penetration_key angeben."
            raise ValueError(msg)
        return self


class OpeningCrossingWaypointIn(_Strict):
    """Bodenuebergang: Lage auf der Achse der Wand, an der die Oeffnung gespeichert ist.

    ``opening_id`` ist der fachliche Bezug; ``null`` nur bei einer Leitung, deren
    Oeffnung bestaetigt entfernt wurde (Konflikt, Entwurf §5.6).
    """

    kind: Literal["opening_crossing"]
    wall_id: uuid.UUID
    offset_mm: int = Field(ge=0, le=MAX_COORDINATE_MM)
    opening_id: uuid.UUID | None


class RiserWaypointIn(_Strict):
    """Steigwegnutzung in Leitungsrichtung; Hoehen lokal ueber dem FFB des jeweiligen Halts."""

    kind: Literal["riser"]
    riser_id: uuid.UUID
    from_stop_id: uuid.UUID
    from_height_mm: int = Field(ge=0, le=MAX_ROOM_HEIGHT_MM)
    to_stop_id: uuid.UUID
    to_height_mm: int = Field(ge=0, le=MAX_ROOM_HEIGHT_MM)


CableWaypointIn = Annotated[
    WallWaypointIn
    | AreaWaypointIn
    | PenetrationWaypointIn
    | OpeningCrossingWaypointIn
    | RiserWaypointIn,
    Field(discriminator="kind"),
]


class NewPenetrationIn(_Strict):
    """Neue Durchfuehrung, die mit dieser Leitung entsteht (atomar, Entwurf §8.2).

    Lage an ``wall_a`` der Kopplung (ab deren Wandanfang); ``key`` verbindet sie
    mit dem Wegpunkt ``new_penetration_key``.
    """

    key: str = Field(min_length=1, max_length=40)
    wall_link_id: uuid.UUID
    offset_mm: int = Field(ge=0, le=MAX_COORDINATE_MM)
    height_mm: int = Field(ge=0, le=MAX_ROOM_HEIGHT_MM)
    note: str | None = Field(default=None, max_length=200)

    _optional = field_validator("note")(_trimmed)


class DefaultsBasisIn(_Strict):
    """Stand der Vorgaben, den der Client gesehen hat (``effective``-Antwort, ADR 0027 Nr. 8).

    ``0`` = zu dem Zeitpunkt keine Vorgabe gespeichert. ``cable_template_*`` nur, wenn die
    Kabelangaben aus einer Vorlage stammen; ``circuit_version`` nur bei aktivierter
    Stromkreisvorgabe.
    """

    office_version: int = Field(ge=0)
    project_version: int = Field(ge=0)
    cable_template_id: uuid.UUID | None = None
    cable_template_version: int | None = Field(default=None, ge=1)
    circuit_version: int | None = Field(default=None, ge=1)


class CableIn(_Strict):
    """Leitung als Ganzes - anlegen (``POST /circuits/{id}/cables``) oder ersetzen (``PUT``).

    Die Kabelangaben stehen an der Leitung. ``start_device_id`` ist leer nur bei einer
    Verteilung ohne Lage; ``end_device_id`` leer = bewusst offene Planung ("Endgeraet
    fehlt", ``incomplete``, Phase 6c V1). ``waypoints`` ist die vollstaendige Liste in
    Leitungsrichtung.

    **Herkunft je Wertegruppe** (ADR 0027): Kabelangaben (``spec_source``), Reserve
    (``reserve_source``), Anschlusszugaben (``allowance_source``). ``defaults``: Der Server
    loest die Vorgabenkette selbst auf, die gesendeten Werte muessen ihr entsprechen, und
    ``defaults_basis`` muss dem aktuellen Stand gleichen - sonst ``409
    planning-defaults-changed``, nichts gespeichert. ``manual``: ausdruecklich abweichend.
    Fehlt die Angabe (bisherige Clients), gelten die Werte als ausdruecklich; eine
    unveraenderte Gruppe einer Bestandsleitung behaelt dabei ihre Herkunft ``legacy``.

    **Reserve:** ``fixed`` (``reserve_mm``, Bestand) oder ``percent``
    (``reserve_percent``, ``reserve_mm`` dann ``0``) - nie beides.

    ``assign_devices``: Endgeraete dieser Leitung, die beim Speichern ausdruecklich diesem
    Stromkreis zugeordnet werden (zusaetzlich ``electrical.circuit.write``,
    ``expected_circuit_version``); nie umgehaengt, atomar mit der Leitung.
    """

    label: str | None = Field(default=None, max_length=60)
    start_device_id: uuid.UUID | None = None
    end_device_id: uuid.UUID | None = None
    cable_type: str | None = Field(default=None, max_length=40)
    conductor_count: int | None = Field(default=None, ge=1, le=100)
    cross_section_mm2: str | None = Field(
        default=None, pattern=CROSS_SECTION_PATTERN, examples=["1.5", "2.50"]
    )
    start_allowance_mm: int = Field(default=0, ge=0, le=MAX_CABLE_ALLOWANCE_MM)
    end_allowance_mm: int = Field(default=0, ge=0, le=MAX_CABLE_ALLOWANCE_MM)
    reserve_mm: int = Field(default=0, ge=0, le=MAX_CABLE_ALLOWANCE_MM)
    reserve_mode: ReserveModeValue = "fixed"
    reserve_percent: str | None = Field(default=None, pattern=PERCENT_PATTERN, examples=["20"])
    spec_source: ValueSourceValue | None = None
    reserve_source: ValueSourceValue | None = None
    allowance_source: ValueSourceValue | None = None
    defaults_basis: DefaultsBasisIn | None = None
    assign_devices: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_ASSIGN_DEVICES)
    expected_circuit_version: int | None = Field(default=None, ge=1)
    waypoints: list[CableWaypointIn] = Field(default_factory=list, max_length=MAX_CABLE_WAYPOINTS)
    new_penetrations: list[NewPenetrationIn] = Field(
        default_factory=list, max_length=MAX_NEW_PENETRATIONS
    )

    _optional = field_validator("label", "cable_type")(_trimmed)

    @field_validator("cross_section_mm2")
    @classmethod
    def _positive(cls, value: str | None) -> str | None:
        if value is not None and Decimal(value) == 0:
            msg = "Der Querschnitt muss groesser als 0 sein."
            raise ValueError(msg)
        return value

    @model_validator(mode="after")
    def _consistent(self) -> CableIn:
        if self.reserve_mode == "percent":
            if self.reserve_percent is None:
                msg = "Bei reserve_mode percent ist reserve_percent anzugeben."
                raise ValueError(msg)
            if self.reserve_mm != 0:
                msg = "Bei reserve_mode percent ist reserve_mm 0 - nie beide Reserveformen."
                raise ValueError(msg)
        elif self.reserve_percent is not None:
            msg = "reserve_percent gilt nur bei reserve_mode percent."
            raise ValueError(msg)
        uses_defaults = "defaults" in (self.spec_source, self.reserve_source, self.allowance_source)
        if uses_defaults and self.defaults_basis is None:
            msg = "Werte aus Vorgaben brauchen defaults_basis (Stand der gelesenen Vorgaben)."
            raise ValueError(msg)
        if self.assign_devices and self.expected_circuit_version is None:
            msg = "assign_devices braucht expected_circuit_version."
            raise ValueError(msg)
        if len(set(self.assign_devices)) != len(self.assign_devices):
            msg = "Ein Geraet ist in assign_devices doppelt angegeben."
            raise ValueError(msg)
        return self


class CableWaypointOut(BaseModel):
    """Gespeicherter Wegpunkt - je Art nur die zugehoerigen Felder gesetzt."""

    kind: CableWaypointKindValue
    wall_id: uuid.UUID | None = None
    offset_mm: int | None = None
    height_mm: int | None = None
    room_id: uuid.UUID | None = None
    x_mm: int | None = None
    y_mm: int | None = None
    penetration_id: uuid.UUID | None = None
    opening_id: uuid.UUID | None = None
    riser_id: uuid.UUID | None = None
    from_stop_id: uuid.UUID | None = None
    from_height_mm: int | None = None
    to_stop_id: uuid.UUID | None = None
    to_height_mm: int | None = None


class CableProblemOut(BaseModel):
    """Befund: ``conflict`` (ungueltig) oder ``missing`` (fehlt noch), mit Ort und Text.

    ``ref``: ``start``/``end`` (Anschluss), ``route`` (Weg), ``w3`` (Wegpunkt) oder
    ``w2-w3`` (Strecke zwischen zwei Wegpunkten).
    """

    code: str
    kind: CableProblemKindValue
    ref: str
    message: str


class CableSegmentOut(BaseModel):
    """Teilstrecke - Laenge aus der reinen Funktion, Punkte nur fuer die Darstellung.

    ``points``: Geschoss-x/y und absolute Hoehe ``z`` (gespeicherte Hoehenlage des
    Geschosses + lokale Hoehe), ganze mm. ``floor_id`` fehlt bei Steigweg und Schacht.
    """

    kind: CableSegmentKindValue
    ref: str
    owner_id: str
    floor_id: uuid.UUID | None
    length_mm: int | None
    known_mm: int
    points: list[RiserCoursePointOut]


class CableOut(BaseModel):
    """Leitung samt Kabelangaben, Wegpunkten und berechnetem Weg (nie gespeichert).

    ``length_mm`` nur bei ``status = confirmed``; sonst ist ``known_mm`` ausdruecklich
    eine **Teilsumme** der gueltigen Teile plus Zugaben. ``deviates_from_proposal``:
    die Kabelangaben weichen vom aktuellen Stromkreisvorschlag ab. ``allowance_mm`` =
    ``connection_allowance_mm`` + wirksame Reserve (ohne offene Prozentreserve).
    """

    id: uuid.UUID
    circuit_id: uuid.UUID
    label: str | None
    start_device_id: uuid.UUID | None
    #: ``null`` = Endgeraet fehlt (offene Planung, ``incomplete``).
    end_device_id: uuid.UUID | None
    cable_type: str | None
    conductor_count: int | None
    cross_section_mm2: str | None
    start_allowance_mm: int
    end_allowance_mm: int
    #: Feste Reserve (``fixed``); bei ``percent`` immer ``0``.
    reserve_mm: int
    reserve_mode: ReserveModeValue
    #: Prozentsatz als String (``"20.00"``) bei ``percent``, sonst ``null``.
    reserve_percent: str | None
    #: Wirksame Reserve in mm; ``null``, solange eine Prozentreserve auf einen bestaetigten
    #: Weg wartet (``reserve_pending``). Abgeleitet, nie gespeichert.
    reserve_effective_mm: int | None
    reserve_pending: bool
    #: Start- und Endzugabe zusammen - getrennt von der Reserve.
    connection_allowance_mm: int
    spec_origin: CableValueOriginValue
    reserve_origin: CableValueOriginValue
    allowance_origin: CableValueOriginValue
    cable_template_id: uuid.UUID | None
    cable_template_version: int | None
    defaults_office_version: int | None
    defaults_project_version: int | None
    waypoints: list[CableWaypointOut]
    status: CableStatusValue
    geometric_mm: int
    allowance_mm: int
    length_mm: int | None
    known_mm: int
    spec_complete: bool
    deviates_from_proposal: bool
    problems: list[CableProblemOut]
    segments: list[CableSegmentOut]
    penetration_ids: list[uuid.UUID]
    opening_crossings: int
    version: int
    created_at: datetime
    updated_at: datetime


class CableListOut(BaseModel):
    """Leitungen eines Gebaeudes (oder einer Uebernahme), nach Stromkreis und Bezeichnung."""

    building_id: uuid.UUID
    cables: list[CableOut]


class ApplyProposalIn(_Strict):
    """Ausdrueckliche Uebernahme des Stromkreisvorschlags auf **eine** Leitung.

    ``If-Match`` traegt die Version der Leitung; ``expected_circuit_version`` die
    Version des Stromkreises, dessen Vorschlag der Anwender gesehen hat. Weicht eine
    von beiden ab: ``409``, nichts geaendert. Uebernommen werden genau
    ``cable_type``, ``conductor_count`` und ``cross_section_mm2`` - so, wie sie im
    Vorschlag stehen, auch leer. Weg, Endgeraete, Zugaben und Bezeichnung bleiben.
    """

    expected_circuit_version: int = Field(ge=1)


class PositionOut(BaseModel):
    """Exakte Lage ``whole + steps * sqrt(m)`` ab Wandanfang und ihr gerundeter Wert."""

    whole: int
    steps: int
    rounded_mm: int


class PenetrationOut(BaseModel):
    """Durchfuehrung an ``wall_a`` der Kopplung samt abgeleiteter Gegenlage an ``wall_b``.

    ``problem_code`` ist ``null``, wenn die Durchfuehrung gueltig ist.
    ``cable_ids``: Leitungen, die sie nutzen - gezaehlt wird sie einmal.
    """

    id: uuid.UUID
    wall_link_id: uuid.UUID
    wall_a_id: uuid.UUID
    wall_b_id: uuid.UUID
    floor_id: uuid.UUID
    offset_mm: int
    height_mm: int
    note: str | None
    opposite_offset: PositionOut | None
    problem_code: str | None
    cable_ids: list[uuid.UUID]
    version: int
    created_at: datetime
    updated_at: datetime


class PenetrationListOut(BaseModel):
    floor_id: uuid.UUID
    penetrations: list[PenetrationOut]


class PenetrationUpdate(_Strict):
    """Lage, Hoehe oder Notiz einer Durchfuehrung aendern (``If-Match``).

    Die neue Lage muss gueltig sein (``422``). Wuerde eine Leitung dadurch
    unterbrochen, braucht es ``acknowledged_cable_ids`` mit genau diesen Leitungen.
    """

    offset_mm: int | None = Field(default=None, ge=0, le=MAX_COORDINATE_MM)
    height_mm: int | None = Field(default=None, ge=0, le=MAX_ROOM_HEIGHT_MM)
    note: str | None = Field(default=None, max_length=200)
    acknowledged_cable_ids: list[uuid.UUID] = Field(
        default_factory=list, max_length=MAX_ACKNOWLEDGED_CABLES
    )

    _not_nullable = field_validator("offset_mm", "height_mm")(reject_explicit_null)
    _optional = field_validator("note")(_trimmed)


# ------------------------------------------------------------------ Mengenuebersicht (6b.6)

CablingSurfaceValue = Literal["wall", "ceiling", "floor", "riser", "shaft"]
MissingSpecValue = Literal["cable_type", "conductor_count", "cross_section_mm2"]


class CablingBucketOut(BaseModel):
    """Leitungen eines Status in einer Gruppe.

    ``total_mm`` = ``geometric_mm`` + ``allowance_mm``: bei ``confirmed`` die Summe der
    Leitungslaengen, sonst ausdruecklich die **Teilsumme** der bekannten Teile.
    """

    count: int
    geometric_mm: int
    #: ``connection_allowance_mm`` + ``reserve_mm`` - je Leitung genau einmal.
    allowance_mm: int
    #: Anschlusszugaben (fest) - getrennt ausgewiesen (Phase 6c, V1).
    connection_allowance_mm: int
    #: Wirksame Reserve: feste Bestandsreserve und berechnete Prozentreserve, je Leitung eine.
    reserve_mm: int
    #: Leitungen mit Prozentreserve, die auf einen bestaetigten Weg wartet - ihre Reserve
    #: ist in keiner Summe enthalten.
    reserve_pending_count: int
    total_mm: int
    cable_ids: list[uuid.UUID]


class CablingGroupOut(BaseModel):
    """Gruppe gleicher **tatsaechlicher** Kabelangaben (nie der Stromkreisvorschlag)."""

    cable_type: str
    conductor_count: int
    cross_section_mm2: str
    confirmed: CablingBucketOut
    incomplete: CablingBucketOut
    conflict: CablingBucketOut


class CablingTotalsOut(BaseModel):
    """Summen ueber alle vollstaendig angegebenen Leitungen - je Status getrennt."""

    confirmed: CablingBucketOut
    incomplete: CablingBucketOut
    conflict: CablingBucketOut


class CablingCableOut(BaseModel):
    """Eine Leitung als Bestandteil der Uebersicht - Aufschluesselung bis zur Leitung."""

    id: uuid.UUID
    circuit_id: uuid.UUID
    label: str | None
    start_device_id: uuid.UUID | None
    end_device_id: uuid.UUID | None
    cable_type: str | None
    conductor_count: int | None
    cross_section_mm2: str | None
    missing_spec: list[MissingSpecValue]
    status: CableStatusValue
    geometric_mm: int
    allowance_mm: int
    connection_allowance_mm: int
    reserve_mode: ReserveModeValue
    reserve_percent: str | None
    reserve_effective_mm: int | None
    reserve_pending: bool
    spec_origin: CableValueOriginValue
    reserve_origin: CableValueOriginValue
    allowance_origin: CableValueOriginValue
    length_mm: int | None
    known_mm: int
    problem_codes: list[str]


class CablingSurfaceOut(BaseModel):
    """Trassen- und Leitungsmeter einer Flaeche.

    ``confirmed_*`` nur aus bestaetigten Leitungen; ``all_*`` aus allen gueltigen
    Teilstrecken aller Leitungen (einschliesslich vorlaeufiger). Gemeinsam genutzte
    Abschnitte zaehlen als Trasse einmal. ``*_complete = false``: mindestens ein
    Steigweganteil mit unbekannter senkrechter Laenge - gezaehlt ist nur der bekannte Teil.
    """

    surface: CablingSurfaceValue
    confirmed_trace_mm: int
    confirmed_cable_mm: int
    all_trace_mm: int
    all_cable_mm: int
    confirmed_complete: bool
    all_complete: bool


class CablingPenetrationOut(BaseModel):
    """Durchfuehrung nach Identitaet - einmal gezaehlt, egal wie viele Leitungen sie nutzen."""

    id: uuid.UUID
    used: bool
    cable_ids: list[uuid.UUID]
    problem_code: str | None


class CablingCrossingOut(BaseModel):
    """Bodenuebergang an einer Oeffnung: **Nutzungen** je Leitung, kein Bauteil.

    ``opening_id = null``: die Oeffnung wurde entfernt (Leitung im Konflikt).
    """

    opening_id: uuid.UUID | None
    wall_id: uuid.UUID
    cable_ids: list[uuid.UUID]
    uses: int


class CablingTypeCountOut(BaseModel):
    type_key: str
    label: str
    count: int


class CablingCircuitOut(BaseModel):
    """Geraete eines Stromkreises je Typ; zugeordnete Geraete ohne Leitung gesondert."""

    circuit_id: uuid.UUID
    board_id: uuid.UUID
    designation: str
    name: str
    by_type: list[CablingTypeCountOut]
    device_ids: list[uuid.UUID]
    devices_without_cable: list[uuid.UUID]


class CablingSummaryOut(BaseModel):
    """Mengenuebersicht eines Gebaeudes aus dem **gespeicherten** Stand (Entwurf §6.5).

    Abgeleitet bei jedem Lesen, nie gespeichert; ein konsistenter Planungsstand je
    Antwort. Laengen in ganzen Millimetern; ``cross_section_mm2`` als Dezimalstring.
    "Bestaetigt" heisst vollstaendig im Planungsmodell - keine Normpruefung, keine
    Bemessung, keine Aussage ueber Ausfuehrbarkeit. Kein Material, keine Preise.
    """

    building_id: uuid.UUID
    building_name: str
    project_status: str
    groups: list[CablingGroupOut]
    totals: CablingTotalsOut
    unspecified: list[CablingCableOut]
    cables: list[CablingCableOut]
    surfaces: list[CablingSurfaceOut]
    penetrations: list[CablingPenetrationOut]
    crossings: list[CablingCrossingOut]
    circuits: list[CablingCircuitOut]
    unassigned_device_ids: list[uuid.UUID]


# ------------------------------------- Kabelvorlagen und Planungsvorgaben (Phase 6c, V1)

#: Endpunktarten der Anschlusszugaben (Entwurf §8.2).
EndpointKindValue = Literal["board", "junction", "device"]
DefaultsLevelValue = Literal["project", "office"]
MAX_CABLE_TEMPLATES = 500
MAX_TYPE_TEMPLATES = 200


class _CableTemplateFields(_Strict):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    cable_type: str | None = Field(default=None, min_length=1, max_length=40)
    conductor_count: int | None = Field(default=None, ge=1, le=100)
    cross_section_mm2: str | None = Field(
        default=None, pattern=CROSS_SECTION_PATTERN, examples=["1.5", "2.50"]
    )
    is_active: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10_000)

    _required = field_validator("name", "cable_type")(_required_text)

    @field_validator("cross_section_mm2")
    @classmethod
    def _positive(cls, value: str | None) -> str | None:
        if value is not None and Decimal(value) == 0:
            msg = "Der Querschnitt muss groesser als 0 sein."
            raise ValueError(msg)
        return value


class CableTemplateCreate(_CableTemplateFields):
    """Neue Kabelvorlage des Betriebs - technische Angaben, **kein Preis**.

    Das Tripel ist vollstaendig (eine Vorlage liefert immer alle drei Werte).
    """

    name: str = Field(min_length=1, max_length=80)
    cable_type: str = Field(min_length=1, max_length=40)
    conductor_count: int = Field(ge=1, le=100)
    cross_section_mm2: str = Field(pattern=CROSS_SECTION_PATTERN, examples=["1.5"])
    is_active: bool = True
    sort_order: int = Field(default=0, ge=0, le=10_000)


class CableTemplateUpdate(_CableTemplateFields):
    """Teilaenderung (``If-Match``). Deaktivieren statt Loeschen, wenn genutzt.

    Eine Aenderung aendert **keine** bestehende Leitung - deren Angaben stehen an ihr.
    """

    _not_nullable = field_validator(
        "name", "cable_type", "conductor_count", "cross_section_mm2", "is_active", "sort_order"
    )(reject_explicit_null)


class CableTemplateOut(BaseModel):
    id: uuid.UUID
    name: str
    cable_type: str
    conductor_count: int
    cross_section_mm2: str
    is_active: bool
    sort_order: int
    #: Von Leitungen, Vorgaben oder Zuordnungen genutzt - dann nicht loeschbar.
    in_use: bool
    version: int
    created_at: datetime
    updated_at: datetime


class CableTemplateListOut(BaseModel):
    """Alle Kabelvorlagen des Betriebs nach Sortierung und Name (auch inaktive)."""

    templates: list[CableTemplateOut]


class DeviceTypeTemplateIn(_Strict):
    device_type_key: str = Field(min_length=1, max_length=40)
    cable_template_id: uuid.UUID


class DeviceTypeTemplateOut(BaseModel):
    device_type_key: str
    cable_template_id: uuid.UUID


class _PlanningDefaultsFields(_Strict):
    """Vollstaendiger Stand einer Vorgabenebene (``PUT`` ersetzt ihn ganz).

    **Jedes Feld ist anzugeben**: ``null`` = nicht gesetzt (Projekt: Betriebsstandard
    uebernehmen; Betrieb: 0 % bzw. 0 mm), ``"0"`` bzw. ``0`` = ausdruecklich null. Ein
    fehlendes Feld ist ein Fehler (``422``) - so werden fehlend, ``null`` und null nie
    verwechselt. ``expected_version``: gelesene Version, ``0`` = noch nichts gespeichert.
    """

    expected_version: int = Field(ge=0)
    reserve_percent: str | None = Field(pattern=PERCENT_PATTERN, examples=["20", None])
    board_allowance_mm: int | None = Field(ge=0, le=MAX_CABLE_ALLOWANCE_MM)
    junction_allowance_mm: int | None = Field(ge=0, le=MAX_CABLE_ALLOWANCE_MM)
    device_allowance_mm: int | None = Field(ge=0, le=MAX_CABLE_ALLOWANCE_MM)
    default_cable_template_id: uuid.UUID | None
    device_type_templates: list[DeviceTypeTemplateIn] = Field(max_length=MAX_TYPE_TEMPLATES)


class PlanningDefaultsIn(_PlanningDefaultsFields):
    """Betriebsstandard ersetzen (``electrical.defaults.manage``)."""


class ProjectPlanningDefaultsIn(_PlanningDefaultsFields):
    """Projektvorgabe ersetzen (``electrical.route.write``) - waehlt nur Betriebsvorlagen."""


class _PlanningDefaultsOutFields(BaseModel):
    #: ``0`` = keine Vorgabe gespeichert (alle Felder ``null``).
    version: int
    reserve_percent: str | None
    board_allowance_mm: int | None
    junction_allowance_mm: int | None
    device_allowance_mm: int | None
    default_cable_template_id: uuid.UUID | None
    device_type_templates: list[DeviceTypeTemplateOut]
    updated_at: datetime | None


class PlanningDefaultsOut(_PlanningDefaultsOutFields):
    """Betriebsstandard - gespeicherte Werte, ``null`` = nicht gesetzt."""


class ProjectPlanningDefaultsOut(_PlanningDefaultsOutFields):
    """Projektvorgabe - gespeicherte Werte, ``null`` = Betriebsstandard uebernehmen."""

    project_id: uuid.UUID


class DefaultsBasisOut(BaseModel):
    """Stand der Vorgaben dieser Antwort - beim Speichern als ``defaults_basis`` mitsenden."""

    office_version: int
    project_version: int
    cable_template_id: uuid.UUID | None = None
    cable_template_version: int | None = None
    circuit_version: int | None = None


class EffectiveReserveOut(BaseModel):
    percent: str
    origin: CableValueOriginValue


class EffectiveAllowanceOut(BaseModel):
    endpoint_kind: EndpointKindValue
    value_mm: int
    origin: CableValueOriginValue


class EffectiveTemplateChoiceOut(BaseModel):
    """Vorlagenwahl einer Ebene: Projekt vor Betrieb; ``template`` inklusive Aktivstatus."""

    device_type_key: str | None
    level: DefaultsLevelValue
    template: CableTemplateOut


class EffectiveHintOut(BaseModel):
    """Hinweis, nie eine stille Entscheidung: ``template-inactive``,
    ``start-template-differs``, ``circuit-proposal-not-activated``,
    ``circuit-override-incomplete``."""

    code: str
    template_id: uuid.UUID | None
    device_id: uuid.UUID | None


class EffectiveSpecOut(BaseModel):
    origin: CableValueOriginValue
    cable_type: str | None
    conductor_count: int | None
    cross_section_mm2: str | None
    cable_template_id: uuid.UUID | None
    level: DefaultsLevelValue | None
    deciding_device_id: uuid.UUID | None


class EffectiveCableAllowancesOut(BaseModel):
    origin: CableValueOriginValue
    start_mm: int
    end_mm: int
    start_origin: CableValueOriginValue
    end_origin: CableValueOriginValue


class EffectiveForCableOut(BaseModel):
    """Vorbelegung fuer eine konkrete neue Leitung - genau das, was der Server mit
    ``*_source = defaults`` speichern wuerde."""

    circuit_id: uuid.UUID
    start_device_id: uuid.UUID | None
    end_device_id: uuid.UUID | None
    spec: EffectiveSpecOut
    reserve: EffectiveReserveOut
    allowances: EffectiveCableAllowancesOut
    hints: list[EffectiveHintOut]
    basis: DefaultsBasisOut


class EffectivePlanningDefaultsOut(BaseModel):
    """Wirksame Vorgaben eines Projekts (aufgeloeste Werte, Herkunft, Versionsbasis).

    Ein konsistenter Stand je Antwort (geteilte Projekt- und Vorgabensperre). ``basis`` ist
    beim Speichern einer Leitung mit ``*_source = defaults`` als ``defaults_basis`` zu
    senden; ``for_cable`` nur mit ``circuit_id`` (optional Start-/Endgeraet).
    """

    project_id: uuid.UUID
    project_status: str
    basis: DefaultsBasisOut
    reserve: EffectiveReserveOut
    allowances: list[EffectiveAllowanceOut]
    default_template: EffectiveTemplateChoiceOut | None
    device_type_templates: list[EffectiveTemplateChoiceOut]
    templates: list[CableTemplateOut]
    for_cable: EffectiveForCableOut | None
