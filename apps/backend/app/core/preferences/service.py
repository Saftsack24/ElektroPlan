"""Eigene Einstellungen lesen, erstmalig anlegen, versioniert aendern (ADR 0021).

Der Dienst kennt nur **eine** Mitgliedschaft - die aus dem Access Token. Es
gibt keinen Weg, die Einstellungen einer anderen Person zu lesen oder zu
aendern; auch Administratoren haben keinen.

Anlage und Aenderung sind getrennte Operationen statt eines ungeschuetzten
Upserts:

* ``create`` nur, solange kein Datensatz existiert. Zwei Geraete, die
  gleichzeitig zum ersten Mal speichern, legen nicht zwei an - die eindeutige
  Constraint laesst genau eines zu, das andere erhaelt ``409
  preferences-exist`` und uebernimmt den Serverstand.
* ``replace`` nur mit ``If-Match``. Die Zeile wird gesperrt und die Version
  unter der Sperre geprueft; zwei Geraete mit derselben Version: genau eines
  gewinnt, das andere erhaelt ``409 version-conflict``.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.persistence import flush, unique_violation_translated
from app.core.preconditions import check_version
from app.core.preferences.models import PREFERENCES_MEMBER_CONSTRAINT, UserPreferences
from app.core.preferences.schemas import PreferencesIn
from app.errors import NotFoundError, PreferencesExistError

_EXISTS = (
    "Fuer dieses Konto sind bereits Einstellungen gespeichert. Bitte den aktuellen Stand "
    "laden und erneut aendern."
)


class PreferencesService:
    """Einstellungen der Mitgliedschaft des Anfragenden. Committet nicht selbst."""

    def __init__(
        self, session: Session, *, organization_id: uuid.UUID, member_id: uuid.UUID
    ) -> None:
        self.session = session
        self.organization_id = organization_id
        self.member_id = member_id

    def get(self) -> UserPreferences | None:
        return self._select(lock=False)

    def create(self, values: PreferencesIn) -> UserPreferences:
        if self._select(lock=False) is not None:
            raise PreferencesExistError(_EXISTS)
        record = UserPreferences(
            organization_id=self.organization_id,
            member_id=self.member_id,
            theme_mode=values.theme_mode,
            accent=values.accent,
            length_unit=values.length_unit,
        )
        self.session.add(record)
        with unique_violation_translated(
            self.session,
            constraint=PREFERENCES_MEMBER_CONSTRAINT,
            error=PreferencesExistError(_EXISTS),
        ):
            self.session.flush()
        return record

    def replace(self, values: PreferencesIn, *, expected_version: int) -> UserPreferences:
        record = self._select(lock=True)
        if record is None:
            raise NotFoundError("Es sind noch keine Einstellungen gespeichert.")
        check_version(record, expected_version)
        record.theme_mode = values.theme_mode
        record.accent = values.accent
        record.length_unit = values.length_unit
        flush(self.session)
        return record

    def _select(self, *, lock: bool) -> UserPreferences | None:
        stmt = (
            select(UserPreferences)
            .where(
                UserPreferences.organization_id == self.organization_id,
                UserPreferences.member_id == self.member_id,
            )
            .execution_options(populate_existing=True)
        )
        if lock:
            stmt = stmt.with_for_update()
        return self.session.execute(stmt).scalar_one_or_none()
