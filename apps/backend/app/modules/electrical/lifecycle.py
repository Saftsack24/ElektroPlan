"""Teilnahme der Elektroplanung am Loeschprotokoll fuer Projekte (ADR 0020).

Die Planungsdaten haengen am Geschoss, nicht am Projekt (ADR 0013). Welche
Geschosse zu einem Projekt gehoeren, erfaehrt das Modul ueber den
oeffentlichen Erweiterungspunkt :mod:`app.core.projects.planning` - es liest
keine Core-Tabelle selbst.

* :meth:`ElectricalProjectContent.describe_project_content` zaehlt Raeume,
  Waende, Oeffnungen und (seit Phase 5) Geraete des Projekts.
* :meth:`ElectricalProjectContent.delete_project_content` loescht die Raeume;
  Waende, Oeffnungen, Geraete und (seit Phase 6a) Wandkopplungen folgen per
  ``ON DELETE CASCADE`` (Modelldefinition). Der Geraetekatalog ist global und
  bleibt unberuehrt.
* Seit Phase 6a.4 auch Steigwege (ADR 0025): Sie haengen am **Gebaeude** und
  werden ueber ``building_ids_of_project`` gefunden - auch ein Steigweg ohne
  Halt. Sie muessen **vor** dem Core-Kaskadieren weg, weil ihre Fremdschluessel
  auf Gebaeude und Geschosse ``RESTRICT`` tragen; die Halte folgen per
  ``CASCADE``.
* Seit Phase 6b.3 Leitungen (Wegpunkte per ``CASCADE``) und Durchfuehrungen.
  Reihenfolge beim Loeschen (Entwurf §7): Leitungen → Durchfuehrungen →
  Stromkreise → Verteilungen → Steigwege → Raeume. Leitungen halten Geraete, Waende,
  Raeume, Oeffnungen, Durchfuehrungen und Steigweghalte per ``RESTRICT``;
  Durchfuehrungen ihre Wandkopplung.
* Seit Phase 6b.0 Verteilungen, Stromkreise und Geraetezuordnungen (ADR 0026),
  ebenfalls ueber die Gebaeude gefunden. Reihenfolge beim Loeschen: Stromkreise
  (Zuordnungen per ``CASCADE``) → Verteilungen → Steigwege → Raeume. Die
  Verteilung verweist mit ``RESTRICT`` auf ihr Lagegeraet und ihr Gebaeude und
  muss deshalb vor den Raeumen und vor dem Core weg.

Beides laeuft in der Transaktion des Core, der die Projektzeile bereits
gesperrt haelt. Hier wird nicht committet.
"""

from __future__ import annotations

import uuid

from sqlalchemy import Select, delete, func, select
from sqlalchemy.orm import Session

from app.contracts.v1.project_lifecycle import (
    ProjectContentItem,
    ProjectContentReport,
    ProjectContentRequest,
)
from app.core.projects.planning import FloorPlanningAccess
from app.modules.electrical.models import (
    ElectricalCable,
    ElectricalCircuit,
    ElectricalCircuitDevice,
    ElectricalDevice,
    ElectricalDistributionBoard,
    ElectricalOpening,
    ElectricalRiser,
    ElectricalRiserStop,
    ElectricalRoom,
    ElectricalWall,
    ElectricalWallLink,
    ElectricalWallPenetration,
)

MODULE_ID = "electrical"


