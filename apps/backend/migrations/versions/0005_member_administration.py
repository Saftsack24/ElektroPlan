"""Benutzerverwaltung: Mitgliedsversion und Einladungen

Phase 4.2 (ADR 0015).

* ``organization_members.version`` - optimistisches Sperren fuer Status und
  Rollen einer Mitgliedschaft (``If-Match``). Bestehende Zeilen beginnen bei 1.
* ``organization_members.last_login_at`` - letzte Anmeldung **in diesem**
  Betrieb. Bewusst nicht aus ``users.last_login_at`` befuellt: Der globale
  Wert koennte aus einem anderen Betrieb stammen.
* ``member_invitations`` - Einladung einer E-Mail-Adresse. Gespeichert wird
  nur der SHA-256-Hash des Einmal-Tokens (``UNIQUE``). Der partielle
  eindeutige Index ``uq_member_invitations_open_email`` laesst je Betrieb und
  E-Mail hoechstens eine offene Einladung zu - auch unter Parallelitaet.
* ``member_invitation_roles`` - vorgesehene Systemrollen, zusammengesetzte
  Fremdschluessel auf Einladung und Rolle (ADR 0006).

Keine Datenmigration: Es gibt noch keine Einladungen, und der ungenutzte
Mitgliedsstatus ``invited`` kommt im Bestand nicht vor.

Revision ID: 0005_member_administration
Revises: 0004_electrical_room_model
Create Date: 2026-09-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_member_administration"
down_revision: str | None = "0004_electrical_room_model"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "organization_members",
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
    )
    op.add_column(
        "organization_members",
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "member_invitations",
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("full_name", sa.String(length=200), nullable=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
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
            ["created_by_user_id"],
            ["users.id"],
            name=op.f("fk_member_invitations_created_by_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_member_invitations_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_member_invitations")),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_member_invitations_organization_id_id")
        ),
        sa.UniqueConstraint("token_hash", name=op.f("uq_member_invitations_token_hash")),
    )
    op.create_index(
        op.f("ix_member_invitations_organization_id"),
        "member_invitations",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "uq_member_invitations_open_email",
        "member_invitations",
        ["organization_id", "email"],
        unique=True,
        postgresql_where=sa.text("accepted_at IS NULL AND revoked_at IS NULL"),
    )

    op.create_table(
        "member_invitation_roles",
        sa.Column("invitation_id", sa.Uuid(), nullable=False),
        sa.Column("role_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["organization_id", "invitation_id"],
            ["member_invitations.organization_id", "member_invitations.id"],
            name=op.f("fk_member_invitation_roles_organization_id_member_invitations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "role_id"],
            ["roles.organization_id", "roles.id"],
            name=op.f("fk_member_invitation_roles_organization_id_roles"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_member_invitation_roles_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "invitation_id", "role_id", name=op.f("pk_member_invitation_roles")
        ),
    )
    op.create_index(
        op.f("ix_member_invitation_roles_organization_id"),
        "member_invitation_roles",
        ["organization_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_member_invitation_roles_organization_id"), table_name="member_invitation_roles"
    )
    op.drop_table("member_invitation_roles")
    op.drop_index(
        "uq_member_invitations_open_email",
        table_name="member_invitations",
        postgresql_where=sa.text("accepted_at IS NULL AND revoked_at IS NULL"),
    )
    op.drop_index(op.f("ix_member_invitations_organization_id"), table_name="member_invitations")
    op.drop_table("member_invitations")
    op.drop_column("organization_members", "last_login_at")
    op.drop_column("organization_members", "version")
