"""Negative Fixture: falscher Parametertyp bei ``collect``."""

from __future__ import annotations

from app.core.module_registry.descriptor import bind_port

from ._sample_port import SampleProvider


class WrongParamType:
    module_id: str = "electrical"

    def collect(self, project_id: int, *, verbose: bool = False) -> list[str]:
        return [str(project_id), str(verbose)]

    async def fetch(self, project_id: str) -> int:
        return len(project_id)


# mypy: error erwartet - project_id ist int statt str.
binding = bind_port(SampleProvider, WrongParamType)  # type: ignore[type-abstract]  # EXPECT_MYPY_ERROR
