# API-Richtlinien

Version: 1.4 (Core-Geschäftsdaten, Electrical Room Model, Benutzerverwaltung, nummerierte Seiten)
Basis: FastAPI · OpenAPI 3.1 · JSON

---

## 1. Struktur und Versionierung

```
/api/v1/<resource>                      Core und Shared Business Modules
/api/v1/modules/<module-id>/<resource>  Fachmodule
/health/live  /health/ready             ohne Version
```

Beispiele:

```
GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/{project_id}
GET    /api/v1/materials
POST   /api/v1/offers/{offer_id}/versions
GET    /api/v1/modules/electrical/floors/{floor_id}/rooms
POST   /api/v1/modules/electrical/cable-routes/{route_id}/points
```

### Core-Geschäftsdaten (ab Phase 2)

```
GET    /api/v1/customers                      ?q= &kind= &sort= &page= &page_size=   (nummerierte Seiten, ADR 0017)
POST   /api/v1/customers
GET    /api/v1/customers/{customer_id}
PATCH  /api/v1/customers/{customer_id}                       If-Match
DELETE /api/v1/customers/{customer_id}                       If-Match  (endgültig, nur ohne Projekte, ADR 0020)

GET    /api/v1/projects                       ?q= &status= &status_group= &customer_id= &sort= &page= &page_size=
                                              q: Bezeichnung, Projektnummer, Baustellenort (nicht Kunde)
                                              status_group: current (draft+active) | closed (completed+archived)
                                              status und status_group zusammen: 422
                                              sort: created_at (Standard) | name | updated_at (seit 4.2)
POST   /api/v1/projects
GET    /api/v1/projects/{project_id}
PATCH  /api/v1/projects/{project_id}                         If-Match
GET    /api/v1/projects/{project_id}/deletion-check                 (Vorprüfung, ADR 0020)
DELETE /api/v1/projects/{project_id}                         If-Match  ?confirm_project_number=  (endgültig, ADR 0020)
POST   /api/v1/projects/{project_id}/activate                If-Match
POST   /api/v1/projects/{project_id}/complete                If-Match
POST   /api/v1/projects/{project_id}/archive                 If-Match
POST   /api/v1/projects/{project_id}/reopen                  If-Match  (completed -> active, nur Administrator)

GET    /api/v1/projects/{project_id}/buildings
POST   /api/v1/projects/{project_id}/buildings
PATCH  /api/v1/buildings/{building_id}                       If-Match
DELETE /api/v1/buildings/{building_id}                       If-Match  (Hard Delete)
GET    /api/v1/buildings/{building_id}/floors
POST   /api/v1/buildings/{building_id}/floors
PATCH  /api/v1/floors/{floor_id}                             If-Match
DELETE /api/v1/floors/{floor_id}                             If-Match  (Hard Delete)

POST   /api/v1/files                          multipart, optional project_id
GET    /api/v1/projects/{project_id}/files
GET    /api/v1/files/{file_id}
GET    /api/v1/files/{file_id}/download-url   JSON mit signierter Adresse
GET    /api/v1/files/{file_id}/download       307 auf die signierte Adresse
```

### Raummodell des Fachmoduls `electrical` (ab Phase 3)

Alle Pfade unter `/api/v1/modules/electrical` — Fachmodulrouten liegen unter ihrem Modul
(`docs/modules.md`, Abschnitt 5). Eigentümer der Endpunkte und der Tabellen
`electrical_*` ist das Modul, nicht der Core.

```
GET    /floors/{floor_id}/rooms            Räume des Geschosses
POST   /floors/{floor_id}/rooms
GET    /rooms/{room_id}
PATCH  /rooms/{room_id}                    If-Match
DELETE /rooms/{room_id}                    If-Match  (Hard Delete, kaskadiert)
GET    /rooms/{room_id}/contour            Prüfbericht der Raumkontur
GET    /rooms/{room_id}/walls              in Konturreihenfolge
POST   /rooms/{room_id}/walls              hängt hinten an die Kontur an
POST   /rooms/{room_id}/walls/reorder      If-Match (Version des **Raums**)
PATCH  /walls/{wall_id}                    If-Match
DELETE /walls/{wall_id}                    If-Match
GET    /walls/{wall_id}/openings
POST   /walls/{wall_id}/openings
PATCH  /openings/{opening_id}              If-Match
DELETE /openings/{opening_id}              If-Match

# Phase 4a (grafischer Editor, ADR 0014)
GET    /floors/{floor_id}/plan             Planungsstand eines Geschosses in einer Antwort
PUT    /rooms/{room_id}/contour            If-Match (Raumversion) - Raumgeometrie atomar ersetzen
POST   /floors/{floor_id}/rooms            optional mit `walls` - Raum samt Kontur atomar
```

**Raumversion = Version der Raumgeometrie (seit Phase 4a).** Jede wirksame Änderung an
Wänden oder Öffnungen eines Raums zählt auch die Raumversion weiter. Wer danach den Raum
ändert, umordnet oder die Kontur speichert, sendet die aktuelle Raumversion. Vertrag des
Konturspeicherns mit allen Fehlercodes: `docs/modules/electrical.md`, Abschnitt 9.

