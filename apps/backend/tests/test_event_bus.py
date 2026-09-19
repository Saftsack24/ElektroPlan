"""Transaktionsverhalten des Event Bus (ADR 0004).

Die drei nicht verhandelbaren Eigenschaften:
1. Kein Event vor dem Commit.
2. Ein Handler-Fehler beschaedigt die Arbeit des Ausloesers nicht.
3. Die Kette bleibt flach und zyklusfrei.
"""

from __future__ import annotations

import uuid
from typing import Any, ClassVar

import pytest

from app.contracts.v1.events import DomainEvent
from app.core.events.bus import (
    EventBus,
    EventBusConfigurationError,
    Subscription,
)
from app.core.events.models import (
    HANDLER_STATUS_FAILED,
    HANDLER_STATUS_OK,
    HANDLER_STATUS_PARTIAL,
    DomainEventRecord,
)
from app.core.events.uow import UnitOfWork

ORG_ID = uuid.uuid4()


def make_event(event_type: str = "core.project.created", **payload: Any) -> DomainEvent:
    return DomainEvent(
        event_type=event_type,
        organization_id=ORG_ID,
        aggregate_type="project",
        aggregate_id=uuid.uuid4(),
        payload=payload,
    )


class FakeSession:
    """Minimale Session-Attrappe - der Bus braucht keine echte Datenbank."""

    store: ClassVar[dict[uuid.UUID, DomainEventRecord]] = {}

    def __init__(self) -> None:
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def add(self, obj: object) -> None:
        if isinstance(obj, DomainEventRecord):
            FakeSession.store[obj.id] = obj

    def get(self, _model: type, key: uuid.UUID) -> DomainEventRecord | None:
        return FakeSession.store.get(key)

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        self.rolled_back = True

    def close(self) -> None:
        self.closed = True


@pytest.fixture(autouse=True)
def _clear_store() -> None:
    FakeSession.store = {}


@pytest.fixture
def bus() -> EventBus:
    return EventBus(session_factory=FakeSession)  # type: ignore[arg-type]


# ---------------------------------------------------- Unit of Work / Commit


def test_kein_event_vor_dem_commit(bus: EventBus) -> None:
    delivered: list[str] = []
    bus.subscribe(
        Subscription("core.project.created", lambda e, _s: delivered.append(e.event_type), "h")
    )
    session = FakeSession()
    uow = UnitOfWork(session, bus)  # type: ignore[arg-type]

    uow.add_event(make_event())

    assert delivered == []
    assert uow.pending_events


def test_zustellung_nach_dem_commit(bus: EventBus) -> None:
    delivered: list[str] = []
    bus.subscribe(
        Subscription("core.project.created", lambda e, _s: delivered.append(e.event_type), "h")
    )
    session = FakeSession()
    uow = UnitOfWork(session, bus)  # type: ignore[arg-type]

    uow.add_event(make_event())
    uow.commit()

    assert delivered == ["core.project.created"]
    assert session.committed
    assert not uow.pending_events


def test_rollback_verwirft_events(bus: EventBus) -> None:
    delivered: list[str] = []
    bus.subscribe(
        Subscription("core.project.created", lambda e, _s: delivered.append(e.event_type), "h")
    )
    session = FakeSession()
    uow = UnitOfWork(session, bus)  # type: ignore[arg-type]

    uow.add_event(make_event())
    uow.rollback()
    uow.commit()

    assert delivered == []
    assert session.rolled_back


def test_context_manager_rollt_bei_fehler_zurueck(bus: EventBus) -> None:
    session = FakeSession()
    with (
        pytest.raises(ValueError, match="fachlicher Fehler"),
        UnitOfWork(session, bus) as uow,  # type: ignore[arg-type]
    ):
        uow.add_event(make_event())
        raise ValueError("fachlicher Fehler")
    assert session.rolled_back


# ------------------------------------------------------------ Fehlerisolierung


def test_handler_fehler_bricht_den_ausloeser_nicht_ab(bus: EventBus) -> None:
    def failing(_event: DomainEvent, _session: Any) -> None:
        raise RuntimeError("Handler kaputt")

    bus.subscribe(Subscription("core.project.created", failing, "failing"))
    session = FakeSession()
    uow = UnitOfWork(session, bus)  # type: ignore[arg-type]
    uow.add_event(make_event())

    uow.commit()  # darf nicht werfen

    assert session.committed


def test_handler_fehler_wird_protokolliert(bus: EventBus) -> None:
    def failing(_event: DomainEvent, _session: Any) -> None:
        raise RuntimeError("Handler kaputt")

    bus.subscribe(Subscription("core.project.created", failing, "failing"))
    event = make_event()
    bus.publish([event])

    record = FakeSession.store[event.event_id]
    assert record.handler_status == HANDLER_STATUS_FAILED
    assert "Handler kaputt" in (record.handler_error or "")


