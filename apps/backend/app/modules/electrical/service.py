"""Geschaeftslogik des Raummodells: Raeume, Waende, Oeffnungen.

Drei Regeln bestimmen den Aufbau dieser Datei:

1. **Der Raum ist die Klammer.** Jede Aenderung an der Kontur - Wand anlegen,
   aendern, loeschen, umordnen, Oeffnung pflegen - sperrt zuerst die Raumzeile
   (``SELECT ... FOR UPDATE``). Ohne diese Sperre koennten zwei gleichzeitige
   Anfragen jede fuer sich gueltig sein und gemeinsam eine ungueltige Kontur
   erzeugen: Beide lesen dieselben Waende, beide pruefen gegen diesen Stand,
   beide schreiben. Die Sperre macht daraus eine Reihenfolge.
2. **Geometrie wird berechnet, nicht gespeichert.** Flaeche, Umfang,
   Wandlaenge und Konturzustand kommen aus
   :mod:`app.modules.electrical.geometry` (ADR 0013).
3. **Der Core wird nicht nachgebaut.** Mandantenfilter, ``If-Match`` und der
   Schreibschutz archivierter Projekte kommen aus dem Core; dieses Modul ruft
   sie auf und formuliert sie nicht neu.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, nulls_last, select
from sqlalchemy.orm import Session

from app.core.persistence import flush, unique_violation_translated
from app.core.preconditions import check_version
from app.core.projects.planning import FloorPlanningAccess, FloorPlanningContext
from app.core.tenancy.repository import TenantRepository
from app.db.mixins import utcnow
from app.errors import (
    ConflictError,
    NotFoundError,
    ProblemFieldError,
    ValidationFailedError,
)
from app.modules.electrical import geometry
from app.modules.electrical.geometry import (
    ContourReport,
    GeometryProblem,
    OpeningKind,
    OpeningSpan,
    Point,
    Segment,
)
from app.modules.electrical.models import (
    ROOM_NUMBER_CONSTRAINT,
    ElectricalOpening,
    ElectricalRoom,
    ElectricalWall,
)
from app.modules.electrical.schemas import (
    OpeningCreate,
    OpeningUpdate,
    RoomCreate,
    RoomUpdate,
    WallCreate,
    WallUpdate,
)

#: Nachkommastellen der Flaeche in Quadratmetern (ADR 0005: Mengen als String).
AREA_SCALE = 3
#: Eine Raumkontur mit mehr Waenden als das ist ein Erfassungsfehler. Die
#: Lagepruefung ist quadratisch; die Grenze haelt sie berechenbar.
MAX_WALLS_PER_ROOM = 200
#: Mehr Oeffnungen in einer Wand sind ebenfalls kein Grundriss mehr.
MAX_OPENINGS_PER_WALL = 50


class RoomRepository(TenantRepository[ElectricalRoom]):
    model = ElectricalRoom


class WallRepository(TenantRepository[ElectricalWall]):
    model = ElectricalWall


class OpeningRepository(TenantRepository[ElectricalOpening]):
    model = ElectricalOpening


@dataclass(frozen=True, slots=True)
class RoomView:
    """Ein Raum mit allem, was die Oberflaeche ueber ihn wissen muss.

    Der berechnete Teil steht neben dem gespeicherten, statt ihn zu ersetzen -
    so bleibt sichtbar, was Zustand und was Ableitung ist.
    """

    room: ElectricalRoom
    effective_height_mm: int
    contour: ContourReport


@dataclass(frozen=True, slots=True)
class WallDetail:
    """Eine Wand mit der Zahl ihrer Oeffnungen.

    Die Zahl kommt aus **einer** Sammelabfrage je Liste; einzeln nachgeladen
    waere sie ein N+1-Problem.
    """

    wall: ElectricalWall
    opening_count: int


@dataclass(frozen=True, slots=True)
class WriteResult:
    """Was ein Endpunkt nach einer Aenderung fuer das Event braucht.

    Der Service liefert es mit, damit die API-Schicht nicht selbst nach
    Geschoss, Projekt oder Raum suchen muss - sie hat kein Repository
    (docs/architecture.md, Abschnitt 6).
    """

    context: FloorPlanningContext
    room_id: uuid.UUID


def area_m2(area_mm2: int | None) -> str | None:
    """Flaeche in Quadratmetern als Dezimalstring mit drei Nachkommastellen.

    ``1 m^2 = 1_000_000 mm^2``. Gerechnet wird mit :class:`~decimal.Decimal`,
    nie mit ``float`` (ADR 0005).
    """
    if area_mm2 is None:
        return None
    value = (Decimal(area_mm2) / Decimal(1_000_000)).quantize(Decimal(1).scaleb(-AREA_SCALE))
    return str(value)


def _problem_fields(problems: Sequence[GeometryProblem]) -> list[ProblemFieldError]:
    """Bildet Geometriefehler auf die ``errors``-Liste von RFC 9457 ab."""
    return [
        ProblemFieldError(field="geometry", code=problem.code, message=problem.message)
        for problem in problems
    ]


def _raise_geometry(problems: list[GeometryProblem], *, detail: str) -> None:
    """Meldet Geometriefehler als ``422`` mit Einzelbegruendungen."""
    if problems:
        raise ValidationFailedError(detail, errors=_problem_fields(problems))


class ElectricalRoomService:
    """Raeume, Waende und Oeffnungen eines Mandanten."""

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self.session = session
        self.organization_id = organization_id
        self.rooms = RoomRepository(session, organization_id)
        self.walls = WallRepository(session, organization_id)
        self.openings = OpeningRepository(session, organization_id)
        #: Der einzige Weg zu Geschoss, Projekt und Archivregel des Core.
        self.structure = FloorPlanningAccess(session, organization_id)

    # ------------------------------------------------------------------ Lesen

    def list_rooms(self, floor_id: uuid.UUID) -> list[RoomView]:
        """Raeume eines Geschosses - nach Raumnummer, dann Name, dann ID.

        Die ID als letzter Schluessel macht die Reihenfolge auch bei gleichen
        Namen stabil; ohne sie waere die Liste nicht reproduzierbar.
        """
        context = self.structure.context(floor_id)
        stmt = (
            self.rooms.query()
            .where(ElectricalRoom.floor_id == floor_id)
            .order_by(
                nulls_last(ElectricalRoom.room_number.asc()),
                ElectricalRoom.name.asc(),
                ElectricalRoom.id.asc(),
            )
        )
        rooms = list(self.session.execute(stmt).scalars().all())
        return [self._view(room, context) for room in rooms]

    def get_room(self, room_id: uuid.UUID) -> RoomView:
        room = self.rooms.get_or_404(room_id)
        return self._view(room, self.structure.context(room.floor_id))

    def contour(self, room_id: uuid.UUID) -> ContourReport:
        """Pruefbericht zur Raumkontur - reine Auskunft, ohne Nebenwirkung."""
        room = self.rooms.get_or_404(room_id)
        return geometry.contour_report(self._segments(room.id))

    def list_walls(self, room_id: uuid.UUID) -> list[WallDetail]:
        """Waende eines Raums in Konturreihenfolge, je mit Oeffnungszahl."""
        room = self.rooms.get_or_404(room_id)
        return self._details(self._ordered_walls(room.id))

    def list_openings(self, wall_id: uuid.UUID) -> list[ElectricalOpening]:
        """Oeffnungen einer Wand, vom Wandanfang aus."""
        wall = self.walls.get_or_404(wall_id)
        stmt = (
            self.openings.query()
            .where(ElectricalOpening.wall_id == wall.id)
            .order_by(ElectricalOpening.offset_mm.asc(), ElectricalOpening.id.asc())
        )
        return list(self.session.execute(stmt).scalars().all())

    # ------------------------------------------------------------------ Raeume

    def create_room(self, floor_id: uuid.UUID, payload: RoomCreate) -> tuple[RoomView, WriteResult]:
        context = self.structure.writable_context(floor_id)
        # Die Identitaet entsteht vor dem Schreiben - ein Datensatz hat seine
        # endgueltige ID, bevor die Datenbank ihn gesehen hat (ADR 0007).
        room = ElectricalRoom(
            id=uuid.uuid4(),
            organization_id=self.organization_id,
            floor_id=floor_id,
            **payload.model_dump(),
        )
        self.rooms.add(room)
        self._flush_room(payload.room_number)
        return self._view(room, context), WriteResult(context=context, room_id=room.id)

    def update_room(
        self, room_id: uuid.UUID, payload: RoomUpdate, *, expected_version: int
    ) -> tuple[RoomView, WriteResult]:
        """Aendert Name, Raumnummer oder Raumhoehe.

        Auch dieser Vorgang sperrt die Raumzeile, obwohl er die Kontur nicht
        anfasst: Die **Raumhoehe** geht in die Pruefung jeder Oeffnung ein. Ohne
        Sperre koennte eine gleichzeitige Oeffnung gegen die alte Hoehe geprueft
        werden, waehrend dieser Vorgang gegen die noch leere Oeffnungsliste
        prueft - und am Ende waere die Oeffnung hoeher als der Raum.
        """
        room, context = self._locked_room(room_id)
        check_version(room, expected_version)
        changes = payload.model_dump(exclude_unset=True)
        for field, value in changes.items():
            setattr(room, field, value)
        self._flush_room(room.room_number)
        view = self._view(room, context)
        self._require_openings_still_fit(room_id, room_height_mm=view.effective_height_mm)
        return view, WriteResult(context=context, room_id=room.id)

    def delete_room(self, room_id: uuid.UUID, *, expected_version: int) -> WriteResult:
        """Loescht einen Raum **samt Waenden und Oeffnungen**.

        Ein Raum ist Struktur, kein Geschaeftsdokument - wie Gebaeude und
        Geschoss wird er hart geloescht (docs/database.md, Abschnitt 1). Die
        Kaskade ist gewollt und dokumentiert: Eine Wand ohne Raum hat keine
        Bedeutung, und eine Oeffnung ohne Wand erst recht nicht.

        Die Raumzeile wird auch hier gesperrt: Sie ist die Klammer um jede
        Konturaenderung, und ein Loeschen mitten in einer fremden Wandaenderung
        waere eine davon.
        """
        room, context = self._locked_room(room_id)
        check_version(room, expected_version)
        self.session.delete(room)
        flush(self.session)
        return WriteResult(context=context, room_id=room_id)

    # ------------------------------------------------------------------ Waende

    def create_wall(
        self, room_id: uuid.UUID, payload: WallCreate
    ) -> tuple[WallDetail, WriteResult]:
        """Haengt eine Wand hinten an die Kontur.

        Die Reihenfolge vergibt der Server (letzte Position + 1). Damit kann
        eine Anfrage keine Luecke und keine Dublette erzeugen - und der Client
        muss die Reihenfolge nicht kennen.
        """
        room, context = self._locked_room(room_id)
        existing = self._ordered_walls(room.id)
        if len(existing) >= MAX_WALLS_PER_ROOM:
            raise ValidationFailedError(
                f"Ein Raum kann hoechstens {MAX_WALLS_PER_ROOM} Waende haben."
            )
        wall = ElectricalWall(
            id=uuid.uuid4(),
            organization_id=self.organization_id,
            room_id=room.id,
            sort_order=existing[-1].sort_order + 1 if existing else 0,
            **payload.model_dump(),
        )
        self.walls.add(wall)
        _raise_geometry(
            geometry.draft_problems([*(_segment(item) for item in existing), _segment(wall)]),
            detail="Die Wand passt nicht zu den bereits erfassten Waenden dieses Raums.",
        )
        flush(self.session)
        return (
            WallDetail(wall=wall, opening_count=0),
            WriteResult(context=context, room_id=room.id),
        )

    def update_wall(
        self, wall_id: uuid.UUID, payload: WallUpdate, *, expected_version: int
    ) -> tuple[WallDetail, WriteResult]:
        """Aendert eine Wand und prueft die Folgen fuer ihre Oeffnungen.

        Wird eine Wand kuerzer, koennte eine vorhandene Oeffnung ausserhalb
        liegen. Das darf nicht stillschweigend passieren: Die Aenderung wird
        mit ``422`` abgelehnt und nennt die betroffene Oeffnung. Wer die Wand
        wirklich kuerzen will, passt zuerst die Oeffnung an.
        """
        wall = self.walls.get_or_404(wall_id)
        room, context = self._locked_room(wall.room_id)
        check_version(wall, expected_version)
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(wall, field, value)

        walls = [item if item.id != wall.id else wall for item in self._ordered_walls(room.id)]
        _raise_geometry(
            geometry.draft_problems([_segment(item) for item in walls]),
            detail="Die geaenderte Wand passt nicht zur Kontur dieses Raums.",
        )
        openings = self._require_wall_openings_fit(wall)
        flush(self.session)
        return (
            WallDetail(wall=wall, opening_count=len(openings)),
            WriteResult(context=context, room_id=room.id),
        )

    def reorder_walls(
        self, room_id: uuid.UUID, wall_ids: list[uuid.UUID], *, expected_version: int
    ) -> tuple[list[WallDetail], WriteResult]:
        """Setzt die Konturreihenfolge neu.

        Erwartet wird eine vollstaendige Permutation der Waende dieses Raums.
        Die Version des **Raums** ist die Vorbedingung: Umordnen aendert die
        Kontur als Ganzes, nicht eine einzelne Wand.
        """
        room, context = self._locked_room(room_id)
        check_version(room, expected_version)
        walls = {wall.id: wall for wall in self._ordered_walls(room.id)}

        if len(set(wall_ids)) != len(wall_ids):
            raise ValidationFailedError("Die Reihenfolge enthaelt eine Wand mehrfach.")
        if set(wall_ids) != set(walls):
            raise ValidationFailedError(
                "Die Reihenfolge muss genau die Waende dieses Raums enthalten - "
                f"erwartet {len(walls)}, uebergeben {len(wall_ids)}."
            )

        ordered = [walls[wall_id] for wall_id in wall_ids]
        for position, wall in enumerate(ordered):
            wall.sort_order = position
        _raise_geometry(
            geometry.draft_problems([_segment(wall) for wall in ordered]),
            detail="In dieser Reihenfolge ergeben die Waende keine gueltige Kontur.",
        )
        # Der Raum traegt die Reihenfolge: Seine Version zaehlt weiter, damit
        # ein zweiter Client den Wechsel ueber ``If-Match`` bemerkt. Das
        # Aendern von ``updated_at`` macht die Zeile fuer SQLAlchemy schmutzig,
        # und ``version_id_col`` erhoeht die Version beim UPDATE.
        room.updated_at = utcnow()
        flush(self.session)
        return self._details(ordered), WriteResult(context=context, room_id=room.id)

    def delete_wall(self, wall_id: uuid.UUID, *, expected_version: int) -> WriteResult:
        """Loescht eine Wand - **nur**, wenn sie keine Oeffnung mehr traegt.

        Bewusst kein Kaskadenloeschen an dieser Stelle: Eine Tuer verschwindet
        nicht als Nebenwirkung. Wer die Wand entfernen will, entfernt zuerst
        ihre Oeffnungen. Verschwindet dagegen der ganze Raum, gehen Waende und
        Oeffnungen mit ihm (siehe :meth:`delete_room`).

        Die Luecke in der Reihenfolge wird geschlossen: Die verbleibenden
        Waende werden neu durchnummeriert, damit ``sort_order`` lueckenlos
        bleibt.
        """
        wall = self.walls.get_or_404(wall_id)
        room, context = self._locked_room(wall.room_id)
        check_version(wall, expected_version)

        count = self._opening_counts([wall.id]).get(wall.id, 0)
        if count:
            raise ConflictError(
                f"Diese Wand traegt noch {count} Oeffnung(en). Bitte zuerst die Oeffnungen "
                "entfernen."
            )

        self.session.delete(wall)
        self.session.flush()
        for position, remaining in enumerate(self._ordered_walls(room.id)):
            remaining.sort_order = position
        flush(self.session)
        return WriteResult(context=context, room_id=room.id)

    # -------------------------------------------------------------- Oeffnungen

    def create_opening(
        self, wall_id: uuid.UUID, payload: OpeningCreate
    ) -> tuple[ElectricalOpening, WriteResult]:
        """Legt eine Oeffnung in der Wand an."""
        wall = self.walls.get_or_404(wall_id)
        room, context = self._locked_room(wall.room_id)
        existing = self.list_openings(wall.id)
        if len(existing) >= MAX_OPENINGS_PER_WALL:
            raise ValidationFailedError(
                f"Eine Wand kann hoechstens {MAX_OPENINGS_PER_WALL} Oeffnungen haben."
            )
        opening = ElectricalOpening(
            id=uuid.uuid4(),
            organization_id=self.organization_id,
            wall_id=wall.id,
            **payload.model_dump(),
        )
        self.openings.add(opening)
        self._check_opening(
            opening,
            wall=wall,
            room_height_mm=self._effective_height(room, context),
            others=existing,
        )
        flush(self.session)
        return opening, WriteResult(context=context, room_id=room.id)

    def update_opening(
        self, opening_id: uuid.UUID, payload: OpeningUpdate, *, expected_version: int
    ) -> tuple[ElectricalOpening, WriteResult]:
        """Aendert eine Oeffnung und prueft sie neu."""
        opening = self.openings.get_or_404(opening_id)
        wall = self.walls.get_or_404(opening.wall_id)
        room, context = self._locked_room(wall.room_id)
        check_version(opening, expected_version)
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(opening, field, value)
        others = [item for item in self.list_openings(wall.id) if item.id != opening.id]
        self._check_opening(
            opening,
            wall=wall,
            room_height_mm=self._effective_height(room, context),
            others=others,
        )
        flush(self.session)
        return opening, WriteResult(context=context, room_id=room.id)

    def delete_opening(self, opening_id: uuid.UUID, *, expected_version: int) -> WriteResult:
        """Entfernt eine Oeffnung endgueltig."""
        opening = self.openings.get_or_404(opening_id)
        wall = self.walls.get_or_404(opening.wall_id)
        room, context = self._locked_room(wall.room_id)
        check_version(opening, expected_version)
        self.session.delete(opening)
        flush(self.session)
        return WriteResult(context=context, room_id=room.id)

    # ---------------------------------------------------------------- Helfer

    def _locked_room(self, room_id: uuid.UUID) -> tuple[ElectricalRoom, FloorPlanningContext]:
        """Sperrt **erst das Projekt, dann den Raum** - in dieser Reihenfolge.

        Drei Schritte, und die Reihenfolge ist der Punkt:

        1. Den Raum mandantensicher **aufloesen**, noch ohne Sperre. Er liefert
           nur das Geschoss; ein fremder oder unbekannter Raum liefert ``404``.
        2. Ueber den oeffentlichen Core-Zugang die **Projektzeile sperren** und
           den Schreibschutz pruefen. Danach kann das Projekt bis zum Ende
           dieser Transaktion nicht mehr archiviert werden - und ein zeitgleich
           gestarteter Archivierungsvorgang, der zuerst dran war, ist hier
           schon sichtbar (``409 project-archived``).
        3. Erst jetzt die **Raumzeile sperren**, damit zwei Konturaenderungen
           desselben Raums sich nicht gegenseitig ueberholen.

        Die umgekehrte Reihenfolge (Raum, dann Projekt) war die Luecke: Sie
        liest das Projekt ungesperrt und kann danach unter einem inzwischen
        archivierten Projekt committen. Da alle uebrigen Wege ebenfalls
        Projekt -> Unterressource sperren, kann kein Deadlock entstehen.

        ``populate_existing`` haelt ausdruecklich fest, dass der gesperrte Stand
        auch gelesen werden muss - eine sperrende Abfrage ersetzt geladene
        Attribute in SQLAlchemy ohnehin, aber die Zusage soll im Code stehen.
        """
        # 1. Aufloesen ohne Sperre: liefert das Geschoss.
        floor_id = self.rooms.get_or_404(room_id).floor_id

        # 2. Projekt sperren und Schreibschutz pruefen (Core-Contract).
        context = self.structure.writable_context(floor_id)

        # 3. Raumzeile sperren.
        room = self.session.execute(
            select(ElectricalRoom)
            .where(
                ElectricalRoom.organization_id == self.organization_id,
                ElectricalRoom.id == room_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if room is None:
            # Fremder Mandant und unbekannte ID liefern dieselbe Antwort.
            raise NotFoundError("Der Raum wurde nicht gefunden.")
        if room.floor_id != floor_id:
            # Kann nach heutigem Modell nicht auftreten: Ein Raum wechselt das
            # Geschoss nicht (``RoomUpdate`` kennt ``floor_id`` nicht). Die
            # Pruefung haelt die Annahme fest, statt sie vorauszusetzen.
            raise ConflictError(
                "Die Geschosszuordnung dieses Raums hat sich zwischenzeitlich geaendert. "
                "Bitte neu laden und die Aenderung wiederholen."
            )
        return room, context

    def _ordered_walls(self, room_id: uuid.UUID) -> list[ElectricalWall]:
        stmt = (
            self.walls.query()
            .where(ElectricalWall.room_id == room_id)
            .order_by(ElectricalWall.sort_order.asc(), ElectricalWall.id.asc())
        )
        return list(self.session.execute(stmt).scalars().all())

    def _details(self, walls: list[ElectricalWall]) -> list[WallDetail]:
        """Ergaenzt eine Wandliste um die Oeffnungszahl - mit einer Abfrage."""
        counts = self._opening_counts([wall.id for wall in walls])
        return [WallDetail(wall=wall, opening_count=counts.get(wall.id, 0)) for wall in walls]

    def _segments(self, room_id: uuid.UUID) -> list[Segment]:
        return [_segment(wall) for wall in self._ordered_walls(room_id)]

    def _opening_counts(self, wall_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
        """Oeffnungen je Wand in **einer** Abfrage - kein N+1."""
        if not wall_ids:
            return {}
        stmt = (
            select(ElectricalOpening.wall_id, func.count())
            .where(
                ElectricalOpening.organization_id == self.organization_id,
                ElectricalOpening.wall_id.in_(wall_ids),
            )
            .group_by(ElectricalOpening.wall_id)
        )
        return {wall_id: int(count) for wall_id, count in self.session.execute(stmt).all()}

    def _effective_height(self, room: ElectricalRoom, context: FloorPlanningContext) -> int:
        """Raumhoehe: eigene Angabe, sonst Standardhoehe des Geschosses."""
        return room.height_mm if room.height_mm is not None else context.default_ceiling_height_mm

    def _view(self, room: ElectricalRoom, context: FloorPlanningContext) -> RoomView:
        return RoomView(
            room=room,
            effective_height_mm=self._effective_height(room, context),
            contour=geometry.contour_report(self._segments(room.id)),
        )

    def _check_opening(
        self,
        opening: ElectricalOpening,
        *,
        wall: ElectricalWall,
        room_height_mm: int,
        others: list[ElectricalOpening],
    ) -> None:
        problems = geometry.opening_problems(
            opening=_span(opening),
            wall_length_mm=_segment(wall).length_mm,
            others=[_span(item) for item in others],
        )
        problems.extend(
            geometry.opening_height_problems(
                key=str(opening.id),
                kind=OpeningKind(opening.kind),
                height_mm=opening.height_mm,
                sill_height_mm=opening.sill_height_mm,
                room_height_mm=room_height_mm,
            )
        )
        _raise_geometry(problems, detail="Die Oeffnung passt nicht in diese Wand.")

    def _require_wall_openings_fit(self, wall: ElectricalWall) -> list[ElectricalOpening]:
        """Alle Oeffnungen einer geaenderten Wand muessen weiter hineinpassen."""
        openings = self.list_openings(wall.id)
        length = _segment(wall).length_mm
        problems: list[GeometryProblem] = []
        for opening in openings:
            problems.extend(
                geometry.opening_problems(
                    opening=_span(opening),
                    wall_length_mm=length,
                    others=[_span(item) for item in openings],
                )
            )
        _raise_geometry(
            problems,
            detail=(
                "Durch diese Aenderung wuerde eine vorhandene Oeffnung ausserhalb der Wand "
                "liegen. Bitte zuerst die Oeffnung anpassen."
            ),
        )
        return openings

    def _require_openings_still_fit(self, room_id: uuid.UUID, *, room_height_mm: int) -> None:
        """Nach einer Hoehenaenderung: passen die Oeffnungen noch in den Raum?"""
        walls = self._ordered_walls(room_id)
        problems: list[GeometryProblem] = []
        for wall in walls:
            for opening in self.list_openings(wall.id):
                problems.extend(
                    geometry.opening_height_problems(
                        key=str(opening.id),
                        kind=OpeningKind(opening.kind),
                        height_mm=opening.height_mm,
                        sill_height_mm=opening.sill_height_mm,
                        room_height_mm=room_height_mm,
                    )
                )
        _raise_geometry(
            problems,
            detail=(
                "Mit dieser Raumhoehe waere eine vorhandene Oeffnung hoeher als der Raum. "
                "Bitte zuerst die Oeffnung anpassen."
            ),
        )

    def _flush_room(self, room_number: str | None) -> None:
        """Schreibt einen Raum und faengt die doppelte Raumnummer ab.

        Zwei gleichzeitige Anfragen mit derselben Raumnummer bestehen jede
        Vorpruefung; erst der partielle eindeutige Index verhindert das
        Duplikat. Der Verlierer erhaelt dieselbe Meldung wie im sequenziellen
        Fall (``422``) - und keinen ``500``. Uebersetzt wird ausschliesslich
        diese **eine** erwartete Constraint.
        """
        with unique_violation_translated(
            self.session,
            constraint=ROOM_NUMBER_CONSTRAINT,
            error=ValidationFailedError(
                f"Die Raumnummer {room_number!r} ist auf diesem Geschoss bereits vergeben."
            ),
        ):
            flush(self.session)


def _segment(wall: ElectricalWall) -> Segment:
    """Wandzeile als reines Geometrieobjekt."""
    return Segment(
        key=str(wall.id),
        start=Point(x_mm=wall.x1_mm, y_mm=wall.y1_mm),
        end=Point(x_mm=wall.x2_mm, y_mm=wall.y2_mm),
    )


def _span(opening: ElectricalOpening) -> OpeningSpan:
    """Oeffnungszeile als Abschnitt auf der Wand."""
    return OpeningSpan(key=str(opening.id), offset_mm=opening.offset_mm, width_mm=opening.width_mm)