**Geometrie geht als Integer in Millimetern** über die Leitung, Flächen zusätzlich als
Dezimalstring in Quadratmetern (`area_m2`, drei Nachkommastellen). Die Regeln stehen in
[ADR 0013](decisions/0013-room-contour-as-ordered-wall-segments.md).

| Fall | Antwort |
|---|---|
| Geometrie unzulässig (entartete Wand, Überschneidung, Dublette, Öffnung außerhalb, Überlappung) | `422 validation-failed`; `errors[]` nennt je Befund einen stabilen `code` und eine deutsche Meldung |
| Raumnummer im Geschoss bereits vergeben | `422 validation-failed` |
| Wand mit Öffnungen löschen | `409 conflict` |
| Kontur speichern entfernt eine Wand, deren Öffnungen nicht ausdrücklich entfernt sind | `409 conflict`, Code `wall-has-openings` |
| Geschoss oder Gebäude mit Planungsdaten löschen | `409 conflict` (Fremdschlüssel `RESTRICT`) |
| Änderung würde eine vorhandene Öffnung ungültig machen | `422 validation-failed`, Änderung wird **nicht** ausgeführt |
| Projekt archiviert | `409 project-archived` — derselbe Fehlervertrag wie bei den Core-Unterressourcen |
| Fremdes oder unbekanntes Geschoss, Raum, Wand, Öffnung | `404 not-found` |

**`sort_order` vergibt der Server.** `POST …/walls` hängt die Wand hinten an; Umordnen ist
ein eigener Vorgang mit der **vollständigen** Liste der Wand-IDs. Eine Teilliste wäre
mehrdeutig, und eine vom Client gesetzte Position könnte Lücken erzeugen.

**Der Konturbericht ist ein `GET`**, kein Abschlussvorgang: Der Konturzustand ist
abgeleitet und wird nicht gespeichert (ADR 0013). Der Aufruf ändert nichts, ist beliebig
wiederholbar und liefert `contour_status` (`draft` / `valid`), Fläche, Umfang und die
Einzelbefunde.

**Keine Cursor-Pagination:** Ein Geschoss hat Räume in zweistelliger, ein Raum Wände in
einstelliger Anzahl. Die Sortierung ist trotzdem deterministisch — Räume nach Raumnummer,
dann Name, dann ID; Wände nach `sort_order`, dann ID; Öffnungen nach Abstand, dann ID.

### Benutzerverwaltung (ab Phase 4.2, ADR 0015)

```
GET    /api/v1/members                        ?q= &status=active|disabled|invited|removed &limit= &cursor=
GET    /api/v1/members/{member_id}
PATCH  /api/v1/members/{member_id}            If-Match  Name/E-Mail ändern (seit 4e)
POST   /api/v1/members/{member_id}/suspend    If-Match  sperren, Körper {"reason"?} (seit 4e Pflichtkörper)
POST   /api/v1/members/{member_id}/reactivate If-Match  entsperren
POST   /api/v1/members/{member_id}/password-reset       Einmal-Link erzeugen (201, seit 4e)
POST   /api/v1/members/{member_id}/remove     If-Match  endgültig entfernen, {"confirm_email"} (seit 4e)
GET    /api/v1/members/{member_id}/permissions         Rollen und effektive Rechte samt Herkunft
PUT    /api/v1/members/{member_id}/roles      If-Match  Systemrollen als Ganzes ersetzen
GET    /api/v1/roles                                   feste Systemrollen mit Zweck und Rechten
GET    /api/v1/invitations/policy                      Gültigkeit und Zustellweg
POST   /api/v1/invitations                             einladen (201)
GET    /api/v1/invitations/{invitation_id}
POST   /api/v1/invitations/{invitation_id}/revoke   If-Match
POST   /api/v1/invitations/{invitation_id}/reissue  If-Match  neues Token, neue Frist

# öffentlich, ohne Anmeldung - das Token steht im Körper
POST   /api/v1/invitation-acceptance/preview
POST   /api/v1/invitation-acceptance/new-account        (201)
POST   /api/v1/invitation-acceptance/existing-account   (201)
POST   /api/v1/password-reset/preview                   (seit 4e) nur Ablaufzeit
POST   /api/v1/password-reset/complete                  (seit 4e) 204

# eigene Einstellungen (seit 4e), ohne ID im Pfad
GET    /api/v1/me/preferences                           200, auch ohne Stand (stored=false)
POST   /api/v1/me/preferences                           201 - nur ohne Stand, sonst 409 preferences-exist
PUT    /api/v1/me/preferences                 If-Match  ganzer Stand
```

**Liste.** `GET /members` liefert Mitgliedschaften **und** offene Einladungen in einer
Liste (`kind`: `member` | `invitation`), sortiert nach Anzeigename ohne Groß-/Klein-
schreibung, dann ID; Keyset-Cursor über genau diese Werte. `status=invited` zeigt offene
Einladungen, auch abgelaufene (`invitation_expired`). Rollen werden je Seite in einer
Abfrage nachgeladen – kein N+1.

