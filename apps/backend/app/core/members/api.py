"""Endpunkte der Benutzerverwaltung eines Betriebs (Phase 4.2, ADR 0015).

Alle Routen gelten ausschliesslich fuer den Betrieb aus dem Access Token.
Fremde oder unbekannte IDs liefern ``404`` - nicht unterscheidbar.

Berechtigungen (bestehende Schluessel, keine neuen):

* ``user.account.read``      Benutzerliste, Mitglied, Einladung lesen
* ``user.account.write``     einladen, widerrufen, erneut ausstellen, sperren
* ``role.assignment.read``   Systemrollen, Rollen und effektive Rechte lesen
* ``role.assignment.write``  Rollen vergeben

Eine Einladung vergibt Rollen und verlangt deshalb **beide**
Schreibberechtigungen.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.audit import service as audit
from app.core.auth.dependencies import CurrentUser, require_permission
from app.core.authorization.models import Role
from app.core.authorization.permissions import (
    ROLE_ASSIGNMENT_READ,
    ROLE_ASSIGNMENT_WRITE,
    USER_ACCOUNT_READ,
    USER_ACCOUNT_WRITE,
)
from app.core.authorization.service import list_system_roles, permission_area, role_permissions
from app.core.invitations.delivery import deliver
from app.core.invitations.service import InvitationService, InvitationView
from app.core.members.schemas import (
    DirectoryEntryOut,
    DirectoryStatus,
    EffectivePermissionOut,
    InvitationCreate,
    InvitationIssued,
    InvitationOut,
    InvitationPolicy,
    MemberOut,
    MemberPermissionsOut,
    MemberRolesUpdate,
    PermissionInfo,
    RoleRef,
    SystemRoleOut,
)
from app.core.members.service import Actor, MemberAdminService, MemberView
from app.core.module_registry.registry import ModuleRegistry, get_module_registry
from app.core.pagination import DEFAULT_LIMIT, Page, clamp_limit
from app.core.preconditions import require_if_match
from app.db.session import get_session
from app.errors import ProblemDetail

router = APIRouter(tags=["administration"])

_READ_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"model": ProblemDetail, "description": "Nicht gefunden"},
}
_WRITE_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"model": ProblemDetail, "description": "Nicht gefunden"},
    409: {
        "model": ProblemDetail,
        "description": (
            "Versionskonflikt, letzter Administrator (last-administrator), eigene "
            "Mitgliedschaft (self-lockout) oder unzulaessiger Zustand"
        ),
    },
    422: {"model": ProblemDetail, "description": "Unbekannte oder nicht vergebbare Rolle"},
    428: {"model": ProblemDetail, "description": "If-Match fehlt"},
}
_INVITE_RESPONSES: dict[int | str, dict[str, object]] = {
    **_WRITE_RESPONSES,
    503: {"model": ProblemDetail, "description": "Kein Zustellweg eingerichtet"},
}


def _role_refs(roles: list[Role]) -> list[RoleRef]:
    return [RoleRef(key=role.key, name=role.name) for role in roles]


def _actor(current_user: CurrentUser) -> Actor:
    return Actor(user_id=current_user.user_id, member_id=current_user.member_id)


def _member_out(view: MemberView, current_user: CurrentUser) -> MemberOut:
    return MemberOut(
        id=view.member.id,
        full_name=view.user.full_name,
        email=view.user.email,
        status="disabled" if view.member.status == "disabled" else "active",
        roles=_role_refs(view.roles),
        is_administrator=view.is_administrator,
        is_self=view.member.id == current_user.member_id,
        joined_at=view.member.created_at,
        last_login_at=view.member.last_login_at,
        version=view.member.version,
    )


def _invitation_out(view: InvitationView) -> InvitationOut:
    invitation = view.invitation
    return InvitationOut(
        id=invitation.id,
        email=invitation.email,
        full_name=invitation.full_name,
        status=view.status,
        roles=_role_refs(view.roles),
        expires_at=invitation.expires_at,
        created_at=invitation.created_at,
        version=invitation.version,
    )


def _issued(view: InvitationView, token: str) -> InvitationIssued:
    """Stellt zu und baut die Antwort. Das Token verlaesst die Funktion nur im Link."""
    result = deliver(get_settings(), token)
    return InvitationIssued(
        invitation=_invitation_out(view),
        delivery=result.mode,
        development_activation_url=result.development_activation_url,
    )


# ------------------------------------------------------------------- Rollen


@router.get(
    "/roles",
    response_model=list[SystemRoleOut],
    operation_id="listSystemRoles",
    summary="Feste Systemrollen",
)
def list_roles(
    current_user: CurrentUser = Depends(require_permission(ROLE_ASSIGNMENT_READ)),
    session: Session = Depends(get_session),
    registry: ModuleRegistry = Depends(get_module_registry),
) -> list[SystemRoleOut]:
    """Die ausgelieferten Systemrollen mit Einsatzzweck und Berechtigungen.

    Nur lesend: Rollen und die zentrale Permission-Registry sind in dieser
    Phase nicht bearbeitbar.
    """
    roles = list_system_roles(session, current_user.organization_id)
    permissions = role_permissions(session, [role.id for role in roles])
    return [
        SystemRoleOut(
            key=role.key,
            name=role.name,
            description=role.description,
            permissions=sorted(
                (
                    PermissionInfo(
                        key=permission.key,
                        description=permission.description,
                        area=permission_area(permission, registry),
                    )
                    for permission in permissions.get(role.id, [])
                ),
                key=lambda item: (item.area, item.key),
            ),
        )
        for role in roles
    ]


# ------------------------------------------------------------------ Mitglieder


@router.get(
    "/members",
    response_model=Page[DirectoryEntryOut],
    operation_id="listMembers",
    summary="Benutzer des Betriebs",
)
def list_members(
    current_user: CurrentUser = Depends(require_permission(USER_ACCOUNT_READ)),
    session: Session = Depends(get_session),
    q: str | None = Query(default=None, max_length=120, description="Name oder E-Mail"),
    member_status: DirectoryStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=200),
    cursor: str | None = Query(default=None),
) -> Page[DirectoryEntryOut]:
    """Mitgliedschaften und offene Einladungen, nach Name sortiert, seitenweise.

    ``status=invited`` zeigt nur offene (auch abgelaufene) Einladungen.
    """
    service = MemberAdminService(session, current_user.organization_id)
    page = service.list_entries(
        limit=clamp_limit(limit), cursor=cursor, search=q, status=member_status
    )
    return Page[DirectoryEntryOut](
        items=[
            DirectoryEntryOut(
                kind=entry.kind,
                id=entry.id,
                full_name=entry.full_name,
                email=entry.email,
                status=entry.status,
                roles=_role_refs(entry.roles),
                last_login_at=entry.last_login_at,
                invitation_expires_at=entry.invitation_expires_at,
                invitation_expired=entry.invitation_expired,
                version=entry.version,
            )
            for entry in page.items
        ],
        next_cursor=page.next_cursor,
        has_more=page.has_more,
    )


@router.get(
    "/members/{member_id}",
    response_model=MemberOut,
    operation_id="getMember",
    summary="Mitglied",
    responses=_READ_RESPONSES,
)
def get_member(
    member_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(USER_ACCOUNT_READ)),
    session: Session = Depends(get_session),
) -> MemberOut:
    """Eine Mitgliedschaft im aktuellen Betrieb."""
    view = MemberAdminService(session, current_user.organization_id).get(member_id)
    return _member_out(view, current_user)


@router.post(
    "/members/{member_id}/suspend",
    response_model=MemberOut,
    operation_id="suspendMember",
    summary="Zugang zu diesem Betrieb sperren",
    responses=_WRITE_RESPONSES,
)
def suspend_member(
    member_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(USER_ACCOUNT_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> MemberOut:
    """Sperrt den Zugang des Mitglieds zu **diesem** Betrieb.

    Das globale Konto und Mitgliedschaften in anderen Betrieben bleiben
    unberuehrt. Offene Sitzungen in diesem Betrieb enden sofort.
    """
    view = MemberAdminService(session, current_user.organization_id).suspend(
        member_id,
        expected_version=expected_version,
        actor=_actor(current_user),
        permission=USER_ACCOUNT_WRITE,
    )
    audit.record(
        session,
        organization_id=current_user.organization_id,
        action=audit.ACTION_MEMBER_SUSPENDED,
        entity_type="organization_member",
        entity_id=view.member.id,
        actor_user_id=current_user.user_id,
        summary="Zugang zum Betrieb gesperrt",
    )
    session.commit()
    return _member_out(view, current_user)


@router.post(
    "/members/{member_id}/reactivate",
    response_model=MemberOut,
    operation_id="reactivateMember",
    summary="Zugang zu diesem Betrieb wieder freigeben",
    responses=_WRITE_RESPONSES,
)
def reactivate_member(
    member_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(USER_ACCOUNT_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> MemberOut:
    """Gibt den Zugang zu diesem Betrieb wieder frei."""
    view = MemberAdminService(session, current_user.organization_id).reactivate(
        member_id,
        expected_version=expected_version,
        actor=_actor(current_user),
        permission=USER_ACCOUNT_WRITE,
    )
    audit.record(
        session,
        organization_id=current_user.organization_id,
        action=audit.ACTION_MEMBER_REACTIVATED,
        entity_type="organization_member",
        entity_id=view.member.id,
        actor_user_id=current_user.user_id,
        summary="Zugang zum Betrieb wieder freigegeben",
    )
    session.commit()
    return _member_out(view, current_user)


@router.get(
    "/members/{member_id}/permissions",
    response_model=MemberPermissionsOut,
    operation_id="getMemberPermissions",
    summary="Rollen und effektive Berechtigungen eines Mitglieds",
    responses=_READ_RESPONSES,
)
def get_member_permissions(
    member_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(ROLE_ASSIGNMENT_READ)),
    session: Session = Depends(get_session),
    registry: ModuleRegistry = Depends(get_module_registry),
) -> MemberPermissionsOut:
    """Zugewiesene Rollen und daraus folgende Berechtigungen samt Herkunft."""
    view, permissions = MemberAdminService(
        session, current_user.organization_id
    ).effective_permissions(member_id, registry)
    return MemberPermissionsOut(
        member_id=view.member.id,
        version=view.member.version,
        roles=_role_refs(view.roles),
        permissions=[
            EffectivePermissionOut(
                key=item.key,
                description=item.description,
                area=item.area,
                granted_by=_role_refs(item.granted_by),
            )
            for item in permissions
        ],
    )


@router.put(
    "/members/{member_id}/roles",
    response_model=MemberOut,
    operation_id="replaceMemberRoles",
    summary="Rollen eines Mitglieds ersetzen",
    responses=_WRITE_RESPONSES,
)
def replace_member_roles(
    member_id: uuid.UUID,
    payload: MemberRolesUpdate,
    current_user: CurrentUser = Depends(require_permission(ROLE_ASSIGNMENT_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> MemberOut:
    """Ersetzt die Systemrollen eines Mitglieds als Ganzes - atomar.

    ``If-Match`` traegt die Version der Mitgliedschaft. Die Aenderung wirkt ab
    der naechsten Anfrage des Mitglieds, ohne erneute Anmeldung.
    """
    change = MemberAdminService(session, current_user.organization_id).replace_roles(
        member_id,
        payload.role_keys,
        expected_version=expected_version,
        actor=_actor(current_user),
        permission=ROLE_ASSIGNMENT_WRITE,
    )
    if change.added or change.removed:
        audit.record(
            session,
            organization_id=current_user.organization_id,
            action=audit.ACTION_MEMBER_ROLES_CHANGED,
            entity_type="organization_member",
            entity_id=change.view.member.id,
            actor_user_id=current_user.user_id,
            summary="Rollen geaendert",
            data={"added": change.added, "removed": change.removed},
        )
    session.commit()
    return _member_out(change.view, current_user)


# ---------------------------------------------------------------- Einladungen


@router.get(
    "/invitations/policy",
    response_model=InvitationPolicy,
    operation_id="getInvitationPolicy",
    summary="Rahmen fuer Einladungen",
)
def get_invitation_policy(
    _: CurrentUser = Depends(require_permission(USER_ACCOUNT_READ)),
) -> InvitationPolicy:
    """Gueltigkeit und eingerichteter Zustellweg - fuer Hinweise im Dialog."""
    settings = get_settings()
    return InvitationPolicy(
        valid_hours=settings.invitation_valid_hours, delivery=settings.invitation_delivery
    )


@router.post(
    "/invitations",
    response_model=InvitationIssued,
    status_code=status.HTTP_201_CREATED,
    operation_id="createInvitation",
    summary="Benutzer einladen",
    responses=_INVITE_RESPONSES,
)
def create_invitation(
    payload: InvitationCreate,
    current_user: CurrentUser = Depends(require_permission(USER_ACCOUNT_WRITE)),
    session: Session = Depends(get_session),
) -> InvitationIssued:
    """Laedt eine E-Mail-Adresse mit festen Systemrollen in diesen Betrieb ein.

    Verlangt zusaetzlich ``role.assignment.write``: Die Einladung vergibt
    Rollen. Ohne eingerichteten Zustellweg wird nichts angelegt (``503``).
    """
    current_user.require(ROLE_ASSIGNMENT_WRITE)
    view, token = InvitationService(session, current_user.organization_id).create(
        email=payload.email,
        full_name=payload.full_name,
        role_keys=payload.role_keys,
        actor_user_id=current_user.user_id,
    )
    audit.record(
        session,
        organization_id=current_user.organization_id,
        action=audit.ACTION_INVITATION_CREATED,
        entity_type="member_invitation",
        entity_id=view.invitation.id,
        actor_user_id=current_user.user_id,
        summary="Einladung erstellt",
        data={"role_keys": sorted(role.key for role in view.roles)},
    )
    session.commit()
    return _issued(view, token)


@router.get(
    "/invitations/{invitation_id}",
    response_model=InvitationOut,
    operation_id="getInvitation",
    summary="Einladung",
    responses=_READ_RESPONSES,
)
def get_invitation(
    invitation_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(USER_ACCOUNT_READ)),
    session: Session = Depends(get_session),
) -> InvitationOut:
    """Eine Einladung dieses Betriebs - ohne Token und ohne Link."""
    return _invitation_out(
        InvitationService(session, current_user.organization_id).get(invitation_id)
    )


@router.post(
    "/invitations/{invitation_id}/revoke",
    response_model=InvitationOut,
    operation_id="revokeInvitation",
    summary="Einladung widerrufen",
    responses=_WRITE_RESPONSES,
)
def revoke_invitation(
    invitation_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(USER_ACCOUNT_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> InvitationOut:
    """Widerruft eine offene oder abgelaufene Einladung. Das Token wird wertlos."""
    view = InvitationService(session, current_user.organization_id).revoke(
        invitation_id, expected_version=expected_version
    )
    audit.record(
        session,
        organization_id=current_user.organization_id,
        action=audit.ACTION_INVITATION_REVOKED,
        entity_type="member_invitation",
        entity_id=view.invitation.id,
        actor_user_id=current_user.user_id,
        summary="Einladung widerrufen",
    )
    session.commit()
    return _invitation_out(view)


@router.post(
    "/invitations/{invitation_id}/reissue",
    response_model=InvitationIssued,
    operation_id="reissueInvitation",
    summary="Einladung erneut ausstellen",
    responses=_INVITE_RESPONSES,
)
def reissue_invitation(
    invitation_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(USER_ACCOUNT_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> InvitationIssued:
    """Stellt eine Einladung mit neuem Token und neuer Frist aus.

    Das bisherige Token ist danach ungueltig.
    """
    view, token = InvitationService(session, current_user.organization_id).reissue(
        invitation_id, expected_version=expected_version
    )
    audit.record(
        session,
        organization_id=current_user.organization_id,
        action=audit.ACTION_INVITATION_REISSUED,
        entity_type="member_invitation",
        entity_id=view.invitation.id,
        actor_user_id=current_user.user_id,
        summary="Einladung erneut ausgestellt",
    )
    session.commit()
    return _issued(view, token)
