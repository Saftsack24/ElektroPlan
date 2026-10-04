"""Geraetepruefung und Wandtopologie - rein, ohne Datenbank (Phase 5, ADR 0023).

Der Kern ist die gemeinsame Fixture ``testdata/geometry/geraete.v1.json``:
dieselben Faelle prueft der Frontendtest ``geraete/geraetepruefung.test.ts``.
Weicht eine Seite ab, faellt ihr Test.
"""

from __future__ import annotations

import json
from fractions import Fraction
from pathlib import Path
from typing import Any

import pytest

from app.modules.electrical.catalog import (
    DEVICE_TYPE_CATALOG,
    MOUNTING_SURFACES,
    ROOM_TYPES,
)
from app.modules.electrical.device_rules import baseline_of, rejected_problems
from app.modules.electrical.devices import (
    DeviceTypeSpec,
    PlannedDevice,
    PlannedRoom,
    Severity,
    area_inside_rect,
    device_findings,
    device_problems,
    point_in_polygon,
    rect_inside_polygon,
    segment_enters_open_box,
)
from app.modules.electrical.geometry import Point
from app.modules.electrical.schemas import MountingSurfaceValue, RoomTypeValue
from app.modules.electrical.topology import (
    Position,
    TopoOpening,
    TopoWall,
    compare,
    foreign_openings,
    line_measure,
    partition,
)

FIXTURE = Path(__file__).resolve().parents[3] / "testdata" / "geometry" / "geraete.v1.json"
DATEN: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))


def _typen() -> dict[str, DeviceTypeSpec]:
    return {
        key: DeviceTypeSpec(
            key=key,
            width_mm=wert["breite"],
            height_mm=wert["hoehe"],
            allows_wall_interior=wert["innen"],
            allows_wall_exterior=wert["aussen"],
            allows_ceiling=wert["decke"],
        )
        for key, wert in DATEN["typen"].items()
    }


def _raeume(fall: dict[str, Any]) -> list[PlannedRoom]:
    return [
        PlannedRoom(
            id=raum["id"],
            height_mm=raum["hoehe"],
            walls=tuple(
                TopoWall(
                    id=wand["id"],
                    room_id=raum["id"],
                    start=Point(x_mm=wand["w"][0], y_mm=wand["w"][1]),
                    end=Point(x_mm=wand["w"][2], y_mm=wand["w"][3]),
                    openings=tuple(
                        TopoOpening(
                            id=o["id"],
                            offset_mm=o["abstand"],
                            width_mm=o["breite"],
                            sill_height_mm=o["bruestung"],
                            height_mm=o["hoehe"],
                        )
                        for o in wand["oeffnungen"]
                    ),
                )
                for wand in raum["waende"]
            ),
        )
        for raum in fall["raeume"]
    ]


def _geraete(fall: dict[str, Any]) -> list[PlannedDevice]:
    return [
        PlannedDevice(
            id=g["id"],
            room_id=g["raum"],
            type_key=g["typ"],
            surface=g["flaeche"],
            wall_id=g.get("wand"),
            center_offset_mm=g.get("mitte"),
            center_height_mm=g.get("mittelhoehe"),
            x_mm=g.get("x"),
            y_mm=g.get("y"),
        )
        for g in fall["geraete"]
    ]


def test_fixture_hat_die_erwartete_version() -> None:
    assert DATEN["version"] == 1


@pytest.mark.parametrize("fall", DATEN["faelle"], ids=lambda fall: fall["name"])
def test_paritaet_der_geraetepruefung(fall: dict[str, Any]) -> None:
    befunde = device_problems(_raeume(fall), _geraete(fall), _typen())
    je_geraet: dict[str, set[str]] = {g["id"]: set() for g in fall["geraete"]}
    for befund in befunde:
        je_geraet[befund.keys[0]].add(befund.code)
    assert {key: sorted(codes) for key, codes in je_geraet.items()} == fall["erwartet"]


# ------------------------------------------------------------- Bausteine


