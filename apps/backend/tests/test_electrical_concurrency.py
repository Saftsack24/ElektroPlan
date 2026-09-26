"""Echte Parallelitaet am Raummodell (Phase 3).

Die Geometriepruefung liest den Stand der Kontur und entscheidet daraufhin.
Zwei gleichzeitige Anfragen koennten deshalb jede fuer sich gueltig sein und
gemeinsam eine ungueltige Kontur erzeugen - genau das verhindert die
Zeilensperre auf dem Raum.

Aufbau wie in ``tests/test_concurrency.py``: **zwei Threads, zwei Sessions,
eine Barriere**. Kein Zufall, keine Wartezeit. Jeder Test prueft am Ende den
**Datenbankzustand**, nicht nur den Rueckgabewert.

Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import threading
import uuid

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.auth.security import hash_password
from app.core.customers.schemas import CustomerCreate
from app.core.customers.service import CustomerService
from app.core.organizations.models import Organization
from app.core.projects.schemas import BuildingCreate, FloorCreate, ProjectCreate
from app.core.projects.service import ProjectService
from app.core.users.models import User
from app.errors import ValidationFailedError, VersionConflictError
from app.modules.electrical.models import ElectricalWall
from app.modules.electrical.schemas import RoomCreate, RoomUpdate, WallCreate
from app.modules.electrical.service import ElectricalRoomService
from tests.conftest import requires_database
from tests.test_concurrency import ACTOR, gleichzeitig

pytestmark = [requires_database, pytest.mark.database]


@pytest.fixture
def factory(engine: Engine, clean_database: None) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture
def geschoss(factory: sessionmaker[Session]) -> tuple[uuid.UUID, uuid.UUID]:
    """Organisation und Geschoss - synthetische Testdaten."""
    session = factory()
    try:
        organization = Organization(name="Elektro Gleichzeitig GmbH", slug="elektro-gleichzeitig")
        session.add(organization)
        session.add(
            User(
                id=ACTOR,
                email="gleichzeitig@test.example",
                password_hash=hash_password("test-passwort-1234"),
                full_name="Gerd Gleichzeitig",
            )
        )
        session.flush()

        customers = CustomerService(session, organization.id)
        customer = customers.create(CustomerCreate(name="Bauherr Beispiel"), actor_user_id=ACTOR)
        projects = ProjectService(session, organization.id)
        project = projects.create(
            ProjectCreate(customer_id=customer.id, name="Neubau"), actor_user_id=ACTOR
        )
        building = projects.create_building(project.id, BuildingCreate(name="Haupthaus"))
        floor = projects.create_floor(building.id, FloorCreate(name="Erdgeschoss", level=0))
        session.commit()
        return organization.id, floor.id
    finally:
        session.close()


def _raum_anlegen(
    factory: sessionmaker[Session], organization_id: uuid.UUID, floor_id: uuid.UUID
) -> uuid.UUID:
    session = factory()
    try:
        service = ElectricalRoomService(session, organization_id)
        view, _ = service.create_room(floor_id, RoomCreate(name="Wohnzimmer"))
        session.commit()
        return view.room.id
    finally:
        session.close()


def _waende_in_der_datenbank(
    factory: sessionmaker[Session], room_id: uuid.UUID
) -> list[ElectricalWall]:
    session = factory()
    try:
        return list(
            session.execute(
                select(ElectricalWall)
                .where(ElectricalWall.room_id == room_id)
                .order_by(ElectricalWall.sort_order)
            )
            .scalars()
            .all()
        )
    finally:
        session.close()


# ------------------------------------------- 1. Zwei Waende gleichzeitig


def test_zwei_gleichzeitige_waende_erhalten_verschiedene_positionen(
    factory: sessionmaker[Session], geschoss: tuple[uuid.UUID, uuid.UUID]
) -> None:
    """Beide Waende sind fachlich in Ordnung - beide muessen entstehen.

    Ohne die Raumsperre wuerden beide dieselbe ``sort_order`` berechnen: Jede
    Seite sieht eine leere Kontur. Die aufgeschobene Unique-Constraint wuerde
    das erst beim Commit melden - also erst, nachdem die Pruefung schon gegen
    einen veralteten Stand gelaufen ist.
    """
    organization_id, floor_id = geschoss
    room_id = _raum_anlegen(factory, organization_id, floor_id)
    barriere = threading.Barrier(2, timeout=15)
    entwuerfe = {
        "A": WallCreate(x1_mm=0, y1_mm=0, x2_mm=5_000, y2_mm=0),
        "B": WallCreate(x1_mm=5_000, y1_mm=0, x2_mm=5_000, y2_mm=4_000),
    }

    def anlegen(session: Session, name: str) -> str:
        service = ElectricalRoomService(session, organization_id)
        # Beide Seiten sind bereit, bevor eine die Sperre nimmt.
        barriere.wait()
        detail, _ = service.create_wall(room_id, entwuerfe[name])
        return f"{name}:{detail.wall.sort_order}"

    lauf = gleichzeitig(factory, anlegen)

    assert lauf.fehler == [], lauf.fehlerklassen
    waende = _waende_in_der_datenbank(factory, room_id)
    assert len(waende) == 2
    assert [wand.sort_order for wand in waende] == [0, 1]


# ----------------------------------- 2. Dieselbe Wand zweimal gleichzeitig


def test_gleichzeitige_doppelte_wand_wird_genau_einmal_angelegt(
    factory: sessionmaker[Session], geschoss: tuple[uuid.UUID, uuid.UUID]
) -> None:
    """Zwei Anfragen legen dieselbe Strecke an.

    Jede fuer sich waere gueltig - zusammen sind sie eine Dublette. Genau eine
    gewinnt, die andere erhaelt die uebliche Geometriemeldung (``422``) und
    keinen ``500``. Entscheidend ist der Datenbankzustand am Ende.
    """
    organization_id, floor_id = geschoss
    room_id = _raum_anlegen(factory, organization_id, floor_id)
    barriere = threading.Barrier(2, timeout=15)

    def anlegen(session: Session, name: str) -> str:
        service = ElectricalRoomService(session, organization_id)
        barriere.wait()
        service.create_wall(room_id, WallCreate(x1_mm=0, y1_mm=0, x2_mm=5_000, y2_mm=0))
        return name

    lauf = gleichzeitig(factory, anlegen)

    assert len(lauf.erfolge) == 1, lauf.fehlerklassen
    assert lauf.fehlerklassen == [ValidationFailedError]
    assert len(_waende_in_der_datenbank(factory, room_id)) == 1


# ------------------------- 3. Gleichzeitige Aenderung desselben Raums


def test_paralleles_raumupdate_liefert_genau_einen_versionskonflikt(
    factory: sessionmaker[Session], geschoss: tuple[uuid.UUID, uuid.UUID]
) -> None:
    """Beide lesen Version 1 und bestehen ``check_version``.

    Erwartet: ein Gewinner, ein ``VersionConflictError``, Version genau einmal
    weitergezaehlt - wie bei den Core-Entitaeten (Phase 2.1).
    """
    organization_id, floor_id = geschoss
    room_id = _raum_anlegen(factory, organization_id, floor_id)
    barriere = threading.Barrier(2, timeout=15)

    def aendern(session: Session, name: str) -> str:
        service = ElectricalRoomService(session, organization_id)
        # Beide laden den Datensatz vor der Barriere in ihre Session.
        service.get_room(room_id)
        barriere.wait()
        service.update_room(room_id, RoomUpdate(name=f"Raum {name}"), expected_version=1)
        return name

    lauf = gleichzeitig(factory, aendern)

    assert len(lauf.erfolge) == 1
    assert lauf.fehlerklassen == [VersionConflictError]
    session = factory()
    try:
        service = ElectricalRoomService(session, organization_id)
        assert service.get_room(room_id).room.version == 2
    finally:
        session.close()


# ------------------------------- 4. Gleichzeitige Oeffnung in einer Wand


def test_gleichzeitige_ueberlappende_oeffnungen_werden_verhindert(
    factory: sessionmaker[Session], geschoss: tuple[uuid.UUID, uuid.UUID]
) -> None:
    """Zwei Oeffnungen, die sich nur **gemeinsam** ueberschneiden.

    Jede Anfrage prueft gegen den Stand, den sie sieht. Ohne die Raumsperre
    saehen beide eine leere Wand - und die Wand haette am Ende zwei
    ueberlappende Tueren.
    """
    from app.modules.electrical.models import ElectricalOpening
    from app.modules.electrical.schemas import OpeningCreate

    organization_id, floor_id = geschoss
    room_id = _raum_anlegen(factory, organization_id, floor_id)
    session = factory()
    try:
        service = ElectricalRoomService(session, organization_id)
        detail, _ = service.create_wall(room_id, WallCreate(x1_mm=0, y1_mm=0, x2_mm=5_000, y2_mm=0))
        session.commit()
        wall_id = detail.wall.id
    finally:
        session.close()

    barriere = threading.Barrier(2, timeout=15)
    entwuerfe = {
        "A": OpeningCreate(kind="door", offset_mm=1_000, width_mm=1_010, height_mm=2_010),
        "B": OpeningCreate(kind="door", offset_mm=1_500, width_mm=1_010, height_mm=2_010),
    }

    def anlegen(session: Session, name: str) -> str:
        service = ElectricalRoomService(session, organization_id)
        barriere.wait()
        service.create_opening(wall_id, entwuerfe[name])
        return name

    lauf = gleichzeitig(factory, anlegen)

    assert len(lauf.erfolge) == 1, lauf.fehlerklassen
    assert lauf.fehlerklassen == [ValidationFailedError]
    session = factory()
    try:
        anzahl = session.execute(
            select(func.count()).where(ElectricalOpening.wall_id == wall_id)
        ).scalar_one()
        assert anzahl == 1
    finally:
        session.close()


# ------------------ 5. Raumhoehe gegen Oeffnung (Befund aus dem Selbstreview)


def test_gleichzeitige_hoehenaenderung_und_oeffnung_bleiben_konsistent(
    factory: sessionmaker[Session], geschoss: tuple[uuid.UUID, uuid.UUID]
) -> None:
    """Die Raumhoehe geht in die Pruefung jeder Oeffnung ein.

    Eine Anfrage senkt die Raumhoehe auf 2000 mm und sieht noch keine Oeffnung;
    die andere legt ein 1600 mm hohes Fenster mit 1100 mm Bruestung an und prueft
    gegen die alten 2800 mm. Jede waere fuer sich gueltig - zusammen ergaeben sie
    eine Oeffnung, die hoeher ist als der Raum.

    **Befund des Selbstreviews, ehrlich benannt:** Dieser Test besteht auch ohne
    die ausdrueckliche Sperre in :meth:`ElectricalRoomService.update_room`, weil
    das ``UPDATE`` der Raumzeile sie implizit haelt - die Sperre haengt dann aber
    an der **Reihenfolge der Anweisungen** im Service (erst schreiben, dann
    pruefen). Die ausdrueckliche ``SELECT ... FOR UPDATE`` macht die Zusage
    unabhaengig davon: Wer die Raumhoehe aendert, nimmt dieselbe Sperre wie jede
    Konturaenderung. Geprueft wird hier die **Invariante**, nicht die Sperre:
    Genau eine Seite gewinnt, und der Endzustand ist in sich stimmig.
    """
    from app.modules.electrical.models import ElectricalOpening
    from app.modules.electrical.schemas import OpeningCreate

    organization_id, floor_id = geschoss
    session = factory()
    try:
        service = ElectricalRoomService(session, organization_id)
        view, _ = service.create_room(floor_id, RoomCreate(name="Wohnzimmer", height_mm=2_800))
        detail, _ = service.create_wall(
            view.room.id, WallCreate(x1_mm=0, y1_mm=0, x2_mm=5_000, y2_mm=0)
        )
        session.commit()
        room_id, wall_id = view.room.id, detail.wall.id
    finally:
        session.close()

    barriere = threading.Barrier(2, timeout=15)

    def arbeiten(session: Session, name: str) -> str:
        service = ElectricalRoomService(session, organization_id)
        barriere.wait()
        if name == "A":
            service.update_room(room_id, RoomUpdate(height_mm=2_000), expected_version=1)
        else:
            service.create_opening(
                wall_id,
                OpeningCreate(
                    kind="window",
                    offset_mm=1_000,
                    width_mm=1_200,
                    height_mm=1_600,
                    sill_height_mm=1_100,
                ),
            )
        return name

    lauf = gleichzeitig(factory, arbeiten)

    # Genau eine Seite gewinnt; die andere scheitert an der Hoehenpruefung.
    assert len(lauf.erfolge) == 1, lauf.fehlerklassen
    assert lauf.fehlerklassen == [ValidationFailedError]

    # Der Endzustand ist in jedem Fall in sich stimmig.
    session = factory()
    try:
        service = ElectricalRoomService(session, organization_id)
        hoehe = service.get_room(room_id).effective_height_mm
        oeffnungen = (
            session.execute(select(ElectricalOpening).where(ElectricalOpening.wall_id == wall_id))
            .scalars()
            .all()
        )
        for oeffnung in oeffnungen:
            assert oeffnung.sill_height_mm + oeffnung.height_mm <= hoehe
    finally:
        session.close()


# --------------------------------- 6. Gleichzeitige Raumnummer im Geschoss


def test_gleichzeitige_gleiche_raumnummer_endet_in_422(
    factory: sessionmaker[Session], geschoss: tuple[uuid.UUID, uuid.UUID]
) -> None:
    """Der partielle eindeutige Index entscheidet, nicht die Vorpruefung.

    Zwei Anfragen legen unterschiedliche Raeume mit derselben Nummer an. Der
    Verlierer erhaelt dieselbe ``422``-Meldung wie im sequenziellen Fall.
    """
    from app.modules.electrical.models import ElectricalRoom

    organization_id, floor_id = geschoss
    barriere = threading.Barrier(2, timeout=15)

    def anlegen(session: Session, name: str) -> str:
        service = ElectricalRoomService(session, organization_id)
        barriere.wait()
        service.create_room(floor_id, RoomCreate(name=f"Raum {name}", room_number="1.01"))
        return name

    lauf = gleichzeitig(factory, anlegen)

    assert len(lauf.erfolge) == 1, lauf.fehlerklassen
    assert lauf.fehlerklassen == [ValidationFailedError]
    session = factory()
    try:
        anzahl = session.execute(
            select(func.count()).where(ElectricalRoom.floor_id == floor_id)
        ).scalar_one()
        assert anzahl == 1
    finally:
        session.close()
