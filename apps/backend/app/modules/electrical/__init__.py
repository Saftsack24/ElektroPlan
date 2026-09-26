"""Fachmodul Elektroplanung - oeffentlicher Einstiegspunkt.

**Genau ein Name verlaesst dieses Modul: ``DESCRIPTOR``.** Alles andere -
Modelle, Repositories, Services, Schemas, Geometrie, Events - ist modulintern.
Kein anderes Modul darf hier tiefer greifen; die statische Grenzpruefung lehnt
jeden Import auf ``app.modules.electrical.<irgendwas>`` von aussen ab
(docs/modules.md, Abschnitt 8).

Phase 3 modelliert ``Geschoss -> Raum -> Wand -> Oeffnung`` samt
Geometriepruefung. Ausdruecklich **nicht** enthalten: Editor, Canvas, 3D,
Elektrobauteile, Stromkreise, Leitungswege, Material, Kalkulation.
"""

from __future__ import annotations

from app.modules.electrical.module import DESCRIPTOR

__all__ = ["DESCRIPTOR"]
