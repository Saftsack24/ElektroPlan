"""Vergabe von Belegnummern.

Die Nummer wird **nicht** ueber ``MAX(number) + 1`` gebildet - unter
Parallelzugriff entstehen dabei Duplikate. Stattdessen sperrt der Dienst die
Zeile des Nummernkreises (``SELECT ... FOR UPDATE``) und zaehlt sie hoch. Die
Sperre haelt bis zum Commit des Aufrufers; ein zweiter Aufruf wartet.

Damit zwei gleichzeitige Erstzugriffe nicht am Primaerschluessel scheitern,
wird die Zeile zuvor mit ``INSERT ... ON CONFLICT DO NOTHING`` angelegt.

**Nummernformate (Phase 2).** Die Formate sind bewusst schlicht und hier an
einer Stelle definiert:

======== ============ ======================
Bereich  Format       Beispiel
======== ============ ======================
Kunde    ``KD-#####``      ``KD-00001``
Projekt  ``PR-JJJJ-####``  ``PR-2026-0001``
======== ============ ======================

Kundennummern laufen durch, Projektnummern beginnen jedes Jahr neu. Die
Formate der Belege aus spaeteren Phasen (Angebot, Auftrag) sind noch offen
(offene Entscheidung F5 in ``docs/current-status.md``) und werden dort
ergaenzt, nicht hier vorweggenommen.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.numbering.models import NumberSequence
from app.db.mixins import utcnow


@dataclass(frozen=True, slots=True)
class SequenceDefinition:
    """Ein Nummernkreis: Bereich, Praefix, Periodizitaet und Stellenzahl."""

    scope: str
    prefix: str
    yearly: bool
    padding: int

    def period_for(self, today: date) -> str:
        """Periodenschluessel - Jahreszahl oder leer."""
        return str(today.year) if self.yearly else ""

    def format(self, value: int, period: str) -> str:
        number = f"{value:0{self.padding}d}"
        return f"{self.prefix}-{period}-{number}" if period else f"{self.prefix}-{number}"


CUSTOMER_SEQUENCE = SequenceDefinition(scope="customer", prefix="KD", yearly=False, padding=5)
PROJECT_SEQUENCE = SequenceDefinition(scope="project", prefix="PR", yearly=True, padding=4)

#: Alle bekannten Kreise - fuer Tests und spaetere Uebersichten.
SEQUENCES: tuple[SequenceDefinition, ...] = (CUSTOMER_SEQUENCE, PROJECT_SEQUENCE)


def next_number(
    session: Session,
    *,
    organization_id: uuid.UUID,
    definition: SequenceDefinition,
    today: date | None = None,
) -> str:
    """Liefert die naechste Nummer des Kreises - je Organisation getrennt.

    Der Aufrufer committet. Bricht seine Transaktion ab, wird auch die Nummer
    nicht verbraucht.
    """
    period = definition.period_for(today or utcnow().date())

    # Zeile sicherstellen. Legt eine parallele Transaktion sie gerade an,
    # wartet dieses Statement auf deren Commit und tut danach nichts.
    session.execute(
        pg_insert(NumberSequence)
        .values(
            organization_id=organization_id,
            scope=definition.scope,
            period=period,
            current_value=0,
        )
        .on_conflict_do_nothing(index_elements=["organization_id", "scope", "period"])
    )

    sequence = session.execute(
        select(NumberSequence)
        .where(
            NumberSequence.organization_id == organization_id,
            NumberSequence.scope == definition.scope,
            NumberSequence.period == period,
        )
        .with_for_update()
    ).scalar_one()

    sequence.current_value += 1
    session.flush()
    return definition.format(sequence.current_value, period)


def peek_current_value(
    session: Session,
    *,
    organization_id: uuid.UUID,
    definition: SequenceDefinition,
    today: date | None = None,
) -> int:
    """Aktueller Zaehlerstand ohne ihn zu veraendern - fuer Tests und Diagnose."""
    period = definition.period_for(today or utcnow().date())
    value = session.execute(
        select(NumberSequence.current_value).where(
            NumberSequence.organization_id == organization_id,
            NumberSequence.scope == definition.scope,
            NumberSequence.period == period,
        )
    ).scalar_one_or_none()
    return int(value or 0)
