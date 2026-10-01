"""Projektloeschung gegen gleichzeitige Schreibvorgaenge (Phase 4d, ADR 0020).

Die Invariante:

    **Nichts, was nach der Leerheitspruefung entsteht, wird unbemerkt
    mitgeloescht - und nichts entsteht unter einem bereits geloeschten
    Projekt.**

Die Projektzeile ist die gemeinsame Sperrwurzel. Damit gibt es genau zwei
Ausgaenge je Paar:

1. Der Schreibvorgang committet zuerst. Die Loeschung wartet, sieht danach den
   neuen Inhalt bzw. Status und lehnt ab - auch fuer einen Administrator ohne
   ausdrueckliche Bestaetigung.
2. Die Loeschung committet zuerst. Der Schreibvorgang wartet und findet das
   Projekt danach nicht mehr (``404``).

Gepruefte Paare: Datei-Upload (Datenbankteil samt Fremdschluesselwartezeit),
Raum anlegen (Electrical) und Statuswechsel. Ausschliesslich synthetische
Daten. Benoetigt PostgreSQL.
"""

from __future__ import annotations

import io
import threading
import uuid
from dataclasses import dataclass
from typing import IO

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.auth.security import hash_password
from app.core.authorization.permissions import PROJECT_RECORD_DELETE, PROJECT_RECORD_PURGE
from app.core.customers.schemas import CustomerCreate
from app.core.customers.service import CustomerService
from app.core.files.models import FileRecord
from app.core.files.service import FileService
from app.core.files.storage import ObjectStorage, StoredObject
from app.core.organizations.models import Organization
from app.core.projects.deletion import ProjectDeletionService, registered_participants
from app.core.projects.models import PROJECT_STATUS_ACTIVE, Project
from app.core.projects.schemas import BuildingCreate, FloorCreate, ProjectCreate
from app.core.projects.service import ProjectService
from app.core.users.models import User
from app.errors import (
    DeletionConfirmationRequiredError,
    NotFoundError,
    ProjectNotDeletableError,
)
from app.main import build_registry
from app.modules.electrical.models import ElectricalRoom
from app.modules.electrical.schemas import RoomCreate
from app.modules.electrical.service import ElectricalRoomService
from tests.conftest import requires_database
from tests.test_concurrency import gleichzeitig

pytestmark = [requires_database, pytest.mark.database]

ACTOR = uuid.UUID("99999999-8888-7777-6666-555555555555")
#: Ein Administrator - bewusst mit allen Loeschrechten. Selbst er loescht
#: neu entstandene Inhalte nicht ohne ausdrueckliche Bestaetigung.
ADMIN_RECHTE = frozenset({PROJECT_RECORD_DELETE, PROJECT_RECORD_PURGE})


@dataclass(frozen=True, slots=True)
class Welt:
    organization_id: uuid.UUID
    project_id: uuid.UUID
    floor_id: uuid.UUID


class StorageAttrappe(ObjectStorage):
    """Nimmt Uploads an, ohne einen Server zu brauchen."""

    def __init__(self) -> None:
        pass

    def put_stream(
        self, key: str, stream: IO[bytes], content_type: str, size_bytes: int
    ) -> StoredObject:
        return StoredObject(storage_key=key, size_bytes=size_bytes, content_type=content_type)

    def delete(self, key: str) -> None:
        return None


@pytest.fixture
def factory(engine: Engine, clean_database: None) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture
def welt(factory: sessionmaker[Session]) -> Welt:
    """Ein **leeres** Projekt: ein Gebaeude, ein Geschoss, sonst nichts."""
    build_registry()
    session = factory()
    try:
        organization = Organization(name="Loeschtest GmbH", slug="loeschtest")
        session.add(organization)
        session.add(
            User(
                id=ACTOR,
                email="loeschen@test.example",
                password_hash=hash_password("test-passwort-1234"),
                full_name="Lena Loescher",
            )
        )
        session.flush()
        kunde = CustomerService(session, organization.id).create(
            CustomerCreate(name="Bauherr"), actor_user_id=ACTOR
        )
        projects = ProjectService(session, organization.id)
        projekt = projects.create(
            ProjectCreate(customer_id=kunde.id, name="Versehen"), actor_user_id=ACTOR
        )
        gebaeude = projects.create_building(
            projekt.id, BuildingCreate(name="Haus"), actor_user_id=ACTOR
        )
        geschoss = projects.create_floor(
            gebaeude.id, FloorCreate(name="EG", level=0), actor_user_id=ACTOR
        )
        session.commit()
        return Welt(organization.id, projekt.id, geschoss.id)
    finally:
        session.close()


