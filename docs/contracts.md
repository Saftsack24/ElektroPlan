# Contracts

Version: 1.0 (Phase 0 — Entwurf)
Quelle der Wahrheit: `apps/backend/app/contracts/v1/` (Python)
Siehe [ADR 0009](decisions/0009-contracts-source-of-truth.md)

---

## 1. Zwei Arten von Contracts

| Art | Zwischen | Quelle der Wahrheit | Erzeugt |
|---|---|---|---|
| **Modul-Contract** | Backend-Modul ↔ Backend-Modul | `app/contracts/v1/*.py` (Pydantic/Protocol) | von Hand gepflegt |
| **Wire-Contract** | Backend ↔ Frontend/App | OpenAPI aus FastAPI | `packages/api-client` wird **generiert** |

Es gibt **kein** handgepflegtes TypeScript-Contract-Paket. Zwei handgepflegte Definitionen
derselben Struktur driften auseinander, und zwar unbemerkt.

### Was niemals ein Contract ist

- SQLAlchemy-Modelle
- Repository-Methoden
- Datenbanktabellen und Spaltennamen
- interne Service-Klassen

---

## 2. Versionierung

- Contracts liegen unter `contracts/v1/`. Der Ordner **ist** die Version.
- **Additive Änderungen** (neues optionales Feld, neuer Enum-Wert mit definiertem
  Default-Verhalten) sind innerhalb von `v1` erlaubt.
- **Brechende Änderungen** (Feld entfernen/umbenennen, Typ ändern, Pflichtfeld ergänzen)
  erzeugen `v2`. `v1` bleibt mindestens eine Phase lang lauffähig.
- Jede Contract-Änderung wird in `docs/changelog.md` vermerkt.
- Contracts haben keine Abhängigkeit zu Modulcode. Sie importieren nur aus
  `contracts/common.py`.

---

## 3. Gemeinsame Typen

```python
# app/contracts/v1/common.py
from __future__ import annotations
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from uuid import UUID


class Unit(StrEnum):
    PIECE = "piece"      # Stück
    METER = "meter"      # Meter
    PACKAGE = "package"  # Packung
    ROLL = "roll"        # Rolle / Ring
    KILOGRAM = "kg"
    HOUR = "hour"


@dataclass(frozen=True, slots=True)
class Money:
    """Geldbetrag. Immer Decimal, niemals float. Transport als String."""
    amount: Decimal
    currency: str = "EUR"


@dataclass(frozen=True, slots=True)
class ProjectContext:
    """Was ein Modul über ein Projekt wissen darf, ohne core zu importieren."""
    organization_id: UUID
    project_id: UUID
    customer_id: UUID | None
    actor_user_id: UUID | None
```

**Regeln**

- Geld und Mengen sind immer `Decimal`. `float` ist im gesamten Backend für fachliche
  Werte verboten (ausgenommen reine Geometrie-Zwischenrechnungen, siehe ADR 0007).
- `Unit` ist die einzige gültige Einheitenliste. Ein Modul erfindet keine eigenen
  Einheiten.
- Ein Contract-Objekt ist `frozen` — es wird erzeugt, weitergereicht und nicht verändert.

---

## 4. `MaterialRequirement` — der zentrale Contract

Der wichtigste Contract der Plattform: Über ihn wird jedes Fachmodul an Material, Lager,
Kalkulation und Angebot angeschlossen.

```python
# app/contracts/v1/material.py
from typing import Protocol
from uuid import UUID
from decimal import Decimal
from .common import Unit, ProjectContext


@dataclass(frozen=True, slots=True)
class MaterialRequirementDraft:
    """Was ein Fachmodul liefert: reiner technischer Bedarf, ohne Zuschläge."""
    source_module: str            # "electrical" | "pv" | ...
    source_entity_type: str       # "device" | "cable_route" | "roof_area" | ...
    source_entity_id: UUID
    quantity: Decimal             # technischer Bedarf
    unit: Unit
    material_id: UUID | None = None      # konkretes Material, falls bekannt
    material_key: str | None = None      # alternativ ein Katalogschlüssel
    service_template_id: UUID | None = None
    description: str | None = None
    metadata: dict[str, str] | None = None   # z. B. {"circuit": "3", "room": "Küche"}


@dataclass(frozen=True, slots=True)
class MaterialRequirement:
    """Was die Material Engine daraus macht — mit drei getrennten Mengen."""
    id: UUID
    run_id: UUID
    organization_id: UUID
    project_id: UUID
    source_module: str
    source_entity_type: str
    source_entity_id: UUID
    material_id: UUID
    unit: Unit
    required_quantity: Decimal      # technischer Bedarf        42.500
    planned_quantity: Decimal       # + Verschnitt/Reserve      45.900
    procurement_quantity: Decimal   # auf Verpackung gerundet   50.000
    description: str | None = None
    metadata: dict[str, str] | None = None


class MaterialRequirementProvider(Protocol):
    """Port. Implementiert von jedem Fachmodul."""
    module_id: str
    def collect(self, ctx: ProjectContext) -> list[MaterialRequirementDraft]: ...
```