class ElectricalProjectContent:
    """Implementiert ``ProjectContentParticipant`` fuer Raeume, Waende, Oeffnungen."""

    def describe_project_content(
        self, session: Session, request: ProjectContentRequest
    ) -> ProjectContentReport:
        access = FloorPlanningAccess(session, request.organization_id)
        building_ids = access.building_ids_of_project(request.project_id)
        floor_ids = access.floor_ids_of_project(request.project_id)
        riser_items = [
            *_distribution_items(session, request, building_ids),
            *_cable_items(session, request, building_ids, floor_ids),
            *_riser_items(session, request, building_ids),
        ]
        if not floor_ids:
            return _report(riser_items)

        rooms = _rooms(request, floor_ids)
        room_count = int(
            session.execute(select(func.count()).select_from(rooms.subquery())).scalar_one()
        )
        if room_count == 0:
            return _report(riser_items)
        wall_count = int(
            session.execute(
                select(func.count())
                .select_from(ElectricalWall)
                .where(
                    ElectricalWall.organization_id == request.organization_id,
                    ElectricalWall.room_id.in_(rooms.with_only_columns(ElectricalRoom.id)),
                )
            ).scalar_one()
        )
        opening_count = int(
            session.execute(
                select(func.count())
                .select_from(ElectricalOpening)
                .join(
                    ElectricalWall,
                    (ElectricalWall.organization_id == ElectricalOpening.organization_id)
                    & (ElectricalWall.id == ElectricalOpening.wall_id),
                )
                .where(
                    ElectricalOpening.organization_id == request.organization_id,
                    ElectricalWall.room_id.in_(rooms.with_only_columns(ElectricalRoom.id)),
                )
            ).scalar_one()
        )
        device_count = int(
            session.execute(
                select(func.count())
                .select_from(ElectricalDevice)
                .where(
                    ElectricalDevice.organization_id == request.organization_id,
                    ElectricalDevice.room_id.in_(rooms.with_only_columns(ElectricalRoom.id)),
                )
            ).scalar_one()
        )
        # Wandkopplungen (Phase 6a): beide Waende liegen auf demselben Geschoss.
        link_count = int(
            session.execute(
                select(func.count())
                .select_from(ElectricalWallLink)
                .join(
                    ElectricalWall,
                    (ElectricalWall.organization_id == ElectricalWallLink.organization_id)
                    & (ElectricalWall.id == ElectricalWallLink.wall_a_id),
                )
                .where(
                    ElectricalWallLink.organization_id == request.organization_id,
                    ElectricalWall.room_id.in_(rooms.with_only_columns(ElectricalRoom.id)),
                )
            ).scalar_one()
        )
        items = [ProjectContentItem("electrical.rooms", "Räume", room_count)]
        if wall_count:
            items.append(ProjectContentItem("electrical.walls", "Wände", wall_count))
        if opening_count:
            items.append(
                ProjectContentItem(
                    "electrical.openings", "Türen, Fenster, Durchgänge", opening_count
                )
            )
        if device_count:
            items.append(ProjectContentItem("electrical.devices", "Geräte", device_count))
        if link_count:
            items.append(ProjectContentItem("electrical.wall_links", "Wandzuordnungen", link_count))
        return _report([*items, *riser_items])

    def delete_project_content(self, session: Session, request: ProjectContentRequest) -> None:
        access = FloorPlanningAccess(session, request.organization_id)
        building_ids = access.building_ids_of_project(request.project_id)
        floor_ids = access.floor_ids_of_project(request.project_id)
        if building_ids:
            # Leitungen zuerst (Wegpunkte per CASCADE): Sie halten Geraete, Waende,
            # Raeume, Oeffnungen, Durchfuehrungen und Steigweghalte per RESTRICT.
            session.execute(
                delete(ElectricalCable)
                .where(
                    ElectricalCable.organization_id == request.organization_id,
                    ElectricalCable.circuit_id.in_(_circuit_ids(request, building_ids)),
                )
                .execution_options(synchronize_session=False)
            )
        if floor_ids:
            # Dann Durchfuehrungen: Sie halten ihre Wandkopplung per RESTRICT.
            session.execute(
                delete(ElectricalWallPenetration)
                .where(
                    ElectricalWallPenetration.organization_id == request.organization_id,
                    ElectricalWallPenetration.wall_link_id.in_(_link_ids(request, floor_ids)),
                )
                .execution_options(synchronize_session=False)
            )
        if building_ids:
            # Stromkreise und Verteilungen zuerst: Die Verteilung haelt ihr
            # Lagegeraet und ihr Gebaeude per RESTRICT, Stromkreise ihre
            # Verteilung. Zuordnungen folgen den Stromkreisen per CASCADE.
            boards = select(ElectricalDistributionBoard.id).where(
                ElectricalDistributionBoard.organization_id == request.organization_id,
                ElectricalDistributionBoard.building_id.in_(building_ids),
            )
            session.execute(
                delete(ElectricalCircuit)
                .where(
                    ElectricalCircuit.organization_id == request.organization_id,
                    ElectricalCircuit.board_id.in_(boards),
                )
                .execution_options(synchronize_session=False)
            )
            session.execute(
                delete(ElectricalDistributionBoard)
                .where(
                    ElectricalDistributionBoard.organization_id == request.organization_id,
                    ElectricalDistributionBoard.building_id.in_(building_ids),
                )
                .execution_options(synchronize_session=False)
            )
            # Steigwege zuerst: Ihre Fremdschluessel auf Gebaeude und Geschosse
            # tragen RESTRICT. Die Halte folgen per CASCADE.
            session.execute(
                delete(ElectricalRiser)
                .where(
                    ElectricalRiser.organization_id == request.organization_id,
                    ElectricalRiser.building_id.in_(building_ids),
                )
                .execution_options(synchronize_session=False)
            )
        if not floor_ids:
            return
        session.execute(
            delete(ElectricalRoom)
            .where(
                ElectricalRoom.organization_id == request.organization_id,
                ElectricalRoom.floor_id.in_(floor_ids),
            )
            .execution_options(synchronize_session=False)
        )


def _report(items: list[ProjectContentItem]) -> ProjectContentReport:
    return ProjectContentReport(module_id=MODULE_ID, has_content=bool(items), items=tuple(items))


