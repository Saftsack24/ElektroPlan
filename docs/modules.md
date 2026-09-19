# Module, Grenzen und Registrierung

Version: 1.0 (Phase 0)

Dieses Dokument definiert, welche Module es gibt, was sie dürfen, was sie nicht dürfen und
wie sie sich registrieren.

---

## 1. Modullandschaft

| Modul | Art | Status | Präfix | Abhängig von |
|---|---|---|---|---|
| `core` | Core | Phase 1–2 | — | — |
| `materials` | Shared | Phase 7/8 | `material_`, `service_` | core |
| `inventory` | Shared | Phase 12 | `inventory_` | core, materials |
| `calculation` | Shared | Phase 9 | `calculation_` | core, materials |
| `offers` | Shared | Phase 10 | `offer_` | core, calculation |
| `work_orders` | Shared | Phase 11 | `work_order_` | core, offers |
| `electrical` | Fachmodul | Phase 3–6 | `electrical_` | **Phase 3–6: nur core** · ab Phase 7: core, materials |
| `pv` | Fachmodul | Phase 18/19 | `pv_` | core, materials |
| `knx`, `wallbox`, `network`, … | Fachmodul | offen | je eigen | core, materials |

---

## 2. Die eine Regel

> Ein Modul kennt von einem anderen Modul **ausschließlich** die Contracts unter
> `app.contracts.v1`. Es importiert **keinerlei** Code aus `app.modules.<anderes>` —
> weder dessen Paket-Root, `models`, `repositories`, `services`, `api`, `providers`,
> `schemas`, `domain` noch irgendein anderes Submodul. Modultabellen tragen **keine
> Fremdschlüssel** auf Tabellen anderer Module.

**`depends_on` ist keine Importerlaubnis.** Es beschreibt eine fachliche Abhängigkeit
und die Verdrahtungsreihenfolge in der Composition Root. Selbst wenn `electrical` in
`depends_on = ("core", "materials")` steht, darf `electrical` weder eine Python-Zeile
aus `app.modules.materials.*` importieren noch eine `materials_`-Tabelle per FK
referenzieren.

Modulübergreifende Kommunikation läuft ausschließlich über:

* veröffentlichte Contracts unter `app.contracts.v1` (Pydantic-Modelle bzw. `Protocol`),
* typisierte Ports und ihre Verdrahtung im `ModuleDescriptor` (siehe Abschnitt 4),
* Domain Events als *unverbindliche* Post-Commit-Reaktion (siehe `docs/events.md`).

Braucht ein Modul Daten aus einem anderen Modul, hält es dessen fachliche UUID
**ohne FK** in einer eigenen Spalte und validiert sie über den Contract.

### Erlaubt

```python
from app.contracts.v1.inventory import InventoryService, ReservationRequest
inventory.reserve(ReservationRequest(...))
```

### Verboten

```python
# Alle Formen sind gleichwertig verboten - unabhaengig von depends_on:
from app.modules.materials                            # Paket-Root
from app.modules.materials.contracts import ...       # angeblich "oeffentlich"
from app.modules.materials.providers import ...
from app.modules.materials.schemas   import ...
from app.modules.materials.domain    import ...
from app.modules.materials.models    import ...       # fremdes Modell
session.execute(text("UPDATE materials_items SET ...")) # fremde Tabelle
from app.modules.electrical.services import RoomService # Shared -> Fachmodul
```

### Abhängigkeitsrichtungen (fachlich, nicht als Importfreigabe)

```
Fachmodul ──▶ Shared ──▶ Core     (nur ueber app.contracts.v1)
Fachmodul ──▶ Core                (Core-Code, app.db)
Shared ──▶ Shared                 (nur ueber app.contracts.v1)

VERBOTEN als Python-Import: Core ──▶ Shared/Fachmodul,
Shared ──▶ Fachmodul, Fachmodul ──▶ Fachmodul,
Modul ──▶ Datei eines anderen Moduls (in jeder Form).
```

