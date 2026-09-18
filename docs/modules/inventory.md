# Modul: inventory (Lager)

Art: Shared Business Module · Präfix: `inventory_` · Status: geplant (Phase 12)
Abhängig von: `core`, `materials`

---

## 1. Zweck

Bestandsführung mit lückenlosem Bewegungsjournal: Lagerorte, Bestände, Wareneingang,
Entnahme, Rückgabe, Korrektur, Reservierung und Freigabe.

## 2. Grundregel

> **Bestand wird niemals gesetzt, sondern immer gebucht.**

Jede Änderung erzeugt eine Zeile in `inventory_transactions`. Der Aggregatwert
`inventory_stocks.quantity_on_hand` wird ausschließlich in derselben Transaktion
fortgeschrieben (mit `SELECT … FOR UPDATE` auf der Bestandszeile). Ein direktes
`UPDATE inventory_stocks SET quantity_on_hand = …` existiert nirgendwo im Code.

Ein Wartungstest rechnet `SUM(quantity_delta)` gegen `quantity_on_hand`.

---

## 3. Entitäten

| Entität | Inhalt |
|---|---|
| `inventory_locations` | Lagerorte: Hauptlager, Fahrzeug, Baustellencontainer; hierarchisch |
| `inventory_stocks` | Aggregierter Bestand je (Material, Lagerort) inkl. Mindestbestand |
| `inventory_transactions` | Append-only Bewegungsjournal |
| `inventory_reservations` | Reservierungen für Projekt/Auftrag |

### Bewegungsarten

| `transaction_type` | Vorzeichen | Auslöser |
|---|---|---|
| `receipt` | + | Wareneingang |
| `issue` | − | Entnahme für Auftrag |
| `return` | + | Rückgabe von der Baustelle |
| `correction` | ± | Inventur/Korrektur (auditiert, Begründung Pflicht) |
| `transfer_out` / `transfer_in` | −/+ | Umlagerung zwischen Lagerorten |

Reservierungen sind **keine** Bewegung — sie verändern den Bestand nicht, nur die
Verfügbarkeit.

```
verfügbar = quantity_on_hand − Σ(aktive Reservierungen)
```

Beispiel: 500 m NYM vorhanden, 80 m für Auftrag Müller reserviert → 420 m verfügbar.

---

## 4. Contract: `InventoryService`

Der **einzige** Weg ins Lager. Fachmodule und andere Shared Modules greifen nie direkt auf
Tabellen zu.

```
get_stock(material_id, location_id?) -> StockInfo
reserve(ReservationRequest) -> reservation_id
release_reservation(reservation_id, reason)
consume(reservation_id?, material_id, quantity, work_order_id, client_txn_id) -> transaction_id
return_material(material_id, quantity, work_order_id, client_txn_id) -> transaction_id
```

### Zusagen

- Jeder bestandsverändernde Aufruf erzeugt genau eine Journalzeile.
- `client_txn_id` macht Aufrufe **idempotent**: derselbe Wert liefert dieselbe
  Transaktions-ID zurück, ohne doppelt zu buchen. Pflicht für die Baustellen-App.
- Fehler sind typisierte Ausnahmen (`InsufficientStock`, `UnknownMaterial`,
  `ReservationAlreadyReleased`), nicht `None` oder `False`.
- Ob negative Bestände zulässig sind, entscheidet das Lagermodul pro Organisation, nicht
  der Aufrufer.

---

## 5. Permissions

| Key | Bedeutung |
|---|---|
| `inventory.stock.read` | Bestände ansehen |
| `inventory.stock.book` | Wareneingang, Entnahme, Rückgabe |
| `inventory.stock.correct` | Korrekturbuchung (auditiert) |
| `inventory.reservation.write` | Reservieren und freigeben |
| `inventory.location.write` | Lagerorte pflegen |

`inventory.stock.correct` ist bewusst von `book` getrennt — eine Korrektur ist der einzige
Buchungstyp ohne fachlichen Vorgang dahinter und damit der sensibelste.

---

## 6. Events

**Erzeugt:** `inventory.stock.changed` (Mindestbestandswarnung)
**Konsumiert:** `work_order.created` → Reservierungsvorschlag (Vorschlag, keine
automatische Reservierung)

Reservierungen und Buchungen laufen **nie** über Events, sondern immer über synchrone
Aufrufe mit Ergebnis.

---

## 7. API (Auszug)

```
GET  /api/v1/inventory/stocks?material_id=…&location_id=…
POST /api/v1/inventory/transactions           (Wareneingang/Entnahme/Rückgabe)
POST /api/v1/inventory/corrections            (eigene Route, eigene Permission)
GET  /api/v1/inventory/reservations?project_id=…
POST /api/v1/inventory/reservations
POST /api/v1/inventory/reservations/{id}/release
GET  /api/v1/inventory/locations
GET  /api/v1/inventory/alerts                 (Unterschreitung Mindestbestand)
```

Alle bestandsverändernden Routen akzeptieren `Idempotency-Key`.

---

## 8. Offene Punkte

1. Chargen-/Seriennummernverfolgung — nicht im MVP.
2. Automatische Bestellvorschläge aus Mindestbestand und Auftragsbedarf — nach Phase 12
   zu bewerten.
3. Reservierungsstrategie bei Mehrfachlagerorten (Standardlager vs. nächstgelegenes
   Fahrzeug) — vor Phase 12 zu klären.
4. Inventurverfahren (Stichtag oder permanent) — betriebliche Entscheidung.
