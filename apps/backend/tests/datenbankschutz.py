"""Schutz der Entwicklungsdatenbank vor destruktiven Testoperationen.

Die Datenbanktests leeren und erzeugen das Schema (``drop_all``,
``create_all``, ``TRUNCATE``), der Migrationstest legt eine eigene Datenbank an
und löscht sie wieder. Zeigt ``ELEKTROPLAN_TEST_DATABASE_URL`` versehentlich auf
die Entwicklungsdatenbank, wären deren Daten verloren - ein Tippfehler in einer
Umgebungsvariable genügt. Deshalb verlässt sich die Testinfrastruktur nicht auf
die Dokumentation, sondern prüft **vor** jeder Schemaänderung:

1. Eine Test-URL ist gesetzt und lesbar.
2. Der Datenbankname weist die Datenbank **ausdrücklich** als Testdatenbank
   aus: ``test`` als eigener Namensteil, etwa ``elektroplan_test``,
   ``test_elektroplan`` oder ``ci_test_42``. CI-Umgebungen können damit jede
   eigene Testdatenbank verwenden.
3. Sie ist nicht dieselbe Datenbank wie die Entwicklungsdatenbank
   (``ELEKTROPLAN_DATABASE_URL`` bzw. der Standard der Anwendung). Verglichen
   werden Host (``localhost``, ``127.0.0.1`` und ``::1`` gelten als gleich),
   Port und Datenbankname - Treiber und Zugangsdaten spielen keine Rolle.

Meldungen nennen nur Host, Port und Datenbankname - nie Benutzer oder Passwort.

Die Datei ist Testinfrastruktur, kein Anwendungscode: Die laufende Anwendung
und die Compose-Umgebung sind davon nicht betroffen.
"""

from __future__ import annotations

import re

from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError

#: ``test`` als eigener Namensteil, getrennt durch ``_`` oder ``-``.
_TESTNAME = re.compile(r"(^|[_-])test([_-]|$)", re.IGNORECASE)
_LOKAL = {"localhost", "127.0.0.1", "::1", ""}
_STANDARDPORT = 5432


class UnsichereTestdatenbankError(RuntimeError):
    """Die konfigurierte Testdatenbank darf nicht für destruktive Tests benutzt werden."""


def _ziel(url: URL) -> tuple[str, int, str]:
    host = (url.host or "").lower()
    return ("localhost" if host in _LOKAL else host, url.port or _STANDARDPORT, url.database or "")


def _anzeige(ziel: tuple[str, int, str]) -> str:
    """Ohne Benutzer und Passwort - nur, wohin die URL zeigt."""
    host, port, name = ziel
    return f"{host}:{port}/{name}"


def pruefe_testdatenbank(test_url: str | None, entwicklungs_url: str) -> None:
    """Wirft :class:`UnsichereTestdatenbankError`, wenn die Test-URL gefährlich ist."""
    if test_url is None or not test_url.strip():
        raise UnsichereTestdatenbankError(
            "ELEKTROPLAN_TEST_DATABASE_URL ist nicht gesetzt. Datenbanktests brauchen eine "
            "eigene Testdatenbank, etwa .../elektroplan_test (siehe CLAUDE.md, Abschnitt 11)."
        )
    try:
        test = make_url(test_url)
    except ArgumentError:
        # ``from None``: Die Originalmeldung enthielte die URL samt Passwort.
        raise UnsichereTestdatenbankError(
            "ELEKTROPLAN_TEST_DATABASE_URL ist keine gültige Datenbank-URL."
        ) from None

    ziel = _ziel(test)
    if not _TESTNAME.search(ziel[2]):
        raise UnsichereTestdatenbankError(
            f"Die Testdatenbank {_anzeige(ziel)} ist nicht ausdrücklich als Testdatenbank "
            "benannt. Destruktive Tests laufen nur gegen eine Datenbank mit 'test' als "
            "eigenem Namensteil, etwa elektroplan_test."
        )

    try:
        entwicklung = _ziel(make_url(entwicklungs_url))
    except ArgumentError:
        # Ohne lesbare Entwicklungs-URL bleibt der Namensschutz aus Schritt 2.
        return
    if ziel == entwicklung:
        raise UnsichereTestdatenbankError(
            f"ELEKTROPLAN_TEST_DATABASE_URL zeigt auf die Entwicklungsdatenbank "
            f"{_anzeige(ziel)}. Die Tests würden sie leeren. Bitte eine getrennte "
            "Testdatenbank verwenden, etwa .../elektroplan_test."
        )
