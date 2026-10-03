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

**Teilnehmer-Contracts** sind die synchrone Ausnahme für vom Core koordinierte Vorgänge:
`ProjectContentParticipant` (Projektlöschung, ADR 0020) und seit Phase 4f
`FloorCeilingHeightParticipant` (Prüfung einer neuen Geschoss-Standardhöhe, nur lesend,
ADR 0022). Beide laufen in der Transaktion des Core unter der Projektsperre und werden über
`ModuleDescriptor.provides` gebunden.

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

### Das Projekt ist die Sperrwurzel

Eine Vorabprüfung allein hält keine Invariante, die zwei Transaktionen gemeinsam
verletzen können. Für alles unterhalb eines Projekts gilt deshalb:

> **Jeder schreibende Zugriff auf ein Projekt oder eine seiner Unterressourcen sperrt
> zuerst die Projektzeile (`SELECT … FOR UPDATE`) — der Statuswechsel eingeschlossen.**

Die Regel steht **einmal** im Core, in
`ProjectService.lock_writable`. Fachmodule erreichen sie über den öffentlichen
Erweiterungspunkt `app/core/projects/planning.py`; sie bauen nichts nach und kennen
keine Projektmodelle.

**Verbindliche Sperrreihenfolge — überall dieselbe:**

```
Projekt  ──▶  (Kunde, nur wenn er wechselt)  ──▶  Unterressource
                                                  (Gebäude, Geschoss, Raum, Wand,
                                                   Öffnung, Datei)
```

