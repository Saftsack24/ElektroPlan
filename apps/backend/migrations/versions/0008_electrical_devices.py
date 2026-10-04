"""Electrical Devices: Raumtyp, Geraetekatalog, Geraete

Phase 5 (ADR 0023).

* ``electrical_rooms.room_type`` - optionaler Raumtyp (T7), CHECK ueber die
  festen Schluessel. Bestehende Raeume bleiben ``NULL``; es wird nichts
  klassifiziert.

* ``electrical_device_types`` - **globaler** Systemkatalog ohne
  ``organization_id``. Der stabile technische Schluessel ist der
  Primaerschluessel. Befuellt und gepflegt wird er ausschliesslich vom
  idempotenten Seed (``python -m app.cli seed``) - Seeds sind keine Migrationen
  (docs/database.md, Abschnitt 8). Planungsmasse sind gerade Millimeter.

* ``electrical_devices`` - mandantenbezogen, zusammengesetzte Fremdschluessel
  ``(organization_id, room_id)`` (``CASCADE``) und
  ``(organization_id, wall_id)`` (``CASCADE``; eine einzelne Wand mit
  Geraeten laesst der Service nicht loeschen), Geraetetyp ``RESTRICT``. Ein
  CHECK erzwingt je Montageflaeche genau eine Lageform: Wand mit
  ``wall_id``/``center_offset_mm``/``center_height_mm``, Decke mit
  ``x_mm``/``y_mm`` und **ohne** Hoehe (sie ist die effektive Raumhoehe).
  Keine Versionsspalte: Geraete werden mit dem Raumentwurf gespeichert und von
  der Raumversion geschuetzt.

Keine Datenmigration: Es gibt noch keine Geraete. Nach dem Upgrade den Seed
ausfuehren, sonst ist der Katalog leer und es lassen sich keine Geraete setzen.

Revision ID: 0008_electrical_devices
Revises: 0007_user_lifecycle_preferences
Create Date: 2026-10-03
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_electrical_devices"
down_revision: str | None = "0007_user_lifecycle_preferences"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ROOM_TYPES = (
    "'living_room', 'bedroom', 'children_room', 'kitchen', 'bathroom', 'hallway', 'office', "
    "'utility_room', 'technical_room', 'basement', 'garage', 'other'"
)


def upgrade() -> None:
    op.add_column("electrical_rooms", sa.Column("room_type", sa.String(length=30), nullable=True))
    op.create_check_constraint(
        op.f("ck_electrical_rooms_room_type_known"),
        "electrical_rooms",
        f"room_type IS NULL OR room_type IN ({_ROOM_TYPES})",
    )

    op.create_table(
        "electrical_device_types",
        sa.Column("key", sa.String(length=40), nullable=False),
        sa.Column("label", sa.String(length=80), nullable=False),
        sa.Column("category", sa.String(length=16), nullable=False),
        sa.Column("symbol_key", sa.String(length=40), nullable=False),
        sa.Column("allows_wall_interior", sa.Boolean(), nullable=False),
        sa.Column("allows_wall_exterior", sa.Boolean(), nullable=False),
        sa.Column("allows_ceiling", sa.Boolean(), nullable=False),
        sa.Column("default_center_height_mm", sa.Integer(), nullable=True),
        sa.Column("width_mm", sa.Integer(), nullable=False),
        sa.Column("height_mm", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.CheckConstraint(
            "category IN ('socket', 'switch', 'light', 'data')",
            name=op.f("ck_electrical_device_types_category_known"),
        ),
        sa.CheckConstraint(
            "allows_wall_interior OR allows_wall_exterior OR allows_ceiling",
            name=op.f("ck_electrical_device_types_has_surface"),
        ),
        sa.CheckConstraint(
            "width_mm BETWEEN 20 AND 1000 AND height_mm BETWEEN 20 AND 1000 "
            "AND width_mm % 2 = 0 AND height_mm % 2 = 0",
            name=op.f("ck_electrical_device_types_size_plausible"),
        ),
        sa.CheckConstraint(
            "default_center_height_mm IS NULL OR default_center_height_mm BETWEEN 0 AND 6000",
            name=op.f("ck_electrical_device_types_default_height_plausible"),
        ),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_electrical_device_types")),
    )

    op.create_table(
        "electrical_devices",
        sa.Column("room_id", sa.Uuid(), nullable=False),
        sa.Column("device_type_key", sa.String(length=40), nullable=False),
        sa.Column("mounting_surface", sa.String(length=16), nullable=False),
        sa.Column("wall_id", sa.Uuid(), nullable=True),
        sa.Column("center_offset_mm", sa.Integer(), nullable=True),
        sa.Column("center_height_mm", sa.Integer(), nullable=True),
        sa.Column("x_mm", sa.Integer(), nullable=True),
        sa.Column("y_mm", sa.Integer(), nullable=True),
        sa.Column("label", sa.String(length=60), nullable=True),
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
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
        sa.CheckConstraint(
            "mounting_surface IN ('wall_interior', 'wall_exterior', 'ceiling')",
            name=op.f("ck_electrical_devices_surface_known"),
        ),
        sa.CheckConstraint(
            "(mounting_surface = 'ceiling' AND wall_id IS NULL AND center_offset_mm IS NULL "
            "AND center_height_mm IS NULL AND x_mm IS NOT NULL AND y_mm IS NOT NULL) OR "
            "(mounting_surface <> 'ceiling' AND wall_id IS NOT NULL "
            "AND center_offset_mm IS NOT NULL AND center_height_mm IS NOT NULL "
            "AND x_mm IS NULL AND y_mm IS NULL)",
            name=op.f("ck_electrical_devices_position_matches_surface"),
        ),
        sa.CheckConstraint(
            "(x_mm IS NULL OR x_mm BETWEEN -1000000 AND 1000000) AND "
            "(y_mm IS NULL OR y_mm BETWEEN -1000000 AND 1000000)",
            name=op.f("ck_electrical_devices_coordinates_in_range"),
        ),
        sa.CheckConstraint(
            "(center_offset_mm IS NULL OR center_offset_mm BETWEEN 0 AND 1000000) "
            "AND (center_height_mm IS NULL OR center_height_mm BETWEEN 0 AND 6000)",
            name=op.f("ck_electrical_devices_wall_position_plausible"),
        ),
        sa.ForeignKeyConstraint(
            ["device_type_key"],
            ["electrical_device_types.key"],
            name=op.f("fk_electrical_devices_device_type_key_electrical_device_types"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "room_id"],
            ["electrical_rooms.organization_id", "electrical_rooms.id"],
            name=op.f("fk_electrical_devices_organization_id_electrical_rooms"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "wall_id"],
            ["electrical_walls.organization_id", "electrical_walls.id"],
            name=op.f("fk_electrical_devices_organization_id_electrical_walls"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_electrical_devices_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_electrical_devices")),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_electrical_devices_organization_id_id")
        ),
    )
    op.create_index(
        op.f("ix_electrical_devices_organization_id"),
        "electrical_devices",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_electrical_devices_organization_id_room_id",
        "electrical_devices",
        ["organization_id", "room_id"],
        unique=False,
    )
    op.create_index(
        "ix_electrical_devices_organization_id_wall_id",
        "electrical_devices",
        ["organization_id", "wall_id"],
        unique=False,
    )
    op.create_index(
        "ix_electrical_devices_device_type_key",
        "electrical_devices",
        ["device_type_key"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_electrical_devices_device_type_key", table_name="electrical_devices")
    op.drop_index("ix_electrical_devices_organization_id_wall_id", table_name="electrical_devices")
    op.drop_index("ix_electrical_devices_organization_id_room_id", table_name="electrical_devices")
    op.drop_index(op.f("ix_electrical_devices_organization_id"), table_name="electrical_devices")
    op.drop_table("electrical_devices")
    op.drop_table("electrical_device_types")
    op.drop_constraint(
        op.f("ck_electrical_rooms_room_type_known"), "electrical_rooms", type_="check"
    )
    op.drop_column("electrical_rooms", "room_type")