**Invarianten**

1. Ein Draft ist immer genau einer Quellentität zuordenbar (`source_entity_*`). Ohne diese
   Rückverfolgbarkeit ist weder Soll/Ist noch Fehlersuche möglich.
2. `required_quantity` enthält **keine** Zuschläge. Zuschläge sind Sache der Engine.
3. Genau eines von `material_id` / `material_key` / `service_template_id` ist gesetzt.
4. Der Provider schreibt nichts. Er liest den Planungsstand und liefert Daten.
5. Zwei Läufe mit identischem Planungsstand liefern identische Ergebnisse
   (`input_hash` dokumentiert das).

---

## 5. `LaborRequirement`

```python
@dataclass(frozen=True, slots=True)
class LaborRequirementDraft:
    source_module: str
    source_entity_type: str
    source_entity_id: UUID
    labor_kind: str          # "installation" | "connection" | "commissioning" | ...
    minutes: int             # ganze Minuten, keine Nachkommastellen
    description: str | None = None


class LaborRequirementProvider(Protocol):
    module_id: str
    def collect(self, ctx: ProjectContext) -> list[LaborRequirementDraft]: ...
```

Arbeitszeit wird in **ganzen Minuten** geführt. Die Umrechnung in Stunden und Geld
passiert ausschließlich in `calculation`.

---

## 6. `OfferItemSuggestion`

```python
# app/contracts/v1/offer.py
class OfferItemKind(StrEnum):
    HEADING = "heading"
    TEXT = "text"
    ITEM = "item"
    OPTIONAL = "optional"
    ALTERNATIVE = "alternative"
    LUMP_SUM = "lump_sum"


@dataclass(frozen=True, slots=True)
class OfferItemSuggestion:
    kind: OfferItemKind
    title: str
    description: str | None
    quantity: Decimal | None
    unit: Unit | None
    group_key: str | None        # z. B. "02 Elektroinstallation"
    sort_hint: int
    source_module: str
    source_entity_type: str | None
    source_entity_id: UUID | None


class OfferItemSuggestionProvider(Protocol):
    module_id: str
    def suggest(self, ctx: ProjectContext, calculation_id: UUID) -> list[OfferItemSuggestion]: ...
```

**Wichtig:** Ein Vorschlag enthält **keinen Preis**. Preise setzt `offers` aus der
Kalkulation. Ein Fachmodul soll keine Verkaufspreise bilden können.
Vorschläge sind Vorschläge — der Benutzer bearbeitet sie, bevor ein Angebot entsteht.

---

## 7. `InventoryService`

Der einzige Weg ins Lager. Direkter Tabellenzugriff ist verboten.

```python
# app/contracts/v1/inventory.py
@dataclass(frozen=True, slots=True)
class StockInfo:
    material_id: UUID
    location_id: UUID
    on_hand: Decimal
    reserved: Decimal
    available: Decimal          # on_hand - reserved
    unit: Unit


@dataclass(frozen=True, slots=True)
class ReservationRequest:
    material_id: UUID
    quantity: Decimal
    unit: Unit
    project_id: UUID
    work_order_id: UUID | None = None
    location_id: UUID | None = None      # None = Standardlager
    client_txn_id: str | None = None     # Idempotenz


class InventoryService(Protocol):
    def get_stock(self, ctx, material_id: UUID, location_id: UUID | None = None) -> StockInfo: ...
    def reserve(self, ctx, request: ReservationRequest) -> UUID: ...
    def release_reservation(self, ctx, reservation_id: UUID, reason: str) -> None: ...
    def consume(self, ctx, reservation_id: UUID | None, material_id: UUID,
                quantity: Decimal, work_order_id: UUID, client_txn_id: str | None) -> UUID: ...
    def return_material(self, ctx, material_id: UUID, quantity: Decimal,
                        work_order_id: UUID, client_txn_id: str | None) -> UUID: ...
```

**Zusagen des Contracts**

- Jeder Aufruf erzeugt genau eine `inventory_transactions`-Zeile (außer Reservierungen,
  die den Bestand nicht verändern).
