"""Leitungsweg, Laenge, Status und Trassen - reine Funktion (Phase 6b.2, ADR 0026).

Die **fachliche Referenz** fuer Leitungslaengen. Keine Datenbank, keine
Speicherung: Aus dem Planungsstand eines Gebaeudes (Raeume, Waende, Oeffnungen,
Kopplungen, Geraete, Durchfuehrungen, Steigwege) und einer Leitung
(Endgeraete, Wegpunkte, Zugaben, Kabelangaben) folgt deterministisch

* die Folge der Teilstrecken mit ihren Laengen,
* die geometrische Summe, die Zugaben, der Status und - nur bei
  ``confirmed`` - die Leitungslaenge,
* die Leitungsreserve (Phase 6c, V1, ADR 0027): fest in mm (``fixed``, Bestand)
  oder in Prozent der geometrischen Laenge (``percent``) - getrennt von den
  Anschlusszugaben ausgewiesen,
* die Befunde mit Code und Ort.

:func:`derive_traces` leitet daraus die gemeinsamen Trassen ab (Trassenmeter
einmal, Leitungsmeter je Leitung). Das Frontend spiegelt diese Datei
(``leitung/laenge.ts``); die gemeinsame Fixture
``testdata/geometry/leitung.v1.json`` haelt beide gleich.

**Wiederverwendet, nicht kopiert:** Wandteilung, Abschnittszustaende,
Abschnittstransformation und Fremdoeffnungen (``topology.py``), Kopplungsstatus
(``link_rules.py``), Konturpruefung und Rundung (``geometry.py``),
Punkt-im-Polygon (``devices.py``), Steigwegverlauf und -status
(``riser_course.py``).

**Weg** (Entwurf §5.1)::

    Startgeraet -Anschluss- W1 - ... - Wn -Anschluss- Endgeraet

Wegpunktarten: Wandpunkt (Wand, Abstand, Hoehe), Decken-/Fussbodenpunkt (Raum,
x, y), Durchfuehrung, Bodenuebergang (Quellwand der Oeffnung, Abstand) und
Steigwegnutzung (Ein- und Ausstiegshalt mit lokaler Hoehe).

==========================  ================================================
Uebergang                   Bedingung / Laenge
==========================  ================================================
Wand                        dieselbe Wand, waagerecht oder senkrecht, nicht
                            durch eine Oeffnung - exakt
Ecke                        Wandende = Anfang der Nachbarwand desselben Raums,
                            gleiche Hoehe - 0
Wand - Decke / Fussboden    Wandpunkt auf Raumhoehe bzw. 0, Flaechenpunkt
                            genau auf der Wandachse an derselben Stelle - 0
Decke / Fussboden           derselbe Raum, gerade, vollstaendig in der echten
                            Kontur (Rand zaehlt als innen) - einmal gerundet
Durchfuehrung               Wandpunkt Seite A -> Gegenlage auf Seite B ueber
                            die Abschnittstransformation - 0
Bodenuebergang              Fussbodenpunkt Raum A -> Achspunkt in der Tuer ->
                            Fussbodenpunkt Raum B - 0 (die Fussbodenstrecken
                            zaehlen)
Steigweg                    Ein-/Ausstieg genau am Halt; genutzt wird der
                            Abschnitt der einen Steigweg-Polylinie ab der
                            Einstiegshoehe, darueber die Schachtfortsetzung
Anschluss (abgeleitet)      Wandgeraet: senkrecht auf Wegpunkthoehe, dann
                            waagerecht auf derselben Wand; Deckengeraet:
                            gerade in der Decke
==========================  ================================================

**Status** (Entwurf §6.3): ``conflict`` bei jedem ungueltigen Befund (Art
``conflict``), sonst ``incomplete`` bei fehlenden Teilen (Art ``missing``:
Endgeraet nicht platziert, Weg erreicht ein Endgeraet nicht, Hoehenlage im
genutzten Steigweg unbestaetigt), sonst ``confirmed``. Eine ungueltige Strecke
ist **nie** eine gueltige Null: Sie traegt keine Teilstrecke bei, die Summe
heisst dann ausdruecklich Teilsumme.

**Rundung:** ganze Millimeter; achsparallele Strecken exakt; gerade Decken- und
Fussbodenstrecken, ``direct``-Steigwegversaetze und Wandstrecken zu einer
irrationalen Gegenlage je Strecke **einmal** kaufmaennisch gerundet, danach nur
ganzzahlige Summen. Keine Fliesskommazahl.

**Reserve** (ADR 0027 Nr. 5, Entwurf §8.7): ``fixed`` zaehlt ``reserve_mm`` wie
bisher - unabhaengig vom Status. ``percent`` rechnet ``r = ceil(g * p / 100)`` auf
ganze Millimeter **aufgerundet**, ganzzahlig ueber ``P = p * 100``
(:func:`percent_reserve_mm`), und **nur** bei ``confirmed``: Ein offener oder
konflikthafter Weg hat keine scheinbar vollstaendige Prozentreserve
(``reserve_mm = None``, ``reserve_pending``). Prozent nie auf Zugaben, nie auf eine
feste Reserve. Die Reserve wird nie gespeichert, nur der Prozentsatz.

Keine elektrotechnische Bemessung, keine Normaussage, kein Material, kein
Preis (docs/security.md, Abschnitt 17).
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from math import gcd, isqrt

from app.modules.electrical import geometry
from app.modules.electrical.catalog import MountingSurface
from app.modules.electrical.devices import point_in_polygon
from app.modules.electrical.geometry import Point, Segment
from app.modules.electrical.link_rules import LinkStatus, link_status
from app.modules.electrical.riser_course import (
    CoursePoint,
    RiserFloor,
    RiserStopPoint,
    SectionStatus,
    analyse_riser,
)
from app.modules.electrical.topology import (
    LineMeasure,
    Position,
    SectionSource,
    SectionState,
    Span,
    TopoLink,
    TopoOpening,
    TopoWall,
    WallPartition,
    compare,
    foreign_openings,
    partition,
    position,
    spans_overlap,
    transfer,
    whole_span,
)

#: Planungsflaechen eines Leitungswegs.
WALL = "wall"
CEILING = "ceiling"
FLOOR = "floor"
RISER = "riser"
SHAFT = "shaft"

#: Oeffnungsarten, an denen ein Bodenuebergang zulaessig ist (Entwurf §5.6).
CROSSING_OPENING_KINDS = frozenset({"door", "passage"})


# ------------------------------------------------------------------ Eingabe


@dataclass(frozen=True, slots=True)
class CableOpening:
    id: str
    #: ``door``, ``window`` oder ``passage``.
    kind: str
    offset_mm: int
    width_mm: int
    sill_height_mm: int
    height_mm: int


@dataclass(frozen=True, slots=True)
class CableWall:
    id: str
    start: Point
    end: Point
    openings: tuple[CableOpening, ...] = ()


@dataclass(frozen=True, slots=True)
class CableRoom:
    id: str
    floor_id: uuid.UUID
    #: Effektive lichte Raumhoehe.
    height_mm: int
    #: Waende in Konturreihenfolge.
    walls: tuple[CableWall, ...]


@dataclass(frozen=True, slots=True)
class CableDevice:
    """Ein platziertes Geraet - Bezugspunkt ist die Mitte (wie ``devices.py``)."""

    id: str
    room_id: str
    surface: str
    wall_id: str | None = None
    center_offset_mm: int | None = None
    center_height_mm: int | None = None
    x_mm: int | None = None
    y_mm: int | None = None


@dataclass(frozen=True, slots=True)
class CablePenetration:
    """Durchfuehrung, gespeichert einmal an ``wall_a`` ihrer Kopplung."""

    id: str
    link_id: str
    offset_mm: int
    height_mm: int


@dataclass(frozen=True, slots=True)
class CableRiser:
    id: str
    offset_mode: str
    stops: tuple[RiserStopPoint, ...]


@dataclass(frozen=True, slots=True)
class CablePlan:
    """Planungsstand eines Gebaeudes - alles, was die Laengenfunktion liest."""

    floors: tuple[RiserFloor, ...]
    rooms: tuple[CableRoom, ...]
    links: tuple[TopoLink, ...] = ()
    devices: tuple[CableDevice, ...] = ()
    penetrations: tuple[CablePenetration, ...] = ()
    risers: tuple[CableRiser, ...] = ()


@dataclass(frozen=True, slots=True)
class WallWaypoint:
    wall_id: str
    offset_mm: int
    height_mm: int


@dataclass(frozen=True, slots=True)
class AreaWaypoint:
    #: ``ceiling`` oder ``floor``.
    surface: str
    room_id: str
    x_mm: int
    y_mm: int


@dataclass(frozen=True, slots=True)
class PenetrationWaypoint:
    penetration_id: str


@dataclass(frozen=True, slots=True)
class OpeningCrossingWaypoint:
    """Bodenuebergang: Lage auf der Achse der Quellwand der Oeffnung (Entwurf §5.6)."""

    wall_id: str
    offset_mm: int
    #: Nur der fachliche Bezug; ``None`` nach bestaetigtem Entfernen der Oeffnung.
    opening_id: str | None


@dataclass(frozen=True, slots=True)
class RiserWaypoint:
    """Steigwegnutzung in Leitungsrichtung: Einstieg ``from``, Ausstieg ``to``.

    Hoehen sind lokal ueber dem FFB des jeweiligen Halts.
    """

    riser_id: str
    from_stop_id: uuid.UUID
    from_height_mm: int
    to_stop_id: uuid.UUID
    to_height_mm: int


Waypoint = (
    WallWaypoint | AreaWaypoint | PenetrationWaypoint | OpeningCrossingWaypoint | RiserWaypoint
)


@dataclass(frozen=True, slots=True)
class Cable:
    id: str
    start_device_id: str | None
    end_device_id: str | None
    waypoints: tuple[Waypoint, ...] = ()
    start_allowance_mm: int = 0
    end_allowance_mm: int = 0
    reserve_mm: int = 0
    cable_type: str | None = None
    conductor_count: int | None = None
    cross_section_mm2: Decimal | None = None
    #: ``fixed`` (``reserve_mm``) oder ``percent`` (``reserve_percent``, 0-100, zwei Stellen).
    reserve_mode: str = "fixed"
    reserve_percent: Decimal | None = None


#: Reservearten (ADR 0027) - dieselben Schluessel wie Datenbank und API.
RESERVE_FIXED = "fixed"
RESERVE_PERCENT = "percent"
RESERVE_MODES: tuple[str, ...] = (RESERVE_FIXED, RESERVE_PERCENT)


def percent_reserve_mm(geometric_mm: int, percent: Decimal) -> int:
    """Prozentreserve auf die geometrische Laenge, auf ganze mm **aufgerundet** (F2).

    Ganzzahlig, ohne Gleitkomma: ``P = p * 100`` muss eine ganze Zahl sein (hoechstens
    zwei Nachkommastellen), ``r = (g * P + 9 999) // 10 000``. 8 500 / 20 -> 1 700,
    8 333 / 20 -> 1 667, 4 001 / 12,5 -> 501, 0 % -> 0, 100 % -> g.
    """
    if geometric_mm < 0:
        msg = "Die geometrische Laenge ist nie negativ."
        raise ValueError(msg)
    scaled = percent * 100
    if scaled != scaled.to_integral_value() or not Decimal(0) <= percent <= Decimal(100):
        msg = "Prozentsatz 0 bis 100 mit hoechstens zwei Nachkommastellen."
        raise ValueError(msg)
    return (geometric_mm * int(scaled) + 9_999) // 10_000


# ------------------------------------------------------------------ Ergebnis


class CableStatus(StrEnum):
    CONFIRMED = "confirmed"
    INCOMPLETE = "incomplete"
    CONFLICT = "conflict"


class ProblemKind(StrEnum):
    #: Ungueltig - die Leitung ist ``conflict``.
    CONFLICT = "conflict"
    #: Fehlt noch - die Leitung ist hoechstens ``incomplete``.
    MISSING = "missing"


class SegmentKind(StrEnum):
    CONNECTION = "connection"
    WALL = "wall"
    CORNER = "corner"
    WALL_CEILING = "wall-ceiling"
    WALL_FLOOR = "wall-floor"
    CEILING = "ceiling"
    FLOOR = "floor"
    PENETRATION = "penetration"
    OPENING_CROSSING = "opening-crossing"
    RISER = "riser"
    SHAFT = "shaft"


#: Deutsche Meldungen je Code (ADR 0008). Die Oberflaeche hat eigene Texte.
PROBLEM_TEXT: dict[str, str] = {
    "start-not-placed": "Die Leitung hat keinen platzierten Startpunkt.",
    "end-not-placed": "Die Leitung hat keinen platzierten Endpunkt.",
    "end-device-missing": "Die Leitung hat noch kein Endgeraet (offene Planung).",
    "endpoint-unknown": "Das Endgeraet ist nicht bekannt.",
    "endpoint-exterior": "Aussen montierte Geraete werden in 6b nicht angeschlossen.",
    "endpoint-surface-unknown": "Die Montageflaeche des Endgeraets ist nicht bekannt.",
    "route-empty": "Der Leitungsweg ist noch nicht geplant.",
    "route-not-reaching-start": "Der Weg erreicht das Startgeraet nicht.",
    "route-not-reaching-end": "Der Weg erreicht das Endgeraet nicht.",
    "waypoint-wall-unknown": "Der Wegpunkt liegt an keiner bekannten Wand.",
    "waypoint-outside-wall": "Der Wegpunkt liegt ausserhalb der Wandflaeche.",
    "waypoint-in-opening": "Der Wegpunkt liegt in einer Oeffnung.",
    "waypoint-room-unknown": "Der Wegpunkt liegt in keinem bekannten Raum.",
    "contour-open": "Decken- und Fussbodenwege brauchen eine geschlossene Raumkontur.",
    "waypoint-outside-room": "Der Wegpunkt liegt nicht in der Raumkontur.",
    "wall-diagonal": "Auf der Wand sind nur waagerechte und senkrechte Strecken zulaessig.",
    "wall-through-opening": "Die Wandstrecke fuehrt durch eine Oeffnung.",
    "connection-through-opening": "Die Anschlussstrecke fuehrt durch eine Oeffnung.",
    "wall-change-without-corner": "Ein Wandwechsel ist nur ueber eine gemeinsame Ecke moeglich.",
    "room-change-without-crossing": (
        "Ein Raumwechsel ist nur ueber eine Durchfuehrung, einen Bodenuebergang "
        "oder einen Steigweg moeglich."
    ),
    "wall-ceiling-transition": "Der Uebergang Wand - Decke liegt nicht an derselben Stelle.",
    "wall-floor-transition": "Der Uebergang Wand - Fussboden liegt nicht an derselben Stelle.",
    "surface-change-not-allowed": "Decke und Fussboden sind nicht direkt verbunden.",
    "area-outside-contour": "Die Strecke verlaesst die Raumkontur.",
    "penetration-unknown": "Die Durchfuehrung ist nicht bekannt.",
    "penetration-link-not-active": "Die Wandkopplung der Durchfuehrung ist nicht aktiv.",
    "penetration-outside-shared-section": (
        "Die Durchfuehrung liegt nicht in einem gemeinsamen Wandabschnitt."
    ),
    "penetration-height": "Die Durchfuehrung liegt nicht unter beiden Raumhoehen.",
    "penetration-in-opening": "Die Durchfuehrung liegt in einer Oeffnung.",
    "penetration-sequence": "Vor oder nach der Durchfuehrung fehlt ein Wandpunkt ihrer Wand.",
    "opening-crossing-opening-removed": "Bodenuebergang ohne Tuer oder Durchgang.",
    "opening-crossing-window": "Ein Bodenuebergang ist an einem Fenster nicht moeglich.",
    "opening-crossing-outside": "Der Bodenuebergang liegt ausserhalb der Oeffnung.",
    "opening-crossing-not-connecting": "Die Oeffnung verbindet die beiden Raeume nicht.",
    "opening-crossing-off-grid": "Der Bodenuebergang liegt nicht auf ganzen Millimetern.",
    "opening-crossing-sequence": (
        "Vor und nach dem Bodenuebergang muss je ein Fussbodenpunkt der beiden Raeume liegen."
    ),
    "riser-unknown": "Der Steigweg ist nicht bekannt.",
    "riser-stop-unknown": "Der Halt gehoert nicht zu diesem Steigweg.",
    "riser-same-stop": "Ein- und Ausstieg liegen am selben Halt.",
    "riser-height": "Die Hoehe am Halt ist ungueltig.",
    "riser-entry-height": "Der Einstieg liegt nicht unterhalb des naechsten Geschosses.",
    "riser-transfer": "Der Wegpunkt liegt nicht genau am Halt des Steigwegs.",
    "riser-elevation-unconfirmed": (
        "Eine Hoehenlage im genutzten Steigweg ist nicht bestaetigt - Laenge unvollstaendig."
    ),
    "riser-elevation-inconsistent": "Die Hoehenlagen im genutzten Steigweg widersprechen sich.",
}


@dataclass(frozen=True, slots=True)
class CableProblem:
    code: str
    kind: ProblemKind
    #: Ort: ``start``, ``end``, ``route``, ``w3`` (Wegpunkt) oder ``w2-w3`` (Strecke).
    ref: str
    message: str


@dataclass(frozen=True, slots=True)
class WallRun:
    """Gerade Strecke auf einer Raumwand - Lagen exakt ab Wandanfang."""

    wall_id: str
    measure: LineMeasure
    from_offset: Position
    from_height_mm: int
    to_offset: Position
    to_height_mm: int
    length_mm: int


@dataclass(frozen=True, slots=True)
class AreaRun:
    """Gerade Strecke in Decke oder Fussboden eines Raums."""

    surface: str
    room_id: str
    start: Point
    end: Point
    length_mm: int


@dataclass(frozen=True, slots=True)
class RiserRun:
    """Genutzter Teil **eines** Steigwegabschnitts, ab ``from_height_mm`` ueber dem unteren FFB."""

    riser_id: str
    section_index: int
    from_height_mm: int
    #: Genutzter senkrechter Teil - nur bei bestaetigter Hoehenlage.
    vertical_mm: int | None
    horizontal_mm: int
    #: Genutzte Polylinie in Leitungsrichtung (absolute Hoehen).
    course: tuple[CoursePoint, ...]

    @property
    def known_mm(self) -> int:
        return self.horizontal_mm + (self.vertical_mm or 0)


@dataclass(frozen=True, slots=True)
class ShaftRun:
    """Schachtfortsetzung senkrecht ueber einem Halt, lokal ab dessen FFB.

    In Leitungsrichtung von ``from_height_mm`` nach ``to_height_mm`` - aufwaerts
    ``0 -> h`` (Ausstieg), abwaerts ``h -> 0`` (Einstieg von oben).
    """

    riser_id: str
    stop_id: uuid.UUID
    from_height_mm: int
    to_height_mm: int

    @property
    def height_mm(self) -> int:
        return max(self.from_height_mm, self.to_height_mm)


Run = WallRun | AreaRun | RiserRun | ShaftRun


@dataclass(frozen=True, slots=True)
class CableSegment:
    kind: SegmentKind
    ref: str
    #: Wand, Raum, Durchfuehrung, Oeffnung bzw. Steigweg.
    owner_id: str
    runs: tuple[Run, ...]
    #: ``None`` nur bei unbekannter senkrechter Steigweglaenge.
    length_mm: int | None
    known_mm: int
    #: Geschoss der Teilstrecke; ``None`` bei Steigweg und Schacht (mehrere Geschosse).
    floor_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class CableResult:
    cable_id: str
    segments: tuple[CableSegment, ...]
    #: Summe der bekannten, gueltigen Teilstrecken.
    geometric_mm: int
    #: Alle Zusaetze: Anschlusszugaben + wirksame Reserve (bei offener Prozentreserve nur
    #: die Zugaben). Bedeutung unveraendert seit 6b (ADR 0027 §8.8).
    allowance_mm: int
    status: CableStatus
    #: Nur bei ``confirmed``: geometrisch + Zugaben.
    length_mm: int | None
    #: Bekannte Teile + Zugaben - ausdruecklich eine Teilsumme, wenn nicht ``confirmed``.
    known_mm: int
    spec_complete: bool
    problems: tuple[CableProblem, ...]
    #: Genutzte Durchfuehrungen in Wegreihenfolge, je einmal.
    penetration_ids: tuple[str, ...]
    opening_crossings: int
    #: Start- und Endzugabe (fest, mm) - getrennt von der Reserve (V1).
    connection_allowance_mm: int = 0
    #: Wirksame Reserve in mm; ``None``, solange eine Prozentreserve nicht berechenbar ist.
    reserve_mm: int | None = 0
    #: Prozentreserve wartet auf einen bestaetigten Weg (nie bei ``fixed``).
    reserve_pending: bool = False


# ------------------------------------------------------------------ Rundung


def rounded_position(value: Position, measure: LineMeasure) -> int:
    """``round(whole + steps*sqrt(m))`` kaufmaennisch, rein ganzzahlig.

    ``round(x) = floor((2x + 1) / 2)``. Ist ``sqrt(m)`` irrational, liegt
    ``2x + 1`` nie auf einer ganzen Zahl; ``floor`` folgt exakt aus ``isqrt``.
    """
    if value.steps == 0:
        return value.whole
    if measure.root is not None:
        return value.whole + value.steps * measure.root
    root = isqrt(4 * value.steps * value.steps * measure.m)
    twice = 2 * value.whole + 1 + (root if value.steps > 0 else -(root + 1))
    return twice // 2


def _abs_position(value: Position, measure: LineMeasure) -> Position:
    if compare(value, Position(0), measure) < 0:
        return Position(-value.whole, -value.steps)
    return value


def _difference(a: Position, b: Position, measure: LineMeasure) -> Position:
    return position(a.whole - b.whole, a.steps - b.steps, measure)


# ------------------------------------------------------------------ Vorbereitung


@dataclass(frozen=True, slots=True)
class _WallInfo:
    wall: CableWall
    room: CableRoom
    length_mm: int
    item: WallPartition
    #: Gekuerzte Richtung Anfang -> Ende.
    step_x: int
    step_y: int
    steps: int


@dataclass(frozen=True, slots=True)
class PreparedPlan:
    """Einmal je Planungsstand vorbereitet; fuer beliebig viele Leitungen."""

    plan: CablePlan
    rooms: dict[str, CableRoom]
    walls: dict[str, _WallInfo]
    partitions: dict[str, WallPartition]
    links: dict[str, TopoLink]
    devices: dict[str, CableDevice]
    penetrations: dict[str, CablePenetration]
    risers: dict[str, CableRiser]
    floor_ids: frozenset[uuid.UUID]
    #: Geschosse nach ID - Hoehenlage fuer die raeumlichen Punkte.
    floors: dict[uuid.UUID, RiserFloor]
    #: Halte aller Steigwege nach ID.
    stops: dict[uuid.UUID, RiserStopPoint]
    contour_valid: dict[str, bool]
    polygons: dict[str, tuple[Point, ...]]
    #: ``1`` gegen den Uhrzeigersinn, ``-1`` im Uhrzeigersinn.
    orientation: dict[str, int]


def prepare_plan(plan: CablePlan) -> PreparedPlan:
    partitions: dict[str, WallPartition] = {}
    by_floor: dict[uuid.UUID, list[TopoWall]] = {}
    for room in plan.rooms:
        for wall in room.walls:
            by_floor.setdefault(room.floor_id, []).append(
                TopoWall(
                    id=wall.id,
                    room_id=room.id,
                    start=wall.start,
                    end=wall.end,
                    openings=tuple(
                        TopoOpening(o.id, o.offset_mm, o.width_mm, o.sill_height_mm, o.height_mm)
                        for o in wall.openings
                    ),
                )
            )
    # Je Geschoss getrennt: Gleiche Koordinaten auf zwei Geschossen ueberlappen nicht.
    for floor_id in sorted(by_floor, key=str):
        partitions.update(partition(by_floor[floor_id], plan.links))

    walls: dict[str, _WallInfo] = {}
    contour_valid: dict[str, bool] = {}
    polygons: dict[str, tuple[Point, ...]] = {}
    orientation: dict[str, int] = {}
    for room in plan.rooms:
        segments = [Segment(key=w.id, start=w.start, end=w.end) for w in room.walls]
        contour_valid[room.id] = bool(segments) and geometry.contour_report(segments).is_valid
        polygons[room.id] = tuple(w.start for w in room.walls)
        orientation[room.id] = 1 if geometry.doubled_area_mm2(list(polygons[room.id])) > 0 else -1
        for wall in room.walls:
            item = partitions.get(wall.id)
            if item is None:
                continue
            dx = wall.end.x_mm - wall.start.x_mm
            dy = wall.end.y_mm - wall.start.y_mm
            divisor = gcd(dx, dy)
            walls[wall.id] = _WallInfo(
                wall, room, item.length_mm, item, dx // divisor, dy // divisor, divisor
            )
    return PreparedPlan(
        plan=plan,
        rooms={room.id: room for room in plan.rooms},
        walls=walls,
        partitions=partitions,
        links={link.id: link for link in plan.links},
        devices={device.id: device for device in plan.devices},
        penetrations={p.id: p for p in plan.penetrations},
        risers={r.id: r for r in plan.risers},
        floor_ids=frozenset(f.floor_id for f in plan.floors),
        floors={f.floor_id: f for f in plan.floors},
        stops={stop.stop_id: stop for riser in plan.risers for stop in riser.stops},
        contour_valid=contour_valid,
        polygons=polygons,
        orientation=orientation,
    )


# ------------------------------------------------------------------ Wandachse


def _wall_position_of(info: _WallInfo, point: Point) -> Position | None:
    """Exakte Lage eines Gitterpunkts auf der Wandachse - ``None`` neben der Wand."""
    wall = info.wall
    if point == wall.start:
        return Position(0)
    if point == wall.end:
        return Position(info.length_mm)
    px = point.x_mm - wall.start.x_mm
    py = point.y_mm - wall.start.y_mm
    if px * info.step_y - py * info.step_x != 0:
        return None
    j = (px * info.step_x + py * info.step_y) // info.item.measure.m
    if not 0 < j < info.steps:
        return None
    return position(0, j, info.item.measure)


def _axis_point(info: _WallInfo, offset_mm: int) -> Point | None:
    """Ganzzahliger Achspunkt bei ``offset_mm`` - ``None`` neben dem Millimetergitter."""
    if offset_mm == 0:
        return info.wall.start
    if offset_mm == info.length_mm:
        return info.wall.end
    root = info.item.measure.root
    if root is None or offset_mm % root != 0:
        return None
    j = offset_mm // root
    if not 0 < j < info.steps:
        return None
    return Point(info.wall.start.x_mm + j * info.step_x, info.wall.start.y_mm + j * info.step_y)


def shared_sources(
    prepared: PreparedPlan, link: TopoLink, at: Position
) -> tuple[SectionSource, SectionSource] | None:
    """Quellen von ``wall_a``/``wall_b`` im ``shared``-Abschnitt dieser Kopplung an der Lage.

    Die Lage ist ab Anfang von ``wall_a`` gemessen, Kanten eingeschlossen.
    ``None`` ausserhalb jedes gemeinsamen Abschnitts dieser Kopplung (Entwurf §5.2).
    Mit :func:`~app.modules.electrical.topology.transfer` ergibt sich die Gegenlage.
    """
    info = prepared.walls.get(link.wall_a_id)
    if info is None:
        return None
    measure = info.item.measure
    for span, section in info.item.section_spans():
        if section.state is not SectionState.SHARED or section.link_id != link.id:
            continue
        if not compare(span.start, at, measure) <= 0 <= compare(span.end, at, measure):
            continue
        source_a = next(s for s in section.sources if s.wall.id == link.wall_a_id)
        source_b = next(s for s in section.sources if s.wall.id == link.wall_b_id)
        return source_a, source_b
    return None


# ------------------------------------------------------------------ Kontur


def _cross(ax: int, ay: int, bx: int, by: int) -> int:
    return ax * by - ay * bx


def _orient(a: Point, b: Point, c: Point) -> int:
    value = _cross(b.x_mm - a.x_mm, b.y_mm - a.y_mm, c.x_mm - a.x_mm, c.y_mm - a.y_mm)
    return (value > 0) - (value < 0)


def _within_box(p: Point, a: Point, b: Point) -> bool:
    return min(a.x_mm, b.x_mm) <= p.x_mm <= max(a.x_mm, b.x_mm) and min(
        a.y_mm, b.y_mm
    ) <= p.y_mm <= max(a.y_mm, b.y_mm)


def _on_edge(p: Point, a: Point, b: Point) -> bool:
    return _orient(a, b, p) == 0 and _within_box(p, a, b)


def _point_in_closed(polygon: Sequence[Point], p: Point) -> bool:
    count = len(polygon)
    if any(_on_edge(p, polygon[i], polygon[(i + 1) % count]) for i in range(count)):
        return True
    return point_in_polygon(p.x_mm, p.y_mm, polygon)


def _in_cone(v: Point, prev: Point, nxt: Point, dx: int, dy: int, orientation: int) -> bool:
    """Liegt die Richtung im (geschlossenen) Innenwinkel der Ecke ``v``?"""
    first, second = (nxt, prev) if orientation > 0 else (prev, nxt)
    e1x, e1y = first.x_mm - v.x_mm, first.y_mm - v.y_mm
    e2x, e2y = second.x_mm - v.x_mm, second.y_mm - v.y_mm
    if _cross(e1x, e1y, e2x, e2y) > 0:
        return _cross(e1x, e1y, dx, dy) >= 0 and _cross(dx, dy, e2x, e2y) >= 0
    return not (_cross(e2x, e2y, dx, dy) > 0 and _cross(dx, dy, e1x, e1y) > 0)


def segment_inside_contour(polygon: Sequence[Point], orientation: int, a: Point, b: Point) -> bool:
    """Liegt die Strecke ``a-b`` vollstaendig in der geschlossenen Kontur? Exakt, Rand = innen.

    Bedingungen: beide Enden in der Kontur, kein echter Schnitt mit einer
    Konturkante, und an jeder beruehrten Ecke bzw. Kante zeigt die Strecke in
    den Innenwinkel. Damit ist auch ein L-Raum exakt erfasst - nicht nur sein
    umschliessendes Rechteck.
    """
    if not (_point_in_closed(polygon, a) and _point_in_closed(polygon, b)):
        return False
    if a == b:
        return True
    dx = b.x_mm - a.x_mm
    dy = b.y_mm - a.y_mm
    count = len(polygon)
    for index in range(count):
        p = polygon[index]
        q = polygon[(index + 1) % count]
        if _orient(a, b, p) * _orient(a, b, q) < 0 and _orient(p, q, a) * _orient(p, q, b) < 0:
            return False
    for index in range(count):
        v = polygon[index]
        prev = polygon[index - 1]
        nxt = polygon[(index + 1) % count]
        if v == a:
            if not _in_cone(v, prev, nxt, dx, dy, orientation):
                return False
        elif v == b:
            if not _in_cone(v, prev, nxt, -dx, -dy, orientation):
                return False
        elif _on_edge(v, a, b) and not (
            _in_cone(v, prev, nxt, dx, dy, orientation)
            and _in_cone(v, prev, nxt, -dx, -dy, orientation)
        ):
            return False
    for index in range(count):
        p = polygon[index]
        q = polygon[(index + 1) % count]
        ex, ey = q.x_mm - p.x_mm, q.y_mm - p.y_mm
        for end, sx, sy in ((a, dx, dy), (b, -dx, -dy)):
            if end in (p, q) or not _on_edge(end, p, q):
                continue
            if orientation * _cross(ex, ey, sx, sy) < 0:
                return False
    return True


# ------------------------------------------------------------------ Orte


@dataclass(frozen=True, slots=True)
class _WallLoc:
    wall_id: str
    offset: Position
    height_mm: int


@dataclass(frozen=True, slots=True)
class _AreaLoc:
    surface: str
    room_id: str
    point: Point


@dataclass(frozen=True, slots=True)
class _StopLoc:
    riser_id: str
    stop: RiserStopPoint
    height_mm: int


_Loc = _WallLoc | _AreaLoc | _StopLoc


@dataclass(frozen=True, slots=True)
class _TwoSided:
    """Durchfuehrung oder Bodenuebergang - zwei Seiten, die Richtung waehlt der Weg."""

    kind: SegmentKind
    owner_id: str
    sides: tuple[_WallLoc | _AreaLoc, _WallLoc | _AreaLoc]


@dataclass(frozen=True, slots=True)
class _RiserUse:
    entry: _StopLoc
    exit: _StopLoc
    segments: tuple[CableSegment, ...]


def _owner_key(loc: _WallLoc | _AreaLoc) -> str:
    return loc.wall_id if isinstance(loc, _WallLoc) else loc.room_id


# ------------------------------------------------------------------ Analyse


class _Walk:
    def __init__(self, prepared: PreparedPlan) -> None:
        self.p = prepared
        self.segments: list[CableSegment] = []
        self.problems: list[CableProblem] = []

    # -- Befunde

    def conflict(self, code: str, ref: str) -> None:
        self.problems.append(CableProblem(code, ProblemKind.CONFLICT, ref, PROBLEM_TEXT[code]))

    def missing(self, code: str, ref: str) -> None:
        self.problems.append(CableProblem(code, ProblemKind.MISSING, ref, PROBLEM_TEXT[code]))

    def add(
        self,
        kind: SegmentKind,
        ref: str,
        owner_id: str,
        runs: tuple[Run, ...] = (),
        length_mm: int = 0,
    ) -> None:
        self.segments.append(
            CableSegment(kind, ref, owner_id, runs, length_mm, length_mm, self.floor_of(owner_id))
        )

    def floor_of(self, owner_id: str) -> uuid.UUID | None:
        """Geschoss einer Wand oder eines Raums - fuer die Zuordnung in der Darstellung."""
        info = self.p.walls.get(owner_id)
        if info is not None:
            return info.room.floor_id
        room = self.p.rooms.get(owner_id)
        return room.floor_id if room is not None else None

    # -- Wand

    def opening_hit(self, wall_id: str, a: Position, b: Position, h1: int, h2: int) -> bool:
        """Beruehrt die Wandstrecke (oder der Punkt) das offene Innere einer Oeffnung?

        Eigene und vom Nachbarraum uebertragene Oeffnungen; die Unterkante einer
        bodentiefen Oeffnung (Bruestung 0) zaehlt zur Oeffnung - dort ist keine Wand.
        """
        info = self.p.walls[wall_id]
        measure = info.item.measure
        lo, hi = (a, b) if compare(a, b, measure) <= 0 else (b, a)
        low, high = min(h1, h2), max(h1, h2)
        run = Span(lo, hi)
        areas = [
            (whole_span(o.offset_mm, o.offset_mm + o.width_mm), o.sill_height_mm, o.height_mm)
            for o in info.wall.openings
        ]
        areas += [
            (f.span, f.opening.sill_height_mm, f.opening.height_mm)
            for f in foreign_openings(info.item)
        ]
        for span, sill, height in areas:
            bottom = sill if sill > 0 else -1
            top = sill + height
            vertical = bottom < low < top if low == high else max(low, bottom) < min(high, top)
            if vertical and spans_overlap(run, span, measure):
                return True
        return False

    def wall_run(self, loc_a: _WallLoc, loc_b: _WallLoc) -> WallRun | None:
        """Gerade Wandstrecke - ``None`` bei einer schraegen Strecke."""
        measure = self.p.walls[loc_a.wall_id].item.measure
        if loc_a.height_mm == loc_b.height_mm:
            length = rounded_position(
                _abs_position(_difference(loc_b.offset, loc_a.offset, measure), measure), measure
            )
        elif compare(loc_a.offset, loc_b.offset, measure) == 0:
            length = abs(loc_b.height_mm - loc_a.height_mm)
        else:
            return None
        return WallRun(
            loc_a.wall_id,
            measure,
            loc_a.offset,
            loc_a.height_mm,
            loc_b.offset,
            loc_b.height_mm,
            length,
        )

    # -- Endgeraete

    def device_loc(self, device_id: str | None, ref: str) -> _Loc | None:
        if device_id is None:
            # Start fehlt nur bei einer Verteilung ohne Lage; ein fehlendes Endgeraet ist
            # eine bewusst offene Planung (V1, ADR 0027 Nr. 9) - beides ``missing``.
            self.missing("end-device-missing" if ref == "end" else f"{ref}-not-placed", ref)
            return None
        device = self.p.devices.get(device_id)
        if device is None:
            self.conflict("endpoint-unknown", ref)
            return None
        if device.surface == MountingSurface.WALL_EXTERIOR.value:
            self.conflict("endpoint-exterior", ref)
            return None
        if device.surface == MountingSurface.WALL_INTERIOR.value:
            info = self.p.walls.get(device.wall_id or "")
            if (
                info is None
                or info.room.id != device.room_id
                or device.center_offset_mm is None
                or device.center_height_mm is None
            ):
                self.conflict("endpoint-surface-unknown", ref)
                return None
            return _WallLoc(
                info.wall.id, Position(device.center_offset_mm), device.center_height_mm
            )
        if (
            device.surface == MountingSurface.CEILING.value
            and device.room_id in self.p.rooms
            and device.x_mm is not None
            and device.y_mm is not None
        ):
            return _AreaLoc(CEILING, device.room_id, Point(device.x_mm, device.y_mm))
        self.conflict("endpoint-surface-unknown", ref)
        return None

    def connect(self, device: _Loc, loc: _Loc, ref: str, *, at_start: bool) -> None:
        """Abgeleitete Anschlussstrecke zwischen Endgeraet und erstem/letztem Wegpunkt."""
        if isinstance(device, _WallLoc) and isinstance(loc, _WallLoc):
            if device.wall_id == loc.wall_id:
                bend = _WallLoc(device.wall_id, device.offset, loc.height_mm)
                vertical = self.wall_run(device, bend)
                horizontal = self.wall_run(bend, loc)
                assert vertical is not None and horizontal is not None
                if any(
                    self.opening_hit(
                        r.wall_id, r.from_offset, r.to_offset, r.from_height_mm, r.to_height_mm
                    )
                    for r in (vertical, horizontal)
                ):
                    self.conflict("connection-through-opening", ref)
                    return
                runs: tuple[Run, ...] = (
                    (vertical, horizontal)
                    if at_start
                    else (_reverse(horizontal), _reverse(vertical))
                )
                self.add(
                    SegmentKind.CONNECTION,
                    ref,
                    device.wall_id,
                    runs,
                    vertical.length_mm + horizontal.length_mm,
                )
                return
        elif (
            isinstance(device, _AreaLoc)
            and isinstance(loc, _AreaLoc)
            and loc.surface == CEILING
            and loc.room_id == device.room_id
        ):
            start, end = (device.point, loc.point) if at_start else (loc.point, device.point)
            run = self.area_run(CEILING, device.room_id, start, end, ref)
            if run is not None:
                self.add(SegmentKind.CONNECTION, ref, device.room_id, (run,), run.length_mm)
            return
        self.missing("route-not-reaching-start" if at_start else "route-not-reaching-end", ref)

    # -- Flaechen

    def area_run(self, surface: str, room_id: str, a: Point, b: Point, ref: str) -> AreaRun | None:
        if not self.p.contour_valid.get(room_id, False):
            self.conflict("contour-open", ref)
            return None
        if not segment_inside_contour(self.p.polygons[room_id], self.p.orientation[room_id], a, b):
            self.conflict("area-outside-contour", ref)
            return None
        return AreaRun(surface, room_id, a, b, geometry.segment_length_mm(a, b))

    # -- Wegpunkte

    def resolve(self, index: int, wp: Waypoint) -> _Loc | _TwoSided | _RiserUse | None:
        ref = f"w{index}"
        if isinstance(wp, WallWaypoint):
            info = self.p.walls.get(wp.wall_id)
            if info is None:
                self.conflict("waypoint-wall-unknown", ref)
                return None
            if not (
                0 <= wp.offset_mm <= info.length_mm and 0 <= wp.height_mm <= info.room.height_mm
            ):
                self.conflict("waypoint-outside-wall", ref)
                return None
            at = Position(wp.offset_mm)
            if self.opening_hit(wp.wall_id, at, at, wp.height_mm, wp.height_mm):
                self.conflict("waypoint-in-opening", ref)
                return None
            return _WallLoc(wp.wall_id, at, wp.height_mm)
        if isinstance(wp, AreaWaypoint):
            if wp.room_id not in self.p.rooms or wp.surface not in (CEILING, FLOOR):
                self.conflict("waypoint-room-unknown", ref)
                return None
            if not self.p.contour_valid[wp.room_id]:
                self.conflict("contour-open", ref)
                return None
            point = Point(wp.x_mm, wp.y_mm)
            if not _point_in_closed(self.p.polygons[wp.room_id], point):
                self.conflict("waypoint-outside-room", ref)
                return None
            return _AreaLoc(wp.surface, wp.room_id, point)
        if isinstance(wp, PenetrationWaypoint):
            return self.penetration(wp, ref)
        if isinstance(wp, OpeningCrossingWaypoint):
            return self.crossing(wp, ref)
        return self.riser(wp, ref)

    def penetration(self, wp: PenetrationWaypoint, ref: str) -> _TwoSided | None:
        pen = self.p.penetrations.get(wp.penetration_id)
        link = self.p.links.get(pen.link_id) if pen is not None else None
        if (
            pen is None
            or link is None
            or link.wall_a_id not in self.p.walls
            or link.wall_b_id not in self.p.walls
        ):
            self.conflict("penetration-unknown", ref)
            return None
        if link_status(self.p.partitions, link) is not LinkStatus.ACTIVE:
            self.conflict("penetration-link-not-active", ref)
            return None
        info_a = self.p.walls[link.wall_a_id]
        info_b = self.p.walls[link.wall_b_id]
        measure = info_a.item.measure
        at = Position(pen.offset_mm)
        pair = shared_sources(self.p, link, at)
        if pair is None:
            self.conflict("penetration-outside-shared-section", ref)
            return None
        if not 0 <= pen.height_mm < min(info_a.room.height_mm, info_b.room.height_mm):
            self.conflict("penetration-height", ref)
            return None
        if self.opening_hit(link.wall_a_id, at, at, pen.height_mm, pen.height_mm):
            self.conflict("penetration-in-opening", ref)
            return None
        opposite = transfer(at, pair[0], pair[1], measure)
        return _TwoSided(
            SegmentKind.PENETRATION,
            pen.id,
            (
                _WallLoc(link.wall_a_id, at, pen.height_mm),
                _WallLoc(link.wall_b_id, opposite, pen.height_mm),
            ),
        )

    def crossing(self, wp: OpeningCrossingWaypoint, ref: str) -> _TwoSided | None:
        info = self.p.walls.get(wp.wall_id)
        if info is None:
            self.conflict("waypoint-wall-unknown", ref)
            return None
        opening = next((o for o in info.wall.openings if o.id == wp.opening_id), None)
        if opening is None:
            self.conflict("opening-crossing-opening-removed", ref)
            return None
        if opening.kind not in CROSSING_OPENING_KINDS:
            self.conflict("opening-crossing-window", ref)
            return None
        if not opening.offset_mm <= wp.offset_mm <= opening.offset_mm + opening.width_mm:
            self.conflict("opening-crossing-outside", ref)
            return None
        neighbours: set[str] = set()
        connecting = True
        measure = info.item.measure
        at = Position(wp.offset_mm)
        for span, section in info.item.section_spans():
            if not compare(span.start, at, measure) <= 0 <= compare(span.end, at, measure):
                continue
            if len(section.sources) != 2 or section.state not in (
                SectionState.SHARED,
                SectionState.UNDECIDED,
            ):
                connecting = False
                continue
            neighbours.update(s.wall.room_id for s in section.sources if s.wall.id != wp.wall_id)
        if not connecting or len(neighbours) != 1 or info.room.id in neighbours:
            self.conflict("opening-crossing-not-connecting", ref)
            return None
        point = _axis_point(info, wp.offset_mm)
        if point is None:
            self.conflict("opening-crossing-off-grid", ref)
            return None
        return _TwoSided(
            SegmentKind.OPENING_CROSSING,
            opening.id,
            (_AreaLoc(FLOOR, info.room.id, point), _AreaLoc(FLOOR, neighbours.pop(), point)),
        )

    def riser(self, wp: RiserWaypoint, ref: str) -> _RiserUse | None:
        riser = self.p.risers.get(wp.riser_id)
        if riser is None:
            self.conflict("riser-unknown", ref)
            return None
        stops = {stop.stop_id: stop for stop in riser.stops}
        first = stops.get(wp.from_stop_id)
        last = stops.get(wp.to_stop_id)
        if (
            first is None
            or last is None
            or any(stop.floor_id not in self.p.floor_ids for stop in riser.stops)
        ):
            self.conflict("riser-stop-unknown", ref)
            return None
        if first.stop_id == last.stop_id:
            self.conflict("riser-same-stop", ref)
            return None
        if wp.from_height_mm < 0 or wp.to_height_mm < 0:
            self.conflict("riser-height", ref)
            return None
        analysis = analyse_riser(self.p.plan.floors, riser.stops, riser.offset_mode)
        order = [stop.stop_id for stop in analysis.stops]
        a = order.index(first.stop_id)
        b = order.index(last.stop_id)
        upward = a < b
        lo, hi = (a, b) if upward else (b, a)
        low_height = wp.from_height_mm if upward else wp.to_height_mm
        up_height = wp.to_height_mm if upward else wp.from_height_mm
        sections = analysis.sections[lo:hi]
        if any(s.status is SectionStatus.ELEVATION_INCONSISTENT for s in sections):
            self.conflict("riser-elevation-inconsistent", ref)
            return None
        entry_vertical = sections[0].vertical_mm
        if entry_vertical is not None and low_height >= entry_vertical:
            self.conflict("riser-entry-height", ref)
            return None
        if any(s.status is SectionStatus.ELEVATION_UNCONFIRMED for s in sections):
            self.missing("riser-elevation-unconfirmed", ref)

        runs: list[RiserRun] = []
        for offset, section in enumerate(sections):
            used_from = low_height if offset == 0 else 0
            points = list(section.course)
            start = points[0]
            points[0] = CoursePoint(start.x_mm, start.y_mm, start.z_mm + used_from)
            course = tuple(p for i, p in enumerate(points) if i == 0 or p != points[i - 1])
            runs.append(
                RiserRun(
                    riser.id,
                    lo + offset,
                    used_from,
                    None if section.vertical_mm is None else section.vertical_mm - used_from,
                    section.horizontal_mm,
                    course if upward else tuple(reversed(course)),
                )
            )
        if not upward:
            runs.reverse()
        known = sum(run.known_mm for run in runs)
        complete = all(run.vertical_mm is not None for run in runs)
        riser_segment = CableSegment(
            SegmentKind.RISER, ref, riser.id, tuple(runs), known if complete else None, known
        )
        upper = analysis.stops[hi]
        result: list[CableSegment] = [riser_segment]
        if up_height > 0:
            shaft = CableSegment(
                SegmentKind.SHAFT,
                ref,
                riser.id,
                (
                    ShaftRun(
                        riser.id,
                        upper.stop_id,
                        0 if upward else up_height,
                        up_height if upward else 0,
                    ),
                ),
                up_height,
                up_height,
            )
            result = [riser_segment, shaft] if upward else [shaft, riser_segment]
        return _RiserUse(
            _StopLoc(riser.id, first, wp.from_height_mm),
            _StopLoc(riser.id, last, wp.to_height_mm),
            tuple(result),
        )

    # -- Schritte zwischen Wegpunkten

    def at_stop(self, loc: _Loc, stop: _StopLoc) -> bool:
        target = Point(stop.stop.x_mm, stop.stop.y_mm)
        if isinstance(loc, _WallLoc):
            info = self.p.walls[loc.wall_id]
            if info.room.floor_id != stop.stop.floor_id or loc.height_mm != stop.height_mm:
                return False
            at = _wall_position_of(info, target)
            return at is not None and compare(at, loc.offset, info.item.measure) == 0
        if isinstance(loc, _AreaLoc):
            room = self.p.rooms[loc.room_id]
            expected = room.height_mm if loc.surface == CEILING else 0
            return (
                room.floor_id == stop.stop.floor_id
                and loc.point == target
                and stop.height_mm == expected
            )
        return False

    def step(self, a: _Loc, b: _Loc, ref: str) -> None:
        if isinstance(a, _StopLoc) or isinstance(b, _StopLoc):
            stop, other = (a, b) if isinstance(a, _StopLoc) else (b, a)
            assert isinstance(stop, _StopLoc)
            if not self.at_stop(other, stop):
                self.conflict("riser-transfer", ref)
            return
        room_a = self.room_of(a)
        room_b = self.room_of(b)
        if room_a != room_b:
            self.conflict("room-change-without-crossing", ref)
            return
        if isinstance(a, _WallLoc) and isinstance(b, _WallLoc):
            self.wall_step(a, b, ref)
        elif isinstance(a, _AreaLoc) and isinstance(b, _AreaLoc):
            if a.surface != b.surface:
                self.conflict("surface-change-not-allowed", ref)
                return
            run = self.area_run(a.surface, a.room_id, a.point, b.point, ref)
            if run is not None:
                kind = SegmentKind.CEILING if a.surface == CEILING else SegmentKind.FLOOR
                self.add(kind, ref, a.room_id, (run,), run.length_mm)
        else:
            wall, area = (a, b) if isinstance(a, _WallLoc) else (b, a)
            assert isinstance(wall, _WallLoc) and isinstance(area, _AreaLoc)
            self.transition(wall, area, ref)

    def room_of(self, loc: _WallLoc | _AreaLoc) -> str:
        return self.p.walls[loc.wall_id].room.id if isinstance(loc, _WallLoc) else loc.room_id

    def wall_step(self, a: _WallLoc, b: _WallLoc, ref: str) -> None:
        if a.wall_id == b.wall_id:
            run = self.wall_run(a, b)
            if run is None:
                self.conflict("wall-diagonal", ref)
                return
            if self.opening_hit(a.wall_id, a.offset, b.offset, a.height_mm, b.height_mm):
                self.conflict("wall-through-opening", ref)
                return
            self.add(SegmentKind.WALL, ref, a.wall_id, (run,), run.length_mm)
            return
        first = self.p.walls[a.wall_id]
        second = self.p.walls[b.wall_id]
        m1 = first.item.measure
        m2 = second.item.measure
        forward = (
            first.wall.end == second.wall.start
            and compare(a.offset, Position(first.length_mm), m1) == 0
            and compare(b.offset, Position(0), m2) == 0
        )
        backward = (
            first.wall.start == second.wall.end
            and compare(a.offset, Position(0), m1) == 0
            and compare(b.offset, Position(second.length_mm), m2) == 0
        )
        if (forward or backward) and a.height_mm == b.height_mm:
            self.add(SegmentKind.CORNER, ref, b.wall_id)
            return
        self.conflict("wall-change-without-corner", ref)

    def transition(self, wall: _WallLoc, area: _AreaLoc, ref: str) -> None:
        info = self.p.walls[wall.wall_id]
        ceiling = area.surface == CEILING
        expected = info.room.height_mm if ceiling else 0
        at = _wall_position_of(info, area.point)
        if (
            wall.height_mm == expected
            and at is not None
            and compare(at, wall.offset, info.item.measure) == 0
        ):
            kind = SegmentKind.WALL_CEILING if ceiling else SegmentKind.WALL_FLOOR
            self.add(kind, ref, wall.wall_id)
            return
        self.conflict("wall-ceiling-transition" if ceiling else "wall-floor-transition", ref)


def _reverse(run: WallRun) -> WallRun:
    return WallRun(
        run.wall_id,
        run.measure,
        run.to_offset,
        run.to_height_mm,
        run.from_offset,
        run.from_height_mm,
        run.length_mm,
    )


def _choose_side(
    item: _TwoSided, before: str | None, after: str | None
) -> tuple[_WallLoc | _AreaLoc, _WallLoc | _AreaLoc] | None:
    """Eintritts- und Austrittsseite nach dem Nachbarn davor (sonst danach)."""
    first, second = item.sides
    keys = (_owner_key(first), _owner_key(second))
    if before is not None and before in keys:
        return (first, second) if before == keys[0] else (second, first)
    if after is not None and after in keys:
        return (second, first) if after == keys[0] else (first, second)
    return None


def _neighbour_key(
    wp: Waypoint | None, loc: _Loc | _TwoSided | _RiserUse | None, kind: SegmentKind
) -> str | None:
    """Wand (Durchfuehrung) bzw. Fussbodenraum (Bodenuebergang) eines Nachbarn."""
    if kind is SegmentKind.PENETRATION:
        if isinstance(loc, _WallLoc):
            return loc.wall_id
        return wp.wall_id if isinstance(wp, WallWaypoint) else None
    if isinstance(loc, _AreaLoc) and loc.surface == FLOOR:
        return loc.room_id
    if isinstance(wp, AreaWaypoint) and wp.surface == FLOOR and loc is None:
        return wp.room_id
    return None


def analyse_cable(prepared: PreparedPlan, cable: Cable) -> CableResult:
    """Weg, Teilstrecken, Status und Laengen einer Leitung - deterministisch."""
    walk = _Walk(prepared)
    start = walk.device_loc(cable.start_device_id, "start")
    end = walk.device_loc(cable.end_device_id, "end")
    waypoints = cable.waypoints
    count = len(waypoints)
    resolved = [walk.resolve(index, wp) for index, wp in enumerate(waypoints)]

    entries: list[_Loc | None] = []
    exits: list[_Loc | None] = []
    inner: list[CableSegment | tuple[CableSegment, ...] | None] = []
    for index, item in enumerate(resolved):
        ref = f"w{index}"
        if isinstance(item, _TwoSided):
            before_loc = exits[index - 1] if index > 0 else start
            after_wp = waypoints[index + 1] if index + 1 < count else None
            after_loc = resolved[index + 1] if index + 1 < count else end
            before = _neighbour_key(
                waypoints[index - 1] if index > 0 else None, before_loc, item.kind
            )
            after = _neighbour_key(after_wp, after_loc, item.kind)
            chosen = (
                _choose_side(item, before, after)
                if item.kind is SegmentKind.PENETRATION
                else _crossing_sides(item, before, after)
            )
            if chosen is None:
                walk.conflict(
                    "penetration-sequence"
                    if item.kind is SegmentKind.PENETRATION
                    else "opening-crossing-sequence",
                    ref,
                )
                entries.append(None)
                exits.append(None)
                inner.append(None)
                continue
            entries.append(chosen[0])
            exits.append(chosen[1])
            inner.append(
                CableSegment(
                    item.kind, ref, item.owner_id, (), 0, 0, walk.floor_of(_owner_key(chosen[0]))
                )
            )
        elif isinstance(item, _RiserUse):
            entries.append(item.entry)
            exits.append(item.exit)
            inner.append(item.segments)
        else:
            entries.append(item)
            exits.append(item)
            inner.append(None)

    if count == 0:
        walk.missing("route-empty", "route")
    else:
        first_entry = entries[0]
        if start is not None and first_entry is not None:
            walk.connect(start, first_entry, "start", at_start=True)
        for index in range(count):
            segment = inner[index]
            if isinstance(segment, CableSegment):
                walk.segments.append(segment)
            elif segment is not None:
                walk.segments.extend(segment)
            if index + 1 < count:
                left = exits[index]
                right = entries[index + 1]
                if left is not None and right is not None:
                    walk.step(left, right, f"w{index}-w{index + 1}")
        last_exit = exits[-1]
        if end is not None and last_exit is not None:
            walk.connect(end, last_exit, "end", at_start=False)

    geometric = sum(segment.known_mm for segment in walk.segments)
    problems = tuple(walk.problems)
    if any(p.kind is ProblemKind.CONFLICT for p in problems):
        status = CableStatus.CONFLICT
    elif problems:
        status = CableStatus.INCOMPLETE
    else:
        status = CableStatus.CONFIRMED
    connection = cable.start_allowance_mm + cable.end_allowance_mm
    reserve: int | None
    if cable.reserve_mode == RESERVE_PERCENT:
        if cable.reserve_percent is None:
            msg = "Prozentreserve ohne Prozentsatz."
            raise ValueError(msg)
        reserve = (
            percent_reserve_mm(geometric, cable.reserve_percent)
            if status is CableStatus.CONFIRMED
            else None
        )
    else:
        reserve = cable.reserve_mm
    allowance = connection + (reserve or 0)
    penetrations: list[str] = []
    for segment in walk.segments:
        if segment.kind is SegmentKind.PENETRATION and segment.owner_id not in penetrations:
            penetrations.append(segment.owner_id)
    return CableResult(
        cable_id=cable.id,
        segments=tuple(walk.segments),
        geometric_mm=geometric,
        allowance_mm=allowance,
        status=status,
        length_mm=geometric + allowance if status is CableStatus.CONFIRMED else None,
        known_mm=geometric + allowance,
        spec_complete=(
            cable.cable_type is not None
            and cable.conductor_count is not None
            and cable.cross_section_mm2 is not None
        ),
        problems=problems,
        penetration_ids=tuple(penetrations),
        opening_crossings=sum(
            1 for segment in walk.segments if segment.kind is SegmentKind.OPENING_CROSSING
        ),
        connection_allowance_mm=connection,
        reserve_mm=reserve,
        reserve_pending=reserve is None,
    )


def _crossing_sides(
    item: _TwoSided, before: str | None, after: str | None
) -> tuple[_WallLoc | _AreaLoc, _WallLoc | _AreaLoc] | None:
    """Bodenuebergang: davor und danach je ein Fussbodenpunkt der beiden Raeume (§5.6)."""
    first, second = item.sides
    keys = (_owner_key(first), _owner_key(second))
    if before is None or after is None or {before, after} != set(keys):
        return None
    return (first, second) if before == keys[0] else (second, first)


# ------------------------------------------------------------------ Raumpunkte


def _rounded_ratio(numerator: int, denominator: int) -> int:
    """``round(n / d)`` kaufmaennisch (Halbwert vom Nullpunkt weg), ``d > 0``."""
    quotient, rest = divmod(abs(numerator), denominator)
    if 2 * rest >= denominator:
        quotient += 1
    return quotient if numerator >= 0 else -quotient


def _rounded_over_root(value: int, m: int) -> int:
    """``round(value / sqrt(m))`` exakt; bei irrationalem Wert ohne Halbwertfall."""
    root = isqrt(m)
    if root * root == m:
        return _rounded_ratio(value, root)
    magnitude = (isqrt(4 * value * value // m) + 1) // 2
    return magnitude if value >= 0 else -magnitude


def wall_axis_point(info: _WallInfo, at: Position) -> Point:
    """Grundrisspunkt einer exakten Lage auf der Wandachse - nur fuer die Darstellung.

    Wandenden sind exakt Anfang bzw. Ende (``0`` und gerundete Wandlaenge,
    ADR 0013). Dazwischen ``Anfang + Lage * Richtung``; jede Koordinate wird
    einmal kaufmaennisch auf ganze Millimeter gerundet. Laengen werden **nie**
    aus diesen Punkten berechnet.
    """
    if at.steps == 0 and at.whole == 0:
        return info.wall.start
    if at.steps == 0 and at.whole == info.length_mm:
        return info.wall.end
    m = info.item.measure.m
    return Point(
        info.wall.start.x_mm
        + at.steps * info.step_x
        + _rounded_over_root(at.whole * info.step_x, m),
        info.wall.start.y_mm
        + at.steps * info.step_y
        + _rounded_over_root(at.whole * info.step_y, m),
    )


def run_points(prepared: PreparedPlan, run: Run) -> tuple[CoursePoint, ...]:
    """Raeumliche Punkte eines Laufs in Leitungsrichtung (Geschoss-x/y, absolute Hoehe z).

    Bezugssysteme (Entwurf §17.2):

    * Wand: Lage ab Wandanfang auf der Achse der gerichteten Raumwand, Hoehe
      lokal ueber FFB; ``z = Hoehenlage des Geschosses + Hoehe``,
    * Decke/Fussboden: Geschoss-x/y; ``z = Hoehenlage + Raumhoehe`` bzw. ``+ 0``,
    * Steigweg: die eine Polylinie aus ``riser_course`` (absolute Hoehen),
    * Schacht: senkrecht ueber dem Halt, lokal ab dessen FFB.

    Die Hoehenlage ist der gespeicherte Wert, auch wenn er nicht bestaetigt ist -
    wie beim Steigwegverlauf eine vorlaeufige Darstellung, keine Laenge.
    """
    if isinstance(run, WallRun):
        info = prepared.walls[run.wall_id]
        base = prepared.floors[info.room.floor_id].elevation_mm
        start = wall_axis_point(info, run.from_offset)
        end = wall_axis_point(info, run.to_offset)
        return (
            CoursePoint(start.x_mm, start.y_mm, base + run.from_height_mm),
            CoursePoint(end.x_mm, end.y_mm, base + run.to_height_mm),
        )
    if isinstance(run, AreaRun):
        room = prepared.rooms[run.room_id]
        z = prepared.floors[room.floor_id].elevation_mm + (
            room.height_mm if run.surface == CEILING else 0
        )
        return (
            CoursePoint(run.start.x_mm, run.start.y_mm, z),
            CoursePoint(run.end.x_mm, run.end.y_mm, z),
        )
    if isinstance(run, RiserRun):
        return run.course
    stop = prepared.stops[run.stop_id]
    base = prepared.floors[stop.floor_id].elevation_mm
    return (
        CoursePoint(stop.x_mm, stop.y_mm, base + run.from_height_mm),
        CoursePoint(stop.x_mm, stop.y_mm, base + run.to_height_mm),
    )


def segment_points(prepared: PreparedPlan, segment: CableSegment) -> tuple[CoursePoint, ...]:
    """Polylinie einer Teilstrecke - Laeufe aneinander, doppelte Stuetzpunkte entfallen."""
    points: list[CoursePoint] = []
    for run in segment.runs:
        for point in run_points(prepared, run):
            if not points or points[-1] != point:
                points.append(point)
    return tuple(points)


def penetration_problem(prepared: PreparedPlan, penetration_id: str) -> str | None:
    """Befundcode einer Durchfuehrung selbst - ``None``, wenn sie gueltig ist (Entwurf §5.2).

    Dieselbe Pruefung wie beim Aufloesen eines Wegpunkts: Kopplung aktiv, im
    ``shared``-Abschnitt dieser Kopplung, unter beiden Raumhoehen, ausserhalb
    jeder Oeffnung. Unabhaengig davon, ob eine Leitung sie nutzt.
    """
    walk = _Walk(prepared)
    walk.penetration(PenetrationWaypoint(penetration_id), "p")
    return walk.problems[0].code if walk.problems else None


def analyse_cables(plan: CablePlan, cables: Iterable[Cable]) -> list[CableResult]:
    prepared = prepare_plan(plan)
    return [analyse_cable(prepared, cable) for cable in cables]


__all__ = [
    "PROBLEM_TEXT",
    "RESERVE_FIXED",
    "RESERVE_MODES",
    "RESERVE_PERCENT",
    "AreaRun",
    "AreaWaypoint",
    "Cable",
    "CableDevice",
    "CableOpening",
    "CablePenetration",
    "CablePlan",
    "CableProblem",
    "CableResult",
    "CableRiser",
    "CableRoom",
    "CableSegment",
    "CableStatus",
    "CableWall",
    "OpeningCrossingWaypoint",
    "PenetrationWaypoint",
    "PreparedPlan",
    "ProblemKind",
    "RiserRun",
    "RiserWaypoint",
    "SegmentKind",
    "ShaftRun",
    "WallRun",
    "WallWaypoint",
    "Waypoint",
    "analyse_cable",
    "analyse_cables",
    "penetration_problem",
    "percent_reserve_mm",
    "prepare_plan",
    "rounded_position",
    "run_points",
    "segment_inside_contour",
    "segment_points",
    "shared_sources",
    "wall_axis_point",
]
