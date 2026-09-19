"""Statische Typpruefung fuer Provider-Bindings.

Faehrt ``mypy`` als Subprozess ueber jede Fixture unter
``tests/mypy_negative``. Positive Fixtures (``ok_*``) muessen fehlerfrei
durchgehen; negative Fixtures (``bad_*``) muessen genau in der Datei
einen Fehler ausloesen. Damit ist bewiesen, dass die generische
Signatur

    def bind_port(port: type[TPort], implementation: type[TPort])
      -> PortBinding[TPort]

eine inkompatible Implementierung tatsaechlich schon beim Typecheck
ablehnt - nicht nur zur Laufzeit. Die Laufzeitpruefung in
``ModuleRegistry`` bleibt als zusaetzliche Schutzschicht bestehen, siehe
``tests/test_module_registry.py``.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "mypy_negative"


def _run_mypy_on(path: Path) -> tuple[int, str]:
    """Ruft ``mypy --strict`` auf eine einzelne Datei auf."""
    # sys.executable ist die aktuelle .venv - keine externe Eingabe. Der
    # Fixture-Pfad ist unter Test-Kontrolle. S603 ist hier gefahrlos.
    result = subprocess.run(  # noqa: S603 - Argumente stammen aus dem Interpreter, nicht aus Nutzereingabe
        [
            sys.executable,
            "-m",
            "mypy",
            "--strict",
            "--no-incremental",
            "--config-file",
            str(Path(__file__).parents[1] / "pyproject.toml"),
            "--follow-imports=silent",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode, result.stdout + result.stderr


def _fixtures(prefix: str) -> list[Path]:
    return sorted(FIXTURES_DIR.glob(f"{prefix}_*.py"))


def test_positive_fixture_akzeptiert_kompatible_implementierung() -> None:
    positives = _fixtures("ok")
    assert positives, "Es muss mindestens eine positive mypy-Fixture geben."
    for fixture in positives:
        rc, output = _run_mypy_on(fixture)
        assert rc == 0, f"mypy meldet unerwartet Fehler in {fixture.name}:\n{output}"


@pytest.mark.parametrize("fixture", _fixtures("bad"), ids=lambda p: p.name)
def test_negative_fixture_faellt_bei_mypy(fixture: Path) -> None:
    rc, output = _run_mypy_on(fixture)
    assert rc != 0, f"mypy sollte {fixture.name} ablehnen, tut es aber nicht.\nAusgabe:\n{output}"
    # Der Fehler muss ausdruecklich die Fixture betreffen - nicht eine
    # importierte Modul-Datei.
    assert fixture.name in output, f"mypy meldet Fehler, aber nicht in {fixture.name}:\n{output}"
