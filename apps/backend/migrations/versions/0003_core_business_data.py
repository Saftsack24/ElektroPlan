"""Kerngeschaeftsdaten: Kunden, Projekte, Gebaeude, Geschosse

Phase 2. Legt die vier Geschaeftstabellen des Core an und verknuepft
Dateien mit einem Projekt.

Alle vier Tabellen sind mandantenbezogen: ``organization_id NOT NULL``,
``UNIQUE (organization_id, id)`` und zusammengesetzte Fremdschluessel
``(organization_id, <ref>_id)`` (ADR 0006). Ein mandantenuebergreifender
Verweis ist damit auf Datenbankebene unmoeglich.

Projekt -> Gebaeude -> Geschoss loeschen mit ``CASCADE``: Struktur ohne
ihr Projekt ergibt keinen Sinn. Projekte und Kunden werden fachlich nur
ausgeblendet (``deleted_at``); ein Hard Delete kommt ausschliesslich ueber
den dokumentierten DSGVO-Pfad vor.

``files.project_id`` ist optional - nicht jede Datei haengt an einem
Projekt. Der zusammengesetzte Fremdschluessel greift bei ``NULL`` nicht
(MATCH SIMPLE) und laesst genau das zu.

Revision ID: 0003_core_business_data
Revises: 0002_refresh_revocation
Create Date: 2026-09-19
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_core_business_data"
down_revision: str | None = "0002_refresh_revocation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "customers",
        sa.Column("customer_number", sa.String(length=30), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("contact_person", sa.String(length=200), nullable=True),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("phone", sa.String(length=40), nullable=True),
        sa.Column("billing_street", sa.String(length=200), nullable=True),
        sa.Column("billing_postal_code", sa.String(length=20), nullable=True),
        sa.Column("billing_city", sa.String(length=120), nullable=True),
        sa.Column("billing_country_code", sa.String(length=2), nullable=False),
        sa.Column("anonymized_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint("kind IN ('private', 'company')", name=op.f("ck_customers_kind_known")),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            name=op.f("fk_customers_created_by_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_customers_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"],
            ["users.id"],
            name=op.f("fk_customers_updated_by_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_customers")),
        sa.UniqueConstraint(
            "organization_id",
            "customer_number",
            name=op.f("uq_customers_organization_id_customer_number"),
        ),
        sa.UniqueConstraint("organization_id", "id", name=op.f("uq_customers_organization_id_id")),
    )
    op.create_index(
        op.f("ix_customers_organization_id"), "customers", ["organization_id"], unique=False
    )
    op.create_table(
        "projects",
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("project_number", sa.String(length=30), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column(
            "status", sa.String(length=16), server_default=sa.text("'draft'"), nullable=False
        ),
        sa.Column("site_street", sa.String(length=200), nullable=True),
        sa.Column("site_postal_code", sa.String(length=20), nullable=True),
        sa.Column("site_city", sa.String(length=120), nullable=True),
        sa.Column("site_country_code", sa.String(length=2), nullable=False),
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
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "status IN ('draft', 'active', 'completed', 'archived')",
            name=op.f("ck_projects_status_known"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            name=op.f("fk_projects_created_by_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "customer_id"],
            ["customers.organization_id", "customers.id"],
            name=op.f("fk_projects_organization_id_customers"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_projects_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"],
            ["users.id"],
            name=op.f("fk_projects_updated_by_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_projects")),
        sa.UniqueConstraint("organization_id", "id", name=op.f("uq_projects_organization_id_id")),
        sa.UniqueConstraint(
            "organization_id",
            "project_number",
            name=op.f("uq_projects_organization_id_project_number"),
        ),
    )
    op.create_index(
        op.f("ix_projects_organization_id"), "projects", ["organization_id"], unique=False
    )
    op.create_index(
        "ix_projects_organization_id_customer_id",
        "projects",
        ["organization_id", "customer_id"],
        unique=False,
    )
    op.create_index(
        "ix_projects_organization_id_status",
        "projects",
        ["organization_id", "status"],
        unique=False,
    )
    op.create_table(
        "buildings",
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["organization_id", "project_id"],
            ["projects.organization_id", "projects.id"],
            name=op.f("fk_buildings_organization_id_projects"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_buildings_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_buildings")),
        sa.UniqueConstraint("organization_id", "id", name=op.f("uq_buildings_organization_id_id")),
    )
    op.create_index(
        op.f("ix_buildings_organization_id"), "buildings", ["organization_id"], unique=False
    )
    op.create_index(
        "ix_buildings_organization_id_project_id",
        "buildings",
        ["organization_id", "project_id"],
        unique=False,
    )
    op.create_table(
        "floors",
        sa.Column("building_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("elevation_mm", sa.Integer(), nullable=False),
        sa.Column("default_ceiling_height_mm", sa.Integer(), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["organization_id", "building_id"],
            ["buildings.organization_id", "buildings.id"],
            name=op.f("fk_floors_organization_id_buildings"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_floors_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_floors")),
        sa.UniqueConstraint("building_id", "level", name=op.f("uq_floors_building_id_level")),
        sa.UniqueConstraint("organization_id", "id", name=op.f("uq_floors_organization_id_id")),
    )
    op.create_index(op.f("ix_floors_organization_id"), "floors", ["organization_id"], unique=False)
    op.create_index(
        "ix_floors_organization_id_building_id",
        "floors",
        ["organization_id", "building_id"],
        unique=False,
    )
    op.add_column("files", sa.Column("project_id", sa.Uuid(), nullable=True))
    op.create_index(
        "ix_files_organization_id_project_id",
        "files",
        ["organization_id", "project_id"],
        unique=False,
    )
    op.create_foreign_key(
        op.f("fk_files_organization_id_projects"),
        "files",
        "projects",
        ["organization_id", "project_id"],
        ["organization_id", "id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("fk_files_organization_id_projects"), "files", type_="foreignkey")
    op.drop_index("ix_files_organization_id_project_id", table_name="files")
    op.drop_column("files", "project_id")
    op.drop_index("ix_floors_organization_id_building_id", table_name="floors")
    op.drop_index(op.f("ix_floors_organization_id"), table_name="floors")
    op.drop_table("floors")
    op.drop_index("ix_buildings_organization_id_project_id", table_name="buildings")
    op.drop_index(op.f("ix_buildings_organization_id"), table_name="buildings")
    op.drop_table("buildings")
    op.drop_index("ix_projects_organization_id_status", table_name="projects")
    op.drop_index("ix_projects_organization_id_customer_id", table_name="projects")
    op.drop_index(op.f("ix_projects_organization_id"), table_name="projects")
    op.drop_table("projects")
    op.drop_index(op.f("ix_customers_organization_id"), table_name="customers")
    op.drop_table("customers")
