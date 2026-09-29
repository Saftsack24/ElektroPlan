# Glossar (Deutsch ↔ Englisch)

Verbindlich nach [ADR 0008](decisions/0008-documentation-language-and-naming.md):
Dokumentation und Oberfläche auf Deutsch, Code und API auf Englisch.
**Ein neuer Fachbegriff wird hier eingetragen, bevor er im Code verwendet wird.**

## Kernbegriffe

| Deutsch | Englisch (Code/API) | Anmerkung |
|---|---|---|
| Organisation / Mandant | `organization` | Elektrofachbetrieb |
| Mitgliedschaft | `organization_member` | Verbindung Benutzer ↔ Organisation; trägt Status und Rollen |
| Zugang zum Betrieb sperren / freigeben | `suspend` / `reactivate`, Status `disabled` / `active` | betrifft nur die Mitgliedschaft, nie das globale Konto (ADR 0015) |
| Einladung | `member_invitation` | Einladung einer E-Mail-Adresse in einen Betrieb; Token nur als Hash |
| Einladung erneut ausstellen / widerrufen | `reissue` / `revoke` | neues Token und neue Frist / Token wertlos |
| Systemrolle | `role` mit `is_system` | feste, ausgelieferte Rolle; in Phase 4.2 die einzigen vergebbaren |
| Effektive Berechtigungen | `effective permissions` | Vereinigung der Berechtigungen aller Rollen einer Mitgliedschaft, mit Herkunft |
| Letzter Administrator | `last-administrator` | Regel: ein Betrieb bleibt nie ohne aktiven Administrator |
| Benutzer | `user` | globale Identität |
| Rolle | `role` | pro Organisation, enthält Permissions |
| Berechtigung | `permission` | `<modul>.<objekt>.<aktion>` |
| Kunde | `customer` | |
| Projekt | `project` | zentrale Core-Entität |
| Gebäude | `building` | |
| Geschoss | `floor` | |
| Datei | `file` | |
| Beleg-/Nummernkreis | `number_sequence` | Format siehe `docs/database.md`, Abschnitt 3 |
| Kundennummer | `customer_number` | `KD-#####`, durchlaufend je Betrieb |
| Projektnummer | `project_number` | `PR-JJJJ-####`, je Kalenderjahr neu |
| Privatkunde / Firmenkunde | `kind`: `private` / `company` | |
| Ansprechpartner | `contact_person` | |
| Rechnungsanschrift | `billing_*` | Anschrift des Kunden |
| Baustellenanschrift | `site_*` | Anschrift des Projekts |
| Projektstatus | `status`: `draft`, `active`, `completed`, `archived` | Entwurf, In Bearbeitung, Abgeschlossen, Archiviert |
| Ausblenden (Soft Delete) | `deleted_at` | fachliches Ausblenden, kein Löschen |
| Anonymisieren | `anonymize` / `anonymized_at` | Umsetzung eines Löschbegehrens nach Art. 17 DSGVO |
| Geschossebene | `level` | `0` Erdgeschoss, `-1` Untergeschoss, `1` erstes Obergeschoss |
| Höhenlage des Fertigfußbodens | `elevation_mm` | ganzzahlige Millimeter |
| Standard-Geschosshöhe | `default_ceiling_height_mm` | lichte Höhe in Millimetern |
| Protokolleintrag | `audit_entry` | |
| Statusgruppe | `status_group`: `current`, `closed` | Listenfilter: laufend (Entwurf + in Bearbeitung) bzw. abgeschlossen + archiviert |
| Nummerierte Seite | `page`, `page_size`, `total_items`, `total_pages` | seitenbasierte Liste für Kunden und Projekte (ADR 0017) |
| Anzeigeeinheit (Maßeinheit) | `masseinheit` (nur Oberfläche): `cm`, `mm` | persönliche Darstellung von Längen; gespeichert wird immer in Millimetern |
| Adressvorschlag | – (nur Oberfläche) | Rechnungsadresse des Kunden als Vorschlag für die Baustellenadresse; keine Verknüpfung |
| Rückfrage | – (nur Oberfläche, `Rueckfrage`) | eigener Bestätigungsdialog der Anwendung statt `window.confirm` |

## Elektroplanung

