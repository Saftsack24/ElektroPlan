"""Deklarative Basisklasse mit fester Namenskonvention.

Die Namenskonvention ist Voraussetzung dafuer, dass Alembic-Autogenerate
stabile Migrationen erzeugt (docs/database.md, Abschnitt 1).
"""

from __future__ import annotations

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

metadata = MetaData(naming_convention=NAMING_CONVENTION)


class Base(DeclarativeBase):
    """Gemeinsame Basis aller ORM-Modelle."""

    metadata = metadata