def test_teilweiser_fehler_wird_als_partial_vermerkt(bus: EventBus) -> None:
    def failing(_event: DomainEvent, _session: Any) -> None:
        raise RuntimeError("kaputt")

    bus.subscribe(Subscription("core.project.created", failing, "failing"))
    bus.subscribe(Subscription("core.project.created", lambda _e, _s: None, "ok"))
    event = make_event()

    bus.publish([event])

    assert FakeSession.store[event.event_id].handler_status == HANDLER_STATUS_PARTIAL


def test_event_ohne_handler_ist_ok(bus: EventBus) -> None:
    event = make_event()
    bus.publish([event])
    assert FakeSession.store[event.event_id].handler_status == HANDLER_STATUS_OK


def test_ein_defekter_handler_stoppt_die_anderen_nicht(bus: EventBus) -> None:
    seen: list[str] = []

    def failing(_event: DomainEvent, _session: Any) -> None:
        raise RuntimeError("kaputt")

    bus.subscribe(Subscription("core.project.created", failing, "failing"))
    bus.subscribe(Subscription("core.project.created", lambda _e, _s: seen.append("zweiter"), "b"))

    bus.publish([make_event()])

    assert seen == ["zweiter"]


# ------------------------------------------------------------ Folge-Events


def test_folgeebene_wird_zugestellt(bus: EventBus) -> None:
    seen: list[str] = []

    def first(_event: DomainEvent, _session: Any) -> list[DomainEvent]:
        return [make_event("materials.requirements.updated")]

    bus.subscribe(
        Subscription(
            "core.project.created",
            first,
            "first",
            emits=("materials.requirements.updated",),
        )
    )
    bus.subscribe(
        Subscription(
            "materials.requirements.updated", lambda e, _s: seen.append(e.event_type), "second"
        )
    )

    bus.publish([make_event()])

    assert seen == ["materials.requirements.updated"]


def test_dritte_ebene_wird_nicht_zugestellt(bus: EventBus) -> None:
    """Maximal eine Folgeebene (docs/events.md, Abschnitt 5)."""
    seen: list[str] = []

    bus.subscribe(
        Subscription(
            "core.project.created",
            lambda _e, _s: [make_event("materials.requirements.updated")],
            "first",
        )
    )
    bus.subscribe(
        Subscription(
            "materials.requirements.updated",
            lambda _e, _s: [make_event("calculation.calculation.finalized")],
            "second",
        )
    )
    bus.subscribe(
        Subscription(
            "calculation.calculation.finalized", lambda e, _s: seen.append(e.event_type), "third"
        )
    )

    bus.publish([make_event()])

    assert seen == []


# --------------------------------------------------------------- Validierung


def test_zyklus_verhindert_den_start(bus: EventBus) -> None:
    bus.subscribe(Subscription("a.b.created", lambda _e, _s: None, "h1", emits=("c.d.updated",)))
    bus.subscribe(Subscription("c.d.updated", lambda _e, _s: None, "h2", emits=("a.b.created",)))

    with pytest.raises(EventBusConfigurationError, match="Zyklus"):
        bus.validate()


def test_zu_tiefe_kette_verhindert_den_start(bus: EventBus) -> None:
    bus.subscribe(Subscription("a.b.created", lambda _e, _s: None, "h1", emits=("c.d.updated",)))
    bus.subscribe(Subscription("c.d.updated", lambda _e, _s: None, "h2", emits=("e.f.updated",)))
    bus.subscribe(Subscription("e.f.updated", lambda _e, _s: None, "h3", emits=("g.h.updated",)))

    with pytest.raises(EventBusConfigurationError, match="zu tief"):
        bus.validate()


def test_flacher_graph_ist_gueltig(bus: EventBus) -> None:
    bus.subscribe(Subscription("a.b.created", lambda _e, _s: None, "h1", emits=("c.d.updated",)))
    bus.subscribe(Subscription("c.d.updated", lambda _e, _s: None, "h2"))
    bus.validate()


# ------------------------------------------------------------------ Envelope


def test_event_type_muss_dem_schema_folgen() -> None:
    with pytest.raises(ValueError, match="Ungueltiger event_type"):
        DomainEvent(
            event_type="projectCreated",
            organization_id=ORG_ID,
            aggregate_type="project",
            aggregate_id=uuid.uuid4(),
        )


def test_event_ist_unveraenderlich() -> None:
    event = make_event()
    with pytest.raises(AttributeError):
        event.event_type = "anderes.event.type"  # type: ignore[misc]
