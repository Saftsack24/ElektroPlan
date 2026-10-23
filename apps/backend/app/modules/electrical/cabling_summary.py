"""Mengenuebersicht eines Gebaeudes (Phase 6b.6, ADR 0026, Entwurf §6.5).

Eine **Ableitung**, nie gespeichert: Grundlage sind ausschliesslich die
gespeicherten Leitungen, ihre Ergebnisse aus
:func:`~app.modules.electrical.cable_length.analyse_cable` (Weg, Laenge, Status,
Teilsumme) und die Trassen aus
:func:`~app.modules.electrical.cable_traces.derive_traces`. Hier wird nichts neu
berechnet, nur gruppiert und summiert.

Zaehlweise (verbindlich, Entwurf §20/§21):

* **Gruppen** nach den *tatsaechlichen* Kabelangaben jeder Leitung
  (``cable_type``, ``conductor_count``, ``cross_section_mm2``). Der
  Stromkreisvorschlag spielt keine Rolle. Querschnitte vergleichen als
  ``Decimal`` (``1.5`` = ``1.50``). Fehlt eine Angabe, steht die Leitung unter
  **unvollstaendig spezifiziert** - nie in einer erfundenen Gruppe.
* Je Gruppe drei getrennte Bereiche: **bestaetigt** (``confirmed``: Anzahl,
  geometrisch, Zugaben, Summe = ``length_mm``), **offen** (``incomplete``) und
  **Konflikt** (``conflict``) mit der bekannten Teilsumme (``known_mm``,
  geometrisch und Zugaben getrennt). Offene und konflikthafte Mengen fliessen
  nie in die bestaetigte Summe. Zugaben zaehlen genau einmal je Leitung.
* **Reserve getrennt** (Phase 6c, V1, ADR 0027): je Bereich Anschlusszugaben
  (``connection_allowance_mm``) und wirksame Reserve (``reserve_mm``) getrennt;
  ``allowance_mm`` ist ihre Summe. Jede Leitung hat **eine** Reserveform - feste
  Bestandsreserve *oder* Prozentreserve (Datenbank-CHECK) -, gezaehlt genau einmal; eine
  Prozentreserve, die auf einen bestaetigten Weg wartet, steht in keiner Summe
  (``reserve_pending_count``). Uebergabe an Phase 7/8 (Entwurf §8.10): Bedarf (Weg +
  Anschlusszugaben) und Planungsreserve getrennt; Verschnitt und Verpackung sind Sache von
  ``materials`` und werden hier nicht gerechnet.
* **Trassen** zweimal abgeleitet: aus den bestaetigten Leitungen
  (``confirmed``) und aus allen gueltigen Teilstrecken aller Leitungen
  (``with_provisional``). Die Differenz ist ausdruecklich vorlaeufig. Zugaben
  sind keine Trasse.
* **Durchfuehrungen** nach Identitaet, genutzt (von gespeicherten Wegpunkten
  referenziert) oder ungenutzt; mehrere Leitungen zaehlen sie einmal.
* **Bodenuebergaenge** sind Wegpunkte je Leitung, kein Bauteil: ausgewiesen
  werden *Nutzungen* und die genutzten Oeffnungen, keine Stueckzahl von Bauteilen.
* **Geraete** je Stromkreis und Typ; zuordenbare, nicht zugeordnete Geraete;
  zugeordnete Geraete ohne Leitung (kein Start- oder Endgeraet einer Leitung) -
  ohne jede Aussage ueber elektrische Ausfuehrbarkeit.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal

from app.modules.electrical.cable_length import CEILING, FLOOR, RISER, SHAFT, WALL, CableResult
from app.modules.electrical.cable_rules import BuildingCableState
from app.modules.electrical.cable_traces import TraceSummary, derive_traces
from app.modules.electrical.catalog import ASSIGNABLE_CATEGORIES
from app.modules.electrical.models import ElectricalCable

#: Reihenfolge der Flaechen in der Uebersicht.
SURFACES: tuple[str, ...] = (WALL, CEILING, FLOOR, RISER, SHAFT)


@dataclass(frozen=True, slots=True)
class SpecKey:
    cable_type: str
    conductor_count: int
    cross_section_mm2: Decimal


@dataclass(frozen=True, slots=True)
class StatusBucket:
    count: int
    geometric_mm: int
    allowance_mm: int
    #: ``confirmed``: Summe ``length_mm``; sonst Teilsumme ``known_mm``.
    #: Beides geometrisch + Zugaben.
    total_mm: int
    cable_ids: tuple[uuid.UUID, ...]
    connection_allowance_mm: int = 0
    reserve_mm: int = 0
    reserve_pending_count: int = 0


@dataclass(frozen=True, slots=True)
class CableGroup:
    spec: SpecKey
    confirmed: StatusBucket
    incomplete: StatusBucket
    conflict: StatusBucket


@dataclass(frozen=True, slots=True)
class CableLine:
    cable: ElectricalCable
    result: CableResult
    #: ``cable_type``, ``conductor_count``, ``cross_section_mm2`` - fehlende Angaben.
    missing: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SurfaceMeters:
    surface: str
    confirmed_trace_mm: int
    confirmed_cable_mm: int
    all_trace_mm: int
    all_cable_mm: int
    #: ``False``: mindestens eine Steigwegtrasse mit unbekannter senkrechter Laenge
    #: (nur der bekannte Teil ist gezaehlt).
    confirmed_complete: bool
    all_complete: bool


@dataclass(frozen=True, slots=True)
class PenetrationUse:
    penetration_id: uuid.UUID
    cable_ids: tuple[uuid.UUID, ...]
    problem_code: str | None


@dataclass(frozen=True, slots=True)
class CrossingUse:
    opening_id: uuid.UUID | None
    wall_id: uuid.UUID
    cable_ids: tuple[uuid.UUID, ...]
    uses: int


@dataclass(frozen=True, slots=True)
class TypeCount:
    type_key: str
    label: str
    count: int


@dataclass(frozen=True, slots=True)
class CircuitDevices:
    circuit_id: uuid.UUID
    by_type: tuple[TypeCount, ...]
    device_ids: tuple[uuid.UUID, ...]
    without_cable: tuple[uuid.UUID, ...]


@dataclass(frozen=True, slots=True)
class CablingSummary:
    groups: tuple[CableGroup, ...]
    cables: tuple[CableLine, ...]
    unspecified: tuple[CableLine, ...]
    totals: CableGroup
    surfaces: tuple[SurfaceMeters, ...]
    penetrations: tuple[PenetrationUse, ...]
    crossings: tuple[CrossingUse, ...]
    circuits: tuple[CircuitDevices, ...]
    unassigned_device_ids: tuple[uuid.UUID, ...]


def missing_spec(cable: ElectricalCable) -> tuple[str, ...]:
    missing: list[str] = []
    if cable.cable_type is None or cable.cable_type.strip() == "":
        missing.append("cable_type")
    if cable.conductor_count is None:
        missing.append("conductor_count")
    if cable.cross_section_mm2 is None:
        missing.append("cross_section_mm2")
    return tuple(missing)


def _bucket(lines: list[CableLine], status: str) -> StatusBucket:
    chosen = [line for line in lines if line.result.status.value == status]
    return StatusBucket(
        count=len(chosen),
        geometric_mm=sum(line.result.geometric_mm for line in chosen),
        allowance_mm=sum(line.result.allowance_mm for line in chosen),
        total_mm=sum(
            (line.result.length_mm or 0) if status == "confirmed" else line.result.known_mm
            for line in chosen
        ),
        cable_ids=tuple(line.cable.id for line in chosen),
        connection_allowance_mm=sum(line.result.connection_allowance_mm for line in chosen),
        reserve_mm=sum(line.result.reserve_mm or 0 for line in chosen),
        reserve_pending_count=sum(1 for line in chosen if line.result.reserve_pending),
    )


def _group(spec: SpecKey, lines: list[CableLine]) -> CableGroup:
    return CableGroup(
        spec=spec,
        confirmed=_bucket(lines, "confirmed"),
        incomplete=_bucket(lines, "incomplete"),
        conflict=_bucket(lines, "conflict"),
    )


def _complete(traces: TraceSummary, surface: str) -> bool:
    return all(trace.complete for trace in traces.traces if trace.surface == surface)


def summarize(state: BuildingCableState, assignments: dict[uuid.UUID, uuid.UUID]) -> CablingSummary:
    """Mengenuebersicht aus dem gespeicherten Stand; ``assignments``: Stromkreis je Geraet."""
    lines = [
        CableLine(cable=cable, result=state.results[cid], missing=missing_spec(cable))
        for cid, cable in state.cables.items()
    ]
    by_spec: dict[SpecKey, list[CableLine]] = defaultdict(list)
    unspecified: list[CableLine] = []
    for line in lines:
        cable = line.cable
        if line.missing:
            unspecified.append(line)
            continue
        assert cable.cable_type is not None
        assert cable.conductor_count is not None
        assert cable.cross_section_mm2 is not None
        # Decimal: 1.5 und 1.50 sind gleich und haben denselben Hash - eine Gruppe.
        by_spec[SpecKey(cable.cable_type, cable.conductor_count, cable.cross_section_mm2)].append(
            line
        )
    groups = tuple(
        _group(spec, members)
        for spec, members in sorted(
            by_spec.items(),
            key=lambda kv: (kv[0].cable_type, kv[0].conductor_count, kv[0].cross_section_mm2),
        )
    )
    specified = [line for line in lines if not line.missing]
    totals = _group(SpecKey("", 0, Decimal(0)), specified)

    confirmed = derive_traces(
        line.result for line in lines if line.result.status.value == "confirmed"
    )
    everything = derive_traces(line.result for line in lines)
    surfaces = tuple(
        SurfaceMeters(
            surface=surface,
            confirmed_trace_mm=confirmed.trace_mm[surface],
            confirmed_cable_mm=confirmed.cable_mm[surface],
            all_trace_mm=everything.trace_mm[surface],
            all_cable_mm=everything.cable_mm[surface],
            confirmed_complete=_complete(confirmed, surface),
            all_complete=_complete(everything, surface),
        )
        for surface in SURFACES
    )

    # Durchfuehrungen und Bodenuebergaenge nach den gespeicherten Wegpunkten - auch wenn die
    # Strecke dort gerade einen Konflikt hat, nutzt die Leitung sie weiterhin.
    pen_users: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    crossing_users: dict[tuple[uuid.UUID | None, uuid.UUID], list[uuid.UUID]] = defaultdict(list)
    for cid, waypoints in state.waypoints.items():
        for wp in waypoints:
            if wp.kind == "penetration" and wp.penetration_id is not None:
                pen_users[wp.penetration_id].add(cid)
            elif wp.kind == "opening_crossing" and wp.wall_id is not None:
                crossing_users[(wp.opening_id, wp.wall_id)].append(cid)
    penetrations = tuple(
        PenetrationUse(
            penetration_id=pid,
            cable_ids=tuple(sorted(pen_users.get(pid, set()), key=str)),
            problem_code=state.penetration_codes.get(pid),
        )
        for pid in sorted(state.penetrations, key=str)
    )
    crossings = tuple(
        CrossingUse(
            opening_id=opening_id,
            wall_id=wall_id,
            cable_ids=tuple(sorted(set(users), key=str)),
            uses=len(users),
        )
        for (opening_id, wall_id), users in sorted(
            crossing_users.items(), key=lambda kv: (str(kv[0][0]), str(kv[0][1]))
        )
    )

    # Geraete: je Stromkreis und Typ; "ohne Leitung" = kein Start- oder Endgeraet einer Leitung.
    connected: set[uuid.UUID] = set()
    for cable in state.cables.values():
        for device_id in (cable.start_device_id, cable.end_device_id):
            if device_id is not None:
                connected.add(device_id)
    per_circuit: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for device_id, circuit_id in assignments.items():
        if device_id in state.devices and circuit_id in state.circuits:
            per_circuit[circuit_id].append(device_id)
    circuits: list[CircuitDevices] = []
    for circuit_id in state.circuits:
        devices = sorted(per_circuit.get(circuit_id, []), key=str)
        counts: dict[str, int] = defaultdict(int)
        for device_id in devices:
            counts[state.devices[device_id].device_type_key] += 1
        circuits.append(
            CircuitDevices(
                circuit_id=circuit_id,
                by_type=tuple(
                    TypeCount(
                        type_key=key,
                        label=state.types[key].label if key in state.types else key,
                        count=count,
                    )
                    for key, count in sorted(counts.items())
                ),
                device_ids=tuple(devices),
                without_cable=tuple(d for d in devices if d not in connected),
            )
        )
    # Nicht zugeordnet: nur zuordenbare Kategorien - Datendosen und das Lagegeraet einer
    # Verteilung (Kategorie ``distribution``) sind keine fehlende Verbraucherzuordnung.
    unassigned = tuple(
        device_id
        for device_id, device in sorted(state.devices.items(), key=lambda kv: str(kv[0]))
        if device_id not in assignments
        and device.device_type_key in state.types
        and state.types[device.device_type_key].category in ASSIGNABLE_CATEGORIES
    )
    return CablingSummary(
        groups=groups,
        cables=tuple(lines),
        unspecified=tuple(unspecified),
        totals=totals,
        surfaces=surfaces,
        penetrations=penetrations,
        crossings=crossings,
        circuits=tuple(circuits),
        unassigned_device_ids=unassigned,
    )


__all__ = [
    "SURFACES",
    "CableGroup",
    "CableLine",
    "CablingSummary",
    "CircuitDevices",
    "CrossingUse",
    "PenetrationUse",
    "SpecKey",
    "StatusBucket",
    "SurfaceMeters",
    "TypeCount",
    "missing_spec",
    "summarize",
]
