"""Wer hat angelegt, wer zuletzt geaendert - lesbar und mandantensicher.

Kunden und Projekte fuehren ``created_by_user_id`` und ``updated_by_user_id``
(Fremdschluessel auf ``users.id`` mit ``ON DELETE SET NULL``). Benutzer sind
globale Identitaeten (ADR 0006). Deshalb gilt beim Anzeigen:

* **Mitglied dieses Betriebs** (auch gesperrt): Anzeigename.
* **Entferntes Mitglied dieses Betriebs** (Phase 4e, ADR 0021): "Entfernter
  Benutzer" - ohne Name und ohne ID, auch wenn das Konto fuer einen anderen
  Betrieb noch besteht. Die Referenz bleibt so aufloesbar, ohne die Person
  preiszugeben.
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

from app.core.organizations.models import MEMBER_STATUS_REMOVED, OrganizationMember
from app.core.users.models import User

UserReferenceKind = Literal["member", "removed", "unknown", "system"]


class UserReference(BaseModel):
    """Bearbeiter eines Datensatzes, wie die Oberflaeche ihn zeigen darf."""

    kind: UserReferenceKind
    #: Nur bei ``member`` gesetzt.
    user_id: uuid.UUID | None = None
    #: Anzeigename, nur bei ``member`` gesetzt - bewusst nicht die E-Mail.
    display_name: str | None = None


SYSTEM_REFERENCE = UserReference(kind="system")
UNKNOWN_REFERENCE = UserReference(kind="unknown")
REMOVED_REFERENCE = UserReference(kind="removed")


class UserReferenceResolver:
    """Loest Benutzer-IDs eines Betriebs gesammelt auf."""

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self._session = session
        self._organization_id = organization_id
        self._names: dict[uuid.UUID, str] = {}
        self._removed: set[uuid.UUID] = set()
        self._loaded: set[uuid.UUID] = set()

    def load(self, user_ids: Iterable[uuid.UUID | None]) -> UserReferenceResolver:
        """Laedt alle noch unbekannten IDs in **einer** Abfrage.

        Hat dieselbe Person neben einer entfernten auch wieder eine aktuelle
        Mitgliedschaft (erneut eingeladen), gilt die aktuelle.
        """
        wanted = {user_id for user_id in user_ids if user_id is not None} - self._loaded
        if wanted:
            rows = self._session.execute(
                select(User.id, User.full_name, OrganizationMember.status)
                .join(
                    OrganizationMember,
                    (OrganizationMember.user_id == User.id)
                    & (OrganizationMember.organization_id == self._organization_id),
                )
                .where(User.id.in_(wanted))
            ).all()
            for user_id, full_name, status in rows:
                if status == MEMBER_STATUS_REMOVED:
                    self._removed.add(user_id)
                else:
                    self._names[user_id] = full_name
            self._loaded |= wanted
        return self

    def reference(self, user_id: uuid.UUID | None) -> UserReference:
        """Referenz fuer eine bereits geladene ID."""
        if user_id is None:
            return SYSTEM_REFERENCE
        name = self._names.get(user_id)
        if name is None:
            return REMOVED_REFERENCE if user_id in self._removed else UNKNOWN_REFERENCE
        return UserReference(kind="member", user_id=user_id, display_name=name)
