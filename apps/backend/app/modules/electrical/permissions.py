"""Berechtigungen des Fachmoduls ``electrical``.

Bewusst nur **zwei** Schluessel fuer Phase 3: ansehen und bearbeiten. Ein
feineres Modell - je Raum, je Wand, je Oeffnung - waere nicht pflegbar und
haette keinen Nutzen: Wer die Kontur eines Raums erfassen darf, darf auch die
Oeffnungen darin erfassen - und seit Phase 5 auch die Geraete: Sie werden im
selben atomaren Raumentwurf gespeichert (ADR 0023); ein eigener
``electrical.device.write`` wuerde einen Speichervorgang in Teilrechte
zerlegen. Seit Phase 6b.0 gibt es ``electrical.circuit.write`` fuer
Verteilungen, Stromkreise und Geraetezuordnung (ADR 0026), seit Phase 6b.3
``electrical.route.write`` fuer Leitungen und Durchfuehrungen, seit Phase 6c (V1,
ADR 0027) ``electrical.defaults.manage`` fuer betriebsweite Planungsvorgaben und
Kabelvorlagen, seit K2 ``electrical.device_types.manage`` fuer eigene
Geraetetypen; weitere Schluessel entstehen mit den Phasen, die sie brauchen
(docs/modules/electrical.md, Abschnitt 7).

``default_roles`` nennt die ausgelieferten Systemrollen, die den Schluessel
beim Seed erhalten. Der Administrator erhaelt ohnehin jede registrierte
Berechtigung (docs/security.md, Abschnitt 4).
"""

from __future__ import annotations

from app.core.module_registry.descriptor import PermissionDef

PLAN_READ = "electrical.plan.read"
PLAN_WRITE = "electrical.plan.write"
#: Verteilungen, Stromkreise und Geraetezuordnung (Phase 6b.0, ADR 0026).
CIRCUIT_WRITE = "electrical.circuit.write"
#: Leitungen, Wegpunkte, Kabelangaben und Durchfuehrungen (Phase 6b.3, ADR 0026);
#: seit Phase 6c auch die Projektvorgabe und Abweichungen je Leitung (ADR 0027).
ROUTE_WRITE = "electrical.route.write"
#: Betriebsstandard, Kabelvorlagen und Vorlage je Geraetetyp (Phase 6c, V1, ADR 0027).
#: Betriebsweit - ein Projektbearbeiter aendert damit nie die Vorgaben aller Projekte.
DEFAULTS_MANAGE = "electrical.defaults.manage"
#: Betriebseigene Geraetetypen anlegen, aendern, deaktivieren, entfernen (Phase 6c, K2,
#: ADR 0030). Betriebsweit; Auswahl und Platzieren bleiben bei ``electrical.plan.write``.
DEVICE_TYPES_MANAGE = "electrical.device_types.manage"

ELECTRICAL_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(
        PLAN_READ,
        "Elektroplanung ansehen (Raeume, Waende, Oeffnungen, Geraete)",
        default_roles=("planer", "kalkulator", "monteur"),
    ),
    PermissionDef(
        PLAN_WRITE,
        "Elektroplanung bearbeiten (Raeume, Waende, Oeffnungen, Geraete)",
        default_roles=("planer",),
    ),
    PermissionDef(
        CIRCUIT_WRITE,
        "Verteilungen und Stromkreise bearbeiten, Geraete Stromkreisen zuordnen",
        default_roles=("planer",),
    ),
    PermissionDef(
        ROUTE_WRITE,
        "Leitungen, Leitungswege und Durchfuehrungen bearbeiten, Unterbrechungen bestaetigen",
        default_roles=("planer",),
    ),
    # Standard: nur der Administrator (erhaelt jede Berechtigung) - Entwurf 6c §14.
    PermissionDef(
        DEFAULTS_MANAGE,
        "Betriebsweite Planungsvorgaben und Kabelvorlagen verwalten",
        default_roles=(),
    ),
    # Standard: nur der Administrator (erhaelt jede Berechtigung) - Entscheidung R2 (K2).
    PermissionDef(
        DEVICE_TYPES_MANAGE,
        "Betriebseigene Geraetetypen anlegen, aendern, deaktivieren und entfernen",
        default_roles=(),
    ),
)
