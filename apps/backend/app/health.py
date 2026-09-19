"""Health-Endpunkte fuer Betrieb und Container-Orchestrierung."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Response, status
from pydantic import BaseModel
from sqlalchemy import text

from app.db.session import get_engine
from app.logging_config import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["health"])


class HealthStatus(BaseModel):
    status: Literal["ok", "degraded"]
    database: bool = True


@router.get("/health/live", operation_id="healthLive", summary="Liveness")
def live() -> HealthStatus:
    """Der Prozess laeuft. Keine Abhaengigkeiten werden geprueft."""
    return HealthStatus(status="ok")


@router.get("/health/ready", operation_id="healthReady", summary="Readiness")
def ready(response: Response) -> HealthStatus:
    """Der Prozess kann Anfragen bedienen - inklusive Datenbankverbindung."""
    try:
        with get_engine().connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:
        logger.warning("readiness_failed", error=type(exc).__name__)
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return HealthStatus(status="degraded", database=False)
    return HealthStatus(status="ok", database=True)
