"""Fehlerbehandlung nach RFC 9457 (Problem Details).

Regeln aus docs/api.md, Abschnitt 3:
- ``Content-Type: application/problem+json``
- ``type`` ist stabil und maschinenlesbar; Clients werten ``type`` aus, nicht ``title``
- keine Stacktraces, keine SQL-Fehler, keine internen Pfade nach aussen
- ``request_id`` in jeder Antwort
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.logging_config import get_logger, request_id_var

logger = get_logger(__name__)

ERROR_BASE_URI = "https://elektroplan.internal/errors"
PROBLEM_CONTENT_TYPE = "application/problem+json"


class ProblemFieldError(BaseModel):
    """Einzelner Feldfehler innerhalb einer Problemantwort."""

    field: str
    code: str
    message: str


class OrganizationChoice(BaseModel):
    """Auswaehlbarer Betrieb beim Mehrmandanten-Login."""

    id: str
    name: str


class ProblemDetail(BaseModel):
    """Antwortkoerper nach RFC 9457."""

    type: str = Field(examples=[f"{ERROR_BASE_URI}/not-found"])
    title: str
    status: int
    detail: str | None = None
    instance: str | None = None
    request_id: str | None = None
    errors: list[ProblemFieldError] | None = None
    #: Nur bei ``organization-selection-required``: die Betriebe, aus denen der
    #: Client waehlen kann.
    organizations: list[OrganizationChoice] | None = None


class AppError(Exception):
    """Basisklasse aller fachlichen Fehler.

    Jede Unterklasse legt ``error_type`` (stabiler Schluessel), ``title`` und
    ``status_code`` fest.
    """

    error_type: str = "internal-error"
    title: str = "Interner Fehler"
    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR

    def __init__(
        self,
        detail: str | None = None,
        *,
        errors: list[ProblemFieldError] | None = None,
        organizations: list[OrganizationChoice] | None = None,
    ) -> None:
        super().__init__(detail or self.title)
        self.detail = detail
        self.errors = errors
        self.organizations = organizations

    def to_problem(self, instance: str | None = None) -> ProblemDetail:
        return ProblemDetail(
            type=f"{ERROR_BASE_URI}/{self.error_type}",
            title=self.title,
            status=self.status_code,
            detail=self.detail,
            instance=instance,
            request_id=request_id_var.get(),
            errors=self.errors,
            organizations=self.organizations,
        )


class NotFoundError(AppError):
    """Objekt existiert nicht - oder gehoert zu einer anderen Organisation.

    Beide Faelle liefern bewusst dieselbe Antwort (docs/api.md, Abschnitt 3).
    """

    error_type = "not-found"
    title = "Nicht gefunden"
    status_code = status.HTTP_404_NOT_FOUND


class AuthenticationError(AppError):
    error_type = "authentication-failed"
    title = "Nicht angemeldet"
    status_code = status.HTTP_401_UNAUTHORIZED


class PermissionDeniedError(AppError):
    error_type = "permission-denied"
    title = "Keine Berechtigung"
    status_code = status.HTTP_403_FORBIDDEN


class ConflictError(AppError):
    error_type = "conflict"
    title = "Fachlicher Konflikt"
    status_code = status.HTTP_409_CONFLICT


class VersionConflictError(ConflictError):
    error_type = "version-conflict"
    title = "Versionskonflikt"


class ValidationFailedError(AppError):
    error_type = "validation-failed"
    title = "Ungueltige Eingabe"
    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT


class RateLimitedError(AppError):
    error_type = "rate-limited"
    title = "Zu viele Anfragen"
    status_code = status.HTTP_429_TOO_MANY_REQUESTS


class OrganizationSelectionRequiredError(ConflictError):
    """Der Benutzer gehoert mehreren Betrieben an und hat keinen gewaehlt."""

    error_type = "organization-selection-required"
    title = "Betrieb auswaehlen"


class RefreshConflictError(AuthenticationError):
    """Parallele Erneuerung derselben Sitzung.

    Genau eine Anfrage erzeugt den Nachfolger; die uebrigen erhalten diesen
    Fehler. Die Sitzung bleibt gueltig - im Gegensatz zur echten
    Wiederverwendung eines laengst ersetzten Tokens.
    """

    error_type = "refresh-conflict"
    title = "Sitzung wird bereits erneuert"


class CsrfValidationError(AppError):
    """Herkunft der Anfrage passt nicht zu den erlaubten Origins."""

    error_type = "csrf-validation-failed"
    title = "Ungueltige Anfrageherkunft"
    status_code = status.HTTP_403_FORBIDDEN


class MissingTenantContextError(AppError):
    """Zugriff ohne Organisationskontext - Programmierfehler, nie Benutzerfehler."""

    error_type = "missing-tenant-context"
    title = "Kein Organisationskontext"
    status_code = status.HTTP_500_INTERNAL_SERVER_ERROR


def _problem_response(problem: ProblemDetail) -> JSONResponse:
    payload: dict[str, Any] = problem.model_dump(exclude_none=True)
    return JSONResponse(
        status_code=problem.status,
        content=payload,
        media_type=PROBLEM_CONTENT_TYPE,
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Haengt alle Fehler-Handler in die Anwendung ein."""

    @app.exception_handler(AppError)
    async def _app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        if exc.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
            logger.error("app_error", error_type=exc.error_type, detail=exc.detail)
        return _problem_response(exc.to_problem(instance=request.url.path))

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        field_errors = [
            ProblemFieldError(
                field=".".join(str(part) for part in error["loc"][1:]) or "body",
                code=str(error["type"]),
                message=str(error["msg"]),
            )
            for error in exc.errors()
        ]
        problem = ValidationFailedError(
            "Die Anfrage enthaelt ungueltige Werte.", errors=field_errors
        ).to_problem(instance=request.url.path)
        return _problem_response(problem)

    @app.exception_handler(StarletteHTTPException)
    async def _http_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        problem = ProblemDetail(
            type=f"{ERROR_BASE_URI}/http-{exc.status_code}",
            title=str(exc.detail),
            status=exc.status_code,
            instance=request.url.path,
            request_id=request_id_var.get(),
        )
        return _problem_response(problem)

    @app.exception_handler(Exception)
    async def _unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
        # Details bleiben im Serverlog, die Antwort bleibt generisch.
        logger.exception("unhandled_exception", path=request.url.path, error=type(exc).__name__)
        problem = ProblemDetail(
            type=f"{ERROR_BASE_URI}/internal-error",
            title="Interner Fehler",
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Es ist ein unerwarteter Fehler aufgetreten.",
            instance=request.url.path,
            request_id=request_id_var.get(),
        )
        return _problem_response(problem)
