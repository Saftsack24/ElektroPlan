"""Bestandsuebernahme eindeutiger Wandkopplungen (Phase 6a.3, ADR 0024).

``python -m app.cli wall-links-backfill [--project PR-...] [--apply]``

**Standard ist der Probelauf.** Erst ``--apply`` schreibt. Uebernommen werden
ausschliesslich die *eindeutigen* Faelle (``link_rules.CandidateKind.SUGGESTED``)
als ``shared`` mit ``origin = backfill``:

* exakt kollinear, positive Ueberlappung, verschiedene Raeume,
* auf jedem Stueck des Bereichs genau diese zwei Waende,
* beide Konturen gueltig, gleiche Wandstaerke,
* keine beidseitig erfassten Oeffnungen im Bereich.

``separate`` wird **nie** automatisch angelegt; vorhandene Kopplungen - auch
ausdrueckliche Entscheidungen - werden nie veraendert oder ueberschrieben.
Mehrdeutige Faelle bleiben unentschieden und stehen mit Grund im Bericht.
Hoehenlagen werden nicht bestaetigt.

**Ablauf je Projekt, in genau einer Transaktion:**

1. Status lesen. ``completed``/``archived``: nur berichten, nichts schreiben.
2. Projektzeile sperren (``FloorPlanningAccess.writable_context``) - dieselbe
   Sperrreihenfolge wie jeder Schreibvorgang ("Projekt zuerst").
3. Je Geschoss: Pruefsumme ueber Waende, Oeffnungen und Geraete sowie die
   Geraetebefunde festhalten, eindeutige Paare anlegen, die Raumversion der
   beiden Raeume weiterzaehlen (ein offener Raumentwurf bemerkt die neue
   Zuordnung als Versionskonflikt), Pruefsumme und Befunde erneut bilden.
4. Weicht etwas ab: Rollback des ganzen Projekts, Fehler im Bericht.
5. Probelauf: Rollback; ``--apply``: Commit.

Wiederholbar und nach Abbruch fortsetzbar: Bestehende Paare sind keine
Kandidaten mehr (``UNIQUE``); jedes Projekt ist fuer sich abgeschlossen.

Das Modul liest keine Core-Tabelle: Projekte findet es ueber die eigenen Raeume
und den oeffentlichen Zugang ``FloorPlanningAccess``.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.persistence import flush
from app.core.projects.planning import FloorPlanningAccess, FloorPlanningContext
from app.db.mixins import utcnow
from app.errors import AppError
from app.modules.electrical.device_rules import FloorDeviceCheck, baseline_of, room_label
from app.modules.electrical.link_rules import (
    REASON_AMBIGUOUS,
    REASON_CONTOUR,
    REASON_OPENINGS,
    REASON_THICKNESS,
    CandidateKind,
    LinkCandidate,
)
from app.modules.electrical.models import (
    ElectricalDevice,
    ElectricalOpening,
    ElectricalRoom,
    ElectricalWall,
    ElectricalWallLink,
)
from app.modules.electrical.wall_links import analyse_links

#: Status, die nur berichtet und nie veraendert werden.
READ_ONLY_STATUSES = frozenset({"completed", "archived"})

REASON_TEXT = {
    REASON_AMBIGUOUS: (
        "mehr als zwei Waende auf einem Stueck (dritter Raum, doppelte Wand oder "
        "ueberschneidende Zuordnung)"
    ),
    REASON_THICKNESS: "Wandstaerken verschieden",
    REASON_CONTOUR: "Raumkontur nicht geschlossen",
    REASON_OPENINGS: "Oeffnungen auf beiden Seiten erfasst",
}


@dataclass(frozen=True, slots=True)
class PairNote:
    """Ein Wandpaar im Bericht - verstaendlich benannt."""

    wall_a_id: uuid.UUID
    wall_b_id: uuid.UUID
    label: str
    reasons: tuple[str, ...] = ()


@dataclass(slots=True)
class ProjectReport:
    organization_id: uuid.UUID
    project_id: uuid.UUID
    project_number: str
    status: str
    created: list[PairNote] = field(default_factory=list)
    unclear: list[PairNote] = field(default_factory=list)
    existing: int = 0
    #: Gesetzt, wenn das Projekt nur berichtet (``completed``/``archived``).
    read_only: bool = False
    #: Gesetzt, wenn das Projekt zurueckgerollt wurde.
    error: str | None = None


@dataclass(slots=True)
class BackfillReport:
    applied: bool
    projects: list[ProjectReport] = field(default_factory=list)

    @property
    def created(self) -> int:
        return sum(len(p.created) for p in self.projects if p.error is None)

    @property
    def failed(self) -> int:
        return sum(1 for p in self.projects if p.error is not None)


class BackfillMismatchError(Exception):
    """Pruefsumme oder Geraetebefunde haben sich veraendert - Rollback."""


#: Pruefsumme eines Geschosses; austauschbar nur fuer Tests.
Checksum = Callable[[Session, uuid.UUID, uuid.UUID], str]


def floor_checksum(session: Session, organization_id: uuid.UUID, floor_id: uuid.UUID) -> str:
    """SHA-256 ueber alle Felder der Waende, Oeffnungen und Geraete eines Geschosses."""
    room_ids = list(
        session.execute(
            select(ElectricalRoom.id)
            .where(
                ElectricalRoom.organization_id == organization_id,
                ElectricalRoom.floor_id == floor_id,
            )
            .order_by(ElectricalRoom.id)
        ).scalars()
    )
    digest = hashlib.sha256()
    if not room_ids:
        return digest.hexdigest()
    walls = session.execute(
        select(ElectricalWall)
        .where(
            ElectricalWall.organization_id == organization_id,
            ElectricalWall.room_id.in_(room_ids),
        )
        .order_by(ElectricalWall.id)
        .execution_options(populate_existing=True)
    ).scalars()
    wall_ids: list[uuid.UUID] = []
    for wall in walls:
        wall_ids.append(wall.id)
        digest.update(
            repr(
                (
                    "wall",
                    wall.id,
                    wall.room_id,
                    wall.x1_mm,
                    wall.y1_mm,
                    wall.x2_mm,
                    wall.y2_mm,
                    wall.thickness_mm,
                    wall.sort_order,
                    wall.version,
                    wall.updated_at,
                )
            ).encode()
        )
    if wall_ids:
        for opening in session.execute(
            select(ElectricalOpening)
            .where(
                ElectricalOpening.organization_id == organization_id,
                ElectricalOpening.wall_id.in_(wall_ids),
            )
            .order_by(ElectricalOpening.id)
            .execution_options(populate_existing=True)
        ).scalars():
            digest.update(
                repr(
                    (
                        "opening",
                        opening.id,
                        opening.wall_id,
                        opening.kind,
                        opening.offset_mm,
                        opening.width_mm,
                        opening.height_mm,
                        opening.sill_height_mm,
                        opening.version,
                        opening.updated_at,
                    )
                ).encode()
            )
    for device in session.execute(
        select(ElectricalDevice)
        .where(
            ElectricalDevice.organization_id == organization_id,
            ElectricalDevice.room_id.in_(room_ids),
        )
        .order_by(ElectricalDevice.id)
        .execution_options(populate_existing=True)
    ).scalars():
        digest.update(
            repr(
                (
                    "device",
                    device.id,
                    device.room_id,
                    device.device_type_key,
                    device.mounting_surface,
                    device.wall_id,
                    device.center_offset_mm,
                    device.center_height_mm,
                    device.x_mm,
                    device.y_mm,
                    device.label,
                    device.updated_at,
                )
            ).encode()
        )
    return digest.hexdigest()


def _projects(
    session: Session, project_number: str | None
) -> list[tuple[uuid.UUID, uuid.UUID, str, tuple[uuid.UUID, ...]]]:
    """``(Organisation, Projekt, Projektnummer, Geschosse)`` aller Projekte mit Raeumen."""
    pairs = session.execute(
        select(ElectricalRoom.organization_id, ElectricalRoom.floor_id)
        .distinct()
        .order_by(ElectricalRoom.organization_id, ElectricalRoom.floor_id)
    ).all()
    grouped: dict[tuple[uuid.UUID, uuid.UUID], tuple[str, list[uuid.UUID]]] = {}
    for organization_id, floor_id in pairs:
        context = FloorPlanningAccess(session, organization_id).context(floor_id)
        if project_number is not None and context.project_number != project_number:
            continue
        key = (organization_id, context.project_id)
        grouped.setdefault(key, (context.project_number, []))[1].append(floor_id)
    return sorted(
        (
            (organization_id, project_id, number, tuple(floors))
            for (organization_id, project_id), (number, floors) in grouped.items()
        ),
        key=lambda item: (str(item[0]), item[2]),
    )


def run_backfill(
    session_factory: Callable[[], Session],
    *,
    apply: bool,
    project_number: str | None = None,
    checksum: Checksum = floor_checksum,
) -> BackfillReport:
    """Probelauf oder Uebernahme ueber alle (oder ein) Projekte - je Projekt eine Transaktion."""
    report = BackfillReport(applied=apply)
    with session_factory() as session:
        projects = _projects(session, project_number)
    for organization_id, project_id, number, floor_ids in projects:
        with session_factory() as session:
            item = _project(
                session,
                organization_id=organization_id,
                project_id=project_id,
                project_number=number,
                floor_ids=floor_ids,
                apply=apply,
                checksum=checksum,
            )
        report.projects.append(item)
    return report


def _project(
    session: Session,
    *,
    organization_id: uuid.UUID,
    project_id: uuid.UUID,
    project_number: str,
    floor_ids: Sequence[uuid.UUID],
    apply: bool,
    checksum: Checksum,
) -> ProjectReport:
    access = FloorPlanningAccess(session, organization_id)
    status = access.context(floor_ids[0]).project_status
    item = ProjectReport(
        organization_id=organization_id,
        project_id=project_id,
        project_number=project_number,
        status=status,
        read_only=status in READ_ONLY_STATUSES,
    )
    try:
        for floor_id in floor_ids:
            if item.read_only:
                context = access.context(floor_id)
            else:
                # Projekt zuerst - dieselbe Sperrreihenfolge wie jeder Schreibvorgang.
                context = access.writable_context(floor_id)
            _floor(session, context, item, write=not item.read_only, checksum=checksum)
        if apply and not item.read_only:
            session.commit()
        else:
            session.rollback()
    except (BackfillMismatchError, AppError) as exc:
        # Abweichung, inzwischen schreibgeschuetzt o. a.: das ganze Projekt zurueck.
        session.rollback()
        item.error = str(exc)
        item.created.clear()
    return item


def _floor(
    session: Session,
    context: FloorPlanningContext,
    item: ProjectReport,
    *,
    write: bool,
    checksum: Checksum,
) -> None:
    organization_id = context.organization_id
    rooms = list(
        session.execute(
            select(ElectricalRoom)
            .where(
                ElectricalRoom.organization_id == organization_id,
                ElectricalRoom.floor_id == context.floor_id,
            )
            .order_by(ElectricalRoom.id)
        ).scalars()
    )
    if not rooms:
        return
    walls = list(
        session.execute(
            select(ElectricalWall)
            .where(
                ElectricalWall.organization_id == organization_id,
                ElectricalWall.room_id.in_([room.id for room in rooms]),
            )
            .order_by(ElectricalWall.room_id, ElectricalWall.sort_order, ElectricalWall.id)
        ).scalars()
    )
    wall_ids = [wall.id for wall in walls]
    openings: dict[uuid.UUID, list[ElectricalOpening]] = {}
    links: list[ElectricalWallLink] = []
    if wall_ids:
        for opening in session.execute(
            select(ElectricalOpening).where(
                ElectricalOpening.organization_id == organization_id,
                ElectricalOpening.wall_id.in_(wall_ids),
            )
        ).scalars():
            openings.setdefault(opening.wall_id, []).append(opening)
        links = list(
            session.execute(
                select(ElectricalWallLink).where(
                    ElectricalWallLink.organization_id == organization_id,
                    ElectricalWallLink.wall_a_id.in_(wall_ids),
                    ElectricalWallLink.wall_b_id.in_(wall_ids),
                )
            ).scalars()
        )
    item.existing += len(links)
    _, candidates = analyse_links(rooms, walls, openings, links)
    by_wall = {wall.id: wall for wall in walls}
    by_room = {room.id: room for room in rooms}

    def note(candidate: LinkCandidate) -> PairNote:
        a = by_wall[uuid.UUID(candidate.wall_a_id)]
        b = by_wall[uuid.UUID(candidate.wall_b_id)]
        label = (
            f'Geschoss {context.floor_name}: Raum "{room_label(by_room[a.room_id])}" Wand '
            f'{a.sort_order + 1} <-> Raum "{room_label(by_room[b.room_id])}" Wand '
            f"{b.sort_order + 1}"
        )
        return PairNote(
            wall_a_id=a.id,
            wall_b_id=b.id,
            label=label,
            reasons=tuple(REASON_TEXT.get(reason, reason) for reason in candidate.reasons),
        )

    suggested = [c for c in candidates if c.kind is CandidateKind.SUGGESTED]
    item.unclear.extend(note(c) for c in candidates if c.kind is not CandidateKind.SUGGESTED)
    if not suggested:
        return

    check = FloorDeviceCheck(session, organization_id)
    before_sum = checksum(session, organization_id, context.floor_id)
    before_state = check.state(context.floor_id, context.default_ceiling_height_mm)
    before_findings = {} if before_state is None else baseline_of(before_state.findings)

    touched: set[uuid.UUID] = set()
    for candidate in suggested:
        pair = note(candidate)
        item.created.append(pair)
        if not write:
            continue
        session.add(
            ElectricalWallLink(
                id=uuid.uuid4(),
                organization_id=organization_id,
                wall_a_id=pair.wall_a_id,
                wall_b_id=pair.wall_b_id,
                relation="shared",
                origin="backfill",
                created_by_user_id=None,
            )
        )
        touched.update((by_wall[pair.wall_a_id].room_id, by_wall[pair.wall_b_id].room_id))
    if not write:
        return
    for room_id in sorted(touched):
        by_room[room_id].updated_at = utcnow()
    flush(session)

    after_sum = checksum(session, organization_id, context.floor_id)
    after_state = check.state(context.floor_id, context.default_ceiling_height_mm)
    after_findings = {} if after_state is None else baseline_of(after_state.findings)
    if after_sum != before_sum:
        raise BackfillMismatchError(
            f"Geschoss {context.floor_name}: Pruefsumme ueber Waende, Oeffnungen und Geraete "
            "hat sich veraendert. Das Projekt wurde zurueckgerollt."
        )
    if after_findings != before_findings:
        raise BackfillMismatchError(
            f"Geschoss {context.floor_name}: Die Geraetebefunde haetten sich veraendert. Das "
            "Projekt wurde zurueckgerollt."
        )


def format_report(report: BackfillReport) -> list[str]:
    """Bericht fuer die Kommandozeile - deutsch, ohne interne Details."""
    mode = "UEBERNAHME" if report.applied else "PROBELAUF (nichts gespeichert)"
    lines = [f"Wandkopplungen - {mode}"]
    # Projektnummern sind nur je Betrieb eindeutig - bei mehreren Betrieben die Kennung nennen.
    mehrere = len({item.organization_id for item in report.projects}) > 1
    for item in report.projects:
        betrieb = f" - Betrieb {str(item.organization_id)[:8]}" if mehrere else ""
        head = f"Projekt {item.project_number}{betrieb} ({item.status})"
        if item.read_only:
            head += " - nur Bericht, schreibgeschuetzt"
        lines.append(head)
        if item.error is not None:
            lines.append(f"  FEHLER: {item.error}")
        verb = "angelegt" if report.applied and not item.read_only else "wuerde angelegt"
        for pair in item.created:
            lines.append(f"  {verb} (gemeinsame Bauwand): {pair.label}")
        lines.append(f"  bereits vorhanden: {item.existing}")
        for pair in item.unclear:
            lines.append(f"  offen, nicht uebernommen: {pair.label} - {'; '.join(pair.reasons)}")
    lines.append(
        f"Summe: {report.created} {'angelegt' if report.applied else 'eindeutig'}, "
        f"{sum(len(p.unclear) for p in report.projects)} offen, "
        f"{report.failed} Projekt(e) zurueckgerollt"
    )
    return lines