**Berechtigungen:** lesen `user.account.read`; widerrufen, neu ausstellen
`user.account.write`; sperren und entsperren seit 4e `user.account.lock`; Name/E-Mail
`user.profile.write`; Reset-Link `user.password.reset`; entfernen `user.account.remove`
(alle vier nur Administrator); eigene Einstellungen speichern `user.preferences.write`
(jede Systemrolle); Rollen und effektive Rechte lesen
`role.assignment.read`; Rollen vergeben `role.assignment.write`; **einladen verlangt
`user.account.write` und `role.assignment.write`**, weil die Einladung Rollen vergibt.

**Versionierung.** `If-Match` trägt die Version der **Mitgliedschaft** bzw. Einladung.
Eine Rollenänderung zählt die Mitgliedsversion weiter; eine Anmeldung nicht.

| Fall | Antwort |
|---|---|
| eigene Mitgliedschaft sperren oder entfernen / eigene Administratorrolle entfernen | `409 self-lockout` |
| Aktion an einem entfernten Konto (auch entsperren, Rollen, Profil, Reset) | `409 member-removed` |
| Name, E-Mail oder Reset bei einem Konto, das noch einem anderen Betrieb angehört | `409 account-shared` (ohne Betriebsnamen) |
| neue E-Mail gehört einem anderen Konto oder einer offenen Einladung dieses Betriebs | `409 email-unavailable` (eine Meldung für beide Fälle) |
| Bestätigungsadresse beim Entfernen passt nicht | `422`, `errors[].code` `confirmation_mismatch` |
| kein Zustellweg für Reset-Links | `503 password-reset-delivery-unavailable`, nichts angelegt |
| zu viele Reset-Links für ein Mitglied | `429` |
| danach bliebe kein aktiver Administrator | `409 last-administrator` |
| bereits gesperrt / bereits aktiv / Einladung schon angenommen oder widerrufen | `409 conflict` |
| unbekannte, doppelte oder nicht vergebbare Rolle (nur `is_system`) | `422`, `errors[].code` `unknown_role` / `duplicate_role` |
| E-Mail gehört dem Betrieb bereits an / offene Einladung existiert | `409 conflict` |
| kein Zustellweg eingerichtet | `503 invitation-delivery-unavailable`, nichts angelegt |
| fremde oder unbekannte ID | `404` |

**Einladungsantwort.** `POST /invitations` und `…/reissue` liefern `InvitationIssued`
mit `delivery` und – nur bei `ELEKTROPLAN_INVITATION_DELIVERY=development_link` –
`development_activation_url`. Kein anderer Endpunkt liefert Token oder Link.

**Lebenszyklus (seit 4e, ADR 0021).** `MemberOut` trägt zusätzlich `lock_reason`,
`updated_at`, `is_last_active_administrator` und `account_shared`; bei `status=removed` sind
`full_name` und `email` `null`. Die Liste zeigt ohne Filter aktive und gesperrte Mitglieder
sowie offene Einladungen; entfernte nur mit `status=removed` – ohne Name, E-Mail und
Namenssortierung, eine Suche findet sie nicht. `DirectoryEntryOut` trägt `created_at` und
`updated_at`. `PasswordResetIssued.reset_url` steht nur in dieser einen Antwort
(`ELEKTROPLAN_PASSWORD_RESET_DELIVERY=admin_link`). Die öffentliche Einlösung antwortet für
jeden ungültigen Link `404 password-reset-invalid`, bei Fehlversuchen je IP `429`, bei
schwachem Passwort `422` (Link bleibt gültig). **`POST …/suspend` entwertet alle offenen
Reset-Links der Mitgliedschaft** (danach `404 password-reset-invalid`, auch nach dem
Entsperren); `POST …/password-reset` ist für gesperrte Mitglieder weiter erlaubt – das
Passwort wird gesetzt, die Mitgliedschaft bleibt gesperrt. Bearbeiterangaben (`UserReference`) kennen
`kind=removed` („Entfernter Benutzer“).

**Einstellungen.** `PreferencesOut {stored, theme_mode, accent, length_unit, version}`;
`theme_mode ∈ system|light|dark`, `accent ∈ blue|teal|green|violet|orange`,
`length_unit ∈ mm|cm|m`. Unbekannte Werte und zusätzliche Felder `422`. Kein Upsert:
Anlage nur per `POST` ohne Stand, Änderung nur per `PUT` mit `If-Match`.

**Annahme.** Ungültige Tokens (unbekannt, abgelaufen, widerrufen, verwendet) erhalten
einheitlich `404 invitation-invalid`; Fehlversuche je IP begrenzt (`429`). Der Weg
`new-account` legt Konto, Mitgliedschaft und Rollen atomar an – existiert zur E-Mail ein
Konto, `409 invitation-requires-login` ohne Änderung. `existing-account` prüft das
Passwort des Kontos der eingeladenen E-Mail (`401` wie bei der Anmeldung) und ändert das
Konto nicht. Keiner der Wege stellt eine Sitzung aus.

### Zustand des Kunden bei der Projektzuordnung

Ein Projekt darf nur einem Kunden zugeordnet werden, der aktiv ist. Geprüft wird bei
`POST /projects` und bei einem `PATCH`, das `customer_id` ändert:

