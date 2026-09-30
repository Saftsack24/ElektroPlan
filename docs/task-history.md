# Task History

Kompakter Eintrag nach **jedem** abgeschlossenen Arbeitsauftrag. Zweck: nachvollziehbar
halten, *warum* etwas geändert wurde — auch Monate später und in einer neuen Session.

Format:

```
Task NNNN – Titel
Datum:
Ziel:
Durchgeführte Änderungen:
Betroffene Module:
Betroffene wichtige Dateien:
Tests:
Ergebnis:
Offene Punkte:
Nächster sinnvoller Schritt:
```

---

## Task 0001 – Phase 0: Architekturanalyse und Dokumentationsgrundlage

**Datum:** 2026-09-18

**Ziel:**
Masterplan v1.0 vollständig analysieren, technische Konsistenz prüfen, Risiken und
Overengineering identifizieren, Verbesserungen vorschlagen und die Architektur inklusive
ER-Modell, Modulgrenzen, Contracts, Event-Regeln und Modulregistrierung schriftlich
festschreiben. Ausdrücklich **kein** Anwendungscode.

**Durchgeführte Änderungen:**

1. Kritische Prüfung des Masterplans: 16 Befunde, 10 Risiken, 11 begründete Abweichungen
   (`docs/architecture-review.md`)
2. Architektur festgeschrieben: drei Ebenen (Core / Shared / Fachmodule), erlaubte
   Abhängigkeitsrichtungen, Unit of Work mit Post-Commit-Events, Einfrierpunkte für
   Mengen und Preise, maschinelle Durchsetzung der Grenzen
3. Konkretes ER-Modell für Core und alle geplanten Module mit Constraints, Indizes und
   Konventionen (ganzzahlige Millimeter, `numeric` für Geld, zusammengesetzte
   Fremdschlüssel)
4. Zentraler Mechanismus definiert: **Provider-Ports** als Abhängigkeitsumkehr, damit
   Shared Business Modules Fachmodul-Daten erhalten, ohne Fachmodule zu kennen
5. Contracts spezifiziert: `MaterialRequirementDraft`/`MaterialRequirement`,
   `LaborRequirementDraft`, `OfferItemSuggestion`, `InventoryService`, `PricingService`,
   `ModuleDescriptor`, `DomainEvent`
6. Event-Bus-Regeln festgelegt (Post-Commit, at-most-once, Recompute-Pflicht,
   keine Geld-/Bestandsänderung über Events, azyklischer Event-Graph)
7. Backend- und Frontend-Modulregistrierung spezifiziert inkl. Startprüfungen und
   Contribution Points
8. Sicherheitskonzept: Schutzbedarf, Bedrohungsmodell, vierstufige Mandantentrennung,
   Upload-Härtung, DSGVO-Anforderungen, Backup
9. API-Richtlinien: Versionierung, RFC 9457, Geld als String, Cursor-Pagination,
   Idempotenz, Zustandswechsel als eigene Endpunkte
10. Roadmap mit Exit-Kriterien je Phase, Phase 4 in 4a/4b geteilt, Pilot-Meilenstein als
    verbindlicher Stopp
11. Detailplan Phase 1 mit 18 Aufgaben, Abhängigkeiten und Definition of Done
12. 10 ADRs angelegt

**Betroffene Module:** keine (kein Code) — dokumentiert wurden core, materials, inventory,
calculation, offers, work_orders, electrical

**Betroffene wichtige Dateien:**

```
CLAUDE.md                     README.md
docs/architecture.md          docs/architecture-review.md
docs/database.md              docs/modules.md
docs/contracts.md             docs/events.md
docs/api.md                   docs/security.md
docs/roadmap.md               docs/phase-1-plan.md
docs/glossary.md              docs/current-status.md
docs/changelog.md             docs/task-history.md
docs/decisions/0001…0010 + README.md
docs/modules/{electrical,materials,inventory,calculation,offers,work-orders}.md
```

**Tests:**
Nicht anwendbar — es existiert kein Code, keine Testinfrastruktur und keine
Build-Konfiguration. Typecheck und Build entfallen aus demselben Grund. Geprüft wurde die
Vollständigkeit und Widerspruchsfreiheit der Dokumente sowie die Gültigkeit aller internen
Querverweise.

**Ergebnis:**
Phase 0 abgeschlossen. Die Architektur ist entscheidungsfähig festgeschrieben; alle
Abweichungen vom Masterplan sind begründet und als ADR nachvollziehbar.

**Offene Punkte:**
- 5 technische Entscheidungen (T1–T5) und 7 fachliche Angaben aus dem Betrieb (F1–F7),
  siehe `docs/current-status.md` Abschnitt 6
- Spaltendetails im ER-Modell sind Entwurf und werden bei der Umsetzung präzisiert

**Nächster sinnvoller Schritt:**
Phase 1 (Platform Foundation) beginnen, startend mit T-0001 (Monorepo und Werkzeuge).
**Wartet auf ausdrückliche Freigabe.**

---

## Task 0002 – Phase 1: Platform Foundation

**Datum:** 2026-09-18

**Ziel:**
Tragfähiges Fundament nach `docs/phase-1-plan.md` (T-0001 bis T-0018): Monorepo,
Docker Compose, FastAPI-Backend, PostgreSQL-Schema, Authentifizierung, Autorisierung,
Mandantentrennung, Module Registry, Event Bus, Audit, Object Storage, React-Shell mit
Modulregistrierung. Ausdrücklich **keine** Fachlichkeit (keine Kunden, keine Projekte,
keine Elektroplanung).

**Durchgeführte Änderungen:**

1. **Monorepo und Werkzeuge (T-0001, T-0002):** `.gitignore`, `.editorconfig`,
   `.env.example`, npm Workspaces, `Makefile` und `tasks.ps1`, `docker-compose.yml`
   mit PostgreSQL 17, MinIO (inkl. Bucket-Initialisierung), Backend und Planner.
2. **Backend-Grundgerüst (T-0003):** App-Factory, typisierte Settings mit
   Secret-Validierung beim Start, Request-ID-Middleware, Security-Header,
   strukturiertes JSON-Logging mit Maskierung sensibler Schlüssel,
   Fehlerbehandlung nach RFC 9457, Health-Endpunkte.
3. **Datenbankschicht (T-0004):** Declarative Base mit Naming Convention, Mixins
   (`UUIDPrimaryKey`, `Timestamped`, `Versioned`, `TenantScoped`, `SoftDeletable`,
   `Authored`) sowie `tenant_identity()`/`tenant_fk()` als ausführbare Umsetzung von
   ADR 0006. Alembic-Setup, Initialmigration mit 13 Tabellen und 14 Indizes,
   generiert aus den ORM-Metadaten.
4. **Unit of Work und Event Bus (T-0005):** Sammlung während der Transaktion,
   Zustellung erst nach dem Commit, Handler in eigenen Transaktionen mit
   Fehlerisolierung, `domain_events` als Log und spätere Outbox, Zyklus- und
   Tiefenprüfung beim Start.
5. **Module Registry (T-0006):** `ModuleDescriptor`, `PortBinding`, sieben
   Startprüfungen, Router-Einhängung (Shared unter `/api/v1/...`, Fachmodule unter
   `/api/v1/modules/<id>/...`), `GET /api/v1/modules` und `GET /api/v1/me/modules`.
6. **Core-Datenmodell und Seed (T-0007):** 13 Tabellen, 12 Permissions, 6 Systemrollen,
   idempotenter Seed über `python -m app.cli seed`.
7. **Authentifizierung (T-0008):** Argon2id, Access Token ohne Berechtigungen im Token,
   Refresh-Token-Rotation mit Familien-Invalidierung bei Wiederverwendung,
   HttpOnly-Cookie, Rate Limiting je Konto und IP, Mandantenwechsel.
8. **Autorisierung (T-0009):** Permission-Registry aus den Modulen,
   `require_permission()` als introspizierbare Dependency, Test gegen Routen ohne
   Permission-Deklaration.
9. **Mandantentrennung (T-0010):** `TenantRepository` mit Kontextzwang, fremde IDs
   liefern `404`, automatischer Sweep-Test über alle Routen mit zwei Organisationen.
10. **Audit (T-0011):** explizite Aufrufpunkte, unveränderliche Einträge,
    `GET /api/v1/audit` mit Cursor-Pagination.
11. **Object Storage (T-0012):** S3-Client, Typ-Whitelist mit Magic-Byte-Prüfung,
    serverseitig erzeugter Speicherschlüssel, kurzlebige Download-URLs mit
    `Content-Disposition: attachment`.
12. **Qualitätsschranken (T-0013):** `import-linter` mit 4 Contracts, Architekturtests
    (Mandantenspalten, zusammengesetzte Fremdschlüssel, keine Float-Spalten,
    Tabellenpräfixe, Permission-Deklaration), Alembic-Head-Prüfung,
    OpenAPI-Drift-Check — gebündelt in `.\tasks.ps1 check`.
13. **Frontend (T-0014 bis T-0016):** Vite + React 19 + TypeScript strict, AuthProvider
    mit Token im Speicher und automatischer Sitzungserneuerung, Login, Shell mit
    Navigation, Dashboard, Protokollseite, Modul-Registry mit Sichtbarkeitsprüfung,
    aus OpenAPI generierter API-Client (`openapi-typescript`, 998 Zeilen Typen).
14. **Tests (T-0017):** 108 Tests; 85 laufen ohne Datenbank, 23 sind für PostgreSQL
    geschrieben und überspringen sichtbar, wenn keine Testdatenbank konfiguriert ist.

**Unterwegs gefundene und behobene Fehler:**

- `refresh_tokens.organization_id` war nullable — vom Architekturtest gefunden, auf
  `NOT NULL` gesetzt; die Null-Zweige im Auth-Service entfielen dadurch.
- Der Event-Bus meldete einen Zyklus als "zu tiefe Kette"; Prüfreihenfolge korrigiert.
- Der Readiness-Check blockierte ohne Datenbank unbegrenzt; Verbindungs-Timeout ergänzt.
- `app/db/registry.py` importierte aus `app.core` — von `import-linter` gefunden und
  als `app/model_registry.py` oberhalb der Schichten neu verortet.
- Ein Platzhalter-UUID im Auth-Service hätte den Fremdschlüssel auf `organizations`
  verletzt; entfernt.

**Betroffene Module:** core (auth, organizations, users, authorization, audit, files,
numbering, events, module_registry, tenancy), planner, api-client

**Betroffene wichtige Dateien:**

```
apps/backend/app/          59 Python-Dateien, ~4.100 Zeilen
apps/backend/tests/        10 Dateien, ~1.700 Zeilen
apps/backend/migrations/versions/0001_initial_core.py   495 Zeilen
apps/planner/src/          16 TypeScript-Dateien
packages/api-client/src/   generiert aus OpenAPI
docker-compose.yml, Makefile, tasks.ps1
docs/decisions/0011-synchronous-sqlalchemy.md
```

**Tests:**

| Prüfung | Ergebnis |
|---|---|
| `ruff check` / `ruff format --check` | bestanden, 71 Dateien |
| `mypy --strict app` | bestanden, 59 Dateien, keine Befunde |
| `lint-imports` | 4 Contracts, 0 verletzt |
| `alembic heads` | genau ein Head; `upgrade head --sql` erzeugt 14 CREATE TABLE |
| `pytest` | **85 bestanden, 23 übersprungen**, 5,4 s |
| `tsc --noEmit` (Planner und api-client) | bestanden |
| `eslint src` | ohne Befund |
| `vitest run` | 7 bestanden |
| `vite build` | 97 Module, Lazy-Chunk erzeugt |
| OpenAPI-Drift-Check | erkennt Abweichungen (Exit 1), aktuell sauber |

Nicht ausgeführt: die 23 Datenbanktests sowie `docker compose up` — auf dem
Entwicklungsrechner sind weder Docker noch PostgreSQL installiert. Die Tests laufen
bewusst **nicht** ersatzweise gegen SQLite (CLAUDE.md, Abschnitt 9).

**Ergebnis:**
Phase 1 ist implementiert und, soweit ohne Datenbank möglich, geprüft. Vier der sieben
Exit-Kriterien sind nachgewiesen, drei stehen bis zur Abnahme mit laufender Datenbank aus.

**Offene Punkte:**
- Abnahme mit PostgreSQL und Docker (Vorgehen in `docs/current-status.md`, Abschnitt 4)
- CI-Pipeline noch nicht eingerichtet
- Benutzerverwaltungs-Oberfläche bewusst nicht Teil von Phase 1

**Nächster sinnvoller Schritt:**
Abnahme von Phase 1 mit laufender Datenbank, danach Phase 2 (Core Business Data).
**Wartet auf ausdrückliche Freigabe.**

---

## Task 0003 – Phase 1.1: Korrektur- und Abnahmedurchlauf

**Datum:** 2026-09-18

**Ziel:**
Die in einer externen Durchsicht gefundenen Architektur- und Sicherheitsprobleme
korrigieren und anschließend **alle** offenen Phase-1-Exit-Kriterien mit echtem Docker,
PostgreSQL und MinIO nachweisen. Kein Beginn von Phase 2.

**Durchgeführte Änderungen (22 Punkte):**

*Infrastruktur*

1. **Compose:** Images auf Digests gepinnt (PostgreSQL 17-alpine, MinIO, MinIO Client).
   MinIO wird von **quay.io** bezogen — `minio/minio` existiert auf Docker Hub nicht mehr.
   MinIO-Healthcheck auf den dokumentierten Endpunkt `/minio/health/live` per `curl`
   umgestellt (alias-frei). `pg_isready` erzwingt eine TCP-Verbindung. Backend startet
   erst nach `service_healthy` von PostgreSQL und MinIO **und**
   `service_completed_successfully` von `minio-init`; Planner erst nach gesundem Backend.
   Die Volume-Mounts wurden so verschoben, dass sie die Laufzeitumgebung unter
   `/opt/venv` nicht mehr verdecken.
2. **S3-Endpunkte getrennt:** `ELEKTROPLAN_S3_ENDPOINT_URL` (intern) und
   `ELEKTROPLAN_S3_PUBLIC_ENDPOINT_URL` (Browser). Signierte URLs entstehen mit einem
   **eigenen, korrekt konfigurierten Client** — kein nachträgliches Ersetzen des
   Hostnamens, das die SigV4-Signatur ungültig machen würde.

*Sicherheit*

3. **Refresh Token nur noch im Cookie:** `TokenResponse` enthält ihn nicht mehr;
   `/auth/refresh` und `/auth/logout` haben keinen Anfragekörper. Der mobile Tokenflow
   wird als getrennter, späterer Flow dokumentiert.
4. **Rotation nebenläufigkeitssicher:** `SELECT … FOR UPDATE` auf der Token-Zeile.
   Genau ein Nachfolger je Token. Ein bereits ersetzter Token innerhalb von
   `refresh_race_grace_seconds` gilt als parallele Anfrage (Sitzung bleibt), danach als
   Diebstahl (Familie wird widerrufen). Frontend: Single-Flight mit geteiltem Promise,
   genau eine Wiederholung.
5. **CSRF:** `SameSite=Strict` plus strenge Origin-/Referer-Prüfung auf allen
   cookiebasierten Endpunkten. Cookie-Attribute vereinheitlicht, Löschen mit denselben
   Attributen.
6. **Upload:** stückweises Lesen (64 KiB) mit Limit **während** des Lesens, SHA-256 im
   Strom, `SpooledTemporaryFile` statt unbegrenztem Speicher, injektionssichere
   `Content-Disposition`, definierte Reihenfolge Datenbank → Storage → Commit mit
   Aufräumen verwaister Objekte.
9. **Mehrmandanten-Login deterministisch:** kein unsortiertes `LIMIT 1` mehr. Eine
   Mitgliedschaft wird automatisch gewählt, mehrere erzeugen
   `409 organization-selection-required` samt Auswahlliste im Problem-Dokument.
11. **Sicherheitsheader:** CSP getrennt für Entwicklung (Swagger UI) und Produktion,
    HSTS nur in Produktion, Request-ID validiert und längenbegrenzt.

*Architektur und Ehrlichkeit*

10. **Event-Zustellgarantie korrigiert:** ADR 0012 hält fest, dass `domain_events`
    **keine** transaktionale Outbox ist, sondern ein Best-Effort-Protokoll mit
    *at most once*. ADR 0004 wurde entsprechend gekennzeichnet. Der Bus wird vor dem
    Verdrahten geleert, damit Tests keine Handler doppelt registrieren.
14. **Widerspruch Electrical/Materials aufgelöst:** `electrical` hängt in den Phasen 3–6
    nur von `core` ab; Abhängigkeit und Provider-Ports kommen erst in Phase 7. Kein
    Platzhaltermodul.
15. **Rollenmodell auf MVP-Umfang begrenzt** und die Aussage entfernt, Rollen seien
    bereits anpassbar oder kopierbar.

*Werkzeuge und Tests*

7. **Echte Migrationsabnahme:** eigene Datenbank, ausschließlich `alembic upgrade head`,
   kein `create_all`. Zusätzlich: Drift-Vergleich Migration ↔ ORM, `downgrade base` und
   erneutes `upgrade`, Seed zweimal, Login gegen das migrierte Schema und ein Test, der
   PostgreSQL direkt einen mandantenübergreifenden Verweis ablehnen lässt.
8. **Mandantentrennung vollständig:** Der Sweep meldet jetzt Routen ohne Testdaten als
   **Fehler**, statt sie stillschweigend zu überspringen; er prüft alle Methoden.
   Ergänzt: keine fremde `organization_id` einschleusbar, keine mandantenübergreifende
   Rollenzuordnung.
12. **Reproduzierbare Abhängigkeiten:** `uv.lock` (72 Pakete) eingecheckt, Installation
    nur noch über `uv sync --frozen` und `npm ci`, `uv lock --check` im Gesamtlauf,
    Dockerfile auf `uv sync --frozen` umgestellt. `uv` steht selbst im Lock, sonst würde
    `uv sync` das Werkzeug entfernen.
13. **API-Client typsicher:** Pfade, Methoden, Pfadparameter, Query, Body und Response
    werden aus dem OpenAPI-Schema abgeleitet; vier `@ts-expect-error`-Marker beweisen,
    dass falsche Aufrufe nicht mehr übersetzen.

*Dokumentation*

16. Offline-Konzept (`docs/offline-sync.md`): offline schreibbare Aggregate,
    `client_txn_id`, optimistische Versionierung, Tombstones, vier Konfliktklassen mit
    der Festlegung, welche **nur manuell** lösbar sind.
17. DSGVO-Zeitgrenze korrigiert: Die Anforderungen gelten vor der ersten Verarbeitung
    echter personenbezogener Daten — also **vor Phase 2**, nicht erst beim externen
    Mandanten. Zwölf konkrete Voraussetzungen dokumentiert.
18. ARCore: technischer Spike auf realer Zielhardware vor der Umsetzung; Kotlin als
    zulässige Alternative zu Capacitor festgehalten.
19. Dokumentationspflicht pragmatisch gefasst: je Dokument eine Bedingung statt Ritual;
    kleine Korrekturen brauchen keine Dokumentänderung.
20. Status und technische Schulden getrennt nach behoben / getestet / aufgeschoben /
    Schuld / offene Entscheidung / Voraussetzung vor Echtdaten.
21. Repository-Hygiene: `.gitignore` erweitert (u. a. `.uv-cache`), bewusst versionierte
    Artefakte begründet, `git archive` als Weg zum schlanken Prüfarchiv dokumentiert.
    Keine Secrets in versionierten Dateien gefunden.

**Unterwegs gefundene und behobene Fehler:**

- `migrations/env.py` überschrieb die Datenbank-URL bedingungslos aus den Settings; eine
  programmatische Vorgabe wurde ignoriert. Dadurch lief die Migrationsabnahme gegen die
  falsche Datenbank.
- `uv lock` scheiterte am defekten globalen uv-Cache dieser Maschine; die Skripte setzen
  jetzt einen projektlokalen Cache.
- `Invoke-Step` in `tasks.ps1` wertete stderr-Ausgaben nativer Werkzeuge als Fehler.

**Betroffene wichtige Dateien:**

```
docker-compose.yml, infrastructure/*.Dockerfile
apps/backend/app/config.py, middleware.py, errors.py
apps/backend/app/core/auth/{api,service,schemas,dependencies}.py
apps/backend/app/core/files/{storage,service,api}.py
apps/backend/app/core/module_registry/registry.py, app/core/events/bus.py
apps/backend/migrations/env.py, apps/backend/pyproject.toml, apps/backend/uv.lock
apps/backend/tests/{test_auth_flow,test_file_upload,test_migration_acceptance,
                    test_tenant_isolation,conftest}.py
packages/api-client/src/index.ts
apps/planner/src/core/auth/{AuthProvider.tsx,LoginPage.tsx}
apps/planner/src/core/api/client.types.test.ts
tasks.ps1, Makefile, .gitignore
```

