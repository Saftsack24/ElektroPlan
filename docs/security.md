# Sicherheitskonzept

Version: 1.0 (Phase 0)
Geltungsbereich: Backend, Planner (Web), später Baustellen-App

---

## 1. Schutzbedarf

| Datenkategorie | Beispiele | Schutzbedarf | Begründung |
|---|---|---|---|
| Personenbezogene Daten | Kunden, Adressen, Ansprechpartner, Mitarbeiter | **hoch** | DSGVO, Art. 9 nicht betroffen, aber Betroffenenrechte gelten |
| Gebäudedaten | Grundrisse, Verteilerstandorte, Schließpläne im Umfeld | **hoch** | Einbruchsrelevanz |
| Interne Wirtschaftsdaten | Einkaufspreise, Stundensätze, Margen, Kalkulationen | **hoch** | Existenzrelevant bei Abfluss zum Wettbewerb |
| Geschäftsdokumente | Angebote, Aufträge | mittel | Vertraulichkeit gegenüber Dritten |
| Stammdaten | Materialkatalog ohne Preise | niedrig | — |

Die beiden kritischsten Anforderungen des Systems sind:
**(1) Mandantentrennung** und **(2) Trennung interner Kalkulation vom Kundendokument.**

---

## 2. Bedrohungsmodell (Kurzform)

| Bedrohung | Gegenmaßnahme |
|---|---|
| Zugriff auf Daten einer fremden Organisation | Vierstufige Mandantentrennung (Abschnitt 5) |
| Interne Preise/Margen im Kundenangebot | Angebotstabellen ohne Kostenspalten (strukturell) |
| Rechteausweitung durch manipulierten Request | Serverseitige Permission-Prüfung an jedem Endpunkt |
| Gestohlenes Token | Kurzlebige Access Tokens, rotierende Refresh Tokens, Widerruf |
| Brute Force auf Login | Rate Limiting, Verzögerung, Sperre nach Fehlversuchen |
| Schadhafter Datei-Upload | Typprüfung, Größenlimit, getrennte Auslieferung, kein Ausführungspfad |
| SQL-Injection | ORM mit Parametern, kein String-Building |
| Datenverlust | Backups, Restore-Test, append-only Journale |
| Unbemerkte Manipulation | Audit Log für kritische Aktionen |

---

## 3. Authentifizierung

- **Passwort-Hashing:** Argon2id (`argon2-cffi`), Parameter im Code dokumentiert und
  versionierbar. Kein bcrypt, kein SHA-Derivat.
- **Passwortregeln:** Mindestlänge 12, Abgleich gegen eine Liste bekannter Passwörter,
  keine erzwungene periodische Änderung (entspricht BSI-/NIST-Empfehlung).
- **Access Token:** JWT, kurzlebig (15 Minuten), enthält `user_id`, `organization_id`,
  `token_version`. Berechtigungen stehen **nicht** im Token — sie werden serverseitig
  geladen, damit Entzug sofort wirkt.
- **Refresh Token:** zufälliger, hoch-entroper Wert, nur als Hash gespeichert
  (`refresh_tokens`), Rotation bei jeder Nutzung, Wiederverwendung eines alten Tokens
  invalidiert die gesamte Familie (Diebstahlserkennung).
- **Widerrufsgründe.** Der ersetzte Datensatz einer Rotation wird atomar
  mit `replaced_by_id` an den Nachfolger gebunden und mit einem
  expliziten `revoked_reason` versehen. Genau ein Grund bedeutet
  "regulär ersetzt": `rotated`. Alle übrigen (`logout`,
  `reuse_detected`, `family_revoked`) machen den Token sofort und
  eindeutig ungültig. Nur ein `rotated`-Token gilt innerhalb des
  Toleranzfensters (`ELEKTROPLAN_REFRESH_RACE_GRACE_SECONDS`) als
  paralleler Refresh. Ein durch Logout oder Familienwiderruf beendeter
  Token löst bei erneuter Vorlage **keinen** zusätzlichen
  Sammelwiderruf mehr aus — die Ursachenkette bleibt lesbar.
