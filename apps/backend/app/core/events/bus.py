"""Interner Event Bus (ADR 0012, ersetzt die Outbox-Aussage aus ADR 0004).

Kernregeln:

- Events werden waehrend der Unit of Work nur gesammelt, nie sofort zugestellt.
- Zustellung erfolgt **nach** erfolgreichem Commit, synchron, im selben Prozess.
- Handler laufen in eigenen Transaktionen und duerfen nicht in die Transaktion
  des Ausloesers zurueckwirken.
- Zustellung ist *at most once*. Jede eventgetriebene Ableitung braucht
  zusaetzlich einen idempotenten Recompute-Endpunkt.

**Dies ist keine transaktionale Outbox.** Der Fachzustand wird zuerst
committet; das Event wird danach in einer eigenen Transaktion protokolliert.
Stuerzt der Prozess dazwischen ab, geht das Event verloren. ``domain_events``
ist deshalb ein Best-Effort-Ereignisprotokoll fuer Nachvollziehbarkeit und
Fehlersuche - keine Zustellgarantie. Keine fachlich notwendige Wirkung darf
allein davon abhaengen.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from functools import lru_cache

from sqlalchemy.orm import Session

from app.contracts.v1.events import DomainEvent
from app.core.events.models import (
    HANDLER_STATUS_FAILED,
    HANDLER_STATUS_OK,
    HANDLER_STATUS_PARTIAL,
    HANDLER_STATUS_PENDING,
    DomainEventRecord,
)
from app.logging_config import get_logger

logger = get_logger(__name__)

#: Ein Handler erhaelt das Event und eine eigene Session und darf Folge-Events
#: zurueckgeben. Er wirft nicht nach aussen - Fehler werden vom Bus behandelt.
EventHandler = Callable[[DomainEvent, Session], Sequence[DomainEvent] | None]

#: Maximale Anzahl Event-Ebenen: Ausloeser + genau eine Folgeebene.
MAX_EVENT_LEVELS = 2


class EventBusConfigurationError(RuntimeError):
    """Ungueltige Bus-Konfiguration. Verhindert den Start der Anwendung."""


@dataclass(frozen=True, slots=True)
class Subscription:
    """Registrierung eines Handlers fuer einen Event-Typ."""

    event_type: str
    handler: EventHandler
    name: str
    #: Event-Typen, die dieser Handler auslesen darf - fuer die Zykluspruefung.
    emits: tuple[str, ...] = field(default=())


class EventBus:
    """Synchroner In-Process-Bus mit Post-Commit-Zustellung."""

    def __init__(self, session_factory: Callable[[], Session]) -> None:
        self._session_factory = session_factory
        self._subscriptions: dict[str, list[Subscription]] = {}

    # ------------------------------------------------------------------ Setup

    def subscribe(self, subscription: Subscription) -> None:
        self._subscriptions.setdefault(subscription.event_type, []).append(subscription)

    def subscribe_all(self, subscriptions: Iterable[Subscription]) -> None:
        for subscription in subscriptions:
            self.subscribe(subscription)

    def clear(self) -> None:
        self._subscriptions.clear()

    def handlers_for(self, event_type: str) -> tuple[Subscription, ...]:
        return tuple(self._subscriptions.get(event_type, ()))

    def validate(self) -> None:
        """Prueft den Event-Graphen auf Zyklen und zu tiefe Ketten.

        Wird beim Start aufgerufen. Ein Verstoss verhindert den Start, damit ein
        falsch verdrahteter Bus nicht "irgendwie" laeuft.
        """
        graph: dict[str, set[str]] = {}
        for event_type, subscriptions in self._subscriptions.items():
            targets = graph.setdefault(event_type, set())
            for subscription in subscriptions:
                targets.update(subscription.emits)

        visiting: set[str] = set()
        visited: set[str] = set()

        def walk(node: str, depth: int) -> None:
            # Zyklus zuerst pruefen: Ein Zyklus ueberschreitet zwangslaeufig auch
            # die Tiefe, ist aber die aussagekraeftigere Diagnose.
            if node in visiting:
                msg = f"Zyklus im Event-Graphen entdeckt bei {node!r}."
                raise EventBusConfigurationError(msg)
            if depth > MAX_EVENT_LEVELS:
                msg = (
                    f"Event-Kette zu tief bei {node!r}: maximal {MAX_EVENT_LEVELS} Ebenen "
                    "erlaubt (docs/events.md, Abschnitt 5)."
                )
                raise EventBusConfigurationError(msg)
            if node in visited:
                return
            visiting.add(node)
            for target in graph.get(node, ()):
                walk(target, depth + 1)
            visiting.discard(node)
            visited.add(node)

        for event_type in list(graph):
            visited.clear()
            walk(event_type, 1)

    # --------------------------------------------------------------- Zustellung

    def publish(self, events: Sequence[DomainEvent]) -> None:
        """Stellt Events zu. Wird ausschliesslich nach einem Commit aufgerufen."""
        self._publish_level(events, level=1)

    def _publish_level(self, events: Sequence[DomainEvent], *, level: int) -> None:
        if not events:
            return
        if level > MAX_EVENT_LEVELS:
            logger.error(
                "event_chain_too_deep",
                level=level,
                event_types=[event.event_type for event in events],
            )
            return

        follow_ups: list[DomainEvent] = []
        for event in events:
            follow_ups.extend(self._deliver(event))
        self._publish_level(follow_ups, level=level + 1)

    def _deliver(self, event: DomainEvent) -> list[DomainEvent]:
        """Protokolliert ein Event und ruft seine Handler auf."""
        self._record(event)
        subscriptions = self._subscriptions.get(event.event_type, [])
        if not subscriptions:
            self._update_status(event, HANDLER_STATUS_OK, None)
            return []

        follow_ups: list[DomainEvent] = []
        failures: list[str] = []
        for subscription in subscriptions:
            try:
                emitted = self._run_handler(subscription, event)
            except Exception as exc:
                # Ein Handler-Fehler darf die bereits erfolgreiche Arbeit des
                # Ausloesers nicht beschaedigen. Er wird protokolliert, nicht geworfen.
                logger.exception(
                    "event_handler_failed",
                    event_type=event.event_type,
                    handler=subscription.name,
                    error=type(exc).__name__,
                )
                failures.append(f"{subscription.name}: {type(exc).__name__}: {exc}")
            else:
                follow_ups.extend(emitted)

        if not failures:
            self._update_status(event, HANDLER_STATUS_OK, None)
        elif len(failures) == len(subscriptions):
            self._update_status(event, HANDLER_STATUS_FAILED, " | ".join(failures))
        else:
            self._update_status(event, HANDLER_STATUS_PARTIAL, " | ".join(failures))
        return follow_ups

    def _run_handler(self, subscription: Subscription, event: DomainEvent) -> Sequence[DomainEvent]:
        """Fuehrt einen Handler in einer eigenen Transaktion aus."""
        session = self._session_factory()
        try:
            emitted = subscription.handler(event, session)
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()
        return emitted or ()

    # ------------------------------------------------------------- Protokoll

    def _record(self, event: DomainEvent) -> None:
        session = self._session_factory()
        try:
            session.add(
                DomainEventRecord(
                    id=event.event_id,
                    organization_id=event.organization_id,
                    event_type=event.event_type,
                    event_version=event.event_version,
                    aggregate_type=event.aggregate_type,
                    aggregate_id=event.aggregate_id,
                    payload=dict(event.payload),
                    actor_user_id=event.actor_user_id,
                    request_id=event.request_id,
                    occurred_at=event.occurred_at,
                    handler_status=HANDLER_STATUS_PENDING,
                )
            )
            session.commit()
        except Exception:
            session.rollback()
            logger.exception("event_record_failed", event_type=event.event_type)
        finally:
            session.close()

    def _update_status(self, event: DomainEvent, status: str, error: str | None) -> None:
        session = self._session_factory()
        try:
            record = session.get(DomainEventRecord, event.event_id)
            if record is not None:
                record.handler_status = status
                record.handler_error = error[:4000] if error else None
                session.commit()
        except Exception:
            session.rollback()
            logger.exception("event_status_update_failed", event_type=event.event_type)
        finally:
            session.close()


@lru_cache(maxsize=1)
def get_event_bus() -> EventBus:
    """Prozessweiter Bus."""
    from app.db.session import get_session_factory

    return EventBus(session_factory=lambda: get_session_factory()())
