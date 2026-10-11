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
- **Access Token:** JWT, kurzlebig (15 Minuten), enthält `user_id` (`sub`),
  `organization_id` (`org`), `member_id` (`mid`) und seit Phase 4e die
  **Sitzungsversion** (`sv`) der Mitgliedschaft. Berechtigungen stehen **nicht** im Token —
  sie werden serverseitig geladen, damit Entzug sofort wirkt.
- **Sitzungsversion (seit Phase 4e, ADR 0021):** `organization_members.session_version`
  steht in jedem Access Token und in jedem Refresh Token. Jede Anfrage und jede Erneuerung
  vergleicht sie mit dem aktuellen Wert; Abweichung → `401` (Refresh: Familie widerrufen,
  Grund `session_outdated`). Sperren, Entsperren, Entfernen, neue E-Mail und neues Passwort
  zählen sie hoch. Damit ist **jedes** vorher ausgestellte Token wertlos – auch ein Nachfolger,
  den eine gleichzeitige Erneuerung noch mit altem Stand ausgestellt hat – und ein Entsperren
  belebt keine alte Sitzung. Keine prozesslokale Sperrliste. Access Tokens ohne `sv` (vor 4e)
  gelten nicht; der Client erneuert einmal über das Cookie.
- **Neutrale Ablehnung (seit Phase 4e, ADR 0021 §2a):** Jeder abgelehnte Login –
  unbekannte Adresse, falsches Passwort, deaktiviertes Konto, gesperrte, entfernte oder
  fehlende Mitgliedschaft, gewählter Betrieb ohne aktive Mitgliedschaft – antwortet gleich:
  `401 authentication-failed`, „Anmeldung nicht möglich. Bitte Zugangsdaten prüfen oder die Administration kontaktieren.“, kein Token, kein Cookie. Jeder zählt als
  Fehlversuch je Konto und IP, auch mit richtigem Passwort. Die Auswahl zwischen mehreren
  aktiven Betrieben (`409`) ist kein Fehler. Dieselbe Antwort bei der Prüfung bestehender
  Zugangsdaten in der Einladungsannahme.
- **Refresh Token:** zufälliger, hoch-entroper Wert, nur als Hash gespeichert
  (`refresh_tokens`), Rotation bei jeder Nutzung, Wiederverwendung eines alten Tokens
  invalidiert die gesamte Familie (Diebstahlserkennung).
- **Token-Familie mit dauerhaftem Zustand (seit Sicherheitsauftrag 2026-10-10, Migration
  `0011`):** Jede Anmeldung und jeder Betriebswechsel legt eine Zeile in
  `refresh_token_families` an; alle Rotationen dieser Sitzung gehören dazu. **Rotation und
  Widerruf sperren zuerst diese Zeile** (`FOR UPDATE`, Sperrreihenfolge Konto (`KEY SHARE`)
  → Familie → Token). Ein Widerruf (Logout, Wiederverwendung, Sperre, Sitzungsversion,
  Kontoänderung) setzt `revoked_at` an der Familie und widerruft danach – in einer neuen
  Abfrage – alle Tokenzeilen. Eine gleichzeitige Rotation wartet auf die Familiensperre und
  scheitert dann am Familienzustand. **Nach einem abgeschlossenen Widerruf erneuert kein
  Token dieser Familie mehr eine Sitzung**, auch kein Nachfolger, den eine Rotation kurz
  davor angelegt hat. Vorher widerrief ein Logout nur die zum Abfragezeitpunkt sichtbaren
  Zeilen; ein gleichzeitig entstehender Nachfolger blieb gültig (mit echten
  PostgreSQL-Transaktionen reproduziert, `tests/test_refresh_revocation_concurrency.py`).
  Die Sitzungsversion (Phase 4e) bleibt als zweite, unabhängige Schicht bestehen.
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
- **Logout:** widerruft die Token-Familie **dieser** Sitzung serverseitig und dauerhaft,
  nicht nur clientseitig. Andere Geräte und Betriebe desselben Kontos bleiben angemeldet
  (ein Logout überall wäre eine eigene, ausdrückliche Funktion).
- **Bereits ausgestellte Access Tokens (ausdrücklich):** Ein Logout und ein
  Familienwiderruf widerrufen **nur Refresh Tokens**. Ein schon ausgestellter Access Token
  dieser Sitzung bleibt bis zu seinem Ablauf gültig (höchstens
  `ELEKTROPLAN_ACCESS_TOKEN_MINUTES`, Standard 15 Minuten) – es gibt keine Sperrliste für
  Access Tokens. Der Planner verwirft seinen Token beim Abmelden sofort. **Sofort**
  unwirksam werden Access Tokens nur über die Sitzungsversion bzw. den Mitgliedsstatus:
  Sperren, Entsperren, Entfernen, neue E-Mail und neues Passwort.
- **Gesperrte oder entfernte Mitgliedschaft (seit Phase 4.2, ergänzt 4e):** Jede Anfrage
  prüft Status **und Sitzungsversion** der Mitgliedschaft aus dem Access Token; ein
  gesperrter Zugang erhält sofort `401`. Die
  Sperre widerruft zusätzlich alle offenen Refresh Tokens **dieser** Mitgliedschaft
  (Grund `membership_disabled`); Sitzungen desselben Kontos in anderen Betrieben bleiben
  unberührt. Ein Refresh mit gesperrter Mitgliedschaft liefert `401` und widerruft die
  Familie. Nach der Freigabe meldet sich die Person neu an. Rollenänderungen brauchen
  keinen Widerruf: Rechte werden ohnehin pro Anfrage geladen.
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
- kein Rolleneditor in der Oberfläche; Rollen lassen sich **nicht** anpassen oder
  kopieren, und einzelne Berechtigungen lassen sich nicht vergeben,
- keine Passwortwiederherstellung durch die Person selbst (kein E-Mail-Versand); seit
  Phase 4e kann ein Administrator einen Einmal-Link auslösen (Abschnitt 18a),
- keine Lizenz-, Abrechnungs- oder Trial-Logik.

**Lebenszyklus von Projekten und Kunden (seit Phase 4d, ADR 0020):**

| Berechtigung | erlaubt | Standardrollen |
|---|---|---|
| `project.record.delete` | leeres Projekt (Entwurf/in Bearbeitung) endgültig löschen | Administrator, Planer – genau die Rollen mit `project.record.write` |
| `project.record.purge` | Projekt **mit Inhalt** endgültig löschen (Projektnummer als Bestätigung) | **nur** Administrator |
| `project.record.reopen` | abgeschlossenes Projekt wieder in Bearbeitung setzen | **nur** Administrator |
| `customer.record.delete` | Kunden ohne Projekte endgültig löschen | **nur** Administrator |

`ADMIN_ONLY_PERMISSIONS` (`app/core/authorization/permissions.py`) nennt die drei
Administratorrechte; ein Test verhindert, dass eine andere Systemrolle oder ein
`default_roles` eines Moduls sie erhält, ein weiterer prüft die Zuordnung nach dem Seed in
der Datenbank. `customer.record.anonymize` ist entfernt (Migration `0006`).

