# Architektur

Version: 1.0 (Phase 0)
Stand: 2026-09-18
Verbindliche Entscheidungen: `docs/decisions/`
Kritische Vorprüfung: `docs/architecture-review.md`

---

## 1. Zweck und Leitgedanke

ElektroPlan ist eine **Plattform**, kein einzelnes Planungswerkzeug. Der wirtschaftliche
Wert entsteht nicht durch ein einzelnes Fachmodul, sondern dadurch, dass jedes Fachmodul
(Elektro, PV, KNX, Wallbox …) dieselbe Kette aus Material, Lager, Kalkulation, Angebot und
Auftrag benutzt.

> **Leitsatz:** Ein neues Fachmodul darf ausschließlich Fachwissen mitbringen.
> Alles, was es mit Material, Preisen, Lager, Angeboten und Aufträgen zu tun hat,
> muss es von der Plattform bekommen.

Alle folgenden Regeln dienen diesem einen Ziel.

---

## 2. Architekturstil: modularer Monolith

Ein Repository, ein Backend-Prozess, eine PostgreSQL-Datenbank, eine Authentifizierung.
Innerhalb dieses Prozesses existieren **scharf getrennte Module** mit eigenen Tabellen,
eigener API-Fläche und definierten Schnittstellen nach außen.

Begründung und Konsequenzen: [ADR 0001](decisions/0001-modular-monolith.md).

```
┌──────────────────────────────────────────────────────────────────────┐
│                         apps/planner (React)                         │
│   Shell · Module Registry (Frontend) · Projekt-Tabs · API-Client      │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ HTTPS / JSON (OpenAPI)
┌───────────────────────────────▼──────────────────────────────────────┐
│                      apps/backend (FastAPI, ein Prozess)             │
│                                                                      │
│  ┌─────────────────────── CORE ─────────────────────────────────┐    │
│  │ auth · organizations · users · customers · projects · files   │    │
│  │ audit · numbering · events (Bus) · module_registry            │    │
│  └───────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌─────────── SHARED BUSINESS MODULES ──────────┐                     │
│  │ materials · inventory · calculation ·         │                     │
│  │ offers · work_orders                          │                     │
│  │  ▲ definieren Ports, kennen keine Fachmodule │                     │
│  └───────────────────────────────────────────────┘                     │
│                        ▲ implementieren Ports                         │
│  ┌─────────── FACHMODULE ────────────────────────┐                     │
│  │ electrical    (später: pv, knx, wallbox …)    │                     │
│  └───────────────────────────────────────────────┘                     │
└──────────────────────────────────────────────────────────────────────┘
          │                        │                        │
   PostgreSQL 17            S3 / MinIO               (später: Android-App)
```

---

## 3. Die drei Ebenen

### 3.1 Core

Plattformfunktionen, ohne die nichts läuft. Der Core kennt **kein** Fachmodul und **kein**
Shared Business Module.

| Bereich | Inhalt |
|---|---|
| `auth` | Login, Token, Passwort-Hashing, Sessions |
| `organizations` | Mandanten, Mitgliedschaften, Modulaktivierung |
| `users` | globale Identitäten |
| `authorization` | Rollen, Permissions, Permission-Registry |
| `customers` | Kundenstamm |
| `projects` | Projekte, Gebäude, Geschosse |
| `files` | Upload, Object Storage, Verknüpfung zu Entitäten |
| `audit` | Nachvollziehbarkeit kritischer Aktionen |
| `numbering` | Belegnummern über gesperrte Sequenztabelle |
| `events` | Unit of Work + interner Event Bus |
| `module_registry` | Registrierung, Abhängigkeitsprüfung, Ports |

### 3.2 Shared Business Modules

Geschäftslogik, die von mehreren Fachmodulen benutzt wird. Sie kennen den Core und andere
Shared Modules (nur über deren Service-Contracts), aber **niemals ein Fachmodul**.

