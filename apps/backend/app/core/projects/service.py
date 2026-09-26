"""Geschaeftslogik fuer Projekte, Gebaeude und Geschosse.

Der Statuswechsel eines Projekts ist an eine Uebergangstabelle gebunden
(``PROJECT_STATUS_TRANSITIONS``). Ein unzulaessiger Wechsel ist ein fachlicher
Konflikt (``409``), kein Validierungsfehler - er haengt vom aktuellen Zustand
ab, nicht von der Eingabe.
"""

from __future__ import annotations

import uuid
from typing import Literal

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.core.customers.models import Customer
from app.core.numbering.service import PROJECT_SEQUENCE, next_number
from app.core.pagination import (
    KeysetPage,
    apply_keyset,
    build_keyset_page,
    parse_datetime_key,
    parse_text_key,
)
from app.core.persistence import (
    flush,
    foreign_key_violation_translated,
    unique_violation_translated,
)
from app.core.preconditions import check_version
from app.core.projects.models import (
    PROJECT_STATUS_ARCHIVED,
    PROJECT_STATUS_TRANSITIONS,
    Building,
    Floor,
    Project,
)
from app.core.projects.schemas import (
    BuildingCreate,
    BuildingUpdate,
    FloorCreate,
    FloorUpdate,
    ProjectCreate,
    ProjectUpdate,
)
from app.core.tenancy.repository import TenantRepository
from app.db.mixins import utcnow
from app.errors import (
    ConflictError,
    NotFoundError,
    ProjectArchivedError,
    ValidationFailedError,
)

ProjectSort = Literal["created_at", "name"]

#: Name des eindeutigen Index aus Migration ``0003_core_business_data``.
#: Die Namenskonvention in ``app/db/base.py`` erzeugt ihn aus Tabelle und
#: Spalten; er ist damit stabil und nicht geraten.
FLOOR_LEVEL_CONSTRAINT = "uq_floors_building_id_level"


#: Meldungen, wenn ein Fachmodul auf die Struktur verweist. Bewusst
#: fachneutral: Der Core kennt keine Module (ADR 0001) und nennt deshalb weder
#: Raeume noch Leitungen, sondern nur den Umstand.
_IN_USE_FLOOR = (
    "Zu diesem Geschoss gibt es Planungsdaten. Bitte diese zuerst entfernen; "
    "danach laesst sich das Geschoss loeschen."
)
_IN_USE_BUILDING = (
    "Zu einem Geschoss dieses Gebaeudes gibt es Planungsdaten. Bitte diese zuerst "
    "entfernen; danach laesst sich das Gebaeude loeschen."
)


def _level_taken_detail(level: int) -> str:
    return f"In diesem Gebaeude gibt es bereits ein Geschoss auf Ebene {level}."


def _require_writable(project: Project) -> None:
    """Zentrale Vorbedingung fuer **jeden** schreibenden Zugriff.

    ``archived`` ist ein Endzustand und vollstaendig schreibgeschuetzt:
    Projektstammdaten, Gebaeude, Geschosse und Dateien sind unveraenderlich,
    neue Uploads werden abgelehnt. Lesen und das Herunterladen bestehender
    Dateien bleiben erlaubt (docs/api.md, Abschnitt "Projektstatus").

    **Eine Ausnahme, bewusst:** Das Ausblenden des Projekts (``deleted_at``)
    bleibt moeglich. Es ist kein inhaltlicher Eingriff, sondern ein
    Aufraeumschritt - und ohne ihn liessen sich Kunden mit archivierten
    Projekten nie mehr ausblenden, weil die Kundenloeschung offene Projekte
    zaehlt.

    Eine Wiederherstellung aus ``archived`` gibt es nicht; sie waere ein
    eigener administrativer Vorgang und braucht eine eigene Entscheidung.
    """
    if project.status == PROJECT_STATUS_ARCHIVED:
        raise ProjectArchivedError(
            f"Projekt {project.project_number} ist archiviert und damit schreibgeschuetzt. "
            "Lesen und das Herunterladen bestehender Dateien bleiben moeglich."
        )


class ProjectRepository(TenantRepository[Project]):
    model = Project


class BuildingRepository(TenantRepository[Building]):
    model = Building


class FloorRepository(TenantRepository[Floor]):
    model = Floor