**Tests:**

| Prüfung | Ergebnis |
|---|---|
| `ruff check` / `ruff format --check` | bestanden, 73 Dateien |
| `mypy --strict app` | keine Befunde, 59 Dateien |
| `lint-imports` | 4 Contracts, 0 verletzt |
| `uv lock --check` | aktuell, 72 Pakete |
| `alembic heads` | genau ein Head |
| `pytest` | **145 bestanden, 0 übersprungen** (zuvor 85 bestanden + 23 übersprungen) |
| `tsc --noEmit` (Planner, api-client) | bestanden |
| `eslint src` | ohne Befund |
| `vitest run` | 8 bestanden |
| `vite build` | erfolgreich, Lazy-Chunk erzeugt |
| OpenAPI-Drift-Check | aktuell |

**Ergebnis:**
Phase 1 ist abgeschlossen. Alle sieben Exit-Kriterien wurden ausgeführt und erfüllt.

**Offene Punkte:**
Siehe `docs/current-status.md`, Abschnitt 5 — getrennt nach behoben/getestet,
aufgeschoben, technischer Schuld, offener Entscheidung und Voraussetzung vor Echtdaten.

**Nächster sinnvoller Schritt:**
Phase 2 (Core Business Data) — erst nach Klärung der DSGVO-Voraussetzungen für echte
Kundendaten. **Wartet auf ausdrückliche Freigabe.**

---

## Task 0004 – Phase 1.2: Härtung der Architekturgrenzen und der Sitzungslogik

**Datum:** 2026-09-19

**Ziel:**
Die in Phase 1 dokumentierten Architektur- und Sitzungsregeln automatisch
durchsetzbar machen. Konkrete Ziele: (a) das Drei-Ebenen-System aus Core /
Shared / Fachmodul greift auch **innerhalb** von `app.modules`, ohne dass
für jedes zukünftige Modul eine neue `.importlinter`-Zeile nötig ist; (b)
Provider-Ports werden statisch **und** zur Startzeit auf Signaturkonformität
geprüft; (c) Datenbank-Fremdschlüssel zwischen Modulen sind kontrolliert;
(d) das Frontend erlaubt keine Umgehungspfade mehr; (e) die
Refresh-Token-Rotation trennt regulären Wechsel eindeutig von Logout,
Diebstahlsverdacht und Familienwiderruf.

**Durchgeführte Änderungen:**

1. **Statische Import-Analyse.** Neue Datei
   `apps/backend/app/core/module_registry/boundaries.py` liest die
   registrierten `ModuleDescriptor`, importiert jedes `app.modules.<id>`
   und scannt jede Python-Datei per AST. Die Verstöße kommen als typisierte
   Liste zurück; der Test `tests/test_module_boundaries.py` bricht den
   Build bei jedem Verstoß.
2. **Erlaubte Nachbarschaft.** Jedes Modul darf ausschließlich Contracts
   (`app.contracts.*`), Core (`app.core.*`, `app.db.*`), sich selbst und
   Module in `depends_on` importieren. `models`, `repositories`,
   `services`, `api` eines fremden Moduls sind grundsätzlich verboten —
   die Kommunikation läuft über den Contract.
3. **Synthetische Verstöße getestet.** Weil in Phase 1 noch keine
   Fach- oder Shared-Module existieren, deckt der Test alle Regeln über
   synthetische Descriptor- und Metadaten-Fixtures ab: Shared → Fachmodul,
   Fachmodul → Fachmodul, Zugriff auf `models`/`repositories`,
   unbekanntes Präfix, mandantenübergreifender Composite-FK, unbekannter
   Import.
4. **Datenbankgrenzen.** `check_table_boundaries()` ordnet jede Tabelle
   ihrem Modul zu und prüft alle FKs. Core-Tabellen sind nun **zentral**
   in `apps/backend/app/core/module.py::CORE_TABLES` gelistet; sowohl der
   neue Test als auch der ältere Präfix-Test lesen aus derselben Quelle.
5. **Provider-Ports typisiert.** `PortBinding` wurde generisch
   (`PortBinding[TPort]`) und die neue Fabrikfunktion `bind_port()`
   erzwingt, dass Implementierung und Port zueinander passen. Damit
   greift mypy `--strict` schon am Aufruf. Die Registry verifiziert
   zusätzlich per `inspect.signature`, dass die Methoden-Parameter und
   der Rückgabetyp der Implementierung mit dem Protocol übereinstimmen.
6. **Neue negative Tests für Ports.** Zwei Fälle in
   `test_module_registry.py` (falscher Parametername, falscher
   Rückgabetyp) sind rot, wenn die Prüfung sie nicht mehr abfängt.
7. **Frontend-Grenzen.** `eslint.config.js` wurde neu geschnitten. Die
   Muster erfassen absolute Pfade (`@/modules/…`, `src/modules/…`) und
   relative Umgehungen (`../modules/…`, `../../modules/…`). Innerhalb
   eines Modul-Ordners kommt eine strengere Regel gegen
   Geschwister-Imports (`../<name>`) hinzu. Nur `src/modules/index.ts`
   darf konkrete Module registrieren. Ein neuer Vitest-Test
   `src/core/modules/boundaries.test.ts` fährt ESLint programmatisch
   gegen synthetische Import-Muster.
8. **Refresh-Token-Rotation.** Das Modell `RefreshToken` erhielt die
   Spalte `revoked_reason` (Alembic-Migration
   `0002_refresh_revocation`). Der Auth-Service setzt beim
   Rotieren `replaced_by_id` und `revoked_reason = ROTATED` atomar zum
   Nachfolger; ausschließlich `ROTATED`-Tokens innerhalb des
   Toleranzfensters gelten als paralleler Refresh. Logout,
   Familienwiderruf und `REUSE_DETECTED` sind sofort ungültig und lösen
   **keinen** weiteren Sammelwiderruf mehr aus. `IssuedTokens` trägt
   jetzt die Refresh-ID des neuen Datensatzes.
9. **Sechs neue Auth-Tests** (`test_auth_flow.py`) belegen: `replaced_by_id`
   ist gesetzt, ein Logout setzt `revoked_reason = LOGOUT`, die
   Wiederverwendung eines Logout-Tokens innerhalb des Toleranzfensters
   führt zu 401 **ohne** neuen Sammelwiderruf, echte Wiederverwendung
   markiert die Nachfolger mit `REUSE_DETECTED`.
10. **Dokumentation** synchronisiert: `docs/modules.md` (Abschnitt 8 —
    Zuständigkeiten je Ebene), `docs/security.md` (Refresh-Rotation mit
    Widerrufsgründen), `docs/current-status.md`, `docs/roadmap.md`,
    `docs/changelog.md`.

**Betroffene Module:** core (Refresh-Token, Registry, Grenzprüfung), Frontend-Shell
(ESLint-Konfig).

**Betroffene wichtige Dateien:**

```
apps/backend/app/core/auth/models.py
apps/backend/app/core/auth/service.py
apps/backend/app/core/module.py
apps/backend/app/core/module_registry/descriptor.py
apps/backend/app/core/module_registry/registry.py
apps/backend/app/core/module_registry/boundaries.py        (neu)
apps/backend/migrations/versions/0002_refresh_revocation.py            (neu)
apps/backend/tests/test_architecture.py
apps/backend/tests/test_auth_flow.py
apps/backend/tests/test_module_boundaries.py               (neu)
apps/backend/tests/test_module_registry.py
apps/backend/.importlinter
apps/planner/eslint.config.js
apps/planner/src/core/modules/boundaries.test.ts           (neu)
docs/changelog.md
docs/current-status.md
docs/modules.md
docs/security.md
docs/task-history.md
```

**Tests:**
Siehe DONE-Block der Aufgabenzusammenfassung. In dieser Umgebung stand kein
PostgreSQL, kein Docker und keine installierte Python-/Node-Umgebung zur
Verfügung — die Tests wurden geschrieben und in Struktur/Logik geprüft, aber
`tasks.ps1 check` konnte nicht ausgeführt werden. Der Grund ist im
Abschnitt "TESTS" der Zusammenfassung namentlich benannt.

**Ergebnis:**
Die vier Architekturregeln aus Abschnitt 3 der `CLAUDE.md` sind jetzt
automatisch geprüft — nicht nur dokumentiert. Ein neues Modul, das falsche
`depends_on` deklariert, fremde Tabellen anfässt, den falschen
Protocol-Rückgabetyp liefert oder Geschwister-Module importiert, wird von
den Tests namentlich beanstandet. Die Refresh-Token-Semantik unterscheidet
regulären Wechsel, Logout und Wiederverwendung explizit.

**Offene Punkte:**
Ausführung der Gesamtabnahme (`tasks.ps1 check`, Migration auf leerer
Datenbank, Compose-Start, Login/Refresh/Logout gegen das laufende System)
steht aus. Sie muss vor der Freigabe für Phase 2 in einer geeigneten
Umgebung durchlaufen werden.

**Nächster sinnvoller Schritt:**
`tasks.ps1 check` in einer Umgebung mit PostgreSQL 17 und Docker
ausführen und die im DONE-Block genannten Tests bestätigen. Erst danach
Phase 2 auf ausdrückliche Freigabe.

---

## Task 0005 – Phase 1.2 Nachbesserung: harte Grenzen, PG-Abnahme

**Datum:** 2026-09-19

**Ziel:**
Neun konkrete Review-Befunde zu Phase 1.2 vollständig abarbeiten: die
Alembic-Kennung verkürzen, den Import-Deckel schließen (keine
`app.modules.<anderes>`-Importe mehr, auch nicht auf angeblich öffentliche
Submodule), die Architekturprüfung von dynamischen Importen auf reine
AST-/Dateisystem-Analyse umstellen, FK zwischen Modultabellen kategorisch
verbieten, das Frontend technisch gegen Sibling-Imports absichern, die
Port-Typisierung mit einem echten mypy-Negativtest belegen und die
Refresh-Token-Semantik gegen PostgreSQL laufen zu lassen.

**Durchgeführte Änderungen:**

1. **Alembic**: Datei umbenannt in
   `0002_refresh_revocation.py`, `revision = "0002_refresh_revocation"` (23
   Zeichen). Sämtliche Dokumentationsverweise entsprechend nachgezogen. Kein
   ALTER TABLE nötig, weil noch keine Datenbank auf dem alten Namen stand.
2. **`boundaries.py` neu**:
   * Rein dateisystembasierte AST-Analyse in
     `check_import_boundaries`, keine `importlib.import_module`- oder
     `pkgutil.walk_packages`-Aufrufe.
   * `_classify_import` bricht jeden Import auf `app.modules.<anderes>` ab —
     unabhängig davon, welches Submodul er anspricht (Paket-Root,
     `contracts`, `providers`, `schemas`, `domain`, `models`, `services`,
     `api`, `utils`, …). Die alte `INTERNAL_SUBPACKAGES`-Allowlist ist
     entfernt.
   * `require_module_folder=True` meldet ein registriertes Nicht-Core-Modul
     ohne eigenen Ordner als Fehler.
   * Syntaxfehler, unlesbare Dateien und relative Importe über das Backend
     hinaus werden mit Datei- und Zeilenangabe gemeldet.
   * `check_table_boundaries` erlaubt FK nur noch auf eigene und
     Core-Tabellen. Der frühere Positivtest
     `test_erlaubt_ziel_in_depends_on` ist als Negativtest
     `test_depends_on_hebt_verbot_nicht_auf` neu geschrieben.
3. **`tests/test_module_boundaries.py`**: komplett neu geschrieben; 30
   Tests. Ein Test erzeugt einen realistischen Modulbaum in `tmp_path` und
   fährt den Scanner darüber (`test_scanner_gegen_realistischen_modulbaum`).
   Weitere Tests decken Syntaxfehler, unerlaubte relative Importe, den
   Sibling-, Shared-, Fachmodul-, `depends_on`-Fall und den
   zusammengesetzten mandantensicheren FK ab.
4. **Frontend-Grenze technisch**:
   * `apps/planner/scripts/module-boundaries.mjs` löst Importpfade
     (absolut, alias `@/` und `src/`, relativ) gegenüber der Quelldatei auf,
     bestimmt den tatsächlichen Datei-Owner und lehnt jeden
     Cross-Module-Zugriff ab. Composition Root darf konkrete Modul-Indizes
     importieren, sonst niemand.
   * `boundaries.test.ts` importiert dieselbe Funktion aus dem `.mjs`-Modul
     — kein duplizierter Regelsatz. 11 Fixture-Fälle: Sibling,
     `../../modules/…`, Alias, Core→Modul, App→Interna, Composition
     Root→Index (erlaubt), Composition Root→Interna (verboten),
     eigenes Modul, Modul→Core.
   * `npm run check:boundaries` verwendet das Skript; in
     `tasks.ps1 check` eingebaut.
5. **Port-Typisierung**:
   * Vier Negativ-Fixtures unter `tests/mypy_negative/` (fehlende Methode,
     falsche Parameteranzahl, falscher Parametertyp, falscher Rückgabetyp)
     plus eine positive Fixture. `tests/test_ports_typing.py` ruft mypy
     `--strict` als Subprozess auf und prüft, dass die Fehler jeweils in
     der geprüften Datei auftauchen.
   * `_verify_port_binding` in `registry.py` erweitert:
     - vergleicht jetzt auch **Parametertypen** und den **Rückgabetyp**,
     - lehnt sync/async-Missmatch ab,
     - erhebt nicht auflösbare Forward-Referenzen zum harten Fehler
       (`raise ModuleRegistrationError`).
6. **Refresh-Token gegen PostgreSQL**:
   * Alle Auth-Tests laufen gegen `elektroplan_test`.
   * Migration von leer → head, downgrade → 0001, erneutes upgrade → 0002
     durchlaufen.
   * Ein Legacy-Token ohne Grund wird durch die Migration korrekt auf
     `family_revoked` gesetzt.
   * Login/Refresh/Logout gegen laufendes Backend (Docker Compose)
     durchlaufen. Der Datenbankinhalt zeigt: Vorgänger trägt
     `revoked_reason = rotated` und `replaced_by_id`, Logout-Token trägt
     `revoked_reason = logout`.
   * Browser-Neuladen erhält die Sitzung.
7. **Dokumentation**: `docs/modules.md` Abschnitte 2 und 8 neu formuliert;
   `docs/security.md`, `docs/changelog.md`, `docs/current-status.md`,
   `docs/task-history.md` und diese Datei nachgezogen.

**Betroffene wichtige Dateien:**

```
apps/backend/app/core/module_registry/boundaries.py
apps/backend/app/core/module_registry/registry.py
apps/backend/app/core/module_registry/descriptor.py    (unveraendert)
apps/backend/migrations/versions/0002_refresh_revocation.py  (umbenannt)
apps/backend/tests/test_module_boundaries.py           (neu strukturiert)
apps/backend/tests/test_module_registry.py             (zwei neue Runtime-Tests)
apps/backend/tests/test_ports_typing.py                (neu)
apps/backend/tests/mypy_negative/                       (neu: 5 Fixtures)
apps/planner/scripts/module-boundaries.mjs             (neu, Produktivpruefung)
apps/planner/scripts/_globby.mjs                       (neu, kleiner Datei-Sammler)
apps/planner/eslint.config.js                          (auf Fruehwarnung reduziert)
apps/planner/src/core/modules/boundaries.test.ts       (produktive Funktion aufgerufen)
apps/planner/package.json, package.json                (check:boundaries-Skript)
tasks.ps1                                              (check:boundaries eingebaut)
docs/modules.md, docs/security.md, docs/current-status.md,
docs/roadmap.md, docs/task-history.md, docs/changelog.md
```

**Tests:**

| Prüfung | Ergebnis |
|---|---|
| ruff check | All checks passed |
| ruff format --check | keine Diffs |
| mypy --strict app | keine Befunde |
| import-linter | 4 Contracts, 0 verletzt |
| tests/test_module_boundaries.py (isoliert) | 30 bestanden |
| tests/test_module_registry.py (isoliert) | 25 bestanden |
| tests/test_ports_typing.py (mypy-Subprozess je Fixture) | 5 bestanden |
| pytest gegen PostgreSQL | **190 bestanden, 0 übersprungen** |
| Alembic leer → head | grün |
| Alembic downgrade → 0001 → upgrade → 0002 | grün |
| Alembic Legacy-Token → `family_revoked` | grün |
| Seed zweimal | idempotent (12/0 neue Permissions) |
| Login/Refresh/Logout gegen laufendes Backend | 200/200/204, danach 401 |
| Rotationskette in DB | Vorgänger `rotated` mit `replaced_by_id`, Nachfolger nach Logout `logout` |
| Browser-Neuladen | Sitzung bleibt erhalten |
| Frontend npm run typecheck | grün |
| Frontend npm run lint | grün |
| Frontend npm run check:boundaries | Modulgrenzen: OK |
| Frontend npm run test | 19 bestanden |
| Frontend npm run build | erfolgreich |
| Frontend npm run check:api | API-Client ist aktuell |
| Docker-Container | Postgres, MinIO, Backend, Planner alle `healthy` |

**Ergebnis:**
Alle neun Review-Befunde umgesetzt. Die harten Regeln sind technisch geprüft
und nicht mehr nur konventionell. Phase 1.2 ist bereit für die formelle
Freigabe.

**Offene Punkte:**

* Ein Vollzyklus `docker compose down --volumes` + `up` (frischer Start ab
  leeren Volumes) wurde in diesem Durchlauf nicht wiederholt — die
  Container liefen bereits aus der Vorsession. Migration, Seed und
  Auth-Endpunkte gegen genau diesen Zustand sind aber grün.
* `RefreshConflictError` liefert weiterhin bewusst `401`, weil das
  Single-Flight-Frontend genau darauf reagiert; die Entscheidung ist in
  `docs/security.md` dokumentiert.

**Nächster sinnvoller Schritt:**
Freigabe für Phase 2. Bis dahin keine weiteren Änderungen an Sitzung,
Grenzen oder Migration.

---

## Task 0006 – Phase 1.2 Finalisierung

**Datum:** 2026-09-19

**Ziel:**
Zwei letzte Frontend-Architekturluecken schliessen (App darf konkrete
Module gar nicht kennen; dynamische Imports muessen genauso streng
geprueft werden wie statische), `tasks.ps1 boundaries` konsistent
machen und Phase 1.2 mit einem echten `docker compose down -v` +
`up --build` abnehmen.

**Durchgeführte Änderungen:**

1. **Produktive Grenzfunktion (`apps/planner/scripts/module-boundaries.mjs`)
   neu geschrieben.** Statt Regex ueber die Quelltexte parst die
   Analyse mit dem TypeScript-Compiler (`ts.createSourceFile`) den
   vollen AST und sammelt:
   * statische `ImportDeclaration`,
   * `ExportDeclaration` mit `moduleSpecifier` (Re-Exports),
   * `CallExpression` mit `ImportKeyword` (dynamische Imports, u. a.
     in `React.lazy(() => import("…"))`, mehrzeilig, mit `await`).
   Nicht statisch bestimmbare Ziele (`import(variable)`,
   Template-Literals mit `${…}`) werden als
   `dynamic-non-literal`-Verstoss zurueckgegeben; sie brechen den
   Build und koennen die Grenze nicht mehr umgehen.
2. **`isAllowed` verschaerft**: `app → module-public` ist jetzt
   ausdruecklich verboten. Nur `app → composition-root` (die Fassade
   `src/modules/index.ts`), `app → core` und `app → other` sind
   erlaubt. `reasonFor` liefert je eine klare Meldung fuer
   `app → module-public` und `app → module-internal`.
3. **Vitest-Fixtures erweitert** (`boundaries.test.ts`): jetzt 29
   Fixtures - Sibling-Import (relativ / Alias / `../../modules/`),
   Re-Export, `app → ../modules/audit`, `app → @/modules/audit`,
   `app → ../modules/audit/AuditPage`, `app → ../modules` (erlaubt),
   `app → core` (erlaubt), Composition-Root-Faelle, dynamische
   Sibling-Imports, dynamische `import()` von Core und
   Composition-Root, `dynamic-non-literal` fuer Template und Variable,
   Import eines externen Pakets. Die Fixtures rufen weiterhin die
   produktive Funktion aus `module-boundaries.mjs` auf.
4. **`tasks.ps1 boundaries`** fuehrt jetzt alle vier Grenzpruefungen
   aus: `import-linter`, Backend-AST-Grenzen inkl. Datenbankgrenzen,
   Port-Typisierung mit mypy-Negativfixtures, produktive
   Frontend-Grenzpruefung. Die Hilfe wurde aktualisiert.