**Benutzerverwaltung (seit Phase 4.2, Abschnitt 18):** Ein Administrator vergibt die
**festen Systemrollen** an Mitgliedschaften seines Betriebs, lädt ein und sperrt den
Zugang. Verwendete Berechtigungen – keine neuen Schlüssel:

| Berechtigung | erlaubt |
|---|---|
| `user.account.read` | Benutzerliste, Mitglied, Einladung, Systeminformationen lesen |
| `user.account.write` | Einladung widerrufen/neu ausstellen (Sperren seit 4e: `user.account.lock`) |
| `user.account.lock` | sperren und entsperren – **nur Administrator** (seit 4e) |
| `user.profile.write` | Name und E-Mail eines exklusiven Kontos ändern – **nur Administrator** (seit 4e) |
| `user.password.reset` | Reset-Link auslösen – **nur Administrator** (seit 4e) |
| `user.account.remove` | Mitglied endgültig entfernen – **nur Administrator** (seit 4e) |
| `user.preferences.write` | **eigene** Einstellungen speichern – jede Systemrolle (seit 4e) |
| `role.assignment.read` | Systemrollen, Rollen und effektive Rechte eines Mitglieds lesen |
| `role.assignment.write` | Rollen vergeben; zusammen mit `user.account.write` einladen |

**`role.assignment.write` ist gleichbedeutend mit Administratorrechten:** Wer Rollen
vergibt, kann auch die Rolle `admin` vergeben – sich selbst eingeschlossen. Die
Berechtigung steckt deshalb ausschließlich in der Administratorrolle und darf keiner
Fachrolle zugeordnet werden.

`organization.member.read`/`write` bleiben unverändert und werden von der Verwaltung
nicht verwendet: Planer und Kalkulator besitzen `organization.member.read` („Kollegen
ansehen“) – sie sollen dadurch **nicht** E-Mail-Adressen, Status und Rollen aller
Mitglieder sehen.

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
| Frühe Schranke (seit Sicherheitsauftrag 2026-10-10) | `POST /files` liest den Anfragekörper **selbst** und erst **nach** Anmeldung, `file.object.write`, Schreib- und Upload-Grenze (`app/core/files/upload_form.py`). Vorher ließ FastAPI wegen `File`/`Form`-Parametern den ganzen Körper puffern, bevor irgendeine Prüfung lief – auch für Unangemeldete. Jetzt: `Content-Length` über der Anfragegrenze → `413` ohne ein Byte zu lesen; die **tatsächlich empfangenen** Bytes werden gezählt (fehlende oder falsche `Content-Length` hilft nicht) → `413`, sobald die Grenze überschritten ist. Multipart nur mit einem Dateiteil `upload`, höchstens drei Formularfeldern (`project_id`, `entity_type`, `entity_id`) zu je 1 KiB; alles andere `422`. Abbruch durch den Client → `422`, keine `500`. |
| Anfragegrenze vs. Dateilimit | Dateilimit `ELEKTROPLAN_UPLOAD_MAX_BYTES` (Standard 50 MiB) gilt für den Inhalt des Dateiteils und wird weiter im Service geprüft (zweite Schicht, `422`). Die Anfrage darf zusätzlich `ELEKTROPLAN_UPLOAD_REQUEST_OVERHEAD_BYTES` (Standard 64 KiB) für den Multipart-Rahmen enthalten. |
| Aufräumen | Scheitert das Lesen, schließt der Multipart-Parser alle angelegten temporären Dateien; nach der Anfrage schließt die Dependency die Datei immer. In den Object Storage gelangt nichts vor der vollständigen Prüfung. Nachgewiesen mit einem auf die Platte auslagernden Puffer (`tests/test_upload_guard.py`). |
| Streaming | Der Dateiteil wird stückweise gelesen (64 KiB); das Größenlimit greift **während** des Lesens. Gepuffert wird in einer `SpooledTemporaryFile`, die oberhalb 1 MiB auf die Festplatte auslagert — keine unbegrenzte Datei im Arbeitsspeicher. |
| Andere Anfragekörper | Für JSON-Endpunkte gibt es in der Anwendung **keine** allgemeine Größengrenze; sie gehört an den Reverse Proxy (Betriebsblocker G-3, [`release-checklist-real-data.md`](release-checklist-real-data.md)). |
| Projektzuordnung | Ein Upload mit `project_id` wird gegen den mandantengefilterten Projektdienst geprüft; ein fremdes Projekt liefert `404`. Der Speicherschlüssel lautet dann `org/<org-id>/project/<project-id>/<file-id><ext>`. |
| Download im Browser | `GET /files/{id}/download-url` liefert die signierte Adresse als JSON, der Browser navigiert anschließend dorthin. Ein Link direkt auf den API-Endpunkt käme ohne `Authorization`-Header nicht durch; ein Token in der URL ist ausgeschlossen. |
| Dateiname im Header | `Content-Disposition` wird injektionssicher gebaut: Steuerzeichen, Zeilenumbrüche, Anführungszeichen und Backslashes werden ersetzt, der Originalname folgt prozentkodiert als `filename*` (RFC 6266). |
| Verwaiste Objekte | Reihenfolge: Datenbankzeile → Storage-Upload → Commit. Scheitert der Upload, wird die Transaktion zurückgerollt (kein Datensatz ohne Objekt). Scheitert der Commit, wird das Objekt gelöscht (kein Objekt ohne Datensatz). Gelingt auch das Löschen nicht, wird der Schlüssel unter `orphan_object_cleanup_failed` protokolliert und muss von Hand entfernt werden. Objekte gelöschter Projekte laufen dagegen über die persistente Warteschlange `storage_cleanup_jobs` (Phase 4d, ADR 0020): vorgemerkt in der Löschtransaktion, nach dem Commit gelöscht, bei Fehler mit Zähler und Meldung aufbewahrt, nachholbar mit `python -m app.cli storage-cleanup`. |

---

## 8. Secrets und Konfiguration

- Keine Secrets im Repository. `.env.example` enthält nur Platzhalter, `.env` ist ignoriert.
- Konfiguration über Umgebungsvariablen (`pydantic-settings`), typisiert und beim Start
  validiert — ein fehlendes Secret verhindert den Start.
- Getrennte Werte für Entwicklung, Test und Produktion.
- Rotationsfähigkeit: JWT-Signaturschlüssel mit Key-ID, damit ein Wechsel ohne Totalausfall
  möglich ist.
- Datenbank- und Storage-Zugangsdaten nie im Frontend, nie in Logs.

### Entwicklungsbetrieb (Docker Compose) – seit Sicherheitsauftrag 2026-10-10

