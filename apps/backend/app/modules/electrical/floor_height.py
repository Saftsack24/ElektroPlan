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

**Leitungen (Phase 6b.3, Entwurf §7):** Die Standardhoehe wirkt auf Wandwegpunkte,
Durchfuehrungen und Uebergaenge Wand - Decke in Raeumen mit geerbter Hoehe. Jede
Aenderung, nach der eine Durchfuehrung ungueltig oder eine Leitung unterbrochen waere,
wird abgelehnt - auch eine Anhebung (Uebergang zur Decke). Ueber diesen Core-Weg gibt
es keine Bestaetigung (``acknowledged_cable_ids``); dafuer die Raumhoehe einzeln
aendern oder die Leitung anpassen.

Nur lesen: Hier wird nichts verschoben, verkleinert, geloescht oder committet.
Die Projektzeile haelt der Core bereits gesperrt; jede Aenderung an Raeumen und
Oeffnungen sperrt dieselbe Zeile zuerst.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.contracts.v1.floor_planning import FloorCeilingHeightChange, FloorCeilingHeightConflict
from app.core.projects.planning import FloorPlanningAccess
from app.errors import NotFoundError
from app.modules.electrical import geometry
from app.modules.electrical.cable_rules import CableStateLoader, describe_cable
from app.modules.electrical.geometry import OpeningKind
from app.modules.electrical.models import (
    ElectricalDevice,
    ElectricalDeviceType,
    ElectricalOpening,
    ElectricalRoom,
    ElectricalWall,
)

#: Der einzige Befund, der von der Raumhoehe abhaengt.
EXCEEDS = "opening-exceeds-room-height"
#: Dasselbe fuer Wandgeraete (Phase 5). Deckengeraete folgen der Decke und
#: koennen durch eine Hoehenaenderung nicht unzulaessig werden.
DEVICE_EXCEEDS = "device-exceeds-room-height"

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
        conflicts.extend(self._device_conflicts(session, change))
        conflicts.extend(self._cable_conflicts(session, change))
        return tuple(conflicts)

    def _cable_conflicts(
        self, session: Session, change: FloorCeilingHeightChange
    ) -> list[FloorCeilingHeightConflict]:
        """Durchfuehrungen und Leitungen vorher/nachher - mit der vorgeschlagenen Hoehe."""
        neu = change.proposed_default_ceiling_height_mm
        if neu == change.current_default_ceiling_height_mm:
            return []
        loader = CableStateLoader(session, change.organization_id)
        try:
            context = FloorPlanningAccess(session, change.organization_id).context(change.floor_id)
        except NotFoundError:
            # Geschoss eines anderen Mandanten: hier gibt es keine Leitungen - wie bei
            # Oeffnungen und Geraeten keine Konflikte und keine Existenzauskunft.
            return []
        building_id = context.building_id
        if not loader.has_cable_data(building_id):
            return []
        before = loader.load(building_id)
        after = loader.load(building_id, default_heights={change.floor_id: neu})
        conflicts: list[FloorCeilingHeightConflict] = []
        for pid, code in after.penetration_codes.items():
            if code is not None and before.penetration_codes.get(pid) is None:
                conflicts.append(
                    FloorCeilingHeightConflict(
                        code=code,
                        message=(
                            f"Eine Durchfuehrung bei {after.penetrations[pid].height_mm} mm laege "
                            f"mit der Standardhoehe {neu} mm nicht mehr unter der Raumhoehe."
                        ),
                        keys=(str(pid),),
                    )
                )
        for cable_id, result in after.results.items():
            new = {(p.code, p.ref) for p in result.problems} - before.findings(cable_id)
            if not new:
                continue
            reasons = []
            for problem in result.problems:
                if (problem.code, problem.ref) in new and problem.message not in reasons:
                    reasons.append(problem.message)
            conflicts.append(
                FloorCeilingHeightConflict(
                    code="cables-would-break",
                    message=(
                        f"{describe_cable(after, cable_id)}: {' '.join(reasons)} Bitte zuerst die "
                        "Leitung anpassen oder die Raumhoehe einzeln setzen."
                    ),
                    keys=(str(cable_id),),
                )
            )
        return conflicts

    def _device_conflicts(
        self, session: Session, change: FloorCeilingHeightChange
    ) -> list[FloorCeilingHeightConflict]:
        """Wandgeraete in Raeumen mit geerbter Hoehe - dieselbe Regel wie fuer Oeffnungen.

        Oberkante = Mitte + halbes Planungsmass des Typs. Abgelehnt wird jede
        Absenkung, nach der eine Oberkante ueber der Decke laege.
        """
        neu = change.proposed_default_ceiling_height_mm
        bisher = change.current_default_ceiling_height_mm
        if neu >= bisher:
            return []
        rows = session.execute(
            select(ElectricalRoom, ElectricalWall, ElectricalDevice, ElectricalDeviceType)
            .join(
                ElectricalDevice,
                (ElectricalDevice.organization_id == ElectricalRoom.organization_id)
                & (ElectricalDevice.room_id == ElectricalRoom.id),
            )
            .join(
                ElectricalWall,
                (ElectricalWall.organization_id == ElectricalDevice.organization_id)
                & (ElectricalWall.id == ElectricalDevice.wall_id),
            )
            .join(
                ElectricalDeviceType, ElectricalDeviceType.key == ElectricalDevice.device_type_key
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
                ElectricalDevice.id.asc(),
            )
            .execution_options(populate_existing=True)
        ).all()
        conflicts: list[FloorCeilingHeightConflict] = []
        for room, wall, device, kind in rows:
            if device.center_height_mm is None:
                continue
            top = device.center_height_mm + kind.height_mm // 2
            if top <= neu:
                continue
            ort = f'Raum "{_label(room)}", Wand {wall.sort_order + 1}, {kind.label}: '
            if top > bisher:
                message = (
                    f"{ort}Die Oberkante des Geraets liegt bei {top} mm und schon jetzt ueber der "
                    f"Standardhoehe von {bisher} mm. Eine Absenkung auf {neu} mm wuerde den "
                    "Konflikt vergroessern."
                )
            else:
                message = (
                    f"{ort}Die Oberkante des Geraets liegt bei {top} mm, die neue Standardhoehe "
                    f"betraegt {neu} mm."
                )
            conflicts.append(
                FloorCeilingHeightConflict(
                    code=DEVICE_EXCEEDS, message=message, keys=(str(room.id), str(device.id))
                )
            )
        return conflicts
