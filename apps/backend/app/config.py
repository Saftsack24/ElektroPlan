"""Anwendungskonfiguration.

Alle Werte kommen aus Umgebungsvariablen mit dem Praefix ``ELEKTROPLAN_``.
Die Konfiguration wird beim Start validiert: Ein fehlendes oder unsicheres
Secret verhindert den Start (siehe docs/security.md, Abschnitt 8).
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "production"]

_PLACEHOLDER_SECRETS = frozenset(
    {
        "bitte-ersetzen-mindestens-32-zeichen-langer-zufallswert",
        "changeme",
        "secret",
    }
)


class Settings(BaseSettings):
    """Typisierte Laufzeitkonfiguration."""

    model_config = SettingsConfigDict(
        env_prefix="ELEKTROPLAN_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Allgemein ---
    environment: Environment = "development"
    debug: bool = False
    app_name: str = "ElektroPlan"
    api_prefix: str = "/api/v1"

    # --- Datenbank ---
    database_url: str = "postgresql+psycopg://elektroplan:elektroplan@localhost:5432/elektroplan"
    database_echo: bool = False
    database_pool_size: int = 5
    database_connect_timeout: int = Field(default=5, ge=1, le=30)

    # --- Sicherheit ---
    jwt_secret: str = Field(default="", min_length=0)
    jwt_key_id: str = "key-1"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = Field(default=15, ge=1, le=120)
    refresh_token_days: int = Field(default=14, ge=1, le=90)
    password_min_length: int = Field(default=12, ge=8)
    #: Wird ein bereits ersetzter Refresh Token innerhalb dieses Fensters
    #: erneut vorgelegt, gilt das als parallele Anfrage desselben Clients
    #: und nicht als Diebstahl. Es werden trotzdem keine neuen Tokens
    #: ausgegeben - nur die Familie bleibt bestehen.
    refresh_race_grace_seconds: int = Field(default=10, ge=0, le=120)

    # --- Rate Limiting (Startwerte aus docs/security.md, Abschnitt 11) ---
    login_attempts_per_window: int = 10
    login_window_seconds: int = 900

    # --- Object Storage ---
    #: Endpunkt fuer Zugriffe des Backends (im Docker-Netz z. B. http://minio:9000).
    s3_endpoint_url: str = "http://localhost:9000"
    #: Endpunkt, der in signierte Download-URLs eingeht. Diese URLs ruft der
    #: **Browser** auf - ein Docker-interner Hostname waere dort nicht
    #: aufloesbar. Leer bedeutet: identisch mit dem internen Endpunkt.
    s3_public_endpoint_url: str = ""
    s3_access_key: str = "elektroplan"
    s3_secret_key: str = ""
    s3_bucket: str = "elektroplan"
    s3_region: str = "eu-central-1"
    upload_max_bytes: int = 50 * 1024 * 1024
    download_url_ttl_seconds: int = Field(default=300, ge=30, le=3600)

    # --- CORS ---
    cors_origins: str = "http://localhost:5173"

    # --- Seed (nur Entwicklung) ---
    seed_org_name: str = "Elektro Musterbetrieb GmbH"
    seed_admin_email: str = "admin@example.com"
    seed_admin_password: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def s3_signing_endpoint_url(self) -> str:
        """Endpunkt, mit dem signierte URLs erzeugt werden.

        Die Signatur nach SigV4 umfasst den Host. Deshalb wird mit genau dem
        Endpunkt signiert, den der Browser spaeter aufruft - ein nachtraegliches
        Ersetzen des Hostnamens wuerde die Signatur ungueltig machen.
        """
        return self.s3_public_endpoint_url or self.s3_endpoint_url

    @field_validator("database_url")
    @classmethod
    def _validate_database_url(cls, value: str) -> str:
        if not value.startswith("postgresql"):
            msg = "Nur PostgreSQL wird unterstuetzt (ADR 0002)."
            raise ValueError(msg)
        return value

    @model_validator(mode="after")
    def _validate_secrets(self) -> Settings:
        """Unsichere Secrets verhindern den Start - ausser in Entwicklung/Test."""
        if self.environment in ("development", "test"):
            if not self.jwt_secret:
                # Nur Entwicklung/Test: In Produktion erzwingt die Pruefung unten
                # ein echtes Secret mit mindestens 32 Zeichen.
                self.jwt_secret = "development-only-insecure-secret-do-not-use"  # noqa: S105
            return self
        if len(self.jwt_secret) < 32:
            msg = "ELEKTROPLAN_JWT_SECRET muss in Produktion mindestens 32 Zeichen haben."
            raise ValueError(msg)
        if self.jwt_secret in _PLACEHOLDER_SECRETS:
            msg = "ELEKTROPLAN_JWT_SECRET ist noch der Platzhalterwert."
            raise ValueError(msg)
        if not self.s3_secret_key:
            msg = "ELEKTROPLAN_S3_SECRET_KEY fehlt."
            raise ValueError(msg)
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Zwischengespeicherte Settings-Instanz."""
    return Settings()
