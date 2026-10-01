"""Endpunkte des Kundenstamms.

Alle schreibenden Routen deklarieren ihre Permission explizit; aendernde
Routen verlangen zusaetzlich ``If-Match`` mit der gelesenen Version
(docs/api.md, Abschnitt 5).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.audit import service as audit
from app.core.auth.dependencies import CurrentUser, require_permission
from app.core.authorization.permissions import (
    CUSTOMER_RECORD_DELETE,
    CUSTOMER_RECORD_READ,
    CUSTOMER_RECORD_WRITE,
)
from app.core.customers.models import Customer
from app.core.customers.schemas import (
    CustomerCreate,
    CustomerKind,
    CustomerOut,
    CustomerUpdate,
)
from app.core.customers.service import CustomerService, CustomerSort
from app.core.pagination import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, NumberedPage
from app.core.preconditions import check_version, require_if_match
from app.core.projects.service import count_projects_of_customer
from app.core.users.references import UserReferenceResolver
from app.db.session import get_session
from app.errors import CustomerHasProjectsError, ProblemDetail

router = APIRouter(tags=["customers"])

_WRITE_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"model": ProblemDetail, "description": "Nicht gefunden"},
    409: {"model": ProblemDetail, "description": "Versionskonflikt"},
    428: {"model": ProblemDetail, "description": "If-Match fehlt"},
}


def _customer_out(customer: Customer, people: UserReferenceResolver) -> CustomerOut:
    return CustomerOut(
        id=customer.id,
        customer_number=customer.customer_number,
        kind=customer.kind,
        name=customer.name,
        contact_person=customer.contact_person,
        email=customer.email,
        phone=customer.phone,
        billing_street=customer.billing_street,
        billing_postal_code=customer.billing_postal_code,
        billing_city=customer.billing_city,
        billing_country_code=customer.billing_country_code,
        version=customer.version,
        created_at=customer.created_at,
        updated_at=customer.updated_at,
        created_by=people.reference(customer.created_by_user_id),
        updated_by=people.reference(customer.updated_by_user_id),
    )


def _single_out(session: Session, current_user: CurrentUser, customer: Customer) -> CustomerOut:
    people = UserReferenceResolver(session, current_user.organization_id).load(
        (customer.created_by_user_id, customer.updated_by_user_id)
    )
    return _customer_out(customer, people)


@router.get(
    "/customers",
    response_model=NumberedPage[CustomerOut],
    operation_id="listCustomers",
    summary="Kunden auflisten",
)
def list_customers(
    current_user: CurrentUser = Depends(require_permission(CUSTOMER_RECORD_READ)),
    session: Session = Depends(get_session),
    q: str | None = Query(default=None, max_length=120, description="Name, Nummer oder Ort"),
    kind: CustomerKind | None = Query(default=None),
    sort: CustomerSort = Query(default="created_at"),
    page: int = Query(default=1, ge=1, le=1_000_000, description="Seite, beginnend bei 1"),
    page_size: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
) -> NumberedPage[CustomerOut]:
    """Kunden der eigenen Organisation - gefiltert, sortiert, nummerierte Seiten.

    Eine Seite hinter der letzten liefert die letzte vorhandene Seite; das
    Feld ``page`` der Antwort nennt sie (ADR 0017).
    """
    service = CustomerService(session, current_user.organization_id)
    seite = service.list_customers(page=page, page_size=page_size, search=q, kind=kind, sort=sort)
    # Bearbeiter der ganzen Seite in **einer** Abfrage - kein N+1.
    people = UserReferenceResolver(session, current_user.organization_id).load(
        user_id
        for row in seite.items
        for user_id in (row.created_by_user_id, row.updated_by_user_id)
    )
    return NumberedPage[CustomerOut](
        items=[_customer_out(row, people) for row in seite.items],
        page=seite.page,
        page_size=seite.page_size,
        total_items=seite.total_items,
        total_pages=seite.total_pages,
    )


@router.post(
    "/customers",
    response_model=CustomerOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createCustomer",
    summary="Kunden anlegen",
)
def create_customer(
    payload: CustomerCreate,
    current_user: CurrentUser = Depends(require_permission(CUSTOMER_RECORD_WRITE)),
    session: Session = Depends(get_session),
) -> CustomerOut:
    """Legt einen Kunden an. Die Kundennummer vergibt der Nummernkreis."""
    service = CustomerService(session, current_user.organization_id)
    customer = service.create(payload, actor_user_id=current_user.user_id)
    audit.record(
        session,
        organization_id=current_user.organization_id,
        action=audit.ACTION_CUSTOMER_CREATED,
        entity_type="customer",
        entity_id=customer.id,
        actor_user_id=current_user.user_id,
        summary=f"Kunde {customer.customer_number} angelegt",
        data={"customer_number": customer.customer_number, "kind": customer.kind},
    )
    session.commit()
    return _single_out(session, current_user, customer)


@router.get(
    "/customers/{customer_id}",
    response_model=CustomerOut,
    operation_id="getCustomer",
    summary="Kunde",
    responses={404: {"model": ProblemDetail, "description": "Nicht gefunden"}},
)
def get_customer(
    customer_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(CUSTOMER_RECORD_READ)),
    session: Session = Depends(get_session),
) -> CustomerOut:
    """Ein Kunde der eigenen Organisation."""
    service = CustomerService(session, current_user.organization_id)
    return _single_out(session, current_user, service.get(customer_id))


@router.patch(
    "/customers/{customer_id}",
    response_model=CustomerOut,
    operation_id="updateCustomer",
    summary="Kunde bearbeiten",
    responses=_WRITE_RESPONSES,
)
def update_customer(
    customer_id: uuid.UUID,
    payload: CustomerUpdate,
    current_user: CurrentUser = Depends(require_permission(CUSTOMER_RECORD_WRITE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> CustomerOut:
    """Aendert einzelne Felder. Die Kundennummer bleibt unveraendert."""
    service = CustomerService(session, current_user.organization_id)
    customer = service.update(
        customer_id,
        payload,
        expected_version=expected_version,
        actor_user_id=current_user.user_id,
    )
    audit.record(
        session,
        organization_id=current_user.organization_id,
        action=audit.ACTION_CUSTOMER_UPDATED,
        entity_type="customer",
        entity_id=customer.id,
        actor_user_id=current_user.user_id,
        summary=f"Kunde {customer.customer_number} geaendert",
        data={"fields": sorted(payload.model_dump(exclude_unset=True))},
    )
    session.commit()
    return _single_out(session, current_user, customer)


@router.delete(
    "/customers/{customer_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteCustomer",
    summary="Kunden endgueltig loeschen",
    responses={
        403: {"model": ProblemDetail, "description": "Berechtigung fehlt"},
        404: {"model": ProblemDetail, "description": "Nicht gefunden"},
        409: {
            "model": ProblemDetail,
            "description": "Versionskonflikt oder dem Kunden sind Projekte zugeordnet",
        },
        428: {"model": ProblemDetail, "description": "If-Match fehlt"},
    },
)
def delete_customer(
    customer_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(CUSTOMER_RECORD_DELETE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> None:
    """Loescht den Kunden **physisch** aus der operativen Datenbank (ADR 0020).

    Nur Administratoren, und nur wenn dem Kunden **kein einziges** Projekt
    zugeordnet ist - gleich in welchem Status.
    Sonst ``409 customer-has-projects``.

    **Sperre, Pruefung und Loeschung liegen in einer Transaktion.** Die
    Kundenzeile wird zuerst gesperrt; eine gleichzeitige Projektanlage oder ein
    Kundenwechsel sperrt dieselbe Zeile und wartet. Danach findet sie den
    Kunden nicht mehr (``404``) - ein Projekt ohne Kunden kann nicht entstehen.

    Das Protokoll haelt nur Kunden-ID und Kundennummer fest, keine
    personenbezogenen Daten. Die Kundennummer wird nie wiederverwendet.
    Backups enthalten den Datensatz bis zum Ablauf ihrer Aufbewahrungsfrist
    (docs/security.md, Abschnitt 13).
    """
    # Reihenfolge: erst Existenz (404), dann Version (409 version-conflict),
    # dann der fachliche Konflikt.
    service = CustomerService(session, current_user.organization_id)
    customer = service.get_for_update(customer_id)
    check_version(customer, expected_version)
    assigned = count_projects_of_customer(
        session, organization_id=current_user.organization_id, customer_id=customer_id
    )
    if assigned:
        raise CustomerHasProjectsError(
            f"Dem Kunden {customer.customer_number} sind noch {assigned} Projekt(e) "
            "zugeordnet - auch abgeschlossene oder archivierte zaehlen. Ein Kunde laesst "
            "sich nur loeschen, wenn ihm kein Projekt mehr zugeordnet ist."
        )
    customer_number = customer.customer_number
    service.delete(customer)
    audit.record(
        session,
        organization_id=current_user.organization_id,
        action=audit.ACTION_CUSTOMER_DELETED,
        entity_type="customer",
        entity_id=customer_id,
        actor_user_id=current_user.user_id,
        summary=f"Kunde {customer_number} endgueltig geloescht",
        # Bewusst nur die Nummer: kein Name, keine Adresse, keine E-Mail.
        data={"customer_number": customer_number},
    )
    session.commit()
