"""Leitungsweg, Laenge, Status und Trassen - die reine Funktion gegen die gemeinsame Fixture.

``testdata/geometry/leitung.v1.json`` pruefen **beide** Seiten: dieser Test
``cable_length.py``/``cable_traces.py``, ``leitung/laenge.test.ts`` den Spiegel
im Frontend (Phase 6b.2, ADR 0026, Entwurf §5/§6). Keine Datenbank noetig.
"""

from __future__ import annotations

import copy
import json
import uuid
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from app.modules.electrical.cable_length import (
    AreaWaypoint,
    Cable,
    CableDevice,
    CableOpening,
    CablePenetration,
    CablePlan,
    CableResult,
    CableRiser,
    CableRoom,
    CableStatus,
    CableWall,
    OpeningCrossingWaypoint,
    PenetrationWaypoint,
    ProblemKind,
    RiserRun,
    RiserWaypoint,
    WallWaypoint,
    Waypoint,
    analyse_cable,
    analyse_cables,
    percent_reserve_mm,
    prepare_plan,
    rounded_position,
    segment_inside_contour,
    segment_points,
    shared_sources,
    wall_axis_point,
)
from app.modules.electrical.cable_traces import derive_traces
from app.modules.electrical.geometry import Point
from app.modules.electrical.riser_course import CoursePoint, RiserFloor, RiserStopPoint
from app.modules.electrical.topology import Position, TopoLink, line_measure, transfer

FIXTURE = Path(__file__).resolve().parents[3] / "testdata" / "geometry" / "leitung.v1.json"
DATEN: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))
_NS = uuid.UUID("6b2a0000-0000-4000-8000-000000000000")


def _id(name: str) -> uuid.UUID:
    return uuid.uuid5(_NS, name)


# ------------------------------------------------------------------ Fixture lesen


def _plan_daten(name: str) -> dict[str, Any]:
    roh = DATEN["plaene"][name]
    if "basis" not in roh:
        return copy.deepcopy(roh)
    plan = _plan_daten(roh["basis"])
    for key, items in roh.get("ersetzen", {}).items():
        liste = plan.setdefault(key, [])
        for item in items:
            index = next((i for i, alt in enumerate(liste) if alt["id"] == item["id"]), None)
            if index is None:
                liste.append(item)
            else:
                liste[index] = item
    for key, ids in roh.get("entfernen", {}).items():
        plan[key] = [item for item in plan.get(key, []) if item["id"] not in ids]
    return plan


def _plan(name: str) -> CablePlan:
    daten = _plan_daten(name)
    return CablePlan(
        floors=tuple(
            RiserFloor(_id(g["id"]), g["ebene"], g["hoehe"], g["bestaetigt"], g["decke"])
            for g in daten["geschosse"]
        ),
        rooms=tuple(
            CableRoom(
                id=r["id"],
                floor_id=_id(r["geschoss"]),
                height_mm=r["hoehe"],
                walls=tuple(
                    CableWall(
                        id=w["id"],
                        start=Point(*w["von"]),
                        end=Point(*w["bis"]),
                        openings=tuple(
                            CableOpening(
                                o["id"],
                                o["art"],
                                o["abstand"],
                                o["breite"],
                                o["bruestung"],
                                o["hoehe"],
                            )
                            for o in w.get("oeffnungen", [])
                        ),
                    )
                    for w in r["waende"]
                ),
            )
            for r in daten["raeume"]
        ),
        links=tuple(TopoLink(k["id"], k["a"], k["b"], k["beziehung"]) for k in daten["kopplungen"]),
        devices=tuple(
            CableDevice(
                id=g["id"],
                room_id=g["raum"],
                surface=g["flaeche"],
                wall_id=g.get("wand"),
                center_offset_mm=g.get("abstand"),
                center_height_mm=g.get("hoehe"),
                x_mm=g.get("x"),
                y_mm=g.get("y"),
            )
            for g in daten["geraete"]
        ),
        penetrations=tuple(
            CablePenetration(d["id"], d["kopplung"], d["abstand"], d["hoehe"])
            for d in daten["durchfuehrungen"]
        ),
        risers=tuple(
            CableRiser(
                s["id"],
                s["versatz"],
                tuple(
                    RiserStopPoint(_id(h["id"]), _id(h["geschoss"]), h["x"], h["y"])
                    for h in s["halte"]
                ),
            )
            for s in daten["steigwege"]
        ),
    )


