# Modul: materials (Materialstamm, ServiceTemplates, Material Engine)

Art: Shared Business Module · Präfix: `material_`, `service_` · Status: geplant (Phasen 7–8)
Abhängig von: `core`

---

## 1. Zweck

Katalog und Mengenlogik der Plattform:

- Materialstamm mit Preisen und Preishistorie
- ServiceTemplates (Leistungsvorlagen: Stückliste + Arbeitszeit)
- globale Materialregeln (Verschnitt, Verpackungsrundung, Mindestmengen)
- **Material Engine**: berechnet aus dem Planungsstand aller Fachmodule den Material- und
  Arbeitszeitbedarf eines Projekts

## 2. Abgrenzung

| Das Modul … | … tut es nicht |
|---|---|
| kennt Einkaufspreise und Aufschläge | bildet keine Verkaufspreise (das tut `calculation`) |
| berechnet Mengen | kennt keine Fachmodule |
| liefert Bedarf | bucht keine Bestände |
| hält ServiceTemplates | erstellt keine Angebote |

**Warum ServiceTemplates hier liegen:** Ein ServiceTemplate ist im Kern eine Stückliste
plus Zeitwert — Katalogdaten. `calculation` bewertet sie nur monetär. Zwei Module würden
sonst dieselben Daten pflegen.

---

## 3. Entitäten

### `materials`
Artikelnummer, Bezeichnung, Kategorie, Einheit, Hersteller, Herstellernummer,
Einkaufspreis, Standardaufschlag, **Verpackungsmenge** (`packaging_quantity`),
**Rundungsart** (`packaging_rounding`: `none` | `up_to_package` | `up_to_unit`),
**Verschnitt** (`waste_percent`), **Kalkulationsbasis** (`calculation_basis`:
`required` | `planned` | `procurement`), Aktivkennzeichen.

### `material_prices`
Preishistorie mit `valid_from`. Der aktuelle Preis ist der jüngste Eintrag mit
`valid_from <= heute`. Historische Kalkulationen lesen **nie** hier, sondern aus ihrem
Snapshot.

### `material_categories`
Hierarchische Kategorien (Leitungen, Installationsmaterial, Schaltgeräte, Leuchten,
Verteilerkomponenten, Kleinmaterial). Die Kategorie *Leitung* ist fachlich relevant für
den Doppelzählungsschutz.

### `service_templates` / `service_template_items`
Leistungsvorlage, z. B. "Steckdose UP Standard":

| Feld | Beispiel |
|---|---|
| `key` | `socket-flush-standard` |
| `name` | Steckdose UP Standard |
| `labor_minutes` | 15 |
| `includes_cable` | `false` |
| Positionen | 1 × Gerätedose, 1 × Steckdoseneinsatz, 1 × Rahmen, 1 × Kleinmaterialpauschale |

`includes_cable` ist ein Pflichtfeld und im Standard `false` — Leitungen kommen aus der
Leitungsplanung.

### `material_rules`
Globale Regeln pro Kategorie oder Einheit: Verschnittprozent, Rundungsart,
Mindestmenge, Priorität. Regeln **verändern nur Mengen** und erzeugen niemals neues
Fachmaterial.

### `material_requirement_runs`, `material_requirements`, `labor_requirements`
Ein Lauf bündelt das Ergebnis einer Berechnung. Je Projekt ist genau ein Lauf
`is_current`. Ältere Läufe bleiben zur Nachvollziehbarkeit erhalten
(Aufbewahrung: die letzten 10 Läufe je Projekt).

---

## 4. Material Engine

