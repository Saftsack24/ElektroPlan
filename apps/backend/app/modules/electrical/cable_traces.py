"""Trassen aus Leitungswegen - reine Ableitung (Phase 6b.2, ADR 0026, Entwurf §5.4).

Exakt aufeinanderliegende Teilstrecken **auf derselben Planungsflaeche** bilden
eine Trasse; nichts davon wird gespeichert. Planungsflaechen:

* Wand - je Raumwand getrennt nach waagerechten Strecken (gleiche Hoehe) und
  senkrechten Strecken (gleiche Lage); die beiden Seiten einer gemeinsamen
  Wand sind zwei Raumwaende und damit zwei Flaechen,
* Decke und Fussboden - je Raum und Gerade; gleicher Grundriss in Decke und
  Fussboden ergibt **zwei** Trassen,
* Steigweg - je Abschnitt (genutzt ab der niedrigsten Einstiegshoehe),
* Schachtfortsetzung - je Halt.

Trassenmeter zaehlen einmal (Vereinigung), Leitungsmeter je Leitung und
Durchlauf. Rundung: Jede zusammenhaengende Trasse und jedes Belegungsstueck
wird **einmal** gerundet (schraege Decken-/Fussbodenstrecken, irrationale
Gegenlagen); die Summe gerundeter Stuecke kann deshalb um wenige Millimeter von
der gerundeten Trassenlaenge abweichen - dokumentiert, keine Korrektur.

Gezaehlt wird, was die Aufrufer uebergeben: nur gueltige Teilstrecken stehen in
den Ergebnissen von :func:`~app.modules.electrical.cable_length.analyse_cable`.
Spiegel im Frontend: ``leitung/trassen.ts``.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from functools import cmp_to_key
from itertools import pairwise
from math import gcd

from app.modules.electrical.cable_length import (
    CEILING,
    FLOOR,
    RISER,
    SHAFT,
    WALL,
    AreaRun,
    CableResult,
    RiserRun,
    WallRun,
    rounded_position,
)
from app.modules.electrical.geometry import rounded_sqrt
from app.modules.electrical.topology import LineMeasure, Position, compare, position


def _difference(a: Position, b: Position, measure: LineMeasure) -> Position:
    return position(a.whole - b.whole, a.steps - b.steps, measure)


@dataclass(frozen=True, slots=True)
class TracePiece:
    """Teil einer Trasse mit gleicher Belegung."""

    length_mm: int
    cable_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Trace:
    """Exakt aufeinanderliegende Wege auf derselben Planungsflaeche - nie gespeichert."""

    surface: str
    owner_id: str
    #: ``horizontal``/``vertical`` (Wand), ``straight`` (Decke, Fussboden), ``riser``, ``shaft``.
    direction: str
    #: Trassenmeter (einmal) - bei unbestaetigtem Steigweg nur der bekannte Teil.
    length_mm: int
    complete: bool
    #: Leitungsmeter auf dieser Trasse (je Leitung und Durchlauf).
    cable_mm: int
    cable_ids: tuple[str, ...]
    pieces: tuple[TracePiece, ...]


@dataclass(frozen=True, slots=True)
class TraceSummary:
    traces: tuple[Trace, ...]
    #: Trassenmeter je Flaeche (``wall``, ``ceiling``, ``floor``, ``riser``, ``shaft``).
    trace_mm: dict[str, int]
    #: Leitungsmeter je Flaeche.
    cable_mm: dict[str, int]
    #: Genutzte Durchfuehrungen - je einmal gezaehlt.
    penetration_ids: tuple[str, ...]
    #: Bodenuebergaenge - je Leitung gezaehlt (kein gemeinsames Bauteil).
    opening_crossings: int


@dataclass(frozen=True, slots=True)
class _Interval[C]:
    low: C
    high: C
    cable_id: str
    length_mm: int


def _linear[C](
    surface: str,
    owner_id: str,
    direction: str,
    items: Sequence[_Interval[C]],
    cmp: Callable[[C, C], int],
    length: Callable[[C, C], int],
) -> list[Trace]:
    """Zusammenhaengende Trassen einer Linie mit Belegung - jede Strecke einmal gerundet."""
    items = [item for item in items if cmp(item.low, item.high) != 0]
    if not items:
        return []
    points: list[C] = []
    for value in sorted((v for item in items for v in (item.low, item.high)), key=cmp_to_key(cmp)):
        if not points or cmp(points[-1], value) != 0:
            points.append(value)
    traces: list[Trace] = []
    component: list[tuple[C, C, tuple[str, ...]]] = []

    def close() -> None:
        if not component:
            return
        low = component[0][0]
        high = component[-1][1]
        members = [item for item in items if cmp(low, item.low) <= 0 and cmp(item.high, high) <= 0]
        merged: list[tuple[C, C, tuple[str, ...]]] = []
        for a, b, ids in component:
            if merged and merged[-1][2] == ids:
                merged[-1] = (merged[-1][0], b, ids)
            else:
                merged.append((a, b, ids))
        pieces = [TracePiece(length(a, b), ids) for a, b, ids in merged]
        traces.append(
            Trace(
                surface=surface,
                owner_id=owner_id,
                direction=direction,
                length_mm=length(low, high),
                complete=True,
                cable_mm=sum(item.length_mm for item in members),
                cable_ids=tuple(sorted({item.cable_id for item in members})),
                pieces=tuple(pieces),
            )
        )
        component.clear()

    for a, b in pairwise(points):
        ids = tuple(
            sorted(
                {
                    item.cable_id
                    for item in items
                    if cmp(item.low, a) <= 0 and cmp(b, item.high) <= 0
                }
            )
        )
        if not ids:
            close()
            continue
        component.append((a, b, ids))
    close()
    return traces


def _ordered[C](a: C, b: C, cmp: Callable[[C, C], int]) -> tuple[C, C]:
    return (a, b) if cmp(a, b) <= 0 else (b, a)


def _int_cmp(a: int, b: int) -> int:
    return (a > b) - (a < b)


def _area_line(run: AreaRun) -> tuple[tuple[int, int, int], int, int, int] | None:
    """Gerade (gekuerzte kanonische Richtung, Abstand), Masszahl ``m`` und Parameter der Enden."""
    dx = run.end.x_mm - run.start.x_mm
    dy = run.end.y_mm - run.start.y_mm
    if dx == 0 and dy == 0:
        return None
    divisor = gcd(dx, dy)
    dx //= divisor
    dy //= divisor
    if dx < 0 or (dx == 0 and dy < 0):
        dx, dy = -dx, -dy
    key = (dx, dy, dy * run.start.x_mm - dx * run.start.y_mm)
    m = dx * dx + dy * dy
    return (
        key,
        m,
        dx * run.start.x_mm + dy * run.start.y_mm,
        dx * run.end.x_mm + dy * run.end.y_mm,
    )


def derive_traces(results: Iterable[CableResult]) -> TraceSummary:
    """Trassen aller gueltigen Teilstrecken - Trassenmeter einmal, Leitungsmeter je Leitung.

    Wand, Decke und Fussboden sind getrennte Flaechen: Eine Fussboden- und eine
    Deckenstrecke mit gleichem Grundriss sind zwei Trassen; die beiden Seiten
    einer gemeinsamen Wand ebenfalls (zwei Raumwaende).
    """
    horizontal: dict[tuple[str, int], tuple[LineMeasure, list[_Interval[Position]]]] = {}
    vertical: dict[tuple[str, int, int], list[_Interval[int]]] = {}
    areas: dict[tuple[str, str, tuple[int, int, int]], tuple[int, list[_Interval[int]]]] = {}
    risers: dict[tuple[str, int], list[tuple[str, RiserRun]]] = {}
    shafts: dict[tuple[str, uuid.UUID], list[tuple[str, int]]] = {}
    penetrations: list[str] = []
    crossings = 0
    for result in results:
        crossings += result.opening_crossings
        for pid in result.penetration_ids:
            if pid not in penetrations:
                penetrations.append(pid)
        for segment in result.segments:
            for run in segment.runs:
                cid = result.cable_id
                if isinstance(run, WallRun):
                    measure = run.measure

                    def cmp(a: Position, b: Position, measure: LineMeasure = measure) -> int:
                        return compare(a, b, measure)

                    if run.from_height_mm == run.to_height_mm:
                        low, high = _ordered(run.from_offset, run.to_offset, cmp)
                        bucket = horizontal.setdefault(
                            (run.wall_id, run.from_height_mm), (measure, [])
                        )
                        bucket[1].append(_Interval(low, high, cid, run.length_mm))
                    else:
                        lo_h, hi_h = sorted((run.from_height_mm, run.to_height_mm))
                        vertical.setdefault(
                            (run.wall_id, run.from_offset.whole, run.from_offset.steps), []
                        ).append(_Interval(lo_h, hi_h, cid, run.length_mm))
                elif isinstance(run, AreaRun):
                    line = _area_line(run)
                    if line is None:
                        continue
                    key, m, t0, t1 = line
                    lo_t, hi_t = sorted((t0, t1))
                    areas.setdefault((run.surface, run.room_id, key), (m, []))[1].append(
                        _Interval(lo_t, hi_t, cid, run.length_mm)
                    )
                elif isinstance(run, RiserRun):
                    risers.setdefault((run.riser_id, run.section_index), []).append((cid, run))
                else:
                    shafts.setdefault((run.riser_id, run.stop_id), []).append((cid, run.height_mm))

    traces: list[Trace] = []
    for (wall_id, _height), (measure, intervals) in sorted(
        horizontal.items(), key=lambda kv: kv[0]
    ):

        def wall_cmp(a: Position, b: Position, measure: LineMeasure = measure) -> int:
            return compare(a, b, measure)

        def wall_length(a: Position, b: Position, measure: LineMeasure = measure) -> int:
            return rounded_position(_difference(b, a, measure), measure)

        traces += _linear(WALL, wall_id, "horizontal", intervals, wall_cmp, wall_length)
    for (wall_id, _whole, _steps), ints in sorted(vertical.items(), key=lambda kv: kv[0]):
        traces += _linear(WALL, wall_id, "vertical", ints, _int_cmp, lambda a, b: b - a)
    for (surface, room_id, _key), (m, ints) in sorted(areas.items(), key=lambda kv: kv[0]):

        def area_length(a: int, b: int, m: int = m) -> int:
            k = (b - a) // m
            return rounded_sqrt(k * k * m)

        traces += _linear(surface, room_id, "straight", ints, _int_cmp, area_length)
    for (riser_id, _index), uses in sorted(risers.items(), key=lambda kv: kv[0]):
        sample = uses[0][1]
        lowest = min(run.from_height_mm for _, run in uses)
        full_vertical = (
            None if sample.vertical_mm is None else sample.vertical_mm + sample.from_height_mm
        )
        known = sample.horizontal_mm + (0 if full_vertical is None else full_vertical - lowest)
        traces.append(
            Trace(
                surface=RISER,
                owner_id=riser_id,
                direction="riser",
                length_mm=known,
                complete=full_vertical is not None,
                cable_mm=sum(run.known_mm for _, run in uses),
                cable_ids=tuple(sorted({cid for cid, _ in uses})),
                pieces=(),
            )
        )
    # Je Steigweg in der Reihenfolge des ersten Auftretens (stabil sortiert).
    for (riser_id, _stop), heights in sorted(shafts.items(), key=lambda kv: kv[0][0]):
        traces.append(
            Trace(
                surface=SHAFT,
                owner_id=riser_id,
                direction="shaft",
                length_mm=max(h for _, h in heights),
                complete=True,
                cable_mm=sum(h for _, h in heights),
                cable_ids=tuple(sorted({cid for cid, _ in heights})),
                pieces=(),
            )
        )

    trace_mm = dict.fromkeys((WALL, CEILING, FLOOR, RISER, SHAFT), 0)
    cable_mm = dict(trace_mm)
    for trace in traces:
        trace_mm[trace.surface] += trace.length_mm
        cable_mm[trace.surface] += trace.cable_mm
    return TraceSummary(
        traces=tuple(traces),
        trace_mm=trace_mm,
        cable_mm=cable_mm,
        penetration_ids=tuple(penetrations),
        opening_crossings=crossings,
    )


__all__ = ["Trace", "TracePiece", "TraceSummary", "derive_traces"]
