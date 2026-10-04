"""Echte Parallelitaet bei Geraeten (Phase 5, ADR 0023).

Zwei Threads, zwei Sessions, PostgreSQL. Geprueft wird jeweils der
**Datenbankzustand** am Ende: Er darf nie eine Kombination enthalten, die jede
Seite einzeln abgelehnt haette.

* Geraet im Raum A gegen eine Tuer, die der Nachbarraum B an der
  deckungsgleichen Wand genau dort speichert (raumuebergreifende Pruefung).
* Wandgeraet gegen eine abgesenkte Geschoss-Standardhoehe.
* Zwei Speichervorgaenge desselben Raumentwurfs (Versionskonflikt).

Der Abschluss und die Archivierung gegen den Geraete-Speicherweg laufen in
``test_completed_concurrency.py`` und ``test_archive_concurrency.py``
(Schreibweg ``geraete-speichern``).

Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import threading
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.core.projects.floor_height import registered_height_participants
from app.core.projects.models import Floor
from app.core.projects.schemas import FloorUpdate
from app.core.projects.service import ProjectService
from app.errors import ValidationFailedError, VersionConflictError
from app.modules.electrical.models import ElectricalDevice, ElectricalOpening, ElectricalRoom
from app.modules.electrical.schemas import (
    ContourDeviceIn,
    ContourOpeningIn,
    ContourWallIn,
    RoomContourUpdate,
    RoomCreate,
)
from app.modules.electrical.service import ElectricalRoomService
from tests.conftest import requires_database
from tests.test_archive_concurrency import Welt, factory, welt  # noqa: F401 - Fixtures
from tests.test_concurrency import ACTOR, gleichzeitig

pytestmark = [requires_database, pytest.mark.database]

NACHBARWAND = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")


def _nachbar(factory: sessionmaker[Session], welt: Welt) -> uuid.UUID:  # noqa: F811
    """Raum B mit einer Wand auf derselben Geraden wie die Wand von A, gegenlaeufig."""
    session = factory()
    try:
        view, _ = ElectricalRoomService(session, welt.organization_id).create_room(
            welt.floor_id,
            RoomCreate(
                name="Flur",
                walls=[ContourWallIn(id=NACHBARWAND, x1_mm=5_000, y1_mm=0, x2_mm=0, y2_mm=0)],
            ),
        )
        session.commit()
        return view.room.id
    finally:
        session.close()


def _geraet_in_a(
    session: Session,
    welt: Welt,  # noqa: F811
    *,
    hoehe: int = 300,
    typ: str = "socket_single",
) -> None:
    service = ElectricalRoomService(session, welt.organization_id)
    version = service.get_room(welt.room_id).room.version
    service.replace_contour(
        welt.room_id,
        RoomContourUpdate(
            walls=[ContourWallIn(id=welt.wall_id, x1_mm=0, y1_mm=0, x2_mm=5_000, y2_mm=0)],
            devices=[
                ContourDeviceIn(
                    device_type_key=typ,
                    mounting_surface="wall_interior",
                    wall_id=welt.wall_id,
                    center_offset_mm=2_500,
                    center_height_mm=hoehe,
                )
            ],
        ),
        expected_version=version,
    )


def _tuer_in_b(session: Session, welt: Welt, room_b: uuid.UUID) -> None:  # noqa: F811
    """Tuer an B's Wand (5000,0)->(0,0) bei 2000..3010 ab Anfang = x 1990..3000."""
    service = ElectricalRoomService(session, welt.organization_id)
    version = service.get_room(room_b).room.version
    service.replace_contour(
        room_b,
        RoomContourUpdate(
            walls=[
                ContourWallIn(
                    id=NACHBARWAND,
                    x1_mm=5_000,
                    y1_mm=0,
                    x2_mm=0,
                    y2_mm=0,
                    openings=[
                        ContourOpeningIn(
                            kind="door", offset_mm=2_000, width_mm=1_010, height_mm=2_010
                        )
                    ],
                )
            ]
        ),
        expected_version=version,
    )


def _zaehlen(factory: sessionmaker[Session], welt: Welt) -> tuple[int, int]:  # noqa: F811
    session = factory()
    try:
        geraete = len(list(session.execute(select(ElectricalDevice.id)).scalars()))
        tueren = len(
            list(
                session.execute(
                    select(ElectricalOpening.id).where(ElectricalOpening.wall_id == NACHBARWAND)
                ).scalars()
            )
        )
        return geraete, tueren
    finally:
        session.close()


