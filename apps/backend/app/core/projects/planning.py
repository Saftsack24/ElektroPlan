"""Oeffentlicher Erweiterungspunkt: Planungsdaten an einem Geschoss.

Jedes Fachmodul haengt seine Planungsdaten an ein Geschoss - heute
``electrical``, spaeter ``pv`` oder ``knx``. Alle brauchen dieselben drei
Auskuenfte, und keines darf sie sich selbst beschaffen:

1. Gehoert dieses Geschoss zu meinem Mandanten? (Sonst ``404``, ohne zu
   verraten, ob es existiert.)
2. Zu welchem Projekt gehoert es?
3. Darf ich darunter ueberhaupt schreiben - oder ist das Projekt archiviert?

Diese Datei ist die **einzige** Stelle, an der ein Fachmodul das erfaehrt. Sie
liefert einen unveraenderlichen Wertetyp, kein ORM-Objekt: ``models`` und
``repositories`` des Core verlassen den Core nicht (docs/modules.md,
Abschnitt 2). Die Archivregel wird nicht wiederholt, sondern von
:meth:`~app.core.projects.service.ProjectService.lock_writable` uebernommen -
sie steht damit weiterhin an genau einer Stelle (docs/api.md, Abschnitt
"Projektstatus").

**Sperrwurzel.** :meth:`FloorPlanningAccess.writable_context` sperrt die
Projektzeile (``SELECT ... FOR UPDATE``), bevor sie den Schreibschutz prueft.
Ein Fachmodul erhaelt damit dieselbe Zusage wie der Core selbst: Nach einer
abgeschlossenen Archivierung committet keine Aenderung mehr. Das Modul muss
dafuer nichts wissen und nichts nachbauen - es ruft diesen Zugang auf, **bevor**
es eigene Zeilen sperrt (docs/architecture.md, Abschnitt 7).

Der Core kennt dabei kein Fachmodul: Er stellt den Kanal bereit, das Modul
benutzt ihn (ADR 0001).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.projects.service import ProjectService


@dataclass(frozen=True, slots=True)
class FloorPlanningContext:
    """Was ein Fachmodul ueber ein Geschoss wissen darf.

    Bewusst flach und unveraenderlich. ``default_ceiling_height_mm`` ist
    enthalten, weil Planungsdaten ohne eigene Hoehenangabe darauf zurueckfallen
    duerfen, ohne den Wert zu kopieren.
    """

    organization_id: uuid.UUID
    project_id: uuid.UUID
    project_number: str
    project_status: str
    building_id: uuid.UUID
    floor_id: uuid.UUID
    floor_name: str
    level: int
    elevation_mm: int
    default_ceiling_height_mm: int


class FloorPlanningAccess:
    """Zugang zum Geschosskontext fuer ein Fachmodul.

    ``organization_id`` stammt aus dem gepruften Token, nie aus der Anfrage
    (ADR 0006).
    """

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self._projects = ProjectService(session, organization_id)
        self._organization_id = organization_id

    def context(self, floor_id: uuid.UUID) -> FloorPlanningContext:
        """Loest ein Geschoss auf, **ohne** zu sperren. Fremd oder unbekannt: ``404``.

        Fuer lesende Zugriffe. Die Kette ``Geschoss -> Gebaeude -> Projekt`` ist
        unveraenderlich: Weder ``FloorUpdate`` noch ``BuildingUpdate`` kennen
        ``building_id`` bzw. ``project_id``, und es gibt keinen Endpunkt, der
        ein Geschoss umhaengt. Deshalb darf :meth:`writable_context` erst
        aufloesen und danach sperren, ohne dass sich die Zugehoerigkeit
        dazwischen aendern koennte. Ein Test haelt diese Annahme fest.
        """
        floor = self._projects.floors.get_or_404(floor_id)
        building = self._projects.buildings.get_or_404(floor.building_id)
        project = self._projects.get(building.project_id)
        return FloorPlanningContext(
            organization_id=self._organization_id,
            project_id=project.id,
            project_number=project.project_number,
            project_status=project.status,
            building_id=building.id,
            floor_id=floor.id,
            floor_name=floor.name,
            level=floor.level,
            elevation_mm=floor.elevation_mm,
            default_ceiling_height_mm=floor.default_ceiling_height_mm,
        )

    def writable_context(self, floor_id: uuid.UUID) -> FloorPlanningContext:
        """Wie :meth:`context`, **sperrt** aber die Projektzeile und prueft den
        Schreibschutz.

        Nach der Rueckkehr gilt bis zum Ende der Transaktion: Das Projekt ist
        nicht archiviert, und es kann auch nicht archiviert werden, solange
        diese Transaktion laeuft. Erst danach darf ein Fachmodul seine eigenen
        Zeilen sperren - die Reihenfolge ist ueberall **Projekt zuerst**.

        Ein archiviertes Projekt liefert ``409 project-archived`` - dieselbe
        Antwort wie bei den Unterressourcen des Core, damit ein Client nur
        einen Fehlervertrag kennen muss.
        """
        context = self.context(floor_id)
        # Sperrt die Projektzeile und wirft ProjectArchivedError, wenn das
        # Projekt schreibgeschuetzt ist. Der Status wird dabei neu gelesen.
        self._projects.lock_writable(context.project_id)
        return context