Braucht ein Shared Module Daten aus einem Fachmodul, wird **kein Import** eingeführt,
sondern ein Port (Abschnitt 4).

---

## 3. Modulzuschnitt im Detail

### core
Organisationen, Benutzer, Mitgliedschaften, Rollen/Permissions, Kunden, Projekte, Gebäude,
Geschosse, Dateien, Audit, Nummernkreise, Event-Bus, Module Registry.
Der Core ist der einzige Ort mit Wissen über Mandanten und Identität.

Der Core ist selbst geschichtet: `app/core/projects` kennt `app/core/customers`
(ein Projekt braucht einen Auftraggeber), **nicht umgekehrt**. Die Prüfung, ob an einem
Kunden noch Projekte hängen, liegt deshalb in `projects/service.py` und wird vom
Kunden-Endpunkt aufgerufen — eine Rückwärtsabhängigkeit wäre der Anfang eines Zyklus.

### materials (Katalog + Material Engine)
Materialstamm, Preise und Preishistorie, Kategorien, ServiceTemplates, globale
Materialregeln, Material Engine (Bedarfsberechnung), Materialbedarf und Arbeitszeitbedarf.

*Warum ServiceTemplates hier und nicht in `calculation`:* Ein ServiceTemplate ist im Kern
eine Stückliste plus Zeitwert — Katalogdaten. Die Kalkulation bewertet sie nur monetär.
Zwei Module würden dieselben Daten pflegen.

### inventory
Lagerorte, Bestände, Bewegungen, Reservierungen, Mindestbestände.
Einziger Weg hinein: der `InventoryService`-Contract.

### calculation
Stundensätze, Kostenarten, Zuschläge, Kalkulationen, Preis- und Mengen-Snapshots.
Hier — und nur hier — liegen Einkaufspreise, Margen und Deckungsbeiträge.

### offers
Angebote, Versionen, Positionen, Freigabe-Workflow, PDF-Erzeugung.
Kennt **keine** Kosten (siehe `docs/database.md`, Abschnitt 5).

### work_orders
Aufträge aus angenommenen Angeboten, Soll-Material, Soll-Zeiten, Status, später Ist-Daten.

### electrical
Räume, Wände, Öffnungen, Geräte, Verteilungen, Stromkreise, Leitungswege,
Installationszonen, Längenberechnung. Kennt keine Preise.

**Abhängigkeit zeitlich gestaffelt.** In den Phasen 3–6 hängt `electrical`
ausschließlich von `core` ab. Das Modul `materials` existiert zu diesem Zeitpunkt
noch nicht; die Module Registry würde eine Abhängigkeit auf ein nicht registriertes
Modul beim Start ablehnen.

Erst in **Phase 7** kommen hinzu: `depends_on = ("core", "materials")` sowie die
Implementierungen von `MaterialRequirementProvider` und `LaborRequirementProvider`.
Bis dahin wird **kein leeres Materials-Modul als Platzhalter** angelegt — ein Modul
ohne Inhalt wäre genau die Art von Vorratscode, die CLAUDE.md Abschnitt 8 ausschließt.

---

## 4. Provider-Ports (Abhängigkeitsumkehr)

Ports sind die einzige Möglichkeit, dass ein Shared Module fachmodulspezifische Daten
erhält, ohne das Fachmodul zu kennen.

| Port | Definiert in | Aufgerufen von | Implementiert von | Ab Phase |
|---|---|---|---|---|
| `MaterialRequirementProvider` | `contracts/v1/material.py` | Material Engine | jedes Fachmodul | 7 |
| `LaborRequirementProvider` | `contracts/v1/labor.py` | Material Engine | jedes Fachmodul | 7 |
| `OfferItemSuggestionProvider` | `contracts/v1/offer.py` | Angebotsassistent | jedes Fachmodul | 10 |

