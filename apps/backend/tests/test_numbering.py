"""Nummernkreise (docs/database.md, Abschnitt 3).

Die Vergabe ist der einzige Ort, an dem ein Parallelzugriff zu doppelten
Belegnummern fuehren koennte. Der Test mit zwei echten Threads und einer
Barriere prueft genau das - nicht nur die Formatierung.

Die Formattests laufen ohne Datenbank; die Vergabetests brauchen PostgreSQL
(``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import threading
import uuid
from datetime import date

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.numbering.models import NumberSequence
from app.core.numbering.service import (
    CUSTOMER_SEQUENCE,
    PROJECT_SEQUENCE,
    SequenceDefinition,
    next_number,
    peek_current_value,
)
from app.core.organizations.models import Organization
from tests.conftest import requires_database

# ------------------------------------------------------------ ohne Datenbank


def test_format_ohne_periode() -> None:
    assert CUSTOMER_SEQUENCE.format(1, "") == "KD-00001"
    assert CUSTOMER_SEQUENCE.format(12345, "") == "KD-12345"


def test_format_mit_jahresperiode() -> None:
    assert PROJECT_SEQUENCE.format(1, "2026") == "PR-2026-0001"
    assert PROJECT_SEQUENCE.format(9999, "2026") == "PR-2026-9999"


def test_periode_haengt_an_der_definition() -> None:
    tag = date(2026, 3, 7)
    assert CUSTOMER_SEQUENCE.period_for(tag) == ""
    assert PROJECT_SEQUENCE.period_for(tag) == "2026"


def test_ueberlauf_der_stellenzahl_bricht_nicht_ab() -> None:
    """Mehr Stellen als geplant sind haesslich, aber kein Datenverlust."""
    assert PROJECT_SEQUENCE.format(12345, "2026") == "PR-2026-12345"


# ------------------------------------------------------------- mit Datenbank


@pytest.fixture
def organisation(db_session: Session) -> uuid.UUID:
    organization = Organization(name="Elektro Nummern GmbH", slug=f"nr-{uuid.uuid4().hex[:8]}")
    db_session.add(organization)
    db_session.flush()
    return organization.id


@pytest.mark.database
@requires_database
def test_zaehlt_hoch(db_session: Session, organisation: uuid.UUID) -> None:
    erste = next_number(db_session, organization_id=organisation, definition=CUSTOMER_SEQUENCE)
    zweite = next_number(db_session, organization_id=organisation, definition=CUSTOMER_SEQUENCE)

    assert erste == "KD-00001"
    assert zweite == "KD-00002"


@pytest.mark.database
@requires_database
def test_kreise_sind_je_organisation_getrennt(db_session: Session) -> None:
    ids: list[uuid.UUID] = []
    for index in range(2):
        organization = Organization(
            name=f"Betrieb {index}", slug=f"b{index}-{uuid.uuid4().hex[:6]}"
        )
        db_session.add(organization)
        db_session.flush()
        ids.append(organization.id)

    erste = next_number(db_session, organization_id=ids[0], definition=CUSTOMER_SEQUENCE)
    zweite = next_number(db_session, organization_id=ids[1], definition=CUSTOMER_SEQUENCE)

    assert erste == zweite == "KD-00001"


@pytest.mark.database
@requires_database
def test_jahreskreis_beginnt_neu(db_session: Session, organisation: uuid.UUID) -> None:
    alt = next_number(
        db_session,
        organization_id=organisation,
        definition=PROJECT_SEQUENCE,
        today=date(2025, 12, 31),
    )
    neu = next_number(
        db_session,
        organization_id=organisation,
        definition=PROJECT_SEQUENCE,
        today=date(2026, 1, 1),
    )

    assert alt == "PR-2025-0001"
    assert neu == "PR-2026-0001"


@pytest.mark.database
@requires_database
def test_zaehlerstand_ist_ablesbar(db_session: Session, organisation: uuid.UUID) -> None:
    vorher = peek_current_value(
        db_session, organization_id=organisation, definition=CUSTOMER_SEQUENCE
    )
    next_number(db_session, organization_id=organisation, definition=CUSTOMER_SEQUENCE)
    nachher = peek_current_value(
        db_session, organization_id=organisation, definition=CUSTOMER_SEQUENCE
    )

    assert (vorher, nachher) == (0, 1)


@pytest.mark.database
@requires_database
def test_parallele_vergabe_erzeugt_keine_doppelte_nummer(
    engine: Engine, clean_database: None
) -> None:
    """Zwei echte Threads, gleicher Kreis, gleichzeitiger Start.

    Ohne Zeilensperre wuerden beide denselben Zaehlerstand lesen. Erwartet
    werden zwei **verschiedene** Nummern.

    Die Zeile des Kreises wird vorher **committet** angelegt. Geprueft wird
    damit genau die Sperre auf dem Zaehler - nicht zusaetzlich das Verhalten
    zweier gleichzeitiger Ersteinfuegungen, das PostgreSQL ueber den
    Primaerschluessel serialisiert und das den Test nur langsam und
    stoeranfaellig machen wuerde.
    """
    definition = SequenceDefinition(scope="test", prefix="TS", yearly=False, padding=4)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    setup = factory()
    try:
        organization = Organization(name="Elektro Parallel GmbH", slug="elektro-parallel")
        setup.add(organization)
        setup.flush()
        organization_id = organization.id
        setup.add(
            NumberSequence(
                organization_id=organization_id,
                scope=definition.scope,
                period="",
                current_value=0,
            )
        )
        setup.commit()
    finally:
        setup.close()

    barrier = threading.Barrier(2)
    ergebnisse: list[str] = []
    fehler: list[BaseException] = []
    schloss = threading.Lock()

    def vergeben() -> None:
        session = factory()
        try:
            barrier.wait(timeout=10)
            nummer = next_number(session, organization_id=organization_id, definition=definition)
            session.commit()
            with schloss:
                ergebnisse.append(nummer)
        except BaseException as exc:
            with schloss:
                fehler.append(exc)
            session.rollback()
        finally:
            session.close()

    # daemon=True: Ein haengender Thread darf den gesamten Testlauf nicht am
    # Beenden hindern - der Fehler wird stattdessen sichtbar behauptet.
    threads = [threading.Thread(target=vergeben, daemon=True) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert all(not thread.is_alive() for thread in threads), (
        "Ein Thread haengt - vermutlich blockiert die Zeilensperre laenger als erwartet."
    )
    assert not fehler, f"Unerwartete Fehler: {fehler}"
    assert sorted(ergebnisse) == ["TS-0001", "TS-0002"]
