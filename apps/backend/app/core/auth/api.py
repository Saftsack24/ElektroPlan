"""Endpunkte fuer Anmeldung, Sitzung und Benutzerkontext."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.auth.dependencies import (
    REFRESH_COOKIE_NAME,
    CurrentUser,
    get_client_ip,
    get_current_user,
    require_trusted_origin,
)
from app.core.auth.schemas import (
    LoginRequest,
    MeResponse,
    OrganizationSummary,
    RoleSummary,
    SwitchOrganizationRequest,
    TokenResponse,
)
from app.core.auth.service import AuthService, IssuedTokens
from app.core.authorization.service import list_member_roles
from app.core.organizations.models import Organization
from app.db.session import get_session
from app.errors import AuthenticationError, ProblemDetail

router = APIRouter(tags=["auth"])

_PROBLEM_RESPONSES: dict[int | str, dict[str, object]] = {
    401: {"model": ProblemDetail, "description": "Nicht angemeldet"},
    429: {"model": ProblemDetail, "description": "Zu viele Versuche"},
}


#: Enger Pfad: Das Cookie wird nur zu den Sitzungsendpunkten gesendet.
REFRESH_COOKIE_PATH = "/api/v1/auth"


def _set_refresh_cookie(response: Response, tokens: IssuedTokens) -> None:
    """Setzt das Refresh-Cookie.

    Der Refresh Token verlaesst den Server **ausschliesslich** hier. Er steht
    nicht im Antwortkoerper, damit JavaScript - und damit auch ein
    XSS-Angriff - ihn nicht lesen kann (docs/security.md, Abschnitt 3).
    """
    settings = get_settings()
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        tokens.refresh_token,
        max_age=settings.refresh_token_days * 24 * 3600,
        httponly=True,
        secure=settings.is_production,
        samesite="strict",
        path=REFRESH_COOKIE_PATH,
    )


def _clear_refresh_cookie(response: Response) -> None:
    """Loescht das Cookie mit denselben Attributen, mit denen es gesetzt wurde."""
    settings = get_settings()
    response.delete_cookie(
        REFRESH_COOKIE_NAME,
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        secure=settings.is_production,
        samesite="strict",
    )


def _read_refresh_cookie(request: Request) -> str:
    token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not token:
        raise AuthenticationError("Keine gueltige Sitzung vorhanden.")
    return token


def _to_token_response(tokens: IssuedTokens) -> TokenResponse:
    return TokenResponse(
        access_token=tokens.access_token,
        expires_in=tokens.expires_in,
        organization_id=tokens.organization_id,
    )


@router.post(
    "/auth/login",
    response_model=TokenResponse,
    operation_id="login",
    summary="Anmelden",
    responses=_PROBLEM_RESPONSES,
)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
    _csrf: None = Depends(require_trusted_origin),
) -> TokenResponse:
    """Meldet einen Benutzer an.

    Der Access Token steht in der Antwort, der Refresh Token ausschliesslich im
    HttpOnly-Cookie. Gehoert das Konto mehreren Betrieben an und wurde keiner
    gewaehlt, antwortet der Endpunkt mit ``409`` und der Auswahlliste.
    """
    service = AuthService(session)
    tokens = service.login(
        email=payload.email,
        password=payload.password,
        organization_id=payload.organization_id,
        user_agent=request.headers.get("User-Agent"),
        client_ip=get_client_ip(request),
    )
    session.commit()
    _set_refresh_cookie(response, tokens)
    return _to_token_response(tokens)


@router.post(
    "/auth/refresh",
    response_model=TokenResponse,
    operation_id="refreshSession",
    summary="Sitzung erneuern",
    responses=_PROBLEM_RESPONSES,
)
def refresh(
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
    _csrf: None = Depends(require_trusted_origin),
) -> TokenResponse:
    """Rotiert den Refresh Token und liefert einen neuen Access Token.

    Der Token wird ausschliesslich dem Cookie entnommen - es gibt keinen
    Anfragekoerper, in dem er stehen koennte.
    """
    service = AuthService(session)
    tokens = service.refresh(
        _read_refresh_cookie(request), user_agent=request.headers.get("User-Agent")
    )
    session.commit()
    _set_refresh_cookie(response, tokens)
    return _to_token_response(tokens)


@router.post(
    "/auth/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="logout",
    summary="Abmelden",
)
def logout(
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
    _csrf: None = Depends(require_trusted_origin),
) -> None:
    """Widerruft die Token-Familie serverseitig und loescht das Cookie."""
    AuthService(session).logout(request.cookies.get(REFRESH_COOKIE_NAME))
    session.commit()
    _clear_refresh_cookie(response)


@router.post(
    "/auth/switch-organization",
    response_model=TokenResponse,
    operation_id="switchOrganization",
    summary="Mandanten wechseln",
    responses=_PROBLEM_RESPONSES,
)
def switch_organization(
    payload: SwitchOrganizationRequest,
    request: Request,
    response: Response,
    current_user: CurrentUser = Depends(get_current_user),
    session: Session = Depends(get_session),
    _csrf: None = Depends(require_trusted_origin),
) -> TokenResponse:
    """Wechselt den aktiven Betrieb gegen eine gepruefte Mitgliedschaft."""
    service = AuthService(session)
    tokens = service.switch_organization(
        user_id=current_user.user_id,
        organization_id=payload.organization_id,
        user_agent=request.headers.get("User-Agent"),
    )
    session.commit()
    _set_refresh_cookie(response, tokens)
    return _to_token_response(tokens)


@router.get(
    "/me",
    response_model=MeResponse,
    operation_id="getCurrentUser",
    summary="Angemeldeter Benutzer",
)
def read_me(
    current_user: CurrentUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> MeResponse:
    """Benutzer, aktiver Mandant, Rollen und Berechtigungen."""
    organization = session.get(Organization, current_user.organization_id)
    if organization is None:  # pragma: no cover - durch Dependency ausgeschlossen
        from app.errors import NotFoundError

        raise NotFoundError("Betrieb nicht gefunden.")
    roles = list_member_roles(session, current_user.member_id)
    return MeResponse(
        user_id=current_user.user_id,
        email=current_user.email,
        full_name=current_user.full_name,
        organization=OrganizationSummary.model_validate(organization),
        member_id=current_user.member_id,
        roles=[RoleSummary.model_validate(role) for role in roles],
        permissions=sorted(current_user.permissions),
    )


@router.get(
    "/me/organizations",
    response_model=list[OrganizationSummary],
    operation_id="listMyOrganizations",
    summary="Eigene Betriebe",
)
def list_my_organizations(
    current_user: CurrentUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[OrganizationSummary]:
    """Alle Betriebe, in denen der Benutzer aktiv ist."""
    organizations = AuthService(session).list_memberships(current_user.user_id)
    return [OrganizationSummary.model_validate(org) for org in organizations]
