"""Registrierte Fach- und Shared-Business-Module.

Ein neues Modul benoetigt genau eine Zeile in dieser Liste
(docs/modules.md, Abschnitt 9).
"""

from __future__ import annotations

from app.core.module_registry.descriptor import ModuleDescriptor
from app.modules import electrical

REGISTERED_MODULES: list[ModuleDescriptor] = [
    # ab Phase 7: materials.DESCRIPTOR,
    electrical.DESCRIPTOR,
]

__all__ = ["REGISTERED_MODULES"]
