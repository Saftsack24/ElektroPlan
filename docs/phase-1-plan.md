# Phase 1 — Platform Foundation: Detailplan

Status: DONE (2026-09-18) · Ergebnis in `docs/task-history.md`, Task 0002 bis 0006
Voraussetzung: Phase 0 abgeschlossen

> Dieses Dokument ist der **Detailplan** von Phase 1 und bleibt als Beleg stehen.
> Der aktuelle Stand steht in `docs/current-status.md`.

Ziel dieser Phase: ein **tragfähiges Fundament**, auf dem alle weiteren Module ohne
Umbauten aufsetzen können. Keine Fachlichkeit, keine Elektroplanung, kein Material.

---

## 1. Was am Ende funktioniert

1. `docker compose up` startet PostgreSQL, MinIO, Backend und Planner.
2. Ein Benutzer meldet sich an und sieht seine Organisation.
3. `GET /api/v1/me` liefert Benutzer, aktive Organisation, Rollen und Permissions.
4. Ein Benutzer kann Daten einer anderen Organisation nachweislich nicht erreichen.
5. Die Module Registry verweigert den Start bei ungültiger Modulkonfiguration.
6. Der Event Bus stellt nachweislich erst nach dem Commit zu.
7. Audit-Einträge entstehen für Anmeldung und Rechteänderungen.
8. Ein Beispielmodul ist registriert und erscheint als Projekt-Tab im Frontend.
9. Alle Qualitätswerkzeuge laufen grün.

## 2. Was ausdrücklich nicht dazugehört

Kunden, Projekte, Gebäude (Phase 2) · Elektroplanung · Material · Kalkulation · Angebote ·
Dateiupload-Oberfläche (nur Infrastruktur und API) · Passwort-Zurücksetzen per E-Mail ·
MFA · Benutzerverwaltungs-Oberfläche (Seed genügt) · Deployment-Pipeline.

---

## 3. Technologiefestlegungen für Phase 1

| Bereich | Wahl | Begründung |
|---|---|---|
| Python | 3.12+ | `StrEnum`, moderne Typsyntax |
| Paketmanager | `uv` | schnell, ein Lockfile, reproduzierbar |
| Web | FastAPI + Uvicorn | vorgegeben |
| ORM | SQLAlchemy 2.0 (typisiert, `Mapped[...]`) | vorgegeben |
| Migrationen | Alembic, ein Strang | ADR 0002 |
| Validierung | Pydantic v2 + `pydantic-settings` | Contracts und Konfiguration |
| Passwort | `argon2-cffi` (Argon2id) | Stand der Technik |
| Token | `pyjwt` | schlank |
| Logging | `structlog` (JSON) | Request-Korrelation |
| Tests | `pytest`, `pytest-asyncio`, `httpx`, `testcontainers` oder Compose-DB | echte PostgreSQL im Test, kein SQLite |
| Lint/Format | `ruff` | ein Werkzeug für beides |
| Typen | `mypy --strict` für `app/` | Fehler früh |
| Grenzen | `import-linter` | ADR 0001 |
| Frontend | React 19, TypeScript strict, Vite | vorgegeben |
| Datenabruf | TanStack Query | vorgegeben |
| Formulare/Validierung | React Hook Form + Zod | vorgegeben |
| Routing | React Router (Data Router) | Lazy Routes je Modul |
| API-Client | `openapi-typescript` (generiert) | ADR 0009 |
| Geld im Frontend | `decimal.js-light` | ADR 0005 |
| Paketmanager JS | `pnpm` Workspaces | Monorepo ohne Turborepo im MVP |

**Nicht in Phase 1:** Redis, Celery, Turborepo, Storybook, E2E-Framework, Sentry.

---

## 4. Aufgabenliste

Reihenfolge ist bindend; jede Aufgabe endet mit grünen Prüfungen und einem Eintrag in
`docs/task-history.md`.

### T-0001 — Monorepo und Werkzeuge
Ordnerstruktur (`apps/`, `packages/`, `infrastructure/`, `docs/`), `.gitignore`,
`.editorconfig`, `pnpm-workspace.yaml`, `pyproject.toml` mit `uv`, `ruff`- und
`mypy`-Konfiguration, `Makefile` bzw. `tasks.ps1` mit `install`, `lint`, `typecheck`,
`test`, `migrate`, `dev`.
**Fertig, wenn:** `make lint` und `make typecheck` in einem leeren Projekt grün laufen.

