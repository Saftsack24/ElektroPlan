"""Ein- und Ausgabeschemas des Kundenstamms."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.validation import reject_explicit_null

CustomerKind = Literal["private", "company"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CustomerCreate(_Strict):
    """Neuer Kunde. Die Kundennummer vergibt der Nummernkreis."""

    kind: CustomerKind = "private"
    name: str = Field(min_length=1, max_length=200)
    contact_person: str | None = Field(default=None, max_length=200)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=40)
    billing_street: str | None = Field(default=None, max_length=200)
    billing_postal_code: str | None = Field(default=None, max_length=20)
    billing_city: str | None = Field(default=None, max_length=120)
    billing_country_code: str = Field(default="DE", min_length=2, max_length=2)


class CustomerUpdate(_Strict):
    """Teilaenderung. Nicht gesetzte Felder bleiben unveraendert.

    Die Kundennummer ist nicht aenderbar: Sie ist der Bezug bestehender
    Belege (docs/security.md, Abschnitt 13, Punkt 4).
    """

    kind: CustomerKind | None = None
    name: str | None = Field(default=None, min_length=1, max_length=200)
    contact_person: str | None = Field(default=None, max_length=200)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=40)
    billing_street: str | None = Field(default=None, max_length=200)
    billing_postal_code: str | None = Field(default=None, max_length=20)
    billing_city: str | None = Field(default=None, max_length=120)
    billing_country_code: str | None = Field(default=None, min_length=2, max_length=2)

    #: Diese Felder sind in der Datenbank ``NOT NULL`` - sie lassen sich
    #: aendern, aber nicht leeren.
    _not_nullable = field_validator("kind", "name", "billing_country_code")(reject_explicit_null)


class CustomerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_number: str
    kind: CustomerKind
    name: str
    contact_person: str | None
    email: str | None
    phone: str | None
    billing_street: str | None
    billing_postal_code: str | None
    billing_city: str | None
    billing_country_code: str
    anonymized_at: datetime | None
    version: int
    created_at: datetime
    updated_at: datetime
