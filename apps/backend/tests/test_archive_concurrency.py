"""Archivierung gegen gleichzeitige Schreibvorgaenge (Phase 3.1).

Die verbindliche Invariante lautet:

    **Sobald ein Projekt archiviert ist, committet keine Aenderung an ihm oder
    an einer untergeordneten Ressource mehr.**

Sie gilt auch unter echter Parallelitaet. Das Projekt ist dafuer die gemeinsame
**Sperrwurzel**: Jeder schreibende Weg sperrt zuerst die Projektzeile
(``SELECT ... FOR UPDATE``), auch der Statuswechsel selbst. Damit bleiben genau
zwei serialisierbare Ausgaenge:

1. Die Fachaenderung committet zuerst, danach wird archiviert.
2. Die Archivierung committet zuerst, danach wird die Fachaenderung mit
   ``409 project-archived`` abgelehnt.

**Wie die Tests das deterministisch pruefen.** ``gleichzeitig`` haengt den
Rueckgabewert einer Seite erst **nach** ihrem Commit an ``erfolge`` an - die
Liste ist also die **Commit-Reihenfolge**. Beide Richtungen werden erzwungen,
indem die Barriere einmal nach der Fachaenderung und einmal nach der
Archivierung sitzt, jeweils **vor** dem Commit der wartenden Seite. Ohne die
Projektsperre kippt die Commit-Reihenfolge, und genau das faengt die Zusicherung
ab (siehe ``docs/task-history.md``, Task 0013).

Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import pytest
from sqlalchemy import Engine, event, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.auth.security import hash_password
from app.core.customers.schemas import CustomerCreate
from app.core.customers.service import CustomerService
from app.core.files.models import FileRecord
from app.core.organizations.models import Organization
from app.core.projects.models import PROJECT_STATUS_ARCHIVED, Project
from app.core.projects.schemas import (
    BuildingCreate,
    FloorCreate,
    ProjectCreate,
    ProjectUpdate,
)
from app.core.projects.service import ProjectService
from app.core.users.models import User
from app.errors import ProjectArchivedError
from app.modules.electrical.models import ElectricalOpening, ElectricalRoom
from app.modules.electrical.schemas import OpeningCreate, RoomCreate, WallCreate, WallUpdate
from app.modules.electrical.service import ElectricalRoomService
from tests.conftest import requires_database
from tests.test_concurrency import ACTOR, gleichzeitig

pytestmark = [requires_database, pytest.mark.database]


# ----------------------------------------------------------------- Testwelt


@dataclass(frozen=True, slots=True)
class Welt:
    """Ein vollstaendiges, beschreibbares Projekt mit Planungsdaten."""

    organization_id: uuid.UUID
    project_id: uuid.UUID
    building_id: uuid.UUID
    floor_id: uuid.UUID
    room_id: uuid.UUID
    wall_id: uuid.UUID


@pytest.fixture
def factory(engine: Engine, clean_database: None) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture
def welt(factory: sessionmaker[Session]) -> Welt:
    """Synthetische Testdaten: Betrieb, Kunde, Projekt, Struktur, Raum, Wand."""
    session = factory()
    try:
        organization = Organization(name="Elektro Archivtest GmbH", slug="elektro-archivtest")
        session.add(organization)
        session.add(
            User(
                id=ACTOR,
                email="archiv@test.example",
                password_hash=hash_password("test-passwort-1234"),
                full_name="Anna Archiv",
            )
        )
        session.flush()

        customer = CustomerService(session, organization.id).create(
            CustomerCreate(name="Bauherr Beispiel"), actor_user_id=ACTOR
        )
        projects = ProjectService(session, organization.id)
        project = projects.create(
            ProjectCreate(customer_id=customer.id, name="Neubau"), actor_user_id=ACTOR
        )
        building = projects.create_building(project.id, BuildingCreate(name="Haupthaus"))
        floor = projects.create_floor(building.id, FloorCreate(name="Erdgeschoss", level=0))

        electrical = ElectricalRoomService(session, organization.id)
        view, _ = electrical.create_room(floor.id, RoomCreate(name="Wohnzimmer"))
        detail, _ = electrical.create_wall(
            view.room.id, WallCreate(x1_mm=0, y1_mm=0, x2_mm=5_000, y2_mm=0)
        )
        session.commit()
        return Welt(
            organization_id=organization.id,
            project_id=project.id,
            building_id=building.id,
            floor_id=floor.id,
            room_id=view.room.id,
            wall_id=detail.wall.id,
        )
    finally:
        session.close()


# ------------------------------------------------- die gepruefen Schreibwege

#: Eine Fachaenderung: fuehrt einen Schreibvorgang aus, **ohne** zu committen.
Fachaenderung = Callable[[Session, Welt], None]


def raum_anlegen(session: Session, welt: Welt) -> None:
    ElectricalRoomService(session, welt.organization_id).create_room(
        welt.floor_id, RoomCreate(name="Kueche")
    )


def wand_aendern(session: Session, welt: Welt) -> None:
    ElectricalRoomService(session, welt.organization_id).update_wall(
        welt.wall_id, WallUpdate(thickness_mm=240), expected_version=1
    )


def oeffnung_anlegen(session: Session, welt: Welt) -> None:
    ElectricalRoomService(session, welt.organization_id).create_opening(
        welt.wall_id,
        OpeningCreate(kind="door", offset_mm=1_000, width_mm=1_010, height_mm=2_010),
    )


def gebaeude_anlegen(session: Session, welt: Welt) -> None:
    ProjectService(session, welt.organization_id).create_building(
        welt.project_id, BuildingCreate(name="Garage")
    )


def geschoss_anlegen(session: Session, welt: Welt) -> None:
    ProjectService(session, welt.organization_id).create_floor(
        welt.building_id, FloorCreate(name="Obergeschoss", level=1)
    )


def projekt_aendern(session: Session, welt: Welt) -> None:
    ProjectService(session, welt.organization_id).update(
        welt.project_id,
        ProjectUpdate(name="Neubau Sued"),
        expected_version=1,
        actor_user_id=ACTOR,
    )


def datei_zuordnen(session: Session, welt: Welt) -> None:
    """Der **Datenbankteil** des Datei-Uploads.

    Nachgestellt wird genau die Reihenfolge des Endpunkts: Die Zeile entsteht,
    das Objekt waere zu diesem Zeitpunkt schon im Storage - und **erst danach**
    sperrt die Vorbedingung die Projektzeile (``before_commit`` in
    ``FileService.finalize``). Die Uebertragung selbst ist hier bewusst nicht
    beteiligt: Sie liegt ausserhalb jeder Sperre, und genau das ist der Punkt.
    """
    session.add(
        FileRecord(
            organization_id=welt.organization_id,
            project_id=welt.project_id,
            storage_key=f"org/{welt.organization_id}/{uuid.uuid4()}.pdf",
            filename="grundriss.pdf",
            content_type="application/pdf",
            size_bytes=1024,
            sha256="0" * 64,
            created_by_user_id=ACTOR,
        )
    )
    session.flush()
    # Das macht ``FileService.finalize(..., before_commit=...)`` unmittelbar
    # vor dem Commit.
    ProjectService(session, welt.organization_id).lock_writable(welt.project_id)


SCHREIBWEGE: tuple[tuple[str, Fachaenderung], ...] = (
    ("raum-anlegen", raum_anlegen),
    ("wand-aendern", wand_aendern),
    ("oeffnung-anlegen", oeffnung_anlegen),
    ("gebaeude-anlegen", gebaeude_anlegen),
    ("geschoss-anlegen", geschoss_anlegen),
    ("projekt-aendern", projekt_aendern),
    ("datei-zuordnen", datei_zuordnen),
)


# ------------------------------------------------------------------ Helfer


def _archivieren(session: Session, welt: Welt) -> None:
    """Archiviert das Projekt mit der Version, die **nach** der Sperre gilt.

    Die Version wird bewusst erst hinter der Sperre gelesen. Sonst pruefte der
    Test zwei Dinge auf einmal: Ein Schreibweg, der die Projektzeile selbst
    aendert (``projekt-aendern``), zaehlt deren Version weiter, und die
    Archivierung scheiterte dann an ``If-Match`` statt am Archivstatus. Genau so
    verhaelt sich auch ein echter Client: nach einem Versionskonflikt neu laden
    und wiederholen. Geprueft werden soll hier der Archivschutz.
    """
    projects = ProjectService(session, welt.organization_id)
    aktuell = projects.lock_project(welt.project_id)
    projects.change_status(
        welt.project_id,
        PROJECT_STATUS_ARCHIVED,
        expected_version=aktuell.version,
        actor_user_id=ACTOR,
    )


def _ist_archiviert(factory: sessionmaker[Session], welt: Welt) -> bool:
    session = factory()
    try:
        status = session.execute(
            select(Project.status).where(Project.id == welt.project_id)
        ).scalar_one()
        return bool(status == PROJECT_STATUS_ARCHIVED)
    finally:
        session.close()


def _bestand(factory: sessionmaker[Session], welt: Welt) -> dict[str, int]:
    """Zaehlt alles, was eine Fachaenderung erzeugen koennte."""
    session = factory()
    try:

        def zaehlen(stmt: Any) -> int:
            return int(session.execute(stmt).scalar_one())

        return {
            "raeume": zaehlen(select(func.count()).where(ElectricalRoom.floor_id == welt.floor_id)),
            "oeffnungen": zaehlen(
                select(func.count()).where(ElectricalOpening.wall_id == welt.wall_id)
            ),
            "dateien": zaehlen(
                select(func.count()).where(FileRecord.project_id == welt.project_id)
            ),
        }
    finally:
        session.close()


# ------------------------------- 1. Fachaenderung gewinnt die Projektsperre


@pytest.mark.parametrize(("bezeichnung", "aendern"), SCHREIBWEGE, ids=[n for n, _ in SCHREIBWEGE])
def test_fachaenderung_zuerst_dann_archivierung(
    factory: sessionmaker[Session],
    welt: Welt,
    bezeichnung: str,
    aendern: Fachaenderung,
) -> None:
    """Wer die Projektsperre zuerst hat, darf vollstaendig committen.

    Die Fachaenderung fuehrt ihren Schreibvorgang aus und haelt damit die
    Projektsperre. Erst danach darf die Archivierung starten - sie laeuft in
    dieselbe Sperre und **blockiert in der Datenbank**, bis die Fachaenderung
    committet hat.

    Geprueft wird deshalb beides:

    * Die Archivierung **kann** nicht fertig werden, solange die Sperre gehalten
      wird. Die Wartezeit ist eine Obergrenze, keine Synchronisation: Mit Sperre
      laeuft sie zwangslaeufig ab, ohne Sperre ist die Archivierung in
      Millisekunden durch.
    * Die Commit-Reihenfolge ist Fachaenderung, dann Archivierung.

    **Ohne die Projektsperre fallen beide Behauptungen um** - die Archivierung
    zieht durch und committet vor der Fachaenderung, die damit unter einem
    bereits archivierten Projekt wirksam wuerde.
    """
    sperre_genommen = threading.Event()
    archivierung_durch = threading.Event()
    beobachtung: dict[str, bool] = {}

    def arbeiten(session: Session, name: str) -> str:
        if name == "archivierung":
            assert sperre_genommen.wait(timeout=20), "Die Fachaenderung kam nicht zustande."
            _archivieren(session, welt)
            archivierung_durch.set()
        else:
            aendern(session, welt)
            sperre_genommen.set()
            beobachtung["archivierung_vorbei"] = archivierung_durch.wait(timeout=1.5)
        return name

    lauf = gleichzeitig(factory, arbeiten, namen=(bezeichnung, "archivierung"))

    assert beobachtung["archivierung_vorbei"] is False, (
        "Die Archivierung ist durchgelaufen, obwohl die Fachaenderung die Projektsperre "
        "hielt - die gemeinsame Sperrwurzel greift nicht."
    )
    assert lauf.fehler == [], lauf.fehlerklassen
    assert lauf.erfolge == [bezeichnung, "archivierung"], (
        "Die Fachaenderung muss vor der Archivierung committen - sonst waere sie "
        f"nach einem archivierten Projekt wirksam geworden. Reihenfolge: {lauf.erfolge}"
    )
    assert _ist_archiviert(factory, welt)


# ------------------------------- 2. Archivierung gewinnt die Projektsperre


@pytest.mark.parametrize(("bezeichnung", "aendern"), SCHREIBWEGE, ids=[n for n, _ in SCHREIBWEGE])
def test_archivierung_zuerst_dann_409(
    factory: sessionmaker[Session],
    welt: Welt,
    bezeichnung: str,
    aendern: Fachaenderung,
) -> None:
    """Wer die Projektsperre verliert, sieht danach den neuen Status.

    Die Archivierung fuehrt ihren Statuswechsel aus - und haelt damit die
    Projektsperre - und gibt erst danach die Barriere frei. Die Fachaenderung
    laeuft in dieselbe Sperre, wartet, liest **nach** der Freigabe den neuen
    Status und wird mit ``409 project-archived`` abgelehnt.

    Das ist der Kern der Korrektur: Der Wartende darf den Status nicht aus
    seiner Identity Map beantworten. Die Sperre liest ihn mit
    ``populate_existing`` neu.
    """
    vorher = _bestand(factory, welt)
    barriere = threading.Barrier(2, timeout=20)

    def arbeiten(session: Session, name: str) -> str:
        if name == "archivierung":
            _archivieren(session, welt)
            barriere.wait()
        else:
            barriere.wait()
            aendern(session, welt)
        return name

    lauf = gleichzeitig(factory, arbeiten, namen=(bezeichnung, "archivierung"))

    assert lauf.erfolge == ["archivierung"], (
        f"Nur die Archivierung darf committen. Erfolge={lauf.erfolge}, Fehler={lauf.fehler}"
    )
    assert lauf.fehlerklassen == [ProjectArchivedError], lauf.fehler
    assert _ist_archiviert(factory, welt)
    assert _bestand(factory, welt) == vorher, (
        "Nach abgeschlossener Archivierung darf keine Aenderung mehr in der Datenbank stehen."
    )


# --------------------------------------------- 3. Sperrreihenfolge und Deadlocks


def test_electrical_sperrt_das_projekt_vor_dem_raum(
    factory: sessionmaker[Session], welt: Welt, engine: Engine
) -> None:
    """Die Reihenfolge ist Projekt -> Raum, nicht umgekehrt.

    Nachgewiesen am mitgeschriebenen SQL: Die erste ``FOR UPDATE``-Anweisung
    einer Konturaenderung trifft ``projects``, die zweite
    ``electrical_rooms``. Die umgekehrte Reihenfolge war die Luecke - und waere
    mit den uebrigen Wegen (Projekt -> Gebaeude/Geschoss) eine Deadlock-Quelle.
    """
    anweisungen: list[str] = []

    def mitschreiben(
        conn: Any, cursor: Any, statement: str, parameters: Any, context: Any, executemany: bool
    ) -> None:
        anweisungen.append(" ".join(statement.split()))

    event.listen(engine, "before_cursor_execute", mitschreiben)
    session = factory()
    try:
        ElectricalRoomService(session, welt.organization_id).update_wall(
            welt.wall_id, WallUpdate(thickness_mm=200), expected_version=1
        )
        session.commit()
    finally:
        session.close()
        event.remove(engine, "before_cursor_execute", mitschreiben)

    sperren = [sql for sql in anweisungen if sql.endswith("FOR UPDATE")]
    ziele = [
        "projects"
        if "FROM projects" in sql
        else "electrical_rooms"
        if "FROM electrical_rooms" in sql
        else "?"
        for sql in sperren
    ]
    assert ziele[:2] == ["projects", "electrical_rooms"], (ziele, sperren)


def test_gegenlaeufige_unterressourcen_erzeugen_keinen_deadlock(
    factory: sessionmaker[Session], welt: Welt
) -> None:
    """Zwei verschiedene Unterressourcen gleichzeitig - beide kommen durch.

    Ein Gebaeude (Core-Weg) und eine Wandaenderung (Fachmodulweg) sperren
    dieselbe Projektzeile zuerst und danach ihre eigenen Zeilen. Weil die
    Reihenfolge ueberall dieselbe ist, wartet der Zweite nur - er verklemmt
    sich nicht. Ein Deadlock waere hier ein ``DeadlockDetected`` und damit ein
    Fehler in ``lauf.fehler``.
    """
    barriere = threading.Barrier(2, timeout=20)

    def arbeiten(session: Session, name: str) -> str:
        barriere.wait()
        if name == "gebaeude":
            gebaeude_anlegen(session, welt)
        else:
            wand_aendern(session, welt)
        return name

    lauf = gleichzeitig(factory, arbeiten, namen=("gebaeude", "wand"))

    assert lauf.fehler == [], lauf.fehlerklassen
    assert sorted(lauf.erfolge) == ["gebaeude", "wand"]


def test_mehrere_gleichzeitige_archivierungen_bleiben_eindeutig(
    factory: sessionmaker[Session], welt: Welt
) -> None:
    """Zwei Archivierungen desselben Projekts: genau eine gewinnt.

    Die zweite sieht nach der Sperre entweder die veraltete Version (``409``
    Versionskonflikt) oder den Endzustand ``archived``, aus dem kein Wechsel
    fuehrt (``409`` Konflikt). Beides ist ein fachlicher Konflikt, kein ``500``.
    """
    barriere = threading.Barrier(2, timeout=20)

    def arbeiten(session: Session, name: str) -> str:
        barriere.wait()
        _archivieren(session, welt)
        return name

    lauf = gleichzeitig(factory, arbeiten)

    assert len(lauf.erfolge) == 1, (lauf.erfolge, lauf.fehler)
    assert len(lauf.fehler) == 1
    assert _ist_archiviert(factory, welt)


# --------------------------------------- 4. Annahme: unveraenderliche Kette


def test_zugehoerigkeit_ist_unveraenderlich() -> None:
    """Raum -> Geschoss -> Gebaeude -> Projekt kann nicht umgehaengt werden.

    Darauf beruht die Sperrreihenfolge: Erst wird die Kette ungesperrt
    aufgeloest, dann das Projekt gesperrt. Duerfte ein Raum das Geschoss
    wechseln, waere die Sperre womoeglich am falschen Projekt. Kein
    ``Update``-Schema kennt diese Felder, und es gibt keinen Endpunkt dafuer -
    dieser Test haelt die Annahme fest, statt sie vorauszusetzen.
    """
    from app.core.projects.schemas import BuildingUpdate, FloorUpdate
    from app.modules.electrical.schemas import OpeningUpdate, RoomUpdate

    assert "floor_id" not in RoomUpdate.model_fields
    assert "building_id" not in FloorUpdate.model_fields
    assert "project_id" not in BuildingUpdate.model_fields
    assert "room_id" not in WallUpdate.model_fields
    assert "wall_id" not in OpeningUpdate.model_fields