`materials` · `inventory` · `calculation` · `offers` · `work_orders`

### 3.3 Fachmodule

Fachliche Planungssysteme. Sie kennen Core und Shared Modules, aber **niemals ein anderes
Fachmodul**.

Jetzt: `electrical` — später: `pv`, `knx`, `wallbox`, `network`, …

### 3.4 Erlaubte Abhängigkeitsrichtungen

```
Fachmodul ──▶ Shared Business Module ──▶ Core
Fachmodul ──▶ Core
Shared ──▶ Shared   (nur über öffentliche Service-Contracts)

VERBOTEN:
Core ──▶ Shared          Core ──▶ Fachmodul
Shared ──▶ Fachmodul     Fachmodul ──▶ Fachmodul
```

Die Umkehrung "Shared braucht Daten aus einem Fachmodul" wird **nicht** durch einen Import
gelöst, sondern durch einen Port (Abschnitt 5).

Durchgesetzt wird das in CI über `import-linter` (Backend) und ESLint-Pfadregeln
(Frontend). Siehe `docs/modules.md`, Abschnitt "Durchsetzung".

---

## 4. Kommunikation zwischen Modulen

Es gibt genau drei erlaubte Wege:

| Weg | Wann | Beispiel |
|---|---|---|
| **Service-Contract** (synchroner Aufruf) | Ein Modul braucht *jetzt* eine Antwort oder eine Wirkung | `calculation` fragt `materials.PricingService.get_price(...)` |
| **Provider-Port** (Abhängigkeitsumkehr) | Ein Shared Module braucht Daten, die nur Fachmodule kennen | `materials` ruft alle `MaterialRequirementProvider` |
| **Domain Event** (Benachrichtigung nach Commit) | Ein Modul soll *reagieren*, ohne dass der Auslöser es kennen muss | `ElectricalPlanUpdated` → Materialbedarf als veraltet markieren |

**Verboten:**
- direkter Zugriff auf Tabellen eines anderen Moduls (auch lesend),
- Import von `models`, `repositories` oder internen Services eines anderen Moduls,
- Events als verkappte Befehle ("mach X" statt "X ist passiert").

Details: `docs/contracts.md` und `docs/events.md`.

---

## 5. Der zentrale Mechanismus: Provider-Ports

Das Problem: `materials` muss aus der Elektroplanung Materialbedarf ableiten, darf aber
`electrical` nicht kennen. Die Lösung ist Abhängigkeitsumkehr.

```python
# apps/backend/contracts/v1/material.py  (gehört zum Shared-Modul materials)
class MaterialRequirementProvider(Protocol):
    module_id: str
    def collect(self, ctx: ProjectContext) -> list[MaterialRequirementDraft]: ...

# apps/backend/modules/electrical/providers.py  (gehört zum Fachmodul)
class ElectricalMaterialProvider:
    module_id = "electrical"
    def collect(self, ctx: ProjectContext) -> list[MaterialRequirementDraft]:
        ...  # Geräte + Leitungswege -> Drafts
```

Die Registrierung erfolgt im `ModuleDescriptor` des Fachmoduls. Die Material Engine
iteriert über alle registrierten Provider — sie kennt nur den Port.

Drei Ports sind vorgesehen:

| Port | Definiert von | Implementiert von | Ergebnis |
|---|---|---|---|
| `MaterialRequirementProvider` | `materials` | jedem Fachmodul | Materialbedarf |
| `LaborRequirementProvider` | `materials` | jedem Fachmodul | Arbeitszeitbedarf |
| `OfferItemSuggestionProvider` | `offers` | jedem Fachmodul | Angebotspositionsvorschläge |

Mehr Ports werden erst eingeführt, wenn ein konkreter zweiter Anwendungsfall existiert.
Siehe [ADR 0003](decisions/0003-module-contracts-and-provider-ports.md).

---

## 6. Schichten innerhalb eines Moduls