class ProjectService:
    """Projekte samt ihrer Gebaeude- und Geschossstruktur."""

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self.session = session
        self.organization_id = organization_id
        self.projects = ProjectRepository(session, organization_id)
        self.buildings = BuildingRepository(session, organization_id)
        self.floors = FloorRepository(session, organization_id)

    # -------------------------------------------------------------- Projekte

    def get(self, project_id: uuid.UUID) -> Project:
        return self.projects.get_or_404(project_id)

    def list_projects(
        self,
        *,
        limit: int,
        cursor: str | None = None,
        search: str | None = None,
        status: str | None = None,
        customer_id: uuid.UUID | None = None,
        sort: ProjectSort = "created_at",
    ) -> KeysetPage[tuple[Project, str]]:
        """Seite von Projekten samt Kundenname.

        Der Kundenname wird mitgelesen statt je Zeile nachgeladen - sonst
        entstuende bei 50 Projekten ein N+1-Problem.
        """
        stmt: Select[tuple[Project, str]] = (
            select(Project, Customer.name)
            .join(
                Customer,
                (Customer.organization_id == Project.organization_id)
                & (Customer.id == Project.customer_id),
            )
            .where(
                Project.organization_id == self.organization_id,
                Project.deleted_at.is_(None),
            )
        )
        if status:
            stmt = stmt.where(Project.status == status)
        if customer_id is not None:
            stmt = stmt.where(Project.customer_id == customer_id)
        if search:
            pattern = f"%{search.strip()}%"
            stmt = stmt.where(
                or_(
                    Project.name.ilike(pattern),
                    Project.project_number.ilike(pattern),
                    func.coalesce(Project.site_city, "").ilike(pattern),
                    Customer.name.ilike(pattern),
                )
            )

        if sort == "name":
            stmt = apply_keyset(
                stmt,
                sort_column=Project.name,
                id_column=Project.id,
                descending=False,
                cursor=cursor,
                parse_key=parse_text_key,
            )
        else:
            stmt = apply_keyset(
                stmt,
                sort_column=Project.created_at,
                id_column=Project.id,
                descending=True,
                cursor=cursor,
                parse_key=parse_datetime_key,
            )

        rows: list[tuple[Project, str]] = [
            (project, customer_name)
            for project, customer_name in self.session.execute(stmt.limit(limit + 1)).all()
        ]
        return build_keyset_page(
            rows,
            limit=limit,
            key_of=lambda row: row[0].name if sort == "name" else row[0].created_at.isoformat(),
            id_of=lambda row: row[0].id,
        )

    def create(self, payload: ProjectCreate, *, actor_user_id: uuid.UUID) -> Project:
        self._lock_customer(payload.customer_id)
        project = Project(
            organization_id=self.organization_id,
            project_number=next_number(
                self.session,
                organization_id=self.organization_id,
                definition=PROJECT_SEQUENCE,
            ),
            created_by_user_id=actor_user_id,
            updated_by_user_id=actor_user_id,
            **payload.model_dump(),
        )
        self.projects.add(project)
        flush(self.session)
        return project

    def update(
        self,
        project_id: uuid.UUID,
        payload: ProjectUpdate,
        *,
        expected_version: int,
        actor_user_id: uuid.UUID,
    ) -> Project:
        # Reihenfolge: erst das Projekt sperren, dann - falls der Kunde
        # wechselt - die Kundenzeile. Nie umgekehrt (docs/database.md).
        project = self.lock_writable(project_id)
        check_version(project, expected_version)
        changes = payload.model_dump(exclude_unset=True)
        new_customer_id = changes.get("customer_id")
        if new_customer_id is not None:
            self._lock_customer(new_customer_id)
        for field, value in changes.items():
            setattr(project, field, value)
        project.updated_by_user_id = actor_user_id
        flush(self.session)
        return project

    def change_status(
        self,
        project_id: uuid.UUID,
        target_status: str,
        *,
        expected_version: int,
        actor_user_id: uuid.UUID,
    ) -> Project:
        """Fuehrt einen Statuswechsel aus, wenn er erlaubt ist.

        **Sperrt dieselbe Projektzeile** wie jeder fachliche Schreibvorgang.
        Die Archivierung ist damit kein Sonderweg: Sie reiht sich in dieselbe
        Warteschlange ein. Entweder committet die Fachaenderung zuerst und die
        Archivierung folgt, oder die Archivierung gewinnt und die Fachaenderung
        wird mit ``409 project-archived`` abgelehnt. Ein Dazwischen gibt es
        nicht.
        """
        project = self.lock_project(project_id)
        check_version(project, expected_version)
        allowed = PROJECT_STATUS_TRANSITIONS[project.status]
        if target_status not in allowed:
            readable = ", ".join(sorted(allowed)) or "keine"
            raise ConflictError(
                f"Wechsel von {project.status!r} nach {target_status!r} ist nicht vorgesehen. "
                f"Moeglich waeren: {readable}."
            )
        project.status = target_status
        project.updated_by_user_id = actor_user_id
        flush(self.session)
        return project

    def soft_delete(
        self, project_id: uuid.UUID, *, expected_version: int, actor_user_id: uuid.UUID
    ) -> Project:
        """Blendet das Projekt aus - auch ein archiviertes (bewusste Ausnahme).

        Sperrt trotzdem dieselbe Zeile: Die Sperrwurzel gilt fuer **jeden**
        Schreibvorgang am Projekt, damit die Reihenfolge ueberall dieselbe ist.
        """
        project = self.lock_project(project_id)
        check_version(project, expected_version)
        project.deleted_at = utcnow()
        project.updated_by_user_id = actor_user_id
        flush(self.session)
        return project

    # -------------------------------------------------------------- Gebaeude

    def list_buildings(self, project_id: uuid.UUID) -> list[Building]:
        self.projects.get_or_404(project_id)
        stmt = (
            self.buildings.query()
            .where(Building.project_id == project_id)
            .order_by(Building.sort_order.asc(), Building.name.asc())
        )
        return list(self.session.execute(stmt).scalars().all())

    def create_building(self, project_id: uuid.UUID, payload: BuildingCreate) -> Building:
        # Projekt zuerst sperren - danach entsteht die Unterressource.
        self.lock_writable(project_id)
        building = Building(
            organization_id=self.organization_id,
            project_id=project_id,
            **payload.model_dump(),
        )
        self.buildings.add(building)
        flush(self.session)
        return building

    def update_building(
        self, building_id: uuid.UUID, payload: BuildingUpdate, *, expected_version: int
    ) -> Building:
        building = self._writable_building(building_id)
        check_version(building, expected_version)
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(building, field, value)
        flush(self.session)
        return building

    def delete_building(self, building_id: uuid.UUID, *, expected_version: int) -> None:
        """Entfernt ein Gebaeude endgueltig - samt seiner Geschosse.

        Gebaeude und Geschosse sind Struktur, kein Geschaeftsdokument; sie
        werden deshalb hart geloescht (docs/database.md, Abschnitt 1). Sobald
        ein Fachmodul auf ein Geschoss verweist, verhindert der Fremdschluessel
        das Loeschen - der Verweis geht nicht verloren, und die Antwort ist ein
        fachlicher Konflikt (``409``), kein Serverfehler.
        """
        building = self._writable_building(building_id)
        check_version(building, expected_version)
        self.session.delete(building)
        self._flush_structure_delete(_IN_USE_BUILDING)

    # ------------------------------------------------------------- Geschosse

    def list_floors(self, building_id: uuid.UUID) -> list[Floor]:
        self.buildings.get_or_404(building_id)
        stmt = (
            self.floors.query().where(Floor.building_id == building_id).order_by(Floor.level.asc())
        )
        return list(self.session.execute(stmt).scalars().all())

    def create_floor(self, building_id: uuid.UUID, payload: FloorCreate) -> Floor:
        self._writable_building(building_id)
        self._require_free_level(building_id, payload.level, exclude_floor_id=None)
        floor = Floor(
            organization_id=self.organization_id,
            building_id=building_id,
            **payload.model_dump(),
        )
        self.floors.add(floor)
        self._flush_floor(payload.level)
        return floor

    def update_floor(
        self, floor_id: uuid.UUID, payload: FloorUpdate, *, expected_version: int
    ) -> Floor:
        floor = self._writable_floor(floor_id)
        check_version(floor, expected_version)
        changes = payload.model_dump(exclude_unset=True)
        new_level = changes.get("level")
        if new_level is not None and new_level != floor.level:
            self._require_free_level(floor.building_id, new_level, exclude_floor_id=floor.id)
        for field, value in changes.items():
            setattr(floor, field, value)
        self._flush_floor(floor.level)
        return floor

    def delete_floor(self, floor_id: uuid.UUID, *, expected_version: int) -> None:
        """Entfernt ein Geschoss endgueltig.

        Haengen Planungsdaten eines Fachmoduls daran, lehnt der
        Fremdschluessel das Loeschen ab. Das ist gewollt: Ein Geschoss
        verschwindet nicht unter der Planung weg.
        """
        floor = self._writable_floor(floor_id)
        check_version(floor, expected_version)
        self.session.delete(floor)
        self._flush_structure_delete(_IN_USE_FLOOR)

    # -------------------------------------------------- Schreibschutz

    def lock_project(self, project_id: uuid.UUID) -> Project:
        """Sperrt die Projektzeile und liefert ihren **aktuellen** Stand.

        Das Projekt ist die **gemeinsame Sperrwurzel** aller projektbezogenen
        Schreibvorgaenge (docs/architecture.md, Abschnitt 7). Ohne diese Sperre
        entsteht folgendes Rennen: Ein Schreibvorgang liest das Projekt als
        aktiv, eine andere Transaktion archiviert es und committet, und der
        erste committet danach unter dem bereits archivierten Projekt.

        **Der gesperrte Stand muss auch gelesen werden.** Liegt das Projekt schon
        in der Identity Map der Session - etwa weil zuvor die Geschosskette
        aufgeloest wurde -, darf nicht der alte ``status`` zurueckkommen.
        SQLAlchemy ueberschreibt geladene Attribute bei einer sperrenden Abfrage
        von sich aus; ``populate_existing`` schreibt diese Abhaengigkeit
        ausdruecklich hin, statt sie stillschweigend vorauszusetzen. Sie ist
        damit Absicherung gegen eine spaetere Umstellung, nicht die eigentliche
        Wirkung - die kommt von ``FOR UPDATE``. Belegt wird beides in
        ``tests/test_archive_concurrency.py``.

        Ein fremdes oder unbekanntes Projekt liefert ``404`` - wie ueberall,
        damit die Existenz fremder Daten nicht ableitbar ist.
        """
        project = self.session.execute(
            select(Project)
            .where(
                Project.organization_id == self.organization_id,
                Project.id == project_id,
                Project.deleted_at.is_(None),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if project is None:
            raise NotFoundError("Project wurde nicht gefunden.")
        return project

    def require_writable_unlocked(self, project_id: uuid.UUID) -> Project:
        """Prueft den Schreibschutz **ohne** Sperre - nur als fruehe Absage.

        Gedacht fuer den einen Fall, in dem eine Sperre zu lange gehalten
        wuerde: Der Datei-Upload soll eine unbekannte oder archivierte
        Projektzuordnung ablehnen, **bevor** Bytes in den Object Storage
        wandern. Diese Pruefung ist deshalb ausdruecklich **nicht** verbindlich;
        verbindlich ist :meth:`lock_writable` unmittelbar vor dem Commit
        (docs/architecture.md, Abschnitt 7).
        """
        project = self.projects.get_or_404(project_id)
        _require_writable(project)
        return project

    def lock_writable(self, project_id: uuid.UUID) -> Project:
        """Sperrt das Projekt und stellt sicher, dass es beschreibbar ist.

        **Die eine Stelle**, an der der Schreibschutz archivierter Projekte
        entschieden wird. Jeder schreibende Weg unterhalb eines Projekts laeuft
        hier durch - Projektstammdaten, Gebaeude, Geschosse, Dateien und die
        Planungsdaten der Fachmodule (ueber
        :mod:`app.core.projects.planning`).

        Weil die Zeile gesperrt **und** neu gelesen wird, gilt die Zusage auch
        unter echter Parallelitaet: Nach einer abgeschlossenen Archivierung
        kann keine Aenderung mehr committen. Wer die Sperre zuerst erhaelt,
        gewinnt; der Wartende sieht anschliessend den neuen Status und erhaelt
        ``409 project-archived``.
        """
        project = self.lock_project(project_id)
        _require_writable(project)
        return project

    def _writable_building(self, building_id: uuid.UUID) -> Building:
        """Gebaeude laden und das zugehoerige Projekt sperren.

        Reihenfolge: **erst das Projekt, dann die Unterressource.** Das Gebaeude
        wird ungesperrt aufgeloest - seine Projektzugehoerigkeit ist
        unveraenderlich (siehe :class:`~app.core.projects.schemas.BuildingUpdate`) -
        und erst danach gesperrt, naemlich durch das ``UPDATE`` bzw. ``DELETE``
        des Aufrufers.
        """
        building = self.buildings.get_or_404(building_id)
        self.lock_writable(building.project_id)
        return building

    def _writable_floor(self, floor_id: uuid.UUID) -> Floor:
        """Geschoss laden und ueber Gebaeude und Projekt sperren."""
        floor = self.floors.get_or_404(floor_id)
        self._writable_building(floor.building_id)
        return floor

    # ---------------------------------------------------------------- Helfer

    def _lock_customer(self, customer_id: uuid.UUID) -> Customer:
        """Prueft den Kunden fuer eine **neue** Zuordnung und sperrt ihn.

        Zulaessig ist nur ein Kunde, der

        * zur eigenen Organisation gehoert,
        * nicht ausgeblendet ist (``deleted_at IS NULL``) und
        * nicht anonymisiert ist (``anonymized_at IS NULL``).

        Ein anonymisierter Kunde bleibt fuer **bestehende** Projekte und
        Belege lesbar - er darf aber nicht fuer neue Geschaeftsvorgaenge
        reaktiviert werden (docs/security.md, Abschnitt 13).

        ``SELECT ... FOR UPDATE`` haelt die Zeile bis zum Commit. Ein
        gleichzeitiges Ausblenden oder Anonymisieren desselben Kunden sperrt
        dieselbe Zeile und wartet damit; die Reihenfolge ist auf beiden Seiten
        gleich (erst Kunde, dann Projekt) und deshalb deadlockfrei.

        Jeder unzulaessige Fall liefert ``404`` - auch der fremde Mandant.
        Andernfalls waere ableitbar, dass es den Kunden gibt.
        """
        customer = self.session.execute(
            select(Customer)
            .where(
                Customer.organization_id == self.organization_id,
                Customer.id == customer_id,
                Customer.deleted_at.is_(None),
                Customer.anonymized_at.is_(None),
            )
            .with_for_update()
        ).scalar_one_or_none()
        if customer is None:
            raise NotFoundError("Der angegebene Kunde wurde nicht gefunden.")
        return customer

    def _flush_structure_delete(self, detail: str) -> None:
        """Schreibt ein Loeschen und faengt einen verbleibenden Verweis ab."""
        with foreign_key_violation_translated(self.session, error=ConflictError(detail)):
            flush(self.session)

    def _flush_floor(self, level: int) -> None:
        """Schreibt ein Geschoss und faengt die Ebenen-Kollision ab.

        :meth:`_require_free_level` erkennt den Normalfall sequenzieller
        Aufrufe mit einer verstaendlichen Meldung. Zwei **gleichzeitige**
        Anfragen bestehen diese Vorpruefung aber beide; erst der eindeutige
        Index in der Datenbank verhindert das Duplikat. Der Verlierer erhaelt
        dieselbe Meldung wie im sequenziellen Fall (``422``) - und keinen
        ``500``.

        Uebersetzt wird ausschliesslich die **eine** erwartete Constraint.
        Jede andere Integritaetsverletzung bleibt ein unerwarteter Fehler.
        """
        with unique_violation_translated(
            self.session,
            constraint=FLOOR_LEVEL_CONSTRAINT,
            error=ValidationFailedError(_level_taken_detail(level)),
        ):
            flush(self.session)

    def _require_free_level(
        self, building_id: uuid.UUID, level: int, *, exclude_floor_id: uuid.UUID | None
    ) -> None:
        stmt = self.floors.query().where(Floor.building_id == building_id, Floor.level == level)
        if exclude_floor_id is not None:
            stmt = stmt.where(Floor.id != exclude_floor_id)
        if self.session.execute(stmt).scalars().first() is not None:
            raise ValidationFailedError(_level_taken_detail(level))


def count_projects_of_customer(
    session: Session, *, organization_id: uuid.UUID, customer_id: uuid.UUID
) -> int:
    """Wie viele nicht geloeschte Projekte haengen an diesem Kunden.

    Bewusst hier und nicht im Kundendienst: ``projects`` kennt ``customers``,
    nicht umgekehrt. Das Loeschen eines Kunden ruft diese Funktion auf, statt
    eine Rueckwaertsabhaengigkeit einzufuehren.
    """
    stmt = select(func.count()).where(
        Project.organization_id == organization_id,
        Project.customer_id == customer_id,
        Project.deleted_at.is_(None),
    )
    return int(session.execute(stmt).scalar_one())
