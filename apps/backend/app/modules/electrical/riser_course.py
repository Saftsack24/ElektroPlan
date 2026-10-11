"""Verlauf und Laenge eines Steigwegs - reine Funktionen (Phase 6a.4, ADR 0025).

Ein Steigweg verbindet Uebergabepunkte (Halte) auf mehreren Geschossen eines
Gebaeudes. Die Halte werden nach ``level`` sortiert; je zwei
aufeinanderfolgende Halte bilden einen **Abschnitt**. Geschosse dazwischen
ohne Halt werden durchquert, bekommen aber keinen Anschluss.

**Verlauf eines Abschnitts** (:func:`riser_course`, Entwurf §2.6) - die
**einzige** Quelle fuer Laenge, 2D- und 3D-Darstellung:

1. senkrecht am **unteren** Uebergabepunkt von der Ebene des unteren
   Fertigfussbodens (FFB) bis zur Ebene des oberen FFB;
2. waagerecht auf der Ebene des **oberen** FFB zum oberen Uebergabepunkt -
   ``orthogonal`` zuerst entlang x, dann entlang y; ``direct`` als **eine**
   waagerechte Gerade (keine diagonale 3D-Luftlinie);
3. Teilstrecken der Laenge 0 entfallen.

**Laenge** = Summe der Teilstrecken. Achsparallele Teile sind exakt
ganzzahlig, die ``direct``-Gerade wird einmal kaufmaennisch gerundet
(ADR 0013, :func:`~app.modules.electrical.geometry.rounded_sqrt`). Jede
Teilstrecke zaehlt genau einmal; der Steigweg endet genau am Halt.

**Verlaesslichkeit** ist von der Geometrie getrennt (Entwurf §4.4):

* ``confirmed`` - beide Hoehenlagen bestaetigt und das hoehere Geschoss liegt
  hoeher; erst dann gibt es eine senkrechte Laenge;
* ``elevation-unconfirmed`` - mindestens eine Hoehenlage ist nicht bestaetigt.
  Der Verlauf nutzt die **gespeicherten** Werte nur als vorlaeufige
  Darstellung; eine senkrechte Laenge gibt es nicht;
* ``elevation-inconsistent`` - beide bestaetigt, aber das hoehere ``level``
  liegt gleich hoch oder tiefer: Konflikt, keine senkrechte Laenge.

Der Plausibilitaetshinweis (Geschossabstand kleiner als die lichte
Standardhoehe des unteren Geschosses) aendert weder Laenge noch Status. Nichts
wird aus ``level`` oder der Standard-Deckenhoehe abgeleitet.

Keine Aussage ueber bauliche Machbarkeit, Brandschutz oder Normen
(docs/security.md, Abschnitt 17): Das ist ein vereinfachter Planungsverlauf.

Das Frontend spiegelt diese Datei (``steigweg/verlauf.ts``); die gemeinsame
Fixture ``testdata/geometry/steigweg.v1.json`` haelt beide gleich.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from itertools import pairwise

from app.modules.electrical.geometry import rounded_sqrt

#: Versatzarten (``models.RISER_OFFSET_MODES``).
OFFSET_ORTHOGONAL = "orthogonal"
OFFSET_DIRECT = "direct"


class SectionStatus(StrEnum):
    CONFIRMED = "confirmed"
    ELEVATION_UNCONFIRMED = "elevation-unconfirmed"
    ELEVATION_INCONSISTENT = "elevation-inconsistent"


class RiserStatus(StrEnum):
    """Gesamtstatus eines Steigwegs."""

    #: Mindestens ein Abschnitt, alle ``confirmed`` - die Summe ist die Laenge.
    CONFIRMED = "confirmed"
    #: Mindestens eine Hoehenlage unbestaetigt - nur eine Teilsumme ist bekannt.
    INCOMPLETE = "incomplete"
    #: Mindestens ein Abschnitt mit widerspruechlicher Hoehenlage.
    CONFLICT = "conflict"
    #: Genau ein Uebergabepunkt - noch kein verbindender Abschnitt.
    SINGLE_STOP = "single-stop"
    #: Noch kein Uebergabepunkt.
    NO_STOPS = "no-stops"


class SectionHint(StrEnum):
    #: Geschossabstand kleiner als die lichte Standardhoehe des unteren Geschosses.
    FLOOR_GAP_BELOW_CEILING_HEIGHT = "floor-gap-below-ceiling-height"


@dataclass(frozen=True, slots=True)
class RiserFloor:
    """Was der Verlauf ueber ein Geschoss braucht (aus ``FloorPlanningContext``)."""

    floor_id: uuid.UUID
    level: int
    elevation_mm: int
    elevation_confirmed: bool
    default_ceiling_height_mm: int


@dataclass(frozen=True, slots=True)
class RiserStopPoint:
    stop_id: uuid.UUID
    floor_id: uuid.UUID
    x_mm: int
    y_mm: int


@dataclass(frozen=True, slots=True)
class CoursePoint:
    x_mm: int
    y_mm: int
    z_mm: int


@dataclass(frozen=True, slots=True)
class RiserSection:
    lower: RiserStopPoint
    upper: RiserStopPoint
    #: Geschosse strikt zwischen den beiden Halten - durchquert, ohne Anschluss.
    traversed_floor_ids: tuple[uuid.UUID, ...]
    status: SectionStatus
    #: Polylinie, ganzzahlige mm, ohne Teilstrecken der Laenge 0.
    course: tuple[CoursePoint, ...]
    #: Nur bei ``confirmed``.
    vertical_mm: int | None
    #: Waagerechter Versatz auf der Ebene des oberen FFB - immer bekannt.
    horizontal_mm: int
    #: Nur bei ``confirmed``: senkrecht + waagerecht.
    length_mm: int | None
    hints: tuple[SectionHint, ...]

    @property
    def known_mm(self) -> int:
        """Der bekannte Teil: waagerecht, bei ``confirmed`` zuzueglich senkrecht."""
        return self.horizontal_mm + (self.vertical_mm or 0)


@dataclass(frozen=True, slots=True)
class RiserAnalysis:
    #: Halte nach ``level`` aufsteigend.
    stops: tuple[RiserStopPoint, ...]
    sections: tuple[RiserSection, ...]
    status: RiserStatus
    #: Summe der bekannten Teile - bei ``confirmed`` die vollstaendige Laenge,
    #: sonst ausdruecklich nur eine **Teilsumme**.
    known_length_mm: int
    #: Nur bei ``confirmed``.
    length_mm: int | None


def riser_course(
    lower: RiserStopPoint,
    upper: RiserStopPoint,
    *,
    z_lower_mm: int,
    z_upper_mm: int,
    offset_mode: str,
) -> tuple[CoursePoint, ...]:
    """Der Verlauf eines Abschnitts als 3D-Polylinie (Entwurf §2.6).

    ``z_*`` sind die (gespeicherten) Hoehenlagen der beiden Geschosse. Ob sie
    verlaesslich sind, entscheidet :func:`analyse_riser`, nicht diese Funktion.
    """
    points = [
        CoursePoint(lower.x_mm, lower.y_mm, z_lower_mm),
        CoursePoint(lower.x_mm, lower.y_mm, z_upper_mm),
    ]
    if offset_mode == OFFSET_ORTHOGONAL:
        points.append(CoursePoint(upper.x_mm, lower.y_mm, z_upper_mm))
    points.append(CoursePoint(upper.x_mm, upper.y_mm, z_upper_mm))
    course: list[CoursePoint] = []
    for point in points:
        if not course or course[-1] != point:
            course.append(point)
    return tuple(course)


def horizontal_length_mm(course: Sequence[CoursePoint]) -> int:
    """Laenge der waagerechten Teilstrecken; jede einmal, die schraege gerundet."""
    total = 0
    for start, end in pairwise(course):
        if start.z_mm != end.z_mm:
            continue
        dx = end.x_mm - start.x_mm
        dy = end.y_mm - start.y_mm
        total += abs(dx) + abs(dy) if dx == 0 or dy == 0 else rounded_sqrt(dx * dx + dy * dy)
    return total


def analyse_riser(
    floors: Sequence[RiserFloor],
    stops: Sequence[RiserStopPoint],
    offset_mode: str,
) -> RiserAnalysis:
    """Abschnitte, Status und Laengen eines Steigwegs.

    ``floors`` sind alle Geschosse des Gebaeudes (fuer durchquerte Geschosse);
    jeder Halt muss auf einem davon liegen - das sichert der Service.
    """
    by_id = {floor.floor_id: floor for floor in floors}
    ordered = tuple(sorted(stops, key=lambda stop: (by_id[stop.floor_id].level, stop.stop_id)))
    sections: list[RiserSection] = []
    for lower, upper in pairwise(ordered):
        sections.append(
            _section(
                by_id[lower.floor_id], by_id[upper.floor_id], lower, upper, floors, offset_mode
            )
        )

    known = sum(section.known_mm for section in sections)
    if not ordered:
        status = RiserStatus.NO_STOPS
    elif len(ordered) == 1:
        status = RiserStatus.SINGLE_STOP
    elif any(s.status is SectionStatus.ELEVATION_INCONSISTENT for s in sections):
        status = RiserStatus.CONFLICT
    elif any(s.status is SectionStatus.ELEVATION_UNCONFIRMED for s in sections):
        status = RiserStatus.INCOMPLETE
    else:
        status = RiserStatus.CONFIRMED
    return RiserAnalysis(
        stops=ordered,
        sections=tuple(sections),
        status=status,
        known_length_mm=known,
        length_mm=known if status is RiserStatus.CONFIRMED else None,
    )


def _section(
    lower_floor: RiserFloor,
    upper_floor: RiserFloor,
    lower: RiserStopPoint,
    upper: RiserStopPoint,
    floors: Sequence[RiserFloor],
    offset_mode: str,
) -> RiserSection:
    course = riser_course(
        lower,
        upper,
        z_lower_mm=lower_floor.elevation_mm,
        z_upper_mm=upper_floor.elevation_mm,
        offset_mode=offset_mode,
    )
    rise = upper_floor.elevation_mm - lower_floor.elevation_mm
    if not (lower_floor.elevation_confirmed and upper_floor.elevation_confirmed):
        status = SectionStatus.ELEVATION_UNCONFIRMED
    elif rise <= 0:
        status = SectionStatus.ELEVATION_INCONSISTENT
    else:
        status = SectionStatus.CONFIRMED
    horizontal = horizontal_length_mm(course)
    vertical = rise if status is SectionStatus.CONFIRMED else None
    hints: tuple[SectionHint, ...] = ()
    if status is SectionStatus.CONFIRMED and rise < lower_floor.default_ceiling_height_mm:
        hints = (SectionHint.FLOOR_GAP_BELOW_CEILING_HEIGHT,)
    traversed = tuple(
        floor.floor_id
        for floor in sorted(floors, key=lambda floor: floor.level)
        if lower_floor.level < floor.level < upper_floor.level
    )
    return RiserSection(
        lower=lower,
        upper=upper,
        traversed_floor_ids=traversed,
        status=status,
        course=course,
        vertical_mm=vertical,
        horizontal_mm=horizontal,
        length_mm=None if vertical is None else vertical + horizontal,
        hints=hints,
    )
