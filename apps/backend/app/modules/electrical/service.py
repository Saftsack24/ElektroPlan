"""Geschaeftslogik des Raummodells: Raeume, Waende, Oeffnungen.

Drei Regeln bestimmen den Aufbau dieser Datei:

1. **Der Raum ist die Klammer.** Jede Aenderung an der Kontur - Wand anlegen,
   aendern, loeschen, umordnen, Oeffnung pflegen - sperrt zuerst die Raumzeile
   (``SELECT ... FOR UPDATE``). Ohne diese Sperre koennten zwei gleichzeitige
   Anfragen jede fuer sich gueltig sein und gemeinsam eine ungueltige Kontur
   erzeugen: Beide lesen dieselben Waende, beide pruefen gegen diesen Stand,
   beide schreiben. Die Sperre macht daraus eine Reihenfolge.

   Seit Phase 4a ist die **Raumversion die Version der gesamten
   Raumgeometrie** (ADR 0014): Jede wirksame Aenderung an Waenden oder
   Oeffnungen zaehlt sie weiter. Nur so bemerkt der grafische Editor, der die
   Kontur als Ganzes gegen die Raumversion speichert, eine zwischenzeitliche
   Aenderung ueber die Formulare - statt sie zu ueberschreiben.
2. **Geometrie wird berechnet, nicht gespeichert.** Flaeche, Umfang,
   Wandlaenge und Konturzustand kommen aus
   :mod:`app.modules.electrical.geometry` (ADR 0013).
3. **Der Core wird nicht nachgebaut.** Mandantenfilter, ``If-Match`` und der
   Schreibschutz archivierter Projekte kommen aus dem Core; dieses Modul ruft
   sie auf und formuliert sie nicht neu.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, nulls_last, select
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.orm import Session

from app.core.persistence import CONCURRENT_UPDATE_DETAIL, flush, unique_violation_translated
from app.core.preconditions import check_version
from app.core.projects.planning import FloorPlanningAccess, FloorPlanningContext
from app.core.tenancy.repository import TenantRepository
from app.db.mixins import utcnow
from app.errors import (
    ConflictError,
    NotFoundError,
    ProblemFieldError,
    ValidationFailedError,
    VersionConflictError,
)
from app.modules.electrical import geometry
from app.modules.electrical.cable_rules import (
    BuildingCableState,
    CableGuard,
    cables_referencing,
    detach_removed_openings,
    in_use_error,
    preserve_reversed_walls,
    require_devices_free,
    require_links_without_penetrations,
    require_no_split_references,
    require_room_free,
    require_walls_free,
    wall_length,
)
from app.modules.electrical.catalog import (
    ASSIGNABLE_CATEGORIES,
    DISTRIBUTION_BOARD_TYPE,
    WALL_SURFACES,
)
from app.modules.electrical.device_rules import (
    DeviceBaseline,
    FloorDeviceCheck,
    links_of_walls,
    load_device_types,
)
from app.modules.electrical.distribution import boards_placed_on, circuits_of_devices
from app.modules.electrical.geometry import (
    ContourReport,
    GeometryProblem,
    OpeningKind,
    OpeningSpan,
    Point,
    Segment,
)
from app.modules.electrical.link_rules import LinkCandidate
from app.modules.electrical.models import (
    ROOM_NUMBER_CONSTRAINT,
    ElectricalDevice,
    ElectricalDeviceType,
    ElectricalOpening,
    ElectricalRoom,
    ElectricalWall,
    ElectricalWallLink,
)
from app.modules.electrical.schemas import (
    ContourDeviceIn,
    ContourWallIn,
    OpeningCreate,
    OpeningUpdate,
    RoomContourUpdate,
    RoomCreate,
    RoomUpdate,
    WallCreate,
    WallUpdate,
)
from app.modules.electrical.wall_links import WallLinkView, analyse_links, links_touching

#: Nachkommastellen der Flaeche in Quadratmetern (ADR 0005: Mengen als String).
AREA_SCALE = 3
#: Grenzen je Raum und Wand - definiert in ``geometry``, damit auch die
#: Eingabeschemas sie kennen.
MAX_WALLS_PER_ROOM = geometry.MAX_WALLS_PER_ROOM
MAX_OPENINGS_PER_WALL = geometry.MAX_OPENINGS_PER_WALL


class RoomRepository(TenantRepository[ElectricalRoom]):
    model = ElectricalRoom


class WallRepository(TenantRepository[ElectricalWall]):
    model = ElectricalWall


class OpeningRepository(TenantRepository[ElectricalOpening]):
    model = ElectricalOpening


class DeviceRepository(TenantRepository[ElectricalDevice]):
    model = ElectricalDevice


#: Meldung, wenn eine Aenderung ein vorhandenes Geraet unzulaessig machen wuerde.
DEVICE_DETAIL = (
    "Durch diese Aenderung laege ein Geraet unzulaessig (ausserhalb der Wand, in einer "
    "Oeffnung oder ausserhalb des Raums). Es wurde nichts gespeichert; Geraete werden nie "
    "automatisch verschoben."
)


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
class WallPlan:
    """Eine Wand mit ihren Oeffnungen - Baustein des Planungsstands."""

    wall: ElectricalWall
    openings: list[ElectricalOpening]


@dataclass(frozen=True, slots=True)
class RoomPlan:
    """Ein Raum mit Kontur, Waenden, Oeffnungen und Geraeten."""

    view: RoomView
    walls: list[WallPlan]
    devices: list[ElectricalDevice]


@dataclass(frozen=True, slots=True)
class FloorPlan:
    """Vollstaendiger Planungsstand eines Geschosses."""

    context: FloorPlanningContext
    rooms: list[RoomPlan]
    #: Wandkopplungen mit Status und ungekoppelte Kandidaten (Phase 6a).
    wall_links: list[WallLinkView]
    wall_link_candidates: list[LinkCandidate]


@dataclass(frozen=True, slots=True)
class WriteResult:
    """Was ein Endpunkt nach einer Aenderung fuer das Event braucht.

    Der Service liefert es mit, damit die API-Schicht nicht selbst nach
    Geschoss, Projekt oder Raum suchen muss - sie hat kein Repository
    (docs/architecture.md, Abschnitt 6).
    """

    context: FloorPlanningContext
    room_id: uuid.UUID
    #: ``False``: Der Vorgang hat nur Geraete geaendert (Event ``devices_changed``).
    geometry_changed: bool = True


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
    """Bildet Geometriefehler auf die ``errors``-Liste von RFC 9457 ab.

    ``keys`` nennt die betroffenen Waende oder Oeffnungen, damit eine
    Oberflaeche sie am Objekt markieren kann (Phase 4a).
    """
    return [
        ProblemFieldError(
            field="geometry",
            code=problem.code,
            message=problem.message,
            keys=list(problem.keys) or None,
        )
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
        self.devices = DeviceRepository(session, organization_id)
        #: Geraetepruefung ueber das ganze Geschoss (Phase 5, ADR 0023).
        self.device_check = FloorDeviceCheck(session, organization_id)
        #: Der einzige Weg zu Geschoss, Projekt und Archivregel des Core.
        self.structure = FloorPlanningAccess(session, organization_id)
        #: Leitungen und Durchfuehrungen des Gebaeudes vorher/nachher (Phase 6b.3).
        self.cable_guard = CableGuard(session, organization_id)

    # ------------------------------------------------------------------ Lesen

    def list_rooms(self, floor_id: uuid.UUID) -> list[RoomView]:
        """Raeume eines Geschosses - nach Raumnummer, dann Name, dann ID.

        Die ID als letzter Schluessel macht die Reihenfolge auch bei gleichen
        Namen stabil; ohne sie waere die Liste nicht reproduzierbar.
        """
        context = self.structure.context(floor_id)
        return [self._view(room, context) for room in self._rooms_on_floor(floor_id)]

    def floor_plan(self, floor_id: uuid.UUID) -> FloorPlan:
        """Vollstaendiger Planungsstand eines Geschosses - in konstant vielen Abfragen.

        Drei Abfragen fuer den Geschosskontext (Core), je eine fuer Raeume,
        Waende und Oeffnungen - unabhaengig davon, wie viele Raeume es gibt.
        Die Kontur jedes Raums wird aus den bereits geladenen Waenden
        berechnet, nicht je Raum nachgeladen (kein N+1).

        Archivierte Projekte bleiben lesbar: Hier wird nichts gesperrt und
        nichts geprueft ausser der Mandantenzugehoerigkeit.
        """
        context = self.structure.context(floor_id)
        rooms = self._rooms_on_floor(floor_id)
        walls = self._walls_by_room([room.id for room in rooms])
        openings = self._openings_by_wall(
            [wall.id for room_walls in walls.values() for wall in room_walls]
        )
        devices: dict[uuid.UUID, list[ElectricalDevice]] = {}
        for device in self.device_check.devices_of_rooms([room.id for room in rooms]):
            devices.setdefault(device.room_id, []).append(device)
        all_walls = [wall for room_walls in walls.values() for wall in room_walls]
        link_views, candidates = analyse_links(
            rooms,
            all_walls,
            openings,
            links_of_walls(self.session, self.organization_id, [wall.id for wall in all_walls]),
        )
        return FloorPlan(
            context=context,
            rooms=[
                self._room_plan(
                    room, context, walls.get(room.id, []), openings, devices.get(room.id, [])
                )
                for room in rooms
            ],
            wall_links=link_views,
            wall_link_candidates=candidates,
        )

    def list_device_types(self) -> list[ElectricalDeviceType]:
        """Der Systemkatalog - aktive und deaktivierte Typen, in Katalogreihenfolge.

        Deaktivierte Typen bleiben sichtbar, damit vorhandene Geraete benannt
        werden koennen; fuer neue Geraete sind sie gesperrt.
        """
        return list(load_device_types(self.session).values())

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
        baseline = self._device_baseline(context)
        cables_before = self._cables_before(context)
        # Die Identitaet entsteht vor dem Schreiben - ein Datensatz hat seine
        # endgueltige ID, bevor die Datenbank ihn gesehen hat (ADR 0007).
        room = ElectricalRoom(
            id=uuid.uuid4(),
            organization_id=self.organization_id,
            floor_id=floor_id,
            **payload.model_dump(exclude={"walls"}),
        )
        self.rooms.add(room)
        self._flush_room(payload.room_number)
        if payload.walls:
            # Raum und Kontur in **einer** Transaktion (Phase 4a): Scheitert
            # die Kontur, entsteht auch kein leerer Raum.
            self._apply_contour(room, context, payload.walls, removed_opening_ids=[])
            # Ein neuer Raum kann ein Wandstueck eines Nachbarn zu einem geteilten machen.
            self._require_devices_fit(context, baseline)
            # ... und eine Kopplung mehrdeutig machen (Durchfuehrung, Bodenuebergang).
            self.cable_guard.require_unbroken(cables_before)
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
        baseline = self._device_baseline(context)
        cables_before = self._cables_before(context)
        changes = payload.model_dump(exclude_unset=True, exclude={"acknowledged_cable_ids"})
        for field, value in changes.items():
            setattr(room, field, value)
        self._flush_room(room.room_number)
        view = self._view(room, context)
        self._require_openings_still_fit(room_id, room_height_mm=view.effective_height_mm)
        # Wandgeraete muessen unter die neue Decke passen; Deckengeraete folgen ihr.
        self._require_devices_fit(context, baseline)
        # Wegpunkte und Durchfuehrungen ueber einer abgesenkten Decke: 422 (Entwurf §7).
        # Eine angehobene Decke unterbricht Uebergaenge Wand - Decke: nur mit Bestaetigung.
        self.cable_guard.require_unbroken(
            cables_before,
            acknowledged=payload.acknowledged_cable_ids,
            acknowledgement_supported=True,
            hard_codes=frozenset({"waypoint-outside-wall"}),
        )
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
        # Ein Geraet, das eine Verteilung platziert, verschwindet nicht nebenbei
        # (Phase 6b.0, ADR 0026) - sonst hinge die Verteilung ohne Lage.
        room_device_ids = list(
            self.session.execute(
                select(ElectricalDevice.id).where(
                    ElectricalDevice.organization_id == self.organization_id,
                    ElectricalDevice.room_id == room.id,
                )
            ).scalars()
        )
        placements = boards_placed_on(self.session, self.organization_id, room_device_ids)
        if placements:
            raise ConflictError(
                "In diesem Raum liegt die Lage einer Verteilung ("
                + ", ".join(sorted(board.code for board in placements.values()))
                + "). Bitte zuerst die Lage der Verteilung loesen. Es wurde nichts geloescht.",
                errors=[
                    ProblemFieldError(
                        field="room",
                        code="room-has-distribution-board",
                        message="Der Raum enthaelt die Lage einer Verteilung.",
                        keys=[str(board.id) for board in placements.values()],
                    )
                ],
            )
        # Kopplungen verschwinden mit den Waenden (CASCADE). Die Partnerraeume
        # zaehlen ihre Version weiter: Ein dort offener Entwurf soll die
        # Zuordnung nicht als bestehend voraussetzen.
        walls = self._ordered_walls(room.id)
        links = links_touching(self.session, self.organization_id, [wall.id for wall in walls])
        # Leitungen verschwinden nie nebenbei (Phase 6b.3): Wege, Bodenuebergaenge,
        # Endgeraete und Durchfuehrungen halten den Raum.
        require_room_free(
            self.session,
            self.organization_id,
            room_id=room.id,
            wall_ids=[wall.id for wall in walls],
            device_ids=room_device_ids,
            link_ids=[link.id for link in links],
        )
        self._touch_partner_rooms(links, exclude=room.id)
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
        baseline = self._device_baseline(context)
        cables_before = self._cables_before(context)
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
        _touch(room)
        flush(self.session)
        self._require_devices_fit(context, baseline)
        self.cable_guard.require_unbroken(cables_before)
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
        self._reread(wall)
        check_version(wall, expected_version)
        baseline = self._device_baseline(context)
        cables_before = self._cables_before(context)
        old = (wall.x1_mm, wall.y1_mm, wall.x2_mm, wall.y2_mm)
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(wall, field, value)
        if (wall.x1_mm, wall.y1_mm, wall.x2_mm, wall.y2_mm) == (old[2], old[3], old[0], old[1]):
            # Umgekehrte Wand: Leitungsbezuege behalten ihren Ort (L - x).
            preserve_reversed_walls(
                self.session, self.organization_id, {wall.id: wall_length(wall)}
            )

        walls = [item if item.id != wall.id else wall for item in self._ordered_walls(room.id)]
        _raise_geometry(
            geometry.draft_problems([_segment(item) for item in walls]),
            detail="Die geaenderte Wand passt nicht zur Kontur dieses Raums.",
        )
        openings = self._require_wall_openings_fit(wall)
        _touch(room)
        flush(self.session)
        self._require_devices_fit(context, baseline)
        self.cable_guard.require_unbroken(cables_before)
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
        baseline = self._device_baseline(context)
        cables_before = self._cables_before(context)
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
        # ein zweiter Client den Wechsel ueber ``If-Match`` bemerkt.
        _touch(room)
        flush(self.session)
        # Eine andere Reihenfolge kann die Kontur oeffnen - Deckengeraete brauchen sie.
        self._require_devices_fit(context, baseline)
        self.cable_guard.require_unbroken(cables_before)
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
        self._reread(wall)
        check_version(wall, expected_version)

        count = self._opening_counts([wall.id]).get(wall.id, 0)
        if count:
            raise ConflictError(
                f"Diese Wand traegt noch {count} Oeffnung(en). Bitte zuerst die Oeffnungen "
                "entfernen."
            )
        devices = self._device_count_on_wall(wall.id)
        if devices:
            raise ConflictError(
                f"An dieser Wand sind noch {devices} Geraet(e) montiert. Bitte zuerst die Geraete "
                "entfernen."
            )
        require_walls_free(self.session, self.organization_id, [wall.id])
        links = links_touching(self.session, self.organization_id, [wall.id])
        if links:
            raise _wall_has_links([wall.id], links)
        baseline = self._device_baseline(context)
        cables_before = self._cables_before(context)

        self.session.delete(wall)
        self.session.flush()
        for position, remaining in enumerate(self._ordered_walls(room.id)):
            remaining.sort_order = position
        _touch(room)
        flush(self.session)
        self._require_devices_fit(context, baseline)
        self.cable_guard.require_unbroken(cables_before)
        return WriteResult(context=context, room_id=room.id)

    # ------------------------------------------------ Kontur als Ganzes (4a)

    def replace_contour(
        self, room_id: uuid.UUID, payload: RoomContourUpdate, *, expected_version: int
    ) -> tuple[RoomPlan, WriteResult]:
        """Ersetzt die Raumgeometrie **atomar** durch den uebergebenen Zielzustand.

        Fuer den grafischen Editor: Er aendert Waende und Oeffnungen lokal und
        speichert dann **einen** Stand - nicht viele voneinander unabhaengige
        Anfragen, von denen einzelne scheitern koennten.

        Ablauf, und die Reihenfolge ist Teil der Zusage:

        1. Projekt sperren, dann Raum sperren (:meth:`_locked_room`).
        2. ``If-Match`` gegen die **Raumversion** pruefen. Sie ist die Version
           der gesamten Raumgeometrie; jede Wand- oder Oeffnungsaenderung ueber
           die Einzelendpunkte zaehlt sie ebenfalls weiter.
        3. Den **Zielzustand als Ganzes** pruefen - Kennungen, Oeffnungsregeln,
           Geometrie. Ein technisch erzeugter Zwischenstand spielt keine Rolle.
        4. Erst dann schreiben. Die Reihenfolge der Waende ist aufgeschoben
           eindeutig; Constraints bleiben die letzte Schutzschicht.
        5. Die Raumversion genau einmal erhoehen.

        Scheitert irgendein Schritt, wird nichts gespeichert: Die API-Schicht
        committet nur nach erfolgreicher Rueckkehr.
        """
        room, context = self._locked_room(room_id)
        check_version(room, expected_version)
        baseline = self._device_baseline(context)
        geometry_before = self._geometry_signature(room.id)
        cables_before = self._cables_before(context)
        if cables_before is not None:
            self._prepare_contour_cables(room, payload, cables_before)
        changed = self._apply_contour(
            room,
            context,
            payload.walls,
            removed_opening_ids=payload.removed_opening_ids,
            devices_in=payload.devices,
            removed_device_ids=payload.removed_device_ids,
            removed_wall_link_ids=payload.removed_wall_link_ids,
        )
        _touch(room)
        flush(self.session)
        self._require_devices_fit(context, baseline, changed=changed)
        # Leitungen (Phase 6b.3): Oeffnung ueber einer Wandstrecke 422, jede andere
        # Unterbrechung nur mit genauer Bestaetigung (D4).
        self.cable_guard.require_unbroken(
            cables_before,
            acknowledged=payload.acknowledged_cable_ids,
            acknowledgement_supported=True,
            opening_rule=True,
        )
        return self._reloaded_plan(room, context), WriteResult(
            context=context,
            room_id=room.id,
            geometry_changed=self._geometry_signature(room.id) != geometry_before,
        )

    def _apply_contour(
        self,
        room: ElectricalRoom,
        context: FloorPlanningContext,
        walls_in: list[ContourWallIn],
        *,
        removed_opening_ids: list[uuid.UUID],
        devices_in: list[ContourDeviceIn] | None = None,
        removed_device_ids: list[uuid.UUID] | None = None,
        removed_wall_link_ids: list[uuid.UUID] | None = None,
    ) -> frozenset[str]:
        """Prueft den Zielzustand vollstaendig und schreibt ihn erst dann.

        Voraussetzung: Projekt und Raum sind gesperrt. Liefert die IDs der neuen
        oder geaenderten Geraete - sie muessen danach vollstaendig zulaessig sein.
        """
        current_walls = {wall.id: wall for wall in self._ordered_walls(room.id)}
        current_openings = {
            opening.id: opening
            for openings in self._openings_by_wall(list(current_walls)).values()
            for opening in openings
        }

        # 1. Identitaeten. Fehlt eine ID, vergibt der Server sie jetzt - vor
        #    dem Schreiben, wie ueberall im Modul (ADR 0007).
        wall_ids = [wall.id or uuid.uuid4() for wall in walls_in]
        opening_ids = [
            [opening.id or uuid.uuid4() for opening in wall.openings] for wall in walls_in
        ]
        self._require_valid_identities(
            wall_ids=wall_ids,
            opening_ids=opening_ids,
            removed_opening_ids=removed_opening_ids,
            current_walls=current_walls,
            current_openings=current_openings,
        )

        # 2. Keine Oeffnung verschwindet stillschweigend.
        _require_no_silent_opening_loss(
            wall_ids=wall_ids,
            opening_ids=opening_ids,
            removed_opening_ids=removed_opening_ids,
            current_openings=current_openings,
        )

        # 2a. Geraete (Phase 5): Kennungen und Zielzustand - vor jedem Schreiben.
        current_devices = {
            device.id: device for device in self.device_check.devices_of_rooms([room.id])
        }
        device_plan = self._device_plan(
            devices_in,
            removed_device_ids or [],
            current_devices=current_devices,
            target_wall_ids=set(wall_ids),
        )

        # 2b. Wandkopplungen entfallender Waende (Phase 6a): nur ausdruecklich.
        removed_links = self._removed_links(
            current_walls, set(wall_ids), removed_wall_link_ids or []
        )

        # 3. Der Zielzustand als Ganzes - dieselben Regeln wie ueberall.
        _raise_geometry(
            _target_problems(
                wall_ids=wall_ids,
                opening_ids=opening_ids,
                walls_in=walls_in,
                room_height_mm=self._effective_height(room, context),
            ),
            detail="Die Raumkontur ist so nicht zulaessig. Es wurde nichts gespeichert.",
        )

        # 2c. Eine Kopplung mit Durchfuehrung wird nicht mitgeloest (Phase 6b.3).
        require_links_without_penetrations(
            self.session, self.organization_id, [link.id for link in removed_links]
        )

        # 4. Schreiben: erst entfernen, dann aendern und anlegen.
        self._touch_partner_rooms(removed_links, exclude=room.id)
        for link in removed_links:
            self.session.delete(link)
        for device_id in device_plan.removed:
            self.session.delete(current_devices[device_id])
        for opening_id in removed_opening_ids:
            self.session.delete(current_openings[opening_id])
        flush(self.session)
        kept = set(wall_ids)
        for wall_id, wall in current_walls.items():
            if wall_id not in kept:
                self.session.delete(wall)
        flush(self.session)

        for position, (wall_id, wall_in) in enumerate(zip(wall_ids, walls_in, strict=True)):
            values: dict[str, object] = {
                "x1_mm": wall_in.x1_mm,
                "y1_mm": wall_in.y1_mm,
                "x2_mm": wall_in.x2_mm,
                "y2_mm": wall_in.y2_mm,
                "thickness_mm": wall_in.thickness_mm,
                "sort_order": position,
            }
            existing_wall = current_walls.get(wall_id)
            if existing_wall is None:
                new_wall = ElectricalWall(
                    id=wall_id, organization_id=self.organization_id, room_id=room.id
                )
                _assign(new_wall, values)
                self.walls.add(new_wall)
            else:
                _assign(existing_wall, values)
        self._flush_new(
            constraint="pk_electrical_walls",
            detail="Eine Wand-ID ist bereits vergeben. Bitte neu laden.",
        )

        for wall_id, wall_in, ids in zip(wall_ids, walls_in, opening_ids, strict=True):
            for opening_id, opening_in in zip(ids, wall_in.openings, strict=True):
                opening_values: dict[str, object] = {
                    "kind": opening_in.kind,
                    "offset_mm": opening_in.offset_mm,
                    "width_mm": opening_in.width_mm,
                    "height_mm": opening_in.height_mm,
                    "sill_height_mm": opening_in.sill_height_mm,
                }
                existing_opening = current_openings.get(opening_id)
                if existing_opening is None:
                    new_opening = ElectricalOpening(
                        id=opening_id, organization_id=self.organization_id, wall_id=wall_id
                    )
                    _assign(new_opening, opening_values)
                    self.openings.add(new_opening)
                else:
                    _assign(existing_opening, opening_values)
        self._flush_new(
            constraint="pk_electrical_openings",
            detail="Eine Oeffnungs-ID ist bereits vergeben. Bitte neu laden.",
        )

        changed: set[str] = set()
        for device_id, device_in in device_plan.target:
            device_values: dict[str, object] = {
                "device_type_key": device_in.device_type_key,
                "mounting_surface": device_in.mounting_surface,
                "wall_id": device_in.wall_id,
                "center_offset_mm": device_in.center_offset_mm,
                "center_height_mm": device_in.center_height_mm,
                "x_mm": device_in.x_mm,
                "y_mm": device_in.y_mm,
                "label": device_in.label,
            }
            existing_device = current_devices.get(device_id)
            if existing_device is None:
                new_device = ElectricalDevice(
                    id=device_id, organization_id=self.organization_id, room_id=room.id
                )
                _assign(new_device, device_values)
                self.devices.add(new_device)
                changed.add(str(device_id))
            elif _assign(existing_device, device_values):
                changed.add(str(device_id))
        self._flush_new(
            constraint="pk_electrical_devices",
            detail="Eine Geraete-ID ist bereits vergeben. Bitte neu laden.",
        )
        return frozenset(changed)

    def _device_plan(
        self,
        devices_in: list[ContourDeviceIn] | None,
        removed_device_ids: list[uuid.UUID],
        *,
        current_devices: dict[uuid.UUID, ElectricalDevice],
        target_wall_ids: set[uuid.UUID],
    ) -> _DevicePlan:
        """Kennungen und Zielzustand der Geraete - geprueft, bevor geschrieben wird.

        Ohne ``devices`` bleiben die gespeicherten Geraete, wie sie sind; eine
        Wand, an der noch ein Geraet haengt, laesst sich dann nicht entfernen.
        """
        if devices_in is None:
            if removed_device_ids:
                _raise_geometry(
                    [
                        GeometryProblem(
                            code="device-list-missing",
                            message=(
                                "Geraete werden nur zusammen mit der vollstaendigen Liste entfernt."
                            ),
                            keys=tuple(str(item) for item in removed_device_ids),
                        )
                    ],
                    detail="Der Entwurf ist unvollstaendig. Es wurde nichts gespeichert.",
                )
            on_removed = sorted(
                str(device.id)
                for device in current_devices.values()
                if device.wall_id is not None and device.wall_id not in target_wall_ids
            )
            if on_removed:
                _raise_devices_on_removed_walls(on_removed, current_devices)
            return _DevicePlan(target=[], removed=[])

        device_ids = [device.id or uuid.uuid4() for device in devices_in]
        problems: list[GeometryProblem] = []
        doubled = _duplicates([*device_ids, *removed_device_ids])
        if doubled:
            problems.append(
                GeometryProblem(
                    code="device-id-duplicate",
                    message="Eine Geraete-ID kommt mehrfach vor.",
                    keys=doubled,
                )
            )
        foreign = [str(item) for item in removed_device_ids if item not in current_devices]
        new_ids = [item for item in device_ids if item not in current_devices]
        if new_ids:
            foreign.extend(
                str(device.id)
                for device in self.session.execute(
                    self.devices.query().where(ElectricalDevice.id.in_(new_ids))
                ).scalars()
            )
        if foreign:
            problems.append(
                GeometryProblem(
                    code="device-foreign",
                    message="Ein Geraet gehoert nicht zu diesem Raum.",
                    keys=tuple(foreign),
                )
            )
        listed = {*device_ids, *removed_device_ids}
        missing = [str(item) for item in current_devices if item not in listed]
        if missing:
            problems.append(
                GeometryProblem(
                    code="device-missing",
                    message=(
                        "Ein gespeichertes Geraet fehlt im Entwurf. Geraete werden nur "
                        "ausdruecklich entfernt."
                    ),
                    keys=tuple(missing),
                )
            )
        types = load_device_types(self.session)
        for device_id, device_in in zip(device_ids, devices_in, strict=True):
            key = str(device_id)
            existing = current_devices.get(device_id)
            if existing is not None and (
                existing.mounting_surface != device_in.mounting_surface
                or existing.wall_id != device_in.wall_id
            ):
                problems.append(
                    GeometryProblem(
                        code="device-surface-changed",
                        message=(
                            "Ein Geraet wechselt seine Montageflaeche nicht. Bitte entfernen "
                            "und an der neuen Stelle neu setzen."
                        ),
                        keys=(key,),
                    )
                )
            if (
                device_in.mounting_surface in WALL_SURFACES
                and device_in.wall_id not in target_wall_ids
            ):
                problems.append(
                    GeometryProblem(
                        code="device-wall-unknown",
                        message="Das Wandgeraet gehoert zu keiner Wand dieses Raums.",
                        keys=(key,),
                    )
                )
            kind = types.get(device_in.device_type_key)
            if kind is None:
                problems.append(
                    GeometryProblem(
                        code="device-type-unknown",
                        message="Der Geraetetyp ist nicht bekannt.",
                        keys=(key,),
                    )
                )
            elif not kind.is_active and (
                existing is None or existing.device_type_key != device_in.device_type_key
            ):
                problems.append(
                    GeometryProblem(
                        code="device-type-inactive",
                        message="Dieser Geraetetyp wird fuer neue Geraete nicht mehr angeboten.",
                        keys=(key,),
                    )
                )
        problems.extend(
            self._distribution_problems(
                device_ids, devices_in, current_devices, removed_device_ids, types
            )
        )
        _raise_geometry(
            problems,
            detail=(
                "Die Geraete des Entwurfs passen nicht zu diesem Raum. Es wurde nichts gespeichert."
            ),
        )
        on_removed = sorted(
            str(device.id)
            for device in current_devices.values()
            if device.id not in removed_device_ids
            and device.wall_id is not None
            and device.wall_id not in target_wall_ids
        )
        if on_removed:
            _raise_devices_on_removed_walls(on_removed, current_devices)
        return _DevicePlan(
            target=list(zip(device_ids, devices_in, strict=True)), removed=list(removed_device_ids)
        )

    def _distribution_problems(
        self,
        device_ids: list[uuid.UUID],
        devices_in: list[ContourDeviceIn],
        current_devices: dict[uuid.UUID, ElectricalDevice],
        removed_device_ids: list[uuid.UUID],
        types: Mapping[str, ElectricalDeviceType],
    ) -> list[GeometryProblem]:
        """Verteilungslage und Stromkreiszuordnung bleiben gueltig (Phase 6b.0, ADR 0026).

        * Ein Geraet, das eine Verteilung platziert, wird nicht entfernt
          (``409 device-is-distribution-board``) und wechselt nicht den Typ.
        * Ein zugeordnetes Geraet wechselt nicht in eine nicht zuordenbare
          Kategorie (etwa Datendose) - die Zuordnung wuerde still ungueltig.
        """
        placements = boards_placed_on(self.session, self.organization_id, current_devices)
        removed_placements = [item for item in removed_device_ids if item in placements]
        if removed_placements:
            raise ConflictError(
                "Ein Geraet, das entfernt werden soll, ist die Lage einer Verteilung ("
                + ", ".join(sorted(placements[item].code for item in removed_placements))
                + "). Bitte zuerst die Lage der Verteilung loesen. Es wurde nichts gespeichert.",
                errors=[
                    ProblemFieldError(
                        field="devices",
                        code="device-is-distribution-board",
                        message="Das Geraet ist die Lage einer Verteilung.",
                        keys=[str(item) for item in removed_placements],
                    )
                ],
            )
        assigned = circuits_of_devices(self.session, self.organization_id, current_devices)
        problems: list[GeometryProblem] = []
        for device_id, device_in in zip(device_ids, devices_in, strict=True):
            existing = current_devices.get(device_id)
            if existing is None or existing.device_type_key == device_in.device_type_key:
                continue
            if device_id in placements and device_in.device_type_key != DISTRIBUTION_BOARD_TYPE:
                problems.append(
                    GeometryProblem(
                        code="distribution-board-type-changed",
                        message=(
                            "Das Geraet ist die Lage einer Verteilung und bleibt vom Typ "
                            "„Verteilung“."
                        ),
                        keys=(str(device_id),),
                    )
                )
            kind = types.get(device_in.device_type_key)
            if (
                device_id in assigned
                and kind is not None
                and kind.category not in ASSIGNABLE_CATEGORIES
            ):
                problems.append(
                    GeometryProblem(
                        code="assigned-device-not-assignable",
                        message=(
                            "Das Geraet ist einem Stromkreis zugeordnet; dieser Typ laesst sich "
                            "keinem Stromkreis zuordnen. Bitte zuerst die Zuordnung entfernen."
                        ),
                        keys=(str(device_id),),
                    )
                )
        return problems

    def _removed_links(
        self,
        current_walls: dict[uuid.UUID, ElectricalWall],
        kept_wall_ids: set[uuid.UUID],
        removed_wall_link_ids: list[uuid.UUID],
    ) -> list[ElectricalWallLink]:
        """Kopplungen entfallender Waende - geprueft, bevor geschrieben wird.

        * Jede genannte ID muss eine Kopplung einer **entfallenden Wand dieses
          Raums** sein (sonst ``422 wall-link-not-affected``) - fremde,
          unbeteiligte oder unbekannte Kopplungen werden nie geloest.
        * Jede Kopplung einer entfallenden Wand muss genannt sein (sonst
          ``409 wall-has-links``) - nichts verschwindet nebenbei.
        """
        removed_walls = [wall_id for wall_id in current_walls if wall_id not in kept_wall_ids]
        affected = {
            link.id: link
            for link in links_touching(self.session, self.organization_id, removed_walls)
        }
        problems: list[GeometryProblem] = []
        doubled = _duplicates(removed_wall_link_ids)
        if doubled:
            problems.append(
                GeometryProblem(
                    code="wall-link-id-duplicate",
                    message="Eine Wandzuordnung ist mehrfach genannt.",
                    keys=doubled,
                )
            )
        unrelated = tuple(str(item) for item in removed_wall_link_ids if item not in affected)
        if unrelated:
            problems.append(
                GeometryProblem(
                    code="wall-link-not-affected",
                    message=(
                        "Eine genannte Wandzuordnung betrifft keine Wand, die hier entfernt wird."
                    ),
                    keys=unrelated,
                )
            )
        _raise_geometry(
            problems,
            detail="Die Angaben zu den Wandzuordnungen passen nicht. Es wurde nichts gespeichert.",
        )
        listed = set(removed_wall_link_ids)
        missing = [link for link in affected.values() if link.id not in listed]
        if missing:
            walls = sorted(
                {
                    wall_id
                    for link in missing
                    for wall_id in (link.wall_a_id, link.wall_b_id)
                    if wall_id in current_walls
                },
                key=str,
            )
            raise _wall_has_links(walls, missing)
        return list(affected.values())

    def _touch_partner_rooms(
        self, links: Sequence[ElectricalWallLink], *, exclude: uuid.UUID
    ) -> None:
        """Zaehlt die Version der Partnerraeume geloester Kopplungen weiter."""
        wall_ids = {wall_id for link in links for wall_id in (link.wall_a_id, link.wall_b_id)}
        if not wall_ids:
            return
        room_ids = {
            wall.room_id
            for wall in self.session.execute(
                self.walls.query().where(ElectricalWall.id.in_(wall_ids))
            ).scalars()
        }
        room_ids.discard(exclude)
        if not room_ids:
            return
        for partner in self.session.execute(
            self.rooms.query().where(ElectricalRoom.id.in_(room_ids))
        ).scalars():
            _touch(partner)

    def _require_valid_identities(
        self,
        *,
        wall_ids: list[uuid.UUID],
        opening_ids: list[list[uuid.UUID]],
        removed_opening_ids: list[uuid.UUID],
        current_walls: dict[uuid.UUID, ElectricalWall],
        current_openings: dict[uuid.UUID, ElectricalOpening],
    ) -> None:
        """Doppelte, fremde oder umgehaengte Kennungen werden abgelehnt (``422``).

        "Fremd" heisst: Die ID gehoert zu einem anderen Raum dieses Mandanten.
        Eine ID eines **anderen** Mandanten ist hier nicht sichtbar; sie
        scheitert spaetestens am Primaerschluessel und erhaelt dann ebenfalls
        ``422`` (:meth:`_flush_new`) - ohne zu verraten, wem sie gehoert.
        """
        problems: list[GeometryProblem] = []

        doubled_walls = _duplicates(wall_ids)
        if doubled_walls:
            problems.append(
                GeometryProblem(
                    code="wall-id-duplicate",
                    message="Eine Wand-ID kommt in der Kontur mehrfach vor.",
                    keys=doubled_walls,
                )
            )
        flat_openings = [opening_id for ids in opening_ids for opening_id in ids]
        doubled_openings = _duplicates([*flat_openings, *removed_opening_ids])
        if doubled_openings:
            problems.append(
                GeometryProblem(
                    code="opening-id-duplicate",
                    message="Eine Oeffnungs-ID kommt mehrfach vor.",
                    keys=doubled_openings,
                )
            )

        new_walls = [wall_id for wall_id in wall_ids if wall_id not in current_walls]
        if new_walls:
            foreign_walls = tuple(
                str(wall.id)
                for wall in self.session.execute(
                    self.walls.query().where(ElectricalWall.id.in_(new_walls))
                ).scalars()
            )
            if foreign_walls:
                problems.append(
                    GeometryProblem(
                        code="wall-foreign",
                        message="Eine Wand gehoert nicht zu diesem Raum.",
                        keys=foreign_walls,
                    )
                )

        new_openings = [item for item in flat_openings if item not in current_openings]
        foreign_openings: list[str] = [
            str(item) for item in removed_opening_ids if item not in current_openings
        ]
        if new_openings:
            foreign_openings.extend(
                str(opening.id)
                for opening in self.session.execute(
                    self.openings.query().where(ElectricalOpening.id.in_(new_openings))
                ).scalars()
            )
        if foreign_openings:
            problems.append(
                GeometryProblem(
                    code="opening-foreign",
                    message="Eine Oeffnung gehoert nicht zu diesem Raum.",
                    keys=tuple(foreign_openings),
                )
            )

        moved = tuple(
            str(opening_id)
            for wall_id, ids in zip(wall_ids, opening_ids, strict=True)
            for opening_id in ids
            if opening_id in current_openings and current_openings[opening_id].wall_id != wall_id
        )
        if moved:
            problems.append(
                GeometryProblem(
                    code="opening-wall-changed",
                    message=(
                        "Eine Oeffnung wechselt ihre Wand nicht. Bitte die Oeffnung entfernen "
                        "und an der anderen Wand neu anlegen."
                    ),
                    keys=moved,
                )
            )
        _raise_geometry(
            problems,
            detail=(
                "Die Kennungen der Kontur passen nicht zu diesem Raum. Es wurde nichts gespeichert."
            ),
        )

    def _flush_new(self, *, constraint: str, detail: str) -> None:
        """Schreibt neue Zeilen; eine schon vergebene ID wird ``422``, nicht ``500``."""
        with unique_violation_translated(
            self.session,
            constraint=constraint,
            error=ValidationFailedError(detail),
        ):
            flush(self.session)

    # -------------------------------------------------------------- Oeffnungen

    def create_opening(
        self, wall_id: uuid.UUID, payload: OpeningCreate
    ) -> tuple[ElectricalOpening, WriteResult]:
        """Legt eine Oeffnung in der Wand an."""
        wall = self.walls.get_or_404(wall_id)
        room, context = self._locked_room(wall.room_id)
        self._reread(wall)
        baseline = self._device_baseline(context)
        cables_before = self._cables_before(context)
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
        _touch(room)
        flush(self.session)
        # Eine neue Oeffnung darf kein Geraet ueberdecken - auch keines im Nachbarraum.
        self._require_devices_fit(context, baseline)
        # ... und keine Wandstrecke oder Durchfuehrung (Entwurf §7: 422).
        self.cable_guard.require_unbroken(cables_before, opening_rule=True)
        return opening, WriteResult(context=context, room_id=room.id)

    def update_opening(
        self, opening_id: uuid.UUID, payload: OpeningUpdate, *, expected_version: int
    ) -> tuple[ElectricalOpening, WriteResult]:
        """Aendert eine Oeffnung und prueft sie neu."""
        opening = self.openings.get_or_404(opening_id)
        wall = self.walls.get_or_404(opening.wall_id)
        room, context = self._locked_room(wall.room_id)
        self._reread(wall, opening)
        check_version(opening, expected_version)
        # Vor jeder Zuweisung: Die Abfrage saehe sonst schon den geaenderten Stand.
        baseline = self._device_baseline(context)
        cables_before = self._cables_before(context)
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(opening, field, value)
        others = [item for item in self.list_openings(wall.id) if item.id != opening.id]
        self._check_opening(
            opening,
            wall=wall,
            room_height_mm=self._effective_height(room, context),
            others=others,
        )
        _touch(room)
        flush(self.session)
        self._require_devices_fit(context, baseline)
        self.cable_guard.require_unbroken(cables_before, opening_rule=True)
        return opening, WriteResult(context=context, room_id=room.id)

    def delete_opening(self, opening_id: uuid.UUID, *, expected_version: int) -> WriteResult:
        """Entfernt eine Oeffnung endgueltig."""
        opening = self.openings.get_or_404(opening_id)
        wall = self.walls.get_or_404(opening.wall_id)
        room, context = self._locked_room(wall.room_id)
        self._reread(wall, opening)
        check_version(opening, expected_version)
        users = cables_referencing(self.session, self.organization_id, opening_ids=[opening.id])
        if users:
            # Speicherstrategie §5.6: nur ueber den Raumentwurf mit Bestaetigung.
            raise in_use_error(
                "An dieser Oeffnung liegt ein Bodenuebergang einer Leitung. Entfernen nur im "
                "Raumentwurf mit ausdruecklicher Bestaetigung der Leitungen.",
                "opening-has-cables",
                "Oeffnung traegt einen Bodenuebergang.",
                users,
                opening.id,
            )
        self.session.delete(opening)
        _touch(room)
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

    def _rooms_on_floor(self, floor_id: uuid.UUID) -> list[ElectricalRoom]:
        stmt = (
            self.rooms.query()
            .where(ElectricalRoom.floor_id == floor_id)
            .order_by(
                nulls_last(ElectricalRoom.room_number.asc()),
                ElectricalRoom.name.asc(),
                ElectricalRoom.id.asc(),
            )
        )
        return list(self.session.execute(stmt).scalars().all())

    def _walls_by_room(self, room_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[ElectricalWall]]:
        """Waende mehrerer Raeume in **einer** Abfrage, je Raum in Konturreihenfolge."""
        grouped: dict[uuid.UUID, list[ElectricalWall]] = {}
        if not room_ids:
            return grouped
        stmt = (
            self.walls.query()
            .where(ElectricalWall.room_id.in_(room_ids))
            .order_by(
                ElectricalWall.room_id.asc(),
                ElectricalWall.sort_order.asc(),
                ElectricalWall.id.asc(),
            )
        )
        for wall in self.session.execute(stmt).scalars():
            grouped.setdefault(wall.room_id, []).append(wall)
        return grouped

    def _openings_by_wall(
        self, wall_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, list[ElectricalOpening]]:
        """Oeffnungen mehrerer Waende in **einer** Abfrage, je Wand vom Anfang aus."""
        grouped: dict[uuid.UUID, list[ElectricalOpening]] = {}
        if not wall_ids:
            return grouped
        stmt = (
            self.openings.query()
            .where(ElectricalOpening.wall_id.in_(wall_ids))
            .order_by(
                ElectricalOpening.wall_id.asc(),
                ElectricalOpening.offset_mm.asc(),
                ElectricalOpening.id.asc(),
            )
        )
        for opening in self.session.execute(stmt).scalars():
            grouped.setdefault(opening.wall_id, []).append(opening)
        return grouped

    def _room_plan(
        self,
        room: ElectricalRoom,
        context: FloorPlanningContext,
        walls: list[ElectricalWall],
        openings: dict[uuid.UUID, list[ElectricalOpening]],
        devices: list[ElectricalDevice],
    ) -> RoomPlan:
        view = RoomView(
            room=room,
            effective_height_mm=self._effective_height(room, context),
            contour=geometry.contour_report([_segment(wall) for wall in walls]),
        )
        return RoomPlan(
            view=view,
            walls=[WallPlan(wall=wall, openings=openings.get(wall.id, [])) for wall in walls],
            devices=devices,
        )

    def _reloaded_plan(self, room: ElectricalRoom, context: FloorPlanningContext) -> RoomPlan:
        """Der gespeicherte Stand eines Raums, frisch aus der Datenbank gelesen."""
        walls = self._ordered_walls(room.id)
        return self._room_plan(
            room,
            context,
            walls,
            self._openings_by_wall([wall.id for wall in walls]),
            self.device_check.devices_of_rooms([room.id]),
        )

    # ----------------------------------------------------- Leitungen (6b.3)

    def _cables_before(self, context: FloorPlanningContext) -> BuildingCableState | None:
        """Leitungsstand des Gebaeudes vor der Aenderung (unter der Projektsperre)."""
        return self.cable_guard.snapshot(context.building_id)

    def _prepare_contour_cables(
        self, room: ElectricalRoom, payload: RoomContourUpdate, before: BuildingCableState
    ) -> None:
        """Leitungsregeln des Raumentwurfs - vor dem Schreiben der Kontur (Entwurf §7).

        * Endgeraete und Waende mit Leitungsbezug werden nicht entfernt (``409``),
        * eine umgekehrte Wand behaelt die Orte ihrer Bezuege (``L - x``),
        * beim Teilen faellt kein Bezug still in das neue Stueck (``422``),
        * Bodenuebergaenge entfernter Oeffnungen verlieren nur den Bezug - wirksam
          nur mit Bestaetigung der Leitungen (Speicherstrategie §5.6).
        """
        current = {wall.id: wall for wall in self._ordered_walls(room.id)}
        target_ids = {wall.id for wall in payload.walls if wall.id is not None}
        require_devices_free(self.session, self.organization_id, payload.removed_device_ids)
        require_walls_free(
            self.session, self.organization_id, [w for w in current if w not in target_ids]
        )
        reversed_walls: dict[uuid.UUID, int] = {}
        changed: list[uuid.UUID] = []
        for wall_in in payload.walls:
            existing = current.get(wall_in.id) if wall_in.id is not None else None
            if existing is None:
                continue
            new = (wall_in.x1_mm, wall_in.y1_mm, wall_in.x2_mm, wall_in.y2_mm)
            old = (existing.x1_mm, existing.y1_mm, existing.x2_mm, existing.y2_mm)
            if new == (old[2], old[3], old[0], old[1]):
                reversed_walls[existing.id] = wall_length(existing)
            elif new != old:
                changed.append(existing.id)
        require_no_split_references(
            before,
            [
                (Point(w.x1_mm, w.y1_mm), Point(w.x2_mm, w.y2_mm))
                for w in payload.walls
                if w.id is None or w.id not in current
            ],
            changed,
        )
        preserve_reversed_walls(self.session, self.organization_id, reversed_walls)
        detach_removed_openings(self.session, self.organization_id, payload.removed_opening_ids)
        flush(self.session)

    # ------------------------------------------------------- Geraete (Phase 5)

    def _device_baseline(self, context: FloorPlanningContext) -> DeviceBaseline:
        """Geraetebefunde des Geschosses vor einer Aenderung (unter der Projektsperre)."""
        return self.device_check.baseline(context.floor_id, context.default_ceiling_height_mm)

    def _require_devices_fit(
        self,
        context: FloorPlanningContext,
        baseline: DeviceBaseline,
        *,
        changed: frozenset[str] = frozenset(),
    ) -> None:
        """Keine neuen Befunde; neue oder geaenderte Geraete muessen ganz zulaessig sein."""
        self.device_check.require_no_new_problems(
            context.floor_id,
            context.default_ceiling_height_mm,
            baseline,
            changed=changed,
            detail=DEVICE_DETAIL,
        )

    def _device_count_on_wall(self, wall_id: uuid.UUID) -> int:
        stmt = select(func.count()).where(
            ElectricalDevice.organization_id == self.organization_id,
            ElectricalDevice.wall_id == wall_id,
        )
        return int(self.session.execute(stmt).scalar_one())

    def _geometry_signature(self, room_id: uuid.UUID) -> tuple[object, ...]:
        """Waende und Oeffnungen eines Raums als Vergleichswert (fuer das Event)."""
        walls = self._ordered_walls(room_id)
        openings = self._openings_by_wall([wall.id for wall in walls])
        return tuple(
            (
                wall.id,
                wall.x1_mm,
                wall.y1_mm,
                wall.x2_mm,
                wall.y2_mm,
                wall.thickness_mm,
                tuple(
                    (o.id, o.kind, o.offset_mm, o.width_mm, o.height_mm, o.sill_height_mm)
                    for o in openings.get(wall.id, [])
                ),
            )
            for wall in walls
        )

    def _reread(self, *entities: ElectricalWall | ElectricalOpening) -> None:
        """Liest vor der Sperre geladene Zeilen **nach** der Sperre neu.

        Wand und Oeffnung werden zuerst ungesperrt aufgeloest, weil erst sie den
        Raum nennen. Wartet die Anfrage danach auf die Sperre, kann eine andere
        Transaktion dieselbe Zeile inzwischen geaendert haben. Ohne Neulesen
        pruefte die Geometrie gegen den veralteten Stand und meldete einen
        irrefuehrenden Geometriefehler statt des Versionskonflikts (Befund aus
        den Parallelitaetstests der Phase 4a). Ist die Zeile inzwischen
        geloescht, ist das ein Versionskonflikt: Der Client arbeitet gegen einen
        Stand, den es nicht mehr gibt.
        """
        for entity in entities:
            try:
                self.session.refresh(entity)
            except InvalidRequestError as exc:
                raise VersionConflictError(CONCURRENT_UPDATE_DETAIL) from exc

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


def _touch(room: ElectricalRoom) -> None:
    """Zaehlt die Raumversion weiter - die Version der gesamten Raumgeometrie.

    Das Aendern von ``updated_at`` macht die Zeile fuer SQLAlchemy schmutzig,
    und ``version_id_col`` erhoeht die Version beim naechsten UPDATE - genau
    einmal je Vorgang, auch wenn mehrere Waende betroffen sind.
    """
    room.updated_at = utcnow()


def _assign(
    entity: ElectricalWall | ElectricalOpening | ElectricalDevice, values: dict[str, object]
) -> bool:
    """Setzt nur Werte, die sich wirklich aendern; ``True``, wenn sich etwas aenderte.

    Eine unveraenderte Wand behaelt ihre Version. Sonst liefe ein Formular,
    das sie gerade offen hat, ohne Grund in einen Versionskonflikt.
    """
    changed = False
    for field, value in values.items():
        if getattr(entity, field, None) != value:
            setattr(entity, field, value)
            changed = True
    return changed


@dataclass(frozen=True, slots=True)
class _DevicePlan:
    """Gepruefter Zielzustand der Geraete eines Raums."""

    target: list[tuple[uuid.UUID, ContourDeviceIn]]
    removed: list[uuid.UUID]


def _raise_devices_on_removed_walls(
    device_ids: list[str], current: dict[uuid.UUID, ElectricalDevice]
) -> None:
    """Eine Wand mit Geraeten verschwindet nicht nebenbei (``409``, wie bei Oeffnungen)."""
    walls = sorted(
        {
            str(device.wall_id)
            for device in current.values()
            if str(device.id) in device_ids and device.wall_id is not None
        }
    )
    raise ConflictError(
        "An einer Wand, die entfernt werden soll, sind noch Geraete montiert. Bitte zuerst die "
        "Geraete entfernen. Es wurde nichts gespeichert.",
        errors=[
            ProblemFieldError(
                field="devices",
                code="wall-has-devices",
                message="An dieser Wand sind noch Geraete montiert.",
                keys=[*walls, *device_ids],
            )
        ],
    )


def _wall_has_links(
    wall_ids: Sequence[uuid.UUID], links: Sequence[ElectricalWallLink]
) -> ConflictError:
    """Eine gekoppelte Wand verschwindet nicht nebenbei (``409``, ADR 0024)."""
    return ConflictError(
        "Eine Wand, die entfernt werden soll, ist einer Wand eines Nachbarraums zugeordnet. "
        "Die Zuordnung muss ausdruecklich mit geloest werden. Es wurde nichts gespeichert.",
        errors=[
            ProblemFieldError(
                field="geometry",
                code="wall-has-links",
                message="Diese Wand ist einer Wand eines Nachbarraums zugeordnet.",
                keys=[*(str(item) for item in wall_ids), *(str(link.id) for link in links)],
            )
        ],
    )


def _duplicates(ids: list[uuid.UUID]) -> tuple[str, ...]:
    seen: set[uuid.UUID] = set()
    doubled: list[str] = []
    for item in ids:
        if item in seen:
            doubled.append(str(item))
        seen.add(item)
    return tuple(doubled)


def _require_no_silent_opening_loss(
    *,
    wall_ids: list[uuid.UUID],
    opening_ids: list[list[uuid.UUID]],
    removed_opening_ids: list[uuid.UUID],
    current_openings: dict[uuid.UUID, ElectricalOpening],
) -> None:
    """Jede vorhandene Oeffnung steht im Zielzustand - oder ist ausdruecklich entfernt.

    Eine Wand, die noch Oeffnungen traegt, laesst sich nicht nebenbei
    entfernen (``409``, wie beim Einzelloeschen). Eine Oeffnung, die einfach
    fehlt, ist ein unvollstaendiger Zielzustand (``422``).
    """
    listed = {opening_id for ids in opening_ids for opening_id in ids}
    listed.update(removed_opening_ids)
    kept_walls = set(wall_ids)
    missing = [opening for opening in current_openings.values() if opening.id not in listed]

    on_removed_walls = [opening for opening in missing if opening.wall_id not in kept_walls]
    if on_removed_walls:
        walls = sorted({str(opening.wall_id) for opening in on_removed_walls})
        raise ConflictError(
            "Eine Wand, die entfernt werden soll, traegt noch Oeffnungen. Bitte zuerst die "
            "Oeffnungen entfernen. Es wurde nichts gespeichert.",
            errors=[
                ProblemFieldError(
                    field="geometry",
                    code="wall-has-openings",
                    message="Diese Wand traegt noch Oeffnungen.",
                    keys=[*walls, *(str(opening.id) for opening in on_removed_walls)],
                )
            ],
        )
    if missing:
        _raise_geometry(
            [
                GeometryProblem(
                    code="opening-missing",
                    message=(
                        "Eine vorhandene Oeffnung fehlt im gespeicherten Stand. Oeffnungen "
                        "werden nur ausdruecklich entfernt."
                    ),
                    keys=tuple(str(opening.id) for opening in missing),
                )
            ],
            detail="Der gespeicherte Stand ist unvollstaendig. Es wurde nichts gespeichert.",
        )


def _target_problems(
    *,
    wall_ids: list[uuid.UUID],
    opening_ids: list[list[uuid.UUID]],
    walls_in: list[ContourWallIn],
    room_height_mm: int,
) -> list[GeometryProblem]:
    """Alle Geometriebefunde des Zielzustands - Waende und Oeffnungen zusammen.

    Dieselben reinen Regeln wie bei den Einzelendpunkten; nur der Stand, gegen
    den geprueft wird, ist der vollstaendige Zielzustand.
    """
    segments = [
        Segment(
            key=str(wall_id),
            start=Point(x_mm=wall.x1_mm, y_mm=wall.y1_mm),
            end=Point(x_mm=wall.x2_mm, y_mm=wall.y2_mm),
        )
        for wall_id, wall in zip(wall_ids, walls_in, strict=True)
    ]
    problems = geometry.draft_problems(segments)
    for segment, wall, ids in zip(segments, walls_in, opening_ids, strict=True):
        spans = [
            OpeningSpan(key=str(opening_id), offset_mm=opening.offset_mm, width_mm=opening.width_mm)
            for opening_id, opening in zip(ids, wall.openings, strict=True)
        ]
        for index, (span, opening) in enumerate(zip(spans, wall.openings, strict=True)):
            # Jedes Paar wird einmal verglichen - sonst erschiene dieselbe
            # Ueberlappung doppelt in der Antwort.
            problems.extend(
                geometry.opening_problems(
                    opening=span,
                    wall_length_mm=segment.length_mm,
                    others=spans[index + 1 :],
                )
            )
            problems.extend(
                geometry.opening_height_problems(
                    key=span.key,
                    kind=OpeningKind(opening.kind),
                    height_mm=opening.height_mm,
                    sill_height_mm=opening.sill_height_mm,
                    room_height_mm=room_height_mm,
                )
            )
    return problems


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
