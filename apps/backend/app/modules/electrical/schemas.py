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
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.validation import reject_explicit_null
from app.modules.electrical.catalog import MAX_DEVICE_LABEL_LENGTH, MAX_DEVICES_PER_ROOM
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
DeviceCategoryValue = Literal["socket", "switch", "light", "data"]


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
    """Ein Geraetetyp des Systemkatalogs.

    ``width_mm``/``height_mm`` sind das **Planungsmass** fuer die
    Platzierungspruefung (an der Wand Breite x Hoehe, an der Decke in x und y)
    - keine Herstellerangabe. ``default_center_height_mm`` ist ein Startwert,
    keine Normvorgabe. ``is_active = false``: nicht mehr fuer neue Geraete.
    """

    model_config = ConfigDict(from_attributes=True)

    key: str
    label: str
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


class WallLinkUpdate(_Strict):
    """Entscheidung einer Kopplung aendern (``If-Match`` der Kopplungsversion)."""

    relation: WallLinkRelationValue


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
    sie.
    """


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
