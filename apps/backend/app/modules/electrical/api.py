"""Endpunkte des Fachmoduls ``electrical`` (Phase 3).

Eingehaengt unter ``/api/v1/modules/electrical`` - Fachmodulrouten liegen
bewusst unter ihrem Modul (docs/modules.md, Abschnitt 5).

Aufbau nach Eigentuemer: Raeume haengen an einem Geschoss, Waende an einem
Raum, Oeffnungen an einer Wand. Die Unterressource wird jeweils unter ihrem
Eigentuemer angelegt und danach unter ihrer eigenen ID bearbeitet - dasselbe
Muster wie bei Gebaeuden und Geschossen im Core.

``api`` ruft ausschliesslich den Service, nie ein Repository und kein Modell
(docs/architecture.md, Abschnitt 6). Die Transaktion wird hier geschlossen:
Der Commit stellt anschliessend die gesammelten Events zu (Unit of Work).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.auth.dependencies import CurrentUser, require_permission
from app.core.events.bus import EventBus, get_event_bus
from app.core.events.uow import UnitOfWork
from app.core.preconditions import require_if_match
from app.db.session import get_session
from app.errors import ProblemDetail
from app.modules.electrical.events import PlanChangeKind, plan_updated
from app.modules.electrical.geometry import Point, segment_length_mm
from app.modules.electrical.models import ElectricalOpening
from app.modules.electrical.permissions import PLAN_READ, PLAN_WRITE
from app.modules.electrical.schemas import (
    GeometryProblemOut,
    OpeningCreate,
    OpeningOut,
    OpeningUpdate,
    RoomContourOut,
    RoomCreate,
    RoomOut,
    RoomUpdate,
    WallCreate,
    WallOrder,
    WallOut,
    WallUpdate,
)
from app.modules.electrical.service import (
    ElectricalRoomService,
    RoomView,
    WallDetail,
    WriteResult,
    area_m2,
)

router = APIRouter(tags=["electrical"])

_READ_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"model": ProblemDetail, "description": "Nicht gefunden"},
}

_CREATE_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"model": ProblemDetail, "description": "Nicht gefunden"},
    409: {"model": ProblemDetail, "description": "Projekt ist archiviert"},
    422: {"model": ProblemDetail, "description": "Geometrie oder Eingabe unzulaessig"},
}

_WRITE_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"model": ProblemDetail, "description": "Nicht gefunden"},
    409: {
        "model": ProblemDetail,
        "description": "Versionskonflikt, archiviertes Projekt oder Wand mit Oeffnungen",
    },
    422: {"model": ProblemDetail, "description": "Geometrie oder Eingabe unzulaessig"},
    428: {"model": ProblemDetail, "description": "If-Match fehlt"},
}


# ------------------------------------------------------------- Serialisierung


def _room_out(view: RoomView) -> RoomOut:
    """Raum samt berechneter Konturwerte."""
    return RoomOut(
        id=view.room.id,
        floor_id=view.room.floor_id,
        name=view.room.name,
        room_number=view.room.room_number,
        height_mm=view.room.height_mm,
        effective_height_mm=view.effective_height_mm,
        contour_status=view.contour.status.value,
        wall_count=view.contour.wall_count,
        area_mm2=view.contour.area_mm2,
        area_m2=area_m2(view.contour.area_mm2),
        perimeter_mm=view.contour.perimeter_mm,
        version=view.room.version,
        created_at=view.room.created_at,
        updated_at=view.room.updated_at,
    )


def _wall_out(detail: WallDetail) -> WallOut:
    """Wand samt gerundeter Laenge - dieselbe Funktion wie in der Pruefung."""
    wall = detail.wall
    length = segment_length_mm(
        Point(x_mm=wall.x1_mm, y_mm=wall.y1_mm), Point(x_mm=wall.x2_mm, y_mm=wall.y2_mm)
    )
    return WallOut(
        id=wall.id,
        room_id=wall.room_id,
        sort_order=wall.sort_order,
        x1_mm=wall.x1_mm,
        y1_mm=wall.y1_mm,
        x2_mm=wall.x2_mm,
        y2_mm=wall.y2_mm,
        thickness_mm=wall.thickness_mm,
        length_mm=length,
        opening_count=detail.opening_count,
        version=wall.version,
        created_at=wall.created_at,
        updated_at=wall.updated_at,
    )


def _opening_out(opening: ElectricalOpening) -> OpeningOut:
    return OpeningOut.model_validate(opening)


def _commit(
    *,
    session: Session,
    bus: EventBus,
    current_user: CurrentUser,
    result: WriteResult,
    change_kind: PlanChangeKind,
) -> None:
    """Schliesst die Transaktion und stellt das Event **danach** zu.

    Die Unit of Work sammelt das Event und gibt es erst nach erfolgreichem
    Commit an den Bus: Vor dem Commit ist nichts Tatsache (docs/events.md,
    Abschnitt 3). Ein Fehler im Handler wirkt nicht auf diese Anfrage zurueck.
    """
    uow = UnitOfWork(session, bus)
    uow.add_event(
        plan_updated(
            organization_id=result.context.organization_id,
            project_id=result.context.project_id,
            floor_id=result.context.floor_id,
            room_id=result.room_id,
            change_kind=change_kind,
            actor_user_id=current_user.user_id,
        )
    )
    uow.commit()


# ----------------------------------------------------------------------- Raum


@router.get(
    "/floors/{floor_id}/rooms",
    response_model=list[RoomOut],
    operation_id="listElectricalRooms",
    summary="Raeume eines Geschosses",
    responses=_READ_RESPONSES,
)
def list_rooms(
    floor_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PLAN_READ)),
    session: Session = Depends(get_session),
) -> list[RoomOut]:
    """Raeume des Geschosses - nach Raumnummer, dann Name, dann ID sortiert.

    Keine Cursor-Pagination: Ein Geschoss hat Raeume in zweistelliger Anzahl.
    Eine Seitenmechanik ohne Bedarf waere nur mehr Vertrag zum Pflegen.
    """
    service = ElectricalRoomService(session, current_user.organization_id)
    return [_room_out(view) for view in service.list_rooms(floor_id)]


@router.post(
    "/floors/{floor_id}/rooms",
    response_model=RoomOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createElectricalRoom",
    summary="Raum anlegen",
    responses=_CREATE_RESPONSES,
)
def create_room(
    floor_id: uuid.UUID,
    payload: RoomCreate,
    current_user: CurrentUser = Depends(require_permission(PLAN_WRITE)),
    session: Session = Depends(get_session),
    bus: EventBus = Depends(get_event_bus),
) -> RoomOut:
    """Legt einen Raum auf dem Geschoss an. Die Kontur folgt als Waende."""
    service = ElectricalRoomService(session, current_user.organization_id)
    view, result = service.create_room(floor_id, payload)
    _commit(
        session=session,
        bus=bus,
        current_user=current_user,
        result=result,
        change_kind=PlanChangeKind.ROOM_CREATED,
    )
    return _room_out(view)


@router.get(
    "/rooms/{room_id}",
    response_model=RoomOut,
    operation_id="getElectricalRoom",
    summary="Raum",
    responses=_READ_RESPONSES,
)
def get_room(
    room_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PLAN_READ)),
    session: Session = Depends(get_session),
) -> RoomOut:
    """Ein Raum samt berechneter Flaeche, Umfang und Konturzustand."""
    service = ElectricalRoomService(session, current_user.organization_id)
    return _room_out(service.get_room(room_id))


@router.patch(
    "/rooms/{room_id}",
    response_model=RoomOut,
    operation_id="updateElectricalRoom",
    summary="Raum bearbeiten",
    responses=_WRITE_RESPONSES,
)
def update_room(
    room_id: uuid.UUID,
    payload: RoomUpdate,
    current_user: CurrentUser = Depends(require_permission(PLAN_WRITE)),
    session: Session = Depends(get_session),
    bus: EventBus = Depends(get_event_bus),
    expected_version: int = Depends(require_if_match),
) -> RoomOut:
    """Aendert Name, Raumnummer oder Raumhoehe."""
    service = ElectricalRoomService(session, current_user.organization_id)
    view, result = service.update_room(room_id, payload, expected_version=expected_version)
    _commit(
        session=session,
        bus=bus,
        current_user=current_user,
        result=result,
        change_kind=PlanChangeKind.ROOM_UPDATED,
    )
    return _room_out(view)


@router.delete(
    "/rooms/{room_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteElectricalRoom",
    summary="Raum loeschen",
    responses=_WRITE_RESPONSES,
)
def delete_room(
    room_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PLAN_WRITE)),
    session: Session = Depends(get_session),
    bus: EventBus = Depends(get_event_bus),
    expected_version: int = Depends(require_if_match),
) -> None:
    """Entfernt den Raum endgueltig - samt seiner Waende und Oeffnungen."""
    service = ElectricalRoomService(session, current_user.organization_id)
    result = service.delete_room(room_id, expected_version=expected_version)
    _commit(
        session=session,
        bus=bus,
        current_user=current_user,
        result=result,
        change_kind=PlanChangeKind.ROOM_DELETED,
    )


@router.get(
    "/rooms/{room_id}/contour",
    response_model=RoomContourOut,
    operation_id="getElectricalRoomContour",
    summary="Raumkontur pruefen",
    responses=_READ_RESPONSES,
)
def get_contour(
    room_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PLAN_READ)),
    session: Session = Depends(get_session),
) -> RoomContourOut:
    """Vollstaendige Pruefung der Raumkontur.

    Reine Auskunft: Der Aufruf aendert nichts und ist beliebig wiederholbar.
    Der Konturzustand ist **abgeleitet** und nicht gespeichert (ADR 0013) -
    deshalb gibt es keinen Abschlussvorgang, der ihn festschreibt. Wer wissen
    will, warum ein Raum noch im Entwurf steht, liest hier die Einzelfehler.
    """
    service = ElectricalRoomService(session, current_user.organization_id)
    report = service.contour(room_id)
    return RoomContourOut(
        room_id=room_id,
        contour_status=report.status.value,
        wall_count=report.wall_count,
        area_mm2=report.area_mm2,
        area_m2=area_m2(report.area_mm2),
        perimeter_mm=report.perimeter_mm,
        problems=[
            GeometryProblemOut(
                code=problem.code,
                message=problem.message,
                wall_ids=[uuid.UUID(key) for key in problem.keys],
            )
            for problem in report.problems
        ],
    )


# ----------------------------------------------------------------------- Wand


@router.get(
    "/rooms/{room_id}/walls",
    response_model=list[WallOut],
    operation_id="listElectricalWalls",
    summary="Waende eines Raums",
    responses=_READ_RESPONSES,
)
def list_walls(
    room_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PLAN_READ)),
    session: Session = Depends(get_session),
) -> list[WallOut]:
    """Waende in Konturreihenfolge, jede mit ihrer gerundeten Laenge."""
    service = ElectricalRoomService(session, current_user.organization_id)
    return [_wall_out(detail) for detail in service.list_walls(room_id)]


@router.post(
    "/rooms/{room_id}/walls",
    response_model=WallOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createElectricalWall",
    summary="Wand anlegen",
    responses=_CREATE_RESPONSES,
)
def create_wall(
    room_id: uuid.UUID,
    payload: WallCreate,
    current_user: CurrentUser = Depends(require_permission(PLAN_WRITE)),
    session: Session = Depends(get_session),
    bus: EventBus = Depends(get_event_bus),
) -> WallOut:
    """Haengt eine Wand hinten an die Kontur des Raums."""
    service = ElectricalRoomService(session, current_user.organization_id)
    detail, result = service.create_wall(room_id, payload)
    _commit(
        session=session,
        bus=bus,
        current_user=current_user,
        result=result,
        change_kind=PlanChangeKind.WALLS_CHANGED,
    )
    return _wall_out(detail)


@router.patch(
    "/walls/{wall_id}",
    response_model=WallOut,
    operation_id="updateElectricalWall",
    summary="Wand bearbeiten",
    responses=_WRITE_RESPONSES,
)
def update_wall(
    wall_id: uuid.UUID,
    payload: WallUpdate,
    current_user: CurrentUser = Depends(require_permission(PLAN_WRITE)),
    session: Session = Depends(get_session),
    bus: EventBus = Depends(get_event_bus),
    expected_version: int = Depends(require_if_match),
) -> WallOut:
    """Aendert Koordinaten oder Wandstaerke.

    Wuerde eine vorhandene Oeffnung dadurch ausserhalb der Wand liegen, wird
    die Aenderung mit ``422`` abgelehnt - eine Tuer wird nicht stillschweigend
    ungueltig.
    """
    service = ElectricalRoomService(session, current_user.organization_id)
    detail, result = service.update_wall(wall_id, payload, expected_version=expected_version)
    _commit(
        session=session,
        bus=bus,
        current_user=current_user,
        result=result,
        change_kind=PlanChangeKind.WALLS_CHANGED,
    )
    return _wall_out(detail)


@router.post(
    "/rooms/{room_id}/walls/reorder",
    response_model=list[WallOut],
    operation_id="reorderElectricalWalls",
    summary="Waende umordnen",
    responses=_WRITE_RESPONSES,
)
def reorder_walls(
    room_id: uuid.UUID,
    payload: WallOrder,
    current_user: CurrentUser = Depends(require_permission(PLAN_WRITE)),
    session: Session = Depends(get_session),
    bus: EventBus = Depends(get_event_bus),
    expected_version: int = Depends(require_if_match),
) -> list[WallOut]:
    """Setzt die Konturreihenfolge neu.

    ``If-Match`` traegt die Version des **Raums**: Die Reihenfolge gehoert der
    Kontur als Ganzes, nicht einer einzelnen Wand.
    """
    service = ElectricalRoomService(session, current_user.organization_id)
    details, result = service.reorder_walls(
        room_id, payload.wall_ids, expected_version=expected_version
    )
    _commit(
        session=session,
        bus=bus,
        current_user=current_user,
        result=result,
        change_kind=PlanChangeKind.WALLS_CHANGED,
    )
    return [_wall_out(detail) for detail in details]


@router.delete(
    "/walls/{wall_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteElectricalWall",
    summary="Wand loeschen",
    responses=_WRITE_RESPONSES,
)
def delete_wall(
    wall_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PLAN_WRITE)),
    session: Session = Depends(get_session),
    bus: EventBus = Depends(get_event_bus),
    expected_version: int = Depends(require_if_match),
) -> None:
    """Entfernt die Wand. Traegt sie noch Oeffnungen, antwortet der Server ``409``."""
    service = ElectricalRoomService(session, current_user.organization_id)
    result = service.delete_wall(wall_id, expected_version=expected_version)
    _commit(
        session=session,
        bus=bus,
        current_user=current_user,
        result=result,
        change_kind=PlanChangeKind.WALLS_CHANGED,
    )


# ------------------------------------------------------------------- Oeffnung


@router.get(
    "/walls/{wall_id}/openings",
    response_model=list[OpeningOut],
    operation_id="listElectricalOpenings",
    summary="Oeffnungen einer Wand",
    responses=_READ_RESPONSES,
)
def list_openings(
    wall_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PLAN_READ)),
    session: Session = Depends(get_session),
) -> list[OpeningOut]:
    """Oeffnungen der Wand, vom Wandanfang aus sortiert."""
    service = ElectricalRoomService(session, current_user.organization_id)
    return [_opening_out(opening) for opening in service.list_openings(wall_id)]


@router.post(
    "/walls/{wall_id}/openings",
    response_model=OpeningOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createElectricalOpening",
    summary="Oeffnung anlegen",
    responses=_CREATE_RESPONSES,
)
def create_opening(
    wall_id: uuid.UUID,
    payload: OpeningCreate,
    current_user: CurrentUser = Depends(require_permission(PLAN_WRITE)),
    session: Session = Depends(get_session),
    bus: EventBus = Depends(get_event_bus),
) -> OpeningOut:
    """Legt Tuer, Fenster oder Durchgang in der Wand an."""
    service = ElectricalRoomService(session, current_user.organization_id)
    opening, result = service.create_opening(wall_id, payload)
    _commit(
        session=session,
        bus=bus,
        current_user=current_user,
        result=result,
        change_kind=PlanChangeKind.OPENINGS_CHANGED,
    )
    return _opening_out(opening)


@router.patch(
    "/openings/{opening_id}",
    response_model=OpeningOut,
    operation_id="updateElectricalOpening",
    summary="Oeffnung bearbeiten",
    responses=_WRITE_RESPONSES,
)
def update_opening(
    opening_id: uuid.UUID,
    payload: OpeningUpdate,
    current_user: CurrentUser = Depends(require_permission(PLAN_WRITE)),
    session: Session = Depends(get_session),
    bus: EventBus = Depends(get_event_bus),
    expected_version: int = Depends(require_if_match),
) -> OpeningOut:
    """Aendert Art, Lage oder Abmessungen der Oeffnung."""
    service = ElectricalRoomService(session, current_user.organization_id)
    opening, result = service.update_opening(opening_id, payload, expected_version=expected_version)
    _commit(
        session=session,
        bus=bus,
        current_user=current_user,
        result=result,
        change_kind=PlanChangeKind.OPENINGS_CHANGED,
    )
    return _opening_out(opening)


@router.delete(
    "/openings/{opening_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteElectricalOpening",
    summary="Oeffnung loeschen",
    responses=_WRITE_RESPONSES,
)
def delete_opening(
    opening_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PLAN_WRITE)),
    session: Session = Depends(get_session),
    bus: EventBus = Depends(get_event_bus),
    expected_version: int = Depends(require_if_match),
) -> None:
    """Entfernt die Oeffnung endgueltig."""
    service = ElectricalRoomService(session, current_user.organization_id)
    result = service.delete_opening(opening_id, expected_version=expected_version)
    _commit(
        session=session,
        bus=bus,
        current_user=current_user,
        result=result,
        change_kind=PlanChangeKind.OPENINGS_CHANGED,
    )
