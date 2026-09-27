"""Paritaet der Raumgeometrie: die Backend-Regeln gegen die gemeinsame Fixture.

``testdata/geometry/raumgeometrie.v1.json`` enthaelt statische Beispiele, die
**beide** Seiten pruefen: dieser Test die verbindliche Serverregel, der
Frontendtest ``editor/geometrie.test.ts`` den Spiegel im Editor. Weicht eine
Seite ab, faellt ihr Test - stiller Drift ist damit ausgeschlossen.

Die Fixture ist kein API-Vertrag; der steht in Pydantic/OpenAPI (ADR 0009).
Keine Datenbank noetig.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.modules.electrical.geometry import (
    OpeningSpan,
    Point,
    Segment,
    contour_report,
    opening_problems,
    segment_length_mm,
)

FIXTURE = Path(__file__).resolve().parents[3] / "testdata" / "geometry" / "raumgeometrie.v1.json"
DATEN: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_fixture_hat_die_erwartete_version() -> None:
    assert DATEN["version"] == 1


@pytest.mark.parametrize("fall", DATEN["laengen"], ids=lambda fall: fall["name"])
def test_laenge(fall: dict[str, Any]) -> None:
    start = Point(x_mm=fall["start"][0], y_mm=fall["start"][1])
    ende = Point(x_mm=fall["ende"][0], y_mm=fall["ende"][1])
    assert segment_length_mm(start, ende) == fall["laenge_mm"]


@pytest.mark.parametrize("fall", DATEN["konturen"], ids=lambda fall: fall["name"])
def test_kontur(fall: dict[str, Any]) -> None:
    segmente = [
        Segment(key=f"w{index}", start=Point(x_mm=x1, y_mm=y1), end=Point(x_mm=x2, y_mm=y2))
        for index, (x1, y1, x2, y2) in enumerate(fall["waende"])
    ]
    bericht = contour_report(segmente)
    assert bericht.status.value == fall["status"]
    assert bericht.area_mm2 == fall["flaeche_mm2"]
    assert bericht.perimeter_mm == fall["umfang_mm"]
    assert [problem.code for problem in bericht.problems] == fall["codes"]


@pytest.mark.parametrize("fall", DATEN["oeffnungen"], ids=lambda fall: fall["name"])
def test_oeffnung(fall: dict[str, Any]) -> None:
    offset, breite = fall["oeffnung"]
    andere = [
        OpeningSpan(key=f"a{index}", offset_mm=o, width_mm=w)
        for index, (o, w) in enumerate(fall["andere"])
    ]
    befunde = opening_problems(
        opening=OpeningSpan(key="o", offset_mm=offset, width_mm=breite),
        wall_length_mm=fall["wandlaenge_mm"],
        others=andere,
    )
    assert [befund.code for befund in befunde] == fall["codes"]