| Zustand des Kunden | Neue Zuordnung | Bestehende Zuordnung |
|---|---|---|
| aktiv | erlaubt | bleibt |
| gelöscht (Phase 4d) | `404` | nicht möglich – ein Kunde mit Projekten ist nicht löschbar |
| fremder Mandant | `404` | — |

Jeder unzulässige Fall liefert `404` — auch der fremde Mandant. Andernfalls wäre
ableitbar, dass es den Kunden gibt. Die Anonymisierung aus Phase 2 gibt es seit Phase 4d
nicht mehr (ADR 0020).

### Löschen und Wiedereröffnen (Phase 4d, ADR 0020)

**`GET /projects/{id}/deletion-check`** (`project.record.read`) beschreibt, was eine
Löschung bedeuten würde – **keine Autorisierung und keine Garantie**:

| Feld | Bedeutung |
|---|---|
| `status`, `version` | aktueller Stand (die Version ist das `If-Match` der Löschung) |
| `is_empty`, `contents[]` | leer oder erkannte Inhaltsarten `{code, label, count}` (`core.files`, `core.structure`, `electrical.rooms`, `electrical.walls`, `electrical.openings`) |
| `status_allows_deletion` | nur `draft` und `active` |
| `can_delete` | der angemeldete Benutzer dürfte jetzt löschen |
| `requires_admin`, `requires_number_confirmation` | Inhalte vorhanden – nur `project.record.purge`, nur mit Projektnummer |
| `blocked_code`, `blocked_reason` | `status` oder `permission` samt Erklärung |

**`DELETE /projects/{id}`** (Route: `project.record.delete`; bei Inhalt zusätzlich
`project.record.purge` und `confirm_project_number`) prüft alles erneut unter der
Projektsperre:

| Fall | Antwort |
|---|---|
| gelöscht | `204` – auch wenn das Storage-Objekt erst später entfernt werden kann |
| `If-Match` fehlt / veraltet | `428` / `409 version-conflict` |
| fremdes oder unbekanntes Projekt | `404` |
| Berechtigung fehlt (auch: Inhalt ohne `purge`) | `403 permission-denied` |
| `completed` oder `archived` | `409 project-not-deletable` |
| Inhalt, aber Projektnummer fehlt oder falsch | `409 deletion-confirmation-required` |
| Teilnehmer gescheitert | `500 project-deletion-failed` – nichts verändert |

**`POST /projects/{id}/reopen`** (`project.record.reopen`, nur Administrator): nur aus
`completed` → `active`; `archived` → `409 project-archived`; `draft`/`active` → `409`;
`If-Match` Pflicht. Die normalen Übergänge bleiben unverändert.

**`DELETE /customers/{id}`** (`customer.record.delete`, nur Administrator): physische
Löschung unter der Kundensperre. Ist dem Kunden irgendein Projekt zugeordnet – jeder
Status –, `409 customer-has-projects`. `If-Match` Pflicht.

Projekt- und Kundennummern werden nach einer Löschung nie wiederverwendet.

### Ersteller und letzter Bearbeiter (Phase 4d)

`CustomerOut`, `ProjectOut` und `ProjectSummary` tragen `created_by` und `updated_by`:
`{kind, user_id, display_name}` mit `kind` = `member` (Mitglied dieses Betriebs, Anzeigename,
nie E-Mail), `unknown` (Konto außerhalb des Betriebs – ohne Name und ID) oder `system`
(Bestandsdaten, gelöschtes Konto). Listen lösen die Bearbeiter einer Seite in einer
Abfrage auf. Änderungen an Gebäuden, Geschossen, Dateien und Planungsdaten setzen
`updated_at`/`updated_by` des Projekts, **ohne** dessen `version` zu erhöhen.

### Projektstatus

`draft → active → completed`, `archived` ist von jedem Zustand aus erreichbar und ein
Endzustand. Ein Wechsel außerhalb dieser Tabelle ist `409`. Einzige Rückkehr ist seit
Phase 4d die administrative Wiedereröffnung `completed → active`
(`POST /projects/{id}/reopen`, ADR 0020) – kein Teil der Übergangstabelle.

#### `archived` ist ein Schreibschutz

**Fachlich entschieden am 2026-09-19.** Ein archiviertes Projekt ist **vollständig
schreibgeschützt**. Lesen und das Herunterladen bestehender Dateien bleiben erlaubt;
jede Änderung wird abgelehnt:

| Zugriff | Antwort |
|---|---|
| `GET` auf Projekt, Gebäude, Geschosse, Dateiliste | erlaubt |
| `GET /files/{id}/download-url` · `/download` | erlaubt |
| `PATCH /projects/{id}` | `409` `project-archived` |
| `POST /projects/{id}/buildings` | `409` `project-archived` |
| `PATCH` · `DELETE` auf `buildings/{id}` | `409` `project-archived` |
| `POST /buildings/{id}/floors` | `409` `project-archived` |
| `PATCH` · `DELETE` auf `floors/{id}` | `409` `project-archived` |
| jeder schreibende Zugriff auf `modules/electrical/…` (Raum, Wand, Öffnung) | `409` `project-archived` |
| `POST /files` mit `project_id` des Projekts | `409` `project-archived` |
| `POST /projects/{id}/activate` · `/complete` · `/archive` | `409` (kein Wechsel aus `archived`) |
| `POST /projects/{id}/reopen` | `409` `project-archived` |
| `DELETE /projects/{id}` | `409` `project-not-deletable` (seit Phase 4d) |

