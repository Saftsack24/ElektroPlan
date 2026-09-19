"""Beispielport im Stil von ``MaterialRequirementProvider``.

Wird von den mypy-Fixtures gemeinsam benutzt, damit Port-Typ und Test-
Implementierungen konsistent bleiben. Er lebt bewusst *in* ``tests``,
damit er nicht Teil der Produktions-Contracts wird.
"""

from __future__ import annotations

from typing import Protocol


class SampleProvider(Protocol):
    """Ports haben ein ``module_id`` und mindestens eine Methode."""

    module_id: str

    def collect(self, project_id: str, *, verbose: bool = False) -> list[str]: ...

    async def fetch(self, project_id: str) -> int: ...
