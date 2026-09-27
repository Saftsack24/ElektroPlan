"""Echte Parallelitaet beim atomaren Konturspeichern (Phase 4a).

Aufbau wie in ``tests/test_electrical_concurrency.py``: **zwei Threads, zwei
Sessions, eine Barriere**, Pruefung des Datenbankzustands am Ende. Die
Wechselwirkung mit der Archivierung steht in ``tests/test_archive_concurrency.py``
(Schreibweg ``kontur-speichern``).

Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import threading
import uuid

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.errors import VersionConflictError
from app.modules.electrical.models import ElectricalRoom, ElectricalWall
from app.modules.electrical.schemas import (
    ContourWallIn,
    RoomContourUpdate,
    RoomCreate,
    WallUpdate,
)
from app.modules.electrical.service import ElectricalRoomService
from tests import test_electrical_concurrency as raummodell
from tests.conftest import requires_database
from tests.test_concurrency import gleichzeitig

pytestmark = [requires_database, pytest.mark.database]

geschoss = raummodell.geschoss


@pytest.fixture
def factory(engine: Engine, clean_database: None) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def _rechteck(breite: int, ids: list[uuid.UUID]) -> RoomContourUpdate:
    ecken = [(0, 0), (breite, 0), (breite, 4_000), (0, 4_000)]
    return RoomContourUpdate(
        walls=[
            ContourWallIn(
                id=ids[index],
                x1_mm=ecken[index][0],
                y1_mm=ecken[index][1],
                x2_mm=ecken[(index + 1) % 4][0],
                y2_mm=ecken[(index + 1) % 4][1],
            )
            for index in range(4)
        ]
    )


@pytest.fixture
def rechteckraum(
    factory: sessionmaker[Session], geschoss: tuple[uuid.UUID, uuid.UUID]
) -> tuple[uuid.UUID, list[uuid.UUID], int]:
    """Raum 5000 x 4000 mit vier Waenden - IDs und Raumversion danach."""
    organization_id, floor_id = geschoss
    ids = [uuid.uuid4() for _ in range(4)]
    session = factory()
    try:
        service = ElectricalRoomService(session, organization_id)
        view, _ = service.create_room(floor_id, RoomCreate(name="Wohnzimmer"))
        session.commit()
        plan, _ = service.replace_contour(
            view.room.id, _rechteck(5_000, ids), expected_version=view.room.version
        )
        session.commit()
        return view.room.id, ids, plan.view.room.version
    finally:
        session.close()


def _zustand(
    factory: sessionmaker[Session], room_id: uuid.UUID
) -> tuple[int, list[tuple[uuid.UUID, int, int, int, int, int]]]:
    session = factory()
    try:
        version = session.execute(
            select(ElectricalRoom.version).where(ElectricalRoom.id == room_id)
        ).scalar_one()
        waende = session.execute(
            select(ElectricalWall)
            .where(ElectricalWall.room_id == room_id)
            .order_by(ElectricalWall.sort_order)
        ).scalars()
        return version, [(w.id, w.x1_mm, w.y1_mm, w.x2_mm, w.y2_mm, w.thickness_mm) for w in waende]
    finally:
        session.close()


def test_zwei_gleichzeitige_editor_speichervorgaenge_ueberschreiben_sich_nicht(
    factory: sessionmaker[Session],
    geschoss: tuple[uuid.UUID, uuid.UUID],
    rechteckraum: tuple[uuid.UUID, list[uuid.UUID], int],
) -> None:
    """Zwei Editoren mit demselben Stand speichern gleichzeitig verschiedene Breiten.

    Genau einer gewinnt; der andere erhaelt ``409 version-conflict``. Im
    Datenbankzustand steht vollstaendig der Stand des Gewinners - keine
    Mischung aus beiden, und die Raumversion ist genau einmal weitergezaehlt.
    """
    organization_id, _ = geschoss
    room_id, ids, version = rechteckraum
    breiten = {"A": 6_000, "B": 7_000}
    barriere = threading.Barrier(2, timeout=15)

    def speichern(session: Session, name: str) -> str:
        service = ElectricalRoomService(session, organization_id)
        barriere.wait()
        service.replace_contour(room_id, _rechteck(breiten[name], ids), expected_version=version)
        return name

    lauf = gleichzeitig(factory, speichern)

    assert len(lauf.erfolge) == 1, lauf.fehler
    assert lauf.fehlerklassen == [VersionConflictError]
    neue_version, waende = _zustand(factory, room_id)
    assert neue_version == version + 1
    gewinnerbreite = breiten[lauf.erfolge[0]]
    assert [w[0] for w in waende] == ids
    assert waende[0][3] == gewinnerbreite
    assert waende[1][1] == gewinnerbreite
    assert waende[1][3] == gewinnerbreite
    assert waende[2][1] == gewinnerbreite


def test_editor_und_formular_gleichzeitig_auf_derselben_wand(
    factory: sessionmaker[Session],
    geschoss: tuple[uuid.UUID, uuid.UUID],
    rechteckraum: tuple[uuid.UUID, list[uuid.UUID], int],
) -> None:
    """Editor verschiebt eine Ecke, das Formular aendert dieselbe Wand.

    Beide sperren Projekt und Raum. Wer zweiter ist, arbeitet gegen einen
    veralteten Stand und erhaelt ``409`` - in beiden Reihenfolgen. Eine
    verlorene Aenderung gibt es nicht.
    """
    organization_id, _ = geschoss
    room_id, ids, version = rechteckraum
    barriere = threading.Barrier(2, timeout=15)

    def arbeiten(session: Session, name: str) -> str:
        service = ElectricalRoomService(session, organization_id)
        barriere.wait()
        if name == "editor":
            service.replace_contour(room_id, _rechteck(6_000, ids), expected_version=version)
        else:
            service.update_wall(ids[1], WallUpdate(thickness_mm=300), expected_version=1)
        return name

    lauf = gleichzeitig(factory, arbeiten, namen=("editor", "formular"))

    assert len(lauf.erfolge) == 1, lauf.fehler
    assert lauf.fehlerklassen == [VersionConflictError]
    neue_version, waende = _zustand(factory, room_id)
    assert neue_version == version + 1
    if lauf.erfolge == ["editor"]:
        assert waende[1][1] == 6_000 and waende[1][5] != 300
    else:
        assert waende[1][1] == 5_000 and waende[1][5] == 300
