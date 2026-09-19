"""Negative Fixture: fehlende Methode ``fetch``.

Mypy muss die Bindung ablehnen.
"""

from __future__ import annotations

from app.core.module_registry.descriptor import bind_port

from ._sample_port import SampleProvider


class MissingMethod:
    module_id: str = "electrical"

    def collect(self, project_id: str, *, verbose: bool = False) -> list[str]:
        return [project_id]


# mypy: error erwartet - MissingMethod fehlt ``fetch``. Der
# ``type-abstract``-Hinweis auf den Protocol-Port wird unterdrueckt, der
# ``arg-type``-Fehler soll aber zwingend feuern.
binding = bind_port(SampleProvider, MissingMethod)  # type: ignore[type-abstract]  # EXPECT_MYPY_ERROR