@pytest.mark.parametrize("zuerst", ["geraet", "tuer"])
def test_geraet_und_nachbartuer_gleichzeitig_an_derselben_stelle(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
    zuerst: str,
) -> None:
    """Einzeln zulaessig, zusammen nicht: Wer zuerst committet, gewinnt.

    Beide Seiten sperren dieselbe Projektzeile. Der Wartende sieht danach den
    Stand des anderen Raums und erhaelt ``422 device-in-opening``. Ohne die
    gemeinsame Sperre laege am Ende ein Geraet in der Tuer.
    """
    room_b = _nachbar(factory, welt)
    gesperrt = threading.Event()

    def ausfuehren(session: Session, name: str) -> None:
        if name == "geraet":
            _geraet_in_a(session, welt)
        else:
            _tuer_in_b(session, welt, room_b)

    def arbeiten(session: Session, name: str) -> str:
        if name == zuerst:
            ausfuehren(session, name)
            gesperrt.set()
            threading.Event().wait(0.5)  # Sperre halten, bis die andere Seite wartet.
        else:
            assert gesperrt.wait(timeout=20)
            ausfuehren(session, name)
        return name

    lauf = gleichzeitig(factory, arbeiten, namen=("geraet", "tuer"))

    assert lauf.erfolge == [zuerst], lauf.fehlerklassen
    assert len(lauf.fehler) == 1 and isinstance(lauf.fehler[0], ValidationFailedError)
    assert "device-in-opening" in {e.code for e in lauf.fehler[0].errors or []}
    assert _zaehlen(factory, welt) == ((1, 0) if zuerst == "geraet" else (0, 1))


@pytest.mark.parametrize("zuerst", ["geraet", "geschoss"])
def test_wandgeraet_und_abgesenkte_geschosshoehe_gleichzeitig(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
    zuerst: str,
) -> None:
    """Schalter mit Oberkante 2190 mm gegen Standardhoehe 2100 mm."""
    gesperrt = threading.Event()

    def ausfuehren(session: Session, name: str) -> None:
        if name == "geraet":
            _geraet_in_a(session, welt, hoehe=2_150, typ="switch_single")
        else:
            projects = ProjectService(session, welt.organization_id)
            version = session.execute(
                select(Floor.version).where(Floor.id == welt.floor_id)
            ).scalar_one()
            projects.update_floor(
                welt.floor_id,
                FloorUpdate(default_ceiling_height_mm=2_100),
                expected_version=version,
                actor_user_id=ACTOR,
                height_participants=registered_height_participants(),
            )

    def arbeiten(session: Session, name: str) -> str:
        if name == zuerst:
            ausfuehren(session, name)
            gesperrt.set()
            threading.Event().wait(0.5)
        else:
            assert gesperrt.wait(timeout=20)
            ausfuehren(session, name)
        return name

    lauf = gleichzeitig(factory, arbeiten, namen=("geraet", "geschoss"))

    assert lauf.erfolge == [zuerst], lauf.fehlerklassen
    assert len(lauf.fehler) == 1 and isinstance(lauf.fehler[0], ValidationFailedError)
    assert "device-exceeds-room-height" in {e.code for e in lauf.fehler[0].errors or []}
    session = factory()
    try:
        hoehe = session.execute(
            select(Floor.default_ceiling_height_mm).where(Floor.id == welt.floor_id)
        ).scalar_one()
        geraete = list(session.execute(select(ElectricalDevice)).scalars())
        raum = session.get(ElectricalRoom, welt.room_id)
        assert raum is not None and raum.height_mm is None
    finally:
        session.close()
    if zuerst == "geraet":
        assert (hoehe, len(geraete)) == (2_500, 1)
    else:
        assert (hoehe, len(geraete)) == (2_100, 0)


def test_zwei_entwuerfe_desselben_raums_erzeugen_einen_versionskonflikt(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    """Beide lesen dieselbe Raumversion; genau einer speichert, der andere erhaelt 409."""
    barriere = threading.Barrier(2, timeout=20)

    def arbeiten(session: Session, name: str) -> str:
        service = ElectricalRoomService(session, welt.organization_id)
        version = service.get_room(welt.room_id).room.version
        barriere.wait()
        service.replace_contour(
            welt.room_id,
            RoomContourUpdate(
                walls=[ContourWallIn(id=welt.wall_id, x1_mm=0, y1_mm=0, x2_mm=5_000, y2_mm=0)],
                devices=[
                    ContourDeviceIn(
                        device_type_key="socket_single",
                        mounting_surface="wall_interior",
                        wall_id=welt.wall_id,
                        center_offset_mm=1_000 if name == "A" else 4_000,
                        center_height_mm=300,
                    )
                ],
            ),
            expected_version=version,
        )
        return name

    lauf = gleichzeitig(factory, arbeiten)

    assert len(lauf.erfolge) == 1, lauf.fehlerklassen
    assert len(lauf.fehler) == 1 and isinstance(lauf.fehler[0], VersionConflictError)
    session = factory()
    try:
        geraete = list(session.execute(select(ElectricalDevice)).scalars())
        assert len(geraete) == 1
        assert geraete[0].center_offset_mm == (1_000 if lauf.erfolge == ["A"] else 4_000)
    finally:
        session.close()
