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

**Vorgaben und Herkunft** (Phase 6c, V1, ADR 0027): Je Wertegruppe (Kabelangaben,
Reserve, Anschlusszugaben) speichert die Leitung ihre tatsaechlichen Werte und deren
Herkunft. Mit ``*_source = defaults`` loest der Server die Vorgabenkette selbst auf
(:mod:`defaults_chain`); die gesendeten Werte und die Vorgabenbasis muessen dem aktuellen
Stand gleichen, sonst ``409 planning-defaults-changed`` - nichts gespeichert. Die Herkunft
wird nie ungeprueft aus der Anfrage uebernommen. Sperren: Projekt -> Vorgabensperre
(geteilt, :func:`planning_defaults.lock_defaults`) -> Stromkreis -> Leitung.

**Ausdrueckliche Zuordnung beim Speichern** (``assign_devices``): Endgeraete dieser
Leitung, die noch keinem Stromkreis zugeordnet sind, werden in derselben Transaktion
diesem Stromkreis zugeordnet - mit Pruefung der Stromkreisversion, nie umgehaengt. Eine
reine Leitungsaenderung aendert keine Zuordnung.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, replace
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
from app.modules.electrical.catalog import ASSIGNABLE_CATEGORIES, MountingSurface
from app.modules.electrical.defaults_chain import (
    Endpoint,
    resolve_allowances,
    resolve_reserve,
    resolve_spec,
)
from app.modules.electrical.distribution import circuits_of_devices
from app.modules.electrical.models import (
    CIRCUIT_DEVICE_PK,
    ElectricalCable,
    ElectricalCableWaypoint,
    ElectricalCircuit,
    ElectricalCircuitDevice,
    ElectricalDistributionBoard,
    ElectricalRoom,
    ElectricalWall,
    ElectricalWallLink,
    ElectricalWallPenetration,
)
from app.modules.electrical.planning_defaults import (
    PlanningDefaultsChangedError,
    PlanningDefaultsService,
    circuit_proposal,
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
#: Herkuenfte aus der Vorgabenkette (alles ausser ``manual`` und ``legacy``).
DEFAULTS_ORIGINS = frozenset(
    {
        "circuit_override",
        "device_type_template",
        "default_template",
        "project_default",
        "office_default",
        "none",
    }
)


@dataclass(frozen=True, slots=True)
class StoredValues:
    """Was an der Leitung gespeichert wird: Werte je Gruppe, Herkunft, Vorgabenbasis."""

    cable_type: str | None
    conductor_count: int | None
    cross_section_mm2: Decimal | None
    spec_origin: str
    cable_template_id: uuid.UUID | None
    cable_template_version: int | None
    reserve_mode: str
    reserve_mm: int
    reserve_percent: Decimal | None
    reserve_origin: str
    start_allowance_mm: int
    end_allowance_mm: int
    allowance_origin: str
    defaults_office_version: int | None
    defaults_project_version: int | None


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
        assigning = self._assignments(state, circuit, payload)
        values = self._values(context, state, circuit, payload, stored=None)
        _, new_penetrations = self._validated_target(
            state, circuit, cable_id, payload, values, previous=None, assigning=assigning
        )
        cable = ElectricalCable(
            id=cable_id,
            organization_id=self.organization_id,
            circuit_id=circuit.id,
            end_device_id=payload.end_device_id,
        )
        self._assign(cable, payload, values)
        self._assign_devices(circuit, assigning)
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
        assigning = self._assignments(state, circuit, payload)
        values = self._values(context, state, circuit, payload, stored=cable)
        target, new_penetrations = self._validated_target(
            state, circuit, cable.id, payload, values, previous=cable.id, assigning=assigning
        )
        stored = to_cable(cable, [to_waypoint(wp) for wp in state.waypoints[cable.id]])
        if (
            target == stored
            and not new_penetrations
            and not assigning
            and cable.label == payload.label
            and _stored_values(cable) == values
        ):
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
        self._assign(cable, payload, values)
        self._assign_devices(circuit, assigning)
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
            # Ausdrueckliche Einzelaktion (6b): die Angaben sind damit bewusst gewaehlt.
            locked.spec_origin = "manual"
            locked.cable_template_id = None
            locked.cable_template_version = None
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
        values: StoredValues,
        *,
        previous: uuid.UUID | None,
        assigning: Sequence[uuid.UUID] = (),
    ) -> tuple[Cable, list[tuple[str, ElectricalWallPenetration]]]:
        """Endgeraete, Bezuege, neue Durchfuehrungen und Weg - vor jedem Schreiben."""
        self._require_endpoints(state, circuit, payload, assigning)
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
            end_device_id=None if payload.end_device_id is None else str(payload.end_device_id),
            waypoints=tuple(_pure_waypoint(wp, keys) for wp in payload.waypoints),
            start_allowance_mm=values.start_allowance_mm,
            end_allowance_mm=values.end_allowance_mm,
            reserve_mm=values.reserve_mm,
            cable_type=values.cable_type,
            conductor_count=values.conductor_count,
            cross_section_mm2=values.cross_section_mm2,
            reserve_mode=values.reserve_mode,
            reserve_percent=values.reserve_percent,
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
                (None if stored.end_device_id is None else str(stored.end_device_id))
                == target.end_device_id
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
        self,
        state: BuildingCableState,
        circuit: ElectricalCircuit,
        payload: CableIn,
        assigning: Sequence[uuid.UUID] = (),
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
            item
            for item in endpoints
            if item != placement and assigned.get(item) != circuit.id and item not in assigning
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

    def _assign(self, cable: ElectricalCable, payload: CableIn, values: StoredValues) -> None:
        cable.label = payload.label
        cable.start_device_id = payload.start_device_id
        cable.end_device_id = payload.end_device_id
        cable.cable_type = values.cable_type
        cable.conductor_count = values.conductor_count
        cable.cross_section_mm2 = values.cross_section_mm2
        cable.spec_origin = values.spec_origin
        cable.cable_template_id = values.cable_template_id
        cable.cable_template_version = values.cable_template_version
        cable.reserve_mode = values.reserve_mode
        cable.reserve_mm = values.reserve_mm
        cable.reserve_percent = values.reserve_percent
        cable.reserve_origin = values.reserve_origin
        cable.start_allowance_mm = values.start_allowance_mm
        cable.end_allowance_mm = values.end_allowance_mm
        cable.allowance_origin = values.allowance_origin
        cable.defaults_office_version = values.defaults_office_version
        cable.defaults_project_version = values.defaults_project_version

    # ------------------------------------------------- Vorgaben und Zuordnung (6c, V1)

    def _values(
        self,
        context: BuildingPlanningContext,
        state: BuildingCableState,
        circuit: ElectricalCircuit,
        payload: CableIn,
        *,
        stored: ElectricalCable | None,
    ) -> StoredValues:
        """Werte und Herkunft je Gruppe - mit Vorgabenherkunft gegen den aktuellen Stand geprueft.

        ``defaults``: Der Server loest die Kette auf; gesendete Werte und Vorgabenbasis
        muessen gleichen, sonst ``409 planning-defaults-changed``. ``manual``: die Werte der
        Anfrage, Herkunft ``manual``. Ohne Angabe (bisherige Clients): unveraenderte Werte
        behalten ihre gespeicherte Herkunft (``legacy`` bleibt ``legacy``), geaenderte
        werden ``manual``.
        """
        cross = None if payload.cross_section_mm2 is None else Decimal(payload.cross_section_mm2)
        spec_in = (payload.cable_type, payload.conductor_count, cross)
        percent_in = None if payload.reserve_percent is None else Decimal(payload.reserve_percent)
        reserve_in = (payload.reserve_mode, payload.reserve_mm, percent_in)
        allowance_in = (payload.start_allowance_mm, payload.end_allowance_mm)
        sources = (payload.spec_source, payload.reserve_source, payload.allowance_source)

        # Gespeicherter Stand je Gruppe (nur beim Ersetzen).
        stored_spec = None if stored is None else _spec(stored)
        stored_reserve = (
            None
            if stored is None
            else (stored.reserve_mode, stored.reserve_mm, stored.reserve_percent)
        )
        stored_allowance = (
            None if stored is None else (stored.start_allowance_mm, stored.end_allowance_mm)
        )

        def kept(source: str | None, current: object, before: object) -> bool:
            return source is None and stored is not None and current == before

        spec_origin = "manual"
        template_id: uuid.UUID | None = None
        template_version: int | None = None
        reserve_origin = "manual"
        allowance_origin = "manual"
        office_version: int | None = None
        project_version: int | None = None

        if stored is not None and kept(payload.spec_source, spec_in, stored_spec):
            spec_origin = stored.spec_origin
            template_id, template_version = stored.cable_template_id, stored.cable_template_version
        if stored is not None and kept(payload.reserve_source, reserve_in, stored_reserve):
            reserve_origin = stored.reserve_origin
        if stored is not None and kept(payload.allowance_source, allowance_in, stored_allowance):
            allowance_origin = stored.allowance_origin

        if "defaults" in sources:
            basis = payload.defaults_basis
            assert basis is not None  # Schema: Pflicht bei Vorgabenherkunft
            office, project, data = PlanningDefaultsService(
                self.session, self.organization_id
            ).locked_input(context.project_id)
            errors: list[ProblemFieldError] = []
            if basis.office_version != office.version:
                errors.append(
                    _problem(
                        "defaults_basis.office_version",
                        "planning-defaults-changed",
                        f"Betriebsstandard geaendert (gelesen {basis.office_version}, "
                        f"jetzt {office.version}).",
                    )
                )
            if basis.project_version != project.version:
                errors.append(
                    _problem(
                        "defaults_basis.project_version",
                        "planning-defaults-changed",
                        f"Projektvorgabe geaendert (gelesen {basis.project_version}, "
                        f"jetzt {project.version}).",
                    )
                )
            start = _endpoint(state, payload.start_device_id)
            end = _endpoint(state, payload.end_device_id)
            if payload.spec_source == "defaults":
                spec = resolve_spec(data, circuit_proposal(circuit), start, end)
                if spec.values != spec_in:
                    errors.append(
                        _problem(
                            "cable_type",
                            "planning-defaults-changed",
                            f"Kabelangaben aus Vorgaben jetzt: {_spec_text(*spec.values)}.",
                        )
                    )
                used = spec.template
                if (basis.cable_template_id, basis.cable_template_version) != (
                    None if used is None else used.id,
                    None if used is None else used.version,
                ):
                    errors.append(
                        _problem(
                            "defaults_basis.cable_template_version",
                            "planning-defaults-changed",
                            "Die Kabelvorlage der Vorgabe wurde geaendert oder ist eine andere.",
                            *([] if used is None else [used.id]),
                        )
                    )
                if spec.origin == "circuit_override" and basis.circuit_version != circuit.version:
                    errors.append(
                        _problem(
                            "defaults_basis.circuit_version",
                            "planning-defaults-changed",
                            "Die aktivierte Stromkreisvorgabe wurde geaendert.",
                            circuit.id,
                        )
                    )
                spec_origin = spec.origin
                template_id = None if used is None else used.id
                template_version = None if used is None else used.version
            if payload.reserve_source == "defaults":
                reserve = resolve_reserve(data)
                if reserve_in != ("percent", 0, reserve.percent):
                    errors.append(
                        _problem(
                            "reserve_percent",
                            "planning-defaults-changed",
                            f"Reserve aus Vorgaben jetzt: {reserve.percent} %.",
                        )
                    )
                reserve_origin = reserve.origin
            if payload.allowance_source == "defaults":
                allowance = resolve_allowances(data, start, end)
                if allowance_in != (allowance.start_mm, allowance.end_mm):
                    errors.append(
                        _problem(
                            "start_allowance_mm",
                            "planning-defaults-changed",
                            f"Anschlusszugaben aus Vorgaben jetzt: Start {allowance.start_mm} mm, "
                            f"Ende {allowance.end_mm} mm.",
                        )
                    )
                allowance_origin = allowance.origin
            if errors:
                raise PlanningDefaultsChangedError(
                    "Die Planungsvorgaben wurden seit dem Lesen geaendert. Bitte die neuen "
                    "Vorgaben uebernehmen oder die bisherigen Werte als Abweichung behalten. Es "
                    "wurde nichts gespeichert.",
                    errors=errors,
                )
            office_version, project_version = office.version, project.version
        elif (
            stored is not None
            and {spec_origin, reserve_origin, allowance_origin} & DEFAULTS_ORIGINS
        ):
            # Unveraenderte Gruppen aus Vorgaben behalten die Basis, mit der sie entstanden.
            office_version = stored.defaults_office_version
            project_version = stored.defaults_project_version

        if payload.spec_source == "manual":
            spec_origin, template_id, template_version = "manual", None, None
        if payload.reserve_source == "manual":
            reserve_origin = "manual"
        if payload.allowance_source == "manual":
            allowance_origin = "manual"
        return StoredValues(
            cable_type=spec_in[0],
            conductor_count=spec_in[1],
            cross_section_mm2=spec_in[2],
            spec_origin=spec_origin,
            cable_template_id=template_id,
            cable_template_version=template_version,
            reserve_mode=payload.reserve_mode,
            reserve_mm=payload.reserve_mm,
            reserve_percent=percent_in,
            reserve_origin=reserve_origin,
            start_allowance_mm=payload.start_allowance_mm,
            end_allowance_mm=payload.end_allowance_mm,
            allowance_origin=allowance_origin,
            defaults_office_version=office_version,
            defaults_project_version=project_version,
        )

    def _assignments(
        self, state: BuildingCableState, circuit: ElectricalCircuit, payload: CableIn
    ) -> list[uuid.UUID]:
        """Ausdrueckliche Zuordnung beim Speichern: Pruefung vor jedem Schreiben.

        Nur Endgeraete dieser Leitung, im Gebaeude, zuordenbare Kategorie, noch keinem
        anderen Stromkreis zugeordnet; Stromkreisversion wie gelesen. Liefert die Geraete,
        die tatsaechlich neu zugeordnet werden (bereits diesem Stromkreis zugeordnete nicht).
        """
        wanted = list(payload.assign_devices)
        if not wanted:
            return []
        if circuit.version != payload.expected_circuit_version:
            raise ConflictError(
                "Der Stromkreis wurde inzwischen geaendert. Bitte neu laden; es wurde nichts "
                "gespeichert und nichts zugeordnet.",
                errors=[
                    _problem(
                        "expected_circuit_version",
                        "circuit-version-changed",
                        "Stromkreis geaendert.",
                        circuit.id,
                    )
                ],
            )
        endpoints = {payload.start_device_id, payload.end_device_id} - {None}
        not_endpoint = [item for item in wanted if item not in endpoints]
        if not_endpoint:
            raise _invalid(
                "Zugeordnet werden beim Speichern nur Endgeraete dieser Leitung.",
                "assign_devices",
                "assign-device-not-endpoint",
                "Geraet ist kein Endgeraet dieser Leitung.",
                *not_endpoint,
            )
        unknown = [item for item in wanted if item not in state.devices]
        if unknown:
            raise _invalid(
                "Ein Endgeraet gehoert nicht zu diesem Gebaeude. Es wurde nichts gespeichert.",
                "assign_devices",
                "cable-endpoint-not-in-building",
                "Endgeraet nicht in diesem Gebaeude.",
                *unknown,
            )
        not_assignable = [
            item
            for item in wanted
            if (kind := state.types.get(state.devices[item].device_type_key)) is None
            or kind.category not in ASSIGNABLE_CATEGORIES
        ]
        if not_assignable:
            raise _invalid(
                "Nur Steckdosen, Schalter, Leuchten und Abzweigdosen lassen sich einem "
                "Stromkreis zuordnen - keine Datendosen und nicht das Lagegeraet einer "
                "Verteilung. Es wurde nichts gespeichert.",
                "assign_devices",
                "circuit-device-not-assignable",
                "Geraetetyp nicht zuordenbar.",
                *not_assignable,
            )
        current = circuits_of_devices(self.session, self.organization_id, wanted)
        elsewhere = [item for item in wanted if current.get(item, circuit.id) != circuit.id]
        if elsewhere:
            raise _assigned_elsewhere(*elsewhere)
        return [item for item in wanted if item not in current]

    def _assign_devices(self, circuit: ElectricalCircuit, devices: Sequence[uuid.UUID]) -> None:
        if not devices:
            return
        self.session.add_all(
            ElectricalCircuitDevice(
                organization_id=self.organization_id, device_id=device_id, circuit_id=circuit.id
            )
            for device_id in sorted(devices, key=str)
        )
        # Die Zuordnung steht unter der Stromkreisversion.
        circuit.updated_at = utcnow()
        with unique_violation_translated(
            self.session, constraint=CIRCUIT_DEVICE_PK, error=_assigned_elsewhere(*devices)
        ):
            flush(self.session)

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


