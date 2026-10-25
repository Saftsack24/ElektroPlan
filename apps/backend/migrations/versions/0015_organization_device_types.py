"""Betriebseigene Geraetetypen und Kategorie Geraeteanschluss/Festanschluss

Phase 6c, Schritt K2 (ADR 0030, ``docs/geraetekatalog-design.md`` §3.1, §4, §5).

* ``electrical_device_types`` bleibt **der eine Katalog**: neu ``organization_id``
  (``NULL`` = Systemtyp), ``description``, ``version`` und Zeitstempel.
* CHECK ``key_scope``: Systemschluessel tragen nie das reservierte Praefix ``c_``, eigene
  Typen immer - ein eigener Typ kann sich nicht als Systemtyp ausgeben.
* CHECK ``custom_not_distribution``: Die Lage einer Verteilung bleibt der Systemtyp.
* ``UNIQUE (organization_id, key)`` und ein Teilindex fuer eindeutige Namen aktiver
  eigener Typen je Betrieb.
* Trigger: Schluessel und Eigentuemer eines Typs sind unveraenderlich.
* Kategorie ``connection`` (Geraeteanschluss/Festanschluss) im CHECK ``category_known``;
  den Systemtyp liefert der Seed.
* ``electrical_devices``, ``electrical_type_templates`` und
  ``electrical_proj_type_templates`` erhalten die berechnete Spalte
  ``device_type_org_id`` (Betrieb bei ``c_``-Schluesseln, sonst ``NULL``) und einen
  zusammengesetzten Fremdschluessel auf ``(organization_id, key)``: Die Datenbank laesst
  keinen Verweis auf den eigenen Typ eines anderen Betriebs zu. Der bisherige
  Fremdschluessel auf ``key`` bleibt.

**Bestand bleibt unveraendert:** Alle vorhandenen Typen sind Systemtypen (``NULL``),
alle Verweise behalten ihren Schluessel; die berechneten Spalten sind ``NULL``.

**Downgrade** bricht ab, solange eigene Typen oder Geraete bzw. Vorlagen der Kategorie
``connection`` existieren - nichts wird still verworfen.

Revision ID: 0015_organization_device_types
Revises: 0014_planning_defaults
Create Date: 2026-10-25
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_organization_device_types"
down_revision: str | None = "0014_planning_defaults"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Festgeschrieben zum Zeitpunkt dieser Migration (keine Abhaengigkeit vom Modellcode).
_KEY_LIKE = "c\\_%"
_OWNER_SQL = f"CASE WHEN device_type_key LIKE '{_KEY_LIKE}' THEN organization_id END"
_CATEGORIES_ALT = "'socket', 'switch', 'light', 'data', 'distribution', 'junction'"
_CATEGORIES_NEU = _CATEGORIES_ALT + ", 'connection'"
_REFERENZEN = (
    ("electrical_devices", "fk_el_devices_device_type_scope"),
    ("electrical_type_templates", "fk_el_type_templates_type_scope"),
    ("electrical_proj_type_templates", "fk_el_proj_type_templates_type_scope"),
)
_TRIGGER_FUNKTION = """
CREATE OR REPLACE FUNCTION electrical_device_types_scope_fixed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.key IS DISTINCT FROM OLD.key
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
        RAISE EXCEPTION 'Schluessel und Eigentuemer eines Geraetetyps sind unveraenderlich'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$
