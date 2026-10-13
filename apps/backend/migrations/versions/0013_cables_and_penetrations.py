"""Leitungen, Wegpunkte und Durchfuehrungen

Phase 6b.3 (ADR 0026, Entwurf §3.2/§3.3).

* ``electrical_wall_penetrations`` - Durchfuehrung, einmal an ``wall_a`` der
  Wandkopplung gespeichert (Abstand, Hoehe), versioniert. Kopplung ``RESTRICT``.
* ``electrical_cables`` - Leitung eines Stromkreises mit tatsaechlichen
  Kabelangaben, Zugaben und Reserve, versioniert. **Keine Laengenspalte.**
  Stromkreis ``CASCADE``, Endgeraete ``RESTRICT``; ``start_device_id`` leer nur
  bei einer Verteilung ohne Lage.
* ``electrical_cable_waypoints`` - Wegpunktliste je Leitung (``seq`` eindeutig),
  je Art genau die zugehoerigen Spalten (CHECK). Alle Bezuege ``RESTRICT``; Halte
  ueber ``(organization_id, riser_id, stop_id)`` - dafuer erhaelt
  ``electrical_riser_stops`` die Eindeutigkeit ``(organization_id, riser_id, id)``.
  Der Bodenuebergang speichert seine Lage selbst; ``opening_id`` ist nullable.

Tabellenuebergreifende Regeln (gleiches Gebaeude, Stromkreiszugehoerigkeit der
Endgeraete, gueltiger Weg, aktive Kopplung) prueft der Service unter der
Projektsperre. Das neue Recht ``electrical.route.write`` legt der Seed an.

**Keine Datenmigration.**

**Downgrade** entfernt die drei Tabellen und die zusaetzliche Eindeutigkeit. Gibt
es Leitungen oder Durchfuehrungen, bricht es ab, statt sie still zu loeschen.

Revision ID: 0013_cables_and_penetrations
Revises: 0012_boards_and_circuits
Create Date: 2026-10-12
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "0013_cables_and_penetrations"
down_revision: str | None = "0012_boards_and_circuits"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NULLS = (
    "wall_id",
    "offset_mm",
    "height_mm",
    "room_id",
    "x_mm",
    "y_mm",
    "penetration_id",
    "opening_id",
    "riser_id",
    "from_stop_id",
    "from_height_mm",
    "to_stop_id",
    "to_height_mm",
)


def _shape(kinds: str, present: tuple[str, ...], optional: tuple[str, ...] = ()) -> str:
    parts = [f"kind IN ({kinds})"]
    parts += [f"{column} IS NOT NULL" for column in present]
    parts += [
        f"{column} IS NULL" for column in _NULLS if column not in present and column not in optional
    ]
    return "(" + " AND ".join(parts) + ")"


#: Festgeschrieben zum Zeitpunkt dieser Migration (keine Abhaengigkeit vom Modellcode).
_WAYPOINT_SHAPES = " OR ".join(
    [
        _shape("'wall'", ("wall_id", "offset_mm", "height_mm")),
        _shape("'ceiling', 'floor'", ("room_id", "x_mm", "y_mm")),
        _shape("'penetration'", ("penetration_id",)),
        _shape("'opening_crossing'", ("wall_id", "offset_mm"), ("opening_id",)),
        _shape(
            "'riser'",
            ("riser_id", "from_stop_id", "from_height_mm", "to_stop_id", "to_height_mm"),
        ),
    ]
)


def _timestamps() -> list[sa.Column[Any]]:
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


def _identity() -> list[sa.Column[Any]]:
    return [
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
    ]


def _org_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["organization_id"],
        ["organizations.id"],
        name=op.f(f"fk_{table}_organization_id_organizations"),
        ondelete="RESTRICT",
    )


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_el_riser_stops_riser_id_id",
        "electrical_riser_stops",
        ["organization_id", "riser_id", "id"],
    )

    op.create_table(
        "electrical_wall_penetrations",
        sa.Column("wall_link_id", sa.Uuid(), nullable=False),
        sa.Column("offset_mm", sa.Integer(), nullable=False),
        sa.Column("height_mm", sa.Integer(), nullable=False),
        sa.Column("note", sa.String(length=200), nullable=True),
        *_identity(),
        *_timestamps(),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.CheckConstraint(
            "offset_mm BETWEEN 0 AND 1000000",
            name=op.f("ck_electrical_wall_penetrations_offset_plausible"),
        ),
        sa.CheckConstraint(
            "height_mm BETWEEN 0 AND 6000",
            name=op.f("ck_electrical_wall_penetrations_height_plausible"),
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "wall_link_id"],
            ["electrical_wall_links.organization_id", "electrical_wall_links.id"],
            name="fk_el_penetrations_wall_link",
            ondelete="RESTRICT",
        ),
        _org_fk("electrical_wall_penetrations"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_electrical_wall_penetrations")),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_electrical_wall_penetrations_organization_id_id")
        ),
    )
    op.create_index(
        op.f("ix_electrical_wall_penetrations_organization_id"),
        "electrical_wall_penetrations",
        ["organization_id"],
    )
    op.create_index(
        "ix_electrical_wall_penetrations_organization_id_wall_link_id",
        "electrical_wall_penetrations",
        ["organization_id", "wall_link_id"],
    )

    op.create_table(
        "electrical_cables",
        sa.Column("circuit_id", sa.Uuid(), nullable=False),
        sa.Column("label", sa.String(length=60), nullable=True),
        sa.Column("start_device_id", sa.Uuid(), nullable=True),
        sa.Column("end_device_id", sa.Uuid(), nullable=False),
        sa.Column("cable_type", sa.String(length=40), nullable=True),
        sa.Column("conductor_count", sa.SmallInteger(), nullable=True),
        sa.Column("cross_section_mm2", sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column("start_allowance_mm", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("end_allowance_mm", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("reserve_mm", sa.Integer(), server_default=sa.text("0"), nullable=False),
        *_identity(),
        *_timestamps(),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.CheckConstraint(
            "start_device_id IS NULL OR start_device_id <> end_device_id",
            name=op.f("ck_electrical_cables_endpoints_differ"),
        ),
        sa.CheckConstraint(
            "conductor_count IS NULL OR conductor_count BETWEEN 1 AND 100",
            name=op.f("ck_electrical_cables_conductor_count_plausible"),
        ),
        sa.CheckConstraint(
            "cross_section_mm2 IS NULL OR cross_section_mm2 > 0",
            name=op.f("ck_electrical_cables_cross_section_positive"),
        ),
        sa.CheckConstraint(
            "start_allowance_mm BETWEEN 0 AND 20000 AND end_allowance_mm BETWEEN 0 AND 20000 "
            "AND reserve_mm BETWEEN 0 AND 20000",
            name=op.f("ck_electrical_cables_allowances_plausible"),
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "circuit_id"],
            ["electrical_circuits.organization_id", "electrical_circuits.id"],
            name="fk_electrical_cables_circuit",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "start_device_id"],
            ["electrical_devices.organization_id", "electrical_devices.id"],
            name="fk_electrical_cables_start_device",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "end_device_id"],
            ["electrical_devices.organization_id", "electrical_devices.id"],
            name="fk_electrical_cables_end_device",
            ondelete="RESTRICT",
        ),
        _org_fk("electrical_cables"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_electrical_cables")),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_electrical_cables_organization_id_id")
        ),
    )
    op.create_index(
        op.f("ix_electrical_cables_organization_id"), "electrical_cables", ["organization_id"]
    )
    for column in ("circuit_id", "start_device_id", "end_device_id"):
        op.create_index(
            f"ix_electrical_cables_organization_id_{column}",
            "electrical_cables",
            ["organization_id", column],
        )

    op.create_table(
        "electrical_cable_waypoints",
        sa.Column("cable_id", sa.Uuid(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("wall_id", sa.Uuid(), nullable=True),
        sa.Column("offset_mm", sa.Integer(), nullable=True),
        sa.Column("height_mm", sa.Integer(), nullable=True),
        sa.Column("room_id", sa.Uuid(), nullable=True),
        sa.Column("x_mm", sa.Integer(), nullable=True),
        sa.Column("y_mm", sa.Integer(), nullable=True),
        sa.Column("penetration_id", sa.Uuid(), nullable=True),
        sa.Column("opening_id", sa.Uuid(), nullable=True),
        sa.Column("riser_id", sa.Uuid(), nullable=True),
        sa.Column("from_stop_id", sa.Uuid(), nullable=True),
        sa.Column("from_height_mm", sa.Integer(), nullable=True),
        sa.Column("to_stop_id", sa.Uuid(), nullable=True),
        sa.Column("to_height_mm", sa.Integer(), nullable=True),
        *_identity(),
        *_timestamps(),
        sa.CheckConstraint("seq >= 0", name=op.f("ck_electrical_cable_waypoints_seq_not_negative")),
        sa.CheckConstraint(
            "kind IN ('wall', 'ceiling', 'floor', 'penetration', 'opening_crossing', 'riser')",
            name=op.f("ck_electrical_cable_waypoints_kind_known"),
        ),
        sa.CheckConstraint(
            _WAYPOINT_SHAPES, name=op.f("ck_electrical_cable_waypoints_columns_match_kind")
        ),
        sa.CheckConstraint(
            "(offset_mm IS NULL OR offset_mm BETWEEN 0 AND 1000000) "
            "AND (height_mm IS NULL OR height_mm BETWEEN 0 AND 6000) "
            "AND (from_height_mm IS NULL OR from_height_mm BETWEEN 0 AND 6000) "
            "AND (to_height_mm IS NULL OR to_height_mm BETWEEN 0 AND 6000)",
            name=op.f("ck_electrical_cable_waypoints_values_plausible"),
        ),
        sa.CheckConstraint(
            "(x_mm IS NULL OR x_mm BETWEEN -1000000 AND 1000000) AND "
            "(y_mm IS NULL OR y_mm BETWEEN -1000000 AND 1000000)",
            name=op.f("ck_electrical_cable_waypoints_coordinates_in_range"),
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "cable_id"],
            ["electrical_cables.organization_id", "electrical_cables.id"],
            name=op.f("fk_electrical_cable_waypoints_organization_id_electrical_cables"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "wall_id"],
            ["electrical_walls.organization_id", "electrical_walls.id"],
            name=op.f("fk_electrical_cable_waypoints_organization_id_electrical_walls"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "room_id"],
            ["electrical_rooms.organization_id", "electrical_rooms.id"],
            name=op.f("fk_electrical_cable_waypoints_organization_id_electrical_rooms"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "penetration_id"],
            ["electrical_wall_penetrations.organization_id", "electrical_wall_penetrations.id"],
            name="fk_el_cable_waypoints_penetration",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "opening_id"],
            ["electrical_openings.organization_id", "electrical_openings.id"],
            name="fk_el_cable_waypoints_opening",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "riser_id"],
            ["electrical_risers.organization_id", "electrical_risers.id"],
            name="fk_el_cable_waypoints_riser",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "riser_id", "from_stop_id"],
            [
                "electrical_riser_stops.organization_id",
                "electrical_riser_stops.riser_id",
                "electrical_riser_stops.id",
            ],
            name="fk_el_cable_waypoints_from_stop",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "riser_id", "to_stop_id"],
            [
                "electrical_riser_stops.organization_id",
                "electrical_riser_stops.riser_id",
                "electrical_riser_stops.id",
            ],
            name="fk_el_cable_waypoints_to_stop",
            ondelete="RESTRICT",
        ),
        _org_fk("electrical_cable_waypoints"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_electrical_cable_waypoints")),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_electrical_cable_waypoints_organization_id_id")
        ),
        sa.UniqueConstraint("organization_id", "cable_id", "seq", name="uq_el_cable_waypoints_seq"),
    )
    op.create_index(
        op.f("ix_electrical_cable_waypoints_organization_id"),
        "electrical_cable_waypoints",
        ["organization_id"],
    )
    for name, column in (
        ("wall", "wall_id"),
        ("room", "room_id"),
        ("penetration", "penetration_id"),
        ("opening", "opening_id"),
        ("riser", "riser_id"),
    ):
        op.create_index(
            f"ix_el_cable_waypoints_{name}",
            "electrical_cable_waypoints",
            ["organization_id", column],
        )


def downgrade() -> None:
    bind = op.get_bind()
    cables = bind.execute(sa.text("SELECT count(*) FROM electrical_cables")).scalar_one()
    penetrations = bind.execute(
        sa.text("SELECT count(*) FROM electrical_wall_penetrations")
    ).scalar_one()
    if cables or penetrations:
        msg = (
            f"Downgrade abgebrochen: {cables} Leitung(en) und {penetrations} Durchfuehrung(en) "
            "vorhanden. Sie werden nicht still geloescht - bitte zuerst entfernen."
        )
        raise RuntimeError(msg)
    for name in ("wall", "room", "penetration", "opening", "riser"):
        op.drop_index(f"ix_el_cable_waypoints_{name}", table_name="electrical_cable_waypoints")
    op.drop_index(
        op.f("ix_electrical_cable_waypoints_organization_id"),
        table_name="electrical_cable_waypoints",
    )
    op.drop_table("electrical_cable_waypoints")
    for column in ("circuit_id", "start_device_id", "end_device_id"):
        op.drop_index(
            f"ix_electrical_cables_organization_id_{column}", table_name="electrical_cables"
        )
    op.drop_index(op.f("ix_electrical_cables_organization_id"), table_name="electrical_cables")
    op.drop_table("electrical_cables")
    op.drop_index(
        "ix_electrical_wall_penetrations_organization_id_wall_link_id",
        table_name="electrical_wall_penetrations",
    )
    op.drop_index(
        op.f("ix_electrical_wall_penetrations_organization_id"),
        table_name="electrical_wall_penetrations",
    )
    op.drop_table("electrical_wall_penetrations")
    op.drop_constraint("uq_el_riser_stops_riser_id_id", "electrical_riser_stops", type_="unique")
