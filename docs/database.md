# Datenbank und ER-Modell

Version: 1.0 (Phase 0 — Entwurf, noch keine Migration erzeugt)
Datenbank: PostgreSQL 17
ORM: SQLAlchemy 2.0 · Migrationen: Alembic (ein einziger Strang)

Dieses Dokument ist das verbindliche fachliche Datenmodell. Spalten können sich in der
Umsetzung im Detail ändern; Entitäten, Beziehungen und Grenzen nicht ohne ADR.

---

## 1. Konventionen

| Thema | Regel |
|---|---|
| Primärschlüssel | `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| Mandant | `organization_id uuid NOT NULL` auf jeder mandantenbezogenen Tabelle |
| Fremdschlüssel (mandantenbezogen) | **zusammengesetzt**: `(organization_id, <ref>_id)` → `ziel(organization_id, id)` |
| Zeitstempel | `created_at`, `updated_at` als `timestamptz`, immer UTC |
| Fachliche Daten | `date` ohne Zeitzone (z. B. `valid_until`) |
| Optimistisches Sperren | `version integer NOT NULL DEFAULT 1` auf Geschäftsentitäten |
| Löschen | `deleted_at timestamptz NULL` (Soft Delete) für Geschäftsdokumente; Hard Delete nur über den dokumentierten DSGVO-Pfad |
| Tabellennamen | Plural, Modulpräfix bei Nicht-Core-Modulen: `electrical_`, `inventory_`, `calculation_`, `offer_`, `work_order_`, `material_` |
| Geometrie | ganzzahlige **Millimeter**, Suffix `_mm` |
| Geld | `numeric(12,4)` für Einzelpreise, `numeric(12,2)` für Summen |
| Mengen | `numeric(14,3)` |
| Enums | als `text` + `CHECK`-Constraint, nicht als PostgreSQL-Enum (Migrationen bleiben einfach) |
| Constraint-Namen | feste Naming Convention in SQLAlchemy, damit Alembic-Autogenerate stabil ist |

### Warum zusammengesetzte Fremdschlüssel

```sql
-- statt:  project_id uuid REFERENCES projects(id)
ALTER TABLE electrical_rooms
  ADD CONSTRAINT fk_electrical_rooms_project
  FOREIGN KEY (organization_id, project_id)
  REFERENCES projects (organization_id, id);
