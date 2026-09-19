"""Endpunkte der Module Registry."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.auth.dependencies import CurrentUser, get_current_user, require_permission
from app.core.authorization.permissions import MODULE_REGISTRY_READ
from app.core.module_registry.registry import ModuleRegistry, get_module_registry
from app.core.organizations.service import enabled_module_ids
from app.db.session import get_session

router = APIRouter(tags=["modules"])


class ModuleInfo(BaseModel):
    """Beschreibung eines registrierten Moduls."""

    id: str
    name: str
    version: str
    kind: str
    depends_on: list[str]
    permissions: list[str]


class ActiveModuleInfo(BaseModel):
    """Modul im Kontext der aktuellen Organisation und des Benutzers."""

    id: str
    name: str
    version: str
    kind: str
    enabled: bool


@router.get(
    "/modules",
    response_model=list[ModuleInfo],
    operation_id="listModules",
    summary="Registrierte Module",
)
def list_modules(
    _: CurrentUser = Depends(require_permission(MODULE_REGISTRY_READ)),
    registry: ModuleRegistry = Depends(get_module_registry),
) -> list[ModuleInfo]:
    """Alle im Backend registrierten Module."""
    return [
        ModuleInfo(
            id=module.id,
            name=module.name,
            version=module.version,
            kind=str(module.kind),
            depends_on=list(module.depends_on),
            permissions=list(module.permission_keys),
        )
        for module in registry.modules
    ]


@router.get(
    "/me/modules",
    response_model=list[ActiveModuleInfo],
    operation_id="listMyModules",
    summary="Aktive Module",
)
def list_my_modules(
    current_user: CurrentUser = Depends(get_current_user),
    registry: ModuleRegistry = Depends(get_module_registry),
    session: Session = Depends(get_session),
) -> list[ActiveModuleInfo]:
    """Module, die fuer den aktuellen Betrieb aktiv sind.

    Steuert die Sichtbarkeit im Frontend. Die eigentliche Absicherung bleibt
    serverseitig - ein ausgeblendeter Tab ist kein Zugriffsschutz.
    """
    active = enabled_module_ids(session, current_user.organization_id)
    return [
        ActiveModuleInfo(
            id=module.id,
            name=module.name,
            version=module.version,
            kind=str(module.kind),
            enabled=True,
        )
        for module in registry.modules
        if module.id in active
    ]
