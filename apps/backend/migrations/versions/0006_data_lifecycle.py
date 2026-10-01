"""Datenlebenszyklus: Storage-Aufraeum-Warteschlange, Ende von Anonymisierung und Soft Delete

Phase 4d (ADR 0020).

* ``storage_cleanup_jobs`` - dauerhafte Vormerkung von Storage-Objekten, deren
  Dateizeile in derselben Transaktion geloescht wurde. Eindeutiger Schluessel,
  Versuchszaehler, letzter Versuch, gekuerzte Fehlermeldung. Keine Adressen,
  keine Zugangsdaten. Mandantenbezug ueber ``organization_id``.
* ``customers.anonymized_at`` entfaellt: Kunden werden seit Phase 4d physisch
  geloescht, die Anonymisierung gibt es nicht mehr. Bereits anonymisierte
  Entwicklungsdatensaetze bleiben mit ihrem Platzhalternamen stehen und werden
  nicht rekonstruiert.
* ``customers.deleted_at`` und ``projects.deleted_at`` entfallen: Das Ausblenden
  (Soft Delete) von Kunden und Projekten ist abgeschafft. **Es wird keine Zeile
  geloescht.** Zuvor ausgeblendete Kunden und Projekte verlieren nur ihre
  Markierung und sind danach wieder normal sichtbar - Projekte je nach Status in der
  laufenden oder historischen Ansicht. Danach gelten fuer sie die Regeln aus ADR 0020.
  Archivierung bleibt ausschliesslich der Projektstatus ``archived``.
* Die Berechtigung ``customer.record.anonymize`` wird entfernt; ihre
  Rollenzuordnungen verschwinden per ``ON DELETE CASCADE``. Die neuen
  Berechtigungen (``project.record.purge``, ``project.record.reopen``) und die
  Zuordnung von ``project.record.delete`` zum Planer legt der idempotente
  Seed an (``python -m app.cli seed``) - Seeds sind keine Migrationen
  (docs/database.md, Abschnitt 8).

``created_by_user_id``/``updated_by_user_id`` bestehen an Kunden und Projekten
seit ``0003`` (``ON DELETE SET NULL`` auf ``users``) und bleiben unveraendert;
Bestandsdaten ohne Bearbeiter erscheinen als "System/Bestandsdaten".
``files.project_id`` und ``electrical_rooms.floor_id`` bleiben bewusst
``RESTRICT``: Kein Cascade darf Storage-Schluessel oder Planungsdaten unbemerkt
mitnehmen.

Revision ID: 0006_data_lifecycle
Revises: 0005_member_administration
Create Date: 2026-09-30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_data_lifecycle"
down_revision: str | None = "0005_member_administration"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "storage_cleanup_jobs",
        sa.Column("storage_key", sa.String(length=400), nullable=False),
        sa.Column("reason", sa.String(length=40), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=500), nullable=True),
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
            "attempts >= 0", name=op.f("ck_storage_cleanup_jobs_attempts_not_negative")
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_storage_cleanup_jobs_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_storage_cleanup_jobs")),
        sa.UniqueConstraint("storage_key", name=op.f("uq_storage_cleanup_jobs_storage_key")),
    )
    op.create_index(
        op.f("ix_storage_cleanup_jobs_organization_id"),
        "storage_cleanup_jobs",
        ["organization_id"],
        unique=False,
    )
    op.drop_column("customers", "anonymized_at")
    # Soft Delete abgeschafft: nur die Spalten entfallen, keine Zeile wird geloescht.
    op.drop_column("customers", "deleted_at")
    op.drop_column("projects", "deleted_at")
    # Rollenzuordnungen folgen per ON DELETE CASCADE (role_permissions).
    op.execute("DELETE FROM permissions WHERE key = 'customer.record.anonymize'")


def downgrade() -> None:
    # Die Berechtigung legt ein Seed der alten Version wieder an.
    # Grenze: Die Spalten entstehen leer (nullable). Fruehere Ausblendemarkierungen
    # und Anonymisierungszeitpunkte lassen sich nicht rekonstruieren - nach einem
    # Downgrade ist jeder Kunde und jedes Projekt sichtbar.
    op.add_column(
        "projects",
        sa.Column("deleted_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
    )
    op.add_column(
        "customers",
        sa.Column("deleted_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
    )
    op.add_column(
        "customers",
        sa.Column("anonymized_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
    )
    op.drop_index(
        op.f("ix_storage_cleanup_jobs_organization_id"), table_name="storage_cleanup_jobs"
    )
    op.drop_table("storage_cleanup_jobs")
