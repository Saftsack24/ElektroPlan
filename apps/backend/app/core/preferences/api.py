"""Eigene persoenliche Einstellungen (Phase 4e, ADR 0021).

Ohne Pfadparameter: Mandant und Mitgliedschaft stammen ausschliesslich aus
dem Access Token. Eine fremde Einstellung ist ueber diese API nicht
adressierbar - weder lesend noch schreibend, auch nicht fuer Administratoren.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.auth.dependencies import CurrentUser, get_current_user, require_permission
from app.core.authorization.permissions import USER_PREFERENCES_WRITE
from app.core.preconditions import require_if_match
from app.core.preferences.models import (
    DEFAULT_ACCENT,
    DEFAULT_LENGTH_UNIT,
    DEFAULT_THEME_MODE,
    UserPreferences,
)
from app.core.preferences.schemas import PreferencesIn, PreferencesOut
from app.core.preferences.service import PreferencesService
from app.db.session import get_session
from app.errors import ProblemDetail

router = APIRouter(tags=["preferences"])


def _service(session: Session, current_user: CurrentUser) -> PreferencesService:
    return PreferencesService(
        session, organization_id=current_user.organization_id, member_id=current_user.member_id
    )


def _out(record: UserPreferences) -> PreferencesOut:
    # Die Datenbank laesst nur bekannte Werte zu (CHECK); Pydantic prueft erneut.
    return PreferencesOut.model_validate(
        {
            "stored": True,
            "theme_mode": record.theme_mode,
            "accent": record.accent,
            "length_unit": record.length_unit,
            "version": record.version,
        }
    )


@router.get(
    "/me/preferences",
    response_model=PreferencesOut,
    operation_id="getMyPreferences",
    summary="Eigene Einstellungen",
)
def get_my_preferences(
    current_user: CurrentUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PreferencesOut:
    """Der gespeicherte Stand - oder die Standardwerte mit ``stored=false``.

    Bewusst ``200`` statt ``404``: "noch nichts gespeichert" ist der
    regulaere Zustand nach der ersten Anmeldung, kein Fehler.
    """
    record = _service(session, current_user).get()
    if record is None:
        return PreferencesOut.model_validate(
            {
                "stored": False,
                "theme_mode": DEFAULT_THEME_MODE,
                "accent": DEFAULT_ACCENT,
                "length_unit": DEFAULT_LENGTH_UNIT,
                "version": 0,
            }
        )
    return _out(record)


@router.post(
    "/me/preferences",
    response_model=PreferencesOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createMyPreferences",
    summary="Eigene Einstellungen erstmalig speichern",
    responses={
        409: {
            "model": ProblemDetail,
            "description": "Es gibt bereits einen Serverstand (preferences-exist)",
        },
        422: {"model": ProblemDetail, "description": "Unbekannter Wert"},
    },
)
def create_my_preferences(
    payload: PreferencesIn,
    current_user: CurrentUser = Depends(require_permission(USER_PREFERENCES_WRITE)),
    session: Session = Depends(get_session),
) -> PreferencesOut:
    """Legt den Serverstand an - nur, solange es noch keinen gibt.

    Fuer die einmalige Uebernahme eines alten lokalen Stands und fuer das
    erste Speichern. Existiert bereits einer, gewinnt er (``409``).
    """
    record = _service(session, current_user).create(payload)
    session.commit()
    return _out(record)


@router.put(
    "/me/preferences",
    response_model=PreferencesOut,
    operation_id="replaceMyPreferences",
    summary="Eigene Einstellungen aendern",
    responses={
        404: {"model": ProblemDetail, "description": "Noch kein Serverstand"},
        409: {"model": ProblemDetail, "description": "Versionskonflikt (anderes Geraet)"},
        422: {"model": ProblemDetail, "description": "Unbekannter Wert"},
        428: {"model": ProblemDetail, "description": "If-Match fehlt"},
    },
)
def replace_my_preferences(
    payload: PreferencesIn,
    current_user: CurrentUser = Depends(require_permission(USER_PREFERENCES_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> PreferencesOut:
    """Ersetzt den Serverstand als Ganzes - nur mit der aktuellen Version."""
    record = _service(session, current_user).replace(payload, expected_version=expected_version)
    session.commit()
    return _out(record)
