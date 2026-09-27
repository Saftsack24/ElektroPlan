"""Oeffentliche Annahme einer Einladung (Phase 4.2, ADR 0015).

Diese Endpunkte verlangen **keine** Anmeldung - das Einladungs-Token ist der
Nachweis. Sie sind deshalb wie die Anmeldung geschuetzt:

* Fehlversuche je IP begrenzt (``429``),
* ein einheitlicher Fehler fuer jedes ungueltige Token (``invitation-invalid``),
* Herkunftspruefung wie bei den Sitzungsendpunkten,
* das Token steht im Anfragekoerper, nie in Pfad oder Query - es erscheint so
  in keinem Zugriffsprotokoll.

Sie setzen kein Cookie und stellen keine Sitzung aus: Nach der Annahme meldet
sich die Person regulaer an.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.core.audit import service as audit
from app.core.auth.dependencies import get_client_ip, require_trusted_origin
from app.core.invitations.service import AcceptanceResult, InvitationAcceptance
from app.core.members.schemas import (
    AcceptWithExistingAccount,
    AcceptWithNewAccount,
    InvitationAccepted,
    InvitationPreview,
    InvitationTokenIn,
)
from app.db.session import get_session
from app.errors import ProblemDetail

router = APIRouter(tags=["invitation-acceptance"])

_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"model": ProblemDetail, "description": "Einladung ungueltig (invitation-invalid)"},
    429: {"model": ProblemDetail, "description": "Zu viele Versuche"},
}


def _record(session: Session, result: AcceptanceResult) -> None:
    audit.record(
        session,
        organization_id=result.organization_id,
        action=audit.ACTION_INVITATION_ACCEPTED,
        entity_type="organization_member",
        entity_id=result.member_id,
        actor_user_id=result.user_id,
        summary="Einladung angenommen",
        data={"invitation_id": str(result.invitation_id)},
    )


@router.post(
    "/invitation-acceptance/preview",
    response_model=InvitationPreview,
    operation_id="previewInvitation",
    summary="Einladung pruefen",
    responses=_RESPONSES,
)
def preview_invitation(
    payload: InvitationTokenIn,
    request: Request,
    session: Session = Depends(get_session),
    _csrf: None = Depends(require_trusted_origin),
) -> InvitationPreview:
    """Zeigt dem Inhaber eines gueltigen Tokens Betrieb und E-Mail der Einladung.

    ``account_exists`` sagt, welcher Annahmeweg gilt. Aendert nichts.
    """
    data = InvitationAcceptance(session, client_ip=get_client_ip(request)).preview(payload.token)
    return InvitationPreview(
        organization_name=data.organization_name,
        email=data.email,
        full_name=data.full_name,
        expires_at=data.expires_at,
        account_exists=data.account_exists,
    )


@router.post(
    "/invitation-acceptance/new-account",
    response_model=InvitationAccepted,
    status_code=status.HTTP_201_CREATED,
    operation_id="acceptInvitationWithNewAccount",
    summary="Einladung mit neuem Konto annehmen",
    responses={
        **_RESPONSES,
        409: {
            "model": ProblemDetail,
            "description": "Konto existiert bereits (invitation-requires-login)",
        },
        422: {"model": ProblemDetail, "description": "Passwortregeln nicht erfuellt"},
    },
)
def accept_with_new_account(
    payload: AcceptWithNewAccount,
    request: Request,
    session: Session = Depends(get_session),
    _csrf: None = Depends(require_trusted_origin),
) -> InvitationAccepted:
    """Legt Konto und Mitgliedschaft in **einer** Transaktion an.

    Nur fuer eine E-Mail ohne bestehendes Konto. Es gelten die Passwortregeln
    der Anmeldung.
    """
    result = InvitationAcceptance(
        session, client_ip=get_client_ip(request)
    ).accept_with_new_account(payload.token, full_name=payload.full_name, password=payload.password)
    _record(session, result)
    session.commit()
    return InvitationAccepted(organization_name=result.organization_name, email=result.email)


@router.post(
    "/invitation-acceptance/existing-account",
    response_model=InvitationAccepted,
    status_code=status.HTTP_201_CREATED,
    operation_id="acceptInvitationWithExistingAccount",
    summary="Einladung mit bestehendem Konto annehmen",
    responses={
        **_RESPONSES,
        401: {"model": ProblemDetail, "description": "Anmeldedaten falsch"},
        409: {"model": ProblemDetail, "description": "Bereits Mitglied"},
    },
)
def accept_with_existing_account(
    payload: AcceptWithExistingAccount,
    request: Request,
    session: Session = Depends(get_session),
    _csrf: None = Depends(require_trusted_origin),
) -> InvitationAccepted:
    """Nimmt die Einladung mit dem Passwort des bestehenden Kontos an.

    Geprueft wird das Konto **der eingeladenen E-Mail**. Das Konto selbst wird
    nicht veraendert.
    """
    result = InvitationAcceptance(
        session, client_ip=get_client_ip(request)
    ).accept_with_existing_account(payload.token, password=payload.password)
    _record(session, result)
    session.commit()
    return InvitationAccepted(organization_name=result.organization_name, email=result.email)
