"""Leitungen unter Parallelitaet und Schreibschutz (Phase 6b.3, ADR 0026, Entwurf §8.5).

Zwei Threads, zwei Sessions, PostgreSQL. Geprueft wird der **Datenbankzustand**:

* zwei Ersetzungen derselben Leitung mit derselben Version: genau eine gewinnt;
* Leitung anlegen gegen Entfernen ihres Endgeraets: nie eine Leitung zu einem
  entfernten Geraet;
* Leitung ersetzen gegen Wand verkuerzen: nie ein unbemerkt unterbrochener Weg -
  entweder lehnt die Kontur ab (``409 cables-would-break``) oder die Leitung
  (``422``);
* ``archived``/``completed``: jeder neue Schreibweg liefert ``409`` und aendert
  nichts.

Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.projects.models import (
    PROJECT_STATUS_ACTIVE,
    PROJECT_STATUS_ARCHIVED,
    PROJECT_STATUS_COMPLETED,
)
from app.core.projects.service import ProjectService
from app.errors import (
    ConflictError,
    ProjectArchivedError,
    ProjectCompletedError,
    ValidationFailedError,
    VersionConflictError,
)
from app.modules.electrical.board_placement import BoardPlacementService
from app.modules.electrical.cables import CableService
from app.modules.electrical.distribution import DistributionService
from app.modules.electrical.models import (
    ElectricalCable,
    ElectricalDevice,
    ElectricalWallPenetration,
)
from app.modules.electrical.schemas import (
    ApplyProposalIn,
    BoardPlacementUpdate,
    CableIn,
    CircuitCreate,
    CircuitDevicesUpdate,
    ContourDeviceIn,
    ContourWallIn,
    DistributionBoardCreate,
    PenetrationUpdate,
    RoomContourUpdate,
    RoomCreate,
    WallLinkCreate,
    WallWaypointIn,
)
from app.modules.electrical.service import ElectricalRoomService
from app.modules.electrical.wall_links import WallLinkService
from tests.conftest import requires_database
from tests.test_archive_concurrency import Welt, factory, welt  # noqa: F401 - Fixtures
from tests.test_concurrency import ACTOR, gleichzeitig

pytestmark = [requires_database, pytest.mark.database]

WAND = (0, 0, 5_000, 0)


@dataclass(frozen=True, slots=True)
class Leitungswelt:
    board_device: uuid.UUID
    socket: uuid.UUID
    socket_2: uuid.UUID
    circuit: uuid.UUID
    cable: uuid.UUID
    penetration: uuid.UUID
    room_version: int


def _wand(welt: Welt) -> ContourWallIn:  # noqa: F811
    x1, y1, x2, y2 = WAND
    return ContourWallIn(id=welt.wall_id, x1_mm=x1, y1_mm=y1, x2_mm=x2, y2_mm=y2)


def _geraet(
    welt: Welt,  # noqa: F811
    device_id: uuid.UUID,
    offset: int,
    hoehe: int,
    typ: str = "socket_single",
) -> ContourDeviceIn:
    return ContourDeviceIn(
        id=device_id,
        device_type_key=typ,
        mounting_surface="wall_interior",
        wall_id=welt.wall_id,
        center_offset_mm=offset,
        center_height_mm=hoehe,
    )


def _leitung(lw_board: uuid.UUID, ende: uuid.UUID, welt: Welt, bis: int = 3_000) -> CableIn:  # noqa: F811
    """Verteilung (1 000/1 400) -> Steckdose: senkrecht 800, waagerecht, senkrecht 1 900."""
    return CableIn(
        label="L1",
        start_device_id=lw_board,
        end_device_id=ende,
        waypoints=[
            WallWaypointIn(kind="wall", wall_id=welt.wall_id, offset_mm=1_000, height_mm=2_200),
            WallWaypointIn(kind="wall", wall_id=welt.wall_id, offset_mm=bis, height_mm=2_200),
        ],
    )


def _aufbau(factory: sessionmaker[Session], welt: Welt) -> Leitungswelt:  # noqa: F811
    """Geraete, Nachbarraum mit Kopplung und Durchfuehrung, Verteilung, Stromkreis, Leitung."""
    session = factory()
    try:
        socket, socket_2 = uuid.uuid4(), uuid.uuid4()
        rooms = ElectricalRoomService(session, welt.organization_id)
        version = rooms.get_room(welt.room_id).room.version
        rooms.replace_contour(
            welt.room_id,
            RoomContourUpdate(
                walls=[_wand(welt)],
                devices=[_geraet(welt, socket, 3_000, 300), _geraet(welt, socket_2, 4_000, 300)],
            ),
            expected_version=version,
        )
        nachbar, _ = rooms.create_room(
            welt.floor_id,
            RoomCreate(
                name="Flur",
                walls=[ContourWallIn(x1_mm=5_000, y1_mm=0, x2_mm=0, y2_mm=0)],
            ),
        )
        nachbarwand = rooms._ordered_walls(nachbar.room.id)[0].id
        link, _ = WallLinkService(session, welt.organization_id).create(
            welt.floor_id,
            WallLinkCreate(wall_a_id=welt.wall_id, wall_b_id=nachbarwand, relation="shared"),
            actor_user_id=ACTOR,
        )
        penetration = ElectricalWallPenetration(
            id=uuid.uuid4(),
            organization_id=welt.organization_id,
            wall_link_id=link.link.id,
            # Beide Waende decken 0..5 000 ab: 2 500 ab Anfang ist von beiden Seiten die Mitte.
            offset_mm=2_500,
            height_mm=1_000,
        )
        session.add(penetration)
        distribution = DistributionService(session, welt.organization_id)
        board, _ = distribution.create_board(
            welt.building_id, DistributionBoardCreate(code="UV1", name="UV1")
        )
        # Das Lagegeraet entsteht mit der Verteilung ueber den VP-Weg (Phase 6c).
        board_device = (
            BoardPlacementService(session, welt.organization_id)
            .place(
                board.id,
                BoardPlacementUpdate(
                    room_id=welt.room_id,
                    wall_id=welt.wall_id,
                    center_offset_mm=1_000,
                    center_height_mm=1_400,
                    expected_room_version=rooms.get_room(welt.room_id).room.version,
                ),
                expected_version=board.version,
            )
            .device.id
        )
        circuit, _ = distribution.create_circuit(
            board.id,
            CircuitCreate(
                designation="F1",
                name="Steckdosen",
                proposed_cable_type="NYM-J",
                proposed_conductor_count=3,
                proposed_cross_section_mm2="1.5",
            ),
        )
        distribution.replace_devices(
            circuit.circuit.id,
            CircuitDevicesUpdate(device_ids=[socket, socket_2]),
            expected_version=1,
        )
        view, _ = CableService(session, welt.organization_id).create(
            circuit.circuit.id, _leitung(board_device, socket, welt)
        )
        assert view.result.status.value == "confirmed", view.result.problems
        assert view.result.length_mm == 800 + 2_000 + 1_900
        session.commit()
        return Leitungswelt(
            board_device=board_device,
            socket=socket,
            socket_2=socket_2,
            circuit=circuit.circuit.id,
            cable=view.cable.id,
            penetration=penetration.id,
            room_version=rooms.get_room(welt.room_id).room.version,
        )
    finally:
        session.close()


def _anzahl(factory: sessionmaker[Session], model: type[object]) -> int:  # noqa: F811
    session = factory()
    try:
        return int(session.execute(select(func.count()).select_from(model)).scalar_one())
    finally:
        session.close()


def _leitungsversion(factory: sessionmaker[Session], cable_id: uuid.UUID) -> int:  # noqa: F811
    session = factory()
    try:
        return int(
            session.execute(
                select(ElectricalCable.version).where(ElectricalCable.id == cable_id)
            ).scalar_one()
        )
    finally:
        session.close()


# ------------------------------------------------------------------ Parallel


def test_zwei_parallele_leitungsersetzungen(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    lw = _aufbau(factory, welt)
    barriere = threading.Barrier(2, timeout=20)

    def arbeit(session: Session, name: str) -> str:
        barriere.wait()
        ende = 3_000 if name == "a" else 2_000
        CableService(session, welt.organization_id).replace(
            lw.cable, _leitung(lw.board_device, lw.socket, welt, bis=ende), expected_version=1
        )
        return name

    lauf = gleichzeitig(factory, arbeit, namen=("a", "b"))

    assert len(lauf.erfolge) == 1, lauf.fehlerklassen
    assert lauf.fehlerklassen == [VersionConflictError]
    assert _leitungsversion(factory, lw.cable) == 2


def test_leitung_anlegen_gegen_endgeraet_entfernen(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    lw = _aufbau(factory, welt)
    barriere = threading.Barrier(2, timeout=20)

    def arbeit(session: Session, name: str) -> str:
        barriere.wait()
        if name == "anlegen":
            CableService(session, welt.organization_id).create(
                lw.circuit, _leitung(lw.board_device, lw.socket_2, welt, bis=4_000)
            )
        else:
            ElectricalRoomService(session, welt.organization_id).replace_contour(
                welt.room_id,
                RoomContourUpdate(
                    walls=[_wand(welt)],
                    devices=[
                        _geraet(welt, lw.board_device, 1_000, 1_400, "distribution_board"),
                        _geraet(welt, lw.socket, 3_000, 300),
                    ],
                    removed_device_ids=[lw.socket_2],
                ),
                expected_version=lw.room_version,
            )
        return name

    lauf = gleichzeitig(factory, arbeit, namen=("anlegen", "entfernen"))

    assert len(lauf.erfolge) == 1 and len(lauf.fehler) == 1, lauf.fehlerklassen
    session = factory()
    try:
        geraete = set(session.execute(select(ElectricalDevice.id)).scalars())
        enden = set(session.execute(select(ElectricalCable.end_device_id)).scalars())
    finally:
        session.close()
    # Keine Leitung haengt an einem entfernten Geraet.
    assert enden <= geraete
    if lauf.erfolge == ["anlegen"]:
        assert lauf.fehlerklassen == [ConflictError]
        assert lw.socket_2 in enden
    else:
        assert lauf.fehlerklassen == [ValidationFailedError]
        assert lw.socket_2 not in geraete


def test_leitung_ersetzen_gegen_wand_verkuerzen(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    """Die Wand wird 2 600 mm lang; der Weg bis 3 000 laege ausserhalb - nie unbemerkt."""
    lw = _aufbau(factory, welt)
    # Die Steckdose bei 3 000 waere ebenfalls ausserhalb - sie wird mit verschoben.
    barriere = threading.Barrier(2, timeout=20)

    def arbeit(session: Session, name: str) -> str:
        barriere.wait()
        if name == "leitung":
            CableService(session, welt.organization_id).replace(
                lw.cable, _leitung(lw.board_device, lw.socket, welt, bis=3_000), expected_version=1
            )
        else:
            ElectricalRoomService(session, welt.organization_id).replace_contour(
                welt.room_id,
                RoomContourUpdate(
                    walls=[ContourWallIn(id=welt.wall_id, x1_mm=0, y1_mm=0, x2_mm=2_600, y2_mm=0)],
                    devices=[
                        _geraet(welt, lw.board_device, 1_000, 1_400, "distribution_board"),
                        _geraet(welt, lw.socket, 2_000, 300),
                        _geraet(welt, lw.socket_2, 2_400, 300),
                    ],
                ),
                expected_version=lw.room_version,
            )
        return name

    lauf = gleichzeitig(factory, arbeit, namen=("leitung", "kontur"))

    # Die Kontur unterbricht die Leitung (Wegpunkt bei 3 000) und wird ohne Bestaetigung
    # abgelehnt - in beiden Reihenfolgen. Die Durchfuehrung bei 2 500 bliebe gueltig.
    assert lauf.erfolge == ["leitung"], lauf.fehlerklassen
    assert lauf.fehlerklassen == [ConflictError]
    session = factory()
    try:
        wand_bleibt = session.execute(
            select(func.count())
            .select_from(ElectricalDevice)
            .where(ElectricalDevice.center_offset_mm == 3_000)
        ).scalar_one()
    finally:
        session.close()
    assert wand_bleibt == 1


# ------------------------------------------------------------------ Schreibschutz


def _status(factory: sessionmaker[Session], welt: Welt, status: str) -> None:  # noqa: F811
    session = factory()
    try:
        projects = ProjectService(session, welt.organization_id)
        # Abgeschlossen wird nur ein aktives Projekt (Statusregeln des Core).
        schritte = (
            (PROJECT_STATUS_ACTIVE, status) if status == PROJECT_STATUS_COMPLETED else (status,)
        )
        for schritt in schritte:
            aktuell = projects.lock_project(welt.project_id)
            projects.change_status(
                welt.project_id, schritt, expected_version=aktuell.version, actor_user_id=ACTOR
            )
        session.commit()
    finally:
        session.close()


SCHREIBWEGE = (
    "leitung-anlegen",
    "leitung-ersetzen",
    "leitung-entfernen",
    "vorschlag-uebernehmen",
    "durchfuehrung-aendern",
    "durchfuehrung-entfernen",
)


def _schreiben(session: Session, welt: Welt, lw: Leitungswelt, weg: str) -> None:  # noqa: F811
    service = CableService(session, welt.organization_id)
    if weg == "leitung-anlegen":
        service.create(lw.circuit, _leitung(lw.board_device, lw.socket_2, welt, bis=4_000))
    elif weg == "leitung-ersetzen":
        service.replace(
            lw.cable, _leitung(lw.board_device, lw.socket, welt, bis=2_000), expected_version=1
        )
    elif weg == "leitung-entfernen":
        service.delete(lw.cable, expected_version=1)
    elif weg == "vorschlag-uebernehmen":
        # Stromkreisversion 2: angelegt (1), Zuordnung ersetzt (2).
        service.apply_proposal(
            lw.cable, ApplyProposalIn(expected_circuit_version=2), expected_version=1
        )
    elif weg == "durchfuehrung-aendern":
        service.update_penetration(
            lw.penetration, PenetrationUpdate(height_mm=900), expected_version=1
        )
    else:
        service.delete_penetration(lw.penetration, expected_version=1)


@pytest.mark.parametrize(
    ("status", "fehler"),
    [
        (PROJECT_STATUS_ARCHIVED, ProjectArchivedError),
        (PROJECT_STATUS_COMPLETED, ProjectCompletedError),
    ],
    ids=["archived", "completed"],
)
@pytest.mark.parametrize("weg", SCHREIBWEGE)
def test_schreibgeschuetztes_projekt_sperrt_jeden_leitungsweg(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
    status: str,
    fehler: type[ConflictError],
    weg: str,
) -> None:
    lw = _aufbau(factory, welt)
    _status(factory, welt, status)
    session = factory()
    try:
        with pytest.raises(fehler):
            _schreiben(session, welt, lw, weg)
        session.rollback()
    finally:
        session.close()
    assert _anzahl(factory, ElectricalCable) == 1
    assert _anzahl(factory, ElectricalWallPenetration) == 1
    assert _leitungsversion(factory, lw.cable) == 1


@pytest.mark.parametrize("weg", SCHREIBWEGE)
def test_leitungsweg_zuerst_dann_archivierung(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
    weg: str,
) -> None:
    """Wer die Projektsperre zuerst hat, committet vollstaendig; die Archivierung wartet."""
    lw = _aufbau(factory, welt)
    barriere = threading.Barrier(2, timeout=20)

    def arbeit(session: Session, name: str) -> str:
        if name == "schreiben":
            _schreiben(session, welt, lw, weg)
            barriere.wait()
        else:
            barriere.wait()
            projects = ProjectService(session, welt.organization_id)
            aktuell = projects.lock_project(welt.project_id)
            projects.change_status(
                welt.project_id,
                PROJECT_STATUS_ARCHIVED,
                expected_version=aktuell.version,
                actor_user_id=ACTOR,
            )
        return name

    lauf = gleichzeitig(factory, arbeit, namen=("schreiben", "archivieren"))

    assert sorted(lauf.erfolge) == ["archivieren", "schreiben"], lauf.fehlerklassen
