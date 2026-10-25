"""Betriebseigene Geraetetypen im einen Geraetekatalog (Phase 6c, K2, ADR 0030).

Systemtypen (``organization_id IS NULL``) liefert nur der Seed - sie sind hier nicht
aenderbar. Eigene Typen gehoeren einem Betrieb; ihr Schluessel ``c_<32 hex>`` und ihr
Eigentuemer werden vom Server vergeben und aendern sich nie (CHECK und Trigger).

**Bestandsschutz** (Entwurf §4.3): Ein Typ ist *verwendet*, sobald ein Geraet oder eine
Vorlage je Typ (Betriebsstandard oder Projektvorgabe) auf ihn verweist. Dann sind
Kategorie und Planungsmass gesperrt; eine Montageflaeche, auf der Geraete sitzen, laesst
sich nicht entfernen. Name, Beschreibung, Symbol, Standardhoehe, Reihenfolge und
Aktivstatus bleiben aenderbar - keiner davon veraendert Lage, Mass oder Bedeutung eines
Geraets. Fuer abweichende Varianten legt man einen neuen Typ an.

**Sperrstrategie:** Aendern und Entfernen sperren die Typzeile ``FOR UPDATE`` und zaehlen
die Verweise erst danach. Jeder Weg, der einen eigenen Typ verwendet, sperrt dieselbe
Zeile vorher ``FOR KEY SHARE`` (``device_rules.lock_device_types_for_use``); auch die
Fremdschluesselpruefung der Datenbank haelt diese Sperre bis zum Commit. Eine Aenderung
der gesperrten Angaben und die erste Verwendung koennen sich so nicht ueberholen - eine
vorherige Zaehlung allein waere kein Schutz.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.persistence import CONCURRENT_UPDATE_DETAIL, flush, unique_violation_translated
from app.core.preconditions import check_version
from app.errors import (
    ConflictError,
    NotFoundError,
    ProblemFieldError,
    ValidationFailedError,
    VersionConflictError,
)
from app.modules.electrical.catalog import (
    CUSTOM_SYMBOL_KEYS,
    CUSTOM_TYPE_CATEGORIES,
    CUSTOM_TYPE_KEY_PREFIX,
)
from app.modules.electrical.device_rules import load_device_types, visible_device_types
from app.modules.electrical.models import (
    DEVICE_TYPE_LABEL_CONSTRAINT,
    ElectricalDevice,
    ElectricalDeviceType,
    ElectricalDeviceTypeCableTemplate,
    ElectricalProjectDeviceTypeCableTemplate,
)
from app.modules.electrical.schemas import DeviceTypeCreate, DeviceTypeUpdate

#: Angaben, die bei einem verwendeten Typ gesperrt sind (Kategorie, Planungsmass).
_GESPERRT_BEI_VERWENDUNG = ("category", "width_mm", "height_mm")
_FLAECHEN = {
    "allows_wall_interior": "wall_interior",
    "allows_wall_exterior": "wall_exterior",
    "allows_ceiling": "ceiling",
}


@dataclass(frozen=True, slots=True)
class DeviceTypeView:
    """Ein Typ mit seinen Verweisen im eigenen Betrieb."""

    kind: ElectricalDeviceType
    device_count: int
    template_count: int

    @property
    def in_use(self) -> bool:
        return self.device_count + self.template_count > 0


def _problem(field: str, code: str, message: str) -> ProblemFieldError:
    return ProblemFieldError(field=field, code=code, message=message)


def _invalid(detail: str, *errors: ProblemFieldError) -> ValidationFailedError:
    return ValidationFailedError(detail, errors=list(errors))


def _label_taken() -> ValidationFailedError:
    return _invalid(
        "Es gibt bereits einen aktiven eigenen Geraetetyp mit diesem Namen.",
        _problem("label", "device-type-label-taken", "Name bereits vergeben."),
    )


class DeviceTypeService:
    """Lesen aller sichtbaren Typen, Verwalten der eigenen Typen eines Betriebs."""

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self.session = session
        self.organization_id = organization_id

    # ------------------------------------------------------------------ Lesen

    def list_types(self) -> list[DeviceTypeView]:
        types = list(load_device_types(self.session, self.organization_id).values())
        devices, templates = self._usage([kind.key for kind in types])
        return [
            DeviceTypeView(kind, devices.get(kind.key, 0), templates.get(kind.key, 0))
            for kind in types
        ]

    # -------------------------------------------------------------- Schreiben

    def create(self, payload: DeviceTypeCreate) -> DeviceTypeView:
        values = payload.model_dump()
        self._require_valid(values)
        kind = ElectricalDeviceType(
            key=f"{CUSTOM_TYPE_KEY_PREFIX}{uuid.uuid4().hex}",
            organization_id=self.organization_id,
            **values,
        )
        self.session.add(kind)
        self._flush()
        return DeviceTypeView(kind, 0, 0)

    def update(
        self, key: str, payload: DeviceTypeUpdate, *, expected_version: int
    ) -> DeviceTypeView:
        kind = self._locked_own(key)
        check_version(kind, expected_version)
        changes = payload.model_dump(exclude_unset=True)
        merged = {field: getattr(kind, field) for field in DeviceTypeCreate.model_fields}
        merged.update(changes)
        self._require_valid(merged)
        # Verweise erst nach der Sperre zaehlen - eine laufende erste Verwendung ist dann
        # entweder sichtbar (committet) oder wartet auf diese Transaktion.
        devices, templates = self._usage([kind.key])
        view = DeviceTypeView(kind, devices.get(kind.key, 0), templates.get(kind.key, 0))
        if view.in_use:
            gesperrt = [
                field
                for field in _GESPERRT_BEI_VERWENDUNG
                if field in changes and changes[field] != getattr(kind, field)
            ]
            if gesperrt:
                raise ConflictError(
                    "Dieser Geraetetyp wird bereits verwendet - Kategorie und Planungsmass "
                    "bleiben, damit vorhandene Geraete nicht still ihre Bedeutung oder ihr Mass "
                    "aendern. Fuer eine abweichende Variante bitte einen neuen Typ anlegen.",
                    errors=[
                        _problem(field, "device-type-in-use", "Bei verwendetem Typ gesperrt.")
                        for field in gesperrt
                    ],
                )
        entfernt = [
            surface
            for field, surface in _FLAECHEN.items()
            if changes.get(field) is False and getattr(kind, field)
        ]
        belegt = self._devices_on(kind.key, entfernt)
        if belegt:
            raise ConflictError(
                "Auf dieser Montageflaeche sitzen Geraete dieses Typs - sie bleibt erhalten. "
                "Es wurde nichts geaendert.",
                errors=[
                    _problem(field, "device-type-surface-in-use", "Flaeche mit Geraeten belegt.")
                    for field, surface in _FLAECHEN.items()
                    if surface in belegt
                ],
            )
        changed = False
        for field, value in changes.items():
            if getattr(kind, field) != value:
                setattr(kind, field, value)
                changed = True
        if changed:
            self._flush()
        return view

    def delete(self, key: str, *, expected_version: int) -> None:
        kind = self._locked_own(key)
        check_version(kind, expected_version)
        devices, templates = self._usage([kind.key])
        anzahl = devices.get(kind.key, 0) + templates.get(kind.key, 0)
        if anzahl:
            raise ConflictError(
                f"Dieser Geraetetyp wird noch verwendet ({devices.get(kind.key, 0)} Geraet(e), "
                f"{templates.get(kind.key, 0)} Kabelvorlagen-Zuordnung(en)) und bleibt erhalten. "
                "Deaktivieren verhindert neue Geraete, der Bestand bleibt lesbar.",
                errors=[_problem("key", "device-type-in-use", "Typ wird verwendet.")],
            )
        self.session.delete(kind)
        flush(self.session)

    # ---------------------------------------------------------------- Helfer

    def _locked_own(self, key: str) -> ElectricalDeviceType:
        """Eigener Typ, ``FOR UPDATE`` gesperrt; Systemtyp ``409``, fremd ``404``."""
        sichtbar = self.session.execute(
            select(ElectricalDeviceType.organization_id).where(
                ElectricalDeviceType.key == key, visible_device_types(self.organization_id)
            )
        ).first()
        if sichtbar is None:
            # Fremder Betrieb und unbekannter Schluessel: dieselbe Antwort.
            raise NotFoundError("Geraetetyp wurde nicht gefunden.")
        if sichtbar[0] is None:
            raise ConflictError(
                "Systemtypen werden mit ElektroPlan ausgeliefert und lassen sich nicht aendern "
                "oder entfernen. Fuer eine Variante bitte einen eigenen Typ anlegen.",
                errors=[_problem("key", "device-type-system", "Systemtyp.")],
            )
        locked = self.session.execute(
            select(ElectricalDeviceType)
            .where(
                ElectricalDeviceType.key == key,
                ElectricalDeviceType.organization_id == self.organization_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if locked is None:
            raise VersionConflictError(CONCURRENT_UPDATE_DETAIL)
        return locked

    def _require_valid(self, values: dict[str, object]) -> None:
        errors: list[ProblemFieldError] = []
        if not values.get("label"):
            errors.append(_problem("label", "device-type-label-missing", "Name fehlt."))
        if values.get("category") not in CUSTOM_TYPE_CATEGORIES:
            errors.append(
                _problem(
                    "category",
                    "device-type-category-not-allowed",
                    "Diese Kategorie ist fuer eigene Typen nicht vorgesehen.",
                )
            )
        if values.get("symbol_key") not in CUSTOM_SYMBOL_KEYS:
            errors.append(_problem("symbol_key", "device-type-symbol-unknown", "Symbol unbekannt."))
        if not any(values.get(field) for field in _FLAECHEN):
            errors.append(
                _problem("allows_wall_interior", "device-type-surface-missing", "Flaeche fehlt.")
            )
        for field in ("width_mm", "height_mm"):
            value = values.get(field)
            if not isinstance(value, int) or value % 2 != 0:
                errors.append(_problem(field, "device-type-size-invalid", "Gerade Millimeter."))
        if errors:
            raise _invalid("Die Angaben des Geraetetyps sind so nicht zulaessig.", *errors)

    def _usage(self, keys: list[str]) -> tuple[dict[str, int], dict[str, int]]:
        """Verweise im eigenen Betrieb: Geraete und Vorlagen je Typ (Betrieb und Projekte)."""
        if not keys:
            return {}, {}
        devices: dict[str, int] = {
            key: int(count)
            for key, count in self.session.execute(
                select(ElectricalDevice.device_type_key, func.count())
                .where(
                    ElectricalDevice.organization_id == self.organization_id,
                    ElectricalDevice.device_type_key.in_(keys),
                )
                .group_by(ElectricalDevice.device_type_key)
            ).all()
        }
        templates: dict[str, int] = {}
        for model in (ElectricalDeviceTypeCableTemplate, ElectricalProjectDeviceTypeCableTemplate):
            for key, count in self.session.execute(
                select(model.device_type_key, func.count())
                .where(
                    model.organization_id == self.organization_id, model.device_type_key.in_(keys)
                )
                .group_by(model.device_type_key)
            ).all():
                templates[key] = templates.get(key, 0) + int(count)
        return devices, templates

    def _devices_on(self, key: str, surfaces: list[str]) -> set[str]:
        if not surfaces:
            return set()
        return set(
            self.session.execute(
                select(ElectricalDevice.mounting_surface)
                .where(
                    ElectricalDevice.organization_id == self.organization_id,
                    ElectricalDevice.device_type_key == key,
                    ElectricalDevice.mounting_surface.in_(surfaces),
                )
                .distinct()
            ).scalars()
        )

    def _flush(self) -> None:
        with unique_violation_translated(
            self.session, constraint=DEVICE_TYPE_LABEL_CONSTRAINT, error=_label_taken()
        ):
            flush(self.session)
