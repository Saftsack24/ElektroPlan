"""Selbstbeschreibung des Fachmoduls ``electrical``.

``depends_on = ("core",)`` und sonst nichts: In den Phasen 3-6 haengt die
Elektroplanung ausschliesslich am Core. ``materials`` existiert noch nicht -
eine Abhaengigkeit darauf wuerde die Module Registry beim Start ablehnen, und
ein leeres Platzhaltermodul waere Vorratscode (docs/modules.md, Abschnitt 3;
ADR 0003, Punkt 6).

``depends_on`` ist **keine Importerlaubnis**. Welche Core-Dateien dieses Modul
tatsaechlich benutzen darf, steht als Positivliste in
``app/core/module_registry/boundaries.py`` (``CORE_PUBLIC_SURFACE``) und wird
statisch geprueft.

``provides`` bleibt leer: Provider-Ports entstehen mit dem Modul, das sie
aufruft - das ist ``materials`` ab Phase 7.
"""

from __future__ import annotations

from app.core.module_registry.descriptor import ModuleDescriptor, ModuleKind
from app.modules.electrical.api import router
from app.modules.electrical.permissions import ELECTRICAL_PERMISSIONS

DESCRIPTOR = ModuleDescriptor(
    id="electrical",
    name="Elektroplanung",
    version="1.0.0",
    kind=ModuleKind.DOMAIN,
    depends_on=("core",),
    table_prefix="electrical_",
    permissions=ELECTRICAL_PERMISSIONS,
    router=router,
    subscriptions=(),
    provides=(),
)
