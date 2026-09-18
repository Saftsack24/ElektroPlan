# Glossar (Deutsch ↔ Englisch)

Verbindlich nach [ADR 0008](decisions/0008-documentation-language-and-naming.md):
Dokumentation und Oberfläche auf Deutsch, Code und API auf Englisch.
**Ein neuer Fachbegriff wird hier eingetragen, bevor er im Code verwendet wird.**

## Kernbegriffe

| Deutsch | Englisch (Code/API) | Anmerkung |
|---|---|---|
| Organisation / Mandant | `organization` | Elektrofachbetrieb |
| Mitgliedschaft | `organization_member` | Verbindung Benutzer ↔ Organisation |
| Benutzer | `user` | globale Identität |
| Rolle | `role` | pro Organisation, enthält Permissions |
| Berechtigung | `permission` | `<modul>.<objekt>.<aktion>` |
| Kunde | `customer` | |
| Projekt | `project` | zentrale Core-Entität |
| Gebäude | `building` | |
| Geschoss | `floor` | |
| Datei | `file` | |
| Beleg-/Nummernkreis | `number_sequence` | |
| Protokolleintrag | `audit_entry` | |

## Elektroplanung

| Deutsch | Englisch | Anmerkung |
|---|---|---|
| Raum | `room` | |
| Wand | `wall` | |
| Öffnung (Tür/Fenster) | `opening` | `kind`: `door`, `window`, `passage` |
| Brüstungshöhe | `sill_height` | |
| Elektroelement / Gerät | `device` | |
| Gerätetyp | `device_type` | Katalog |
| Montagehöhe | `mount_height` | |
| Verteilung / Unterverteilung | `distribution_board` | |
| Stromkreis | `circuit` | |
| Querschnitt | `cross_section` | in mm² |
| Absicherung / Schutzorgan | `protection` | Typ und Nennstrom |
| Leitungsweg | `cable_route` | |
| Verlegeart | `installation_method` | |
| Installationszone | `installation_zone` / `zone_key` | siehe ADR 0010 |
| Fertigfußboden (FFB) | `finished_floor_level` | `z = 0` |
| Rohdecke | `structural_ceiling` | |
| Aufmaß | `survey` / `measurement` | |
| Grundriss | `floor_plan` | |

## Material und Kalkulation

| Deutsch | Englisch | Anmerkung |
|---|---|---|
| Materialstamm | `material catalog` | |
| Artikelnummer | `article_number` | |
| Einheit | `unit` | `piece`, `meter`, `package`, `roll`, `kg`, `hour` |
| Einkaufspreis | `purchase_price` | **intern** |
| Verkaufspreis | `sales_price` / `unit_price` | kundenseitig |
| Aufschlag | `markup` | **intern** |
| Marge / Deckungsbeitrag | `margin` | **intern** |
| Verschnitt / Reserve | `waste` | Prozentsatz |
| Verpackungseinheit | `packaging_quantity` | z. B. 50-m-Ring |
| Bedarf (technisch) | `required_quantity` | ohne Zuschläge |
| Planmenge | `planned_quantity` | inkl. Verschnitt |
| Beschaffungsmenge | `procurement_quantity` | auf Verpackung gerundet |
| Materialbedarf | `material_requirement` | zentraler Contract |
| Arbeitszeitbedarf | `labor_requirement` | in Minuten |
| Leistungsvorlage | `service_template` | Stückliste + Zeit |
| Kleinmaterial | `small_material` | |
| Stundensatz | `labor_rate` | **intern** |
| Zuschlag | `surcharge` | |
| Selbstkosten | `cost_total` | **intern** |
| Kalkulation | `calculation` | **intern** |

## Angebot und Auftrag

| Deutsch | Englisch | Anmerkung |
|---|---|---|
| Angebot | `offer` | |
| Angebotsversion | `offer_version` | |
| Angebotsposition | `offer_item` | |
| Überschrift | `heading` | Positionsart |
| Textposition | `text` | Positionsart |
| Eventualposition | `optional` | zählt nicht in die Summe |
| Alternativposition | `alternative` | zählt nicht in die Summe |
| Pauschalposition | `lump_sum` | |
| Freigabe | `release` / `approve` | auditiert |
| Gültig bis | `valid_until` | |
| Netto / Steuer / Brutto | `net_total` / `tax_total` / `gross_total` | |
| Auftrag | `work_order` | |
| Soll / Ist | `planned` / `actual` | |
| Abweichung | `variance` | |
| Nachkalkulation | `post_calculation` | |

## Lager

| Deutsch | Englisch | Anmerkung |
|---|---|---|
| Lagerort | `inventory_location` | |
| Bestand | `stock` / `quantity_on_hand` | |
| Verfügbar | `available` | Bestand − Reservierungen |
| Bewegung / Buchung | `transaction` | append-only |
| Wareneingang | `receipt` | |
| Entnahme | `issue` | |
| Rückgabe | `return` | |
| Korrektur | `correction` | eigene Berechtigung |
| Umlagerung | `transfer` | |
| Reservierung | `reservation` | verändert den Bestand nicht |
| Mindestbestand | `minimum_quantity` | |
| Inventur | `stocktaking` | |
