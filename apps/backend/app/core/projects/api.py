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
    PROJECT_RECORD_REOPEN,
    PROJECT_RECORD_WRITE,
)
from app.core.files import cleanup
from app.core.files.storage import ObjectStorage, get_object_storage
from app.core.pagination import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, NumberedPage
from app.core.preconditions import require_if_match
from app.core.projects.deletion import (
    Participant,
    ProjectDeletionService,
    registered_participants,
)
from app.core.projects.floor_height import HeightParticipant, registered_height_participants
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
    ProjectContentOut,
    ProjectCreate,
    ProjectDeletionCheck,
    ProjectOut,
    ProjectStatus,
    ProjectStatusGroup,
    ProjectSummary,
    ProjectUpdate,
)
from app.core.projects.service import ProjectService, ProjectSort
from app.core.users.references import UserReferenceResolver
from app.db.session import get_session
from app.errors import ProblemDetail
from app.logging_config import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["projects"])

_WRITE_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"model": ProblemDetail, "description": "Nicht gefunden"},
    409: {
        "model": ProblemDetail,
        "description": (
            "Versionskonflikt, unzulaessiger Statuswechsel, archiviertes oder "
            "abgeschlossenes Projekt"
        ),
    },
    428: {"model": ProblemDetail, "description": "If-Match fehlt"},
}

_SUBRESOURCE_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"model": ProblemDetail, "description": "Nicht gefunden"},
    409: {"model": ProblemDetail, "description": "Projekt ist archiviert oder abgeschlossen"},
}


def get_project_participants() -> tuple[Participant, ...]:
    """Teilnehmer des Loeschprotokolls aus der Module Registry (ADR 0020)."""
    return registered_participants()


def get_height_participants() -> tuple[HeightParticipant, ...]:
    """Pruefer einer neuen Geschoss-Standardhoehe aus der Module Registry (ADR 0022)."""
    return registered_height_participants()


def _project_out(session: Session, current_user: CurrentUser, project: Project) -> ProjectOut:
    """Projekt samt lesbarer Bearbeiter - zwei IDs, eine Abfrage."""
    people = UserReferenceResolver(session, current_user.organization_id).load(
        (project.created_by_user_id, project.updated_by_user_id)
    )
    return ProjectOut(
        id=project.id,
        project_number=project.project_number,
        name=project.name,
        status=project.status,
        customer_id=project.customer_id,
        site_street=project.site_street,
        site_postal_code=project.site_postal_code,
        site_city=project.site_city,
        site_country_code=project.site_country_code,
        version=project.version,
        created_at=project.created_at,
        updated_at=project.updated_at,
        created_by=people.reference(project.created_by_user_id),
        updated_by=people.reference(project.updated_by_user_id),
    )


def _summary(project: Project, customer_name: str, people: UserReferenceResolver) -> ProjectSummary:
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
        updated_at=project.updated_at,
        created_by=people.reference(project.created_by_user_id),
        updated_by=people.reference(project.updated_by_user_id),
    )


# ---------------------------------------------------------------- Projekte