### T-0002 — Docker Compose
PostgreSQL 17, MinIO (+ Bucket-Init), Backend, Planner. `.env.example`, Healthchecks,
benannte Volumes.
**Fertig, wenn:** `docker compose up` alle Dienste gesund startet und der Planner das
Backend erreicht.

### T-0003 — Backend-Grundgerüst
App-Factory, typisierte Settings, `/health/live`, `/health/ready`, Request-ID-Middleware,
strukturiertes JSON-Logging, globaler Fehler-Handler nach RFC 9457.
**Fertig, wenn:** Ein provozierter Fehler liefert `application/problem+json` mit
`request_id` und ohne Stacktrace.

### T-0004 — Datenbankschicht
Declarative Base mit Naming Convention, Session-Handling, Mixins (`UUIDPrimaryKey`,
`Timestamped`, `Versioned`, `TenantScoped`, `SoftDeletable`, `Authored`), Alembic-Setup,
Erweiterungen `pgcrypto` und `citext`.
**Fertig, wenn:** Eine Beispielmigration läuft und `alembic heads` genau einen Head liefert.

### T-0005 — Unit of Work und Event Bus
`UnitOfWork` mit Event-Sammlung, Post-Commit-Zustellung, Tabelle `domain_events`,
Subscription-Registrierung, Zyklusprüfung, Fehlerisolierung.
**Fertig, wenn:** Tests belegen: kein Event nach Rollback, Handler-Fehler bricht den
Auslöser nicht ab, Zyklus verhindert den Start.

### T-0006 — Module Registry
`ModuleDescriptor`, `PortBinding`, Registry mit allen Startprüfungen aus
`docs/modules.md` Abschnitt 5, Router-Einhängung, `GET /api/v1/modules`.
**Fertig, wenn:** Eine künstlich fehlerhafte Konfiguration (Zyklus, doppelter Präfix,
falsche Richtung) den Start mit klarer Meldung verhindert.

### T-0007 — Core-Datenmodell
`organizations`, `users`, `organization_members`, `roles`, `permissions`,
`role_permissions`, `member_roles`, `refresh_tokens`, `organization_modules`,
`number_sequences`, `audit_entries`. Migration und Seed (Systemrollen, Permissions,
Demo-Organisation, Demo-Benutzer).
**Fertig, wenn:** Der Seed läuft idempotent; zusammengesetzte Fremdschlüssel sind gesetzt.

### T-0008 — Authentifizierung
Argon2id, `POST /auth/login`, `POST /auth/refresh` (Rotation + Diebstahlserkennung),
`POST /auth/logout`, `GET /api/v1/me`, `POST /auth/switch-organization`,
Rate Limiting auf Login.
**Fertig, wenn:** Ein wiederverwendeter Refresh-Token invalidiert die gesamte Familie
(Test).

### T-0009 — Autorisierung
Permission-Registry aus Modulen, `require_permission()`-Dependency, Rollenauflösung je
Request, Test, der eine Route ohne Permission-Deklaration meldet.
**Fertig, wenn:** Der Sweep-Test alle schreibenden Routen abdeckt.

### T-0010 — Mandantentrennung
Request-Kontext mit Organisation, `TenantRepository`, `MissingTenantContext`,
Sweep-Test über alle Routen mit zwei Organisationen, RLS-Vorbereitung dokumentiert.
**Fertig, wenn:** Fremde IDs liefern durchgängig `404`, nie `200` mit Inhalt.

### T-0011 — Audit
`AuditService` mit expliziten Aufrufpunkten (Anmeldung, fehlgeschlagene Anmeldung,
Rechteänderung), unveränderliche Einträge, `GET /api/v1/audit` mit Permission.
**Fertig, wenn:** Anmeldung und Rollenänderung erzeugen nachvollziehbare Einträge.

### T-0012 — Object Storage
S3-Client, Bucket-Initialisierung, Key-Schema, `files`-Tabelle, Upload- und
Download-Endpunkte mit zeitlich begrenzten URLs, Typ- und Größenprüfung.
**Fertig, wenn:** Eine Datei ist hochladbar, wiederauffindbar und für eine fremde
Organisation nicht erreichbar.

