"""Routen-Introspektion fuer Architekturtests.

FastAPI haengt Router seit 0.141 verschachtelt ein (``_IncludedRouter``) statt
sie flachzuklopfen. Diese Hilfsfunktion laeuft die Struktur ab und liefert
vollstaendige Pfade samt Route-Objekt.
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence

from fastapi import FastAPI
from fastapi.routing import APIRoute, _IncludedRouter
from starlette.routing import BaseRoute


def iter_api_routes(
    routes: Sequence[BaseRoute], prefix: str = ""
) -> Iterator[tuple[str, APIRoute]]:
    """Liefert ``(voller_pfad, route)`` fuer alle APIRoutes."""
    for route in routes:
        if isinstance(route, APIRoute):
            yield prefix + route.path, route
        elif isinstance(route, _IncludedRouter):
            yield from iter_api_routes(
                route.original_router.routes,
                prefix + (route.include_context.prefix or ""),
            )


def all_routes(app: FastAPI) -> list[tuple[str, APIRoute]]:
    return sorted(iter_api_routes(app.routes), key=lambda item: item[0])