- `client_txn_id` macht Aufrufe idempotent: derselbe Wert liefert dieselbe Transaktions-ID
  zurück, ohne doppelt zu buchen.
- Negative Bestände sind zulässig, wenn die Organisation das erlaubt — die Entscheidung
  liegt beim Lagermodul, nicht beim Aufrufer.
- Fehler kommen als typisierte Ausnahmen (`InsufficientStock`, `UnknownMaterial`), nicht
  als `None` oder `False`.

---

## 8. `PricingService`

```python
# app/contracts/v1/pricing.py
class PricingService(Protocol):
    def get_purchase_price(self, ctx, material_id: UUID, at: date | None = None) -> Money: ...
    def get_labor_rate(self, ctx, rate_key: str, at: date | None = None) -> Money: ...
    def build_price_snapshot(self, ctx, material_ids: Sequence[UUID],
                             rate_keys: Sequence[str]) -> "PriceSnapshot": ...


@dataclass(frozen=True, slots=True)
class PriceSnapshot:
    created_at: datetime
    materials: dict[UUID, Money]
    labor_rates: dict[str, Money]
    rules: dict[str, str]
    hash: str                    # SHA-256 über den kanonisierten Inhalt
```

Ein Snapshot ist unveränderlich. Eine finalisierte Kalkulation liest **ausschließlich** aus
ihrem Snapshot, nie aus dem Live-Katalog. Das ist die technische Umsetzung von §26.

---

## 9. `ModuleDescriptor`

```python
# app/core/module_registry/descriptor.py
class ModuleKind(StrEnum):
    CORE = "core"
    SHARED = "shared"
    DOMAIN = "domain"


@dataclass(frozen=True, slots=True)
class PermissionDef:
    key: str          # "<modul>.<objekt>.<aktion>"
    description: str


@dataclass(frozen=True, slots=True)
class PortBinding:
    port: type
    implementation: type


@dataclass(frozen=True, slots=True)
class ModuleDescriptor:
    id: str
    name: str
    version: str
    kind: ModuleKind
    depends_on: tuple[str, ...]
    table_prefix: str
    permissions: tuple[PermissionDef, ...]
    router: "APIRouter | None"
    subscriptions: tuple["Subscription", ...]
    provides: tuple[PortBinding, ...]
```

---

## 10. Event-Envelope

```python
# app/contracts/v1/events.py
@dataclass(frozen=True, slots=True)
class DomainEvent:
    event_id: UUID
    event_type: str            # "electrical.plan.updated"
    event_version: int         # 1
    organization_id: UUID
    occurred_at: datetime
    aggregate_type: str        # "project"
    aggregate_id: UUID
    actor_user_id: UUID | None
    request_id: str | None
    payload: dict[str, object]   # nur IDs und kleine Skalare
```

Details und Regeln: `docs/events.md`.

---

## 11. Regeln für Contract-Änderungen

1. Vor der Änderung prüfen, wer den Contract benutzt (`grep` über `app/modules`).
2. Additiv ändern, wenn möglich. Optional mit sinnvollem Default.
3. Brechende Änderung → neuer Ordner `v2`, alter bleibt bestehen.
4. Contract-Tests liegen in `tests/contracts/` und prüfen Struktur und Invarianten,
   nicht die Implementierung.
5. Jede Änderung wird in `docs/changelog.md` und `docs/contracts.md` dokumentiert.
6. Ein Contract wird nicht erweitert, um ein einzelnes Modul bequemer zu machen.
   Wenn nur ein Modul es braucht, gehört es nicht in den Contract.

---

## 12. Beispiel: PV schließt sich später an — ohne Änderung an Shared Modules

```python
# app/modules/pv/providers.py   (Phase 18/19)
class PvMaterialProvider:
    module_id = "pv"

    def collect(self, ctx: ProjectContext) -> list[MaterialRequirementDraft]:
        drafts: list[MaterialRequirementDraft] = []
        for string in self._strings(ctx.project_id):
            drafts.append(MaterialRequirementDraft(
                source_module="pv",
                source_entity_type="string",
                source_entity_id=string.id,
                material_key="dc-cable-6mm2",
                quantity=string.dc_cable_length_m,
                unit=Unit.METER,
                metadata={"string": string.name},
            ))
        return drafts
```

Registrierung im `ModuleDescriptor` — fertig. Material Engine, Lager, Kalkulation,
Angebot und Auftrag funktionieren, ohne dass in diesen Modulen eine Zeile geändert wird.
**Das ist der Prüfstein der gesamten Architektur.**