5. **Frischer Compose-Abnahmelauf**:
   * Betroffene Volumes vorher gelistet: `dev_elektroplan_minio-data`
     und `dev_elektroplan_postgres-data`.
   * `docker compose down -v` entfernte beide Volumes.
   * `docker compose up --build -d` startete alle Container neu.
     `postgres`, `minio`, `backend` sind `healthy`; `minio-init` mit
     Exit 0. Planner erreichbar auf Port 5173.
   * Migration `leer -> head` (0001 -> 0002_refresh_revocation)
     erfolgreich innerhalb des frischen Backend-Containers.
   * Seed zweimal ausgefuehrt: 12 neue Permissions im ersten Lauf,
     0 im zweiten (Idempotenz nachgewiesen).
   * API-Smoke: Login 200, HttpOnly-Cookie gesetzt; Refresh 200 mit
     rotiertem Cookie; Vorgaenger in DB traegt
     `revoked_reason='rotated'` und `replaced_by_id`; Logout 204;
     Nachfolger `revoked_reason='logout'`; Refresh nach Logout 401.
   * Browser-Smoke: Anmeldung ueber die UI erfolgreich, Neuladen
     erhaelt die Sitzung, Login-Maske erscheint nach Logout.
6. **Volle Qualitaetspruefung** nach dem frischen Compose-Start
   erneut durchlaufen. Ergebnisse siehe unten.

**Betroffene Module:** Frontend-Modulregistry-Test und produktive
Grenzpruefung; `tasks.ps1`; Dokumentation. Kein Backend-Code
angefasst.

**Betroffene wichtige Dateien:**

```
apps/planner/scripts/module-boundaries.mjs         (TS-Compiler-AST, isAllowed erweitert)
apps/planner/src/core/modules/boundaries.test.ts   (29 Fixtures)
tasks.ps1                                          (boundaries deckt jetzt alles ab)
docs/modules.md, docs/current-status.md,
docs/task-history.md, docs/changelog.md
```

**Tests:**

| Prüfung | Ergebnis |
|---|---|
| ruff check | All checks passed |
| ruff format --check | 84 Dateien, keine Diffs |
| mypy --strict app | Success: no issues found in 60 source files |
| import-linter | 4 Contracts kept, 0 broken |
| alembic heads | 0002_refresh_revocation (einziger Head) |
| alembic history | linear 0001 -> 0002 |
| pytest gegen frisches PostgreSQL | **190 passed, 0 skipped, 0 failed** |
| Alembic leer -> Head im frischen Container | grün |
| Seed zweimal | idempotent (12 / 0 neue Permissions) |
| OpenAPI-Export | 14 Endpunkte, kein Drift |
| API-Client aktuell | grün |
| tasks.ps1 boundaries | alle vier Schritte grün (import-linter,
  Backend-AST, Port-Typisierung, Frontend-Skript) |
| Frontend typecheck | grün |
| Frontend eslint | ohne Befund |
| Frontend npm run check:boundaries | Modulgrenzen: OK |
| Frontend vitest | **37 passed** (davon 29 in boundaries.test.ts) |
| Frontend Produktions-Build | erfolgreich (dist/index-*.js, dist/AuditPage-*.js) |
| Docker Compose fresh up --build | alle Container healthy, minio-init exit 0 |
| API-Smoke (Login/Refresh/Logout) | 200/200/204, danach 401 |
| DB-Kette nach Rotation + Logout | Vorgaenger rotated + replaced_by_id, Nachfolger logout |
| Browser-Smoke | Anmeldung UI, Neuladen erhaelt Sitzung, Logout zurueck zur Anmeldemaske |

**Ergebnis:**
Die letzten zwei Frontend-Grenzluecken sind geschlossen. Statische und
dynamische Imports werden identisch geprueft; die verbindliche Grenze
ist das produktive Node-Skript, das Vitest und CLI gemeinsam nutzen.
`tasks.ps1 boundaries` ist eine echte Gesamt-Grenzpruefung. Ein
vollstaendiger frischer Compose-Aufbau war erfolgreich und wurde
gegen Migration, Seed, API und Browser abgenommen. **Keine bekannten
Blocker fuer Phase 2.**

**Offene Punkte:**
Keine bekannten Blocker fuer Phase 2. Die DSGVO-Voraussetzungen aus
`docs/security.md` Abschnitt 13 sind unabhaengig vom Code und werden
mit dem Beginn von Phase 2 wirksam.

**Nächster sinnvoller Schritt:**
Freigabe fuer Phase 2 abwarten. Bis dahin keine weiteren Aenderungen an
Sitzung, Grenzen oder Migration.

**Nachtrag 2026-09-19 (Punkt-Fix):** `ownerOf()` in
`apps/planner/scripts/module-boundaries.mjs` klassifizierte jede
Datei namens `index.ts[x]` unabhaengig von der Tiefe als
`module-public`. Das ist korrigiert - nur `src/modules/<id>` und
`src/modules/<id>/index.ts[x]` gelten als oeffentlicher Einstieg;
verschachtelte `index`-Dateien wie `modules/<id>/pages/index.ts`
sind `module-internal`. 11 zusaetzliche Vitest-Fixtures decken
Composition-Root-, App-, Cross-Module- und dynamische Faelle ab und
bestaetigen, dass das Ziel als `module-internal` klassifiziert wird.
Frontend-Ergebnis: `npm run check:boundaries` OK, 48 Vitest bestanden,
typecheck / lint / build gruen.

---

## Task 0007 – Phase 2: Core Business Data

**Datum:** 2026-09-19

**Ziel:**
Phase 2 der Roadmap umsetzen: Kunden, Projekte, Gebäude, Geschosse, Dateiupload gegen
MinIO, Nummernkreise in Benutzung und eine Projektübersicht im Frontend mit Modul-Tabs.
Ausschließlich synthetische Testdaten.

**Durchgeführte Änderungen:**

1. **Nummernkreise in Benutzung** (`app/core/numbering/service.py`). Vergabe über
   Zeilensperre (`SELECT … FOR UPDATE`), Zeile vorher per `INSERT … ON CONFLICT DO
   NOTHING` sichergestellt. Formate: `KD-#####` (durchlaufend) und `PR-JJJJ-####` (je
   Kalenderjahr neu). Die Formate für Angebot und Auftrag bleiben offen (F5).
2. **Kundenstamm** (`app/core/customers/`): Modell, Schemas, Service, API. Freitextsuche
   über Name, Nummer und Ort, Filter nach Art, Sortierung nach Anlagezeitpunkt oder Name,
   Keyset-Pagination.
3. **Projekte, Gebäude, Geschosse** (`app/core/projects/`): Projekt mit Pflichtkunde,
   Statuslauf `draft → active → completed` mit `archived` als Endzustand. Statuswechsel
   sind eigene Endpunkte, kein Feld im `PATCH`. Geschosse tragen ganzzahlige Millimeter
   (ADR 0007) und sind je Gebäude auf ihrer Ebene eindeutig.
4. **Optimistisches Sperren** (`app/core/preconditions.py`): `If-Match` ist auf allen
   versionierten Entitäten Pflicht. Fehlt der Header, antwortet der Server mit `428`
   (Precondition Required, RFC 6585); passt er nicht, mit `409`. Ohne Pflicht hätte die
   Versionsspalte keinerlei Wirkung.
