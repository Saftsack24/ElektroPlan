"""FastAPI-Anwendungsfabrik.

Reihenfolge beim Start:
1. Logging konfigurieren
2. Module registrieren und pruefen (Verstoss => kein Start)
3. Event-Subscriptions verdrahten und Event-Graphen pruefen
4. Router einhaengen
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import health
from app.config import Settings, get_settings
from app.core import module as core_module
from app.core.events.bus import get_event_bus
from app.core.module_registry.registry import ModuleRegistry, get_module_registry
from app.errors import register_exception_handlers
from app.logging_config import configure_logging, get_logger
from app.middleware import RequestContextMiddleware, SecurityHeadersMiddleware
from app.modules import REGISTERED_MODULES

logger = get_logger(__name__)


def build_registry() -> ModuleRegistry:
    """Registriert alle Module und fuehrt die Startpruefungen aus."""
    registry = get_module_registry()
    registry.clear()
    registry.register(core_module.DESCRIPTOR)
    registry.register_all(REGISTERED_MODULES)
    registry.validate()
    return registry


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Start- und Abschaltlogik."""
    logger.info(
        "application_started",
        environment=get_settings().environment,
        modules=[module.id for module in get_module_registry().modules],
    )
    yield
    logger.info("application_stopped")


def create_app(settings: Settings | None = None) -> FastAPI:
    """Erzeugt die Anwendung."""
    settings = settings or get_settings()
    configure_logging(debug=settings.debug)

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description=(
            "Modulare Plattform fuer Elektrofachbetriebe. "
            "Geldbetraege und Mengen werden als Dezimal-String uebertragen (ADR 0005)."
        ),
        lifespan=lifespan,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url=None,
        openapi_url="/openapi.json" if not settings.is_production else None,
    )

    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-Id", "If-Match"],
        expose_headers=["X-Request-Id"],
    )

    register_exception_handlers(app)

    registry = build_registry()
    registry.wire_events(get_event_bus())
    registry.mount_routers(app, api_prefix=settings.api_prefix)

    app.include_router(health.router)
    return app


app = create_app()