Die Ports entstehen **mit dem Modul, das sie definiert** — nicht vorher. Ein Port
ohne Aufrufer wäre tote Abstraktion.

Regeln:

1. Ein Port ist ein `Protocol` in `contracts/v1/`, keine Basisklasse.
2. Implementierungen liegen in `providers.py` des Fachmoduls und werden im
   `ModuleDescriptor` registriert.
3. Ein Port liefert **Daten**, keine Datenbankobjekte. Rückgabe sind Contract-Dataclasses.
4. Ein Port darf nicht schreiben. Der Aufrufer entscheidet, was persistiert wird.
5. Ein Port muss mit mehreren Implementierungen sinnvoll sein. Sonst ist es kein Port,
   sondern ein Funktionsaufruf.
6. Ein neuer Port braucht eine Begründung im ADR-Format.

---

## 5. Backend-Modulregistrierung

```python
# apps/backend/app/modules/electrical/module.py
# Zustand ab Phase 7. In den Phasen 3-6 lautet depends_on nur ("core",),
# und `provides` bleibt leer (siehe Abschnitt 3).
from app.core.module_registry import ModuleDescriptor, ModuleKind, PermissionDef, PortBinding
from app.contracts.v1.material import MaterialRequirementProvider, LaborRequirementProvider
from .api import router
from .providers import ElectricalMaterialProvider, ElectricalLaborProvider

DESCRIPTOR = ModuleDescriptor(
    id="electrical",
    name="Elektroplanung",
    version="1.0.0",
    kind=ModuleKind.DOMAIN,
    depends_on=("core", "materials"),
    table_prefix="electrical_",
    permissions=(
        PermissionDef("electrical.plan.read",  "Elektroplanung ansehen"),
        PermissionDef("electrical.plan.write", "Elektroplanung bearbeiten"),
        PermissionDef("electrical.device.write", "Elektroelemente bearbeiten"),
        PermissionDef("electrical.circuit.write", "Stromkreise bearbeiten"),
    ),
    router=router,                       # -> /api/v1/modules/electrical
    subscriptions=(),
    provides=(
        PortBinding(MaterialRequirementProvider, ElectricalMaterialProvider),
        PortBinding(LaborRequirementProvider,    ElectricalLaborProvider),
    ),
)
```

Registrierung in `app/modules/__init__.py` — eine einzige Liste, statisch:

```python
REGISTERED_MODULES = [
    materials.DESCRIPTOR,
    calculation.DESCRIPTOR,
    offers.DESCRIPTOR,
    work_orders.DESCRIPTOR,
    inventory.DESCRIPTOR,
    electrical.DESCRIPTOR,
]
```

### Prüfungen beim Start (Fehler = Start verweigert)

| Prüfung | Grund |
|---|---|
| Modul-IDs eindeutig | sonst mehrdeutige Routen und Permissions |
| Abhängigkeiten existieren | fehlendes Modul früh melden |
| Keine Zyklen | Zyklen sind das Ende der Modularität |
| Richtung erlaubt (`kind`) | Shared darf nicht von Fachmodul abhängen |
| Tabellenpräfix eindeutig | Grenzen bleiben im Schema sichtbar |
| Permission-Keys mit Modul-ID | keine Namenskollisionen |
| Jeder `PortBinding` erfüllt das Protocol | Fehler zur Startzeit statt zur Laufzeit |

### Routen

| Art | Muster | Beispiel |
|---|---|---|
| Core | `/api/v1/<resource>` | `/api/v1/projects` |
| Shared | `/api/v1/<resource>` | `/api/v1/materials`, `/api/v1/offers` |
| Fachmodul | `/api/v1/modules/<id>/…` | `/api/v1/modules/electrical/rooms` |

Die Trennung ist Absicht: Shared-Ressourcen sind modulübergreifend stabil, Fachmodulrouten
dürfen sich mit ihrem Modul entwickeln.

---

## 6. Frontend-Modulregistrierung