@router.get(
    "/projects",
    response_model=NumberedPage[ProjectSummary],
    operation_id="listProjects",
    summary="Projekte auflisten",
)
def list_projects(
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_READ)),
    session: Session = Depends(get_session),
    q: str | None = Query(
        default=None, max_length=120, description="Bezeichnung, Projektnummer oder Baustellenort"
    ),
    project_status: ProjectStatus | None = Query(default=None, alias="status"),
    status_group: ProjectStatusGroup | None = Query(
        default=None,
        description=(
            "current = draft + active, closed = completed + archived. "
            "Schliesst sich mit status aus."
        ),
    ),
    customer_id: uuid.UUID | None = Query(default=None),
    sort: ProjectSort = Query(default="created_at"),
    page: int = Query(default=1, ge=1, le=1_000_000, description="Seite, beginnend bei 1"),
    page_size: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
) -> NumberedPage[ProjectSummary]:
    """Projekte der eigenen Organisation - gefiltert, sortiert, nummerierte Seiten.

    Eine Seite hinter der letzten liefert die letzte vorhandene Seite; das
    Feld ``page`` der Antwort nennt sie (ADR 0017).
    """
    service = ProjectService(session, current_user.organization_id)
    seite = service.list_projects(
        page=page,
        page_size=page_size,
        search=q,
        status=project_status,
        status_group=status_group,
        customer_id=customer_id,
        sort=sort,
    )
    # Bearbeiter der ganzen Seite in **einer** Abfrage - kein N+1.
    people = UserReferenceResolver(session, current_user.organization_id).load(
        user_id
        for project, _ in seite.items
        for user_id in (project.created_by_user_id, project.updated_by_user_id)
    )
    return NumberedPage[ProjectSummary](
        items=[_summary(project, customer_name, people) for project, customer_name in seite.items],
        page=seite.page,
        page_size=seite.page_size,
        total_items=seite.total_items,
        total_pages=seite.total_pages,
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
    return _project_out(session, current_user, project)


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
    return _project_out(session, current_user, service.get(project_id))


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

    Ein archiviertes oder abgeschlossenes Projekt ist schreibgeschuetzt und liefert ``409``.
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
    return _project_out(session, current_user, project)


@router.get(
    "/projects/{project_id}/deletion-check",
    response_model=ProjectDeletionCheck,
    operation_id="checkProjectDeletion",
    summary="Loeschwirkung eines Projekts pruefen",
    responses={404: {"model": ProblemDetail, "description": "Nicht gefunden"}},
)
def check_project_deletion(
    project_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_READ)),
    session: Session = Depends(get_session),
    participants: tuple[Participant, ...] = Depends(get_project_participants),
) -> ProjectDeletionCheck:
    """Was eine Loeschung bedeuten wuerde - fuer den Bestaetigungsdialog.

    **Keine Autorisierung und keine Garantie:** ``DELETE`` prueft Status,
    Inhalte und Berechtigung erneut unter der Projektsperre (ADR 0020).
    """
    service = ProjectDeletionService(session, current_user.organization_id, participants)
    result = service.assess(project_id, permissions=current_user.permissions)
    project = result.project
    return ProjectDeletionCheck(
        project_id=project.id,
        project_number=project.project_number,
        name=project.name,
        status=project.status,
        version=project.version,
        is_empty=result.is_empty,
        contents=[
            ProjectContentOut(code=item.code, label=item.label, count=item.count)
            for item in result.items
        ],
        status_allows_deletion=result.status_allows,
        can_delete=result.can_delete,
        requires_admin=result.requires_purge,
        requires_number_confirmation=result.requires_purge,
        blocked_code=result.blocked_code,
        blocked_reason=result.blocked_reason,
    )