```
api/           FastAPI-Router, HTTP-Schemas, Permission-Checks
services/      Geschäftslogik, Transaktionsgrenzen, Event-Erzeugung
repositories/  Datenzugriff, immer mandantengefiltert
models/        SQLAlchemy-Modelle (modulintern, nie exportiert)
schemas/       Pydantic-Schemas (Ein-/Ausgabe)
providers.py   Implementierungen fremder Ports
events.py      erzeugte Events und Subscriptions
permissions.py Permission-Definitionen des Moduls
tests/         Modultests
module.py      ModuleDescriptor
```

Regeln:
- `api` ruft **nur** `services`, nie `repositories` oder `models`.
- `services` besitzen die Transaktionsgrenze und erzeugen Events.
- `models` verlassen niemals das Modul. Was nach außen geht, ist ein Contract-Objekt.
- Eine Schicht wird nicht angelegt, wenn sie in einem Modul keinen Inhalt hätte.

---

## 7. Transaktionen und Unit of Work

Ein HTTP-Request = eine Unit of Work = eine Datenbanktransaktion.

```
Request ──▶ UoW öffnen ──▶ Service-Logik ──▶ Events sammeln ──▶ COMMIT
                                                                  │
                                                       ──▶ Events zustellen (nach Commit)
```

- Events werden **während** der Arbeit nur gesammelt, **nie** sofort zugestellt.
- Nach erfolgreichem Commit wird synchron im Prozess zugestellt.
- Ein Handler-Fehler wird geloggt und in `domain_events` vermerkt, aber **rollt den
  Auslöser nicht zurück**.
- Daraus folgt: Zustellung ist *at most once*. **Jede eventgetriebene Ableitung braucht
  einen idempotenten Recompute-Endpunkt.**

`domain_events` ist ein **Best-Effort-Protokoll**, ausdrücklich **keine transaktionale
Outbox**: Der Fachzustand wird zuerst committet, das Event danach in einer eigenen
Transaktion geschrieben. Ein Absturz dazwischen lässt das Event verschwinden.

Siehe [ADR 0004](decisions/0004-internal-event-bus.md) und
[ADR 0012](decisions/0012-event-delivery-guarantee.md).

---

## 8. Mandantenfähigkeit

Vier Ebenen, bewusst redundant — ein einzelner Fehler soll keinen Datenabfluss verursachen.

1. **Schema:** Jede mandantenbezogene Tabelle hat `organization_id NOT NULL`.
2. **Zusammengesetzte Fremdschlüssel:** Verweise laufen über `(organization_id, id)`, nicht
   über `id` allein. Damit ist ein mandantenübergreifender Verweis auf Datenbankebene
   unmöglich, nicht nur unerwünscht.
3. **Repository-Basisklasse:** `TenantRepository` setzt den Filter automatisch; ein Query
   ohne Organisationskontext wirft einen Fehler statt Daten zu liefern.
4. **Test-Sweep:** Ein Test iteriert über alle registrierten Routen und prüft mit zwei
   Testorganisationen, dass fremde IDs `404` liefern — nie `200`, nie `403` mit Inhalt.

Vorbereitet, aber im MVP nicht aktiv: PostgreSQL Row Level Security über
`SET LOCAL app.current_organization`.

`users` ist **global**; die Zugehörigkeit läuft über `organization_members`. Der aktive
Mandant steckt im Token und wird serverseitig gegen die Mitgliedschaft geprüft — niemals
aus einem Request-Parameter übernommen.

Siehe [ADR 0006](decisions/0006-tenant-isolation-and-data-separation.md).

---

## 9. Autorisierung

Autorisiert wird über **Permissions**, nicht über Rollennamen.

```
User ──▶ organization_member ──▶ role(s) ──▶ permissions
```

- Permission-Schlüssel: `<modul>.<objekt>.<aktion>`, z. B. `electrical.plan.write`,
  `inventory.stock.book`, `offer.version.approve`.
