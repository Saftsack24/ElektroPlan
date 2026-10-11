"""Bestaetigte Hoehenlage eines Geschosses

Phase 6a.0 (ADR 0025).

* ``floors.elevation_confirmed boolean NOT NULL DEFAULT false``.

``floors.elevation_mm`` ist ``NOT NULL DEFAULT 0``; ob ein Wert gepflegt ist,
laesst sich daran nicht erkennen. Die neue Spalte haelt fest, ob die Hoehenlage
**ausdruecklich bestaetigt** ist.

**Bestand:** Alle vorhandenen Geschosse werden ``false`` - auch plausible Werte
und auch das Erdgeschoss mit ``0``. Es wird nichts automatisch bestaetigt und
nichts aus ``level`` oder der Standardhoehe abgeleitet. Die Hoehenlagen selbst
bleiben unveraendert.

**Downgrade** entfernt die Spalte: Die Bestaetigungen gehen verloren, die
Hoehenlagen bleiben. Nach einem erneuten Upgrade ist alles unbestaetigt.

Revision ID: 0009_elevation_confirmed
Revises: 0008_electrical_devices
Create Date: 2026-10-06
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_elevation_confirmed"
down_revision: str | None = "0008_electrical_devices"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Der Server-Default setzt den Bestand in einem Schritt auf ``false``.
    op.add_column(
        "floors",
        sa.Column(
            "elevation_confirmed",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("floors", "elevation_confirmed")
