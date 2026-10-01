"""Ein- und Ausgabeschemas der persoenlichen Einstellungen (Phase 4e)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

ThemeMode = Literal["system", "light", "dark"]
Accent = Literal["blue", "teal", "green", "violet", "orange"]
LengthUnit = Literal["mm", "cm", "m"]


class PreferencesIn(BaseModel):
    """Vollstaendiger Stand - ersetzt den gespeicherten als Ganzes.

    Unbekannte Werte und zusaetzliche Felder werden abgelehnt (``422``).
    """

    model_config = ConfigDict(extra="forbid")

    theme_mode: ThemeMode
    accent: Accent
    length_unit: LengthUnit


class PreferencesOut(BaseModel):
    """Eigene Einstellungen im aktuellen Betrieb.

    ``stored`` sagt, ob es bereits einen Serverstand gibt. Ohne ihn stehen hier
    die dokumentierten Standardwerte (``system``, ``blue``, ``cm``) und
    ``version`` ist ``0``; der Client darf dann einmalig einen alten lokalen
    Stand uebertragen (``POST``). Mit ihm ist der Server die Wahrheit, und
    Aenderungen laufen ueber ``PUT`` mit ``If-Match`` (ADR 0021).
    """

    stored: bool
    theme_mode: ThemeMode
    accent: Accent
    length_unit: LengthUnit
    version: int
