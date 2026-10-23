"""Vorgabenkette fuer neue Leitungen - reine Funktion (Phase 6c, V1, ADR 0027, Entwurf §8.3/§8.4).

Je Stufe der Kette ein Fall, dazu die Sonderregeln: aktivierter gegen nicht aktivierten
Stromkreisvorrang, keine Mischung des Tripels, inaktive Vorlagen, massgebliches Geraet,
ausdrueckliche Null gegenueber Vererbung. Synthetische Werte - keine Normvorgaben.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from app.modules.electrical.defaults_chain import (
    CIRCUIT_OVERRIDE,
    DEFAULT_TEMPLATE,
    DEVICE_TYPE_TEMPLATE,
    EMPTY_LEVEL,
    NONE,
    OFFICE_DEFAULT,
    PROJECT_DEFAULT,
    CircuitProposal,
    DefaultsInput,
    DefaultsLevel,
    Endpoint,
    TemplateSpec,
    deciding_endpoint,
    resolve_allowances,
    resolve_reserve,
    resolve_spec,
)


def _vorlage(name: str, typ: str, leiter: int, quer: str, *, aktiv: bool = True) -> TemplateSpec:
    return TemplateSpec(uuid.uuid4(), name, typ, leiter, Decimal(quer), aktiv, 1)


NYM_3_15 = _vorlage("Steckdose", "NYM-J", 3, "1.5")
NYM_5_15 = _vorlage("Schalter", "NYM-J", 5, "1.5")
NYM_3_25 = _vorlage("Kueche", "NYM-J", 3, "2.5")
ALT = _vorlage("Alt", "NYM-O", 2, "1.5", aktiv=False)
ALLE = {v.id: v for v in (NYM_3_15, NYM_5_15, NYM_3_25, ALT)}

UV = Endpoint(uuid.uuid4(), "distribution_board", "distribution")
DOSE = Endpoint(uuid.uuid4(), "socket", "socket")
SCHALTER = Endpoint(uuid.uuid4(), "switch", "switch")
ABZWEIG = Endpoint(uuid.uuid4(), "junction_box", "junction")


def _daten(
    office: DefaultsLevel = EMPTY_LEVEL, project: DefaultsLevel = EMPTY_LEVEL
) -> DefaultsInput:
    return DefaultsInput(office=office, project=project, templates=ALLE)


def _kreis(
    *, aktiv: bool, typ: str | None = "NYM-J", leiter: int | None = 3, quer: str | None = "2.5"
) -> CircuitProposal:
    return CircuitProposal(
        uuid.uuid4(), 4, aktiv, typ, leiter, None if quer is None else Decimal(quer)
    )


# ------------------------------------------------------------------ Kabelangaben


def test_stufe_5_ohne_vorgaben_sichtbar_fehlend() -> None:
    spec = resolve_spec(_daten(), None, UV, DOSE)
    assert spec.origin == NONE
    assert spec.values == (None, None, None)
    assert spec.template is None


def test_stufe_4_standardvorlage_projekt_vor_betrieb() -> None:
    betrieb = DefaultsLevel(version=3, default_template_id=NYM_3_15.id)
    assert resolve_spec(_daten(betrieb), None, UV, DOSE).origin == DEFAULT_TEMPLATE
    projekt = DefaultsLevel(version=2, default_template_id=NYM_3_25.id)
    spec = resolve_spec(_daten(betrieb, projekt), None, UV, DOSE)
    assert (spec.origin, spec.level, spec.template) == (DEFAULT_TEMPLATE, "project", NYM_3_25)


def test_stufe_3_geraetetyp_vor_standardvorlage_und_projekt_vor_betrieb() -> None:
    betrieb = DefaultsLevel(
        version=3, default_template_id=NYM_3_15.id, type_templates={"socket": NYM_3_15.id}
    )
    spec = resolve_spec(_daten(betrieb), None, UV, DOSE)
    assert (spec.origin, spec.level, spec.deciding_device_id) == (
        DEVICE_TYPE_TEMPLATE,
        "office",
        DOSE.device_id,
    )
    projekt = DefaultsLevel(version=1, type_templates={"socket": NYM_3_25.id})
    spec = resolve_spec(_daten(betrieb, projekt), None, UV, DOSE)
    assert (spec.origin, spec.level, spec.values) == (
        DEVICE_TYPE_TEMPLATE,
        "project",
        ("NYM-J", 3, Decimal("2.5")),
    )


def test_stufe_2_nur_mit_aktivierung_und_ohne_mischung() -> None:
    betrieb = DefaultsLevel(version=3, type_templates={"socket": NYM_3_15.id})
    # Nicht aktiviert: Gerätetypvorlage gilt, der Stromkreis ist nur ein Hinweis.
    spec = resolve_spec(_daten(betrieb), _kreis(aktiv=False), UV, DOSE)
    assert spec.origin == DEVICE_TYPE_TEMPLATE
    assert spec.values == ("NYM-J", 3, Decimal("1.5"))
    assert [h.code for h in spec.hints] == ["circuit-proposal-not-activated"]
    # Aktiviert: schlaegt die Gerätetypvorlage.
    spec = resolve_spec(_daten(betrieb), _kreis(aktiv=True), UV, DOSE)
    assert (spec.origin, spec.values, spec.template) == (
        CIRCUIT_OVERRIDE,
        ("NYM-J", 3, Decimal("2.5")),
        None,
    )
    # Aktiviert, aber teilweise: als Einheit, fehlende Werte bleiben fehlend (keine Ergaenzung).
    spec = resolve_spec(_daten(betrieb), _kreis(aktiv=True, quer=None), UV, DOSE)
    assert spec.values == ("NYM-J", 3, None)
    assert [h.code for h in spec.hints] == ["circuit-override-incomplete"]


def test_gleiche_stromkreiswerte_ohne_aktivierung_ohne_hinweis() -> None:
    betrieb = DefaultsLevel(version=1, type_templates={"socket": NYM_3_25.id})
    spec = resolve_spec(_daten(betrieb), _kreis(aktiv=False), UV, DOSE)
    assert spec.hints == ()


def test_inaktive_vorlage_wird_nie_vorgeschlagen() -> None:
    betrieb = DefaultsLevel(
        version=1, default_template_id=NYM_3_15.id, type_templates={"socket": ALT.id}
    )
    spec = resolve_spec(_daten(betrieb), None, UV, DOSE)
    assert (spec.origin, spec.template) == (DEFAULT_TEMPLATE, NYM_3_15)
    assert [(h.code, h.template_id) for h in spec.hints] == [("template-inactive", ALT.id)]
    # Auch die Standardvorlage inaktiv: sichtbar fehlend.
    nur_alt = DefaultsLevel(version=1, default_template_id=ALT.id)
    spec = resolve_spec(_daten(nur_alt), None, UV, DOSE)
    assert spec.origin == NONE and [h.code for h in spec.hints] == ["template-inactive"]


def test_massgebliches_geraet() -> None:
    # Ziel entscheidet; eine Verteilung nie; ohne Ziel das Startgeraet.
    assert deciding_endpoint(UV, DOSE) == DOSE
    assert deciding_endpoint(DOSE, UV) == DOSE
    assert deciding_endpoint(SCHALTER, None) == SCHALTER
    assert deciding_endpoint(UV, None) is None
    assert deciding_endpoint(None, None) is None
    assert deciding_endpoint(UV, ABZWEIG) == ABZWEIG


def test_start_und_ziel_mit_verschiedenen_vorlagen_ziel_gilt_mit_hinweis() -> None:
    betrieb = DefaultsLevel(
        version=1, type_templates={"switch": NYM_5_15.id, "socket": NYM_3_15.id}
    )
    spec = resolve_spec(_daten(betrieb), None, SCHALTER, DOSE)
    assert spec.template == NYM_3_15
    assert [(h.code, h.template_id, h.device_id) for h in spec.hints] == [
        ("start-template-differs", NYM_5_15.id, SCHALTER.device_id)
    ]


def test_offene_leitung_ohne_ziel_nutzt_das_startgeraet() -> None:
    betrieb = DefaultsLevel(version=1, type_templates={"switch": NYM_5_15.id})
    spec = resolve_spec(_daten(betrieb), None, SCHALTER, None)
    assert (spec.origin, spec.template) == (DEVICE_TYPE_TEMPLATE, NYM_5_15)
    # Start an der Verteilung ohne Ziel: keine Gerätetypvorlage.
    assert resolve_spec(_daten(betrieb), None, UV, None).origin == NONE


# ------------------------------------------------------------------ Reserve


def test_reserve_null_ist_nicht_vererbung() -> None:
    betrieb = DefaultsLevel(version=2, reserve_percent=Decimal("20"))
    assert resolve_reserve(_daten(betrieb)) == resolve_reserve(_daten(betrieb, EMPTY_LEVEL))
    assert resolve_reserve(_daten(betrieb)).origin == OFFICE_DEFAULT
    assert resolve_reserve(_daten(betrieb)).percent == Decimal("20")
    # Projekt ausdruecklich 0 %: gewinnt gegen den Betrieb (nicht "nicht gesetzt").
    projekt = DefaultsLevel(version=1, reserve_percent=Decimal("0.00"))
    reserve = resolve_reserve(_daten(betrieb, projekt))
    assert (reserve.origin, reserve.percent) == (PROJECT_DEFAULT, Decimal("0.00"))
    # Nichts gesetzt: 0 %, Herkunft none.
    assert resolve_reserve(_daten()).origin == NONE


# ------------------------------------------------------------------ Zugaben


def test_zugaben_je_endpunktart_und_feld() -> None:
    betrieb = DefaultsLevel(
        version=1, board_allowance_mm=500, junction_allowance_mm=150, device_allowance_mm=200
    )
    zug = resolve_allowances(_daten(betrieb), UV, DOSE)
    assert (zug.start_mm, zug.end_mm, zug.origin) == (500, 200, OFFICE_DEFAULT)
    # Projekt setzt nur die Geraetezugabe ausdruecklich auf 0 - die Verteilung bleibt Betrieb.
    projekt = DefaultsLevel(version=1, device_allowance_mm=0)
    zug = resolve_allowances(_daten(betrieb, projekt), UV, DOSE)
    assert (zug.start_mm, zug.end_mm) == (500, 0)
    assert (zug.start_origin, zug.end_origin, zug.origin) == (
        OFFICE_DEFAULT,
        PROJECT_DEFAULT,
        PROJECT_DEFAULT,
    )
    # Abzweigdose und fehlendes Endgeraet.
    zug = resolve_allowances(_daten(betrieb), ABZWEIG, None)
    assert (zug.start_mm, zug.end_mm, zug.end_origin) == (150, 0, NONE)
    assert resolve_allowances(_daten(), UV, DOSE).origin == NONE
