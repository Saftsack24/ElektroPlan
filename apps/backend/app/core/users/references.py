"""Wer hat angelegt, wer zuletzt geaendert - lesbar und mandantensicher.

Kunden und Projekte fuehren ``created_by_user_id`` und ``updated_by_user_id``
(Fremdschluessel auf ``users.id`` mit ``ON DELETE SET NULL``). Benutzer sind
globale Identitaeten (ADR 0006). Deshalb gilt beim Anzeigen:

* **Mitglied dieses Betriebs** (auch gesperrt): Anzeigename.
* **Kein Mitglied dieses Betriebs**: kein Name, keine ID - sonst liesse sich
  ueber einen Datensatz auf Personen eines anderen Mandanten schliessen.
* **Kein Benutzer** (Bestandsdaten vor Phase 4d, geloeschtes Konto,
  Systemvorgang): ``system``.

Aufgeloest wird **gesammelt** in einer Abfrage je Liste - nie je Zeile.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.organizations.models import OrganizationMember
from app.core.users.models import User

UserReferenceKind = Literal["member", "unknown", "system"]


class UserReference(BaseModel):
    """Bearbeiter eines Datensatzes, wie die Oberflaeche ihn zeigen darf."""

    kind: UserReferenceKind
    #: Nur bei ``member`` gesetzt.
    user_id: uuid.UUID | None = None
    #: Anzeigename, nur bei ``member`` gesetzt - bewusst nicht die E-Mail.
    display_name: str | None = None


SYSTEM_REFERENCE = UserReference(kind="system")
UNKNOWN_REFERENCE = UserReference(kind="unknown")


class UserReferenceResolver:
    """Loest Benutzer-IDs eines Betriebs gesammelt auf."""

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self._session = session
        self._organization_id = organization_id
        self._names: dict[uuid.UUID, str] = {}

    def load(self, user_ids: Iterable[uuid.UUID | None]) -> UserReferenceResolver:
        """Laedt alle noch unbekannten IDs in **einer** Abfrage."""
        wanted = {user_id for user_id in user_ids if user_id is not None} - set(self._names)
        if wanted:
            rows = self._session.execute(
                select(User.id, User.full_name)
                .join(
                    OrganizationMember,
                    (OrganizationMember.user_id == User.id)
                    & (OrganizationMember.organization_id == self._organization_id),
                )
                .where(User.id.in_(wanted))
            ).all()
            self._names.update({row[0]: row[1] for row in rows})
        return self

    def reference(self, user_id: uuid.UUID | None) -> UserReference:
        """Referenz fuer eine bereits geladene ID."""
        if user_id is None:
            return SYSTEM_REFERENCE
        name = self._names.get(user_id)
        if name is None:
            return UNKNOWN_REFERENCE
        return UserReference(kind="member", user_id=user_id, display_name=name)
