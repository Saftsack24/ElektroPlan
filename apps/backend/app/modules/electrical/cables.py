"""Leitungen und Durchfuehrungen: anlegen, ersetzen, entfernen, auswerten (Phase 6b.3).

ADR 0026, Entwurf §3.2/§3.3/§5/§8. Weg, Laenge und Status berechnet
ausschliesslich :func:`~app.modules.electrical.cable_length.analyse_cable` -
hier wird nichts davon gespeichert.

**Ablauf jedes Schreibvorgangs** (eine Transaktion, "Projekt zuerst"):

1. Projektzeile sperren, Schreibschutz pruefen
   (``FloorPlanningAccess.writable_building_context`` - ``409`` bei
   ``completed``/``archived``),
2. eigene Zeile sperren und ``If-Match`` pruefen (Leitung, Stromkreis,
   Durchfuehrung),
3. den Planungsstand des Gebaeudes **frisch** lesen (``CableStateLoader``) -
   Waende, Oeffnungen, Kopplungen, Geraete, Durchfuehrungen, Steigwege,
4. Bezuege und Weg pruefen, neue Durchfuehrungen anlegen, schreiben.

**Unvollstaendig ist erlaubt, unzulaessig nicht.** Ein neuer oder geaenderter
Weg darf Teile offenlassen (Befunde der Art ``missing``: Endgeraet nicht
erreicht, Hoehenlage unbestaetigt) und wird dann ``incomplete`` gespeichert.
Ein Befund der Art ``conflict`` (schraeg, ohne Ecke, durch eine Oeffnung,
ausserhalb der Kontur, Raumwechsel ohne Uebergang ...) lehnt das Speichern mit
``422 cable-route-invalid`` ab. Ausnahme: ``riser-elevation-inconsistent`` ist
ein Befund der Geschossdaten, nicht des Wegs - die Leitung wird gespeichert und
bleibt ``conflict``. Bleiben Weg und Endgeraete einer bestehenden Leitung
unveraendert (etwa nur Kabelangaben geaendert), gilt nur: **kein neuer**
Konfliktbefund - ein bestehender Konflikt nach bestaetigter Wandaenderung wird
nicht still repariert und blockiert das Bearbeiten der Angaben nicht.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, replace
from decimal import Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.persistence import CONCURRENT_UPDATE_DETAIL, flush
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
from app.modules.electrical.cable_length import (
    AreaWaypoint,
    Cable,
    CablePenetration,
    CableResult,
    CableSegment,
    OpeningCrossingWaypoint,
    PenetrationWaypoint,
    PreparedPlan,
    ProblemKind,
    RiserWaypoint,
    WallWaypoint,
    Waypoint,
    analyse_cable,
    penetration_problem,
    prepare_plan,
    rounded_position,
    segment_points,
    shared_sources,
)
from app.modules.electrical.cable_rules import (
    BuildingCableState,
    CableGuard,
    CableStateLoader,
    cables_referencing,
    findings_of,
    in_use_error,
    to_cable,
    to_waypoint,
)
from app.modules.electrical.cabling_summary import CablingSummary, summarize
from app.modules.electrical.catalog import MountingSurface
from app.modules.electrical.distribution import circuits_of_devices
from app.modules.electrical.models import (
    ElectricalCable,
    ElectricalCableWaypoint,
    ElectricalCircuit,
    ElectricalDistributionBoard,
    ElectricalRoom,
    ElectricalWall,
    ElectricalWallLink,
    ElectricalWallPenetration,
)
from app.modules.electrical.schemas import (
    MAX_CABLES_PER_CIRCUIT,
    ApplyProposalIn,
    AreaWaypointIn,
    CableIn,
    CableWaypointIn,
    OpeningCrossingWaypointIn,
    PenetrationUpdate,
    PenetrationWaypointIn,
    RiserWaypointIn,
    WallWaypointIn,
)
from app.modules.electrical.topology import Position, transfer

#: Befund der Geschossdaten, nicht des Wegs - blockiert das Speichern nicht.
NOT_ROUTE_CODES = frozenset({"riser-elevation-inconsistent"})


class CableRepository(TenantRepository[ElectricalCable]):
    model = ElectricalCable


class CircuitRepository(TenantRepository[ElectricalCircuit]):
    model = ElectricalCircuit


class BoardRepository(TenantRepository[ElectricalDistributionBoard]):
    model = ElectricalDistributionBoard


class PenetrationRepository(TenantRepository[ElectricalWallPenetration]):
    model = ElectricalWallPenetration


@dataclass(frozen=True, slots=True)
class CableView:
    cable: ElectricalCable
    waypoints: list[ElectricalCableWaypoint]
    result: CableResult
    #: Raeumliche Punkte je Teilstrecke (dieselbe Reihenfolge wie ``result.segments``).
    points: list[tuple[tuple[int, int, int], ...]]
    deviates_from_proposal: bool


@dataclass(frozen=True, slots=True)
class PenetrationView:
    penetration: ElectricalWallPenetration
    wall_a_id: uuid.UUID
    wall_b_id: uuid.UUID
    floor_id: uuid.UUID
    opposite: Position | None
    opposite_rounded_mm: int | None
    problem_code: str | None
    cable_ids: list[uuid.UUID]


@dataclass(frozen=True, slots=True)
class CableWriteResult:
    """Was die API-Schicht fuer den Projektvermerk braucht."""

    context: BuildingPlanningContext
    changed: bool = True


def _problem(field: str, code: str, message: str, *keys: object) -> ProblemFieldError:
    return ProblemFieldError(
        field=field, code=code, message=message, keys=[str(key) for key in keys] or None
    )


def _invalid(
    detail: str, field: str, code: str, message: str, *keys: object
) -> ValidationFailedError:
    return ValidationFailedError(detail, errors=[_problem(field, code, message, *keys)])


def _spec(cable: ElectricalCable) -> tuple[str | None, int | None, Decimal | None]:
    return cable.cable_type, cable.conductor_count, cable.cross_section_mm2


def _proposal(circuit: ElectricalCircuit) -> tuple[str | None, int | None, Decimal | None]:
    return (
        circuit.proposed_cable_type,
        circuit.proposed_conductor_count,
        circuit.proposed_cross_section_mm2,
    )


def cable_view(state: BuildingCableState, cable_id: uuid.UUID) -> CableView:
    cable = state.cables[cable_id]
    result = state.results[cable_id]
    circuit = state.circuits.get(cable.circuit_id)
    return CableView(
        cable=cable,
        waypoints=state.waypoints[cable_id],
        result=result,
        points=_points(state.prepared, result.segments),
        deviates_from_proposal=circuit is not None and _spec(cable) != _proposal(circuit),
    )


def _points(
    prepared: PreparedPlan, segments: Sequence[CableSegment]
) -> list[tuple[tuple[int, int, int], ...]]:
    return [
        tuple((p.x_mm, p.y_mm, p.z_mm) for p in segment_points(prepared, segment))
        for segment in segments
    ]


class CableService:
    """Leitungen, Wegpunkte und Durchfuehrungen eines Mandanten."""

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self.session = session
        self.organization_id = organization_id
        self.cables = CableRepository(session, organization_id)
        self.circuits = CircuitRepository(session, organization_id)
        self.boards = BoardRepository(session, organization_id)
        self.penetrations = PenetrationRepository(session, organization_id)
        self.structure = FloorPlanningAccess(session, organization_id)
        self.loader = CableStateLoader(session, organization_id)
        self.guard = CableGuard(session, organization_id)

    # ------------------------------------------------------------------ Lesen

    def overview(self, building_id: uuid.UUID) -> tuple[BuildingCableState, list[CableView]]:
        """Alle Leitungen eines Gebaeudes - archivierte Projekte bleiben lesbar."""
        state = self.loader.load(building_id)
        return state, [cable_view(state, cable_id) for cable_id in state.cables]

    def cabling_summary(self, building_id: uuid.UUID) -> tuple[BuildingCableState, CablingSummary]:
        """Mengenuebersicht aus dem gespeicherten Stand - rein lesend, ein konsistenter Stand.

        Die geteilte Projektsperre haelt Schreibvorgaenge an, bis alles gelesen ist
        (``consistent_building_context``); fremdes oder unbekanntes Gebaeude: ``404``.
        Feste Zahl von Abfragen - keine Kette je Leitung.
        """
        context = self.structure.consistent_building_context(building_id)
        state = self.loader.load(context.building_id)
        assignments = circuits_of_devices(self.session, self.organization_id, state.devices)
        return state, summarize(state, assignments)

    def floor_penetrations(self, floor_id: uuid.UUID) -> list[PenetrationView]:
        context = self.structure.context(floor_id)
        state = self.loader.load(context.building_id)
        return [
            self._penetration_view(state, pid)
            for pid, pen in state.penetrations.items()
            if state.rooms[state.walls[state.links[pen.wall_link_id].wall_a_id].room_id].floor_id
            == floor_id
        ]

    # -------------------------------------------------------------- Leitungen

    def create(self, circuit_id: uuid.UUID, payload: CableIn) -> tuple[CableView, CableWriteResult]:
        circuit = self.circuits.get_or_404(circuit_id)
        board = self.boards.get_or_404(circuit.board_id)
        context = self.structure.writable_building_context(board.building_id)
        circuit = self._fresh_circuit(
            circuit_id, missing=NotFoundError("Stromkreis wurde nicht gefunden.")
        )
        count = int(
            self.session.execute(
                select(func.count())
                .select_from(ElectricalCable)
                .where(
                    ElectricalCable.organization_id == self.organization_id,
                    ElectricalCable.circuit_id == circuit.id,
                )
            ).scalar_one()
        )
        if count >= MAX_CABLES_PER_CIRCUIT:
            raise _invalid(
                f"Ein Stromkreis hat hoechstens {MAX_CABLES_PER_CIRCUIT} Leitungen.",
                "circuit",
                "circuit-cable-limit",
                "Zu viele Leitungen im Stromkreis.",
                circuit.id,
            )
        state = self.loader.load(context.building_id)
        cable_id = uuid.uuid4()
        _, new_penetrations = self._validated_target(
            state, circuit, cable_id, payload, previous=None
        )
        cable = ElectricalCable(
            id=cable_id,
            organization_id=self.organization_id,
            circuit_id=circuit.id,
            end_device_id=payload.end_device_id,
        )
        self._assign(cable, payload)
        # Neue Durchfuehrungen und ihre erste Leitung in derselben Transaktion.
        self.session.add_all(row for _, row in new_penetrations)
        flush(self.session)
        self.cables.add(cable)
        flush(self.session)
        self.session.add_all(self._rows(cable.id, payload.waypoints, dict(_keys(new_penetrations))))
        flush(self.session)
        return self._reloaded_view(context.building_id, cable.id), CableWriteResult(context=context)

    def replace(
        self, cable_id: uuid.UUID, payload: CableIn, *, expected_version: int
    ) -> tuple[CableView, CableWriteResult]:
        cable, context = self._locked_cable(cable_id, expected_version)
        circuit = self._fresh_circuit(
            cable.circuit_id, missing=VersionConflictError(CONCURRENT_UPDATE_DETAIL)
        )
        state = self.loader.load(context.building_id)
        target, new_penetrations = self._validated_target(
            state, circuit, cable.id, payload, previous=cable.id
        )
        stored = to_cable(cable, [to_waypoint(wp) for wp in state.waypoints[cable.id]])
        if target == stored and not new_penetrations and cable.label == payload.label:
            return cable_view(state, cable.id), CableWriteResult(context=context, changed=False)
        self.session.add_all(row for _, row in new_penetrations)
        flush(self.session)
        # Erst die alten Wegpunkte entfernen, dann die Leitung genau **einmal** aendern:
        # Jeder Flush mit geaenderter Zeile zaehlt die Version weiter.
        self.session.execute(
            delete(ElectricalCableWaypoint)
            .where(
                ElectricalCableWaypoint.organization_id == self.organization_id,
                ElectricalCableWaypoint.cable_id == cable.id,
            )
            .execution_options(synchronize_session=False)
        )
        self._assign(cable, payload)
        # Wegpunkte stehen unter der Leitungsversion.
        cable.updated_at = utcnow()
        self.session.add_all(self._rows(cable.id, payload.waypoints, dict(_keys(new_penetrations))))
        flush(self.session)
        return self._reloaded_view(context.building_id, cable.id), CableWriteResult(context=context)

    def delete(self, cable_id: uuid.UUID, *, expected_version: int) -> CableWriteResult:
        """Entfernt die Leitung samt Wegpunkten; genutzte Durchfuehrungen bleiben sichtbar."""
        cable, context = self._locked_cable(cable_id, expected_version)
        self.session.delete(cable)
        flush(self.session)
        return CableWriteResult(context=context)

    def apply_proposal(
        self, cable_id: uuid.UUID, payload: ApplyProposalIn, *, expected_version: int
    ) -> tuple[CableView, CableWriteResult]:
        """Uebertraegt den Stromkreisvorschlag ausdruecklich auf genau diese Leitung.

        Zwei Versionen, beide unter der Projektsperre geprueft, bevor etwas geaendert
        wird: ``expected_version`` (``If-Match``) ist die Version der Leitung,
        ``payload.expected_circuit_version`` die Version des Stromkreises, dessen
        Vorschlag der Anwender gesehen hat. Sperrreihenfolge Projekt -> Stromkreis ->
        Leitung. Uebernommen werden genau Typ, Leiterzahl und Querschnitt.
        """
        cable = self.cables.get_or_404(cable_id)
        circuit = self.circuits.get_or_404(cable.circuit_id)
        board = self.boards.get_or_404(circuit.board_id)
        context = self.structure.writable_building_context(board.building_id)
        circuit = self._fresh_circuit(
            circuit.id, missing=VersionConflictError(CONCURRENT_UPDATE_DETAIL)
        )
        locked = self.session.execute(
            select(ElectricalCable)
            .where(
                ElectricalCable.organization_id == self.organization_id,
                ElectricalCable.id == cable_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if locked is None or locked.circuit_id != circuit.id:
            raise VersionConflictError(CONCURRENT_UPDATE_DETAIL)
        if circuit.version != payload.expected_circuit_version:
            raise ConflictError(
                "Der Vorschlag des Stromkreises wurde inzwischen geaendert. Bitte neu laden und "
                "den aktuellen Vorschlag pruefen; es wurde nichts uebernommen.",
                errors=[
                    _problem(
                        "expected_circuit_version",
                        "circuit-proposal-changed",
                        "Stromkreisvorschlag geaendert.",
                        circuit.id,
                    )
                ],
            )
        check_version(locked, expected_version)
        proposal = _proposal(circuit)
        changed = _spec(locked) != proposal
        if changed:
            locked.cable_type, locked.conductor_count, locked.cross_section_mm2 = proposal
            locked.updated_at = utcnow()
            flush(self.session)
        return self._reloaded_view(context.building_id, locked.id), CableWriteResult(
            context=context, changed=changed
        )

    # ------------------------------------------------------- Durchfuehrungen

    def update_penetration(
        self, penetration_id: uuid.UUID, payload: PenetrationUpdate, *, expected_version: int
    ) -> tuple[PenetrationView, CableWriteResult]:
        penetration, context = self._locked_penetration(penetration_id, expected_version)
        changes = payload.model_dump(exclude_unset=True, exclude={"acknowledged_cable_ids"})
        if all(getattr(penetration, field) == value for field, value in changes.items()):
            state = self.loader.load(context.building_id)
            return self._penetration_view(state, penetration.id), CableWriteResult(
                context=context, changed=False
            )
        before = self.loader.load(context.building_id)
        for field, value in changes.items():
            setattr(penetration, field, value)
        flush(self.session)
        state = self.loader.load(context.building_id)
        code = state.penetration_codes[penetration.id]
        if code is not None:
            raise _invalid(
                "An dieser Stelle ist keine Durchfuehrung moeglich (aktiver gemeinsamer "
                "Wandabschnitt, unter beiden Raumhoehen, ausserhalb jeder Oeffnung). Es wurde "
                "nichts gespeichert.",
                "penetration",
                code,
                "Durchfuehrung an dieser Stelle unzulaessig.",
                penetration.id,
            )
        self.guard.require_unbroken(
            before,
            acknowledged=payload.acknowledged_cable_ids,
            acknowledgement_supported=True,
        )
        return self._penetration_view(self.loader.load(context.building_id), penetration.id), (
            CableWriteResult(context=context)
        )

    def delete_penetration(
        self, penetration_id: uuid.UUID, *, expected_version: int
    ) -> CableWriteResult:
        penetration, context = self._locked_penetration(penetration_id, expected_version)
        users = cables_referencing(
            self.session, self.organization_id, penetration_ids=[penetration.id]
        )
        if users:
            raise in_use_error(
                "Diese Durchfuehrung wird von Leitungen genutzt. Bitte zuerst den Weg der "
                "Leitungen aendern.",
                "penetration-in-use",
                "Durchfuehrung wird genutzt.",
                users,
                penetration.id,
            )
        self.session.delete(penetration)
        flush(self.session)
        return CableWriteResult(context=context)

    # ---------------------------------------------------------------- Pruefen

    def _validated_target(
        self,
        state: BuildingCableState,
        circuit: ElectricalCircuit,
        cable_id: uuid.UUID,
        payload: CableIn,
        *,
        previous: uuid.UUID | None,
    ) -> tuple[Cable, list[tuple[str, ElectricalWallPenetration]]]:
        """Endgeraete, Bezuege, neue Durchfuehrungen und Weg - vor jedem Schreiben."""
        self._require_endpoints(state, circuit, payload)
        new_rows = self._new_penetrations(state, payload)
        self._require_references(state, payload)
        rows = [row for _, row in new_rows]
        plan = state.plan
        if rows:
            plan = replace(
                plan,
                penetrations=plan.penetrations
                + tuple(
                    CablePenetration(
                        str(row.id), str(row.wall_link_id), row.offset_mm, row.height_mm
                    )
                    for row in rows
                ),
            )
        prepared = prepare_plan(plan) if rows else state.prepared
        invalid = [
            (key, code)
            for key, row in new_rows
            if (code := penetration_problem(prepared, str(row.id))) is not None
        ]
        if invalid:
            raise ValidationFailedError(
                "Eine neue Durchfuehrung ist an dieser Stelle nicht moeglich (aktiver gemeinsamer "
                "Wandabschnitt, unter beiden Raumhoehen, ausserhalb jeder Oeffnung). Es wurde "
                "nichts gespeichert.",
                errors=[
                    _problem(
                        "new_penetrations", code, "Durchfuehrung an dieser Stelle unzulaessig.", key
                    )
                    for key, code in invalid
                ],
            )
        keys = dict(_keys(new_penetrations=new_rows))
        target = Cable(
            id=str(cable_id),
            start_device_id=None
            if payload.start_device_id is None
            else str(payload.start_device_id),
            end_device_id=str(payload.end_device_id),
            waypoints=tuple(_pure_waypoint(wp, keys) for wp in payload.waypoints),
            start_allowance_mm=payload.start_allowance_mm,
            end_allowance_mm=payload.end_allowance_mm,
            reserve_mm=payload.reserve_mm,
            cable_type=payload.cable_type,
            conductor_count=payload.conductor_count,
            cross_section_mm2=None
            if payload.cross_section_mm2 is None
            else Decimal(payload.cross_section_mm2),
        )
        result = analyse_cable(prepared, target)
        conflicts = [
            p
            for p in result.problems
            if p.kind is ProblemKind.CONFLICT and p.code not in NOT_ROUTE_CODES
        ]
        if previous is not None:
            stored = state.cables[previous]
            unchanged_route = (
                str(stored.end_device_id) == target.end_device_id
                and (None if stored.start_device_id is None else str(stored.start_device_id))
                == target.start_device_id
                and tuple(to_waypoint(wp) for wp in state.waypoints[previous]) == target.waypoints
            )
            if unchanged_route:
                existing = findings_of(state.results[previous])
                conflicts = [p for p in conflicts if (p.code, p.ref) not in existing]
        if conflicts:
            raise ValidationFailedError(
                "Der Leitungsweg ist so nicht zulaessig. Unvollstaendige Wege duerfen gespeichert "
                "werden, unzulaessige Strecken nicht. Es wurde nichts gespeichert.",
                errors=[
                    ProblemFieldError(
                        field="waypoints",
                        code=problem.code,
                        message=f"{_ref_label(problem.ref)}: {problem.message}",
                        keys=[problem.ref],
                    )
                    for problem in conflicts
                ],
            )
        return target, new_rows

    def _require_endpoints(
        self, state: BuildingCableState, circuit: ElectricalCircuit, payload: CableIn
    ) -> None:
        board = state.boards.get(circuit.board_id)
        placement = None if board is None else board.placement_device_id
        if payload.start_device_id is None:
            if placement is not None:
                raise _invalid(
                    "Die Verteilung dieses Stromkreises ist platziert - bitte ihr Lagegeraet "
                    "oder ein Geraet des Stromkreises als Startpunkt angeben.",
                    "start_device_id",
                    "cable-start-required",
                    "Startgeraet fehlt.",
                )
        elif payload.start_device_id == payload.end_device_id:
            raise _invalid(
                "Start- und Endgeraet einer Leitung sind verschieden.",
                "end_device_id",
                "cable-endpoints-equal",
                "Gleiches Start- und Endgeraet.",
                payload.end_device_id,
            )
        endpoints = [item for item in (payload.start_device_id, payload.end_device_id) if item]
        unknown = [item for item in endpoints if item not in state.devices]
        if unknown:
            # Fremder Mandant, anderes Gebaeude und unbekannte ID: dieselbe Antwort.
            raise _invalid(
                "Ein Endgeraet gehoert nicht zu diesem Gebaeude. Es wurde nichts gespeichert.",
                "end_device_id",
                "cable-endpoint-not-in-building",
                "Endgeraet nicht in diesem Gebaeude.",
                *unknown,
            )
        assigned = circuits_of_devices(self.session, self.organization_id, endpoints)
        foreign = [
            item for item in endpoints if item != placement and assigned.get(item) != circuit.id
        ]
        if foreign:
            raise _invalid(
                "Endgeraete einer Leitung sind die Lage der Verteilung oder Geraete, die diesem "
                "Stromkreis zugeordnet sind. Es wurde nichts gespeichert.",
                "end_device_id",
                "cable-endpoint-not-in-circuit",
                "Endgeraet gehoert nicht zu diesem Stromkreis.",
                *foreign,
            )
        exterior = [
            item
            for item in endpoints
            if state.devices[item].mounting_surface == MountingSurface.WALL_EXTERIOR.value
        ]
        if exterior:
            raise _invalid(
                "Aussen montierte Geraete werden in dieser Version nicht angeschlossen "
                "(Aussenleitungen folgen spaeter). Es wurde nichts gespeichert.",
                "end_device_id",
                "cable-endpoint-exterior",
                "Endgeraet aussen montiert.",
                *exterior,
            )

    def _new_penetrations(
        self, state: BuildingCableState, payload: CableIn
    ) -> list[tuple[str, ElectricalWallPenetration]]:
        keys = [item.key for item in payload.new_penetrations]
        doubled = sorted({key for key in keys if keys.count(key) > 1})
        if doubled:
            raise _invalid(
                "Ein Schluessel einer neuen Durchfuehrung ist doppelt.",
                "new_penetrations",
                "penetration-key-duplicate",
                "Schluessel doppelt.",
                *doubled,
            )
        used = {
            wp.new_penetration_key
            for wp in payload.waypoints
            if isinstance(wp, PenetrationWaypointIn) and wp.new_penetration_key is not None
        }
        unknown = sorted(used - set(keys))
        if unknown:
            raise _invalid(
                "Ein Wegpunkt verweist auf eine neue Durchfuehrung, die nicht angegeben ist.",
                "waypoints",
                "penetration-key-unknown",
                "Neue Durchfuehrung fehlt.",
                *unknown,
            )
        unused = sorted(set(keys) - used)
        if unused:
            raise _invalid(
                "Eine neue Durchfuehrung entsteht nur mit der Leitung, die sie nutzt.",
                "new_penetrations",
                "penetration-unused",
                "Neue Durchfuehrung wird nicht genutzt.",
                *unused,
            )
        foreign = [
            item.key for item in payload.new_penetrations if item.wall_link_id not in state.links
        ]
        if foreign:
            raise _invalid(
                "Eine Wandkopplung gehoert nicht zu diesem Gebaeude.",
                "new_penetrations",
                "penetration-link-not-in-building",
                "Wandkopplung nicht in diesem Gebaeude.",
                *foreign,
            )
        return [
            (
                item.key,
                ElectricalWallPenetration(
                    id=uuid.uuid4(),
                    organization_id=self.organization_id,
                    wall_link_id=item.wall_link_id,
                    offset_mm=item.offset_mm,
                    height_mm=item.height_mm,
                    note=item.note,
                ),
            )
            for item in payload.new_penetrations
        ]

    def _require_references(self, state: BuildingCableState, payload: CableIn) -> None:
        """Jeder Bezug eines Wegpunkts liegt in diesem Gebaeude; Halte gehoeren zum Steigweg."""
        openings = {o.id for items in state.openings.values() for o in items}
        unknown: list[str] = []
        for index, wp in enumerate(payload.waypoints):
            ok = True
            if isinstance(wp, WallWaypointIn):
                ok = wp.wall_id in state.walls
            elif isinstance(wp, AreaWaypointIn):
                ok = wp.room_id in state.rooms
            elif isinstance(wp, PenetrationWaypointIn):
                ok = wp.penetration_id in state.penetrations if wp.penetration_id else True
            elif isinstance(wp, OpeningCrossingWaypointIn):
                ok = wp.wall_id in state.walls and (
                    wp.opening_id is None or wp.opening_id in openings
                )
            else:
                stops = state.stops
                ok = (
                    wp.riser_id in state.risers
                    and wp.from_stop_id in stops
                    and wp.to_stop_id in stops
                    and stops[wp.from_stop_id].riser_id == wp.riser_id
                    and stops[wp.to_stop_id].riser_id == wp.riser_id
                )
            if not ok:
                unknown.append(f"w{index}")
        if unknown:
            raise _invalid(
                "Ein Wegpunkt verweist auf eine Wand, einen Raum, eine Oeffnung, eine "
                "Durchfuehrung oder einen Steigweghalt, der nicht zu diesem Gebaeude bzw. "
                "Steigweg gehoert. Es wurde nichts gespeichert.",
                "waypoints",
                "cable-reference-unknown",
                "Bezug nicht in diesem Gebaeude.",
                *unknown,
            )

    # ---------------------------------------------------------------- Helfer

    def _assign(self, cable: ElectricalCable, payload: CableIn) -> None:
        cable.label = payload.label
        cable.start_device_id = payload.start_device_id
        cable.end_device_id = payload.end_device_id
        cable.cable_type = payload.cable_type
        cable.conductor_count = payload.conductor_count
        cable.cross_section_mm2 = (
            None if payload.cross_section_mm2 is None else Decimal(payload.cross_section_mm2)
        )
        cable.start_allowance_mm = payload.start_allowance_mm
        cable.end_allowance_mm = payload.end_allowance_mm
        cable.reserve_mm = payload.reserve_mm

    def _rows(
        self,
        cable_id: uuid.UUID,
        waypoints: Sequence[CableWaypointIn],
        keys: dict[str, uuid.UUID],
    ) -> list[ElectricalCableWaypoint]:
        """Wegpunktzeilen in Leitungsrichtung; neue Durchfuehrungen ueber ihren Schluessel."""
        rows: list[ElectricalCableWaypoint] = []
        for seq, wp in enumerate(waypoints):
            row = ElectricalCableWaypoint(
                id=uuid.uuid4(),
                organization_id=self.organization_id,
                cable_id=cable_id,
                seq=seq,
                kind=wp.kind,
            )
            if isinstance(wp, WallWaypointIn):
                row.wall_id, row.offset_mm, row.height_mm = wp.wall_id, wp.offset_mm, wp.height_mm
            elif isinstance(wp, AreaWaypointIn):
                row.room_id, row.x_mm, row.y_mm = wp.room_id, wp.x_mm, wp.y_mm
            elif isinstance(wp, PenetrationWaypointIn):
                row.penetration_id = wp.penetration_id or keys[wp.new_penetration_key or ""]
            elif isinstance(wp, OpeningCrossingWaypointIn):
                row.wall_id, row.offset_mm, row.opening_id = wp.wall_id, wp.offset_mm, wp.opening_id
            else:
                row.riser_id = wp.riser_id
                row.from_stop_id, row.from_height_mm = wp.from_stop_id, wp.from_height_mm
                row.to_stop_id, row.to_height_mm = wp.to_stop_id, wp.to_height_mm
            rows.append(row)
        return rows

    def _reloaded_view(self, building_id: uuid.UUID, cable_id: uuid.UUID) -> CableView:
        return cable_view(self.loader.load(building_id), cable_id)

    def _fresh_circuit(self, circuit_id: uuid.UUID, *, missing: Exception) -> ElectricalCircuit:
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
            raise missing
        return locked

    def _locked_cable(
        self, cable_id: uuid.UUID, expected_version: int
    ) -> tuple[ElectricalCable, BuildingPlanningContext]:
        cable = self.cables.get_or_404(cable_id)
        circuit = self.circuits.get_or_404(cable.circuit_id)
        board = self.boards.get_or_404(circuit.board_id)
        context = self.structure.writable_building_context(board.building_id)
        locked = self.session.execute(
            select(ElectricalCable)
            .where(
                ElectricalCable.organization_id == self.organization_id,
                ElectricalCable.id == cable_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if locked is None:
            raise VersionConflictError(CONCURRENT_UPDATE_DETAIL)
        check_version(locked, expected_version)
        return locked, context

    def _locked_penetration(
        self, penetration_id: uuid.UUID, expected_version: int
    ) -> tuple[ElectricalWallPenetration, BuildingPlanningContext]:
        penetration = self.penetrations.get_or_404(penetration_id)
        building_id = self._building_of_link(penetration.wall_link_id)
        context = self.structure.writable_building_context(building_id)
        locked = self.session.execute(
            select(ElectricalWallPenetration)
            .where(
                ElectricalWallPenetration.organization_id == self.organization_id,
                ElectricalWallPenetration.id == penetration_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if locked is None:
            raise VersionConflictError(CONCURRENT_UPDATE_DETAIL)
        check_version(locked, expected_version)
        return locked, context

    def _building_of_link(self, link_id: uuid.UUID) -> uuid.UUID:
        floor_id = self.session.execute(
            select(ElectricalRoom.floor_id)
            .join(
                ElectricalWall,
                (ElectricalWall.organization_id == ElectricalRoom.organization_id)
                & (ElectricalWall.room_id == ElectricalRoom.id),
            )
            .join(
                ElectricalWallLink,
                (ElectricalWallLink.organization_id == ElectricalWall.organization_id)
                & (ElectricalWallLink.wall_a_id == ElectricalWall.id),
            )
            .where(
                ElectricalWallLink.organization_id == self.organization_id,
                ElectricalWallLink.id == link_id,
            )
        ).scalar_one_or_none()
        if floor_id is None:
            raise NotFoundError("Durchfuehrung wurde nicht gefunden.")
        return self.structure.context(floor_id).building_id

    def _penetration_view(
        self, state: BuildingCableState, penetration_id: uuid.UUID
    ) -> PenetrationView:
        pen = state.penetrations[penetration_id]
        link = state.links[pen.wall_link_id]
        wall_a = state.walls[link.wall_a_id]
        floor_id = state.rooms[wall_a.room_id].floor_id
        opposite: Position | None = None
        rounded: int | None = None
        topo = next((li for li in state.plan.links if li.id == str(link.id)), None)
        if topo is not None:
            pair = shared_sources(state.prepared, topo, Position(pen.offset_mm))
            if pair is not None:
                measure = state.prepared.walls[str(link.wall_a_id)].item.measure
                opposite = transfer(Position(pen.offset_mm), pair[0], pair[1], measure)
                rounded = rounded_position(opposite, measure)
        users = sorted(
            {
                cable_id
                for cable_id, rows in state.waypoints.items()
                for row in rows
                if row.penetration_id == penetration_id
            },
            key=str,
        )
        return PenetrationView(
            penetration=pen,
            wall_a_id=link.wall_a_id,
            wall_b_id=link.wall_b_id,
            floor_id=floor_id,
            opposite=opposite,
            opposite_rounded_mm=rounded,
            problem_code=state.penetration_codes.get(penetration_id),
            cable_ids=users,
        )


def _keys(
    new_penetrations: Sequence[tuple[str, ElectricalWallPenetration]],
) -> list[tuple[str, uuid.UUID]]:
    return [(key, row.id) for key, row in new_penetrations]


def _pure_waypoint(wp: CableWaypointIn, keys: dict[str, uuid.UUID]) -> Waypoint:
    """Eingabe als Wegpunkt der reinen Funktion - neue Durchfuehrungen mit ihrer neuen ID."""
    if isinstance(wp, WallWaypointIn):
        return WallWaypoint(str(wp.wall_id), wp.offset_mm, wp.height_mm)
    if isinstance(wp, AreaWaypointIn):
        return AreaWaypoint(wp.kind, str(wp.room_id), wp.x_mm, wp.y_mm)
    if isinstance(wp, PenetrationWaypointIn):
        target = wp.penetration_id or keys[wp.new_penetration_key or ""]
        return PenetrationWaypoint(str(target))
    if isinstance(wp, OpeningCrossingWaypointIn):
        return OpeningCrossingWaypoint(
            str(wp.wall_id), wp.offset_mm, None if wp.opening_id is None else str(wp.opening_id)
        )
    assert isinstance(wp, RiserWaypointIn)
    return RiserWaypoint(
        str(wp.riser_id), wp.from_stop_id, wp.from_height_mm, wp.to_stop_id, wp.to_height_mm
    )


def _ref_label(ref: str) -> str:
    if ref == "start":
        return "Anschluss am Startgeraet"
    if ref == "end":
        return "Anschluss am Endgeraet"
    if ref == "route":
        return "Weg"
    if "-" in ref:
        first, second = ref.split("-", 1)
        return f"Strecke Wegpunkt {int(first[1:]) + 1} bis {int(second[1:]) + 1}"
    return f"Wegpunkt {int(ref[1:]) + 1}"
