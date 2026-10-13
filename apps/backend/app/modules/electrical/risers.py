"""Steigwege: anlegen, ersetzen, loeschen, auswerten (Phase 6a.4, ADR 0025).

Ein Steigweg gehoert zu genau einem Gebaeude und hat hoechstens einen
Uebergabepunkt (Halt) je Geschoss dieses Gebaeudes. Er entsteht nur
ausdruecklich - nie aus uebereinanderliegenden Raeumen - und ist an keinen
Raum gebunden. Verlauf, Status und Laengen leitet ``riser_course.py`` bei
jedem Lesen aus Halten und Geschossen ab; gespeichert wird davon nichts.

**Ablauf jedes Schreibvorgangs** (eine Transaktion, "Projekt zuerst"):

1. Projektzeile sperren und Schreibschutz pruefen
   (``FloorPlanningAccess.writable_building_context`` - ``409`` bei
   ``completed`` und ``archived``); Gebaeude und Geschosse danach frisch lesen,
2. Steigweg sperren und ``If-Match`` pruefen (beim Ersetzen und Loeschen),
3. Halte gegen die frisch gelesenen Geschosse desselben Gebaeudes pruefen,
4. schreiben - vorhandene Halte behalten ihre ID.

Kein Event: Es gibt keinen Konsumenten und nichts Abgeleitetes zu speichern
(Entwurf §5).
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.persistence import CONCURRENT_UPDATE_DETAIL, flush, unique_violation_translated
from app.core.preconditions import check_version
from app.core.projects.planning import BuildingPlanningContext, FloorPlanningAccess
from app.core.tenancy.repository import TenantRepository
from app.db.mixins import utcnow
from app.errors import ProblemFieldError, ValidationFailedError, VersionConflictError
from app.modules.electrical.cable_rules import CableGuard, cables_referencing, in_use_error
from app.modules.electrical.models import (
    RISER_NAME_CONSTRAINT,
    RISER_STOP_FLOOR_CONSTRAINT,
    ElectricalRiser,
    ElectricalRiserStop,
)
from app.modules.electrical.riser_course import (
    RiserAnalysis,
    RiserFloor,
    RiserStopPoint,
    analyse_riser,
)
from app.modules.electrical.schemas import RiserCreate, RiserStopIn, RiserUpdate

NAME_TAKEN_DETAIL = "In diesem Gebaeude gibt es bereits einen Steigweg mit diesem Namen."


class RiserRepository(TenantRepository[ElectricalRiser]):
    model = ElectricalRiser


@dataclass(frozen=True, slots=True)
class RiserView:
    riser: ElectricalRiser
    analysis: RiserAnalysis


@dataclass(frozen=True, slots=True)
class RiserWriteResult:
    """Was die API-Schicht fuer den Projektvermerk braucht."""

    context: BuildingPlanningContext
    changed: bool = True


def riser_floors(context: BuildingPlanningContext) -> list[RiserFloor]:
    return [
        RiserFloor(
            floor_id=floor.floor_id,
            level=floor.level,
            elevation_mm=floor.elevation_mm,
            elevation_confirmed=floor.elevation_confirmed,
            default_ceiling_height_mm=floor.default_ceiling_height_mm,
        )
        for floor in context.floors
    ]


def _problem(code: str, message: str, *keys: uuid.UUID, field: str = "stops") -> ProblemFieldError:
    return ProblemFieldError(
        field=field, code=code, message=message, keys=[str(key) for key in keys] or None
    )


def _invalid(detail: str, code: str, message: str, *keys: uuid.UUID) -> ValidationFailedError:
    return ValidationFailedError(detail, errors=[_problem(code, message, *keys)])


def _name_taken() -> ValidationFailedError:
    return ValidationFailedError(
        NAME_TAKEN_DETAIL,
        errors=[
            _problem("riser-name-taken", "Name im Gebaeude bereits vergeben.", field="name"),
        ],
    )


class RiserService:
    """Steigwege eines Mandanten."""

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self.session = session
        self.organization_id = organization_id
        self.risers = RiserRepository(session, organization_id)
        self.structure = FloorPlanningAccess(session, organization_id)
        self.cable_guard = CableGuard(session, organization_id)

    # ------------------------------------------------------------------ Lesen

    def overview(self, building_id: uuid.UUID) -> tuple[BuildingPlanningContext, list[RiserView]]:
        """Alle Steigwege eines Gebaeudes - archivierte Projekte bleiben lesbar."""
        context = self.structure.building_context(building_id)
        risers = list(
            self.session.execute(
                self.risers.query()
                .where(ElectricalRiser.building_id == building_id)
                .order_by(ElectricalRiser.name.asc(), ElectricalRiser.id.asc())
            ).scalars()
        )
        stops = self._stops_of([riser.id for riser in risers])
        return context, [self._view(context, riser, stops.get(riser.id, [])) for riser in risers]

    # -------------------------------------------------------------- Schreiben

    def create(
        self, building_id: uuid.UUID, payload: RiserCreate
    ) -> tuple[RiserView, RiserWriteResult]:
        context = self.structure.writable_building_context(building_id)
        self._require_valid_stops(context, payload.stops, existing=[])
        self._require_free_name(building_id, payload.name, exclude_id=None)
        riser = ElectricalRiser(
            id=uuid.uuid4(),
            organization_id=self.organization_id,
            building_id=building_id,
            name=payload.name,
            note=payload.note,
            offset_mode=payload.offset_mode,
        )
        self.risers.add(riser)
        self._flush()
        stops = [self._new_stop(riser.id, stop) for stop in payload.stops]
        self.session.add_all(stops)
        self._flush()
        return self._view(context, riser, stops), RiserWriteResult(context=context)

    def replace(
        self, riser_id: uuid.UUID, payload: RiserUpdate, *, expected_version: int
    ) -> tuple[RiserView, RiserWriteResult]:
        riser, context = self._locked(riser_id, expected_version)
        existing = self._stops_of([riser.id]).get(riser.id, [])
        self._require_valid_stops(context, payload.stops, existing=existing)
        if payload.name != riser.name:
            self._require_free_name(riser.building_id, payload.name, exclude_id=riser.id)

        by_id = {stop.id: stop for stop in existing}
        kept_ids = {stop.id for stop in payload.stops if stop.id is not None}
        removed = [stop for stop in existing if stop.id not in kept_ids]
        added = [stop for stop in payload.stops if stop.id is None]
        moved = [
            stop
            for stop in payload.stops
            if stop.id is not None
            and (by_id[stop.id].x_mm, by_id[stop.id].y_mm) != (stop.x_mm, stop.y_mm)
        ]
        fields_changed = (riser.name, riser.note, riser.offset_mode) != (
            payload.name,
            payload.note,
            payload.offset_mode,
        )
        if not (fields_changed or removed or added or moved):
            return self._view(context, riser, existing), RiserWriteResult(
                context=context, changed=False
            )

        # Ein genutzter Halt verschwindet nicht (Phase 6b.3, Entwurf §7).
        users = cables_referencing(
            self.session, self.organization_id, stop_ids=[stop.id for stop in removed]
        )
        if users:
            raise in_use_error(
                "Ein Uebergabepunkt, der entfallen soll, wird von Leitungen genutzt. Bitte zuerst "
                "den Weg der Leitungen aendern.",
                "riser-stop-in-use",
                "Uebergabepunkt wird genutzt.",
                users,
                *(stop.id for stop in removed),
            )
        cables_before = self.cable_guard.snapshot(riser.building_id)

        # Erst entfernen, dann aendern und anlegen: Ein neuer Halt darf auf
        # einem Geschoss entstehen, dessen alter Halt im selben Schritt entfaellt.
        for stop in removed:
            self.session.delete(stop)
        self._flush()
        for stop_in in moved:
            assert stop_in.id is not None
            by_id[stop_in.id].x_mm = stop_in.x_mm
            by_id[stop_in.id].y_mm = stop_in.y_mm
            by_id[stop_in.id].updated_at = utcnow()
        new_stops = [self._new_stop(riser.id, stop) for stop in added]
        self.session.add_all(new_stops)
        riser.name = payload.name
        riser.note = payload.note
        riser.offset_mode = payload.offset_mode
        # Auch eine reine Halteaenderung zaehlt die Steigwegversion weiter.
        riser.updated_at = utcnow()
        self._flush()
        # Verschobene Halte: Laengen aendern sich sichtbar; liegt ein Ein- oder
        # Ausstieg danach nicht mehr am Halt, nur mit Bestaetigung (Entwurf §7).
        self.cable_guard.require_unbroken(
            cables_before,
            acknowledged=payload.acknowledged_cable_ids,
            acknowledgement_supported=True,
        )
        stops = [by_id[stop_id] for stop_id in kept_ids] + new_stops
        return self._view(context, riser, stops), RiserWriteResult(context=context)

    def delete(self, riser_id: uuid.UUID, *, expected_version: int) -> RiserWriteResult:
        """Entfernt den Steigweg samt Halten (``ON DELETE CASCADE``)."""
        riser, context = self._locked(riser_id, expected_version)
        users = cables_referencing(self.session, self.organization_id, riser_ids=[riser.id])
        if users:
            raise in_use_error(
                "Dieser Steigweg wird von Leitungen genutzt. Bitte zuerst den Weg der Leitungen "
                "aendern.",
                "riser-in-use",
                "Steigweg wird genutzt.",
                users,
                riser.id,
            )
        self.session.delete(riser)
        flush(self.session)
        return RiserWriteResult(context=context)

    # ---------------------------------------------------------------- Helfer

    def _locked(
        self, riser_id: uuid.UUID, expected_version: int
    ) -> tuple[ElectricalRiser, BuildingPlanningContext]:
        """Projekt sperren, dann den Steigweg - in dieser Reihenfolge."""
        riser = self.risers.get_or_404(riser_id)
        context = self.structure.writable_building_context(riser.building_id)
        locked = self.session.execute(
            select(ElectricalRiser)
            .where(
                ElectricalRiser.organization_id == self.organization_id,
                ElectricalRiser.id == riser_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if locked is None:
            # Zwischenzeitlich geloescht.
            raise VersionConflictError(CONCURRENT_UPDATE_DETAIL)
        check_version(locked, expected_version)
        return locked, context

    def _stops_of(
        self, riser_ids: Sequence[uuid.UUID]
    ) -> dict[uuid.UUID, list[ElectricalRiserStop]]:
        result: dict[uuid.UUID, list[ElectricalRiserStop]] = {}
        if not riser_ids:
            return result
        for stop in self.session.execute(
            select(ElectricalRiserStop)
            .where(
                ElectricalRiserStop.organization_id == self.organization_id,
                ElectricalRiserStop.riser_id.in_(riser_ids),
            )
            .order_by(ElectricalRiserStop.id.asc())
            .execution_options(populate_existing=True)
        ).scalars():
            result.setdefault(stop.riser_id, []).append(stop)
        return result

    def _require_valid_stops(
        self,
        context: BuildingPlanningContext,
        stops: Sequence[RiserStopIn],
        *,
        existing: Sequence[ElectricalRiserStop],
    ) -> None:
        floor_ids = {floor.floor_id for floor in context.floors}
        unknown_floors = [stop.floor_id for stop in stops if stop.floor_id not in floor_ids]
        if unknown_floors:
            # Fremder Mandant, anderes Gebaeude und unbekannte ID: dieselbe Antwort.
            raise _invalid(
                "Ein Uebergabepunkt liegt auf einem Geschoss, das nicht zu diesem Gebaeude "
                "gehoert. Es wurde nichts gespeichert.",
                "riser-stop-floor-unknown",
                "Geschoss gehoert nicht zu diesem Gebaeude.",
                *unknown_floors,
            )
        seen_floors: set[uuid.UUID] = set()
        for stop in stops:
            if stop.floor_id in seen_floors:
                raise _invalid(
                    "Ein Steigweg hat hoechstens einen Uebergabepunkt je Geschoss. Es wurde "
                    "nichts gespeichert.",
                    "riser-stop-floor-duplicate",
                    "Zweiter Uebergabepunkt auf demselben Geschoss.",
                    stop.floor_id,
                )
            seen_floors.add(stop.floor_id)
        by_id = {stop.id: stop for stop in existing}
        seen_ids: set[uuid.UUID] = set()
        for stop in stops:
            if stop.id is None:
                continue
            if stop.id in seen_ids:
                raise _invalid(
                    "Ein Uebergabepunkt ist doppelt angegeben. Es wurde nichts gespeichert.",
                    "riser-stop-id-duplicate",
                    "Uebergabepunkt doppelt angegeben.",
                    stop.id,
                )
            seen_ids.add(stop.id)
            current = by_id.get(stop.id)
            if current is None:
                raise _invalid(
                    "Ein Uebergabepunkt gehoert nicht zu diesem Steigweg. Bitte neu laden.",
                    "riser-stop-unknown",
                    "Uebergabepunkt nicht gefunden.",
                    stop.id,
                )
            if current.floor_id != stop.floor_id:
                raise _invalid(
                    "Ein vorhandener Uebergabepunkt wechselt nie das Geschoss. Bitte den Punkt "
                    "entfernen und auf dem anderen Geschoss neu setzen.",
                    "riser-stop-floor-changed",
                    "Uebergabepunkt wuerde das Geschoss wechseln.",
                    stop.id,
                )

    def _require_free_name(
        self, building_id: uuid.UUID, name: str, *, exclude_id: uuid.UUID | None
    ) -> None:
        stmt = self.risers.query().where(
            ElectricalRiser.building_id == building_id, ElectricalRiser.name == name
        )
        if exclude_id is not None:
            stmt = stmt.where(ElectricalRiser.id != exclude_id)
        if self.session.execute(stmt).scalars().first() is not None:
            raise _name_taken()

    def _new_stop(self, riser_id: uuid.UUID, stop: RiserStopIn) -> ElectricalRiserStop:
        return ElectricalRiserStop(
            id=uuid.uuid4(),
            organization_id=self.organization_id,
            riser_id=riser_id,
            floor_id=stop.floor_id,
            x_mm=stop.x_mm,
            y_mm=stop.y_mm,
        )

    def _flush(self) -> None:
        """Schreibt und uebersetzt die beiden erwarteten Unique-Verletzungen.

        Beide sind vorher geprueft; uebrig bleibt das Rennen zweier
        gleichzeitiger Anfragen, die beide die Vorpruefung bestehen.
        """
        with (
            unique_violation_translated(
                self.session, constraint=RISER_NAME_CONSTRAINT, error=_name_taken()
            ),
            unique_violation_translated(
                self.session,
                constraint=RISER_STOP_FLOOR_CONSTRAINT,
                error=_invalid(
                    "Ein Steigweg hat hoechstens einen Uebergabepunkt je Geschoss. Bitte neu "
                    "laden.",
                    "riser-stop-floor-duplicate",
                    "Zweiter Uebergabepunkt auf demselben Geschoss.",
                ),
            ),
        ):
            flush(self.session)

    def _view(
        self,
        context: BuildingPlanningContext,
        riser: ElectricalRiser,
        stops: Sequence[ElectricalRiserStop],
    ) -> RiserView:
        return RiserView(
            riser=riser,
            analysis=analyse_riser(
                riser_floors(context),
                [
                    RiserStopPoint(
                        stop_id=stop.id, floor_id=stop.floor_id, x_mm=stop.x_mm, y_mm=stop.y_mm
                    )
                    for stop in stops
                ],
                riser.offset_mode,
            ),
        )
