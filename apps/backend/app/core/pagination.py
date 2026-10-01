"""Auflistungen (docs/api.md, Abschnitt 4) - zwei Muster.

**Keyset-Cursor** (Protokoll, Benutzerverwaltung): Sortierwert plus ID des
letzten gelieferten Datensatzes. Stabil bei gleichzeitigen Aenderungen, aber
ohne Seitenzahlen und ohne Gesamtzahl.

**Nummerierte Seiten** (Kunden, Projekte - ADR 0017): ``page``/``page_size``
mit ``total_items`` und ``total_pages``. Die Backoffice-Listen brauchen
"Seite 6 von 24" und den Sprung auf eine beliebige Seite; beides kann ein
Cursor nicht liefern. Der Preis ist bewusst akzeptiert: Aendert sich die Liste
zwischen zwei Seitenaufrufen, verschieben sich Eintraege um eine Position.

In beiden Mustern ist die ID der abschliessende Gleichstandsbrecher - ohne
sie waere die Reihenfolge bei gleichen Sortierwerten (zwei Kunden gleichen
Namens) nicht stabil.
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
from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.errors import ValidationFailedError

DEFAULT_LIMIT = 50
MAX_LIMIT = 200

#: Nummerierte Seiten: 25 Eintraege sind eine Bildschirmseite der Tabellen.
DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 100

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
    return order_with_tiebreaker(
        stmt, sort_column=sort_column, id_column=id_column, descending=descending
    )


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


# ------------------------------------------------------ Nummerierte Seiten


class NumberedPage[ItemT](BaseModel):
    """Eine nummerierte Seite samt Gesamtzahl (ADR 0017)."""

    items: list[ItemT]
    page: int = Field(
        description=(
            "Tatsaechlich gelieferte Seite, beginnend bei 1. Lag die angefragte Seite "
            "hinter der letzten, ist es die letzte vorhandene Seite."
        )
    )
    page_size: int
    total_items: int = Field(description="Treffer unter allen Filtern, nur eigener Betrieb.")
    total_pages: int = Field(description="0 bei leerer Treffermenge.")


@dataclass(frozen=True, slots=True)
class OffsetPage[RowT]:
    """Eine geladene nummerierte Seite - noch ohne Serialisierung."""

    items: Sequence[RowT]
    page: int
    page_size: int
    total_items: int
    total_pages: int


def order_with_tiebreaker[SelectT: Select[Any]](
    stmt: SelectT,
    *,
    sort_column: InstrumentedAttribute[Any],
    id_column: InstrumentedAttribute[Any],
    descending: bool,
) -> SelectT:
    """Stabile Reihenfolge: Sortierspalte, dann die ID in derselben Richtung."""
    if descending:
        return stmt.order_by(sort_column.desc(), id_column.desc())
    return stmt.order_by(sort_column.asc(), id_column.asc())


def count_pages(total_items: int, page_size: int) -> int:
    """Anzahl der Seiten; ``0`` bei leerer Treffermenge."""
    return -(-total_items // page_size)


def fetch_numbered_page[RowT](
    session: Session,
    stmt: Select[Any],
    *,
    page: int,
    page_size: int,
    load: Callable[[Select[Any]], Sequence[RowT]],
) -> OffsetPage[RowT]:
    """Zaehlt die Treffer und laedt genau eine Seite.

    **Zaehlung und Datenselektion benutzen dieselbe Abfrage.** Gezaehlt wird
    ueber ``stmt`` als Unterabfrage (ohne Sortierung) - jede Filter- und
    Mandantenbedingung, die die Seite einschraenkt, schraenkt damit auch die
    Gesamtzahl ein. Eine zweite, von Hand nachgebaute Zaehlabfrage koennte
    davon abweichen; genau das ist hier ausgeschlossen.

    ``stmt`` muss bereits sortiert sein (siehe :func:`order_with_tiebreaker`).

    Eine Seite hinter der letzten wird **auf die letzte vorhandene Seite**
    abgebildet, nicht mit einem Fehler beantwortet: Nach dem Loeschen des
    letzten Eintrags einer Seite oder einem engeren Filter landet die
    Oberflaeche so auf einer gueltigen Seite, statt auf einer dauerhaft
    leeren. Die Antwort nennt die tatsaechlich gelieferte Seite.
    """
    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total_items = int(session.execute(count_stmt).scalar_one())
    total_pages = count_pages(total_items, page_size)
    effective = max(1, min(page, total_pages))
    rows = load(stmt.limit(page_size).offset((effective - 1) * page_size))
    return OffsetPage(
        items=rows,
        page=effective,
        page_size=page_size,
        total_items=total_items,
        total_pages=total_pages,
    )
