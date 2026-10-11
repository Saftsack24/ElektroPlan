"""Wandkopplungen und Steigweg-Tabellen

Phase 6a (ADR 0024, ADR 0025). Eine Migration fuer beide Tabellengruppen, damit
sie spaeter nicht umgeschrieben werden muss.

* ``electrical_wall_links`` - **in Gebrauch ab 6a.1.** Zwei Raumwaende
  verschiedener Raeume; nur die Entscheidung ``relation`` (``shared`` |
  ``separate``) und die Herkunft ``origin`` (``user`` | ``backfill``), keine
  Geometrie. Kanonisch ``wall_a_id < wall_b_id`` (CHECK), je Paar hoechstens
  einmal (``uq_el_wall_links_pair``). Zusammengesetzte Fremdschluessel auf
  ``electrical_walls`` mit ``CASCADE`` - ausdruecklich benannt, weil beide nach
  der Namenskonvention gleich hiessen. Ersteller ``SET NULL``. Versioniert.

* ``electrical_risers`` und ``electrical_riser_stops`` - **nur
  Schema-Vorbereitung** fuer 6a.4. In 6a.0-6a.3 gibt es dafuer keine API, keinen
  Service, keine Oberflaeche und keine Daten. Steigweg je Gebaeude (Name
  eindeutig im Gebaeude, ``offset_mode`` ``orthogonal`` | ``direct``,
  versioniert, Gebaeude ``RESTRICT``); Halt je Geschoss (``x_mm``/``y_mm`` im
  Koordinatenbereich, hoechstens einer je Steigweg und Geschoss, Steigweg
  ``CASCADE``, Geschoss ``RESTRICT``). Die Halteliste ist ueber die
  Steigwegversion geschuetzt; Halte haben keine eigene Version.

Tabellenuebergreifende Regeln (selbes Geschoss, verschiedene Raeume, exakt
kollinear und eindeutig; Halt im selben Gebaeude) prueft der Service unter der
Projektsperre.

**Keine Datenmigration.** Bestehende Raumwaende bleiben unentschieden; ein
eindeutiger Bestand kann mit dem getrennten, idempotenten Befehl
``python -m app.cli wall-links-backfill`` (Standard: Probelauf) als ``shared``
uebernommen werden.

**Downgrade** entfernt alle drei Tabellen. Wandkopplungen - auch ausdrueckliche
``separate``-Entscheidungen - sind danach verloren und nicht wiederherstellbar;
Waende, Oeffnungen und Geraete bleiben unberuehrt.

Revision ID: 0010_wall_links_and_risers
Revises: 0009_elevation_confirmed
Create Date: 2026-10-06
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_wall_links_and_risers"
down_revision: str | None = "0009_elevation_confirmed"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


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
    op.create_table(
        "electrical_wall_links",
        sa.Column("wall_a_id", sa.Uuid(), nullable=False),
        sa.Column("wall_b_id", sa.Uuid(), nullable=False),
        sa.Column("relation", sa.String(length=16), nullable=False),
        sa.Column("origin", sa.String(length=16), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.CheckConstraint(
            "wall_a_id < wall_b_id", name=op.f("ck_electrical_wall_links_pair_canonical")
        ),
        sa.CheckConstraint(
            "relation IN ('shared', 'separate')",
            name=op.f("ck_electrical_wall_links_relation_known"),
        ),
        sa.CheckConstraint(
            "origin IN ('user', 'backfill')", name=op.f("ck_electrical_wall_links_origin_known")
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "wall_a_id"],
            ["electrical_walls.organization_id", "electrical_walls.id"],
            name="fk_electrical_wall_links_wall_a_electrical_walls",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "wall_b_id"],
            ["electrical_walls.organization_id", "electrical_walls.id"],
            name="fk_electrical_wall_links_wall_b_electrical_walls",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            name=op.f("fk_electrical_wall_links_created_by_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_electrical_wall_links_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_electrical_wall_links")),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_electrical_wall_links_organization_id_id")
        ),
        sa.UniqueConstraint(
            "organization_id", "wall_a_id", "wall_b_id", name="uq_el_wall_links_pair"
        ),
    )
    op.create_index(
        op.f("ix_electrical_wall_links_organization_id"),
        "electrical_wall_links",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_electrical_wall_links_organization_id_wall_a_id",
        "electrical_wall_links",
        ["organization_id", "wall_a_id"],
        unique=False,
    )
    op.create_index(
        "ix_electrical_wall_links_organization_id_wall_b_id",
        "electrical_wall_links",
        ["organization_id", "wall_b_id"],
        unique=False,
    )

    op.create_table(
        "electrical_risers",
        sa.Column("building_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("offset_mode", sa.String(length=16), nullable=False),
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.CheckConstraint(
            "offset_mode IN ('orthogonal', 'direct')",
            name=op.f("ck_electrical_risers_offset_mode_known"),
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "building_id"],
            ["buildings.organization_id", "buildings.id"],
            name=op.f("fk_electrical_risers_organization_id_buildings"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_electrical_risers_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_electrical_risers")),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_electrical_risers_organization_id_id")
        ),
        sa.UniqueConstraint(
            "organization_id",
            "building_id",
            "name",
            name=op.f("uq_electrical_risers_organization_id_building_id_name"),
        ),
    )
    op.create_index(
        op.f("ix_electrical_risers_organization_id"),
        "electrical_risers",
        ["organization_id"],
        unique=False,
    )

    op.create_table(
        "electrical_riser_stops",
        sa.Column("riser_id", sa.Uuid(), nullable=False),
        sa.Column("floor_id", sa.Uuid(), nullable=False),
        sa.Column("x_mm", sa.Integer(), nullable=False),
        sa.Column("y_mm", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            "x_mm BETWEEN -1000000 AND 1000000 AND y_mm BETWEEN -1000000 AND 1000000",
            name=op.f("ck_electrical_riser_stops_coordinates_in_range"),
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "riser_id"],
            ["electrical_risers.organization_id", "electrical_risers.id"],
            name=op.f("fk_electrical_riser_stops_organization_id_electrical_risers"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "floor_id"],
            ["floors.organization_id", "floors.id"],
            name=op.f("fk_electrical_riser_stops_organization_id_floors"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_electrical_riser_stops_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_electrical_riser_stops")),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_electrical_riser_stops_organization_id_id")
        ),
        sa.UniqueConstraint(
            "organization_id",
            "riser_id",
            "floor_id",
            name=op.f("uq_electrical_riser_stops_organization_id_riser_id_floor_id"),
        ),
    )
    op.create_index(
        op.f("ix_electrical_riser_stops_organization_id"),
        "electrical_riser_stops",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_electrical_riser_stops_organization_id_floor_id",
        "electrical_riser_stops",
        ["organization_id", "floor_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_electrical_riser_stops_organization_id_floor_id", table_name="electrical_riser_stops"
    )
    op.drop_index(
        op.f("ix_electrical_riser_stops_organization_id"), table_name="electrical_riser_stops"
    )
    op.drop_table("electrical_riser_stops")
    op.drop_index(op.f("ix_electrical_risers_organization_id"), table_name="electrical_risers")
    op.drop_table("electrical_risers")
    op.drop_index(
        "ix_electrical_wall_links_organization_id_wall_b_id", table_name="electrical_wall_links"
    )
    op.drop_index(
        "ix_electrical_wall_links_organization_id_wall_a_id", table_name="electrical_wall_links"
    )
    op.drop_index(
        op.f("ix_electrical_wall_links_organization_id"), table_name="electrical_wall_links"
    )
    op.drop_table("electrical_wall_links")
