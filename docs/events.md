# Domain Events und interner Event Bus

Version: 1.0 (Phase 0)
Verbindliche Entscheidung: [ADR 0004](decisions/0004-internal-event-bus.md)

---

## 1. Wann ein Event — und wann nicht

Events sind **kein** Standardkommunikationsmittel. Sie sind die Ausnahme für echte
Entkopplung.

| Situation | Mittel |
|---|---|
| Ich brauche jetzt ein Ergebnis | **Service-Contract** (synchroner Aufruf) |
| Ich brauche eine garantierte Wirkung | **Service-Contract** |
| Ich muss wissen, ob es geklappt hat | **Service-Contract** |
| Etwas ist passiert; wer will, reagiert | **Domain Event** |
| Ich weiß nicht, wer reagieren soll (und will es nicht wissen) | **Domain Event** |

**Faustregel:** Wenn dich interessiert, *ob* der Empfänger etwas getan hat, ist es kein
Event, sondern ein Aufruf.

### Verbotene Muster

```python
# FALSCH — Event als Befehl
publish("inventory.reserve_material", {...})

# RICHTIG — Befehl ist ein Aufruf
inventory.reserve(ctx, ReservationRequest(...))
```

```python
# FALSCH — Event transportiert ein ganzes Aggregat
publish(ProjectUpdated(project=project_dict_mit_50_feldern))

# RICHTIG — Event transportiert IDs und wenige Skalare
publish(ProjectUpdated(aggregate_id=project.id, changed_fields=("name",)))
```

---

## 2. Envelope

```python
@dataclass(frozen=True, slots=True)
class DomainEvent:
    event_id: UUID
    event_type: str            # "<modul>.<aggregat>.<vorgang im Perfekt>"
    event_version: int
    organization_id: UUID
    occurred_at: datetime      # UTC
    aggregate_type: str
    aggregate_id: UUID
    actor_user_id: UUID | None
    request_id: str | None
    payload: dict[str, object]
```

Namensregeln:

- Vergangenheitsform, immer: `electrical.plan.updated`, nicht `electrical.plan.update`.
- Schema `<modul>.<aggregat>.<vorgang>`.
- Ein Event ist eine **Tatsache**. Tatsachen werden nicht abgelehnt und nicht widerrufen.

---

## 3. Lebenszyklus

```
┌─ Request ────────────────────────────────────────────────┐
│ UoW öffnen                                               │
│   Service-Logik                                          │
│   uow.add_event(ElectricalPlanUpdated(...))   ← sammeln  │
│   Service-Logik                                          │
│ COMMIT  ✔                                                │
└──────────────────────┬───────────────────────────────────┘
                       │ erst jetzt
        ┌──────────────▼───────────────┐
        │ in domain_events schreiben   │
        │ Handler synchron aufrufen    │
        │ Fehler loggen, nicht werfen  │
        └──────────────────────────────┘
```

Drei Regeln, die nicht verhandelbar sind:

1. **Kein Event vor dem Commit.** Ein Event beschreibt eine Tatsache; vor dem Commit ist
   nichts Tatsache.
2. **Kein Handler-Fehler wirkt auf den Auslöser zurück.** Der Auslöser hat seine Arbeit
   getan; ein Folgefehler darf sie nicht zerstören.
3. **Handler laufen in eigenen Transaktionen.**

---

## 4. Zustellgarantie und die Recompute-Pflicht

> Die Zustellung ist **at most once**. Stürzt der Prozess zwischen Commit und Zustellung
> ab, ist das Event verloren.

Daraus folgt die wichtigste Regel dieses Dokuments:

> **Jede eventgetriebene Ableitung muss zusätzlich als idempotenter, direkt aufrufbarer
> Befehl existieren.**

| Ableitung | Event (bequem) | Befehl (verbindlich) |
|---|---|---|
| Materialbedarf | `electrical.plan.updated` | `POST /api/v1/projects/{id}/material-requirements/recompute` |
| Kalkulation veraltet | `materials.requirements.updated` | `POST /api/v1/calculations/{id}/check-stale` |
| Lagerreservierung | — | immer nur synchron über `InventoryService` |

Bestandsbuchungen, Reservierungen, Angebotsfreigaben und Auftragsstatus laufen **nie** über
Events. Alles, was Geld oder Bestand verändert, ist ein synchroner Aufruf mit Ergebnis.

---

## 5. Regeln für Handler

