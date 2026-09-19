"""Ein- und Ausgabeschemas der Authentifizierung."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LoginRequest(_Strict):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)
    organization_id: uuid.UUID | None = Field(
        default=None, description="Optional, wenn der Benutzer mehreren Betrieben angehoert."
    )


class SwitchOrganizationRequest(_Strict):
    organization_id: uuid.UUID


class TokenResponse(BaseModel):
    """Antwort des Webflows.

    Enthaelt **keinen** Refresh Token: Der liegt ausschliesslich im
    HttpOnly-Cookie und ist fuer JavaScript nicht lesbar. Wuerde er zusaetzlich
    im JSON stehen, waere der HttpOnly-Schutz gegen XSS wirkungslos
    (docs/security.md, Abschnitt 3).

    Die spaetere Baustellen-App erhaelt einen ausdruecklich getrennten mobilen
    Tokenflow mit sicherem Geraetespeicher - nicht dieses Schema.
    """

    access_token: str
    token_type: str = "bearer"  # noqa: S105 - OAuth-Typbezeichnung
    expires_in: int
    organization_id: uuid.UUID


class OrganizationSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str


class RoleSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    name: str


class MeResponse(BaseModel):
    """Benutzer, aktiver Mandant, Rollen und Berechtigungen."""

    user_id: uuid.UUID
    email: str
    full_name: str
    organization: OrganizationSummary
    member_id: uuid.UUID
    roles: list[RoleSummary]
    permissions: list[str]
