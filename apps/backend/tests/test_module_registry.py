"""Startpruefungen der Module Registry (docs/modules.md, Abschnitt 5).

Ein falsch verdrahtetes Modul soll die Anwendung am Start hindern - nicht
"irgendwie" laufen. Diese Tests decken jede einzelne Pruefung ab.
"""

from __future__ import annotations

from typing import Protocol

import pytest

from app.core.module_registry.descriptor import (
    ModuleDescriptor,
    ModuleKind,
    PermissionDef,
    PortBinding,
    bind_port,
)
from app.core.module_registry.registry import ModuleRegistrationError, ModuleRegistry


def make_module(
    module_id: str,
    kind: ModuleKind = ModuleKind.DOMAIN,
    **overrides: object,
) -> ModuleDescriptor:
    defaults: dict[str, object] = {
        "id": module_id,
        "name": module_id.title(),
        "version": "1.0.0",
        "kind": kind,
        "table_prefix": f"{module_id}_",
    }
    defaults.update(overrides)
    return ModuleDescriptor(**defaults)  # type: ignore[arg-type]


@pytest.fixture
def empty_registry() -> ModuleRegistry:
    return ModuleRegistry()


def test_registriert_und_findet_module(empty_registry: ModuleRegistry) -> None:
    empty_registry.register(make_module("materials", ModuleKind.SHARED))
    empty_registry.validate()

    assert "materials" in empty_registry
    assert len(empty_registry) == 1
    assert empty_registry.get("materials").name == "Materials"


def test_doppelte_modul_id_wird_abgelehnt(empty_registry: ModuleRegistry) -> None:
    empty_registry.register(make_module("electrical"))
    with pytest.raises(ModuleRegistrationError, match="bereits vergeben"):
        empty_registry.register(make_module("electrical"))


def test_ungueltige_modul_id_wird_abgelehnt(empty_registry: ModuleRegistry) -> None:
    with pytest.raises(ModuleRegistrationError, match="Ungueltige Modul-ID"):
        empty_registry.register(make_module("Electrical-PV"))


def test_fehlende_abhaengigkeit_wird_gemeldet(empty_registry: ModuleRegistry) -> None:
    empty_registry.register(make_module("electrical", depends_on=("materials",)))
    with pytest.raises(ModuleRegistrationError, match="nicht registriert"):
        empty_registry.validate()


def test_shared_darf_nicht_von_fachmodul_abhaengen(empty_registry: ModuleRegistry) -> None:
    """Die wichtigste Richtungsregel: Shared kennt keine Fachmodule (ADR 0001)."""
    empty_registry.register(make_module("electrical", ModuleKind.DOMAIN))
    empty_registry.register(make_module("materials", ModuleKind.SHARED, depends_on=("electrical",)))
    with pytest.raises(ModuleRegistrationError, match="Unerlaubte Abhaengigkeitsrichtung"):
        empty_registry.validate()


def test_fachmodul_darf_nicht_von_fachmodul_abhaengen(empty_registry: ModuleRegistry) -> None:
    empty_registry.register(make_module("electrical", ModuleKind.DOMAIN))
    empty_registry.register(make_module("pv", ModuleKind.DOMAIN, depends_on=("electrical",)))
    with pytest.raises(ModuleRegistrationError, match="Unerlaubte Abhaengigkeitsrichtung"):
        empty_registry.validate()


def test_core_darf_nicht_von_shared_abhaengen(empty_registry: ModuleRegistry) -> None:
    empty_registry.register(make_module("materials", ModuleKind.SHARED))
    empty_registry.register(
        make_module("core", ModuleKind.CORE, depends_on=("materials",), table_prefix="")
    )
    with pytest.raises(ModuleRegistrationError, match="Unerlaubte Abhaengigkeitsrichtung"):
        empty_registry.validate()


