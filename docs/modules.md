# Module, Grenzen und Registrierung

Version: 1.0 (Phase 0)

Dieses Dokument definiert, welche Module es gibt, was sie dürfen, was sie nicht dürfen und
wie sie sich registrieren.

---

## 1. Modullandschaft

| Modul | Art | Status | Präfix | Abhängig von |
|---|---|---|---|---|
| `core` | Core | Phase 1 | — | — |
| `materials` | Shared | Phase 7/8 | `material_`, `service_` | core |
| `inventory` | Shared | Phase 12 | `inventory_` | core, materials |
| `calculation` | Shared | Phase 9 | `calculation_` | core, materials |
| `offers` | Shared | Phase 10 | `offer_` | core, calculation |
| `work_orders` | Shared | Phase 11 | `work_order_` | core, offers |
| `electrical` | Fachmodul | Phase 3–6 | `electrical_` | core, materials |
| `pv` | Fachmodul | Phase 18/19 | `pv_` | core, materials |
| `knx`, `wallbox`, `network`, … | Fachmodul | offen | je eigen | core, materials |

---

## 2. Die eine Regel

> Ein Modul kennt von einem anderen Modul **ausschließlich** dessen veröffentlichte
> Contracts. Niemals Tabellen, Modelle, Repositories oder interne Services.

### Erlaubt

```python
from app.contracts.v1.inventory import InventoryService, ReservationRequest
inventory.reserve(ReservationRequest(...))
```

### Verboten

```python
from app.modules.inventory.models import InventoryStock      # fremdes Modell
session.execute(text("UPDATE inventory_stocks SET ..."))      # fremde Tabelle
from app.modules.electrical.services import RoomService      # Shared -> Fachmodul
```

### Abhängigkeitsrichtungen

```
Fachmodul ──▶ Shared ──▶ Core
Fachmodul ──▶ Core
Shared ──▶ Shared   (nur Contracts)

VERBOTEN: Core ──▶ Shared/Fachmodul · Shared ──▶ Fachmodul · Fachmodul ──▶ Fachmodul
```

Braucht ein Shared Module Daten aus einem Fachmodul, wird **kein Import** eingeführt,
sondern ein Port (Abschnitt 4).

---

## 3. Modulzuschnitt im Detail

### core
Organisationen, Benutzer, Mitgliedschaften, Rollen/Permissions, Kunden, Projekte, Gebäude,
Geschosse, Dateien, Audit, Nummernkreise, Event-Bus, Module Registry.
Der Core ist der einzige Ort mit Wissen über Mandanten und Identität.

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
Installationszonen, Längenberechnung. Erzeugt Material- und Arbeitszeitbedarf über Ports.
Kennt keine Preise.

---

## 4. Provider-Ports (Abhängigkeitsumkehr)

Ports sind die einzige Möglichkeit, dass ein Shared Module fachmodulspezifische Daten
erhält, ohne das Fachmodul zu kennen.

| Port | Definiert in | Aufgerufen von | Implementiert von |
|---|---|---|---|
| `MaterialRequirementProvider` | `contracts/v1/material.py` | Material Engine | jedes Fachmodul |
| `LaborRequirementProvider` | `contracts/v1/labor.py` | Material Engine | jedes Fachmodul |
| `OfferItemSuggestionProvider` | `contracts/v1/offer.py` | Angebotsassistent | jedes Fachmodul |

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

### Backend — `import-linter`

```ini
[importlinter:contract:layers]
name = ElektroPlan Schichten
type = layers
layers =
    app.modules
    app.contracts
    app.core

[importlinter:contract:no-domain-to-domain]
name = Fachmodule kennen einander nicht
type = independence
modules =
    app.modules.electrical
    app.modules.pv

[importlinter:contract:shared-not-to-domain]
name = Shared Modules kennen keine Fachmodule
type = forbidden
source_modules =
    app.modules.materials
    app.modules.inventory
    app.modules.calculation
    app.modules.offers
    app.modules.work_orders
forbidden_modules =
    app.modules.electrical
    app.modules.pv

[importlinter:contract:no-cross-module-models]
name = Keine fremden Models/Repositories
type = forbidden
source_modules = app.modules
forbidden_modules =
    app.modules.*.models
    app.modules.*.repositories
```

(Die letzte Regel wird in der Umsetzung als explizite Paarliste ausformuliert.)

### Frontend — ESLint

```js
"no-restricted-imports": ["error", {
  patterns: [
    { group: ["@/modules/*/!(index)", "../*/!(index)"],
      message: "Module nur über ihren index.ts-Contract verwenden." },
    { group: ["@/modules/*"],
      message: "Kein Modul-Import aus core/. Beiträge laufen über die Registry." }
  ]
}]
```

### Datenbank

Ein Test liest die SQLAlchemy-Metadaten jedes Moduls und prüft, dass alle Tabellen mit dem
eigenen Präfix beginnen und Fremdschlüssel nur auf Core-Tabellen oder eigene Tabellen
zeigen.

**Ein Verstoß bricht den Build.** Regeln ohne Prüfung halten in einem KI-gestützten
Projekt keine drei Wochen.

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
