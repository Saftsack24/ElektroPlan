# API-Richtlinien

Version: 1.2 (Core-Geschäftsdaten und Electrical Room Model umgesetzt)
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
GET    /api/v1/customers                      ?q= &kind= &sort= &limit= &cursor=
POST   /api/v1/customers
GET    /api/v1/customers/{customer_id}
PATCH  /api/v1/customers/{customer_id}                       If-Match
DELETE /api/v1/customers/{customer_id}                       If-Match  (Soft Delete)
POST   /api/v1/customers/{customer_id}/anonymize             If-Match  (DSGVO Art. 17)

GET    /api/v1/projects                       ?q= &status= &customer_id= &sort= &limit= &cursor=
POST   /api/v1/projects
GET    /api/v1/projects/{project_id}
PATCH  /api/v1/projects/{project_id}                         If-Match
DELETE /api/v1/projects/{project_id}                         If-Match  (Soft Delete)
POST   /api/v1/projects/{project_id}/activate                If-Match
POST   /api/v1/projects/{project_id}/complete                If-Match
POST   /api/v1/projects/{project_id}/archive                 If-Match

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
```

**Geometrie geht als Integer in Millimetern** über die Leitung, Flächen zusätzlich als
Dezimalstring in Quadratmetern (`area_m2`, drei Nachkommastellen). Die Regeln stehen in
[ADR 0013](decisions/0013-room-contour-as-ordered-wall-segments.md).

| Fall | Antwort |
|---|---|
| Geometrie unzulässig (entartete Wand, Überschneidung, Dublette, Öffnung außerhalb, Überlappung) | `422 validation-failed`; `errors[]` nennt je Befund einen stabilen `code` und eine deutsche Meldung |
| Raumnummer im Geschoss bereits vergeben | `422 validation-failed` |
| Wand mit Öffnungen löschen | `409 conflict` |
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

### Zustand des Kunden bei der Projektzuordnung

Ein Projekt darf nur einem Kunden zugeordnet werden, der aktiv ist. Geprüft wird bei
`POST /projects` und bei einem `PATCH`, das `customer_id` ändert:

| Zustand des Kunden | Neue Zuordnung | Bestehende Zuordnung |
|---|---|---|
| aktiv | erlaubt | bleibt |
| ausgeblendet (`deleted_at`) | `404` | bleibt |
| anonymisiert (`anonymized_at`) | `404` | bleibt, zeigt den Platzhalternamen |
| fremder Mandant | `404` | — |

Jeder unzulässige Fall liefert `404` — auch der fremde Mandant. Andernfalls wäre
ableitbar, dass es den Kunden gibt.

Ein anonymisierter Kunde bleibt für **bestehende** Projekte und aufbewahrungspflichtige
Belege lesbar, darf aber nicht für neue Geschäftsvorgänge reaktiviert werden
(`docs/security.md`, Abschnitt 13).

### Projektstatus

`draft → active → completed`, `archived` ist von jedem Zustand aus erreichbar und ein
Endzustand. Ein Wechsel außerhalb dieser Tabelle ist `409`.

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
| `DELETE /projects/{id}` (Soft Delete) | **erlaubt** — siehe unten |

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

**Eine bewusste Ausnahme: das Ausblenden des Projekts.** `DELETE /projects/{id}` bleibt
möglich. Es ist kein inhaltlicher Eingriff, sondern ein Aufräumschritt — und ohne diese
Ausnahme ließe sich ein Kunde mit archiviertem Projekt nie mehr ausblenden, weil die
Kundenlöschung offene Projekte zählt.

**Keine Wiederherstellung.** Aus `archived` führt kein Weg zurück. Sollte eine
Reaktivierung gebraucht werden, wird sie als eigener administrativer Vorgang mit eigener
Berechtigung eingeführt — nicht als stiller Statuswechsel.

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
kleinem `limit` und wertet `has_more` aus. Sie lädt also nicht den ganzen Kundenstamm in
den Browser und weist darauf hin, wenn es mehr Treffer gibt als angezeigt. Anonymisierte
Kunden werden ausgefiltert — der Server lehnt sie für neue Zuordnungen ohnehin ab.

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
| 409 | Fachlicher Konflikt (Versionskonflikt, Bestand, Statuswechsel unzulässig) |
| 422 | Validierungsfehler im Inhalt |
| 428 | `If-Match` fehlt bei einer Aenderung an einer versionierten Entität (RFC 6585) |
| 429 | Rate Limit |
| 500 | Unerwarteter Fehler (generische Meldung) |

---

## 4. Auflistungen und Pagination

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

- Cursor-basiert, kein `offset` (stabil bei gleichzeitigen Änderungen).
- `limit` Standard 50, Maximum 200.
- Filter sind explizit definierte Query-Parameter, keine generische Filtersprache.
- Sortierung nur über eine Whitelist von Feldern.

---

## 5. Schreibende Operationen

- `POST` legt an und liefert `201` mit dem vollständigen Objekt.
- `PATCH` ändert teilweise; `PUT` wird nicht verwendet.
- `DELETE` ist Soft Delete, wo fachlich vorgesehen, und liefert `204`.
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
