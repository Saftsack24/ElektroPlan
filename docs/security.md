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
- **Transport Web:** Refresh Token als `HttpOnly; Secure; SameSite=Strict`-Cookie.
- **Transport App:** Refresh Token im sicheren Gerätespeicher (Keystore über Capacitor),
  nicht in `localStorage`.
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

- TLS erzwungen, HSTS in Produktion.
- Security Header: `Content-Security-Policy` (keine Inline-Skripte),
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`,
  `X-Frame-Options: DENY`.
- CORS: enge Whitelist, keine Wildcards mit Credentials.
- CSRF: Refresh-Cookie mit `SameSite=Strict` plus Double-Submit-Token für
  Cookie-basierte Anfragen.

---

## 13. DSGVO / Datenschutz

| Anforderung | Umsetzung |
|---|---|
| Rechtsgrundlage | Vertragserfüllung (Kundendaten), berechtigtes Interesse (Audit) |
| Datenminimierung | Nur Felder mit konkretem Zweck; keine Vorratsfelder |
| Auskunft | Export aller personenbezogenen Daten eines Kunden als JSON/PDF |
| Löschung | Soft Delete für Geschäftsdokumente **plus** dokumentierter Pfad zur Anonymisierung personenbezogener Felder unter Wahrung handelsrechtlicher Aufbewahrungspflichten |
| Aufbewahrung | Geschäftsdokumente nach GoBD; Audit 12 Monate; Logs 30 Tage |
| Auftragsverarbeitung | AV-Vertrag erforderlich, sobald ein zweiter Betrieb die Plattform nutzt |
| Verzeichnis von Verarbeitungstätigkeiten | vor Produktivbetrieb zu erstellen |

Wichtig: Soft Delete allein erfüllt **kein** Löschbegehren. Der Anonymisierungspfad ist
Teil des Datenmodells (siehe `docs/database.md`) und wird spätestens vor dem ersten
externen Kunden implementiert.

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