| Punkt | Umsetzung |
|---|---|
| Ports | Alle veröffentlichten Ports (`5173`, `8000`, `5432`, `9000`, `9001`) ausdrücklich an `127.0.0.1` gebunden; interne Kommunikation über das Compose-Netz unverändert. Wirksam nach `docker compose up -d`. |
| Übergabekette | Docker Compose liest `.env` im Projektverzeichnis und setzt nur die mit `${...}` referenzierten Variablen ein: `ELEKTROPLAN_JWT_SECRET`, `ELEKTROPLAN_JWT_KEY_ID`, `ELEKTROPLAN_S3_SECRET_KEY` (auch für MinIO selbst), `ELEKTROPLAN_SEED_ORG_NAME`, `…_SEED_ADMIN_EMAIL`, `…_SEED_ADMIN_PASSWORD`. **Vorher** erreichte keiner dieser in `.env.example` dokumentierten Werte den Backend-Container; das Backend lief immer mit dem Entwicklungsersatz für das JWT-Secret. Eine gleichnamige Variable der aufrufenden Shell hat Vorrang vor `.env`. |
| Nachweis | `tests/test_config_secrets.py`: statisch (Ports, Referenzen) und mit `docker compose config` und synthetischer `.env`. Zusätzlich einmalig von Hand: ein synthetischer Wert kam per `docker compose run --rm --no-deps backend` im Container an (Hashvergleich, kein Klartext ausgegeben). |
| Entwicklungsersatz | Ohne `ELEKTROPLAN_JWT_SECRET` nutzt das Backend in Entwicklung/Test einen öffentlich bekannten Ersatzwert und protokolliert beim Start `jwt_secret_development_default`. Lokal seit 2026-10-10 durch einen eigenen Schlüssel in `.env` ersetzt. |
| Schlüsselwechsel | Macht alle zuvor ausgestellten **Access Tokens** ungültig (`401`). **Refresh-Sitzungen bleiben gültig** – Refresh Tokens sind vom JWT-Schlüssel unabhängig (Zufallswert, Hash in der DB); sie erhalten beim nächsten Erneuern Access Tokens mit dem neuen Schlüssel. Sollen alle Sitzungen enden, zusätzlich Familien widerrufen. Nachgewiesen am 2026-10-10. |
| Produktion | `ELEKTROPLAN_ENVIRONMENT=production` verweigert den Start mit jedem bekannten Entwicklungswert: JWT-Ersatzwert oder Platzhalter, < 32 Zeichen, S3-Schlüssel `elektroplan-dev-secret` oder leer, Datenbankkennwort `elektroplan`, Seed-Passwörter aus Compose und Vorlage. |
| Datenbankkennwort | bleibt in Compose fest – es wird nur beim ersten Anlegen des Volumes gesetzt. |
| Werkzeuge auf dem Rechner | `127.0.0.1` statt `localhost` (Standardwerte in `app/config.py`, `.env.example`, Test-URL in CLAUDE.md, README, `tasks.ps1`). `localhost` löst unter Windows zuerst `::1` auf; seit der IPv4-Loopback-Bindung wartete libpq dort bis zum Verbindungs-Timeout (gemessen bis 200 s). Browser-Adressen (`localhost:5173`, signierte MinIO-URLs) bleiben, weil Browser sofort auf IPv4 ausweichen. |
| Offen | Eine eigene Produktionskonfiguration (Secrets, TLS, Backups) ist ein dokumentierter Freigabepunkt (G-1 in [`release-checklist-real-data.md`](release-checklist-real-data.md)). |

---

## 9. Audit

Explizit protokolliert werden mindestens:

- Anmeldung, fehlgeschlagene Anmeldung, Logout
- Änderung von Rollen und Berechtigungen (`member.roles_changed` mit hinzugefügten und
  entfernten Rollenschlüsseln)
- Benutzerverwaltung: `invitation.created`, `invitation.revoked`, `invitation.reissued`,
  `invitation.accepted`, `member.suspended`, `member.reactivated` – mit IDs und
  Rollenschlüsseln, **ohne** E-Mail, Namen, Token, Link oder Passwort
- Benutzerlebenszyklus (seit 4e): `member.profile_updated` (nur die **Namen** der
  geänderten Felder), `member.removed` (`account_tombstoned` ja/nein),
  `member.password_reset_issued`, `member.password_reset_completed` – Ziel-ID und
  Aktionsart, nie alte oder neue Werte, Sperrgrund, Token, Link oder Passwort. Die
  Anmeldung protokolliert seit 4e nur „Anmeldung“ ohne E-Mail (ältere Einträge enthalten sie
  noch; das Audit wird nicht nachträglich geändert)
- Anlegen/Ändern/Löschen von Kunden und Projekten
  (`customer.created`, `customer.updated`, `customer.deleted`, `project.created`,
  `project.updated`, `project.deleted`, `project.status_changed`, `project.reopened`).
  Löscheinträge tragen nur IDs, Nummern und Inhaltsarten – keine Namen, Anschriften oder
  E-Mail-Adressen (ADR 0020). `customer.anonymized` stammt aus der Zeit vor Phase 4d und
  kommt nur noch in älteren Einträgen vor.
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

Abgleich Dokumentation ↔ Umsetzung mit dem Sicherheitsauftrag 2026-10-10. Alle Werte
sind über `ELEKTROPLAN_*` einstellbar (`app/config.py`).

| Endpunktgruppe | Grenze | Schlüssel | Was zählt | Stand |
|---|---|---|---|---|
| `POST /auth/login` | 10 / 15 min | Konto (E-Mail nur als SHA-256-Präfix im Speicher) **und** IP | jeder abgelehnte Versuch; Erfolg und Betriebsauswahl (`409`) geben ihre Reservierung zurück | umgesetzt, **jetzt atomar** |
| `POST /auth/refresh` | **120** / Stunde | Konto (`user_id`) | jede Erneuerung mit bekanntem Token | **neu umgesetzt** (vorher nur dokumentiert); Startwert 60 → 120, weil jeder Seitenaufruf und jeder Tab einmal erneuert |
| `POST /auth/refresh`, ungültig | 30 / 15 min | IP | **nur** unbekannter Token, Token einer widerrufenen Familie, widerrufener Token, Wiederverwendung eines ersetzten Tokens nach dem Toleranzfenster, abgelaufener Token. **Zurückgegeben** wird genau die eigene Reservierung bei Erfolg, parallelem Refresh im Toleranzfenster, persönlicher Kontogrenze (`429`), Kontozustand (deaktiviert, Mitgliedschaft gesperrt, Sitzungsversion) und internen Fehlern – sonst blockierten sich Benutzer hinter derselben IP gegenseitig (Review 2026-10-10) | **neu**, Rückgabe nachgeschärft |
| `POST /invitation-acceptance/*` | 20 ungültige Tokens / 15 min | IP | ungültige Tokens; mit bestehendem Konto zusätzlich die Login-Grenze | umgesetzt, **jetzt atomar** |
| `POST /password-reset/*` (seit 4e) | 20 ungültige Tokens / 15 min | IP | ungültige Links | umgesetzt, **jetzt atomar** |
| `POST /members/{id}/password-reset` (seit 4e) | 5 Links / 15 min | Mitgliedschaft | jeder ausgestellte Link | umgesetzt, **jetzt atomar** |
| Datei-Upload | 100 / Stunde | Betrieb | jeder angenommene Upload-Versuch nach Anmeldung, **vor** dem Lesen des Körpers | **neu umgesetzt** |
| Schreibende API allgemein | 600 / min je Betrieb **und** 300 / min je Mitgliedschaft | Betrieb, Mitgliedschaft | jedes angemeldete `POST`/`PUT`/`PATCH`/`DELETE`, nach geprüftem Token | **neu umgesetzt** |
| PDF-Erzeugung | 30 / min / Betrieb | – | – | **nicht umgesetzt** – es gibt noch keine PDF-Erzeugung |