```
Aufruf: POST /api/v1/projects/{project_id}/material-requirements/recompute

1. Lauf anlegen (status = running)
2. Für jeden registrierten MaterialRequirementProvider:
       drafts += provider.collect(ctx)
   (Fehler eines Providers => Lauf schlägt sichtbar fehl, kein Teilergebnis)
3. Drafts auflösen:
       service_template_id -> Positionen des Templates   (Menge × Position)
       material_key        -> material_id
4. required_quantity je (material_id, source_entity_type, source_entity_id) summieren
5. Regeln anwenden:
       planned_quantity     = required_quantity × (1 + waste_percent/100)
       procurement_quantity = aufgerundet auf packaging_quantity
6. Plausibilitätsprüfung (Warnungen in run.warnings):
       - gleiche material_id aus zwei verschiedenen source_entity_type
       - Template mit includes_cable=true bei vorhandenen Leitungswegen
       - Material ohne Preis
       - Menge = 0 oder negativ
7. Schreiben, alten Lauf auf is_current=false setzen, neuen auf true
8. Event materials.requirements.updated
```

Eigenschaften:

- **Idempotent:** Zwei Läufe mit identischem Planungsstand liefern identische Ergebnisse.
  `input_hash` dokumentiert das und erlaubt, einen überflüssigen Lauf zu überspringen.
- **Vollständig oder gar nicht:** Kein Teilergebnis bei Providerfehlern.
- **Nachvollziehbar:** Jede Zeile trägt `source_module`, `source_entity_type`,
  `source_entity_id`.

### Rundungsbeispiel

| Schritt | Wert |
|---|---|
| Bedarf aus 6 Leitungswegen | 42,500 m |
| Verschnitt 8 % | 45,900 m |
| Verpackung: Ring 50 m, `up_to_package` | 50,000 m |
| `calculation_basis` = `planned` | kalkuliert werden 45,900 m |

---

## 5. Bereitgestellte Contracts

| Contract | Nutzer |
|---|---|
| `MaterialRequirementProvider` (Port) | Fachmodule implementieren |
| `LaborRequirementProvider` (Port) | Fachmodule implementieren |
| `PricingService` | `calculation` |
| `MaterialCatalogService` (lesen, suchen) | `inventory`, `offers`, Frontend |

## 6. Genutzte Contracts

`ProjectContext` aus dem Core. Keine.

---

## 7. Permissions

| Key | Bedeutung |
|---|---|
| `material.catalog.read` | Materialstamm ansehen |
| `material.catalog.write` | Material anlegen/ändern |
| `material.price.read` | Einkaufspreise sehen |
| `material.price.write` | Preise ändern (auditiert) |
| `material.template.write` | ServiceTemplates pflegen |
| `material.rule.write` | globale Regeln pflegen |
| `material.requirement.read` | Materialbedarf ansehen |
| `material.requirement.recompute` | Neuberechnung auslösen |

`material.price.read` ist bewusst eine eigene Permission: Ein Monteur sieht Material,
aber keine Einkaufspreise.

---

## 8. Events

**Erzeugt:** `materials.requirements.updated`, `materials.price.changed`
**Konsumiert:** `electrical.plan.updated`, `electrical.circuit.changed`
→ markiert den aktuellen Lauf als veraltet (`stale`). Die Neuberechnung selbst erfolgt
**nicht** automatisch im Handler, sondern auf Anforderung — sonst würde jede kleine
Planänderung einen vollständigen Lauf auslösen.

---

## 9. API (Auszug)

```
GET  /api/v1/materials?q=NYM&category_id=…
POST /api/v1/materials
GET  /api/v1/materials/{id}/prices
POST /api/v1/materials/{id}/prices
GET  /api/v1/service-templates
POST /api/v1/service-templates
GET  /api/v1/projects/{project_id}/material-requirements
POST /api/v1/projects/{project_id}/material-requirements/recompute
GET  /api/v1/projects/{project_id}/material-requirements/runs
```

---

## 10. Offene Punkte

1. Datanorm-/IDS-Import von Großhändlerkatalogen — hoher praktischer Nutzen, nicht im MVP.
2. Staffelpreise und lieferantenabhängige Preise — im MVP genau ein Einkaufspreis je
   Material.
3. Kleinmaterialpauschale: als eigenes Material mit Einheit `piece` oder als prozentualer
   Zuschlag in `calculation`? Vor Phase 8 zu entscheiden.
4. Reale Verschnittsätze je Kategorie sind vom Betrieb festzulegen (siehe
   `docs/architecture-review.md`, Abs. 6).
