"""Wandkopplungen: anlegen, aendern, loesen, auswerten (Phase 6a, ADR 0024).

Eine Kopplung verbindet zwei Raumwaende verschiedener Raeume desselben
Geschosses und speichert nur die Entscheidung ``shared``/``separate``. Die
Geometrie bleibt in den Raumwaenden; Status und Kandidaten leitet
``link_rules.py`` aus der Teilung des Geschosses ab.

**Ablauf jedes Schreibvorgangs** (eine Transaktion, Reihenfolge "Projekt
zuerst"):

1. Projektzeile sperren und Schreibschutz pruefen
   (``FloorPlanningAccess.writable_context`` - ``409`` bei ``completed`` und
   ``archived``),
2. Kopplung sperren und ``If-Match`` pruefen (beim Aendern und Loesen),
3. beide beteiligten Raeume sperren,
4. Geraete-Ausgangslage des Geschosses festhalten,
5. schreiben,
6. **Raumversion beider Raeume** weiterzaehlen - ein bereits geoeffneter
   Raumentwurf bemerkt die neue Zuordnung beim Speichern als Versionskonflikt,
   statt sie still zu uebergehen,
7. Geraetebefunde pruefen: keine neuen, keine groesseren (``422``). Nichts wird
   verschoben oder geloescht.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.persistence import CONCURRENT_UPDATE_DETAIL, flush, unique_violation_translated
from app.core.preconditions import check_version
from app.core.projects.planning import FloorPlanningAccess, FloorPlanningContext
from app.core.tenancy.repository import TenantRepository
from app.db.mixins import utcnow
from app.errors import (
    ConflictError,
    ProblemFieldError,
    ValidationFailedError,
    VersionConflictError,
)
from app.modules.electrical import geometry
from app.modules.electrical.device_rules import (
    DeviceBaseline,
    FloorDeviceCheck,
    topo_link,
    topo_wall,
)
from app.modules.electrical.geometry import Point, Segment
from app.modules.electrical.link_rules import (
    LinkCandidate,
    LinkStatus,
    link_candidates,
    link_status,
    pair_coverage,
)
from app.modules.electrical.models import (
    WALL_LINK_PAIR_CONSTRAINT,
    ElectricalOpening,
    ElectricalRoom,
    ElectricalWall,
    ElectricalWallLink,
)
from app.modules.electrical.schemas import WallLinkCreate, WallLinkUpdate
from app.modules.electrical.topology import partition

#: Meldung, wenn eine Zuordnung ein vorhandenes Geraet unzulaessig machen wuerde.
LINK_DEVICE_DETAIL = (
    "Mit dieser Wandzuordnung laege ein Geraet unzulaessig (etwa in einer Oeffnung des "
    "Nachbarraums). Es wurde nichts gespeichert; Geraete werden nie automatisch verschoben."
)


class WallLinkRepository(TenantRepository[ElectricalWallLink]):
    model = ElectricalWallLink


class _WallRepository(TenantRepository[ElectricalWall]):
    model = ElectricalWall


class _RoomRepository(TenantRepository[ElectricalRoom]):
    model = ElectricalRoom


@dataclass(frozen=True, slots=True)
class WallLinkView:
    """Eine gespeicherte Kopplung mit abgeleitetem Status."""

    link: ElectricalWallLink
    status: LinkStatus
    thickness_conflict: bool


@dataclass(frozen=True, slots=True)
class WallLinkOverview:
    floor_id: uuid.UUID
    links: list[WallLinkView]
    candidates: list[LinkCandidate]


@dataclass(frozen=True, slots=True)
class LinkWriteResult:
    """Was die API-Schicht fuer Event und Projektvermerk braucht."""

    context: FloorPlanningContext
    #: Raeume beider Waende - je Raum ein ``plan_updated`` (``wall_links_changed``).
    room_ids: tuple[uuid.UUID, ...]
    changed: bool = True


def analyse_links(
    rooms: Sequence[ElectricalRoom],
    walls: Sequence[ElectricalWall],
    openings: Mapping[uuid.UUID, Sequence[ElectricalOpening]],
    links: Sequence[ElectricalWallLink],
) -> tuple[list[WallLinkView], list[LinkCandidate]]:
    """Status jeder Kopplung und alle Kandidaten eines Geschosses - rein."""
    partitions = partition(
        [topo_wall(wall, openings.get(wall.id, ())) for wall in walls],
        [topo_link(link) for link in links],
    )
    thickness = {str(wall.id): wall.thickness_mm for wall in walls}
    by_room: dict[uuid.UUID, list[ElectricalWall]] = {}
    for wall in walls:
        by_room.setdefault(wall.room_id, []).append(wall)
    valid_rooms = {
        str(room.id)
        for room in rooms
        if geometry.contour_report(
            [
                Segment(
                    key=str(wall.id),
                    start=Point(x_mm=wall.x1_mm, y_mm=wall.y1_mm),
                    end=Point(x_mm=wall.x2_mm, y_mm=wall.y2_mm),
                )
                for wall in sorted(by_room.get(room.id, []), key=lambda w: (w.sort_order, w.id))
            ]
        ).status
        is geometry.ContourStatus.VALID
    }
    views = [
        WallLinkView(
            link=link,
            status=link_status(partitions, topo_link(link)),
            thickness_conflict=link.relation == "shared"
            and thickness.get(str(link.wall_a_id)) != thickness.get(str(link.wall_b_id)),
        )
        for link in links
    ]
    candidates = link_candidates(
        partitions,
        [topo_link(link) for link in links],
        thickness_mm=thickness,
        valid_rooms=valid_rooms,
    )
    return views, candidates


def _problem(code: str, message: str, *keys: uuid.UUID) -> ProblemFieldError:
    return ProblemFieldError(
        field="wall_link", code=code, message=message, keys=[str(key) for key in keys] or None
    )


class WallLinkService:
    """Wandkopplungen eines Mandanten."""

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self.session = session
        self.organization_id = organization_id
        self.links = WallLinkRepository(session, organization_id)
        self.walls = _WallRepository(session, organization_id)
        self.rooms = _RoomRepository(session, organization_id)
        self.device_check = FloorDeviceCheck(session, organization_id)
        self.structure = FloorPlanningAccess(session, organization_id)

    # ------------------------------------------------------------------ Lesen

    def overview(self, floor_id: uuid.UUID) -> WallLinkOverview:
        """Kopplungen mit Status und Kandidaten - archivierte Projekte bleiben lesbar."""
        self.structure.context(floor_id)
        views, candidates = self._analysis(floor_id)
        return WallLinkOverview(floor_id=floor_id, links=views, candidates=candidates)

    def _floor_rows(
        self, floor_id: uuid.UUID
    ) -> tuple[
        list[ElectricalRoom],
        list[ElectricalWall],
        dict[uuid.UUID, list[ElectricalOpening]],
        list[ElectricalWallLink],
    ]:
        rooms = list(
            self.session.execute(
                self.rooms.query()
                .where(ElectricalRoom.floor_id == floor_id)
                .order_by(ElectricalRoom.id.asc())
            ).scalars()
        )
        walls: list[ElectricalWall] = []
        if rooms:
            walls = list(
                self.session.execute(
                    self.walls.query()
                    .where(ElectricalWall.room_id.in_([room.id for room in rooms]))
                    .order_by(
                        ElectricalWall.room_id.asc(),
                        ElectricalWall.sort_order.asc(),
                        ElectricalWall.id.asc(),
                    )
                    .execution_options(populate_existing=True)
                ).scalars()
            )
        openings: dict[uuid.UUID, list[ElectricalOpening]] = {}
        links: list[ElectricalWallLink] = []
        if walls:
            wall_ids = [wall.id for wall in walls]
            for opening in self.session.execute(
                select(ElectricalOpening).where(
                    ElectricalOpening.organization_id == self.organization_id,
                    ElectricalOpening.wall_id.in_(wall_ids),
                )
            ).scalars():
                openings.setdefault(opening.wall_id, []).append(opening)
            links = list(
                self.session.execute(
                    self.links.query()
                    .where(
                        ElectricalWallLink.wall_a_id.in_(wall_ids),
                        ElectricalWallLink.wall_b_id.in_(wall_ids),
                    )
                    .order_by(ElectricalWallLink.id.asc())
                ).scalars()
            )
        return rooms, walls, openings, links

    def _analysis(self, floor_id: uuid.UUID) -> tuple[list[WallLinkView], list[LinkCandidate]]:
        rooms, walls, openings, links = self._floor_rows(floor_id)
        return analyse_links(rooms, walls, openings, links)

    # -------------------------------------------------------------- Schreiben

    def create(
        self, floor_id: uuid.UUID, payload: WallLinkCreate, *, actor_user_id: uuid.UUID
    ) -> tuple[WallLinkView, LinkWriteResult]:
        """Legt eine Kopplung an - nur fuer exakt und eindeutig ueberlappende Waende."""
        context = self.structure.writable_context(floor_id)
        first, second = self._walls_on_floor(floor_id, payload.wall_a_id, payload.wall_b_id)
        rooms = self._lock_rooms(first.room_id, second.room_id)

        a, b = sorted((first, second), key=lambda wall: wall.id)
        _, walls, openings, links = self._floor_rows(floor_id)
        partitions = partition(
            [topo_wall(wall, openings.get(wall.id, ())) for wall in walls],
            [topo_link(link) for link in links],
        )
        coverage = pair_coverage(partitions, str(a.id), str(b.id))
        if coverage.sections == 0:
            raise ValidationFailedError(
                "Diese beiden Waende liegen nicht exakt auf derselben Linie oder ueberlappen sich "
                "nicht. Es wurde nichts gespeichert.",
                errors=[
                    _problem(
                        "wall-link-no-overlap",
                        "Die Waende ueberlappen sich nicht exakt.",
                        a.id,
                        b.id,
                    )
                ],
            )
        if coverage.ambiguous:
            raise ValidationFailedError(
                "Auf diesem Wandstueck liegt eine weitere Wand (dritter Raum oder eine andere "
                "Zuordnung). Die Zuordnung waere nicht eindeutig. Es wurde nichts gespeichert.",
                errors=[
                    _problem(
                        "wall-link-ambiguous",
                        "Die Wandzuordnung waere nicht eindeutig.",
                        a.id,
                        b.id,
                    )
                ],
            )
        existing = next(
            (link for link in links if (link.wall_a_id, link.wall_b_id) == (a.id, b.id)), None
        )
        if existing is not None:
            raise _exists_error(existing)

        baseline = self._baseline(context)
        link = ElectricalWallLink(
            id=uuid.uuid4(),
            organization_id=self.organization_id,
            wall_a_id=a.id,
            wall_b_id=b.id,
            relation=payload.relation,
            origin="user",
            created_by_user_id=actor_user_id,
        )
        self.links.add(link)
        for room in rooms:
            _touch(room)
        with unique_violation_translated(
            self.session,
            constraint=WALL_LINK_PAIR_CONSTRAINT,
            error=ConflictError(
                "Diese beiden Waende sind bereits einander zugeordnet. Bitte neu laden.",
                errors=[_problem("wall-link-exists", "Die Zuordnung besteht bereits.", a.id, b.id)],
            ),
        ):
            flush(self.session)
        self._require_devices_fit(context, baseline)
        return self._view(floor_id, link), LinkWriteResult(
            context=context, room_ids=tuple(room.id for room in rooms)
        )

    def update(
        self, link_id: uuid.UUID, payload: WallLinkUpdate, *, expected_version: int
    ) -> tuple[WallLinkView, LinkWriteResult]:
        """Aendert die Entscheidung; unveraendert bleibt alles, wie es ist."""
        link, context, rooms = self._locked_link(link_id, expected_version)
        if link.relation == payload.relation:
            return self._view(context.floor_id, link), LinkWriteResult(
                context=context, room_ids=tuple(room.id for room in rooms), changed=False
            )
        baseline = self._baseline(context)
        link.relation = payload.relation
        for room in rooms:
            _touch(room)
        flush(self.session)
        self._require_devices_fit(context, baseline)
        return self._view(context.floor_id, link), LinkWriteResult(
            context=context, room_ids=tuple(room.id for room in rooms)
        )

    def delete(self, link_id: uuid.UUID, *, expected_version: int) -> LinkWriteResult:
        """Loest die Kopplung. Der Abschnitt ist danach unentschieden (konservativ)."""
        link, context, rooms = self._locked_link(link_id, expected_version)
        baseline = self._baseline(context)
        self.session.delete(link)
        for room in rooms:
            _touch(room)
        flush(self.session)
        self._require_devices_fit(context, baseline)
        return LinkWriteResult(context=context, room_ids=tuple(room.id for room in rooms))

    # ---------------------------------------------------------------- Helfer

    def _walls_on_floor(
        self, floor_id: uuid.UUID, first_id: uuid.UUID, second_id: uuid.UUID
    ) -> tuple[ElectricalWall, ElectricalWall]:
        if first_id == second_id:
            raise ValidationFailedError(
                "Eine Wand kann nicht mit sich selbst gekoppelt werden.",
                errors=[_problem("wall-link-same-wall", "Zweimal dieselbe Wand.", first_id)],
            )
        walls = {
            wall.id: wall
            for wall in self.session.execute(
                self.walls.query()
                .where(ElectricalWall.id.in_([first_id, second_id]))
                .execution_options(populate_existing=True)
            ).scalars()
        }
        missing = [item for item in (first_id, second_id) if item not in walls]
        if missing:
            # Fremder Mandant und unbekannte ID liefern dieselbe Antwort.
            raise ValidationFailedError(
                "Eine der Waende wurde nicht gefunden. Bitte neu laden.",
                errors=[_problem("wall-link-wall-unknown", "Wand nicht gefunden.", *missing)],
            )
        first, second = walls[first_id], walls[second_id]
        room_floors = {
            room.id: room.floor_id
            for room in self.session.execute(
                self.rooms.query().where(ElectricalRoom.id.in_([first.room_id, second.room_id]))
            ).scalars()
        }
        if any(room_floors.get(wall.room_id) != floor_id for wall in (first, second)):
            raise ValidationFailedError(
                "Gekoppelt werden nur Waende desselben Geschosses.",
                errors=[
                    _problem(
                        "wall-link-other-floor",
                        "Die Wand gehoert zu einem anderen Geschoss.",
                        first_id,
                        second_id,
                    )
                ],
            )
        if first.room_id == second.room_id:
            raise ValidationFailedError(
                "Gekoppelt werden nur Waende verschiedener Raeume.",
                errors=[
                    _problem(
                        "wall-link-same-room",
                        "Beide Waende gehoeren zum selben Raum.",
                        first_id,
                        second_id,
                    )
                ],
            )
        return first, second

    def _lock_rooms(self, *room_ids: uuid.UUID) -> list[ElectricalRoom]:
        """Sperrt die beteiligten Raeume - nach der Projektsperre, nach ID geordnet."""
        return list(
            self.session.execute(
                select(ElectricalRoom)
                .where(
                    ElectricalRoom.organization_id == self.organization_id,
                    ElectricalRoom.id.in_(set(room_ids)),
                )
                .order_by(ElectricalRoom.id.asc())
                .with_for_update()
                .execution_options(populate_existing=True)
            ).scalars()
        )

    def _locked_link(
        self, link_id: uuid.UUID, expected_version: int
    ) -> tuple[ElectricalWallLink, FloorPlanningContext, list[ElectricalRoom]]:
        """Projekt sperren, dann Kopplung, dann beide Raeume - in dieser Reihenfolge."""
        link = self.links.get_or_404(link_id)
        wall = self.walls.get_or_404(link.wall_a_id)
        floor_id = self.rooms.get_or_404(wall.room_id).floor_id
        context = self.structure.writable_context(floor_id)
        locked = self.session.execute(
            select(ElectricalWallLink)
            .where(
                ElectricalWallLink.organization_id == self.organization_id,
                ElectricalWallLink.id == link_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if locked is None:
            # Zwischenzeitlich geloest (oder mit einem Raum entfernt).
            raise VersionConflictError(CONCURRENT_UPDATE_DETAIL)
        check_version(locked, expected_version)
        room_ids = [
            wall.room_id
            for wall in self.session.execute(
                self.walls.query().where(
                    ElectricalWall.id.in_([locked.wall_a_id, locked.wall_b_id])
                )
            ).scalars()
        ]
        return locked, context, self._lock_rooms(*room_ids)

    def _baseline(self, context: FloorPlanningContext) -> DeviceBaseline:
        return self.device_check.baseline(context.floor_id, context.default_ceiling_height_mm)

    def _require_devices_fit(self, context: FloorPlanningContext, baseline: DeviceBaseline) -> None:
        self.device_check.require_no_new_problems(
            context.floor_id,
            context.default_ceiling_height_mm,
            baseline,
            detail=LINK_DEVICE_DETAIL,
        )

    def _view(self, floor_id: uuid.UUID, link: ElectricalWallLink) -> WallLinkView:
        views, _ = self._analysis(floor_id)
        return next(view for view in views if view.link.id == link.id)


def _exists_error(existing: ElectricalWallLink) -> ConflictError:
    return ConflictError(
        "Diese beiden Waende sind bereits einander zugeordnet. Bitte die bestehende Zuordnung "
        "aendern statt eine neue anzulegen.",
        errors=[
            _problem(
                "wall-link-exists",
                "Die Zuordnung besteht bereits.",
                existing.id,
                existing.wall_a_id,
                existing.wall_b_id,
            )
        ],
    )


def _touch(room: ElectricalRoom) -> None:
    """Zaehlt die Raumversion weiter (wie ``service._touch``)."""
    room.updated_at = utcnow()


def links_touching(
    session: Session, organization_id: uuid.UUID, wall_ids: Sequence[uuid.UUID]
) -> list[ElectricalWallLink]:
    """Alle Kopplungen, an denen mindestens eine der Waende beteiligt ist."""
    if not wall_ids:
        return []
    return list(
        session.execute(
            select(ElectricalWallLink)
            .where(
                ElectricalWallLink.organization_id == organization_id,
                or_(
                    ElectricalWallLink.wall_a_id.in_(wall_ids),
                    ElectricalWallLink.wall_b_id.in_(wall_ids),
                ),
            )
            .order_by(ElectricalWallLink.id.asc())
        ).scalars()
    )