- **`RefreshConflictError` → HTTP 401.** Ein paralleler Refresh ist
  serverseitig kein Angriff, aber das Frontend hat kein separates
  Auswertungssignal für 409 im Single-Flight-Renewer. Das bestehende
  `AuthProvider.renewSession` interpretiert die Antwort als „Sitzung
  noch nicht renewt, in aktuellem Cookie steht bereits der Nachfolger",
  wiederholt den Aufruf mit dem frischen Cookie und kommt so an einen
  gültigen Access Token. Der Statuscode ist bewusst gemeinsam von API
  und Frontend gewählt; er wird nur mit einer neuen Frontend-Version
  verändert.
- Die Migration `0002_refresh_revocation` hat die Revisions-ID auf 23
  Zeichen gekürzt, damit sie in
  `alembic_version.version_num (VARCHAR(32))` sicher passt.
- **Transport Web:** Der Refresh Token verlässt den Server **ausschließlich** als
  `HttpOnly; Secure; SameSite=Strict`-Cookie mit engem `Path=/api/v1/auth`. Er steht
  **nicht** im Antwortkörper von Login, Refresh oder Mandantenwechsel — sonst könnte
  JavaScript ihn lesen und der HttpOnly-Schutz gegen XSS wäre wirkungslos. Die Endpunkte
  `/auth/refresh` und `/auth/logout` haben deshalb gar keinen Anfragekörper; sie lesen
  das Cookie.
- **Transport App (später):** Die Baustellen-App erhält einen **ausdrücklich getrennten**
  mobilen Tokenflow mit sicherem Gerätespeicher (Keystore/Keychain über Capacitor). Er
  wird erst mit Phase 13 gebaut und teilt sich **nicht** das Response-Schema des
  Webflows — andernfalls bekäme der Webclient den Refresh Token wieder lesbar zurück.
- **Logout:** widerruft die Token-Familie serverseitig, nicht nur clientseitig.
- MFA ist im MVP nicht enthalten, aber im Datenmodell nicht ausgeschlossen.

---

## 4. Autorisierung

- Jede schreibende Route deklariert ihre Permission explizit:
  `Depends(require_permission("offer.version.approve"))`.
- Ein Test iteriert alle Routen; eine Route ohne Deklaration lässt den Test scheitern.
- Berechtigungen werden pro Request aus der Mitgliedschaft geladen (kein Vertrauen auf
  Client-Angaben, kein Cache über Requests hinweg im MVP).
- Verweigerung: `403` ohne Hinweis auf die Existenz fremder Objekte; nicht existierende
  **oder fremde** Objekte liefern `404`.

### Umfang des Rollenmodells im MVP

Was **heute** existiert und geprüft ist:

- sechs fest ausgelieferte Systemrollen (Admin, Planer, Kalkulator, Monteur, Lager,
  Einkauf) als Seed je Organisation,
- eine **statische** Zuordnung von Permissions zu diesen Rollen, definiert im Code
  (`app/core/authorization/permissions.py`),
- serverseitige Prüfung über flache Permission-Schlüssel.

**Berechtigungen von Modulen** (seit Phase 3): Der Administrator erhält **jede**
registrierte Berechtigung — sonst verliert er mit jedem neuen Modul an Reichweite,
obwohl seine Rolle „Vollzugriff" heißt. Die übrigen Systemrollen erhalten genau die
Schlüssel, die das Modul ihnen in `PermissionDef.default_roles` zuschreibt
(`electrical.plan.read` für Planer, Kalkulator und Monteur, `electrical.plan.write` für
den Planer). Der Core kennt dabei keine Modulschlüssel; er liest sie aus der Module
Registry. Eine bestehende Rolle **verliert** beim erneuten Seed nie eine Berechtigung —
es werden nur fehlende ergänzt.

Was es **noch nicht** gibt — und was deshalb nirgends behauptet wird:

- keine Rollenvererbung,
- keine bedingten oder datenabhängigen Policies,
- kein Rolleneditor in der Oberfläche; Rollen lassen sich in Phase 1 **nicht** anpassen
  oder kopieren,
- keine Benutzerverwaltungs-Oberfläche (Anlage erfolgt über den Seed),
- keine Lizenz-, Abrechnungs- oder Trial-Logik.

Das Datenmodell (`roles`, `role_permissions`, `member_roles` je Organisation) lässt
spätere Anpassbarkeit zu. Bis eine geprüfte Funktion dafür existiert, gilt der Umfang
oben.

---

## 5. Mandantentrennung

Vier Ebenen. Jede einzelne würde theoretisch genügen; zusammen überleben sie einen Fehler.

