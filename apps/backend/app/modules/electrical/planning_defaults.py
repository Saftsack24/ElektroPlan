"""Kabelvorlagen, Betriebsstandard, Projektvorgabe und wirksame Vorgaben (Phase 6c, V1, ADR 0027).

Die Auswertung der Kette steht als reine Funktion in :mod:`defaults_chain`; hier werden
nur gelesen, geprueft, gesperrt und geschrieben.

**Sperrstrategie** (Entwurf §10.5, ADR 0027 Nr. 8):

* Betriebsweite Vorgaben (Betriebsstandard samt Vorlage je Geraetetyp und alle
  Kabelvorlagen) schuetzt eine **Vorgabensperre je Betrieb**: eine transaktionsgebundene
  PostgreSQL-Advisory-Sperre (:func:`lock_defaults`). Sie wirkt auch, solange noch keine
  Zeile existiert - eine Zeilensperre koennte eine gleichzeitige Erstanlage nicht
  aufhalten.
* **Schreiben** betriebsweiter Vorgaben: Vorgabensperre **exklusiv**, danach die eigene
  Zeile. **Nie** eine Projektsperre - betriebsweite Vorgaben aendern keine Projektdaten
  und sind deshalb auch fuer abgeschlossene oder archivierte Projekte folgenlos.
* **Lesen und Pruefen** (wirksame Vorgaben, Speichern einer Leitung mit Vorgabenherkunft,
  Projektvorgabe): zuerst die Projektsperre (geteilt bzw. exklusiv, Core), **danach** die
  Vorgabensperre **geteilt**. Zwischen Pruefen der Vorgabenbasis und Commit kann so keine
  betriebsweite Aenderung committen.
* Kein Zyklus: Ein Halter der exklusiven Vorgabensperre wartet nie auf ein Projekt, und
  geteilte Sperren schliessen sich nicht aus. Die bestehende Reihenfolge "Projekt zuerst"
  bleibt unveraendert.

Die Projektvorgabe steht unter der Projektsperre (``writable_project_context``) - ihre
eigene Zeile sperrt sie zusaetzlich mit ``FOR UPDATE``.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import delete, exists, select, text, union_all
from sqlalchemy.orm import Session

from app.core.persistence import CONCURRENT_UPDATE_DETAIL, flush, unique_violation_translated
from app.core.preconditions import check_version
from app.core.projects.planning import (
    BuildingPlanningContext,
    FloorPlanningAccess,
    ProjectPlanningContext,
)
from app.core.tenancy.repository import TenantRepository
from app.db.mixins import utcnow
from app.errors import (
    ConflictError,
    NotFoundError,
    ProblemFieldError,
    ValidationFailedError,
    VersionConflictError,
)
from app.modules.electrical.catalog import ASSIGNABLE_CATEGORIES
from app.modules.electrical.defaults_chain import (
    EMPTY_LEVEL,
    AllowanceResolution,
    CircuitProposal,
    DefaultsInput,
    DefaultsLevel,
    Endpoint,
    ReserveResolution,
    SpecResolution,
    TemplateSpec,
    resolve_allowances,
    resolve_reserve,
    resolve_spec,
)
from app.modules.electrical.models import (
    CABLE_TEMPLATE_NAME_CONSTRAINT,
    PLANNING_DEFAULTS_ORG_CONSTRAINT,
    PROJECT_DEFAULTS_PROJECT_CONSTRAINT,
    ElectricalCable,
    ElectricalCableTemplate,
    ElectricalCircuit,
    ElectricalDevice,
    ElectricalDeviceType,
    ElectricalDeviceTypeCableTemplate,
    ElectricalDistributionBoard,
    ElectricalPlanningDefaults,
    ElectricalProjectDeviceTypeCableTemplate,
    ElectricalProjectPlanningDefaults,
    ElectricalRoom,
)
from app.modules.electrical.schemas import (
    CableTemplateCreate,
    CableTemplateUpdate,
    PlanningDefaultsIn,
    ProjectPlanningDefaultsIn,
)


class PlanningDefaultsChangedError(ConflictError):
    """Die Vorgaben haben sich seit dem Lesen geaendert (ADR 0027 Nr. 8) - nichts gespeichert."""

    error_type = "planning-defaults-changed"
    title = "Planungsvorgaben geaendert"


class CableTemplateRepository(TenantRepository[ElectricalCableTemplate]):
    model = ElectricalCableTemplate


#: Namensraum der Vorgabensperre - unterscheidet sie von anderen Advisory-Sperren.
_LOCK_NAMESPACE = b"elektroplan.electrical.planning-defaults:"


def defaults_lock_key(organization_id: uuid.UUID) -> int:
    """Stabiler 64-Bit-Schluessel der Vorgabensperre eines Betriebs."""
    digest = hashlib.sha256(_LOCK_NAMESPACE + organization_id.bytes).digest()
    return int.from_bytes(digest[:8], "big", signed=True)


def lock_defaults(session: Session, organization_id: uuid.UUID, *, exclusive: bool) -> None:
    """Vorgabensperre des Betriebs bis zum Ende der Transaktion (siehe Moduldoku)."""
    function = "pg_advisory_xact_lock" if exclusive else "pg_advisory_xact_lock_shared"
    session.execute(text(f"SELECT {function}(:key)"), {"key": defaults_lock_key(organization_id)})


def _problem(field: str, code: str, message: str, *keys: object) -> ProblemFieldError:
    return ProblemFieldError(
        field=field, code=code, message=message, keys=[str(key) for key in keys] or None
    )


def _invalid(
    detail: str, field: str, code: str, message: str, *keys: object
) -> ValidationFailedError:
    return ValidationFailedError(detail, errors=[_problem(field, code, message, *keys)])


def percent_out(value: Decimal | None) -> str | None:
    """Prozentsatz als String mit zwei Nachkommastellen (ADR 0005), etwa ``"20.00"``."""
    return None if value is None else f"{value.quantize(Decimal('0.01'))}"


def _decimal(value: str | None) -> Decimal | None:
    return None if value is None else Decimal(value)


def template_spec(row: ElectricalCableTemplate) -> TemplateSpec:
    return TemplateSpec(
        id=row.id,
        name=row.name,
        cable_type=row.cable_type,
        conductor_count=row.conductor_count,
        cross_section_mm2=row.cross_section_mm2,
        is_active=row.is_active,
        version=row.version,
    )


@dataclass(frozen=True, slots=True)
class TemplateView:
    template: ElectricalCableTemplate
    in_use: bool


@dataclass(frozen=True, slots=True)
class DefaultsView:
    """Gespeicherter Stand einer Ebene; ``row is None`` = nichts gespeichert (Version 0)."""

    row: ElectricalPlanningDefaults | ElectricalProjectPlanningDefaults | None
    type_templates: tuple[tuple[str, uuid.UUID], ...]

    @property
    def version(self) -> int:
        return 0 if self.row is None else self.row.version

    def level(self) -> DefaultsLevel:
        row = self.row
        if row is None:
            return EMPTY_LEVEL
        return DefaultsLevel(
            version=row.version,
            reserve_percent=row.reserve_percent,
            board_allowance_mm=row.board_allowance_mm,
            junction_allowance_mm=row.junction_allowance_mm,
            device_allowance_mm=row.device_allowance_mm,
            default_template_id=row.default_cable_template_id,
            type_templates=dict(self.type_templates),
        )


@dataclass(frozen=True, slots=True)
class ForCable:
    circuit: ElectricalCircuit
    start_device_id: uuid.UUID | None
    end_device_id: uuid.UUID | None
    spec: SpecResolution
    reserve: ReserveResolution
    allowances: AllowanceResolution


@dataclass(frozen=True, slots=True)
class EffectiveView:
    context: ProjectPlanningContext
    office: DefaultsView
    project: DefaultsView
    data: DefaultsInput
    templates: tuple[TemplateView, ...]
    for_cable: ForCable | None


@dataclass(frozen=True, slots=True)
class DefaultsWriteResult:
    """Fuer den Projektvermerk der API-Schicht (nur Projektvorgabe)."""

    project_id: uuid.UUID | None
    changed: bool


class PlanningDefaultsService:
    """Vorlagen und Vorgaben eines Mandanten; ``organization_id`` aus dem Token."""

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self.session = session
        self.organization_id = organization_id
        self.templates = CableTemplateRepository(session, organization_id)
        self.structure = FloorPlanningAccess(session, organization_id)

    # ------------------------------------------------------------ Kabelvorlagen

    def list_templates(self) -> list[TemplateView]:
        rows = list(
            self.session.execute(
                select(ElectricalCableTemplate)
                .where(ElectricalCableTemplate.organization_id == self.organization_id)
                .order_by(ElectricalCableTemplate.sort_order, ElectricalCableTemplate.name)
            ).scalars()
        )
        used = self._templates_in_use([row.id for row in rows])
        return [TemplateView(row, row.id in used) for row in rows]

    def create_template(self, payload: CableTemplateCreate) -> TemplateView:
        lock_defaults(self.session, self.organization_id, exclusive=True)
        row = ElectricalCableTemplate(
            organization_id=self.organization_id,
            name=payload.name,
            cable_type=payload.cable_type,
            conductor_count=payload.conductor_count,
            cross_section_mm2=Decimal(payload.cross_section_mm2),
            is_active=payload.is_active,
            sort_order=payload.sort_order,
        )
        self.session.add(row)
        self._flush_template()
        return TemplateView(row, in_use=False)

    def update_template(
        self, template_id: uuid.UUID, payload: CableTemplateUpdate, *, expected_version: int
    ) -> tuple[TemplateView, bool]:
        lock_defaults(self.session, self.organization_id, exclusive=True)
        row = self._locked_template(template_id, expected_version)
        changes = payload.model_dump(exclude_unset=True)
        if "cross_section_mm2" in changes:
            changes["cross_section_mm2"] = Decimal(changes["cross_section_mm2"])
        changed = any(getattr(row, key) != value for key, value in changes.items())
        if changed:
            for key, value in changes.items():
                setattr(row, key, value)
            self._flush_template()
        used = self._templates_in_use([row.id])
        return TemplateView(row, row.id in used), changed

    def delete_template(self, template_id: uuid.UUID, *, expected_version: int) -> None:
        """Nur ungenutzt; sonst ``409 cable-template-in-use`` - deaktivieren statt loeschen."""
        lock_defaults(self.session, self.organization_id, exclusive=True)
        row = self._locked_template(template_id, expected_version)
        if self._templates_in_use([row.id]):
            raise ConflictError(
                "Diese Kabelvorlage wird von Leitungen oder Vorgaben genutzt und laesst sich "
                "nicht loeschen. Bitte deaktivieren - bestehende Leitungen behalten ihre Angaben.",
                errors=[
                    _problem(
                        "cable_template",
                        "cable-template-in-use",
                        "Kabelvorlage wird genutzt.",
                        row.id,
                    )
                ],
            )
        self.session.delete(row)
        flush(self.session)

    # --------------------------------------------------------- Betriebsstandard

    def office(self) -> DefaultsView:
        """Betriebsstandard ohne Sperre (fuer reine Leseansichten)."""
        row = self.session.execute(
            select(ElectricalPlanningDefaults).where(
                ElectricalPlanningDefaults.organization_id == self.organization_id
            )
        ).scalar_one_or_none()
        return DefaultsView(row, self._office_type_templates())

    def put_office(self, payload: PlanningDefaultsIn) -> tuple[DefaultsView, bool]:
        """Ersetzt den Betriebsstandard - exklusive Vorgabensperre, keine Projektsperre."""
        lock_defaults(self.session, self.organization_id, exclusive=True)
        row = self.session.execute(
            select(ElectricalPlanningDefaults)
            .where(ElectricalPlanningDefaults.organization_id == self.organization_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        self._require_expected(row, payload.expected_version)
        stored = dict(self._office_type_templates())
        self._require_templates(payload, stored)
        created = row is None
        if row is None:
            row = ElectricalPlanningDefaults(organization_id=self.organization_id)
            self._apply_fields(row, payload)
            self.session.add(row)
            with unique_violation_translated(
                self.session,
                constraint=PLANNING_DEFAULTS_ORG_CONSTRAINT,
                error=VersionConflictError(CONCURRENT_UPDATE_DETAIL),
            ):
                flush(self.session)
            changed = True
        else:
            changed = self._apply_fields(row, payload)
        wanted = {
            item.device_type_key: item.cable_template_id for item in payload.device_type_templates
        }
        if wanted != stored:
            self.session.execute(
                delete(ElectricalDeviceTypeCableTemplate)
                .where(ElectricalDeviceTypeCableTemplate.organization_id == self.organization_id)
                .execution_options(synchronize_session=False)
            )
            self.session.add_all(
                ElectricalDeviceTypeCableTemplate(
                    organization_id=self.organization_id,
                    device_type_key=key,
                    cable_template_id=template_id,
                )
                for key, template_id in sorted(wanted.items())
            )
            changed = True
        if changed and not created:
            # Die Zuordnung je Geraetetyp steht unter der Version des Betriebsstandards: jede
            # Aenderung erhoeht sie genau einmal (Aenderungszeitpunkt am Datensatz).
            row.updated_at = utcnow()
        flush(self.session)
        return DefaultsView(row, self._office_type_templates()), changed

    # ----------------------------------------------------------- Projektvorgabe

    def project(self, project_id: uuid.UUID) -> tuple[ProjectPlanningContext, DefaultsView]:
        context = self.structure.consistent_project_context(project_id)
        return context, self._project_view(project_id)

    def put_project(
        self, project_id: uuid.UUID, payload: ProjectPlanningDefaultsIn
    ) -> tuple[ProjectPlanningContext, DefaultsView, DefaultsWriteResult]:
        """Ersetzt die Projektvorgabe: Projektsperre (Schreibschutz) -> Vorgabensperre geteilt."""
        context = self.structure.writable_project_context(project_id)
        lock_defaults(self.session, self.organization_id, exclusive=False)
        row = self.session.execute(
            select(ElectricalProjectPlanningDefaults)
            .where(
                ElectricalProjectPlanningDefaults.organization_id == self.organization_id,
                ElectricalProjectPlanningDefaults.project_id == context.project_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        self._require_expected(row, payload.expected_version)
        stored = dict(self._project_type_templates(None if row is None else row.id))
        self._require_templates(payload, stored)
        created = row is None
        if row is None:
            row = ElectricalProjectPlanningDefaults(
                id=uuid.uuid4(), organization_id=self.organization_id, project_id=context.project_id
            )
            self._apply_fields(row, payload)
            self.session.add(row)
            with unique_violation_translated(
                self.session,
                constraint=PROJECT_DEFAULTS_PROJECT_CONSTRAINT,
                error=VersionConflictError(CONCURRENT_UPDATE_DETAIL),
            ):
                flush(self.session)
            changed = True
        else:
            changed = self._apply_fields(row, payload)
        wanted = {
            item.device_type_key: item.cable_template_id for item in payload.device_type_templates
        }
        if wanted != stored:
            self.session.execute(
                delete(ElectricalProjectDeviceTypeCableTemplate)
                .where(
                    ElectricalProjectDeviceTypeCableTemplate.organization_id
                    == self.organization_id,
                    ElectricalProjectDeviceTypeCableTemplate.project_defaults_id == row.id,
                )
                .execution_options(synchronize_session=False)
            )
            self.session.add_all(
                ElectricalProjectDeviceTypeCableTemplate(
                    organization_id=self.organization_id,
                    project_defaults_id=row.id,
                    device_type_key=key,
                    cable_template_id=template_id,
                )
                for key, template_id in sorted(wanted.items())
            )
            changed = True
        if changed and not created:
            row.updated_at = utcnow()
        flush(self.session)
        return (
            context,
            self._project_view(context.project_id),
            DefaultsWriteResult(project_id=context.project_id, changed=changed),
        )

    # -------------------------------------------------------- Wirksame Vorgaben

    def effective(
        self,
        project_id: uuid.UUID,
        *,
        circuit_id: uuid.UUID | None = None,
        start_device_id: uuid.UUID | None = None,
        end_device_id: uuid.UUID | None = None,
    ) -> EffectiveView:
        """Aufgeloeste Vorgaben samt Herkunft und Versionsbasis - ein konsistenter Stand.

        Geteilte Projektsperre, danach geteilte Vorgabensperre. Mit ``circuit_id`` auch die
        Vorbelegung einer konkreten Leitung (Stromkreis und Geraete dieses Projekts, sonst
        ``404`` bzw. ``422``).
        """
        if circuit_id is None and (start_device_id is not None or end_device_id is not None):
            raise _invalid(
                "Geraete nur zusammen mit dem Stromkreis angeben.",
                "circuit_id",
                "circuit-required",
                "Stromkreis fehlt.",
            )
        context = self.structure.consistent_project_context(project_id)
        lock_defaults(self.session, self.organization_id, exclusive=False)
        office = self.office()
        project = self._project_view(context.project_id)
        data = self.defaults_input(office, project)
        for_cable: ForCable | None = None
        if circuit_id is not None:
            circuit, building = self._circuit_of_project(circuit_id, context.project_id)
            endpoints = self.endpoints_in_building(
                building, [d for d in (start_device_id, end_device_id) if d is not None]
            )
            unknown = [
                d for d in (start_device_id, end_device_id) if d is not None and d not in endpoints
            ]
            if unknown:
                raise _invalid(
                    "Ein Geraet gehoert nicht zum Gebaeude dieses Stromkreises.",
                    "end_device_id",
                    "cable-endpoint-not-in-building",
                    "Geraet nicht in diesem Gebaeude.",
                    *unknown,
                )
            start = None if start_device_id is None else endpoints[start_device_id]
            end = None if end_device_id is None else endpoints[end_device_id]
            for_cable = ForCable(
                circuit=circuit,
                start_device_id=start_device_id,
                end_device_id=end_device_id,
                spec=resolve_spec(data, circuit_proposal(circuit), start, end),
                reserve=resolve_reserve(data),
                allowances=resolve_allowances(data, start, end),
            )
        used = self._templates_in_use(list(data.templates))
        return EffectiveView(
            context=context,
            office=office,
            project=project,
            data=data,
            templates=tuple(
                TemplateView(row, row.id in used) for row in self._template_rows(data.templates)
            ),
            for_cable=for_cable,
        )

    # --------------------------------------------- Hilfen fuer den Leitungsdienst

    def locked_input(
        self, project_id: uuid.UUID
    ) -> tuple[DefaultsView, DefaultsView, DefaultsInput]:
        """Vorgaben zum Pruefen beim Speichern einer Leitung.

        Der Aufrufer haelt die Projektsperre bereits (``writable_building_context``);
        hier folgt die geteilte Vorgabensperre.
        """
        lock_defaults(self.session, self.organization_id, exclusive=False)
        office = self.office()
        project = self._project_view(project_id)
        return office, project, self.defaults_input(office, project)

    def defaults_input(self, office: DefaultsView, project: DefaultsView) -> DefaultsInput:
        rows = self.session.execute(
            select(ElectricalCableTemplate).where(
                ElectricalCableTemplate.organization_id == self.organization_id
            )
        ).scalars()
        return DefaultsInput(
            office=office.level(),
            project=project.level(),
            templates={row.id: template_spec(row) for row in rows},
        )

    def endpoints_in_building(
        self, building: BuildingPlanningContext, device_ids: Sequence[uuid.UUID]
    ) -> dict[uuid.UUID, Endpoint]:
        if not device_ids:
            return {}
        floor_ids = [floor.floor_id for floor in building.floors]
        if not floor_ids:
            return {}
        rows = self.session.execute(
            select(
                ElectricalDevice.id, ElectricalDevice.device_type_key, ElectricalDeviceType.category
            )
            .join(
                ElectricalRoom,
                (ElectricalRoom.organization_id == ElectricalDevice.organization_id)
                & (ElectricalRoom.id == ElectricalDevice.room_id),
            )
            .join(
                ElectricalDeviceType, ElectricalDeviceType.key == ElectricalDevice.device_type_key
            )
            .where(
                ElectricalDevice.organization_id == self.organization_id,
                ElectricalDevice.id.in_(list(device_ids)),
                ElectricalRoom.floor_id.in_(floor_ids),
            )
        ).all()
        return {row[0]: Endpoint(row[0], row[1], row[2]) for row in rows}

    # ---------------------------------------------------------------- intern

    def _circuit_of_project(
        self, circuit_id: uuid.UUID, project_id: uuid.UUID
    ) -> tuple[ElectricalCircuit, BuildingPlanningContext]:
        missing = NotFoundError("Stromkreis wurde nicht gefunden.")
        circuit = self.session.execute(
            select(ElectricalCircuit).where(
                ElectricalCircuit.organization_id == self.organization_id,
                ElectricalCircuit.id == circuit_id,
            )
        ).scalar_one_or_none()
        if circuit is None:
            raise missing
        board = self.session.execute(
            select(ElectricalDistributionBoard).where(
                ElectricalDistributionBoard.organization_id == self.organization_id,
                ElectricalDistributionBoard.id == circuit.board_id,
            )
        ).scalar_one()
        building = self.structure.building_context(board.building_id)
        if building.project_id != project_id:
            # Anderes Projekt: dieselbe Antwort wie unbekannt.
            raise missing
        return circuit, building

    def _project_view(self, project_id: uuid.UUID) -> DefaultsView:
        row = self.session.execute(
            select(ElectricalProjectPlanningDefaults).where(
                ElectricalProjectPlanningDefaults.organization_id == self.organization_id,
                ElectricalProjectPlanningDefaults.project_id == project_id,
            )
        ).scalar_one_or_none()
        return DefaultsView(row, self._project_type_templates(None if row is None else row.id))

    def _office_type_templates(self) -> tuple[tuple[str, uuid.UUID], ...]:
        rows = self.session.execute(
            select(
                ElectricalDeviceTypeCableTemplate.device_type_key,
                ElectricalDeviceTypeCableTemplate.cable_template_id,
            )
            .where(ElectricalDeviceTypeCableTemplate.organization_id == self.organization_id)
            .order_by(ElectricalDeviceTypeCableTemplate.device_type_key)
        ).all()
        return tuple((row[0], row[1]) for row in rows)

    def _project_type_templates(
        self, defaults_id: uuid.UUID | None
    ) -> tuple[tuple[str, uuid.UUID], ...]:
        if defaults_id is None:
            return ()
        rows = self.session.execute(
            select(
                ElectricalProjectDeviceTypeCableTemplate.device_type_key,
                ElectricalProjectDeviceTypeCableTemplate.cable_template_id,
            )
            .where(
                ElectricalProjectDeviceTypeCableTemplate.organization_id == self.organization_id,
                ElectricalProjectDeviceTypeCableTemplate.project_defaults_id == defaults_id,
            )
            .order_by(ElectricalProjectDeviceTypeCableTemplate.device_type_key)
        ).all()
        return tuple((row[0], row[1]) for row in rows)

    def _template_rows(
        self, templates: Mapping[uuid.UUID, TemplateSpec]
    ) -> list[ElectricalCableTemplate]:
        if not templates:
            return []
        return list(
            self.session.execute(
                select(ElectricalCableTemplate)
                .where(
                    ElectricalCableTemplate.organization_id == self.organization_id,
                    ElectricalCableTemplate.id.in_(list(templates)),
                )
                .order_by(ElectricalCableTemplate.sort_order, ElectricalCableTemplate.name)
            ).scalars()
        )

    def _templates_in_use(self, template_ids: Iterable[uuid.UUID]) -> set[uuid.UUID]:
        ids = list(template_ids)
        if not ids:
            return set()
        org = self.organization_id
        uses = union_all(
            select(ElectricalCable.cable_template_id.label("tid")).where(
                ElectricalCable.organization_id == org, ElectricalCable.cable_template_id.in_(ids)
            ),
            select(ElectricalPlanningDefaults.default_cable_template_id).where(
                ElectricalPlanningDefaults.organization_id == org,
                ElectricalPlanningDefaults.default_cable_template_id.in_(ids),
            ),
            select(ElectricalProjectPlanningDefaults.default_cable_template_id).where(
                ElectricalProjectPlanningDefaults.organization_id == org,
                ElectricalProjectPlanningDefaults.default_cable_template_id.in_(ids),
            ),
            select(ElectricalDeviceTypeCableTemplate.cable_template_id).where(
                ElectricalDeviceTypeCableTemplate.organization_id == org,
                ElectricalDeviceTypeCableTemplate.cable_template_id.in_(ids),
            ),
            select(ElectricalProjectDeviceTypeCableTemplate.cable_template_id).where(
                ElectricalProjectDeviceTypeCableTemplate.organization_id == org,
                ElectricalProjectDeviceTypeCableTemplate.cable_template_id.in_(ids),
            ),
        ).subquery()
        return {row[0] for row in self.session.execute(select(uses.c.tid).distinct()).all()}

    def _locked_template(
        self, template_id: uuid.UUID, expected_version: int
    ) -> ElectricalCableTemplate:
        self.templates.get_or_404(template_id)
        row = self.session.execute(
            select(ElectricalCableTemplate)
            .where(
                ElectricalCableTemplate.organization_id == self.organization_id,
                ElectricalCableTemplate.id == template_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if row is None:
            raise VersionConflictError(CONCURRENT_UPDATE_DETAIL)
        check_version(row, expected_version)
        return row

    def _flush_template(self) -> None:
        with unique_violation_translated(
            self.session,
            constraint=CABLE_TEMPLATE_NAME_CONSTRAINT,
            error=_invalid(
                "Eine Kabelvorlage mit diesem Namen gibt es bereits.",
                "name",
                "cable-template-name-taken",
                "Name bereits vergeben.",
            ),
        ):
            flush(self.session)

    @staticmethod
    def _require_expected(
        row: ElectricalPlanningDefaults | ElectricalProjectPlanningDefaults | None,
        expected_version: int,
    ) -> None:
        current = 0 if row is None else row.version
        if current != expected_version:
            raise VersionConflictError(
                f"Die Vorgaben wurden zwischenzeitlich geaendert (erwartet: {expected_version}, "
                f"aktuell: {current}). Bitte neu laden und die Aenderung wiederholen."
            )

    def _require_templates(
        self,
        payload: PlanningDefaultsIn | ProjectPlanningDefaultsIn,
        stored: Mapping[str, uuid.UUID],
    ) -> None:
        """Vorlagen gehoeren dem Betrieb; Geraetetypen sind bekannt und zuordenbar.

        Eine **inaktive** Vorlage laesst sich nicht neu waehlen; eine bereits gespeicherte
        Zuweisung darf bestehen bleiben (sonst liesse sich nach dem Deaktivieren kein
        anderes Feld mehr speichern). Sie wird ohnehin nie vorgeschlagen.
        """
        keys = [item.device_type_key for item in payload.device_type_templates]
        doubled = sorted({key for key in keys if keys.count(key) > 1})
        if doubled:
            raise _invalid(
                "Ein Geraetetyp ist doppelt angegeben.",
                "device_type_templates",
                "device-type-duplicate",
                "Geraetetyp doppelt.",
                *doubled,
            )
        categories: dict[str, str] = {
            row[0]: row[1]
            for row in self.session.execute(
                select(ElectricalDeviceType.key, ElectricalDeviceType.category).where(
                    ElectricalDeviceType.key.in_(keys or [""])
                )
            ).all()
        }
        unknown = [key for key in keys if key not in categories]
        if unknown:
            raise _invalid(
                "Ein Geraetetyp ist nicht bekannt.",
                "device_type_templates",
                "device-type-unknown",
                "Geraetetyp unbekannt.",
                *unknown,
            )
        not_assignable = [key for key in keys if categories[key] not in ASSIGNABLE_CATEGORIES]
        if not_assignable:
            raise _invalid(
                "Kabelvorlagen gibt es nur fuer Geraetetypen mit Leitungsanschluss an einem "
                "Stromkreis (Steckdose, Schalter, Leuchte, Abzweigdose) - nie fuer die Verteilung "
                "oder Datendosen.",
                "device_type_templates",
                "device-type-not-assignable",
                "Geraetetyp ohne Kabelvorlage.",
                *not_assignable,
            )
        wanted: list[tuple[str, uuid.UUID]] = [
            (item.device_type_key, item.cable_template_id) for item in payload.device_type_templates
        ]
        ids = {template_id for _, template_id in wanted}
        if payload.default_cable_template_id is not None:
            ids.add(payload.default_cable_template_id)
        rows = {
            row.id: row
            for row in self.session.execute(
                select(ElectricalCableTemplate).where(
                    ElectricalCableTemplate.organization_id == self.organization_id,
                    ElectricalCableTemplate.id.in_(list(ids) or [uuid.uuid4()]),
                )
            ).scalars()
        }
        missing = sorted(str(i) for i in ids if i not in rows)
        if missing:
            # Fremder Betrieb und unbekannte ID: dieselbe Antwort.
            raise _invalid(
                "Eine Kabelvorlage gehoert nicht zu diesem Betrieb.",
                "device_type_templates",
                "cable-template-unknown",
                "Kabelvorlage unbekannt.",
                *missing,
            )
        inactive = sorted(
            str(template_id)
            for key, template_id in wanted
            if not rows[template_id].is_active and stored.get(key) != template_id
        )
        default = payload.default_cable_template_id
        if (
            default is not None
            and not rows[default].is_active
            and not self._is_stored_default(default)
        ):
            inactive.append(str(default))
        if inactive:
            raise _invalid(
                "Eine inaktive Kabelvorlage laesst sich nicht neu als Vorgabe waehlen.",
                "device_type_templates",
                "cable-template-inactive",
                "Kabelvorlage ist deaktiviert.",
                *inactive,
            )

    def _is_stored_default(self, template_id: uuid.UUID) -> bool:
        return bool(
            self.session.execute(
                select(
                    exists().where(
                        ElectricalPlanningDefaults.organization_id == self.organization_id,
                        ElectricalPlanningDefaults.default_cable_template_id == template_id,
                    )
                    | exists().where(
                        ElectricalProjectPlanningDefaults.organization_id == self.organization_id,
                        ElectricalProjectPlanningDefaults.default_cable_template_id == template_id,
                    )
                )
            ).scalar_one()
        )

    @staticmethod
    def _apply_fields(
        row: ElectricalPlanningDefaults | ElectricalProjectPlanningDefaults,
        payload: PlanningDefaultsIn | ProjectPlanningDefaultsIn,
    ) -> bool:
        values = {
            "reserve_percent": _decimal(payload.reserve_percent),
            "board_allowance_mm": payload.board_allowance_mm,
            "junction_allowance_mm": payload.junction_allowance_mm,
            "device_allowance_mm": payload.device_allowance_mm,
            "default_cable_template_id": payload.default_cable_template_id,
        }
        changed = any(getattr(row, key) != value for key, value in values.items())
        for key, value in values.items():
            setattr(row, key, value)
        return changed


def circuit_proposal(circuit: ElectricalCircuit) -> CircuitProposal:
    return CircuitProposal(
        circuit_id=circuit.id,
        version=circuit.version,
        overrides_templates=circuit.proposal_overrides_templates,
        cable_type=circuit.proposed_cable_type,
        conductor_count=circuit.proposed_conductor_count,
        cross_section_mm2=circuit.proposed_cross_section_mm2,
    )


__all__ = [
    "DefaultsView",
    "DefaultsWriteResult",
    "EffectiveView",
    "ForCable",
    "PlanningDefaultsChangedError",
    "PlanningDefaultsService",
    "TemplateView",
    "circuit_proposal",
    "defaults_lock_key",
    "lock_defaults",
    "percent_out",
    "template_spec",
]
