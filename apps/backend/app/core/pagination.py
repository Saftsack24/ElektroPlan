"""Cursor-basierte Auflistung (docs/api.md, Abschnitt 4).

Kein ``offset``: Bei gleichzeitigen Aenderungen wuerde ein Offset Eintraege
ueberspringen oder doppelt liefern.

Der Cursor ist ein **Keyset**: Sortierwert plus ID des letzten gelieferten
Datensatzes. Die ID ist der Gleichstandsbrecher - ohne sie waere die Seite bei
gleichen Sortierwerten (zwei Kunden gleichen Namens) nicht stabil.

Die Helfer hier sind bewusst allgemein gehalten: Kunden, Projekte und das
Protokoll benutzen dieselbe Mechanik. Ein drittes Muster wird erst eingefuehrt,
wenn eine Liste es tatsaechlich braucht.
"""

from __future__ import annotations

import base64
import binascii
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import Select, and_, or_
from sqlalchemy.orm import InstrumentedAttribute

from app.errors import ValidationFailedError

DEFAULT_LIMIT = 50
MAX_LIMIT = 200

#: Trennzeichen zwischen Sortierwert und ID. Der Sortierwert darf es
#: enthalten - beim Dekodieren wird von rechts getrennt.
_SEPARATOR = "|"


class Page[ItemT](BaseModel):
    """Eine Seite mit Fortsetzungszeiger."""

    items: list[ItemT]
    next_cursor: str | None = Field(default=None)
    has_more: bool = False


# ------------------------------------------------------------------- Cursor


def encode_keyset_cursor(sort_key: str, entity_id: uuid.UUID) -> str:
    """Kodiert die Sortierposition undurchsichtig."""
    raw = f"{sort_key}{_SEPARATOR}{entity_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def decode_keyset_cursor(cursor: str) -> tuple[str, uuid.UUID]:
    """Dekodiert einen Cursor. Ungueltige Werte sind Eingabefehler."""
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        sort_key, separator, identifier = raw.rpartition(_SEPARATOR)
        if not separator:
            msg = "Trennzeichen fehlt"
            raise ValueError(msg)
        return sort_key, uuid.UUID(identifier)
    except (ValueError, binascii.Error, UnicodeDecodeError) as exc:
        raise ValidationFailedError("Ungueltiger Cursor.") from exc


def encode_cursor(created_at: datetime, entity_id: uuid.UUID) -> str:
    """Cursor fuer nach Zeitpunkt sortierte Listen."""
    return encode_keyset_cursor(created_at.isoformat(), entity_id)


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    """Gegenstueck zu :func:`encode_cursor`."""
    sort_key, entity_id = decode_keyset_cursor(cursor)
    return parse_datetime_key(sort_key), entity_id


def parse_datetime_key(raw: str) -> datetime:
    """Liest einen Zeitpunkt aus einem Cursor."""
    try:
        return datetime.fromisoformat(raw)
    except ValueError as exc:
        raise ValidationFailedError("Ungueltiger Cursor.") from exc


def parse_text_key(raw: str) -> str:
    """Liest einen Textschluessel aus einem Cursor (Identitaet)."""
    return raw


# --------------------------------------------------------------- Seitenbau


def clamp_limit(limit: int) -> int:
    """Begrenzt die Seitengroesse."""
    return max(1, min(limit, MAX_LIMIT))


def apply_keyset[SelectT: Select[Any]](
    stmt: SelectT,
    *,
    sort_column: InstrumentedAttribute[Any],
    id_column: InstrumentedAttribute[Any],
    descending: bool,
    cursor: str | None,
    parse_key: Callable[[str], Any],
) -> SelectT:
    """Setzt Sortierung und Fortsetzungsbedingung eines Keyset-Cursors."""
    if cursor:
        raw_key, last_id = decode_keyset_cursor(cursor)
        key = parse_key(raw_key)
        if descending:
            stmt = stmt.where(or_(sort_column < key, and_(sort_column == key, id_column < last_id)))
        else:
            stmt = stmt.where(or_(sort_column > key, and_(sort_column == key, id_column > last_id)))
    if descending:
        return stmt.order_by(sort_column.desc(), id_column.desc())
    return stmt.order_by(sort_column.asc(), id_column.asc())


@dataclass(frozen=True, slots=True)
class KeysetPage[ModelT]:
    """Eine geladene Seite samt Fortsetzungszeiger - noch ohne Serialisierung."""

    items: Sequence[ModelT]
    next_cursor: str | None
    has_more: bool


def build_keyset_page[ModelT](
    rows: Sequence[ModelT],
    *,
    limit: int,
    key_of: Callable[[ModelT], str],
    id_of: Callable[[ModelT], uuid.UUID],
) -> KeysetPage[ModelT]:
    """Schneidet die Ueberhangzeile ab und bildet den Fortsetzungszeiger.

    Es wird ``limit + 1`` Zeile geladen; die letzte dient nur dazu,
    ``has_more`` ohne zweite Abfrage zu bestimmen.
    """
    has_more = len(rows) > limit
    visible = list(rows[:limit])
    next_cursor = (
        encode_keyset_cursor(key_of(visible[-1]), id_of(visible[-1]))
        if has_more and visible
        else None
    )
    return KeysetPage(items=visible, next_cursor=next_cursor, has_more=has_more)
