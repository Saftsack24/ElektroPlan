"""Unit of Work: eine Anfrage, eine Transaktion, Events nach dem Commit.

Request -> UoW oeffnen -> Service-Logik -> Events sammeln -> COMMIT
                                                               |
                                                -> Events zustellen (danach)
"""

from __future__ import annotations

from collections.abc import Generator, Iterator, Sequence
from contextlib import contextmanager
from types import TracebackType

from sqlalchemy.orm import Session

from app.contracts.v1.events import DomainEvent
from app.core.events.bus import EventBus, get_event_bus
from app.db.session import get_session_factory
from app.logging_config import get_logger

logger = get_logger(__name__)


class UnitOfWork:
    """Transaktionsklammer mit Event-Sammlung.

    Events werden ueber :meth:`add_event` gesammelt und erst in :meth:`commit`
    - nach erfolgreichem Datenbank-Commit - zugestellt. Ein Rollback verwirft
    die gesammelten Events, denn vor dem Commit ist nichts Tatsache.
    """

    def __init__(self, session: Session, bus: EventBus) -> None:
        self.session = session
        self._bus = bus
        self._pending: list[DomainEvent] = []

    @property
    def pending_events(self) -> Sequence[DomainEvent]:
        return tuple(self._pending)

    def add_event(self, event: DomainEvent) -> None:
        """Sammelt ein Event. Zustellung erfolgt erst nach dem Commit."""
        self._pending.append(event)

    def commit(self) -> None:
        """Committet die Transaktion und stellt danach die Events zu."""
        self.session.commit()
        events = tuple(self._pending)
        self._pending.clear()
        if events:
            self._bus.publish(events)

    def rollback(self) -> None:
        """Rollt zurueck und verwirft alle gesammelten Events."""
        self.session.rollback()
        self._pending.clear()

    def flush(self) -> None:
        """Schreibt anstehende Aenderungen, ohne zu committen."""
        self.session.flush()

    def __enter__(self) -> UnitOfWork:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        if exc_type is not None:
            self.rollback()


@contextmanager
def unit_of_work() -> Iterator[UnitOfWork]:
    """UoW fuer Skripte, Seeds und Tests."""
    session = get_session_factory()()
    uow = UnitOfWork(session, get_event_bus())
    try:
        yield uow
    except Exception:
        uow.rollback()
        raise
    finally:
        session.close()


def get_unit_of_work() -> Generator[UnitOfWork, None, None]:
    """FastAPI-Dependency.

    Committet **nicht** automatisch: Der Service entscheidet, wann eine
    Transaktion abgeschlossen ist.
    """
    session = get_session_factory()()
    uow = UnitOfWork(session, get_event_bus())
    try:
        yield uow
    except Exception:
        uow.rollback()
        raise
    finally:
        session.close()
