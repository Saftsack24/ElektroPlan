"""Geschaeftslogik des Kundenstamms.

Die Schicht besitzt die Transaktionsgrenze nicht selbst: Der Endpunkt
committet, damit Fachaenderung und Audit-Eintrag in derselben Transaktion
liegen (docs/architecture.md, Abschnitt 7).
"""

from __future__ import annotations

import uuid
from typing import Literal

from sqlalchemy import Select, func, or_
from sqlalchemy.orm import Session

from app.core.customers.models import Customer
from app.core.customers.schemas import CustomerCreate, CustomerUpdate
from app.core.numbering.service import CUSTOMER_SEQUENCE, next_number
from app.core.pagination import OffsetPage, fetch_numbered_page, order_with_tiebreaker
from app.core.persistence import flush
from app.core.preconditions import check_version
from app.core.tenancy.repository import TenantRepository
from app.errors import NotFoundError

CustomerSort = Literal["created_at", "name"]


class CustomerRepository(TenantRepository[Customer]):
    model = Customer


class CustomerService:
    """Anlegen, Aendern und endgueltiges Loeschen von Kunden."""

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self.session = session
        self.organization_id = organization_id
        self.repository = CustomerRepository(session, organization_id)

    # ------------------------------------------------------------------ Lesen

    def get(self, customer_id: uuid.UUID) -> Customer:
        return self.repository.get_or_404(customer_id)

    def get_for_update(self, customer_id: uuid.UUID) -> Customer:
        """Laedt den Kunden und **sperrt die Zeile** bis zum Commit.

        Die Sperre ist der Angelpunkt gegen das Rennen **Loeschen gegen
        Projektzuordnung** (docs/database.md, Abschnitt "Sperrreihenfolge"):
        Projektanlage und Kundenwechsel sperren dieselbe Zeile.

        Es wird **immer zuerst die Kundenzeile** gesperrt und erst danach auf
        Projekte zugegriffen. Diese Reihenfolge gilt auf beiden Seiten und
        schliesst Deadlocks aus.

        Der Mandantenfilter bleibt aktiv: Eine fremde ID liefert ``404``.
        """
        stmt = self.repository.query().where(Customer.id == customer_id).with_for_update()
        customer = self.session.execute(stmt).scalar_one_or_none()
        if customer is None:
            raise NotFoundError("Customer wurde nicht gefunden.")
        return customer

    def list_customers(
        self,
        *,
        page: int,
        page_size: int,
        search: str | None = None,
        kind: str | None = None,
        sort: CustomerSort = "created_at",
    ) -> OffsetPage[Customer]:
        """Nummerierte Seite von Kunden - gefiltert, stabil sortiert (ADR 0017).

        Die Basisabfrage ist bereits auf den Betrieb eingeschraenkt; Zaehlung
        und Seite teilen sie.
        """
        stmt = self.repository.query()
        if kind:
            stmt = stmt.where(Customer.kind == kind)
        if search:
            stmt = _apply_search(stmt, search)
        stmt = order_with_tiebreaker(
            stmt,
            sort_column=Customer.name if sort == "name" else Customer.created_at,
            id_column=Customer.id,
            descending=sort != "name",
        )
        return fetch_numbered_page(
            self.session,
            stmt,
            page=page,
            page_size=page_size,
            load=lambda seite: list(self.session.execute(seite).scalars().all()),
        )

    # ---------------------------------------------------------------- Aendern

    def create(self, payload: CustomerCreate, *, actor_user_id: uuid.UUID) -> Customer:
        customer = Customer(
            organization_id=self.organization_id,
            customer_number=next_number(
                self.session,
                organization_id=self.organization_id,
                definition=CUSTOMER_SEQUENCE,
            ),
            created_by_user_id=actor_user_id,
            updated_by_user_id=actor_user_id,
            **payload.model_dump(),
        )
        self.repository.add(customer)
        flush(self.session)
        return customer

    def update(
        self,
        customer_id: uuid.UUID,
        payload: CustomerUpdate,
        *,
        expected_version: int,
        actor_user_id: uuid.UUID,
    ) -> Customer:
        customer = self.repository.get_or_404(customer_id)
        check_version(customer, expected_version)
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(customer, field, value)
        customer.updated_by_user_id = actor_user_id
        flush(self.session)
        return customer

    def delete(self, customer: Customer) -> None:
        """Entfernt den Kunden **physisch** aus der operativen Datenbank.

        Erwartet einen ueber :meth:`get_for_update` **gesperrten** Datensatz,
        dessen Projektfreiheit der Aufrufer unter derselben Sperre geprueft hat
        (ADR 0020). Der Fremdschluessel ``projects -> customers`` (``RESTRICT``)
        sichert das zusaetzlich in der Datenbank.

        Die Kundennummer wird nicht wiederverwendet: Der Nummernkreis zaehlt
        nur hoch.
        """
        self.session.delete(customer)
        flush(self.session)


# ------------------------------------------------------------------- Helfer


def _apply_search(stmt: Select[tuple[Customer]], search: str) -> Select[tuple[Customer]]:
    """Freitextsuche ueber Name, Kundennummer und Ort.

    Bewusst ``ILIKE`` statt Volltextsuche: Der Bestand eines Betriebs liegt im
    vierstelligen Bereich; ein GIN-Index waere Aufwand ohne Messung
    (docs/database.md, Abschnitt 7).
    """
    pattern = f"%{search.strip()}%"
    return stmt.where(
        or_(
            Customer.name.ilike(pattern),
            Customer.customer_number.ilike(pattern),
            func.coalesce(Customer.billing_city, "").ilike(pattern),
        )
    )