def test_wurzelvergleich_ist_exakt() -> None:
    mass = line_measure(2)
    grenze = Position(0, 1000)  # 1000 * sqrt(2) = 1414,21...
    assert compare(Position(1414), grenze, mass) == -1
    assert compare(Position(1415), grenze, mass) == 1
    assert compare(Position(1414, 0), Position(1414), mass) == 0
    # Ganze Wurzel: Stufen werden zu Millimetern normalisiert.
    assert line_measure(25).root == 5


def test_teilung_einer_wand_mit_nachbar() -> None:
    a = TopoWall("a", "A", Point(0, 0), Point(5000, 0))
    b = TopoWall(
        "b",
        "B",
        Point(6000, 0),
        Point(0, 0),
        openings=(
            TopoOpening("t", offset_mm=4000, width_mm=900, sill_height_mm=0, height_mm=2000),
        ),
    )
    teilung = partition([a, b])
    assert teilung["a"].boundaries == (Position(0), Position(5000))
    assert [s.room_ids for s in teilung["a"].sections] == [("A", "B")]
    assert teilung["b"].boundaries == (Position(0), Position(1000), Position(6000))
    assert [s.shared for s in teilung["b"].sections] == [False, True]
    fremde = foreign_openings(teilung["a"])
    assert [(f.opening.id, f.span.start, f.span.end) for f in fremde] == [
        ("t", Position(1100), Position(2000))
    ]


def test_beruehrung_am_endpunkt_ist_keine_gemeinsame_wand() -> None:
    a = TopoWall("a", "A", Point(0, 0), Point(3000, 0))
    b = TopoWall("b", "B", Point(3000, 0), Point(6000, 0))
    teilung = partition([a, b])
    assert all(not s.shared for s in teilung["a"].sections)
    assert foreign_openings(teilung["a"]) == []


def test_rechteck_im_l_raum() -> None:
    l_raum = [
        Point(0, 0),
        Point(6000, 0),
        Point(6000, 3000),
        Point(3000, 3000),
        Point(3000, 6000),
        Point(0, 6000),
    ]
    assert rect_inside_polygon(100, 100, 200, 200, l_raum)
    # Im umschliessenden Rechteck, aber in der Aussparung:
    assert not rect_inside_polygon(4000, 4000, 4100, 4100, l_raum)
    # Ueber die einspringende Ecke:
    assert not rect_inside_polygon(2950, 2950, 3050, 3050, l_raum)
    # Kante an Kante mit der Wand ist erlaubt:
    assert rect_inside_polygon(2900, 4000, 3000, 4100, l_raum)


def test_punkt_und_strecke_exakt() -> None:
    quadrat = [Point(0, 0), Point(10, 0), Point(10, 10), Point(0, 10)]
    assert point_in_polygon(5, 5, quadrat)
    assert not point_in_polygon(15, 5, quadrat)
    # Eine Strecke entlang der Kante beruehrt das offene Innere nicht.
    assert not segment_enters_open_box(Point(0, 0), Point(10, 0), 0, 0, 10, 10)
    assert segment_enters_open_box(Point(-5, 5), Point(15, 5), 0, 0, 10, 10)
    assert not segment_enters_open_box(Point(-5, -5), Point(0, 0), 0, 0, 10, 10)
    # Diagonale durch die Ecken geht durchs Innere.
    assert segment_enters_open_box(Point(0, 0), Point(10, 10), 0, 0, 10, 10)


# ------------------------------------------------------------- Katalog


def test_katalog_ist_klein_eindeutig_und_vollstaendig() -> None:
    keys = [definition.key for definition in DEVICE_TYPE_CATALOG]
    assert len(keys) == len(set(keys))
    kategorien = {definition.category.value for definition in DEVICE_TYPE_CATALOG}
    assert kategorien == {"socket", "switch", "light", "data"}
    # Mindestens ein ausdruecklich aussen geeigneter Leuchtentyp.
    assert any(
        definition.category.value == "light" and definition.allows_wall_exterior
        for definition in DEVICE_TYPE_CATALOG
    )
    # Ein- und Mehrfachsteckdosen, Deckenleuchte.
    assert {"socket_single", "socket_double", "socket_triple", "light_ceiling"} <= set(keys)
    for definition in DEVICE_TYPE_CATALOG:
        assert definition.width_mm % 2 == 0 and definition.height_mm % 2 == 0
        assert (
            definition.allows_wall_interior
            or definition.allows_wall_exterior
            or definition.allows_ceiling
        )
        wand = definition.allows_wall_interior or definition.allows_wall_exterior
        assert (definition.default_center_height_mm is not None) == wand


