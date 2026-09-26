"""Reine Geometrie der Raumkontur (ADR 0013).

Diese Tests brauchen **keine** Datenbank: Sie pruefen die Rechenregeln selbst.
Die Werte sind exakt erwartet, nicht mit Toleranz - das ist der Sinn der
ganzzahligen Millimeter (ADR 0007).
"""

from __future__ import annotations

import math

import pytest

from app.modules.electrical.geometry import (
    ContourStatus,
    OpeningKind,
    OpeningSpan,
    Point,
    Segment,
    closed_contour_problems,
    contour_report,
    doubled_area_mm2,
    draft_problems,
    opening_height_problems,
    opening_problems,
    perimeter_mm,
    polygon_area_mm2,
    rounded_sqrt,
    segment_length_mm,
    segments_intersect,
)


def seg(key: str, x1: int, y1: int, x2: int, y2: int) -> Segment:
    return Segment(key=key, start=Point(x_mm=x1, y_mm=y1), end=Point(x_mm=x2, y_mm=y2))


def rechteck(breite: int = 5_000, tiefe: int = 4_000) -> list[Segment]:
    """Vier Waende gegen den Uhrzeigersinn, geschlossen."""
    return [
        seg("w1", 0, 0, breite, 0),
        seg("w2", breite, 0, breite, tiefe),
        seg("w3", breite, tiefe, 0, tiefe),
        seg("w4", 0, tiefe, 0, 0),
    ]


def codes(problems: list) -> set[str]:
    return {problem.code for problem in problems}


# ------------------------------------------------------------ Streckenlaenge


@pytest.mark.parametrize(
    ("value", "erwartet"),
    [(0, 0), (1, 1), (2, 1), (3, 2), (4, 2), (6, 2), (7, 3), (9, 3), (12, 3), (13, 4)],
)
def test_rounded_sqrt_rundet_kaufmaennisch(value: int, erwartet: int) -> None:
    assert rounded_sqrt(value) == erwartet


def test_rounded_sqrt_stimmt_mit_der_gleitkommarundung_ueberein() -> None:
    """Die ganzzahlige Regel muss dasselbe liefern wie ``round(sqrt(n))``.

    Gleitkomma dient hier nur als Vergleichsmassstab - im Produktivcode kommt
    es nicht vor.
    """
    for value in range(0, 20_000):
        assert rounded_sqrt(value) == round(math.sqrt(value))


def test_rounded_sqrt_lehnt_negative_werte_ab() -> None:
    with pytest.raises(ValueError, match="nicht negative"):
        rounded_sqrt(-1)


@pytest.mark.parametrize(
    ("x1", "y1", "x2", "y2", "erwartet"),
    [
        # waagerecht
        (0, 0, 5_000, 0, 5_000),
        # senkrecht
        (0, 0, 0, 2_500, 2_500),
        # rueckwaerts - die Laenge ist richtungsunabhaengig
        (5_000, 0, 0, 0, 5_000),
        # pythagoreisch, exakt
        (0, 0, 3_000, 4_000, 5_000),
        # schraeg mit Rundung: sqrt(2) * 1000 = 1414,21... -> 1414
        (0, 0, 1_000, 1_000, 1_414),
        # sqrt(2) * 3 = 4,24 -> 4
        (0, 0, 3, 3, 4),
        # sqrt(5) = 2,236 -> 2
        (0, 0, 1, 2, 2),
    ],
)
def test_segmentlaenge(x1: int, y1: int, x2: int, y2: int, erwartet: int) -> None:
    assert segment_length_mm(Point(x_mm=x1, y_mm=y1), Point(x_mm=x2, y_mm=y2)) == erwartet


# -------------------------------------------------------------- Einzelsegment


def test_wand_mit_identischen_endpunkten_ist_unzulaessig() -> None:
    problems = draft_problems([seg("w1", 1_000, 1_000, 1_000, 1_000)])
    assert codes(problems) == {"wall-degenerate"}


@pytest.mark.parametrize(
    ("x2", "code"),
    [(50, "wall-length-implausible"), (200_000, "wall-length-implausible")],
)
def test_unplausible_wandlaenge(x2: int, code: str) -> None:
    assert code in codes(draft_problems([seg("w1", 0, 0, x2, 0)]))


