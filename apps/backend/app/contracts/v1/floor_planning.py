"""Pruefung einer geaenderten Geschoss-Standardhoehe (Contract v1, Phase 4f, ADR 0022).

Ein Raum ohne eigene Hoehe erbt die Standard-Deckenhoehe seines Geschosses
(``floors.default_ceiling_height_mm``, ADR 0016). Senkt der Core diese Hoehe,
koennte eine Oeffnung eines solchen Raums danach ueber die Raumhoehe ragen -
ohne dass das Fachmodul, dem die Oeffnung gehoert, davon erfaehrt. Der Core
darf die Oeffnungen aber weder kennen noch lesen (ADR 0001).

Dafuer gibt es diesen synchronen **Validierungs**-Teilnehmer:

1. Der Core sperrt die Projektzeile (``ProjectService.lock_writable``) und
   prueft die Version des Geschosses.
2. Aendert die Anfrage die Standardhoehe, fragt er jeden registrierten
   Teilnehmer mit :meth:`FloorCeilingHeightParticipant.check_floor_ceiling_height`.
3. Meldet ein Teilnehmer Konflikte, lehnt der Core den **gesamten**
   Geschoss-PATCH mit ``422 validation-failed`` ab; sonst schreibt er.

**Transaktionsgrenze.** Pruefung und Aenderung laufen in **einer**
Transaktion, die der Core besitzt, unter der bereits gehaltenen Projektsperre.
Jeder fachliche Schreibweg der Teilnehmer sperrt dieselbe Projektzeile zuerst
(``FloorPlanningAccess.writable_context``) und liest die Standardhoehe danach
neu. Zwischen Pruefung und Commit kann deshalb keine ungueltige Geometrie
entstehen - in keiner Reihenfolge.

**Nur lesen.** Ein Teilnehmer veraendert nichts, committet nie und verschiebt,
verkleinert oder loescht keine Oeffnung. Er prueft ausschliesslich eigene
Daten des genannten Mandanten.

Contracts haengen an nichts aus ``app`` (``.importlinter``). Die Session ist
die SQLAlchemy-Session der laufenden Anfrage.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Protocol

# Zur Laufzeit importiert, nicht nur fuer die Typpruefung: Die Module Registry
# vergleicht beim Start die Signaturen der Implementierung mit diesem Protocol
# und muss die Annotationen aufloesen koennen.
from sqlalchemy.orm import Session


@dataclass(frozen=True, slots=True)
class FloorCeilingHeightChange:
    """Die vorgeschlagene neue Standard-Deckenhoehe eines Geschosses.

    ``organization_id`` stammt aus dem geprueften Token (ADR 0006). Ein
    Teilnehmer filtert **jede** Abfrage darauf. Werte in ganzen Millimetern
    (ADR 0007).
    """

    organization_id: uuid.UUID
    floor_id: uuid.UUID
    current_default_ceiling_height_mm: int
    proposed_default_ceiling_height_mm: int


@dataclass(frozen=True, slots=True)
class FloorCeilingHeightConflict:
    """Ein Grund, warum die neue Hoehe nicht passt.

    ``code`` ist maschinenlesbar und stabil (etwa
    ``opening-exceeds-room-height``), ``message`` eine verstaendliche deutsche
    Meldung, die den betroffenen Raum nennt. ``keys`` nennt die IDs der
    betroffenen Objekte (Raum, Oeffnung) fuer eine Markierung in der
    Oberflaeche.
    """

    code: str
    message: str
    keys: tuple[str, ...] = field(default=())


class FloorCeilingHeightParticipant(Protocol):
    """Fachmodul, dessen Daten von der Standardhoehe eines Geschosses abhaengen.

    Implementierungen werden im ``ModuleDescriptor`` ueber
    ``bind_port(FloorCeilingHeightParticipant, <Implementierung>)`` gebunden und
    ohne Argumente instanziiert. Sie halten keinen Zustand.
    """

    def check_floor_ceiling_height(
        self, session: Session, change: FloorCeilingHeightChange
    ) -> tuple[FloorCeilingHeightConflict, ...]:
        """Nur lesen. Leeres Ergebnis: Die neue Hoehe ist fuer dieses Modul zulaessig."""
        ...
