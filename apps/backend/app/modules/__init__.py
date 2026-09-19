"""Registrierte Fach- und Shared-Business-Module.

Ein neues Modul benoetigt genau eine Zeile in dieser Liste
(docs/modules.md, Abschnitt 9).

Phase 1 liefert bewusst noch kein Fachmodul: Die Registry wird vom Core
verwendet und in ``tests/test_module_registry.py`` vollstaendig geprueft.
"""

from __future__ import annotations

from app.core.module_registry.descriptor import ModuleDescriptor

REGISTERED_MODULES: list[ModuleDescriptor] = [
    # ab Phase 7: materials.DESCRIPTOR,
    # ab Phase 3: electrical.DESCRIPTOR,
]

__all__ = ["REGISTERED_MODULES"]