5. **Anonymisierung von Kunden** (`POST /customers/{id}/anonymize`): Umsetzung von
   Art. 17 DSGVO. Die personenbezogenen Felder werden überschrieben, Kundennummer und
   Belegzuordnung bleiben. Nicht umkehrbar, eigene Berechtigung, nur Administrator. Das
   Protokoll hält den Vorgang fest — **ohne** die gelöschten Werte. Der Datensatz ist
   danach serverseitig gegen Änderungen gesperrt; Ausblenden und Anonymisieren sind
   zwei getrennte, kombinierbare Vorgänge.
   *Beim Selbstreview korrigiert:* Die Anonymisierung setzte anfangs zusätzlich
   `deleted_at`. Damit war der Datensatz über die API nicht mehr erreichbar — die
   Sperre gegen erneutes Bearbeiten wäre toter Code gewesen, und die Dokumentation
   („bleibt bestehen") hätte nicht zum Verhalten gepasst.
6. **Projektdateien**: `files.project_id` (zusammengesetzter FK, `NULL` erlaubt),
   Speicherschlüssel `org/<org>/project/<projekt>/<datei><ext>` wie in
   `docs/architecture.md`, Abschnitt 15 beschrieben. Neu:
   `GET /projects/{id}/files` und `GET /files/{id}/download-url`.
7. **Pagination verallgemeinert** (`app/core/pagination.py`): Keyset-Cursor über
   Sortierwert plus ID, benutzt von Kunden, Projekten und dem Protokoll.
8. **Permissions**: sieben neue Core-Permissions (`customer.record.*`,
   `project.record.*`), Zuordnung zu den Systemrollen erweitert.
9. **Migration `0003_core_business_data`**, aus den ORM-Metadaten erzeugt und von Hand
   dokumentiert. Autogenerate meldet danach keinen Unterschied mehr.
10. **Frontend**: `src/modules/audit` wurde zu `src/modules/platform` — das Modul trägt
    jetzt Kunden, Projekte und Protokoll. Neue Seiten: Kundenliste und -detail,
    Projektliste, Projektdetail mit Tabs (Stammdaten, Gebäude & Geschosse, Dateien) samt
    Upload und Download.
11. **Projekt-Tabs der Fachmodule** über einen Core-Context
    (`src/core/modules/ProjectTabs.tsx`), gefüllt von `src/app/App.tsx`. Ein Modul darf
    die Composition Root nicht importieren; der Kanal hält die Grenze ein. Der
    Beitragspunkt ist damit live, obwohl ihn in Phase 2 noch niemand nutzt.
12. **API-Client** um `If-Match` und `upload()` für Multipart erweitert; neue Schematypen
    exportiert.
13. **Ein ausdrückliches `null` auf einem Pflichtfeld im `PATCH`** wird als
    Validierungsfehler (`422`) abgelehnt. *Beim Selbstreview gefunden:* Ohne diese
    Prüfung hätte `{"name": null}` einen Datenbankfehler und damit `500` erzeugt.
    Optionale Felder lassen sich weiterhin über `null` leeren.

**Betroffene Module:**
`core` (numbering, customers, projects, files, authorization, audit), Planner-Modul
`platform`, `packages/api-client`.

**Betroffene wichtige Dateien:**
`app/core/numbering/service.py`, `app/core/customers/*`, `app/core/projects/*`,
`app/core/preconditions.py`, `app/core/pagination.py`, `app/core/files/{models,service,api,storage}.py`,
`app/core/authorization/permissions.py`, `app/core/module.py`, `app/model_registry.py`,
`migrations/versions/0003_core_business_data.py`,
`apps/planner/src/modules/platform/*`, `apps/planner/src/core/modules/ProjectTabs.tsx`,
`apps/planner/src/app/App.tsx`, `packages/api-client/src/index.ts`.

**Tests:**

- Neu: `tests/test_numbering.py` (9), `tests/test_customers.py` (30),
  `tests/test_projects.py` (29), `tests/test_project_files.py` (8).
- Erweitert: `tests/test_tenant_isolation.py` um Kunden, Projekte, Gebäude und Geschosse
  — inklusive des Nachweises, dass PostgreSQL einen mandantenübergreifenden
  Projekt-Kunde-Verweis selbst ablehnt (`IntegrityError`). Der Routen-Sweep deckt die
  vier neuen Pfadparameter ab.
- Angepasst: `tests/test_architecture.py` (Tabellenzahl 13 → 17).
- Frontend: `ProjectTabs.test.tsx` (2), `modules/platform/index.test.ts` (4),
  `client.types.test.ts` um Compile-Zeit-Prüfungen der neuen Endpunkte erweitert.
- Vollständiger Durchlauf gegen PostgreSQL 17 und MinIO: **273 Backend-Tests bestanden,
  0 übersprungen** (4:39), **54 Frontend-Tests**. Zusätzlich grün: Ruff, mypy `--strict`
  (72 Dateien), `import-linter` (4 Contracts), Modul- und Datenbankgrenzen,
  Frontend-Grenzprüfung, `uv lock --check`, genau ein Alembic-Head, OpenAPI-Drift-Check,
  Frontend-Typecheck, ESLint und Build.

**Ergebnis:**
Alle drei Exit-Kriterien von Phase 2 sind erfüllt und im laufenden System nachgewiesen:
Projekt mit Kunde, Gebäude und drei Geschossen angelegt; Plan-PDF hochgeladen, über die
signierte Adresse geladen und byteweise verglichen; Projektliste nach Status, Kunde und
Freitext gefiltert.

**Offene Punkte:**

- Die Listenansichten zeigen bis zu 50 bzw. 200 Einträge und weisen auf weitere hin; eine
  Blätter-Bedienung in der Oberfläche fehlt noch (die API kann es bereits).
- Von den zwölf DSGVO-Voraussetzungen ist mit dieser Phase Punkt 5 (Löschung/
  Anonymisierung) umgesetzt und Punkt 2 (Datenminimierung) dokumentiert. Auskunft/Export,
  Verarbeitungsverzeichnis, TOM-Dokumentation, AV-Verträge und die Restore-Regel fehlen
  weiterhin.
- Ein Cleanup-Werkzeug für verwaiste Storage-Objekte gibt es weiterhin nicht (war nicht
  Teil des Auftrags).
- Der vollständige Backend-Testlauf dauert rund vier Minuten, weil
  `tests/test_ports_typing.py` mypy je Fixture als Subprozess startet. Das ist kein
  Hänger, fällt aber auf; als technische Schuld notiert.

**Nächster sinnvoller Schritt:**
Phase 3 — Electrical Room Model. **Nicht ohne ausdrückliche Freigabe beginnen.**

---

## Task 0008 – Phase 2.1: Nebenläufigkeit und Zustandskonsistenz

**Datum:** 2026-09-19

**Ziel:**
Vier Parallelitäts- und Zustandsprobleme aus Phase 2 schließen, bevor Phase 2 endgültig
freigegeben wird. Kein Electrical-Modul, keine neue Phase, kein Commit. Weiterhin
ausschließlich synthetische Testdaten.

**Durchgeführte Änderungen:**

1. **`StaleDataError` → `409`.** Neues Modul `app/core/persistence.py` übersetzt die
   beiden erwarteten Datenbankkonflikte in fachliche Fehler und rollt dabei die Session
   zurück. `flush(session)` ersetzt `session.flush()` in allen Schreibpfaden der
   versionierten Entitäten — damit ist der Konflikt schon im Service ein
   `VersionConflictError` und nicht erst in der HTTP-Schicht. Zusätzlich ein zentraler
   FastAPI-Handler als Netz für Konflikte, die erst beim Commit auffallen. Kein
   `try/except` in den Endpunkten.
2. **Session-Grenze.** `get_session` rollt bei einer Ausnahme ausdrücklich zurück,
   bevor es schließt. Der Exception-Handler läuft erst danach (FastAPI schließt den
   Dependency-Stack innerhalb der `ExceptionMiddleware`) und fasst die Session nicht an
   — eine Session im Fehlerzustand darf nicht weiterverwendet werden.
3. **Sperrreihenfolge Kunde → Projekt.** `CustomerService.get_for_update()` lädt die
   Kundenzeile mit `SELECT … FOR UPDATE`. Ausblenden, Anonymisieren, Projektanlage und
   Projekt-Neuzuordnung sperren dieselbe Zeile **vor** jedem Projektzugriff. Damit ist
   die Reihenfolge auf allen Seiten gleich und ein Deadlock ausgeschlossen. Der
   Löschendpunkt hält Sperre, Projektzählung und Änderung jetzt in einer Transaktion;
   `soft_delete` nimmt den bereits gesperrten Datensatz entgegen statt einer ID.
4. **Anonymisierte Kunden gesperrt für neue Zuordnungen.** `_require_customer` wurde zu
   `_lock_customer`: `organization_id` + ID + `deleted_at IS NULL` +
   `anonymized_at IS NULL` + `FOR UPDATE`. Bestehende Projekte behalten ihre Referenz.
5. **Parallele Geschosseindeutigkeit.** `_flush_floor()` übersetzt ausschließlich die
   namentlich erwartete Constraint `uq_floors_building_id_level` in dieselbe
   `422`-Meldung wie die Vorabprüfung. Jeder andere `IntegrityError` bleibt unerwartet.
   Greift bei Anlage **und** beim Verschieben.
6. **Strikte `If-Match`-Syntax.** Regex statt `strip('"')`: akzeptiert `3` und `"3"`,
   lehnt `W/"3"`, unpaarige und doppelte Anführungszeichen, Listen, `*`, `0`, negative
   Werte, Nachkommastellen und führende Nullen ab. Die Meldung spiegelt den Rohwert
   nicht zurück.
7. **`archived` geklärt — ohne stille Fachentscheidung.** Masterplanunterlagen,
   Roadmap, API-Dokumentation und Oberfläche legen **nirgends** fest, dass ein
   archiviertes Projekt schreibgeschützt ist. Das Verhalten wurde deshalb **nicht**
   geändert; stattdessen ist der Ist-Zustand dokumentiert, durch zwei Tests
   festgehalten und in der Oberfläche ausdrücklich benannt. Die Entscheidung über
   vollständige Unveränderlichkeit bleibt offen und steht vor Phase 3 an.

**Betroffene Module:** ausschließlich `core` (persistence, customers, projects,
preconditions, errors, db/session). Kein Shared- oder Fachmodul, keine Vorgriffe auf
Phase 3.

**Betroffene wichtige Dateien:**
`app/core/persistence.py` (neu), `app/core/preconditions.py`, `app/errors.py`,
`app/db/session.py`, `app/core/customers/{service,api}.py`,
`app/core/projects/service.py`, `tests/test_concurrency.py` (neu),
`tests/test_preconditions.py` (neu), `tests/test_projects.py`,
`tests/test_api_contract.py`, `apps/planner/src/modules/platform/ProjectDetailPage.tsx`.

**Tests:**

- `tests/test_concurrency.py`: 15 Tests, zwei getrennte Sessions in zwei Threads mit
  expliziten Barrieren gegen PostgreSQL. Geprüft wird jeweils der **Datenbankzustand**,
  nicht nur die Rückgabe. Der Versionskonflikttest ist nicht zeitabhängig: Beide Seiten
  laden den Datensatz vor der Barriere, das erneute Lesen trifft die Identity Map, der
  Konflikt fällt zwingend erst beim Schreiben auf — belegt durch die Meldung des
  Verlierers. Für die Geschossebene sichert ein zusätzlicher, threadfreier Test den
  Index-Pfad deterministisch ab.
- `tests/test_preconditions.py`: 35 parametrisierte Fälle der `If-Match`-Syntax.
- Gesamtlauf: **336 Backend-Tests bestanden, 0 übersprungen**; 54 Frontend-Tests.
  `.\tasks.ps1 check` vollständig grün.

**Ergebnis:**
Die vier Rennen sind geschlossen und nachgewiesen. Es gibt keine Migration — das Schema
blieb unverändert, weil die Invarianten mit Transaktionsgrenzen und Zeilensperren
gehalten werden und nicht mit Triggern.

**Offene Punkte:**

- ~~**Fachliche Entscheidung vor Phase 3:** Soll ein archiviertes Projekt vollständig
  unveränderlich sein?~~ **Erledigt durch Task 0009:** Ja — `archived` ist Endzustand
  und vollständiger Schreibschutz.
- Die Sperre serialisiert Projektanlagen je Kunde. Für den geplanten Einsatz
  unkritisch; bei sehr vielen gleichzeitigen Anlagen an einem Kunden wäre es messbar.
- Die offenen DSGVO-Punkte aus Task 0007 bleiben unverändert offen.

**Nächster sinnvoller Schritt:**
Phase 3 — Electrical Room Model. **Nicht ohne ausdrückliche Freigabe beginnen.**

---

## Task 0009 – Phase 2.2: Schreibschutz für archivierte Projekte

**Datum:** 2026-09-19

**Ziel:**
Die aus Phase 2.1 offene fachliche Entscheidung **T0** umsetzen und eine beim
Durchklicken gefundene Sackgasse in der Kundenauswahl schließen. Kein Electrical-Modul,
keine neue Phase.

**Fachliche Entscheidung (vom Auftraggeber getroffen):**
Ein Projekt im Zustand `archived` ist **vollständig schreibgeschützt**. Lesen und das
Herunterladen bestehender Dateien bleiben erlaubt; Änderungen an Projekt, Gebäuden,
Geschossen und Dateien sowie neue Uploads werden abgelehnt. Eine Wiederherstellung wäre
ein eigener administrativer Vorgang und ist nicht Teil dieser Aufgabe.

**Durchgeführte Änderungen:**

1. **Eine zentrale Service-Vorbedingung** `_require_writable(project)` in
   `app/core/projects/service.py`. Sie wird von allen schreibenden Pfaden aufgerufen;
   für Gebäude und Geschosse lösen `_writable_building()` und `_writable_floor()` die
   Eigentümerkette bis zum Projekt auf. Keine verstreute Statusprüfung je Endpunkt.
2. **Öffentliches `get_writable()`**, damit auch der Datei-Upload
   (`app/core/files/api.py`) dieselbe Vorbedingung nutzt, statt die Regel zu wiederholen.
3. **Eigener Fehlertyp** `ProjectArchivedError` → `409` mit
   `type: …/project-archived`. Clients können den Fall von einem gewöhnlichen Konflikt
   unterscheiden, ohne die Meldung auszuwerten.
4. **Eine bewusste Ausnahme:** `DELETE /projects/{id}` (Soft Delete) bleibt möglich.
   Ohne sie ließe sich ein Kunde mit archiviertem Projekt nie mehr ausblenden — die
   Kundenlöschung zählt offene Projekte. Die Ausnahme ist im Code und in `docs/api.md`
   begründet.
5. **Oberfläche spiegelt den Schreibschutz:** Der Hinweis auf der Projektseite nennt ihn
   jetzt korrekt; Stammdaten-Formular, Gebäude- und Geschossformulare sowie der
   Datei-Upload sind bei einem archivierten Projekt gesperrt. Download und Dateiliste
   bleiben sichtbar.
6. **Kundenauswahl gefiltert.** `zuordenbareKunden()` lässt anonymisierte Kunden aus der
   Auswahl beim Anlegen eines Projekts weg. Der Server lehnt sie mit `404` ab; die
   Oberfläche bot bis dahin eine Sackgasse an.

**Betroffene Module:** ausschließlich `core` und das Planner-Modul `platform`.

**Betroffene wichtige Dateien:**
`app/core/projects/service.py`, `app/core/projects/api.py`, `app/core/files/api.py`,
`app/errors.py`, `tests/test_projects.py`, `tests/test_project_files.py`,
`apps/planner/src/modules/platform/{ProjectDetailPage,ProjectMasterDataTab,ProjectStructureTab,ProjectFilesTab,ProjectsPage}.tsx`,
`apps/planner/src/modules/platform/auswahl.ts` (neu).

**Tests:**

- `test_archiviertes_projekt_bleibt_fachlich_bearbeitbar` wurde **ersetzt**. Der Test
  hielt bewusst den Ist-Zustand fest, solange die Entscheidung offen war — genau dafür
  war er da. An seine Stelle treten drei Tests: vollständiger Schreibschutz über alle
  sieben schreibenden Unterressourcen, uneingeschränkte Lesbarkeit und die dokumentierte
  Ausnahme beim Ausblenden (inklusive des Nachweises, dass der Kunde danach ausgeblendet
  werden kann).
- Dateien: Upload auf ein archiviertes Projekt → `409 project-archived`; eine bestehende
  Datei bleibt auflistbar und über die signierte Adresse herunterladbar, Inhalt
  byteweise verglichen.
- Frontend: `auswahl.test.ts` mit drei Fällen.
- Gesamtlauf: **340 Backend-Tests bestanden, 0 übersprungen**; 57 Frontend-Tests.
  `.\tasks.ps1 check` vollständig grün. Keine Migration — das Schema blieb unverändert.

**Ergebnis:**
T0 ist entschieden und umgesetzt. Die Liste der offenen fachlichen Entscheidungen in
`docs/current-status.md` ist um diesen Punkt kürzer.

**Offene Punkte:**

- Eine **Wiederherstellung** archivierter Projekte gibt es nicht. Sobald sie gebraucht
  wird, braucht sie einen eigenen Endpunkt, eine eigene Berechtigung und einen
  Audit-Eintrag — das ist eine neue Aufgabe, keine Erweiterung dieser.
- Die offenen DSGVO-Punkte und die übrigen Einträge aus Task 0007/0008 bleiben
  unverändert.

**Nächster sinnvoller Schritt:**
Phase 3 — Electrical Room Model. **Nicht ohne ausdrückliche Freigabe beginnen.**

---

## Task 0010 – Phase 2.3: Workflow- und UX-Nacharbeit

**Datum:** 2026-09-19

**Ziel:**
Die vorhandene Kunden- und Projektverwaltung im täglichen Betrieb schnell und
verständlich bedienbar machen — ohne Datenmodell, Architektur oder Migration
anzufassen. Kein Electrical-Modul, keine Phase 3.

**Durchgeführte Änderungen:**

1. **Kundenanlage im Dialog.** Knopf „Neuer Kunde" **oberhalb** der Liste; das Formular
   steht nicht mehr dauerhaft darunter. Gewählte Variante: natives `<dialog>` mit
   `showModal()`. Es bringt Fokusfalle, Escape, Backdrop und die Rolle `dialog` mit —
   eine Bibliothek hätte nur wiederholt, was der Browser kann. Auf schmalen
   Bildschirmen füllt der Dialog per CSS die Fläche; eine eigene Vollbildvariante war
   dafür nicht nötig.
2. **Projektanlage nach demselben Muster**, mit Kundenauswahl, deutschen Pflichtfeld-
   und Fehlermeldungen. Nach Erfolg wird die Liste aktualisiert und das neue Projekt
   geöffnet.
3. **Startstruktur.** Im Projektdialog ist „Gebäude und Geschoss gleich mit anlegen"
   vorausgewählt (`Hauptgebäude`, `Erdgeschoss`, Ebene 0, 2500 mm), beide Namen sind
   änderbar, und für Serviceaufträge lässt sich die Struktur abwählen.
   *Entscheidung:* umgesetzt als **Folgeablauf** aus den drei vorhandenen Endpunkten,
   nicht atomar. Eine atomare Anlage hätte einen neuen, geschachtelten Endpunkt samt
   eigener Transaktionsklammer gebraucht — eine API-Änderung für eine reine
   Bedienerleichterung. Ein Teilfehler bleibt nicht unbemerkt: Das Projekt ist angelegt,
   die Meldung benennt, was fehlt, und die Oberfläche bleibt auf der Liste stehen
   (siehe die Korrektur in Task 0011).
4. **Projektdetail vereinfacht.** Gebäude und Geschosse erscheinen als ruhige
   Übersicht; Anlegen, Umbenennen und Löschen liegen darunter im ausklappbaren Bereich
   „Gebäudestruktur verwalten". Bestehende Projekte werden nicht angefasst.
5. **Cursor-Bedienung.** Neuer gemeinsamer Baustein `useCursorListe` für Kunden- und
   Projektliste: „Weitere laden", Entdopplung über die ID, Lade-, Leer- und
   Fehlerzustand, gesperrte Knöpfe während laufender Anfragen. Das Zurücksetzen bei
   Such- und Filteränderung steckt im Query-Key — eine zweite Wahrheit von Hand wäre
   irgendwann abgewichen. Bewusst keine Seitenzahlen (die API kennt keine) und kein
   Infinite Scrolling.
6. **Gemeinsame UI-Bausteine.** `Feld`, `Auswahl`, `Schalter`, `Dialog` und
   `WeitereLaden` liegen in `src/core/ui/`, `useCursorListe` und `eintraegeAus` in
   `src/core/api/`, die Projektstatusnamen in `modules/platform/status.ts`. Damit ist
   die dokumentierte technische Schuld abgetragen: Keine Seite exportiert mehr
   Bausteine für eine andere Seite. Keine Sammelablage `utils`.
7. **Fehlerübersetzung** (`modules/platform/fehler.ts`): Die englischen Pydantic-Codes
   werden auf kurze deutsche Sätze abgebildet, mit verständlicher Rückfallmeldung.
   Eingaben bleiben bei jedem Fehler erhalten.

**Zu Punkt 6 des Auftrags (Schreibschutz archivierter Projekte):** Das war bereits
Task 0009 (Phase 2.2) und ist unverändert in Kraft — zentrale Service-Vorbedingung,
`409 project-archived`, serverseitig durchgesetzt. Ergänzt wurde nur ein Test für den
**Kundenwechsel** an einem archivierten Projekt sowie die Frontend-Tests für die
ausgeblendeten Aktionen.

**Zu Punkt 7 (Nebenläufigkeit):** Am Backend wurde außer dem einen neuen Test nichts
geändert. `If-Match`, `428`, `409`, die Zeilensperren und alle Parallelitätstests aus
Phase 2.1 bleiben unverändert.

**Betroffene Module:** Planner (`core/ui`, `core/api`, Modul `platform`); im Backend nur
ein zusätzlicher Test.

**Betroffene wichtige Dateien:**
Neu: `core/ui/{Dialog,Feld,WeitereLaden}.tsx`, `core/api/{seiten,useCursorListe}.ts`,
`modules/platform/{CustomerFormDialog,ProjectFormDialog}.tsx`,
`modules/platform/{status,fehler}.ts` und sechs Testdateien.
Geändert: `modules/platform/{CustomersPage,ProjectsPage,ProjectStructureTab,ProjectDetailPage,CustomerDetailPage,ProjectMasterDataTab}.tsx`,
`src/styles.css`, `tests/test_projects.py`.

**Tests:**

- Gezielt während der Arbeit: die sechs neuen Frontend-Testdateien einzeln, dann der
  betroffene Backend-Testlauf.
- Ein vollständiger Abnahmelauf am Ende: `.	asks.ps1 check`, Exit 0 —
  **341 Backend-Tests, 0 übersprungen** (4:22), **110 Frontend-Tests** (13 Dateien),
  dazu Ruff, mypy `--strict`, Modulgrenzen, ein Alembic-Head, OpenAPI-Drift,
  Frontend-Typecheck, ESLint und Build.
- Browser-Smoke-Test über alle neun geforderten Schritte; die beiden dabei gefundenen
  Fehler sind oben beschrieben und behoben.

**Ergebnis:**
Die Bedienung folgt jetzt dem Alltagsablauf, ohne dass Datenmodell, API-Verträge oder
Nebenläufigkeitsgarantien angefasst wurden. Keine Migration.

**Zwei Funde aus dem Browser-Smoke-Test, beide behoben:**

1. Bei einem **Teilfehler der Startstruktur** wäre die Warnung verlorengegangen: Die
   Oberfläche sprang sofort ins Projekt, der Hinweis lebte aber auf der Projektliste.
   Jetzt wird nur bei vollständigem Erfolg gesprungen; bleibt etwas offen, bleibt die
   Meldung als Fehlerhinweis stehen. Genau das verlangt der Auftrag.
2. Der **Planner-Container hatte `packages/api-client` nur aus dem Image**. Dadurch lief
   der Dev-Server gegen eine Fassung ohne `ifMatch`, und jeder Statuswechsel scheiterte
   mit `428`. Ursache lag in `docker-compose.yml` und stammt aus Phase 1 — sie fiel erst
   auf, seit die Oberfläche `If-Match` benutzt. Das Quellverzeichnis ist jetzt wie das
   des Planners eingebunden.

**Offene Punkte:**

- Die **Kundenbearbeitung** nutzt weiterhin das Formular auf der Detailseite. Der
  Dialogbaustein ist für beide Fälle ausgelegt (`startwerte`, `absendenLabel`), die
  Umstellung der Detailseite ist aber nicht Teil dieses Auftrags.
- Die Suche feuert bei jedem Tastendruck eine Abfrage. Bei den erwarteten Datenmengen
  unkritisch. *Nachtrag Task 0011:* Für die Kundenauswahl im Projektdialog ist das
  erledigt (300 ms Entprellung); die Kunden- und Projektliste selbst sucht weiterhin
  ungebremst.
- **Projektarten** (Neubau, Sanierung, Service) sind bewusst **nicht** implementiert —
  dafür liegt keine fachliche Entscheidung vor. Die abwählbare Startstruktur deckt den
  Serviceauftrag vorerst ab.
- Eine Wiederherstellung archivierter Projekte gibt es weiterhin nicht.

**Nächster sinnvoller Schritt:**
Phase 3 — Electrical Room Model. **Nicht ohne ausdrückliche Freigabe beginnen.**

---

## Task 0012 – Phase 3: Electrical Room Model

**Datum:** 2026-09-26

**Ziel:**
Das erste echte Fachmodul einführen: `electrical` mit Räumen, Wänden und Öffnungen auf
einem bestehenden Geschoss, samt serverseitiger Geometrieprüfung. Ohne Editor, ohne
Canvas, ohne Elektrobauteile. Der eigentliche Prüfstein war die **Architektur**: Ein
Fachmodul muss sich an den Core hängen können, ohne ihn zu verbiegen.

**Durchgeführte Änderungen:**

1. **Fachmodell `Geschoss → Raum → Wand → Öffnung`** in drei Tabellen mit Präfix
   `electrical_`. Ein Raum gehört zu genau einem Geschoss, eine Wand zu genau einem Raum,
   eine Öffnung zu genau einer Wand. Alle Verweise laufen über zusammengesetzte
   Fremdschlüssel `(organization_id, <ref>_id)`.
2. **Geometriemodell entschieden und dokumentiert**
   ([ADR 0013](decisions/0013-room-contour-as-ordered-wall-segments.md)): Die Raumkontur
   **sind** die geordneten Wandsegmente. Kein Polygonfeld, keine gespeicherte Fläche, kein
   gespeicherter Konturzustand, kein `project_id` am Raum — alles vier wäre eine zweite
   Wahrheit. Die Entwurfsfassung aus Phase 0 ist damit ausdrücklich überholt; die
   Abweichungen sind im ADR einzeln benannt.
3. **Reine, ganzzahlige Geometrie** in `geometry.py` — ohne Datenbank, ohne Framework,
   ohne Fließkomma. Längen über `(isqrt(4n)+1)//2` (kaufmännisch gerundet), Flächen über
   die doppelte Gauß-Trapezfläche. Jeder Vergleich läuft gegen den gerundeten Wert, damit
   Backend, Tests und späterer Editor dasselbe Ergebnis erhalten.
4. **Zwei Prüfstufen.** Jeder Schreibvorgang prüft die Entwurfsregeln (nicht entartet,
   Bereiche, keine Dublette, keine Überschneidung); der Konturschluss wird nur im
   Prüfbericht `GET …/rooms/{id}/contour` verlangt. Ein Raum darf zwischendurch eine offene
   Kontur haben — das ist der normale Erfassungszustand und kein Fehler.
5. **15 Endpunkte** unter `/api/v1/modules/electrical`, `If-Match` Pflicht bei jeder
   Änderung. Beim Umordnen der Wände trägt `If-Match` die Version des **Raums**; die
   Reihenfolge wird als vollständige Permutation gesetzt.
6. **Ein Event**: `electrical.plan.updated` mit `change_kind`, über die Unit of Work nach
   dem Commit zugestellt. Keine personenbezogenen Daten in der Nutzlast, kein Handler in
   Phase 3 — der Nutzen ist heute die Nachvollziehbarkeit im Ereignisprotokoll.
7. **Zwei Berechtigungen**: `electrical.plan.read` und `electrical.plan.write`. Der
   Administrator erhält über den Seed jede registrierte Berechtigung; weitere Systemrollen
   über das neue Feld `PermissionDef.default_roles`. Der Core kennt dabei keine
   Modulschlüssel — er liest sie aus der Registry.
8. **Veröffentlichte Core-Oberfläche.** Neu ist `CORE_PUBLIC_SURFACE` in
   `boundaries.py`: eine Positivliste der Core-Namen, die ein Modul importieren darf.
   Alles andere im Core — `models`, `service`, `schemas`, `storage`, `seed`, `registry` —
   ist ab jetzt statisch verboten. Die bestehende Regel „jeder Import auf ein fremdes
   Modul ist verboten" bleibt unverändert.
9. **Erweiterungspunkt `app/core/projects/planning.py`**: die einzige Stelle, an der ein
   Fachmodul erfährt, ob ein Geschoss zu seinem Mandanten gehört, zu welchem Projekt es
   gehört und ob darunter geschrieben werden darf. Liefert einen unveränderlichen
   Wertetyp, kein ORM-Objekt. Die Archivregel wird nicht wiederholt, sondern von
   `ProjectService.get_writable` übernommen.
10. **Nebenläufigkeit über eine Zeilensperre auf dem Raum.** Jede Änderung an Kontur,
    Öffnungen oder Raumhöhe nimmt `SELECT … FOR UPDATE` auf die Raumzeile. Ohne diese
    Sperre könnten zwei gleichzeitige Anfragen jede für sich gültig sein und gemeinsam
    eine ungültige Kontur erzeugen.
11. **Löschregeln ausdrücklich entschieden:** Raum löschen nimmt Wände und Öffnungen mit
    (`CASCADE`); eine **einzelne** Wand mit Öffnungen lässt sich nicht löschen (`409`);
    ein Geschoss oder Gebäude mit Planungsdaten lässt sich nicht löschen (`409` statt
    vorher `500` — der Fremdschlüsselkonflikt wird zentral übersetzt).
12. **Oberfläche**: Projekt-Tab „Räume & Grundriss", registriert über den vorhandenen
    Beitragspunkt `project.tabs`. **Die zentrale Projektseite wurde nicht angefasst.**
    Geschossauswahl, Raumliste mit Konturzustand und Fläche, Dialoge für Raum, Wand und
    Öffnung, Wandtabelle mit Reihenfolge und Länge, Öffnungen je Wand, Konturbericht mit
    Einzelbefunden im Klartext, sichtbarer Schreibschutz bei archivierten Projekten.
13. **`fehler.ts` ist in den Core gezogen** (`src/core/api/fehler.ts`): Mit der
    Elektroplanung hat der Fehlerübersetzer einen zweiten Consumer, und ein Modul darf die
    Dateien eines anderen Moduls nicht importieren.
14. **`reject_explicit_null` ist nach `app/core/validation.py` gezogen** — aus demselben
    Grund: Das Schema eines Fachmoduls darf die Schemadatei eines Core-Fachbereichs nicht
    importieren.

**Betroffene Module:**
`electrical` (neu), `core` (vier kleine, fachneutrale Erweiterungen: Erweiterungspunkt
für Planungsdaten, Fremdschlüsselübersetzung, `default_roles`, gemeinsame Validatoren),
Planner-Frontend.

**Betroffene wichtige Dateien:**

- `apps/backend/app/modules/electrical/` — `geometry.py`, `models.py`, `schemas.py`,
  `service.py`, `api.py`, `events.py`, `permissions.py`, `module.py`, `__init__.py`
- `apps/backend/app/core/projects/planning.py` (neu), `app/core/validation.py` (neu)
- `apps/backend/app/core/module_registry/boundaries.py` (`CORE_PUBLIC_SURFACE`)
- `apps/backend/app/core/persistence.py` (`foreign_key_violation_translated`)
- `apps/backend/app/core/authorization/service.py`, `app/core/module_registry/descriptor.py`
- `apps/backend/migrations/versions/0004_electrical_room_model.py`
- `apps/planner/src/modules/electrical/` — `index.ts`, `RoomsTab.tsx`, `RaumDetail.tsx`,
  drei Dialoge, `texte.ts`
- `apps/planner/src/core/api/fehler.ts` (verschoben)

**Tests:**

- **Backend 552** (Phase 2.4: 341), 0 übersprungen, gegen echtes PostgreSQL 17:
  `test_electrical_geometry.py` (58, ohne Datenbank), `test_electrical_rooms.py` (76),
  `test_electrical_module.py` (34), `test_electrical_concurrency.py` (6 mit zwei Threads,
  zwei Sessions und Barriere), dazu erweiterte Mandanten-, Architektur- und
  Grenztests.
- **Frontend 163** (Phase 2.4: 129): Modulregistrierung (9), Oberfläche (25).
- Vollständiger `tasks.ps1 check` und ein Browser-Smoke-Test im laufenden
  Compose-System.

**Ergebnis:**
Phase 3 ist abgeschlossen. Die drei Exit-Kriterien sind erfüllt (siehe
`docs/roadmap.md`); der Wortlaut „Polygon" ist durch die Kontur aus Wandsegmenten
ersetzt, dokumentiert in ADR 0013.

**Offene Punkte:**

- Räume tragen noch **keinen Raumtyp** (`living`, `kitchen`, …). Er wird erst mit den
  Ausstattungsvorlagen gebraucht.
- Wände tragen **keine eigene Höhe** und keinen Wandtyp. Solange die Raumhöhe gilt, ist
  beides unnötig; eine Kniestockwand wäre der erste echte Bedarf.
- Der Konturbericht berechnet Fläche und Umfang bei jedem Lesen. Messbar langsam ist das
  bei diesen Datenmengen nicht.
- Es gibt **keine textuelle oder grafische Konturvorschau** über die Wandtabelle hinaus —
  bewusst, der Editor kommt in Phase 4a.
- Zu Phase 2.4 (**Task 0011**) fehlt in dieser Datei ein eigener Eintrag;
  `docs/current-status.md` verweist darauf. Der Verweis ist damit ins Leere gerichtet.
  Nicht in Phase 3 nachgetragen, weil die Einzelheiten dieses Auftrags hier nicht
  belegbar sind.

**Nächster sinnvoller Schritt:**
Phase 4a — 2D-Editor. **Nicht ohne ausdrückliche Freigabe beginnen.**

---

## Task 0013 – Phase 3.1: Projektweiter Schreibschutz unter Nebenläufigkeit

**Datum:** 2026-09-26

**Ziel:**
Eine Nebenläufigkeitslücke schließen, die eine unabhängige Kontrolle nach Phase 3
gefunden hat: Electrical-Schreibvorgänge sperrten die **Raumzeile** und lasen den
Projektstatus danach **ohne Sperre**. Eine Änderung konnte das Projekt als aktiv lesen,
während eine andere Transaktion es archivierte — und anschließend unter dem bereits
archivierten Projekt committen. Verbindlich ist: Sobald ein Projekt archiviert ist,
committet keine Änderung an ihm oder an einer Unterressource mehr, auch nicht unter echter
Parallelität.

**Durchgeführte Änderungen:**

1. **Das Projekt ist die Sperrwurzel.** Neu im Core: `ProjectService.lock_project`
   (sperrt die Projektzeile mit `SELECT … FOR UPDATE` und liest sie neu) und
   `ProjectService.lock_writable` (sperrt und prüft den Schreibschutz). Letztere ist die
   **eine** Stelle, an der der Archivschutz entschieden wird; das frühere `get_writable`
   ist darin aufgegangen.
2. **Der Statuswechsel ist kein Sonderweg mehr.** `change_status` und `soft_delete`
   sperren dieselbe Projektzeile wie jeder fachliche Schreibvorgang. Die Archivierung
   reiht sich damit in dieselbe Warteschlange ein.
3. **Verbindliche Sperrreihenfolge `Projekt → (Kunde) → Unterressource`.**
   `_writable_building` und `_writable_floor` lösen die Unterressource ungesperrt auf und
   sperren dann das Projekt; `create_building` und `create_floor` sperren das Projekt,
   bevor die Unterressource entsteht.
4. **`ElectricalRoomService._locked_room` umgebaut** — vorher Raum → Projekt, jetzt in
   drei Schritten: Raum mandantensicher auflösen (ohne Sperre) → Projektzeile über den
   öffentlichen Planning-Contract sperren und Schreibschutz prüfen → erst danach die
   Raumzeile sperren. Zusätzlich prüft der Service, dass sich die Geschosszuordnung
   dazwischen nicht geändert hat, und hält die Annahme der unveränderlichen Kette
   `Raum → Geschoss → Gebäude → Projekt` mit einem Test fest.
5. **`FloorPlanningAccess.writable_context` sperrt jetzt** und ist damit der öffentliche,
   fachneutrale Zugang zur Sperrwurzel. `context` bleibt die sperrfreie Variante fürs
   Lesen.
6. **Der Datei-Upload hält keine Sperre über die Übertragung.** Neu: die unverbindliche
   Vorprüfung `require_writable_unlocked` (frühe Absage, bevor Bytes bewegt werden) und
   `FileService.finalize(record, before_commit=…)`. Die verbindliche Prüfung sperrt die
   Projektzeile erst unmittelbar vor dem Commit; scheitert sie, wird zurückgerollt und das
   bereits geladene Objekt verworfen.
7. **`CORE_PUBLIC_SURFACE` präzisiert**: `app.db` → `app.db.base`, `app.db.mixins`,
   `app.db.session`; `app.core.events` → `app.core.events.bus`, `app.core.events.uow`.
   Damit ist `app.core.events.models` (Tabelle `domain_events`) für Module nicht mehr
   erreichbar, und keine künftige Datei unter `app.db` wird unbemerkt mitfreigegeben.
   `app.contracts` bleibt als Ganzes offen — der Ordner **ist** der Modulvertrag (ADR 0009).

**Betroffene Module:**
`core` (Projekte, Dateien, Grenzprüfung), `electrical` (Sperrreihenfolge). Keine Migration,
keine API-Änderung, kein neuer Fehlertyp, keine neue Abhängigkeit.

**Betroffene wichtige Dateien:**

- `apps/backend/app/core/projects/service.py` — `lock_project`, `lock_writable`,
  `require_writable_unlocked`, gesperrte Statuswechsel
- `apps/backend/app/core/projects/planning.py` — sperrender Planning-Contract
- `apps/backend/app/core/files/service.py`, `app/core/files/api.py` — Prüfung vor dem
  Commit statt vor dem Upload
- `apps/backend/app/modules/electrical/service.py` — `_locked_room` in drei Schritten
- `apps/backend/app/core/module_registry/boundaries.py` — präzisierte Oberfläche
- `apps/backend/tests/test_archive_concurrency.py` (neu)

**Tests:**

- **Neu: `tests/test_archive_concurrency.py` (18 Tests)** mit zwei Threads, zwei Sessions,
  Ereignissen als Synchronisationspunkten und Prüfung des Datenbankzustands. Sieben
  Schreibwege — Raum anlegen, Wand ändern, Öffnung anlegen, Gebäude anlegen, Geschoss
  anlegen, Projektstammdaten ändern, Dateizuordnung — jeweils in **beiden** Richtungen,
  dazu Sperrreihenfolge am mitgeschriebenen SQL, Deadlockfreiheit gegenläufiger
  Unterressourcen, zwei gleichzeitige Archivierungen und die Unveränderlichkeit der Kette.
- **Nachweis, dass die Tests ohne die Sperre fehlschlagen:** Mit vorübergehend entfernter
  `FOR UPDATE`-Sperre fallen **8** Tests um (alle sieben Schreibwege in Richtung 1 plus
  der Reihenfolgetest). Die Änderung wurde danach zurückgenommen.
- **Ehrlicher Zusatzbefund:** `populate_existing` ist neben `with_for_update()` **nicht**
  wirksamkeitsentscheidend — SQLAlchemy ersetzt geladene Attribute bei sperrenden Abfragen
  ohnehin. Ohne die Option bleiben alle 18 Tests grün. Sie steht trotzdem im Code, weil
  die Abhängigkeit sichtbar sein soll; der Kommentar behauptet nichts anderes mehr.
- **Neu bei den Grenztests:** erlaubte konkrete Imports (`app.db.base`,
  `app.core.events.uow`, …), synthetische Verstöße unter `app.db` und `app.core.events`,
  und die Zusicherung, dass die Positivliste kein ganzes Paket freigibt (außer
  `app.contracts`).
- Gezielt nachgeprüft: `test_concurrency.py`, `test_projects.py`, `test_project_files.py`,
  `test_file_upload.py`, `test_electrical_*`, `test_module_boundaries.py`,
  `test_tenant_isolation.py` — 311 Tests grün.
- Vollständiger `tasks.ps1 check` und ein kurzer Smoke-Test (bearbeiten, dann archivieren).

**Ergebnis:**
Die Invariante gilt jetzt auch unter echter Parallelität, mit genau zwei serialisierbaren
Ausgängen. Der Fehlervertrag bleibt `409 project-archived`; `If-Match` und die
Versionskonfliktregeln sind unverändert.

**Offene Punkte:**

- Die Sperre serialisiert **alle** Schreibvorgänge eines Projekts. Bei einem Projekt mit
  vielen gleichzeitigen Bearbeitern ist das eine bewusste Engstelle; sie ist im Baualltag
  (ein bis zwei Personen je Projekt) unkritisch und wurde nicht gemessen.
- Ein Upload kann nach vollständiger Übertragung noch mit `409` scheitern. Das ist der
  Preis dafür, die Sperre nicht über die Übertragung zu halten — dokumentiert in
  `docs/api.md`.
- Der Verzicht auf `populate_existing` wäre möglich; die Option bleibt als ausdrückliche
  Zusicherung stehen.

**Nächster sinnvoller Schritt:**
Commit von Phase 3 samt dieser Korrektur, danach Phase 4a — 2D-Editor.
**Nicht ohne ausdrückliche Freigabe beginnen.**

---

## Task 0014 – Phase 4a: Grafischer 2D-Editor

**Datum:** 2026-09-26

**Ziel:**
Aus dem formularbasierten Raummodell (Phase 3) einen alltagstauglichen grafischen
Grundrisseditor machen: Räume als Rechteck oder Polygon zeichnen, Konturen und Wände
bearbeiten, Türen, Fenster und Durchgänge platzieren, Raster und Fang, Maße, Zoom und
Pan, Undo/Redo, bewusstes und konfliktgeschütztes Speichern, verständliche
Validierungsrückmeldung. Exit-Kriterium: ein Einfamilienhausgeschoss mit 6–8 Räumen in
unter 20 Minuten, gemessen.

**Durchgeführte Änderungen:**

1. **Darstellungsentscheidung SVG** ohne Zusatzbibliothek, dokumentiert in
   [ADR 0014](decisions/0014-2d-editor-svg-and-atomic-contour.md). Kein Spike für Canvas
   nötig: Die Messung mit 200 Segmenten zeigt keinen Engpass.
2. **Backend, Fachmodul `electrical`:**
   * `GET /floors/{floor_id}/plan` — Planungsstand eines Geschosses in konstant sechs
     Abfragen; geschossbezogen statt projektweit (Begründung im ADR).
   * `PUT /rooms/{room_id}/contour` — atomares Ersetzen der Raumgeometrie (Wände samt
     Öffnungen, `removed_opening_ids`), Zielzustand als Ganzes geprüft, Projekt- vor
     Raumsperre, `If-Match` auf die Raumversion, genau ein Event `walls_changed`.
   * `POST /floors/{floor_id}/rooms` nimmt optional `walls` — Raum und Kontur in einer
     Transaktion (Rechteck- und Polygonwerkzeug).
   * **Raumversion = Version der Raumgeometrie**: Wand- und Öffnungsänderungen über die
     Einzelendpunkte zählen die Raumversion jetzt ebenfalls weiter. Ohne das hätte ein
     Editor mit altem Stand eine zwischenzeitliche Formularänderung überschreiben können.
   * **Neulesen nach der Sperre** bei Wand- und Öffnungsendpunkten (Befund des neuen
     Parallelitätstests Editor gegen Formular: vorher prüfte der Wartende gegen den
     veralteten Stand und meldete `422 walls-intersect` statt `409 version-conflict`;
     gespeichert wurde nie Falsches, aber die Begründung war irreführend).
3. **Core, fachneutral:** `ProblemFieldError.keys` (optionale Kennungen der betroffenen
   Objekte in `errors[]`); CORS erlaubt `PUT`; der API-Client-Wrapper kennt `put`.
   Frontend: `core/ui/ungespeichert.ts` (Warnung bei ungespeicherten Änderungen für
   `beforeunload`, interne Links, Projekt-Tabwechsel, Abmelden).
4. **Frontend, Modul `electrical/editor/`:** reine Funktionen für Geometrie-Spiegel,
   Viewport, Fang, Zeichen- und Bearbeitungswerkzeuge, Entwurf/API-Umwandlung,
   Fehlerauswertung; ein Reducer für den Editorzustand; SVG-Zeichenfläche,
   Werkzeugleiste, Eigenschaften-Seitenleiste, Steuerkomponente. Der Tab „Räume &
   Grundriss" hat zwei Ansichten — „Grafischer Editor" und „Tabellen & Details" — auf
   demselben Serverstand.
5. **Geometrieparität:** versionierte Fixture `testdata/geometry/raumgeometrie.v1.json`
   (Längen, Rechteck, L-Form, Halb-mm², offene Kontur, Lücke, Schleife, zurücklaufende
   Wand, zu kurze Wand, Öffnungen innen/außen/berührend/überlappend), geprüft von
   Backend **und** Frontend.
6. **Im Browser gefundene und behobene Bedienfehler** (vor dem Messlauf):
   * Hinweise und Fehlerboxen oberhalb der Zeichenfläche verschoben diese — Zeiger
     trafen danach andere Stellen. Hinweise liegen jetzt als klickdurchlässige
     Überlagerung in der Fläche, Serverrückmeldungen in der Seitenleiste, die
     Speicherleiste hat eine feste Höhe.
   * Der Namensdialog öffnete schon bei `pointerdown`; der `click` desselben Klicks traf
     den Dialog bzw. dessen Hintergrund und schloss ihn oder nahm dem Feld den Fokus.
     Zeichenwerkzeuge reagieren jetzt auf den abgeschlossenen Klick.
   * Tastenkürzel wurden bei fokussierter Checkbox („Fang") unterdrückt; die Ausnahme
     gilt jetzt nur für Text- und Auswahlfelder. `Strg+S` speichert auch aus Feldern.
   * Raumwechsel mit ungespeichertem Entwurf bot nur „verwerfen oder bleiben"; jetzt
     „speichern und wechseln" oder bleiben — nie stilles Verwerfen.
   * Eine veraltete Fehlermeldung blieb stehen, nachdem der Entwurf per Undo zum
     Serverstand zurückgekehrt war.

**Betroffene Module:**
`electrical` (Backend und Frontend), fachneutrale Ergänzungen im Core (Fehlerformat,
CORS, API-Client, Warnbaustein), Plattform-Projektseite (Tabwechsel fragt nach). Keine
Migration, keine neue Abhängigkeit, keine neue Berechtigung, kein neues Event.

**Betroffene wichtige Dateien:**

- `apps/backend/app/modules/electrical/service.py` — `floor_plan`, `replace_contour`,
  `_apply_contour`, Raumversion, Neulesen nach der Sperre
- `apps/backend/app/modules/electrical/api.py`, `schemas.py`, `geometry.py`
- `apps/backend/app/errors.py`, `app/main.py`
- `apps/planner/src/modules/electrical/editor/*` (neu), `RoomsTab.tsx`
- `apps/planner/src/core/ui/ungespeichert.ts` (neu), `modules/platform/ProjectDetailPage.tsx`,
  `app/Layout.tsx`, `styles.css`
- `packages/api-client/src/index.ts`, `generated.ts`
- `testdata/geometry/raumgeometrie.v1.json` (neu)
- `docs/decisions/0014-2d-editor-svg-and-atomic-contour.md` (neu)

**Tests:**

* **Neu Backend:** `test_electrical_editor_api.py` (29: Plan vollständig, Konturbefunde
  mit Wand-IDs, keine N+1-Abfragen bei 1 vs. 7 Räumen, 403 ohne Leserecht, 404;
  Konturspeichern mit Client-IDs, Ändern mit ID-Erhalt und Versionsverhalten je Wand,
  Reihenfolge, Hinzufügen/Entfernen, Zielzustand als Ganzes (Umlaufsinn umkehren),
  Öffnungen anlegen/ändern/ausdrücklich entfernen, Raum samt Kontur anlegen, ungültige
  Kontur legt keinen Raum an; Rollback bei Selbstüberschneidung, ungültig gewordener Tür,
  Überlappung, doppelter ID, Wand aus anderem Raum, Wandwechsel einer Öffnung, stiller
  Öffnungsverlust (409), fehlender Öffnung (422), veralteter Version, ungültigem
  `If-Match`; Formularänderung wird nicht überschrieben; 403 ohne Schreibrecht; genau ein
  Event bzw. keines),
  `test_electrical_editor_concurrency.py` (2: zwei gleichzeitige Editor-Speichervorgänge,
  Editor gegen Formular), `test_geometry_parity.py` (25), Tenant-Tests für Plan und
  fremde IDs (3), `kontur-speichern` als achter Schreibweg in beiden Richtungen der
  Archiv-Parallelitätstests, Sperrreihenfolge Projekt → Raum für das Konturspeichern,
  `PUT` in `428`-, Archiv- und Lesbarkeitslisten sowie im Tenant-Sweep.
* **Angepasst (nicht abgeschwächt):** Sechs Tests sendeten nach Wandänderungen fest
  Raumversion 1; sie lesen jetzt die aktuelle Version. Der Paralleltest „Höhenänderung
  gegen Fenster" akzeptiert zwei Verlierer-Klassen — `422` (Höhe zuerst) oder `409`
  (Fenster zuerst, weil es die Raumversion weiterzählt); die Invariante „genau ein
  Gewinner, stimmiger Endzustand" bleibt geprüft.
* **Neu Frontend (92):** Parität gegen die Fixture (27), Viewport (10), Fang (7),
  Werkzeuge (16), Editorzustand (15), Editor-Integration im Tab (14: Plan in einer
  Anfrage, Auswahl, Rechteckraum mit Client-UUIDs, Polygon mit Escape/Rücktaste,
  Kontur bearbeiten und atomar speichern ohne Anfrage beim Ziehen, Tabellenansicht zieht
  nach, Undo/Redo und Feldausnahme, 409, 422 mit Markierung, Tür setzen, Geschosswechsel-
  und Raumwechselwarnung, `beforeunload`, Archiv- und Lesemodus), Core-Warnbaustein (3).
* **Gesamtabnahme `tasks.ps1 check`, genau ein Lauf, alles grün:** Ruff und Format,
  mypy `--strict` (84 Dateien), import-linter (4 Contracts), Modul- und Datenbankgrenzen,
  genau ein Alembic-Head (`0004_electrical_room_model`), `uv lock --check`,
  **642 Backendtests, 0 übersprungen** (vorher 579) gegen PostgreSQL 17
  (`elektroplan_test`), OpenAPI-/Client-Drift, Frontend-Typecheck, ESLint,
  Frontend-Modulgrenzen, **255 Frontendtests** (vorher 163), Produktionsbuild.

**Browser-Smoke-Test** (laufendes Compose-System, synthetische Daten, Built-in-Browser
der Desktop-App; Fenster verdeckt, deshalb ohne Screenshots — geprüft über DOM-Text,
Zugänglichkeitsbaum und die API):

| # | Schritt | Bedienweg | Ergebnis |
|---|---|---|---|
| 1 | Anmelden | Formularfelder + Taste Enter | ok |
| 2–4 | Projekt, Tab, Geschoss | Klick | Editor Standardansicht, Geschoss sichtbar |
| 5–7 | Rechteckraum, Name, Maße | Taste R, 2 Zeigerklicks, Tastatur | 5,000/4,000 m, 20,00 m², geschlossen |
| 8 | Polygonraum (L, 6 Punkte) | Taste P, 7 Klicks (Schließen am Start) | 9,00 m², 6 Wände |
| 9 | Eckpunkt verschieben | Zeiger ziehen | beide Nachbarwände folgen, gefangen |
| 10 | Undo / Redo | Strg+Z, Strg+Y, Strg+Umschalt+Z | exakt ein Schritt je Ziehen |
| 11 | Fang aus/ein | Checkbox | 7136/1370 mm frei ↔ 7100/1400 mm Raster |
| 12 | Zoom, Pan, Einpassen | Mausrad, Knöpfe, Taste H + Ziehen, Taste F | Zoom am Zeiger verankert, Pan exakt, Einpassen ok |
| 13 | Tür platzieren | Taste O, Klick auf Wand | Wand 2, 2600 mm (Raster) |
| 14 | Fenster, Maße ändern | Auswahlfeld, Klick, Formular (Tastatur) | 1500 mm breit bei 1750 mm |
| 15 | ungültiger Zustand | Ecke quer ziehen, Strg+S | lokal orange, Server 422, 2 Wände rot, deutsche Meldung |
| 16 | korrigieren, speichern | Strg+Z, gültig ziehen, Strg+S | gespeichert, 21,25 m² |
| 17 | neu laden | Navigation | Stand vollständig da; Tabellenansicht identisch |
| 18 | Konflikt | Wand per zweitem API-Zugriff ändern, dann im Editor speichern | „zwischenzeitlich geändert", Entwurf bleibt; „behalten" und „Serverstand laden" geprüft |
| 19 | archiviertes Projekt | Archivierung per API, Tab öffnen | Plan sichtbar, „Nur Ansicht", keine Griffe, kein Speichern |
| 20 | Abmelden, neu laden | Knopf, Navigation | Anmeldeseite |

Einschränkungen: Native `confirm`-Dialoge wurden an einer Stelle per JavaScript
beantwortet (Serverstand laden), weil ein nativer Dialog die Automatisierung blockiert.
Die Öffnungsart wurde einmal per `form_input`, im Messlauf per Wertsetzung mit
`change`-Ereignis gewählt. Das Mausrad scrollt im Automatisierungswerkzeug zusätzlich die
Seite; das Ereignis selbst wird nachweislich abgefangen (`defaultPrevented`). Vier
Klicks mussten wiederholt werden, weil das verdeckte Fenster „nicht bereit" meldete —
ohne Auswirkung auf die Anwendung.

**Performance-Smoke-Test:** synthetisches Geschoss mit 25 Räumen × 8 Wänden = **200
Segmenten** und 25 Türen (per API angelegt — nur Testdaten, nicht Teil des
20-Minuten-Kriteriums). Umgebung: Windows 11 Pro, 16 logische Kerne, Chromium 152
(Built-in-Browser der Claude-Desktop-App), **Vite-Entwicklungsbuild** (React-Dev-Modus,
langsamer als der Produktionsbuild), Fenster verdeckt. Messung per `performance.now()`
um das Ereignis bis nach dem nächsten Task (React-Commit):

| Vorgang | Median | p95 | Max |
|---|---|---|---|
| Plan-Anfrage (Netzwerk) | 62 ms | — | — |
| Eckpunkt ziehen, je Zeigerbewegung (100×) | 5,2 ms | 17,4 ms | 19,1 ms |
| Zoomschritt Mausrad (60×) | 23,4 ms | 41,1 ms | 48,6 ms |
| Zeigerbewegung ohne Ziehen (100×) | 1,7 ms | 3,1 ms | 5,1 ms |

Während des Ziehens keine Netzanfrage; die Ziehbewegung ergibt einen Undo-Schritt. Der
Zoomschritt ist der teuerste Vorgang (Beschriftungen, Raster und Seitenleiste werden neu
berechnet); bei dieser Größe unkritisch, nicht weiter optimiert. Ein einzelner Lauf —
keine allgemeine Zusage.

**Messung des Exit-Kriteriums (automatisierter, entwicklungsnaher Durchlauf — kein
Usability-Test mit Menschen):**

Szenario: Einfamilienhaus-Erdgeschoss 11 × 9 m, leeres Geschoss im Projekt `PR-2026-0006`.

| Raum | Werkzeug | Fläche | Öffnungen |
|---|---|---|---|
| 0.01 Wohnen | Rechteck | 25,00 m² | 2 Fenster |
| 0.02 Küche | Rechteck | 16,00 m² | 2 Fenster |
| 0.03 Flur (L-Form) | Polygon, 6 Punkte | 17,50 m² | 3 Türen (Haustür, zu Wohnen, zu Küche) |
| 0.04 Bad | Rechteck | 7,50 m² | 1 Tür, 1 Fenster |
| 0.05 HWR | Rechteck | 6,00 m² | 1 Tür, 1 Fenster |
| 0.06 Schlafen | Rechteck | 15,75 m² | 1 Tür, 1 Fenster |
| 0.07 Kind | Rechteck | 11,25 m² | 1 Tür, 1 Fenster |

**7 Räume, 30 Wände, 15 Öffnungen (7 Türen, 8 Fenster), 103,25 m².**
Start 2026-09-26T20:25:57.590Z (Editor mit leerem Geschoss geladen), Ende
20:28:04.278Z (letztes erfolgreiches Speichern) — **126,7 s**. Alle Räume nach Abschluss
über die API geprüft: Kontur `valid`, erwartete Flächen und Öffnungen. Bedienwege:
Tasten R/P/O/V, Zeigerklicks auf die Zeichenfläche (Fang auf Raster und vorhandene
Eckpunkte), Tastatureingabe der Namen im Dialog, Strg+S je Raum nach dem Setzen der
Öffnungen, zweimal „Verkleinern" zu Beginn. Die Klickkoordinaten wurden vorab aus der
Viewport-Transformation berechnet — ein Mensch braucht deutlich länger zum Zielen. Die
gemessene Zeit belegt die **technische** Erfassbarkeit in wenigen Aktionen (2 Klicks +
Name je Rechteckraum, 1 Klick je Öffnung, 1 Tastendruck je Speichern), nicht die Dauer
für einen ungeübten Benutzer.
Beobachtete Bremse: Der Erfolgshinweis „Raum angelegt" lag über dem oberen Rand der
Zeichenfläche und hätte Klicks dort abgefangen; im Lauf jeweils geschlossen, danach
behoben (klickdurchlässig, rechts oben).

**Ergebnis:**
Phase 4a ist umgesetzt; das Exit-Kriterium ist gemessen erfüllt (126,7 s ≪ 20 min, im
automatisierten Durchlauf). Keine Migration.

**Offene Punkte:**
Zurück-Taste des Browsers wird nicht abgefangen; Entwurf umfasst genau einen Raum;
Öffnungen wechseln ihre Wand nicht; Performance nur im Entwicklungsbuild gemessen;
Usability mit echten Benutzern ungeprüft; Vite im Planner-Container bemerkt
Dateiänderungen unter Windows nicht (Neustart nötig); `CLAUDE.md` nennt als
Testdatenbank-URL die Entwicklungsdatenbank, obwohl die Tests `drop_all` ausführen.

**Nächster sinnvoller Schritt:**
Abnahme und Commit von Phase 4a; danach Phase 4b (3D-Ansicht) erst nach Freigabe.

---

## Task 0015 – Phase 4a.1: Navigationsschutz und Testdatenbank-Sicherheit

**Datum:** 2026-09-27

**Ziel:**
Vor dem Commit von Phase 4a zwei Lücken schließen: Browser-Zurück und -Vorwärts
verwarfen ungespeicherte Editoränderungen ohne Rückfrage, und `CLAUDE.md` nannte als
Testdatenbank die Entwicklungsdatenbank, obwohl die Tests `drop_all` ausführen. Außerdem
die offene Entscheidung zu deckungsgleichen Wänden vor Phase 4b festhalten.

**Durchgeführte Änderungen:**

1. **Data Router.** `App.tsx` exportiert die Routen und die Factory `erzeugeRouter()`;
   `main.tsx` erzeugt den Browserrouter **genau einmal vor** `createRoot(...).render(...)`
   und übergibt ihn `App` als Property. Keine Erzeugung in `useState`/`useMemo` oder im
   Render: Unter `StrictMode` könnte ein doppelt ausgeführter Initializer sonst einen
   verworfenen Router mit registrierten History-Listenern zurücklassen (Nachkorrektur vor
   dem Commit; Test: kein Router entsteht beim Rendern oder erneuten Rendern). Eine
   Splat-Route; darunter `AuthProvider`, `Navigationsschutz` und `Gate` mit den
   dynamischen `<Routes>` aus der Modul-Registry — unverändert.
   `QueryClientProvider` bleibt außen, `ProjectTabsProvider` in `AuthenticatedApp`.
2. **`core/ui/Navigationsschutz.tsx`** (neu, fachneutral): `useBlocker` blockiert, wenn
   die Meldestelle ungespeicherte Änderungen kennt und sich Pfad, Suche oder Hash ändern;
   Rückfrage per `window.confirm`, dann `proceed()` oder `reset()`. Der Router stellt bei
   Zurück/Vorwärts den Verlaufseintrag selbst wieder her — kein eigener
   `popstate`-/`history.go()`-Umweg.
3. **`core/ui/ungespeichert.ts`:** globaler Link-Klick-Handler entfernt (sonst zwei
   Rückfragen je Link); `beforeunload` und `verlassenBestaetigen` (Tabwechsel, Abmelden)
   bleiben.
4. **Testumgebung:** `test-setup.ts` gleicht eine jsdom-Grenze aus (Node-`Request` lehnt
   das jsdom-`AbortSignal` des Data Routers ab) — nur in Tests.
5. **Testdatenbank-Schutz** `apps/backend/tests/datenbankschutz.py`: Test-URL muss
   gesetzt sein, einen Datenbanknamen mit `test` als eigenem Namensteil tragen und darf
   nicht dieselbe Datenbank wie `ELEKTROPLAN_DATABASE_URL` sein (Host-Aliase
   `localhost`/`127.0.0.1`/`::1`, Standardport, Treiber ohne Belang). Eingebunden in
   `pytest_sessionstart` (Abbruch des ganzen Laufs mit Code 2 vor jedem Test), zusätzlich
   direkt vor `drop_all` in der `engine`-Fixture und vor dem Anlegen/Löschen der
   Migrationsdatenbank. Meldungen nennen nur Host, Port und Datenbankname. Ohne Test-URL
   bleiben die Datenbanktests wie bisher sichtbar übersprungen — dann gibt es keine
   destruktive Operation.
6. **Doku:** `CLAUDE.md` (Testdatenbank, Schutz), offene Entscheidung **T9**
   (deckungsgleiche Wände) verbindlich vor Phase 4b.

**Betroffene Module:** Frontend-App-Wurzel und Core-UI (fachneutral), Backend-Testinfrastruktur.
Kein Backend-Produktivcode, keine API-Änderung, keine Migration.

**Betroffene wichtige Dateien:**
`apps/planner/src/app/App.tsx`, `src/core/ui/Navigationsschutz.tsx` (neu),
`src/core/ui/ungespeichert.ts`, `src/test-setup.ts`,
`apps/backend/tests/datenbankschutz.py` (neu), `tests/conftest.py`,
`tests/test_migration_acceptance.py`, `CLAUDE.md`.

**Tests:**

* Neu Frontend (12): `Navigationsschutz.test.tsx` (7: ohne Änderungen keine Frage;
  Zurück blockiert, „bleiben" erhält URL und Entwurf; „verlassen" genau einmal;
  Vorwärts beides; interner Link genau eine Frage; abgelehnter Link bleibt;
  `beforeunload`), `App.test.tsx` (3: dynamische Modulroute erreichbar, Hauptnavigation
  fragt genau einmal, Abmelden über den Core-Mechanismus), `ProjectDetailPage.test.tsx`
  (2: Tabwechsel fragt und bleibt, ohne Änderungen keine Frage); `ungespeichert.test.tsx`
  angepasst (kein eigener Link-Handler mehr).
* Neu Backend (10, ohne Datenbank): identische URLs → Abbruch; gleiche Datenbank unter
  anderer Schreibweise → Abbruch; getrennte Testdatenbank → erlaubt; fehlende URL →
  verständlicher Abbruch; nicht als Test benannte Datenbank → Abbruch; ungültige URL;
  keine Zugangsdaten in Meldungen (3 Fälle); echter pytest-Unterlauf mit gefährlicher URL
  endet mit Code 2 vor jedem Test, ohne Passwort in der Ausgabe.
* Gegenprobe mit korrekter URL: Tenancy- und Migrationsabnahme laufen; die
  Entwicklungsdatenbank blieb unberührt (38 Räume vorher und nachher).
* Gezielter Lauf: Frontend-Typecheck, ESLint, Modulgrenzen, **267 Frontendtests**,
  Produktionsbuild, API-Client-Drift („aktuell"), Ruff für die Backend-Tests. Kein
  vollständiger Backendlauf — Backend-Produktivcode und Verträge sind unverändert.

**Browser-Smoke-Test** (laufendes Compose-System, Built-in-Browser; `window.confirm`
im Seitenkontext durch eine Aufzeichnung ersetzt, weil native Dialoge die Automatisierung
blockieren):

| Schritt | Ergebnis |
|---|---|
| Editor öffnen (Projekt per In-App-Link aus der Liste), Raum Wohnen lokal ändern | 25,50 m², „Ungespeicherte Änderungen" |
| Browser-Zurück, „bleiben" | 1 Rückfrage; URL, Entwurf und Undo-Historie erhalten |
| Browser-Zurück, „verlassen" | genau 1 weitere Rückfrage, Projektliste, keine Schleife |
| Browser-Vorwärts ohne Änderungen | ohne Rückfrage zurück im Projekt |
| Browser-Vorwärts mit Änderungen, „bleiben" / „verlassen" | 1 Rückfrage, Entwurf erhalten / genau 1 weitere, Navigation ausgeführt |
| Interner Link „← Alle Projekte" mit Änderungen | je Klick genau 1 Rückfrage; ohne Änderungen keine |
| Neuladen mit Änderungen | `beforeunload`-Handler registriert und hält das Ereignis an; **der native Dialog selbst war in dieser Automatisierung nicht beobachtbar**: Die Werkzeug-Navigation umgeht ihn, F5 ist im eingebetteten Browser kein Reload-Kürzel (Gegenprobe: auch ohne Änderungen kein Reload) |

**Ergebnis:** Alle Navigationswege innerhalb der Anwendung sind geschützt;
Neuladen/Schließen über `beforeunload`. Destruktive Tests können die
Entwicklungsdatenbank nicht mehr treffen.

**Offene Punkte:** nativer `beforeunload`-Dialog in einem normalen Browser manuell
prüfen; menschlicher Bedientest; Touch und weitere Browser; Entscheidung T9 vor Phase 4b.

**Nächster sinnvoller Schritt:** Commit von Phase 4a und 4a.1 nach Freigabe.

---

## Task 0016 – Phase 4.2: Benutzerverwaltung, Rollenvergabe und Startseite

**Datum:** 2026-09-27

**Ziel:**
Ein Administrator verwaltet die Mitglieder seines Betriebs: sehen, sicher einladen,
Einladungen widerrufen oder neu ausstellen, feste Systemrollen vergeben, effektive Rechte
nachvollziehen, den Zugang zum Betrieb sperren und freigeben. Dazu eine
arbeitsorientierte Startseite statt der technischen Übersicht. Kein Rolleneditor, kein
E-Mail-Versand, keine Passwortwiederherstellung, kein Beginn von Phase 4b.

**Geprüfter Ausgangsstand:**
`users` global, `organization_members` mit Status (`invited` ungenutzt) und **ohne**
Version; sechs Systemrollen statisch im Code; `user.account.*` und `role.assignment.*`
nur beim Administrator; keine Verwaltungs-API. Rechte und Mitgliedsstatus wurden schon
pro Anfrage geprüft, ein Refresh bei gesperrter Mitgliedschaft lieferte aber `404` statt
`401` und widerrief nichts. Roadmap-Tabelle führte 4a noch als `NOT STARTED`,
`current-status.md` 4a als nicht committet – beides korrigiert.

**Durchgeführte Änderungen:**

1. **Migration `0005_member_administration`:** `organization_members.version` und
   `last_login_at` (je Betrieb), neue Tabellen `member_invitations` (Token nur als
   SHA-256-Hash, partieller Unique-Index „eine offene Einladung je Betrieb und E-Mail“)
   und `member_invitation_roles` (zusammengesetzte FKs). Keine Datenmigration.
2. **`app/core/invitations`:** Anlegen, Widerrufen, Neu ausstellen (ersetzt Hash und
   Frist); öffentliche Annahme `preview` / `new-account` / `existing-account`;
   Zustellung als kleine Funktion (`development_link` nur außerhalb Produktion, sonst
   `503` ohne Anlage); Token im URL-Fragment; einheitlicher Fehler
   `invitation-invalid`; Begrenzung je IP; `purge-invitations` nach 30 Tagen.
3. **`app/core/members`:** Verzeichnis aus Mitgliedschaften und offenen Einladungen in
   einer datenbankseitig vereinigten, sortierten und begrenzten Keyset-Liste; Detail;
   Sperren/Freigeben; Rollen atomar ersetzen; effektive Rechte mit Herkunft.
   **Organisationszeile als Sperrwurzel**, Handelnder wird unter der Sperre erneut
   geprüft; `self-lockout` und `last-administrator` als eigene Fehlertypen.
4. **Sitzungen:** Sperre widerruft die Refresh Tokens nur dieser Mitgliedschaft
   (`membership_disabled`); Refresh einer gesperrten Mitgliedschaft `401` samt
   Familienwiderruf; `last_login_at` je Betrieb ohne Versionszählung.
5. **`GET /roles`**, Rollenbeschreibungen mit Einsatzzweck, Bereichsnamen der Rechte
   (Core nach Namensraum, Module nach Modulname aus der Registry).
6. **Projektliste:** `sort=updated_at` (Keyset), `ProjectSummary.updated_at`.
7. **Frontend (Plattformmodul):** Startseite `/`, Administration (Benutzer, Mitglied,
   Rollen und Rechte, Systeminformationen), Einladungsdialog, Vor-/Zurück-Blättern über
   einen Cursor-Stapel, Entwicklungslink nur bei Server-Einstellung **und**
   Vite-Entwicklungsmodus. Core: öffentliche Seite `/einladung` über eine eigene
   Routenebene vor der Anmeldung, `Bestaetigung`, `Marke`, Dialog mit `data-autofocus`
   und Fokusrückgabe, `aktualisieren()` lädt Rechte bei Rückkehr ins Fenster neu,
   `?neu=1` öffnet die Anlagedialoge für Projekt und Kunde.
8. **ADR 0015**, Dokumentation (Sicherheit inkl. neuem Abschnitt 18 und DSGVO-Feldliste,
   API, Datenbank, Module, Events, Glossar, README, Roadmap, Status, Changelog).

**Befunde im Browser-Smoke-Test, behoben:**
- Die Annahmeseite reagierte nicht auf einen neuen Link bei bereits geöffneter Seite
  (nur das Fragment ändert sich) – jetzt Neustart mit dem neuen Token, Test ergänzt.
- Rollen-Checkboxen hatten die ganze Beschreibung als zugänglichen Namen – jetzt Name
  über `aria-labelledby`, Beschreibung über `aria-describedby`.
- Während der Umsetzung aufgefallen: `useLocation` im Gate hätte die ganze Anwendung bei
  jeder Navigation neu gerendert (App-Tests liefen in Timeouts) – ersetzt durch eine
  eigene Routenebene.

**Selbstreview:**

| Frage | Ergebnis |
|---|---|
| Betriebsübergreifende Rechteausweitung? | Nein. Jede Abfrage ist auf die Organisation aus dem Token gefiltert, Rollen werden nur im eigenen Betrieb aufgelöst, fremde IDs `404` (Sweep + eigener Test über alle acht Routen). `role.assignment.write` ist faktisch Administratorrecht – dokumentiert, nur in der Rolle `admin`. |
| Kontoübernahme durch Betriebsadministrator? | Nein. Kein Endpunkt ändert Passwort, E-Mail, Name oder `is_active`; `new-account` lehnt bestehende Adressen ab; `existing-account` verlangt das Passwort genau dieses Kontos. Restrisiko nur im Entwicklungsmodus (Einladender hält das Token) – deshalb in Produktion verboten. |
| Token aus Logs, Audit, späteren Antworten? | Nein. Nur die Antwort auf Anlage/Neuausstellung enthält den Link; getestet für Audit, Logausgabe (mit Gegenprobe, dass Logs erfasst wurden), Detail und Liste; im Compose-System per `grep` geprüft. |
| Abgelaufenes, widerrufenes, ersetztes Token nutzbar? | Nein, je eigener Test; im Browser Wiederverwendung abgelehnt. |
| Paralleles Entfernen des letzten Administrators? | Nein. Drei Paralleltests; Gegenprobe ohne Sperre ergibt nachweislich null Administratoren. |
| Wirken Sperre und Rollenänderung sofort? | Ja, serverseitig pro Anfrage; getestet mit demselben Access Token; im Browser ohne Neuanmeldung sichtbar. |
| Direkte Imports Core ↔ Modul-Interna / gelockerte Grenzen? | Nein. `CORE_PUBLIC_SURFACE`, `.importlinter` und Frontend-Grenzregeln unverändert, alle grün. Einzige Erweiterung: drei öffentliche Pfade in der Permission-Ausnahmeliste des Architekturtests, begründet. |
| Dashboard mit erfundenen oder technischen Inhalten? | Nein. Nur echte Projekt- und Einladungsdaten, keine Kennzahlen, keine Modulversionen, keine Schlüssel (getestet). |
| Listen über mehrere Seiten? | Ja, Backend (jede Zeile genau einmal) und Frontend (Vor/Zurück) getestet. |
| Schreiboperationen mandanten- und nebenläufigkeitssicher? | Ja: Sperrwurzel Organisation, `FOR UPDATE` auf Einladung und Mitgliedschaft, `If-Match`, partieller Unique-Index. |
| Code, OpenAPI, Client, Doku konsistent? | Ja, Drift-Check grün, Doku nachgezogen. |

**Tests:**
- Backend: **706 bestanden, 0 übersprungen** (vorher 652). Neu: `test_member_administration.py`
  (24), `test_invitations.py` (22), `test_member_concurrency.py` (7), Projektsortierung (1);
  Mandanten-Sweep um `member_id`/`invitation_id` erweitert.
- Frontend: **319 bestanden** in 33 Dateien (vorher 255 laut letztem Stand). Neu u. a.
  `StartPage`, `BenutzerPage`, `MitgliedPage`, `EinladenDialog`, `Bestaetigung`,
  `EinladungAnnehmenPage`, App-Routing.
- `tasks.ps1 check` vollständig grün (Ruff, Format, mypy 93 Dateien, import-linter 4/0,
  ein Alembic-Head `0005`, Lockfile, Backend, API-Drift, Typecheck, ESLint,
  Modulgrenzen, Frontend, Build). Modell und Migration stimmen überein
  (`compare_metadata` in `test_migration_acceptance.py`, inkl. Downgrade/Upgrade).

**Browser-Smoke-Test (Compose-System, synthetische Daten):** Admin angemeldet →
eingeladen (Serverfehler bei `.test`-Domain korrekt als Feldfehler) → Link einmalig
übernommen → in eigenem Tab ohne Sitzung angenommen (zu kurzes Passwort abgelehnt) →
Wiederverwendung abgelehnt → neuer Benutzer angemeldet: nur Übersicht und Projekte,
direkte Aufrufe von Administration und Kunden gesperrt, API `403` → Rolle als Admin
ergänzt: Kunden sofort sichtbar ohne Neuanmeldung → Selbstsperre `409 self-lockout` →
Mitglied gesperrt: alter Access Token `401`, Refresh `401`, Anmeldung abgelehnt, Browser
fällt auf die Anmeldung → über die Oberfläche freigegeben (Rückfrage, Fokus, Escape) →
paralleler Versionskonflikt verständlich gemeldet → Dashboard als Admin und Monteur,
auch auf 375 px Breite → Abmelden und Neuladen.

**Offen:** siehe `docs/current-status.md`.

---

## Task 0017 – Phase 4b: abgeleitete 3D-Ansicht des Grundrisses

**Datum:** 2026-09-27

**Ziel:**
Der Grundriss aus Phase 4a wird dreidimensional dargestellt, navigiert, kontrolliert und
ausgewählt. Die 2D-Ansicht bleibt die einzige Autorenfläche; die 3D-Ansicht ist
vollständig abgeleitet und schreibgeschützt. Die fachlichen Entscheidungen T8 und T9
waren vorgegeben und sind in ADR 0016 festgehalten.

**Ausgangsprüfung:** Der Plan-Endpunkt liefert je Raum `effective_height_mm` und
`contour_status`, Wände gerichtet mit Stärke und gerundeter Länge, Öffnungen mit Art,
Abstand, Breite, Höhe und Brüstung — ausreichend, keine API-Änderung nötig. Query-Key
`["electrical","plan",floorId]`, Ansichtsschutz über `window.confirm`, `StrictMode`
aktiv. Abweichung in der Auftragsliste: ADR 0013 heißt
`0013-room-contour-as-ordered-wall-segments.md`.

**Durchgeführte Änderungen:**

1. **ADR 0016** (T8, T9, Three.js-Einbindung, Konfliktregeln, Neubewertung vor
   Leitungsrouting/Materialermittlung). T8/T9 in Status, Moduldoku und Roadmap als
   entschieden geführt; neue offene Frage T10 (physische Wandidentität, vor Phase 6).
2. **Reine Aufbereitung** in `apps/planner/src/modules/electrical/ansicht3d/`:
   `transformation.ts` (mm → m, x → +X, y → −Z, Höhe → +Y, Zentrierung auf ganzzahlig
   abgerundete Mitte), `wandgruppen.ts` (kanonischer Schlüssel aus Geschoss und sortierten
   Endpunkten, Öffnungsumrechnung `L − Abstand − Breite`, Dedup, Konfliktwarnungen,
   Erkennung teilweiser Überlagerung — exakt ganzzahlig), `wandzerlegung.ts` (Raster
   entlang aller Öffnungskanten, Zusammenfassen der Wandzellen, keine Nullflächen,
   defensiv bei ungültigen Maßen), `szenenmodell.ts` (Plan → unveränderliches Modell,
   ausgelassene Räume mit Grund, `objektZu`, `warnungenZu`).
3. **Geometrie** `geometrien.ts`: Boden über `ShapeUtils`/Earcut mit nach oben
   ausgerichteten Dreiecken, Umriss, Wandquader aus den Wandteilen (Gruppen senkrecht /
   waagerecht, Enden um halbe Stärke verlängert), Öffnungsflächen in der Wandmitte.
4. **Szenenschicht** `szene.ts` (`Grundrissszene`) mit injizierbarer `Umgebung`
   (`umgebung.ts`: `WebGLRenderer`, `OrbitControls`, rAF, `ResizeObserver`, WebGL-2-Probe).
   Rendern nur auf Anforderung, Pixel Ratio ≤ 2, Pause bei verborgenem Dokument,
   Meldung bei Kontextverlust, Raycasting nur gegen auswählbare Objekte, Hervorhebung per
   Materialtausch, vollständiges `entsorgen()` inklusive `forceContextLoss`.
5. **React**: `Ansicht3d.tsx` (gleicher Query-Key, Modell per `useMemo`, Szene einmal je
   Mount, gezielte `setzePlan`/`setzeAuswahl`, Zustände, Escape), `Seitenleiste.tsx`
   (Auswahl, „Nicht dargestellt", Hinweise mit „In der Ansicht zeigen"),
   `Ansicht3dLaden.tsx` (Lazy-Grenze mit Fehlerfang und neuem Versuch).
6. **RoomsTab**: drei Ansichten „2D-Editor" · „3D-Ansicht" · „Tabellen & Details";
   gemerkte Wahl mit sicherem Rückfall; die Verwerfen-Rückfrage kommt weiter nur beim
   Verlassen des Editors. `plan.ts` hält Query-Key und Abfrage für Editor und 3D.
7. **Abhängigkeiten**: `three` 0.186.1, `@types/three` 0.186.0. Die Typen ziehen als
   Entwicklungsabhängigkeiten u. a. `@types/webxr`, `@types/stats.js`, `meshoptimizer`,
   `fflate`, `@tweenjs/tween.js` und `@dimforge/rapier3d-compat` nach; nichts davon
   gelangt ins Bundle. Vite `chunkSizeWarningLimit` 650 kB.
8. **Befunde behoben**: Die Mittellinie des Orientierungsrasters schien im Browser
   durch die 2 mm höher liegenden Böden — Raster jetzt `renderOrder −1` ohne
   Tiefenschreiben, mit Regressionstest. Außerdem richtet die Szene die Kamera selbst
   aus (`lookAt`), statt sich auf die Controls zu verlassen (Befund der Szenentests).

**Tests (automatisiert):**
- Frontend: **441** bestanden (vorher 319), davon 122 neu: Transformation 8,
  Wandzerlegung 11, Wandgruppen 22, Szenenmodell 12, Geometrie 10, Szenenschicht 25,
  3D-Komponente 20, Ansichten/Lazy-Grenze 13, Editor-Rückfrage beim Wechsel zu 3D 1.
- Backend: **707** bestanden, 0 übersprungen — unverändert, keine Backenddatei geändert.
- `tasks.ps1 check` vollständig grün; ein Alembic-Head `0005_member_administration`
  (keine Migration), kein API-Drift, Modulgrenzen unverändert.

**Browserabnahme (Compose-System, synthetische Daten, echtes WebGL 2):**
Chromium 152 (Browserbereich der Claude-Desktop-App), ANGLE/D3D11, NVIDIA RTX 3060.
Daten per API angelegt: `PR-2026-0008` — EG mit Küche und Flur (exakt gemeinsame Wand,
Tür nur flurseitig erfasst), Küchenfenster mit 900 mm Brüstung, L-förmigem Wohnen,
Flur 2600 mm hoch (Höhenkonflikt), Wand Flur/Wohnen 115/175 mm (Stärkekonflikt),
beidseitig gleich erfasstem Durchgang und offenem Abstellraum; OG mit einem Raum;
Geschoss „Belastungsprobe" mit 30 Räumen, 120 Wänden, 60 Öffnungen. `PR-2026-0009` mit
gleichem EG, archiviert. Zusätzlich gelesen: `PR-2026-0006` (EFH aus dem Messlauf 4a).

| # | Punkt | Ergebnis | Art |
|---|---|---|---|
| 1 | Wechsel 2D → 3D | ok | visuell |
| 2 | Schutz ungespeicherter Änderungen | Rückfrage mit bestehendem Text; Abbrechen: Editor und Entwurf bleiben; OK: 3D. `window.confirm` per Skript beantwortet | Skript + visuell |
| 3 | vollständig, nicht gespiegelt | Draufsicht: Küche West, Wohnen Ost, L-Flügel Nord, Fenster/Haustür Süd | visuell |
| 4 | gemeinsame Wand einmal | 14 logische → 12 Körper, davon 2 gemeinsam (hell) | visuell + Text |
| 5 | einseitige Tür schneidet durch | Durchbruch sichtbar, per Klick ausgewählt | visuell |
| 6 | Warnung zur einseitigen Erfassung | sichtbar in der Liste und bei der Auswahl | Text |
| 7 | Fenster mit Brüstung | Brüstung sichtbar; Auswahl: 1260 × 1385 mm, Brüstung 900 mm | visuell + Text |
| 8 | L-Boden korrekt | Form in Drauf- und Schrägsicht, Fläche 20,00 m² | visuell |
| 9 | Orbit | Ziehen dreht; ein Ziehen löst keine Auswahl aus | visuell |
| 10 | Zoom | Mausrad, die Seite scrollt nicht mit; Knöpfe „Näher"/„Weiter weg" | visuell |
| 11 | Pan | Pfeiltasten; Umschalt+Ziehen als erzeugte `PointerEvent`s (das Werkzeug überträgt beim Ziehen keine Modifier); rechte Maustaste nicht geprüft | visuell, eingeschränkt |
| 12 | Ansicht einpassen | ok nach starkem Zoom | visuell |
| 13 | Draufsicht | ok | visuell |
| 14–17 | Raum, Wand, Öffnung auswählen; Fachdaten | Wohnen; Wand Flur/Wohnen (175 mm dargestellt, erfasst 115/175, Höhe 2600 mm); Fenster; Tür — alle Werte korrekt | visuell + Text |
| 18 | Escape | hebt auf, Fokus bleibt in der Szene | Text |
| 19 | Geschosswechsel | EG → OG → Belastungsprobe: ein Canvas, neu eingepasst, alte Auswahl entfällt | visuell |
| 20 | zurück zum 2D-Editor ohne Datenverlust | Räume vorhanden; per API alle Räume unverändert in Version 1 (kein Schreibvorgang) | API + Text |
| 21 | archiviertes Projekt | 3D vollständig, Schreibschutzhinweis, keine Bearbeitungsknöpfe | visuell |
| 22 | 375 px | kein horizontaler Überlauf, Knöpfe umgebrochen, Szene 308 × 445 px, Seitenleiste darunter | visuell + Messung |
| 23 | Neuladen, Zurück/Vorwärts | Sitzung und gemerkte Ansicht bleiben; Zurück/Vorwärts ok | Text |
| 24 | Konsole und Containerlogs | keine Fehler aus der 3D-Ansicht; vorhandene Einträge stammen vom Docker-Neustart (401 vor der Anmeldung) und vom bewussten Planner-Neustart (Vite-WebSocket, Exit 143) | Log |
| 25 | kein Dauer-CPU nach Verlassen | 0 rAF-Anforderungen in 3 s im 2D-Editor und in 3 s ruhiger 3D-Ansicht | Messung |
| + | Leckprüfung | 10 × 2D ↔ 3D: jedes Mal genau 1 Canvas, im 2D-Editor 0 | Messung |

Nur automatisiert geprüft, im Browser nicht auslösbar: WebGL nicht verfügbar,
Kontextverlust, gescheitertes Nachladen des Chunks. Kein Touchgerät, kein zweiter Browser.

**Befund am realen Grundriss aus 4a:** 7 Räume ergeben 26 Wandkörper, nur 4 exakt
gemeinsam, 7 Hinweise „Wände überlagern sich teilweise", 3 einseitig erfasste Türen.
Die exakte T9-Regel führt diese Wände bewusst nicht zusammen.

**Performance:** siehe `docs/modules/electrical.md`, Abschnitt 10 (Produktionsbuild:
EFH Drehen/Zoomen Median 1,8 ms je Bild, Belastungsprobe 3,9 ms; erstes Öffnen 444 ms).
Ein Rechner (AMD Ryzen 7 2700, 24 GB, RTX 3060), ein Browser — keine allgemeine Zusage.

**Selbstreview:**

| Frage | Ergebnis |
|---|---|
| Wirklich rein lesend? | Ja. Kein `post/put/patch/delete`, kein `setQueryData` in `ansicht3d`; per API bestätigt, dass die Versionen unverändert blieben. |
| Floats zurück ins Datenmodell? | Nein. Umrechnung nur in `geometrien.ts`; nichts fließt zurück, React erhält nur `{art, id}`. |
| Gespiegelt? | Nein — Tests (Umlaufsinn, Draufsicht) und visuell. |
| Nur exakte Gruppierung? | Ja; Tests für 1 mm Abweichung, Teilüberlappung, anderes Geschoss, gleiche ID. |
| Richtungsumkehr der Öffnungen? | Test mit der Formel; beidseitiger Durchgang im Browser dedupliziert. |
| Konflikte sichtbar? | Ja, elf Warnungsarten mit Darstellungsregel im Text. |
| WebGL-Ressourcen entsorgt, StrictMode? | Test zählt Geometrie- und Materialfreigaben exakt; StrictMode-Test: eine Szene, ein Canvas; Browser: 10 Wechsel ohne Rückstand. |
| Kamera → React-Render? | Nein (Profiler-Test). |
| Ungültige Konturen ehrlich ausgelassen? | Ja, mit Grund — auch defensiv bei „valid" mit Lücke. |
| 2D-Editor unverändert? | Ja; nur der Query-Key liegt jetzt in `plan.ts`; alle Editortests grün. |
| Grenzen gelockert, Backend geändert, zweiter Three.js-Consumer? | Nein, nein, nein. |
| WebGL-Fallback erreichbar? | Ja, automatisiert (Probe schlägt fehl → Hinweis); im Browser nicht auslösbar. |
| Hinweise verständlich? | Deutsch, mit Raumnamen, Maßen und der angewandten Regel. |

**Offen:** siehe `docs/current-status.md` (Abschnitte 7 und 9): teilweise überlappende
Wände im 2D-Editor angleichen können, T10 vor Phase 6, Fallbacks im echten Browser,
weitere Browser und Touch, Usability mit Menschen.

---

## Task 0018 – Bedienungsnacharbeit 1: Kunden, Projekte, Seiten, Maßeinheit, Rückfragen

**Datum:** 2026-09-28 · **Stand:** umgesetzt, **nicht committet** (zusammen mit Phase 4b)

**Ziel:** Punkte 1–8 und 10–11 der manuellen Abnahme nach Phase 4b. Punkt 9 (Tür per Maus,
gekoppelte Öffnungen, teilweise gemeinsame Wände) ist ausdrücklich ein Folgeauftrag und
wurde nicht begonnen.

**Ausgangsprüfung (Befunde):**

- `customer_id` existierte im Projektlisten-Endpunkt bereits, ungetestet; `q` suchte auch
  im Kundennamen.
- Doppelte Scrollleiste: `.dialog` (nativ `overflow: auto`) **und** `.dialog__inhalt`
  scrollten mit derselben Maximalhöhe.
- Versatz Gebäude/Geschoss: `.inline-form` richtete mit `align-items: flex-end` aus.
- `api.md` §4 („Cursor, kein offset") und §9 (Feldnamen stabil) standen der
  Seitenpagination entgegen → **ADR 0017**.
- Die 3D-Taste „Ansicht einpassen" behält die Blickrichtung – der neue Tooltip sagt das,
  statt eine Standardausrichtung zu versprechen.

**Umsetzung:**

1. **Backend (Core):** `fetch_numbered_page` zählt die bereits gefilterte,
   mandantenbeschränkte Abfrage als Unterabfrage – Zählung und Seite können nicht
   auseinanderlaufen. Stabile Sortierung mit ID. Seite außerhalb → letzte Seite; leer →
   `page 1`, `total_pages 0`. `status_group`; Suche ohne Kundenname. Audit und
   Benutzerverwaltung bleiben beim Cursor. Keine Migration.
2. **Frontend-Core:** `Seitennavigation`/`seitenfolge`, `useNummerierteListe`,
   `Combobox` (fixed verankert, Listbox-Semantik, Tastatur), `Dialog` mit genau einem
   Scrollbereich und referenzgezählter Seiten-Sperre, `RueckfrageProvider`
   (eine Frage zur Zeit, Antwort genau einmal), `core/masse.ts` + `masseinheit.ts`
   (reine Umrechnung ohne Fließkomma, Store über `useSyncExternalStore`, Einstellungsdialog).
3. **Platform:** getrennter Kundenfilter, Kunden-Projektliste mit Statusgruppen,
   Adressvorschlag mit Feldherkunft (`adressvorschlag.ts`), Ländercode-Feld, `.feldzeile`.
4. **Electrical:** alle Längenanzeigen und -eingaben über `useMasse` (Eigenschaften,
   Statuszeile, SVG-Maßtexte, Raster, Dialoge, Tabellen, 3D-Seitenleiste und
   3D-Hinweistexte über einen übergebenen Formatierer). Geometrie, Gruppierung und
   Öffnungslogik unverändert. `window.confirm` → Rückfrage; Raumwechsel mit drei Wegen.

**Im Browser gefundener und behobener Fehler:** Unter StrictMode (Entwicklung) merkte
sich der Dialog beim zweiten Effektlauf den bereits fokussierten Knopf **im** Dialog als
Rückgabeziel; nach dem Schließen landete der Fokus auf `body`. jsdom zeigte das nicht
(kein `inert`). Behoben: gemerkt wird nur ein Element außerhalb, zurückgegeben erst, wenn
der Dialog aus dem DOM ist. Regressionstest bildet den inerten Hintergrund nach.
Außerdem: nach der Kundenauswahl geht der Fokus auf den Knopf der Auswahlanzeige.

**Browserabnahme** (laufendes Compose-System, synthetische Daten: 46 Kunden, 40
Projekte, davon 30 an einem Kunden; Chromium im Browserbereich der Desktop-App):

| # | Prüfung | Art | Ergebnis |
|---|---|---|---|
| 1–2 | Projektübersicht, allgemeine Suche | funktional | Suche „Testprojekt 1" → 10 Treffer, von Seite 2 zurück auf Seite 1 |
| 3–4 | Kundenfilter per Tastatur, entfernen | visuell + funktional | Liste schwebt am Feld (klappt bei wenig Platz nach oben), Pfeil/Enter wählt, 30 Einträge; Entfernen → 40, Fokus im Suchfeld |
| 5–6 | nummerierte Seiten Projekte/Kunden | funktional | „Seite 1 von 2 · 40", Seite 2 = 15; Kunden „Seite 1 von 2 · 46", letzte Seite = 21, Erste/Vorige gesperrt |
| 7–9 | Kundendetail | funktional | 24 laufende; umgeschaltet 6 archivierte |
| 10–12 | Projektformular | gemessen | genau ein Scrollbereich, Dialog selbst `overflow hidden`, `html` gesperrt; Dialoghöhe 688 px und Feldlage über alle Tipp-/Ladezustände konstant; Fokus bleibt im Feld |
| 13–15 | Adressübernahme, Wechsel, „übernehmen" | funktional | wie spezifiziert, manuelles Feld bleibt |
| 16–17 | Ausrichtung, schmal (375 px) | gemessen | Label/Eingabe auf gleicher Höhe (768/793 px); schmal untereinander, kein Überlauf |
| 18–19 | cm Standard, Umstellung auf mm | visuell + funktional | 2D „500 cm" → „5.000 mm", Raster „10 cm" → „100 mm", ohne Neuladen |
| 20 | Anlage in cm, Prüfung per API | API | Geschoss „287,5"/„262,5" cm → `elevation_mm 2875`, `default_ceiling_height_mm 2625` (int) |
| 21 | 2D/3D vergleichen | funktional | dieselbe Tür 88,5 cm/201 cm bzw. 885 mm/2.010 mm; 3D-Hinweistexte folgen |
| 22–24 | Rückfrage, Abbrechen, Verwerfen | visuell + funktional | eigener Dialog, Anfangsfokus „Änderungen behalten", Escape; Fokus zurück auf „3D-Ansicht" (nach Fehlerbehebung); Verwerfen → 3D, 1 Canvas |
| 25 | Neuladen | indirekt | F5 lud nicht neu, Entwurf blieb; Konsole: Chromium blockierte beim skriptgesteuerten Neuladen „beforeunload confirmation panel" – der native Dialog selbst ist im Screenshot nicht sichtbar |
| 26 | „Ansicht zurücksetzen" 2D/3D | funktional | Beschriftung und Tooltip, keine „einpassen"-Texte mehr |
| 27 | Konsole, Container | Logs | keine Anwendungsfehler; nur 401 der Sitzungsprüfung und HMR-WebSocket bei Neustarts; Backend ohne 5xx |

Zusätzlich im Browser: interne Navigation fragt genau einmal, Abmelden fragt (nur
Abbrechen geprüft – Sitzung bleibt).

**Selbstreview:** siehe Abschlussbericht dieser Session; alle Fragen mit Nachweis
beantwortet, keine offenen Widersprüche zwischen Code, OpenAPI, Client und Doku.

**Offen:** Punkt 9 (Tür/Teilwand) als nächster Block; nativer `beforeunload`-Dialog nicht
visuell bestätigt; Anonymisierungs-Rückfrage nutzt noch `window.confirm` (keine
ungespeicherten Änderungen, außerhalb des Auftrags).

---

## Task 0019 – Bedienungsnacharbeit 2 / Phase 4b.2: gemeinsame Wandabschnitte, Tür per Maus

**Datum:** 2026-09-28 · **Stand:** umgesetzt, **nicht committet** (zusammen mit Phase 4b und 4b.1)

### Anlass

Punkt 9 der Abnahme nach 4b. Die Browserabnahme mit dem realen Grundriss aus dem Messlauf 4a
(`PR-2026-0006`) zeigte: nur 4 Wandpaare exakt deckungsgleich, 7 Paare nur teilweise
überlappend (lange Flurwand gegen Bad/Schlafen/Kind, Wohnen gegen Küche/Flur, Schlafen gegen
Bad/HWR). Folge in 3D: doppelte, sich durchdringende Wandkörper, 7 Überlagerungshinweise,
Türen auf den kurzen Raumwänden als „nur einseitig erfasst" gemeldet. Im 2D-Editor musste eine
Tür über Abstandsangaben gesetzt werden; eine später gezeichnete Nachbarwand konnte sie
überdecken.

### Umsetzung

1. **Reine Topologieschicht** `modules/electrical/topologie/` (`lage.ts`, `wandtopologie.ts`,
   `oeffnungen.ts`): exakte Geraden (gekürzte ganzzahlige Richtung, ganzzahliger Abstand),
   atomare Abschnitte an allen Wandendpunkten, exakte Lagen `ganz + stufen·√m` für schräge
   Wände, Einordnung jeder Öffnung (`gemeinsam` mit abgeleitetem Nachbarn, `aussen`,
   `konflikt`: `mehrdeutig`/`grenze`/`teilweise`/`widerspruch`/`art`, `ungueltig`),
   Dubletten, Übertragung zwischen Wänden. 2D und 3D verwenden dieselbe Ableitung.
2. **Eine Öffnung, keine Dublette** (ADR 0016 präzisiert): Öffnung bleibt eine Zeile an ihrer
   Eigentümerwand; der zweite Raum ist abgeleitet. Keine Paar-ID, keine Migration,
   **keine Backendänderung** – die Serverprüfung der einzelnen Öffnung bleibt Autorität, eine
   halb gespeicherte Raumverbindung ist ausgeschlossen.
3. **3D:** ein Wandkörper je atomarem Abschnitt, Verlängerung nur an freien Enden, eine
   gespeicherte Tür schneidet den gemeinsamen Körper; neue Hinweise (Dublette, Grenze,
   teilweise, nicht eindeutig), entfallen: „einseitig", „teilweise überlagert". Seitenleiste:
   „Verbindet „A" und „B"", Maße aus der gespeicherten Öffnung.
4. **2D:** Öffnungsebene über allen Wänden (jede Öffnung einmal, im Nachbarraum gestrichelt
   als abgeleitet, Klick führt zur gespeicherten Öffnung); Werkzeug „Öffnung" mit Vorschau,
   geometrischer Wandsuche (aktiver Raum bevorzugt), 5-cm-Fang, Begrenzung auf Wand und
   atomaren Abschnitt, Kollisionsprüfung auch gegen die Gegenseite; Verschieben nur entlang
   der Wand, Escape/`pointercancel`/Verlust des Zeigers brechen ab und geben den Zeiger frei;
   Hinweis beim Wechsel gemeinsam ↔ nicht geteilt. Seitenleiste: Verbindung, Quellwand,
   abgeleitete Öffnungen der Nachbarwand. Ersetzt: `oeffnungSetzen`, `oeffnungVerschieben`,
   `abstandFangen` (Platzierung jetzt in `editor/platzierung.ts`).
5. **Maßeinheit je Benutzer:** `elektroplan.masseinheit.<user_id>`, gesetzt vom
   `AuthProvider`; Laden/Abmelden → Standard; alter Schlüssel einmalig übernommen und entfernt.
6. **`.claude/launch.json`:** untracktes Vorschau-Werkzeugartefakt (Format der
   Desktop-App-Vorschau, Port 3000, Root-`dev`; nirgends referenziert, nicht in 4b/4b.1
   berichtet) aus dem Arbeitsbaum entfernt; `.claude` nicht versioniert. Kopie liegt in der
   Scratchpad-Sicherung.

### Messwerte

| Messung | Wert |
|---|---|
| Realer 4a-Grundriss in 3D | 23 Wandkörper, 11 gemeinsam, 15 Öffnungen, **0 Hinweise** (vorher 26 Körper, davon 7 Paare sich durchdringend, 7 Überlagerungs- und 3 Einseitigkeitshinweise) |
| Topologie + Einordnung je Zeichenschritt (Node/jsdom, Median / p95) | 4a: 0,34 / 0,66 ms · Belastung 30 Räume: 0,53 / 0,91 ms · 200 Wände: 0,76 / 1,28 ms |
| 3D im Browser (Entwicklungsbuild, Pane verborgen) | Szenenmodell 1,0–2,5 ms, Geometrie 3,0–3,7 ms |
| 3D-Chunk Produktion | 588,5 kB (152 kB gzip) – unverändert |

### Browserabnahme (Compose, synthetische Daten)

Original `PR-2026-0006` nur gelesen; bearbeitet wurde die per API angelegte identische Kopie
`PR-2026-0042` („Abnahme 4b.2 Teilwände"). Zweiter synthetischer Benutzer per
Entwicklungseinladung (Rolle Planer).

* **Funktional/DOM geprüft:** 3D-Zusammenfassung beider Projekte (23/11/15/0); 15 bzw. 16
  Öffnungselemente in 2D (eines je Öffnung); Türwerkzeug per Taste; Vorschau über gemeinsamer
  Wand „verbindet „0.01 Wohnen" und „0.02 Küche"", über Außenwand „kein zweiter Raum", abseits
  keine; Kollision mit vorhandenem Fenster; Klick → Tür bei 255 cm, sofort ausgewählt; Ziehen
  mit echter Maus (Zeiger 30 cm neben der Wand) → 355 cm, gleiche Wand, 5-cm-Raster; Escape
  während des Ziehens → Lage zurück, Vorschau weg; numerisch 352,5 cm übernommen; Speichern;
  Nachbarraum Küche: Tür gestrichelt als abgeleitet mit Tooltip; Klick auf eine abgeleitete Tür
  → Wechsel in den Eigentümerraum und Auswahl der gespeicherten Tür; Außenwandtür „kein
  zweiter Raum"; cm → mm: Geometrie identisch, Anzeige 3800 mm; Ansichtswechsel mit
  ungespeicherter Tür → eigener Dialog „Ansicht wechseln?" mit Fokus auf „Änderungen
  behalten"; 10× 2D ↔ 3D → stets genau 1 bzw. 0 Canvas; Konsole ohne Fehler, Backend ohne
  Fehler; zwei Benutzer im selben Browser: Admin mm, Planerin cm, nach Rückwechsel Admin
  weiter mm.
* **Per Datenbank geprüft:** genau eine neue Zeile an der Wohnen-Wand (3525 mm), keine an der
  Küchenwand; Projekt 15 → 16 Öffnungen.
* **Nicht visuell geprüft:** Der Browserbereich war während der Abnahme verborgen; WebGL-Bilder
  und Screenshots wurden nicht gezeichnet. Die 3D-Auswahl einer gemeinsamen Öffnung ist nur
  automatisiert geprüft. Pointer Capture lässt sich mit seitenseitig erzeugten Ereignissen im
  Browser nicht beobachten (Chromium gewährt sie nur echten Zeigern) – automatisiert geprüft.
* **Befund behoben:** Kollisionsmeldung „mit der vorhandenen Fenster" → artikelgerecht
  („dem vorhandenen Fenster"), mit Regressionstest.

---

## Task 0020 – Phase 4c.1: Frontend auf Tailwind CSS, Theme-Grundlage

**Datum:** 2026-09-29 · **Stand:** umgesetzt, **nicht committet** (Ausgangsstand `ce57492`,
Arbeitsbaum vorher sauber; Sicherung als Archiv im Scratchpad)

### Anlass

Die Gestaltung lag in einer globalen `styles.css` (553 Zeilen, ~267 Regelblöcke,
BEM-Klassen für Core, Plattform und Electrical gemischt). Neue Oberfläche soll einen
einheitlichen Weg haben, und Phase 4c.2 soll Farben persönlich einstellbar machen, ohne
Komponenten umzuschreiben. Ausdrücklich **kein Redesign**, keine Verhaltensänderung.

### Umsetzung

1. **Tailwind CSS 4.3.3** + `@tailwindcss/vite` 4.3.3 (devDependencies, Lockfile inkl.
   Linux-musl-Binärdatei für das Alpine-Image). CSS-first in `src/styles.css`: nur
   `theme.css` und `utilities.css`, **kein Preflight** (hätte Überschriften, Listen und
   Knöpfe zurückgesetzt), `source("./")`. Die zunächst eingeführte Ausschlussliste
   `@source not inline(...)` ist in einer Nachkorrektur wieder entfernt: Sie hätte gültige
   Utilities wie `hidden` oder `fixed` bei späterer Verwendung stillschweigend aus dem Build
   entfernt.
2. **Tokens** (`core/theme/tokens.css`): `--ep-*` für Seite, Oberfläche, Dialog,
   Navigation, Rahmen, Text, gedämpft, Akzent/Hover/Kontrast, Fokus, Auswahl, Erfolg,
   Warnung, Fehler, Zeichenfläche, Raster, Backdrop, Radius – hell/dunkel mit den
   bisherigen Werten; `@theme inline` → `bg-surface`, `text-muted` …; Standardpalette
   abgeschaltet. **Grundregeln** (`core/theme/basis.css`).
3. **Rezepte** (`core/ui/stil.ts`): `knopf()`, `eingabefeld()`, `meldungsflaeche()`,
   `karte()`, `reiter()`, Konstanten für Feld, Formularraster, Feldzeile, Tabelle,
   Kennwerte. **`DialogAktionen`** ersetzt `.dialog__aktionen` (typisiert, `anordnung`).
4. **Migration** in der beauftragten Reihenfolge: Shell/Startseite → Core-Bausteine →
   Anmeldung/Einladung → Kunden/Projekte → Formulare, Dialoge, Combobox, Seiten →
   Verwaltung → Projektstruktur → Electrical-Räume → 2D-Editor → 3D-Ansicht. Dynamische
   Klassen (`marke--${art}`, `grundriss__status--${status}`,
   `grundriss__oeffnung--${art}`) durch statische Zuordnungen ersetzt.
5. **Electrical** behält fachliche Darstellung im Modul: `editor/grundriss.css`
   (SVG-Zeichenfläche, Tokens `--ep-plan-*`), vom Editor importiert, eigener CSS-Chunk.
6. **Tests** an vier Stellen von Klassennamen auf Semantik umgestellt
   (`[data-dialog-aktionen]`, `[role=alert]`, Rezeptvergleich für Hauptknopf, Reiter und
   Feldzeile); Anzahl unverändert 622.
7. **Docker:** Planner-Image neu gebaut; der Container kompiliert Tailwind
   (`/workspace/apps/planner/src/styles.css`, v4.3.3).

### Befund während der Migration (behoben)

`[font:inherit]` im Knopf-Rezept überschrieb als Kurzschreibweise `font-semibold`
(Tailwind sortiert nach Eigenschaft, nicht nach `className`) – die aktive Seitenzahl verlor
ihr Fettgewicht. Lösung: `font: inherit` für Formularelemente als Grundregel in
`basis.css`; Rezepte setzen keine Schrift-Kurzschreibweise mehr.

### Visueller Vergleich

Vorher (Stand `ce57492`) und nachher wurden im Browserbereich für jedes sichtbare Element
Position, Größe und 28 berechnete Stileigenschaften (Farben, Rahmen, Abstände, Schrift,
Display, Overflow, SVG-Füllung/Strich …) erfasst und verglichen: 19 Seiten und Zustände,
33 Vergleiche (dunkel 1280 px, dunkel 420 px, hell 1280 px) – Startseite, Kundenliste,
Kundendetail, Projektliste, Projektdetail mit drei Reitern, 2D-Editor ohne/mit Auswahl,
3D-Ansicht, Tabellenansicht, Benutzerliste, Mitglied, Rollen, System, Protokoll,
Projektdialog, Combobox mit Vorschlägen, Einstellungsdialog.
**Ergebnis:** keine Farb-, Abstands-, Rahmen- oder Layoutabweichung. Verbleibende
Unterschiede: Messbedingungen (Pixelverhältnis 1,25 ↔ 1 → Rahmen 0,8/1 px, bis 4 px
aufsummierte Rundung), neue Daten (Anmeldezeit, Protokolleinträge),
Kontrollkästchen/Optionsfelder erben die Schriftgröße (ohne sichtbare Wirkung),
`rounded-full` statt `999px`, Schatten in Tailwind-Notation. Die Vergleichsdaten liegen
nur im Browserspeicher des Browserbereichs, nicht im Repository.

**Funktional im Browser geprüft:** Anmeldung (nach Ablauf der Sitzung), Dialog modal mit
Fokusfalle, ein Scrollbereich, angeheftete Aktionen, Seitensperre, Escape und
Fokusrückgabe; Combobox mit Pfeiltaste (aktive Option mit Auswahlrahmen); Seiten;
Einstellungen cm → mm → cm (2D-Maße „5.000 mm"/„500 cm"); Navigationsschutz mit eigener
Rückfrage (Fokus „Änderungen behalten"), Verwerfen ohne Speichern; Zoom und Zurücksetzen;
4× 2D ↔ 3D stets genau ein bzw. kein Canvas, Canvasgröße = Fläche, WebGL2-Kontext;
Benutzertabelle blendet bei 420 px „Letzte Anmeldung" aus; mobiler Dialog vollflächig.

**Nicht geprüft:** Bildschirmfotos und sichtbares WebGL-Bild – der Browserbereich war
verdeckt (Bilder werden dann nicht gezeichnet, Animationsbilder laufen nicht). Vorher-
Bildschirmfotos existieren deshalb nicht; Ersatz ist der Stilvergleich.

### Messwerte

| Messung | vorher | nachher |
|---|---|---|
| Produktions-CSS | 20,24 kB (4,69 kB gzip), ein Bundle | 17,37 kB (4,22 kB gzip) Haupt + 3,75 kB (0,94 kB gzip) Editor-Chunk (mit Ausschlussliste waren es 15,22 kB / 3,86 kB) |
| CSS-Regelblöcke (handgeschrieben) | ~267 in `styles.css` | 13 in `core/theme/` (Tokens, Grundregeln) + 43 in `grundriss.css` (davon ~39 SVG-Regeln, nur mit dem Editor geladen); ~215 globale Regeln durch Utilities/Rezepte ersetzt |
| Frontendtests | 622 | 622 |

### Offene Punkte

Sichtprüfung mit Bildschirmfotos und WebGL-Bild; helle Warnfarbe (3,3 : 1) und Rahmen
unter WCAG AA (Bestand); 3D-Szene noch nicht an Tokens angebunden; waagrechte Überbreite
bei schmalen Fenstern (Bestand, Ursache gemessen). Details: `docs/current-status.md`.

### Nächster sinnvoller Schritt

Prüfung durch den Auftraggeber, dann Commit auf Freigabe. Danach Phase 4c.2 planen.

---

## Task 0021 – Phase 4c.2: persönliche Darstellung, Laufzeitthemes, responsive Nachkorrektur

**Datum:** 2026-09-30 · **Stand:** umgesetzt, **nicht committet** (Ausgangsstand `02e4017`
= `origin/main`, Arbeitsbaum sauber; Sicherung als Archiv im Scratchpad)

### Umsetzung

1. **Core-Modell** `core/theme/darstellung.ts`: `modus` (`system`/`light`/`dark`), `akzent`
   (`blue`/`teal`/`green`/`violet`/`orange`), Speicherformat
   `{"version":1,"modus":…,"akzent":…}` unter `elektroplan.darstellung.<user_id>`,
   Validierung je Feld, Vorschau-Schicht, `useDarstellung` (`useSyncExternalStore`) und
   `darstellungAbonnieren`. Wurzelattribute `data-theme`, `data-theme-mode`, `data-accent`,
   `color-scheme`. `darstellungStarten()` in `main.tsx` beobachtet `prefers-color-scheme`
   und `storage`. `AuthProvider` meldet nur die `user_id` (wie bei der Maßeinheit).
2. **CSS:** dunkle Werte an `:root[data-theme="dark"]`, minimaler Rückfall vor dem
   Skriptstart; `akzente.css` mit fünf Schemata für jedes Element mit `data-accent`
   (Farbmuster im Dialog nutzen dieselben Regeln); neuer Token `--ep-border-control`;
   Warnfarbe `#946000`; `accent-color` für Kontrollkästchen.
3. **Dialog:** Darstellung, Akzentfarbe, Maßeinheit; Vorschau, Übernehmen, Abbrechen
   (auch Escape/✕), Auf Standard zurücksetzen. **Entscheidung:** Die Maßeinheit verhält
   sich wie die übrigen Einstellungen (Vorschau, Speichern mit „Übernehmen") – dafür hat
   `masseinheit.ts` eine Vorschau-Schicht erhalten.
4. **Electrical:** `modules/electrical/darstellung.css` bündelt 2D- und 3D-Tokens (hell und
   dunkel über `data-theme`). 3D: `Umgebung.dunkel()` ersetzt durch `farben()` und
   `farbwechselBeobachten()`; `Grundrissszene.setzeFarben()` ändert Materialfarben und
   Hintergrund, ersetzt nur das Raster, fordert höchstens ein Bild an.
5. **Responsiv:** Benutzerblock der Kopfzeile bricht um, Hauptbereich `min-w-0`,
   Kartenköpfe und Blätterleiste der Benutzerliste umbrechend, Tabellenhülle
   `max-w-full min-w-0`.

### Tests

31 neue bzw. angepasste Prüfungen: Speicherformat und Validierung, zwei Benutzer,
Abmelden, Tab-Synchronisierung, gesperrter Speicher, System/Hell/Dunkel mit `matchMedia`,
Akzent, Vorschau; Dialog (Gliederung, Vorschau, Abbrechen mit Fokusrückgabe, Escape,
Übernehmen, Zurücksetzen, erneutes Öffnen); Maßeinheit-Vorschau; 3D (Farben beim Start,
Wechsel ohne neue Szene/Canvas mit einem Bild, 20 Wechsel ohne Wachstum, Abmeldung beim
Entsorgen); 3D-Komponente mit echter Core-Schnittstelle (kein React-Render, ein Canvas);
Tabellenhülle der Benutzerliste. Ein bestehender Test (Maßeinheit sofort gespeichert) an
das neue Übernehmen-Verhalten angepasst. Gesamt **653** Frontendtests grün; TypeScript,
ESLint, Modulgrenzen, API-Drift, Produktionsbuild grün. Backend unverändert, kein
Backendlauf.

### Messwerte

| Messung | vorher (4c.1) | nachher |
|---|---|---|
| Produktions-CSS Haupt | 17,37 kB (4,22 kB gzip) | 19,66 kB (4,67 kB gzip) |
| Electrical-Chunk-CSS | 3,75 kB (0,94 kB gzip) | 4,17 kB (1,08 kB gzip) |
| Warnung hell / Oberfläche | 3,3 : 1 | 5,3 : 1 |
| Kontrollrahmen hell / dunkel | ~1,3 : 1 | 3,3 : 1 / 3,4 : 1 |

### Browserabnahme

**Nicht durchgeführt.** Der Browserbereich war verdeckt, und die Navigation zu
`localhost:5173` wurde abgelehnt (Freigabe nicht erteilt). Keine Vergleichsbilder, keine
Messung bei 320/360/420 px. Offene Prüfliste: `docs/current-status.md`, Technische Schulden.

### Nächster sinnvoller Schritt

Sichtbare Browserabnahme; danach Commit auf Freigabe.
