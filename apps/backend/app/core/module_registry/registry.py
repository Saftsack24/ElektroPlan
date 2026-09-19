"""Module Registry mit Startpruefungen.

Ein Verstoss verhindert den Start der Anwendung. Ein falsch verdrahtetes Modul
soll nicht "irgendwie" laufen (docs/modules.md, Abschnitt 5).
"""

from __future__ import annotations

import inspect
import re
from collections.abc import Iterable, Sequence
from typing import get_type_hints

from fastapi import FastAPI

from app.core.events.bus import EventBus
from app.core.module_registry.descriptor import (
    ALLOWED_DEPENDENCIES,
    ModuleDescriptor,
    ModuleKind,
)
from app.logging_config import get_logger

logger = get_logger(__name__)

PERMISSION_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$")
MODULE_ID_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")


class ModuleRegistrationError(RuntimeError):
    """Ungueltige Modulkonfiguration."""


class ModuleRegistry:
    """Haelt alle registrierten Module und prueft ihre Konsistenz."""

    def __init__(self) -> None:
        self._modules: dict[str, ModuleDescriptor] = {}

    # --------------------------------------------------------------- Zugriff

    def __contains__(self, module_id: object) -> bool:
        return module_id in self._modules

    def __len__(self) -> int:
        return len(self._modules)

    @property
    def modules(self) -> tuple[ModuleDescriptor, ...]:
        return tuple(self._modules.values())

    def get(self, module_id: str) -> ModuleDescriptor:
        try:
            return self._modules[module_id]
        except KeyError as exc:
            msg = f"Unbekanntes Modul {module_id!r}."
            raise ModuleRegistrationError(msg) from exc

    def all_permissions(self) -> tuple[tuple[str, str, str], ...]:
        """Alle Permissions als ``(key, module_id, description)``."""
        return tuple(
            (permission.key, module.id, permission.description)
            for module in self._modules.values()
            for permission in module.permissions
        )

    def clear(self) -> None:
        self._modules.clear()

    # ------------------------------------------------------------ Registrierung

    def register(self, descriptor: ModuleDescriptor) -> None:
        if descriptor.id in self._modules:
            msg = f"Modul-ID {descriptor.id!r} ist bereits vergeben."
            raise ModuleRegistrationError(msg)
        if not MODULE_ID_PATTERN.match(descriptor.id):
            msg = f"Ungueltige Modul-ID {descriptor.id!r}: nur [a-z0-9_], Beginn mit Buchstabe."
            raise ModuleRegistrationError(msg)
        self._modules[descriptor.id] = descriptor

    def register_all(self, descriptors: Iterable[ModuleDescriptor]) -> None:
        for descriptor in descriptors:
            self.register(descriptor)

    # --------------------------------------------------------------- Pruefung

    def validate(self) -> None:
        """Fuehrt alle Startpruefungen aus."""
        self._validate_dependencies()
        self._validate_no_cycles()
        self._validate_table_prefixes()
        self._validate_permissions()
        self._validate_ports()

    def _validate_dependencies(self) -> None:
        for module in self._modules.values():
            for dependency_id in module.depends_on:
                dependency = self._modules.get(dependency_id)
                if dependency is None:
                    msg = (
                        f"Modul {module.id!r} haengt von {dependency_id!r} ab, "
                        "das nicht registriert ist."
                    )
                    raise ModuleRegistrationError(msg)
                allowed = ALLOWED_DEPENDENCIES[module.kind]
                if dependency.kind not in allowed:
                    msg = (
                        f"Unerlaubte Abhaengigkeitsrichtung: {module.kind} {module.id!r} "
                        f"-> {dependency.kind} {dependency_id!r} (ADR 0001)."
                    )
                    raise ModuleRegistrationError(msg)

    def _validate_no_cycles(self) -> None:
        visiting: set[str] = set()
        visited: set[str] = set()

        def walk(module_id: str, path: Sequence[str]) -> None:
            if module_id in visiting:
                chain = " -> ".join([*path, module_id])
                msg = f"Zyklus in den Modulabhaengigkeiten: {chain}"
                raise ModuleRegistrationError(msg)
            if module_id in visited:
                return
            visiting.add(module_id)
            for dependency_id in self._modules[module_id].depends_on:
                walk(dependency_id, [*path, module_id])
            visiting.discard(module_id)
            visited.add(module_id)

        for module_id in self._modules:
            walk(module_id, [])

    def _validate_table_prefixes(self) -> None:
        seen: dict[str, str] = {}
        for module in self._modules.values():
            prefix = module.table_prefix
            if not prefix:
                continue
            if prefix in seen:
                msg = (
                    f"Tabellenpraefix {prefix!r} wird von {seen[prefix]!r} und "
                    f"{module.id!r} verwendet."
                )
                raise ModuleRegistrationError(msg)
            seen[prefix] = module.id

    def _validate_permissions(self) -> None:
        namespace_owner: dict[str, str] = {}
        seen_keys: dict[str, str] = {}
        for module in self._modules.values():
            for namespace in module.namespaces:
                owner = namespace_owner.get(namespace)
                if owner is not None and owner != module.id:
                    msg = (
                        f"Permission-Namensraum {namespace!r} wird von {owner!r} und "
                        f"{module.id!r} beansprucht."
                    )
                    raise ModuleRegistrationError(msg)
                namespace_owner[namespace] = module.id

            for permission in module.permissions:
                if not PERMISSION_KEY_PATTERN.match(permission.key):
                    msg = (
                        f"Ungueltiger Permission-Schluessel {permission.key!r} in "
                        f"{module.id!r}: erwartet <namensraum>.<objekt>.<aktion>."
                    )
                    raise ModuleRegistrationError(msg)
                if not any(
                    permission.key.startswith(f"{namespace}.") for namespace in module.namespaces
                ):
                    msg = (
                        f"Permission {permission.key!r} liegt ausserhalb der Namensraeume "
                        f"{module.namespaces} von Modul {module.id!r}."
                    )
                    raise ModuleRegistrationError(msg)
                previous = seen_keys.get(permission.key)
                if previous is not None:
                    msg = (
                        f"Permission {permission.key!r} wird von {previous!r} und "
                        f"{module.id!r} registriert."
                    )
                    raise ModuleRegistrationError(msg)
                seen_keys[permission.key] = module.id

    def _validate_ports(self) -> None:
        """Prueft strukturell, ob eine Implementierung ihren Port erfuellt.

        Neben der reinen Existenz der Attribute werden die
        Methoden-Signaturen mit ``inspect.signature`` verglichen: Zahl und
        Namen der Parameter und der Rueckgabetyp muessen mit dem Protocol
        uebereinstimmen. Die statische Bindung ueber
        :func:`app.core.module_registry.descriptor.bind_port` erzwingt das
        bereits im mypy-Strict-Lauf; diese Laufzeitpruefung ist die
        zusaetzliche Rueckfallgrenze und erlaubt frueh sichtbare Fehler
        beim Anwendungsstart.
        """
        for module in self._modules.values():
            for binding in module.provides:
                _verify_port_binding(binding.port, binding.implementation)

    # ---------------------------------------------------------------- Aufbau

    def subscriptions(self) -> tuple[object, ...]:
        return tuple(
            subscription
            for module in self._modules.values()
            for subscription in module.subscriptions
        )

    def wire_events(self, bus: EventBus) -> None:
        """Haengt alle Modul-Subscriptions in den Bus und prueft den Graphen.

        Der Bus wird zuvor geleert. Ohne das wuerden Handler bei jedem erneuten
        Erzeugen der Anwendung - etwa in Tests - mehrfach registriert und jedes
        Event mehrfach verarbeitet.
        """
        bus.clear()
        for module in self._modules.values():
            bus.subscribe_all(module.subscriptions)
        bus.validate()

    def mount_routers(self, app: FastAPI, *, api_prefix: str) -> None:
        """Haengt die Router ein.

        Core und Shared unter ``<prefix>/<resource>``, Fachmodule unter
        ``<prefix>/modules/<id>`` (docs/modules.md, Abschnitt 5).
        """
        for module in self._modules.values():
            if module.router is None:
                continue
            if module.kind is ModuleKind.DOMAIN:
                prefix = f"{api_prefix}/modules/{module.id}"
            else:
                prefix = api_prefix
            app.include_router(module.router, prefix=prefix)
            logger.info("module_router_mounted", module=module.id, prefix=prefix)


