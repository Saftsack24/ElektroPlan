"""Entwicklungsbetrieb und Secrets (Sicherheitsauftrag 2026-10-10, Befund 3).

* Produktion lehnt jeden bekannten Entwicklungswert ab.
* ``docker-compose.yml`` bindet jeden veroeffentlichten Port an 127.0.0.1 und
  reicht die in ``.env.example`` dokumentierten Secrets wirklich an den
  Backend-Container durch (statisch geprueft).
* Mit Docker: Die effektive Compose-Konfiguration enthaelt einen gesetzten
  synthetischen Wert. Ohne Docker ueberspringt dieser eine Test sichtbar.

Es werden ausschliesslich synthetische Werte verwendet und nichts ausgegeben.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
import yaml

from app.config import DEVELOPMENT_JWT_SECRET, Settings

REPO = Path(__file__).resolve().parents[3]
COMPOSE = REPO / "docker-compose.yml"
ENV_EXAMPLE = REPO / ".env.example"
PROD_DB = "postgresql+psycopg://app:synthetisch-prod-kennwort@db:5432/elektroplan"

#: In .env.example dokumentierte Werte, die den Backend-Container erreichen muessen.
DURCHGEREICHT = (
    "ELEKTROPLAN_JWT_SECRET",
    "ELEKTROPLAN_JWT_KEY_ID",
    "ELEKTROPLAN_S3_SECRET_KEY",
    "ELEKTROPLAN_SEED_ORG_NAME",
    "ELEKTROPLAN_SEED_ADMIN_EMAIL",
    "ELEKTROPLAN_SEED_ADMIN_PASSWORD",
)


def _produktion(**werte: Any) -> Settings:
    basis: dict[str, Any] = {
        "environment": "production",
        "jwt_secret": "s" * 48,
        "s3_secret_key": "synthetisch-s3",
        "database_url": PROD_DB,
        "invitation_delivery": "none",
        "password_reset_delivery": "none",
    }
    basis.update(werte)
    return Settings(**basis)


# --------------------------------------------------------------- Konfiguration


def test_produktion_mit_eigenen_werten_startet() -> None:
    assert _produktion().is_production


@pytest.mark.parametrize(
    ("feld", "wert", "meldung"),
    [
        ("jwt_secret", DEVELOPMENT_JWT_SECRET, "JWT_SECRET"),
        ("jwt_secret", "bitte-ersetzen-mindestens-32-zeichen-langer-zufallswert", "JWT_SECRET"),
        ("jwt_secret", "zu-kurz", "JWT_SECRET"),
        ("s3_secret_key", "elektroplan-dev-secret", "S3_SECRET_KEY"),
        ("s3_secret_key", "", "S3_SECRET_KEY"),
        (
            "database_url",
            "postgresql+psycopg://elektroplan:elektroplan@postgres:5432/elektroplan",
            "DATABASE_URL",
        ),
        ("seed_admin_password", "entwicklung-bitte-aendern", "SEED_ADMIN_PASSWORD"),
        ("seed_admin_password", "aendere-dieses-passwort", "SEED_ADMIN_PASSWORD"),
    ],
)
def test_produktion_lehnt_entwicklungswerte_ab(feld: str, wert: str, meldung: str) -> None:
    with pytest.raises(ValueError, match=meldung):
        _produktion(**{feld: wert})


def test_entwicklung_ohne_secret_nutzt_gekennzeichneten_ersatzwert(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ELEKTROPLAN_JWT_SECRET", raising=False)
    settings = Settings(environment="development", jwt_secret="")
    assert settings.uses_development_jwt_secret
    gesetzt = Settings(environment="development", jwt_secret="synthetisch-" + "x" * 30)
    assert not gesetzt.uses_development_jwt_secret


# ------------------------------------------------------------ docker-compose.yml


def _compose() -> dict[str, Any]:
    daten: dict[str, Any] = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))
    return daten


def test_alle_ports_nur_auf_localhost() -> None:
    gefunden = 0
    for name, dienst in _compose()["services"].items():
        for port in dienst.get("ports", []):
            gefunden += 1
            assert str(port).startswith("127.0.0.1:"), f"{name}: {port}"
    assert gefunden == 5


def test_dokumentierte_secrets_erreichen_den_backend_container() -> None:
    umgebung = _compose()["services"]["backend"]["environment"]
    for variable in DURCHGEREICHT:
        assert variable in ENV_EXAMPLE.read_text(encoding="utf-8")
        wert = str(umgebung[variable])
        assert re.fullmatch(rf"\$\{{{variable}(:-[^}}]*)?\}}", wert), (variable, wert)


def test_minio_und_backend_teilen_denselben_zugang() -> None:
    dienste = _compose()["services"]
    erwartet = dienste["backend"]["environment"]["ELEKTROPLAN_S3_SECRET_KEY"]
    assert dienste["minio"]["environment"]["MINIO_ROOT_PASSWORD"] == erwartet
    assert dienste["minio-init"]["environment"]["MINIO_ROOT_PASSWORD"] == erwartet


def _docker_compose_verfuegbar() -> bool:
    if shutil.which("docker") is None:
        return False
    try:
        result = subprocess.run(
            ["docker", "compose", "version"],  # noqa: S607
            capture_output=True,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


@pytest.mark.skipif(not _docker_compose_verfuegbar(), reason="Docker Compose nicht verfuegbar.")
def test_effektive_compose_konfiguration_enthaelt_den_gesetzten_wert(tmp_path: Path) -> None:
    """``docker compose config`` mit einer synthetischen ``.env`` - nichts wird gestartet."""
    synthetisch = "synthetisch-jwt-" + "q" * 40
    env_datei = tmp_path / "synthetisch.env"
    env_datei.write_text(
        f"ELEKTROPLAN_JWT_SECRET={synthetisch}\nELEKTROPLAN_S3_SECRET_KEY=synthetisch-s3\n",
        encoding="utf-8",
    )
    # Variablen der aufrufenden Shell haben bei Docker Compose Vorrang vor der
    # .env-Datei - der Testlauf selbst setzt ELEKTROPLAN_*. Deshalb ohne sie.
    umgebung = {k: v for k, v in os.environ.items() if not k.startswith("ELEKTROPLAN_")}
    result = subprocess.run(  # noqa: S603
        [  # noqa: S607
            "docker",
            "compose",
            "-f",
            str(COMPOSE),
            "--env-file",
            str(env_datei),
            "config",
            "--format",
            "json",
        ],
        capture_output=True,
        timeout=60,
        check=False,
        cwd=REPO,
        env=umgebung,
    )
    assert result.returncode == 0, "docker compose config ist gescheitert."
    effektiv = json.loads(result.stdout)
    backend = effektiv["services"]["backend"]["environment"]
    assert backend["ELEKTROPLAN_JWT_SECRET"] == synthetisch
    assert backend["ELEKTROPLAN_S3_SECRET_KEY"] == "synthetisch-s3"
    assert effektiv["services"]["minio"]["environment"]["MINIO_ROOT_PASSWORD"] == "synthetisch-s3"
    for dienst in effektiv["services"].values():
        for port in dienst.get("ports", []):
            assert port["host_ip"] == "127.0.0.1"


def test_rechnerseitige_standardadressen_nutzen_ipv4_loopback() -> None:
    """Compose bindet nur 127.0.0.1. ``localhost`` loest unter Windows zuerst ``::1``
    auf; libpq wartete dort bis zum Verbindungs-Timeout (Review 2026-10-10).
    """
    felder = Settings.model_fields
    assert "@127.0.0.1:5432/" in str(felder["database_url"].default)
    assert str(felder["s3_endpoint_url"].default) == "http://127.0.0.1:9000"
    beispiel = ENV_EXAMPLE.read_text(encoding="utf-8")
    assert "@localhost:5432" not in beispiel
    assert "ELEKTROPLAN_S3_ENDPOINT_URL=http://127.0.0.1:9000" in beispiel