def test_koordinate_ausserhalb_des_bereichs() -> None:
    problems = draft_problems([seg("w1", 0, 0, 2_000_000, 0)])
    assert "coordinate-out-of-range" in codes(problems)


# ------------------------------------------------------------- Lagepruefung


def test_sich_kreuzende_segmente_werden_erkannt() -> None:
    assert segments_intersect(seg("a", 0, 0, 1_000, 1_000), seg("b", 0, 1_000, 1_000, 0))


def test_beruehrung_gilt_als_schnitt() -> None:
    assert segments_intersect(seg("a", 0, 0, 1_000, 0), seg("b", 1_000, 0, 1_000, 1_000))


def test_getrennte_segmente_schneiden_sich_nicht() -> None:
    assert not segments_intersect(seg("a", 0, 0, 1_000, 0), seg("b", 0, 500, 1_000, 500))


def test_doppeltes_segment_wird_erkannt() -> None:
    """Dieselbe Strecke zweimal - auch in umgekehrter Richtung."""
    problems = draft_problems([seg("w1", 0, 0, 5_000, 0), seg("w2", 5_000, 0, 0, 0)])
    assert "wall-duplicate" in codes(problems)


def test_zurueckspringende_wand_wird_abgelehnt() -> None:
    """Die zweite Wand laeuft auf der ersten zurueck - keine einfache Kontur."""
    problems = draft_problems([seg("w1", 0, 0, 5_000, 0), seg("w2", 5_000, 0, 2_000, 0)])
    assert "wall-backtracks" in codes(problems)


def test_gerade_fortsetzung_ist_erlaubt() -> None:
    """Ein ueberzaehliger Punkt auf einer Gerade ist kein Fehler."""
    assert draft_problems([seg("w1", 0, 0, 2_000, 0), seg("w2", 2_000, 0, 5_000, 0)]) == []


def test_selbstueberschneidende_kontur_wird_abgelehnt() -> None:
    """Klassische Schleife: Die Kontur kreuzt sich selbst."""
    schleife = [
        seg("w1", 0, 0, 5_000, 0),
        seg("w2", 5_000, 0, 0, 4_000),
        seg("w3", 0, 4_000, 5_000, 4_000),
        seg("w4", 5_000, 4_000, 0, 0),
    ]
    report = contour_report(schleife)
    assert report.status is ContourStatus.DRAFT
    assert "walls-intersect" in codes(list(report.problems))


def test_einschnuerung_wird_abgelehnt() -> None:
    """Zwei nicht benachbarte Waende treffen sich in einem Punkt."""
    achter = [
        seg("w1", 0, 0, 2_000, 2_000),
        seg("w2", 2_000, 2_000, 4_000, 0),
        seg("w3", 4_000, 0, 4_000, 4_000),
        seg("w4", 4_000, 4_000, 2_000, 2_000),
        seg("w5", 2_000, 2_000, 0, 4_000),
        seg("w6", 0, 4_000, 0, 0),
    ]
    assert "walls-intersect" in codes(draft_problems(achter))


# -------------------------------------------------------------- Entwurfsphase


def test_einzelne_wand_ist_ein_gueltiger_entwurf() -> None:
    """Ein Zwischenstand verlangt keine geschlossene Kontur."""
    assert draft_problems([seg("w1", 0, 0, 5_000, 0)]) == []


def test_zwei_nicht_anschliessende_waende_sind_im_entwurf_erlaubt() -> None:
    entwurf = [seg("w1", 0, 0, 5_000, 0), seg("w2", 6_000, 1_000, 6_000, 3_000)]
    assert draft_problems(entwurf) == []


def test_entwurf_ist_noch_nicht_gueltig() -> None:
    report = contour_report([seg("w1", 0, 0, 5_000, 0), seg("w2", 5_000, 0, 5_000, 4_000)])
    assert report.status is ContourStatus.DRAFT
    assert report.area_mm2 is None
    assert report.perimeter_mm == 9_000
    assert "contour-too-few-walls" in codes(list(report.problems))


def test_offene_kontur_wird_benannt() -> None:
    offen = rechteck()[:3]
    problems = closed_contour_problems(offen)
    assert "contour-not-closed" in codes(problems)


