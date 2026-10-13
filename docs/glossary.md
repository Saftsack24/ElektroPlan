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
| Ausblenden (Soft Delete) | `deleted_at` | für Kunden und Projekte mit Phase 4d abgeschafft (Spalten entfernt, Zeilen wieder sichtbar); nur noch an `organizations` |
| Endgültig löschen | `DELETE` | physische Löschung aus der operativen Datenbank (Kunden, Projekte; ADR 0020) |
| Leeres Projekt | – (`is_empty`) | keine Dateien, höchstens ein Gebäude mit höchstens einem Geschoss, keine Planungsdaten eines Moduls |
| Projekt mit Inhalt löschen | `purge` (`project.record.purge`) | nur Administrator, Projektnummer als Bestätigung |
| Löschvorprüfung | `deletion-check` | Auskunft über Status, Inhalte und Berechtigung vor dem Löschen – keine Zusage |
| Löschschutz-Protokoll | `ProjectContentParticipant` | synchroner Contract, über den Fachmodule Projektinhalte melden und löschen |
| Inhaltsart | `ProjectContentItem.code` | `<modul>.<art>`, z. B. `core.files`, `electrical.rooms` |
| Wiedereröffnen | `reopen` (`project.record.reopen`) | abgeschlossenes Projekt wieder in Bearbeitung setzen, nur Administrator |
| Storage-Aufräumauftrag | `storage_cleanup_jobs` | vorgemerktes Storage-Objekt, das nach dem Commit gelöscht wird |
| Erstellt von / Zuletzt geändert von | `created_by` / `updated_by` | Bearbeiterangabe; „System/Bestandsdaten" ohne Bearbeiter |
| Projekt berühren | `touch` | `updated_at`/`updated_by` des Projekts setzen, ohne Versionssprung |
| Laufende / historische Ansicht | `?ansicht=abgeschlossen` (nur Oberfläche) | Projektliste: Entwurf + in Bearbeitung bzw. abgeschlossen + archiviert |
| Aktionsicon | `AKTION`, `Symbol` (nur Oberfläche) | einheitliche Icons aus `lucide-react`, immer mit Text |
| Geschossebene | `level` | `0` Erdgeschoss, `-1` Untergeschoss, `1` erstes Obergeschoss |
| Höhenlage des Fertigfußbodens | `elevation_mm` | ganzzahlige Millimeter |
| Bestätigte Höhenlage | `elevation_confirmed` | ausdrücklich bestätigter Wert von `elevation_mm` (Phase 6a, ADR 0025); Bestand und Neuanlage unbestätigt; eine Wertänderung ohne erneute Bestätigung entzieht sie; nie abgeleitet |
| Wandkopplung / Wandzuordnung | `wall_link` | Zuordnung zweier exakt aufeinanderliegender Raumwände verschiedener Räume; speichert nur die Entscheidung, keine Geometrie (ADR 0024). In der Oberfläche „Wandzuordnung“ |
| Gemeinsame Bauwand | `relation = shared` | beide Raumwände sind dieselbe Bauwand: Öffnungen gelten durchgehend |
| Getrennte Wände | `relation = separate` | zwei Bauwände auf derselben Achse (z. B. zweischalige Trennwand, Fuge): Öffnungen gelten nur für ihre eigene Wand; in 3D vereinfacht als zwei Halbkörper |
| Zuordnung offen (unentschieden) | Abschnittszustand `undecided` | keine wirksame Kopplung; vorsichtige Regel wie Phase 5 |
| Kopplung unterbrochen | Status `broken` | die gekoppelten Wände liegen nicht mehr aufeinander; die Kopplung bleibt gespeichert und wirkt wieder, sobald die Geometrie passt |
| Zwischenfläche | – | äußere Seite einer getrennten Wand; **keine** Fassade – Außenmontage verboten |
| Außenseite ohne modellierten Nachbarraum | Abschnittszustand `no-partner` | äußere Seite einer Raumwand ohne anderen Raum auf derselben Linie; keine gesicherte Fassade |
| Vorschlag (Kandidat) | `wall_link_candidate` | ungekoppeltes, exakt überlappendes Wandpaar mit Einordnung `suggested`, `decision-needed` oder `not-linkable`; wird nie automatisch gekoppelt |
| Bestandsübernahme (Backfill) | `wall-links-backfill`, `origin = backfill` | Befehl, der eindeutige Bestandsfälle als gemeinsame Bauwand anlegt; Standard Probelauf |
| Steigweg / Übergabepunkt | `riser` / `riser_stop` | ausdrücklich angelegter Geschossübergang je Gebäude bzw. sein Punkt je Geschoss auf Fertigfußbodenhöhe (ADR 0025); seit 6a.4–6a.5 |
| Verteilung | `distribution_board` | elektrischer Bezugspunkt eines Gebäudes (Code, Name), mehrere je Gebäude; Lage über ein Gerät des Typs `distribution_board` – seit 6b.0 (ADR 0026) |
| Stromkreis | `circuit` | Einheit an einer Verteilung; ihre Kabelangaben (`proposed_*`) sind **Vorschläge** für neue Leitungen, manuell und ungeprüft – seit 6b.0 |
| Gerätezuordnung | `circuit_device` | Gerät hängt an einem Stromkreis (höchstens einem); Steckdosen, Schalter, Leuchten und Abzweigdosen – nicht Datendosen und nicht das Lagegerät einer Verteilung – seit 6b.0/6b.1 |
| Abzweigdose | `junction_box` | Gerätetyp als Verzweigungspunkt künftiger Leitungen; kein Verbraucher – seit 6b.0 |
| Leitung | `cable` | physisches Kabel eines Stromkreises zwischen zwei Geräten mit eigenen tatsächlichen Kabelangaben – **Entwurf 6b** |
| Kabelangaben | `cable_type`, `conductor_count`, `cross_section_mm2` | Leitungstyp, Leiteranzahl, Querschnitt je Leitung; fehlt eine, ist die Leitung „unvollständig spezifiziert“ – **Entwurf 6b** |
| Planungsfläche | – | Wand (Innenseite), Decke (lichte Raumhöhe), Fußboden (FFB-Ebene) eines Raums, auf der Wegpunkte liegen – **Entwurf 6b** |
| Bodenübergang | `opening_crossing` | Fußbodenweg unter einer Tür oder einem Durchgang in den Nachbarraum; kein Weg unter geschlossenen Wänden – **Entwurf 6b** |
| Leitungsweg / Wegpunkt | `cable_waypoint` | Führung einer Leitung über verankerte Punkte an Wand, Decke, Fußboden, Durchführung, Bodenübergang, Steigweg – **Entwurf 6b** |
| Trasse | – (abgeleitet) | Strecke mit mindestens einer Leitung; exakt aufeinanderliegende Wege bilden eine Trasse, nie gespeichert – **Entwurf 6b** |
| Durchführung | `wall_penetration` | Durchquerung einer bestätigten gemeinsamen Bauwand, einmal an der Eigentümerwand gespeichert – **Entwurf 6b** |
| Anschlussstrecke | – (abgeleitet) | Strecke vom letzten Wegpunkt zur Gerätemitte – **Entwurf 6b** |
| Schachtfortsetzung | `shaft` (abgeleitet) | senkrechte Strecke über einem Steigweghalt bis zu einem Wand- oder Deckenpunkt genau darüber – seit 6b.2 |
| Trassenmeter / Leitungsmeter | – (abgeleitet) | Länge einer Trasse einmal gezählt bzw. Summe der Leitungslängen auf ihr je Leitung – seit 6b.2 |
| Teilsumme | `known_mm` | Summe der gültigen, bekannten Teile einer nicht bestätigten Leitung – nie eine Leitungslänge – seit 6b.2 |
| Anschlusszugabe / Reserve | `start_allowance_mm`, `end_allowance_mm`, `reserve_mm` | ausdrücklich je Leitung eingetragene Zusatzlänge, nie still – **Entwurf 6b** |
| Standard-Geschosshöhe | `default_ceiling_height_mm` | lichte Höhe in Millimetern |
| Protokolleintrag | `audit_entry` | |
| Statusgruppe | `status_group`: `current`, `closed` | Listenfilter: laufend (Entwurf + in Bearbeitung) bzw. abgeschlossen + archiviert |
| Nummerierte Seite | `page`, `page_size`, `total_items`, `total_pages` | seitenbasierte Liste für Kunden und Projekte (ADR 0017) |
| Anzeigeeinheit (Maßeinheit) | `length_unit` / `masseinheit`: `mm`, `cm`, `m` | persönliche Darstellung von Längen; gespeichert und übertragen wird immer in ganzen Millimetern (`m` seit 4e) |
| Persönliche Einstellungen | `user_preferences`, `/me/preferences` | Darstellung, Akzent, Maßeinheit je Benutzer und Betrieb; Server ist die Wahrheit, Browser nur Cache (ADR 0021) |
| Kontostatus | `organization_members.status`: `active`, `disabled`, `removed` | Aktiv, Gesperrt, Entfernt – Zustand eines Benutzers in einem Betrieb |
| Sperren / Entsperren | `suspend` / `reactivate` (`user.account.lock`) | Zugang zu diesem Betrieb sofort beenden bzw. wieder erlauben; alte Sitzungen bleiben ungültig |
| Sperrgrund | `lock_reason` | optionaler, kurzer Hinweis zur Sperre, ohne sensible Angaben |
| Benutzer entfernen | `remove` (`user.account.remove`) | endgültiger Tombstone, keine Wiederherstellung; Bearbeiterangaben zeigen „Entfernter Benutzer“ |
| Tombstone | – | verbleibende, neutralisierte Zeile eines entfernten Kontos, damit Referenzen auflösbar bleiben |
| Entfernter Benutzer | `UserReference.kind = "removed"` | neutrale Anzeige eines entfernten Mitglieds – ohne Name, E-Mail, ID |
| Exklusives Konto | – (`account_shared = false`) | Konto, das keinem anderen Betrieb (nicht entfernt) angehört; nur dann ändert ein Betrieb Name, E-Mail, Passwort |
| Sitzungsversion | `session_version` (Claim `sv`) | Zähler je Mitgliedschaft; jede sicherheitsrelevante Änderung macht alle älteren Tokens wertlos |
| Token-Familie | `refresh_token_family` (Tabelle `refresh_token_families`) | alle Refresh Tokens einer Sitzung seit Anmeldung oder Betriebswechsel; ihr Widerruf ist dauerhaft und schließt jede spätere Erneuerung aus |
| Sitzungskontext / Sitzungsraum | `Sitzungskontext` / `Sitzungsraum` (Planner, `core/sitzung`) | Benutzer + Betrieb + Mitgliedschaft aus dem Access Token / eigener Abfrage-Cache und eigenes Abbruchsignal je Kontext im Browser |
| Anfragegrenze | `rate limit` (`SlidingWindowLimiter`) | Höchstzahl von Anfragen je Schlüssel und Zeitfenster; Antwort `429` mit `Retry-After` |
| Anfragegrenze vs. Dateilimit (Upload) | `upload_request_max_bytes` / `upload_max_bytes` | ganze Anfrage samt Multipart-Rahmen / Inhalt der Datei |
| Passwort zurücksetzen | `password-reset`, `password_reset_tokens` | Einmal-Link, vom Administrator ausgelöst; das Passwort setzt die Person selbst |
| Einmal-Link | `reset_url`, Token im Fragment `#t=` | nur als Hash gespeichert, befristet, genau einmal verwendbar |
| Adressvorschlag | – (nur Oberfläche) | Rechnungsadresse des Kunden als Vorschlag für die Baustellenadresse; keine Verknüpfung |
| Rückfrage | – (nur Oberfläche, `Rueckfrage`) | eigener Bestätigungsdialog der Anwendung statt `window.confirm` |
| Design-Token (Theme-Token) | CSS Custom Property `--ep-*`, Tailwind-Name z. B. `bg-surface` | benannte Bedeutung einer Farbe oder Form („Oberfläche", „Akzent"), zur Laufzeit überschreibbar (ADR 0018) |
| Darstellungsmodus | `modus`: `system`, `light`, `dark` | „Wie das System", Hell, Dunkel; aufgelöst als `data-theme` am Wurzelelement |
| Akzentfarbschema | `akzent`: `blue`, `teal`, `green`, `violet`, `orange` | kuratierter, auf Kontrast geprüfter Satz aus Akzent, Hover, Fokus, Auswahl (ADR 0018) |
| Vorschau (Einstellungen) | `vorschau` (nur Oberfläche) | Entwurf sofort sichtbar, aber nicht gespeichert; „Übernehmen" speichert, Abbrechen stellt her |
| Klassenrezept | – (nur Oberfläche, `core/ui/stil.ts`) | typisierte Zusammenstellung von Tailwind-Klassen für ein wiederkehrendes Muster, etwa `knopf("primaer")` |

