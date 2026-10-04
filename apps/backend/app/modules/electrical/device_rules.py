"""Geraeteregeln im Service: Zustand laden, pruefen, Befunde verstaendlich benennen.

Phase 5 (ADR 0023). Die eigentlichen Regeln sind rein (``devices.py``); hier
werden nur gespeicherte Zeilen in deren Eingabe uebersetzt und die Befunde mit
Raum, Wand und Geraetetyp benannt, damit eine Meldung ohne Rueckfrage
verstaendlich ist.

**"Keine neuen und keine groesseren Konflikte."** Jeder Schreibvorgang, der
Geometrie, Oeffnungen, Hoehen oder Geraete eines Geschosses aendert,
vergleicht die Befunde vor und nach der Aenderung - unter der Projektsperre,
in derselben Transaktion:

* ein **neues oder geaendertes** Geraet muss vollstaendig zulaessig sein,
* jedes andere Geraet darf **keinen neuen** Befund erhalten - auch nicht durch
  eine Aenderung in einem Nachbarraum (abgeleitete Oeffnung, geteiltes
  Wandstueck). "Derselbe" Befund heisst: dasselbe Geraet, derselbe Code und
  **dieselben Konfliktpartner** (Oeffnung, anderes Geraet, Nachbarraeume),
* ein schon bestehender Befund darf bleiben oder kleiner werden, aber **nicht
  groesser**: verglichen wird sein exaktes Ausmass (Ueberstand in mm,
  ueberdeckte Flaeche in mm², ``devices.py``). Eine Teilverbesserung ist
  zulaessig, auch wenn der Konflikt danach noch besteht (dieselbe Regel wie
  bei der Geschosshoehe, ADR 0022).

Ein Code allein beweist nichts: Wird eine Raumhoehe weiter abgesenkt, bleibt
der Code ``device-exceeds-room-height`` gleich, der Ueberstand waechst - das
ist abgelehnt. Befunde ohne messbares Ausmass (unbekannter Typ, fehlende Wand
u. a.) bleiben zulaessig, solange derselbe Befund besteht.

Nichts wird verschoben oder geloescht; eine Verletzung ist ``422``.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import ProblemFieldError, ValidationFailedError
from app.modules.electrical.devices import (
    DeviceFinding,
    DeviceTypeSpec,
    PlannedDevice,
    PlannedRoom,
    Severity,
    device_findings,
)
from app.modules.electrical.geometry import GeometryProblem, Point
from app.modules.electrical.models import (
    ElectricalDevice,
    ElectricalDeviceType,
    ElectricalOpening,
    ElectricalRoom,
    ElectricalWall,
)
from app.modules.electrical.topology import TopoOpening, TopoWall

#: Ausgangslage: Ausmass je Befundidentitaet ``(Geraet, Code, Partner ...)``.
DeviceBaseline = dict[tuple[str, ...], Severity]

#: Zusatz zur Meldung, wenn ein bestehender Konflikt groesser wuerde.
WORSENED = " Der bestehende Konflikt wuerde dadurch groesser."


def load_device_types(session: Session) -> dict[str, ElectricalDeviceType]:
    """Alle Typen des Systemkatalogs nach Schluessel (aktiv und deaktiviert)."""
    rows = session.execute(
        select(ElectricalDeviceType).order_by(
            ElectricalDeviceType.sort_order.asc(), ElectricalDeviceType.key.asc()
        )
    ).scalars()
    return {row.key: row for row in rows}


def type_specs(types: Mapping[str, ElectricalDeviceType]) -> dict[str, DeviceTypeSpec]:
    return {
        key: DeviceTypeSpec(
            key=key,
            width_mm=row.width_mm,
            height_mm=row.height_mm,
            allows_wall_interior=row.allows_wall_interior,
            allows_wall_exterior=row.allows_wall_exterior,
            allows_ceiling=row.allows_ceiling,
        )
        for key, row in types.items()
    }


def planned_room(
    room: ElectricalRoom,
    walls: Sequence[ElectricalWall],
    openings: Mapping[uuid.UUID, Sequence[ElectricalOpening]],
    height_mm: int,
) -> PlannedRoom:
    return PlannedRoom(
        id=str(room.id),
        height_mm=height_mm,
        walls=tuple(
            TopoWall(
                id=str(wall.id),
                room_id=str(room.id),
                start=Point(x_mm=wall.x1_mm, y_mm=wall.y1_mm),
                end=Point(x_mm=wall.x2_mm, y_mm=wall.y2_mm),
                openings=tuple(
                    TopoOpening(
                        id=str(opening.id),
                        offset_mm=opening.offset_mm,
                        width_mm=opening.width_mm,
                        sill_height_mm=opening.sill_height_mm,
                        height_mm=opening.height_mm,
                    )
                    for opening in openings.get(wall.id, ())
                ),
            )
            for wall in walls
        ),
    )


def planned_device(device: ElectricalDevice) -> PlannedDevice:
    return PlannedDevice(
        id=str(device.id),
        room_id=str(device.room_id),
        type_key=device.device_type_key,
        surface=device.mounting_surface,
        wall_id=str(device.wall_id) if device.wall_id is not None else None,
        center_offset_mm=device.center_offset_mm,
        center_height_mm=device.center_height_mm,
        x_mm=device.x_mm,
        y_mm=device.y_mm,
    )


def room_label(room: ElectricalRoom) -> str:
    return f"{room.room_number} {room.name}" if room.room_number else room.name


_SURFACE = {"wall_interior": "innen", "wall_exterior": "aussen"}


def describe(
    problems: Iterable[GeometryProblem],
    *,
    rooms: Mapping[uuid.UUID, ElectricalRoom],
    walls: Mapping[uuid.UUID, ElectricalWall],
    devices: Mapping[str, ElectricalDevice],
    types: Mapping[str, ElectricalDeviceType],
) -> list[ProblemFieldError]:
    """Befunde als RFC-9457-``errors`` - mit Ort und Geraetetyp in der Meldung."""
    errors: list[ProblemFieldError] = []
    for problem in problems:
        device = devices.get(problem.keys[0]) if problem.keys else None
        prefix = ""
        if device is not None:
            room = rooms.get(device.room_id)
            kind = types.get(device.device_type_key)
            parts = [f'Raum "{room_label(room)}"' if room is not None else "Raum"]
            wall = walls.get(device.wall_id) if device.wall_id is not None else None
            if wall is not None:
                parts.append(
                    f"Wand {wall.sort_order + 1} {_SURFACE.get(device.mounting_surface, '')}"
                )
            elif device.mounting_surface == "ceiling":
                parts.append("Decke")
            parts.append(kind.label if kind is not None else device.device_type_key)
            prefix = ", ".join(part.strip() for part in parts) + ": "
        errors.append(
            ProblemFieldError(
                field="devices",
                code=problem.code,
                message=prefix + problem.message,
                keys=list(problem.keys) or None,
            )
        )
    return errors


@dataclass(frozen=True, slots=True)
class FloorDeviceState:
    """Gespeicherter Stand eines Geschosses, soweit die Geraetepruefung ihn braucht."""

    rooms: dict[uuid.UUID, ElectricalRoom]
    walls: dict[uuid.UUID, ElectricalWall]
    devices: dict[str, ElectricalDevice]
    types: dict[str, ElectricalDeviceType]
    findings: list[DeviceFinding]

    @property
    def problems(self) -> list[GeometryProblem]:
        return [finding.problem for finding in self.findings]

    def errors(self, problems: Iterable[GeometryProblem]) -> list[ProblemFieldError]:
        return describe(
            problems, rooms=self.rooms, walls=self.walls, devices=self.devices, types=self.types
        )


class FloorDeviceCheck:
    """Prueft die Geraete eines Geschosses gegen den aktuellen Stand der Session.

    Der Aufrufer haelt die Projektsperre. Raeume, Waende, Oeffnungen und Geraete
    werden in konstant vielen Abfragen gelesen; ohne Geraete auf dem Geschoss
    bleibt es bei einer.
    """

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self.session = session
        self.organization_id = organization_id

    def devices_of_rooms(self, room_ids: Sequence[uuid.UUID]) -> list[ElectricalDevice]:
        if not room_ids:
            return []
        return list(
            self.session.execute(
                select(ElectricalDevice)
                .where(
                    ElectricalDevice.organization_id == self.organization_id,
                    ElectricalDevice.room_id.in_(room_ids),
                )
                .order_by(ElectricalDevice.id.asc())
            ).scalars()
        )

    def state(self, floor_id: uuid.UUID, default_height_mm: int) -> FloorDeviceState | None:
        """Stand und Befunde - ``None``, wenn auf dem Geschoss kein Geraet steht."""
        rooms = list(
            self.session.execute(
                select(ElectricalRoom).where(
                    ElectricalRoom.organization_id == self.organization_id,
                    ElectricalRoom.floor_id == floor_id,
                )
            ).scalars()
        )
        devices = self.devices_of_rooms([room.id for room in rooms])
        if not devices:
            return None
        walls = list(
            self.session.execute(
                select(ElectricalWall)
                .where(
                    ElectricalWall.organization_id == self.organization_id,
                    ElectricalWall.room_id.in_([room.id for room in rooms]),
                )
                .order_by(
                    ElectricalWall.room_id.asc(),
                    ElectricalWall.sort_order.asc(),
                    ElectricalWall.id.asc(),
                )
            ).scalars()
        )
        openings: dict[uuid.UUID, list[ElectricalOpening]] = {}
        if walls:
            for opening in self.session.execute(
                select(ElectricalOpening).where(
                    ElectricalOpening.organization_id == self.organization_id,
                    ElectricalOpening.wall_id.in_([wall.id for wall in walls]),
                )
            ).scalars():
                openings.setdefault(opening.wall_id, []).append(opening)
        walls_by_room: dict[uuid.UUID, list[ElectricalWall]] = {}
        for wall in walls:
            walls_by_room.setdefault(wall.room_id, []).append(wall)
        planned_rooms = [
            planned_room(
                room,
                walls_by_room.get(room.id, []),
                openings,
                room.height_mm if room.height_mm is not None else default_height_mm,
            )
            for room in rooms
        ]
        types = load_device_types(self.session)
        return FloorDeviceState(
            rooms={room.id: room for room in rooms},
            walls={wall.id: wall for wall in walls},
            devices={str(device.id): device for device in devices},
            types=types,
            findings=device_findings(
                planned_rooms, [planned_device(device) for device in devices], type_specs(types)
            ),
        )

    def baseline(self, floor_id: uuid.UUID, default_height_mm: int) -> DeviceBaseline:
        """Befunde mit Ausmass vor der Aenderung - die Ausgangslage des Vergleichs."""
        current = self.state(floor_id, default_height_mm)
        return {} if current is None else baseline_of(current.findings)

    def require_no_new_problems(
        self,
        floor_id: uuid.UUID,
        default_height_mm: int,
        baseline: DeviceBaseline,
        *,
        changed: frozenset[str] = frozenset(),
        detail: str,
    ) -> None:
        """``422``, wenn die Aenderung einen Geraetebefund erzeugt oder vergroessert."""
        current = self.state(floor_id, default_height_mm)
        if current is None:
            return
        rejected = rejected_problems(current.findings, baseline, changed)
        if rejected:
            raise ValidationFailedError(detail, errors=current.errors(rejected))


def baseline_of(findings: Iterable[DeviceFinding]) -> DeviceBaseline:
    return {finding.identity: finding.severity for finding in findings}


def rejected_problems(
    findings: Iterable[DeviceFinding],
    baseline: DeviceBaseline,
    changed: frozenset[str] = frozenset(),
) -> list[GeometryProblem]:
    """Befunde, die eine Aenderung verbieten - rein, ohne Datenbank.

    * jeder Befund eines neuen oder geaenderten Geraets,
    * jeder Befund, dessen Identitaet (Geraet, Code, Partner) vorher fehlte,
    * jeder bestehende Befund, dessen Ausmass gewachsen ist (Meldung mit Zusatz).
    """
    rejected: list[GeometryProblem] = []
    for finding in findings:
        before = baseline.get(finding.identity)
        if finding.device_id in changed or before is None:
            rejected.append(finding.problem)
        elif not finding.severity.not_worse_than(before):
            problem = finding.problem
            rejected.append(
                GeometryProblem(
                    code=problem.code, message=problem.message + WORSENED, keys=problem.keys
                )
            )
    return rejected
