"""Echte Parallelitaet bei Wandkopplungen (Phase 6a.1, ADR 0024).

Zwei Threads, zwei Sessions, PostgreSQL. Geprueft wird jeweils der
**Datenbankzustand** am Ende: Er darf nie eine Kombination enthalten, die eine
Seite allein abgelehnt haette.

* Kopplung anlegen gegen das Verschieben der Partnerwand (Raumentwurf mit vorher
  gelesener Version): Nie entsteht eine Kopplung "hinter" einer bereits
  verschobenen Wand, und der Entwurf unterbricht keine Kopplung, die er nicht
  kannte.
* Kopplung anlegen gegen das Entfernen der Wand.
* ``separate -> shared`` gegen ein Geraet, das genau in der Tuer des Nachbarn
  gespeichert wird: Nie stehen ``shared`` und das Geraet in der Tuer zusammen.

Abschluss und Archivierung gegen den Kopplungsweg laufen in
``test_completed_concurrency.py`` und ``test_archive_concurrency.py``
(Schreibweg ``kopplung-anlegen``).

Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import threading
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.errors import ValidationFailedError, VersionConflictError
from app.modules.electrical.models import ElectricalDevice, ElectricalWall, ElectricalWallLink
from app.modules.electrical.schemas import (
    ContourDeviceIn,
    ContourWallIn,
    OpeningCreate,
    RoomContourUpdate,
    RoomCreate,
    WallLinkCreate,
    WallLinkUpdate,
)
from app.modules.electrical.service import ElectricalRoomService
from app.modules.electrical.wall_links import WallLinkService
from tests.conftest import requires_database
from tests.test_archive_concurrency import Welt, factory, welt  # noqa: F401 - Fixtures
from tests.test_concurrency import ACTOR, gleichzeitig

pytestmark = [requires_database, pytest.mark.database]


def _nachbar(factory: sessionmaker[Session], welt: Welt) -> tuple[uuid.UUID, uuid.UUID]:  # noqa: F811
    """Raum B mit einer Wand (5000,0)->(0,0) - gegenlaeufig deckungsgleich zur Wand von A."""
    session = factory()
    try:
        wand = uuid.uuid4()
        view, _ = ElectricalRoomService(session, welt.organization_id).create_room(
            welt.floor_id,
            RoomCreate(
                name="Flur",
                walls=[ContourWallIn(id=wand, x1_mm=5_000, y1_mm=0, x2_mm=0, y2_mm=0)],
            ),
        )
        session.commit()
        return view.room.id, wand
    finally:
        session.close()


def _raumversion(factory: sessionmaker[Session], welt: Welt, room_id: uuid.UUID) -> int:  # noqa: F811
    session = factory()
    try:
        return ElectricalRoomService(session, welt.organization_id).get_room(room_id).room.version
    finally:
        session.close()


def _zustand(factory: sessionmaker[Session], wand: uuid.UUID) -> tuple[list[str], int]:  # noqa: F811
    session = factory()
    try:
        links = [link.relation for link in session.execute(select(ElectricalWallLink)).scalars()]
        y1 = session.execute(select(ElectricalWall.y1_mm).where(ElectricalWall.id == wand))
        return links, int(y1.scalar_one())
    finally:
        session.close()


def test_kopplung_gegen_verschieben_der_partnerwand(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    room_b, wand_b = _nachbar(factory, welt)
    version_b = _raumversion(factory, welt, room_b)
    barriere = threading.Barrier(2, timeout=20)

    def arbeit(session: Session, name: str) -> str:
        barriere.wait()
        if name == "koppeln":
            WallLinkService(session, welt.organization_id).create(
                welt.floor_id,
                WallLinkCreate(wall_a_id=welt.wall_id, wall_b_id=wand_b, relation="separate"),
                actor_user_id=ACTOR,
            )
        else:
            ElectricalRoomService(session, welt.organization_id).replace_contour(
                room_b,
                RoomContourUpdate(
                    walls=[ContourWallIn(id=wand_b, x1_mm=5_000, y1_mm=500, x2_mm=0, y2_mm=500)]
                ),
                expected_version=version_b,
            )
        return name

    lauf = gleichzeitig(factory, arbeit, namen=("koppeln", "verschieben"))

    assert len(lauf.erfolge) == 1 and len(lauf.fehler) == 1, lauf.fehlerklassen
    links, y1 = _zustand(factory, wand_b)
    if lauf.erfolge == ["koppeln"]:
        # Die Kopplung zaehlte die Version von B weiter - der Entwurf war veraltet.
        assert lauf.fehlerklassen == [VersionConflictError]
        assert (links, y1) == (["separate"], 0)
    else:
        # Die Wand lag schon weg - keine Kopplung ohne gemeinsamen Abschnitt.
        assert lauf.fehlerklassen == [ValidationFailedError]
        assert (links, y1) == ([], 500)


def test_kopplung_gegen_entfernen_der_wand(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    room_b, wand_b = _nachbar(factory, welt)
    version_b = _raumversion(factory, welt, room_b)
    barriere = threading.Barrier(2, timeout=20)
    ersatz = uuid.uuid4()

    def arbeit(session: Session, name: str) -> str:
        barriere.wait()
        if name == "koppeln":
            WallLinkService(session, welt.organization_id).create(
                welt.floor_id,
                WallLinkCreate(wall_a_id=welt.wall_id, wall_b_id=wand_b, relation="shared"),
                actor_user_id=ACTOR,
            )
        else:
            # Der Entwurf ersetzt die Wand durch eine neue - ohne removed_wall_link_ids.
            ElectricalRoomService(session, welt.organization_id).replace_contour(
                room_b,
                RoomContourUpdate(
                    walls=[ContourWallIn(id=ersatz, x1_mm=5_000, y1_mm=0, x2_mm=0, y2_mm=0)]
                ),
                expected_version=version_b,
            )
        return name

    lauf = gleichzeitig(factory, arbeit, namen=("koppeln", "entfernen"))

    assert len(lauf.erfolge) == 1 and len(lauf.fehler) == 1, lauf.fehlerklassen
    session = factory()
    try:
        links = list(session.execute(select(ElectricalWallLink)).scalars())
        waende = {wand.id for wand in session.execute(select(ElectricalWall)).scalars()}
    finally:
        session.close()
    if lauf.erfolge == ["koppeln"]:
        assert lauf.fehlerklassen == [VersionConflictError]
        assert len(links) == 1 and wand_b in waende and ersatz not in waende
    else:
        # Die Wand ist weg - die Kopplung findet sie nicht mehr.
        assert lauf.fehlerklassen == [ValidationFailedError]
        assert links == [] and wand_b not in waende and ersatz in waende


def test_wechsel_auf_shared_gegen_geraet_in_der_nachbartuer(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    room_b, wand_b = _nachbar(factory, welt)
    session = factory()
    try:
        # Tuer an der Wand von A bei 1000..2010 -> auf B (gegenlaeufig) bei 2990..4000.
        ElectricalRoomService(session, welt.organization_id).create_opening(
            welt.wall_id,
            OpeningCreate(kind="door", offset_mm=1_000, width_mm=1_010, height_mm=2_010),
        )
        view, _ = WallLinkService(session, welt.organization_id).create(
            welt.floor_id,
            WallLinkCreate(wall_a_id=welt.wall_id, wall_b_id=wand_b, relation="separate"),
            actor_user_id=ACTOR,
        )
        link_id = view.link.id
        session.commit()
    finally:
        session.close()
    version_b = _raumversion(factory, welt, room_b)
    barriere = threading.Barrier(2, timeout=20)

    def arbeit(session: Session, name: str) -> str:
        barriere.wait()
        if name == "shared":
            WallLinkService(session, welt.organization_id).update(
                link_id, WallLinkUpdate(relation="shared"), expected_version=1
            )
        else:
            ElectricalRoomService(session, welt.organization_id).replace_contour(
                room_b,
                RoomContourUpdate(
                    walls=[ContourWallIn(id=wand_b, x1_mm=5_000, y1_mm=0, x2_mm=0, y2_mm=0)],
                    devices=[
                        ContourDeviceIn(
                            device_type_key="socket_single",
                            mounting_surface="wall_interior",
                            wall_id=wand_b,
                            center_offset_mm=3_500,
                            center_height_mm=1_000,
                        )
                    ],
                ),
                expected_version=version_b,
            )
        return name

    lauf = gleichzeitig(factory, arbeit, namen=("shared", "geraet"))

    assert len(lauf.erfolge) == 1 and len(lauf.fehler) == 1, lauf.fehlerklassen
    session = factory()
    try:
        relation = session.execute(select(ElectricalWallLink.relation)).scalar_one()
        geraete = list(session.execute(select(ElectricalDevice)).scalars())
    finally:
        session.close()
    # Nie beides zugleich: eine gemeinsame Bauwand und ein Geraet in ihrer Tuer.
    assert not (relation == "shared" and geraete)
    if lauf.erfolge == ["shared"]:
        assert lauf.fehlerklassen == [VersionConflictError]
    else:
        assert lauf.fehlerklassen == [ValidationFailedError]
        assert relation == "separate" and len(geraete) == 1
