"""Exakte Wandtopologie eines Geschosses - die Teilmenge, die die Geraetepruefung braucht.

Phase 5 (ADR 0023). Dieselbe Ableitung wie im Frontend
(``apps/planner/src/modules/electrical/topologie/``): Waende verschiedener
Raeume, die **exakt** auf derselben Geraden liegen, werden an allen
Wandendpunkten in atomare Abschnitte zerlegt. Daraus folgt fuer eine Wand

* welche Stuecke sie mit einem anderen Raum teilt (``gemeinsam``) und
* welche Oeffnungen ein Nachbarraum auf ihren gemeinsamen Stuecken
  gespeichert hat (abgeleitete Oeffnungen, ADR 0016 "eine Oeffnung als
  Quelle").

Der Server braucht das, damit ein Geraet nicht in eine Tuer gesetzt wird, die
der Nachbarraum gespeichert hat, und damit eine Aussenmontage nicht auf einem
geteilten Wandstueck landet. Es entsteht **keine** persistente physische
Wandidentitaet (T10 bleibt offen) - alles hier ist eine reine, wiederholbare
Ableitung aus den gespeicherten Waenden.

**Exakt, ohne Toleranz.** Eine Lage entlang einer Wand hat die Form
``whole + steps * sqrt(m)`` (``m`` = Quadrat des kleinsten Gitterschritts der
Geraden). Wandenden gelten - wie ueberall (ADR 0013) - als ``0`` bzw. als die
kaufmaennisch gerundete Wandlaenge; innere Abschnittsgrenzen sind exakte
Gitterlagen. Verglichen wird ueber Quadrate. Die Konvention ist absichtlich
dieselbe wie im Frontend; die gemeinsame Fixture
``testdata/geometry/geraete.v1.json`` haelt beide Seiten gleich.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from itertools import pairwise
from math import gcd, isqrt

from app.modules.electrical.geometry import Point, segment_length_mm

# ------------------------------------------------------------------ Lagen


@dataclass(frozen=True, slots=True)
class LineMeasure:
    """Schrittlaenge einer Geraden: ``sqrt(m)``, ganzzahlig (``root``) oder irrational."""

    m: int
    root: int | None


@dataclass(frozen=True, slots=True)
class Position:
    """Exakte Lage ``whole + steps * sqrt(m)`` in Millimetern ab Wandanfang."""

    whole: int
    steps: int = 0


def line_measure(m: int) -> LineMeasure:
    root = isqrt(m)
    return LineMeasure(m=m, root=root if root * root == m else None)


def position(whole: int, steps: int, measure: LineMeasure) -> Position:
    """Normalisiert: Ist ``sqrt(m)`` ganz, wandert der Stufenanteil in ``whole``."""
    if measure.root is not None:
        return Position(whole + steps * measure.root, 0)
    return Position(whole, steps)


def _sign(value: int) -> int:
    return (value > 0) - (value < 0)


def _sign_of(d: int, e: int, m: int) -> int:
    """Vorzeichen von ``d + e * sqrt(m)`` - exakt."""
    if e == 0:
        return _sign(d)
    if d == 0:
        return _sign(e)
    if _sign(d) == _sign(e):
        return _sign(d)
    left = d * d
    right = e * e * m
    if left == right:
        return 0
    if d > 0:
        return 1 if left > right else -1
    return 1 if right > left else -1


def compare(a: Position, b: Position, measure: LineMeasure) -> int:
    """``-1``, ``0`` oder ``1`` - wie ``a - b``."""
    return _sign_of(a.whole - b.whole, a.steps - b.steps, measure.m)


def _plus(a: Position, b: Position, measure: LineMeasure) -> Position:
    return position(a.whole + b.whole, a.steps + b.steps, measure)


def _minus(a: Position, b: Position, measure: LineMeasure) -> Position:
    return position(a.whole - b.whole, a.steps - b.steps, measure)


@dataclass(frozen=True, slots=True)
class Span:
    """Bereich ``[start, end]`` entlang einer Wand, exakt."""

    start: Position
    end: Position


def spans_overlap(a: Span, b: Span, measure: LineMeasure) -> bool:
    """Echte Ueberdeckung positiver Laenge - Beruehrung an der Kante zaehlt nicht."""
    return compare(a.start, b.end, measure) < 0 and compare(b.start, a.end, measure) < 0


def whole_span(start_mm: int, end_mm: int) -> Span:
    return Span(Position(start_mm), Position(end_mm))


# ------------------------------------------------------------------ Eingabe


@dataclass(frozen=True, slots=True)
class TopoOpening:
    """Gespeicherte Oeffnung an ihrer Wand - Abstand ab Wandanfang."""

    id: str
    offset_mm: int
    width_mm: int
    sill_height_mm: int
    height_mm: int


@dataclass(frozen=True, slots=True)
class TopoWall:
    """Gespeicherte, gerichtete Wand eines Raums."""

    id: str
    room_id: str
    start: Point
    end: Point
    openings: tuple[TopoOpening, ...] = ()


# ------------------------------------------------------------------ Ergebnis


@dataclass(frozen=True, slots=True)
class SectionSource:
    """Bereich eines Abschnitts auf einer seiner Quellwaende, ab deren Anfang."""

    wall: TopoWall
    reversed: bool
    start: Position
    end: Position


@dataclass(frozen=True, slots=True)
class Section:
    """Atomarer Abschnitt einer Geraden mit seinen ueberdeckenden Waenden."""

    room_ids: tuple[str, ...]
    sources: tuple[SectionSource, ...]

    @property
    def shared(self) -> bool:
        return len(self.room_ids) >= 2


@dataclass(frozen=True, slots=True)
class ForeignOpening:
    """Oeffnung einer anderen Wand, uebertragen auf die betrachtete Wand."""

    opening: TopoOpening
    room_id: str
    wall_id: str
    span: Span


@dataclass(frozen=True, slots=True)
class WallPartition:
    """Eine Wand, geteilt an allen inneren Abschnittsgrenzen - in Wandrichtung."""

    wall: TopoWall
    length_mm: int
    measure: LineMeasure
    #: Grenzen ab Wandanfang, aufsteigend: 0, innere Grenzen, Wandlaenge.
    boundaries: tuple[Position, ...]
    #: ``sections[i]`` liegt zwischen ``boundaries[i]`` und ``boundaries[i + 1]``.
    sections: tuple[Section, ...] = field(default=())

    def section_spans(self) -> Iterable[tuple[Span, Section]]:
        for index, section in enumerate(self.sections):
            yield Span(self.boundaries[index], self.boundaries[index + 1]), section


# ------------------------------------------------------------------ Zerlegung


@dataclass(frozen=True, slots=True)
class _Entry:
    wall: TopoWall
    k_start: int
    k_end: int
    length_mm: int


def _line_key(start: Point, end: Point) -> tuple[int, int, int] | None:
    """Gekuerzte kanonische Richtung und ganzzahliger Geradenabstand - exakt."""
    dx = end.x_mm - start.x_mm
    dy = end.y_mm - start.y_mm
    if dx == 0 and dy == 0:
        return None
    divisor = gcd(dx, dy)
    dx //= divisor
    dy //= divisor
    if dx < 0 or (dx == 0 and dy < 0):
        dx, dy = -dx, -dy
    return dx, dy, dy * start.x_mm - dx * start.y_mm


def partition(walls: Sequence[TopoWall]) -> dict[str, WallPartition]:
    """Teilung je Wand-ID fuer die Waende **eines** Geschosses.

    Rein und deterministisch; dieselbe Wand-ID zaehlt nur einmal, Waende ohne
    Laenge fehlen im Ergebnis.
    """
    lines: dict[tuple[int, int, int], list[TopoWall]] = {}
    seen: set[str] = set()
    for wall in walls:
        if wall.id in seen:
            continue
        seen.add(wall.id)
        key = _line_key(wall.start, wall.end)
        if key is None:
            continue
        lines.setdefault(key, []).append(wall)

    result: dict[str, WallPartition] = {}
    for key in sorted(lines):
        for item in _split_line(key[0], key[1], lines[key]):
            result[item.wall.id] = item
    return result


def _split_line(dx: int, dy: int, walls: list[TopoWall]) -> list[WallPartition]:
    measure = line_measure(dx * dx + dy * dy)

    def t(point: Point) -> int:
        return dx * point.x_mm + dy * point.y_mm

    t_min = min(t(p) for wall in walls for p in (wall.start, wall.end))

    def k(point: Point) -> int:
        # Zwei Gitterpunkte derselben Geraden unterscheiden sich um ein
        # ganzzahliges Vielfaches von (dx, dy) - die Division ist exakt.
        return (t(point) - t_min) // measure.m

    entries = [
        _Entry(wall, k(wall.start), k(wall.end), segment_length_mm(wall.start, wall.end))
        for wall in sorted(walls, key=lambda item: item.id)
    ]
    boundaries = sorted({value for e in entries for value in (e.k_start, e.k_end)})

    intervals: list[tuple[int, int, Section]] = []
    for ka, kb in pairwise(boundaries):
        covering = [
            e for e in entries if min(e.k_start, e.k_end) <= ka and max(e.k_start, e.k_end) >= kb
        ]
        if not covering:
            continue
        section = Section(
            room_ids=tuple(sorted({e.wall.room_id for e in covering})),
            sources=tuple(_source(e, ka, kb, measure) for e in covering),
        )
        intervals.append((ka, kb, section))

    partitions: list[WallPartition] = []
    for e in entries:
        forward = e.k_start < e.k_end
        own = [
            (ka, kb, section)
            for ka, kb, section in intervals
            if any(source.wall.id == e.wall.id for source in section.sources)
        ]
        own.sort(key=lambda item: item[0] if forward else -item[0])
        inner = [
            position(0, abs((ka if forward else kb) - e.k_start), measure) for ka, kb, _ in own[1:]
        ]
        partitions.append(
            WallPartition(
                wall=e.wall,
                length_mm=e.length_mm,
                measure=measure,
                boundaries=(Position(0), *inner, Position(e.length_mm)),
                sections=tuple(section for _, _, section in own),
            )
        )
    return partitions


def _source(e: _Entry, ka: int, kb: int, measure: LineMeasure) -> SectionSource:
    reversed_ = e.k_start > e.k_end

    def at(k_point: int) -> Position:
        # Wandenden gelten als 0 bzw. gerundete Wandlaenge (ADR 0013).
        if k_point == e.k_start:
            return Position(0)
        if k_point == e.k_end:
            return Position(e.length_mm)
        return position(0, abs(k_point - e.k_start), measure)

    if reversed_:
        return SectionSource(e.wall, True, at(kb), at(ka))
    return SectionSource(e.wall, False, at(ka), at(kb))


def _local(source: SectionSource, offset_mm: int, width_mm: int, measure: LineMeasure) -> Span:
    """Bereich der Quellwand in der kanonischen Richtung des Abschnitts."""
    a = Position(offset_mm)
    b = Position(offset_mm + width_mm)
    if source.reversed:
        return Span(_minus(source.end, b, measure), _minus(source.end, a, measure))
    return Span(_minus(a, source.start, measure), _minus(b, source.start, measure))


def _back(source: SectionSource, local: Span, measure: LineMeasure) -> Span:
    """Umkehrung: ein Bereich des Abschnitts auf der Quellwand, ab deren Anfang."""
    if source.reversed:
        return Span(
            _minus(source.end, local.end, measure), _minus(source.end, local.start, measure)
        )
    return Span(_plus(local.start, source.start, measure), _plus(local.end, source.start, measure))


def foreign_openings(item: WallPartition) -> list[ForeignOpening]:
    """Oeffnungen, die andere Waende auf den gemeinsamen Abschnitten dieser Wand tragen."""
    found: dict[str, ForeignOpening] = {}
    for section in item.sections:
        own = next((s for s in section.sources if s.wall.id == item.wall.id), None)
        if own is None:
            continue
        for source in section.sources:
            if source.wall.id == item.wall.id:
                continue
            on_section = Span(Position(0), _minus(source.end, source.start, item.measure))
            for opening in source.wall.openings:
                if opening.id in found:
                    continue
                local = _local(source, opening.offset_mm, opening.width_mm, item.measure)
                if not spans_overlap(local, on_section, item.measure):
                    continue
                found[opening.id] = ForeignOpening(
                    opening=opening,
                    room_id=source.wall.room_id,
                    wall_id=source.wall.id,
                    span=_back(own, local, item.measure),
                )
    return list(found.values())
