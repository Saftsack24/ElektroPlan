"""Negative Fixture: falsche Parameteranzahl bei ``collect``."""

from __future__ import annotations

from app.core.module_registry.descriptor import bind_port

from ._sample_port import SampleProvider


class WrongArity:
    module_id: str = "electrical"

    def collect(self) -> list[str]:  # type: ignore[override]  # unwichtig fuer den Test
        return []

    async def fetch(self, project_id: str) -> int:
        return len(project_id)


# mypy: error erwartet - collect fehlt der Parameter ``project_id``.
binding = bind_port(SampleProvider, WrongArity)  # type: ignore[type-abstract]  # EXPECT_MYPY_ERROR
