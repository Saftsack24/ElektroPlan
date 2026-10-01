"""Persistente Aufraeum-Warteschlange fuer Storage-Objekte (ADR 0020).

**Warum es sie gibt.** Datenbank und Object Storage haben keine gemeinsame
Transaktion. Wird ein Projekt samt Dateien geloescht, darf weder

* die Dateizeile verschwinden, waehrend das Objekt unbemerkt liegen bleibt,
* noch das Objekt verschwinden, waehrend eine gueltige Dateizeile bestehen
  bleibt.

**Ablauf.**

1. :func:`enqueue` merkt die Schluessel **in derselben Transaktion** vor, in
   der die Dateizeilen geloescht werden. Rollt sie zurueck, gibt es weder
   Loeschung noch Auftrag.
2. Nach dem Commit versucht :func:`process_jobs` das Loeschen im Storage.
   Erfolg entfernt den Auftrag, ein Fehler erhoeht den Versuchszaehler und
   haelt Zeitpunkt und gekuerzte Meldung fest.
3. Offene Auftraege arbeitet ``python -m app.cli storage-cleanup`` erneut ab.

**Idempotent.** Ein Schluessel wird hoechstens einmal vorgemerkt (``UNIQUE``),
das Loeschen eines nicht mehr vorhandenen Objekts ist im S3-Protokoll ein
Erfolg, und ein bereits erledigter Auftrag ist schlicht nicht mehr da. Zwei
gleichzeitige Laeufe ueberspringen gesperrte Auftraege (``SKIP LOCKED``).

**Keine Geheimnisse.** Gespeichert werden Schluessel, Grund und Diagnose.
Adressen werden aus Fehlermeldungen entfernt; Zugangsdaten kommen in einer
S3-Fehlermeldung nicht vor und werden nie uebergeben.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.files.models import StorageCleanupJob
from app.db.mixins import utcnow
from app.logging_config import get_logger

logger = get_logger(__name__)

REASON_PROJECT_DELETED = "project_deleted"

#: Laenge der gespeicherten Fehlermeldung.
MAX_ERROR_LENGTH = 500
_URL = re.compile(r"[a-z][a-z0-9+.-]*://\S+", re.IGNORECASE)


class ObjectRemover(Protocol):
    """Was die Warteschlange vom Storage braucht - nur das Loeschen."""

    def delete(self, key: str) -> None: ...


@dataclass(frozen=True, slots=True)
class CleanupResult:
    """Ergebnis eines Durchlaufs."""

    removed: int
    failed: int

    @property
    def processed(self) -> int:
        return self.removed + self.failed


def enqueue(
    session: Session,
    *,
    organization_id: uuid.UUID,
    storage_keys: Iterable[str],
    reason: str,
) -> list[str]:
    """Merkt Schluessel zur Loeschung vor - **ohne** Commit.

    Liefert die Schluessel in Eingabereihenfolge (ohne Dubletten). Ein bereits
    vorgemerkter Schluessel bleibt unveraendert stehen.
    """
    keys = list(dict.fromkeys(storage_keys))
    if not keys:
        return []
    session.execute(
        pg_insert(StorageCleanupJob)
        .values(
            [
                {
                    "id": uuid.uuid4(),
                    "organization_id": organization_id,
                    "storage_key": key,
                    "reason": reason,
                }
                for key in keys
            ]
        )
        .on_conflict_do_nothing(index_elements=["storage_key"])
    )
    return keys


def pending_count(session: Session) -> int:
    """Wie viele Auftraege offen sind - fuer Diagnose und CLI."""
    return int(session.execute(select(func.count()).select_from(StorageCleanupJob)).scalar_one())


def process_jobs(
    session: Session,
    storage: ObjectRemover,
    *,
    storage_keys: Sequence[str] | None = None,
    limit: int = 500,
) -> CleanupResult:
    """Arbeitet offene Auftraege ab und **committet je Auftrag**.

    ``storage_keys`` beschraenkt den Lauf auf bestimmte Schluessel - so raeumt
    eine Loeschung direkt nach ihrem Commit genau ihre eigenen Objekte ab. Ohne
    Angabe werden die aeltesten offenen Auftraege bearbeitet (CLI).

    Die Session darf beim Aufruf keine offene Aenderung tragen: Jeder Auftrag
    wird in einer eigenen kurzen Transaktion abgeschlossen.
    """
    stmt = select(StorageCleanupJob.id).order_by(
        StorageCleanupJob.created_at.asc(), StorageCleanupJob.id.asc()
    )
    if storage_keys is not None:
        if not storage_keys:
            return CleanupResult(removed=0, failed=0)
        stmt = stmt.where(StorageCleanupJob.storage_key.in_(list(storage_keys)))
    job_ids = list(session.execute(stmt.limit(limit)).scalars().all())
    session.commit()

    removed = 0
    failed = 0
    for job_id in job_ids:
        job = session.execute(
            select(StorageCleanupJob)
            .where(StorageCleanupJob.id == job_id)
            .with_for_update(skip_locked=True)
        ).scalar_one_or_none()
        if job is None:
            # Erledigt oder gerade in einem parallelen Lauf.
            session.commit()
            continue
        try:
            storage.delete(job.storage_key)
        except Exception as exc:
            job.attempts += 1
            job.last_attempt_at = utcnow()
            job.last_error = describe_error(exc)
            session.commit()
            failed += 1
            logger.warning(
                "storage_cleanup_failed",
                storage_key=job.storage_key,
                attempts=job.attempts,
                error=type(exc).__name__,
            )
        else:
            session.delete(job)
            session.commit()
            removed += 1
    if job_ids:
        logger.info("storage_cleanup_run", removed=removed, failed=failed)
    return CleanupResult(removed=removed, failed=failed)


def describe_error(exc: BaseException) -> str:
    """Fehlerklasse und Meldung, ohne Adressen, gekuerzt."""
    message = _URL.sub("<adresse>", str(exc)).strip()
    text = f"{type(exc).__name__}: {message}" if message else type(exc).__name__
    return text[:MAX_ERROR_LENGTH]
