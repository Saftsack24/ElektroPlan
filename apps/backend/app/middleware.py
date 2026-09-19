"""Request-Kontext, Zugriffsprotokollierung und Sicherheitsheader."""

from __future__ import annotations

import re
import time
import uuid
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.config import get_settings
from app.logging_config import get_logger, organization_id_var, request_id_var, user_id_var

logger = get_logger(__name__)

REQUEST_ID_HEADER = "X-Request-Id"
#: Eine vom Client gelieferte Request-ID wird uebernommen, aber nur in engen
#: Grenzen: Sie landet in Logs und Antworten und darf dort nichts einschleusen.
REQUEST_ID_MAX_LENGTH = 64
_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

#: Produktion: Diese API liefert ausschliesslich JSON aus - nichts wird
#: eingebettet, nichts wird nachgeladen.
_CSP_STRICT = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
#: Entwicklung: zusaetzlich die von Swagger UI (/docs) benoetigten Quellen.
#: In Produktion ist /docs abgeschaltet, dort gilt die strikte Variante.
_CSP_DOCS = (
    "default-src 'none'; "
    "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
    "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
    "img-src 'self' https://fastapi.tiangolo.com data:; "
    "connect-src 'self'; "
    "frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
)


def _sanitize_request_id(value: str | None) -> str:
    """Uebernimmt eine Client-Request-ID nur, wenn sie unbedenklich ist."""
    if value and _REQUEST_ID_PATTERN.match(value):
        return value
    return uuid.uuid4().hex


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Setzt Request-ID, protokolliert Dauer und Status jeder Anfrage."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = _sanitize_request_id(request.headers.get(REQUEST_ID_HEADER))
        token = request_id_var.set(request_id)
        user_token = user_id_var.set(None)
        org_token = organization_id_var.set(None)
        request.state.request_id = request_id
        started = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            # Bewusst ohne Query-String, Header oder Cookies: Dort koennten
            # Tokens stehen (docs/security.md, Abschnitt 10).
            logger.info(
                "request",
                method=request.method,
                path=request.url.path,
                duration_ms=duration_ms,
            )
            request_id_var.reset(token)
            user_id_var.reset(user_token)
            organization_id_var.reset(org_token)
        response.headers[REQUEST_ID_HEADER] = request_id
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Setzt die Sicherheitsheader (docs/security.md, Abschnitt 12).

    Zustaendigkeiten:

    * Diese Middleware sichert die **API**-Antworten ab.
    * Die Auslieferung des Planners erfolgt durch Vite bzw. spaeter durch einen
      Webserver; dessen CSP wird dort gesetzt, nicht hier.
    * ``Strict-Transport-Security`` wird nur in Produktion gesetzt. Terminiert
      TLS an einem Reverse Proxy, darf dieser den Header ebenfalls setzen - die
      Zustaendigkeit ist in ``docs/security.md`` festgehalten.
    """

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        settings = get_settings()
        response = await call_next(request)

        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        response.headers.setdefault(
            "Content-Security-Policy",
            _CSP_STRICT if settings.is_production else _CSP_DOCS,
        )
        if settings.is_production:
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        return response