```ts
// apps/planner/src/core/modules/types.ts
export interface ProjectTab {
  id: string;
  label: string;
  order: number;
  permission?: string;
  element: React.LazyExoticComponent<React.ComponentType>;
}

export interface PlannerModule {
  id: string;
  name: string;
  version: string;
  dependsOn?: string[];
  routes?: RouteObject[];
  projectTabs?: ProjectTab[];
  navigation?: NavItem[];
  settingsSections?: SettingsSection[];
}
```

```ts
// apps/planner/src/modules/electrical/index.ts
export const electricalModule: PlannerModule = {
  id: "electrical",
  name: "Elektroplanung",
  version: "1.0.0",
  dependsOn: ["materials"],
  projectTabs: [
    { id: "electrical-plan", label: "Elektroplanung", order: 20,
      permission: "electrical.plan.read",
      element: lazy(() => import("./pages/PlanPage")) },
  ],
  settingsSections: [
    { id: "electrical-device-types", label: "Gerätetypen",
      permission: "electrical.plan.write",
      element: lazy(() => import("./pages/DeviceTypesPage")) },
  ],
};
```

```ts
// apps/planner/src/modules/index.ts   <- die EINZIGE zentrale Stelle
export const MODULES: PlannerModule[] = [
  materialsModule,
  calculationModule,
  offersModule,
  workOrdersModule,
  electricalModule,
];
```

### Projekt-Tabs und die Grenze zur Composition Root

Die Projektansicht liegt im Plattform-Modul (`src/modules/platform`), die Beiträge der
Fachmodule stehen aber in der Composition Root `src/modules/index.ts`. Ein Modul darf
diese Datei **nicht** importieren — das wäre ein Zyklus und ein Grenzverstoß.

Gelöst über einen Kanal im Core:

```
src/core/modules/ProjectTabs.tsx     definiert Context + useProjectTabs()
src/app/App.tsx                      liest moduleRegistry.projectTabs(...) und fuellt ihn
src/modules/<id>/…                   liest ihn ueber useProjectTabs()
```

Damit bleibt die Richtung `Modul → Core` erhalten, und `app/**` bleibt der einzige
Bereich, der die zentrale Fassade kennt.

### Sichtbarkeitsregel

Ein Beitrag (Tab, Route, Navigationseintrag) wird nur gerendert, wenn

1. das Modul laut `GET /api/v1/me/modules` für die Organisation aktiv ist **und**
2. der Nutzer die deklarierte Permission besitzt.

Das ist reine Bequemlichkeit für die Bedienung — die eigentliche Absicherung passiert
serverseitig. Ein ausgeblendeter Tab ist **kein** Zugriffsschutz.

### Contribution Points im MVP

| Punkt | Zweck |
|---|---|
| `project.tabs` | Fachmodul-Seiten innerhalb eines Projekts |
| `nav.main` | Einträge in der Hauptnavigation |
| `settings.sections` | Stammdatenpflege des Moduls |
| `routes` | eigenständige Seiten außerhalb des Projektkontexts |

Weitere Punkte (Toolbar-Aktionen, Widgets, Projektübersicht-Kacheln) werden erst
eingeführt, wenn ein zweites Modul sie tatsächlich benötigt.

---

## 7. Modul-Aktivierung pro Organisation

Tabelle `organization_modules (organization_id, module_id, enabled, settings jsonb)`.
Im MVP sind alle registrierten Module für jede Organisation aktiv. Der Endpunkt
`GET /api/v1/me/modules` liefert die aktiven Module samt Version und den Permissions des
Nutzers. Eine Deaktivierung blendet das Modul aus **und** lässt seine Endpunkte mit `403`
antworten.

Keine Lizenz-, Abrechnungs- oder Trial-Logik.

---

## 8. Durchsetzung der Grenzen

