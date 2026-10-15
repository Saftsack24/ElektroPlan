"""Endpunkte des Fachmoduls ``electrical`` (Phase 3, erweitert in Phase 4a).

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
from typing import Literal, cast

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.auth.dependencies import CurrentUser, require_permission
from app.core.events.bus import EventBus, get_event_bus
from app.core.events.uow import UnitOfWork
from app.core.preconditions import require_if_match
from app.core.projects.planning import FloorPlanningAccess
from app.db.session import get_session
from app.errors import ProblemDetail
from app.modules.electrical.cable_rules import BuildingCableState
from app.modules.electrical.cables import (
    CableService,
    CableView,
    CableWriteResult,
    PenetrationView,
)
from app.modules.electrical.cabling_summary import (
    CableGroup,
    CableLine,
    CablingSummary,
    StatusBucket,
)
from app.modules.electrical.distribution import (
    CircuitView,
    DistributionService,
    DistributionWriteResult,
    cross_section_out,
)
from app.modules.electrical.events import PlanChangeKind, plan_updated
from app.modules.electrical.geometry import GeometryProblem, Point, segment_length_mm
from app.modules.electrical.link_rules import LinkCandidate
from app.modules.electrical.models import ElectricalOpening
from app.modules.electrical.permissions import (
    CIRCUIT_WRITE,
    PLAN_READ,
    PLAN_WRITE,
    ROUTE_WRITE,
)
from app.modules.electrical.risers import RiserService, RiserView, RiserWriteResult
from app.modules.electrical.schemas import (
    ApplyProposalIn,
    CableIn,
    CableListOut,
    CableOut,
    CableProblemOut,
    CableSegmentOut,
    CableWaypointKindValue,
    CableWaypointOut,
    CablingBucketOut,
    CablingCableOut,
    CablingCircuitOut,
    CablingCrossingOut,
    CablingGroupOut,
    CablingPenetrationOut,
    CablingSummaryOut,
    CablingSurfaceOut,
    CablingSurfaceValue,
    CablingTotalsOut,
    CablingTypeCountOut,
    CircuitCreate,
    CircuitDevicesUpdate,
    CircuitListOut,
    CircuitOut,
    CircuitUpdate,
    DeviceOut,
    DeviceTypeOut,
    DistributionBoardCreate,
    DistributionBoardListOut,
    DistributionBoardOut,
    DistributionBoardUpdate,
    FloorPlanOut,
    GeometryProblemOut,
    MissingSpecValue,
    OpeningCreate,
    OpeningOut,
    OpeningUpdate,
    PenetrationListOut,
    PenetrationOut,
    PenetrationUpdate,
    PositionOut,
    RiserCoursePointOut,
    RiserCreate,
    RiserListOut,
    RiserOut,
    RiserSectionOut,
    RiserStopOut,
    RiserUpdate,
    RoomContourOut,
    RoomContourUpdate,
    RoomCreate,
    RoomOut,
    RoomPlanOut,
    RoomTypeValue,
    RoomUpdate,
    WallCreate,
    WallLinkCandidateOut,
    WallLinkCreate,
    WallLinkOut,
    WallLinkOverviewOut,
    WallLinkUpdate,
    WallOrder,
    WallOut,
    WallPlanOut,
    WallUpdate,
)
from app.modules.electrical.service import (
    ElectricalRoomService,
    RoomPlan,
    RoomView,
    WallDetail,
    WriteResult,
    area_m2,
)
from app.modules.electrical.wall_links import LinkWriteResult, WallLinkService, WallLinkView

router = APIRouter(tags=["electrical"])

_READ_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"model": ProblemDetail, "description": "Nicht gefunden"},
}

_CREATE_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"model": ProblemDetail, "description": "Nicht gefunden"},
    409: {"model": ProblemDetail, "description": "Projekt ist archiviert oder abgeschlossen"},
    422: {"model": ProblemDetail, "description": "Geometrie oder Eingabe unzulaessig"},
}

_WRITE_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"model": ProblemDetail, "description": "Nicht gefunden"},
    409: {
        "model": ProblemDetail,
        "description": (
            "Versionskonflikt, archiviertes oder abgeschlossenes Projekt oder Wand mit Oeffnungen"
        ),
    },
    422: {"model": ProblemDetail, "description": "Geometrie oder Eingabe unzulaessig"},
    428: {"model": ProblemDetail, "description": "If-Match fehlt"},
}


def _require_acknowledgement_right(
    current_user: CurrentUser, acknowledged: list[uuid.UUID]
) -> None:
    """Wer Leitungsunterbrechungen bestaetigt, braucht ``electrical.route.write`` (6b.3)."""
    if acknowledged:
        current_user.require(ROUTE_WRITE)


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
        # Die Datenbank laesst nur die bekannten Schluessel zu (CHECK).
        room_type=cast(RoomTypeValue | None, view.room.room_type),
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


def _problem_out(problem: GeometryProblem) -> GeometryProblemOut:
    return GeometryProblemOut(
        code=problem.code,
        message=problem.message,
        wall_ids=[uuid.UUID(key) for key in problem.keys],
    )


def _room_plan_out(plan: RoomPlan) -> RoomPlanOut:
    """Raum samt Waenden und Oeffnungen - ein Objekt je Raum im Planungsstand."""
    return RoomPlanOut(
        **_room_out(plan.view).model_dump(),
        walls=[
            WallPlanOut(
                **_wall_out(
                    WallDetail(wall=item.wall, opening_count=len(item.openings))
                ).model_dump(),
                openings=[_opening_out(opening) for opening in item.openings],
            )
            for item in plan.walls
        ],
        contour_problems=[_problem_out(problem) for problem in plan.view.contour.problems],
        devices=[DeviceOut.model_validate(device) for device in plan.devices],
    )


def _link_out(view: WallLinkView) -> WallLinkOut:
    link = view.link
    return WallLinkOut(
        id=link.id,
        wall_a_id=link.wall_a_id,
        wall_b_id=link.wall_b_id,
        # Die Datenbank laesst nur die bekannten Werte zu (CHECK).
        relation=cast(Literal["shared", "separate"], link.relation),
        origin=cast(Literal["user", "backfill"], link.origin),
        status=view.status.value,
        thickness_conflict=view.thickness_conflict,
        version=link.version,
        created_at=link.created_at,
        updated_at=link.updated_at,
    )


def _candidate_out(candidate: LinkCandidate) -> WallLinkCandidateOut:
    return WallLinkCandidateOut.model_validate(
        {
            "wall_a_id": candidate.wall_a_id,
            "wall_b_id": candidate.wall_b_id,
            "kind": candidate.kind.value,
            "reasons": list(candidate.reasons),
        }
    )


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
    # Die Aenderung am Projekt vermerken (wer, wann) - ueber den oeffentlichen
    # Core-Zugang, ohne das Projektmodell zu kennen (Phase 4d). Die
    # Projektsperre haelt dieser Vorgang bereits.
    FloorPlanningAccess(session, current_user.organization_id).record_project_change(
        result.context.project_id, actor_user_id=current_user.user_id
    )
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


def _commit_links(
    *, session: Session, bus: EventBus, current_user: CurrentUser, result: LinkWriteResult
) -> None:
    """Wie :func:`_commit` - je beteiligtem Raum ein ``wall_links_changed``."""
    if not result.changed:
        # Unveraenderte Entscheidung: nichts vermerken, kein Event.
        session.commit()
        return
    FloorPlanningAccess(session, current_user.organization_id).record_project_change(
        result.context.project_id, actor_user_id=current_user.user_id
    )
    uow = UnitOfWork(session, bus)
    for room_id in result.room_ids:
        uow.add_event(
            plan_updated(
                organization_id=result.context.organization_id,
                project_id=result.context.project_id,
                floor_id=result.context.floor_id,
                room_id=room_id,
                change_kind=PlanChangeKind.WALL_LINKS_CHANGED,
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
    """Aendert Name, Raumnummer oder Raumhoehe.

    Wegpunkte oder Durchfuehrungen ueber einer abgesenkten Hoehe: ``422``. Unterbricht die
    Aenderung eine Leitung (etwa Uebergang zur Decke), braucht es ``acknowledged_cable_ids``.
    """
    _require_acknowledgement_right(current_user, payload.acknowledged_cable_ids)
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
        problems=[_problem_out(problem) for problem in report.problems],
    )


# ------------------------------------------------------ Planungsstand (4a)


@router.get(
    "/floors/{floor_id}/plan",
    response_model=FloorPlanOut,
    operation_id="getElectricalFloorPlan",
    summary="Planungsstand eines Geschosses",
    responses=_READ_RESPONSES,
)
def get_floor_plan(
    floor_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PLAN_READ)),
    session: Session = Depends(get_session),
) -> FloorPlanOut:
    """Raeume, Waende und Oeffnungen eines Geschosses in **einer** Antwort.

    Fuer den grafischen Editor, der den Stand ohnehin vollstaendig braucht.
    Geschossbezogen statt projektweit: Der Editor zeigt genau ein Geschoss,
    und die Antwort bleibt damit begrenzt. Die Anzahl der Datenbankabfragen
    haengt nicht von der Zahl der Raeume ab. Archivierte Projekte bleiben
    lesbar.
    """
    service = ElectricalRoomService(session, current_user.organization_id)
    plan = service.floor_plan(floor_id)
    return FloorPlanOut(
        floor_id=plan.context.floor_id,
        project_id=plan.context.project_id,
        rooms=[_room_plan_out(room) for room in plan.rooms],
        wall_links=[_link_out(view) for view in plan.wall_links],
        wall_link_candidates=[_candidate_out(item) for item in plan.wall_link_candidates],
    )


@router.put(
    "/rooms/{room_id}/contour",
    response_model=RoomPlanOut,
    operation_id="replaceElectricalRoomContour",
    summary="Raumkontur als Ganzes speichern",
    responses=_WRITE_RESPONSES,
)
def replace_contour(
    room_id: uuid.UUID,
    payload: RoomContourUpdate,
    current_user: CurrentUser = Depends(require_permission(PLAN_WRITE)),
    session: Session = Depends(get_session),
    bus: EventBus = Depends(get_event_bus),
    expected_version: int = Depends(require_if_match),
) -> RoomPlanOut:
    """Ersetzt Waende und Oeffnungen eines Raums **atomar** durch den Zielzustand.

    ``If-Match`` traegt die Version des **Raums** - sie ist die Version der
    gesamten Raumgeometrie. Die Reihenfolge der Waende ist die Reihenfolge in
    der Liste. Bekannte IDs werden geaendert, neue angelegt, fehlende Waende
    entfernt. Oeffnungen verschwinden nur, wenn sie in
    ``removed_opening_ids`` stehen; Wandkopplungen entfallender Waende nur,
    wenn sie in ``removed_wall_link_ids`` stehen (sonst ``409 wall-has-links``).
    Jeder Fehler laesst den Raum
    unveraendert; bei Erfolg entsteht genau ein ``electrical.plan.updated``
    (``walls_changed``).

    Der ``GET`` auf derselben Adresse liefert den Pruefbericht dieser Kontur.

    **Leitungen (6b.3):** Endgeraete und Waende mit Leitungsbezug werden nicht entfernt
    (``409``); eine Oeffnung ueber einer Wandstrecke ist ``422``. Jede andere
    Unterbrechung braucht ``acknowledged_cable_ids`` mit **genau** den betroffenen
    Leitungen (sonst ``409 cables-would-break``; verlangt ``electrical.route.write``).
    """
    _require_acknowledgement_right(current_user, payload.acknowledged_cable_ids)
    service = ElectricalRoomService(session, current_user.organization_id)
    plan, result = service.replace_contour(room_id, payload, expected_version=expected_version)
    _commit(
        session=session,
        bus=bus,
        current_user=current_user,
        result=result,
        change_kind=(
            PlanChangeKind.WALLS_CHANGED
            if result.geometry_changed
            else PlanChangeKind.DEVICES_CHANGED
        ),
    )
    return _room_plan_out(plan)


@router.get(
    "/device-types",
    response_model=list[DeviceTypeOut],
    operation_id="listElectricalDeviceTypes",
    summary="Geraetetypen des Systemkatalogs",
)
def list_device_types(
    current_user: CurrentUser = Depends(require_permission(PLAN_READ)),
    session: Session = Depends(get_session),
) -> list[DeviceTypeOut]:
    """Der ausgelieferte Geraetekatalog (Phase 5) in Katalogreihenfolge.

    Global fuer alle Betriebe; deaktivierte Typen stehen mit ``is_active =
    false`` dabei, damit vorhandene Geraete benannt werden koennen.
    """
    service = ElectricalRoomService(session, current_user.organization_id)
    return [DeviceTypeOut.model_validate(row) for row in service.list_device_types()]


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


# -------------------------------------------------------- Wandkopplung (6a)


@router.get(
    "/floors/{floor_id}/wall-links",
    response_model=WallLinkOverviewOut,
    operation_id="listElectricalWallLinks",
    summary="Wandkopplungen und Kandidaten eines Geschosses",
    responses=_READ_RESPONSES,
)
def list_wall_links(
    floor_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PLAN_READ)),
    session: Session = Depends(get_session),
) -> WallLinkOverviewOut:
    """Gespeicherte Kopplungen mit Status und ungekoppelte Kandidaten (ADR 0024).

    Reine Auskunft: Vorschlaege werden nie automatisch gespeichert.
    """
    overview = WallLinkService(session, current_user.organization_id).overview(floor_id)
    return WallLinkOverviewOut(
        floor_id=overview.floor_id,
        links=[_link_out(view) for view in overview.links],
        candidates=[_candidate_out(item) for item in overview.candidates],
    )


@router.post(
    "/floors/{floor_id}/wall-links",
    response_model=WallLinkOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createElectricalWallLink",
    summary="Wandkopplung anlegen",
    responses={
        **_CREATE_RESPONSES,
        409: {
            "model": ProblemDetail,
            "description": "Projekt schreibgeschuetzt oder Zuordnung besteht bereits",
        },
    },
)
def create_wall_link(
    floor_id: uuid.UUID,
    payload: WallLinkCreate,
    current_user: CurrentUser = Depends(require_permission(PLAN_WRITE)),
    session: Session = Depends(get_session),
    bus: EventBus = Depends(get_event_bus),
) -> WallLinkOut:
    """Ordnet zwei exakt ueberlappende Raumwaende verschiedener Raeume einander zu.

    ``shared`` = eine Bauwand, ``separate`` = zwei Bauwaende auf derselben Achse.
    Die Raumversion beider Raeume zaehlt weiter. Wuerde ein vorhandenes Geraet
    dadurch unzulaessig, antwortet der Server ``422`` und speichert nichts.
    Unterbricht sie eine Leitung (Bodenuebergang bei ``separate``), braucht es
    ``acknowledged_cable_ids``.
    """
    _require_acknowledgement_right(current_user, payload.acknowledged_cable_ids)
    view, result = WallLinkService(session, current_user.organization_id).create(
        floor_id, payload, actor_user_id=current_user.user_id
    )
    _commit_links(session=session, bus=bus, current_user=current_user, result=result)
    return _link_out(view)


@router.patch(
    "/wall-links/{link_id}",
    response_model=WallLinkOut,
    operation_id="updateElectricalWallLink",
    summary="Wandkopplung aendern",
    responses=_WRITE_RESPONSES,
)
def update_wall_link(
    link_id: uuid.UUID,
    payload: WallLinkUpdate,
    current_user: CurrentUser = Depends(require_permission(PLAN_WRITE)),
    session: Session = Depends(get_session),
    bus: EventBus = Depends(get_event_bus),
    expected_version: int = Depends(require_if_match),
) -> WallLinkOut:
    """Aendert ``shared`` <-> ``separate``; ``If-Match`` traegt die Kopplungsversion.

    Mit Durchfuehrung ist ``separate`` nicht moeglich (``422``); ein Bodenuebergang wird
    dann einseitig - nur mit ``acknowledged_cable_ids``.
    """
    _require_acknowledgement_right(current_user, payload.acknowledged_cable_ids)
    view, result = WallLinkService(session, current_user.organization_id).update(
        link_id, payload, expected_version=expected_version
    )
    _commit_links(session=session, bus=bus, current_user=current_user, result=result)
    return _link_out(view)


@router.delete(
    "/wall-links/{link_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteElectricalWallLink",
    summary="Wandkopplung loesen",
    responses=_WRITE_RESPONSES,
)
def delete_wall_link(
    link_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PLAN_WRITE)),
    session: Session = Depends(get_session),
    bus: EventBus = Depends(get_event_bus),
    expected_version: int = Depends(require_if_match),
) -> None:
    """Loest die Kopplung; der Abschnitt ist danach unentschieden (konservativ)."""
    result = WallLinkService(session, current_user.organization_id).delete(
        link_id, expected_version=expected_version
    )
    _commit_links(session=session, bus=bus, current_user=current_user, result=result)


# ------------------------------------------------------------ Steigwege (6a.4)


def _riser_out(view: RiserView) -> RiserOut:
    riser = view.riser
    analysis = view.analysis
    return RiserOut(
        id=riser.id,
        building_id=riser.building_id,
        name=riser.name,
        note=riser.note,
        # Die Datenbank laesst nur die bekannten Werte zu (CHECK).
        offset_mode=cast(Literal["orthogonal", "direct"], riser.offset_mode),
        stops=[
            RiserStopOut(id=stop.stop_id, floor_id=stop.floor_id, x_mm=stop.x_mm, y_mm=stop.y_mm)
            for stop in analysis.stops
        ],
        sections=[
            RiserSectionOut(
                lower_stop_id=section.lower.stop_id,
                upper_stop_id=section.upper.stop_id,
                lower_floor_id=section.lower.floor_id,
                upper_floor_id=section.upper.floor_id,
                traversed_floor_ids=list(section.traversed_floor_ids),
                status=section.status.value,
                course=[
                    RiserCoursePointOut(x_mm=point.x_mm, y_mm=point.y_mm, z_mm=point.z_mm)
                    for point in section.course
                ],
                vertical_mm=section.vertical_mm,
                horizontal_mm=section.horizontal_mm,
                length_mm=section.length_mm,
                hints=[hint.value for hint in section.hints],
            )
            for section in analysis.sections
        ],
        status=analysis.status.value,
        known_length_mm=analysis.known_length_mm,
        length_mm=analysis.length_mm,
        version=riser.version,
        created_at=riser.created_at,
        updated_at=riser.updated_at,
    )


def _commit_riser(*, session: Session, current_user: CurrentUser, result: RiserWriteResult) -> None:
    """Schliesst die Transaktion. Steigwege senden kein Event (Entwurf §5)."""
    if result.changed:
        FloorPlanningAccess(session, current_user.organization_id).record_project_change(
            result.context.project_id, actor_user_id=current_user.user_id
        )
    session.commit()


@router.get(
    "/buildings/{building_id}/risers",
    response_model=RiserListOut,
    operation_id="listElectricalRisers",
    summary="Steigwege eines Gebaeudes",
    responses=_READ_RESPONSES,
)
def list_risers(
    building_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PLAN_READ)),
    session: Session = Depends(get_session),
) -> RiserListOut:
    """Steigwege mit Halten, Verlauf je Abschnitt und Laengenstatus (ADR 0025).

    Verlauf und Laengen werden bei jedem Lesen aus den aktuellen Hoehenlagen
    abgeleitet. Vereinfachter Planungsverlauf - keine Aussage ueber bauliche
    Machbarkeit, Brandschutz oder Normen.
    """
    _, views = RiserService(session, current_user.organization_id).overview(building_id)
    return RiserListOut(building_id=building_id, risers=[_riser_out(view) for view in views])


@router.post(
    "/buildings/{building_id}/risers",
    response_model=RiserOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createElectricalRiser",
    summary="Steigweg anlegen",
    responses=_CREATE_RESPONSES,
)
def create_riser(
    building_id: uuid.UUID,
    payload: RiserCreate,
    current_user: CurrentUser = Depends(require_permission(PLAN_WRITE)),
    session: Session = Depends(get_session),
) -> RiserOut:
    """Legt einen benannten Steigweg an - hoechstens ein Halt je Geschoss des Gebaeudes."""
    view, result = RiserService(session, current_user.organization_id).create(building_id, payload)
    _commit_riser(session=session, current_user=current_user, result=result)
    return _riser_out(view)


@router.put(
    "/risers/{riser_id}",
    response_model=RiserOut,
    operation_id="replaceElectricalRiser",
    summary="Steigweg ersetzen",
    responses=_WRITE_RESPONSES,
)
def replace_riser(
    riser_id: uuid.UUID,
    payload: RiserUpdate,
    current_user: CurrentUser = Depends(require_permission(PLAN_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> RiserOut:
    """Ersetzt Stammdaten und die ganze Halteliste; ``If-Match`` traegt die Steigwegversion.

    Halte mit ``id`` behalten ihre ID, fehlende werden entfernt, Halte ohne
    ``id`` neu angelegt. Genutzte Halte entfallen nicht (``409 riser-stop-in-use``);
    unterbricht ein verschobener Halt eine Leitung, braucht es ``acknowledged_cable_ids``.
    """
    _require_acknowledgement_right(current_user, payload.acknowledged_cable_ids)
    view, result = RiserService(session, current_user.organization_id).replace(
        riser_id, payload, expected_version=expected_version
    )
    _commit_riser(session=session, current_user=current_user, result=result)
    return _riser_out(view)


@router.delete(
    "/risers/{riser_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteElectricalRiser",
    summary="Steigweg loeschen",
    responses=_WRITE_RESPONSES,
)
def delete_riser(
    riser_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PLAN_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> None:
    """Entfernt den Steigweg samt Uebergabepunkten."""
    result = RiserService(session, current_user.organization_id).delete(
        riser_id, expected_version=expected_version
    )
    _commit_riser(session=session, current_user=current_user, result=result)


# ------------------------------------- Verteilungen und Stromkreise (6b.0)


def _circuit_out(view: CircuitView) -> CircuitOut:
    circuit = view.circuit
    return CircuitOut(
        id=circuit.id,
        board_id=circuit.board_id,
        designation=circuit.designation,
        name=circuit.name,
        sort_order=circuit.sort_order,
        proposed_cable_type=circuit.proposed_cable_type,
        proposed_conductor_count=circuit.proposed_conductor_count,
        proposed_cross_section_mm2=cross_section_out(circuit.proposed_cross_section_mm2),
        protective_device=circuit.protective_device,
        rcd_group=circuit.rcd_group,
        phase_count=circuit.phase_count,
        note=circuit.note,
        device_ids=list(view.device_ids),
        version=circuit.version,
        created_at=circuit.created_at,
        updated_at=circuit.updated_at,
    )


def _commit_distribution(
    *, session: Session, current_user: CurrentUser, result: DistributionWriteResult
) -> None:
    """Schliesst die Transaktion. Kein Event (ADR 0026, D8)."""
    if result.changed:
        FloorPlanningAccess(session, current_user.organization_id).record_project_change(
            result.context.project_id, actor_user_id=current_user.user_id
        )
    session.commit()


@router.get(
    "/buildings/{building_id}/distribution-boards",
    response_model=DistributionBoardListOut,
    operation_id="listElectricalDistributionBoards",
    summary="Verteilungen eines Gebaeudes",
    responses=_READ_RESPONSES,
)
def list_distribution_boards(
    building_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PLAN_READ)),
    session: Session = Depends(get_session),
) -> DistributionBoardListOut:
    """Verteilungen mit Code, Name und optionaler Lage (Geraet ``distribution_board``)."""
    _, boards = DistributionService(session, current_user.organization_id).list_boards(building_id)
    return DistributionBoardListOut(
        building_id=building_id,
        boards=[DistributionBoardOut.model_validate(board) for board in boards],
    )


@router.post(
    "/buildings/{building_id}/distribution-boards",
    response_model=DistributionBoardOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createElectricalDistributionBoard",
    summary="Verteilung anlegen",
    responses={
        **_CREATE_RESPONSES,
        409: {
            "model": ProblemDetail,
            "description": "Projekt schreibgeschuetzt oder Geraet platziert schon eine Verteilung",
        },
    },
)
def create_distribution_board(
    building_id: uuid.UUID,
    payload: DistributionBoardCreate,
    current_user: CurrentUser = Depends(require_permission(CIRCUIT_WRITE)),
    session: Session = Depends(get_session),
) -> DistributionBoardOut:
    """Legt eine Verteilung an; mehrere je Gebaeude, Code je Gebaeude eindeutig."""
    board, result = DistributionService(session, current_user.organization_id).create_board(
        building_id, payload
    )
    _commit_distribution(session=session, current_user=current_user, result=result)
    return DistributionBoardOut.model_validate(board)


@router.patch(
    "/distribution-boards/{board_id}",
    response_model=DistributionBoardOut,
    operation_id="updateElectricalDistributionBoard",
    summary="Verteilung aendern",
    responses=_WRITE_RESPONSES,
)
def update_distribution_board(
    board_id: uuid.UUID,
    payload: DistributionBoardUpdate,
    current_user: CurrentUser = Depends(require_permission(CIRCUIT_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> DistributionBoardOut:
    """Aendert Code, Name, Notiz oder Lage; ``If-Match`` traegt die Verteilungsversion."""
    board, result = DistributionService(session, current_user.organization_id).update_board(
        board_id, payload, expected_version=expected_version
    )
    _commit_distribution(session=session, current_user=current_user, result=result)
    return DistributionBoardOut.model_validate(board)


@router.delete(
    "/distribution-boards/{board_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteElectricalDistributionBoard",
    summary="Verteilung entfernen",
    responses=_WRITE_RESPONSES,
)
def delete_distribution_board(
    board_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(CIRCUIT_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> None:
    """Nur ohne Stromkreise (sonst ``409 board-has-circuits``); das Lagegeraet bleibt."""
    result = DistributionService(session, current_user.organization_id).delete_board(
        board_id, expected_version=expected_version
    )
    _commit_distribution(session=session, current_user=current_user, result=result)


@router.get(
    "/buildings/{building_id}/circuits",
    response_model=CircuitListOut,
    operation_id="listElectricalCircuits",
    summary="Stromkreise eines Gebaeudes",
    responses=_READ_RESPONSES,
)
def list_circuits(
    building_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PLAN_READ)),
    session: Session = Depends(get_session),
) -> CircuitListOut:
    """Stromkreise aller Verteilungen samt zugeordneten Geraeten.

    ``proposed_*`` sind Vorschlaege fuer neue Leitungen, ungeprueft (ADR 0026).
    """
    _, views = DistributionService(session, current_user.organization_id).list_circuits(building_id)
    return CircuitListOut(building_id=building_id, circuits=[_circuit_out(view) for view in views])


@router.post(
    "/distribution-boards/{board_id}/circuits",
    response_model=CircuitOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createElectricalCircuit",
    summary="Stromkreis anlegen",
    responses=_CREATE_RESPONSES,
)
def create_circuit(
    board_id: uuid.UUID,
    payload: CircuitCreate,
    current_user: CurrentUser = Depends(require_permission(CIRCUIT_WRITE)),
    session: Session = Depends(get_session),
) -> CircuitOut:
    """Legt einen Stromkreis an; Bezeichnung je Verteilung eindeutig."""
    view, result = DistributionService(session, current_user.organization_id).create_circuit(
        board_id, payload
    )
    _commit_distribution(session=session, current_user=current_user, result=result)
    return _circuit_out(view)


@router.patch(
    "/circuits/{circuit_id}",
    response_model=CircuitOut,
    operation_id="updateElectricalCircuit",
    summary="Stromkreis aendern",
    responses=_WRITE_RESPONSES,
)
def update_circuit(
    circuit_id: uuid.UUID,
    payload: CircuitUpdate,
    current_user: CurrentUser = Depends(require_permission(CIRCUIT_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> CircuitOut:
    """Aendert Angaben; eine Vorschlagsaenderung aendert keine bestehende Leitung."""
    view, result = DistributionService(session, current_user.organization_id).update_circuit(
        circuit_id, payload, expected_version=expected_version
    )
    _commit_distribution(session=session, current_user=current_user, result=result)
    return _circuit_out(view)


@router.delete(
    "/circuits/{circuit_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteElectricalCircuit",
    summary="Stromkreis entfernen",
    responses=_WRITE_RESPONSES,
)
def delete_circuit(
    circuit_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(CIRCUIT_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> None:
    """Entfernt den Stromkreis samt Geraetezuordnungen; die Geraete bleiben."""
    result = DistributionService(session, current_user.organization_id).delete_circuit(
        circuit_id, expected_version=expected_version
    )
    _commit_distribution(session=session, current_user=current_user, result=result)


@router.put(
    "/circuits/{circuit_id}/devices",
    response_model=CircuitOut,
    operation_id="replaceElectricalCircuitDevices",
    summary="Geraetezuordnung eines Stromkreises ersetzen",
    responses=_WRITE_RESPONSES,
)
def replace_circuit_devices(
    circuit_id: uuid.UUID,
    payload: CircuitDevicesUpdate,
    current_user: CurrentUser = Depends(require_permission(CIRCUIT_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> CircuitOut:
    """Ersetzt die Geraeteliste (``If-Match`` der Stromkreisversion).

    Nur Steckdosen, Schalter, Leuchten und Abzweigdosen desselben Gebaeudes (keine
    Datendosen, nicht das Lagegeraet einer Verteilung); ein Geraet eines
    anderen Stromkreises liefert ``409 device-assigned-elsewhere`` - es wird nie
    still umgehaengt.
    """
    view, result = DistributionService(session, current_user.organization_id).replace_devices(
        circuit_id, payload, expected_version=expected_version
    )
    _commit_distribution(session=session, current_user=current_user, result=result)
    return _circuit_out(view)


# ------------------------------------------ Leitungen und Durchfuehrungen (6b.3)


def _cable_out(view: CableView) -> CableOut:
    cable = view.cable
    result = view.result
    return CableOut(
        id=cable.id,
        circuit_id=cable.circuit_id,
        label=cable.label,
        start_device_id=cable.start_device_id,
        end_device_id=cable.end_device_id,
        cable_type=cable.cable_type,
        conductor_count=cable.conductor_count,
        cross_section_mm2=cross_section_out(cable.cross_section_mm2),
        start_allowance_mm=cable.start_allowance_mm,
        end_allowance_mm=cable.end_allowance_mm,
        reserve_mm=cable.reserve_mm,
        waypoints=[
            CableWaypointOut(
                # Die Datenbank laesst nur die bekannten Arten zu (CHECK).
                kind=cast(CableWaypointKindValue, row.kind),
                wall_id=row.wall_id,
                offset_mm=row.offset_mm,
                height_mm=row.height_mm,
                room_id=row.room_id,
                x_mm=row.x_mm,
                y_mm=row.y_mm,
                penetration_id=row.penetration_id,
                opening_id=row.opening_id,
                riser_id=row.riser_id,
                from_stop_id=row.from_stop_id,
                from_height_mm=row.from_height_mm,
                to_stop_id=row.to_stop_id,
                to_height_mm=row.to_height_mm,
            )
            for row in view.waypoints
        ],
        status=result.status.value,
        geometric_mm=result.geometric_mm,
        allowance_mm=result.allowance_mm,
        length_mm=result.length_mm,
        known_mm=result.known_mm,
        spec_complete=result.spec_complete,
        deviates_from_proposal=view.deviates_from_proposal,
        problems=[
            CableProblemOut(code=p.code, kind=p.kind.value, ref=p.ref, message=p.message)
            for p in result.problems
        ],
        segments=[
            CableSegmentOut(
                kind=segment.kind.value,
                ref=segment.ref,
                owner_id=segment.owner_id,
                floor_id=segment.floor_id,
                length_mm=segment.length_mm,
                known_mm=segment.known_mm,
                points=[RiserCoursePointOut(x_mm=x, y_mm=y, z_mm=z) for x, y, z in points],
            )
            for segment, points in zip(result.segments, view.points, strict=True)
        ],
        penetration_ids=[uuid.UUID(item) for item in result.penetration_ids],
        opening_crossings=result.opening_crossings,
        version=cable.version,
        created_at=cable.created_at,
        updated_at=cable.updated_at,
    )


def _penetration_out(view: PenetrationView) -> PenetrationOut:
    pen = view.penetration
    return PenetrationOut(
        id=pen.id,
        wall_link_id=pen.wall_link_id,
        wall_a_id=view.wall_a_id,
        wall_b_id=view.wall_b_id,
        floor_id=view.floor_id,
        offset_mm=pen.offset_mm,
        height_mm=pen.height_mm,
        note=pen.note,
        opposite_offset=None
        if view.opposite is None or view.opposite_rounded_mm is None
        else PositionOut(
            whole=view.opposite.whole,
            steps=view.opposite.steps,
            rounded_mm=view.opposite_rounded_mm,
        ),
        problem_code=view.problem_code,
        cable_ids=view.cable_ids,
        version=pen.version,
        created_at=pen.created_at,
        updated_at=pen.updated_at,
    )


def _commit_cables(
    *, session: Session, current_user: CurrentUser, result: CableWriteResult
) -> None:
    """Schliesst die Transaktion. Kein Event (ADR 0026, D8)."""
    if result.changed:
        FloorPlanningAccess(session, current_user.organization_id).record_project_change(
            result.context.project_id, actor_user_id=current_user.user_id
        )
    session.commit()


_CABLE_WRITE_RESPONSES: dict[int | str, dict[str, object]] = {
    **_WRITE_RESPONSES,
    409: {
        "model": ProblemDetail,
        "description": (
            "Versionskonflikt, Projekt schreibgeschuetzt, Bezug in Gebrauch oder Leitung "
            "wuerde unterbrochen (cables-would-break)"
        ),
    },
}


@router.get(
    "/buildings/{building_id}/cables",
    response_model=CableListOut,
    operation_id="listElectricalCables",
    summary="Leitungen eines Gebaeudes",
    responses=_READ_RESPONSES,
)
def list_cables(
    building_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PLAN_READ)),
    session: Session = Depends(get_session),
) -> CableListOut:
    """Leitungen mit Wegpunkten, Teilstrecken, Status, Laenge oder Teilsumme und Befunden.

    Nichts davon ist gespeichert: Weg und Laenge berechnet die reine Funktion bei jedem
    Lesen. ``length_mm`` nur bei ``confirmed``. Keine Bemessung, keine Normaussage.
    """
    _, views = CableService(session, current_user.organization_id).overview(building_id)
    return CableListOut(building_id=building_id, cables=[_cable_out(view) for view in views])


@router.get(
    "/buildings/{building_id}/cabling-summary",
    response_model=CablingSummaryOut,
    operation_id="getElectricalCablingSummary",
    summary="Mengenuebersicht der Leitungen eines Gebaeudes",
    responses=_READ_RESPONSES,
)
def get_cabling_summary(
    building_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PLAN_READ)),
    session: Session = Depends(get_session),
) -> CablingSummaryOut:
    """Mengen nach den tatsaechlichen Kabelangaben, Trassen, Durchfuehrungen, Geraete.

    Rein lesend und abgeleitet - nichts davon ist gespeichert; ein konsistenter Stand je
    Antwort, auch fuer abgeschlossene und archivierte Projekte. Offene und konflikthafte
    Leitungen stehen getrennt und nie in der bestaetigten Menge. Kein Material, keine
    Preise, keine Bemessung oder Normaussage.
    """
    state, summary = CableService(session, current_user.organization_id).cabling_summary(
        building_id
    )
    return _summary_out(state, summary)


def _bucket_out(bucket: StatusBucket) -> CablingBucketOut:
    return CablingBucketOut(
        count=bucket.count,
        geometric_mm=bucket.geometric_mm,
        allowance_mm=bucket.allowance_mm,
        total_mm=bucket.total_mm,
        cable_ids=list(bucket.cable_ids),
    )


def _summary_cable_out(line: CableLine) -> CablingCableOut:
    cable = line.cable
    result = line.result
    return CablingCableOut(
        id=cable.id,
        circuit_id=cable.circuit_id,
        label=cable.label,
        start_device_id=cable.start_device_id,
        end_device_id=cable.end_device_id,
        cable_type=cable.cable_type,
        conductor_count=cable.conductor_count,
        cross_section_mm2=cross_section_out(cable.cross_section_mm2),
        missing_spec=[cast(MissingSpecValue, field) for field in line.missing],
        status=result.status.value,
        geometric_mm=result.geometric_mm,
        allowance_mm=result.allowance_mm,
        length_mm=result.length_mm,
        known_mm=result.known_mm,
        problem_codes=[problem.code for problem in result.problems],
    )


def _group_out(group: CableGroup) -> CablingGroupOut:
    return CablingGroupOut(
        cable_type=group.spec.cable_type,
        conductor_count=group.spec.conductor_count,
        cross_section_mm2=cross_section_out(group.spec.cross_section_mm2) or "",
        confirmed=_bucket_out(group.confirmed),
        incomplete=_bucket_out(group.incomplete),
        conflict=_bucket_out(group.conflict),
    )


def _summary_out(state: BuildingCableState, summary: CablingSummary) -> CablingSummaryOut:
    return CablingSummaryOut(
        building_id=state.context.building_id,
        building_name=state.context.building_name,
        project_status=state.context.project_status,
        groups=[_group_out(group) for group in summary.groups],
        totals=CablingTotalsOut(
            confirmed=_bucket_out(summary.totals.confirmed),
            incomplete=_bucket_out(summary.totals.incomplete),
            conflict=_bucket_out(summary.totals.conflict),
        ),
        unspecified=[_summary_cable_out(line) for line in summary.unspecified],
        cables=[_summary_cable_out(line) for line in summary.cables],
        surfaces=[
            CablingSurfaceOut(
                surface=cast(CablingSurfaceValue, item.surface),
                confirmed_trace_mm=item.confirmed_trace_mm,
                confirmed_cable_mm=item.confirmed_cable_mm,
                all_trace_mm=item.all_trace_mm,
                all_cable_mm=item.all_cable_mm,
                confirmed_complete=item.confirmed_complete,
                all_complete=item.all_complete,
            )
            for item in summary.surfaces
        ],
        penetrations=[
            CablingPenetrationOut(
                id=item.penetration_id,
                used=len(item.cable_ids) > 0,
                cable_ids=list(item.cable_ids),
                problem_code=item.problem_code,
            )
            for item in summary.penetrations
        ],
        crossings=[
            CablingCrossingOut(
                opening_id=item.opening_id,
                wall_id=item.wall_id,
                cable_ids=list(item.cable_ids),
                uses=item.uses,
            )
            for item in summary.crossings
        ],
        circuits=[
            CablingCircuitOut(
                circuit_id=item.circuit_id,
                board_id=state.circuits[item.circuit_id].board_id,
                designation=state.circuits[item.circuit_id].designation,
                name=state.circuits[item.circuit_id].name,
                by_type=[
                    CablingTypeCountOut(type_key=t.type_key, label=t.label, count=t.count)
                    for t in item.by_type
                ],
                device_ids=list(item.device_ids),
                devices_without_cable=list(item.without_cable),
            )
            for item in summary.circuits
        ],
        unassigned_device_ids=list(summary.unassigned_device_ids),
    )


@router.post(
    "/circuits/{circuit_id}/cables",
    response_model=CableOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createElectricalCable",
    summary="Leitung anlegen",
    responses=_CREATE_RESPONSES,
)
def create_cable(
    circuit_id: uuid.UUID,
    payload: CableIn,
    current_user: CurrentUser = Depends(require_permission(ROUTE_WRITE)),
    session: Session = Depends(get_session),
) -> CableOut:
    """Legt eine Leitung samt Wegpunkten an; neue Durchfuehrungen entstehen atomar mit ihr.

    Endgeraete: das Lagegeraet der Verteilung oder Geraete dieses Stromkreises, im
    Gebaeude, nicht aussen montiert. Unvollstaendige Wege werden gespeichert
    (``incomplete``), unzulaessige Strecken nicht (``422 cable-route-invalid``).
    """
    view, result = CableService(session, current_user.organization_id).create(circuit_id, payload)
    _commit_cables(session=session, current_user=current_user, result=result)
    return _cable_out(view)


@router.put(
    "/cables/{cable_id}",
    response_model=CableOut,
    operation_id="replaceElectricalCable",
    summary="Leitung ersetzen",
    responses=_CABLE_WRITE_RESPONSES,
)
def replace_cable(
    cable_id: uuid.UUID,
    payload: CableIn,
    current_user: CurrentUser = Depends(require_permission(ROUTE_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> CableOut:
    """Ersetzt die ganze Leitung samt Wegpunkten (``If-Match`` der Leitungsversion).

    Bleiben Weg und Endgeraete unveraendert, blockiert ein bestehender Konflikt das
    Aendern der Kabelangaben nicht; ein **neuer** Konflikt wird abgelehnt.
    """
    view, result = CableService(session, current_user.organization_id).replace(
        cable_id, payload, expected_version=expected_version
    )
    _commit_cables(session=session, current_user=current_user, result=result)
    return _cable_out(view)


@router.delete(
    "/cables/{cable_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteElectricalCable",
    summary="Leitung entfernen",
    responses=_WRITE_RESPONSES,
)
def delete_cable(
    cable_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(ROUTE_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> None:
    """Entfernt die Leitung samt Wegpunkten; Durchfuehrungen bleiben sichtbar bestehen."""
    result = CableService(session, current_user.organization_id).delete(
        cable_id, expected_version=expected_version
    )
    _commit_cables(session=session, current_user=current_user, result=result)


@router.post(
    "/cables/{cable_id}/apply-proposal",
    response_model=CableOut,
    operation_id="applyElectricalCircuitProposal",
    summary="Stromkreisvorschlag auf eine Leitung uebertragen",
    responses=_CABLE_WRITE_RESPONSES,
)
def apply_circuit_proposal(
    cable_id: uuid.UUID,
    payload: ApplyProposalIn,
    current_user: CurrentUser = Depends(require_permission(CIRCUIT_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> CableOut:
    """Uebertraegt Typ, Leiterzahl und Querschnitt des Stromkreisvorschlags auf die Leitung.

    ``If-Match``: Version der Leitung. ``expected_circuit_version``: Version des
    Stromkreises, dessen Vorschlag gesehen wurde. Beide werden unter der Projektsperre
    geprueft; bei Abweichung ``409`` (``version-conflict`` bzw.
    ``circuit-proposal-changed``) ohne jede Aenderung. Weg, Endgeraete, Zugaben und
    Bezeichnung bleiben unveraendert.
    """
    view, result = CableService(session, current_user.organization_id).apply_proposal(
        cable_id, payload, expected_version=expected_version
    )
    _commit_cables(session=session, current_user=current_user, result=result)
    return _cable_out(view)


@router.get(
    "/floors/{floor_id}/penetrations",
    response_model=PenetrationListOut,
    operation_id="listElectricalPenetrations",
    summary="Durchfuehrungen eines Geschosses",
    responses=_READ_RESPONSES,
)
def list_penetrations(
    floor_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PLAN_READ)),
    session: Session = Depends(get_session),
) -> PenetrationListOut:
    """Durchfuehrungen mit abgeleiteter Gegenlage, Gueltigkeit und nutzenden Leitungen."""
    views = CableService(session, current_user.organization_id).floor_penetrations(floor_id)
    return PenetrationListOut(
        floor_id=floor_id, penetrations=[_penetration_out(view) for view in views]
    )


@router.patch(
    "/penetrations/{penetration_id}",
    response_model=PenetrationOut,
    operation_id="updateElectricalPenetration",
    summary="Durchfuehrung aendern",
    responses=_CABLE_WRITE_RESPONSES,
)
def update_penetration(
    penetration_id: uuid.UUID,
    payload: PenetrationUpdate,
    current_user: CurrentUser = Depends(require_permission(ROUTE_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> PenetrationOut:
    """Aendert Lage, Hoehe oder Notiz; die neue Lage muss gueltig sein (``422``)."""
    view, result = CableService(session, current_user.organization_id).update_penetration(
        penetration_id, payload, expected_version=expected_version
    )
    _commit_cables(session=session, current_user=current_user, result=result)
    return _penetration_out(view)


@router.delete(
    "/penetrations/{penetration_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteElectricalPenetration",
    summary="Durchfuehrung entfernen",
    responses=_CABLE_WRITE_RESPONSES,
)
def delete_penetration(
    penetration_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(ROUTE_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> None:
    """Nur ungenutzt (sonst ``409 penetration-in-use``)."""
    result = CableService(session, current_user.organization_id).delete_penetration(
        penetration_id, expected_version=expected_version
    )
    _commit_cables(session=session, current_user=current_user, result=result)