def test_luecke_zwischen_waenden_wird_benannt() -> None:
    mit_luecke = [
        seg("w1", 0, 0, 5_000, 0),
        seg("w2", 5_100, 0, 5_100, 4_000),
        seg("w3", 5_100, 4_000, 0, 4_000),
        seg("w4", 0, 4_000, 0, 0),
    ]
    assert "contour-gap" in codes(closed_contour_problems(mit_luecke))


def test_kontur_ohne_flaeche_wird_abgelehnt() -> None:
    """Drei kollineare Segmente schliessen keine Flaeche ein."""
    entartet = [
        seg("w1", 0, 0, 2_000, 0),
        seg("w2", 2_000, 0, 4_000, 0),
        seg("w3", 4_000, 0, 0, 0),
    ]
    assert "wall-duplicate" in codes(draft_problems(entartet)) or "contour-without-area" in codes(
        closed_contour_problems(entartet)
    )


# --------------------------------------------------------- gueltige Kontur


def test_gueltiges_rechteck() -> None:
    report = contour_report(rechteck())
    assert report.status is ContourStatus.VALID
    assert report.problems == ()
    assert report.wall_count == 4
    assert report.area_mm2 == 20_000_000
    assert report.perimeter_mm == 18_000


def test_gueltiges_dreieck_mit_schraeger_wand() -> None:
    dreieck = [
        seg("w1", 0, 0, 3_000, 0),
        seg("w2", 3_000, 0, 0, 4_000),
        seg("w3", 0, 4_000, 0, 0),
    ]
    report = contour_report(dreieck)
    assert report.status is ContourStatus.VALID
    # Flaeche = 3000 * 4000 / 2
    assert report.area_mm2 == 6_000_000
    # Umfang = 3000 + 5000 (3-4-5) + 4000
    assert report.perimeter_mm == 12_000


def test_l_form_mit_sechs_waenden() -> None:
    l_form = [
        seg("w1", 0, 0, 6_000, 0),
        seg("w2", 6_000, 0, 6_000, 2_000),
        seg("w3", 6_000, 2_000, 3_000, 2_000),
        seg("w4", 3_000, 2_000, 3_000, 5_000),
        seg("w5", 3_000, 5_000, 0, 5_000),
        seg("w6", 0, 5_000, 0, 0),
    ]
    report = contour_report(l_form)
    assert report.status is ContourStatus.VALID
    # 6000*2000 + 3000*3000
    assert report.area_mm2 == 21_000_000


def test_umlaufsinn_aendert_die_flaeche_nicht() -> None:
    gegen_uhrzeigersinn = rechteck()
    im_uhrzeigersinn = [
        seg("w1", 0, 0, 0, 4_000),
        seg("w2", 0, 4_000, 5_000, 4_000),
        seg("w3", 5_000, 4_000, 5_000, 0),
        seg("w4", 5_000, 0, 0, 0),
    ]
    assert doubled_area_mm2([s.start for s in gegen_uhrzeigersinn]) > 0
    assert doubled_area_mm2([s.start for s in im_uhrzeigersinn]) < 0
    assert contour_report(gegen_uhrzeigersinn).area_mm2 == contour_report(im_uhrzeigersinn).area_mm2


def test_flaeche_rundet_den_halben_quadratmillimeter_auf() -> None:
    """Ein Dreieck mit ungerader doppelter Flaeche."""
    punkte = [Point(x_mm=0, y_mm=0), Point(x_mm=3, y_mm=0), Point(x_mm=0, y_mm=1)]
    assert doubled_area_mm2(punkte) == 3
    assert polygon_area_mm2(punkte) == 2


def test_umfang_summiert_gerundete_einzellaengen() -> None:
    schraeg = [
        seg("w1", 0, 0, 1_000, 1_000),
        seg("w2", 1_000, 1_000, 2_000, 0),
        seg("w3", 2_000, 0, 0, 0),
    ]
    assert perimeter_mm(schraeg) == 1_414 + 1_414 + 2_000


def test_vierte_wand_schliesst_die_kontur_ohne_beschwerde() -> None:
    """Die schliessende Wand beruehrt die erste - das ist erwuenscht."""
    assert draft_problems(rechteck()) == []