def _protocol_members(port: type) -> tuple[str, ...]:
    """Ermittelt die von einem Protocol geforderten Member."""
    explicit = getattr(port, "__protocol_attrs__", None)
    if explicit:
        members: set[str] = set(explicit)
    else:
        members = {
            name
            for name in dir(port)
            if not name.startswith("_") and callable(getattr(port, name, None))
        }
        members.update(getattr(port, "__annotations__", {}).keys())
    return tuple(sorted(members))


def _verify_port_binding(port: type, implementation: type) -> None:
    """Sichtbarer Fehler zur Startzeit statt kryptischer Attributerror.

    Prueft:

    * Existenz aller vom Protocol geforderten Attribute
    * Zahl, Namen, Kind (positional/keyword-only) und Typannotationen
      der Parameter jeder Methode
    * Rueckgabetyp
    * sync/async-Konsistenz (``async def`` gegen synchrones ``def``)
    * Nicht aufloesbare Forward-Referenzen sind ein eigenstaendiger
      Fehler - sie duerfen nicht stillschweigend als "geprueft" gelten.

    Der statische Nachweis ueber :func:`bind_port` in
    ``descriptor.py`` bleibt die primaere Schutzschicht (mypy strict);
    diese Runtime-Pruefung ergaenzt sie.
    """
    for name in _protocol_members(port):
        if not hasattr(implementation, name):
            msg = (
                f"{implementation.__name__} erfuellt {port.__name__} nicht: "
                f"Attribut {name!r} fehlt."
            )
            raise ModuleRegistrationError(msg)

        # Attribute, die auf dem Protocol nur als Annotation stehen
        # (``module_id: str``), sind kein Callable - hier bleibt es bei
        # der Existenzpruefung.
        if not hasattr(port, name):
            continue

        port_attr = getattr(port, name)
        impl_attr = getattr(implementation, name)

        if not callable(port_attr):
            continue

        try:
            expected = inspect.signature(port_attr)
            actual = inspect.signature(impl_attr)
        except (TypeError, ValueError):
            continue

        expected_params = _method_parameters(expected)
        actual_params = _method_parameters(actual)
        if expected_params != actual_params:
            msg = (
                f"{implementation.__name__}.{name}{actual} passt nicht zu "
                f"{port.__name__}.{name}{expected}: Parameter (Name/Kind) "
                "unterscheiden sich."
            )
            raise ModuleRegistrationError(msg)

        # sync/async-Vergleich: ein synchroner Port darf nicht durch eine
        # ``async def``-Implementierung ersetzt werden und umgekehrt.
        if inspect.iscoroutinefunction(port_attr) != inspect.iscoroutinefunction(impl_attr):
            msg = (
                f"{implementation.__name__}.{name} unterscheidet sich in "
                f"sync/async von {port.__name__}.{name}."
            )
            raise ModuleRegistrationError(msg)

        try:
            expected_hints = get_type_hints(port_attr)
            actual_hints = get_type_hints(impl_attr)
        except NameError as exc:
            # Nicht aufloesbare Forward-Refs sind ein Fehler: der
            # Aufrufer erwartet eine Zusicherung, die wir hier nicht
            # abgeben koennen.
            msg = (
                f"Portpruefung {port.__name__}.{name}: nicht aufloesbare "
                f"Typreferenz ({exc}). Bitte den Contract mit auflosbaren "
                "Namen definieren."
            )
            raise ModuleRegistrationError(msg) from exc

        # Rueckgabetyp
        if (
            "return" in expected_hints
            and "return" in actual_hints
            and expected_hints["return"] != actual_hints["return"]
        ):
            msg = (
                f"{implementation.__name__}.{name} liefert "
                f"{actual_hints['return']!r}, erwartet {expected_hints['return']!r} "
                f"laut {port.__name__}."
            )
            raise ModuleRegistrationError(msg)

        # Parametertypen
        for parameter_name in expected.parameters:
            if parameter_name in {"self", "cls", "return"}:
                continue
            expected_type = expected_hints.get(parameter_name)
            actual_type = actual_hints.get(parameter_name)
            if expected_type is not None and expected_type != actual_type:
                msg = (
                    f"{implementation.__name__}.{name}: Parameter "
                    f"{parameter_name!r} ist {actual_type!r}, erwartet "
                    f"{expected_type!r} laut {port.__name__}."
                )
                raise ModuleRegistrationError(msg)


def _method_parameters(signature: inspect.Signature) -> tuple[tuple[str, str, str], ...]:
    """Reduziert eine Signatur auf ``(Name, Kind, HatDefault)`` je Parameter.

    ``self`` und ``cls`` bleiben ausgespart. ``VAR_KEYWORD`` (``**kwargs``)
    wird ausgelassen, weil er als Erweiterung fuer alle Faelle
    unschaedlich ist. ``KEYWORD_ONLY`` wird ausdruecklich erhalten -
    ein Contract-Parameter mit ``*``-Grenze soll auch auf der
    Implementierung so bleiben.
    """

    def _kind(parameter: inspect.Parameter) -> str:
        return "default" if parameter.default is not inspect.Parameter.empty else "required"

    return tuple(
        (parameter.name, parameter.kind.name, _kind(parameter))
        for parameter in signature.parameters.values()
        if parameter.name not in {"self", "cls"}
        and parameter.kind is not inspect.Parameter.VAR_KEYWORD
    )


_registry = ModuleRegistry()


def get_module_registry() -> ModuleRegistry:
    """Prozessweite Registry."""
    return _registry
