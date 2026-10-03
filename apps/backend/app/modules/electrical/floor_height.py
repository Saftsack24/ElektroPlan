"""Pruefung einer neuen Geschoss-Standardhoehe durch die Elektroplanung (ADR 0022).

Implementiert :class:`~app.contracts.v1.floor_planning.FloorCeilingHeightParticipant`.
Betroffen sind nur Raeume, die ihre Hoehe vom Geschoss **erben**
(``height_mm IS NULL``); ein Raum mit eigener Hoehe haengt nicht von der
Standardhoehe ab.

**Regel** (ADR 0022, nachgeschaerft): Abgelehnt wird jede **Absenkung**, nach
der eine Oeffnung hoeher als ihr Raum waere:

* passt sie bisher und danach nicht mehr - die Aenderung wuerde sie ungueltig
  machen;
* passt sie schon bisher nicht - die Absenkung wuerde den bestehenden Konflikt
  vergroessern.

Eine unveraenderte oder hoehere Standardhoehe ist immer zulaessig, auch wenn
ein bestehender Konflikt danach noch nicht vollstaendig behoben ist - eine
Verbesserung darf nie blockiert werden. Verbleibende Konflikte bleiben
gespeichert, wie sie sind, und werden in Wand- und Deckenansicht erklaert.
Geprueft wird mit derselben Funktion wie bei einer Raumhoehenaenderung
(:func:`geometry.opening_height_problems`).

Nur lesen: Hier wird nichts verschoben, verkleinert, geloescht oder committet.
Die Projektzeile haelt der Core bereits gesperrt; jede Aenderung an Raeumen und
Oeffnungen sperrt dieselbe Zeile zuerst.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.contracts.v1.floor_planning import FloorCeilingHeightChange, FloorCeilingHeightConflict
from app.modules.electrical import geometry
from app.modules.electrical.geometry import OpeningKind
from app.modules.electrical.models import ElectricalOpening, ElectricalRoom, ElectricalWall

#: Der einzige Befund, der von der Raumhoehe abhaengt.
EXCEEDS = "opening-exceeds-room-height"

#: Kurzname je Art - die Meldung muss mehrere Oeffnungen einer Wand unterscheiden.
_ART = {"door": "Tuer", "window": "Fenster", "passage": "Durchgang"}


def _label(room: ElectricalRoom) -> str:
    return f"{room.room_number} {room.name}" if room.room_number else room.name


class ElectricalFloorHeightCheck:
    """Prueft Oeffnungen in Raeumen, die die Standardhoehe des Geschosses erben."""

    def check_floor_ceiling_height(
        self, session: Session, change: FloorCeilingHeightChange
    ) -> tuple[FloorCeilingHeightConflict, ...]:
        rows = session.execute(
            select(ElectricalRoom, ElectricalWall, ElectricalOpening)
            .join(
                ElectricalWall,
                (ElectricalWall.organization_id == ElectricalRoom.organization_id)
                & (ElectricalWall.room_id == ElectricalRoom.id),
            )
            .join(
                ElectricalOpening,
                (ElectricalOpening.organization_id == ElectricalWall.organization_id)
                & (ElectricalOpening.wall_id == ElectricalWall.id),
            )
            .where(
                ElectricalRoom.organization_id == change.organization_id,
                ElectricalRoom.floor_id == change.floor_id,
                ElectricalRoom.height_mm.is_(None),
            )
            .order_by(
                ElectricalRoom.name.asc(),
                ElectricalRoom.id.asc(),
                ElectricalWall.sort_order.asc(),
                ElectricalOpening.offset_mm.asc(),
                ElectricalOpening.id.asc(),
            )
            .execution_options(populate_existing=True)
        ).all()

        conflicts: list[FloorCeilingHeightConflict] = []
        for room, wall, opening in rows:

            def exceeds(height_mm: int, opening: ElectricalOpening = opening) -> bool:
                return any(
                    problem.code == EXCEEDS
                    for problem in geometry.opening_height_problems(
                        key=str(opening.id),
                        kind=OpeningKind(opening.kind),
                        height_mm=opening.height_mm,
                        sill_height_mm=opening.sill_height_mm,
                        room_height_mm=height_mm,
                    )
                )

            neu = change.proposed_default_ceiling_height_mm
            bisher = change.current_default_ceiling_height_mm
            # Nur eine Absenkung kann einen Konflikt erzeugen oder vergroessern.
            if neu >= bisher or not exceeds(neu):
                continue
            top = opening.sill_height_mm + opening.height_mm
            art = _ART.get(opening.kind, "Oeffnung")
            ort = (
                f'Raum "{_label(room)}", Wand {wall.sort_order + 1}, {art} bei '
                f"{opening.offset_mm} mm ab Wandanfang: "
            )
            if exceeds(bisher):
                message = (
                    f"{ort}Die Oberkante der Oeffnung liegt bei {top} mm und schon jetzt ueber "
                    f"der Standardhoehe von {bisher} mm. Eine Absenkung auf {neu} mm wuerde "
                    "den Konflikt vergroessern."
                )
            else:
                message = (
                    f"{ort}Die Oberkante der Oeffnung liegt bei {top} mm, die neue "
                    f"Standardhoehe betraegt {neu} mm."
                )
            conflicts.append(
                FloorCeilingHeightConflict(
                    code=EXCEEDS, message=message, keys=(str(room.id), str(opening.id))
                )
            )
        return tuple(conflicts)
