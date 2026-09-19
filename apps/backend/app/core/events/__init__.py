"""Interner Event Bus und Unit of Work (ADR 0004)."""

from app.core.events.bus import (
    MAX_EVENT_LEVELS,
    EventBus,
    EventBusConfigurationError,
    EventHandler,
    Subscription,
    get_event_bus,
)
from app.core.events.models import DomainEventRecord
from app.core.events.uow import UnitOfWork, get_unit_of_work, unit_of_work

__all__ = [
    "MAX_EVENT_LEVELS",
    "DomainEventRecord",
    "EventBus",
    "EventBusConfigurationError",
    "EventHandler",
    "Subscription",
    "UnitOfWork",
    "get_event_bus",
    "get_unit_of_work",
    "unit_of_work",
]