Die umgekehrte Richtung ist verboten. Ein Weg, der erst einen Raum und dann das Projekt
sperrt, während ein anderer Projekt → Raum sperrt, wäre eine Deadlock-Quelle — und war
genau die Lücke, die in Phase 3.1 geschlossen wurde. Ein Pfad, der eine Kundenzeile hält
und danach auf eine Projektzeile wartet, existiert nicht; der Zyklus ist damit
ausgeschlossen (Einzelheiten in `docs/database.md`, „Sperrreihenfolge und
Nebenläufigkeit").

**Verhalten bei gleichzeitiger Archivierung.** Es gibt genau zwei serialisierbare
Ausgänge:

| Wer die Projektsperre zuerst erhält | Ergebnis |
|---|---|
| die Fachänderung | Sie committet vollständig. Die Archivierung wartet und läuft danach durch. |
| die Archivierung | Sie committet. Die wartende Fachänderung liest anschließend den neuen Status und wird mit `409 project-archived` abgelehnt. |

**Ausgeschlossen** ist der dritte Fall: eine Änderung, die nach abgeschlossener
Archivierung committet. Die Zusage gilt unter echter Parallelität und ist mit zwei
Threads, zwei Sessions und Prüfung des Datenbankzustands belegt
(`tests/test_archive_concurrency.py`).

**Eine Sperre überdauert keinen externen Aufruf.** Der Datei-Upload prüft die
Projektzuordnung zuerst **ohne** Sperre (frühe, unverbindliche Absage), überträgt danach
in den Object Storage und sperrt die Projektzeile erst unmittelbar **vor** dem Commit.
Eine Datenbanksperre über eine S3-Übertragung hinweg zu halten wäre der falsche Tausch:
Sie würde jede parallele Änderung am Projekt für die Dauer des Uploads blockieren.
Scheitert die Prüfung, wird zurückgerollt und das bereits geladene Objekt verworfen.

**Endgültiges Löschen eines Projekts (Phase 4d, ADR 0020)** reiht sich in dieselbe
Sperrwurzel ein: Projektzeile sperren → `If-Match` → Status → Inhalte über Core und
Teilnehmer des Löschschutz-Protokolls → Berechtigung → Teilnehmer löschen → Nachkontrolle
→ Storage-Schlüssel vormerken, Dateizeilen löschen → Projekt löschen → Commit → Storage
aufräumen. Gewinnt ein Schreibvorgang die Sperre, sieht die Löschung seinen Inhalt; gewinnt
die Löschung, findet der Schreibvorgang das Projekt nicht mehr (`404`). Belegt in
`tests/test_deletion_concurrency.py`.

**Berühren ohne Versionssprung.** Schreibvorgänge unterhalb des Projekts (Gebäude,
Geschosse, Dateien, Planungsdaten der Fachmodule) setzen unter der gehaltenen
Projektsperre `updated_at` und `updated_by_user_id` des Projekts per gezieltem `UPDATE`
(`ProjectService.touch`, für Module `FloorPlanningAccess.record_project_change`). Die
Projektversion bleibt unverändert: Sie schützt Stammdaten und Status, nicht die
Unterressourcen.

---

## 8. Mandantenfähigkeit

> **Seit Phase 4e (ADR 0021):** Persönliche Einstellungen und Reset-Links sind
> mandantenbezogene Tabellen je Mitgliedschaft (`organization_id`, zusammengesetzte
> Fremdschlüssel). Der Lebenszustand eines Benutzers (`active`, `disabled`, `removed`) hängt
> an der Mitgliedschaft; Kontoänderungen durch einen Betrieb nur bei Konten, die keinem
> anderen Betrieb angehören. Access und Refresh Token tragen die Sitzungsversion der
> Mitgliedschaft.

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
    theme/        semantische Laufzeit-Tokens und Grundregeln (Phase 4c.1, ADR 0018)
    ui/stil.ts    Tailwind-Klassenrezepte für wiederkehrende Muster
  styles.css      Einstiegspunkt: Tailwind (Theme + Utilities, ohne Preflight) + Theme
  modules/
    electrical/   index.ts exportiert PlannerModule-Descriptor
      editor/     grafischer 2D-Editor (Phase 4a): reine Geometrie-, Viewport-,
                  Fang- und Werkzeugfunktionen, Reducer, SVG-Zeichenfläche
      ansicht3d/  abgeleitete 3D-Ansicht (Phase 4b): reine Szenenmodell-Aufbereitung,
                  Three.js-Geometrien, imperative Szenenschicht, React-Ansicht (lazy)
      topologie/  gemeinsame, reine Wandtopologie für 2D und 3D (Phase 4b.2): atomare
                  Wandabschnitte, abgeleitete Raumverbindungen von Öffnungen
    materials/ calculation/ offers/ work-orders/
  modules/index.ts  statische Registrierung aller Module
```

**Router und Navigationsschutz (seit Phase 4a.1).** Die Anwendung läuft auf dem Data
Router (`createBrowserRouter`) mit einer einzigen Splat-Route; darunter entstehen die
Routen weiter dynamisch aus der Modul-Registry (`<Routes>` in `AuthenticatedApp`). Der
Data Router ist nötig, weil nur er Navigation — auch Browser-Zurück und -Vorwärts —
blockieren kann. `core/ui/Navigationsschutz.tsx` ist genau einmal unterhalb des
`RouterProvider` eingehängt und fachneutral: Er fragt nur die Meldestelle
`core/ui/ungespeichert.ts`, ob irgendwo ungespeicherte Änderungen bestehen.

**Grafischer Editor (Phase 4a, ADR 0014).** Der Editor gehört vollständig zum
Fachmodul `electrical`; der Core enthält davon nichts. Neue Core-Bausteine sind
fachneutral: `core/ui/ungespeichert.ts` meldet „es gibt ungespeicherte Änderungen" an
Browser (`beforeunload`), Projekt-Tabwechsel und Abmelden, `core/ui/Navigationsschutz.tsx`
an den Router — ohne zu wissen, was ungespeichert ist. Der Editor liest den Planungsstand über
`GET /floors/{id}/plan` und schreibt eine Raumgeometrie über den atomaren Befehl
`PUT /rooms/{id}/contour`. Der lokale Entwurf ist keine zweite Datenhaltung: Er entsteht
aus dem Serverstand und wird nach dem Speichern durch die Serverantwort ersetzt.

**Imperative 3D-Szenenschicht (Phase 4b, ADR 0016).** Three.js lebt ausschließlich im
Fachmodul `electrical` (`ansicht3d/`), nicht im Core und nicht in einem eigenen Paket
(kein zweiter Consumer). React hält nur fachliche Daten und eine kleine Auswahlreferenz;
eine Klasse (`Grundrissszene`) besitzt Renderer, Szene, Kamera und Controls von der
Erzeugung bis `entsorgen()`. Sie wird einmal je Mount erzeugt, über gezielte Aufrufe
(`setzePlan`, `setzeAuswahl`, Kamerabefehle) aktualisiert und rendert nur auf
Anforderung — kein React-State pro Frame, keine Neuerzeugung bei Renders oder Resize.
Renderer, Controls, Bildtakt und Größenbeobachtung werden injiziert und sind in Tests
ersetzt. Die Umwandlung Plan → Szenenmodell ist reine, ganzzahlige Logik ohne DOM, WebGL
oder React; erst die Geometrieschicht rechnet Millimeter in Meter um. Die 3D-Ansicht
schreibt nichts.

**Gemeinsame Wandtopologie (Phase 4b.2, ADR 0016).** 2D-Editor und 3D-Ansicht leiten
gemeinsame Wandabschnitte und die Raumverbindung von Öffnungen aus **einer** reinen
Schicht ab (`modules/electrical/topologie/`): exakt kollineare Wände werden ganzzahlig und
ohne Toleranz in atomare Abschnitte zerlegt, jede gespeicherte Öffnung wird eingeordnet
(gemeinsam mit abgeleitetem Nachbarraum, außen, Konflikt). Die Schicht ist intern im
Fachmodul, ohne Core-Abhängigkeit und ohne Persistenz – eine Öffnung bleibt genau eine
Zeile an ihrer Wand; die Nachbarschaft ist Ansicht, kein Datum. Eine physische
Wandidentität (T10) ist vor Phase 6 neu zu bewerten.

**Gestaltung mit Tailwind (Phase 4c.1, ADR 0018).** Tailwind CSS 4 ist über das
offizielle Vite-Plugin eingebunden, CSS-first ohne `tailwind.config.js` und **ohne
Preflight** (sonst änderten sich Überschriften, Listen und Knöpfe). Zwischen Tailwind und
den Komponenten liegen semantische CSS-Variablen:

```
Komponente  className="bg-surface text-muted border-line"
    │
    ▼
@theme inline { --color-surface: var(--ep-surface); … }     core/theme/tokens.css
    │
    ▼
:root { --ep-surface: #ffffff }  :root[data-theme="dark"] { … }    ◀ Laufzeit
```

*So wird ein Token verwendet:* Utility mit dem semantischen Namen schreiben –
`bg-page`, `bg-surface`, `bg-raised`, `bg-nav`, `border-line`, `text-fg`, `text-muted`,
`border-control` (Umriss von Bedienelementen),
`bg-accent`/`hover:bg-accent-hover`/`text-on-accent`, `outline-focus`, `border-selected`,
`bg-selected-soft`, `text-success`, `text-warning`, `text-danger`/`bg-danger-soft`,
`bg-canvas`; Radius `rounded-ep`. In eigenem CSS (SVG) direkt `var(--ep-…)`. Wiederkehrende
Muster kommen aus `core/ui/stil.ts` (`knopf("primaer")`, `eingabefeld()`, `karte()` …).
Fehlt eine Bedeutung, wird ein Token in `tokens.css` ergänzt (fachliche Tokens im
Fachmodul), nie ein Farbwert in die Komponente geschrieben.

*Ausnahmen:* Die Tailwind-Standardpalette ist abgeschaltet; zulässig sind nur die
farbneutralen Schlüsselwörter `transparent` und `current` (`bg-transparent`,
`border-transparent`) sowie farbunabhängige Schatten (`shadow-popup`, `shadow-hint`).
Berechnete Werte – Popup-Lage, SVG-Cursor, Three.js-Materialien – werden weiter
programmatisch gesetzt; die 3D-Szene liest ihre Farben dafür aus den berechneten
`--ep-plan3d-*`-Tokens (siehe unten).

*Regeln:* Klassen vollständig und statisch im Quelltext (Varianten über
`Record<Art, string>`), keine Benutzerwerte in Klassennamen, keine Inline-Styles für
gewöhnliches Layout oder Farben. Spezial-CSS nur in `core/theme/basis.css` (globale
Grundregeln, Dialog-Backdrop) und in `modules/electrical/editor/grundriss.css`
(SVG-Zeichenfläche); fachliche Tokens des Electrical-Moduls in
`modules/electrical/darstellung.css`.

**Persönliche Darstellung (Phase 4c.2, ADR 0018 präzisiert, ADR 0019).** Benutzer wählen
Darstellungsmodus (Wie das System, Hell, Dunkel), eines von fünf geprüften
Akzentfarbschemata und die Maßeinheit. `core/theme/darstellung.ts` ist die einzige Stelle,
die Hell/Dunkel und Akzent entscheidet:

```
Einstellungsdialog ─ Vorschau/Übernehmen ─▶ core/theme/darstellung.ts
                                              │ setzt data-theme, data-theme-mode,
                                              │ data-accent, color-scheme an <html>
                                              ▼
       CSS-Tokens (tokens.css, akzente.css, electrical/darstellung.css) reagieren
                                              │
         useDarstellung() (React) ◀───────────┼──────────▶ darstellungAbonnieren()
                                                            └▶ 3D: Grundrissszene.setzeFarben()
```

* **Seit Phase 4e (ADR 0021) ist der Server die Wahrheit:** `GET/POST/PUT
  /me/preferences` je Mitgliedschaft. `core/einstellungen/persoenlich.ts` gleicht ab:
  Cache je Mitgliedschaft (`elektroplan.einstellungen.<member_id>`) sofort nach der
  Anmeldung, dann der Serverstand; einmalige Übernahme der alten lokalen Schlüssel, wenn der
  Server noch nichts hat; Speichern mit `If-Match`, ein Konflikt mit einem anderen Gerät wird
  erklärt. `darstellung.ts` und `masseinheit.ts` halten nur noch den wirksamen Zustand
  (`darstellungSetzen`, `masseinheitSetzen`) und lesen/schreiben keinen Speicher.
  `AuthProvider` meldet `user_id` und `member_id`. Ohne Anmeldung gilt der Standard.
  (Bis 4d: lokal je Benutzer, `elektroplan.darstellung.<user_id>`, ADR 0019.)
* Maßeinheiten `mm`, `cm`, `m` (seit 4e); umgerechnet wird ausschließlich in
  `core/masse.ts` ohne Fließkomma, gespeichert und übertragen immer ganze Millimeter.
* Im Modus „Wie das System" folgt die Anwendung `prefers-color-scheme` auch zur Laufzeit.
* Die 3D-Szene erhält Theme-Wechsel über die Umgebung (`ansicht3d/umgebung.ts`), liest die
  berechneten Tokens vom Wurzelelement und ändert nur Materialfarben, Hintergrund und
  Raster – ohne neue Szene und mit höchstens einem Bild.
* Fachmodule binden eigene Farben als Tokens an `data-theme` (hell auf `:root`, dunkel auf
  `:root[data-theme="dark"]`); Akzent über `--ep-accent`/`--ep-selected`, wo die Farbe
  keine fachliche Bedeutung trägt.

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
- **Löschen (Phase 4d):** Datenbank und Storage haben keine gemeinsame Transaktion. Beim
  Löschen eines Projekts werden die Schlüssel in derselben Transaktion in
  `storage_cleanup_jobs` vorgemerkt, in der die Dateizeilen verschwinden; nach dem Commit
  wird gelöscht, Fehler bleiben mit Versuchszähler stehen und werden über
  `python -m app.cli storage-cleanup` nachgeholt (ADR 0020).

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
