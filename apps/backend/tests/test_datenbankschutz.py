"""Die Entwicklungsdatenbank ist vor destruktiven Tests geschützt (Phase 4a.1).

Keine Datenbank nötig: geprüft wird die reine Validierung aus
``tests/datenbankschutz.py`` und der Abbruch des Laufs in einem eigenen
pytest-Prozess.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from tests.datenbankschutz import UnsichereTestdatenbankError, pruefe_testdatenbank

PASSWORT = "geheim-4711"
ENTWICKLUNG = f"postgresql+psycopg://elektroplan:{PASSWORT}@localhost:5432/elektroplan"
BACKEND = Path(__file__).resolve().parents[1]


def _meldung(test_url: str | None, entwicklung: str = ENTWICKLUNG) -> str:
    with pytest.raises(UnsichereTestdatenbankError) as fehler:
        pruefe_testdatenbank(test_url, entwicklung)
    return str(fehler.value)


def test_identische_urls_brechen_hart_ab() -> None:
    meldung = _meldung(ENTWICKLUNG)
    assert "Entwicklungsdatenbank" in meldung or "nicht ausdrücklich" in meldung


def test_gleiche_datenbank_unter_anderer_schreibweise_wird_erkannt() -> None:
    """127.0.0.1 statt localhost, anderer Treiber, fehlender Port: dieselbe Datenbank."""
    meldung = _meldung(
        f"postgresql://elektroplan:{PASSWORT}@127.0.0.1/ci_test",
        entwicklung=f"postgresql+psycopg://elektroplan:{PASSWORT}@localhost:5432/ci_test",
    )
    assert "zeigt auf die Entwicklungsdatenbank" in meldung


def test_getrennte_testdatenbank_ist_erlaubt() -> None:
    pruefe_testdatenbank(
        f"postgresql+psycopg://elektroplan:{PASSWORT}@localhost:5432/elektroplan_test", ENTWICKLUNG
    )
    pruefe_testdatenbank("postgresql://ci:ci@db-server:5433/test_elektroplan", ENTWICKLUNG)


def test_fehlende_test_url_bricht_verstaendlich_ab() -> None:
    for leer in (None, "", "   "):
        assert "ELEKTROPLAN_TEST_DATABASE_URL ist nicht gesetzt" in _meldung(leer)


def test_nicht_als_test_benannte_datenbank_wird_abgelehnt() -> None:
    """Eine andere Datenbank ist noch keine Testdatenbank - etwa eine Kopie."""
    for name in ("elektroplan_kopie", "contest", "latest", "elektroplan"):
        assert "nicht ausdrücklich als Testdatenbank" in _meldung(
            f"postgresql+psycopg://u:{PASSWORT}@localhost:5432/{name}"
        )


def test_ungueltige_url_wird_abgelehnt() -> None:
    assert "keine gültige" in _meldung(f"kein-url-{PASSWORT}")


@pytest.mark.parametrize(
    "test_url",
    [
        ENTWICKLUNG,
        f"postgresql+psycopg://elektroplan:{PASSWORT}@localhost:5432/elektroplan_kopie",
        f"kein-url-{PASSWORT}",
    ],
)
def test_meldung_enthaelt_keine_zugangsdaten(test_url: str) -> None:
    meldung = _meldung(test_url)
    assert PASSWORT not in meldung
    assert "elektroplan:" not in meldung  # kein Benutzer-Passwort-Paar


def test_testlauf_bricht_vor_jeder_schemaaenderung_ab() -> None:
    """Ein echter pytest-Lauf mit gefährlicher URL endet sofort mit Code 2.

    Gestartet wird ein Datenbanktest; er kommt gar nicht erst zur Ausführung.
    Die Datenbank ist dafür nicht nötig - der Abbruch liegt vor jeder
    Verbindung.
    """
    umgebung = {
        **os.environ,
        "ELEKTROPLAN_TEST_DATABASE_URL": ENTWICKLUNG,
        "ELEKTROPLAN_DATABASE_URL": ENTWICKLUNG,
    }
    lauf = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests/test_tenancy.py"],
        cwd=BACKEND,
        env=umgebung,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    ausgabe = lauf.stdout + lauf.stderr
    assert lauf.returncode == 2, ausgabe
    assert "Testlauf abgebrochen" in ausgabe
    assert PASSWORT not in ausgabe
    assert " passed" not in ausgabe
