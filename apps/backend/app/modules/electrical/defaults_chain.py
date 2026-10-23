"""Vorgabenkette fuer neue Leitungen - reine Funktion (Phase 6c, V1, ADR 0027, Entwurf §8.3/§8.4).

Keine Datenbank, keine Speicherung. Aus Betriebsstandard, Projektvorgabe, Kabelvorlagen,
Stromkreis und den beiden Endgeraeten folgt deterministisch, welche Werte eine **neue**
Leitung vorbelegt bekaeme und woher sie stammen. Vorgaben sind Vorschlagsquellen, keine
Laufzeitvererbung: Gespeichert werden die Werte an der Leitung (``cables.py``), eine
spaetere Vorgabenaenderung aendert keine Leitung.

**Eine Kette je Wertegruppe**, die erste Stufe mit Wert gewinnt, spaetere Stufen werden
nicht eingemischt:

==================  ===========================================================
Kabelangaben        (1) Leitung abweichend - nicht hier, sondern ``manual`` beim
                    Speichern · (2) Stromkreisvorgabe, **nur** wenn
                    ``proposal_overrides_templates`` aktiviert ist (F1) · (3)
                    Vorlage je Geraetetyp des massgeblichen Geraets - Projekt,
                    sonst Betrieb · (4) allgemeine Standardvorlage - Projekt,
                    sonst Betrieb · (5) keine: sichtbar fehlend (``none``)
Reserve %           Projekt -> Betrieb -> 0 % (``none``)
Anschlusszugaben    je Endpunktart (Verteilung, Abzweigdose, Geraet) und Feld:
                    Projekt -> Betrieb -> 0 mm
==================  ===========================================================

Das Tripel (Typ, Leiterzahl, Querschnitt) ist eine **Einheit**: eine Vorlage oder die
aktivierte Stromkreisvorgabe liefert alle drei Werte - auch eine aktivierte, nur teilweise
ausgefuellte Stromkreisvorgabe wird nicht aus einer Vorlage ergaenzt.

**Massgebliches Geraet** (§8.4): das Zielgeraet; ist es eine Verteilung oder fehlt es, das
Startgeraet, sofern es kein Lagegeraet einer Verteilung ist. Eine Verteilung bestimmt nie
die Vorlage. Liefern Start und Ziel verschiedene Vorlagen, gilt das Ziel; die andere steht
als Hinweis bereit.

**Inaktive Vorlagen** werden nie vorgeschlagen: Ist die gewaehlte Vorlage einer Stufe
inaktiv, liefert diese Stufe nichts (Hinweis ``template-inactive``) und die naechste
Stufe entscheidet. Die erste Ebene (Projekt vor Betrieb), die einem Geraetetyp bzw. der
Standardvorlage **ueberhaupt** eine Vorlage zuweist, entscheidet die Stufe.

Keine Bemessung, keine Normpruefung (docs/security.md, Abschnitt 17).
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from decimal import Decimal

from app.modules.electrical.catalog import DeviceCategory

#: Herkunftsschluessel (dieselben wie ``models.CABLE_VALUE_ORIGINS``).
CIRCUIT_OVERRIDE = "circuit_override"
DEVICE_TYPE_TEMPLATE = "device_type_template"
DEFAULT_TEMPLATE = "default_template"
PROJECT_DEFAULT = "project_default"
OFFICE_DEFAULT = "office_default"
NONE = "none"

#: Ebenen einer Vorlagenwahl.
LEVEL_PROJECT = "project"
LEVEL_OFFICE = "office"

#: Endpunktarten der Anschlusszugaben (Entwurf §8.2).
ENDPOINT_BOARD = "board"
ENDPOINT_JUNCTION = "junction"
ENDPOINT_DEVICE = "device"


@dataclass(frozen=True, slots=True)
class TemplateSpec:
    """Kabelvorlage als Wertetyp - technische Angaben ohne Preis."""

    id: uuid.UUID
    name: str
    cable_type: str
    conductor_count: int
    cross_section_mm2: Decimal
    is_active: bool
    version: int


@dataclass(frozen=True, slots=True)
class DefaultsLevel:
    """Felder einer Vorgabenebene; ``None`` = nicht gesetzt (naechste Ebene)."""

    version: int
    reserve_percent: Decimal | None = None
    board_allowance_mm: int | None = None
    junction_allowance_mm: int | None = None
    device_allowance_mm: int | None = None
    default_template_id: uuid.UUID | None = None
    #: Vorlage je Geraetetyp (``device_type_key`` -> Vorlagen-ID).
    type_templates: Mapping[str, uuid.UUID] = field(default_factory=dict)

    def allowance(self, kind: str) -> int | None:
        if kind == ENDPOINT_BOARD:
            return self.board_allowance_mm
        if kind == ENDPOINT_JUNCTION:
            return self.junction_allowance_mm
        return self.device_allowance_mm


#: Keine Zeile gespeichert: nichts gesetzt, Version ``0``.
EMPTY_LEVEL = DefaultsLevel(version=0)


@dataclass(frozen=True, slots=True)
class CircuitProposal:
    """Vorschlag am Stromkreis - wirksam nur bei ``overrides_templates``."""

    circuit_id: uuid.UUID
    version: int
    overrides_templates: bool
    cable_type: str | None
    conductor_count: int | None
    cross_section_mm2: Decimal | None

    @property
    def has_values(self) -> bool:
        return (
            self.cable_type is not None
            or self.conductor_count is not None
            or self.cross_section_mm2 is not None
        )


@dataclass(frozen=True, slots=True)
class Endpoint:
    """Ein Endgeraet der Leitung: Typ und Kategorie aus dem Katalog."""

    device_id: uuid.UUID
    type_key: str
    category: str

    @property
    def kind(self) -> str:
        if self.category == DeviceCategory.DISTRIBUTION.value:
            return ENDPOINT_BOARD
        if self.category == DeviceCategory.JUNCTION.value:
            return ENDPOINT_JUNCTION
        return ENDPOINT_DEVICE


@dataclass(frozen=True, slots=True)
class Hint:
    """Hinweis zur Vorbelegung - nie eine stille Entscheidung (§8.4, §8.5)."""

    code: str
    template_id: uuid.UUID | None = None
    device_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class SpecResolution:
    origin: str
    cable_type: str | None
    conductor_count: int | None
    cross_section_mm2: Decimal | None
    #: Genutzte Vorlage (Stufe 3 oder 4), sonst ``None``.
    template: TemplateSpec | None = None
    #: Ebene der Vorlagenwahl (``project``/``office``), sonst ``None``.
    level: str | None = None
    #: Geraet, dessen Typ die Vorlage bestimmt hat (Stufe 3).
    deciding_device_id: uuid.UUID | None = None
    hints: tuple[Hint, ...] = ()

    @property
    def values(self) -> tuple[str | None, int | None, Decimal | None]:
        return self.cable_type, self.conductor_count, self.cross_section_mm2


@dataclass(frozen=True, slots=True)
class ReserveResolution:
    origin: str
    percent: Decimal


@dataclass(frozen=True, slots=True)
class AllowanceResolution:
    origin: str
    start_mm: int
    end_mm: int
    #: Herkunft je Ende (``project_default``/``office_default``/``none``).
    start_origin: str
    end_origin: str


@dataclass(frozen=True, slots=True)
class DefaultsInput:
    office: DefaultsLevel
    project: DefaultsLevel
    templates: Mapping[uuid.UUID, TemplateSpec]


# ------------------------------------------------------------------ Kabelangaben


def deciding_endpoint(start: Endpoint | None, end: Endpoint | None) -> Endpoint | None:
    """Massgebliches Geraet der Gerätetypvorlage (§8.4) - nie eine Verteilung."""
    if end is not None and end.kind != ENDPOINT_BOARD:
        return end
    if start is not None and start.kind != ENDPOINT_BOARD:
        return start
    return None


def _type_template(
    data: DefaultsInput, endpoint: Endpoint
) -> tuple[TemplateSpec | None, str | None]:
    """Vorlage je Geraetetyp: die erste Ebene mit Zuweisung entscheidet (Projekt vor Betrieb)."""
    for level, values in ((LEVEL_PROJECT, data.project), (LEVEL_OFFICE, data.office)):
        template_id = values.type_templates.get(endpoint.type_key)
        if template_id is not None:
            return data.templates.get(template_id), level
    return None, None


def _default_template(data: DefaultsInput) -> tuple[TemplateSpec | None, str | None]:
    for level, values in ((LEVEL_PROJECT, data.project), (LEVEL_OFFICE, data.office)):
        if values.default_template_id is not None:
            return data.templates.get(values.default_template_id), level
    return None, None


def resolve_spec(
    data: DefaultsInput,
    circuit: CircuitProposal | None,
    start: Endpoint | None,
    end: Endpoint | None,
) -> SpecResolution:
    """Kabelangaben einer neuen Leitung nach Stufen 2-5 (Stufe 1 ist ``manual``)."""
    hints: list[Hint] = []
    if circuit is not None and circuit.overrides_templates:
        if None in (circuit.cable_type, circuit.conductor_count, circuit.cross_section_mm2):
            hints.append(Hint("circuit-override-incomplete"))
        return SpecResolution(
            origin=CIRCUIT_OVERRIDE,
            cable_type=circuit.cable_type,
            conductor_count=circuit.conductor_count,
            cross_section_mm2=circuit.cross_section_mm2,
            hints=tuple(hints),
        )

    chosen: SpecResolution | None = None
    deciding = deciding_endpoint(start, end)
    if deciding is not None:
        template, level = _type_template(data, deciding)
        if template is not None and template.is_active:
            chosen = _from_template(DEVICE_TYPE_TEMPLATE, template, level, deciding.device_id)
            # Startgeraet mit anderer Vorlage: nur Hinweis, das Ziel gilt (§8.4 Nr. 4).
            if deciding is end and start is not None and start.kind != ENDPOINT_BOARD:
                other, _ = _type_template(data, start)
                if other is not None and other.is_active and other.id != template.id:
                    hints.append(Hint("start-template-differs", other.id, start.device_id))
        elif template is not None:
            hints.append(Hint("template-inactive", template.id, deciding.device_id))
    if chosen is None:
        template, level = _default_template(data)
        if template is not None and template.is_active:
            chosen = _from_template(DEFAULT_TEMPLATE, template, level, None)
        elif template is not None:
            hints.append(Hint("template-inactive", template.id))
    if chosen is None:
        chosen = SpecResolution(
            origin=NONE, cable_type=None, conductor_count=None, cross_section_mm2=None
        )
    if (
        circuit is not None
        and circuit.has_values
        and (circuit.cable_type, circuit.conductor_count, circuit.cross_section_mm2)
        != chosen.values
    ):
        # Werte am Stromkreis ohne Aktivierung: Information, keine Vorbelegung (F1).
        hints.append(Hint("circuit-proposal-not-activated"))
    return SpecResolution(
        origin=chosen.origin,
        cable_type=chosen.cable_type,
        conductor_count=chosen.conductor_count,
        cross_section_mm2=chosen.cross_section_mm2,
        template=chosen.template,
        level=chosen.level,
        deciding_device_id=chosen.deciding_device_id,
        hints=tuple(hints),
    )


def _from_template(
    origin: str, template: TemplateSpec, level: str | None, device_id: uuid.UUID | None
) -> SpecResolution:
    return SpecResolution(
        origin=origin,
        cable_type=template.cable_type,
        conductor_count=template.conductor_count,
        cross_section_mm2=template.cross_section_mm2,
        template=template,
        level=level,
        deciding_device_id=device_id,
    )


# ------------------------------------------------------------ Reserve und Zugaben


def resolve_reserve(data: DefaultsInput) -> ReserveResolution:
    """Reserve in Prozent: Projekt -> Betrieb -> 0 % (``none``)."""
    if data.project.reserve_percent is not None:
        return ReserveResolution(PROJECT_DEFAULT, data.project.reserve_percent)
    if data.office.reserve_percent is not None:
        return ReserveResolution(OFFICE_DEFAULT, data.office.reserve_percent)
    return ReserveResolution(NONE, Decimal("0.00"))


def _allowance(data: DefaultsInput, endpoint: Endpoint | None) -> tuple[int, str]:
    if endpoint is None:
        return 0, NONE
    project = data.project.allowance(endpoint.kind)
    if project is not None:
        return project, PROJECT_DEFAULT
    office = data.office.allowance(endpoint.kind)
    if office is not None:
        return office, OFFICE_DEFAULT
    return 0, NONE


def resolve_allowances(
    data: DefaultsInput, start: Endpoint | None, end: Endpoint | None
) -> AllowanceResolution:
    """Anschlusszugaben je Ende nach dessen Endpunktart; Feld fuer Feld Projekt -> Betrieb -> 0.

    Gruppenherkunft: ``project_default``, sobald ein Wert aus dem Projekt stammt, sonst
    ``office_default``, sobald einer aus dem Betrieb stammt, sonst ``none``. Ohne Endgeraet
    ist die Endzugabe ``0`` (``none``) - es gibt noch keine Endpunktart.
    """
    start_mm, start_origin = _allowance(data, start)
    end_mm, end_origin = _allowance(data, end)
    origins = {start_origin, end_origin}
    origin = (
        PROJECT_DEFAULT
        if PROJECT_DEFAULT in origins
        else OFFICE_DEFAULT
        if OFFICE_DEFAULT in origins
        else NONE
    )
    return AllowanceResolution(origin, start_mm, end_mm, start_origin, end_origin)


__all__ = [
    "CIRCUIT_OVERRIDE",
    "DEFAULT_TEMPLATE",
    "DEVICE_TYPE_TEMPLATE",
    "EMPTY_LEVEL",
    "ENDPOINT_BOARD",
    "ENDPOINT_DEVICE",
    "ENDPOINT_JUNCTION",
    "LEVEL_OFFICE",
    "LEVEL_PROJECT",
    "NONE",
    "OFFICE_DEFAULT",
    "PROJECT_DEFAULT",
    "AllowanceResolution",
    "CircuitProposal",
    "DefaultsInput",
    "DefaultsLevel",
    "Endpoint",
    "Hint",
    "ReserveResolution",
    "SpecResolution",
    "TemplateSpec",
    "deciding_endpoint",
    "resolve_allowances",
    "resolve_reserve",
    "resolve_spec",
]