```

Damit kann ein Datensatz von Organisation A **technisch nicht** auf einen Datensatz von
Organisation B verweisen. Voraussetzung: jede referenzierte Tabelle hat zusätzlich
`UNIQUE (organization_id, id)`.

### Mixins

| Mixin | Spalten |
|---|---|
| `UUIDPrimaryKey` | `id` |
| `Timestamped` | `created_at`, `updated_at` |
| `Versioned` | `version` (SQLAlchemy `version_id_col`) |
| `TenantScoped` | `organization_id` + `UNIQUE (organization_id, id)` |
| `SoftDeletable` | `deleted_at` |
| `Authored` | `created_by_user_id`, `updated_by_user_id` |

---

## 2. Übersicht der Module und Tabellen

| Modul | Präfix | Tabellen |
|---|---|---|
| Core | — | `organizations`, `users`, `organization_members`, `roles`, `permissions`, `role_permissions`, `member_roles`, `refresh_tokens`, `organization_modules`, `customers`, `projects`, `buildings`, `floors`, `files`, `audit_entries`, `number_sequences`, `domain_events` |
| materials | `material_` | `material_categories`, `materials`, `material_prices`, `material_rules`, `service_templates`, `service_template_items`, `material_requirement_runs`, `material_requirements`, `labor_requirements` |
| inventory | `inventory_` | `inventory_locations`, `inventory_stocks`, `inventory_transactions`, `inventory_reservations` |
| calculation | `calculation_` | `calculation_labor_rates`, `calculations`, `calculation_items`, `calculation_surcharges` |
| offers | `offer_` | `offers`, `offer_versions`, `offer_items` |
| work_orders | `work_order_` | `work_orders`, `work_order_items`, `work_order_materials`, `work_order_time_entries`, `work_order_notes` |
| electrical | `electrical_` | `electrical_device_types`, `electrical_rooms`, `electrical_walls`, `electrical_openings`, `electrical_devices`, `electrical_distribution_boards`, `electrical_circuits`, `electrical_cable_routes`, `electrical_cable_route_points` |

Anmerkung: `materials`, `material_requirements` und `service_templates` liegen bewusst im
selben Modul (`materials` = Katalog + Material Engine). Begründung in
[ADR 0003](decisions/0003-module-contracts-and-provider-ports.md).

---

## 3. ER-Modell — Core

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ ORGANIZATION_MEMBERS : hat
    USERS         ||--o{ ORGANIZATION_MEMBERS : ist
    ORGANIZATIONS ||--o{ ROLES : definiert
    ROLES         ||--o{ ROLE_PERMISSIONS : gewaehrt
    PERMISSIONS   ||--o{ ROLE_PERMISSIONS : wird_gewaehrt
    ORGANIZATION_MEMBERS ||--o{ MEMBER_ROLES : besitzt
    ROLES         ||--o{ MEMBER_ROLES : zugewiesen
    ORGANIZATIONS ||--o{ ORGANIZATION_MODULES : aktiviert
    ORGANIZATIONS ||--o{ CUSTOMERS : fuehrt
    CUSTOMERS     ||--o{ PROJECTS : beauftragt
    PROJECTS      ||--o{ BUILDINGS : enthaelt
    BUILDINGS     ||--o{ FLOORS : enthaelt
    PROJECTS      ||--o{ FILES : hat
    ORGANIZATIONS ||--o{ AUDIT_ENTRIES : protokolliert
    ORGANIZATIONS ||--o{ NUMBER_SEQUENCES : verwaltet
    ORGANIZATIONS ||--o{ DOMAIN_EVENTS : erzeugt

    ORGANIZATIONS {
        uuid id PK
        text name
        text slug UK
        text legal_name
        text address_json
        text default_tax_rate
        text currency
        timestamptz created_at
    }
    USERS {
        uuid id PK
        text email UK
        text password_hash
        text full_name
        bool is_active
        timestamptz last_login_at
    }
    ORGANIZATION_MEMBERS {
        uuid id PK
        uuid organization_id FK
        uuid user_id FK
        text status
        timestamptz created_at
    }
    ROLES {
        uuid id PK
        uuid organization_id FK
        text key
        text name
        bool is_system
    }
    PERMISSIONS {
        uuid id PK
        text key UK
        text module_id
        text description
    }
    CUSTOMERS {
        uuid id PK
        uuid organization_id FK
        text customer_number
        text kind
        text name
        text email
        text phone
        text billing_street
        text billing_postal_code
        text billing_city
        timestamptz deleted_at
    }
    PROJECTS {
        uuid id PK
        uuid organization_id FK
        uuid customer_id FK
        text project_number
        text name
        text status
        text site_street
        text site_postal_code
        text site_city
        int version
        timestamptz deleted_at
    }
    BUILDINGS {
        uuid id PK
        uuid organization_id FK
        uuid project_id FK
        text name
        int sort_order
    }
    FLOORS {
        uuid id PK
        uuid organization_id FK
        uuid building_id FK
        text name
        int level
        int elevation_mm
        int default_ceiling_height_mm
    }
    FILES {
        uuid id PK
        uuid organization_id FK
        uuid project_id FK
        text storage_key
        text filename
        text content_type
        bigint size_bytes
        text sha256
        text entity_type
        uuid entity_id
    }
    AUDIT_ENTRIES {
        uuid id PK
        uuid organization_id FK
        uuid actor_user_id
        text action
        text entity_type
        uuid entity_id
        text module_id
        jsonb data
        text request_id
        timestamptz created_at
    }
    NUMBER_SEQUENCES {
        uuid organization_id PK
        text scope PK
        text period PK
        bigint current_value
    }
    DOMAIN_EVENTS {
        uuid id PK
        uuid organization_id FK
        text event_type
        int event_version
        text aggregate_type
        uuid aggregate_id
        jsonb payload
        text request_id
        text handler_status
        timestamptz occurred_at
    }
```

### Wichtige Constraints (Core)

- `organizations.slug` UNIQUE
- `users.email` UNIQUE (immer klein geschrieben gespeichert)
- `organization_members` UNIQUE `(organization_id, user_id)`
- `roles` UNIQUE `(organization_id, key)`
- `permissions.key` UNIQUE, Format `<modul>.<objekt>.<aktion>`
- `customers` UNIQUE `(organization_id, customer_number)`
- `projects` UNIQUE `(organization_id, project_number)`
- `number_sequences` PK `(organization_id, scope, period)` — Vergabe per
  `SELECT ... FOR UPDATE`
