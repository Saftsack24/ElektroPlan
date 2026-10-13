"""Verlauf und Laenge von Steigwegen - die reine Funktion gegen die gemeinsame Fixture.

``testdata/geometry/steigweg.v1.json`` pruefen **beide** Seiten: dieser Test
``riser_course.py``, ``steigweg/verlauf.test.ts`` den Spiegel im Frontend
(ADR 0025, Entwurf §2.6/§4.4). Keine Datenbank noetig.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import pytest

from app.modules.electrical.riser_course import (
    CoursePoint,
    RiserFloor,
    RiserStatus,
    RiserStopPoint,
    analyse_riser,
    horizontal_length_mm,
    riser_course,
)

FIXTURE = Path(__file__).resolve().parents[3] / "testdata" / "geometry" / "steigweg.v1.json"
DATEN: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))


def _id(name: str) -> uuid.UUID:
    """Reihenfolgetreue ID: ``str(_id(a)) < str(_id(b))`` genau dann, wenn ``a < b``.

    Das Backend sortiert Halte gleicher Ebene nach ihrer ID, das Frontend nach
    demselben Schluessel als Zeichenkette. Die Fixture benennt Halte; diese
    Abbildung erhaelt die Ordnung der Namen (ASCII, hoechstens 16 Zeichen), damit
    beide Seiten dieselbe Reihenfolge pruefen.
    """
    raw = name.encode("ascii")
    assert len(raw) <= 16, name
    return uuid.UUID(bytes=raw.ljust(16, b"\0"))


def test_fixture_hat_die_erwartete_version() -> None:
    assert DATEN["version"] == 1


@pytest.mark.parametrize("fall", DATEN["faelle"], ids=lambda fall: fall["name"])
def test_verlauf_status_und_laengen(fall: dict[str, Any]) -> None:
    namen = {
        _id(name): name
        for name in [g["id"] for g in fall["geschosse"]] + [h["id"] for h in fall["halte"]]
    }
    floors = [
        RiserFloor(
            floor_id=_id(g["id"]),
            level=g["ebene"],
            elevation_mm=g["hoehe"],
            elevation_confirmed=g["bestaetigt"],
            default_ceiling_height_mm=g["decke"],
        )
        for g in fall["geschosse"]
    ]
    stops = [
        RiserStopPoint(stop_id=_id(h["id"]), floor_id=_id(h["geschoss"]), x_mm=h["x"], y_mm=h["y"])
        for h in fall["halte"]
    ]
    result = analyse_riser(floors, stops, fall["versatz"])
    erwartet = fall["erwartet"]

    assert [namen[stop.stop_id] for stop in result.stops] == erwartet["reihenfolge"]
    assert result.status.value == erwartet["status"]
    assert result.known_length_mm == erwartet["bekannt"]
    assert result.length_mm == erwartet["laenge"]
    assert len(result.sections) == len(erwartet["abschnitte"])
    for section, soll in zip(result.sections, erwartet["abschnitte"], strict=True):
        assert namen[section.lower.stop_id] == soll["von"]
        assert namen[section.upper.stop_id] == soll["bis"]
        assert [namen[f] for f in section.traversed_floor_ids] == soll["durchquert"]
        assert section.status.value == soll["status"]
        assert [[p.x_mm, p.y_mm, p.z_mm] for p in section.course] == soll["verlauf"]
        assert section.vertical_mm == soll["senkrecht"]
        assert section.horizontal_mm == soll["waagerecht"]
        assert section.length_mm == soll["laenge"]
        assert [hint.value for hint in section.hints] == soll["hinweise"]
        # Laenge und Darstellung stammen aus derselben Polylinie.
        assert section.horizontal_mm == horizontal_length_mm(section.course)


@pytest.mark.parametrize("fall", DATEN["faelle"], ids=lambda fall: fall["name"])
def test_eingabereihenfolge_ohne_wirkung(fall: dict[str, Any]) -> None:
    """Umgekehrte oder rotierte Listen ergeben dasselbe Ergebnis - auch bei gleicher Ebene."""
    floors = [
        RiserFloor(_id(g["id"]), g["ebene"], g["hoehe"], g["bestaetigt"], g["decke"])
        for g in fall["geschosse"]
    ]
    stops = [
        RiserStopPoint(_id(h["id"]), _id(h["geschoss"]), h["x"], h["y"]) for h in fall["halte"]
    ]
    basis = analyse_riser(floors, stops, fall["versatz"])
    for variante in (list(reversed(stops)), stops[1:] + stops[:1]):
        assert analyse_riser(list(reversed(floors)), variante, fall["versatz"]) == basis


def test_keine_diagonale_3d_luftlinie_bei_direct() -> None:
    """``direct`` ist waagerecht: Kein Teilstueck aendert z und x/y zugleich."""
    course = riser_course(
        RiserStopPoint(_id("a"), _id("eg"), 0, 0),
        RiserStopPoint(_id("b"), _id("og"), 3000, 4000),
        z_lower_mm=0,
        z_upper_mm=2900,
        offset_mode="direct",
    )
    assert course == (
        CoursePoint(0, 0, 0),
        CoursePoint(0, 0, 2900),
        CoursePoint(3000, 4000, 2900),
    )
    assert horizontal_length_mm(course) == 5000


def test_standardhoehe_aendert_nur_den_hinweis() -> None:
    """Die lichte Standardhoehe beeinflusst weder Laenge noch Status (Entwurf §4.4)."""

    def auswerten(decke: int) -> Any:
        return analyse_riser(
            [
                RiserFloor(_id("eg"), 0, 0, True, decke),
                RiserFloor(_id("og"), 1, 2200, True, 2500),
            ],
            [
                RiserStopPoint(_id("a"), _id("eg"), 0, 0),
                RiserStopPoint(_id("b"), _id("og"), 0, 0),
            ],
            "orthogonal",
        )

    hoch, niedrig = auswerten(2500), auswerten(2000)
    assert hoch.sections[0].hints and not niedrig.sections[0].hints
    assert hoch.length_mm == niedrig.length_mm == 2200
    assert hoch.status is niedrig.status is RiserStatus.CONFIRMED


def test_unbestaetigt_erfindet_keine_hoehe_aus_ebene() -> None:
    """Gleiche gespeicherte Hoehenlage (Standard 0), unbestaetigt: keine senkrechte Laenge."""
    result = analyse_riser(
        [
            RiserFloor(_id("eg"), 0, 0, False, 2500),
            RiserFloor(_id("og"), 1, 0, False, 2500),
        ],
        [
            RiserStopPoint(_id("a"), _id("eg"), 0, 0),
            RiserStopPoint(_id("b"), _id("og"), 300, 0),
        ],
        "orthogonal",
    )
    assert result.status is RiserStatus.INCOMPLETE
    assert result.sections[0].vertical_mm is None
    assert result.length_mm is None
    assert result.known_length_mm == 300
