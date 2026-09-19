"""Belegnummernkreise.

Vergabe ueber Zeilensperre, nicht ueber ``MAX(number)+1`` - sonst entstehen
unter Parallelzugriff doppelte Nummern (docs/architecture-review.md, B-12).
"""

from __future__ import annotations

import uuid

from sqlalchemy import BigInteger, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import Timestamped


class NumberSequence(Timestamped, Base):
    """Laufende Nummer je Organisation, Bereich und Periode."""

    __tablename__ = "number_sequences"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
    )
    #: z. B. "customer", "project", "offer", "work_order"
    scope: Mapped[str] = mapped_column(String(40), primary_key=True)
    #: z. B. "2026" oder "" fuer periodenlose Kreise
    period: Mapped[str] = mapped_column(String(10), primary_key=True)
    current_value: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