Der eigene Fehlertyp `project-archived` erlaubt es Clients, diesen Fall ohne Auswerten
der Meldung von einem gewöhnlichen Konflikt zu unterscheiden.

**Auch unter Parallelität.** Wird ein Projekt archiviert, während eine Änderung an ihm
oder an einer Unterressource läuft, gibt es genau zwei Ausgänge: Die Änderung committet
zuerst und die Archivierung folgt, oder die Archivierung committet zuerst und die
Änderung erhält `409 project-archived`. Eine Änderung, die **nach** abgeschlossener
Archivierung wirksam wird, ist ausgeschlossen — das Projekt ist die gemeinsame Sperrwurzel
(docs/architecture.md, Abschnitt 7). Für den Datei-Upload heißt das: Die verbindliche
Prüfung erfolgt erst unmittelbar vor dem Commit, also nach der Übertragung. Ein Upload
kann deshalb mit `409 project-archived` scheitern, obwohl die Datei bereits übertragen
war; sie wird dann verworfen.

~~**Eine bewusste Ausnahme: das Ausblenden des Projekts.**~~ **Überholt mit Phase 4d**
(ADR 0020): `DELETE /projects/{id}` löscht endgültig und ist für archivierte Projekte
gesperrt. Soft Delete für Kunden und Projekte ist abgeschafft; Migration `0006` macht
früher ausgeblendete Zeilen wieder sichtbar, ohne eine zu löschen.

**Keine Wiederherstellung aus `archived`.** Aus `archived` führt kein Weg zurück. Die mit
Phase 4d eingeführte Wiedereröffnung betrifft ausschließlich `completed`.

Die Regel steht als **eine** Service-Vorbedingung im Backend und nicht verstreut je
Endpunkt. Die Oberfläche spiegelt sie: Formulare und Upload sind bei einem archivierten
Projekt ausgeblendet, und ein Hinweis benennt den Schreibschutz.

### Startstruktur bei der Projektanlage

Das Datenmodell bleibt `Kunde → Projekt → Gebäude → Geschoss`. Die Oberfläche nimmt dem
Regelfall nur die Handarbeit ab: Im Anlagedialog ist „Gebäude und Geschoss gleich mit
anlegen" vorausgewählt (`Hauptgebäude`, `Erdgeschoss`, Ebene 0, 2500 mm). Die Namen sind
änderbar, und wer die Struktur nicht braucht — etwa bei einem Serviceauftrag ohne
Raumplanung — wählt sie ab.

**Umgesetzt als Folgeablauf, nicht atomar.** Die Oberfläche ruft nacheinander
`POST /projects`, `POST /projects/{id}/buildings` und `POST /buildings/{id}/floors` auf.
Eine atomare Anlage hätte einen neuen, geschachtelten Endpunkt samt eigener
Transaktionsklammer gebraucht — eine API-Änderung für eine reine Bedienerleichterung.
Das steht in keinem Verhältnis, solange die drei Endpunkte für sich korrekt sind.

Die Folge daraus wird **nicht** verschwiegen: Schlägt ein späterer Schritt fehl,
existiert das Projekt bereits. Die Oberfläche unterscheidet dann zwei Stufen — schon das
Gebäude fehlgeschlagen, oder nur das Geschoss — und benennt im zweiten Fall den bereits
angelegten Gebäudenamen, damit niemand versehentlich ein zweites Hauptgebäude anlegt.
Bei einem Teilfehler **bleibt sie auf der Projektliste** stehen; ein Sprung ins Projekt
würde die Warnung mit dem Seitenwechsel verschlucken.

Bestehende Projekte werden davon nicht berührt; es gibt keine nachträgliche automatische
Strukturanlage.

**Kundenauswahl im Dialog.** Die Oberfläche sucht über `GET /api/v1/customers?q=…` mit
kleiner `page_size` und vergleicht `total_items` mit der Trefferzahl. Sie lädt also nicht
den ganzen Kundenstamm in den Browser und weist darauf hin, wenn es mehr Treffer gibt als
angezeigt. Jeder gelistete Kunde ist zuordenbar (seit Phase 4d gibt es keine
anonymisierten Kunden mehr).

**Baustellenadresse als Vorschlag.** Nach der Kundenwahl schlägt die Oberfläche die
Rechnungsadresse des Kunden (Straße, PLZ, Ort, Ländercode) als Baustellenadresse vor.
Gesendet wird, was im Formular steht; die Projektadresse ist danach eine unabhängige
Momentaufnahme. Es gibt **keine** Verknüpfung zwischen Kunden- und Projektadresse,
spätere Änderungen am Kunden wirken nicht auf bestehende Projekte. `site_country_code`
ist ein sichtbares Formularfeld und nicht mehr fest `DE`.

### Doppelte Geschossebene

