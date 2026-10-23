"""Kabelvorlagen, Planungsvorgaben, Prozentreserve und offene Leitungen

Phase 6c, Schritt V1 (ADR 0027, Entwurf 6c §8, §10.3, §18.6).

* ``electrical_cable_templates`` - technische Kabelvorlage je Betrieb (Name, Typ,
  Leiterzahl, Querschnitt, aktiv, Sortierung), **ohne Preis**, versioniert.
* ``electrical_planning_defaults`` - Betriebsstandard (hoechstens eine Zeile je Betrieb):
  Reserve %, Anschlusszugaben je Endpunktart, Standardvorlage; ``NULL`` = nicht gesetzt.
* ``electrical_type_templates`` - Vorlage je Geraetetyp (Betrieb).
* ``electrical_project_defaults`` - Projektvorgabe (hoechstens eine je Projekt),
  feldweise ``NULL`` = Betriebsstandard uebernehmen; Projekt ``RESTRICT``.
* ``electrical_proj_type_templates`` - abweichende Vorlage je
  Geraetetyp einer Projektvorgabe (``CASCADE`` mit ihr).
* ``electrical_circuits.proposal_overrides_templates`` - **fuer alle vorhandenen
  Stromkreise ``false``**: vorhandene Stromkreiswerte gelten nie automatisch als
  aktivierter Vorrang (F1).
* ``electrical_cables``: ``end_device_id`` darf fehlen (offene Planung);
  ``reserve_mode`` (Bestand ``fixed``), ``reserve_percent`` (``NULL``),
  ``spec_origin``/``reserve_origin``/``allowance_origin`` (Bestand ``legacy``),
  ``cable_template_id`` (``RESTRICT``) und die Versionen der genutzten Vorgaben.

**Bestand bleibt unveraendert:** keine tatsaechliche Angabe, keine Reserve, keine Zugabe
wird geaendert oder umgerechnet - jede Bestandsleitung ist danach gleich lang.

Das neue Recht ``electrical.defaults.manage`` legt der Seed an (Standard: nur der
Administrator).

**Downgrade** entfernt Tabellen und Spalten. Gibt es Vorlagen, Vorgaben, Leitungen ohne
Endgeraet, Prozentreserven oder Herkuenfte ausser ``legacy``, bricht es ab, statt Daten
still zu verwerfen.

Revision ID: 0014_planning_defaults
Revises: 0013_cables_and_penetrations
Create Date: 2026-10-23
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "0014_planning_defaults"
down_revision: str | None = "0013_cables_and_penetrations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Festgeschrieben zum Zeitpunkt dieser Migration (keine Abhaengigkeit vom Modellcode).
_ORIGINS = (
    "'legacy', 'manual', 'circuit_override', 'device_type_template', 'default_template', "
    "'project_default', 'office_default', 'none'"
)
_MAX_ALLOWANCE_MM = 20_000
_RESERVE_CHECK = "reserve_percent IS NULL OR reserve_percent BETWEEN 0 AND 100"
_ALLOWANCE_CHECK = " AND ".join(
    f"({column} IS NULL OR {column} BETWEEN 0 AND {_MAX_ALLOWANCE_MM})"
    for column in ("board_allowance_mm", "junction_allowance_mm", "device_allowance_mm")
)


def _timestamps() -> list[sa.Column[Any]]:
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    ]


def _identity() -> list[sa.Column[Any]]:
    return [
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
    ]


def _org_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["organization_id"],
        ["organizations.id"],
        name=op.f(f"fk_{table}_organization_id_organizations"),
        ondelete="RESTRICT",
    )


def _template_fk(name: str, column: str = "cable_template_id") -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["organization_id", column],
        ["electrical_cable_templates.organization_id", "electrical_cable_templates.id"],
        name=name,
        ondelete="RESTRICT",
    )


def _defaults_columns() -> list[sa.Column[Any]]:
    return [
        sa.Column("reserve_percent", sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column("board_allowance_mm", sa.Integer(), nullable=True),
        sa.Column("junction_allowance_mm", sa.Integer(), nullable=True),
        sa.Column("device_allowance_mm", sa.Integer(), nullable=True),
        sa.Column("default_cable_template_id", sa.Uuid(), nullable=True),
    ]


def upgrade() -> None:
    # -------------------------------------------------------------- Kabelvorlagen
    op.create_table(
        "electrical_cable_templates",
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("cable_type", sa.String(length=40), nullable=False),
        sa.Column("conductor_count", sa.SmallInteger(), nullable=False),
        sa.Column("cross_section_mm2", sa.Numeric(precision=6, scale=2), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        *_identity(),
        *_timestamps(),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.CheckConstraint(
            "conductor_count BETWEEN 1 AND 100",
            name=op.f("ck_electrical_cable_templates_conductor_count_plausible"),
        ),
        sa.CheckConstraint(
            "cross_section_mm2 > 0",
            name=op.f("ck_electrical_cable_templates_cross_section_positive"),
        ),
        sa.CheckConstraint(
            "btrim(name) <> '' AND btrim(cable_type) <> ''",
            name=op.f("ck_electrical_cable_templates_text_present"),
        ),
        _org_fk("electrical_cable_templates"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_electrical_cable_templates")),
        sa.UniqueConstraint("organization_id", "name", name="uq_el_cable_templates_name"),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_electrical_cable_templates_organization_id_id")
        ),
    )
    op.create_index(
        op.f("ix_electrical_cable_templates_organization_id"),
        "electrical_cable_templates",
        ["organization_id"],
    )

    # ---------------------------------------------------------- Betriebsstandard
    op.create_table(
        "electrical_planning_defaults",
        *_defaults_columns(),
        *_identity(),
        *_timestamps(),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.CheckConstraint(
            _RESERVE_CHECK, name=op.f("ck_electrical_planning_defaults_reserve_percent_plausible")
        ),
        sa.CheckConstraint(
            _ALLOWANCE_CHECK, name=op.f("ck_electrical_planning_defaults_allowances_plausible")
        ),
        _template_fk("fk_el_planning_defaults_template", "default_cable_template_id"),
        _org_fk("electrical_planning_defaults"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_electrical_planning_defaults")),
        sa.UniqueConstraint("organization_id", name="uq_el_planning_defaults_org"),
        sa.UniqueConstraint(
            "organization_id",
            "id",
            name=op.f("uq_electrical_planning_defaults_organization_id_id"),
        ),
    )
    op.create_index(
        op.f("ix_electrical_planning_defaults_organization_id"),
        "electrical_planning_defaults",
        ["organization_id"],
    )
    op.create_table(
        "electrical_type_templates",
        sa.Column("device_type_key", sa.String(length=40), nullable=False),
        sa.Column("cable_template_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["device_type_key"],
            ["electrical_device_types.key"],
            name="fk_el_type_templates_device_type",
            ondelete="RESTRICT",
        ),
        _template_fk("fk_el_type_templates_template"),
        _org_fk("electrical_type_templates"),
        sa.PrimaryKeyConstraint("organization_id", "device_type_key", name="pk_el_type_templates"),
    )
    op.create_index(
        op.f("ix_electrical_type_templates_organization_id"),
        "electrical_type_templates",
        ["organization_id"],
    )
    op.create_index(
        "ix_el_type_templates_template",
        "electrical_type_templates",
        ["organization_id", "cable_template_id"],
    )

    # ----------------------------------------------------------- Projektvorgabe
    op.create_table(
        "electrical_project_defaults",
        sa.Column("project_id", sa.Uuid(), nullable=False),
        *_defaults_columns(),
        *_identity(),
        *_timestamps(),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.CheckConstraint(
            _RESERVE_CHECK,
            name=op.f("ck_electrical_project_defaults_reserve_percent_plausible"),
        ),
        sa.CheckConstraint(
            _ALLOWANCE_CHECK,
            name=op.f("ck_electrical_project_defaults_allowances_plausible"),
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "project_id"],
            ["projects.organization_id", "projects.id"],
            name="fk_el_project_defaults_project",
            ondelete="RESTRICT",
        ),
        _template_fk("fk_el_project_defaults_template", "default_cable_template_id"),
        _org_fk("electrical_project_defaults"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_electrical_project_defaults")),
        sa.UniqueConstraint("organization_id", "project_id", name="uq_el_project_defaults_project"),
        sa.UniqueConstraint(
            "organization_id",
            "id",
            name=op.f("uq_electrical_project_defaults_organization_id_id"),
        ),
    )
    op.create_index(
        op.f("ix_electrical_project_defaults_organization_id"),
        "electrical_project_defaults",
        ["organization_id"],
    )
    op.create_table(
        "electrical_proj_type_templates",
        sa.Column("project_defaults_id", sa.Uuid(), nullable=False),
        sa.Column("device_type_key", sa.String(length=40), nullable=False),
        sa.Column("cable_template_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["organization_id", "project_defaults_id"],
            [
                "electrical_project_defaults.organization_id",
                "electrical_project_defaults.id",
            ],
            name="fk_el_proj_type_templates_defaults",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["device_type_key"],
            ["electrical_device_types.key"],
            name="fk_el_proj_type_templates_device_type",
            ondelete="RESTRICT",
        ),
        _template_fk("fk_el_proj_type_templates_template"),
        _org_fk("electrical_proj_type_templates"),
        sa.PrimaryKeyConstraint(
            "organization_id",
            "project_defaults_id",
            "device_type_key",
            name="pk_el_proj_type_templates",
        ),
    )
    op.create_index(
        op.f("ix_electrical_proj_type_templates_organization_id"),
        "electrical_proj_type_templates",
        ["organization_id"],
    )
    op.create_index(
        "ix_el_proj_type_templates_template",
        "electrical_proj_type_templates",
        ["organization_id", "cable_template_id"],
    )

    # ------------------------------------------------------- Stromkreis: Vorrang
    # Fuer alle vorhandenen Stromkreise false (server_default) - nie automatisch aktiviert.
    op.add_column(
        "electrical_circuits",
        sa.Column(
            "proposal_overrides_templates",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )

    # ------------------------------------------------------------------ Leitungen
    op.alter_column("electrical_cables", "end_device_id", existing_type=sa.Uuid(), nullable=True)
    # Ausdruecklich auch bei fehlendem Endgeraet: verschieden, wenn beide gesetzt sind.
    op.drop_constraint(
        op.f("ck_electrical_cables_endpoints_differ"), "electrical_cables", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_electrical_cables_endpoints_differ"),
        "electrical_cables",
        "start_device_id IS NULL OR end_device_id IS NULL OR start_device_id <> end_device_id",
    )
    op.add_column(
        "electrical_cables",
        sa.Column(
            "reserve_mode", sa.String(length=8), server_default=sa.text("'fixed'"), nullable=False
        ),
    )
    op.add_column(
        "electrical_cables",
        sa.Column("reserve_percent", sa.Numeric(precision=5, scale=2), nullable=True),
    )
    for column in ("spec_origin", "reserve_origin", "allowance_origin"):
        op.add_column(
            "electrical_cables",
            sa.Column(
                column, sa.String(length=24), server_default=sa.text("'legacy'"), nullable=False
            ),
        )
    op.add_column("electrical_cables", sa.Column("cable_template_id", sa.Uuid(), nullable=True))
    for column in ("cable_template_version", "defaults_office_version", "defaults_project_version"):
        op.add_column("electrical_cables", sa.Column(column, sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_electrical_cables_cable_template",
        "electrical_cables",
        "electrical_cable_templates",
        ["organization_id", "cable_template_id"],
        ["organization_id", "id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_electrical_cables_organization_id_cable_template_id",
        "electrical_cables",
        ["organization_id", "cable_template_id"],
    )
    op.create_check_constraint(
        op.f("ck_electrical_cables_reserve_mode_known"),
        "electrical_cables",
        "reserve_mode IN ('fixed', 'percent')",
    )
    op.create_check_constraint(
        op.f("ck_electrical_cables_reserve_matches_mode"),
        "electrical_cables",
        "(reserve_mode = 'fixed' AND reserve_percent IS NULL) OR "
        "(reserve_mode = 'percent' AND reserve_percent IS NOT NULL AND reserve_mm = 0 "
        "AND reserve_percent BETWEEN 0 AND 100)",
    )
    op.create_check_constraint(
        op.f("ck_electrical_cables_origins_known"),
        "electrical_cables",
        f"spec_origin IN ({_ORIGINS}) AND reserve_origin IN ({_ORIGINS}) "
        f"AND allowance_origin IN ({_ORIGINS})",
    )


def downgrade() -> None:
    bind = op.get_bind()
    blockers = {
        "Kabelvorlage(n)": "SELECT count(*) FROM electrical_cable_templates",
        "Betriebsstandard(s)": "SELECT count(*) FROM electrical_planning_defaults",
        "Projektvorgabe(n)": "SELECT count(*) FROM electrical_project_defaults",
        "Leitung(en) ohne Endgeraet": (
            "SELECT count(*) FROM electrical_cables WHERE end_device_id IS NULL"
        ),
        "Leitung(en) mit Prozentreserve oder neuer Herkunft": (
            "SELECT count(*) FROM electrical_cables WHERE reserve_mode <> 'fixed' "
            "OR spec_origin <> 'legacy' OR reserve_origin <> 'legacy' "
            "OR allowance_origin <> 'legacy'"
        ),
        "aktivierte Stromkreisvorgabe(n)": (
            "SELECT count(*) FROM electrical_circuits WHERE proposal_overrides_templates"
        ),
    }
    found = {
        label: count
        for label, sql in blockers.items()
        if (count := bind.execute(sa.text(sql)).scalar_one())
    }
    if found:
        listing = ", ".join(f"{count} {label}" for label, count in found.items())
        msg = (
            f"Downgrade abgebrochen: {listing} vorhanden. Sie werden nicht still verworfen - "
            "bitte zuerst entfernen bzw. zuruecksetzen."
        )
        raise RuntimeError(msg)

    for name in ("origins_known", "reserve_matches_mode", "reserve_mode_known"):
        op.drop_constraint(op.f(f"ck_electrical_cables_{name}"), "electrical_cables", type_="check")
    op.drop_index(
        "ix_electrical_cables_organization_id_cable_template_id", table_name="electrical_cables"
    )
    op.drop_constraint(
        "fk_electrical_cables_cable_template", "electrical_cables", type_="foreignkey"
    )
    for column in (
        "defaults_project_version",
        "defaults_office_version",
        "cable_template_version",
        "cable_template_id",
        "allowance_origin",
        "reserve_origin",
        "spec_origin",
        "reserve_percent",
        "reserve_mode",
    ):
        op.drop_column("electrical_cables", column)
    op.drop_constraint(
        op.f("ck_electrical_cables_endpoints_differ"), "electrical_cables", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_electrical_cables_endpoints_differ"),
        "electrical_cables",
        "start_device_id IS NULL OR start_device_id <> end_device_id",
    )
    op.alter_column("electrical_cables", "end_device_id", existing_type=sa.Uuid(), nullable=False)
    op.drop_column("electrical_circuits", "proposal_overrides_templates")

    op.drop_index(
        "ix_el_proj_type_templates_template",
        table_name="electrical_proj_type_templates",
    )
    op.drop_index(
        op.f("ix_electrical_proj_type_templates_organization_id"),
        table_name="electrical_proj_type_templates",
    )
    op.drop_table("electrical_proj_type_templates")
    op.drop_index(
        op.f("ix_electrical_project_defaults_organization_id"),
        table_name="electrical_project_defaults",
    )
    op.drop_table("electrical_project_defaults")
    op.drop_index("ix_el_type_templates_template", table_name="electrical_type_templates")
    op.drop_index(
        op.f("ix_electrical_type_templates_organization_id"),
        table_name="electrical_type_templates",
    )
    op.drop_table("electrical_type_templates")
    op.drop_index(
        op.f("ix_electrical_planning_defaults_organization_id"),
        table_name="electrical_planning_defaults",
    )
    op.drop_table("electrical_planning_defaults")
    op.drop_index(
        op.f("ix_electrical_cable_templates_organization_id"),
        table_name="electrical_cable_templates",
    )
    op.drop_table("electrical_cable_templates")