| Ebene | Mechanismus |
|---|---|
| 1 — Schema | `organization_id NOT NULL` auf jeder mandantenbezogenen Tabelle |
| 2 — Referenzen | Zusammengesetzte Fremdschlüssel `(organization_id, id)` — ein mandantenübergreifender Verweis ist technisch unmöglich |
| 3 — Zugriffsschicht | `TenantRepository` setzt den Filter; ein Query ohne Organisationskontext wirft `MissingTenantContext` |
| 4 — Test | Automatischer Sweep über **alle** Routen mit zwei Testorganisationen |

Der aktive Mandant stammt ausschließlich aus dem geprüften Token, **nie** aus Header,
Query oder Body. Ein Organisationswechsel erfordert einen neuen Token-Austausch gegen die
Mitgliedschaft.

Vorbereitet, aber im MVP nicht aktiviert: PostgreSQL Row Level Security
(`SET LOCAL app.current_organization`) als fünfte Ebene.

---

## 6. Eingabevalidierung

- Alle Ein- und Ausgaben über Pydantic-Schemas; keine ungetypten `dict`-Durchreichungen.
- Whitelist statt Blacklist; unbekannte Felder werden abgelehnt (`extra="forbid"`).
- Grenzen für Listenlängen (z. B. Polygonpunkte, Streckenpunkte) und Textlängen.
- Geometrie wird fachlich validiert (mindestens 3 Punkte, keine Selbstüberschneidung,
  plausible Maße) — nicht nur syntaktisch.
- IDs sind UUIDs; keine fortlaufenden Zahlen in URLs (keine Aufzählbarkeit).

---

## 7. Datei-Uploads

| Maßnahme | Umsetzung |
|---|---|
| Größenlimit | serverseitig, pro Datei und pro Projekt |
| Typprüfung | erlaubte MIME-Typen als Whitelist + Prüfung des tatsächlichen Inhalts (Magic Bytes), nicht nur der Endung |
| Dateiname | nie als Pfad verwendet; Speicherung unter generiertem Key |
| Auslieferung | zeitlich begrenzte, autorisierte URLs; `Content-Disposition: attachment` |
| Origin | Nutzerinhalte nie unter dem Anwendungs-Origin ausliefern |
| SVG/HTML | nicht als anzeigbarer Inhalt zugelassen (XSS-Vektor) |
| Integrität | SHA-256 bei Upload gespeichert |
| Virenscan | im MVP nicht enthalten, vor kommerziellem Einsatz nachrüsten |
| Streaming | Der Upload wird stückweise gelesen (64 KiB); das Größenlimit greift **während** des Lesens. Gepuffert wird in einer `SpooledTemporaryFile`, die oberhalb 1 MiB auf die Festplatte auslagert — keine unbegrenzte Datei im Arbeitsspeicher. |
| Projektzuordnung | Ein Upload mit `project_id` wird gegen den mandantengefilterten Projektdienst geprüft; ein fremdes Projekt liefert `404`. Der Speicherschlüssel lautet dann `org/<org-id>/project/<project-id>/<file-id><ext>`. |
| Download im Browser | `GET /files/{id}/download-url` liefert die signierte Adresse als JSON, der Browser navigiert anschließend dorthin. Ein Link direkt auf den API-Endpunkt käme ohne `Authorization`-Header nicht durch; ein Token in der URL ist ausgeschlossen. |
| Dateiname im Header | `Content-Disposition` wird injektionssicher gebaut: Steuerzeichen, Zeilenumbrüche, Anführungszeichen und Backslashes werden ersetzt, der Originalname folgt prozentkodiert als `filename*` (RFC 6266). |
| Verwaiste Objekte | Reihenfolge: Datenbankzeile → Storage-Upload → Commit. Scheitert der Upload, wird die Transaktion zurückgerollt (kein Datensatz ohne Objekt). Scheitert der Commit, wird das Objekt gelöscht (kein Objekt ohne Datensatz). Gelingt auch das Löschen nicht, wird der Schlüssel unter `orphan_object_cleanup_failed` protokolliert und über einen manuellen Cleanup-Lauf entfernt. |

---

## 8. Secrets und Konfiguration

- Keine Secrets im Repository. `.env.example` enthält nur Platzhalter, `.env` ist ignoriert.
- Konfiguration über Umgebungsvariablen (`pydantic-settings`), typisiert und beim Start
  validiert — ein fehlendes Secret verhindert den Start.