Je Gebäude ist jede Ebene nur einmal belegbar. Der Konflikt liefert `422`
(`validation-failed`) mit der Meldung, dass die Ebene bereits belegt ist — **unabhängig
davon**, ob ihn die Vorabprüfung oder der eindeutige Index in der Datenbank erkennt.
Zwei gleichzeitige Anfragen bestehen die Vorabprüfung beide; genau eine gewinnt, die
andere erhält dieselbe `422`-Antwort und keinen `500`. Constraint-, SQL- und
Treiberdetails erscheinen nie in der Antwort.

**Zwei Download-Wege, bewusst.** `/download` antwortet mit `307` und ist der bequeme Weg
für API-Clients und `curl`. Die Weboberfläche kann ihn nicht verwenden: Ein einfacher
Link im Browser kann den `Authorization`-Header nicht setzen, und ein Token gehört nicht
in eine URL. Sie holt deshalb über `/download-url` die signierte Adresse als JSON und
navigiert anschließend dorthin. Beide Wege protokollieren den Zugriff.

- `v1` wird geführt, solange es genutzt wird. Brechende Änderungen erzeugen `v2`; beide
  laufen parallel, bis alle Clients migriert sind.
- Additive Änderungen (neues optionales Feld, neuer Endpunkt) sind innerhalb von `v1`
  erlaubt.
- Ressourcen im Plural, Kebab-Case in Pfaden, Snake-Case in JSON-Feldern.

---

## 2. Datentypen über die Leitung

| Typ | Übertragung | Beispiel |
|---|---|---|
| Geld | **String** | `"1234.56"` |
| Menge | **String** | `"45.900"` |
| Prozent | **String** | `"8.000"` |
| Geometrie (mm) | Integer | `3250` |
| ID | UUID-String | `"3f2a…"` |
| Zeitpunkt | ISO 8601 UTC | `"2026-09-18T07:15:00Z"` |
| Datum | ISO 8601 | `"2026-09-30"` |
| Einheit | Enum-String | `"meter"` |

**Begründung String bei Geld und Mengen:** JSON-Zahlen werden in JavaScript zu IEEE-754-
Doubles. Ein im Backend korrekt gerechneter `Decimal` wäre im Browser sofort wieder
ungenau. Siehe [ADR 0005](decisions/0005-money-rounding-and-quantities.md).

Geldfelder tragen immer eine Währung im umgebenden Objekt (`"currency": "EUR"`).

---

## 3. Fehlerformat (RFC 9457)

```json
{
  "type": "https://elektroplan.internal/errors/insufficient-stock",
  "title": "Nicht genügend Bestand",
  "status": 409,
  "detail": "Verfügbar sind 12.500 m, angefordert wurden 45.900 m.",
  "instance": "/api/v1/inventory/reservations",
  "request_id": "01JB3K…",
  "errors": [
    { "field": "quantity", "code": "insufficient", "message": "Menge übersteigt Bestand" }
  ]
}
```

`errors[].keys` (optional, seit Phase 4a): Kennungen der betroffenen Objekte, wenn sich
ein Befund einzelnen Datensätzen zuordnen lässt — etwa die IDs zweier sich schneidender
Wände. Fachneutral: Der Core reicht die Kennungen nur durch. Fehlt die Angabe, entfällt
das Feld.

Regeln:

- `Content-Type: application/problem+json`
- `type` ist stabil und maschinenlesbar; Clients werten `type` aus, nicht `title`.
- Keine Stacktraces, keine SQL-Fehler, keine internen Pfade.
- `request_id` in **jeder** Antwort (auch im Erfolgsfall als Header `X-Request-Id`).

| Status | Verwendung |
|---|---|
| 400 | Syntaktisch ungültige Anfrage |
| 401 | Nicht angemeldet / Token ungültig |
| 403 | Angemeldet, aber Permission fehlt |
| 404 | Nicht vorhanden **oder fremder Mandant** (bewusst nicht unterscheidbar) |
| 409 | Fachlicher Konflikt (Versionskonflikt, Bestand, Statuswechsel unzulässig, letzter Administrator) |
| 422 | Validierungsfehler im Inhalt |
| 428 | `If-Match` fehlt bei einer Aenderung an einer versionierten Entität (RFC 6585) |
| 429 | Rate Limit |
| 503 | Dienst nicht eingerichtet (z. B. kein Zustellweg für Einladungen) |
| 500 | Unerwarteter Fehler (generische Meldung) |

---

## 4. Auflistungen und Pagination

Zwei Muster, bewusst getrennt ([ADR 0017](decisions/0017-numbered-pages-for-customer-and-project-lists.md)):

**Keyset-Cursor** – Standard für Listen, die vollständig und stabil durchlaufen werden
(Protokoll, Benutzerverwaltung, künftige Stammdatenlisten):

```
GET /api/v1/materials?limit=50&cursor=eyJ…&q=NYM&category_id=…&sort=name
```

```json
{
  "items": [ … ],
  "next_cursor": "eyJ…",
  "has_more": true
}
```

- Kein `offset` (stabil bei gleichzeitigen Änderungen).
- `limit` Standard 50, Maximum 200.

