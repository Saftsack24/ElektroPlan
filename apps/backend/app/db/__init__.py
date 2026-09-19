"""Datenbankschicht: Basisklasse, Mixins, Session-Handling."""

from app.db.base import Base, metadata
from app.db.mixins import (
    Authored,
    SoftDeletable,
    TenantScoped,
    Timestamped,
    UUIDPrimaryKey,
    Versioned,
    tenant_fk,
    tenant_identity,
)
from app.db.session import get_engine, get_session, session_scope

__all__ = [
    "Authored",
    "Base",
    "SoftDeletable",
    "TenantScoped",
    "Timestamped",
    "UUIDPrimaryKey",
    "Versioned",
    "get_engine",
    "get_session",
    "metadata",
    "session_scope",
    "tenant_fk",
    "tenant_identity",
]
