"""Mitgelieferte Stammdaten eines Moduls: idempotenter Seed (Contract v1, ADR 0023).

Manche Module liefern einen **Systemkatalog** aus, der in der Datenbank
stehen muss, damit Fachdaten auf ihn verweisen koennen - etwa die Geraetetypen
der Elektroplanung (Phase 5). Seeds sind keine Migrationen
(docs/database.md, Abschnitt 8); der Core-Seed (``python -m app.cli seed``)
ist der eine, wiederholbare Weg dafuer.

Der Core kennt dabei weder Tabellen noch Inhalte eines Moduls (ADR 0001). Er
fragt jeden registrierten Teilnehmer der Reihe nach (nach Modul-ID sortiert)
und laesst ihn seine eigenen Stammdaten abgleichen:

* **idempotent:** ein zweiter Lauf erzeugt keine Duplikate und aendert nichts,
* **nur eigene Tabellen**, ohne Commit - die Transaktion gehoert dem Seed,
* **nie loeschend:** Was der Katalog nicht mehr kennt, wird deaktiviert,
  nicht entfernt; vorhandene Fachdaten koennen darauf verweisen,
* **ohne Mandantendaten:** Systemkataloge sind fuer alle Betriebe gleich.

Contracts haengen an nichts aus ``app`` (``.importlinter``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

# Zur Laufzeit importiert: Die Module Registry prueft beim Start die Signaturen.
from sqlalchemy.orm import Session


@dataclass(frozen=True, slots=True)
class ReferenceDataResult:
    """Was ein Abgleich bewirkt hat - fuer Protokoll und Ausgabe."""

    module_id: str
    created: int = 0
    updated: int = 0
    deactivated: int = 0


class ReferenceDataSeeder(Protocol):
    """Modul mit mitgeliefertem Systemkatalog.

    Gebunden ueber ``bind_port(ReferenceDataSeeder, <Implementierung>)`` im
    ``ModuleDescriptor``, ohne Argumente instanziiert, ohne Zustand.
    """

    def seed_reference_data(self, session: Session) -> ReferenceDataResult:
        """Gleicht den Katalog idempotent ab - ohne Commit."""
        ...