def _distribution_items(
    session: Session, request: ProjectContentRequest, building_ids: tuple[uuid.UUID, ...]
) -> list[ProjectContentItem]:
    """Verteilungen, Stromkreise und Zuordnungen des Projekts (Phase 6b.0)."""
    if not building_ids:
        return []
    boards = select(ElectricalDistributionBoard.id).where(
        ElectricalDistributionBoard.organization_id == request.organization_id,
        ElectricalDistributionBoard.building_id.in_(building_ids),
    )
    board_count = int(
        session.execute(select(func.count()).select_from(boards.subquery())).scalar_one()
    )
    if board_count == 0:
        return []
    circuits = select(ElectricalCircuit.id).where(
        ElectricalCircuit.organization_id == request.organization_id,
        ElectricalCircuit.board_id.in_(boards),
    )
    circuit_count = int(
        session.execute(select(func.count()).select_from(circuits.subquery())).scalar_one()
    )
    assignment_count = int(
        session.execute(
            select(func.count())
            .select_from(ElectricalCircuitDevice)
            .where(
                ElectricalCircuitDevice.organization_id == request.organization_id,
                ElectricalCircuitDevice.circuit_id.in_(circuits),
            )
        ).scalar_one()
    )
    items = [ProjectContentItem("electrical.distribution_boards", "Verteilungen", board_count)]
    if circuit_count:
        items.append(ProjectContentItem("electrical.circuits", "Stromkreise", circuit_count))
    if assignment_count:
        items.append(
            ProjectContentItem(
                "electrical.circuit_devices", "Gerätezuordnungen zu Stromkreisen", assignment_count
            )
        )
    return items


def _circuit_ids(
    request: ProjectContentRequest, building_ids: tuple[uuid.UUID, ...]
) -> Select[tuple[uuid.UUID]]:
    boards = select(ElectricalDistributionBoard.id).where(
        ElectricalDistributionBoard.organization_id == request.organization_id,
        ElectricalDistributionBoard.building_id.in_(building_ids),
    )
    return select(ElectricalCircuit.id).where(
        ElectricalCircuit.organization_id == request.organization_id,
        ElectricalCircuit.board_id.in_(boards),
    )


def _link_ids(
    request: ProjectContentRequest, floor_ids: tuple[uuid.UUID, ...]
) -> Select[tuple[uuid.UUID]]:
    rooms = select(ElectricalRoom.id).where(
        ElectricalRoom.organization_id == request.organization_id,
        ElectricalRoom.floor_id.in_(floor_ids),
    )
    walls = select(ElectricalWall.id).where(
        ElectricalWall.organization_id == request.organization_id,
        ElectricalWall.room_id.in_(rooms),
    )
    return select(ElectricalWallLink.id).where(
        ElectricalWallLink.organization_id == request.organization_id,
        ElectricalWallLink.wall_a_id.in_(walls),
    )


def _cable_items(
    session: Session,
    request: ProjectContentRequest,
    building_ids: tuple[uuid.UUID, ...],
    floor_ids: tuple[uuid.UUID, ...],
) -> list[ProjectContentItem]:
    """Leitungen und Durchfuehrungen des Projekts (Phase 6b.3)."""
    items: list[ProjectContentItem] = []
    if building_ids:
        cable_count = int(
            session.execute(
                select(func.count())
                .select_from(ElectricalCable)
                .where(
                    ElectricalCable.organization_id == request.organization_id,
                    ElectricalCable.circuit_id.in_(_circuit_ids(request, building_ids)),
                )
            ).scalar_one()
        )
        if cable_count:
            items.append(ProjectContentItem("electrical.cables", "Leitungen", cable_count))
    if floor_ids:
        penetration_count = int(
            session.execute(
                select(func.count())
                .select_from(ElectricalWallPenetration)
                .where(
                    ElectricalWallPenetration.organization_id == request.organization_id,
                    ElectricalWallPenetration.wall_link_id.in_(_link_ids(request, floor_ids)),
                )
            ).scalar_one()
        )
        if penetration_count:
            items.append(
                ProjectContentItem("electrical.penetrations", "Durchführungen", penetration_count)
            )
    return items


def _riser_items(
    session: Session, request: ProjectContentRequest, building_ids: tuple[uuid.UUID, ...]
) -> list[ProjectContentItem]:
    """Steigwege und Uebergabepunkte des Projekts (Phase 6a.4)."""
    if not building_ids:
        return []
    riser_ids = select(ElectricalRiser.id).where(
        ElectricalRiser.organization_id == request.organization_id,
        ElectricalRiser.building_id.in_(building_ids),
    )
    riser_count = int(
        session.execute(select(func.count()).select_from(riser_ids.subquery())).scalar_one()
    )
    if riser_count == 0:
        return []
    stop_count = int(
        session.execute(
            select(func.count())
            .select_from(ElectricalRiserStop)
            .where(
                ElectricalRiserStop.organization_id == request.organization_id,
                ElectricalRiserStop.riser_id.in_(riser_ids),
            )
        ).scalar_one()
    )
    items = [ProjectContentItem("electrical.risers", "Steigwege", riser_count)]
    if stop_count:
        items.append(
            ProjectContentItem(
                "electrical.riser_stops", "Übergabepunkte von Steigwegen", stop_count
            )
        )
    return items


def _rooms(
    request: ProjectContentRequest, floor_ids: tuple[uuid.UUID, ...]
) -> Select[tuple[ElectricalRoom]]:
    return select(ElectricalRoom).where(
        ElectricalRoom.organization_id == request.organization_id,
        ElectricalRoom.floor_id.in_(floor_ids),
    )
