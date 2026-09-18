# Modul: offers (Angebote)

Art: Shared Business Module · Präfix: `offer_` · Status: geplant (Phase 10)
Abhängig von: `core`, `calculation`

---

## 1. Zweck

Erstellung, Versionierung, Freigabe und Ausgabe von Kundenangeboten auf Basis einer
finalisierten Kalkulation.

## 2. Die wichtigste Eigenschaft

> **Die Tabellen `offer_versions` und `offer_items` enthalten keine Kostenspalten.**

Kein `unit_cost`, kein `purchase_price`, kein `markup_percent`, keine Marge. Ein Angebot
kennt ausschließlich Verkaufspreise. Damit ist §29 des Masterplans keine Regel, die man
verletzen kann, sondern eine Eigenschaft des Schemas
([ADR 0006](../decisions/0006-tenant-isolation-and-data-separation.md)).

Der Bezug zur Kalkulation läuft über `offer_versions.calculation_id`.

---

## 3. Struktur

```
offers (Angebotsnummer, Kunde, Projekt, Zeiger auf aktuelle Version)
   └── offer_versions (Version, Status, Summen, Snapshot)
          └── offer_items (Positionen, hierarchisch über parent_id)
```

Eine neue Version ist eine **vollständige Kopie**, kein Diff. Freigegebene Versionen sind
unveränderlich; nur Statusfelder dürfen fortschreiten.

### Belegnummern

Vergabe über `number_sequences` mit Zeilensperre, nicht über `MAX(number)+1`.
Format je Organisation konfigurierbar, Standard `ANG-{JJJJ}-{NNNN}` → `ANG-2026-0042`,
Versionen als `ANG-2026-0042 V2`.

---

## 4. Positionsarten

| `kind` | Verhalten |
|---|---|
| `heading` | Überschrift, kein Preis, nicht in der Summe |
| `text` | Freitext, kein Preis |
| `item` | normale Position, **in** der Summe |
| `optional` | Eventualposition, **nicht** in der Summe |
| `alternative` | Alternativposition, **nicht** in der Summe |
| `lump_sum` | Pauschalposition, in der Summe, ohne Mengengerüst |

Gesteuert über `include_in_total`. Beispielgliederung:

```
01     Baustelleneinrichtung
02     Elektroinstallation
02.01    Leitungen
02.02    Steckdosen und Schalter
02.03    Beleuchtung
03     Photovoltaik            (später, aus dem PV-Modul)
```

Positionsnummern werden aus Hierarchie und Reihenfolge erzeugt und bei jeder Umsortierung
neu vergeben.

---

## 5. Statusverlauf

```
draft ──▶ released ──▶ sent ──▶ accepted
                          │        └──▶ work_order (Phase 11)
                          ├──▶ rejected
                          └──▶ expired
```

- `draft → released`: erfordert `offer.version.approve`, wird auditiert, erzeugt den
  Snapshot und friert die Version ein.
- **Kein Angebot wird automatisch versendet.** `mark-sent` ist eine bewusste Handlung.
- `expired` wird aus `valid_until` abgeleitet, nicht per Hintergrundjob gesetzt.

---

## 6. Vorschläge aus Fachmodulen

```
OfferItemSuggestionProvider.suggest(ctx, calculation_id) -> list[OfferItemSuggestion]
```

- Vorschläge enthalten **keine Preise** — Preise setzt `offers` aus der Kalkulation.
- Vorschläge sind Entwürfe: Der Benutzer bearbeitet, gruppiert, formuliert um und löscht.
- Ein Fachmodul kann damit eine sinnvolle Gliederung anbieten, ohne Verkaufspreise zu
  bestimmen.

---

## 7. Snapshot

Beim Freigeben wird gespeichert: Positionen, Preise, Steuersätze, Zahlungs- und
Lieferbedingungen, Firmen- und Kundendaten zum Zeitpunkt der Freigabe, Gültigkeitsdatum.
Ein Jahr später muss exakt dasselbe Dokument reproduzierbar sein — auch wenn sich Adresse,
Logo oder Preise geändert haben.

Das erzeugte PDF wird als Datei abgelegt (`pdf_file_id`) und nicht bei jedem Abruf neu
gerendert.

---

## 8. Steuer

- Steuersatz je Position (`tax_rate`), Standard aus der Organisation (19 %).
- Steuer wird je Steuersatzgruppe berechnet, nicht je Position summiert.
- §13b (Reverse Charge bei Bauleistungen) ist **nicht** im MVP enthalten; das Feld
  `tax_rate` und eine spätere Kennzeichnung am Angebot lassen die Erweiterung offen.

---

## 9. Permissions

| Key | Bedeutung |
|---|---|
| `offer.read` | Angebote ansehen |
| `offer.write` | Entwürfe erstellen und bearbeiten |
| `offer.version.approve` | Freigeben (auditiert) |
| `offer.version.send` | Als versendet markieren |
| `offer.pdf.download` | PDF herunterladen (auditiert) |

---

## 10. Events

**Erzeugt:** `offer.version.released`, `offer.version.accepted`
**Konsumiert:** `calculation.finalized` (Hinweis: Angebotsentwurf möglich)

---

## 11. API (Auszug)

```
GET  /api/v1/projects/{project_id}/offers
POST /api/v1/projects/{project_id}/offers
POST /api/v1/offers/{offer_id}/versions
POST /api/v1/offers/{offer_id}/versions/{version_no}/items
POST /api/v1/offers/{offer_id}/versions/{version_no}/release
POST /api/v1/offers/{offer_id}/versions/{version_no}/mark-sent
POST /api/v1/offers/{offer_id}/versions/{version_no}/decision
GET  /api/v1/offers/{offer_id}/versions/{version_no}/pdf
GET  /api/v1/offers/{offer_id}/suggestions?calculation_id=…
```

---

## 12. Tests (verbindlich)

| Test | Prüft |
|---|---|
| Keine Kostenfelder | Schema und alle Ausgabe-DTOs enthalten keine Kostenspalte |
| Kein Kalkulationsimport | PDF-/DTO-Pfad importiert kein `calculation_*` |
| Summenbildung | Optional- und Alternativpositionen zählen nicht mit |
| USt | Mehrere Steuersätze in einem Angebot |
| Unveränderlichkeit | Freigegebene Version lässt sich nicht inhaltlich ändern |
| Nummernvergabe | Parallele Anfragen erzeugen keine doppelte Nummer |
| Snapshot | Preisänderung nach Freigabe verändert das PDF nicht |

---

## 13. Offene Punkte

1. PDF-Erzeugung: WeasyPrint (HTML/CSS) oder ReportLab? Vorschlag WeasyPrint — Layout per
   CSS ist für Angebotsvorlagen deutlich pflegeleichter.
2. Angebotsvorlage: Layout, Logo, Zahlungsbedingungen, Rechtstexte — Muster vom Betrieb
   erforderlich.
3. Versand per E-Mail direkt aus dem System — bewusst nicht im MVP (Freigabe- und
   Zustellrisiko).
4. Nachlass/Skonto als eigene Positionsart oder als Feld am Angebotskopf.
