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

``provides`` bindet seit Phase 4d den Teilnehmer des Loeschprotokolls fuer
Projekte (``ProjectContentParticipant``, ADR 0020) und seit Phase 4f den
Pruefer einer neuen Geschoss-Standardhoehe (``FloorCeilingHeightParticipant``,
ADR 0022). Die Provider-Ports fuer ``materials`` kommen erst mit Phase 7.
"""

from __future__ import annotations

from app.contracts.v1.floor_planning import FloorCeilingHeightParticipant
from app.contracts.v1.project_lifecycle import ProjectContentParticipant
from app.core.module_registry.descriptor import ModuleDescriptor, ModuleKind, bind_port
from app.modules.electrical.api import router
from app.modules.electrical.floor_height import ElectricalFloorHeightCheck
from app.modules.electrical.lifecycle import ElectricalProjectContent
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
    provides=(
        bind_port(ProjectContentParticipant, ElectricalProjectContent),
        bind_port(FloorCeilingHeightParticipant, ElectricalFloorHeightCheck),
    ),
)