# ------------------------------------------------------------------ Vorgaenge


def _loeschen(session: Session, welt: Welt, version: int | None = None) -> None:
    """Loescht mit der zuletzt committeten Version - **ohne** vorher zu sperren.

    Die einzige Sperre nimmt ``ProjectDeletionService.delete`` selbst; ohne sie
    fallen die Tests der ersten Richtung nachweislich um.
    """
    service = ProjectDeletionService(session, welt.organization_id, registered_participants())
    if version is None:
        version = service.projects.get(welt.project_id).version
    service.delete(
        welt.project_id,
        expected_version=version,
        permissions=ADMIN_RECHTE,
        confirm_project_number=None,
    )


def _upload(session: Session, welt: Welt) -> None:
    """Der vollstaendige Upload-Pfad ohne echten Storage."""
    projects = ProjectService(session, welt.organization_id)
    projects.require_writable_unlocked(welt.project_id)
    service = FileService(session, StorageAttrappe(), welt.organization_id)
    record = service.upload(
        filename="plan.pdf",
        content_type="application/pdf",
        stream=io.BytesIO(b"%PDF-1.4 synthetisch"),
        uploaded_by=ACTOR,
        project_id=welt.project_id,
    )
    assert record.id is not None
    projects.lock_writable(welt.project_id)
    projects.touch(welt.project_id, actor_user_id=ACTOR)


def _raum(session: Session, welt: Welt) -> None:
    ElectricalRoomService(session, welt.organization_id).create_room(
        welt.floor_id, RoomCreate(name="Kueche")
    )


def _aktivieren(session: Session, welt: Welt) -> None:
    projects = ProjectService(session, welt.organization_id)
    version = projects.lock_project(welt.project_id).version
    projects.change_status(
        welt.project_id, PROJECT_STATUS_ACTIVE, expected_version=version, actor_user_id=ACTOR
    )


def _abschliessen(session: Session, welt: Welt) -> None:
    _aktivieren(session, welt)
    projects = ProjectService(session, welt.organization_id)
    version = projects.lock_project(welt.project_id).version
    projects.change_status(
        welt.project_id, "completed", expected_version=version, actor_user_id=ACTOR
    )


def _bestand(factory: sessionmaker[Session], welt: Welt) -> dict[str, int]:
    session = factory()
    try:

        def zaehlen(stmt: object) -> int:
            return int(session.execute(stmt).scalar_one())  # type: ignore[call-overload]

        return {
            "projekt": zaehlen(select(func.count()).where(Project.id == welt.project_id)),
            "dateien": zaehlen(
                select(func.count()).where(FileRecord.project_id == welt.project_id)
            ),
            "raeume": zaehlen(select(func.count()).where(ElectricalRoom.floor_id == welt.floor_id)),
        }
    finally:
        session.close()


SCHREIBWEGE = (("datei-upload", _upload), ("raum-anlegen", _raum))


# ------------------------------------------- 1. Schreibvorgang gewinnt die Sperre


@pytest.mark.parametrize(("bezeichnung", "schreiben"), SCHREIBWEGE, ids=[n for n, _ in SCHREIBWEGE])
def test_inhalt_zuerst_dann_keine_stille_loeschung(
    factory: sessionmaker[Session], welt: Welt, bezeichnung: str, schreiben: object
) -> None:
    sperre_genommen = threading.Event()
    loeschung_durch = threading.Event()
    beobachtung: dict[str, bool] = {}

    def arbeiten(session: Session, name: str) -> str:
        if name == "loeschen":
            assert sperre_genommen.wait(timeout=20)
            _loeschen(session, welt)
            loeschung_durch.set()
        else:
            schreiben(session, welt)  # type: ignore[operator]
            sperre_genommen.set()
            beobachtung["loeschung_vorbei"] = loeschung_durch.wait(timeout=1.5)
        return name

    lauf = gleichzeitig(factory, arbeiten, namen=(bezeichnung, "loeschen"))

    assert beobachtung["loeschung_vorbei"] is False, "Die Loeschung wartete nicht auf die Sperre."
    assert lauf.erfolge == [bezeichnung]
    assert lauf.fehlerklassen == [DeletionConfirmationRequiredError], lauf.fehler
    bestand = _bestand(factory, welt)
    assert bestand["projekt"] == 1
    assert bestand["dateien" if bezeichnung == "datei-upload" else "raeume"] == 1