def test_wertelisten_stimmen_mit_den_schemas_ueberein() -> None:
    assert tuple(RoomTypeValue.__args__) == ROOM_TYPES  # type: ignore[attr-defined]
    assert tuple(MountingSurfaceValue.__args__) == MOUNTING_SURFACES  # type: ignore[attr-defined]


# ------------------------------------------- Ausmass und Konfliktpartner

_SPEC = {
    "s": DeviceTypeSpec("s", 80, 80, True, True, False),
    "d": DeviceTypeSpec("d", 100, 100, False, False, True),
}


def _rechteckraum(rid: str, x0: int, y0: int, x1: int, y1: int, hoehe: int = 2_500) -> PlannedRoom:
    ecken = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    return PlannedRoom(
        id=rid,
        height_mm=hoehe,
        walls=tuple(
            TopoWall(
                id=f"{rid}-w{i}",
                room_id=rid,
                start=Point(x_mm=ecken[i][0], y_mm=ecken[i][1]),
                end=Point(x_mm=ecken[(i + 1) % 4][0], y_mm=ecken[(i + 1) % 4][1]),
            )
            for i in range(4)
        ),
    )


def _wand(
    gid: str, mitte: int, hoehe: int = 300, wand: str = "r-w0", flaeche: str = "wall_interior"
) -> PlannedDevice:
    return PlannedDevice(gid, "r", "s", flaeche, wand, mitte, hoehe)


def test_ausmass_vergleich_exakt_auch_irrational() -> None:
    assert Severity(Fraction(10)).not_worse_than(Severity(Fraction(10)))
    assert Severity(Fraction(9)).not_worse_than(Severity(Fraction(10)))
    assert not Severity(Fraction(11)).not_worse_than(Severity(Fraction(10)))
    # 3·√2 ≈ 4.24 gegen 4 und 5; gleiche Schrittlaenge exakt vergleichbar.
    assert not Severity(Fraction(0), 3, 2).not_worse_than(Severity(Fraction(4)))
    assert Severity(Fraction(0), 3, 2).not_worse_than(Severity(Fraction(5)))
    assert Severity(Fraction(1), 3, 2).not_worse_than(Severity(Fraction(1), 3, 2))
    assert not Severity(Fraction(1), 4, 2).not_worse_than(Severity(Fraction(1), 3, 2))
    # Verschiedene irrationale Schrittlaengen: konservativ schlechter.
    assert not Severity(Fraction(0), 1, 2).not_worse_than(Severity(Fraction(100), 1, 3))


def test_flaeche_innerhalb_der_kontur_auch_im_l_raum() -> None:
    l_raum = [Point(x_mm=x, y_mm=y) for x, y in
              [(0, 0), (4000, 0), (4000, 2000), (2000, 2000), (2000, 4000), (0, 4000)]]  # fmt: skip
    assert area_inside_rect(100, 100, 200, 200, l_raum) == 10_000
    # Rechteck ueber der Innenecke (2000, 2000): ein Viertel liegt aussen.
    assert area_inside_rect(1950, 1950, 2050, 2050, l_raum) == 7_500
    assert area_inside_rect(5000, 5000, 5100, 5100, l_raum) == 0