- `domain_events` ist **append-only** (kein UPDATE außer `handler_status`)

---

## 4. ER-Modell — Electrical (Fachmodul)

```mermaid
erDiagram
    PROJECTS ||--o{ ELECTRICAL_ROOMS : enthaelt
    FLOORS   ||--o{ ELECTRICAL_ROOMS : liegt_auf
    FLOORS   ||--o{ ELECTRICAL_WALLS : liegt_auf
    ELECTRICAL_WALLS ||--o{ ELECTRICAL_OPENINGS : hat
    ELECTRICAL_ROOMS ||--o{ ELECTRICAL_DEVICES : enthaelt
    ELECTRICAL_DEVICE_TYPES ||--o{ ELECTRICAL_DEVICES : typisiert
    ELECTRICAL_DISTRIBUTION_BOARDS ||--o{ ELECTRICAL_CIRCUITS : speist
    ELECTRICAL_CIRCUITS ||--o{ ELECTRICAL_DEVICES : versorgt
    ELECTRICAL_CIRCUITS ||--o{ ELECTRICAL_CABLE_ROUTES : fuehrt
    ELECTRICAL_CABLE_ROUTES ||--o{ ELECTRICAL_CABLE_ROUTE_POINTS : besteht_aus

    ELECTRICAL_ROOMS {
        uuid id PK
        uuid organization_id FK
        uuid project_id FK
        uuid floor_id FK
        text name
        text room_type
        int height_mm
        jsonb floor_polygon_mm
        bigint area_mm2
        int version
    }
    ELECTRICAL_WALLS {
        uuid id PK
        uuid organization_id FK
        uuid floor_id FK
        int start_x_mm
        int start_y_mm
        int end_x_mm
        int end_y_mm
        int height_mm
        int thickness_mm
        text wall_type
    }
    ELECTRICAL_OPENINGS {
        uuid id PK
        uuid organization_id FK
        uuid wall_id FK
        text kind
        int offset_mm
        int width_mm
        int height_mm
        int sill_height_mm
    }
    ELECTRICAL_DEVICE_TYPES {
        uuid id PK
        uuid organization_id FK
        text key
        text name
        text category
        int default_mount_height_mm
        uuid default_service_template_id
        text symbol_key
        bool is_system
    }
    ELECTRICAL_DEVICES {
        uuid id PK
        uuid organization_id FK
        uuid project_id FK
        uuid room_id FK
        uuid device_type_id FK
        uuid circuit_id FK
        uuid service_template_id
        text label
        int x_mm
        int y_mm
        int mount_height_mm
        int rotation_deg
        uuid wall_id
        jsonb properties
        int version
    }
    ELECTRICAL_DISTRIBUTION_BOARDS {
        uuid id PK
        uuid organization_id FK
        uuid project_id FK
        uuid room_id FK
        text code
        text name
        int x_mm
        int y_mm
        int mount_height_mm
        int main_breaker_a
    }
    ELECTRICAL_CIRCUITS {
        uuid id PK
        uuid organization_id FK
        uuid project_id FK
        uuid board_id FK
        text number
        text name
        text cable_type_key
        numeric cross_section_mm2
        text protection_type
        int protection_rating_a
        text rcd_group
        int phases
    }
    ELECTRICAL_CABLE_ROUTES {
        uuid id PK
        uuid organization_id FK
        uuid project_id FK
        uuid circuit_id FK
        text from_ref_type
        uuid from_ref_id
        text to_ref_type
        uuid to_ref_id
        text cable_type_key
        text installation_method
        text zone_key
        int computed_length_mm
        int allowance_mm
        int total_length_mm
        int version
    }
    ELECTRICAL_CABLE_ROUTE_POINTS {
        uuid route_id PK
        int seq PK
        int x_mm
        int y_mm
        int z_mm
        text point_kind
    }
```

**Hinweise**

- `floor_polygon_mm` ist ein JSONB-Array `[[x,y], …]` in Millimetern. Es ist ein
  geschlossener, einfacher Polygonzug; Validierung (keine Selbstüberschneidung, mind. 3
  Punkte) erfolgt im Service, nicht in der Datenbank.
- Streckenpunkte sind **normalisiert**, nicht JSONB: Sie werden einzeln bearbeitet und
  müssen deterministisch summierbar sein.
