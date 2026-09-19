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