# ------------------------------------------------------------------ Oeffnungen


def test_oeffnung_innerhalb_der_wand() -> None:
    problems = opening_problems(
        opening=OpeningSpan(key="o1", offset_mm=1_000, width_mm=900),
        wall_length_mm=5_000,
        others=[],
    )
    assert problems == []


def test_oeffnung_darf_die_wand_genau_ausfuellen() -> None:
    problems = opening_problems(
        opening=OpeningSpan(key="o1", offset_mm=0, width_mm=5_000),
        wall_length_mm=5_000,
        others=[],
    )
    assert problems == []


@pytest.mark.parametrize(
    ("offset", "width", "code"),
    [
        (4_500, 900, "opening-exceeds-wall"),
        (5_000, 100, "opening-exceeds-wall"),
        (-1, 900, "opening-offset-negative"),
        (0, 0, "opening-width-not-positive"),
    ],
)
def test_oeffnung_ausserhalb_der_wand(offset: int, width: int, code: str) -> None:
    problems = opening_problems(
        opening=OpeningSpan(key="o1", offset_mm=offset, width_mm=width),
        wall_length_mm=5_000,
        others=[],
    )
    assert code in codes(problems)


def test_ueberlappende_oeffnungen_werden_abgelehnt() -> None:
    problems = opening_problems(
        opening=OpeningSpan(key="o2", offset_mm=1_500, width_mm=900),
        wall_length_mm=5_000,
        others=[OpeningSpan(key="o1", offset_mm=1_000, width_mm=900)],
    )
    assert "openings-overlap" in codes(problems)


def test_beruehrung_an_der_kante_ist_erlaubt() -> None:
    """Dokumentierte Entscheidung: gemeinsamer Rahmenpfosten ist zulaessig."""
    problems = opening_problems(
        opening=OpeningSpan(key="o2", offset_mm=1_900, width_mm=900),
        wall_length_mm=5_000,
        others=[OpeningSpan(key="o1", offset_mm=1_000, width_mm=900)],
    )
    assert problems == []


def test_oeffnung_vergleicht_gegen_die_gerundete_wandlaenge() -> None:
    """Die schraege Wand ist 1414 mm lang - nicht 1414,21."""
    wand = seg("w1", 0, 0, 1_000, 1_000)
    assert wand.length_mm == 1_414
    assert (
        opening_problems(
            opening=OpeningSpan(key="o1", offset_mm=514, width_mm=900),
            wall_length_mm=wand.length_mm,
            others=[],
        )
        == []
    )
    assert "opening-exceeds-wall" in codes(
        opening_problems(
            opening=OpeningSpan(key="o1", offset_mm=515, width_mm=900),
            wall_length_mm=wand.length_mm,
            others=[],
        )
    )


def test_tuer_ohne_bruestung_ist_in_ordnung() -> None:
    assert (
        opening_height_problems(
            key="o1",
            kind=OpeningKind.DOOR,
            height_mm=2_010,
            sill_height_mm=0,
            room_height_mm=2_500,
        )
        == []
    )


def test_fenster_braucht_eine_bruestung() -> None:
    problems = opening_height_problems(
        key="o1",
        kind=OpeningKind.WINDOW,
        height_mm=1_400,
        sill_height_mm=0,
        room_height_mm=2_500,
    )
    assert "window-needs-sill" in codes(problems)


def test_bruestung_nur_beim_fenster() -> None:
    problems = opening_height_problems(
        key="o1",
        kind=OpeningKind.DOOR,
        height_mm=2_010,
        sill_height_mm=900,
        room_height_mm=2_500,
    )
    assert "sill-only-for-window" in codes(problems)


def test_oeffnung_hoeher_als_der_raum() -> None:
    problems = opening_height_problems(
        key="o1",
        kind=OpeningKind.WINDOW,
        height_mm=1_400,
        sill_height_mm=1_500,
        room_height_mm=2_500,
    )
    assert "opening-exceeds-room-height" in codes(problems)


def test_oeffnung_darf_bis_zur_decke_reichen() -> None:
    assert (
        opening_height_problems(
            key="o1",
            kind=OpeningKind.WINDOW,
            height_mm=1_600,
            sill_height_mm=900,
            room_height_mm=2_500,
        )
        == []
    )
