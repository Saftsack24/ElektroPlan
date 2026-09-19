"""Cursor-basierte Auflistung (docs/api.md, Abschnitt 4).

Kein ``offset``: Bei gleichzeitigen Aenderungen wuerde ein Offset Eintraege
ueberspringen oder doppelt liefern.
"""

from __future__ import annotations

import base64
import binascii
import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.errors import ValidationFailedError

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


class Page[ItemT](BaseModel):
    """Eine Seite mit Fortsetzungszeiger."""

    items: list[ItemT]
    next_cursor: str | None = Field(default=None)
    has_more: bool = False


def encode_cursor(created_at: datetime, entity_id: uuid.UUID) -> str:
    """Kodiert die Sortierposition undurchsichtig."""
    raw = f"{created_at.isoformat()}|{entity_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    """Dekodiert einen Cursor. Ungueltige Werte sind Eingabefehler."""
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        timestamp, _, identifier = raw.partition("|")
        return datetime.fromisoformat(timestamp), uuid.UUID(identifier)
    except (ValueError, binascii.Error) as exc:
        raise ValidationFailedError("Ungueltiger Cursor.") from exc


def clamp_limit(limit: int) -> int:
    """Begrenzt die Seitengroesse."""
    return max(1, min(limit, MAX_LIMIT))