**Nummerierte Seiten** – für die Backoffice-Listen Kunden (`GET /customers`) und
Projekte (`GET /projects`), die Seitenzahlen und eine Gesamtzahl brauchen:

```
GET /api/v1/projects?page=6&page_size=25&status_group=current&customer_id=…
```

```json
{
  "items": [ … ],
  "page": 6,
  "page_size": 25,
  "total_items": 587,
  "total_pages": 24
}
```

- `page` ab 1, `page_size` Standard 25, Maximum 100.
- `total_items` zählt **dieselbe** gefilterte, mandantenbeschränkte Abfrage wie die Seite
  (Unterabfrage) – nie fremde Betriebe, nie ungefilterte Mengen.
- Stabile Sortierung: Sortierspalte, dann ID.
- Seite hinter der letzten → letzte vorhandene Seite, `page` nennt sie. Leer:
  `page = 1`, `total_pages = 0`. `page < 1` oder `page_size` außerhalb → `422`.
- Ändert sich die Liste zwischen zwei Aufrufen, verschieben sich Einträge um eine
  Position. Für diese Listen ist das akzeptiert.
- Filter sind explizit definierte Query-Parameter, keine generische Filtersprache.
- Sortierung nur über eine Whitelist von Feldern.

---

## 5. Schreibende Operationen

- `POST` legt an und liefert `201` mit dem vollständigen Objekt.
- `PATCH` ändert teilweise.
- `PUT` ersetzt ausschließlich eine **vollständige Liste als Ganzes**, wo eine
  Teiländerung mehrdeutig oder nicht atomar wäre. Einziger Fall bisher:
  `PUT /modules/electrical/rooms/{room_id}/contour` (Phase 4a, ADR 0014). Vorgesehen war
  das Muster schon für die Punktlisten der Leitungswege.
- `DELETE` liefert `204`. Kunden und Projekte werden seit Phase 4d endgültig gelöscht
  (ADR 0020); Gebäude, Geschosse und Planungsdaten waren schon immer hart gelöscht.
- Zustandswechsel sind eigene Endpunkte, keine Statusfelder im `PATCH`:

```
POST /api/v1/calculations/{id}/finalize
POST /api/v1/offers/{offer_id}/versions/{version_no}/release
POST /api/v1/offers/{offer_id}/versions/{version_no}/mark-sent
POST /api/v1/work-orders/{id}/complete
```

Begründung: Ein Statuswechsel hat Vorbedingungen, Berechtigungen und Nebenwirkungen. Als
Feld in einem generischen `PATCH` wäre er weder prüfbar noch sauber protokollierbar.

### Optimistisches Sperren

Schreibende Anfragen auf versionierte Entitäten senden `If-Match: "<version>"`.
Akzeptiert werden die ETag-Schreibweise `"3"` und die nackte Zahl `3`.

| Fall | Antwort |
|---|---|
| Header fehlt | `428` mit `type: …/precondition-required` |
| Header passt nicht zur gespeicherten Version | `409` mit `type: …/version-conflict` |
| Header passt | Änderung wird ausgeführt |

**Der Header ist Pflicht, nicht optional.** Ein `PATCH` oder `DELETE` ohne `If-Match`
wäre ein stilles Überschreiben — die Versionsspalte hätte dann keinerlei Wirkung. `428`
(Precondition Required, RFC 6585) ist genau für diesen Fall vorgesehen: Der Server
verlangt, dass die Anfrage bedingt gestellt wird.

Versioniert sind in Phase 2: `customers`, `projects`, `buildings`, `floors`.
Ab Phase 3 zusätzlich: `electrical_rooms`, `electrical_walls`, `electrical_openings`.
Ab Phase 4.2 zusätzlich: `organization_members`, `member_invitations`.

Beim Umordnen der Wände trägt `If-Match` die Version des **Raums**: Die Reihenfolge gehört
der Kontur als Ganzes, nicht einer einzelnen Wand. Der Raum zählt dabei seine Version
weiter, damit ein zweiter Client den Wechsel bemerkt.

#### Genaue Syntax

Die API braucht bewusst nur eine **positive Ganzzahl** — keine vollständige
ETag-Grammatik. Akzeptiert wird ausschließlich:

```
If-Match: 3
If-Match: "3"
```

Umgebende Leerzeichen werden ignoriert. Alles andere ist `428`:

| Wert | Grund |
|---|---|
| `W/"3"` | schwacher Vergleich — eine Version ist exakt |
| `"3` · `3"` · `""3""` | unpaarige oder doppelte Anführungszeichen |
| `3, 4` · `"3", "4"` | Listen werden nicht unterstützt |
| `*` | Platzhalter wird nicht unterstützt |
| `0` · `-1` | Versionen beginnen bei 1 |
| `3.0` · `abc` · `+3` | keine ganze Zahl |
| `03` | führende Null |

Die Fehlermeldung spiegelt den gesendeten Wert **nicht** zurück.

#### Echter paralleler Konflikt