Die Regeln aus Abschnitt 2 werden auf sechs Ebenen automatisiert geprüft. Jede
Ebene hat einen **eindeutigen** Zuständigkeitsbereich; sie ersetzen einander
nicht.

| Ebene | Werkzeug | Prüft |
|---|---|---|
| Registry (Laufzeit) | `ModuleRegistry.validate()` in `app/core/module_registry/registry.py` | eindeutige Modul-IDs, existierende und richtungskonforme Abhängigkeiten, keine Zyklen, eindeutige Tabellenpräfixe, Permission-Namensraum, Port-Bindings (Existenz, Signatur, sync/async, Rückgabetyp, Parametertypen) |
| Statische Import-Analyse | `check_import_boundaries()` in `app/core/module_registry/boundaries.py`, aufgerufen von `tests/test_module_boundaries.py` | Rein dateisystembasierte AST-Analyse: **jeder** Import auf `app.modules.<anderes>` ist verboten, unabhängig von `depends_on`. Syntaxfehler, unlesbare Dateien und relative Importe über das Backend hinaus führen zu einem klaren Fehler; fehlende Modul-Ordner werden gemeldet. |
| Schichten (`import-linter`) | `apps/backend/.importlinter` | `app.modules → app.core → app.db → app.contracts`; Core kennt keine Module; Contracts hängen an nichts; DB kennt keine Fachlogik |
| Datenbank (Metadaten) | `check_table_boundaries()` in `boundaries.py`, aufgerufen von `tests/test_module_boundaries.py` | Jede Tabelle gehört einem Modul über `table_prefix` oder der Core-Positivliste `CORE_TABLES`. Jeder FK trifft nur eigene Tabellen oder Core-Tabellen. **Kein FK auf fremde Modultabellen — auch bei `depends_on` nicht.** Fremde Daten leben als externe UUID ohne FK. |
| Statische Port-Typisierung | `PortBinding[TPort]` + `bind_port(TPort, TPort)` in `descriptor.py`, gegengeprüft mit `tests/test_ports_typing.py` | Vier mypy-Negativ-Fixtures (`bad_missing_method`, `bad_wrong_arity`, `bad_wrong_param_type`, `bad_wrong_return`) laufen mypy `--strict` als Subprozess an und werden nachweislich abgelehnt. Die positive Fixture wird akzeptiert. |
| Frontend | `apps/planner/scripts/module-boundaries.mjs` (`npm run check:boundaries`), zusätzlich `no-restricted-imports` als Frühwarner | Absolute und relative Importpfade werden gegen den *tatsächlichen* Datei-Owner aufgelöst. Ein Sibling-Import wie `../andereModul/internal` wird technisch erkannt — nicht mehr nur konventionell. Der Vitest-Test importiert die produktive Funktion; Test und Regel bleiben synchron. |

**Ein Verstoß auf jeder dieser Ebenen bricht den Build.** Regeln ohne
Prüfung halten in einem KI-gestützten Projekt keine drei Wochen.

Die statischen Prüfungen greifen automatisch, sobald ein Modul im
`ModuleDescriptor` registriert wird — es sind **keine** manuellen
Nachträge an `.importlinter` oder ESLint mehr nötig. Ein neues Modul, das
falsche `depends_on`-Werte oder fremde Tabellen anfässt, ist damit auch
in der ersten Version nicht grün.

### Backend — `import-linter`

```ini
[importlinter:contract:layers]
name = Schichten: modules -> core -> db -> contracts
type = layers
layers =
    app.modules
    app.core
    app.db
    app.contracts

[importlinter:contract:core-not-to-modules]
name = Core kennt keine Module
type = forbidden
source_modules = app.core
forbidden_modules = app.modules
```

