# Modul: calculation (Kalkulation)

Art: Shared Business Module · Präfix: `calculation_` · Status: geplant (Phase 9)
Abhängig von: `core`, `materials`

---

## 1. Zweck

Wirtschaftliche Bewertung eines Projekts: Materialkosten, Arbeitskosten, sonstige Kosten,
Zuschläge, Marge und interner Angebotspreis. Hier — und nur hier — liegen Einkaufspreise,
Stundensätze und Deckungsinformationen.

## 2. Abgrenzung

| Das Modul … | … tut es nicht |
|---|---|
| bewertet Mengen monetär | berechnet keine Mengen (das tut `materials`) |
| kennt Kosten und Margen | erzeugt keine Kundendokumente |
| erzeugt Snapshots | ändert keine Preise im Katalog |

---

## 3. Eingaben

| Eingabe | Quelle |
|---|---|
| Materialbedarf (3 Mengen) | `materials`, aktueller Lauf |
| Arbeitszeitbedarf (Minuten) | `materials`, aktueller Lauf |
| Einkaufspreise | `PricingService` |
| Stundensätze | `calculation_labor_rates` |
| Zuschläge | `calculation_surcharges` |
| sonstige Kosten | manuell erfasst |

---

## 4. Berechnung

```
Materialkosten   = Σ (Menge(calculation_basis) × Einkaufspreis)
Arbeitskosten    = Σ (Minuten / 60 × Stundensatz(kind))
sonstige Kosten  = Σ manuelle Positionen
Selbstkosten     = Material + Arbeit + sonstige
Zuschläge        = je Zuschlag auf definierte Basis (Material | Lohn | Selbstkosten)
Angebotspreis    = Selbstkosten + Zuschläge
Marge            = Angebotspreis − Selbstkosten
```

Rundungsreihenfolge und Datentypen sind verbindlich festgelegt:
[ADR 0005](../decisions/0005-money-rounding-and-quantities.md).

- Jede Position wird einzeln auf 2 Nachkommastellen gerundet.
- Summen bilden sich aus **bereits gerundeten** Positionen.
- Arbeitszeit wird in ganzen Minuten geführt und erst hier in Stunden umgerechnet.

---

## 5. Snapshots (§26 des Masterplans)

Beim Statuswechsel `draft → final` wird ein unveränderlicher Snapshot geschrieben:

```json
{
  "created_at": "2026-09-18T07:15:00Z",
  "materials": { "<material_id>": { "amount": "0.7400", "currency": "EUR" } },
  "labor_rates": { "installer": { "amount": "52.00", "currency": "EUR" } },
  "quantities": { "<requirement_id>": "45.900" },
  "rules": { "waste.cable": "8.000", "rounding.cable": "up_to_package" },
  "hash": "sha256:…"
}
```

Regeln:

1. Eine finalisierte Kalkulation liest **ausschließlich** aus ihrem Snapshot.
2. Eine Preisänderung im Katalog verändert **keine** bestehende Kalkulation.
3. Mengen werden mitgesnapshottet, nicht nur Preise — sonst würde eine Planänderung
   rückwirkend die Kalkulation verändern.
4. Der Hash macht nachweisbar, dass nichts nachträglich geändert wurde.

### Veraltete Kalkulationen

Ändert sich die Planung nach dem Finalisieren, wird `is_stale = true` gesetzt und in der UI
angezeigt. **Es ändert sich kein eingefrorener Wert.** Neue Zahlen erfordern eine neue
Kalkulationsversion.

---

## 6. Versionierung

`calculations` trägt `number` und `version_no`. Eine neue Version ist eine vollständige
Kopie mit neuem Snapshot; alte Versionen bleiben lesbar. Eine finalisierte Version ist
unveränderlich.

---

## 7. Permissions

| Key | Bedeutung |
|---|---|
| `calculation.read` | Kalkulation ansehen (inkl. Kosten) |
| `calculation.write` | Kalkulation erstellen/ändern |
| `calculation.finalize` | Finalisieren (auditiert) |
| `calculation.rate.write` | Stundensätze pflegen |

`calculation.read` ist eine sensible Berechtigung: Sie umfasst Einkaufspreise und Margen.
Monteure erhalten sie nicht.

---

## 8. Events

**Erzeugt:** `calculation.finalized`
**Konsumiert:** `materials.requirements.updated` → `is_stale` prüfen und setzen

---

## 9. API (Auszug)

```
GET  /api/v1/projects/{project_id}/calculations
POST /api/v1/projects/{project_id}/calculations
GET  /api/v1/calculations/{id}
PATCH /api/v1/calculations/{id}
POST /api/v1/calculations/{id}/items
POST /api/v1/calculations/{id}/surcharges
POST /api/v1/calculations/{id}/finalize
POST /api/v1/calculations/{id}/new-version
POST /api/v1/calculations/{id}/check-stale
```

---

## 10. Tests (verbindlich)

| Test | Prüft |
|---|---|
| Rundung | Positionssumme, Nettosumme, USt je Steuersatz |
| Snapshot-Isolation | Preisänderung nach `final` verändert die Kalkulation nicht |
| Mengen-Snapshot | Planänderung nach `final` verändert die Kalkulation nicht |
| Stale-Erkennung | Planänderung setzt `is_stale` |
| Kein Float | Alle Geldspalten sind `numeric`, alle Berechnungen `Decimal` |
| Zuschlagsbasis | Zuschlag auf Material ≠ Zuschlag auf Selbstkosten |
| Nullmengen | Position mit Menge 0 erzeugt keine Kosten und keinen Fehler |

---

## 11. Offene Punkte

1. Ein Stundensatz oder mehrere (Monteur/Geselle/Meister/Azubi)? — betriebliche Entscheidung.
2. Gemeinkostenzuschlag: prozentual auf Material, auf Lohn oder auf beides?
3. Nachlass/Skonto: in der Kalkulation oder erst im Angebot? Vorschlag: im Angebot,
   damit die interne Kalkulation die reale Kostenlage zeigt.
4. Umgang mit Kleinmaterial (Pauschale vs. Einzelposition) — gemeinsam mit `materials`.
