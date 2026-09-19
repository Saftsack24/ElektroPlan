"""Event-Envelope (Contract v1).

Regeln aus docs/events.md:
- Vergangenheitsform, Schema ``<modul>.<aggregat>.<vorgang>``
- Ein Event ist eine Tatsache: unveraenderlich, nie widerrufen
- Payload enthaelt nur IDs und kleine Skalare, niemals personenbezogene Daten
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

EventPayload = dict[str, object]


def _new_event_id() -> uuid.UUID:
    return uuid.uuid4()


def _now() -> datetime:
    return datetime.now(tz=UTC)


@dataclass(frozen=True, slots=True)
class DomainEvent:
    """Unveraenderlicher Event-Envelope."""

    event_type: str
    organization_id: uuid.UUID
    aggregate_type: str
    aggregate_id: uuid.UUID
    event_version: int = 1
    payload: EventPayload = field(default_factory=dict)
    actor_user_id: uuid.UUID | None = None
    request_id: str | None = None
    event_id: uuid.UUID = field(default_factory=_new_event_id)
    occurred_at: datetime = field(default_factory=_now)

    def __post_init__(self) -> None:
        parts = self.event_type.split(".")
        if len(parts) < 3:
            msg = (
                f"Ungueltiger event_type {self.event_type!r}: erwartet <modul>.<aggregat>.<vorgang>"
            )
            raise ValueError(msg)