- Getrennte Werte für Entwicklung, Test und Produktion.
- Rotationsfähigkeit: JWT-Signaturschlüssel mit Key-ID, damit ein Wechsel ohne Totalausfall
  möglich ist.
- Datenbank- und Storage-Zugangsdaten nie im Frontend, nie in Logs.

---

## 9. Audit

Explizit protokolliert werden mindestens:

- Anmeldung, fehlgeschlagene Anmeldung, Logout
- Änderung von Rollen und Berechtigungen
- Anlegen/Ändern/Löschen von Kunden und Projekten
  (`customer.created`, `customer.updated`, `customer.deleted`, `customer.anonymized`,
  `project.created`, `project.updated`, `project.deleted`, `project.status_changed`)
- Materialpreisänderungen
- Finalisierung einer Kalkulation
- Freigabe, Versand und Statuswechsel einer Angebotsversion
- Bestandskorrekturen und manuelle Lagerbuchungen
- Auftragsabschluss
- Dateizugriff auf Angebote und Pläne (Download)

Ein Audit-Eintrag enthält: Wer, Was, Wann, Welches Objekt, Request-ID, relevante
Änderungswerte. Audit-Einträge werden **explizit an fachlichen Punkten** geschrieben,
nicht generisch über ORM-Hooks, und sind nicht änderbar.

---

## 10. Logging

- Strukturiertes JSON-Logging mit `request_id`, `user_id`, `organization_id`, `module`,
  `route`, `status`, `duration_ms`.
- **Nie geloggt:** Passwörter, Tokens, Cookie-Werte, vollständige Kundenadressen,
  Einkaufspreise, Dateiinhalte.
- Fehler nach außen nach RFC 9457 ohne interne Details; Stacktraces bleiben im Server-Log
  und werden über die `request_id` zugeordnet.

---

## 11. Rate Limiting und Missbrauchsschutz

| Endpunktgruppe | Grenze (Startwert) |
|---|---|
| `POST /auth/login` | 10 Versuche / 15 min / IP **und** / Konto |
| `POST /auth/refresh` | 60 / Stunde / Konto |
| Datei-Upload | 100 / Stunde / Organisation |
| Schreibende API allgemein | 600 / min / Organisation |
| PDF-Erzeugung | 30 / min / Organisation |

Umsetzung zunächst in der Anwendung (in-memory je Prozess) — ausreichend für den
Einzelbetrieb; bei Mehrinstanzbetrieb auf einen gemeinsamen Zähler umstellen.

---

## 12. Transport und Browser-Härtung

### Header, die das Backend selbst setzt

