"""Positive Fixture: mypy soll diese Bindung akzeptieren."""

from __future__ import annotations

from app.core.module_registry.descriptor import bind_port

from ._sample_port import SampleProvider


class GoodProvider:
    module_id: str = "electrical"

    def collect(self, project_id: str, *, verbose: bool = False) -> list[str]:
        return [project_id, str(verbose)]

    async def fetch(self, project_id: str) -> int:
        return len(project_id)


# mypy meldet in Strict-Mode ``type-abstract`` fuer den Protocol-Port,
# ohne dass das eine echte Fehlbindung waere. Diese eine Diagnose wird
# gezielt unterdrueckt - andere Fehler (z. B. arg-type) bleiben aktiv.
binding = bind_port(SampleProvider, GoodProvider)  # type: ignore[type-abstract]