def _wegpunkt(roh: list[Any]) -> Waypoint:
    art = roh[0]
    if art == "wand":
        return WallWaypoint(roh[1], roh[2], roh[3])
    if art in ("decke", "boden"):
        return AreaWaypoint("ceiling" if art == "decke" else "floor", roh[1], roh[2], roh[3])
    if art == "durchfuehrung":
        return PenetrationWaypoint(roh[1])
    if art == "uebergang":
        return OpeningCrossingWaypoint(roh[1], roh[2], roh[3])
    assert art == "steigweg"
    return RiserWaypoint(roh[1], _id(roh[2]), roh[3], _id(roh[4]), roh[5])


def _leitung(roh: dict[str, Any]) -> Cable:
    zugaben = roh.get("zugaben", [0, 0, 0])
    kabel = roh.get("kabel", [None, None, None])
    prozent = roh.get("reserve_prozent")
    return Cable(
        id=roh["id"],
        start_device_id=roh["start"],
        end_device_id=roh["ende"],
        waypoints=tuple(_wegpunkt(w) for w in roh["wegpunkte"]),
        start_allowance_mm=zugaben[0],
        end_allowance_mm=zugaben[1],
        reserve_mm=zugaben[2],
        cable_type=kabel[0],
        conductor_count=kabel[1],
        cross_section_mm2=None if kabel[2] is None else Decimal(kabel[2]),
        reserve_mode="fixed" if prozent is None else "percent",
        reserve_percent=None if prozent is None else Decimal(prozent),
    )


def _strecken(result: CableResult) -> list[list[Any]]:
    return [[s.kind.value, s.ref, s.length_mm, s.known_mm] for s in result.segments]


# ------------------------------------------------------------------ Faelle


def test_fixture_hat_die_erwartete_version() -> None:
    assert DATEN["version"] == 1


@pytest.mark.parametrize("fall", DATEN["faelle"], ids=lambda fall: fall["name"])
def test_leitungen_und_trassen(fall: dict[str, Any]) -> None:
    plan = _plan(fall["plan"])
    cables = [_leitung(roh) for roh in fall["leitungen"]]
    results = analyse_cables(plan, cables)
    roh_je_id = {roh["id"]: roh for roh in fall["leitungen"]}
    soll_alle = fall["erwartet"]["leitungen"]
    assert [r.cable_id for r in results] == list(soll_alle)
    for result in results:
        soll = soll_alle[result.cable_id]
        assert result.status.value == soll["status"], result.cable_id
        assert _strecken(result) == soll["strecken"], result.cable_id
        assert [[p.code, p.kind.value, p.ref] for p in result.problems] == soll["befunde"]
        assert result.geometric_mm == soll["geometrisch"]
        assert result.allowance_mm == soll["zugaben"]
        assert result.length_mm == soll["laenge"]
        assert result.known_mm == soll["bekannt"]
        assert result.spec_complete is soll["spezifiziert"]
        assert list(result.penetration_ids) == soll["durchfuehrungen"]
        assert result.opening_crossings == soll["bodenuebergaenge"]
        if "verlauf" in soll:
            runs = [run for s in result.segments for run in s.runs if isinstance(run, RiserRun)]
            assert [[[p.x_mm, p.y_mm, p.z_mm] for p in run.course] for run in runs] == soll[
                "verlauf"
            ]
        # Ungueltig ist nie eine gueltige Null: Laenge nur bei ``confirmed``.
        assert (result.length_mm is not None) == (result.status is CableStatus.CONFIRMED)
        assert result.known_mm == result.geometric_mm + result.allowance_mm
        # Reserve getrennt (V1): ohne Angabe in der Fixture gilt die feste Bestandsreserve.
        zugaben = roh_je_id[result.cable_id].get("zugaben", [0, 0, 0])
        assert result.connection_allowance_mm == soll.get(
            "anschlusszugaben", zugaben[0] + zugaben[1]
        )
        assert result.reserve_mm == soll.get("reserve", zugaben[2])
        assert result.reserve_pending is soll.get("reserve_offen", False)
        assert result.allowance_mm == result.connection_allowance_mm + (result.reserve_mm or 0)

    if "trassen" in fall["erwartet"]:
        soll_t = fall["erwartet"]["trassen"]
        summary = derive_traces(results)
        assert summary.trace_mm == soll_t["flaechen"]
        assert summary.cable_mm == soll_t["leitungsmeter"]
        assert list(summary.penetration_ids) == soll_t["durchfuehrungen"]
        assert summary.opening_crossings == soll_t["bodenuebergaenge"]
        assert [
            [
                t.surface,
                t.owner_id,
                t.direction,
                t.length_mm,
                t.cable_mm,
                t.complete,
                [[p.length_mm, len(p.cable_ids)] for p in t.pieces],
            ]
            for t in summary.traces
        ] == soll_t["liste"]


