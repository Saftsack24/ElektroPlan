"""Endgueltiges Loeschen eines Projekts (Phase 4d, ADR 0020).

**Regeln.**

* Geloescht werden duerfen nur ``draft`` und ``active``. ``completed`` und
  ``archived`` liefern ``409 project-not-deletable``.
* **Leer** ist ein Projekt, wenn

  1. keine Dateizeile auf das Projekt verweist,
  2. es hoechstens **ein** Gebaeude mit hoechstens **einem** Geschoss hat
     (die leere Startstruktur der Projektanlage - Namen spielen keine Rolle),
  3. kein Teilnehmer des Loeschprotokolls Inhalte meldet.

* Ein leeres Projekt darf loeschen, wer ``project.record.delete`` **oder**
  ``project.record.purge`` hat; ein Projekt mit Inhalt nur, wer
  ``project.record.purge`` hat (Standard: nur der Administrator).
* Ein Projekt mit Inhalt wird nur geloescht, wenn die Anfrage den Verlust
  ausdruecklich bestaetigt (Projektnummer). Das schuetzt vor einer veralteten
  Vorpruefung, nicht vor Missbrauch - dafuer ist die Berechtigung da.

**Ablauf in einer Transaktion** (:meth:`ProjectDeletionService.delete`):
Projektzeile sperren (fremd: ``404``) → ``If-Match`` → Status → Inhalte ueber
Core und Teilnehmer → Berechtigung → Bestaetigung → Teilnehmer loeschen ihre
Daten → Nachkontrolle → Storage-Schluessel vormerken, Dateizeilen loeschen →
Projekt loeschen (Gebaeude und Geschosse per ``CASCADE``). Jeder Fehler rollt
alles zurueck. Die Storage-Objekte werden erst **nach** dem Commit entfernt
(:mod:`app.core.files.cleanup`).

Jeder Schreibweg, der Projektinhalte erzeugt, sperrt dieselbe Projektzeile
zuerst. Nach der Sperre kann also nichts mehr entstehen, was die Pruefung
nicht gesehen haette - und ein wartender Schreibvorgang findet das Projekt
danach nicht mehr (``404``).
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from functools import partial

from sqlalchemy import Select, delete, func, select
from sqlalchemy.orm import Session

from app.contracts.v1.project_lifecycle import (
    ProjectContentItem,
    ProjectContentParticipant,
    ProjectContentRequest,
)
from app.core.authorization.permissions import PROJECT_RECORD_DELETE, PROJECT_RECORD_PURGE
from app.core.files import cleanup
from app.core.files.models import FileRecord
from app.core.module_registry.registry import ModuleRegistry, get_module_registry
from app.core.persistence import flush, foreign_key_violation_translated
from app.core.preconditions import check_version
from app.core.projects.models import PROJECT_DELETABLE_STATUSES, Building, Project
from app.core.projects.service import ProjectService
from app.errors import (
    AppError,
    DeletionConfirmationRequiredError,
    PermissionDeniedError,
    ProjectDeletionFailedError,
    ProjectNotDeletableError,
)
from app.logging_config import get_logger

logger = get_logger(__name__)

#: Inhaltsarten, die der Core selbst erkennt.
CONTENT_FILES = "core.files"
CONTENT_STRUCTURE = "core.structure"

#: Leere Startstruktur: hoechstens so viele Gebaeude und Geschosse.
EMPTY_MAX_BUILDINGS = 1
EMPTY_MAX_FLOORS = 1

_FAILED_DETAIL = (
    "Das Projekt konnte nicht geloescht werden. Es wurde nichts veraendert. "
    "Bitte spaeter erneut versuchen oder die Administration informieren."
)

#: Ein Teilnehmer samt Modul-ID, in fester Reihenfolge.
Participant = tuple[str, ProjectContentParticipant]


def registered_participants(registry: ModuleRegistry | None = None) -> tuple[Participant, ...]:
    """Instanziiert alle registrierten Teilnehmer - nach Modul-ID sortiert."""
    source = registry or get_module_registry()
    return tuple(
        (module_id, implementation())
        for module_id, implementation in source.port_implementations(ProjectContentParticipant)
    )


@dataclass(frozen=True, slots=True)
class DeletionAssessment:
    """Was eine Loeschung bedeuten wuerde - und ob sie erlaubt waere."""

    project: Project
    items: tuple[ProjectContentItem, ...]
    status_allows: bool
    can_delete: bool
    blocked_code: str | None
    blocked_reason: str | None

    @property
    def is_empty(self) -> bool:
        return not self.items

    @property
    def requires_purge(self) -> bool:
        """Inhalte vorhanden: nur mit der Administratorberechtigung loeschbar."""
        return not self.is_empty


@dataclass(frozen=True, slots=True)
class DeletedProject:
    """Ergebnis einer Loeschung - fuer Audit und Storage-Aufraeumen."""

    project_id: uuid.UUID
    project_number: str
    items: tuple[ProjectContentItem, ...]
    storage_keys: tuple[str, ...]


class ProjectDeletionService:
    """Koordiniert Core und Teilnehmer bei der endgueltigen Projektloeschung."""

    def __init__(
        self,
        session: Session,
        organization_id: uuid.UUID,
        participants: Sequence[Participant],
    ) -> None:
        self.session = session
        self.organization_id = organization_id
        self.projects = ProjectService(session, organization_id)
        self.participants = tuple(participants)

    # ------------------------------------------------------------ Vorpruefung

    def assess(self, project_id: uuid.UUID, *, permissions: frozenset[str]) -> DeletionAssessment:
        """Vorpruefung **ohne** Sperre - Auskunft fuer die Oberflaeche.

        Keine Autorisierung und keine Garantie: :meth:`delete` prueft alles
        erneut unter der Projektsperre.
        """
        project = self.projects.get(project_id)
        return self._assessment(project, self._inspect(project), permissions)

    # --------------------------------------------------------------- Loeschen

    def delete(
        self,
        project_id: uuid.UUID,
        *,
        expected_version: int,
        permissions: frozenset[str],
        confirm_project_number: str | None,
    ) -> DeletedProject:
        """Loescht das Projekt endgueltig - ohne Commit (der Aufrufer committet)."""
        project = self.projects.lock_project(project_id)
        check_version(project, expected_version)
        if project.status not in PROJECT_DELETABLE_STATUSES:
            raise ProjectNotDeletableError(_status_reason(project))

        items = self._inspect(project)
        if not _allowed(items, permissions):
            raise PermissionDeniedError(_permission_reason(items))
        if items and (confirm_project_number or "").strip() != project.project_number:
            raise DeletionConfirmationRequiredError(
                f"Projekt {project.project_number} enthaelt Inhalte. Zum Loeschen muss die "
                "Projektnummer bestaetigt werden. Bitte die Loeschung erneut pruefen."
            )

        request = ProjectContentRequest(organization_id=self.organization_id, project_id=project.id)
        for module_id, participant in self.participants:
            self._call(
                module_id, partial(participant.delete_project_content, self.session, request)
            )
        # Nachkontrolle: Ein Teilnehmer, der nicht alles entfernt hat, bricht ab.
        for module_id, participant in self.participants:
            report = self._call(
                module_id, partial(participant.describe_project_content, self.session, request)
            )
            if report.has_content:
                logger.error("project_participant_left_content", module=module_id)
                raise ProjectDeletionFailedError(_FAILED_DETAIL)

        storage_keys = tuple(
            self.session.execute(
                select(FileRecord.storage_key)
                .where(
                    FileRecord.organization_id == self.organization_id,
                    FileRecord.project_id == project.id,
                )
                .order_by(FileRecord.storage_key)
            )
            .scalars()
            .all()
        )
        # Erst vormerken, dann loeschen - in derselben Transaktion.
        cleanup.enqueue(
            self.session,
            organization_id=self.organization_id,
            storage_keys=storage_keys,
            reason=cleanup.REASON_PROJECT_DELETED,
        )
        self.session.execute(
            delete(FileRecord).where(
                FileRecord.organization_id == self.organization_id,
                FileRecord.project_id == project.id,
            )
        )

        result = DeletedProject(
            project_id=project.id,
            project_number=project.project_number,
            items=items,
            storage_keys=storage_keys,
        )
        self.session.delete(project)
        # Verweist noch etwas per RESTRICT auf Projekt, Gebaeude oder Geschoss,
        # hat ein Teilnehmer seine Daten nicht entfernt: kontrolliert abbrechen.
        with foreign_key_violation_translated(
            self.session, error=ProjectDeletionFailedError(_FAILED_DETAIL)
        ):
            flush(self.session)
        return result

    # ----------------------------------------------------------------- Helfer

    def _inspect(self, project: Project) -> tuple[ProjectContentItem, ...]:
        """Alle Inhaltsarten - erst der Core, dann die Teilnehmer."""
        items: list[ProjectContentItem] = []
        file_count = self._count(
            select(func.count()).where(
                FileRecord.organization_id == self.organization_id,
                FileRecord.project_id == project.id,
            )
        )
        if file_count:
            items.append(ProjectContentItem(CONTENT_FILES, "Dateien", file_count))

        building_count = self._count(
            select(func.count()).where(
                Building.organization_id == self.organization_id,
                Building.project_id == project.id,
            )
        )
        floor_count = len(self.projects.floor_ids_of_project(project.id))
        if building_count > EMPTY_MAX_BUILDINGS or floor_count > EMPTY_MAX_FLOORS:
            items.append(
                ProjectContentItem(
                    CONTENT_STRUCTURE,
                    f"Gebäudestruktur ({building_count} Gebäude, {floor_count} Geschosse)",
                    building_count + floor_count,
                )
            )

        request = ProjectContentRequest(organization_id=self.organization_id, project_id=project.id)
        for module_id, participant in self.participants:
            report = self._call(
                module_id, partial(participant.describe_project_content, self.session, request)
            )
            if report.has_content:
                items.extend(report.items)
        return tuple(items)

    def _assessment(
        self,
        project: Project,
        items: tuple[ProjectContentItem, ...],
        permissions: frozenset[str],
    ) -> DeletionAssessment:
        status_allows = project.status in PROJECT_DELETABLE_STATUSES
        if not status_allows:
            code: str | None = "status"
            reason: str | None = _status_reason(project)
        elif not _allowed(items, permissions):
            code, reason = "permission", _permission_reason(items)
        else:
            code, reason = None, None
        return DeletionAssessment(
            project=project,
            items=items,
            status_allows=status_allows,
            can_delete=code is None,
            blocked_code=code,
            blocked_reason=reason,
        )

    def _count(self, stmt: Select[tuple[int]]) -> int:
        return int(self.session.execute(stmt).scalar_one())

    @staticmethod
    def _call[T](module_id: str, action: Callable[[], T]) -> T:
        """Ruft einen Teilnehmer auf; ein unerwarteter Fehler bricht kontrolliert ab."""
        try:
            return action()
        except AppError:
            raise
        except Exception as exc:
            logger.exception(
                "project_participant_failed", module=module_id, error=type(exc).__name__
            )
            raise ProjectDeletionFailedError(_FAILED_DETAIL) from exc


def _allowed(items: tuple[ProjectContentItem, ...], permissions: frozenset[str]) -> bool:
    if items:
        return PROJECT_RECORD_PURGE in permissions
    return PROJECT_RECORD_DELETE in permissions or PROJECT_RECORD_PURGE in permissions


def _status_reason(project: Project) -> str:
    return (
        f"Projekt {project.project_number} ist abgeschlossen oder archiviert und kann "
        "nicht geloescht werden. Geloescht werden koennen nur Entwuerfe und Projekte in "
        "Bearbeitung."
    )


def _permission_reason(items: tuple[ProjectContentItem, ...]) -> str:
    if items:
        return (
            "Dieses Projekt enthaelt bereits Inhalte. Projekte mit Inhalt kann nur ein "
            "Administrator loeschen."
        )
    return "Fuer das Loeschen von Projekten fehlt die Berechtigung."