## Elektroplanung

Ergänzt in Phase 5 (Electrical Devices, ADR 0023):

| Deutsch | Englisch (Code/API) | Anmerkung |
|---|---|---|
| Gerät | `device` (`electrical_devices`) | geplantes Elektrogerät eines Raums; kein Herstellerartikel, keine Materialposition |
| Gerätetyp | `device type` (`electrical_device_types`) | Eintrag des globalen Systemkatalogs, per Seed gepflegt |
| Montagefläche | `mounting_surface`: `wall_interior` / `wall_exterior` / `ceiling` | Wand innen, Fassade außen, Decke – dauerhaft gespeichert |
| Gerätemitte | `center_offset_mm`, `center_height_mm` bzw. `x_mm`/`y_mm` | Bezugspunkt jeder Gerätelage |
| Planungsmaß | `width_mm` × `height_mm` des Typs | vereinfachtes Rahmen-/Auslassmaß zur Prüfung, keine Herstellerangabe |
| Standardhöhe | `default_center_height_mm` | Startwert der Mitte über FFB, keine Normvorgabe |
| Planungssymbol | `symbol_key` | eigenes SVG-Symbol (T1), ohne DIN-Anspruch |
| Raumtyp | `room_type` | optional, nur Einordnung (T7): Wohnzimmer … Sonstiges |
| Systemkatalog / Stammdaten-Seed | `ReferenceDataSeeder` | idempotenter Abgleich mitgelieferter Kataloge, deaktiviert statt zu löschen |
| Wandgerät / Deckengerät | wall device / ceiling device | Deckengeräte haben keine eigene Höhe – sie folgen der Raumhöhe |