- Module registrieren ihre Permissions im `ModuleDescriptor`; beim Start werden sie
  abgeglichen.
- Jeder schreibende Endpunkt deklariert seine Permission explizit über eine Dependency.
  Ein Endpunkt ohne Permission-Deklaration gilt als Fehler und wird von einem Test
  gemeldet.
- Rollen (Admin, Planer, Kalkulator, Monteur, Lager, Einkauf) sind **Daten** pro
  Organisation, ausgeliefert als Seed.

---

## 10. Determinismus: Einheiten, Geld, Rundung

Falsche Zahlen sind in diesem Projekt schlimmer als fehlende Funktionen.

| Größe | Speicherung | Transport | Regel |
|---|---|---|---|
| Geometrie (Koordinaten, Höhen, Dicken) | `integer`, Millimeter | Integer | keine Floats, exakt reproduzierbar |
| Längen (Ergebnis) | `numeric(12,3)`, Meter | String | aus mm berechnet, dann konvertiert |
| Mengen | `numeric(14,3)` | String | Einheit immer mitführen |
| Einzelpreise | `numeric(12,4)` | String | vier Nachkommastellen (Meterware) |
| Summen | `numeric(12,2)` | String | kaufmännisch gerundet |
| Prozentsätze | `numeric(6,3)` | String | z. B. Verschnitt, Aufschlag |

**Rundungsreihenfolge** (verbindlich, testabgesichert):
1. Position: `menge × einzelpreis` → auf 2 Nachkommastellen, `ROUND_HALF_UP`.
2. Nettosumme: Summe der bereits gerundeten Positionen.
3. Steuer: je Steuersatzgruppe auf die Nettosumme dieser Gruppe, dann runden.
4. Brutto = Netto + Summe der gerundeten Steuerbeträge.

Geldbeträge werden über die API **als String** übertragen. Siehe
[ADR 0005](decisions/0005-money-rounding-and-quantities.md) und
[ADR 0007](decisions/0007-identifiers-and-geometry-units.md).

---

## 11. Einfrierpunkte (Snapshots)

Der Kern der wirtschaftlichen Korrektheit. Vier Zustände, klar getrennt:

| Stufe | Objekt | Lebt / friert | Was ist eingefroren |
|---|---|---|---|
| 1 | `material_requirements` | lebt | — (wird neu berechnet) |
| 2 | `calculations` Status `final` | friert | Mengen, Preise, Stundensätze, Zuschläge, Regeln |
| 3 | `offer_versions` | friert | Positionen, Verkaufspreise, Steuersätze, Firmendaten |
| 4 | `work_order_materials` | friert | Planmengen als Soll für den Soll/Ist-Vergleich |

Ein Snapshot ist ein unveränderliches JSONB-Dokument plus SHA-256-Prüfsumme. Ändert sich
die Planung nach dem Einfrieren, wird die Kalkulation als `is_stale` markiert — es ändert
sich **kein** eingefrorener Wert.

---

## 12. Datenfluss des Wertschöpfungspfads

```
electrical: Räume, Geräte, Leitungswege
      │  (Provider-Port, on demand)
      ▼
materials: Material Engine
      │  ServiceTemplates (Gerät → Stückliste + Zeit)
      │  globale Regeln  (Verschnitt, Verpackungsrundung)
      ▼
material_requirements   (required / planned / procurement)
      │
      ├────────────▶ inventory: Reservierung (ab Auftrag, Phase 12)
      ▼
calculation: Materialkosten + Lohnkosten + Zuschläge  ──▶ Snapshot bei "final"
      │
      ▼
offers: Angebotsversion (nur Verkaufspreise)          ──▶ Snapshot bei Freigabe
      │
      ▼
work_orders: Auftrag mit Soll-Material und Soll-Zeit
      │
      ▼
Baustelle: Ist-Verbrauch, Ist-Zeit  ──▶ Soll/Ist ──▶ Nachkalkulation
```

Jeder Pfeil ist ein Contract, kein Import.

