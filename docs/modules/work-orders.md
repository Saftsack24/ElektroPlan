# Modul: work_orders (Aufträge)

Art: Shared Business Module · Präfix: `work_order_` · Status: geplant (Phase 11)
Abhängig von: `core`, `offers`

---

## 1. Zweck

Überführung eines angenommenen Angebots in einen ausführbaren Auftrag mit Soll-Material,
Soll-Arbeitszeit und Status. Ab Phase 14 zusätzlich Erfassung der Ist-Daten von der
Baustelle, ab Phase 15 Grundlage des Soll/Ist-Vergleichs.

---

## 2. Entitäten

| Entität | Inhalt |
|---|---|
| `work_orders` | Auftragsnummer, Projekt, Herkunftsangebotsversion, Titel, Status, Termine |
| `work_order_items` | Leistungen mit Planmenge und Soll-Arbeitszeit |
| `work_order_materials` | Planmaterial, reservierte Menge, verbrauchte Menge |
| `work_order_time_entries` | Ist-Arbeitszeiten (Phase 14) |
| `work_order_notes` | Bemerkungen, Fotoverweise (Phase 14) |

---

## 3. Einfrieren der Planwerte

Beim Anlegen des Auftrags werden Material- und Zeitmengen **kopiert**, nicht referenziert.

| Grund | Erläuterung |
|---|---|
| Stabiles Soll | Eine spätere Planänderung darf den Soll/Ist-Vergleich nicht rückwirkend verfälschen |
| Nachvollziehbarkeit | Der Monteur arbeitet gegen genau die Liste, die er erhalten hat |
| Änderungen sichtbar | Nachträge sind eigene Positionen, keine stille Anpassung |

---

## 4. Statusverlauf

```
planned ──▶ released ──▶ in_progress ──▶ completed
    └──▶ cancelled
```

- `released`: Material darf reserviert werden, der Auftrag erscheint in der App.
- `in_progress`: erste Zeit- oder Verbrauchserfassung.
- `completed`: löst `work_order.completed` aus; offene Reservierungen werden zur Freigabe
  vorgeschlagen. Nach `completed` sind Ist-Erfassungen gesperrt.

---

## 5. Zusammenspiel mit dem Lager

- Reservierung ausschließlich über `InventoryService.reserve(...)`.
- Verbrauch über `InventoryService.consume(...)` mit `client_txn_id` (idempotent).
- Rückgabe über `InventoryService.return_material(...)`.
- Das Auftragsmodul führt selbst **keine** Bestandsspalten fort; `consumed_quantity` ist
  eine Auswertung der Lagerbewegungen zu diesem Auftrag.

---

## 6. Soll/Ist (Phase 15)

| Größe | Soll | Ist | Abweichung |
|---|---|---|---|
| Material | `planned_quantity` | Summe `consume` − `return` | Menge und Betrag |
| Arbeitszeit | `planned_labor_minutes` | Summe `time_entries` | Minuten und Betrag |

Beispiel: geplant 38 m Leitung, tatsächlich 44 m → +6 m. Die Auswertung fließt in die
Verbesserung der ServiceTemplates und Verschnittsätze zurück — der eigentliche
wirtschaftliche Nutzen der Plattform.

---

## 7. Permissions

| Key | Bedeutung |
|---|---|
| `work_order.read` | Aufträge ansehen |
| `work_order.write` | Aufträge anlegen/bearbeiten |
| `work_order.release` | Auftrag freigeben |
| `work_order.execute` | Verbrauch und Zeiten erfassen (Monteur) |
| `work_order.complete` | Auftrag abschließen (auditiert) |

`work_order.execute` ist die Kernberechtigung der Baustellen-App und umfasst
ausdrücklich **keine** Preis- oder Kalkulationsdaten.

---

## 8. Events

**Erzeugt:** `work_order.created`, `work_order.completed`
**Konsumiert:** `offer.version.accepted` (Hinweis: Auftrag kann erzeugt werden — die
Erzeugung selbst ist eine bewusste Benutzerhandlung, kein Automatismus)

---

## 9. API (Auszug)

```
GET  /api/v1/work-orders?status=…&assigned_to=…
POST /api/v1/work-orders                       (aus offer_version_id)
GET  /api/v1/work-orders/{id}
POST /api/v1/work-orders/{id}/release
POST /api/v1/work-orders/{id}/materials/{material_id}/consume
POST /api/v1/work-orders/{id}/time-entries
POST /api/v1/work-orders/{id}/complete
GET  /api/v1/work-orders/{id}/variance          (Phase 15)
```

Alle Routen der Baustellen-App verlangen `Idempotency-Key`.

---

## 10. Offene Punkte

1. Teilaufträge und Bauabschnitte — im MVP ein Auftrag je Angebot.
2. Terminplanung und Ressourcenzuordnung (Monteur, Fahrzeug) — bewusst nicht im MVP.
3. Nachträge: eigene Angebotsversion oder Auftragsposition mit Kennzeichen? Vorschlag:
   eigene Angebotsversion, damit die Kette Kalkulation → Angebot → Auftrag geschlossen
   bleibt.
4. Übergang zur Rechnungsstellung — erst nach dem Pilotbetrieb.
