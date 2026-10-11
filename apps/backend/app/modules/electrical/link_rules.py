"""Regeln der Wandkopplung - rein, exakt, ohne Datenbank (Phase 6a, ADR 0024).

Eine Wandkopplung speichert nur die Entscheidung (``shared``/``separate``);
alles Geometrische wird aus der Teilung des Geschosses (``topology.partition``)
abgeleitet. Hier stehen drei Auskuenfte, die Service, Planungsstand und
Backfill gleich beantworten muessen:

* **Abdeckung eines Paars** (:func:`pair_coverage`): Auf wie vielen atomaren
  Abschnitten liegen genau diese beiden Waende - und auf wie vielen liegt
  zusaetzlich eine dritte Wand (mehrdeutig)?
* **Status einer gespeicherten Kopplung** (:func:`link_status`): ``active``,
  ``ambiguous`` (teilweise mehrdeutig, dort konservativ) oder ``broken``
  (unterbrochen - kein gemeinsamer Abschnitt mehr, wirkt nirgends).
* **Kandidaten** (:func:`link_candidates`): ungekoppelte, exakt ueberlappende
  Paare verschiedener Raeume mit ihrer Einordnung:

  ==================  ===========================================================
  ``suggested``        eindeutig - Vorschlag ``shared`` (und Backfill)
  ``decision-needed``  koppelbar, aber nur ausdruecklich (abweichende Staerke,
                       offene Kontur, Oeffnungen auf beiden Seiten)
  ``not-linkable``     drei oder mehr Waende auf einem Stueck des Bereichs
  ==================  ===========================================================

``separate`` wird nie vorgeschlagen. Endpunktberuehrung, Versatz, nicht
parallele Waende und andere Geschosse ergeben keinen gemeinsamen Abschnitt und
damit nie einen Kandidaten.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Set
from dataclasses import dataclass
from enum import StrEnum

from app.modules.electrical.topology import (
    LineMeasure,
    Section,
    TopoLink,
    WallPartition,
    local_span,
    pair_key,
    section_span,
    spans_overlap,
)


class LinkStatus(StrEnum):
    """Abgeleiteter Zustand einer gespeicherten Kopplung."""

    ACTIVE = "active"
    #: Auf einem Teil des Bereichs liegt eine dritte Wand - dort konservativ.
    AMBIGUOUS = "ambiguous"
    #: Kein gemeinsamer Abschnitt mehr - die Kopplung wirkt nirgends.
    BROKEN = "broken"


class CandidateKind(StrEnum):
    SUGGESTED = "suggested"
    DECISION_NEEDED = "decision-needed"
    NOT_LINKABLE = "not-linkable"


#: Gruende einer Kandidateneinordnung (stabile Codes, Texte macht die Oberflaeche).
REASON_AMBIGUOUS = "ambiguous"
REASON_THICKNESS = "thickness-differs"
REASON_CONTOUR = "contour-open"
REASON_OPENINGS = "openings-on-both-sides"


@dataclass(frozen=True, slots=True)
class PairCoverage:
    """Abschnitte, die beide Waende eines Paars ueberdecken."""

    sections: int
    #: Davon Abschnitte mit einer weiteren Wand (dritter Raum, doppelte Wand).
    ambiguous: int


@dataclass(frozen=True, slots=True)
class LinkCandidate:
    """Ein ungekoppeltes, exakt ueberlappendes Wandpaar verschiedener Raeume."""

    wall_a_id: str
    wall_b_id: str
    kind: CandidateKind
    reasons: tuple[str, ...]


def _co_covered(partitions: Mapping[str, WallPartition], a: str, b: str) -> list[Section]:
    item = partitions.get(a)
    if item is None or b not in partitions or partitions[b].measure != item.measure:
        return []
    return [
        section
        for section in item.sections
        if any(source.wall.id == b for source in section.sources)
        and any(source.wall.id == a for source in section.sources)
    ]


def pair_coverage(partitions: Mapping[str, WallPartition], a: str, b: str) -> PairCoverage:
    sections = _co_covered(partitions, a, b)
    return PairCoverage(
        sections=len(sections),
        ambiguous=sum(1 for section in sections if len(section.sources) > 2),
    )


def link_status(partitions: Mapping[str, WallPartition], link: TopoLink) -> LinkStatus:
    """``broken`` ohne gemeinsamen Abschnitt; ``ambiguous``, wenn ein Teil mehrdeutig ist."""
    coverage = pair_coverage(partitions, link.wall_a_id, link.wall_b_id)
    if coverage.sections == 0:
        return LinkStatus.BROKEN
    if coverage.ambiguous:
        return LinkStatus.AMBIGUOUS
    return LinkStatus.ACTIVE


def _openings_on_both_sides(
    sections: Iterable[Section], a: str, b: str, measure: LineMeasure
) -> bool:
    """Tragen beide Waende im gemeinsamen Bereich sich ueberlappende Oeffnungen?"""
    for section in sections:
        source_a = next(s for s in section.sources if s.wall.id == a)
        source_b = next(s for s in section.sources if s.wall.id == b)
        whole = section_span(source_a, measure)
        spans_a = [
            local_span(source_a, o.offset_mm, o.width_mm, measure) for o in source_a.wall.openings
        ]
        spans_b = [
            local_span(source_b, o.offset_mm, o.width_mm, measure) for o in source_b.wall.openings
        ]
        for span_a in spans_a:
            if not spans_overlap(span_a, whole, measure):
                continue
            for span_b in spans_b:
                if spans_overlap(span_b, whole, measure) and spans_overlap(span_a, span_b, measure):
                    return True
    return False


def link_candidates(
    partitions: Mapping[str, WallPartition],
    links: Iterable[TopoLink],
    *,
    thickness_mm: Mapping[str, int],
    valid_rooms: Set[str],
) -> list[LinkCandidate]:
    """Alle ungekoppelten Paare mit gemeinsamem Abschnitt - deterministisch sortiert."""
    linked = {link.pair for link in links}
    pairs: dict[tuple[str, str], tuple[str, str]] = {}
    for item in partitions.values():
        for section in item.sections:
            for first in section.sources:
                for second in section.sources:
                    if first.wall.room_id == second.wall.room_id:
                        continue
                    key = pair_key(first.wall.id, second.wall.id)
                    if key in linked:
                        continue
                    rooms = (
                        (first.wall.room_id, second.wall.room_id)
                        if key[0] == first.wall.id
                        else (second.wall.room_id, first.wall.room_id)
                    )
                    pairs[key] = rooms

    candidates: list[LinkCandidate] = []
    for (a, b), (room_a, room_b) in sorted(pairs.items()):
        sections = _co_covered(partitions, a, b)
        if any(len(section.sources) > 2 for section in sections):
            candidates.append(LinkCandidate(a, b, CandidateKind.NOT_LINKABLE, (REASON_AMBIGUOUS,)))
            continue
        reasons: list[str] = []
        if thickness_mm.get(a) != thickness_mm.get(b):
            reasons.append(REASON_THICKNESS)
        if room_a not in valid_rooms or room_b not in valid_rooms:
            reasons.append(REASON_CONTOUR)
        if _openings_on_both_sides(sections, a, b, partitions[a].measure):
            reasons.append(REASON_OPENINGS)
        kind = CandidateKind.DECISION_NEEDED if reasons else CandidateKind.SUGGESTED
        candidates.append(LinkCandidate(a, b, kind, tuple(reasons)))
    return candidates
