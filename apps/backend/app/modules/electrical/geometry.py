"""Ganzzahlige Geometrie der Raumkontur (ADR 0007, ADR 0013).

Diese Datei ist **rein**: keine Datenbank, kein Framework, kein Zustand. Sie
laesst sich damit ohne Infrastruktur pruefen - und der spaetere 2D-Editor kann
dieselben Regeln anwenden, ohne den Service zu kennen.

**Einheiten.** Alle Werte sind ganzzahlige Millimeter. Fliesskomma kommt
nirgends vor, auch nicht als Zwischenschritt: Streckenlaengen werden mit
:func:`math.isqrt` exakt gerundet (siehe :func:`segment_length_mm`), Flaechen
ueber die doppelte Trapezflaeche nach Gauss. Damit ist jedes Ergebnis exakt
reproduzierbar - Tests pruefen Werte, nicht Toleranzen.

**Koordinatensystem.** Geschossbezogen und kartesisch: ``x`` nach rechts,
``y`` in der Draufsicht nach oben, Ursprung ``(0, 0)`` frei waehlbar je
Geschoss (ueblicherweise die linke untere Ecke des Grundrisses). Positiver
Umlaufsinn ist gegen den Uhrzeigersinn. Die Hoehe ``z`` spielt in Phase 3
keine Rolle; sie kommt mit den Leitungswegen (ADR 0010).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from math import isqrt

# --------------------------------------------------------------- Grenzwerte

#: Zulaessiger Koordinatenbereich: 1 km in jede Richtung. Groessere Werte sind
#: bei einem geschossbezogenen Grundriss ein Eingabefehler, kein Gebaeude.
MIN_COORDINATE_MM = -1_000_000
MAX_COORDINATE_MM = 1_000_000
#: Wandstaerke: 20 mm (Trockenbauschale) bis 1000 mm (Bruchsteinmauerwerk).
MIN_WALL_THICKNESS_MM = 20
MAX_WALL_THICKNESS_MM = 1_000
#: Uebliche Staerke einer Innenwand - nur ein Startwert, keine Vorgabe.
DEFAULT_WALL_THICKNESS_MM = 115
#: Wandlaenge: unter 100 mm ist kein Wandsegment, ueber 100 m kein Raum.
MIN_WALL_LENGTH_MM = 100
MAX_WALL_LENGTH_MM = 100_000
#: Raumhoehe wie in docs/modules/electrical.md festgelegt.
MIN_ROOM_HEIGHT_MM = 1_500
MAX_ROOM_HEIGHT_MM = 6_000
#: Oeffnungen: kleiner als 100 mm ist keine Tuer und kein Fenster.
MIN_OPENING_SIZE_MM = 100
MAX_OPENING_SIZE_MM = 20_000
#: Eine geschlossene Kontur braucht mindestens drei Segmente.
MIN_CONTOUR_WALLS = 3


class ContourStatus(StrEnum):
    """Zustand der Raumkontur - **abgeleitet**, nicht gespeichert.

    ``draft``  Die Wandsegmente ergeben noch keine geschlossene, einfache
               Kontur. Das ist der normale Zwischenstand beim Erfassen.
    ``valid``  Die Segmente bilden einen geschlossenen, ueberschneidungsfreien
               Polygonzug mit einer Flaeche groesser Null.
    """

    DRAFT = "draft"
    VALID = "valid"


class OpeningKind(StrEnum):
    """Oeffnungsart. Tuer, Fenster und Durchgang teilen die Geometrie."""

    DOOR = "door"
    WINDOW = "window"
    PASSAGE = "passage"


OPENING_KINDS: tuple[str, ...] = tuple(kind.value for kind in OpeningKind)


# ------------------------------------------------------------------ Bausteine


@dataclass(frozen=True, slots=True)
class Point:
    """Punkt in der Geschossebene, ganzzahlige Millimeter."""

    x_mm: int
    y_mm: int


@dataclass(frozen=True, slots=True)
class Segment:
    """Gerichtetes Wandsegment mit stabiler Reihenfolge.

    ``key`` traegt die Identitaet aus Sicht des Aufrufers (die Wand-UUID als
    Zeichenkette). Die Geometrie selbst kennt keine Datenbank.
    """

    key: str
    start: Point
    end: Point

    @property
    def is_degenerate(self) -> bool:
        return self.start == self.end

    @property
    def length_mm(self) -> int:
        return segment_length_mm(self.start, self.end)

    @property
    def unordered_endpoints(self) -> frozenset[tuple[int, int]]:
        """Endpunkte ohne Richtung - fuer die Dublettenpruefung."""
        return frozenset({(self.start.x_mm, self.start.y_mm), (self.end.x_mm, self.end.y_mm)})


@dataclass(frozen=True, slots=True)
class GeometryProblem:
    """Ein benannter Geometriefehler.

    ``code`` ist stabil und maschinenlesbar, ``message`` ist die deutsche
    Meldung fuer die Oberflaeche (ADR 0008). ``keys`` nennt die betroffenen
    Wandsegmente, damit die Oberflaeche sie hervorheben kann.
    """

    code: str
    message: str
    keys: tuple[str, ...] = ()


# --------------------------------------------------------------- Streckenlaenge


def rounded_sqrt(value: int) -> int:
    """Kaufmaennisch gerundete Quadratwurzel einer nicht negativen Ganzzahl.

    Rein ganzzahlig: ``round(sqrt(n))`` entspricht ``(isqrt(4n) + 1) // 2``.
    Damit gibt es keinen Fliesskommaschritt und kein plattformabhaengiges
    Ergebnis. Ein exakter Halbwert kann nicht auftreten, weil
    ``(k - 1/2)^2 = k^2 - k + 1/4`` fuer ganzzahlige ``k`` nie ganzzahlig ist -
    die Rundungsregel ist deshalb eindeutig.
    """
    if value < 0:
        msg = "Eine Quadratwurzel wird nur fuer nicht negative Werte gebildet."
        raise ValueError(msg)
    return (isqrt(4 * value) + 1) // 2


def segment_length_mm(start: Point, end: Point) -> int:
    """Laenge eines Segments in ganzen Millimetern.

    **Verbindliche Rundungsregel** (ADR 0013): Die Laenge wird aus dem
    ganzzahligen Quadrat der Katheten gebildet und kaufmaennisch auf ganze
    Millimeter gerundet. Backend, Tests und spaeterer Editor verwenden
    dieselbe Funktion; Vergleiche - etwa "liegt die Oeffnung in der Wand?" -
    laufen ausschliesslich gegen diesen gerundeten Wert.
    """
    dx = end.x_mm - start.x_mm
    dy = end.y_mm - start.y_mm
    return rounded_sqrt(dx * dx + dy * dy)


# ------------------------------------------------------- Lage zweier Segmente


def _orientation(a: Point, b: Point, c: Point) -> int:
    """Drehsinn von ``a -> b -> c``: 1 links, -1 rechts, 0 kollinear."""
    value = (b.x_mm - a.x_mm) * (c.y_mm - a.y_mm) - (b.y_mm - a.y_mm) * (c.x_mm - a.x_mm)
    if value > 0:
        return 1
    if value < 0:
        return -1
    return 0


def _on_segment(point: Point, start: Point, end: Point) -> bool:
    """Liegt ein **kollinearer** Punkt innerhalb der Strecke (inklusive Enden)?"""
    within_x = min(start.x_mm, end.x_mm) <= point.x_mm <= max(start.x_mm, end.x_mm)
    within_y = min(start.y_mm, end.y_mm) <= point.y_mm <= max(start.y_mm, end.y_mm)
    return within_x and within_y


def segments_intersect(first: Segment, second: Segment) -> bool:
    """Haben zwei Segmente irgendeinen gemeinsamen Punkt?

    Beruehrung in einem Endpunkt und kollineare Ueberdeckung gelten
    ausdruecklich als Schnitt. Fuer benachbarte Wandsegmente einer Kontur ist
    der gemeinsame Endpunkt erwuenscht - diesen Fall behandelt
    :func:`_adjacent_is_clean` getrennt.
    """
    o1 = _orientation(first.start, first.end, second.start)
    o2 = _orientation(first.start, first.end, second.end)
    o3 = _orientation(second.start, second.end, first.start)
    o4 = _orientation(second.start, second.end, first.end)

    if o1 != o2 and o3 != o4:
        return True
    return (
        (o1 == 0 and _on_segment(second.start, first.start, first.end))
        or (o2 == 0 and _on_segment(second.end, first.start, first.end))
        or (o3 == 0 and _on_segment(first.start, second.start, second.end))
        or (o4 == 0 and _on_segment(first.end, second.start, second.end))
    )


def _adjacent_is_clean(first: Segment, second: Segment) -> bool:
    """Pruefung zweier Segmente mit gemeinsamem Punkt (``first.end == second.start``).

    Erlaubt ist der Knick in jede Richtung und die gerade Fortsetzung
    (kollinear vorwaerts; ein ueberzaehliger Punkt in der Kontur schadet
    nicht). Verboten ist das Zuruecklaufen auf das eigene Segment: Dabei
    liegen zwei Wandsegmente uebereinander, und die Kontur ist nicht mehr
    einfach.
    """
    if _orientation(first.start, first.end, second.end) != 0:
        return True
    forward = (first.end.x_mm - first.start.x_mm) * (second.end.x_mm - second.start.x_mm) + (
        first.end.y_mm - first.start.y_mm
    ) * (second.end.y_mm - second.start.y_mm)
    return forward > 0


# ------------------------------------------------------------------- Flaeche


def doubled_area_mm2(points: list[Point]) -> int:
    """Doppelte orientierte Flaeche (Trapezformel nach Gauss), exakt ganzzahlig.

    Das Vorzeichen gibt den Umlaufsinn an: positiv gegen den Uhrzeigersinn.
    Verdoppelt, damit innerhalb der Summe kein Halbierungsschritt und damit
    kein Rundungsfehler entsteht.
    """
    total = 0
    count = len(points)
    for index in range(count):
        current = points[index]
        following = points[(index + 1) % count]
        total += current.x_mm * following.y_mm - following.x_mm * current.y_mm
    return total


def polygon_area_mm2(points: list[Point]) -> int:
    """Flaeche in ganzen Quadratmillimetern, kaufmaennisch gerundet.

    Die halbe doppelte Flaeche kann genau auf einem halben Quadratmillimeter
    liegen (etwa bei einem Dreieck mit ungerader doppelter Flaeche). Gerundet
    wird deshalb einmal am Ende, aufwaerts bei genau einem halben
    Quadratmillimeter.
    """
    return (abs(doubled_area_mm2(points)) + 1) // 2


def perimeter_mm(segments: list[Segment]) -> int:
    """Umfang als Summe der **gerundeten** Segmentlaengen.

    Bewusst die Summe der gerundeten Einzellaengen und nicht die Rundung der
    Summe: Ein Editor zeigt die Einzellaengen an, und beide Werte muessen
    zusammenpassen.
    """
    return sum(segment.length_mm for segment in segments)


# ------------------------------------------------------------ Konturpruefung


def segment_problems(segment: Segment) -> list[GeometryProblem]:
    """Prueft ein Segment fuer sich - ohne Bezug zu den Nachbarn."""
    problems: list[GeometryProblem] = []
    if segment.is_degenerate:
        problems.append(
            GeometryProblem(
                code="wall-degenerate",
                message="Start- und Endpunkt der Wand sind identisch.",
                keys=(segment.key,),
            )
        )
        return problems

    for point in (segment.start, segment.end):
        if not (MIN_COORDINATE_MM <= point.x_mm <= MAX_COORDINATE_MM) or not (
            MIN_COORDINATE_MM <= point.y_mm <= MAX_COORDINATE_MM
        ):
            problems.append(
                GeometryProblem(
                    code="coordinate-out-of-range",
                    message=(
                        "Die Koordinaten liegen ausserhalb des zulaessigen Bereichs von "
                        f"{MIN_COORDINATE_MM} bis {MAX_COORDINATE_MM} mm."
                    ),
                    keys=(segment.key,),
                )
            )
            break

    length = segment.length_mm
    if length < MIN_WALL_LENGTH_MM or length > MAX_WALL_LENGTH_MM:
        problems.append(
            GeometryProblem(
                code="wall-length-implausible",
                message=(
                    f"Die Wand ist {length} mm lang; zulaessig sind "
                    f"{MIN_WALL_LENGTH_MM} bis {MAX_WALL_LENGTH_MM} mm."
                ),
                keys=(segment.key,),
            )
        )
    return problems


def _adjacency(segments: list[Segment]) -> set[tuple[int, int]]:
    """Indexpaare, die als Nachbarn einen Endpunkt teilen **duerfen**.

    Nachbarn sind die in der Reihenfolge aufeinander folgenden Segmente - und
    **zyklisch** auch das letzte mit dem ersten. Ohne das Paar ``(0, n-1)``
    wuerde die schliessende Wand eines Rechtecks abgelehnt, weil sie die erste
    beruehrt.

    Die Nachbarschaft ist eine Erlaubnis, kein Freibrief: Teilen zwei Nachbarn
    ihren Endpunkt **nicht** in Konturrichtung, greift die volle
    Schnittpruefung wieder (siehe :func:`_pair_problems`).
    """
    pairs = {(index, index + 1) for index in range(len(segments) - 1)}
    if len(segments) >= MIN_CONTOUR_WALLS:
        pairs.add((0, len(segments) - 1))
    return pairs


def _crossing(first: Segment, second: Segment) -> GeometryProblem:
    return GeometryProblem(
        code="walls-intersect",
        message="Zwei Waende dieses Raums ueberschneiden oder beruehren sich.",
        keys=(first.key, second.key),
    )


def _pair_problems(
    first: Segment, second: Segment, *, are_neighbours: bool
) -> list[GeometryProblem]:
    """Bewertet die Lage zweier Segmente zueinander."""
    if are_neighbours:
        ordered: tuple[Segment, Segment] | None = None
        if first.end == second.start:
            ordered = (first, second)
        elif second.end == first.start:
            ordered = (second, first)
        if ordered is None:
            # Nachbarn, die sich nicht beruehren: im Entwurf erlaubt; nur die
            # Ueberschneidung bleibt verboten. Die fehlende Verbindung meldet
            # die Konturpruefung.
            return [_crossing(first, second)] if segments_intersect(first, second) else []
        if not _adjacent_is_clean(*ordered):
            return [
                GeometryProblem(
                    code="wall-backtracks",
                    message="Zwei aufeinander folgende Waende laufen uebereinander zurueck.",
                    keys=(first.key, second.key),
                )
            ]
        return []
    return [_crossing(first, second)] if segments_intersect(first, second) else []


def draft_problems(segments: list[Segment]) -> list[GeometryProblem]:
    """Regeln, die **jeder** Zwischenstand erfuellen muss.

    Bewusst ohne die Forderung nach einer geschlossenen Kontur: Waende
    entstehen einzeln, und ein Raum mit zwei erfassten Waenden ist kein
    Fehler, sondern ein Entwurf (ADR 0013).

    Geprueft wird:

    * jedes Segment fuer sich (nicht entartet, Bereich, Laenge),
    * keine Dublette - dieselbe Strecke zweimal, in beliebiger Richtung,
    * keine Ueberschneidung zweier Segmente. Benachbarte Segmente duerfen
      ihren gemeinsamen Endpunkt teilen, sonst nichts. Nicht benachbarte
      Segmente duerfen sich nicht einmal beruehren - ein solcher Punkt waere
      eine Einschnuerung, und die Kontur waere nicht mehr einfach.
    """
    problems: list[GeometryProblem] = []
    for segment in segments:
        problems.extend(segment_problems(segment))
    if problems:
        # Ohne gueltige Einzelsegmente ist die Lagepruefung wertlos.
        return problems

    seen: dict[frozenset[tuple[int, int]], str] = {}
    for segment in segments:
        endpoints = segment.unordered_endpoints
        previous = seen.get(endpoints)
        if previous is not None:
            problems.append(
                GeometryProblem(
                    code="wall-duplicate",
                    message="Zwei Waende dieses Raums verlaufen zwischen denselben Punkten.",
                    keys=(previous, segment.key),
                )
            )
        else:
            seen[endpoints] = segment.key

    neighbours = _adjacency(segments)
    for first_index in range(len(segments)):
        for second_index in range(first_index + 1, len(segments)):
            problems.extend(
                _pair_problems(
                    segments[first_index],
                    segments[second_index],
                    are_neighbours=(first_index, second_index) in neighbours,
                )
            )
    return problems


def closed_contour_problems(segments: list[Segment]) -> list[GeometryProblem]:
    """Zusatzregeln fuer eine **abgeschlossene** Raumkontur.

    Sie werden fuer den Konturbericht ausgewertet, nicht bei jedem
    Schreibvorgang - siehe :func:`draft_problems`.
    """
    problems: list[GeometryProblem] = []
    if len(segments) < MIN_CONTOUR_WALLS:
        problems.append(
            GeometryProblem(
                code="contour-too-few-walls",
                message=(
                    f"Eine geschlossene Raumkontur braucht mindestens {MIN_CONTOUR_WALLS} "
                    f"Waende; erfasst sind {len(segments)}."
                ),
            )
        )
        return problems

    for index in range(len(segments) - 1):
        current = segments[index]
        following = segments[index + 1]
        if current.end != following.start:
            problems.append(
                GeometryProblem(
                    code="contour-gap",
                    message=(f"Wand {index + 1} endet nicht dort, wo Wand {index + 2} beginnt."),
                    keys=(current.key, following.key),
                )
            )

    if segments[-1].end != segments[0].start:
        problems.append(
            GeometryProblem(
                code="contour-not-closed",
                message="Die letzte Wand endet nicht am Anfang der ersten Wand.",
                keys=(segments[-1].key, segments[0].key),
            )
        )

    if not problems and doubled_area_mm2([segment.start for segment in segments]) == 0:
        problems.append(
            GeometryProblem(
                code="contour-without-area",
                message="Die Raumkontur umschliesst keine Flaeche.",
            )
        )
    return problems


@dataclass(frozen=True, slots=True)
class ContourReport:
    """Abgeleiteter Zustand einer Raumkontur.

    Nichts davon wird gespeichert: Flaeche, Umfang und Zustand ergeben sich
    jederzeit aus den Wandsegmenten. Ein zweiter, gespeicherter Wahrheitswert
    koennte veralten (ADR 0013).
    """

    status: ContourStatus
    wall_count: int
    problems: tuple[GeometryProblem, ...]
    area_mm2: int | None
    perimeter_mm: int | None

    @property
    def is_valid(self) -> bool:
        return self.status is ContourStatus.VALID


def contour_report(segments: list[Segment]) -> ContourReport:
    """Bewertet die Wandsegmente eines Raums in ihrer Reihenfolge."""
    problems = [*draft_problems(segments), *closed_contour_problems(segments)]
    if problems:
        return ContourReport(
            status=ContourStatus.DRAFT,
            wall_count=len(segments),
            problems=tuple(problems),
            area_mm2=None,
            perimeter_mm=perimeter_mm(segments) if segments else None,
        )
    return ContourReport(
        status=ContourStatus.VALID,
        wall_count=len(segments),
        problems=(),
        area_mm2=polygon_area_mm2([segment.start for segment in segments]),
        perimeter_mm=perimeter_mm(segments),
    )


# ------------------------------------------------------------------ Oeffnungen


@dataclass(frozen=True, slots=True)
class OpeningSpan:
    """Eine Oeffnung als Abschnitt auf der gerichteten Wand."""

    key: str
    offset_mm: int
    width_mm: int

    @property
    def end_mm(self) -> int:
        return self.offset_mm + self.width_mm


def opening_problems(
    *,
    opening: OpeningSpan,
    wall_length_mm: int,
    others: list[OpeningSpan],
) -> list[GeometryProblem]:
    """Prueft eine Oeffnung gegen ihre Wand und die uebrigen Oeffnungen.

    **Vergleichsregel** (ADR 0013): Verglichen wird gegen die gerundete
    Wandlaenge aus :func:`segment_length_mm`. Eine Oeffnung muss vollstaendig
    innerhalb ``[0, Wandlaenge]`` liegen.

    **Beruehrung an der Kante ist erlaubt.** Zwei Oeffnungen duerfen sich in
    genau einem Punkt beruehren (``[a, b)`` und ``[b, c)``): Zwei Tueren mit
    gemeinsamem Rahmenpfosten sind in der Praxis ueblich. Jede echte
    Ueberdeckung ist ein Fehler.
    """
    problems: list[GeometryProblem] = []
    if opening.width_mm <= 0:
        problems.append(
            GeometryProblem(
                code="opening-width-not-positive",
                message="Die Breite der Oeffnung muss groesser als Null sein.",
                keys=(opening.key,),
            )
        )
    if opening.offset_mm < 0:
        problems.append(
            GeometryProblem(
                code="opening-offset-negative",
                message="Der Abstand vom Wandanfang darf nicht negativ sein.",
                keys=(opening.key,),
            )
        )
    if problems:
        return problems

    if opening.end_mm > wall_length_mm:
        problems.append(
            GeometryProblem(
                code="opening-exceeds-wall",
                message=(
                    f"Die Oeffnung endet bei {opening.end_mm} mm, die Wand ist aber nur "
                    f"{wall_length_mm} mm lang."
                ),
                keys=(opening.key,),
            )
        )

    for other in others:
        if other.key == opening.key:
            continue
        if opening.offset_mm < other.end_mm and other.offset_mm < opening.end_mm:
            problems.append(
                GeometryProblem(
                    code="openings-overlap",
                    message="Die Oeffnung ueberschneidet eine andere Oeffnung derselben Wand.",
                    keys=(opening.key, other.key),
                )
            )
    return problems


def opening_height_problems(
    *,
    key: str,
    kind: OpeningKind,
    height_mm: int,
    sill_height_mm: int,
    room_height_mm: int,
) -> list[GeometryProblem]:
    """Prueft die Hoehenlage einer Oeffnung gegen die Raumhoehe.

    ``sill_height_mm`` ist die Unterkante ueber Fertigfussboden. Fuer Tuer und
    Durchgang ist sie ``0``; ein Fenster verlangt eine Bruestung groesser Null -
    sonst waere es eine Tuer.
    """
    problems: list[GeometryProblem] = []
    if height_mm <= 0:
        problems.append(
            GeometryProblem(
                code="opening-height-not-positive",
                message="Die Hoehe der Oeffnung muss groesser als Null sein.",
                keys=(key,),
            )
        )
    if sill_height_mm < 0:
        problems.append(
            GeometryProblem(
                code="opening-sill-negative",
                message="Die Bruestungshoehe darf nicht negativ sein.",
                keys=(key,),
            )
        )
    if kind is OpeningKind.WINDOW and sill_height_mm <= 0:
        problems.append(
            GeometryProblem(
                code="window-needs-sill",
                message="Ein Fenster braucht eine Bruestungshoehe groesser als Null.",
                keys=(key,),
            )
        )
    if kind is not OpeningKind.WINDOW and sill_height_mm != 0:
        problems.append(
            GeometryProblem(
                code="sill-only-for-window",
                message="Eine Bruestungshoehe gibt es nur beim Fenster.",
                keys=(key,),
            )
        )
    if problems:
        return problems

    if sill_height_mm + height_mm > room_height_mm:
        problems.append(
            GeometryProblem(
                code="opening-exceeds-room-height",
                message=(
                    f"Die Oberkante der Oeffnung liegt bei {sill_height_mm + height_mm} mm, "
                    f"die Raumhoehe betraegt {room_height_mm} mm."
                ),
                keys=(key,),
            )
        )
    return problems
