# Domain Events und interner Event Bus

Version: 1.0 (Phase 0)
Verbindliche Entscheidungen: [ADR 0004](decisions/0004-internal-event-bus.md) und
[ADR 0012](decisions/0012-event-delivery-guarantee.md) (Zustellgarantie)

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

### Was `domain_events` ist — und was nicht

`domain_events` ist ein **Best-Effort-Ereignisprotokoll** für Nachvollziehbarkeit und
Fehlersuche. Es ist ausdrücklich **keine transaktionale Outbox**: Der Fachzustand wird
zuerst committet, das Event danach in einer eigenen Transaktion geschrieben. Zwischen
beiden Schritten kann ein Absturz das Event spurlos verschwinden lassen — es taucht dann
auch nicht als `pending` auf.

Der Status `pending` bedeutet daher „Zustellung begonnen“, nicht „wird garantiert
nachgeholt“. Begründung und die Bedingungen für eine spätere echte Outbox:
[ADR 0012](decisions/0012-event-delivery-guarantee.md).

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
| Bus wird vor dem Verdrahten geleert | Mehrfaches Erzeugen der Anwendung (Tests) darf Handler nicht doppelt registrieren |

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
| `electrical.plan.updated` | electrical (**ab Phase 3**) | `project_id`, `floor_id`, `room_id`, `change_kind` | Materialbedarf als veraltet markieren (ab Phase 7) |
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

### `electrical.plan.updated` im Detail (Phase 3)

Das erste tatsächlich erzeugte Fachmodul-Event.

| | |
|---|---|
| **Auslöser** | jede wirksame Änderung am Raummodell: Raum angelegt, geändert, gelöscht; Wände angelegt, geändert, umgeordnet, gelöscht; Öffnungen angelegt, geändert, gelöscht |
| **Kein Auslöser** | der Konturbericht `GET …/rooms/{id}/contour`. Er ändert nichts, und ein Event ist eine Tatsache |
| **Aggregat** | `project` (`aggregate_id` = Projekt-ID) |
| **`event_version`** | `1` |
| **Nutzlast** | `project_id`, `floor_id`, `room_id`, `change_kind` |
| **`change_kind`** | `room_created`, `room_updated`, `room_deleted`, `walls_changed`, `openings_changed` |
| **Handler** | **keiner** in Phase 3 — `materials` entsteht erst in Phase 7 |

**Warum ein Eventname und nicht vier.** Ein Name je Tabellenänderung wäre eine
Namensschwemme ohne zusätzliche Aussage: Der einzige künftige Empfänger — die
Materialermittlung — reagiert auf alle gleich. `change_kind` trägt die Unterscheidung,
und der Name steht seit Phase 0 im Katalog.

**Was das Event nicht ist.** Keine Zusage: Die Zustellung ist *at most once*, und
`domain_events` ist keine transaktionale Outbox (ADR 0012). Solange kein Handler
existiert, ist der Nutzen die Nachvollziehbarkeit im Ereignisprotokoll — "wer hat wann
welchen Raum geändert". Der verbindliche Weg zur Neuberechnung bleibt der
Recompute-Endpunkt des Materialmoduls.

**Keine personenbezogenen Daten:** Nur IDs und ein kurzer Schlüssel. Raumnamen,
Raumnummern und Kundennamen kommen in der Nutzlast nicht vor; ein Test prüft das.

Erweiterung innerhalb von `v1`: Ein zusätzlicher `change_kind`-Wert ist additiv —
Konsumenten behandeln Unbekanntes tolerant (docs/api.md, Abschnitt 9). Ein entferntes
Nutzlastfeld wäre brechend und erzeugt `event_version` 2.

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

**Kein** Nutzen: eine Zustellgarantie. Siehe Abschnitt 4.

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

**Migrationspfad** (falls je nötig): Ein Umstieg auf *at least once* ist **kein** reiner
Worker-Nachbau. Dafür müssten zusätzlich

1. der Eventdatensatz in derselben Transaktion wie der Fachzustand geschrieben werden,
2. ein Zustellstatus je Event **und Handler** geführt werden,
3. ein Worker die offenen Einträge wiederaufnehmen — inklusive Tests für
   Mehrfachzustellung.

Dieser Aufwand wird hier benannt, damit er später nicht unterschätzt wird
([ADR 0012](decisions/0012-event-delivery-guarantee.md)).