Die Vorabprüfung fängt den offensichtlichen Fall ab: Der Client hat einen alten Stand
gelesen. Sie kann aber nicht verhindern, dass **zwei gleichzeitige** Anfragen dieselbe
Version lesen und beide die Prüfung bestehen. Der Verlierer trifft dann beim Schreiben
keine Zeile mehr (`version_id_col`).

Auch dieser Fall ist ein fachlicher Versionskonflikt und **nie** ein `500`:

```json
{
  "type": "https://elektroplan.internal/errors/version-conflict",
  "title": "Versionskonflikt",
  "status": 409,
  "detail": "Der Datensatz wurde zeitgleich von einer anderen Anfrage geändert. Bitte neu laden und die Änderung wiederholen."
}
```

Clients behandeln beide Varianten gleich: neu laden, Änderung wiederholen. Die Antwort
enthält keine Datenbank- oder Bibliotheksdetails.

### Idempotenz

Bestandsverändernde Operationen akzeptieren `Idempotency-Key` (bzw. `client_txn_id` im
Body). Gleicher Schlüssel = gleiche Antwort, keine zweite Buchung. Pflicht für alle
Aufrufe der Baustellen-App.

---

## 6. Recompute-Endpunkte

Zu jeder eventgetriebenen Ableitung gehört ein expliziter, idempotenter Endpunkt
(siehe `docs/events.md`):

```
POST /api/v1/projects/{project_id}/material-requirements/recompute
POST /api/v1/calculations/{calculation_id}/check-stale
```

---

## 7. Modul- und Kontextendpunkte

```
GET  /api/v1/me                 Benutzer, aktive Organisation, Permissions
GET  /api/v1/me/organizations   Mitgliedschaften
GET  /api/v1/me/modules         aktive Module inkl. Version
POST /api/v1/auth/login         Anmeldung
POST /api/v1/auth/refresh       Sitzung erneuern (liest das Cookie, kein Body)
POST /api/v1/auth/logout        Abmelden (liest das Cookie, kein Body)
POST /api/v1/auth/switch-organization
```

### Sitzungsendpunkte: Cookie statt Antwortkörper

`TokenResponse` enthält **keinen** Refresh Token. Er verlässt den Server
ausschließlich als `HttpOnly`-Cookie (`Path=/api/v1/auth`, `SameSite=Strict`,
`Secure` in Produktion). Damit kann JavaScript ihn nicht lesen — und ein
XSS-Angriff ebenso wenig.

Folgen für Clients:

- Anfragen an Sitzungsendpunkte brauchen `credentials: "include"`.
- `/auth/refresh` und `/auth/logout` haben **keinen** Anfragekörper.
- Die vier cookiebasierten Endpunkte prüfen zusätzlich `Origin`/`Referer`
  (`403 csrf-validation-failed` bei fremder Herkunft), siehe
  `docs/security.md`, Abschnitt 12.
- Die spätere Baustellen-App erhält einen **getrennten** mobilen Tokenflow; sie
  verwendet dieses Schema nicht.

### Abgelehnte Anmeldung

Jede Ablehnung von `/auth/login` ist gleich: `401`, `type: …/authentication-failed`,
`detail` „Anmeldung nicht möglich. Bitte Zugangsdaten prüfen oder die Administration kontaktieren.“ – ob die Adresse unbekannt, das Passwort falsch, das Konto deaktiviert,
die Mitgliedschaft gesperrt, entfernt oder nicht vorhanden ist oder der gewählte Betrieb keine
aktive Mitgliedschaft hat. Kein `404`, kein Token, kein Cookie. Nach zu vielen Ablehnungen je
Konto oder IP `429 rate-limited`. Clients zeigen `detail` unverändert an.

### Mehrere Betriebe beim Login

Gehört ein Konto mehreren aktiven Betrieben an und wurde keiner gewählt,
antwortet `/auth/login` mit `409` und
`type: …/organization-selection-required`. Das Problem-Dokument enthält dann das
Feld `organizations` mit `id` und `name` zur Auswahl. Ein erneuter Login mit
`organization_id` schließt den Vorgang ab.

`GET /api/v1/me/modules` steuert die Sichtbarkeit im Frontend. Die eigentliche
Absicherung bleibt serverseitig.

---

## 8. OpenAPI und Client-Erzeugung

- Jeder Endpunkt hat `summary`, `description`, `response_model` und `operation_id`.
- `operation_id` ist stabil und sprechend (`listProjects`, `createOfferVersion`) — sie
  wird zum Funktionsnamen im generierten Client.
- `packages/api-client` wird per `openapi-typescript` erzeugt; ein CI-Schritt erzeugt neu
  und bricht bei Abweichung ab (Drift-Check).
- Fehlerantworten werden im Schema deklariert, nicht nur Erfolgsfälle.

---

## 9. Stabilitätszusagen

| Zusage | Bedeutung |
|---|---|
| Feldnamen in `v1` ändern sich nicht | Umbenennung erzeugt `v2` |
| `operation_id` ist stabil | Client-Code bleibt gültig |
| Enum-Werte werden nur ergänzt | Clients behandeln Unbekanntes tolerant |
| `type`-Werte von Fehlern sind stabil | Clients dürfen darauf verzweigen |
| Geld/Menge bleiben Strings | Keine stille Typänderung |