---

## 13. Monorepo-Struktur

```
/apps
  /planner          React/Vite Weboberfläche
  /backend          FastAPI-Anwendung
  /android          Capacitor-App                     (ab Phase 13)
/packages
  /api-client       aus OpenAPI GENERIERT, nicht handgepflegt
  /ui               gemeinsame Komponenten            (ab Phase 13)
  /3d-engine        Three.js-Kapselung                (erst bei 2. Consumer)
/infrastructure
  docker-compose.yml, Dockerfiles, Init-Skripte
/docs
  siehe docs/README-Struktur unten
```

`packages/ui` und `packages/3d-engine` werden **erst angelegt, wenn ein zweiter Consumer
existiert**. Bis dahin lebt der Code in `apps/planner`.

### Backend

```
apps/backend/
  app/
    main.py                FastAPI-App-Factory
    config.py              pydantic-settings
    db/                    Session, Base, Mixins, Naming Convention
    core/
      auth/ organizations/ users/ authorization/
      customers/ projects/ files/ audit/ numbering/
      events/              Bus, Unit of Work, Outbox-Log
      module_registry/     Descriptor, Registry, Ports
    modules/
      materials/ inventory/ calculation/ offers/ work_orders/
      electrical/
    contracts/
      v1/                  QUELLE DER WAHRHEIT für Modul-Contracts
  migrations/              Alembic, EIN Strang für die gesamte DB
  tests/
```

### Frontend

```
apps/planner/src/
  app/            Bootstrap, Router, Providers, Layout-Shell
  core/           Auth, API-Client-Wrapper, Registry, gemeinsame UI
  modules/
    electrical/   index.ts exportiert PlannerModule-Descriptor
    materials/ calculation/ offers/ work-orders/
  modules/index.ts  statische Registrierung aller Module
```

---

## 14. Modulregistrierung

### Backend

```python
@dataclass(frozen=True)
class ModuleDescriptor:
    id: str                       # "electrical"
    name: str                     # "Elektroplanung"
    version: str                  # "1.0.0"
    kind: ModuleKind              # CORE | SHARED | DOMAIN
    depends_on: tuple[str, ...]
    table_prefix: str             # "electrical_"
    permissions: tuple[PermissionDef, ...]
    router: APIRouter | None
    subscriptions: tuple[Subscription, ...]
    provides: tuple[PortBinding, ...]
```

Die Registry prüft beim Start: eindeutige IDs, vorhandene Abhängigkeiten, keine Zyklen,
erlaubte Abhängigkeitsrichtung, eindeutige Tabellenpräfixe, namensraumkonforme
Permissions. Verstöße verhindern den Start — ein falsch verdrahtetes Modul soll nicht
"irgendwie" laufen.

Routen: Shared Modules unter `/api/v1/<resource>`, Fachmodule unter
`/api/v1/modules/<module-id>/...`.

### Frontend

```ts
export interface PlannerModule {
  id: string;
  name: string;
  version: string;
  dependsOn?: string[];
  routes?: RouteObject[];          // lazy geladen
  projectTabs?: ProjectTab[];      // { id, label, order, permission, element }
  navigation?: NavItem[];
  settingsSections?: SettingsSection[];
}
```

Alle Module werden in `modules/index.ts` **statisch** importiert und registriert
(kein Laufzeit-Plugin-System). Die Shell blendet einen Beitrag nur ein, wenn

1. das Modul für die Organisation aktiv ist (`GET /api/v1/me/modules`) **und**
2. der angemeldete Nutzer die verlangte Permission besitzt.

Ein neues Modul benötigt damit genau **eine** zentrale Änderung: eine Zeile in
`modules/index.ts`.

---

## 15. Dateien und Object Storage

- Speicherung in S3-kompatiblem Storage (lokal MinIO), Key-Schema
  `org/<org-id>/project/<project-id>/<file-id><ext>`.
