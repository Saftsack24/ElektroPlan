"""Beschreibung eines Moduls (docs/modules.md, Abschnitt 5)."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Generic, TypeVar

from fastapi import APIRouter

# Ruff UP046/UP047 empfehlen PEP-695-Typparameter (``class PortBinding[TPort]:``).
# Wir bleiben bewusst bei ``Generic[TPort]``, weil dataclass mit slots und
# PEP-695-Syntax unter Python 3.12 zusaetzliche Feinheiten ins Spiel bringt und
# der Effekt fuer den Nutzer identisch ist. Die Regelverletzung wird gezielt
# unterdrueckt.
from app.core.events.bus import Subscription


class ModuleKind(StrEnum):
    """Ebene eines Moduls. Bestimmt die erlaubten Abhaengigkeitsrichtungen."""

    CORE = "core"
    SHARED = "shared"
    DOMAIN = "domain"


#: Welche Ebene darf von welcher abhaengen (ADR 0001).
ALLOWED_DEPENDENCIES: dict[ModuleKind, frozenset[ModuleKind]] = {
    ModuleKind.CORE: frozenset({ModuleKind.CORE}),
    ModuleKind.SHARED: frozenset({ModuleKind.CORE, ModuleKind.SHARED}),
    ModuleKind.DOMAIN: frozenset({ModuleKind.CORE, ModuleKind.SHARED}),
}


@dataclass(frozen=True, slots=True)
class PermissionDef:
    """Eine vom Modul registrierte Berechtigung."""

    key: str
    description: str


TPort = TypeVar("TPort")


@dataclass(frozen=True, slots=True)
class PortBinding(Generic[TPort]):  # noqa: UP046
    """Bindet eine Port-Implementierung an ihren Contract (ADR 0003).

    Beide Angaben sind ueber ``TPort`` generisch aneinander gebunden: Nur
    eine Klasse, die das Protocol ``TPort`` erfuellt, kann als
    ``implementation`` uebergeben werden - mypy meldet die Verletzung im
    Strict-Modus. Zusaetzlich prueft die Registry zur Startzeit strukturell,
    ob die Methoden-Signaturen zusammenpassen (docs/modules.md, Abschnitt 5).
    """

    port: type[TPort]
    implementation: type[TPort]


def bind_port(port: type[TPort], implementation: type[TPort]) -> PortBinding[TPort]:  # noqa: UP047
    """Typisierter Konstruktor fuer ein :class:`PortBinding`.

    Diese Fabrikfunktion ist die einzige empfohlene Art, ein Binding zu
    erzeugen: Beim direkten Instanziieren wuerde Python das Generic nicht
    aus den Argumenten ableiten koennen, sodass eine Fehlbindung erst zur
    Laufzeit auffiele. Mit ``bind_port(MaterialRequirementProvider,
    ElectricalMaterialProvider)`` erzwingt mypy ``TPort`` bereits am
    Aufruf und meldet eine falsche Implementierung im Strict-Modus als
    Fehler (siehe ``tests/test_ports_typing.py``).
    """
    return PortBinding(port=port, implementation=implementation)


@dataclass(frozen=True, slots=True)
class ModuleDescriptor:
    """Vollstaendige Selbstbeschreibung eines Moduls."""

    id: str
    name: str
    version: str
    kind: ModuleKind
    depends_on: tuple[str, ...] = field(default=())
    table_prefix: str = ""
    permissions: tuple[PermissionDef, ...] = field(default=())
    #: Erlaubte Praefixe der Permission-Schluessel. Standard: die Modul-ID.
    #: Beispiel: Modul ``offers`` nutzt den Namensraum ``offer``.
    permission_namespaces: tuple[str, ...] = field(default=())
    router: APIRouter | None = None
    subscriptions: tuple[Subscription, ...] = field(default=())
    provides: tuple[PortBinding[object], ...] = field(default=())

    @property
    def namespaces(self) -> tuple[str, ...]:
        return self.permission_namespaces or (self.id,)

    @property
    def permission_keys(self) -> tuple[str, ...]:
        return tuple(permission.key for permission in self.permissions)
