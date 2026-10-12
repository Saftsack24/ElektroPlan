"""Echte Parallelitaet bei Verteilungen und Stromkreisen (Phase 6b.0, ADR 0026).

Zwei Threads, zwei Sessions, PostgreSQL. Geprueft wird der **Datenbankzustand**
am Ende:

* dasselbe Geraet gleichzeitig zwei Stromkreisen zuordnen: genau einer gewinnt,
  der andere erhaelt ``409 device-assigned-elsewhere`` - nie zwei Zuordnungen;
* zwei gleichnamige Verteilungen im selben Gebaeude: genau eine entsteht;
* Zuordnen gegen Entfernen des Geraets im Raumentwurf: nie eine Zuordnung zu
  einem entfernten Geraet, nie ein Fehler ``500``;
* Verteilung platzieren gegen Raum loeschen: entweder ist der Raum weg und die
  Platzierung abgelehnt, oder die Verteilung liegt im Raum und das Loeschen ist
  abgelehnt.

Abschluss und Archivierung gegen den Schreibweg ``stromkreis-anlegen`` laufen
in ``test_archive_concurrency.py`` und ``test_completed_concurrency.py``.

Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import threading
import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.errors import ConflictError, ValidationFailedError, VersionConflictError
from app.modules.electrical.distribution import DistributionService
from app.modules.electrical.models import (
    ElectricalCircuitDevice,
    ElectricalDevice,
    ElectricalDistributionBoard,
    ElectricalRoom,
)
from app.modules.electrical.schemas import (
    CircuitCreate,
    CircuitDevicesUpdate,
    ContourDeviceIn,
    ContourWallIn,
    DistributionBoardCreate,
    DistributionBoardUpdate,
    RoomContourUpdate,
)
from app.modules.electrical.service import ElectricalRoomService
from tests.conftest import requires_database
from tests.test_archive_concurrency import Welt, factory, welt  # noqa: F401 - Fixtures
from tests.test_concurrency import gleichzeitig

pytestmark = [requires_database, pytest.mark.database]

WAND = (0, 0, 5_000, 0)


def _geraete(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> tuple[uuid.UUID, uuid.UUID, int]:
    """Steckdose und Verteilungsgeraet an der Wand der Testwelt; liefert die Raumversion."""
    session = factory()
    try:
        steckdose, verteilung = uuid.uuid4(), uuid.uuid4()
        service = ElectricalRoomService(session, welt.organization_id)
        version = service.get_room(welt.room_id).room.version
        service.replace_contour(
            welt.room_id,
            RoomContourUpdate(
                walls=[_wand(welt)],
                devices=[
                    _steckdose(welt, steckdose),
                    ContourDeviceIn(
                        id=verteilung,
                        device_type_key="distribution_board",
                        mounting_surface="wall_interior",
                        wall_id=welt.wall_id,
                        center_offset_mm=1_000,
                        center_height_mm=1_400,
                    ),
                ],
            ),
            expected_version=version,
        )
        session.commit()
        return steckdose, verteilung, service.get_room(welt.room_id).room.version
    finally:
        session.close()


def _wand(welt: Welt) -> ContourWallIn:  # noqa: F811
    x1, y1, x2, y2 = WAND
    return ContourWallIn(id=welt.wall_id, x1_mm=x1, y1_mm=y1, x2_mm=x2, y2_mm=y2)


def _steckdose(welt: Welt, device_id: uuid.UUID) -> ContourDeviceIn:  # noqa: F811
    return ContourDeviceIn(
        id=device_id,
        device_type_key="socket_single",
        mounting_surface="wall_interior",
        wall_id=welt.wall_id,
        center_offset_mm=3_000,
        center_height_mm=300,
    )


def _zwei_stromkreise(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> tuple[uuid.UUID, uuid.UUID]:
    session = factory()
    try:
        service = DistributionService(session, welt.organization_id)
        uv1, _ = service.create_board(
            welt.building_id, DistributionBoardCreate(code="UV1", name="UV1")
        )
        hv, _ = service.create_board(
            welt.building_id, DistributionBoardCreate(code="HV", name="HV")
        )
        f1, _ = service.create_circuit(uv1.id, CircuitCreate(designation="F1", name="A"))
        f2, _ = service.create_circuit(hv.id, CircuitCreate(designation="F1", name="B"))
        session.commit()
        return f1.circuit.id, f2.circuit.id
    finally:
        session.close()


def _anzahl(factory: sessionmaker[Session], model: type[object]) -> int:  # noqa: F811
    session = factory()
    try:
        return int(session.execute(select(func.count()).select_from(model)).scalar_one())  # type: ignore[call-overload]
    finally:
        session.close()


def test_dasselbe_geraet_gleichzeitig_zwei_stromkreisen(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    steckdose, _, _ = _geraete(factory, welt)
    f1, f2 = _zwei_stromkreise(factory, welt)
    barriere = threading.Barrier(2, timeout=20)

    def arbeit(session: Session, name: str) -> str:
        barriere.wait()
        DistributionService(session, welt.organization_id).replace_devices(
            f1 if name == "f1" else f2,
            CircuitDevicesUpdate(device_ids=[steckdose]),
            expected_version=1,
        )
        return name

    lauf = gleichzeitig(factory, arbeit, namen=("f1", "f2"))

    assert len(lauf.erfolge) == 1, lauf.fehlerklassen
    assert lauf.fehlerklassen == [ConflictError]
    assert _anzahl(factory, ElectricalCircuitDevice) == 1


def test_zwei_gleichnamige_verteilungen(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    barriere = threading.Barrier(2, timeout=20)

    def arbeit(session: Session, name: str) -> str:
        barriere.wait()
        DistributionService(session, welt.organization_id).create_board(
            welt.building_id, DistributionBoardCreate(code="UV1", name=name)
        )
        return name

    lauf = gleichzeitig(factory, arbeit, namen=("eins", "zwei"))

    assert len(lauf.erfolge) == 1, lauf.fehlerklassen
    assert lauf.fehlerklassen == [ValidationFailedError]
    assert _anzahl(factory, ElectricalDistributionBoard) == 1


def test_zuordnen_gegen_geraet_entfernen(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    steckdose, verteilung, raumversion = _geraete(factory, welt)
    f1, _ = _zwei_stromkreise(factory, welt)
    barriere = threading.Barrier(2, timeout=20)

    def arbeit(session: Session, name: str) -> str:
        barriere.wait()
        if name == "zuordnen":
            DistributionService(session, welt.organization_id).replace_devices(
                f1, CircuitDevicesUpdate(device_ids=[steckdose]), expected_version=1
            )
        else:
            ElectricalRoomService(session, welt.organization_id).replace_contour(
                welt.room_id,
                RoomContourUpdate(
                    walls=[_wand(welt)],
                    devices=[
                        ContourDeviceIn(
                            id=verteilung,
                            device_type_key="distribution_board",
                            mounting_surface="wall_interior",
                            wall_id=welt.wall_id,
                            center_offset_mm=1_000,
                            center_height_mm=1_400,
                        )
                    ],
                    removed_device_ids=[steckdose],
                ),
                expected_version=raumversion,
            )
        return name

    lauf = gleichzeitig(factory, arbeit, namen=("zuordnen", "entfernen"))

    # Beide Reihenfolgen sind zulaessig; entscheidend ist der Endzustand.
    assert "entfernen" in lauf.erfolge, lauf.fehlerklassen
    assert all(klasse is ValidationFailedError for klasse in lauf.fehlerklassen)
    session = factory()
    try:
        geraete = set(session.execute(select(ElectricalDevice.id)).scalars())
        zuordnungen = set(session.execute(select(ElectricalCircuitDevice.device_id)).scalars())
    finally:
        session.close()
    assert steckdose not in geraete
    assert zuordnungen == set()


def test_verteilung_platzieren_gegen_raum_loeschen(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    _, verteilung, raumversion = _geraete(factory, welt)
    session = factory()
    try:
        board, _ = DistributionService(session, welt.organization_id).create_board(
            welt.building_id, DistributionBoardCreate(code="UV1", name="UV1")
        )
        session.commit()
        board_id = board.id
    finally:
        session.close()
    barriere = threading.Barrier(2, timeout=20)

    def arbeit(session: Session, name: str) -> str:
        barriere.wait()
        if name == "platzieren":
            DistributionService(session, welt.organization_id).update_board(
                board_id,
                DistributionBoardUpdate(placement_device_id=verteilung),
                expected_version=1,
            )
        else:
            ElectricalRoomService(session, welt.organization_id).delete_room(
                welt.room_id, expected_version=raumversion
            )
        return name

    lauf = gleichzeitig(factory, arbeit, namen=("platzieren", "loeschen"))

    assert len(lauf.erfolge) == 1 and len(lauf.fehler) == 1, lauf.fehlerklassen
    raeume = _anzahl(factory, ElectricalRoom)
    session = factory()
    try:
        lage = session.execute(
            select(ElectricalDistributionBoard.placement_device_id).where(
                ElectricalDistributionBoard.id == board_id
            )
        ).scalar_one()
    finally:
        session.close()
    if lauf.erfolge == ["platzieren"]:
        assert lauf.fehlerklassen == [ConflictError]
        assert (raeume, lage) == (1, verteilung)
    else:
        assert lauf.fehlerklassen in ([ValidationFailedError], [VersionConflictError])
        assert (raeume, lage) == (0, None)