**Umsetzung** (`app/core/auth/rate_limit.py`):

- **Rückgabe exakt:** Jede Reservierung trägt je Schlüssel eine eindeutige Kennung;
  `release` entfernt genau diese Einträge, nie fremde Versuche (auch nicht bei gleichem
  Zeitstempel), und ist beim zweiten Aufruf wirkungslos. Kein Zurücksetzen ganzer Zähler.
- **Atomar:** Prüfen und Reservieren geschehen unter einer Sperre in einem Schritt, für
  alle Schlüssel einer Anfrage gemeinsam (alles oder nichts). Vorher prüfte der
  Login-Limiter zuerst und zählte erst nach der Passwortprüfung – parallele Anfragen
  kamen alle durch die Prüfung (nachgestellt: 20 parallele Versuche, alle 20 geprüft bei
  Grenze 10). Jetzt: genau 10 (`tests/test_rate_limits.py`).
- **Einheitliche Antwort:** `429`, `type …/rate-limited`, Problem Details, Header
  `Retry-After` in Sekunden bis zum Freiwerden; per CORS lesbar (`expose_headers`).
- **Ausnahmen:** `/auth/logout` (wirkt nur mit eigenem Cookie), lesende Anfragen (`GET`),
  unangemeldete Schreibversuche (scheitern mit `401`, bevor sie Kontingent verbrauchen). Ein
  Editor-Speichern ist ein einzelnes `PUT`; die Grenzen liegen weit über normaler Nutzung.
- **Speicher begrenzt:** Abgelaufene Einträge werden laufend entfernt; über 20 000
  Schlüssel je Limiter werden die am längsten unbenutzten verdrängt (Log
  `rate_limit_keys_evicted` mit Anzahl, ohne Schlüssel).
- **Logs:** nur Limiter und **Art** der Schlüssel (`ip`, `user`, `member` …), nie Werte,
  Tokens oder Passwörter.
- **Proxy-Header:** Die Anwendung liest `X-Forwarded-For` nie selbst. Maßgeblich ist die
  ASGI-Client-Adresse; Uvicorn ersetzt sie nur für Verbindungen aus `--forwarded-allow-ips`
  (Standard `127.0.0.1`). Hinter einem Reverse Proxy muss dieser Wert genau den Proxy
  nennen, sonst teilen sich alle Clients die IP des Proxys (G-3).
- **Einzelprozess – ehrliche Grenze:** Die Zähler leben **je Prozess**. Mit mehreren
  Uvicorn-Workern oder Instanzen vervielfacht sich jede Grenze mit deren Anzahl. Für den
  vorgesehenen Einzelbetrieb (ein Prozess) genügt das. Ein gemeinsamer Zähler (z. B. in
  PostgreSQL oder einem eigenen Dienst) ist **nicht** gebaut und wird nur nach Freigabe
  ergänzt (G-2).

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
Wildcards. Erlaubte Methoden: `GET, POST, PUT, PATCH, DELETE, OPTIONS` (`PUT` seit Phase 4a für
das atomare Konturspeichern). Erlaubte
Header: `Authorization`, `Content-Type`, `X-Request-Id`, `If-Match`.

### CSRF

Umgesetzt ist eine **zweistufige, überprüfbare** Lösung — kein Double-Submit-Token:

1. **`SameSite=Strict`** auf dem Refresh-Cookie. Moderne Browser senden es bei
   siteübergreifenden Anfragen überhaupt nicht mit.
2. **Strenge Herkunftsprüfung** (`require_trusted_origin`) auf allen
   cookiebasierten Endpunkten (`/auth/login`, `/auth/refresh`, `/auth/logout`,
   `/auth/switch-organization`) und den öffentlichen Token-Endpunkten
   (`/invitation-acceptance/*`, seit 4e `/password-reset/*`): Ist ein `Origin`- oder
   `Referer`-Header vorhanden, muss er zu den konfigurierten Origins passen, sonst `403`
   (`csrf-validation-failed`). Die Reset-Endpunkte lesen und setzen **kein** Cookie und
   stellen keine Sitzung aus; ohne das Einmal-Token im Anfragekörper bewirken sie nichts.

Fehlen **beide** Header, wird die Anfrage zugelassen. Begründung: Browser senden
`Origin` bei zustandsändernden Anfragen immer mit; fehlt er, stammt die Anfrage
nicht aus einem Browserkontext und kann kein CSRF-Opfer sein. Diese Entscheidung
ist bewusst getroffen und hier dokumentiert — sie wird nicht als vollwertiger
Token-Schutz ausgegeben.

Alle übrigen Endpunkte verwenden `Authorization: Bearer` und sind schon deshalb
nicht CSRF-anfällig: Ein Angreifer kann den Header nicht setzen lassen.

### Trennung der Browserdaten nach Sitzung (seit Sicherheitsauftrag 2026-10-10)

Vorher überlebte ein gemeinsamer `QueryClient` jeden Sitzungswechsel, und Abfrageschlüssel
enthielten weder Benutzer noch Betrieb. Nach einem Betriebswechsel zeigte die Oberfläche
weiter Kundendaten des alten Betriebs (bis zu 30 s `staleTime`), nach dem Abmelden lagen die
Daten noch im Speicher (im Test nachgestellt).

Jetzt (`apps/planner/src/core/sitzung/sitzungsraum.ts`, `core/auth/AuthProvider.tsx`):

- Der **Sitzungskontext** ist Benutzer + Betrieb + Mitgliedschaft aus dem Access Token
  (nur gelesen, nicht geprüft – das tut der Server). Jeder Kontext erhält einen eigenen
  **Sitzungsraum** mit eigenem `QueryClient` und eigenem Abbruchsignal.
- Bei **Abmelden, Benutzerwechsel, Betriebswechsel und Verlust der Sitzung** – auch wenn das
  Cookie inzwischen einem anderen Benutzer gehört (Anmeldung in einem anderen Tab) – endet
  der alte Raum sofort: laufende Anfragen werden abgebrochen, Abfragen, Mutationen und
  optimistische Stände gelöscht. Der Teilbaum unter dem `AuthProvider` wird mit dem neuen
  Raum neu aufgebaut; bis der neue Kontext geladen ist, zeigt die Oberfläche nur „Sitzung
  wird geprüft“.
- **Verspätete Antworten:** Der API-Client verwirft jede Antwort, die nach dem Ende ihres
  Raums eintrifft (`AbortError`); ein Token wird nur gesendet, solange er zum Raum gehört;
  eine Erneuerung aus einer älteren Epoche (vor Anmelden/Abmelden/Wechsel) wird ignoriert.
- `/me` muss zum Kontext des Tokens passen, sonst wird die Sitzung verworfen.
- **Keine pauschale Löschung von Browserdaten:** `localStorage` bleibt unberührt;
  persönliche Einstellungen liegen weiter je Mitgliedschaft
  (`elektroplan.einstellungen.<member_id>`).