- `total_length_mm = computed_length_mm + allowance_mm`. Beide Werte werden gespeichert,
  damit im Angebot nachvollziehbar bleibt, wie viel Zuschlag enthalten ist.
- Kein PostGIS. Die Geometrie ist projektlokal, klein und wird nie geografisch abgefragt.

---

## 5. ER-Modell — Materials, Calculation, Offers

```mermaid
erDiagram
    MATERIAL_CATEGORIES ||--o{ MATERIALS : gruppiert
    MATERIALS ||--o{ MATERIAL_PRICES : historisiert
    MATERIALS ||--o{ SERVICE_TEMPLATE_ITEMS : enthalten_in
    SERVICE_TEMPLATES ||--o{ SERVICE_TEMPLATE_ITEMS : besteht_aus
    PROJECTS ||--o{ MATERIAL_REQUIREMENT_RUNS : hat
    MATERIAL_REQUIREMENT_RUNS ||--o{ MATERIAL_REQUIREMENTS : erzeugt
    MATERIAL_REQUIREMENT_RUNS ||--o{ LABOR_REQUIREMENTS : erzeugt
    MATERIALS ||--o{ MATERIAL_REQUIREMENTS : betrifft
    PROJECTS ||--o{ CALCULATIONS : hat
    CALCULATIONS ||--o{ CALCULATION_ITEMS : besteht_aus
    CALCULATIONS ||--o{ CALCULATION_SURCHARGES : hat
    CALCULATIONS ||--o| OFFER_VERSIONS : begruendet
    OFFERS ||--o{ OFFER_VERSIONS : versioniert
    OFFER_VERSIONS ||--o{ OFFER_ITEMS : enthaelt

    MATERIALS {
        uuid id PK
        uuid organization_id FK
        text article_number
        text name
        uuid category_id FK
        text unit
        text manufacturer
        text manufacturer_number
        numeric purchase_price
        numeric default_markup_percent
        numeric packaging_quantity
        text packaging_rounding
        numeric waste_percent
        text calculation_basis
        bool is_active
    }
    MATERIAL_PRICES {
        uuid id PK
        uuid material_id FK
        numeric purchase_price
        date valid_from
        text source
        uuid created_by_user_id
    }
    MATERIAL_RULES {
        uuid id PK
        uuid organization_id FK
        text scope
        uuid category_id
        numeric waste_percent
        text rounding_mode
        numeric minimum_quantity
        int priority
        bool is_active
    }
    SERVICE_TEMPLATES {
        uuid id PK
        uuid organization_id FK
        text key
        text name
        text category
        int labor_minutes
        bool includes_cable
        text description
        bool is_active
    }
    SERVICE_TEMPLATE_ITEMS {
        uuid id PK
        uuid template_id FK
        uuid material_id FK
        numeric quantity
        text unit
        bool is_small_material
    }
    MATERIAL_REQUIREMENT_RUNS {
        uuid id PK
        uuid organization_id FK
        uuid project_id FK
        text status
        text input_hash
        jsonb warnings
        timestamptz started_at
        timestamptz finished_at
        bool is_current
    }
    MATERIAL_REQUIREMENTS {
        uuid id PK
        uuid organization_id FK
        uuid run_id FK
        uuid project_id FK
        text source_module
        text source_entity_type
        uuid source_entity_id
        uuid material_id FK
        numeric required_quantity
        numeric planned_quantity
        numeric procurement_quantity
        text unit
        jsonb metadata
    }
    LABOR_REQUIREMENTS {
        uuid id PK
        uuid organization_id FK
        uuid run_id FK
        uuid project_id FK
        text source_module
        text source_entity_type
        uuid source_entity_id
        text labor_kind
        int minutes
        text description
    }
    CALCULATION_LABOR_RATES {
        uuid id PK
        uuid organization_id FK
        text key
        text name
        numeric hourly_cost
        numeric hourly_price
        date valid_from
    }
    CALCULATIONS {
        uuid id PK
        uuid organization_id FK
        uuid project_id FK
        text number
        int version_no
        text status
        bool is_stale
        numeric material_cost
        numeric labor_cost
        numeric other_cost
        numeric surcharge_total
        numeric cost_total
        numeric price_net
        jsonb snapshot
        text snapshot_hash
        timestamptz finalized_at
    }
    CALCULATION_ITEMS {
        uuid id PK
        uuid calculation_id FK
        int sort_order
        text kind
        text group_key
        text description
        numeric quantity
        text unit
        numeric unit_cost
        numeric total_cost
        numeric markup_percent
        numeric unit_price
        numeric total_price
        text source_module
        text source_entity_type
        uuid source_entity_id
    }
    OFFERS {
        uuid id PK
        uuid organization_id FK
        uuid project_id FK
        uuid customer_id FK
        text offer_number
        uuid current_version_id
    }
    OFFER_VERSIONS {
        uuid id PK
        uuid organization_id FK
        uuid offer_id FK
        int version_no
        text status
        uuid calculation_id
        date offer_date
        date valid_until
        text currency
        numeric net_total
        numeric tax_total
        numeric gross_total
        jsonb snapshot
        uuid pdf_file_id
        uuid released_by_user_id
        timestamptz released_at
        timestamptz sent_at
        text decision
    }
    OFFER_ITEMS {
        uuid id PK
        uuid offer_version_id FK
        uuid parent_id
        text position_number
        text kind
        text title
        text description
        numeric quantity
        text unit
        numeric unit_price
        numeric line_net
        numeric tax_rate
        bool include_in_total
        text source_module
        int sort_order
    }
```

