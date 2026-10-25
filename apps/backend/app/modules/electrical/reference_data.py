"""Idempotenter Seed des Geraetekatalogs (Phase 5, ADR 0023).

Implementiert :class:`~app.contracts.v1.reference_data.ReferenceDataSeeder`.
Quelle ist :data:`catalog.DEVICE_TYPE_CATALOG`:

* fehlender Typ - wird angelegt,
* vorhandener Typ mit abweichenden Werten - wird angeglichen (und wieder
  aktiviert),
* Typ in der Datenbank, aber nicht mehr im Katalog - wird **deaktiviert**,
  nie geloescht: Geraete koennen auf ihn verweisen (``RESTRICT``).

Ein zweiter Lauf aendert nichts. Kein Commit - die Transaktion gehoert dem
Seed des Core.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.contracts.v1.reference_data import ReferenceDataResult
from app.modules.electrical.catalog import DEVICE_TYPE_CATALOG, DeviceTypeDef
from app.modules.electrical.models import ElectricalDeviceType

MODULE_ID = "electrical"


def _values(definition: DeviceTypeDef) -> dict[str, object]:
    return {
        "label": definition.label,
        "category": definition.category.value,
        "symbol_key": definition.symbol_key,
        "allows_wall_interior": definition.allows_wall_interior,
        "allows_wall_exterior": definition.allows_wall_exterior,
        "allows_ceiling": definition.allows_ceiling,
        "default_center_height_mm": definition.default_center_height_mm,
        "width_mm": definition.width_mm,
        "height_mm": definition.height_mm,
        "sort_order": definition.sort_order,
        "is_active": True,
    }


class ElectricalReferenceData:
    """Gleicht ``electrical_device_types`` mit dem ausgelieferten Katalog ab."""

    def seed_reference_data(self, session: Session) -> ReferenceDataResult:
        # Nur Systemtypen: eigene Typen der Betriebe (ADR 0030) fasst der Seed nie an.
        existing = {
            row.key: row
            for row in session.execute(
                select(ElectricalDeviceType).where(ElectricalDeviceType.organization_id.is_(None))
            ).scalars()
        }
        created = updated = deactivated = 0
        known: set[str] = set()
        for definition in DEVICE_TYPE_CATALOG:
            known.add(definition.key)
            values = _values(definition)
            row = existing.get(definition.key)
            if row is None:
                session.add(ElectricalDeviceType(key=definition.key, **values))
                created += 1
                continue
            changed = False
            for field, value in values.items():
                if getattr(row, field) != value:
                    setattr(row, field, value)
                    changed = True
            updated += int(changed)
        for key, row in existing.items():
            if key not in known and row.is_active:
                row.is_active = False
                deactivated += 1
        session.flush()
        return ReferenceDataResult(
            module_id=MODULE_ID, created=created, updated=updated, deactivated=deactivated
        )