"""
_TRIGGER = (
    "CREATE TRIGGER trg_el_device_types_scope_fixed BEFORE UPDATE ON electrical_device_types "
    "FOR EACH ROW EXECUTE FUNCTION electrical_device_types_scope_fixed()"
)


def upgrade() -> None:
    table = "electrical_device_types"
    op.add_column(table, sa.Column("organization_id", sa.Uuid(), nullable=True))
    op.add_column(table, sa.Column("description", sa.String(length=300), nullable=True))
    op.add_column(
        table,
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.add_column(
        table,
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.add_column(
        table, sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False)
    )
    op.create_foreign_key(
        op.f("fk_electrical_device_types_organization_id_organizations"),
        table,
        "organizations",
        ["organization_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(op.f("ix_electrical_device_types_organization_id"), table, ["organization_id"])
    op.create_unique_constraint("uq_el_device_types_org_key", table, ["organization_id", "key"])
    op.create_check_constraint(
        op.f("ck_electrical_device_types_key_scope"),
        table,
        f"(organization_id IS NULL) = (key NOT LIKE '{_KEY_LIKE}')",
    )
    op.create_check_constraint(
        op.f("ck_electrical_device_types_custom_not_distribution"),
        table,
        "organization_id IS NULL OR category <> 'distribution'",
    )
    op.drop_constraint(op.f("ck_electrical_device_types_category_known"), table, type_="check")
    op.create_check_constraint(
        op.f("ck_electrical_device_types_category_known"), table, f"category IN ({_CATEGORIES_NEU})"
    )
    op.create_index(
        "uq_el_device_types_org_label",
        table,
        ["organization_id", sa.text("lower(label)")],
        unique=True,
        postgresql_where=sa.text("organization_id IS NOT NULL AND is_active"),
    )
    op.execute(_TRIGGER_FUNKTION)
    op.execute(_TRIGGER)

    for referenz, fk_name in _REFERENZEN:
        op.add_column(
            referenz,
            sa.Column(
                "device_type_org_id",
                sa.Uuid(),
                sa.Computed(_OWNER_SQL, persisted=True),
                nullable=True,
            ),
        )
        op.create_foreign_key(
            fk_name,
            referenz,
            table,
            ["device_type_org_id", "device_type_key"],
            ["organization_id", "key"],
            ondelete="RESTRICT",
        )


def downgrade() -> None:
    bind = op.get_bind()
    blockers = {
        "eigene(r) Geraetetyp(en)": (
            "SELECT count(*) FROM electrical_device_types WHERE organization_id IS NOT NULL"
        ),
        "Geraet(e) der Kategorie Geraeteanschluss": (
            "SELECT count(*) FROM electrical_devices d JOIN electrical_device_types t "
            "ON t.key = d.device_type_key WHERE t.category = 'connection'"
        ),
        "Vorlage(n) fuer Geraeteanschluesse": (
            "SELECT (SELECT count(*) FROM electrical_type_templates x JOIN electrical_device_types t "
            "ON t.key = x.device_type_key WHERE t.category = 'connection') + "
            "(SELECT count(*) FROM electrical_proj_type_templates x JOIN electrical_device_types t "
            "ON t.key = x.device_type_key WHERE t.category = 'connection')"
        ),
    }
    found = {
        label: count
        for label, sql in blockers.items()
        if (count := bind.execute(sa.text(sql)).scalar_one())
    }
    if found:
        listing = ", ".join(f"{count} {label}" for label, count in found.items())
        msg = (
            f"Downgrade abgebrochen: {listing} vorhanden. Sie werden nicht still verworfen - "
            "bitte zuerst entfernen bzw. auf Systemtypen umstellen."
        )
        raise RuntimeError(msg)

    table = "electrical_device_types"
    for referenz, fk_name in _REFERENZEN:
        op.drop_constraint(fk_name, referenz, type_="foreignkey")
        op.drop_column(referenz, "device_type_org_id")
    op.execute("DROP TRIGGER IF EXISTS trg_el_device_types_scope_fixed ON electrical_device_types")
    op.execute("DROP FUNCTION IF EXISTS electrical_device_types_scope_fixed()")
    op.drop_index("uq_el_device_types_org_label", table_name=table)
    # Der Systemtyp der neuen Kategorie ist unbenutzt (oben geprueft) und entfaellt.
    op.execute("DELETE FROM electrical_device_types WHERE category = 'connection'")
    op.drop_constraint(op.f("ck_electrical_device_types_category_known"), table, type_="check")
    op.create_check_constraint(
        op.f("ck_electrical_device_types_category_known"), table, f"category IN ({_CATEGORIES_ALT})"
    )
    op.drop_constraint(
        op.f("ck_electrical_device_types_custom_not_distribution"), table, type_="check"
    )
    op.drop_constraint(op.f("ck_electrical_device_types_key_scope"), table, type_="check")
    op.drop_constraint("uq_el_device_types_org_key", table, type_="unique")
    op.drop_index(op.f("ix_electrical_device_types_organization_id"), table_name=table)
    op.drop_constraint(
        op.f("fk_electrical_device_types_organization_id_organizations"), table, type_="foreignkey"
    )
    for column in ("version", "updated_at", "created_at", "description", "organization_id"):
        op.drop_column(table, column)