def _stored_values(cable: ElectricalCable) -> StoredValues:
    return StoredValues(
        cable_type=cable.cable_type,
        conductor_count=cable.conductor_count,
        cross_section_mm2=cable.cross_section_mm2,
        spec_origin=cable.spec_origin,
        cable_template_id=cable.cable_template_id,
        cable_template_version=cable.cable_template_version,
        reserve_mode=cable.reserve_mode,
        reserve_mm=cable.reserve_mm,
        reserve_percent=cable.reserve_percent,
        reserve_origin=cable.reserve_origin,
        start_allowance_mm=cable.start_allowance_mm,
        end_allowance_mm=cable.end_allowance_mm,
        allowance_origin=cable.allowance_origin,
        defaults_office_version=cable.defaults_office_version,
        defaults_project_version=cable.defaults_project_version,
    )


def _endpoint(state: BuildingCableState, device_id: uuid.UUID | None) -> Endpoint | None:
    """Endgeraet als Endpunkt der Vorgabenkette (unbekannt: ``None``, Pruefung folgt)."""
    if device_id is None:
        return None
    device = state.devices.get(device_id)
    if device is None:
        return None
    kind = state.types.get(device.device_type_key)
    return Endpoint(device_id, device.device_type_key, "" if kind is None else kind.category)


def _spec_text(cable_type: str | None, count: int | None, cross: Decimal | None) -> str:
    if cable_type is None and count is None and cross is None:
        return "keine Angaben"
    parts = [
        cable_type or "?",
        f"{count if count is not None else '?'}x{cross if cross is not None else '?'}",
    ]
    return " ".join(parts)


def _assigned_elsewhere(*keys: uuid.UUID) -> ConflictError:
    return ConflictError(
        "Mindestens ein Geraet ist bereits einem anderen Stromkreis zugeordnet. Es wird nicht "
        "still umgehaengt - bitte dort zuerst entfernen. Es wurde nichts gespeichert.",
        errors=[
            _problem(
                "assign_devices",
                "device-assigned-elsewhere",
                "Geraet ist einem anderen Stromkreis zugeordnet.",
                *keys,
            )
        ],
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
