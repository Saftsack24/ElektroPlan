"""Teilnahme der Elektroplanung am Loeschprotokoll fuer Projekte (ADR 0020).

Die Planungsdaten haengen am Geschoss, nicht am Projekt (ADR 0013). Welche
Geschosse zu einem Projekt gehoeren, erfaehrt das Modul ueber den
oeffentlichen Erweiterungspunkt :mod:`app.core.projects.planning` - es liest
keine Core-Tabelle selbst.

* :meth:`ElectricalProjectContent.describe_project_content` zaehlt Raeume,
  Waende und Oeffnungen des Projekts.
* :meth:`ElectricalProjectContent.delete_project_content` loescht die Raeume;
  Waende und Oeffnungen folgen per ``ON DELETE CASCADE`` (Modelldefinition).

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
from app.modules.electrical.models import ElectricalOpening, ElectricalRoom, ElectricalWall

MODULE_ID = "electrical"


class ElectricalProjectContent:
    """Implementiert ``ProjectContentParticipant`` fuer Raeume, Waende, Oeffnungen."""

    def describe_project_content(
        self, session: Session, request: ProjectContentRequest
    ) -> ProjectContentReport:
        floor_ids = FloorPlanningAccess(session, request.organization_id).floor_ids_of_project(
            request.project_id
        )
        if not floor_ids:
            return ProjectContentReport(module_id=MODULE_ID, has_content=False)

        rooms = _rooms(request, floor_ids)
        room_count = int(
            session.execute(select(func.count()).select_from(rooms.subquery())).scalar_one()
        )
        if room_count == 0:
            return ProjectContentReport(module_id=MODULE_ID, has_content=False)
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
        items = [ProjectContentItem("electrical.rooms", "Räume", room_count)]
        if wall_count:
            items.append(ProjectContentItem("electrical.walls", "Wände", wall_count))
        if opening_count:
            items.append(
                ProjectContentItem(
                    "electrical.openings", "Türen, Fenster, Durchgänge", opening_count
                )
            )
        return ProjectContentReport(module_id=MODULE_ID, has_content=True, items=tuple(items))

    def delete_project_content(self, session: Session, request: ProjectContentRequest) -> None:
        floor_ids = FloorPlanningAccess(session, request.organization_id).floor_ids_of_project(
            request.project_id
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


def _rooms(
    request: ProjectContentRequest, floor_ids: tuple[uuid.UUID, ...]
) -> Select[tuple[ElectricalRoom]]:
    return select(ElectricalRoom).where(
        ElectricalRoom.organization_id == request.organization_id,
        ElectricalRoom.floor_id.in_(floor_ids),
    )