Die feineren Regeln (Shared → Fachmodul, Fachmodul → Fachmodul, jeder
Zugriff aus `app.modules.<a>` auf `app.modules.<b>`) werden nicht über
`import-linter`-Contracts pro Modulpaar geschrieben, sondern über die
statische AST-Analyse in `boundaries.py`, die die
`ModuleDescriptor`-Metadaten selbst zur Quelle nimmt und **keinen
Modulcode ausführt**. Damit gibt es keinen "zweiten Ort", der bei jedem
neuen Modul mitgepflegt werden müsste.

### Frontend — produktives Skript

```
node apps/planner/scripts/module-boundaries.mjs apps/planner/src
```

`npm run check:boundaries`, `tasks.ps1 boundaries` und `tasks.ps1 check`
rufen dieselbe Funktion auf, die auch die Vitest-Fixtures in
`apps/planner/src/core/modules/boundaries.test.ts` benutzen. Die Regel
nutzt den TypeScript-Compiler und erkennt:

* statische `import`-Deklarationen,
* Re-Exports (`export ... from "…"`, `export * from "…"`),
* dynamische `import("…")` (auch in `React.lazy(() => import("…"))`,
  auch mehrzeilig).

**Nicht statisch bestimmbare** dynamische Imports (`import(variable)`
oder `` import(`.../${x}`) ``) werden ausdrücklich als
Architekturverstoß `dynamic-non-literal` gemeldet — sie würden die
Grenze umgehen können.

Verbindliche Kombinationen (Verstoß bricht den Build):

* `app/**` → konkretes Modul (public **oder** internal) — verboten.
  App importiert ausschließlich die zentrale Composition-Root-Fassade
  `src/modules/index.ts` sowie Core/Utility-Code.
* `core/**` → konkretes Modul — verboten.
* Modul A → Modul B (in jeder Form) — verboten.
* Composition Root → Modul-Interna — verboten (nur öffentliche
  Modul-Indizes).
* Nur `src/modules/index.ts` (Composition Root) darf konkrete
  Modul-Indizes importieren.

**Der öffentliche Einstieg eines Moduls ist genau `src/modules/<id>`
bzw. `src/modules/<id>/index.ts[x]` — keine tiefer verschachtelte
`index.ts`.** Eine Datei wie `src/modules/<id>/pages/index.ts` oder
`src/modules/<id>/internal/index.ts` bleibt intern; auch die
Composition Root darf sie nicht importieren. Der Modul-Eigentümer
selbst darf seine eigenen verschachtelten `index`-Dateien natürlich
nutzen.

ESLint bleibt als Frühwarner für die häufigsten absoluten Patterns
(`@/modules/*`, `../../modules/*`); die verbindliche Grenze ist das
Skript.

### Datenbank

Der Test liest die SQLAlchemy-Metadaten jedes Moduls und prüft, dass alle Tabellen
mit dem eigenen Präfix beginnen und Fremdschlüssel **ausschließlich** auf eigene
Tabellen oder Core-Tabellen zeigen. `depends_on` erlaubt **keine** FK-Referenzen
auf fremde Modultabellen. Die zulässigen Core-Tabellen stehen als Positivliste in
`app.core.module.CORE_TABLES`; sie ist die einzige Quelle für „gehört zum Core".

---

## 9. Checkliste: neues Modul anlegen

1. Ordner `app/modules/<id>/` mit `module.py`, `api/`, `services/`, `models/`, `tests/`.
2. Tabellenpräfix festlegen und in `docs/database.md` eintragen.
3. Permissions definieren (`<id>.<objekt>.<aktion>`).
4. `ModuleDescriptor` erstellen und in `REGISTERED_MODULES` eintragen.
5. Benötigte Ports implementieren (`providers.py`).
6. Alembic-Migration erzeugen (ein Strang!).
7. Frontend: `PlannerModule` anlegen, in `modules/index.ts` eintragen.
8. `docs/modules/<id>.md` schreiben.
9. `import-linter`-Contracts erweitern.
10. Tests: Mandantentrennung, Permissions, Fachlogik.
11. `current-status.md`, `task-history.md`, ggf. `roadmap.md` aktualisieren.