> **Struktureller Schutz (§29):** In `OFFER_VERSIONS` und `OFFER_ITEMS` existiert keine
> einzige Kostenspalte. Ein Angebot kann Einkaufspreise oder Margen nicht enthalten, weil
> es keinen Ort dafür gibt.

### Wichtige Constraints

- `materials` UNIQUE `(organization_id, article_number)`
- `service_templates` UNIQUE `(organization_id, key)`
- `material_requirement_runs`: partieller Unique-Index
  `UNIQUE (project_id) WHERE is_current` — pro Projekt genau ein aktueller Lauf
- `calculations` UNIQUE `(organization_id, number, version_no)`
- `offers` UNIQUE `(organization_id, offer_number)`
- `offer_versions` UNIQUE `(offer_id, version_no)`
- `offer_items.kind` CHECK in (`heading`,`text`,`item`,`optional`,`alternative`,`lump_sum`)
- `offer_versions.status` CHECK in (`draft`,`released`,`sent`,`accepted`,`rejected`,
  `expired`)
- Freigegebene `offer_versions` sind unveränderlich — durchgesetzt im Service und
  zusätzlich über einen `UPDATE`-Trigger, der nur Statusfelder zulässt.

---

## 6. ER-Modell — Inventory und Work Orders

```mermaid
erDiagram
    INVENTORY_LOCATIONS ||--o{ INVENTORY_STOCKS : haelt
    MATERIALS ||--o{ INVENTORY_STOCKS : bestand
    INVENTORY_LOCATIONS ||--o{ INVENTORY_TRANSACTIONS : bucht
    MATERIALS ||--o{ INVENTORY_TRANSACTIONS : betrifft
    PROJECTS ||--o{ INVENTORY_RESERVATIONS : reserviert
    WORK_ORDERS ||--o{ WORK_ORDER_ITEMS : enthaelt
    WORK_ORDERS ||--o{ WORK_ORDER_MATERIALS : plant
    WORK_ORDERS ||--o{ WORK_ORDER_TIME_ENTRIES : erfasst
    OFFER_VERSIONS ||--o| WORK_ORDERS : fuehrt_zu
    PROJECTS ||--o{ WORK_ORDERS : hat

    INVENTORY_LOCATIONS {
        uuid id PK
        uuid organization_id FK
        text code
        text name
        text kind
        uuid parent_id
        bool is_active
    }
    INVENTORY_STOCKS {
        uuid id PK
        uuid organization_id FK
        uuid material_id FK
        uuid location_id FK
        numeric quantity_on_hand
        numeric minimum_quantity
        timestamptz updated_at
    }
    INVENTORY_TRANSACTIONS {
        uuid id PK
        uuid organization_id FK
        uuid material_id FK
        uuid location_id FK
        numeric quantity_delta
        text transaction_type
        text reference_type
        uuid reference_id
        uuid user_id
        text client_txn_id UK
        text note
        timestamptz created_at
    }
    INVENTORY_RESERVATIONS {
        uuid id PK
        uuid organization_id FK
        uuid material_id FK
        uuid location_id FK
        uuid project_id FK
        uuid work_order_id
        numeric quantity
        text status
        timestamptz created_at
        timestamptz released_at
    }
    WORK_ORDERS {
        uuid id PK
        uuid organization_id FK
        uuid project_id FK
        uuid offer_version_id
        text number
        text title
        text status
        date planned_start
        date planned_end
        int version
    }
    WORK_ORDER_ITEMS {
        uuid id PK
        uuid work_order_id FK
        uuid service_template_id
        text description
        numeric planned_quantity
        text unit
        int planned_labor_minutes
        int sort_order
    }
    WORK_ORDER_MATERIALS {
        uuid id PK
        uuid work_order_id FK
        uuid material_id FK
        numeric planned_quantity
        numeric reserved_quantity
        numeric consumed_quantity
        text unit
    }
    WORK_ORDER_TIME_ENTRIES {
        uuid id PK
        uuid work_order_id FK
        uuid user_id
        timestamptz started_at
        timestamptz ended_at
        int minutes
        text description
    }
```

