"""Ein- und Ausgabeschemas des Fachmoduls ``electrical``.

Pydantic ist die einzige Quelle der Wahrheit fuer den HTTP-Vertrag; der
TypeScript-Client wird daraus erzeugt (ADR 0009). Geometrie ist ganzzahliges
Millimeter (ADR 0007), Flaechen in Quadratmeter gehen als **String** ueber die
Leitung (ADR 0005) - sie sind eine Menge, und JSON-Zahlen wuerden im Browser
zu Fliesskomma.

Die Grenzen sind bauliche Plausibilitaetsgrenzen, keine Normvorgaben:
ElektroPlan trifft keine bauordnungsrechtlichen oder elektrotechnischen
Entscheidungen (docs/security.md, Abschnitt 17).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.validation import reject_explicit_null
from app.modules.electrical.geometry import (
    DEFAULT_WALL_THICKNESS_MM,
    MAX_COORDINATE_MM,
    MAX_OPENING_SIZE_MM,
    MAX_ROOM_HEIGHT_MM,
    MAX_WALL_THICKNESS_MM,
    MIN_COORDINATE_MM,
    MIN_OPENING_SIZE_MM,
    MIN_ROOM_HEIGHT_MM,
    MIN_WALL_THICKNESS_MM,
)

OpeningKindValue = Literal["door", "window", "passage"]
ContourStatusValue = Literal["draft", "valid"]


def _coordinate(*, required: bool) -> Any:
    """Feldbeschreibung einer Koordinate in Millimetern.

    Als Fabrik, damit jedes Feld seine eigene ``FieldInfo`` erhaelt - eine
    gemeinsam genutzte Instanz waere ein geteilter Zustand.
    """
    if required:
        return Field(ge=MIN_COORDINATE_MM, le=MAX_COORDINATE_MM)
    return Field(default=None, ge=MIN_COORDINATE_MM, le=MAX_COORDINATE_MM)


class _Strict(BaseModel):
    """Unbekannte Felder werden abgelehnt, nicht stillschweigend verworfen."""

    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------------- Raum


class RoomCreate(_Strict):
    """Neuer Raum auf einem Geschoss.

    ``height_mm`` bleibt leer, wenn die Standardhoehe des Geschosses gilt.
    """

    name: str = Field(min_length=1, max_length=120)
    room_number: str | None = Field(default=None, min_length=1, max_length=30)
    height_mm: int | None = Field(default=None, ge=MIN_ROOM_HEIGHT_MM, le=MAX_ROOM_HEIGHT_MM)


class RoomUpdate(_Strict):
    """Teilaenderung eines Raums.

    Das Geschoss steht nicht hier: Ein Raum wechselt nicht das Geschoss - das
    waere ein neuer Raum. ``room_number`` und ``height_mm`` sind ausdruecklich
    leerbar (``null``), weil beide optional sind.
    """

    name: str | None = Field(default=None, min_length=1, max_length=120)
    room_number: str | None = Field(default=None, min_length=1, max_length=30)
    height_mm: int | None = Field(default=None, ge=MIN_ROOM_HEIGHT_MM, le=MAX_ROOM_HEIGHT_MM)

    #: In der Datenbank ``NOT NULL`` - aenderbar, aber nicht leerbar.
    _not_nullable = field_validator("name")(reject_explicit_null)


class RoomOut(BaseModel):
    """Ein Raum samt abgeleiteten Konturwerten.

    Flaeche, Umfang, Wandzahl und Konturzustand sind **berechnet** und nicht
    gespeichert (ADR 0013). Sie fehlen (``null``), solange die Kontur nicht
    geschlossen ist.
    """

    id: uuid.UUID
    floor_id: uuid.UUID
    name: str
    room_number: str | None
    #: Eigene Raumhoehe; ``null`` bedeutet "Standardhoehe des Geschosses".
    height_mm: int | None
    #: Tatsaechlich geltende Hoehe - eigene Angabe oder Geschossstandard.
    effective_height_mm: int
    contour_status: ContourStatusValue
    wall_count: int
    area_mm2: int | None
    #: Flaeche in Quadratmetern mit drei Nachkommastellen, als String.
    area_m2: str | None
    perimeter_mm: int | None
    version: int
    created_at: datetime
    updated_at: datetime


class GeometryProblemOut(BaseModel):
    """Ein Geometriefehler mit stabilem Code und deutscher Meldung."""

    code: str
    message: str
    #: IDs der betroffenen Waende, sofern zuordenbar.
    wall_ids: list[uuid.UUID] = Field(default_factory=list)


class RoomContourOut(BaseModel):
    """Pruefbericht zur Raumkontur.

    Reine Auskunft: Der Bericht aendert nichts. Der Zustand ``valid`` bedeutet,
    dass die Waende in ihrer Reihenfolge einen geschlossenen,
    ueberschneidungsfreien Polygonzug mit Flaeche bilden.
    """

    room_id: uuid.UUID
    contour_status: ContourStatusValue
    wall_count: int
    area_mm2: int | None
    area_m2: str | None
    perimeter_mm: int | None
    problems: list[GeometryProblemOut]


# ---------------------------------------------------------------------- Wand


class WallCreate(_Strict):
    """Neue Wand am Ende der Raumkontur.

    ``sort_order`` wird **nicht** entgegengenommen: Eine neue Wand haengt sich
    hinten an, Umordnen ist ein eigener Vorgang. Damit kann eine Anfrage keine
    Luecke und keine Dublette in der Reihenfolge erzeugen.
    """

    x1_mm: int = _coordinate(required=True)
    y1_mm: int = _coordinate(required=True)
    x2_mm: int = _coordinate(required=True)
    y2_mm: int = _coordinate(required=True)
    thickness_mm: int = Field(
        default=DEFAULT_WALL_THICKNESS_MM,
        ge=MIN_WALL_THICKNESS_MM,
        le=MAX_WALL_THICKNESS_MM,
    )


class WallUpdate(_Strict):
    """Teilaenderung einer Wand. Der Raum bleibt unveraendert."""

    x1_mm: int | None = _coordinate(required=False)
    y1_mm: int | None = _coordinate(required=False)
    x2_mm: int | None = _coordinate(required=False)
    y2_mm: int | None = _coordinate(required=False)
    thickness_mm: int | None = Field(
        default=None, ge=MIN_WALL_THICKNESS_MM, le=MAX_WALL_THICKNESS_MM
    )

    _not_nullable = field_validator("x1_mm", "y1_mm", "x2_mm", "y2_mm", "thickness_mm")(
        reject_explicit_null
    )


class WallOrder(_Strict):
    """Neue Reihenfolge der Waende eines Raums.

    Die Liste muss **alle** Waende des Raums genau einmal enthalten. Eine
    Teilliste waere mehrdeutig: Sie liesse offen, wohin die uebrigen Waende
    gehoeren.
    """

    wall_ids: list[uuid.UUID] = Field(min_length=1)


class WallOut(BaseModel):
    """Eine Wand samt ihrer gerundeten Laenge."""

    id: uuid.UUID
    room_id: uuid.UUID
    sort_order: int
    x1_mm: int
    y1_mm: int
    x2_mm: int
    y2_mm: int
    thickness_mm: int
    #: Laenge in ganzen Millimetern, kaufmaennisch gerundet (ADR 0013).
    length_mm: int
    opening_count: int
    version: int
    created_at: datetime
    updated_at: datetime


# ------------------------------------------------------------------ Oeffnung


class OpeningCreate(_Strict):
    """Neue Oeffnung in einer Wand."""

    kind: OpeningKindValue
    offset_mm: int = Field(ge=0, le=MAX_COORDINATE_MM)
    width_mm: int = Field(ge=MIN_OPENING_SIZE_MM, le=MAX_OPENING_SIZE_MM)
    height_mm: int = Field(ge=MIN_OPENING_SIZE_MM, le=MAX_OPENING_SIZE_MM)
    #: Nur beim Fenster groesser Null (docs/modules/electrical.md).
    sill_height_mm: int = Field(default=0, ge=0, le=MAX_OPENING_SIZE_MM)


class OpeningUpdate(_Strict):
    """Teilaenderung einer Oeffnung. Die Wand bleibt unveraendert."""

    kind: OpeningKindValue | None = None
    offset_mm: int | None = Field(default=None, ge=0, le=MAX_COORDINATE_MM)
    width_mm: int | None = Field(default=None, ge=MIN_OPENING_SIZE_MM, le=MAX_OPENING_SIZE_MM)
    height_mm: int | None = Field(default=None, ge=MIN_OPENING_SIZE_MM, le=MAX_OPENING_SIZE_MM)
    sill_height_mm: int | None = Field(default=None, ge=0, le=MAX_OPENING_SIZE_MM)

    _not_nullable = field_validator("kind", "offset_mm", "width_mm", "height_mm", "sill_height_mm")(
        reject_explicit_null
    )


class OpeningOut(BaseModel):
    """Eine Oeffnung in ihrer Wand."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    wall_id: uuid.UUID
    kind: OpeningKindValue
    offset_mm: int
    width_mm: int
    height_mm: int
    sill_height_mm: int
    version: int
    created_at: datetime
    updated_at: datetime
