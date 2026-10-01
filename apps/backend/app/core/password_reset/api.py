"""Oeffentliche Einloesung eines Reset-Links (Phase 4e, ADR 0021).

Diese Endpunkte verlangen **keine** Anmeldung - der Einmal-Link ist der
Nachweis. Sie sind deshalb wie die Annahme einer Einladung geschuetzt:

* Fehlversuche je IP begrenzt (``429``),
* **ein** Fehler fuer jedes ungueltige Token (``password-reset-invalid``),
* Herkunftspruefung (``Origin``/``Referer``) wie bei den Sitzungsendpunkten,
* das Token steht im Anfragekoerper, nie in Pfad oder Query.

Sie lesen und setzen **kein** Cookie und stellen keine Sitzung aus: Nach dem
Setzen des Passworts meldet sich die Person regulaer an. Eine bestehende
Sitzung im selben Browser endet mit dem Widerruf aller Sitzungen.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.core.audit import service as audit
from app.core.auth.dependencies import get_client_ip, require_trusted_origin
from app.core.members.schemas import (
    PasswordResetComplete,
    PasswordResetPreview,
    PasswordResetTokenIn,
)
from app.core.password_reset.service import PasswordResetRedemption
from app.db.session import get_session
from app.errors import ProblemDetail

router = APIRouter(tags=["password-reset"])

_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"model": ProblemDetail, "description": "Link ungueltig (password-reset-invalid)"},
    429: {"model": ProblemDetail, "description": "Zu viele Versuche"},
}


@router.post(
    "/password-reset/preview",
    response_model=PasswordResetPreview,
    operation_id="previewPasswordReset",
    summary="Reset-Link pruefen",
    responses=_RESPONSES,
)
def preview_password_reset(
    payload: PasswordResetTokenIn,
    request: Request,
    session: Session = Depends(get_session),
    _csrf: None = Depends(require_trusted_origin),
) -> PasswordResetPreview:
    """Prueft den Link, ohne etwas zu aendern. Verraet nur die Ablaufzeit."""
    expires_at = PasswordResetRedemption(session, client_ip=get_client_ip(request)).preview(
        payload.token
    )
    return PasswordResetPreview(expires_at=expires_at)


@router.post(
    "/password-reset/complete",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="completePasswordReset",
    summary="Neues Passwort mit dem Einmal-Link setzen",
    responses={
        **_RESPONSES,
        422: {"model": ProblemDetail, "description": "Passwortregeln nicht erfuellt"},
    },
)
def complete_password_reset(
    payload: PasswordResetComplete,
    request: Request,
    session: Session = Depends(get_session),
    _csrf: None = Depends(require_trusted_origin),
) -> None:
    """Setzt das Passwort, verbraucht den Link und beendet alle Sitzungen - atomar.

    Es gelten die Passwortregeln der Anmeldung. Ein zu schwaches Passwort
    verbraucht den Link nicht.
    """
    result = PasswordResetRedemption(session, client_ip=get_client_ip(request)).complete(
        payload.token, password=payload.password
    )
    audit.record(
        session,
        organization_id=result.organization_id,
        action=audit.ACTION_PASSWORD_RESET_COMPLETED,
        entity_type="organization_member",
        entity_id=result.member_id,
        actor_user_id=result.user_id,
        summary="Passwort ueber Einmal-Link neu gesetzt",
    )
    session.commit()