# -------------------------------------------- 2. Loeschung gewinnt die Sperre


@pytest.mark.parametrize(("bezeichnung", "schreiben"), SCHREIBWEGE, ids=[n for n, _ in SCHREIBWEGE])
def test_loeschung_zuerst_dann_404(
    factory: sessionmaker[Session], welt: Welt, bezeichnung: str, schreiben: object
) -> None:
    barriere = threading.Barrier(2, timeout=20)

    def arbeiten(session: Session, name: str) -> str:
        if name == "loeschen":
            _loeschen(session, welt)
            barriere.wait()
        else:
            barriere.wait()
            schreiben(session, welt)  # type: ignore[operator]
        return name

    lauf = gleichzeitig(factory, arbeiten, namen=(bezeichnung, "loeschen"))

    assert lauf.erfolge == ["loeschen"], (lauf.erfolge, lauf.fehler)
    assert lauf.fehlerklassen == [NotFoundError], lauf.fehler
    assert _bestand(factory, welt) == {"projekt": 0, "dateien": 0, "raeume": 0}


# --------------------------------------------------- 3. gegen Statuswechsel


def test_abschluss_zuerst_dann_nicht_loeschbar(factory: sessionmaker[Session], welt: Welt) -> None:
    barriere = threading.Barrier(2, timeout=20)

    def arbeiten(session: Session, name: str) -> str:
        if name == "status":
            _abschliessen(session, welt)
            barriere.wait()
        else:
            barriere.wait()
            # Version nach Aktivieren und Abschliessen - so prueft der Test den
            # Status und nicht ``If-Match``.
            _loeschen(session, welt, version=3)
        return name

    lauf = gleichzeitig(factory, arbeiten, namen=("status", "loeschen"))

    assert lauf.erfolge == ["status"]
    assert lauf.fehlerklassen == [ProjectNotDeletableError], lauf.fehler
    assert _bestand(factory, welt)["projekt"] == 1


def test_loeschung_zuerst_dann_statuswechsel_404(
    factory: sessionmaker[Session], welt: Welt
) -> None:
    barriere = threading.Barrier(2, timeout=20)

    def arbeiten(session: Session, name: str) -> str:
        if name == "loeschen":
            _loeschen(session, welt)
            barriere.wait()
        else:
            barriere.wait()
            _aktivieren(session, welt)
        return name

    lauf = gleichzeitig(factory, arbeiten, namen=("status", "loeschen"))

    assert lauf.erfolge == ["loeschen"]
    assert lauf.fehlerklassen == [NotFoundError], lauf.fehler
    assert _bestand(factory, welt)["projekt"] == 0


def test_loeschung_sperrt_die_projektzeile_zuerst(
    factory: sessionmaker[Session], welt: Welt, engine: Engine
) -> None:
    from typing import Any

    from sqlalchemy import event

    anweisungen: list[str] = []

    def mitschreiben(
        conn: Any, cursor: Any, statement: str, parameters: Any, context: Any, executemany: bool
    ) -> None:
        anweisungen.append(" ".join(statement.split()))

    event.listen(engine, "before_cursor_execute", mitschreiben)
    session = factory()
    try:
        ProjectDeletionService(session, welt.organization_id, registered_participants()).delete(
            welt.project_id,
            expected_version=1,
            permissions=ADMIN_RECHTE,
            confirm_project_number=None,
        )
        session.rollback()
    finally:
        session.close()
        event.remove(engine, "before_cursor_execute", mitschreiben)

    erste = next(sql for sql in anweisungen if sql.startswith("SELECT"))
    assert "FROM projects" in erste and erste.endswith("FOR UPDATE"), erste