| Regel | Begründung |
|---|---|
| Idempotent | Ein Handler muss doppelte Zustellung (auch manuell) schadlos überstehen |
| Kurz | Läuft synchron im Request-Thread nach dem Commit |
| Keine Exceptions nach außen | Fehler werden in `domain_events.handler_status` protokolliert |
| Maximal eine Folgeebene | Ein Handler darf ein Event auslösen, dessen Handler keins mehr auslöst |
| Keine Zyklen | Beim Start geprüft: Event-Graph muss azyklisch sein |
| Registriert im `ModuleDescriptor` | Keine versteckten Handler irgendwo im Code |

```python
subscriptions=(
    Subscription(event_type="electrical.plan.updated",
                 handler="mark_material_requirements_stale"),
)
```

---

## 6. Event-Katalog (Phase 0 geplant)

| Event | Ausgelöst von | Payload (Auszug) | Reaktion |
|---|---|---|---|
| `core.project.created` | projects | `project_id`, `customer_id` | Audit |
| `core.project.archived` | projects | `project_id` | Fachmodule können aufräumen |
| `electrical.plan.updated` | electrical | `project_id`, `change_kind` | Materialbedarf als veraltet markieren |
| `electrical.circuit.changed` | electrical | `project_id`, `circuit_id` | dito |
| `materials.requirements.updated` | materials | `project_id`, `run_id` | Kalkulation prüft `is_stale` |
| `materials.price.changed` | materials | `material_id`, `valid_from` | Audit; **keine** Änderung an Snapshots |
| `calculation.finalized` | calculation | `calculation_id`, `project_id` | Angebotsassistent verfügbar |
| `offer.version.released` | offers | `offer_id`, `version_no` | Audit |
| `offer.version.accepted` | offers | `offer_id`, `version_no` | Auftrag kann erzeugt werden |
| `work_order.created` | work_orders | `work_order_id`, `project_id` | Reservierungsvorschlag |
| `work_order.completed` | work_orders | `work_order_id` | Soll/Ist-Auswertung (Phase 15) |
| `inventory.stock.changed` | inventory | `material_id`, `location_id` | Mindestbestandswarnung |
| `core.permissions.changed` | authorization | `member_id` | Audit, Cache verwerfen |

Events werden erst eingeführt, wenn es einen realen Konsumenten gibt. Ein Event ohne
Handler ist toter Code mit Wartungskosten.

---

## 7. Persistenz

Jedes zugestellte Event wird in `domain_events` geschrieben:

```
id · organization_id · event_type · event_version · aggregate_type · aggregate_id
payload jsonb · actor_user_id · request_id · occurred_at · handler_status
```

Nutzen:

- Nachvollziehbarkeit ("warum ist der Bedarf gestiegen?")
- Fehlersuche bei fehlgeschlagenen Handlern
- späterer Umstieg auf asynchrone Verarbeitung ohne Datenverlust

`handler_status` ist `ok`, `partial` oder `failed` samt Fehlertext. Die Tabelle ist
append-only; einzige erlaubte Änderung ist `handler_status`.

Aufbewahrung: 12 Monate, danach Archivierung. Kein PII in `payload` — nur IDs.

---

## 8. Tests

| Test | Prüft |
|---|---|
| Kein Event vor Commit | Rollback erzeugt keine Zustellung |
| Handler-Fehler isoliert | Auslösender Request bleibt erfolgreich |
| Idempotenz | Zweimalige Zustellung erzeugt denselben Zustand |
| Azyklisch | Event-Graph beim Start ohne Zyklus |
| Payload ohne PII | Keine Namen/Adressen in Payloads |
| Recompute-Pflicht | Zu jedem eventgetriebenen Ableitungspfad existiert ein Endpunkt |

---

## 9. Ausdrücklich nicht Teil davon

Kein Kafka, kein RabbitMQ, kein Celery, kein Redis-Pub/Sub. Kein Event Sourcing — der
Zustand lebt in Tabellen, nicht im Event-Log. Keine Retry-Mechanik, keine Dead Letter
Queue, keine Saga-Orchestrierung.

**Migrationspfad** (falls je nötig): `domain_events` existiert bereits als Outbox. Ein
Worker, der die Tabelle abarbeitet, statt direkt zuzustellen, macht aus *at most once*
ein *at least once*, ohne dass Produzenten oder Handler geändert werden müssen. Genau
deshalb wird die Tabelle von Anfang an geschrieben.
