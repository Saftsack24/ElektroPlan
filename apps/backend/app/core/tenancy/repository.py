"""Mandantengefilterter Datenzugriff (ADR 0006, Ebene 3).

Ein Query ohne Organisationskontext wirft einen Fehler, statt ungefilterte
Daten zu liefern. Das ist die dritte von vier Isolationsebenen - Schema,
zusammengesetzte Fremdschluessel, diese Zugriffsschicht und der Sweep-Test.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any, ClassVar

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.db.base import Base
from app.errors import MissingTenantContextError, NotFoundError


class TenantRepository[ModelT: Base]:
    """Basisklasse fuer alle Repositories mandantenbezogener Tabellen."""

    model: ClassVar[type[Any]]

    def __init__(self, session: Session, organization_id: uuid.UUID | None) -> None:
        if organization_id is None:
            msg = (
                f"{type(self).__name__} wurde ohne Organisationskontext erzeugt. "
                "Mandantenbezogene Daten duerfen nie ungefiltert gelesen werden."
            )
            raise MissingTenantContextError(msg)
        self.session = session
        self.organization_id = organization_id

    # ------------------------------------------------------------------ Query

    def query(self) -> Select[tuple[ModelT]]:
        """Basisabfrage - bereits auf die Organisation eingeschraenkt."""
        stmt: Select[tuple[ModelT]] = select(self.model).where(
            self.model.organization_id == self.organization_id
        )
        if hasattr(self.model, "deleted_at"):
            stmt = stmt.where(self.model.deleted_at.is_(None))
        return stmt

    def get(self, entity_id: uuid.UUID) -> ModelT | None:
        """Liefert ein Objekt der eigenen Organisation oder ``None``."""
        stmt = self.query().where(self.model.id == entity_id)
        return self.session.execute(stmt).scalar_one_or_none()

    def get_or_404(self, entity_id: uuid.UUID) -> ModelT:
        """Wie :meth:`get`, wirft aber bei fremden oder fehlenden IDs.

        Fremde und nicht existierende Objekte liefern bewusst dieselbe Antwort,
        damit die Existenz fremder Daten nicht ableitbar ist.
        """
        entity = self.get(entity_id)
        if entity is None:
            raise NotFoundError(f"{self.model.__name__} wurde nicht gefunden.")
        return entity

    def list(self, *, limit: int = 50, offset: int = 0) -> Sequence[ModelT]:
        stmt = self.query().limit(limit).offset(offset)
        return self.session.execute(stmt).scalars().all()

    def count(self) -> int:
        from sqlalchemy import func

        stmt = select(func.count()).select_from(self.query().subquery())
        return int(self.session.execute(stmt).scalar_one())

    # ------------------------------------------------------------------ Write

    def add(self, entity: ModelT) -> ModelT:
        """Fuegt ein Objekt hinzu und erzwingt den Mandantenbezug."""
        current = getattr(entity, "organization_id", None)
        if current is None:
            # ModelT ist an Base gebunden; der Mandantenbezug kommt aus dem
            # TenantScoped-Mixin und ist auf Typebene nicht sichtbar.
            entity.organization_id = self.organization_id  # type: ignore[attr-defined]
        elif current != self.organization_id:
            msg = (
                f"{type(entity).__name__} gehoert zu Organisation {current}, "
                f"der Kontext ist {self.organization_id}."
            )
            raise MissingTenantContextError(msg)
        self.session.add(entity)
        return entity
