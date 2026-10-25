"""Verteilung direkt im Plan platzieren (Phase 6c, Schritt VP, ADR 0028).

Die Verteilung bleibt die einzige Identitaet; ihre Lage ist ein Geraet vom Typ
``distribution_board`` (ADR 0026 D1). Dieser Dienst legt das Lagegeraet an,
verschiebt es oder setzt es an eine andere Wand um - **zusammen** mit der
Verknuepfung ``placement_device_id`` in **einer** Transaktion. Einen offenen
Raumentwurf kennt er nicht: Geschrieben wird nur das Lagegeraet; andere
Aenderungen am Raum werden nie mitgespeichert.

Ablauf (Sperrreihenfolge "Projekt zuerst", wie ueberall):

1. Projekt sperren und Schreibschutz pruefen (``writable_building_context``),
2. Verteilung ``FOR UPDATE`` und ``If-Match`` (Verteilungsversion),
3. betroffene Raeume (Ziel, ggf. bisheriger Raum) nach ID geordnet sperren,
   ``expected_room_version`` des Zielraums pruefen,
4. Lage mit denselben Geraeteregeln wie der Raumentwurf pruefen ("keine neuen
   Befunde", das gesetzte Geraet ganz zulaessig), Leitungen vorher/nachher,
5. Raum- und Verteilungsversion hochzaehlen. Das Event ``electrical.plan.updated``
   (``devices_changed``) je Raum stellt die API-Schicht **nach** dem Commit zu.

Faelle: ohne Lage -> neues Geraet; gleiche Wand -> verschieben; andere Wand ->
nur ohne Leitungen am Lagegeraet (F5): neues Geraet, umhaengen, altes entfernen.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.persistence import CONCURRENT_UPDATE_DETAIL, flush, unique_violation_translated
from app.core.preconditions import check_version
from app.core.projects.planning import (
    BuildingPlanningContext,
    FloorPlanningAccess,
    FloorPlanningContext,
)
from app.core.tenancy.repository import TenantRepository
from app.db.mixins import utcnow
from app.errors import (
    ConflictError,
    NotFoundError,
    ProblemFieldError,
    ValidationFailedError,
    VersionConflictError,
)
from app.modules.electrical.cable_rules import (
    BuildingCableState,
    CableGuard,
    cables_referencing,
    describe_cable,
)
from app.modules.electrical.catalog import DISTRIBUTION_BOARD_TYPE, MountingSurface
from app.modules.electrical.device_rules import DeviceBaseline, FloorDeviceCheck
from app.modules.electrical.models import (
    BOARD_PLACEMENT_CONSTRAINT,
    ElectricalCable,
    ElectricalDevice,
    ElectricalDeviceType,
    ElectricalDistributionBoard,
    ElectricalRoom,
    ElectricalWall,
)
from app.modules.electrical.schemas import BoardPlacementUpdate

#: Meldung, wenn die Lage einen Geraetebefund erzeugen wuerde (wie im Raumentwurf).
PLACEMENT_DETAIL = (
    "Die Verteilung laege so unzulaessig (ausserhalb der Wand, in einer Oeffnung oder ueber "
    "einem anderen Geraet). Es wurde nichts gespeichert."
)


class _RoomRepository(TenantRepository[ElectricalRoom]):
    model = ElectricalRoom


class _DeviceRepository(TenantRepository[ElectricalDevice]):
    model = ElectricalDevice


@dataclass(frozen=True, slots=True)
class PlacementResult:
    """Was die API-Schicht fuer Antwort, Projektvermerk und Events braucht."""

    board: ElectricalDistributionBoard
    device: ElectricalDevice
    #: Betroffene Raeume (Zielraum zuerst) mit ihrem Geschoss.
    rooms: tuple[tuple[ElectricalRoom, FloorPlanningContext], ...]
    context: BuildingPlanningContext


def _invalid(field: str, code: str, message: str, detail: str) -> ValidationFailedError:
    return ValidationFailedError(
        detail, errors=[ProblemFieldError(field=field, code=code, message=message)]
    )


class BoardPlacementService:
    """Platziert, verschiebt und setzt das Lagegeraet einer Verteilung um."""

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self.session = session
        self.organization_id = organization_id
        self.rooms = _RoomRepository(session, organization_id)
        self.devices = _DeviceRepository(session, organization_id)
        self.structure = FloorPlanningAccess(session, organization_id)
        self.device_check = FloorDeviceCheck(session, organization_id)
        self.cable_guard = CableGuard(session, organization_id)

    def place(
        self, board_id: uuid.UUID, payload: BoardPlacementUpdate, *, expected_version: int
    ) -> PlacementResult:
        board = self._board(board_id, lock=False)
        # 1. Projekt zuerst - danach kann es bis zum Commit nicht archiviert werden.
        context = self.structure.writable_building_context(board.building_id)
        # 2. Verteilung sperren, frisch lesen, If-Match.
        board = self._board(board_id, lock=True)
        check_version(board, expected_version)

        floors = {floor.floor_id: floor for floor in context.floors}
        target_room = self.rooms.get(payload.room_id)
        if target_room is None or target_room.floor_id not in floors:
            # Fremder Mandant, anderes Gebaeude, unbekannte ID: dieselbe Antwort.
            raise _invalid(
                "room_id",
                "board-placement-not-in-building",
                "Raum nicht im Gebaeude der Verteilung.",
                "Der Raum gehoert nicht zum Gebaeude dieser Verteilung. Es wurde nichts "
                "gespeichert.",
            )
        old = (
            None
            if board.placement_device_id is None
            else self.devices.get(board.placement_device_id)
        )

        # 3. Raeume nach ID geordnet sperren (Ziel und ggf. bisheriger Raum).
        locked = self._lock_rooms({payload.room_id} | ({old.room_id} if old else set()))
        target_room = locked[payload.room_id]
        if target_room.version != payload.expected_room_version:
            raise VersionConflictError(
                "Der Raum wurde inzwischen geaendert. Bitte neu laden; die gewaehlte Lage bleibt "
                "als Vorschlag erhalten."
            )
        wall = self._wall_of(target_room.id, payload.wall_id)
        kind = self._distribution_type()
        old_room = locked[old.room_id] if old is not None else None
        affected = [target_room]
        if old_room is not None and old_room is not target_room:
            affected.append(old_room)
        for room in affected:
            if room.floor_id not in floors:
                raise ConflictError(
                    "Das bisherige Lagegeraet liegt nicht mehr im Gebaeude der Verteilung. Bitte "
                    "neu laden."
                )

        # 4. Ausgangslage: Geraetebefunde je Geschoss und Leitungen des Gebaeudes.
        baselines: dict[uuid.UUID, DeviceBaseline] = {
            floor_id: self.device_check.baseline(
                floor_id, floors[floor_id].default_ceiling_height_mm
            )
            for floor_id in sorted({room.floor_id for room in affected}, key=str)
        }
        cables_before = self.cable_guard.snapshot(context.building_id)

        # Versionen: jeder betroffene Raum und die Verteilung genau einmal (ein UPDATE).
        now = utcnow()
        if (
            old is not None
            and old.wall_id == wall.id
            and old.mounting_surface == MountingSurface.WALL_INTERIOR.value
        ):
            device = old
            device.center_offset_mm = payload.center_offset_mm
            device.center_height_mm = payload.center_height_mm
            board.updated_at = now
        else:
            if not kind.is_active:
                raise _invalid(
                    "device_type_key",
                    "device-type-inactive",
                    "Dieser Geraetetyp wird fuer neue Geraete nicht mehr angeboten.",
                    "Der Geraetetyp „Verteilung“ ist deaktiviert. Es wurde nichts gespeichert.",
                )
            if old is not None:
                self._require_old_free(old, cables_before)
            device = ElectricalDevice(
                id=uuid.uuid4(),
                organization_id=self.organization_id,
                room_id=target_room.id,
                device_type_key=DISTRIBUTION_BOARD_TYPE,
                mounting_surface=MountingSurface.WALL_INTERIOR.value,
                wall_id=wall.id,
                center_offset_mm=payload.center_offset_mm,
                center_height_mm=payload.center_height_mm,
            )
            self.devices.add(device)
            # Erst das Geraet, dann die Verknuepfung - beides in dieser Transaktion.
            flush(self.session)
            board.placement_device_id = device.id
            board.updated_at = now
            with unique_violation_translated(
                self.session,
                constraint=BOARD_PLACEMENT_CONSTRAINT,
                error=ConflictError("Dieses Geraet ist bereits die Lage einer anderen Verteilung."),
            ):
                flush(self.session)
            if old is not None:
                self.session.delete(old)

        # 5. Raumversionen; danach die Pruefungen gegen den geschriebenen Stand.
        for room in affected:
            room.updated_at = now
        flush(self.session)

        for floor_id, baseline in baselines.items():
            self.device_check.require_no_new_problems(
                floor_id,
                floors[floor_id].default_ceiling_height_mm,
                baseline,
                changed=frozenset({str(device.id)}),
                detail=PLACEMENT_DETAIL,
            )
        # Verschieben auf derselben Wand: Leitungen ab dem Lagegeraet duerfen nicht still
        # ungueltig werden (keine Bestaetigung in diesem Ablauf).
        self.cable_guard.require_unbroken(cables_before)

        return PlacementResult(
            board=board,
            device=device,
            rooms=tuple((room, floors[room.floor_id]) for room in affected),
            context=context,
        )

    # ---------------------------------------------------------------- Helfer

    def _board(self, board_id: uuid.UUID, *, lock: bool) -> ElectricalDistributionBoard:
        stmt = select(ElectricalDistributionBoard).where(
            ElectricalDistributionBoard.organization_id == self.organization_id,
            ElectricalDistributionBoard.id == board_id,
        )
        if lock:
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        board = self.session.execute(stmt).scalar_one_or_none()
        if board is None:
            if lock:
                raise VersionConflictError(CONCURRENT_UPDATE_DETAIL)
            raise NotFoundError("Verteilung wurde nicht gefunden.")
        return board

    def _lock_rooms(self, room_ids: set[uuid.UUID]) -> dict[uuid.UUID, ElectricalRoom]:
        rooms = {
            room.id: room
            for room in self.session.execute(
                select(ElectricalRoom)
                .where(
                    ElectricalRoom.organization_id == self.organization_id,
                    ElectricalRoom.id.in_(sorted(room_ids, key=str)),
                )
                .order_by(ElectricalRoom.id.asc())
                .with_for_update()
                .execution_options(populate_existing=True)
            ).scalars()
        }
        if set(rooms) != room_ids:
            raise VersionConflictError(CONCURRENT_UPDATE_DETAIL)
        return rooms

    def _wall_of(self, room_id: uuid.UUID, wall_id: uuid.UUID) -> ElectricalWall:
        wall = self.session.execute(
            select(ElectricalWall).where(
                ElectricalWall.organization_id == self.organization_id,
                ElectricalWall.id == wall_id,
                ElectricalWall.room_id == room_id,
            )
        ).scalar_one_or_none()
        if wall is None:
            raise _invalid(
                "wall_id",
                "board-placement-wall-unknown",
                "Wand gehoert nicht zu diesem Raum.",
                "Die Wand gehoert nicht zum gewaehlten Raum. Es wurde nichts gespeichert.",
            )
        return wall

    def _distribution_type(self) -> ElectricalDeviceType:
        kind = self.session.get(ElectricalDeviceType, DISTRIBUTION_BOARD_TYPE)
        if kind is None:
            raise ConflictError("Der Geraetetyp „Verteilung“ fehlt im Katalog.")
        return kind

    def _require_old_free(self, old: ElectricalDevice, before: BuildingCableState | None) -> None:
        """F5: An eine andere Wand nur, solange keine Leitung am Lagegeraet haengt."""
        users: list[ElectricalCable] = cables_referencing(
            self.session, self.organization_id, device_ids=[old.id]
        )
        if not users:
            return
        names = (
            [describe_cable(before, cable.id) for cable in users if cable.id in before.cables]
            if before is not None
            else []
        ) or sorted(cable.label or str(cable.id)[:8] for cable in users)
        raise ConflictError(
            "Die Verteilung laesst sich nicht an eine andere Wand umsetzen, solange Leitungen an "
            "ihrem Lagegeraet haengen. Bitte zuerst diese Leitungen aendern: "
            + "; ".join(names)
            + ". Es wurde nichts geaendert.",
            errors=[
                ProblemFieldError(
                    field="cables",
                    code="board-placement-has-cables",
                    message="Lagegeraet ist Endpunkt von Leitungen.",
                    keys=[str(cable.id) for cable in users],
                )
            ],
        )