- Metadaten in `files`, inklusive `sha256`, `content_type`, `size_bytes`.
- Download über zeitlich begrenzte, serverseitig autorisierte URLs — niemals über einen
  rein "geheimen" Pfad.
- Auslieferung nie unter dem Anwendungs-Origin, immer mit
  `Content-Disposition: attachment`.

---

## 16. Offline-Vorbereitung (ohne Vorbau)

Alle Geschäftsentitäten erhalten ab Phase 1: `id UUID`, `created_at`, `updated_at`,
`version integer` (optimistisches Sperren). Das genügt, um später zu synchronisieren, und
ist unabhängig davon sinnvoll.

`sync_status` und `client_txn_id` erhalten **nur** die Tabellen, die von der Baustellen-App
beschrieben werden — eingeführt in Phase 13/16. Ausnahme: `inventory_transactions` bekommt
`client_txn_id` (Unique) bereits bei der Ersteinführung, weil Idempotenz bei Buchungen
nachträglich teuer ist.

Welche Aggregate offline entstehen dürfen, wie Idempotenz, Versionierung, Tombstones und
die vier Konfliktklassen geregelt sind, steht in [`docs/offline-sync.md`](offline-sync.md).
Dort ist auch festgelegt, welche Konflikte automatisch und welche **nur manuell** gelöst
werden dürfen.

---

## 17. Fehlerbehandlung, Logging, Observability

- Fehlerformat: RFC 9457 Problem Details (`application/problem+json`), stabile
  `type`-Werte, keine Stacktraces, keine internen Bezeichner nach außen.
- Sicherheitsheader setzt das Backend für die **API**; die CSP der Planner-Auslieferung
  liegt beim Webserver, HSTS nur in Produktion bzw. am Reverse Proxy
  (`docs/security.md`, Abschnitt 12).
- Strukturiertes JSON-Logging mit `request_id`, `user_id`, `organization_id`, `module`.
- Health-Endpunkte: `/health/live`, `/health/ready`.
- Kein APM/Tracing-Stack im MVP.

Details: `docs/api.md`.

---

## 18. Sicherheitsgrenze Elektrotechnik

ElektroPlan trifft **keine** sicherheitsrelevanten elektrotechnischen Entscheidungen.
Querschnitte, Schutzorgane, Selektivität und Normkonformität werden nicht automatisch
ermittelt oder geprüft. Das System dokumentiert, rechnet und schlägt vor; die
verantwortliche Elektrofachkraft entscheidet. Diese Grenze darf nur über einen neuen ADR
mit ausdrücklicher fachlicher Freigabe verschoben werden.

---

## 19. Durchsetzung der Architektur

| Regel | Durchsetzung |
|---|---|
| Modulgrenzen (Python) | `import-linter`-Contracts in CI |
| Modulgrenzen (TS) | ESLint `no-restricted-imports` |
| Tabellenpräfixe | Test über Metadaten aller Modelle |
| Mandantentrennung | automatisierter Endpoint-Sweep mit zwei Organisationen |
| Kosten nicht im Angebot | Schema ohne Kostenspalten + Importtest im Renderpfad |
| Geld nie als Float | Test über alle `numeric`-Spalten und alle Money-Schemas |
| API/Client-Drift | OpenAPI-Diff-Check gegen generierten Client |
| Eine Migrationskette | `alembic heads` muss genau einen Head liefern |

Eine Regel ohne automatische Prüfung gilt in diesem Projekt als unverbindlich.

---

## 20. Ausdrücklich nicht Teil dieser Architektur

Microservices · externe Message Broker · Event Sourcing · CQRS mit getrennten Modellen ·
Microfrontends · Laufzeit-Plugin-Loader · Mehrwährungsfähigkeit · Lizenz-/Abrechnungslogik ·
generische Rule Engine · Caching-Schicht · automatische Normprüfung.

Jeder dieser Punkte kann später über einen ADR aufgenommen werden — nicht nebenbei.
