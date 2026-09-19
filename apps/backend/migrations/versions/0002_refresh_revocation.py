"""Widerrufsgrund fuer Refresh Tokens

Ergaenzt die Spalte ``refresh_tokens.revoked_reason``. Sie erlaubt es der
Refresh-Logik, eine regulaere Rotation eindeutig von Logout, Familien-
widerruf oder erkanntem Diebstahl zu unterscheiden (docs/security.md,
Abschnitt 3).

Bestehende Zeilen behalten ``NULL`` als Grund. Weil das alte Schema
Widerruf ausschliesslich beim Rotieren markiert hat, waeren solche Zeilen
im neuen Verhalten faelschlich rotationsartig; sie werden deshalb
konservativ mit dem Grund ``family_revoked`` versehen und gelten damit
als sofort ungueltig.

Revision ID: 0002_refresh_revocation
Revises: 0001_initial_core
Create Date: 2026-09-19
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# Kurz genug fuer ``alembic_version.version_num`` (VARCHAR(32)).
revision: str = "0002_refresh_revocation"
down_revision: str | None = "0001_initial_core"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "refresh_tokens",
        sa.Column("revoked_reason", sa.String(length=32), nullable=True),
    )
    op.execute(
        """
        UPDATE refresh_tokens
        SET revoked_reason = 'family_revoked'
        WHERE revoked_at IS NOT NULL AND revoked_reason IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column("refresh_tokens", "revoked_reason")