@pytest.mark.parametrize(
    "fall", DATEN["reserve"], ids=lambda fall: f"{fall['geometrisch']}@{fall['prozent']}"
)
def test_prozentreserve_aufgerundet(fall: dict[str, Any]) -> None:
    """Gemeinsame Rundungsfaelle (Entwurf §8.7, F2): ganze mm, aufgerundet, ganzzahlig."""
    assert percent_reserve_mm(fall["geometrisch"], Decimal(fall["prozent"])) == fall["erwartet"]


def test_prozentreserve_lehnt_mehr_als_zwei_stellen_und_ausserhalb_ab() -> None:
    for prozent in ("12.345", "-1", "100.01"):
        with pytest.raises(ValueError, match="Prozentsatz"):
            percent_reserve_mm(1_000, Decimal(prozent))


@pytest.mark.parametrize("fall", DATEN["gegenlagen"], ids=lambda fall: fall["name"])
def test_gegenlage_der_durchfuehrung(fall: dict[str, Any]) -> None:
    rooms: dict[str, list[CableWall]] = {}
    for w in fall["waende"]:
        rooms.setdefault(w["raum"], []).append(
            CableWall(w["id"], Point(*w["von"]), Point(*w["bis"]))
        )
    link = TopoLink("k", "a", "b", "shared")
    floor = _id("eg")
    prepared = prepare_plan(
        CablePlan(
            floors=(RiserFloor(floor, 0, 0, True, 2500),),
            rooms=tuple(CableRoom(rid, floor, 2500, tuple(ws)) for rid, ws in rooms.items()),
            links=(link,),
        )
    )
    at = Position(fall["abstand"])
    pair = shared_sources(prepared, link, at)
    soll = fall["erwartet"]
    if soll is None:
        assert pair is None
        return
    assert pair is not None
    measure = prepared.walls["a"].item.measure
    opposite = transfer(at, pair[0], pair[1], measure)
    assert [opposite.whole, opposite.steps] == soll["lage"]
    assert rounded_position(opposite, measure) == soll["gerundet"]
    # Hin- und Ruecktransformation ohne Positionsaenderung.
    assert transfer(opposite, pair[1], pair[0], measure) == at


@pytest.mark.parametrize("fall", DATEN["rundung"], ids=lambda fall: str(fall["lage"]))
def test_rundung_exakter_lagen(fall: dict[str, Any]) -> None:
    measure = line_measure(fall["m"])
    assert rounded_position(Position(*fall["lage"]), measure) == fall["erwartet"]


# ------------------------------------------------------------------ Eigenschaften


def test_ergebnis_haengt_nicht_von_der_reihenfolge_der_eingabe_ab() -> None:
    plan = _plan("diele-kueche")
    roh = DATEN["faelle"][0]["leitungen"][0]
    cable = _leitung(roh)
    vorwaerts = analyse_cable(prepare_plan(plan), cable)
    umgedreht = CablePlan(
        floors=plan.floors,
        rooms=tuple(reversed(plan.rooms)),
        links=plan.links,
        devices=tuple(reversed(plan.devices)),
        penetrations=tuple(reversed(plan.penetrations)),
        risers=plan.risers,
    )
    assert analyse_cable(prepare_plan(umgedreht), cable) == vorwaerts


def test_jeder_befund_hat_einen_deutschen_text_und_eine_art() -> None:
    plan = _plan("diele-kueche")
    results = analyse_cables(
        plan, [_leitung(r) for f in DATEN["faelle"][:4] for r in f["leitungen"]]
    )
    problems = [p for r in results for p in r.problems]
    assert problems
    for problem in problems:
        assert problem.message
        assert problem.kind in (ProblemKind.CONFLICT, ProblemKind.MISSING)


def test_kontur_rand_zaehlt_als_innen_und_aussparung_als_aussen() -> None:
    l_raum = [
        Point(0, 0),
        Point(6000, 0),
        Point(6000, 3000),
        Point(3000, 3000),
        Point(3000, 6000),
        Point(0, 6000),
    ]
    # Entlang einer Kante (auf der Wandachse) - innen.
    assert segment_inside_contour(l_raum, 1, Point(0, 1000), Point(0, 5000))
    # Durch die Innenecke - innen, auch umgekehrt.
    assert segment_inside_contour(l_raum, 1, Point(1000, 5000), Point(5000, 1000))
    assert segment_inside_contour(l_raum, 1, Point(5000, 1000), Point(1000, 5000))
    # Von der Innenecke in die Aussparung - aussen.
    assert not segment_inside_contour(l_raum, 1, Point(3000, 3000), Point(4000, 4000))
    # Entlang der Innenkante ueber die Ecke hinaus ins Innere - innen.
    assert segment_inside_contour(l_raum, 1, Point(4000, 3000), Point(2000, 3000))
    # Beide Enden auf dem Rand, die Strecke ausserhalb (ueber die Aussparung).
    assert not segment_inside_contour(l_raum, 1, Point(6000, 3000), Point(3000, 6000))
    # Im Uhrzeigersinn erfasst: gleiche Antworten.
    cw = list(reversed(l_raum))
    assert segment_inside_contour(cw, -1, Point(1000, 5000), Point(5000, 1000))
    assert not segment_inside_contour(cw, -1, Point(6000, 3000), Point(3000, 6000))


