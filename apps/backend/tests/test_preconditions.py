"""Syntax des ``If-Match``-Headers (docs/api.md, Abschnitt 5).

Die Anwendung braucht bewusst nur eine positive Ganzzahl - keine
vollstaendige ETag-Grammatik. Genau das wird hier festgenagelt: Ein
beschaedigter Header darf nicht versehentlich als gueltige Vorbedingung
durchgehen.

Laeuft ohne Datenbank.
"""

from __future__ import annotations

import pytest

from app.core.preconditions import check_version, parse_if_match
from app.errors import PreconditionRequiredError, VersionConflictError


class _Versioniert:
    """Minimale Entitaet mit Versionsspalte."""

    def __init__(self, version: int) -> None:
        self.version = version


# ------------------------------------------------------------------ gueltig


@pytest.mark.parametrize(
    ("header", "erwartet"),
    [
        ("3", 3),
        ('"3"', 3),
        ("1", 1),
        ('"1"', 1),
        ("12345", 12345),
        # Umgebende Leerzeichen sind Transportrauschen, kein Syntaxfehler.
        ("  7  ", 7),
        ('  "7"  ', 7),
    ],
)
def test_gueltige_werte_werden_gelesen(header: str, erwartet: int) -> None:
    assert parse_if_match(header) == erwartet


# ---------------------------------------------------------------- ungueltig


@pytest.mark.parametrize(
    "header",
    [
        'W/"3"',  # schwacher Vergleich - eine Version ist exakt
        '"3',  # oeffnendes Anfuehrungszeichen ohne schliessendes
        '3"',  # schliessendes ohne oeffnendes
        '""3""',  # doppelte Anfuehrungszeichen
        "3, 4",  # Liste
        '"3", "4"',  # Liste in ETag-Schreibweise
        "*",  # Platzhalter
        "0",  # Versionen beginnen bei 1
        '"0"',
        "-1",
        '"-1"',
        "abc",
        "3.0",
        "03",  # fuehrende Null
        "+3",
        "3 4",
        " ",
        "",
        '""',
        "3;4",
        "\t3\n4",
    ],
)
def test_ungueltige_werte_werden_abgelehnt(header: str) -> None:
    with pytest.raises(PreconditionRequiredError):
        parse_if_match(header)


def test_fehlender_header_wird_abgelehnt() -> None:
    with pytest.raises(PreconditionRequiredError):
        parse_if_match(None)


def test_meldung_spiegelt_den_rohwert_nicht_zurueck() -> None:
    """Client-Eingaben gehoeren nicht ungeprueft in eine Antwort."""
    with pytest.raises(PreconditionRequiredError) as fehler:
        parse_if_match("<script>alert(1)</script>")

    assert "script" not in str(fehler.value)


# --------------------------------------------------------- Versionsvergleich


def test_passende_version_geht_durch() -> None:
    check_version(_Versioniert(3), 3)


@pytest.mark.parametrize("erwartet", [1, 2, 4, 99])
def test_abweichende_version_ist_ein_konflikt(erwartet: int) -> None:
    with pytest.raises(VersionConflictError):
        check_version(_Versioniert(3), erwartet)
