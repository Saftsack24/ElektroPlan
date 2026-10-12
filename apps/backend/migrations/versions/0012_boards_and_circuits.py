"""Verteilungen, Stromkreise und Geraetezuordnung

Phase 6b.0 (ADR 0026).

* ``electrical_distribution_boards`` - Verteilung je Gebaeude (mehrere je
  Gebaeude, ``code`` je Gebaeude eindeutig), versioniert. Die Lage ist ein
  Geraet des Katalogtyps ``distribution_board`` (``placement_device_id``,
  optional, hoechstens eine Verteilung je Geraet). Gebaeude und Lagegeraet
  ``RESTRICT``.
* ``electrical_circuits`` - Stromkreis an einer Verteilung (Bezeichnung je
  Verteilung eindeutig), versioniert. ``proposed_*`` sind Vorschlaege fuer
  kuenftige Leitungen; Querschnitt ``numeric(6,2)``. Verteilung ``RESTRICT``.
* ``electrical_circuit_devices`` - Zuordnung Geraet -> Stromkreis,
  Primaerschluessel ``(organization_id, device_id)``: hoechstens ein
  Stromkreis je Geraet. Geraet und Stromkreis ``CASCADE``.
* ``electrical_device_types.category`` erlaubt zusaetzlich ``distribution``
  und ``junction``. Die neuen Katalogtypen ``distribution_board`` und
  ``junction_box`` legt der idempotente Seed an (``python -m app.cli seed``),
  ebenso die neue Berechtigung ``electrical.circuit.write``.

Tabellenuebergreifende Regeln (Lage im selben Gebaeude und vom Typ
Verteilung, Geraete im selben Gebaeude und zuordenbar) prueft der Service unter
der Projektsperre.

**Keine Datenmigration.**

**Downgrade** entfernt die drei Tabellen (Verteilungen, Stromkreise,
Zuordnungen gehen verloren) und stellt die alte Kategorieliste wieder her. Gibt
es Geraete der neuen Typen, bricht das Downgrade ab, statt sie still zu
loeschen; ungenutzte Typzeilen der neuen Kategorien werden entfernt.

Revision ID: 0012_boards_and_circuits
Revises: 0011_refresh_token_families
Create Date: 2026-10-11
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_boards_and_circuits"
down_revision: str | None = "0011_refresh_token_families"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_CATEGORIES = "category IN ('socket', 'switch', 'light', 'data')"
_NEW_CATEGORIES = "category IN ('socket', 'switch', 'light', 'data', 'distribution', 'junction')"


def _timestamps() -> list[sa.Column[object]]:
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


def upgrade() -> None:
    op.drop_constraint(
        op.f("ck_electrical_device_types_category_known"), "electrical_device_types", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_electrical_device_types_category_known"),
        "electrical_device_types",
        _NEW_CATEGORIES,
    )

    op.create_table(
        "electrical_distribution_boards",
        sa.Column("building_id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("placement_device_id", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.ForeignKeyConstraint(
            ["organization_id", "building_id"],
            ["buildings.organization_id", "buildings.id"],
            name=op.f("fk_electrical_distribution_boards_organization_id_buildings"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "placement_device_id"],
            ["electrical_devices.organization_id", "electrical_devices.id"],
            name="fk_el_boards_placement_device",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_electrical_distribution_boards_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_electrical_distribution_boards")),
        sa.UniqueConstraint(
            "organization_id",
            "id",
            name=op.f("uq_electrical_distribution_boards_organization_id_id"),
        ),
        sa.UniqueConstraint(
            "organization_id", "building_id", "code", name="uq_el_boards_building_code"
        ),
        sa.UniqueConstraint(
            "organization_id", "placement_device_id", name="uq_el_boards_placement_device"
        ),
    )
    op.create_index(
        op.f("ix_electrical_distribution_boards_organization_id"),
        "electrical_distribution_boards",
        ["organization_id"],
        unique=False,
    )

    op.create_table(
        "electrical_circuits",
        sa.Column("board_id", sa.Uuid(), nullable=False),
        sa.Column("designation", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("proposed_cable_type", sa.String(length=40), nullable=True),
        sa.Column("proposed_conductor_count", sa.SmallInteger(), nullable=True),
        sa.Column("proposed_cross_section_mm2", sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column("protective_device", sa.String(length=40), nullable=True),
        sa.Column("rcd_group", sa.String(length=40), nullable=True),
        sa.Column("phase_count", sa.SmallInteger(), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.CheckConstraint(
            "proposed_conductor_count IS NULL OR proposed_conductor_count BETWEEN 1 AND 100",
            name=op.f("ck_electrical_circuits_conductor_count_plausible"),
        ),
        sa.CheckConstraint(
            "proposed_cross_section_mm2 IS NULL OR proposed_cross_section_mm2 > 0",
            name=op.f("ck_electrical_circuits_cross_section_positive"),
        ),
        sa.CheckConstraint(
            "phase_count IS NULL OR phase_count IN (1, 2, 3)",
            name=op.f("ck_electrical_circuits_phase_count_known"),
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "board_id"],
            [
                "electrical_distribution_boards.organization_id",
                "electrical_distribution_boards.id",
            ],
            name="fk_electrical_circuits_board",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_electrical_circuits_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_electrical_circuits")),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_electrical_circuits_organization_id_id")
        ),
        sa.UniqueConstraint(
            "organization_id",
            "board_id",
            "designation",
            name="uq_electrical_circuits_organization_id_board_id_designation",
        ),
    )
    op.create_index(
        op.f("ix_electrical_circuits_organization_id"),
        "electrical_circuits",
        ["organization_id"],
        unique=False,
    )

    op.create_table(
        "electrical_circuit_devices",
        sa.Column("device_id", sa.Uuid(), nullable=False),
        sa.Column("circuit_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["organization_id", "device_id"],
            ["electrical_devices.organization_id", "electrical_devices.id"],
            name="fk_electrical_circuit_devices_device",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "circuit_id"],
            ["electrical_circuits.organization_id", "electrical_circuits.id"],
            name="fk_electrical_circuit_devices_circuit",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_electrical_circuit_devices_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "organization_id", "device_id", name="pk_electrical_circuit_devices"
        ),
    )
    op.create_index(
        op.f("ix_electrical_circuit_devices_organization_id"),
        "electrical_circuit_devices",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_electrical_circuit_devices_organization_id_circuit_id",
        "electrical_circuit_devices",
        ["organization_id", "circuit_id"],
        unique=False,
    )


def downgrade() -> None:
    used = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT count(*) FROM electrical_devices d "
                "JOIN electrical_device_types t ON t.key = d.device_type_key "
                "WHERE t.category IN ('distribution', 'junction')"
            )
        )
        .scalar_one()
    )
    if used:
        msg = (
            f"Downgrade abgebrochen: {used} Geraet(e) nutzen die Typen 'Verteilung' oder "
            "'Abzweigdose'. Sie werden nicht still geloescht - bitte zuerst entfernen."
        )
        raise RuntimeError(msg)
    op.drop_index(
        "ix_electrical_circuit_devices_organization_id_circuit_id",
        table_name="electrical_circuit_devices",
    )
    op.drop_index(
        op.f("ix_electrical_circuit_devices_organization_id"),
        table_name="electrical_circuit_devices",
    )
    op.drop_table("electrical_circuit_devices")
    op.drop_index(op.f("ix_electrical_circuits_organization_id"), table_name="electrical_circuits")
    op.drop_table("electrical_circuits")
    op.drop_index(
        op.f("ix_electrical_distribution_boards_organization_id"),
        table_name="electrical_distribution_boards",
    )
    op.drop_table("electrical_distribution_boards")
    op.execute("DELETE FROM electrical_device_types WHERE category IN ('distribution', 'junction')")
    op.drop_constraint(
        op.f("ck_electrical_device_types_category_known"), "electrical_device_types", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_electrical_device_types_category_known"),
        "electrical_device_types",
        _OLD_CATEGORIES,
    )