def test_fachmodul_darf_von_shared_und_core_abhaengen(empty_registry: ModuleRegistry) -> None:
    empty_registry.register(make_module("core", ModuleKind.CORE, table_prefix=""))
    empty_registry.register(make_module("materials", ModuleKind.SHARED, depends_on=("core",)))
    empty_registry.register(
        make_module("electrical", ModuleKind.DOMAIN, depends_on=("core", "materials"))
    )
    empty_registry.validate()


def test_zyklus_wird_erkannt(empty_registry: ModuleRegistry) -> None:
    empty_registry.register(make_module("a", ModuleKind.SHARED, depends_on=("b",)))
    empty_registry.register(make_module("b", ModuleKind.SHARED, depends_on=("a",)))
    with pytest.raises(ModuleRegistrationError, match="Zyklus"):
        empty_registry.validate()


def test_doppelter_tabellenpraefix_wird_abgelehnt(empty_registry: ModuleRegistry) -> None:
    empty_registry.register(make_module("materials", ModuleKind.SHARED, table_prefix="shared_"))
    empty_registry.register(make_module("inventory", ModuleKind.SHARED, table_prefix="shared_"))
    with pytest.raises(ModuleRegistrationError, match="Tabellenpraefix"):
        empty_registry.validate()


def test_permission_muss_dem_schema_folgen(empty_registry: ModuleRegistry) -> None:
    empty_registry.register(
        make_module(
            "electrical",
            permissions=(PermissionDef("electrical.write", "zu kurz"),),
        )
    )
    with pytest.raises(ModuleRegistrationError, match="Ungueltiger Permission-Schluessel"):
        empty_registry.validate()


def test_permission_muss_im_namensraum_liegen(empty_registry: ModuleRegistry) -> None:
    empty_registry.register(
        make_module(
            "electrical",
            permissions=(PermissionDef("inventory.stock.book", "fremder Namensraum"),),
        )
    )
    with pytest.raises(ModuleRegistrationError, match="ausserhalb der Namensraeume"):
        empty_registry.validate()


def test_eigener_namensraum_ist_erlaubt(empty_registry: ModuleRegistry) -> None:
    """Modul ``offers`` nutzt den Namensraum ``offer``."""
    empty_registry.register(
        make_module(
            "offers",
            ModuleKind.SHARED,
            permission_namespaces=("offer",),
            permissions=(PermissionDef("offer.version.approve", "Freigeben"),),
        )
    )
    empty_registry.validate()


def test_namensraum_kollision_wird_abgelehnt(empty_registry: ModuleRegistry) -> None:
    empty_registry.register(
        make_module("offers", ModuleKind.SHARED, permission_namespaces=("offer",))
    )
    empty_registry.register(
        make_module("quotes", ModuleKind.SHARED, permission_namespaces=("offer",))
    )
    with pytest.raises(ModuleRegistrationError, match="Namensraum"):
        empty_registry.validate()


def test_doppelte_permission_wird_abgelehnt(empty_registry: ModuleRegistry) -> None:
    permission = PermissionDef("shared.thing.read", "doppelt")
    empty_registry.register(
        make_module(
            "alpha",
            ModuleKind.SHARED,
            permission_namespaces=("shared",),
            permissions=(permission,),
            table_prefix="alpha_",
        )
    )
    empty_registry.register(
        make_module(
            "beta",
            ModuleKind.SHARED,
            permission_namespaces=("shared",),
            permissions=(permission,),
            table_prefix="beta_",
        )
    )
    with pytest.raises(ModuleRegistrationError, match="Namensraum"):
        empty_registry.validate()


# ------------------------------------------------------------------ Ports


class SampleProvider(Protocol):
    """Beispielport im Stil von ``MaterialRequirementProvider`` (ADR 0003)."""

    module_id: str

    def collect(self, project_id: str) -> list[str]: ...


class GoodProvider:
    module_id = "electrical"

    def collect(self, project_id: str) -> list[str]:
        return [project_id]


class IncompleteProvider:
    module_id = "electrical"