def test_hoehe_ueberstand_waechst_bei_gleichem_code() -> None:
    vorher = device_findings([_rechteckraum("r", 0, 0, 5000, 4000, 2_150)],
                             [_wand("g", 1000, 2_150)], _SPEC)  # fmt: skip
    tiefer = device_findings([_rechteckraum("r", 0, 0, 5000, 4000, 2_100)],
                             [_wand("g", 1000, 2_150)], _SPEC)  # fmt: skip
    hoeher = device_findings([_rechteckraum("r", 0, 0, 5000, 4000, 2_170)],
                             [_wand("g", 1000, 2_150)], _SPEC)  # fmt: skip
    assert [f.severity.whole for f in vorher] == [40]
    basis = baseline_of(vorher)
    abgelehnt = rejected_problems(tiefer, basis)
    assert [p.code for p in abgelehnt] == ["device-exceeds-room-height"]
    assert "groesser" in abgelehnt[0].message
    assert rejected_problems(hoeher, basis) == []
    assert rejected_problems(vorher, basis) == []
    # Ein direkt geaendertes Geraet darf keinen Befund haben - auch keinen kleineren.
    assert [p.code for p in rejected_problems(hoeher, basis, frozenset({"g"}))] == [
        "device-exceeds-room-height"
    ]


def test_ueberdeckung_zweier_geraete_ausmass_und_partner() -> None:
    raum = [_rechteckraum("r", 0, 0, 5000, 4000)]
    basis = baseline_of(device_findings(raum, [_wand("a", 1000), _wand("b", 1060)], _SPEC))
    # Groessere Ueberdeckung (40 statt 20 mm Breite).
    groesser = device_findings(raum, [_wand("a", 1000), _wand("b", 1040)], _SPEC)
    assert {p.code for p in rejected_problems(groesser, basis)} == {"devices-overlap"}
    # Kleinere: zulaessig.
    kleiner = device_findings(raum, [_wand("a", 1000), _wand("b", 1070)], _SPEC)
    assert rejected_problems(kleiner, basis) == []
    # Neuer Partner c bei a: abgelehnt, obwohl a den Code schon hatte.
    neu = device_findings(raum, [_wand("a", 1000), _wand("b", 1060), _wand("c", 950)], _SPEC)
    keys = {tuple(p.keys) for p in rejected_problems(neu, basis)}
    assert ("a", "c") in keys and ("c", "a") in keys and ("a", "b") not in keys


def test_aussen_auf_geteilter_wand_neuer_nachbar_und_laenge() -> None:
    # Raum r (0..5000) mit Aussenleuchte auf der Wand y=0; Nachbar n darunter teilt 0..1000.
    def lage(nachbar_bis: int, zweiter: bool = False) -> list[PlannedRoom]:
        raeume = [
            _rechteckraum("r", 0, 0, 5000, 4000),
            _rechteckraum("n", 0, -3000, nachbar_bis, 0),
        ]
        if zweiter:
            raeume.append(_rechteckraum("m", nachbar_bis, -3000, 5000, 0))
        return raeume

    leuchte = [_wand("g", 1000, 1_800, flaeche="wall_exterior")]  # x 960..1040
    basis = baseline_of(device_findings(lage(1_000), leuchte, _SPEC))
    (bestand,) = basis.items()
    assert bestand[0] == ("g", "device-exterior-on-shared-wall", "n")
    assert bestand[1].whole == 40
    # Nachbar reicht weiter: 80 mm geteilt -> groesser -> abgelehnt.
    assert rejected_problems(device_findings(lage(1_020), leuchte, _SPEC), basis)
    # Nachbar kuerzer: 20 mm -> zulaessig.
    assert rejected_problems(device_findings(lage(980), leuchte, _SPEC), basis) == []
    # Zusaetzlicher Nachbar m: neuer Partner -> abgelehnt.
    assert rejected_problems(device_findings(lage(1_000, zweiter=True), leuchte, _SPEC), basis)


def test_deckengeraet_ausserhalb_flaeche_wird_verglichen() -> None:
    def raum(breite: int) -> list[PlannedRoom]:
        return [_rechteckraum("r", 0, 0, breite, 4000)]

    leuchte = [PlannedDevice("d1", "r", "d", "ceiling", x_mm=1000, y_mm=1000)]  # 950..1050
    basis = baseline_of(device_findings(raum(1_020), leuchte, _SPEC))
    assert [s.whole for s in basis.values()] == [3_000]
    assert rejected_problems(device_findings(raum(1_000), leuchte, _SPEC), basis)
    assert rejected_problems(device_findings(raum(1_040), leuchte, _SPEC), basis) == []
