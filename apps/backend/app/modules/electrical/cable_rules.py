"""Leitungsregeln im Service: Planungsstand laden, Leitungen pruefen, Befunde vergleichen.

Phase 6b.3 (ADR 0026, Entwurf §7). Die Berechnung selbst ist rein
(``cable_length.py``); hier werden gespeicherte Zeilen eines **Gebaeudes** in
deren Eingabe uebersetzt und die Befunde verstaendlich benannt. Gebaeude, weil
Leitungen ueber Steigwege mehrere Geschosse verbinden.

**"Nichts bricht unbemerkt."** Jeder Schreibweg mit Wirkung auf Leitungswege
haelt unter der Projektsperre den Stand vorher fest (:meth:`CableGuard.snapshot`)
und vergleicht ihn nach dem Schreiben (:meth:`CableGuard.require_unbroken`):

1. **Durchfuehrungen - hart:** Wird eine bisher gueltige Durchfuehrung
   ungueltig (Abschnitt nicht mehr ``shared``/aktiv, ueber einer Raumhoehe, in
   einer Oeffnung), lehnt der Server mit ``422`` ab. Keine Bestaetigung moeglich.
2. **Vorgangsbezogen hart:** Codes, die der Aufrufer nennt (``hard_codes``,
   etwa Wandpunkt ueber einer abgesenkten Raumhoehe), und - mit
   ``opening_rule`` - eine Oeffnung, die neu ueber einer Wandstrecke oder einem
   Wegpunkt liegt (``422 opening-over-cable``, Entwurf §7 "Oeffnung so setzen").
3. **Leitungen - mit genauer Bestaetigung:** Jede Leitung mit einem **neuen**
   Befund (Code und Ort, der vorher fehlte) ist betroffen. Gespeichert wird nur,
   wenn ``acknowledged_cable_ids`` **genau** diese Leitungen nennt - sonst
   ``409 cables-would-break`` mit der verstaendlichen Liste (Stromkreis,
   Bezeichnung, Endgeraete, Grund). Doppelte IDs sind ``422``; fremde, veraltete
   oder nicht betroffene IDs machen die Bestaetigung ungueltig (``409``, je ID
   ``cable-not-affected``) - eine Bestaetigung ist keine Pauschalerlaubnis.

Nichts wird verschoben, umgehaengt oder geloescht; die Leitung ist danach
``conflict`` und hat keine Laenge (D4).
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Protocol

from sqlalchemy import ColumnElement, Select, func, or_, select
from sqlalchemy.orm import Session

from app.core.projects.planning import BuildingPlanningContext, FloorPlanningAccess
from app.db.mixins import utcnow
from app.errors import ConflictError, ProblemFieldError, ValidationFailedError
from app.modules.electrical.cable_length import (
    AreaWaypoint,
    Cable,
    CableDevice,
    CableOpening,
    CablePenetration,
    CablePlan,
    CableResult,
    CableRiser,
    CableRoom,
    CableWall,
    OpeningCrossingWaypoint,
    PenetrationWaypoint,
    PreparedPlan,
    RiserWaypoint,
    WallWaypoint,
    Waypoint,
    analyse_cable,
    penetration_problem,
    prepare_plan,
    wall_axis_point,
)
from app.modules.electrical.device_rules import load_device_types, room_label, topo_link
from app.modules.electrical.geometry import Point, segment_length_mm
from app.modules.electrical.models import (
    ElectricalCable,
    ElectricalCableWaypoint,
    ElectricalCircuit,
    ElectricalDevice,
    ElectricalDeviceType,
    ElectricalDistributionBoard,
    ElectricalOpening,
    ElectricalRiser,
    ElectricalRiserStop,
    ElectricalRoom,
    ElectricalWall,
    ElectricalWallLink,
    ElectricalWallPenetration,
)
from app.modules.electrical.riser_course import RiserFloor, RiserStopPoint
from app.modules.electrical.topology import Position

#: Codes einer Wandstrecke oder eines Wegpunkts in einer Oeffnung.
OPENING_CODES = frozenset(
    {"wall-through-opening", "waypoint-in-opening", "connection-through-opening"}
)

#: Befundidentitaet einer Leitung: ``(Code, Ort)``.
Finding = tuple[str, str]


def findings_of(result: CableResult) -> frozenset[Finding]:
    return frozenset((problem.code, problem.ref) for problem in result.problems)


# ------------------------------------------------------------------ Stand


@dataclass(frozen=True, slots=True)
class BuildingCableState:
    """Gespeicherter Planungsstand eines Gebaeudes samt Leitungsauswertung."""

    context: BuildingPlanningContext
    rooms: dict[uuid.UUID, ElectricalRoom]
    walls: dict[uuid.UUID, ElectricalWall]
    openings: dict[uuid.UUID, list[ElectricalOpening]]
    links: dict[uuid.UUID, ElectricalWallLink]
    devices: dict[uuid.UUID, ElectricalDevice]
    types: dict[str, ElectricalDeviceType]
    penetrations: dict[uuid.UUID, ElectricalWallPenetration]
    risers: dict[uuid.UUID, ElectricalRiser]
    stops: dict[uuid.UUID, ElectricalRiserStop]
    boards: dict[uuid.UUID, ElectricalDistributionBoard]
    circuits: dict[uuid.UUID, ElectricalCircuit]
    cables: dict[uuid.UUID, ElectricalCable]
    waypoints: dict[uuid.UUID, list[ElectricalCableWaypoint]]
    plan: CablePlan
    prepared: PreparedPlan
    results: dict[uuid.UUID, CableResult]
    #: Befundcode je Durchfuehrung, ``None`` = gueltig.
    penetration_codes: dict[uuid.UUID, str | None]

    def findings(self, cable_id: uuid.UUID) -> frozenset[Finding]:
        result = self.results.get(cable_id)
        return frozenset() if result is None else findings_of(result)


def to_waypoint(row: ElectricalCableWaypoint) -> Waypoint:
    """Gespeicherter Wegpunkt als Eingabe der reinen Funktion."""
    if row.kind == "wall":
        assert row.wall_id is not None and row.offset_mm is not None and row.height_mm is not None
        return WallWaypoint(str(row.wall_id), row.offset_mm, row.height_mm)
    if row.kind in ("ceiling", "floor"):
        assert row.room_id is not None and row.x_mm is not None and row.y_mm is not None
        return AreaWaypoint(row.kind, str(row.room_id), row.x_mm, row.y_mm)
    if row.kind == "penetration":
        assert row.penetration_id is not None
        return PenetrationWaypoint(str(row.penetration_id))
    if row.kind == "opening_crossing":
        assert row.wall_id is not None and row.offset_mm is not None
        return OpeningCrossingWaypoint(
            str(row.wall_id),
            row.offset_mm,
            None if row.opening_id is None else str(row.opening_id),
        )
    assert row.riser_id is not None
    assert row.from_stop_id is not None and row.from_height_mm is not None
    assert row.to_stop_id is not None and row.to_height_mm is not None
    return RiserWaypoint(
        str(row.riser_id), row.from_stop_id, row.from_height_mm, row.to_stop_id, row.to_height_mm
    )


def to_cable(row: ElectricalCable, waypoints: Sequence[Waypoint]) -> Cable:
    return Cable(
        id=str(row.id),
        start_device_id=None if row.start_device_id is None else str(row.start_device_id),
        end_device_id=None if row.end_device_id is None else str(row.end_device_id),
        waypoints=tuple(waypoints),
        start_allowance_mm=row.start_allowance_mm,
        end_allowance_mm=row.end_allowance_mm,
        reserve_mm=row.reserve_mm,
        cable_type=row.cable_type,
        conductor_count=row.conductor_count,
        cross_section_mm2=row.cross_section_mm2,
        reserve_mode=row.reserve_mode,
        reserve_percent=row.reserve_percent,
    )


def _floors(
    context: BuildingPlanningContext, default_heights: Mapping[uuid.UUID, int]
) -> tuple[RiserFloor, ...]:
    return tuple(
        RiserFloor(
            floor_id=floor.floor_id,
            level=floor.level,
            elevation_mm=floor.elevation_mm,
            elevation_confirmed=floor.elevation_confirmed,
            default_ceiling_height_mm=default_heights.get(
                floor.floor_id, floor.default_ceiling_height_mm
            ),
        )
        for floor in context.floors
    )


class _Identified(Protocol):
    @property
    def id(self) -> uuid.UUID: ...


def _index[T: _Identified](rows: Iterable[T]) -> dict[uuid.UUID, T]:
    return {row.id: row for row in rows}


class CableStateLoader:
    """Liest den Planungsstand eines Gebaeudes in konstant vielen Abfragen."""

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self.session = session
        self.organization_id = organization_id
        self.structure = FloorPlanningAccess(session, organization_id)

    def has_cable_data(self, building_id: uuid.UUID) -> bool:
        """Gibt es im Gebaeude Leitungen oder Durchfuehrungen? (Schneller Vorabweg.)"""
        org = self.organization_id
        cables = self.session.execute(
            select(func.count())
            .select_from(ElectricalCable)
            .join(
                ElectricalCircuit,
                (ElectricalCircuit.organization_id == ElectricalCable.organization_id)
                & (ElectricalCircuit.id == ElectricalCable.circuit_id),
            )
            .join(
                ElectricalDistributionBoard,
                (ElectricalDistributionBoard.organization_id == ElectricalCircuit.organization_id)
                & (ElectricalDistributionBoard.id == ElectricalCircuit.board_id),
            )
            .where(
                ElectricalCable.organization_id == org,
                ElectricalDistributionBoard.building_id == building_id,
            )
        ).scalar_one()
        if cables:
            return True
        context = self.structure.building_context(building_id)
        floor_ids = [floor.floor_id for floor in context.floors]
        if not floor_ids:
            return False
        penetrations = self.session.execute(
            select(func.count())
            .select_from(ElectricalWallPenetration)
            .join(
                ElectricalWallLink,
                (ElectricalWallLink.organization_id == ElectricalWallPenetration.organization_id)
                & (ElectricalWallLink.id == ElectricalWallPenetration.wall_link_id),
            )
            .join(
                ElectricalWall,
                (ElectricalWall.organization_id == ElectricalWallLink.organization_id)
                & (ElectricalWall.id == ElectricalWallLink.wall_a_id),
            )
            .join(
                ElectricalRoom,
                (ElectricalRoom.organization_id == ElectricalWall.organization_id)
                & (ElectricalRoom.id == ElectricalWall.room_id),
            )
            .where(
                ElectricalWallPenetration.organization_id == org,
                ElectricalRoom.floor_id.in_(floor_ids),
            )
        ).scalar_one()
        return bool(penetrations)

    def load(
        self,
        building_id: uuid.UUID,
        *,
        default_heights: Mapping[uuid.UUID, int] | None = None,
    ) -> BuildingCableState:
        """Vollstaendiger Stand; ``default_heights`` ersetzt Geschoss-Standardhoehen (Probe)."""
        org = self.organization_id
        context = self.structure.building_context(building_id)
        floor_ids = [floor.floor_id for floor in context.floors]
        rooms = _index(
            self._all(
                select(ElectricalRoom)
                .where(
                    ElectricalRoom.organization_id == org, ElectricalRoom.floor_id.in_(floor_ids)
                )
                .order_by(ElectricalRoom.id)
            )
            if floor_ids
            else []
        )
        walls = _index(
            self._all(
                select(ElectricalWall)
                .where(
                    ElectricalWall.organization_id == org, ElectricalWall.room_id.in_(list(rooms))
                )
                .order_by(ElectricalWall.room_id, ElectricalWall.sort_order, ElectricalWall.id)
            )
            if rooms
            else []
        )
        openings: dict[uuid.UUID, list[ElectricalOpening]] = {}
        if walls:
            for opening in self._all(
                select(ElectricalOpening)
                .where(
                    ElectricalOpening.organization_id == org,
                    ElectricalOpening.wall_id.in_(list(walls)),
                )
                .order_by(ElectricalOpening.offset_mm, ElectricalOpening.id)
            ):
                openings.setdefault(opening.wall_id, []).append(opening)
        links = _index(
            self._all(
                select(ElectricalWallLink)
                .where(
                    ElectricalWallLink.organization_id == org,
                    ElectricalWallLink.wall_a_id.in_(list(walls)),
                    ElectricalWallLink.wall_b_id.in_(list(walls)),
                )
                .order_by(ElectricalWallLink.id)
            )
            if walls
            else []
        )
        devices = _index(
            self._all(
                select(ElectricalDevice)
                .where(
                    ElectricalDevice.organization_id == org,
                    ElectricalDevice.room_id.in_(list(rooms)),
                )
                .order_by(ElectricalDevice.id)
            )
            if rooms
            else []
        )
        penetrations = _index(
            self._all(
                select(ElectricalWallPenetration)
                .where(
                    ElectricalWallPenetration.organization_id == org,
                    ElectricalWallPenetration.wall_link_id.in_(list(links)),
                )
                .order_by(ElectricalWallPenetration.id)
            )
            if links
            else []
        )
        risers = _index(
            self._all(
                select(ElectricalRiser)
                .where(
                    ElectricalRiser.organization_id == org,
                    ElectricalRiser.building_id == building_id,
                )
                .order_by(ElectricalRiser.id)
            )
        )
        stops = _index(
            self._all(
                select(ElectricalRiserStop)
                .where(
                    ElectricalRiserStop.organization_id == org,
                    ElectricalRiserStop.riser_id.in_(list(risers)),
                )
                .order_by(ElectricalRiserStop.id)
            )
            if risers
            else []
        )
        boards = _index(
            self._all(
                select(ElectricalDistributionBoard)
                .where(
                    ElectricalDistributionBoard.organization_id == org,
                    ElectricalDistributionBoard.building_id == building_id,
                )
                .order_by(ElectricalDistributionBoard.code, ElectricalDistributionBoard.id)
            )
        )
        circuits = _index(
            self._all(
                select(ElectricalCircuit)
                .where(
                    ElectricalCircuit.organization_id == org,
                    ElectricalCircuit.board_id.in_(list(boards)),
                )
                .order_by(
                    ElectricalCircuit.sort_order,
                    ElectricalCircuit.designation,
                    ElectricalCircuit.id,
                )
            )
            if boards
            else []
        )
        cables = _index(
            self._all(
                select(ElectricalCable)
                .where(
                    ElectricalCable.organization_id == org,
                    ElectricalCable.circuit_id.in_(list(circuits)),
                )
                .order_by(ElectricalCable.circuit_id, ElectricalCable.label, ElectricalCable.id)
            )
            if circuits
            else []
        )
        waypoints: dict[uuid.UUID, list[ElectricalCableWaypoint]] = {cid: [] for cid in cables}
        if cables:
            for row in self._all(
                select(ElectricalCableWaypoint)
                .where(
                    ElectricalCableWaypoint.organization_id == org,
                    ElectricalCableWaypoint.cable_id.in_(list(cables)),
                )
                .order_by(ElectricalCableWaypoint.cable_id, ElectricalCableWaypoint.seq)
            ):
                waypoints[row.cable_id].append(row)
        types = load_device_types(self.session)
        plan = build_plan(
            context,
            rooms=rooms,
            walls=walls,
            openings=openings,
            links=links,
            devices=devices,
            penetrations=penetrations,
            risers=risers,
            stops=stops,
            default_heights=default_heights or {},
        )
        prepared = prepare_plan(plan)
        results = {
            cid: analyse_cable(prepared, to_cable(row, [to_waypoint(wp) for wp in waypoints[cid]]))
            for cid, row in cables.items()
        }
        return BuildingCableState(
            context=context,
            rooms=rooms,
            walls=walls,
            openings=openings,
            links=links,
            devices=devices,
            types=types,
            penetrations=penetrations,
            risers=risers,
            stops=stops,
            boards=boards,
            circuits=circuits,
            cables=cables,
            waypoints=waypoints,
            plan=plan,
            prepared=prepared,
            results=results,
            penetration_codes={
                pid: penetration_problem(prepared, str(pid)) for pid in penetrations
            },
        )

    def _all[T](self, stmt: Select[tuple[T]]) -> list[T]:
        return list(self.session.execute(stmt.execution_options(populate_existing=True)).scalars())


def build_plan(
    context: BuildingPlanningContext,
    *,
    rooms: Mapping[uuid.UUID, ElectricalRoom],
    walls: Mapping[uuid.UUID, ElectricalWall],
    openings: Mapping[uuid.UUID, Sequence[ElectricalOpening]],
    links: Mapping[uuid.UUID, ElectricalWallLink],
    devices: Mapping[uuid.UUID, ElectricalDevice],
    penetrations: Mapping[uuid.UUID, ElectricalWallPenetration],
    risers: Mapping[uuid.UUID, ElectricalRiser],
    stops: Mapping[uuid.UUID, ElectricalRiserStop],
    default_heights: Mapping[uuid.UUID, int],
) -> CablePlan:
    """Gespeicherte Zeilen als Eingabe der reinen Funktion - deterministisch nach ID."""
    floors = _floors(context, default_heights)
    floor_default = {floor.floor_id: floor.default_ceiling_height_mm for floor in floors}
    walls_by_room: dict[uuid.UUID, list[ElectricalWall]] = {}
    for wall in walls.values():
        walls_by_room.setdefault(wall.room_id, []).append(wall)
    cable_rooms = tuple(
        CableRoom(
            id=str(room.id),
            floor_id=room.floor_id,
            height_mm=room.height_mm
            if room.height_mm is not None
            else floor_default[room.floor_id],
            walls=tuple(
                CableWall(
                    id=str(wall.id),
                    start=Point(wall.x1_mm, wall.y1_mm),
                    end=Point(wall.x2_mm, wall.y2_mm),
                    openings=tuple(
                        CableOpening(
                            str(o.id),
                            o.kind,
                            o.offset_mm,
                            o.width_mm,
                            o.sill_height_mm,
                            o.height_mm,
                        )
                        for o in openings.get(wall.id, ())
                    ),
                )
                for wall in sorted(
                    walls_by_room.get(room.id, []), key=lambda w: (w.sort_order, w.id)
                )
            ),
        )
        for room in sorted(rooms.values(), key=lambda r: r.id)
    )
    stops_by_riser: dict[uuid.UUID, list[ElectricalRiserStop]] = {}
    for stop in stops.values():
        stops_by_riser.setdefault(stop.riser_id, []).append(stop)
    return CablePlan(
        floors=floors,
        rooms=cable_rooms,
        links=tuple(topo_link(link) for link in sorted(links.values(), key=lambda li: li.id)),
        devices=tuple(
            CableDevice(
                id=str(device.id),
                room_id=str(device.room_id),
                surface=device.mounting_surface,
                wall_id=None if device.wall_id is None else str(device.wall_id),
                center_offset_mm=device.center_offset_mm,
                center_height_mm=device.center_height_mm,
                x_mm=device.x_mm,
                y_mm=device.y_mm,
            )
            for device in sorted(devices.values(), key=lambda d: d.id)
        ),
        penetrations=tuple(
            CablePenetration(str(p.id), str(p.wall_link_id), p.offset_mm, p.height_mm)
            for p in sorted(penetrations.values(), key=lambda p: p.id)
        ),
        risers=tuple(
            CableRiser(
                str(riser.id),
                riser.offset_mode,
                tuple(
                    RiserStopPoint(stop.id, stop.floor_id, stop.x_mm, stop.y_mm)
                    for stop in sorted(stops_by_riser.get(riser.id, []), key=lambda s: s.id)
                ),
            )
            for riser in sorted(risers.values(), key=lambda r: r.id)
        ),
    )


# ------------------------------------------------------------------ Beschreibung


def device_name(
    state: BuildingCableState,
    device_id: uuid.UUID | None,
    *,
    missing: str = "Verteilung (ohne Lage)",
) -> str:
    """„Steckdose „Bett links“ (1.02 Kueche)“ - ohne Datenbankzugriff."""
    if device_id is None:
        return missing
    device = state.devices.get(device_id)
    if device is None:
        return "Geraet"
    kind = state.types.get(device.device_type_key)
    name = kind.label if kind is not None else device.device_type_key
    if device.label:
        name += f" „{device.label}“"
    room = state.rooms.get(device.room_id)
    return f"{name} ({room_label(room)})" if room is not None else name


def describe_cable(state: BuildingCableState, cable_id: uuid.UUID) -> str:
    """„F3 · L2: Abzweigdose (Kueche) → Steckdose (Kueche)“ (Entwurf §7)."""
    cable = state.cables[cable_id]
    circuit = state.circuits.get(cable.circuit_id)
    prefix = circuit.designation if circuit is not None else "Stromkreis"
    label = cable.label or "Leitung"
    return (
        f"{prefix} · {label}: {device_name(state, cable.start_device_id)} → "
        f"{device_name(state, cable.end_device_id, missing='Endgeraet fehlt')}"
    )


def _messages(result: CableResult, findings: Iterable[Finding]) -> str:
    wanted = set(findings)
    texts: list[str] = []
    for problem in result.problems:
        if (problem.code, problem.ref) in wanted and problem.message not in texts:
            texts.append(problem.message)
    return " ".join(texts)


# ------------------------------------------------------------------ Waechter


class CableGuard:
    """Vergleicht Leitungen und Durchfuehrungen eines Gebaeudes vor und nach einer Aenderung."""

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self.loader = CableStateLoader(session, organization_id)

    def snapshot(self, building_id: uuid.UUID) -> BuildingCableState | None:
        """Stand vorher - ``None``, wenn das Gebaeude weder Leitungen noch Durchfuehrungen hat."""
        if not self.loader.has_cable_data(building_id):
            return None
        return self.loader.load(building_id)

    def require_unbroken(
        self,
        before: BuildingCableState | None,
        *,
        acknowledged: Sequence[uuid.UUID] = (),
        acknowledgement_supported: bool = False,
        hard_codes: frozenset[str] = frozenset(),
        opening_rule: bool = False,
    ) -> frozenset[uuid.UUID]:
        """Prueft den Stand nach der Aenderung; liefert die bestaetigt betroffenen Leitungen."""
        if before is None:
            if acknowledged:
                _raise_stale(acknowledged)
            return frozenset()
        after = self.loader.load(before.context.building_id)
        require_penetrations_valid(before, after)
        new: dict[uuid.UUID, frozenset[Finding]] = {}
        for cable_id in after.cables:
            if cable_id not in before.cables:
                continue
            added = after.findings(cable_id) - before.findings(cable_id)
            if added:
                new[cable_id] = added
        hard = {
            cable_id: frozenset(f for f in findings if f[0] in hard_codes)
            for cable_id, findings in new.items()
        }
        if opening_rule:
            caused = _opening_caused(before, after, new)
            for cable_id, findings in caused.items():
                hard[cable_id] = hard.get(cable_id, frozenset()) | findings
        hard = {cable_id: findings for cable_id, findings in hard.items() if findings}
        if hard:
            raise ValidationFailedError(
                "Diese Aenderung wuerde Leitungswege unzulaessig machen (Oeffnung ueber einer "
                "Leitung oder Wegpunkt ueber der Raumhoehe). Es wurde nichts gespeichert; "
                "Leitungen werden nie automatisch verschoben.",
                errors=[
                    ProblemFieldError(
                        field="cables",
                        code="opening-over-cable"
                        if any(f[0] in OPENING_CODES for f in findings)
                        else "cable-waypoint-out-of-range",
                        message=f"{describe_cable(after, cable_id)}: "
                        + _messages(after.results[cable_id], findings),
                        keys=[str(cable_id)],
                    )
                    for cable_id, findings in sorted(hard.items(), key=lambda kv: str(kv[0]))
                ],
            )
        require_acknowledged(
            after,
            new,
            acknowledged,
            supported=acknowledgement_supported,
        )
        return frozenset(new)


def require_penetrations_valid(before: BuildingCableState, after: BuildingCableState) -> None:
    """``422``, wenn eine bisher gueltige Durchfuehrung ungueltig wuerde - ohne Bestaetigung."""
    broken = [
        (pid, code)
        for pid, code in after.penetration_codes.items()
        if code is not None
        and pid in before.penetration_codes
        and before.penetration_codes[pid] is None
    ]
    if broken:
        raise ValidationFailedError(
            "Eine Durchfuehrung laege danach nicht mehr in einem aktiven gemeinsamen "
            "Wandabschnitt, "
            "ueber einer Raumhoehe oder in einer Oeffnung. Durchfuehrungen werden nicht "
            "verschoben; bitte zuerst die Durchfuehrung aendern oder entfernen. Es wurde nichts "
            "gespeichert.",
            errors=[
                ProblemFieldError(
                    field="penetrations",
                    code=code,
                    message=_PENETRATION_TEXT.get(code, "Durchfuehrung ungueltig."),
                    keys=[str(pid)],
                )
                for pid, code in sorted(broken, key=lambda item: str(item[0]))
            ],
        )


_PENETRATION_TEXT = {
    "penetration-link-not-active": "Die Wandkopplung der Durchfuehrung waere nicht mehr aktiv.",
    "penetration-outside-shared-section": (
        "Die Durchfuehrung laege nicht mehr in einem gemeinsamen Wandabschnitt."
    ),
    "penetration-height": "Die Durchfuehrung laege nicht mehr unter beiden Raumhoehen.",
    "penetration-in-opening": "Die Durchfuehrung laege in einer Oeffnung.",
    "penetration-unknown": "Die Durchfuehrung waere nicht mehr zuzuordnen.",
}


def require_acknowledged(
    after: BuildingCableState,
    new: Mapping[uuid.UUID, frozenset[Finding]],
    acknowledged: Sequence[uuid.UUID],
    *,
    supported: bool,
) -> None:
    """Gespeichert wird nur, wenn die Bestaetigung **genau** die betroffenen Leitungen nennt."""
    doubled = sorted({item for item in acknowledged if acknowledged.count(item) > 1}, key=str)
    if doubled:
        raise ValidationFailedError(
            "Eine Leitung ist in der Bestaetigung doppelt genannt. Es wurde nichts gespeichert.",
            errors=[
                ProblemFieldError(
                    field="acknowledged_cable_ids",
                    code="acknowledged-cable-duplicate",
                    message="Leitung doppelt bestaetigt.",
                    keys=[str(item) for item in doubled],
                )
            ],
        )
    affected = set(new)
    if affected == set(acknowledged):
        return
    errors = [
        ProblemFieldError(
            field="cables",
            code="cables-would-break",
            message=f"{describe_cable(after, cable_id)}: "
            + _messages(after.results[cable_id], new[cable_id]),
            keys=[str(cable_id)],
        )
        for cable_id in sorted(affected, key=str)
    ]
    errors += [
        ProblemFieldError(
            field="acknowledged_cable_ids",
            code="cable-not-affected",
            message="Diese Leitung ist von der Aenderung nicht (mehr) betroffen.",
            keys=[str(item)],
        )
        for item in sorted(set(acknowledged) - affected, key=str)
    ]
    if not affected:
        raise ConflictError(
            "Die Bestaetigung passt nicht zum aktuellen Stand: Keine der genannten Leitungen ist "
            "betroffen. Bitte neu laden. Es wurde nichts gespeichert.",
            errors=errors,
        )
    hint = (
        " Zum Speichern muessen genau diese Leitungen bestaetigt werden "
        "(acknowledged_cable_ids); sie sind danach im Konflikt und ohne Laenge."
        if supported
        else " Diese Aenderung ist hier nicht mit Bestaetigung moeglich - bitte im Raumentwurf "
        "bzw. in der Leitung aendern."
    )
    raise ConflictError(
        f"Diese Aenderung wuerde {len(affected)} Leitung(en) unterbrechen.{hint} Es wurde "
        "nichts gespeichert; Leitungen werden nie automatisch verschoben.",
        errors=errors,
    )


def _raise_stale(acknowledged: Sequence[uuid.UUID]) -> None:
    raise ConflictError(
        "Die Bestaetigung passt nicht zum aktuellen Stand: Keine der genannten Leitungen ist "
        "betroffen. Bitte neu laden. Es wurde nichts gespeichert.",
        errors=[
            ProblemFieldError(
                field="acknowledged_cable_ids",
                code="cable-not-affected",
                message="Diese Leitung ist von der Aenderung nicht (mehr) betroffen.",
                keys=[str(item)],
            )
            for item in sorted(set(acknowledged), key=str)
        ],
    )


def _opening_caused(
    before: BuildingCableState,
    after: BuildingCableState,
    new: Mapping[uuid.UUID, frozenset[Finding]],
) -> dict[uuid.UUID, frozenset[Finding]]:
    """Neue Oeffnungsbefunde, die mit den **bisherigen** Oeffnungen nicht entstuenden."""
    candidates = {
        cable_id: frozenset(f for f in findings if f[0] in OPENING_CODES)
        for cable_id, findings in new.items()
    }
    candidates = {cable_id: f for cable_id, f in candidates.items() if f}
    if not candidates:
        return {}
    old_openings = {wall.id: wall.openings for room in before.plan.rooms for wall in room.walls}
    variant = replace(
        after.plan,
        rooms=tuple(
            replace(
                room,
                walls=tuple(
                    replace(wall, openings=old_openings.get(wall.id, ())) for wall in room.walls
                ),
            )
            for room in after.plan.rooms
        ),
    )
    prepared = prepare_plan(variant)
    caused: dict[uuid.UUID, frozenset[Finding]] = {}
    for cable_id, findings in candidates.items():
        row = after.cables[cable_id]
        result = analyse_cable(
            prepared, to_cable(row, [to_waypoint(wp) for wp in after.waypoints[cable_id]])
        )
        still = findings & findings_of(result)
        if findings - still:
            caused[cable_id] = findings - still
    return caused


# ------------------------------------------------------------------ Bezuege


def cables_referencing(
    session: Session,
    organization_id: uuid.UUID,
    *,
    wall_ids: Sequence[uuid.UUID] = (),
    room_ids: Sequence[uuid.UUID] = (),
    device_ids: Sequence[uuid.UUID] = (),
    opening_ids: Sequence[uuid.UUID] = (),
    penetration_ids: Sequence[uuid.UUID] = (),
    riser_ids: Sequence[uuid.UUID] = (),
    stop_ids: Sequence[uuid.UUID] = (),
) -> list[ElectricalCable]:
    """Leitungen, deren Endgeraete oder Wegpunkte einen der Bezuege nutzen - nach ID."""
    conditions: list[ColumnElement[bool]] = []
    wp = ElectricalCableWaypoint
    if wall_ids:
        conditions.append(wp.wall_id.in_(wall_ids))
    if room_ids:
        conditions.append(wp.room_id.in_(room_ids))
    if opening_ids:
        conditions.append(wp.opening_id.in_(opening_ids))
    if penetration_ids:
        conditions.append(wp.penetration_id.in_(penetration_ids))
    if riser_ids:
        conditions.append(wp.riser_id.in_(riser_ids))
    if stop_ids:
        conditions.append(or_(wp.from_stop_id.in_(stop_ids), wp.to_stop_id.in_(stop_ids)))
    cable_ids: set[uuid.UUID] = set()
    if conditions:
        cable_ids.update(
            session.execute(
                select(wp.cable_id).where(wp.organization_id == organization_id, or_(*conditions))
            ).scalars()
        )
    if device_ids:
        cable_ids.update(
            session.execute(
                select(ElectricalCable.id).where(
                    ElectricalCable.organization_id == organization_id,
                    or_(
                        ElectricalCable.start_device_id.in_(device_ids),
                        ElectricalCable.end_device_id.in_(device_ids),
                    ),
                )
            ).scalars()
        )
    if not cable_ids:
        return []
    return list(
        session.execute(
            select(ElectricalCable)
            .where(
                ElectricalCable.organization_id == organization_id,
                ElectricalCable.id.in_(cable_ids),
            )
            .order_by(ElectricalCable.id)
        ).scalars()
    )


def penetrations_on_links(
    session: Session, organization_id: uuid.UUID, link_ids: Sequence[uuid.UUID]
) -> list[ElectricalWallPenetration]:
    if not link_ids:
        return []
    return list(
        session.execute(
            select(ElectricalWallPenetration)
            .where(
                ElectricalWallPenetration.organization_id == organization_id,
                ElectricalWallPenetration.wall_link_id.in_(link_ids),
            )
            .order_by(ElectricalWallPenetration.id)
        ).scalars()
    )


def in_use_error(
    detail: str, code: str, message: str, cables: Sequence[ElectricalCable], *extra: uuid.UUID
) -> ConflictError:
    """``409`` mit den betroffenen Leitungen (Bezeichnung) - nichts wird mitgeloescht."""
    labels = sorted(cable.label or str(cable.id)[:8] for cable in cables)
    suffix = f" Betroffen: {', '.join(labels)}." if labels else ""
    return ConflictError(
        detail + suffix + " Es wurde nichts geaendert.",
        errors=[
            ProblemFieldError(
                field="cables",
                code=code,
                message=message,
                keys=[str(item) for item in extra] + [str(cable.id) for cable in cables] or None,
            )
        ],
    )


# ------------------------------------------------------- Raumschreibwege (6b.3)


def require_walls_free(
    session: Session, organization_id: uuid.UUID, wall_ids: Sequence[uuid.UUID]
) -> None:
    """``409 wall-has-cables``: Eine Wand mit Wegpunkten oder Bodenuebergaengen bleibt."""
    users = cables_referencing(session, organization_id, wall_ids=wall_ids)
    if users:
        raise in_use_error(
            "An dieser Wand liegen Wegpunkte oder Bodenuebergaenge von Leitungen. Bitte zuerst "
            "den Weg der Leitungen aendern.",
            "wall-has-cables",
            "Wand wird von Leitungen genutzt.",
            users,
            *wall_ids,
        )


def require_devices_free(
    session: Session, organization_id: uuid.UUID, device_ids: Sequence[uuid.UUID]
) -> None:
    """``409 device-has-cables``: Ein Endgeraet einer Leitung wird nicht entfernt."""
    users = cables_referencing(session, organization_id, device_ids=device_ids)
    if users:
        used = sorted(
            {
                device
                for cable in users
                for device in (cable.start_device_id, cable.end_device_id)
                if device in set(device_ids)
            },
            key=str,
        )
        raise in_use_error(
            "Ein Geraet, das entfernt werden soll, ist Endpunkt einer Leitung. Bitte zuerst die "
            "Leitung entfernen oder anders anschliessen.",
            "device-has-cables",
            "Geraet ist Endpunkt einer Leitung.",
            users,
            *used,
        )


def require_links_without_penetrations(
    session: Session, organization_id: uuid.UUID, link_ids: Sequence[uuid.UUID]
) -> None:
    """``409 wall-link-has-penetrations``: Eine Kopplung mit Durchfuehrung wird nicht geloest."""
    penetrations = penetrations_on_links(session, organization_id, link_ids)
    if penetrations:
        raise ConflictError(
            "Auf dieser Wandzuordnung liegt eine Durchfuehrung. Bitte zuerst die Durchfuehrung "
            "entfernen (dafuer darf keine Leitung sie nutzen). Es wurde nichts geaendert.",
            errors=[
                ProblemFieldError(
                    field="wall_link",
                    code="wall-link-has-penetrations",
                    message="Wandzuordnung traegt eine Durchfuehrung.",
                    keys=[str(p.wall_link_id) for p in penetrations]
                    + [str(p.id) for p in penetrations],
                )
            ],
        )


def require_room_free(
    session: Session,
    organization_id: uuid.UUID,
    *,
    room_id: uuid.UUID,
    wall_ids: Sequence[uuid.UUID],
    device_ids: Sequence[uuid.UUID],
    link_ids: Sequence[uuid.UUID],
) -> None:
    """``409 room-has-cables``: Wege, Bodenuebergaenge, Endgeraete oder Durchfuehrungen im Raum."""
    users = cables_referencing(
        session, organization_id, wall_ids=wall_ids, room_ids=[room_id], device_ids=device_ids
    )
    penetrations = penetrations_on_links(session, organization_id, link_ids)
    if users or penetrations:
        raise in_use_error(
            "In diesem Raum liegen Leitungswege, Bodenuebergaenge, Durchfuehrungen oder "
            "Endgeraete von Leitungen. Bitte zuerst die Leitungen bzw. Durchfuehrungen aendern.",
            "room-has-cables",
            "Raum wird von Leitungen genutzt.",
            users,
            room_id,
            *(p.id for p in penetrations),
        )


def preserve_reversed_walls(
    session: Session, organization_id: uuid.UUID, reversed_walls: Mapping[uuid.UUID, int]
) -> frozenset[uuid.UUID]:
    """Kehrt sich eine Wand um, bleibt jeder Bezug an seiner Stelle: Abstand ``L - x``.

    Entwurf §7 ("Kontur umkehren ... wie Oeffnungen"): Wegpunkte, Bodenuebergaenge und
    Durchfuehrungen an ``wall_a`` behalten ihren Ort, nicht ihren Abstand. Die Versionen
    der betroffenen Leitungen und Durchfuehrungen zaehlen weiter. Liefert die Leitungen.
    """
    if not reversed_walls:
        return frozenset()
    rows = session.execute(
        select(ElectricalCableWaypoint).where(
            ElectricalCableWaypoint.organization_id == organization_id,
            ElectricalCableWaypoint.wall_id.in_(list(reversed_walls)),
        )
    ).scalars()
    cable_ids: set[uuid.UUID] = set()
    for row in rows:
        assert row.wall_id is not None and row.offset_mm is not None
        row.offset_mm = reversed_walls[row.wall_id] - row.offset_mm
        cable_ids.add(row.cable_id)
    links = session.execute(
        select(ElectricalWallLink).where(
            ElectricalWallLink.organization_id == organization_id,
            ElectricalWallLink.wall_a_id.in_(list(reversed_walls)),
        )
    ).scalars()
    link_walls = {link.id: link.wall_a_id for link in links}
    for penetration in penetrations_on_links(session, organization_id, list(link_walls)):
        penetration.offset_mm = reversed_walls[link_walls[penetration.wall_link_id]] - (
            penetration.offset_mm
        )
        penetration.updated_at = utcnow()
    _touch_cables(session, organization_id, cable_ids)
    return frozenset(cable_ids)


def detach_removed_openings(
    session: Session, organization_id: uuid.UUID, opening_ids: Sequence[uuid.UUID]
) -> frozenset[uuid.UUID]:
    """Speicherstrategie §5.6: Bodenuebergaenge entfernter Oeffnungen verlieren nur den Bezug.

    ``opening_id = NULL`` an genau diesen Wegpunkten, Lage (Wand, Abstand) bleibt; die
    Leitungsversion zaehlt weiter. Wirksam nur, wenn der Aufrufer die betroffenen
    Leitungen danach bestaetigt sieht - sonst wird die Transaktion verworfen.
    """
    if not opening_ids:
        return frozenset()
    rows = list(
        session.execute(
            select(ElectricalCableWaypoint).where(
                ElectricalCableWaypoint.organization_id == organization_id,
                ElectricalCableWaypoint.opening_id.in_(list(opening_ids)),
            )
        ).scalars()
    )
    for row in rows:
        row.opening_id = None
    cable_ids = {row.cable_id for row in rows}
    _touch_cables(session, organization_id, cable_ids)
    return frozenset(cable_ids)


def _touch_cables(
    session: Session, organization_id: uuid.UUID, cable_ids: Iterable[uuid.UUID]
) -> None:
    ids = list(cable_ids)
    if not ids:
        return
    for cable in session.execute(
        select(ElectricalCable).where(
            ElectricalCable.organization_id == organization_id, ElectricalCable.id.in_(ids)
        )
    ).scalars():
        cable.updated_at = utcnow()


def require_no_split_references(
    before: BuildingCableState | None,
    new_walls: Sequence[tuple[Point, Point]],
    changed_wall_ids: Sequence[uuid.UUID],
) -> None:
    """``422 wall-split-with-cables``: Ein Bezug faellt beim Teilen in das neue Wandstueck.

    Entwurf §7 ("Wand teilen: abgelehnt, wenn ein Wegpunkt, eine Durchfuehrung oder ein
    Bodenuebergang in das neue Stueck fiele"). Geprueft wird jeder Bezug einer
    geaenderten Wand an seinem bisherigen Grundrisspunkt gegen das Innere jeder neuen Wand.
    """
    if before is None or not new_walls:
        return
    hits: list[str] = []
    for wall_id in changed_wall_ids:
        info = before.prepared.walls.get(str(wall_id))
        if info is None:
            continue
        offsets = [
            row.offset_mm
            for rows in before.waypoints.values()
            for row in rows
            if row.wall_id == wall_id and row.offset_mm is not None
        ]
        offsets += [
            pen.offset_mm
            for pen in before.penetrations.values()
            if before.links[pen.wall_link_id].wall_a_id == wall_id
        ]
        for offset in offsets:
            point = wall_axis_point(info, Position(offset))
            if any(_strictly_inside(point, start, end) for start, end in new_walls):
                hits.append(str(wall_id))
                break
    if hits:
        raise ValidationFailedError(
            "Beim Teilen einer Wand laege ein Leitungswegpunkt, ein Bodenuebergang oder eine "
            "Durchfuehrung auf dem neuen Wandstueck. Bezuege wechseln nicht still die Wand - "
            "bitte zuerst die Leitung aendern. Es wurde nichts gespeichert.",
            errors=[
                ProblemFieldError(
                    field="walls",
                    code="wall-split-with-cables",
                    message="Bezug einer Leitung laege auf dem neuen Wandstueck.",
                    keys=hits,
                )
            ],
        )


def _strictly_inside(point: Point, start: Point, end: Point) -> bool:
    if point in (start, end):
        return False
    cross = (end.x_mm - start.x_mm) * (point.y_mm - start.y_mm) - (end.y_mm - start.y_mm) * (
        point.x_mm - start.x_mm
    )
    return (
        cross == 0
        and min(start.x_mm, end.x_mm) <= point.x_mm <= max(start.x_mm, end.x_mm)
        and min(start.y_mm, end.y_mm) <= point.y_mm <= max(start.y_mm, end.y_mm)
    )


def wall_length(wall: ElectricalWall) -> int:
    return segment_length_mm(Point(wall.x1_mm, wall.y1_mm), Point(wall.x2_mm, wall.y2_mm))


__all__ = [
    "OPENING_CODES",
    "BuildingCableState",
    "CableGuard",
    "CableStateLoader",
    "build_plan",
    "cables_referencing",
    "describe_cable",
    "detach_removed_openings",
    "device_name",
    "findings_of",
    "in_use_error",
    "penetrations_on_links",
    "preserve_reversed_walls",
    "require_acknowledged",
    "require_devices_free",
    "require_links_without_penetrations",
    "require_no_split_references",
    "require_penetrations_valid",
    "require_room_free",
    "require_walls_free",
    "to_cable",
    "to_waypoint",
    "wall_length",
]
