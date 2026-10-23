"""Verteilungen, Stromkreise und Geraetezuordnung (Phase 6b.0, ADR 0026).

* **Verteilung** - elektrischer Bezugspunkt eines Gebaeudes; mehrere je
  Gebaeude, ``code`` je Gebaeude eindeutig. Ihre Lage ist ein Geraet des Typs
  ``distribution_board`` (``placement_device_id``) - keine zweite Geometrie.
* **Stromkreis** - an genau einer Verteilung. ``proposed_*`` sind Vorschlaege
  fuer kuenftige Leitungen (6b.3), keine Vorgabe und keine Pruefung.
* **Geraetezuordnung** - ein Geraet haengt an hoechstens einem Stromkreis; nur
  Steckdosen, Schalter, Leuchten und Abzweigdosen (``ASSIGNABLE_CATEGORIES``). Nie still
  umgehaengt: Ein anderweitig zugeordnetes Geraet liefert ``409``.

**Ablauf jedes Schreibvorgangs** (eine Transaktion, "Projekt zuerst"):

1. Projektzeile sperren und Schreibschutz pruefen
   (``FloorPlanningAccess.writable_building_context`` - ``409`` bei
   ``completed``/``archived``); Gebaeude und Geschosse danach frisch lesen,
2. die eigene Zeile sperren und ``If-Match`` pruefen,
3. Bezuege (Geraete, Verteilung) nach der Sperre frisch lesen und pruefen,
4. schreiben.

Alles ist gebaeudebezogen (D2): Geraete und Verteilungsplatzierung muessen in
einem Geschoss desselben Gebaeudes liegen. Kein Event (ADR 0026, D8).
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.persistence import CONCURRENT_UPDATE_DETAIL, flush, unique_violation_translated
from app.core.preconditions import check_version
from app.core.projects.planning import BuildingPlanningContext, FloorPlanningAccess
from app.core.tenancy.repository import TenantRepository
from app.db.mixins import utcnow
from app.errors import (
    ConflictError,
    NotFoundError,
    ProblemFieldError,
    ValidationFailedError,
    VersionConflictError,
)
from app.modules.electrical.cable_rules import in_use_error
from app.modules.electrical.catalog import ASSIGNABLE_CATEGORIES, DISTRIBUTION_BOARD_TYPE
from app.modules.electrical.models import (
    BOARD_CODE_CONSTRAINT,
    BOARD_PLACEMENT_CONSTRAINT,
    CIRCUIT_DESIGNATION_CONSTRAINT,
    CIRCUIT_DEVICE_PK,
    ElectricalCable,
    ElectricalCircuit,
    ElectricalCircuitDevice,
    ElectricalDevice,
    ElectricalDeviceType,
    ElectricalDistributionBoard,
    ElectricalRoom,
)
from app.modules.electrical.schemas import (
    CircuitCreate,
    CircuitDevicesUpdate,
    CircuitUpdate,
    DistributionBoardCreate,
    DistributionBoardUpdate,
)

CROSS_SECTION_QUANTUM = Decimal("0.01")


class BoardRepository(TenantRepository[ElectricalDistributionBoard]):
    model = ElectricalDistributionBoard


class CircuitRepository(TenantRepository[ElectricalCircuit]):
    model = ElectricalCircuit


@dataclass(frozen=True, slots=True)
class CircuitView:
    circuit: ElectricalCircuit
    device_ids: tuple[uuid.UUID, ...]


@dataclass(frozen=True, slots=True)
class DistributionWriteResult:
    """Was die API-Schicht fuer den Projektvermerk braucht."""

    context: BuildingPlanningContext
    changed: bool = True


def cross_section_out(value: Decimal | None) -> str | None:
    """Dezimalstring mit genau zwei Nachkommastellen (ADR 0005)."""
    return None if value is None else str(value.quantize(CROSS_SECTION_QUANTUM))


def _problem(field: str, code: str, message: str, *keys: uuid.UUID) -> ProblemFieldError:
    return ProblemFieldError(
        field=field, code=code, message=message, keys=[str(key) for key in keys] or None
    )


def _invalid(
    detail: str, field: str, code: str, message: str, *keys: uuid.UUID
) -> ValidationFailedError:
    return ValidationFailedError(detail, errors=[_problem(field, code, message, *keys)])


def _conflict(detail: str, field: str, code: str, message: str, *keys: uuid.UUID) -> ConflictError:
    return ConflictError(detail, errors=[_problem(field, code, message, *keys)])


def _code_taken() -> ValidationFailedError:
    return _invalid(
        "In diesem Gebaeude gibt es bereits eine Verteilung mit diesem Code.",
        "code",
        "board-code-taken",
        "Code im Gebaeude bereits vergeben.",
    )


def _placement_taken(*keys: uuid.UUID) -> ConflictError:
    return _conflict(
        "Dieses Geraet ist bereits die Lage einer anderen Verteilung.",
        "placement_device_id",
        "board-placement-taken",
        "Geraet platziert bereits eine Verteilung.",
        *keys,
    )


def _designation_taken() -> ValidationFailedError:
    return _invalid(
        "An dieser Verteilung gibt es bereits einen Stromkreis mit dieser Bezeichnung.",
        "designation",
        "circuit-designation-taken",
        "Bezeichnung an der Verteilung bereits vergeben.",
    )


def _assigned_elsewhere(*keys: uuid.UUID) -> ConflictError:
    return _conflict(
        "Mindestens ein Geraet ist bereits einem anderen Stromkreis zugeordnet. Es wird nicht "
        "still umgehaengt - bitte dort zuerst entfernen. Es wurde nichts gespeichert.",
        "device_ids",
        "device-assigned-elsewhere",
        "Geraet ist einem anderen Stromkreis zugeordnet.",
        *keys,
    )


# --------------------------------------------- Auskuenfte fuer den Raumservice


def boards_placed_on(
    session: Session, organization_id: uuid.UUID, device_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, ElectricalDistributionBoard]:
    """Verteilungen, deren Lage eines der Geraete ist - je Geraet."""
    ids = list(device_ids)
    if not ids:
        return {}
    rows = session.execute(
        select(ElectricalDistributionBoard).where(
            ElectricalDistributionBoard.organization_id == organization_id,
            ElectricalDistributionBoard.placement_device_id.in_(ids),
        )
    ).scalars()
    return {row.placement_device_id: row for row in rows if row.placement_device_id is not None}


def circuits_of_devices(
    session: Session, organization_id: uuid.UUID, device_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, uuid.UUID]:
    """Stromkreis je zugeordnetem Geraet."""
    ids = list(device_ids)
    if not ids:
        return {}
    rows = session.execute(
        select(ElectricalCircuitDevice.device_id, ElectricalCircuitDevice.circuit_id).where(
            ElectricalCircuitDevice.organization_id == organization_id,
            ElectricalCircuitDevice.device_id.in_(ids),
        )
    ).all()
    return {row[0]: row[1] for row in rows}


# ----------------------------------------------------------------- Service


class DistributionService:
    """Verteilungen, Stromkreise und Zuordnungen eines Mandanten."""

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self.session = session
        self.organization_id = organization_id
        self.boards = BoardRepository(session, organization_id)
        self.circuits = CircuitRepository(session, organization_id)
        self.structure = FloorPlanningAccess(session, organization_id)

    # ------------------------------------------------------------------ Lesen

    def list_boards(
        self, building_id: uuid.UUID
    ) -> tuple[BuildingPlanningContext, list[ElectricalDistributionBoard]]:
        context = self.structure.building_context(building_id)
        boards = list(
            self.session.execute(
                self.boards.query()
                .where(ElectricalDistributionBoard.building_id == building_id)
                .order_by(ElectricalDistributionBoard.code.asc(), ElectricalDistributionBoard.id)
            ).scalars()
        )
        return context, boards

    def list_circuits(
        self, building_id: uuid.UUID
    ) -> tuple[BuildingPlanningContext, list[CircuitView]]:
        context = self.structure.building_context(building_id)
        circuits = list(
            self.session.execute(
                self.circuits.query()
                .join(
                    ElectricalDistributionBoard,
                    (
                        ElectricalDistributionBoard.organization_id
                        == ElectricalCircuit.organization_id
                    )
                    & (ElectricalDistributionBoard.id == ElectricalCircuit.board_id),
                )
                .where(ElectricalDistributionBoard.building_id == building_id)
                .order_by(
                    ElectricalDistributionBoard.code.asc(),
                    ElectricalCircuit.sort_order.asc(),
                    ElectricalCircuit.designation.asc(),
                    ElectricalCircuit.id.asc(),
                )
            ).scalars()
        )
        devices = self._device_ids_of([circuit.id for circuit in circuits])
        return context, [
            CircuitView(circuit, tuple(devices.get(circuit.id, ()))) for circuit in circuits
        ]

    # ------------------------------------------------------------- Verteilung

    def create_board(
        self, building_id: uuid.UUID, payload: DistributionBoardCreate
    ) -> tuple[ElectricalDistributionBoard, DistributionWriteResult]:
        context = self.structure.writable_building_context(building_id)
        self._require_free_code(building_id, payload.code, exclude_id=None)
        if payload.placement_device_id is not None:
            self._require_placement(context, payload.placement_device_id, exclude_board_id=None)
        board = ElectricalDistributionBoard(
            id=uuid.uuid4(),
            organization_id=self.organization_id,
            building_id=building_id,
            code=payload.code,
            name=payload.name,
            note=payload.note,
            placement_device_id=payload.placement_device_id,
        )
        self.boards.add(board)
        self._flush_board()
        return board, DistributionWriteResult(context=context)

    def update_board(
        self, board_id: uuid.UUID, payload: DistributionBoardUpdate, *, expected_version: int
    ) -> tuple[ElectricalDistributionBoard, DistributionWriteResult]:
        board, context = self._locked_board(board_id, expected_version)
        changes = payload.model_dump(exclude_unset=True)
        if "code" in changes and changes["code"] != board.code:
            self._require_free_code(board.building_id, changes["code"], exclude_id=board.id)
        placement = changes.get("placement_device_id")
        if placement is not None and placement != board.placement_device_id:
            self._require_placement(context, placement, exclude_board_id=board.id)
        if (
            "placement_device_id" in changes
            and changes["placement_device_id"] != board.placement_device_id
            and board.placement_device_id is not None
        ):
            # Leitungen beginnen am Lagegeraet: nie still an ein anderes umgehaengt (6b.3).
            users = self._cables_at(board.id, board.placement_device_id)
            if users:
                raise in_use_error(
                    "Am bisherigen Lagegeraet dieser Verteilung beginnen Leitungen. Bitte zuerst "
                    "die Leitungen aendern.",
                    "board-placement-has-cables",
                    "Lagegeraet ist Endpunkt von Leitungen.",
                    users,
                    board.placement_device_id,
                )
        changed = False
        for field, value in changes.items():
            if getattr(board, field) != value:
                setattr(board, field, value)
                changed = True
        if changed:
            self._flush_board()
        return board, DistributionWriteResult(context=context, changed=changed)

    def delete_board(
        self, board_id: uuid.UUID, *, expected_version: int
    ) -> DistributionWriteResult:
        board, context = self._locked_board(board_id, expected_version)
        circuit_count = int(
            self.session.execute(
                select(func.count())
                .select_from(ElectricalCircuit)
                .where(
                    ElectricalCircuit.organization_id == self.organization_id,
                    ElectricalCircuit.board_id == board.id,
                )
            ).scalar_one()
        )
        if circuit_count:
            raise _conflict(
                f"An dieser Verteilung haengen noch {circuit_count} Stromkreis(e). Bitte zuerst "
                "die Stromkreise entfernen.",
                "board",
                "board-has-circuits",
                "Verteilung hat Stromkreise.",
                board.id,
            )
        self.session.delete(board)
        flush(self.session)
        return DistributionWriteResult(context=context)

    # ------------------------------------------------------------- Stromkreis

    def create_circuit(
        self, board_id: uuid.UUID, payload: CircuitCreate
    ) -> tuple[CircuitView, DistributionWriteResult]:
        board = self.boards.get_or_404(board_id)
        context = self.structure.writable_building_context(board.building_id)
        # Nach der Projektsperre frisch: eine zwischenzeitlich geloeschte
        # Verteilung ist dann nicht mehr da.
        board = self._fresh_board(board_id)
        self._require_free_designation(board.id, payload.designation, exclude_id=None)
        values = payload.model_dump()
        circuit = ElectricalCircuit(
            id=uuid.uuid4(),
            organization_id=self.organization_id,
            board_id=board.id,
            designation=values["designation"],
            name=values["name"],
            sort_order=values["sort_order"] or 0,
            proposed_cable_type=values["proposed_cable_type"],
            proposed_conductor_count=values["proposed_conductor_count"],
            proposed_cross_section_mm2=_decimal(values["proposed_cross_section_mm2"]),
            protective_device=values["protective_device"],
            rcd_group=values["rcd_group"],
            phase_count=values["phase_count"],
            note=values["note"],
            # Neu und Bestand: der Vorschlag ist nur Information, bis er ausdruecklich
            # aktiviert wird (F1, ADR 0027).
            proposal_overrides_templates=bool(values["proposal_overrides_templates"]),
        )
        self.circuits.add(circuit)
        self._flush_circuit()
        return CircuitView(circuit, ()), DistributionWriteResult(context=context)

    def update_circuit(
        self, circuit_id: uuid.UUID, payload: CircuitUpdate, *, expected_version: int
    ) -> tuple[CircuitView, DistributionWriteResult]:
        circuit, context = self._locked_circuit(circuit_id, expected_version)
        changes = payload.model_dump(exclude_unset=True)
        if "designation" in changes and changes["designation"] != circuit.designation:
            self._require_free_designation(
                circuit.board_id, changes["designation"], exclude_id=circuit.id
            )
        if "proposed_cross_section_mm2" in changes:
            changes["proposed_cross_section_mm2"] = _decimal(changes["proposed_cross_section_mm2"])
        changed = False
        for field, value in changes.items():
            if getattr(circuit, field) != value:
                setattr(circuit, field, value)
                changed = True
        if changed:
            self._flush_circuit()
        return self._circuit_view(circuit), DistributionWriteResult(
            context=context, changed=changed
        )

    def delete_circuit(
        self, circuit_id: uuid.UUID, *, expected_version: int
    ) -> DistributionWriteResult:
        """Entfernt den Stromkreis; Zuordnungen und Leitungen folgen per ``CASCADE``.

        Die Rueckfrage mit der Zahl der Leitungen stellt die Oberflaeche (Entwurf §7);
        genutzte Durchfuehrungen bleiben bestehen und werden sichtbar ungenutzt.
        """
        circuit, context = self._locked_circuit(circuit_id, expected_version)
        self.session.delete(circuit)
        flush(self.session)
        return DistributionWriteResult(context=context)

    def replace_devices(
        self, circuit_id: uuid.UUID, payload: CircuitDevicesUpdate, *, expected_version: int
    ) -> tuple[CircuitView, DistributionWriteResult]:
        """Ersetzt die Geraeteliste - nie still umgehaengt, nie gebaeudeuebergreifend."""
        circuit, context = self._locked_circuit(circuit_id, expected_version)
        wanted = payload.device_ids
        doubled = sorted({item for item in wanted if wanted.count(item) > 1}, key=str)
        if doubled:
            raise _invalid(
                "Ein Geraet ist doppelt angegeben. Es wurde nichts gespeichert.",
                "device_ids",
                "circuit-device-duplicate",
                "Geraet doppelt angegeben.",
                *doubled,
            )
        categories = self._device_categories_in_building(context, wanted)
        unknown = [item for item in wanted if item not in categories]
        if unknown:
            # Fremder Mandant, anderes Gebaeude und unbekannte ID: dieselbe Antwort.
            raise _invalid(
                "Ein Geraet gehoert nicht zu diesem Gebaeude. Es wurde nichts gespeichert.",
                "device_ids",
                "circuit-device-not-in-building",
                "Geraet nicht in diesem Gebaeude.",
                *unknown,
            )
        not_assignable = [item for item in wanted if categories[item] not in ASSIGNABLE_CATEGORIES]
        if not_assignable:
            raise _invalid(
                "Nur Steckdosen, Schalter, Leuchten und Abzweigdosen lassen sich einem "
                "Stromkreis zuordnen - keine Datendosen und nicht das Lagegeraet einer "
                "Verteilung. Es wurde nichts gespeichert.",
                "device_ids",
                "circuit-device-not-assignable",
                "Geraetetyp nicht zuordenbar.",
                *not_assignable,
            )
        current = circuits_of_devices(self.session, self.organization_id, wanted)
        elsewhere = [item for item in wanted if current.get(item, circuit.id) != circuit.id]
        if elsewhere:
            raise _assigned_elsewhere(*elsewhere)

        before = set(self._device_ids_of([circuit.id]).get(circuit.id, []))
        after = set(wanted)
        if before == after:
            return self._circuit_view(circuit), DistributionWriteResult(
                context=context, changed=False
            )
        removed = before - after
        users = [
            cable
            for cable in self._cables_of(circuit.id)
            if cable.start_device_id in removed or cable.end_device_id in removed
        ]
        if users:
            # Ein Endgeraet einer Leitung bleibt dem Stromkreis zugeordnet (6b.3).
            raise in_use_error(
                "Ein Geraet, dessen Zuordnung entfallen soll, ist Endpunkt einer Leitung dieses "
                "Stromkreises. Bitte zuerst die Leitung aendern.",
                "circuit-device-has-cables",
                "Geraet ist Endpunkt einer Leitung.",
                users,
                *sorted(
                    {
                        device
                        for cable in users
                        for device in (cable.start_device_id, cable.end_device_id)
                        if device in removed
                    },
                    key=str,
                ),
            )
        if removed:
            self.session.execute(
                delete(ElectricalCircuitDevice)
                .where(
                    ElectricalCircuitDevice.organization_id == self.organization_id,
                    ElectricalCircuitDevice.circuit_id == circuit.id,
                    ElectricalCircuitDevice.device_id.in_(removed),
                )
                .execution_options(synchronize_session=False)
            )
        self.session.add_all(
            ElectricalCircuitDevice(
                organization_id=self.organization_id, device_id=device_id, circuit_id=circuit.id
            )
            for device_id in sorted(after - before, key=str)
        )
        # Die Zuordnung steht unter der Stromkreisversion.
        circuit.updated_at = utcnow()
        with unique_violation_translated(
            self.session, constraint=CIRCUIT_DEVICE_PK, error=_assigned_elsewhere()
        ):
            flush(self.session)
        return self._circuit_view(circuit), DistributionWriteResult(context=context)

    # ---------------------------------------------------------------- Helfer

    def _locked_board(
        self, board_id: uuid.UUID, expected_version: int
    ) -> tuple[ElectricalDistributionBoard, BuildingPlanningContext]:
        board = self.boards.get_or_404(board_id)
        context = self.structure.writable_building_context(board.building_id)
        locked = self._fresh_board(board_id, missing=VersionConflictError(CONCURRENT_UPDATE_DETAIL))
        check_version(locked, expected_version)
        return locked, context

    def _fresh_board(
        self, board_id: uuid.UUID, *, missing: Exception | None = None
    ) -> ElectricalDistributionBoard:
        locked = self.session.execute(
            select(ElectricalDistributionBoard)
            .where(
                ElectricalDistributionBoard.organization_id == self.organization_id,
                ElectricalDistributionBoard.id == board_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if locked is None:
            raise missing or NotFoundError("Verteilung wurde nicht gefunden.")
        return locked

    def _locked_circuit(
        self, circuit_id: uuid.UUID, expected_version: int
    ) -> tuple[ElectricalCircuit, BuildingPlanningContext]:
        circuit = self.circuits.get_or_404(circuit_id)
        board = self.boards.get_or_404(circuit.board_id)
        context = self.structure.writable_building_context(board.building_id)
        locked = self.session.execute(
            select(ElectricalCircuit)
            .where(
                ElectricalCircuit.organization_id == self.organization_id,
                ElectricalCircuit.id == circuit_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if locked is None:
            raise VersionConflictError(CONCURRENT_UPDATE_DETAIL)
        check_version(locked, expected_version)
        return locked, context

    def _require_free_code(
        self, building_id: uuid.UUID, code: str, *, exclude_id: uuid.UUID | None
    ) -> None:
        stmt = self.boards.query().where(
            ElectricalDistributionBoard.building_id == building_id,
            ElectricalDistributionBoard.code == code,
        )
        if exclude_id is not None:
            stmt = stmt.where(ElectricalDistributionBoard.id != exclude_id)
        if self.session.execute(stmt).scalars().first() is not None:
            raise _code_taken()

    def _require_free_designation(
        self, board_id: uuid.UUID, designation: str, *, exclude_id: uuid.UUID | None
    ) -> None:
        stmt = self.circuits.query().where(
            ElectricalCircuit.board_id == board_id, ElectricalCircuit.designation == designation
        )
        if exclude_id is not None:
            stmt = stmt.where(ElectricalCircuit.id != exclude_id)
        if self.session.execute(stmt).scalars().first() is not None:
            raise _designation_taken()

    def _require_placement(
        self,
        context: BuildingPlanningContext,
        device_id: uuid.UUID,
        *,
        exclude_board_id: uuid.UUID | None,
    ) -> None:
        types = self._device_types_in_building(context, [device_id])
        if device_id not in types:
            raise _invalid(
                "Das Geraet fuer die Lage der Verteilung gehoert nicht zu diesem Gebaeude.",
                "placement_device_id",
                "board-placement-not-in-building",
                "Geraet nicht in diesem Gebaeude.",
                device_id,
            )
        if types[device_id] != DISTRIBUTION_BOARD_TYPE:
            raise _invalid(
                "Die Lage einer Verteilung ist ein Geraet vom Typ „Verteilung“.",
                "placement_device_id",
                "board-placement-wrong-type",
                "Geraet ist keine Verteilung.",
                device_id,
            )
        other = boards_placed_on(self.session, self.organization_id, [device_id]).get(device_id)
        if other is not None and other.id != exclude_board_id:
            raise _placement_taken(device_id)

    def _device_rows_in_building(
        self, context: BuildingPlanningContext, device_ids: Sequence[uuid.UUID]
    ) -> list[tuple[uuid.UUID, str, str]]:
        """``(device_id, type_key, category)`` der Geraete, die in diesem Gebaeude liegen."""
        if not device_ids:
            return []
        floor_ids = [floor.floor_id for floor in context.floors]
        if not floor_ids:
            return []
        rows = self.session.execute(
            select(
                ElectricalDevice.id, ElectricalDevice.device_type_key, ElectricalDeviceType.category
            )
            .join(
                ElectricalRoom,
                (ElectricalRoom.organization_id == ElectricalDevice.organization_id)
                & (ElectricalRoom.id == ElectricalDevice.room_id),
            )
            .join(
                ElectricalDeviceType, ElectricalDeviceType.key == ElectricalDevice.device_type_key
            )
            .where(
                ElectricalDevice.organization_id == self.organization_id,
                ElectricalDevice.id.in_(list(device_ids)),
                ElectricalRoom.floor_id.in_(floor_ids),
            )
        ).all()
        return [(device_id, type_key, category) for device_id, type_key, category in rows]

    def _device_types_in_building(
        self, context: BuildingPlanningContext, device_ids: Sequence[uuid.UUID]
    ) -> dict[uuid.UUID, str]:
        return {row[0]: row[1] for row in self._device_rows_in_building(context, device_ids)}

    def _device_categories_in_building(
        self, context: BuildingPlanningContext, device_ids: Sequence[uuid.UUID]
    ) -> dict[uuid.UUID, str]:
        return {row[0]: row[2] for row in self._device_rows_in_building(context, device_ids)}

    def _device_ids_of(self, circuit_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, list[uuid.UUID]]:
        result: dict[uuid.UUID, list[uuid.UUID]] = {}
        if not circuit_ids:
            return result
        for circuit_id, device_id in self.session.execute(
            select(ElectricalCircuitDevice.circuit_id, ElectricalCircuitDevice.device_id)
            .where(
                ElectricalCircuitDevice.organization_id == self.organization_id,
                ElectricalCircuitDevice.circuit_id.in_(list(circuit_ids)),
            )
            .order_by(ElectricalCircuitDevice.device_id.asc())
        ).all():
            result.setdefault(circuit_id, []).append(device_id)
        return result

    def _cables_of(self, circuit_id: uuid.UUID) -> list[ElectricalCable]:
        return list(
            self.session.execute(
                select(ElectricalCable)
                .where(
                    ElectricalCable.organization_id == self.organization_id,
                    ElectricalCable.circuit_id == circuit_id,
                )
                .order_by(ElectricalCable.id)
            ).scalars()
        )

    def _cables_at(self, board_id: uuid.UUID, device_id: uuid.UUID) -> list[ElectricalCable]:
        """Leitungen der Stromkreise dieser Verteilung mit dem Geraet als Endpunkt."""
        circuits = select(ElectricalCircuit.id).where(
            ElectricalCircuit.organization_id == self.organization_id,
            ElectricalCircuit.board_id == board_id,
        )
        return [
            cable
            for cable in self.session.execute(
                select(ElectricalCable)
                .where(
                    ElectricalCable.organization_id == self.organization_id,
                    ElectricalCable.circuit_id.in_(circuits),
                )
                .order_by(ElectricalCable.id)
            ).scalars()
            if device_id in (cable.start_device_id, cable.end_device_id)
        ]

    def _circuit_view(self, circuit: ElectricalCircuit) -> CircuitView:
        return CircuitView(circuit, tuple(self._device_ids_of([circuit.id]).get(circuit.id, [])))

    def _flush_board(self) -> None:
        with (
            unique_violation_translated(
                self.session, constraint=BOARD_CODE_CONSTRAINT, error=_code_taken()
            ),
            unique_violation_translated(
                self.session, constraint=BOARD_PLACEMENT_CONSTRAINT, error=_placement_taken()
            ),
        ):
            flush(self.session)

    def _flush_circuit(self) -> None:
        with unique_violation_translated(
            self.session, constraint=CIRCUIT_DESIGNATION_CONSTRAINT, error=_designation_taken()
        ):
            flush(self.session)


def _decimal(value: str | None) -> Decimal | None:
    return None if value is None else Decimal(value)
