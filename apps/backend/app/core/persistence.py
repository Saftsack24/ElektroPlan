"""Uebersetzung erwarteter Datenbankkonflikte in fachliche Fehler.

Zwei Konflikte entstehen erst unter **echter Parallelitaet** und sind deshalb
mit einer Vorabpruefung allein nicht zu verhindern:

1. **Verlorene Aktualisierung.** Zwei Anfragen lesen dieselbe Version, beide
   bestehen die ``If-Match``-Pruefung, beide schreiben. Die zweite trifft
   dank ``version_id_col`` keine Zeile mehr und SQLAlchemy wirft
   :class:`~sqlalchemy.orm.exc.StaleDataError`. Fachlich ist das derselbe
   Versionskonflikt wie ein veraltetes ``If-Match`` - also ``409``, nie
   ``500``.
2. **Verletzte Eindeutigkeit.** Zwei Anfragen legen dasselbe eindeutige
   Objekt an. Die Datenbank laesst nur eines zu; die zweite erhaelt einen
   ``IntegrityError``. Nur die **namentlich erwartete** Constraint wird
   uebersetzt - jeder andere Integritaetsfehler bleibt ein unerwarteter
   Fehler und wird nicht als Fachmeldung getarnt.

Nach einem Datenbankfehler ist die Transaktion im Fehlerzustand. Beide
Helfer rollen die Session deshalb zurueck, bevor sie den fachlichen Fehler
werfen: Eine Session im Fehlerzustand darf nicht weiterverwendet werden.

Die Endpunkte brauchen dafuer **kein** eigenes ``try/except``. Als Netz fuer
Fehler, die erst beim Commit auftreten, uebersetzt zusaetzlich ein zentraler
Exception-Handler in :mod:`app.errors`.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.errors import AppError, VersionConflictError

#: Meldung fuer einen erst beim Schreiben erkannten Versionskonflikt. Sie
#: nennt bewusst keine Versionsnummern: Der Client hat seinen Stand bereits
#: verloren und muss ohnehin neu laden.
CONCURRENT_UPDATE_DETAIL = (
    "Der Datensatz wurde zeitgleich von einer anderen Anfrage geaendert. "
    "Bitte neu laden und die Aenderung wiederholen."
)


def constraint_name_of(error: IntegrityError) -> str | None:
    """Name der verletzten Constraint, sofern der Treiber ihn liefert.

    psycopg stellt die Felder der PostgreSQL-Fehlermeldung unter ``diag``
    bereit. Fehlt die Angabe, liefert die Funktion ``None`` - dann wird der
    Fehler **nicht** uebersetzt.
    """
    diagnostics = getattr(getattr(error, "orig", None), "diag", None)
    name = getattr(diagnostics, "constraint_name", None)
    return str(name) if name else None


@contextmanager
def version_conflicts_translated(session: Session) -> Iterator[None]:
    """Uebersetzt einen :class:`StaleDataError` in einen ``409``."""
    try:
        yield
    except StaleDataError as exc:
        session.rollback()
        raise VersionConflictError(CONCURRENT_UPDATE_DETAIL) from exc


@contextmanager
def unique_violation_translated(
    session: Session, *, constraint: str, error: AppError
) -> Iterator[None]:
    """Uebersetzt genau **eine** erwartete Unique-Verletzung.

    :param constraint: Name der Constraint, wie ihn PostgreSQL meldet.
    :param error: Der fachliche Fehler, der stattdessen geworfen wird.

    Jeder andere ``IntegrityError`` wird unveraendert weitergereicht - er ist
    ein Programmierfehler und darf nicht als erwartete Fachmeldung erscheinen.
    """
    try:
        yield
    except IntegrityError as exc:
        session.rollback()
        if constraint_name_of(exc) != constraint:
            raise
        raise error from exc


def flush(session: Session) -> None:
    """``session.flush()`` mit Uebersetzung des Versionskonflikts.

    Wird an jeder Stelle benutzt, an der eine versionierte Entitaet
    geschrieben wird. Damit ist der Konflikt schon im Service ein fachlicher
    Fehler - und nicht erst in der HTTP-Schicht.
    """
    with version_conflicts_translated(session):
        session.flush()