| Deutsch | Englisch | Anmerkung |
|---|---|---|
| Raum | `room` | |
| Raumnummer | `room_number` | optional, je Geschoss eindeutig |
| Raumhöhe | `height_mm` | leer = Standardhöhe des Geschosses |
| Wand | `wall` | gerichtetes Segment `(x1,y1) → (x2,y2)` |
| Wandstärke | `thickness_mm` | |
| Wandreihenfolge | `sort_order` | Position in der Raumkontur, ab 0 |
| Raumkontur | `contour` | die geordneten Wände eines Raums (ADR 0013) |
| Konturzustand | `contour_status`: `draft` / `valid` | Entwurf / Geschlossen — abgeleitet, nicht gespeichert |
| Fläche | `area_mm2` / `area_m2` | berechnet; über die API zusätzlich als Dezimalstring in m² |
| Umfang | `perimeter_mm` | Summe der gerundeten Wandlängen |
| Öffnung (Tür/Fenster) | `opening` | `kind`: `door`, `window`, `passage` |
| Abstand vom Wandanfang | `offset_mm` | zählt vom Startpunkt der gerichteten Wand |
| Brüstungshöhe | `sill_height` | nur beim Fenster > 0 |
| Planungsstand (eines Geschosses) | `floor plan` (`GET …/floors/{id}/plan`) | Räume, Wände, Öffnungen in einer Antwort (Phase 4a) |
| Kontur speichern | `replace contour` (`PUT …/rooms/{id}/contour`) | vollständiger Zielzustand eines Raums, atomar (ADR 0014) |
| Grundrisseditor / grafischer Editor | `editor` (Frontend `modules/electrical/editor`) | SVG-Zeichenfläche (Phase 4a) |
| 2D-Editor / 3D-Ansicht / Tabellen & Details | Ansichtswerte `editor` / `3d` / `tabelle` | drei Ansichten desselben Serverstands (Phase 4b) |
| 3D-Ansicht | Frontend `modules/electrical/ansicht3d` | abgeleitet und schreibgeschützt (ADR 0016) |
| Szenenmodell | `Szenenmodell` (`szenenmodell.ts`) | aus dem Planungsstand abgeleitet, ganze Millimeter, unveränderlich |
| Szenenschicht | `Grundrissszene` (`szene.ts`) | imperative Three.js-Schicht mit Lebenszyklus |
| Logische Wand | `LogischeWand` | gespeicherte, gerichtete Wand eines Raums |
| Darstellungswand / Wandkörper | `Wand3d` | eine oder mehrere exakt deckungsgleiche logische Wände (T9) |
| gemeinsame Wand / nicht geteilte Wand | `Wandlage`: `gemeinsam` / `aussen` | abgeleitet, kein gespeicherter Wandtyp (T8) |
| atomarer Wandabschnitt | `Wandabschnitt` (Frontend, `topologie/`) | Stück einer Geraden zwischen zwei aufeinanderfolgenden Wandendpunkten mit festen überdeckenden Wänden; nur abgeleitet (ADR 0016, 4b.2) |
| Eigentümerwand (einer Öffnung) | `wall_id` der Öffnung | die eine Wand, an der eine Öffnung gespeichert ist |
| abgeleitete Raumverbindung | `Oeffnungseinordnung` (`gemeinsam`, `nachbarRaumId`) | zweiter Raum einer Öffnung auf einem gemeinsamen Abschnitt – nie gespeichert |
| Darstellungsdublette | – | dieselbe Öffnung auf beiden Raumseiten exakt gleich gespeichert; wird einmal gezeigt und zur Bereinigung gemeldet |
| Kanonische Wandrichtung | `kanonisch` | lexikografisch kleinerer Endpunkt zuerst |
| Darstellungswarnung / Hinweis | `Warnung` | Befund in gespeicherten Daten samt Darstellungsregel; ändert nichts |
| Entwurf (des Editors) | — (nur Frontend: `Raumentwurf`) | ungespeicherter lokaler Stand **eines** Raums; nicht zu verwechseln mit dem Konturzustand `draft` |
| Fang | `snap` (Frontend: `fangen`) | Einrasten auf Raster oder Wandendpunkt |
| Raster | `grid` (Frontend: `rasterMm`) | 10/50/100/250/500 mm |
| Ansicht / Viewport | `viewport` | Maßstab und Lage der Zeichenfläche - nie gespeichert |
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
