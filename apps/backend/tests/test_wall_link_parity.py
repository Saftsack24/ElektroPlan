"""Paritaet der Wandkopplung: die Backend-Regeln gegen die gemeinsame Fixture.

``testdata/geometry/wandkopplung.v1.json`` pruefen **beide** Seiten: dieser
Test die verbindlichen Serverregeln (``topology.py``, ``link_rules.py``,
``devices.py``), ``topologie/wandkopplung.test.ts`` den Spiegel im Frontend.
Weicht eine Seite ab, faellt ihr Test (ADR 0024).

Keine Datenbank noetig.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.modules.electrical.devices import (
    DeviceTypeSpec,
    PlannedDevice,
    PlannedRoom,
    device_problems,
)
from app.modules.electrical.geometry import ContourStatus, Point, Segment, contour_report
from app.modules.electrical.link_rules import link_candidates, link_status
from app.modules.electrical.topology import (
    TopoLink,
    TopoOpening,
    TopoWall,
    foreign_openings,
    partition,
)

FIXTURE = Path(__file__).resolve().parents[3] / "testdata" / "geometry" / "wandkopplung.v1.json"
DATEN: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_fixture_hat_die_erwartete_version() -> None:
    assert DATEN["version"] == 1


def _waende(fall: dict[str, Any]) -> list[TopoWall]:
    return [
        TopoWall(
            id=w["id"],
            room_id=r["id"],
            start=Point(x_mm=w["w"][0], y_mm=w["w"][1]),
            end=Point(x_mm=w["w"][2], y_mm=w["w"][3]),
            openings=tuple(
                TopoOpening(
                    id=o["id"],
                    offset_mm=o["abstand"],
                    width_mm=o["breite"],
                    sill_height_mm=o["bruestung"],
                    height_mm=o["hoehe"],
                )
                for o in w["oeffnungen"]
            ),
        )
        for r in fall["raeume"]
        for w in r["waende"]
    ]


def _kopplungen(fall: dict[str, Any]) -> list[TopoLink]:
    return [
        TopoLink(id=k["id"], wall_a_id=k["a"], wall_b_id=k["b"], relation=k["beziehung"])
        for k in fall["kopplungen"]
    ]


@pytest.mark.parametrize("fall", DATEN["faelle"], ids=lambda fall: fall["name"])
def test_abschnitte_und_nachbaroeffnungen(fall: dict[str, Any]) -> None:
    teilung = partition(_waende(fall), _kopplungen(fall))
    for wand_id, zustaende in fall["erwartet"]["abschnitte"].items():
        assert [s.state.value for s in teilung[wand_id].sections] == zustaende, wand_id
    for wand_id, oeffnungen in fall["erwartet"]["fremdoeffnungen"].items():
        gefunden = sorted(f.opening.id for f in foreign_openings(teilung[wand_id]))
        assert gefunden == sorted(oeffnungen), wand_id


@pytest.mark.parametrize("fall", DATEN["faelle"], ids=lambda fall: fall["name"])
def test_kopplungsstatus_und_kandidaten(fall: dict[str, Any]) -> None:
    teilung = partition(_waende(fall), _kopplungen(fall))
    for kopplung in _kopplungen(fall):
        assert link_status(teilung, kopplung).value == fall["erwartet"]["kopplungen"][kopplung.id]
    staerken = {w["id"]: w.get("staerke", 115) for r in fall["raeume"] for w in r["waende"]}
    gueltig = {
        r["id"]
        for r in fall["raeume"]
        if contour_report(
            [
                Segment(
                    key=w["id"],
                    start=Point(x_mm=w["w"][0], y_mm=w["w"][1]),
                    end=Point(x_mm=w["w"][2], y_mm=w["w"][3]),
                )
                for w in r["waende"]
            ]
        ).status
        is ContourStatus.VALID
    }
    kandidaten = link_candidates(
        teilung, _kopplungen(fall), thickness_mm=staerken, valid_rooms=gueltig
    )
    assert [
        {"a": k.wall_a_id, "b": k.wall_b_id, "art": k.kind.value, "gruende": list(k.reasons)}
        for k in kandidaten
    ] == fall["erwartet"]["kandidaten"]


@pytest.mark.parametrize("fall", DATEN["faelle"], ids=lambda fall: fall["name"])
def test_geraetebefunde(fall: dict[str, Any]) -> None:
    typen = {
        key: DeviceTypeSpec(
            key=key,
            width_mm=t["breite"],
            height_mm=t["hoehe"],
            allows_wall_interior=t["innen"],
            allows_wall_exterior=t["aussen"],
            allows_ceiling=t["decke"],
        )
        for key, t in DATEN["typen"].items()
    }
    waende = _waende(fall)
    raeume = [
        PlannedRoom(
            id=r["id"],
            height_mm=r["hoehe"],
            walls=tuple(w for w in waende if w.room_id == r["id"]),
        )
        for r in fall["raeume"]
    ]
    geraete = [
        PlannedDevice(
            id=g["id"],
            room_id=g["raum"],
            type_key=g["typ"],
            surface=g["flaeche"],
            wall_id=g.get("wand"),
            center_offset_mm=g.get("mitte"),
            center_height_mm=g.get("mittelhoehe"),
        )
        for g in fall["geraete"]
    ]
    befunde = device_problems(raeume, geraete, typen, _kopplungen(fall))
    for geraet, codes in fall["erwartet"]["geraete"].items():
        assert sorted({b.code for b in befunde if b.keys[0] == geraet}) == codes, geraet
