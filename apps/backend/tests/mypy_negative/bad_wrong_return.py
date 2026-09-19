"""Negative Fixture: falscher Rueckgabetyp bei ``collect``."""

from __future__ import annotations

from app.core.module_registry.descriptor import bind_port

from ._sample_port import SampleProvider


class WrongReturn:
    module_id: str = "electrical"

    def collect(self, project_id: str, *, verbose: bool = False) -> int:
        return len(project_id) + int(verbose)

    async def fetch(self, project_id: str) -> int:
        return len(project_id)


# mypy: error erwartet - collect liefert int statt list[str].
binding = bind_port(SampleProvider, WrongReturn)  # type: ignore[type-abstract]  # EXPECT_MYPY_ERROR
