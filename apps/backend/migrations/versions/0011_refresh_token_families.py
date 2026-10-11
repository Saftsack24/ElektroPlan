"""Refresh-Token-Familien mit dauerhaft gespeichertem Widerrufszustand

Sicherheitsauftrag 2026-10-10, Befund 4: Rotation und Widerruf einer Sitzung
schliessen sich ueber eine gemeinsame Familienzeile aus. Ein Widerruf markiert
die Familie; jede spaetere Erneuerung mit einem Token dieser Familie scheitert -
auch mit einem Nachfolger, den eine gleichzeitige Rotation noch angelegt hat.

* ``refresh_token_families`` - eine Zeile je Sitzung (Anmeldung oder
  Betriebswechsel): Konto, Betrieb, ``revoked_at``, ``revoked_reason``.
  ``UNIQUE (organization_id, id)`` als Ziel des zusammengesetzten
  Fremdschluessels.
* ``refresh_tokens (organization_id, family_id)`` verweist zusammengesetzt auf
  die Familie (``CASCADE`` wie die uebrigen Verweise der Tokentabelle).

**Datenuebernahme.** Fuer jede vorhandene ``family_id`` entsteht genau eine
Familie mit Konto und Betrieb ihrer Tokens. Hat eine Familie noch einen nicht
widerrufenen Token, bleibt sie offen - bestehende Sitzungen bleiben gueltig.
Sind alle ihre Tokens widerrufen, gilt die Familie als widerrufen
(``revoked_at`` = juengster Widerruf, Grund ``family_revoked``); eine solche
Sitzung war schon vorher nicht mehr erneuerbar. Es werden keine Tokens
geaendert oder geloescht.

**Downgrade** entfernt Fremdschluessel und Tabelle. Tokens bleiben; der
Familienzustand ist danach verloren, und Rotation und Widerruf sind wieder nur
ueber die Tokenzeilen synchronisiert (der behobene Wettlauf ist dann wieder
moeglich).

Revision ID: 0011_refresh_token_families
Revises: 0010_wall_links_and_risers
Create Date: 2026-10-10
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_refresh_token_families"
down_revision: str | None = "0010_wall_links_and_risers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "refresh_token_families",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_reason", sa.String(length=32), nullable=True),
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
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
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_refresh_token_families_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_refresh_token_families_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_refresh_token_families")),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_refresh_token_families_organization_id_id")
        ),
    )
    op.create_index(
        op.f("ix_refresh_token_families_organization_id"),
        "refresh_token_families",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_refresh_token_families_user_id"),
        "refresh_token_families",
        ["user_id"],
        unique=False,
    )

    # Bestand: eine Familie je vorhandener family_id. Konto und Betrieb sind
    # innerhalb einer Familie immer gleich (Rotation uebernimmt beide).
    op.execute(
        """
        INSERT INTO refresh_token_families
            (id, user_id, organization_id, revoked_at, revoked_reason, created_at, updated_at)
        SELECT
            t.family_id,
            (array_agg(t.user_id ORDER BY t.created_at))[1],
            (array_agg(t.organization_id ORDER BY t.created_at))[1],
            CASE WHEN bool_or(t.revoked_at IS NULL) THEN NULL ELSE max(t.revoked_at) END,
            CASE WHEN bool_or(t.revoked_at IS NULL) THEN NULL ELSE 'family_revoked' END,
            min(t.created_at),
            now()
        FROM refresh_tokens AS t
        GROUP BY t.family_id
        """
    )

    op.create_foreign_key(
        op.f("fk_refresh_tokens_organization_id_refresh_token_families"),
        "refresh_tokens",
        "refresh_token_families",
        ["organization_id", "family_id"],
        ["organization_id", "id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_refresh_tokens_organization_id_refresh_token_families"),
        "refresh_tokens",
        type_="foreignkey",
    )
    op.drop_index(op.f("ix_refresh_token_families_user_id"), table_name="refresh_token_families")
    op.drop_index(
        op.f("ix_refresh_token_families_organization_id"), table_name="refresh_token_families"
    )
    op.drop_table("refresh_token_families")
