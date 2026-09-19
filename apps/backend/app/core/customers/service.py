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
from app.core.pagination import (
    KeysetPage,
    apply_keyset,
    build_keyset_page,
    parse_datetime_key,
    parse_text_key,
)
from app.core.persistence import flush
from app.core.preconditions import check_version
from app.core.tenancy.repository import TenantRepository
from app.db.mixins import utcnow
from app.errors import ConflictError, NotFoundError

CustomerSort = Literal["created_at", "name"]

#: Platzhalter nach der Anonymisierung. Bewusst ohne Bezug zur Person - der
#: Datensatz bleibt nur als Belegzuordnung bestehen.
ANONYMIZED_NAME = "Geloeschter Kunde"


class CustomerRepository(TenantRepository[Customer]):
    model = Customer


class CustomerService:
    """Anlegen, Aendern, Ausblenden und Anonymisieren von Kunden."""

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self.session = session
        self.organization_id = organization_id
        self.repository = CustomerRepository(session, organization_id)

    # ------------------------------------------------------------------ Lesen

    def get(self, customer_id: uuid.UUID) -> Customer:
        return self.repository.get_or_404(customer_id)

    def get_for_update(self, customer_id: uuid.UUID) -> Customer:
        """Laedt den Kunden und **sperrt die Zeile** bis zum Commit.

        Die Sperre ist der Angelpunkt gegen zwei Rennen (docs/database.md,
        Abschnitt "Sperrreihenfolge"):

        * Ausblenden gegen Projektanlage - sonst entstuende ein sichtbares
          Projekt an einem ausgeblendeten Kunden.
        * Anonymisieren gegen Projektzuordnung - sonst haenge eine neue
          Zuordnung an einem bereits anonymisierten Kunden.

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
        limit: int,
        cursor: str | None = None,
        search: str | None = None,
        kind: str | None = None,
        sort: CustomerSort = "created_at",
    ) -> KeysetPage[Customer]:
        """Seite von Kunden - gefiltert, sortiert, cursorbasiert."""
        stmt = self.repository.query()
        if kind:
            stmt = stmt.where(Customer.kind == kind)
        if search:
            stmt = _apply_search(stmt, search)

        if sort == "name":
            stmt = apply_keyset(
                stmt,
                sort_column=Customer.name,
                id_column=Customer.id,
                descending=False,
                cursor=cursor,
                parse_key=parse_text_key,
            )
        else:
            stmt = apply_keyset(
                stmt,
                sort_column=Customer.created_at,
                id_column=Customer.id,
                descending=True,
                cursor=cursor,
                parse_key=parse_datetime_key,
            )

        rows = list(self.session.execute(stmt.limit(limit + 1)).scalars().all())
        return build_keyset_page(
            rows,
            limit=limit,
            key_of=lambda row: _sort_value(row, sort),
            id_of=lambda row: row.id,
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
        _require_not_anonymized(customer)
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(customer, field, value)
        customer.updated_by_user_id = actor_user_id
        flush(self.session)
        return customer

    def soft_delete(self, customer: Customer, *, actor_user_id: uuid.UUID) -> Customer:
        """Blendet den Kunden aus. Bestehende Belege bleiben zuordenbar.

        Erwartet einen bereits ueber :meth:`get_for_update` **gesperrten**
        Datensatz. Nur so bleiben Sperre, Projektpruefung und Aenderung in
        derselben Transaktion - und genau das schliesst das Rennen gegen eine
        gleichzeitige Projektanlage.
        """
        customer.deleted_at = utcnow()
        customer.updated_by_user_id = actor_user_id
        flush(self.session)
        return customer

    def anonymize(
        self, customer_id: uuid.UUID, *, expected_version: int, actor_user_id: uuid.UUID
    ) -> Customer:
        """Setzt ein Loeschbegehren um (Art. 17 DSGVO).

        Die personenbezogenen Felder werden ueberschrieben; Kundennummer und
        Anlagezeitpunkt bleiben stehen. Damit bleiben aufbewahrungspflichtige
        Belege (HGB/AO) zuordenbar, ohne die Person weiter zu fuehren.

        Die Kundenzeile wird dabei **gesperrt** (siehe
        :meth:`get_for_update`). Eine gleichzeitige Projektzuordnung an
        denselben Kunden wartet damit: Entweder sie ist zuerst fertig und die
        Anonymisierung behaelt die bestehende Referenz, oder die
        Anonymisierung gewinnt und die Zuordnung wird abgelehnt.

        Ausblenden und Anonymisieren sind **zwei getrennte Vorgaenge**:
        ``deleted_at`` steuert die Sichtbarkeit, ``anonymized_at`` den
        Personenbezug. Die Anonymisierung blendet den Datensatz deshalb nicht
        zusaetzlich aus - er bleibt als Zuordnung bestehen und zeigt in Listen
        den Platzhalternamen. Wer ihn auch aus den Listen nehmen will, blendet
        ihn zusaetzlich aus.

        Der Vorgang ist **nicht umkehrbar** und wird protokolliert.
        """
        customer = self.get_for_update(customer_id)
        check_version(customer, expected_version)
        _require_not_anonymized(customer)
        customer.name = ANONYMIZED_NAME
        customer.contact_person = None
        customer.email = None
        customer.phone = None
        customer.billing_street = None
        customer.billing_postal_code = None
        customer.billing_city = None
        customer.anonymized_at = utcnow()
        customer.updated_by_user_id = actor_user_id
        flush(self.session)
        return customer


# ------------------------------------------------------------------- Helfer


def _require_not_anonymized(customer: Customer) -> None:
    """Ein anonymisierter Datensatz wird nicht mehr veraendert.

    Sonst liessen sich die geloeschten Angaben ueber ein ``PATCH`` wieder
    eintragen - die Loeschung waere damit wirkungslos.
    """
    if customer.anonymized_at is not None:
        raise ConflictError("Dieser Kunde wurde anonymisiert und kann nicht mehr geaendert werden.")


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


def _sort_value(customer: Customer, sort: CustomerSort) -> str:
    return customer.name if sort == "name" else customer.created_at.isoformat()