# ------------------------------------------------------------------ Raumpunkte


def _fall(name_start: str) -> dict[str, Any]:
    return next(f for f in DATEN["faelle"] if f["name"].startswith(name_start))


def test_raumpunkte_folgen_dem_weg_ohne_sprung_ueber_die_durchfuehrung() -> None:
    """Beispiel §6.4: Diele.ost bei 2 100 und Kueche.west bei 900 sind derselbe Grundrisspunkt."""
    fall = _fall("§6.4")
    prepared = prepare_plan(_plan(fall["plan"]))
    result = analyse_cable(prepared, _leitung(fall["leitungen"][0]))
    punkte = [
        [[p.x_mm, p.y_mm, p.z_mm] for p in segment_points(prepared, s)] for s in result.segments
    ]
    assert punkte == [
        [[500, 0, 1400], [500, 0, 2200]],
        [[500, 0, 2200], [4200, 0, 2200]],
        [],
        [[4200, 0, 2200], [4200, 2100, 2200]],
        [],
        [[4200, 2100, 2200], [4200, 2100, 300]],
    ]
    eg = _id("eg")
    assert {s.floor_id for s in result.segments} == {eg}


def test_raumpunkte_der_schachtfortsetzung_und_des_steigwegs() -> None:
    """Teilnutzung KG -> EG: Steigweg ab 2 200 ueber KG-FFB, dann 1 100 ueber EG-FFB senkrecht."""
    fall = _fall("Steigweg rueckwaerts")
    prepared = prepare_plan(_plan(fall["plan"]))
    teil = next(r for r in fall["leitungen"] if r["id"] == "LS-teil")
    result = analyse_cable(prepared, _leitung(teil))
    riser, shaft = (s for s in result.segments if s.kind.value in ("riser", "shaft"))
    assert segment_points(prepared, riser) == (
        CoursePoint(1200, 3400, -600),
        CoursePoint(1200, 3400, 0),
    )
    assert segment_points(prepared, shaft) == (
        CoursePoint(1200, 3400, 0),
        CoursePoint(1200, 3400, 1100),
    )
    assert riser.floor_id is None and shaft.floor_id is None
    rueck = next(r for r in fall["leitungen"] if r["id"] == "LS-rueck")
    abwaerts = analyse_cable(prepared, _leitung(rueck))
    riser_ab = next(s for s in abwaerts.segments if s.kind.value == "riser")
    assert segment_points(prepared, riser_ab)[0] == CoursePoint(1650, 3700, 2900)
    assert segment_points(prepared, riser_ab)[-1] == CoursePoint(1200, 3400, 2200)


def test_achspunkt_auf_schraeger_wand_beidseitig_derselbe_grundrisspunkt() -> None:
    """Gegenlage 1 846 + 100*sqrt(10) auf Wand b ist derselbe Punkt wie 1 000 auf Wand a."""
    floor = _id("eg")
    link = TopoLink("k", "a", "b", "shared")
    prepared = prepare_plan(
        CablePlan(
            floors=(RiserFloor(floor, 0, 0, True, 2500),),
            rooms=(
                CableRoom("r1", floor, 2500, (CableWall("a", Point(0, 0), Point(3000, 1000)),)),
                CableRoom("r2", floor, 2500, (CableWall("b", Point(3000, 1000), Point(300, 100)),)),
            ),
            links=(link,),
        )
    )
    a = wall_axis_point(prepared.walls["a"], Position(1000))
    b = wall_axis_point(prepared.walls["b"], Position(1846, 100))
    # 1000 * (3, 1) / sqrt(10) = (948,68.., 316,23..) -> (949, 316), je Koordinate gerundet.
    assert a == b == Point(949, 316)
    # Wandenden sind exakt Anfang und Ende (gerundete Wandlaenge, ADR 0013).
    assert wall_axis_point(prepared.walls["a"], Position(3162)) == Point(3000, 1000)
    assert wall_axis_point(prepared.walls["b"], Position(0)) == Point(3000, 1000)
