"""Lebenszyklus eines Projekts: Loeschschutz-Protokoll (Contract v1, ADR 0020).

Der Core darf nicht wissen, welche Fachmodule Daten an einem Projekt haben -
und schon gar nicht deren Tabellen lesen (ADR 0001). Trotzdem muss er vor dem
endgueltigen Loeschen eines Projekts **verbindlich** wissen, ob irgendwo
fachliche Inhalte haengen, und sie bei einer administrativen Loeschung
mitentfernen lassen.

Dafuer gibt es diesen synchronen Teilnehmer-Contract:

1. Der Core fragt jeden registrierten Teilnehmer mit
   :meth:`ProjectContentParticipant.describe_project_content` nach seinen
   Inhalten am Projekt.
2. Jeder Teilnehmer antwortet strukturiert mit einem
   :class:`ProjectContentReport` (Code, Beschreibung, Anzahlen).
3. Bei einer zulaessigen Loeschung ruft der Core
   :meth:`ProjectContentParticipant.delete_project_content` auf. Der
   Teilnehmer entfernt **seine eigenen** Daten in derselben Session.

**Transaktionsgrenze.** Alles laeuft in **einer** Datenbanktransaktion, die der
Core besitzt: Die Projektzeile ist bereits gesperrt, bevor ein Teilnehmer
gefragt wird, und ein Teilnehmer committet nie. Wirft ein Teilnehmer, wird die
gesamte Loeschung zurueckgerollt. Es gibt keine Eventual Consistency fuer die
Entscheidung, ob geloescht werden darf.

**Keine Regel 4 aus docs/modules.md.** Provider-Ports liefern nur Daten und
schreiben nicht. Dieser Contract ist ausdruecklich ein **Teilnehmer** einer
vom Core koordinierten Operation und darf deshalb im zweiten Schritt
schreiben - ausschliesslich loeschend, ausschliesslich eigene Tabellen,
ausschliesslich innerhalb der vom Core gehaltenen Transaktion (ADR 0020).

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
class ProjectContentRequest:
    """Um welches Projekt es geht.

    ``organization_id`` stammt aus dem geprueften Token (ADR 0006). Ein
    Teilnehmer filtert **jede** Abfrage darauf - ein fremdes Projekt hat fuer
    ihn keine Inhalte.
    """

    organization_id: uuid.UUID
    project_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class ProjectContentItem:
    """Eine erkannte Inhaltsart.

    ``code`` ist maschinenlesbar und stabil (``<modul>.<art>``, etwa
    ``electrical.rooms``), ``label`` eine kurze deutsche Beschreibung fuer die
    Oberflaeche, ``count`` die Anzahl, sofern sinnvoll bestimmbar.
    """

    code: str
    label: str
    count: int | None = None


@dataclass(frozen=True, slots=True)
class ProjectContentReport:
    """Antwort eines Teilnehmers.

    ``has_content`` ist die verbindliche Aussage; ``items`` erklaert sie. Ein
    Teilnehmer mit Inhalten nennt mindestens eine Inhaltsart.
    """

    module_id: str
    has_content: bool
    items: tuple[ProjectContentItem, ...] = field(default=())

    def __post_init__(self) -> None:
        if self.has_content and not self.items:
            msg = f"Teilnehmer {self.module_id!r} meldet Inhalte, nennt aber keine Inhaltsart."
            raise ValueError(msg)


class ProjectContentParticipant(Protocol):
    """Fachmodul, das projektbezogene Daten besitzt.

    Implementierungen werden im ``ModuleDescriptor`` ueber
    ``bind_port(ProjectContentParticipant, <Implementierung>)`` gebunden und
    ohne Argumente instanziiert. Sie halten keinen Zustand.
    """

    def describe_project_content(
        self, session: Session, request: ProjectContentRequest
    ) -> ProjectContentReport:
        """Nur lesen. Darf nichts veraendern und nichts committen."""
        ...

    def delete_project_content(self, session: Session, request: ProjectContentRequest) -> None:
        """Entfernt alle eigenen Daten zum Projekt - ohne Commit.

        Wird nur innerhalb der vom Core koordinierten Loeschung aufgerufen,
        nachdem die Projektzeile gesperrt und die Berechtigung geprueft ist.
        Ein Fehler bricht die gesamte Loeschung ab.
        """
        ...
