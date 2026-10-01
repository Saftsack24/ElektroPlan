"""Benutzerlebenszyklus, Sitzungsversion, Reset-Links und persoenliche Einstellungen

Phase 4e (ADR 0021).

* ``organization_members``

  - ``status`` kennt zusaetzlich ``removed`` (endgueltig entfernt, Tombstone).
    Neu ist ein CHECK ueber die bekannten Werte; der Bestand enthaelt nur
    ``active`` und ``disabled`` und bleibt **unveraendert** - aktive Mitglieder
    bleiben aktiv, gesperrte gesperrt.
  - ``lock_reason`` - optionaler, kurzer Sperrgrund (hoechstens 200 Zeichen),
    nur bei ``disabled`` (CHECK).
  - ``session_version`` - steht in jedem Access und Refresh Token; jede
    sicherheitsrelevante Aenderung zaehlt sie hoch. Bestand beginnt bei 1.
  - Die eindeutige Constraint ``(organization_id, user_id)`` wird zum
    partiellen Index ``uq_organization_members_current_user``
    (``WHERE status <> 'removed'``): Eine entfernte Mitgliedschaft bleibt als
    Tombstone stehen, eine erneute Einladung derselben Person legt eine neue an.

* ``refresh_tokens.session_version`` - Stand bei der Ausstellung. Bestand 1,
  passend zum Bestand der Mitgliedschaften: Bestehende Sitzungen bleiben
  gueltig. Access Tokens ohne Sitzungsversion (vor diesem Stand ausgestellt)
  werden einmal abgelehnt; der Client erneuert sie ueber das Cookie.

* ``password_reset_tokens`` - offene Einmal-Links, **nur** SHA-256-Hash,
  hoechstens einer je Mitgliedschaft; zusammengesetzter Fremdschluessel auf die
  Mitgliedschaft (``CASCADE``), Ersteller ``SET NULL``.

* ``user_preferences`` - Darstellung, Akzent, Masseinheit je Mitgliedschaft,
  versioniert, mit CHECKs ueber die bekannten Werte; hoechstens ein Datensatz je
  Mitgliedschaft; zusammengesetzter Fremdschluessel (``CASCADE``).

Neue Berechtigungen (``user.profile.write``, ``user.account.lock``,
``user.password.reset``, ``user.account.remove``, ``user.preferences.write``)
legt der idempotente Seed an - Seeds sind keine Migrationen (docs/database.md,
Abschnitt 8). Bis zum Seed-Lauf kann niemand sperren oder entsperren:
``user.account.write`` deckt das nicht mehr ab.

Revision ID: 0007_user_lifecycle_preferences
Revises: 0006_data_lifecycle
Create Date: 2026-10-01
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_user_lifecycle_preferences"
down_revision: str | None = "0006_data_lifecycle"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CURRENT_MEMBERSHIP = "uq_organization_members_current_user"
_CURRENT_MEMBERSHIP_WHERE = sa.text("status <> 'removed'")


def upgrade() -> None:
    # --- organization_members -------------------------------------------------
    op.add_column(
        "organization_members",
        sa.Column("lock_reason", sa.String(length=200), nullable=True),
    )
    op.add_column(
        "organization_members",
        sa.Column("session_version", sa.Integer(), server_default=sa.text("1"), nullable=False),
    )
    op.create_check_constraint(
        op.f("ck_organization_members_status_known"),
        "organization_members",
        "status IN ('active', 'invited', 'disabled', 'removed')",
    )
    op.create_check_constraint(
        op.f("ck_organization_members_lock_reason_only_when_disabled"),
        "organization_members",
        "lock_reason IS NULL OR status = 'disabled'",
    )
    op.create_check_constraint(
        op.f("ck_organization_members_session_version_positive"),
        "organization_members",
        "session_version >= 1",
    )
    op.drop_constraint(
        op.f("uq_organization_members_organization_id_user_id"),
        "organization_members",
        type_="unique",
    )
    op.create_index(
        _CURRENT_MEMBERSHIP,
        "organization_members",
        ["organization_id", "user_id"],
        unique=True,
        postgresql_where=_CURRENT_MEMBERSHIP_WHERE,
    )

    # --- refresh_tokens -------------------------------------------------------
    op.add_column(
        "refresh_tokens",
        sa.Column("session_version", sa.Integer(), server_default=sa.text("1"), nullable=False),
    )

    # --- password_reset_tokens --------------------------------------------------
    op.create_table(
        "password_reset_tokens",
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            name=op.f("fk_password_reset_tokens_created_by_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "member_id"],
            ["organization_members.organization_id", "organization_members.id"],
            name=op.f("fk_password_reset_tokens_organization_id_organization_members"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_password_reset_tokens_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_password_reset_tokens")),
        sa.UniqueConstraint("member_id", name=op.f("uq_password_reset_tokens_member_id")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_password_reset_tokens_token_hash")),
    )
    op.create_index(
        op.f("ix_password_reset_tokens_organization_id"),
        "password_reset_tokens",
        ["organization_id"],
        unique=False,
    )

    # --- user_preferences --------------------------------------------------------
    op.create_table(
        "user_preferences",
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("theme_mode", sa.String(length=16), nullable=False),
        sa.Column("accent", sa.String(length=16), nullable=False),
        sa.Column("length_unit", sa.String(length=4), nullable=False),
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
            "accent IN ('blue', 'teal', 'green', 'violet', 'orange')",
            name=op.f("ck_user_preferences_accent_known"),
        ),
        sa.CheckConstraint(
            "length_unit IN ('mm', 'cm', 'm')",
            name=op.f("ck_user_preferences_length_unit_known"),
        ),
        sa.CheckConstraint(
            "theme_mode IN ('system', 'light', 'dark')",
            name=op.f("ck_user_preferences_theme_mode_known"),
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "member_id"],
            ["organization_members.organization_id", "organization_members.id"],
            name=op.f("fk_user_preferences_organization_id_organization_members"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_user_preferences_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_preferences")),
        sa.UniqueConstraint("member_id", name=op.f("uq_user_preferences_member_id")),
    )
    op.create_index(
        op.f("ix_user_preferences_organization_id"),
        "user_preferences",
        ["organization_id"],
        unique=False,
    )


def downgrade() -> None:
    """Zurueck auf ``0006``.

    Grenzen - bewusst und hier festgehalten:

    * Persoenliche Einstellungen und offene Reset-Links gehen verloren.
    * Eine entfernte Mitgliedschaft, neben der dieselbe Person erneut Mitglied
      geworden ist, wird geloescht (die alte Eindeutigkeit liesse beide nicht
      zu). Bearbeiterangaben verweisen auf das Konto, nicht auf die
      Mitgliedschaft, und bleiben erhalten.
    * Die uebrigen entfernten Mitgliedschaften werden zu ``disabled``: Der alte
      Stand kennt kein Entfernen. Ein bereinigtes Konto bleibt bereinigt und
      nicht anmeldbar.
    """
    op.drop_index(op.f("ix_user_preferences_organization_id"), table_name="user_preferences")
    op.drop_table("user_preferences")
    op.drop_index(
        op.f("ix_password_reset_tokens_organization_id"), table_name="password_reset_tokens"
    )
    op.drop_table("password_reset_tokens")
    op.drop_column("refresh_tokens", "session_version")

    op.execute(
        """
        DELETE FROM organization_members AS removed
        WHERE removed.status = 'removed'
          AND EXISTS (
              SELECT 1 FROM organization_members AS current
              WHERE current.organization_id = removed.organization_id
                AND current.user_id = removed.user_id
                AND current.status <> 'removed'
          )
        """
    )
    # Mehrere entfernte Mitgliedschaften derselben Person: nur die juengste bleibt.
    op.execute(
        """
        DELETE FROM organization_members AS older
        USING organization_members AS newer
        WHERE older.status = 'removed'
          AND newer.status = 'removed'
          AND older.organization_id = newer.organization_id
          AND older.user_id = newer.user_id
          AND (older.created_at, older.id) < (newer.created_at, newer.id)
        """
    )
    op.execute("UPDATE organization_members SET status = 'disabled' WHERE status = 'removed'")
    op.drop_index(
        _CURRENT_MEMBERSHIP,
        table_name="organization_members",
        postgresql_where=_CURRENT_MEMBERSHIP_WHERE,
    )
    op.create_unique_constraint(
        op.f("uq_organization_members_organization_id_user_id"),
        "organization_members",
        ["organization_id", "user_id"],
    )
    op.drop_constraint(
        op.f("ck_organization_members_session_version_positive"),
        "organization_members",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_organization_members_lock_reason_only_when_disabled"),
        "organization_members",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_organization_members_status_known"), "organization_members", type_="check"
    )
    op.drop_column("organization_members", "session_version")
    op.drop_column("organization_members", "lock_reason")
