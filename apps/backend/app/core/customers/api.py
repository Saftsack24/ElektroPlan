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
    CUSTOMER_RECORD_ANONYMIZE,
    CUSTOMER_RECORD_DELETE,
    CUSTOMER_RECORD_READ,
    CUSTOMER_RECORD_WRITE,
)
from app.core.customers.schemas import (
    CustomerCreate,
    CustomerKind,
    CustomerOut,
    CustomerUpdate,
)
from app.core.customers.service import CustomerService, CustomerSort
from app.core.pagination import DEFAULT_LIMIT, Page, clamp_limit
from app.core.preconditions import check_version, require_if_match
from app.core.projects.service import count_projects_of_customer
from app.db.session import get_session
from app.errors import ConflictError, ProblemDetail

router = APIRouter(tags=["customers"])

_WRITE_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"model": ProblemDetail, "description": "Nicht gefunden"},
    409: {"model": ProblemDetail, "description": "Versionskonflikt"},
    428: {"model": ProblemDetail, "description": "If-Match fehlt"},
}


@router.get(
    "/customers",
    response_model=Page[CustomerOut],
    operation_id="listCustomers",
    summary="Kunden auflisten",
)
def list_customers(
    current_user: CurrentUser = Depends(require_permission(CUSTOMER_RECORD_READ)),
    session: Session = Depends(get_session),
    q: str | None = Query(default=None, max_length=120, description="Name, Nummer oder Ort"),
    kind: CustomerKind | None = Query(default=None),
    sort: CustomerSort = Query(default="created_at"),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=200),
    cursor: str | None = Query(default=None),
) -> Page[CustomerOut]:
    """Kunden der eigenen Organisation - gefiltert, sortiert, seitenweise."""
    service = CustomerService(session, current_user.organization_id)
    page = service.list_customers(
        limit=clamp_limit(limit), cursor=cursor, search=q, kind=kind, sort=sort
    )
    return Page[CustomerOut](
        items=[CustomerOut.model_validate(row) for row in page.items],
        next_cursor=page.next_cursor,
        has_more=page.has_more,
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
    return CustomerOut.model_validate(customer)


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
    return CustomerOut.model_validate(service.get(customer_id))


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
    return CustomerOut.model_validate(customer)


@router.delete(
    "/customers/{customer_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteCustomer",
    summary="Kunde ausblenden",
    responses=_WRITE_RESPONSES,
)
def delete_customer(
    customer_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(CUSTOMER_RECORD_DELETE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> None:
    """Blendet den Kunden aus (Soft Delete).

    Solange nicht geloeschte Projekte an ihm haengen, wird abgelehnt: Ein
    Projekt ohne auffindbaren Kunden waere ein unvollstaendiger Datensatz.

    **Sperre, Pruefung und Aenderung liegen in einer Transaktion.** Die
    Kundenzeile wird zuerst mit ``SELECT ... FOR UPDATE`` geladen; erst danach
    werden die Projekte gezaehlt. Eine gleichzeitige Projektanlage sperrt
    dieselbe Zeile und wartet deshalb - ein sichtbares Projekt an einem
    ausgeblendeten Kunden kann nicht entstehen (docs/database.md, Abschnitt
    "Sperrreihenfolge").
    """
    # Reihenfolge der Pruefungen: erst Existenz (404), dann Version (409
    # version-conflict), dann der fachliche Konflikt. Andernfalls verdeckt der
    # spaetere Fehler den frueheren.
    service = CustomerService(session, current_user.organization_id)
    customer = service.get_for_update(customer_id)
    check_version(customer, expected_version)
    open_projects = count_projects_of_customer(
        session, organization_id=current_user.organization_id, customer_id=customer_id
    )
    if open_projects:
        raise ConflictError(
            f"An diesem Kunden haengen noch {open_projects} Projekte. "
            "Bitte zuerst die Projekte ausblenden."
        )
    service.soft_delete(customer, actor_user_id=current_user.user_id)
    audit.record(
        session,
        organization_id=current_user.organization_id,
        action=audit.ACTION_CUSTOMER_DELETED,
        entity_type="customer",
        entity_id=customer_id,
        actor_user_id=current_user.user_id,
        summary=f"Kunde {customer.customer_number} ausgeblendet",
    )
    session.commit()


@router.post(
    "/customers/{customer_id}/anonymize",
    response_model=CustomerOut,
    operation_id="anonymizeCustomer",
    summary="Kundendaten anonymisieren",
    responses=_WRITE_RESPONSES,
)
def anonymize_customer(
    customer_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(CUSTOMER_RECORD_ANONYMIZE)),
    session: Session = Depends(get_session),
    expected_version: int = Depends(require_if_match),
) -> CustomerOut:
    """Setzt ein Loeschbegehren um (Art. 17 DSGVO).

    Die personenbezogenen Felder werden ueberschrieben; Kundennummer und
    Belegzuordnung bleiben erhalten, damit aufbewahrungspflichtige Dokumente
    nach HGB/AO zuordenbar bleiben. **Der Vorgang ist nicht umkehrbar.**
    """
    service = CustomerService(session, current_user.organization_id)
    customer = service.anonymize(
        customer_id,
        expected_version=expected_version,
        actor_user_id=current_user.user_id,
    )
    audit.record(
        session,
        organization_id=current_user.organization_id,
        action=audit.ACTION_CUSTOMER_ANONYMIZED,
        entity_type="customer",
        entity_id=customer.id,
        actor_user_id=current_user.user_id,
        summary=f"Kunde {customer.customer_number} anonymisiert",
        # Bewusst ohne die geloeschten Werte: Das Protokoll darf die
        # anonymisierten Daten nicht konservieren.
        data={"customer_number": customer.customer_number},
    )
    session.commit()
    return CustomerOut.model_validate(customer)