@router.delete(
    "/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteProject",
    summary="Projekt endgueltig loeschen",
    responses={
        403: {"model": ProblemDetail, "description": "Berechtigung fehlt"},
        404: {"model": ProblemDetail, "description": "Nicht gefunden"},
        409: {
            "model": ProblemDetail,
            "description": (
                "Versionskonflikt, Projekt abgeschlossen oder archiviert, "
                "oder Bestaetigung der Projektnummer fehlt"
            ),
        },
        428: {"model": ProblemDetail, "description": "If-Match fehlt"},
        500: {"model": ProblemDetail, "description": "Ein Teilnehmer ist gescheitert"},
    },
)
def delete_project(
    project_id: uuid.UUID,
    confirm_project_number: str | None = Query(
        default=None,
        max_length=30,
        description=(
            "Pflicht, wenn das Projekt Inhalte hat: die Projektnummer als ausdrueckliche "
            "Bestaetigung des Verlusts."
        ),
    ),
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_DELETE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
    participants: tuple[Participant, ...] = Depends(get_project_participants),
    storage: ObjectStorage = Depends(get_object_storage),
) -> None:
    """Loescht ein Projekt **endgueltig** samt Struktur, Dateien und Planungsdaten.

    Nur ``draft`` und ``active``. Ein leeres Projekt duerfen alle mit
    ``project.record.delete`` loeschen, ein Projekt mit Inhalt nur, wer
    zusaetzlich ``project.record.purge`` hat - und nur mit
    ``confirm_project_number``. Alles wird unter der Projektsperre in einer
    Transaktion geprueft und geloescht (ADR 0020).

    Die Storage-Objekte der Dateien werden in derselben Transaktion zur
    Loeschung vorgemerkt und erst **nach** dem Commit entfernt. Scheitert das,
    bleibt der Auftrag offen (``python -m app.cli storage-cleanup``); die
    Antwort ist trotzdem ``204``, denn das Projekt ist geloescht.

    Die Projektnummer wird nie wiederverwendet: Der Nummernkreis zaehlt nur
    hoch.
    """
    service = ProjectDeletionService(session, current_user.organization_id, participants)
    deleted = service.delete(
        project_id,
        expected_version=expected_version,
        permissions=current_user.permissions,
        confirm_project_number=confirm_project_number,
    )
    audit.record(
        session,
        organization_id=current_user.organization_id,
        action=audit.ACTION_PROJECT_DELETED,
        entity_type="project",
        entity_id=deleted.project_id,
        actor_user_id=current_user.user_id,
        summary=f"Projekt {deleted.project_number} endgueltig geloescht",
        # Nur Nummer und Inhaltsarten - keine Namen, keine Adressen.
        data={
            "project_number": deleted.project_number,
            "contents": [item.code for item in deleted.items],
            "files": len(deleted.storage_keys),
        },
    )
    session.commit()
    if deleted.storage_keys:
        try:
            cleanup.process_jobs(session, storage, storage_keys=deleted.storage_keys)
        except Exception:
            # Die Loeschung ist committet. Offene Auftraege bleiben stehen.
            logger.exception("storage_cleanup_after_delete_failed")


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
    return _project_out(session, current_user, project)


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


@router.post(
    "/projects/{project_id}/reopen",
    response_model=ProjectOut,
    operation_id="reopenProject",
    summary="Abgeschlossenes Projekt wieder in Bearbeitung setzen",
    responses={
        403: {"model": ProblemDetail, "description": "Berechtigung fehlt"},
        **_WRITE_RESPONSES,
    },
)
def reopen_project(
    project_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_REOPEN)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> ProjectOut:
    """``completed -> active``. Nur Administratoren; ``archived`` bleibt endgueltig.

    Danach gilt das Projekt wieder als laufend und unterliegt allen Regeln
    eines aktiven Projekts (ADR 0020).
    """
    service = ProjectService(session, current_user.organization_id)
    project = service.reopen(
        project_id, expected_version=expected_version, actor_user_id=current_user.user_id
    )
    audit.record(
        session,
        organization_id=current_user.organization_id,
        action=audit.ACTION_PROJECT_REOPENED,
        entity_type="project",
        entity_id=project.id,
        actor_user_id=current_user.user_id,
        summary=f"Projekt {project.project_number} wieder in Bearbeitung",
        data={"from": "completed", "to": project.status},
    )
    session.commit()
    return _project_out(session, current_user, project)


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
    building = service.create_building(project_id, payload, actor_user_id=current_user.user_id)
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
    building = service.update_building(
        building_id,
        payload,
        expected_version=expected_version,
        actor_user_id=current_user.user_id,
    )
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
    service.delete_building(
        building_id, expected_version=expected_version, actor_user_id=current_user.user_id
    )
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
        409: {"model": ProblemDetail, "description": "Projekt ist archiviert oder abgeschlossen"},
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
    floor = service.create_floor(building_id, payload, actor_user_id=current_user.user_id)
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
    height_participants: tuple[HeightParticipant, ...] = Depends(get_height_participants),
) -> FloorOut:
    """Aendert Name, Ebene oder Hoehenangaben eines Geschosses.

    Eine neue Standard-Deckenhoehe pruefen die Fachmodule vorher (ADR 0022):
    Wuerde sie eine vorhandene Oeffnung ungueltig machen, ``422``.
    """
    service = ProjectService(session, current_user.organization_id)
    floor = service.update_floor(
        floor_id,
        payload,
        expected_version=expected_version,
        actor_user_id=current_user.user_id,
        height_participants=height_participants,
    )
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
    service.delete_floor(
        floor_id, expected_version=expected_version, actor_user_id=current_user.user_id
    )
    session.commit()