- Module brauchen dafür nichts zu tun: Sie nutzen `useAuth().api` und `useQueryClient()`.
  Sie dürfen keinen eigenen `QueryClient` und keine modulweiten Caches für geschützte
  Daten anlegen (`docs/modules.md`).
- Nachweis: `src/core/auth/Sitzungstrennung.test.tsx` (A → Abmelden → B; Betrieb 1 → 2;
  langsame Anfrage; Sitzungsende während einer Anfrage; Cookie aus anderem Tab; Mutation
  mit optimistischem Stand; Kunden-, Projekt-, Benutzer- und Electrical-Daten). Gegenprobe
  mit dem alten gemeinsamen Cache: alle sechs Tests scheitern.

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
| 5 | Löschung | Umgesetzter Pfad, der personenbezogene Daten aus der operativen Datenbank entfernt, ohne aufbewahrungspflichtige Belege zu verlieren |
| 6 | Aufbewahrungspflichten | Festgelegt, welche Dokumente nach HGB/AO/GoBD 6 bzw. 10 Jahre bleiben |
| 7 | Trennung löschbar / aufbewahrungspflichtig | Dokumentiert je Tabelle: löschbar oder aufbewahrungspflichtig |
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
| `organization_members` | `status`, `last_login_at` | Zugang zum Betrieb steuern; ungenutzte Zugänge erkennen (letzte Anmeldung **nur in diesem Betrieb**) | Art. 6 Abs. 1 lit. b/f |
| `organization_members` | `lock_reason` (seit 4e, optional, ≤ 200 Zeichen, nur solange gesperrt) | Sperre nachvollziehbar machen – nur bei echtem betrieblichem Bedarf, ohne sensible Angaben | Art. 6 Abs. 1 lit. f |
| `user_preferences` | `theme_mode`, `accent`, `length_unit` (seit 4e) | persönliche Darstellung auf allen Geräten; benutzerbezogene Profildaten ohne weitere Aussagekraft | Art. 6 Abs. 1 lit. b/f |
| `password_reset_tokens` | `token_hash`, `expires_at`, `created_by_user_id` (seit 4e) | Einmal-Link zum Zurücksetzen; nur Hash, nur solange offen | Art. 6 Abs. 1 lit. b/f |
| `member_invitations` | `email`, `full_name` | Einladung zustellen und der richtigen Person zuordnen; der Name ist nur ein Vorschlag | Art. 6 Abs. 1 lit. b |
| `member_invitations` | `token_hash`, `expires_at`, `accepted_at`, `revoked_at`, `created_by_user_id` | Einmaligkeit, Frist und Nachvollziehbarkeit der Einladung – kein Personenbezug im Hash | Art. 6 Abs. 1 lit. f |
| `audit_entries` | `actor_user_id` | Nachvollziehbarkeit kritischer Aktionen | Art. 6 Abs. 1 lit. f |

Bewusst **nicht** erhoben: Geburtsdatum, Bankverbindung, Steuernummer, Freitextnotizen
zu Personen. Sie werden erst aufgenommen, wenn eine konkrete Funktion sie braucht.

### Löschung (Punkt 5) — seit Phase 4d physisch (ADR 0020)

> Die Anonymisierung aus Phase 2 (`POST /customers/{id}/anonymize`, `anonymized_at`,
> Berechtigung `customer.record.anonymize`) ist mit Phase 4d **ersatzlos entfallen**.

`DELETE /api/v1/customers/{id}` entfernt einen Kunden **physisch aus der operativen
Datenbank**:

1. **Nur Administratoren** (`customer.record.delete`); keine andere Standardrolle erhält
   das Recht – ein Architekturtest hält das fest. Die Oberfläche zeigt die Aktion nur
   Berechtigten; verbindlich ist die Serverprüfung.
2. **Nur ohne Projekte.** Ist dem Kunden irgendein Projekt zugeordnet – Entwurf, laufend,
   abgeschlossen oder archiviert –, lautet die Antwort
   `409 customer-has-projects`. Belege, die an Projekten hängen, bleiben damit zuordenbar.
3. **Unter Sperre.** Kundenzeile sperren, `If-Match` prüfen, Projekte zählen, löschen –
   in einer Transaktion; eine gleichzeitige Projektanlage wartet und erhält danach `404`.
4. **Minimale Audit-Tatsache.** `customer.deleted` hält Kunden-ID, Kundennummer, Mandant,
   Akteur und Zeitpunkt fest – keine Namen, Anschriften, E-Mail-Adressen. Ein Test prüft,
   dass keine der gelöschten Angaben im Protokoll steht.
5. **Kundennummer nicht wiederverwendet.** Der Nummernkreis zählt nur hoch.

**Was „physisch gelöscht" nicht bedeutet:** Datensicherungen enthalten den Kunden bis zum
Ablauf ihrer Aufbewahrungsfrist. Eine sofortige Entfernung aus allen Backups findet
**nicht** statt; wie eine Löschung nach einem Restore wiederholt wird, ist offen
(Punkt 8). Bereits anonymisierte Entwicklungsdatensätze aus der Zeit vor 4d bleiben mit
ihrem Platzhalternamen stehen.

**Projekte** mit Anschrift der Baustelle werden ebenso physisch gelöscht (leere Projekte
durch Projektbearbeiter, Projekte mit Inhalt nur durch Administratoren, abgeschlossene
und archivierte nie direkt); ihre Dateien werden über `storage_cleanup_jobs` aus dem
Object Storage entfernt (ADR 0020).

**Ersteller und Bearbeiter.** Kunden und Projekte zeigen, wer sie angelegt und zuletzt
geändert hat. Ausgegeben wird nur der Anzeigename von Mitgliedern des eigenen Betriebs,
nie die E-Mail-Adresse; ein Konto außerhalb des Betriebs bleibt namenlos, damit kein
Datensatz Personen eines anderen Mandanten verrät.

Was damit **weiterhin fehlt**: die Auskunft nach Art. 15 (Punkt 3) als Export, das
Verarbeitungsverzeichnis (Punkt 11), die TOM-Dokumentation (Punkt 12), die AV-Verträge
(Punkt 10) und die Regel zur Wirkung eines Restores auf eine Löschung (Punkt 8).
**Bis diese Punkte vorliegen, gilt weiterhin: ausschließlich synthetische Testdaten.**

### Was Phase 1 dazu beiträgt — und was nicht

Vorhanden: Mandantentrennung, rollenbasierte Zugriffskontrolle, Audit-Protokoll,
`deleted_at` auf Geschäftsdokumenten (für Kunden und Projekte mit Phase 4d abgeschafft), Ausschluss personenbezogener Daten aus
Logs und Event-Payloads.

Nicht vorhanden: Export-, Auskunfts- und Löschfunktionen, das
Verarbeitungsverzeichnis, die TOM-Dokumentation und die AV-Verträge. Das ist
kein Versäumnis von Phase 1 — Phase 1 verarbeitet keine personenbezogenen
Daten außer den Konten der Entwickler. Es ist aber eine **harte Voraussetzung
für Phase 2**.

