"""Events des Fachmoduls ``electrical``.

**Genau ein Event.** ``electrical.plan.updated`` steht seit Phase 0 im
Eventkatalog (docs/events.md, Abschnitt 6) und hat dort einen benannten Zweck:
Der Materialbedarf eines Projekts koennte veraltet sein. ``change_kind``
unterscheidet, was sich geaendert hat; ein eigener Eventname je Tabelle waere
eine Namensschwemme ohne zusaetzliche Aussage.

**Grenzen, ausdruecklich benannt:**

* Das Event ist eine **Benachrichtigung**, keine Zusage. Die Zustellung ist
  *at most once*; ``domain_events`` ist keine transaktionale Outbox (ADR 0012).
  Keine fachlich notwendige Wirkung haengt davon ab.
* In Phase 3 gibt es **keinen** Empfaenger - ``materials`` entsteht erst in
  Phase 7. Bis dahin ist der Nutzen die Nachvollziehbarkeit im
  Ereignisprotokoll ("wer hat wann welchen Raum geaendert").
* Die verbindliche Neuberechnung laeuft spaeter ueber den Recompute-Endpunkt
  des Materialmoduls, nicht ueber dieses Event.
* Die Nutzlast enthaelt ausschliesslich IDs und einen kurzen Schluessel -
  keine Namen, keine Raumnummern, keine personenbezogenen Daten.

Fuer den reinen Pruefbericht der Kontur entsteht **kein** Event: Er aendert
nichts, und ein Event ist eine Tatsache (docs/events.md, Abschnitt 2).
"""

from __future__ import annotations

import uuid
from enum import StrEnum

from app.contracts.v1.events import DomainEvent

#: Stabiler, namespaceter Eventname.
PLAN_UPDATED = "electrical.plan.updated"
#: Schemaversion der Nutzlast. Additive Ergaenzungen erhoehen sie nicht;
#: eine brechende Aenderung schon (docs/events.md, Abschnitt 2).
PLAN_UPDATED_VERSION = 1


class PlanChangeKind(StrEnum):
    """Was sich am Planungsstand geaendert hat."""

    ROOM_CREATED = "room_created"
    ROOM_UPDATED = "room_updated"
    ROOM_DELETED = "room_deleted"
    WALLS_CHANGED = "walls_changed"
    OPENINGS_CHANGED = "openings_changed"


def plan_updated(
    *,
    organization_id: uuid.UUID,
    project_id: uuid.UUID,
    floor_id: uuid.UUID,
    room_id: uuid.UUID,
    change_kind: PlanChangeKind,
    actor_user_id: uuid.UUID | None = None,
) -> DomainEvent:
    """Baut das Event. Zugestellt wird es erst nach dem Commit (UoW)."""
    return DomainEvent(
        event_type=PLAN_UPDATED,
        event_version=PLAN_UPDATED_VERSION,
        organization_id=organization_id,
        aggregate_type="project",
        aggregate_id=project_id,
        actor_user_id=actor_user_id,
        payload={
            "project_id": str(project_id),
            "floor_id": str(floor_id),
            "room_id": str(room_id),
            "change_kind": change_kind.value,
        },
    )
