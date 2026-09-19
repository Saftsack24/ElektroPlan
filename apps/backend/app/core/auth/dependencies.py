"""FastAPI-Dependencies fuer Authentifizierung und Autorisierung.

Jeder schreibende Endpunkt deklariert seine Permission explizit ueber
:func:`require_permission`. Ein Endpunkt ohne Deklaration gilt als Fehler und
wird von ``tests/test_authorization_coverage.py`` gemeldet.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from urllib.parse import urlsplit

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.auth.security import decode_access_token
from app.core.authorization.service import resolve_member_permissions
from app.core.organizations.models import MEMBER_STATUS_ACTIVE, Organization, OrganizationMember
from app.core.users.models import User
from app.db.session import get_session
from app.errors import (
    AuthenticationError,
    CsrfValidationError,
    PermissionDeniedError,
)
from app.logging_config import organization_id_var, user_id_var

REFRESH_COOKIE_NAME = "elektroplan_refresh"


@dataclass(frozen=True, slots=True)
class CurrentUser:
    """Der angemeldete Benutzer im Kontext seines aktiven Mandanten."""

    user_id: uuid.UUID
    organization_id: uuid.UUID
    member_id: uuid.UUID
    email: str
    full_name: str
    permissions: frozenset[str]

    def has(self, permission: str) -> bool:
        return permission in self.permissions

    def require(self, permission: str) -> None:
        if not self.has(permission):
            raise PermissionDeniedError(f"Fuer diese Aktion fehlt die Berechtigung {permission!r}.")


def _extract_bearer_token(request: Request) -> str:
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise AuthenticationError("Anmeldung erforderlich.")
    return token


def get_current_user(
    request: Request,
    session: Session = Depends(get_session),
) -> CurrentUser:
    """Prueft den Access Token und laedt Benutzer, Mandant und Berechtigungen.

    Der aktive Mandant stammt ausschliesslich aus dem geprueften Token - nie
    aus Header, Query oder Body (ADR 0006).
    """
    payload = decode_access_token(_extract_bearer_token(request))

    user = session.get(User, payload.user_id)
    if user is None or not user.is_active:
        raise AuthenticationError("Dieses Konto ist deaktiviert.")

    member = session.get(OrganizationMember, payload.member_id)
    if (
        member is None
        or member.user_id != user.id
        or member.organization_id != payload.organization_id
        or member.status != MEMBER_STATUS_ACTIVE
    ):
        raise AuthenticationError("Die Mitgliedschaft ist nicht mehr gueltig.")

    organization = session.get(Organization, payload.organization_id)
    if organization is None or organization.deleted_at is not None:
        raise AuthenticationError("Der Betrieb ist nicht verfuegbar.")

    user_id_var.set(str(user.id))
    organization_id_var.set(str(member.organization_id))

    return CurrentUser(
        user_id=user.id,
        organization_id=member.organization_id,
        member_id=member.id,
        email=user.email,
        full_name=user.full_name,
        permissions=resolve_member_permissions(session, member.id),
    )


class PermissionRequirement:
    """Aufrufbare Dependency, die eine Permission erzwingt.

    Als Klasse umgesetzt, damit Tests die geforderte Permission einer Route
    auslesen koennen.
    """

    def __init__(self, permission: str) -> None:
        self.permission = permission

    def __call__(self, current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        current_user.require(self.permission)
        return current_user

    def __repr__(self) -> str:
        return f"PermissionRequirement({self.permission!r})"


def require_permission(permission: str) -> PermissionRequirement:
    """Dependency-Factory: ``Depends(require_permission('audit.entry.read'))``."""
    return PermissionRequirement(permission)


def require_trusted_origin(request: Request) -> None:
    """CSRF-Schutz fuer cookiebasierte Endpunkte.

    Zweistufig (docs/security.md, Abschnitt 12):

    1. Das Refresh-Cookie ist ``SameSite=Strict`` - moderne Browser senden es
       bei siteuebergreifenden Anfragen ueberhaupt nicht mit.
    2. Zusaetzlich wird die Herkunft streng geprueft: Ist ein ``Origin``- oder
       ``Referer``-Header vorhanden, muss er zu den konfigurierten Origins
       passen.

    Fehlen beide Header, stammt die Anfrage nicht aus einem Browserkontext
    (Browser senden ``Origin`` bei zustandsaendernden Anfragen immer mit). Ein
    solcher Client kann kein CSRF-Opfer sein und wird zugelassen; das ist
    bewusst so entschieden und hier dokumentiert.
    """
    allowed = set(get_settings().cors_origin_list)
    origin = request.headers.get("Origin")
    if origin:
        if origin not in allowed:
            raise CsrfValidationError("Die Anfrage stammt von einer nicht erlaubten Herkunft.")
        return

    referer = request.headers.get("Referer")
    if referer:
        parsed = urlsplit(referer)
        referer_origin = f"{parsed.scheme}://{parsed.netloc}"
        if referer_origin not in allowed:
            raise CsrfValidationError("Die Anfrage stammt von einer nicht erlaubten Herkunft.")


def get_client_ip(request: Request) -> str | None:
    """Client-IP fuer Rate Limiting. Kein Vertrauen in Proxy-Header ohne Setup."""
    if request.client is None:
        return None
    return request.client.host