**Soft Delete allein erfüllt kein Löschbegehren.** Seit Phase 4d werden Kunden und
Projekte physisch gelöscht (siehe oben). Soft Delete für Kunden und Projekte ist mit Phase 4d **abgeschafft**: Migration `0006`
entfernt `customers.deleted_at` und `projects.deleted_at`, **löscht dabei keine Zeile**,
und zuvor ausgeblendete Kunden und Projekte sind danach wieder normal sichtbar (Projekte
je nach Status in der laufenden oder historischen Ansicht). Für sie gelten die Regeln
aus ADR 0020. Archivierung ist ausschließlich der Projektstatus `archived`.

---

### Benutzerverwaltung (Phase 4.2)

* **Konto und Mitgliedschaft sind getrennt.** Das Konto (`users`) ist global; ein
  Betrieb speichert nur die Mitgliedschaft. Ein Administrator sieht vom Konto Name und
  E-Mail seiner Mitglieder – nicht deren andere Betriebe, nicht deren globale letzte
  Anmeldung.
* **Sperrung** betrifft nur die Mitgliedschaft; Daten bleiben erhalten, damit Protokoll
  und Belege zuordenbar bleiben.
* **Entfernen** (seit Phase 4e, ADR 0021) ist ein endgültiger **Tombstone**, kein
  wiederherstellbares Soft Delete: Rollen, Einstellungen und Reset-Links werden gelöscht;
  gehört das Konto keinem anderen Betrieb an, werden E-Mail (→
  `removed-<user_id>@removed.invalid`), Name (→ „Entfernter Benutzer“), Passworthash und
  letzte Anmeldung ersetzt bzw. gelöscht. Die Mitgliedschaftszeile und die Konto-ID bleiben,
  damit Bearbeiterangaben als „Entfernter Benutzer“ auflösbar sind – ohne Personenbezug im
  operativen Bestand. **Backups** enthalten die früheren Werte bis zum Ablauf ihrer
  Aufbewahrung; die Wiederholung einer Entfernung nach einem Restore ist wie bei Kunden
  offen (Punkt 8). Audit-Einträge behalten nur Ziel-ID und Aktionsart.
* **Einladungen** leben höchstens bis zur Aufbewahrungsfrist: angenommene, widerrufene
  oder abgelaufene Einladungen entfernt `python -m app.cli purge-invitations` nach
  `ELEKTROPLAN_INVITATION_RETENTION_DAYS` (Standard 30 Tage). Das ist ein Werkzeug,
  noch **kein** geplanter Job. Das Protokoll behält nur die ID.
* **Token-Hashes** sind SHA-256 über 256 Bit Zufall; aus ihnen lässt sich weder Token
  noch Person ableiten.
* **Offen** bleiben für Mitarbeiterdaten dieselben Voraussetzungen wie oben (Auskunft,
  Löschkonzept für Konten, Verarbeitungsverzeichnis, TOM, AV-Verträge – zusätzlich mit
  einem künftigen E-Mail-Dienst). **Bis dahin: nur synthetische Benutzer.**

---

**Freigabe-Checkliste:** Was vor echten Daten vorliegen und nachgewiesen sein muss – mit
Status, Nachweis und zuständiger Rolle – steht in
[`release-checklist-real-data.md`](release-checklist-real-data.md). Stand 2026-10-10:
**nicht freigegeben**.

## 14. Backup und Wiederherstellung

- PostgreSQL: tägliches Vollbackup + WAL-Archivierung.
- Object Storage: getrennte Sicherung, konsistent zum Datenbankstand.
- **Ein Restore-Test ist Voraussetzung, bevor echte Kundendaten erfasst werden.**
  Ein ungetestetes Backup ist kein Backup.
- Wiederherstellungsziele: RPO ≤ 24 h, RTO ≤ 8 h für den internen Betrieb.
- **Stand 2026-10-10:** weder Sicherungsjob noch Restore-Test vorhanden; nur ad hoc
  `pg_dump` in der Entwicklung. Abschnitte D und E der
  [Freigabe-Checkliste](release-checklist-real-data.md).

---

## 15. Abhängigkeiten

- Feste Versionen (`uv.lock`, `pnpm-lock.yaml`).
- Regelmäßige Aktualisierung, mindestens monatlich; Sicherheitsupdates sofort.
- `pip-audit` / `npm audit` in CI.
- Neue Abhängigkeiten nur mit Begründung — jede ist dauerhafte Angriffsfläche.

### Sicherheitsupdates 2026-10-10

Gezielt, keine breite Modernisierung; jede Änderung gegen die tatsächlich aufgelöste Version
und den Abhängigkeitspfad geprüft. Betroffenheit der Version und Erreichbarkeit in ElektroPlan
sind getrennt eingeordnet.

| Advisory | Paket | vorher → nachher | Installierte Version betroffen? | Angriffsweg in ElektroPlan erreichbar? |
|---|---|---|---|---|
| GHSA-2cv4-cqwr-gwf7 | uv (Werkzeug) | 0.12.17 → **0.12.18** (venv, `pyproject.toml`, `uv.lock`, `tasks.ps1`, `Makefile`, `backend.Dockerfile`) | ja (0.12.7–0.12.17, nur Windows) | ja für die lokale Windows-Umgebung: Ein bösartiges Wheel könnte beim Installieren außerhalb der Umgebung schreiben. Installiert wird nur aus dem gesperrten `uv.lock`, das senkt das Risiko, schließt es aber nicht aus. Der Linux-Container ist nicht betroffen |
| GHSA-42vr-xj54-vc7v | PyJWT | 2.14.0 → **2.15.1** (Untergrenze `>=2.15.0`) | ja (≤ 2.14.0) | **nur mit gültigem Signaturschlüssel**: `decode_access_token` prüft die Signatur vor dem Parsen der Nutzlast; mit falschem Schlüssel `401`. Mit gültigem Schlüssel löste ein verschachtelter Token einen unbehandelten `RecursionError` (HTTP 500) aus – nachgestellt. Ohne `.env` ist der Schlüssel der öffentlich bekannte Entwicklungswert, dort also erreichbar (über Loopback). Kein Authentifizierungs-Bypass. Jetzt `401`, Regressionstest |
| GHSA-82fw-gwwq-j7x9 | Vitest / `@vitest/mocker` | 3.2.7 → **4.1.11** (3.x erhält keinen Fix) | ja | nein im Normalbetrieb: betroffen sind `mockerPlugin`/`interceptorPlugin`, die ElektroPlan nicht nutzt; Vitest läuft nur lokal als Testrunner. Trotzdem aktualisiert. Vite bleibt 6.4.3 (von Vitest 4 unterstützt) |
| GHSA-85c8-ppgw-ccpr | tinypool | 1.1.1 → **entfernt** (Vitest 4 nutzt es nicht mehr) | ja (< 2.1.2) | nein: setzt eine Prototype-Pollution im Testprozess voraus; nur Testwerkzeug. Über die zuständige direkte Abhängigkeit (Vitest) gelöst, kein Override |
| GHSA-68fv-2mgg-jv7q | source-map-js (über Vite/PostCSS und Tailwind) | 1.2.1 → **1.2.2** (innerhalb der bestehenden Bereiche `^1.2.1`, kein Override) | ja | gering: nur Build und Vite-Entwicklungsserver verarbeiten Source Maps aus dem eigenen Quellcode; ein Angreifer müsste präparierte Source Maps einspielen |
| GHSA-5639-2j2p-m4mx (neu, Scan) | Mako (über Alembic) | 1.4.1 → **1.4.3** | ja (≤ 1.4.1, Windows) | nein: nur Alembic nutzt Mako für die feste Vorlage `script.py.mako`; keine Benutzereingabe erreicht `TemplateLookup` |

