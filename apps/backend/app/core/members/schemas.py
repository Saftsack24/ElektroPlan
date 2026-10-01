"""Ein- und Ausgabeschemas der Benutzerverwaltung (Phase 4.2 und 4e)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ------------------------------------------------------------------- Rollen


class RoleRef(BaseModel):
    """Verweis auf eine Systemrolle."""

    key: str
    name: str


class PermissionInfo(BaseModel):
    key: str
    description: str
    #: Verstaendlicher Funktionsbereich, z. B. "Projekte" oder "Elektroplanung".
    area: str


class SystemRoleOut(BaseModel):
    """Eine feste Systemrolle mit Einsatzzweck und Berechtigungen."""

    key: str
    name: str
    description: str
    permissions: list[PermissionInfo]


# ---------------------------------------------------------- Mitgliederliste

DirectoryStatus = Literal["active", "disabled", "invited", "removed"]
MemberStatus = Literal["active", "disabled", "removed"]


class DirectoryEntryOut(BaseModel):
    """Eintrag der Benutzerliste: Mitgliedschaft **oder** offene Einladung.

    ``kind`` unterscheidet beides. ``id`` ist je nach Art die ID der
    Mitgliedschaft oder der Einladung. Ein entferntes Konto (``removed``)
    erscheint nur mit ``status=removed`` und **ohne** Name und E-Mail.
    """

    kind: Literal["member", "invitation"]
    id: uuid.UUID
    full_name: str | None
    email: str | None
    status: DirectoryStatus
    roles: list[RoleRef]
    last_login_at: datetime | None
    invitation_expires_at: datetime | None
    invitation_expired: bool
    created_at: datetime
    updated_at: datetime
    version: int


class MemberOut(BaseModel):
    """Eine Mitgliedschaft im aktuellen Betrieb.

    Enthaelt vom globalen Konto nur Name und E-Mail. Aenderbar sind sie nur,
    wenn das Konto keinem anderen Betrieb angehoert (``account_shared``,
    ADR 0021). Bei einem entfernten Konto sind beide ``None``.
    """

    id: uuid.UUID
    full_name: str | None
    email: str | None
    status: MemberStatus
    #: Optionaler Sperrgrund - nur bei ``disabled``.
    lock_reason: str | None
    roles: list[RoleRef]
    is_administrator: bool
    #: Die eigene Mitgliedschaft des Anfragenden - Sperren, Entfernen und
    #: Entzug der eigenen Administratorrolle sind dann ausgeschlossen.
    is_self: bool
    #: Einziger aktiver Administrator des Betriebs: sperren, entfernen und
    #: Entzug der Administratorrolle sind ausgeschlossen (serverseitig geprueft).
    is_last_active_administrator: bool
    #: Das Konto gehoert noch einem anderen Betrieb an: Name, E-Mail und
    #: Passwort sind hier nicht aenderbar.
    account_shared: bool
    joined_at: datetime
    updated_at: datetime
    last_login_at: datetime | None
    version: int


class MemberProfileUpdate(_Strict):
    """Name und/oder E-Mail-Adresse. Mindestens ein Feld."""

    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    email: EmailStr | None = None

    @model_validator(mode="after")
    def _mindestens_ein_feld(self) -> MemberProfileUpdate:
        if self.full_name is None and self.email is None:
            msg = "Mindestens Name oder E-Mail-Adresse angeben."
            raise ValueError(msg)
        return self


class MemberSuspend(_Strict):
    """Optionaler, kurzer Sperrgrund - ohne sensible Angaben."""

    reason: str | None = Field(default=None, max_length=200)


class MemberRemove(_Strict):
    """Bestaetigung: die aktuelle E-Mail-Adresse des Kontos."""

    confirm_email: str = Field(min_length=1, max_length=320)


class PasswordResetIssued(BaseModel):
    """Ergebnis eines vom Administrator ausgeloesten Resets.

    ``reset_url`` steht **nur in dieser Antwort** - er wird nicht gespeichert
    und ist spaeter nicht erneut abrufbar. Ein neuer Link macht ihn ungueltig.
    """

    member_id: uuid.UUID
    delivery: Literal["admin_link"]
    reset_url: str
    expires_at: datetime


class MemberRolesUpdate(_Strict):
    """Vollstaendige Liste der Systemrollen - ersetzt die bisherigen als Ganzes."""

    role_keys: list[str] = Field(min_length=1, max_length=20)


class EffectivePermissionOut(BaseModel):
    key: str
    description: str
    area: str
    #: Alle Rollen, die diese Berechtigung liefern.
    granted_by: list[RoleRef]


class MemberPermissionsOut(BaseModel):
    member_id: uuid.UUID
    version: int
    roles: list[RoleRef]
    permissions: list[EffectivePermissionOut]


# ---------------------------------------------------------------- Einladungen

InvitationStatus = Literal["pending", "expired", "accepted", "revoked"]


class InvitationCreate(_Strict):
    email: EmailStr
    full_name: str | None = Field(default=None, max_length=200)
    role_keys: list[str] = Field(min_length=1, max_length=20)


class InvitationOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str | None
    status: InvitationStatus
    roles: list[RoleRef]
    expires_at: datetime
    created_at: datetime
    version: int


class InvitationIssued(BaseModel):
    """Ergebnis von Anlage und erneuter Ausstellung.

    ``development_activation_url`` ist nur gesetzt, wenn der Server mit
    ``ELEKTROPLAN_INVITATION_DELIVERY=development_link`` laeuft - nie in
    Produktion. Der Link steht **nur in dieser Antwort**; er wird nicht
    gespeichert und ist spaeter nicht erneut abrufbar.
    """

    invitation: InvitationOut
    delivery: Literal["development_link"]
    development_activation_url: str | None = None


class InvitationPolicy(BaseModel):
    """Was die Oberflaeche vor dem Einladen wissen muss."""

    valid_hours: int
    delivery: Literal["none", "development_link"]


# --------------------------------------------------------- Annahme (oeffentlich)


class InvitationTokenIn(_Strict):
    token: str = Field(min_length=1, max_length=256)


class InvitationPreview(BaseModel):
    organization_name: str
    email: str
    full_name: str | None
    expires_at: datetime
    account_exists: bool


class AcceptWithNewAccount(_Strict):
    token: str = Field(min_length=1, max_length=256)
    full_name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=256)


class AcceptWithExistingAccount(_Strict):
    token: str = Field(min_length=1, max_length=256)
    password: str = Field(min_length=1, max_length=256)


class InvitationAccepted(BaseModel):
    organization_name: str
    email: str


# ------------------------------------------------ Passwort zuruecksetzen (oeffentlich)


class PasswordResetTokenIn(_Strict):
    token: str = Field(min_length=1, max_length=256)


class PasswordResetPreview(BaseModel):
    """Was der Inhaber eines gueltigen Links erfaehrt: nur die Ablaufzeit."""

    expires_at: datetime


class PasswordResetComplete(_Strict):
    token: str = Field(min_length=1, max_length=256)
    password: str = Field(min_length=1, max_length=256)