def test_port_implementierung_wird_geprueft(empty_registry: ModuleRegistry) -> None:
    empty_registry.register(
        make_module("electrical", provides=(PortBinding(SampleProvider, GoodProvider),))
    )
    empty_registry.validate()


def test_unvollstaendige_port_implementierung_wird_abgelehnt(
    empty_registry: ModuleRegistry,
) -> None:
    empty_registry.register(
        make_module("electrical", provides=(PortBinding(SampleProvider, IncompleteProvider),))
    )
    with pytest.raises(ModuleRegistrationError, match="fehlt"):
        empty_registry.validate()


class WrongSignatureProvider:
    """Erfuellt das Protocol nicht: falscher Parametername."""

    module_id = "electrical"

    def collect(self, other_id: str) -> list[str]:
        return [other_id]


class WrongReturnProvider:
    """Erfuellt das Protocol nicht: falscher Rueckgabetyp."""

    module_id = "electrical"

    def collect(self, project_id: str) -> int:
        return len(project_id)


def test_port_implementierung_mit_falscher_signatur_wird_abgelehnt(
    empty_registry: ModuleRegistry,
) -> None:
    empty_registry.register(
        make_module(
            "electrical",
            provides=(PortBinding(SampleProvider, WrongSignatureProvider),),
        )
    )
    with pytest.raises(ModuleRegistrationError, match="Parameter"):
        empty_registry.validate()


def test_port_implementierung_mit_falschem_rueckgabetyp_wird_abgelehnt(
    empty_registry: ModuleRegistry,
) -> None:
    empty_registry.register(
        make_module(
            "electrical",
            provides=(PortBinding(SampleProvider, WrongReturnProvider),),
        )
    )
    with pytest.raises(ModuleRegistrationError, match="liefert"):
        empty_registry.validate()


def test_bind_port_liefert_typisiertes_binding() -> None:
    """Doppelt gesichert: ``bind_port`` erzeugt ein Binding, das die Registry
    akzeptiert - und mypy im Strict-Modus greift schon am Aufruf."""
    binding = bind_port(SampleProvider, GoodProvider)
    assert binding.port is SampleProvider
    assert binding.implementation is GoodProvider


class AsyncMismatchProvider:
    """Async-Implementierung eines synchronen Ports."""

    module_id = "electrical"

    async def collect(self, project_id: str) -> list[str]:  # type: ignore[override]
        return [project_id]


def test_sync_async_mismatch_wird_abgelehnt(
    empty_registry: ModuleRegistry,
) -> None:
    empty_registry.register(
        make_module(
            "electrical",
            provides=(PortBinding(SampleProvider, AsyncMismatchProvider),),
        )
    )
    with pytest.raises(ModuleRegistrationError, match="sync/async"):
        empty_registry.validate()


class WrongParamTypeProvider:
    """Erfuellt das Protocol nicht: falscher Parametertyp."""

    module_id = "electrical"

    def collect(self, project_id: int) -> list[str]:  # type: ignore[override]
        return [str(project_id)]


def test_falscher_parametertyp_wird_abgelehnt(
    empty_registry: ModuleRegistry,
) -> None:
    empty_registry.register(
        make_module(
            "electrical",
            provides=(PortBinding(SampleProvider, WrongParamTypeProvider),),
        )
    )
    with pytest.raises(ModuleRegistrationError):
        empty_registry.validate()


# ------------------------------------------------------- reale Konfiguration


def test_reale_konfiguration_ist_gueltig(registry: ModuleRegistry) -> None:
    """Die tatsaechlich ausgelieferte Modulkonfiguration muss gueltig sein."""
    registry.validate()
    assert "core" in registry


def test_core_registriert_seine_permissions(registry: ModuleRegistry) -> None:
    keys = {key for key, _, _ in registry.all_permissions()}
    assert "audit.entry.read" in keys
    assert "module.registry.read" in keys
    assert all(key.count(".") == 2 for key in keys)
