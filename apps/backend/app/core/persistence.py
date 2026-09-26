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


#: SQLSTATE einer Fremdschluesselverletzung in PostgreSQL.
FOREIGN_KEY_VIOLATION = "23503"


def _sqlstate_of(error: IntegrityError) -> str | None:
    """SQLSTATE der Datenbankmeldung, sofern der Treiber ihn liefert."""
    code = getattr(getattr(error, "orig", None), "sqlstate", None)
    return str(code) if code else None


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


@contextmanager
def foreign_key_violation_translated(session: Session, *, error: AppError) -> Iterator[None]:
    """Uebersetzt eine Fremdschluesselverletzung in einen fachlichen Fehler.

    Gebraucht beim Loeschen einer Struktur, auf die ein Fachmodul verweist:
    Ein Geschoss mit Planungsdaten laesst sich nicht entfernen, weil der
    Fremdschluessel ``RESTRICT`` traegt. Ohne diese Uebersetzung waere die
    Antwort ein ``500`` - technisch richtig, fachlich nutzlos.

    Der Core erfaehrt dabei **nicht**, welches Modul verweist. Die Meldung
    bleibt deshalb fachneutral: Der Datensatz wird verwendet. Welches Modul ihn
    verwendet, gehoert nicht in die Antwort - der Core kennt keine Module
    (ADR 0001).

    Nur die Verletzung eines Fremdschluessels (PostgreSQL ``23503``) wird
    uebersetzt; jeder andere Integritaetsfehler bleibt ein unerwarteter Fehler.
    """
    try:
        yield
    except IntegrityError as exc:
        session.rollback()
        if _sqlstate_of(exc) != FOREIGN_KEY_VIOLATION:
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
