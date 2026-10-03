"""Standardhoehe eines Geschosses aendern - mit Pruefung durch die Fachmodule.

Phase 4f, ADR 0022. Der Core weiss nicht, welche Fachmodule Daten haben, die
von ``floors.default_ceiling_height_mm`` abhaengen, und liest deren Tabellen
nie (ADR 0001). Er fragt stattdessen jeden Teilnehmer des Contracts
:class:`~app.contracts.v1.floor_planning.FloorCeilingHeightParticipant`.

Aufgerufen wird :func:`require_floor_height_allowed` aus
:meth:`~app.core.projects.service.ProjectService.update_floor`, **nachdem** die
Projektzeile gesperrt ist und **bevor** das Geschoss geaendert wird. Meldet ein
Teilnehmer einen Konflikt, scheitert die gesamte Anfrage mit
``422 validation-failed``; das Geschoss bleibt unveraendert.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy.orm import Session

from app.contracts.v1.floor_planning import (
    FloorCeilingHeightChange,
    FloorCeilingHeightParticipant,
)
from app.core.module_registry.registry import ModuleRegistry, get_module_registry
from app.errors import ProblemFieldError, ValidationFailedError

#: Ein Teilnehmer samt Modul-ID, in fester Reihenfolge.
HeightParticipant = tuple[str, FloorCeilingHeightParticipant]

#: Das Feld der Anfrage, an dem ein Konflikt gemeldet wird.
FIELD = "default_ceiling_height_mm"

_DETAIL = (
    "Mit dieser Standardhoehe waeren vorhandene Oeffnungen hoeher als ihr Raum. "
    "Es wurde nichts geaendert. Bitte zuerst die genannten Oeffnungen anpassen "
    "oder dem Raum eine eigene Hoehe geben."
)


def registered_height_participants(
    registry: ModuleRegistry | None = None,
) -> tuple[HeightParticipant, ...]:
    """Instanziiert alle registrierten Teilnehmer - nach Modul-ID sortiert."""
    source = registry or get_module_registry()
    return tuple(
        (module_id, implementation())
        for module_id, implementation in source.port_implementations(FloorCeilingHeightParticipant)
    )


def require_floor_height_allowed(
    session: Session,
    *,
    organization_id: uuid.UUID,
    floor_id: uuid.UUID,
    current_mm: int,
    proposed_mm: int,
    participants: Sequence[HeightParticipant],
) -> None:
    """Fragt alle Teilnehmer; wirft ``422`` mit allen Konflikten.

    Eine unveraenderte oder hoehere Standardhoehe wird trotzdem geprueft: Die
    Regel steht beim Teilnehmer, nicht hier. Die Teilnehmer lesen nur.
    """
    change = FloorCeilingHeightChange(
        organization_id=organization_id,
        floor_id=floor_id,
        current_default_ceiling_height_mm=current_mm,
        proposed_default_ceiling_height_mm=proposed_mm,
    )
    errors: list[ProblemFieldError] = []
    for _module_id, participant in participants:
        for conflict in participant.check_floor_ceiling_height(session, change):
            errors.append(
                ProblemFieldError(
                    field=FIELD,
                    code=conflict.code,
                    message=conflict.message,
                    keys=list(conflict.keys) or None,
                )
            )
    if errors:
        raise ValidationFailedError(_DETAIL, errors=errors)
