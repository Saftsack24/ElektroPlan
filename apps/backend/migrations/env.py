"""Alembic-Umgebung.

Die Datenbank-URL stammt aus der Anwendungskonfiguration, damit es genau eine
Quelle fuer Verbindungsdaten gibt.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import get_settings
from app.model_registry import metadata

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Eine bereits gesetzte URL hat Vorrang (programmatischer Aufruf, z. B. aus der
# Migrationsabnahme). Sonst gilt die Anwendungskonfiguration - damit es genau
# eine Quelle fuer Verbindungsdaten gibt.
if not config.get_main_option("sqlalchemy.url", ""):
    config.set_main_option("sqlalchemy.url", get_settings().database_url)
target_metadata = metadata


def run_migrations_offline() -> None:
    """Migrationen als SQL ausgeben, ohne Verbindung."""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Migrationen gegen eine Verbindung ausfuehren."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
