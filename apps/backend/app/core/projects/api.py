"""Endpunkte fuer Projekte, Gebaeude und Geschosse.

Statuswechsel sind eigene Endpunkte und kein Feld im ``PATCH``: Sie haben
Vorbedingungen und Nebenwirkungen und muessen einzeln protokolliert werden
(docs/api.md, Abschnitt 5).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.audit import service as audit
from app.core.auth.dependencies import CurrentUser, require_permission
from app.core.authorization.permissions import (
    PROJECT_RECORD_DELETE,
    PROJECT_RECORD_READ,
    PROJECT_RECORD_WRITE,
)
from app.core.pagination import DEFAULT_LIMIT, Page, clamp_limit
from app.core.preconditions import require_if_match
from app.core.projects.models import (
    PROJECT_STATUS_ACTIVE,
    PROJECT_STATUS_ARCHIVED,
    PROJECT_STATUS_COMPLETED,
    Project,
)
from app.core.projects.schemas import (
    BuildingCreate,
    BuildingOut,
    BuildingUpdate,
    FloorCreate,
    FloorOut,
    FloorUpdate,
    ProjectCreate,
    ProjectOut,
    ProjectStatus,
    ProjectSummary,
    ProjectUpdate,
)
from app.core.projects.service import ProjectService, ProjectSort
from app.db.session import get_session
from app.errors import ProblemDetail

router = APIRouter(tags=["projects"])

_WRITE_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"model": ProblemDetail, "description": "Nicht gefunden"},
    409: {
        "model": ProblemDetail,
        "description": "Versionskonflikt, unzulaessiger Statuswechsel oder archiviertes Projekt",
    },
    428: {"model": ProblemDetail, "description": "If-Match fehlt"},
}

_SUBRESOURCE_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"model": ProblemDetail, "description": "Nicht gefunden"},
    409: {"model": ProblemDetail, "description": "Projekt ist archiviert"},
}


def _summary(project: Project, customer_name: str) -> ProjectSummary:
    return ProjectSummary(
        id=project.id,
        project_number=project.project_number,
        name=project.name,
        status=project.status,
        customer_id=project.customer_id,
        customer_name=customer_name,
        site_city=project.site_city,
        version=project.version,
        created_at=project.created_at,
    )


# ---------------------------------------------------------------- Projekte


@router.get(
    "/projects",
    response_model=Page[ProjectSummary],
    operation_id="listProjects",
    summary="Projekte auflisten",
)
def list_projects(
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_READ)),
    session: Session = Depends(get_session),
    q: str | None = Query(default=None, max_length=120, description="Name, Nummer, Ort, Kunde"),
    project_status: ProjectStatus | None = Query(default=None, alias="status"),
    customer_id: uuid.UUID | None = Query(default=None),
    sort: ProjectSort = Query(default="created_at"),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=200),
    cursor: str | None = Query(default=None),
) -> Page[ProjectSummary]:
    """Projekte der eigenen Organisation - gefiltert, sortiert, seitenweise."""
    service = ProjectService(session, current_user.organization_id)
    page = service.list_projects(
        limit=clamp_limit(limit),
        cursor=cursor,
        search=q,
        status=project_status,
        customer_id=customer_id,
        sort=sort,
    )
    return Page[ProjectSummary](
        items=[_summary(project, customer_name) for project, customer_name in page.items],
        next_cursor=page.next_cursor,
        has_more=page.has_more,
    )


@router.post(
    "/projects",
    response_model=ProjectOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createProject",
    summary="Projekt anlegen",
    responses={404: {"model": ProblemDetail, "description": "Kunde nicht gefunden"}},
)
def create_project(
    payload: ProjectCreate,
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_WRITE)),
    session: Session = Depends(get_session),
) -> ProjectOut:
    """Legt ein Projekt an. Die Projektnummer vergibt der Nummernkreis."""
    service = ProjectService(session, current_user.organization_id)
    project = service.create(payload, actor_user_id=current_user.user_id)
    audit.record(
        session,
        organization_id=current_user.organization_id,
        action=audit.ACTION_PROJECT_CREATED,
        entity_type="project",
        entity_id=project.id,
        actor_user_id=current_user.user_id,
        summary=f"Projekt {project.project_number} angelegt",
        data={"project_number": project.project_number},
    )
    session.commit()
    return ProjectOut.model_validate(project)


@router.get(
    "/projects/{project_id}",
    response_model=ProjectOut,
    operation_id="getProject",
    summary="Projekt",
    responses={404: {"model": ProblemDetail, "description": "Nicht gefunden"}},
)
def get_project(
    project_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_READ)),
    session: Session = Depends(get_session),
) -> ProjectOut:
    """Ein Projekt der eigenen Organisation."""
    service = ProjectService(session, current_user.organization_id)
    return ProjectOut.model_validate(service.get(project_id))


@router.patch(
    "/projects/{project_id}",
    response_model=ProjectOut,
    operation_id="updateProject",
    summary="Projekt bearbeiten",
    responses=_WRITE_RESPONSES,
)
def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> ProjectOut:
    """Aendert Stammdaten. Status und Projektnummer bleiben unberuehrt.

    Ein archiviertes Projekt ist schreibgeschuetzt und liefert ``409``.
    """
    service = ProjectService(session, current_user.organization_id)
    project = service.update(
        project_id,
        payload,
        expected_version=expected_version,
        actor_user_id=current_user.user_id,
    )
    audit.record(
        session,
        organization_id=current_user.organization_id,
        action=audit.ACTION_PROJECT_UPDATED,
        entity_type="project",
        entity_id=project.id,
        actor_user_id=current_user.user_id,
        summary=f"Projekt {project.project_number} geaendert",
        data={"fields": sorted(payload.model_dump(exclude_unset=True))},
    )
    session.commit()
    return ProjectOut.model_validate(project)


@router.delete(
    "/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteProject",
    summary="Projekt ausblenden",
    responses=_WRITE_RESPONSES,
)
def delete_project(
    project_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_DELETE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> None:
    """Blendet das Projekt aus (Soft Delete). Gebaeude und Dateien bleiben.

    Funktioniert **auch bei archivierten Projekten**: Das Ausblenden ist kein
    inhaltlicher Eingriff, sondern ein Aufraeumschritt. Ohne diese Ausnahme
    liessen sich Kunden mit archivierten Projekten nie mehr ausblenden.
    """
    service = ProjectService(session, current_user.organization_id)
    project = service.soft_delete(
        project_id,
        expected_version=expected_version,
        actor_user_id=current_user.user_id,
    )
    audit.record(
        session,
        organization_id=current_user.organization_id,
        action=audit.ACTION_PROJECT_DELETED,
        entity_type="project",
        entity_id=project.id,
        actor_user_id=current_user.user_id,
        summary=f"Projekt {project.project_number} ausgeblendet",
    )
    session.commit()


def _change_status(
    *,
    session: Session,
    current_user: CurrentUser,
    project_id: uuid.UUID,
    target: str,
    expected_version: int,
) -> ProjectOut:
    service = ProjectService(session, current_user.organization_id)
    previous = service.get(project_id).status
    project = service.change_status(
        project_id,
        target,
        expected_version=expected_version,
        actor_user_id=current_user.user_id,
    )
    audit.record(
        session,
        organization_id=current_user.organization_id,
        action=audit.ACTION_PROJECT_STATUS_CHANGED,
        entity_type="project",
        entity_id=project.id,
        actor_user_id=current_user.user_id,
        summary=f"Projekt {project.project_number}: {previous} -> {project.status}",
        data={"from": previous, "to": project.status},
    )
    session.commit()
    return ProjectOut.model_validate(project)


@router.post(
    "/projects/{project_id}/activate",
    response_model=ProjectOut,
    operation_id="activateProject",
    summary="Projekt in Bearbeitung nehmen",
    responses=_WRITE_RESPONSES,
)
def activate_project(
    project_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> ProjectOut:
    """Setzt den Status von ``draft`` auf ``active``."""
    return _change_status(
        session=session,
        current_user=current_user,
        project_id=project_id,
        target=PROJECT_STATUS_ACTIVE,
        expected_version=expected_version,
    )


@router.post(
    "/projects/{project_id}/complete",
    response_model=ProjectOut,
    operation_id="completeProject",
    summary="Projekt abschliessen",
    responses=_WRITE_RESPONSES,
)
def complete_project(
    project_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> ProjectOut:
    """Setzt den Status von ``active`` auf ``completed``."""
    return _change_status(
        session=session,
        current_user=current_user,
        project_id=project_id,
        target=PROJECT_STATUS_COMPLETED,
        expected_version=expected_version,
    )


@router.post(
    "/projects/{project_id}/archive",
    response_model=ProjectOut,
    operation_id="archiveProject",
    summary="Projekt archivieren",
    responses=_WRITE_RESPONSES,
)
def archive_project(
    project_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> ProjectOut:
    """Archiviert das Projekt. Aus ``archived`` fuehrt kein Weg zurueck."""
    return _change_status(
        session=session,
        current_user=current_user,
        project_id=project_id,
        target=PROJECT_STATUS_ARCHIVED,
        expected_version=expected_version,
    )


# ---------------------------------------------------------------- Gebaeude


@router.get(
    "/projects/{project_id}/buildings",
    response_model=list[BuildingOut],
    operation_id="listBuildings",
    summary="Gebaeude eines Projekts",
    responses={404: {"model": ProblemDetail, "description": "Nicht gefunden"}},
)
def list_buildings(
    project_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_READ)),
    session: Session = Depends(get_session),
) -> list[BuildingOut]:
    """Gebaeude des Projekts, sortiert nach Reihenfolge und Name."""
    service = ProjectService(session, current_user.organization_id)
    return [BuildingOut.model_validate(row) for row in service.list_buildings(project_id)]


@router.post(
    "/projects/{project_id}/buildings",
    response_model=BuildingOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createBuilding",
    summary="Gebaeude anlegen",
    responses=_SUBRESOURCE_RESPONSES,
)
def create_building(
    project_id: uuid.UUID,
    payload: BuildingCreate,
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_WRITE)),
    session: Session = Depends(get_session),
) -> BuildingOut:
    """Legt ein Gebaeude im Projekt an."""
    service = ProjectService(session, current_user.organization_id)
    building = service.create_building(project_id, payload)
    session.commit()
    return BuildingOut.model_validate(building)


@router.patch(
    "/buildings/{building_id}",
    response_model=BuildingOut,
    operation_id="updateBuilding",
    summary="Gebaeude bearbeiten",
    responses=_WRITE_RESPONSES,
)
def update_building(
    building_id: uuid.UUID,
    payload: BuildingUpdate,
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> BuildingOut:
    """Aendert Name oder Reihenfolge eines Gebaeudes."""
    service = ProjectService(session, current_user.organization_id)
    building = service.update_building(building_id, payload, expected_version=expected_version)
    session.commit()
    return BuildingOut.model_validate(building)


@router.delete(
    "/buildings/{building_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteBuilding",
    summary="Gebaeude loeschen",
    responses=_WRITE_RESPONSES,
)
def delete_building(
    building_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> None:
    """Entfernt das Gebaeude samt seiner Geschosse endgueltig."""
    service = ProjectService(session, current_user.organization_id)
    service.delete_building(building_id, expected_version=expected_version)
    session.commit()


# --------------------------------------------------------------- Geschosse


@router.get(
    "/buildings/{building_id}/floors",
    response_model=list[FloorOut],
    operation_id="listFloors",
    summary="Geschosse eines Gebaeudes",
    responses={404: {"model": ProblemDetail, "description": "Nicht gefunden"}},
)
def list_floors(
    building_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_READ)),
    session: Session = Depends(get_session),
) -> list[FloorOut]:
    """Geschosse des Gebaeudes, von unten nach oben."""
    service = ProjectService(session, current_user.organization_id)
    return [FloorOut.model_validate(row) for row in service.list_floors(building_id)]


@router.post(
    "/buildings/{building_id}/floors",
    response_model=FloorOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createFloor",
    summary="Geschoss anlegen",
    responses={
        404: {"model": ProblemDetail, "description": "Gebaeude nicht gefunden"},
        409: {"model": ProblemDetail, "description": "Projekt ist archiviert"},
        422: {"model": ProblemDetail, "description": "Ebene bereits belegt"},
    },
)
def create_floor(
    building_id: uuid.UUID,
    payload: FloorCreate,
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_WRITE)),
    session: Session = Depends(get_session),
) -> FloorOut:
    """Legt ein Geschoss an. Je Gebaeude ist jede Ebene nur einmal belegbar."""
    service = ProjectService(session, current_user.organization_id)
    floor = service.create_floor(building_id, payload)
    session.commit()
    return FloorOut.model_validate(floor)


@router.patch(
    "/floors/{floor_id}",
    response_model=FloorOut,
    operation_id="updateFloor",
    summary="Geschoss bearbeiten",
    responses=_WRITE_RESPONSES,
)
def update_floor(
    floor_id: uuid.UUID,
    payload: FloorUpdate,
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> FloorOut:
    """Aendert Name, Ebene oder Hoehenangaben eines Geschosses."""
    service = ProjectService(session, current_user.organization_id)
    floor = service.update_floor(floor_id, payload, expected_version=expected_version)
    session.commit()
    return FloorOut.model_validate(floor)


@router.delete(
    "/floors/{floor_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteFloor",
    summary="Geschoss loeschen",
    responses=_WRITE_RESPONSES,
)
def delete_floor(
    floor_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> None:
    """Entfernt das Geschoss endgueltig."""
    service = ProjectService(session, current_user.organization_id)
    service.delete_floor(floor_id, expected_version=expected_version)
    session.commit()
