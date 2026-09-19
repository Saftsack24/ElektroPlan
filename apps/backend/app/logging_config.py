"""Strukturiertes JSON-Logging mit Request-Korrelation.

Nie geloggt werden Passwoerter, Tokens, vollstaendige Kundenadressen oder
Einkaufspreise (docs/security.md, Abschnitt 10).
"""

from __future__ import annotations

import logging
import sys
from contextvars import ContextVar

import structlog
from structlog.types import EventDict, WrappedLogger

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
user_id_var: ContextVar[str | None] = ContextVar("user_id", default=None)
organization_id_var: ContextVar[str | None] = ContextVar("organization_id", default=None)

_REDACTED = "***"
_SENSITIVE_KEYS = frozenset(
    {"password", "token", "access_token", "refresh_token", "secret", "authorization", "cookie"}
)


def _add_request_context(_logger: WrappedLogger, _name: str, event_dict: EventDict) -> EventDict:
    """Ergaenzt Request-, Benutzer- und Organisationskontext."""
    for key, var in (
        ("request_id", request_id_var),
        ("user_id", user_id_var),
        ("organization_id", organization_id_var),
    ):
        value = var.get()
        if value is not None:
            event_dict[key] = value
    return event_dict


def _redact_sensitive(_logger: WrappedLogger, _name: str, event_dict: EventDict) -> EventDict:
    """Maskiert bekannte sensible Schluessel."""
    for key in list(event_dict):
        if key.lower() in _SENSITIVE_KEYS:
            event_dict[key] = _REDACTED
    return event_dict


def configure_logging(*, debug: bool = False) -> None:
    """Richtet structlog und das Standard-Logging ein."""
    renderer: structlog.types.Processor = (
        structlog.dev.ConsoleRenderer() if debug else structlog.processors.JSONRenderer()
    )
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            _add_request_context,
            _redact_sensitive,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.DEBUG if debug else logging.INFO
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=logging.INFO)


def get_logger(name: str) -> structlog.types.FilteringBoundLogger:
    """Liefert einen benannten Logger."""
    logger: structlog.types.FilteringBoundLogger = structlog.get_logger(name)
    return logger