**Folgen für die Werkzeuge:** Vitest 4 liefert `vi.spyOn` auf einem bestehenden Mock denselben
Mock samt Aufrufhistorie; ein 3D-Test zählt deshalb jetzt erst ab dem Theme-Wechsel
(`mockClear`), die Erwartung „genau drei“ ist unverändert.

**Scans danach:** `npm audit` 0 Funde; OSV-Abfrage aller 71 gesperrten Python-Pakete 0 Treffer.
Ein sauberer Scan beweist **keine** Sicherheit, er zeigt nur, dass bekannte Advisories zu
diesen Versionen fehlen. `pip-audit` steht nicht im Lockfile und wurde nicht ergänzt.

**Laufende Container (Stand 2026-10-10, nach freigegebenem Neubau):** aktiv sind uv 0.12.18
(Backend, System-Python), PyJWT 2.15.1 und Mako 1.4.3 (Backend, `/opt/venv`), Vitest 4.1.11 und
source-map-js 1.2.2 (Planner, `node_modules`); tinypool ist nicht installiert. Nachweis je
Installationsort in `current-status.md` §2. Seit Task 0031 gilt lokal ein eigener JWT-Schlüssel
aus `.env` (Entwicklungsersatz nicht mehr aktiv).

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

---

## 18. Benutzerverwaltung und Einladungen (Phase 4.2)

Entscheidung: [ADR 0015](decisions/0015-membership-administration-and-invitations.md).

**Grenze der Verwaltung.** Ein Betriebsadministrator verwaltet ausschließlich
Mitgliedschaften seines Betriebs: Status und feste Systemrollen. Passwort, E-Mail, Name
und die globale Aktivierung eines Kontos sind über keine Verwaltungsfunktion erreichbar.
Damit kann er kein Konto übernehmen oder aussperren, das auch einem anderen Betrieb
gehört.

**Einladungstoken.**

| Eigenschaft | Umsetzung |
|---|---|
| Zufall | `secrets.token_urlsafe(32)` (256 Bit) |
| Speicherung | nur SHA-256-Hash, eindeutig |
| Gültigkeit | `ELEKTROPLAN_INVITATION_VALID_HOURS` (Standard 72 h) |
| Einmalig | Annahme sperrt die Einladungszeile und setzt `accepted_at` in derselben Transaktion wie Konto und Mitgliedschaft |
| Neu ausstellen | ersetzt den Hash – das alte Token ist sofort wertlos |
| Ungültig | unbekannt, abgelaufen, widerrufen, verwendet: **eine** Antwort (`404 invitation-invalid`) |
| Transport | im Anfragekörper, nie in Pfad oder Query; im Link hinter `#` (Fragment) – kein Server-Log, kein `Referer`; die Annahmeseite entfernt es sofort aus der Adresszeile |
| Protokoll und Logs | weder Token noch Link noch Passwort; getestet für Audit **und** Logausgabe |

**Bestehende Konten.** Eine Einladung verändert nie ein bestehendes Konto. Der Weg
„neues Konto“ lehnt eine vorhandene E-Mail ab (`409 invitation-requires-login`). Der
Weg „bestehendes Konto“ verlangt das Passwort **des Kontos der eingeladenen E-Mail** und
unterliegt derselben Begrenzung wie die Anmeldung. Ob zur Adresse ein Konto existiert,
erfährt nur, wer ein gültiges Token vorlegt.

**Zustellung.** `ELEKTROPLAN_INVITATION_DELIVERY`:

| Wert | Verhalten |
|---|---|
| `none` (Standard) | kein Zustellweg – Einladungen werden mit `503` abgelehnt, nichts wird angelegt |
| `development_link` | Link einmalig in der Antwort an den Einladenden, in der Oberfläche als Entwicklungsfunktion markiert und nur im Vite-Entwicklungsmodus angezeigt. **In Produktion verweigert die Konfiguration den Start.** |

**Letzter Administrator.** Die Organisationszeile ist die Sperrwurzel aller Status- und
Rollenänderungen. Unter der Sperre werden der Handelnde erneut geprüft und die aktiven
Administratoren gezählt (aktive Mitgliedschaft, aktives Konto, Rolle `admin`).
Selbstsperre und Entfernen der eigenen Administratorrolle sind ausgeschlossen. Nachweis:
Paralleltests gegen PostgreSQL samt Gegenprobe ohne Sperre.

**Öffentliche Annahme.** Die drei Endpunkte unter `/invitation-acceptance/` verlangen
keine Anmeldung, prüfen aber `Origin`/`Referer` wie die Sitzungsendpunkte, sind je IP
begrenzt und stellen keine Sitzung aus.

**Passwortwiederherstellung** durch die Person selbst (mit E-Mail-Versand) gibt es weiterhin
nicht. Seit Phase 4e kann ein Administrator für ein **exklusives** Konto einen Einmal-Link
auslösen – siehe Abschnitt 18a.

---

## 18a. Benutzerlebenszyklus (Phase 4e)

Entscheidung: [ADR 0021](decisions/0021-user-lifecycle-account-locks-password-reset-preferences.md).
Präzisiert die Grenze aus Abschnitt 18:

**Exklusive Konten.** Name, E-Mail und Passwortreset sowie die Bereinigung beim Entfernen
nur für Konten ohne weitere (nicht entfernte) Mitgliedschaft in einem anderen Betrieb –
sonst `409 account-shared` (ohne Betriebsnamen). Sperren und Entfernen der Mitgliedschaft
bleiben für jedes Mitglied möglich.

**Zustände** `active ↔ disabled → removed` (endgültig). Sperren widerruft die Refresh Tokens
der Mitgliedschaft, löscht alle offenen Reset-Links der Mitgliedschaft und zählt die
Sitzungsversion hoch (Abschnitt 3); Entsperren zählt erneut hoch, verlangt eine neue
Anmeldung und belebt weder Sitzungen noch Reset-Links. Eine Anmeldung mit gesperrter
oder entfernter Mitgliedschaft ist nach außen nicht von einem falschen Passwort zu
unterscheiden (Abschnitt 3) und zählt für die Begrenzung.

