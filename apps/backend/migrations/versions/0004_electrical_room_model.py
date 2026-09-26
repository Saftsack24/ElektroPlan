"""Electrical Room Model: Raeume, Waende, Oeffnungen

Phase 3. Erste Tabellen eines Fachmoduls - Praefix ``electrical_``.

``Geschoss -> Raum -> Wand -> Oeffnung``. Alle drei Tabellen sind
mandantenbezogen: ``organization_id NOT NULL``, ``UNIQUE (organization_id, id)``
und zusammengesetzte Fremdschluessel ``(organization_id, <ref>_id)``
(ADR 0006). Ein mandantenuebergreifender Verweis ist damit auf Datenbankebene
unmoeglich - auch der Verweis auf die Core-Tabelle ``floors``.

Loeschverhalten, bewusst unterschiedlich:

* ``electrical_rooms.floor_id`` mit ``RESTRICT`` - ein Geschoss mit
  Planungsdaten verschwindet nicht unter der Planung weg. Der Core uebersetzt
  den Verweis in einen ``409``.
* ``electrical_walls.room_id`` und ``electrical_openings.wall_id`` mit
  ``CASCADE`` - eine Wand ohne Raum und eine Oeffnung ohne Wand haben keine
  Bedeutung. Eine **einzelne** Wand mit Oeffnungen laesst der Service dennoch
  nicht loeschen; er antwortet mit ``409``.

Check-Constraints sichern die Invarianten, die ohne Kontext pruefbar sind:
nicht entartete Wand, Koordinaten- und Staerkegrenzen, positive
Oeffnungsmasse, bekannte Oeffnungsart, Raumhoehe im plausiblen Bereich. Die
Regeln, die mehrere Zeilen betreffen - Konturschluss, Ueberschneidung,
Ueberlappung von Oeffnungen - liegen im Service: Sie brauchen die ganze
Kontur. **Keine Trigger** (ADR 0013).

``uq_el_walls_room_sort_order`` ist ``DEFERRABLE INITIALLY DEFERRED``: Beim
Umordnen tauscht eine Transaktion mehrere Positionen, und ein Zwischenstand
darf kurzzeitig doppelt sein - das Ergebnis nicht. Der Name ist gekuerzt, weil
PostgreSQL Bezeichner bei 63 Zeichen abschneidet.

``uq_el_rooms_floor_room_number`` ist ein **partieller** eindeutiger Index:
Die Raumnummer ist optional, und beliebig viele Raeume ohne Nummer sind
zulaessig.

Kein PostGIS: Die Geometrie ist geschossbezogen, klein und wird nie
geografisch abgefragt (docs/database.md, Abschnitt 4).

Revision ID: 0004_electrical_room_model
Revises: 0003_core_business_data
Create Date: 2026-09-26
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_electrical_room_model"
down_revision: str | None = "0003_core_business_data"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "electrical_rooms",
        sa.Column("floor_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("room_number", sa.String(length=30), nullable=True),
        sa.Column("height_mm", sa.Integer(), nullable=True),
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
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.CheckConstraint(
            "height_mm IS NULL OR height_mm BETWEEN 1500 AND 6000",
            name=op.f("ck_electrical_rooms_height_plausible"),
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "floor_id"],
            ["floors.organization_id", "floors.id"],
            name=op.f("fk_electrical_rooms_organization_id_floors"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_electrical_rooms_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_electrical_rooms")),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_electrical_rooms_organization_id_id")
        ),
    )
    op.create_index(
        op.f("ix_electrical_rooms_organization_id"),
        "electrical_rooms",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_electrical_rooms_organization_id_floor_id",
        "electrical_rooms",
        ["organization_id", "floor_id"],
        unique=False,
    )
    op.create_index(
        "uq_el_rooms_floor_room_number",
        "electrical_rooms",
        ["organization_id", "floor_id", "room_number"],
        unique=True,
        postgresql_where=sa.text("room_number IS NOT NULL"),
    )
    op.create_table(
        "electrical_walls",
        sa.Column("room_id", sa.Uuid(), nullable=False),
        sa.Column("x1_mm", sa.Integer(), nullable=False),
        sa.Column("y1_mm", sa.Integer(), nullable=False),
        sa.Column("x2_mm", sa.Integer(), nullable=False),
        sa.Column("y2_mm", sa.Integer(), nullable=False),
        sa.Column("thickness_mm", sa.Integer(), server_default=sa.text("115"), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
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
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.CheckConstraint(
            "sort_order >= 0", name=op.f("ck_electrical_walls_sort_order_not_negative")
        ),
        sa.CheckConstraint(
            "thickness_mm BETWEEN 20 AND 1000", name=op.f("ck_electrical_walls_thickness_plausible")
        ),
        sa.CheckConstraint(
            "x1_mm <> x2_mm OR y1_mm <> y2_mm", name=op.f("ck_electrical_walls_not_degenerate")
        ),
        sa.CheckConstraint(
            "x1_mm BETWEEN -1000000 AND 1000000 AND y1_mm BETWEEN -1000000 AND 1000000 AND x2_mm BETWEEN -1000000 AND 1000000 AND y2_mm BETWEEN -1000000 AND 1000000",
            name=op.f("ck_electrical_walls_coordinates_in_range"),
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "room_id"],
            ["electrical_rooms.organization_id", "electrical_rooms.id"],
            name=op.f("fk_electrical_walls_organization_id_electrical_rooms"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_electrical_walls_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_electrical_walls")),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_electrical_walls_organization_id_id")
        ),
        sa.UniqueConstraint(
            "organization_id",
            "room_id",
            "sort_order",
            deferrable=True,
            initially="DEFERRED",
            name="uq_el_walls_room_sort_order",
        ),
    )
    op.create_index(
        op.f("ix_electrical_walls_organization_id"),
        "electrical_walls",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_electrical_walls_organization_id_room_id",
        "electrical_walls",
        ["organization_id", "room_id"],
        unique=False,
    )
    op.create_table(
        "electrical_openings",
        sa.Column("wall_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("offset_mm", sa.Integer(), nullable=False),
        sa.Column("width_mm", sa.Integer(), nullable=False),
        sa.Column("height_mm", sa.Integer(), nullable=False),
        sa.Column("sill_height_mm", sa.Integer(), server_default=sa.text("0"), nullable=False),
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
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.CheckConstraint(
            "kind IN ('door', 'window', 'passage')", name=op.f("ck_electrical_openings_kind_known")
        ),
        sa.CheckConstraint(
            "offset_mm >= 0", name=op.f("ck_electrical_openings_offset_not_negative")
        ),
        sa.CheckConstraint(
            "sill_height_mm >= 0", name=op.f("ck_electrical_openings_sill_not_negative")
        ),
        sa.CheckConstraint(
            "width_mm > 0 AND height_mm > 0",
            name=op.f("ck_electrical_openings_dimensions_positive"),
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "wall_id"],
            ["electrical_walls.organization_id", "electrical_walls.id"],
            name=op.f("fk_electrical_openings_organization_id_electrical_walls"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_electrical_openings_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_electrical_openings")),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_electrical_openings_organization_id_id")
        ),
    )
    op.create_index(
        op.f("ix_electrical_openings_organization_id"),
        "electrical_openings",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_electrical_openings_organization_id_wall_id",
        "electrical_openings",
        ["organization_id", "wall_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_electrical_openings_organization_id_wall_id", table_name="electrical_openings"
    )
    op.drop_index(op.f("ix_electrical_openings_organization_id"), table_name="electrical_openings")
    op.drop_table("electrical_openings")
    op.drop_index("ix_electrical_walls_organization_id_room_id", table_name="electrical_walls")
    op.drop_index(op.f("ix_electrical_walls_organization_id"), table_name="electrical_walls")
    op.drop_table("electrical_walls")
    op.drop_index(
        "uq_el_rooms_floor_room_number",
        table_name="electrical_rooms",
        postgresql_where=sa.text("room_number IS NOT NULL"),
    )
    op.drop_index("ix_electrical_rooms_organization_id_floor_id", table_name="electrical_rooms")
    op.drop_index(op.f("ix_electrical_rooms_organization_id"), table_name="electrical_rooms")
    op.drop_table("electrical_rooms")