Ergänzt in Phase 4f (Wand- und Deckenansicht, ADR 0022):

| Deutsch | Englisch (Code/API) | Anmerkung |
|---|---|---|
| Wandansicht | wall view (`wandansicht/`) | eine Wand frontal aus ihrem Raum; keine Persistenz |
| Deckenansicht | ceiling view (`deckenansicht/`) | Decke eines Raums wie ein Deckenspiegel, Ausrichtung wie der Grundriss |
| Blickrichtung | view direction | aus dem Raum auf die Wand; bestimmt links und rechts |
| Abstand von links / von rechts | — (Ansicht), gespeichert `offset_mm` | lichtes Maß Wandkante bis Öffnungskante in der Ansicht |
| Brüstung (über Boden) | `sill_height_mm` | Fertigfußboden bis Unterkante; nur beim Fenster > 0 |
| Abstand zur Decke | — | Oberkante bis effektive Raumhöhe |
| Achsmaß | — | Abstand zur Mitte einer Öffnung; immer so benannt |
| Einrasten | snap (`wandfang.ts`) | Fang an Wandkanten, Mitten, Öffnungskanten, gleichen Höhen, Raster |
| Hilfslinie / Maßlinie | guide / dimension line | angezeigte Maße zur gewählten oder bewegten Öffnung |
| Quellöffnung | source opening | die eine gespeicherte Öffnung an ihrer Eigentümerwand |
| abgeleitete Öffnung | derived opening | Darstellung einer Quellöffnung auf der Gegenseite, nicht bearbeitbar |
| Fertigfußboden (FFB) | finished floor level | Bezug aller Höhen (`z = 0`) |

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