**Sperre als Sicherheitsstopp (Nachkorrektur vor dem Commit):** Eine Sperre löscht in
derselben Transaktion jeden zuvor ausgestellten offenen Reset-Link der Mitgliedschaft
(Reihenfolge `Organisation → Mitgliedschaft → Reset-Link`, kein Konto nötig); Entsperren
belebt ihn nicht wieder. Ein Administrator darf für das gesperrte Mitglied **bewusst einen
neuen** Link erzeugen: Das Passwort lässt sich damit setzen, die Sperre bleibt bestehen, und
anmelden kann sich die Person erst nach dem Entsperren – dann nur mit dem neuen Passwort;
alte Sitzungen bleiben ungültig. Gleichzeitig mit einer Einlösung entscheidet die
Mitgliedschaftssperre: Hat die Einlösung zuerst committet, gilt das neue Passwort und die
Sperre folgt; hat die Sperre zuerst committet, findet die Einlösung keinen Link mehr. Nach
jeder abgeschlossenen Sperre bleibt kein zuvor ausgestellter Link übrig.

**Neue E-Mail** (normalisiert, eindeutig gegen alle Konten und die offenen Einladungen
dieses Betriebs, sonst `409 email-unavailable` – eine Meldung für beide Fälle): alle
Sitzungen enden, nur noch die neue Adresse meldet an.

**Reset-Link:**

| Eigenschaft | Umsetzung |
|---|---|
| Zufall | 256 Bit (`secrets.token_urlsafe(32)`, gemeinsame Hilfsfunktion mit Einladungen) |
| Speicherung | nur SHA-256-Hash, eindeutig; höchstens ein offener Link je Mitgliedschaft |
| Gültigkeit | `ELEKTROPLAN_PASSWORD_RESET_VALID_MINUTES` (Standard 60) |
| Neuer Link | löscht den alten – er ist sofort wertlos |
| Einlösen | atomar: Mitgliedschaft → Konto → Link sperren, erneut prüfen, Passwort setzen, Link löschen, alle Refresh Tokens widerrufen, Sitzungsversion + 1 |
| Sperre | löscht jeden zuvor ausgestellten offenen Link der Mitgliedschaft; ein danach bewusst neu erzeugter Link wirkt, die Sperre bleibt |
| Ungültig | unbekannt, abgelaufen, verwendet, ersetzt, durch Sperre entwertet, entfernt, inzwischen geteilt: **eine** Antwort (`404 password-reset-invalid`) |
| Passwortregeln | dieselben wie bei der Anmeldung; ein zu schwaches Passwort verbraucht den Link nicht |
| Transport | Token im Fragment (`#t=`), im Anfragekörper, nie in Pfad oder Query; die Seite entfernt es sofort aus der Adresszeile |
| Protokoll und Logs | weder Token noch Link noch Passwort; getestet für Audit **und** Logausgabe |
| Zustellung | `ELEKTROPLAN_PASSWORD_RESET_DELIVERY`: `none` (Standard) → `503`, nichts angelegt; `admin_link` → Link genau einmal in der Antwort an den Administrator, **in Produktion verweigert die Konfiguration den Start**. Kein E-Mail-Versand. |

Restrisiko: Mit `admin_link` hält der Administrator den Link in der Hand und könnte das
Passwort selbst setzen. Der Vorgang steht im Audit; deshalb nur außerhalb der Produktion.

**Letzter Administrator.** Sperren, Entfernen und Herabstufen teilen sich die Sperrwurzel
Organisationszeile und die Reihenfolge `organizations → organization_members → users →
password_reset_tokens`. Nachgewiesen mit Paralleltests gegen PostgreSQL
(`tests/test_lifecycle_concurrency.py`).

**Einstellungen** sind benutzerbezogene Profildaten je Mitgliedschaft; nur der Anfragende
erreicht sie (`/me/preferences`, ohne ID im Pfad). Beim Entfernen werden sie gelöscht.

**Ausschließlich synthetische Benutzer**, bis die DSGVO-Voraussetzungen aus Abschnitt 13
erfüllt sind. Phase 4e erfüllt die DSGVO **nicht** automatisch; sie liefert Bausteine
(Berichtigung von Name und E-Mail, Entfernen mit Bereinigung), keine vollständige Umsetzung
von Auskunft, Verarbeitungsverzeichnis, TOM oder Backup-Löschkonzept.

---

## 19. Sicherheitsprüfung 2026-10-10 – Befundstatus

Unabhängige Prüfung, umgesetzt im Sicherheitsauftrag vom 2026-10-10 (getrennt von Phase 6a).

| # | Befund | Einordnung | Nachweis |
|---|---|---|---|
| 1 | Gemeinsamer `QueryClient` überlebt Sitzungswechsel | **bestätigt und behoben** | Abschnitt 12; Gegenprobe: 6 von 6 Tests scheitern mit altem Cache |
| 2 | Dateilimit greift erst nach Multipart-Pufferung | **bestätigt und behoben** | Abschnitt 7; alter Endpunkt las unangemeldet 2 MiB vor dem `401` |
| 3 | Compose: Ports auf allen Schnittstellen, JWT-Secret erreicht den Container nicht | **bestätigt und behoben** (Entwicklung); Produktionskonfiguration **bewusst offener Betriebsblocker** | Abschnitt 8 |
| 4 | Rotation entgeht dem Familienwiderruf | **bestätigt und behoben** (Logout, Wiederverwendung, Mitgliedschaftswiderruf); die Reihenfolge „Logout zuerst“ war schon vorher sicher (**Verdacht dort widerlegt**) | Abschnitt 3; zusätzlich Deadlock E-Mail-Änderung ↔ Rotation gefunden und behoben |
| 5 | Fehlende Grenzen, nicht atomarer Login-Limiter | **bestätigt und behoben** für Erneuerung, Upload, Schreibzugriffe, Atomarität; PDF-Grenze **nicht umsetzbar** (keine PDF-Erzeugung); Mehrinstanzbetrieb **bewusst offener Betriebsblocker** | Abschnitt 11 |
| – | Aktivierung in der Entwicklungsumgebung (2026-10-10) | Migration `0011` aktiv, Ports nur `127.0.0.1`, Upload-Schranke, Sitzungswiderruf, Schreibgrenze und Datentrennung im echten Stack beobachtet; JWT-Entwicklungsersatz aktiv (kein `.env`) | `current-status.md` §2 |
| R1 | Review: Invalid-IP-Limiter blockiert Unbeteiligte (Konflikt im Toleranzfenster, Kontogrenze) | **bestätigt und behoben** – nur echte ungültige Versuche zählen, eigene Reservierung exakt zurück | Abschnitt 11; Gegenprobe: 5 von 8 Tests scheitern mit altem Verhalten |
| R2 | Review: Advisories uv, PyJWT, Vitest, tinypool, source-map-js | **bestätigt (Versionen betroffen) und aktualisiert**; Erreichbarkeit getrennt eingeordnet; zusätzlich Mako aus Scan | Abschnitt 15 |
| R3 | Beim Prüfen gefunden: `localhost` hängt seit der IPv4-Loopback-Bindung | **bestätigt und behoben** (Werkzeuge auf `127.0.0.1`) | Abschnitt 8 |
| 6 | Datenschutz und Wiederherstellung | **kein Codefix** – Checkliste angelegt, Punkte überwiegend **offen** bzw. **Entscheidung offen** | [`release-checklist-real-data.md`](release-checklist-real-data.md) |
