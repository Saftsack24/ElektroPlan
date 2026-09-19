"""Ein- und Ausgabeschemas fuer Projekte, Gebaeude und Geschosse.

Geometrische Werte sind ganzzahlige Millimeter (ADR 0007). Die Grenzen sind
bauliche Plausibilitaetsgrenzen, keine Normvorgaben - ElektroPlan trifft keine
elektrotechnischen oder bauordnungsrechtlichen Entscheidungen
(docs/security.md, Abschnitt 17).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.customers.schemas import reject_explicit_null

ProjectStatus = Literal["draft", "active", "completed", "archived"]

#: Hoehenlage eines Geschosses: 200 m unter bis 1 km ueber dem Bezugspunkt.
MIN_ELEVATION_MM = -200_000
MAX_ELEVATION_MM = 1_000_000
#: Lichte Geschosshoehe: 1,50 m bis 20 m.
MIN_CEILING_HEIGHT_MM = 1_500
MAX_CEILING_HEIGHT_MM = 20_000
#: Geschossebene: 20 Unter- bis 200 Obergeschosse.
MIN_FLOOR_LEVEL = -20
MAX_FLOOR_LEVEL = 200


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ------------------------------------------------------------------ Projekt


class ProjectCreate(_Strict):
    """Neues Projekt. Die Projektnummer vergibt der Nummernkreis."""

    customer_id: uuid.UUID
    name: str = Field(min_length=1, max_length=200)
    site_street: str | None = Field(default=None, max_length=200)
    site_postal_code: str | None = Field(default=None, max_length=20)
    site_city: str | None = Field(default=None, max_length=120)
    site_country_code: str = Field(default="DE", min_length=2, max_length=2)


class ProjectUpdate(_Strict):
    """Teilaenderung.

    Weder Projektnummer noch Status stehen hier: Die Nummer ist der Bezug
    bestehender Belege, und ein Statuswechsel hat Vorbedingungen und laeuft
    ueber eigene Endpunkte (docs/api.md, Abschnitt 5).
    """

    customer_id: uuid.UUID | None = None
    name: str | None = Field(default=None, min_length=1, max_length=200)
    site_street: str | None = Field(default=None, max_length=200)
    site_postal_code: str | None = Field(default=None, max_length=20)
    site_city: str | None = Field(default=None, max_length=120)
    site_country_code: str | None = Field(default=None, min_length=2, max_length=2)

    #: In der Datenbank ``NOT NULL`` - aenderbar, aber nicht leerbar.
    _not_nullable = field_validator("customer_id", "name", "site_country_code")(
        reject_explicit_null
    )


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_number: str
    name: str
    status: ProjectStatus
    customer_id: uuid.UUID
    site_street: str | None
    site_postal_code: str | None
    site_city: str | None
    site_country_code: str
    version: int
    created_at: datetime
    updated_at: datetime


class ProjectSummary(BaseModel):
    """Listeneintrag - mit dem Kundennamen, damit die Liste ohne
    Folgeabfragen lesbar ist."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_number: str
    name: str
    status: ProjectStatus
    customer_id: uuid.UUID
    customer_name: str
    site_city: str | None
    version: int
    created_at: datetime


# ------------------------------------------------------------------ Gebaeude


class BuildingCreate(_Strict):
    name: str = Field(min_length=1, max_length=120)
    sort_order: int = Field(default=0, ge=0, le=9_999)


class BuildingUpdate(_Strict):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    sort_order: int | None = Field(default=None, ge=0, le=9_999)

    _not_nullable = field_validator("name", "sort_order")(reject_explicit_null)


class BuildingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    sort_order: int
    version: int
    created_at: datetime
    updated_at: datetime


# ----------------------------------------------------------------- Geschoss


class FloorCreate(_Strict):
    name: str = Field(min_length=1, max_length=120)
    level: int = Field(ge=MIN_FLOOR_LEVEL, le=MAX_FLOOR_LEVEL)
    elevation_mm: int = Field(default=0, ge=MIN_ELEVATION_MM, le=MAX_ELEVATION_MM)
    default_ceiling_height_mm: int = Field(
        default=2_500, ge=MIN_CEILING_HEIGHT_MM, le=MAX_CEILING_HEIGHT_MM
    )


class FloorUpdate(_Strict):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    level: int | None = Field(default=None, ge=MIN_FLOOR_LEVEL, le=MAX_FLOOR_LEVEL)
    elevation_mm: int | None = Field(default=None, ge=MIN_ELEVATION_MM, le=MAX_ELEVATION_MM)
    default_ceiling_height_mm: int | None = Field(
        default=None, ge=MIN_CEILING_HEIGHT_MM, le=MAX_CEILING_HEIGHT_MM
    )

    _not_nullable = field_validator("name", "level", "elevation_mm", "default_ceiling_height_mm")(
        reject_explicit_null
    )


class FloorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    building_id: uuid.UUID
    name: str
    level: int
    elevation_mm: int
    default_ceiling_height_mm: int
    version: int
    created_at: datetime
    updated_at: datetime
