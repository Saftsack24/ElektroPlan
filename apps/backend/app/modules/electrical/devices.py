"""Pruefung der Geraetelagen - rein, ganzzahlig, ohne Datenbank (Phase 5, ADR 0023).

**Bezugspunkt** ist immer die **Mitte** des Geraets:

* Wand (innen oder aussen): ``center_offset_mm`` = Abstand der Mitte vom
  Anfang der gerichteten Wand (ADR 0013), ``center_height_mm`` = Hoehe der
  Mitte ueber Fertigfussboden. Beides haengt weder von der Blickrichtung noch
  von der betrachteten Seite ab.
* Decke: ``x_mm``/``y_mm`` = Mitte in Geschosskoordinaten (wie der Grundriss).
  Eine Hoehe wird nicht gespeichert: Deckengeraete sitzen auf der effektiven
  Raumhoehe und folgen jeder Hoehenaenderung.

**Geraetegeometrie** ist das Planungsmass des Typs (``catalog.py``): ein
achsparalleles Rechteck um die Mitte, an der Wand in (Abstand, Hoehe), an der
Decke in (x, y). Masse sind gerade - die Kanten liegen damit auf ganzen
Millimetern. Keine erfundenen Sicherheitsabstaende: Beruehrung an einer Kante
ist erlaubt, wie bei Oeffnungen.

Regeln je Geraet:

1. Der Typ ist bekannt und erlaubt die Montageflaeche.
2. Wand: Die Wand gehoert zum Raum; das Rechteck liegt ganz in der Wand
   (``0 .. Wandlaenge``, ``0 .. Raumhoehe``) und ueberdeckt keine Oeffnung -
   weder eine eigene noch eine, die ein Nachbarraum auf demselben Wandstueck
   gespeichert hat. Aussen zusaetzlich: kein geteiltes Wandstueck (dort ist die
   andere Seite der Innenraum des Nachbarn).

   **Wandkopplungen (Phase 6a, ADR 0024):** Auf einem als ``separate``
   gekoppelten Stueck gehoert eine Oeffnung nur ihrer eigenen Bauwand - die
   Oeffnung des Nachbarn blockiert dort nicht. ``shared`` und unentschiedene
   Stuecke verhalten sich wie in Phase 5. Die Aussenmontage bleibt auf jedem
   Stueck mit Nachbarraum verboten, auch bei ``separate``: Die aeussere Seite
   ist dort eine Zwischenflaeche, keine Fassade.
3. Decke: geschlossene Kontur, das Rechteck liegt vollstaendig in der echten
   Raumkontur - auch bei L-Form und anderen nicht rechteckigen Raeumen, nicht
   nur im umschliessenden Rechteck.
4. Keine Ueberdeckung mit einem anderen Geraet auf derselben Flaeche
   (dieselbe Wand und Seite bzw. dieselbe Decke).

**Befund mit Ausmass.** Jeder Befund (:class:`DeviceFinding`) traegt neben
Code und Meldung eine **Identitaet** - Geraet, Code und Konfliktpartner
(Oeffnung, anderes Geraet, Nachbarraum) - und ein exaktes **Ausmass**
(:class:`Severity`, groesser = schlimmer). Damit laesst sich unterscheiden, ob
eine Aenderung einen bestehenden Konflikt unveraendert laesst, verkleinert,
vergroessert oder durch einen anderen ersetzt (``device_rules.py``):

==================================  ==============================================
Code                                Ausmass / Partner
==================================  ==============================================
``device-outside-wall``             Ueberstand ueber beide Wandenden, mm
``device-below-floor``              Ueberstand unter den Fussboden, mm
``device-exceeds-room-height``      Ueberstand ueber die Raumhoehe, mm
``device-in-opening``               ueberdeckte Flaeche, mm²; Partner: Oeffnung
``device-exterior-on-shared-wall``  Laenge auf geteilten Stuecken, mm; Partner:
                                    alle beteiligten Nachbarraeume
``device-outside-room``             Flaeche ausserhalb der Raumkontur, mm²
``devices-overlap``                 ueberdeckte Flaeche, mm²; Partner: Geraet
uebrige (Typ, Flaeche, Raum, Wand,  kein Ausmass: Ein Bestand bleibt zulaessig,
Lage, offene Kontur)                solange derselbe Befund besteht
==================================  ==============================================

Langen auf schraegen Waenden koennen irrational sein (``whole + steps·√m``,
``topology.py``); sie werden exakt verglichen. Zwei Ausmasse mit
verschiedenen irrationalen Schrittlaengen gelten als **nicht vergleichbar** und
damit konservativ als Verschlechterung.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from fractions import Fraction

from app.modules.electrical import geometry
from app.modules.electrical.catalog import MountingSurface
from app.modules.electrical.geometry import GeometryProblem, Point, Segment
from app.modules.electrical.topology import (
    LineMeasure,
    Position,
    Span,
    TopoLink,
    TopoWall,
    WallPartition,
    compare,
    foreign_openings,
    partition,
    position,
    spans_overlap,
    whole_span,
)


@dataclass(frozen=True, slots=True)
class DeviceTypeSpec:
    """Was die Pruefung von einem Geraetetyp braucht."""

    key: str
    width_mm: int
    height_mm: int
    allows_wall_interior: bool
    allows_wall_exterior: bool
    allows_ceiling: bool

    def allows(self, surface: str) -> bool:
        return {
            MountingSurface.WALL_INTERIOR.value: self.allows_wall_interior,
            MountingSurface.WALL_EXTERIOR.value: self.allows_wall_exterior,
            MountingSurface.CEILING.value: self.allows_ceiling,
        }.get(surface, False)


@dataclass(frozen=True, slots=True)
class PlannedDevice:
    """Ein Geraet in reiner Form - gespeichert oder Zielzustand."""

    id: str
    room_id: str
    type_key: str
    surface: str
    wall_id: str | None = None
    center_offset_mm: int | None = None
    center_height_mm: int | None = None
    x_mm: int | None = None
    y_mm: int | None = None


@dataclass(frozen=True, slots=True)
class PlannedRoom:
    """Ein Raum mit Kontur (geordnete Waende) und effektiver Hoehe."""

    id: str
    height_mm: int
    walls: tuple[TopoWall, ...]


@dataclass(frozen=True, slots=True)
class Severity:
    """Exaktes Ausmass ``whole + steps·√m`` eines Befunds - groesser ist schlimmer.

    ``steps == 0`` ist eine rationale Groesse (mm, mm²); ``m`` zaehlt dann nicht.
    Befunde ohne messbares Ausmass haben ``Severity()`` (null).
    """

    whole: Fraction = Fraction(0)
    steps: int = 0
    m: int = 1

    def not_worse_than(self, before: Severity) -> bool:
        """``True``, wenn dieses Ausmass hoechstens so gross ist wie ``before``."""
        if self.steps == 0 and before.steps == 0:
            return self.whole <= before.whole
        if self.steps != 0 and before.steps != 0 and self.m != before.m:
            # Verschiedene irrationale Schrittlaengen: nicht exakt vergleichbar.
            return False
        m = self.m if self.steps != 0 else before.m
        return _sign_sqrt(self.whole - before.whole, self.steps - before.steps, m) <= 0


def _sign(value: Fraction | int) -> int:
    return (value > 0) - (value < 0)


def _sign_sqrt(d: Fraction, e: int, m: int) -> int:
    """Vorzeichen von ``d + e·√m`` - exakt, auch fuer rationales ``d``."""
    if e == 0 or d == 0 or _sign(d) == _sign(e):
        return _sign(d) if d != 0 else _sign(e)
    left = d * d
    right = e * e * m
    if left == right:
        return 0
    return _sign(d) if left > right else _sign(e)


def _length_severity(length: Position, factor: int, measure: LineMeasure) -> Severity:
    return Severity(Fraction(length.whole * factor), length.steps * factor, measure.m)


@dataclass(frozen=True, slots=True)
class DeviceFinding:
    """Ein Befund mit Konfliktpartnern und Ausmass.

    ``problem.keys`` nennt zuerst das Geraet (fuer Meldung und Hervorhebung);
    ``identity`` = (Geraet, Code, Partner ...) bestimmt, ob ein Befund vorher
    schon bestand.
    """

    problem: GeometryProblem
    partners: tuple[str, ...] = ()
    severity: Severity = Severity()

    @property
    def device_id(self) -> str:
        return self.problem.keys[0]

    @property
    def identity(self) -> tuple[str, ...]:
        return (self.device_id, self.problem.code, *self.partners)


@dataclass(frozen=True, slots=True)
class _Rect:
    x0: int
    x1: int
    y0: int
    y1: int

    def overlaps(self, other: _Rect) -> bool:
        return (
            self.x0 < other.x1 and other.x0 < self.x1 and self.y0 < other.y1 and other.y0 < self.y1
        )

    def overlap_area(self, other: _Rect) -> int:
        if not self.overlaps(other):
            return 0
        return (min(self.x1, other.x1) - max(self.x0, other.x0)) * (
            min(self.y1, other.y1) - max(self.y0, other.y0)
        )


def _finding(
    code: str,
    message: str,
    device_id: str,
    *partners: str,
    severity: Severity | None = None,
    partners_in_keys: bool = True,
) -> DeviceFinding:
    keys = (device_id, *partners) if partners_in_keys else (device_id,)
    return DeviceFinding(
        problem=GeometryProblem(code=code, message=message, keys=keys),
        partners=partners,
        severity=severity if severity is not None else Severity(),
    )


def device_findings(
    rooms: Sequence[PlannedRoom],
    devices: Sequence[PlannedDevice],
    types: Mapping[str, DeviceTypeSpec],
    links: Sequence[TopoLink] = (),
) -> list[DeviceFinding]:
    """Alle Befunde der Geraete eines Geschosses - deterministisch nach Geraete-ID.

    ``rooms`` sind **alle** Raeume des Geschosses: Abgeleitete Oeffnungen und
    geteilte Wandstuecke ergeben sich aus den Nachbarraeumen. ``links`` sind
    die Wandkopplungen des Geschosses (ohne sie: Phase-5-Verhalten).
    """
    by_room = {room.id: room for room in rooms}
    partitions = partition([wall for room in rooms for wall in room.walls], links)
    findings: list[DeviceFinding] = []
    surfaces: dict[tuple[str, str], list[tuple[str, _Rect]]] = {}

    for device in sorted(devices, key=lambda item: item.id):
        spec = types.get(device.type_key)
        if spec is None:
            findings.append(
                _finding("device-type-unknown", "Der Geraetetyp ist nicht bekannt.", device.id)
            )
            continue
        if not spec.allows(device.surface):
            findings.append(
                _finding(
                    "device-surface-not-allowed",
                    "Dieser Geraetetyp ist fuer diese Montageflaeche nicht vorgesehen.",
                    device.id,
                )
            )
            continue
        room = by_room.get(device.room_id)
        if room is None:
            findings.append(
                _finding("device-room-unknown", "Der Raum des Geraets fehlt.", device.id)
            )
            continue
        if device.surface == MountingSurface.CEILING.value:
            rect = _ceiling_findings(device, spec, room, findings)
            surface_key = (room.id, MountingSurface.CEILING.value)
        else:
            rect = _wall_findings(device, spec, room, partitions, findings)
            surface_key = (device.wall_id or "", device.surface)
        if rect is not None:
            surfaces.setdefault(surface_key, []).append((device.id, rect))

    for placed in surfaces.values():
        for index, (first, rect) in enumerate(placed):
            for second, other in placed[index + 1 :]:
                if rect.overlaps(other):
                    message = "Zwei Geraete auf derselben Flaeche ueberdecken sich."
                    area = Severity(Fraction(rect.overlap_area(other)))
                    findings.append(
                        _finding("devices-overlap", message, first, second, severity=area)
                    )
                    findings.append(
                        _finding("devices-overlap", message, second, first, severity=area)
                    )
    return findings


def device_problems(
    rooms: Sequence[PlannedRoom],
    devices: Sequence[PlannedDevice],
    types: Mapping[str, DeviceTypeSpec],
    links: Sequence[TopoLink] = (),
) -> list[GeometryProblem]:
    """Nur die Befunde (Code, Meldung, Schluessel) - fuer Anzeige und Parität mit dem Editor."""
    return [finding.problem for finding in device_findings(rooms, devices, types, links)]


# ---------------------------------------------------------------------- Wand


def _wall_findings(
    device: PlannedDevice,
    spec: DeviceTypeSpec,
    room: PlannedRoom,
    partitions: Mapping[str, WallPartition],
    findings: list[DeviceFinding],
) -> _Rect | None:
    wall = next((item for item in room.walls if item.id == device.wall_id), None)
    if wall is None or device.center_offset_mm is None or device.center_height_mm is None:
        findings.append(
            _finding(
                "device-wall-unknown",
                "Das Wandgeraet gehoert zu keiner Wand dieses Raums.",
                device.id,
            )
        )
        return None
    half_w = spec.width_mm // 2
    half_h = spec.height_mm // 2
    rect = _Rect(
        device.center_offset_mm - half_w,
        device.center_offset_mm + half_w,
        device.center_height_mm - half_h,
        device.center_height_mm + half_h,
    )
    length = geometry.segment_length_mm(wall.start, wall.end)
    if rect.x0 < 0 or rect.x1 > length:
        overhang = max(0, -rect.x0) + max(0, rect.x1 - length)
        findings.append(
            _finding(
                "device-outside-wall",
                "Das Geraet ragt ueber den Rand der Wand hinaus.",
                device.id,
                severity=Severity(Fraction(overhang)),
            )
        )
    if rect.y0 < 0:
        findings.append(
            _finding(
                "device-below-floor",
                "Das Geraet reicht unter den Fussboden.",
                device.id,
                severity=Severity(Fraction(-rect.y0)),
            )
        )
    if rect.y1 > room.height_mm:
        findings.append(
            _finding(
                "device-exceeds-room-height",
                "Das Geraet reicht ueber die Decke des Raums hinaus.",
                device.id,
                severity=Severity(Fraction(rect.y1 - room.height_mm)),
            )
        )

    for opening in wall.openings:
        area = _Rect(
            opening.offset_mm,
            opening.offset_mm + opening.width_mm,
            opening.sill_height_mm,
            opening.sill_height_mm + opening.height_mm,
        )
        if rect.overlaps(area):
            findings.append(
                _finding(
                    "device-in-opening",
                    "Das Geraet liegt in einer Tuer-, Fenster- oder Durchgangsoeffnung.",
                    device.id,
                    opening.id,
                    severity=Severity(Fraction(rect.overlap_area(area))),
                )
            )

    item = partitions.get(wall.id)
    if item is None:
        return rect
    device_span = whole_span(rect.x0, rect.x1)
    for other in foreign_openings(item):
        top = other.opening.sill_height_mm + other.opening.height_mm
        vertical = min(rect.y1, top) - max(rect.y0, other.opening.sill_height_mm)
        if vertical > 0 and spans_overlap(device_span, other.span, item.measure):
            findings.append(
                _finding(
                    "device-in-opening",
                    "Das Geraet liegt in einer Oeffnung, die der Nachbarraum an dieser Wand "
                    "gespeichert hat.",
                    device.id,
                    other.opening.id,
                    severity=_length_severity(
                        _overlap_length(device_span, other.span, item.measure),
                        vertical,
                        item.measure,
                    ),
                )
            )
    if device.surface == MountingSurface.WALL_EXTERIOR.value:
        neighbours: set[str] = set()
        shared = Position(0)
        for span, section in item.section_spans():
            if section.shared and spans_overlap(device_span, span, item.measure):
                neighbours.update(rid for rid in section.room_ids if rid != room.id)
                piece = _overlap_length(device_span, span, item.measure)
                shared = position(
                    shared.whole + piece.whole, shared.steps + piece.steps, item.measure
                )
        if neighbours:
            findings.append(
                _finding(
                    "device-exterior-on-shared-wall",
                    "Aussen montiert, aber dieses Wandstueck grenzt an einen anderen Raum. "
                    "Dort bitte als Geraet des Nachbarraums innen setzen.",
                    device.id,
                    *sorted(neighbours),
                    severity=_length_severity(shared, 1, item.measure),
                    # Die Meldung hebt nur das Geraet hervor (wie im Editor).
                    partners_in_keys=False,
                )
            )
    return rect


def _overlap_length(a: Span, b: Span, measure: LineMeasure) -> Position:
    """Laenge der Ueberdeckung zweier sich ueberdeckender Bereiche - exakt."""
    start = a.start if compare(a.start, b.start, measure) >= 0 else b.start
    end = a.end if compare(a.end, b.end, measure) <= 0 else b.end
    return position(end.whole - start.whole, end.steps - start.steps, measure)


# ---------------------------------------------------------------------- Decke


def _ceiling_findings(
    device: PlannedDevice,
    spec: DeviceTypeSpec,
    room: PlannedRoom,
    findings: list[DeviceFinding],
) -> _Rect | None:
    if device.x_mm is None or device.y_mm is None:
        findings.append(
            _finding("device-position-missing", "Dem Deckengeraet fehlt die Lage.", device.id)
        )
        return None
    segments = [Segment(key=wall.id, start=wall.start, end=wall.end) for wall in room.walls]
    if geometry.contour_report(segments).status is not geometry.ContourStatus.VALID:
        findings.append(
            _finding(
                "device-ceiling-contour-open",
                "Deckengeraete brauchen eine geschlossene Raumkontur.",
                device.id,
            )
        )
        return None
    half_w = spec.width_mm // 2
    half_h = spec.height_mm // 2
    rect = _Rect(
        device.x_mm - half_w, device.x_mm + half_w, device.y_mm - half_h, device.y_mm + half_h
    )
    polygon = [wall.start for wall in room.walls]
    if not rect_inside_polygon(rect.x0, rect.y0, rect.x1, rect.y1, polygon):
        outside = (rect.x1 - rect.x0) * (rect.y1 - rect.y0) - area_inside_rect(
            rect.x0, rect.y0, rect.x1, rect.y1, polygon
        )
        findings.append(
            _finding(
                "device-outside-room",
                "Das Deckengeraet liegt nicht vollstaendig im Raum.",
                device.id,
                severity=Severity(outside),
            )
        )
    return rect


def point_in_polygon(x: int, y: int, polygon: Sequence[Point]) -> bool:
    """Strahlverfahren, exakt ganzzahlig. Ein Punkt auf dem Rand gilt hier als aussen."""
    inside = False
    count = len(polygon)
    for index in range(count):
        a = polygon[index]
        b = polygon[(index + 1) % count]
        if (a.y_mm > y) == (b.y_mm > y):
            continue
        # x < a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y), ohne Division.
        numerator = (y - a.y_mm) * (b.x_mm - a.x_mm)
        denominator = b.y_mm - a.y_mm
        left = (x - a.x_mm) * denominator
        if (left < numerator) if denominator > 0 else (left > numerator):
            inside = not inside
    return inside


def segment_enters_open_box(a: Point, b: Point, x0: int, y0: int, x1: int, y1: int) -> bool:
    """Beruehrt die Strecke ``a-b`` das **offene** Innere des Rechtecks? Exakt (Liang-Barsky)."""
    dx = b.x_mm - a.x_mm
    dy = b.y_mm - a.y_mm
    low = Fraction(0)
    high = Fraction(1)
    # Bedingung je Kante: p * t < q (strikt), t in [0, 1].
    for p, q in (
        (-dx, a.x_mm - x0),
        (dx, x1 - a.x_mm),
        (-dy, a.y_mm - y0),
        (dy, y1 - a.y_mm),
    ):
        if p == 0:
            if q <= 0:
                return False
            continue
        bound = Fraction(q, p)
        if p < 0:
            low = max(low, bound)
        else:
            high = min(high, bound)
    return low < high


def rect_inside_polygon(x0: int, y0: int, x1: int, y1: int, polygon: Sequence[Point]) -> bool:
    """Liegt das achsparallele Rechteck vollstaendig in der (einfachen) Kontur?

    Genau dann, wenn keine Konturkante das offene Innere des Rechtecks
    beruehrt und seine Mitte innen liegt. Beruehrung des Rands ist erlaubt.
    """
    count = len(polygon)
    for index in range(count):
        if segment_enters_open_box(polygon[index], polygon[(index + 1) % count], x0, y0, x1, y1):
            return False
    # Die Mitte ist ganzzahlig, weil die Planungsmasse gerade sind.
    return point_in_polygon((x0 + x1) // 2, (y0 + y1) // 2, polygon)


_FPoint = tuple[Fraction, Fraction]


def area_inside_rect(x0: int, y0: int, x1: int, y1: int, polygon: Sequence[Point]) -> Fraction:
    """Flaeche der (einfachen) Kontur innerhalb des Rechtecks - exakt.

    Sutherland-Hodgman gegen die vier Rechteckkanten; die Flaeche des
    Ergebnisses ist auch bei nicht konvexer Kontur exakt (entartete Kanten
    entlang des Rechteckrands tragen nichts bei).
    """
    points: list[_FPoint] = [(Fraction(p.x_mm), Fraction(p.y_mm)) for p in polygon]
    for axis, bound, keep_greater in ((0, x0, True), (0, x1, False), (1, y0, True), (1, y1, False)):
        if not points:
            break
        clipped: list[_FPoint] = []
        for index, current in enumerate(points):
            previous = points[index - 1]

            def inside(
                point: _FPoint,
                axis: int = axis,
                bound: int = bound,
                keep_greater: bool = keep_greater,
            ) -> bool:
                return point[axis] >= bound if keep_greater else point[axis] <= bound

            if inside(current):
                if not inside(previous):
                    clipped.append(_cut(previous, current, axis, bound))
                clipped.append(current)
            elif inside(previous):
                clipped.append(_cut(previous, current, axis, bound))
        points = clipped
    twice = Fraction(0)
    for a, b in zip(points, points[1:] + points[:1], strict=True):
        twice += a[0] * b[1] - b[0] * a[1]
    return abs(twice) / 2


def _cut(a: _FPoint, b: _FPoint, axis: int, bound: int) -> _FPoint:
    t = (bound - a[axis]) / (b[axis] - a[axis])
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


__all__ = [
    "DeviceFinding",
    "DeviceTypeSpec",
    "PlannedDevice",
    "PlannedRoom",
    "Severity",
    "area_inside_rect",
    "device_findings",
    "device_problems",
    "point_in_polygon",
    "rect_inside_polygon",
    "segment_enters_open_box",
]