**Bestandsregeln**

- `inventory_transactions` ist die **Quelle der Wahrheit** und append-only.
- `inventory_stocks.quantity_on_hand` ist ein gepflegter Aggregatwert, der ausschließlich
  in derselben Transaktion wie die Bewegung fortgeschrieben wird (`SELECT ... FOR UPDATE`
  auf der Bestandszeile).
- Ein Wartungstest rechnet stichprobenartig `SUM(quantity_delta)` gegen
  `quantity_on_hand`.
- `verfügbar = quantity_on_hand − Σ(aktive Reservierungen)`; nicht gespeichert, sondern
  berechnet.
- `client_txn_id` UNIQUE `(organization_id, client_txn_id)` macht Buchungen idempotent —
  Voraussetzung für die Baustellen-App.

---

## 7. Indizes (Ausgangsmenge)

| Tabelle | Index |
|---|---|
| alle mandantenbezogenen | `(organization_id, id)` UNIQUE |
| `projects` | `(organization_id, customer_id)`, `(organization_id, status)` |
| `electrical_devices` | `(organization_id, project_id)`, `(room_id)`, `(circuit_id)` |
| `electrical_cable_routes` | `(organization_id, project_id)`, `(circuit_id)` |
| `electrical_cable_route_points` | PK `(route_id, seq)` |
| `material_requirements` | `(run_id)`, `(organization_id, project_id)`, `(material_id)` |
| `inventory_transactions` | `(organization_id, material_id, location_id, created_at)` |
| `inventory_reservations` | partiell `(material_id, location_id) WHERE status='active'` |
| `offer_versions` | `(offer_id, version_no)` |
| `audit_entries` | `(organization_id, created_at DESC)`, `(entity_type, entity_id)` |
| `domain_events` | `(organization_id, occurred_at DESC)`, `(event_type)` |

Weitere Indizes erst nach Messung (`EXPLAIN ANALYZE`), nicht auf Verdacht.

---

## 8. Migrationen

- **Ein** Alembic-Strang für die gesamte Datenbank. `alembic heads` muss genau einen Head
  liefern; in CI geprüft.
- Migrationen sind vorwärtsgerichtet; `downgrade` wird nur dort gepflegt, wo es trivial
  ist.
- Datenmigrationen laufen nie automatisch beim Start, sondern über einen expliziten Befehl.
- **Keine** Datenbankerweiterungen nötig: `gen_random_uuid()` ist seit
  PostgreSQL 13 im Kern enthalten, und E-Mails werden statt über `citext`
  grundsätzlich klein geschrieben gespeichert (Normalisierung im Service).
  Das hält Migrationen und Testdatenbanken erweiterungsfrei.
- Seeds (Systemrollen, Permissions, Basis-Gerätetypen, Standard-Installationszonen) sind
  idempotente Skripte, keine Migrationen.

---

## 9. Backup und Integrität

- Tägliches `pg_dump` plus WAL-Archivierung (Betriebskonzept ab Phase 1 dokumentiert,
  Automatisierung vor Produktivbetrieb).
- Restore muss getestet sein, bevor echte Kundendaten erfasst werden.
- Object Storage wird getrennt gesichert; ein Datenbank-Restore ohne passende Dateien ist
  unvollständig.
- Fremdschlüssel und CHECK-Constraints werden aktiv genutzt — Integrität gehört in die
  Datenbank, nicht nur in die Anwendung.