### T-0013 — Qualitätsschranken
`import-linter`-Contracts, Tabellenpräfix-Test, Money-/Float-Test, OpenAPI-Drift-Check,
`alembic heads`-Prüfung, alles in einem Skript gebündelt.
**Fertig, wenn:** Ein absichtlicher Grenzverstoß bricht die Prüfung.

### T-0014 — Frontend-Grundgerüst
Vite + React + TS strict, Router, QueryClient, Auth-Kontext mit Token-Refresh,
Layout-Shell (Kopfzeile, Navigation, Organisationsanzeige), Login-Seite,
Fehler- und Ladezustände, Design-Grundlagen (Farben, Abstände, Typografie).
**Fertig, wenn:** Anmeldung, Sitzungserneuerung und Abmeldung funktionieren.

### T-0015 — Frontend-Modulregistrierung
`PlannerModule`-Typ, Registry, Sichtbarkeitsprüfung über `/me/modules` und Permissions,
Lazy Routes, ESLint-Grenzregeln, ein Beispielmodul mit Projekt-Tab.
**Fertig, wenn:** Ein neues Modul benötigt genau eine Zeile in `modules/index.ts`.

### T-0016 — API-Client-Erzeugung
OpenAPI-Export, `openapi-typescript`, `packages/api-client`, typisierter Fetch-Wrapper
mit Fehlerbehandlung nach RFC 9457, Money-Helfer.
**Fertig, wenn:** Der Drift-Check bricht bei einer Backend-Änderung ohne Neugenerierung.

### T-0017 — Testfundament
Pytest-Konfiguration, Testdatenbank, Transaktions-Rollback je Test, Fabriken für
Organisation/Benutzer/Rolle, Hilfsfunktionen für authentifizierte Anfragen, Frontend-Tests
mit Vitest und Testing Library.
**Fertig, wenn:** `make test` läuft in unter zwei Minuten und ist reproduzierbar grün.

### T-0018 — Abschluss und Dokumentation
`README.md` mit Startanleitung aktualisieren, `docs/current-status.md`,
`docs/task-history.md`, `docs/changelog.md`, `docs/roadmap.md` (Phase 1 → DONE),
Backup-/Restore-Vorgehen für die lokale Entwicklung dokumentieren.

---

## 5. Abhängigkeiten

```
T-0001 ─▶ T-0002 ─▶ T-0003 ─▶ T-0004 ─▶ T-0005 ─▶ T-0006
                                   └──▶ T-0007 ─▶ T-0008 ─▶ T-0009 ─▶ T-0010 ─▶ T-0011
                                                                              └─▶ T-0012
T-0013 begleitend ab T-0006
T-0014 ─▶ T-0015 ─▶ T-0016   (parallel ab T-0008 möglich)
T-0017 begleitend ab T-0007
T-0018 zum Abschluss
```

---

## 6. Definition of Done für Phase 1

| Kriterium | Prüfung |
|---|---|
| Alle T-Aufgaben abgeschlossen | `docs/task-history.md` |
| Backend-Tests grün | `make test` |
| Typprüfung grün | `mypy --strict app/`, `tsc --noEmit` |
| Lint grün | `ruff check`, `eslint` |
| Modulgrenzen grün | `lint-imports` |
| Genau ein Alembic-Head | `alembic heads` |
| Mandantentrennung nachgewiesen | Sweep-Test grün |
| Compose-Start dokumentiert und reproduzierbar | `README.md` |
| Dokumentation aktualisiert | Phase-1-Abschnitte in `current-status.md` |

---

## 7. Risiken dieser Phase

| Risiko | Gegenmaßnahme |
|---|---|
| Über das Ziel hinaus bauen (Kunden, Projekte „schnell mitnehmen“) | Abschnitt 2 ist bindend; Zusätzliches wird notiert, nicht gebaut |
| Zusammengesetzte Fremdschlüssel werden als lästig empfunden und weggelassen | In T-0004 in die Mixins eingebaut, damit sie der Standardweg sind |
| Das Berechtigungssystem wird zu flexibel entworfen | Permissions sind flache Schlüssel; keine Bedingungen, keine Vererbung |
| Frontend-Design bindet unnötig Zeit | Schlichte, funktionale Oberfläche; Gestaltung erst mit Phase 4a |
| Tests gegen SQLite statt PostgreSQL | Ausgeschlossen — Constraints und `numeric` verhalten sich anders |