| Header | Wert | Geltung |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | immer |
| `X-Frame-Options` | `DENY` | immer |
| `Referrer-Policy` | `same-origin` | immer |
| `Cross-Origin-Opener-Policy` | `same-origin` | immer |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` | Produktion |
| `Content-Security-Policy` | zusätzlich die von Swagger UI benötigten Quellen (`cdn.jsdelivr.net`) | Entwicklung |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | **nur** Produktion |

**Zuständigkeiten — bewusst getrennt:**

- Diese API liefert ausschließlich JSON aus. Die strikte CSP ist deshalb
  angemessen; in der Entwicklung ist sie gelockert, weil `/docs` (Swagger UI)
  Skripte und Styles von einem CDN lädt. In Produktion ist `/docs` abgeschaltet.
- Die **Auslieferung des Planners** erfolgt durch Vite bzw. später durch einen
  Webserver. Dessen CSP wird **dort** gesetzt, nicht im Backend — das Backend
  kann sie nicht beeinflussen.
- `Strict-Transport-Security` setzt das Backend nur bei
  `ELEKTROPLAN_ENVIRONMENT=production`. Terminiert TLS an einem Reverse Proxy,
  darf dieser den Header ebenfalls setzen. Wird TLS ausschließlich am Proxy
  terminiert, liegt die Verantwortung dort — das Backend behauptet nicht, HTTPS
  selbst zu erzwingen.

### CORS

Enge Whitelist aus `ELEKTROPLAN_CORS_ORIGINS`, `allow_credentials=true`, **keine**
Wildcards. Erlaubte Methoden: `GET, POST, PATCH, DELETE, OPTIONS`. Erlaubte
Header: `Authorization`, `Content-Type`, `X-Request-Id`, `If-Match`.

### CSRF

Umgesetzt ist eine **zweistufige, überprüfbare** Lösung — kein Double-Submit-Token:

1. **`SameSite=Strict`** auf dem Refresh-Cookie. Moderne Browser senden es bei
   siteübergreifenden Anfragen überhaupt nicht mit.
2. **Strenge Herkunftsprüfung** (`require_trusted_origin`) auf allen
   cookiebasierten Endpunkten (`/auth/login`, `/auth/refresh`, `/auth/logout`,
   `/auth/switch-organization`): Ist ein `Origin`- oder `Referer`-Header
   vorhanden, muss er zu den konfigurierten Origins passen, sonst `403`
   (`csrf-validation-failed`).

Fehlen **beide** Header, wird die Anfrage zugelassen. Begründung: Browser senden
`Origin` bei zustandsändernden Anfragen immer mit; fehlt er, stammt die Anfrage
nicht aus einem Browserkontext und kann kein CSRF-Opfer sein. Diese Entscheidung
ist bewusst getroffen und hier dokumentiert — sie wird nicht als vollwertiger
Token-Schutz ausgegeben.

Alle übrigen Endpunkte verwenden `Authorization: Bearer` und sind schon deshalb
nicht CSRF-anfällig: Ein Angreifer kann den Header nicht setzen lassen.

### Cookie-Attribute des Refresh-Cookies

| Attribut | Wert | Zweck |
|---|---|---|
| `HttpOnly` | ja | für JavaScript unlesbar |
| `Secure` | nur Produktion | lokale Entwicklung läuft über HTTP |
| `SameSite` | `Strict` | keine siteübergreifende Übertragung |
| `Path` | `/api/v1/auth` | wird nur zu den Sitzungsendpunkten gesendet |
| `Max-Age` | `ELEKTROPLAN_REFRESH_TOKEN_DAYS` (Standard 14 Tage) | begrenzte Lebensdauer |

Beim Abmelden wird das Cookie mit **denselben** Attributen (`Path`, `Secure`,
`SameSite`, `HttpOnly`) gelöscht — andernfalls bliebe es im Browser stehen.

---

## 13. DSGVO / Datenschutz

> **Zeitgrenze — korrigiert.** Frühere Fassungen dieses Dokuments verschoben die
> DSGVO-Anforderungen auf den "ersten externen Mandanten". Das ist falsch.
> Die Pflichten gelten ab der **ersten Verarbeitung echter personenbezogener
> Daten** — auch bei rein interner Nutzung im eigenen Elektrofachbetrieb, weil
> Kunden, Ansprechpartner und Mitarbeiter betroffene Personen sind.
>
> **Phase 2 führt genau diese Daten ein** (Kunden, Adressen, Kontakte). Die
> Voraussetzungen unten müssen deshalb **vor** dem ersten Echtdatensatz erfüllt
> sein. Bis dahin gilt: **ausschließlich synthetische Testdaten.**

### Voraussetzungen vor dem ersten echten Kundendatensatz

| # | Anforderung | Was konkret vorliegen muss |
|---|---|---|
| 1 | Zweck und Rechtsgrundlage | Schriftlich: Vertragserfüllung bzw. -anbahnung (Art. 6 Abs. 1 lit. b) für Kunden- und Projektdaten; berechtigtes Interesse (lit. f) für Audit und Betrieb |
| 2 | Datenminimierung | Feldliste je Entität mit Zweck; keine Felder „für später“ |
| 3 | Auskunft und Export | Verfahren, wie alle Daten zu einer Person zusammengestellt und ausgegeben werden |
| 4 | Berichtigung | Änderbarkeit der Stammdaten, ohne Geschäftsdokumente zu verfälschen |
| 5 | Löschung / Anonymisierung | Umgesetzter Pfad, der personenbezogene Felder anonymisiert und aufbewahrungspflichtige Belege erhält |
| 6 | Aufbewahrungspflichten | Festgelegt, welche Dokumente nach HGB/AO/GoBD 6 bzw. 10 Jahre bleiben |
| 7 | Trennung löschbar / aufbewahrungspflichtig | Dokumentiert je Tabelle: löschbar, anonymisierbar oder aufbewahrungspflichtig |
| 8 | Backup und Restore | Regel, wie eine Löschung wirkt, wenn ein älteres Backup zurückgespielt wird (Wiederholung der Löschung nach Restore, protokolliert) |
| 9 | Protokoll- und Audit-Aufbewahrung | Audit 12 Monate, Anwendungslogs 30 Tage; keine personenbezogenen Daten in Logs |
| 10 | Auftragsverarbeitung | AV-Verträge mit **allen** Verarbeitern: Hosting, Backup, Object Storage, E-Mail-Versand, Monitoring — auch bei rein interner Nutzung, sobald Dritte beteiligt sind |
| 11 | Verzeichnis von Verarbeitungstätigkeiten | Erstellt und gepflegt (Art. 30) |
| 12 | Technische und organisatorische Maßnahmen | Dokumentiert (Art. 32): Zugriffskontrolle, Verschlüsselung im Transport, Protokollierung, Backup, Wiederherstellbarkeit |

### Feldliste und Zweck (Datenminimierung, Punkt 2)

Verarbeitet werden ausschließlich die folgenden personenbezogenen Felder. Jedes hat
einen Zweck; Felder „für später" gibt es nicht.

| Tabelle | Feld | Zweck | Rechtsgrundlage |
|---|---|---|---|
| `customers` | `name` | Vertragspartner benennen, Angebot und Rechnung adressieren | Art. 6 Abs. 1 lit. b |
| `customers` | `contact_person` | Ansprechpartner bei Firmenkunden erreichen | Art. 6 Abs. 1 lit. b |
| `customers` | `email`, `phone` | Terminabstimmung, Rückfragen, Versand von Angeboten | Art. 6 Abs. 1 lit. b |
| `customers` | `billing_street`, `billing_postal_code`, `billing_city`, `billing_country_code` | Rechnungsanschrift | Art. 6 Abs. 1 lit. b, §14 UStG |
| `projects` | `site_street`, `site_postal_code`, `site_city` | Baustelle auffinden, Anfahrt und Aufmaß | Art. 6 Abs. 1 lit. b |
| `users` | `email`, `full_name` | Anmeldung und Zuordnung von Handlungen | Art. 6 Abs. 1 lit. b/f |
| `audit_entries` | `actor_user_id` | Nachvollziehbarkeit kritischer Aktionen | Art. 6 Abs. 1 lit. f |

Bewusst **nicht** erhoben: Geburtsdatum, Bankverbindung, Steuernummer, Freitextnotizen
zu Personen. Sie werden erst aufgenommen, wenn eine konkrete Funktion sie braucht.

### Löschung und Anonymisierung (Punkt 5) — umgesetzt in Phase 2

`POST /api/v1/customers/{id}/anonymize` setzt ein Löschbegehren nach Art. 17 DSGVO um:

1. `name`, `contact_person`, `email`, `phone` und die Rechnungsanschrift werden
   überschrieben, nicht nur ausgeblendet.
2. `customer_number`, `created_at` und die Verknüpfung zu Projekten und Belegen bleiben
   erhalten — sonst wären aufbewahrungspflichtige Dokumente nach HGB/AO nicht mehr
   zuordenbar (Punkte 6 und 7).
3. `anonymized_at` hält fest, wann das geschah. Der Datensatz ist danach **serverseitig
   gesperrt**: Ein `PATCH` oder ein zweiter Anonymisierungsversuch wird mit `409`
   abgelehnt. Andernfalls ließen sich die gelöschten Angaben einfach wieder eintragen —
   die Löschung wäre wirkungslos.
   *Ausblenden und Anonymisieren sind getrennt:* `deleted_at` steuert die Sichtbarkeit,
   `anonymized_at` den Personenbezug. Ein anonymisierter Kunde bleibt sichtbar (mit
   Platzhalternamen), damit Projekte und Belege zuordenbar bleiben; wer ihn auch aus den
   Listen nehmen will, blendet ihn zusätzlich aus.
6. **Keine Reaktivierung.** Für **neue** Projektzuordnungen ist ein anonymisierter Kunde
   gesperrt (`404`) — sonst ließe sich der gelöschte Datensatz über einen neuen
   Geschäftsvorgang wieder in Gebrauch nehmen. Die Kundenzeile wird dabei gesperrt
   (`SELECT … FOR UPDATE`), damit Anonymisierung und Zuordnung nicht gegeneinander
   laufen: Entweder die Zuordnung ist zuerst fertig und die Anonymisierung behält die
   bestehende Referenz, oder die Anonymisierung gewinnt und die Zuordnung wird
   abgelehnt. **Bestehende** Projekte bleiben in jedem Fall lesbar.
7. **Keine Kopien der gelöschten Werte.** Weder Audit-Eintrag noch Fehlermeldung noch
   Log enthalten die überschriebenen Angaben. Tests prüfen das für das Protokoll und
   für die Projektliste.
4. Der Vorgang wird protokolliert — **ohne** die gelöschten Werte. Ein Audit-Eintrag,
   der die anonymisierten Daten konserviert, wäre das Gegenteil einer Löschung. Ein Test
   prüft das.
5. Die Berechtigung `customer.record.anonymize` liegt ausschließlich beim
   Administrator, nicht bei einer Fachrolle. Auch das ist getestet.

Der Vorgang ist **nicht umkehrbar**.

Was damit **weiterhin fehlt**: die Auskunft nach Art. 15 (Punkt 3) als Export, das
Verarbeitungsverzeichnis (Punkt 11), die TOM-Dokumentation (Punkt 12), die AV-Verträge
(Punkt 10) und die Regel zur Wirkung eines Restores auf eine Löschung (Punkt 8).
**Bis diese Punkte vorliegen, gilt weiterhin: ausschließlich synthetische Testdaten.**

### Was Phase 1 dazu beiträgt — und was nicht

Vorhanden: Mandantentrennung, rollenbasierte Zugriffskontrolle, Audit-Protokoll,
`deleted_at` auf Geschäftsdokumenten, Ausschluss personenbezogener Daten aus
Logs und Event-Payloads.

Nicht vorhanden: Export-, Auskunfts- und Anonymisierungsfunktionen, das
Verarbeitungsverzeichnis, die TOM-Dokumentation und die AV-Verträge. Das ist
kein Versäumnis von Phase 1 — Phase 1 verarbeitet keine personenbezogenen
Daten außer den Konten der Entwickler. Es ist aber eine **harte Voraussetzung
für Phase 2**.

**Soft Delete allein erfüllt kein Löschbegehren.** Der Anonymisierungspfad ist mit
Phase 2 implementiert und getestet (siehe oben) — `deleted_at` blendet lediglich aus,
`anonymized_at` entfernt den Personenbezug.

---

## 14. Backup und Wiederherstellung

- PostgreSQL: tägliches Vollbackup + WAL-Archivierung.
- Object Storage: getrennte Sicherung, konsistent zum Datenbankstand.
- **Ein Restore-Test ist Voraussetzung, bevor echte Kundendaten erfasst werden.**
  Ein ungetestetes Backup ist kein Backup.
- Wiederherstellungsziele: RPO ≤ 24 h, RTO ≤ 8 h für den internen Betrieb.

---

## 15. Abhängigkeiten

- Feste Versionen (`uv.lock`, `pnpm-lock.yaml`).
- Regelmäßige Aktualisierung, mindestens monatlich; Sicherheitsupdates sofort.
- `pip-audit` / `npm audit` in CI.
- Neue Abhängigkeiten nur mit Begründung — jede ist dauerhafte Angriffsfläche.

---

## 16. Vor kommerziellem Einsatz erforderlich

Diese Punkte sind **nicht** Teil des MVP, aber Voraussetzung, bevor ElektroPlan über den
eigenen Betrieb hinaus eingesetzt wird:

1. Externes Security Review / Penetrationstest
2. DSGVO-Konzept inkl. Verarbeitungsverzeichnis, TOM-Dokumentation und AV-Verträgen
3. Umgesetztes Lösch- und Exportkonzept
4. Dokumentierter und **geprobter** Restore
5. Mandantentrennungstest durch eine unabhängige Person
6. Betriebshandbuch (Incident Response, Ansprechpartner, Meldewege nach Art. 33 DSGVO)
7. Virenscan für Uploads
8. MFA für administrative Konten

---

## 17. Sicherheitsgrenze Elektrotechnik

ElektroPlan trifft keine sicherheitsrelevanten elektrotechnischen Entscheidungen
(Querschnitte, Schutzorgane, Selektivität, Normkonformität). Das System rechnet,
dokumentiert und schlägt vor — die verantwortliche Elektrofachkraft entscheidet und gibt
frei. Diese Grenze ist bewusst gesetzt und darf nur über einen neuen ADR mit fachlicher
Freigabe verschoben werden.
