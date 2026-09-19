"""Echte Parallelitaet gegen PostgreSQL (Phase 2.1).

Drei Rennen lassen sich mit einer Vorabpruefung allein nicht schliessen. Sie
werden hier mit **zwei getrennten Sessions in zwei Threads** und einer
Barriere nachgestellt - nicht mit Zufall, sondern mit expliziter
Synchronisation:

1. **Verlorene Aktualisierung.** Beide lesen Version 1 und bestehen
   ``check_version``. Genau einer gewinnt; der andere muss einen
   kontrollierten Versionskonflikt erhalten, keinen rohen ``StaleDataError``
   und keinen ``500``.
2. **Kunde ausblenden gegen Projekt anlegen.** Es darf niemals ein
   sichtbares Projekt an einem ausgeblendeten Kunden entstehen.
3. **Geschossebene doppelt.** Pro Gebaeude darf eine Ebene genau einmal
   existieren - auch wenn zwei Anfragen die Vorpruefung gleichzeitig
   bestehen.

Jeder Test prueft am Ende den **Datenbankzustand**, nicht nur den Rueckgabe-
wert. Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import pytest
from sqlalchemy import Engine, event, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.orm.exc import StaleDataError

from app.core.customers.models import Customer
from app.core.customers.schemas import CustomerUpdate
from app.core.customers.service import CustomerService
from app.core.persistence import CONCURRENT_UPDATE_DETAIL
from app.core.projects.models import Building, Floor, Project
from app.core.projects.schemas import FloorCreate, FloorUpdate, ProjectCreate
from app.core.projects.service import ProjectService, count_projects_of_customer
from app.errors import (
    AppError,
    ConflictError,
    NotFoundError,
    ValidationFailedError,
    VersionConflictError,
)
from tests.conftest import requires_database

pytestmark = [requires_database, pytest.mark.database]

#: Handelnder Benutzer. Die Geschaeftsentitaeten fuehren
#: ``created_by_user_id`` als Fremdschluessel auf ``users`` - der Akteur muss
#: also wirklich existieren. Die ID ist fest, damit die Hilfsfunktionen ohne
#: zusaetzlichen Parameter auskommen.
ACTOR = uuid.UUID("11111111-2222-3333-4444-555555555555")


# --------------------------------------------------------------- Werkzeuge


@dataclass
class ParallelLauf:
    """Ergebnis zweier gleichzeitig ausgefuehrter Arbeitsschritte."""

    erfolge: list[str] = field(default_factory=list)
    fehler: list[BaseException] = field(default_factory=list)

    @property
    def fehlerklassen(self) -> list[type[BaseException]]:
        return [type(fehler) for fehler in self.fehler]


def gleichzeitig(
    factory: sessionmaker[Session],
    arbeit: Callable[[Session, str], str],
    namen: tuple[str, str] = ("A", "B"),
) -> ParallelLauf:
    """Fuehrt ``arbeit`` in zwei Threads mit je eigener Session aus.

    Die Barriere sitzt **in** ``arbeit``, damit jeder Test selbst bestimmt, an
    welcher Stelle beide Seiten aufeinander warten.
    """
    lauf = ParallelLauf()
    schloss = threading.Lock()

    def ausfuehren(name: str) -> None:
        session = factory()
        try:
            lauf_ergebnis = arbeit(session, name)
            session.commit()
            with schloss:
                lauf.erfolge.append(lauf_ergebnis)
        except BaseException as exc:
            session.rollback()
            with schloss:
                lauf.fehler.append(exc)
        finally:
            session.close()

    # daemon=True: Ein haengender Thread darf den Testlauf nicht blockieren.
    threads = [threading.Thread(target=ausfuehren, args=(name,), daemon=True) for name in namen]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert all(not thread.is_alive() for thread in threads), (
        "Ein Thread haengt - vermutlich wartet eine Zeilensperre laenger als erwartet."
    )
    return lauf


@pytest.fixture
def factory(engine: Engine, clean_database: None) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture
def organisation(factory: sessionmaker[Session]) -> uuid.UUID:
    """Ein Betrieb samt handelndem Benutzer - synthetische Testdaten."""
    from app.core.auth.security import hash_password
    from app.core.organizations.models import Organization
    from app.core.users.models import User

    session = factory()
    try:
        organization = Organization(name="Elektro Parallel GmbH", slug="elektro-parallel")
        session.add(organization)
        session.add(
            User(
                id=ACTOR,
                email="parallel@test.example",
                password_hash=hash_password("test-passwort-1234"),
                full_name="Paula Parallel",
            )
        )
        session.commit()
        return organization.id
    finally:
        session.close()


def _kunde_anlegen(
    factory: sessionmaker[Session], organization_id: uuid.UUID, *, name: str = "Bauherr Beispiel"
) -> uuid.UUID:
    session = factory()
    try:
        service = CustomerService(session, organization_id)
        from app.core.customers.schemas import CustomerCreate

        customer = service.create(CustomerCreate(name=name), actor_user_id=ACTOR)
        session.commit()
        return customer.id
    finally:
        session.close()


def _gebaeude_anlegen(
    factory: sessionmaker[Session], organization_id: uuid.UUID, customer_id: uuid.UUID
) -> uuid.UUID:
    from app.core.projects.schemas import BuildingCreate

    session = factory()
    try:
        service = ProjectService(session, organization_id)
        project = service.create(
            ProjectCreate(customer_id=customer_id, name="Neubau"), actor_user_id=ACTOR
        )
        building = service.create_building(project.id, BuildingCreate(name="Haupthaus"))
        session.commit()
        return building.id
    finally:
        session.close()


# ------------------------------------- 1. Verlorene Aktualisierung (409)


def test_paralleles_update_liefert_genau_einen_versionskonflikt(
    factory: sessionmaker[Session], organisation: uuid.UUID
) -> None:
    """Beide lesen Version 1, beide bestehen ``check_version``.

    Erwartet: genau ein Gewinner, genau ein ``VersionConflictError`` - kein
    roher ``StaleDataError``, keine zwei Gewinner, kein Versionssprung.

    Der Test ist **nicht** zeitabhaengig: Beide Seiten laden den Datensatz
    vor der Barriere in ihre Session. Das erneute Lesen in ``update`` trifft
    danach die Identity Map und liefert weiterhin Version 1 - der Konflikt
    faellt also zwingend erst beim Schreiben auf. Genau das belegt die
    Meldung des Verlierers.
    """
    customer_id = _kunde_anlegen(factory, organisation)
    barriere = threading.Barrier(2, timeout=15)

    def aendern(session: Session, name: str) -> str:
        service = CustomerService(session, organisation)
        # Beide lesen denselben Stand ...
        customer = service.get(customer_id)
        assert customer.version == 1
        # ... und starten erst danach gemeinsam.
        barriere.wait()
        service.update(
            customer_id,
            CustomerUpdate(billing_city=f"Stadt {name}"),
            expected_version=1,
            actor_user_id=ACTOR,
        )
        return name

    lauf = gleichzeitig(factory, aendern)

    assert len(lauf.erfolge) == 1, f"Genau eine Aenderung darf gewinnen: {lauf.erfolge}"
    assert len(lauf.fehler) == 1
    verlierer = lauf.fehler[0]
    assert isinstance(verlierer, VersionConflictError), (
        f"Erwartet wurde ein fachlicher Versionskonflikt, erhalten: {verlierer!r}"
    )
    assert not isinstance(verlierer, StaleDataError)
    assert verlierer.status_code == 409
    assert verlierer.error_type == "version-conflict"
    # Diese Meldung entsteht ausschliesslich aus der Uebersetzung des
    # StaleDataError. Waere der Konflikt schon im Vorabvergleich aufgefallen,
    # stuende hier die Meldung von check_version.
    assert verlierer.detail == CONCURRENT_UPDATE_DETAIL

    # Datenbankzustand: genau eine Aenderung, Version genau einmal weitergezaehlt.
    session = factory()
    try:
        gespeichert = session.get(Customer, customer_id)
        assert gespeichert is not None
        assert gespeichert.version == 2
        assert gespeichert.billing_city == f"Stadt {lauf.erfolge[0]}"
    finally:
        session.close()


def test_versionskonflikt_nennt_keine_datenbankinterna(
    factory: sessionmaker[Session], organisation: uuid.UUID
) -> None:
    """Die Antwort darf keine SQLAlchemy- oder SQL-Details enthalten."""
    customer_id = _kunde_anlegen(factory, organisation)
    barriere = threading.Barrier(2, timeout=15)

    def aendern(session: Session, name: str) -> str:
        service = CustomerService(session, organisation)
        service.get(customer_id)
        barriere.wait()
        service.update(
            customer_id,
            CustomerUpdate(billing_city=f"Stadt {name}"),
            expected_version=1,
            actor_user_id=ACTOR,
        )
        return name

    lauf = gleichzeitig(factory, aendern)
    problem = lauf.fehler[0].to_problem()  # type: ignore[attr-defined]
    roh = problem.model_dump_json()

    for verboten in ("UPDATE", "customers.version", "StaleDataError", "sqlalchemy", "psycopg"):
        assert verboten not in roh, f"{verboten!r} steht in der Antwort: {roh}"


@pytest.mark.parametrize("entitaet", ["building", "floor"])
def test_dieselbe_behandlung_gilt_fuer_alle_versionierten_entitaeten(
    factory: sessionmaker[Session], organisation: uuid.UUID, entitaet: str
) -> None:
    """Gebaeude und Geschoss laufen ueber dieselbe Infrastruktur.

    Geprueft wird der Verlierer eines echten Parallelschreibens - also der
    Pfad ueber ``version_id_col``, nicht nur die Vorabpruefung.
    """
    customer_id = _kunde_anlegen(factory, organisation)
    building_id = _gebaeude_anlegen(factory, organisation, customer_id)

    if entitaet == "floor":
        session = factory()
        try:
            service = ProjectService(session, organisation)
            floor = service.create_floor(building_id, FloorCreate(name="Erdgeschoss", level=0))
            session.commit()
            ziel_id = floor.id
        finally:
            session.close()
    else:
        ziel_id = building_id

    barriere = threading.Barrier(2, timeout=15)

    def aendern(session: Session, name: str) -> str:
        from app.core.projects.schemas import BuildingUpdate

        service = ProjectService(session, organisation)
        if entitaet == "floor":
            service.floors.get_or_404(ziel_id)
            barriere.wait()
            service.update_floor(ziel_id, FloorUpdate(name=f"Ebene {name}"), expected_version=1)
        else:
            service.buildings.get_or_404(ziel_id)
            barriere.wait()
            service.update_building(
                ziel_id, BuildingUpdate(name=f"Haus {name}"), expected_version=1
            )
        return name

    lauf = gleichzeitig(factory, aendern)

    assert len(lauf.erfolge) == 1
    assert isinstance(lauf.fehler[0], VersionConflictError)

    session = factory()
    try:
        modell = Floor if entitaet == "floor" else Building
        gespeichert = session.get(modell, ziel_id)
        assert gespeichert is not None
        assert gespeichert.version == 2
    finally:
        session.close()


# ------------------------- 2. Kunde ausblenden gegen Projekt anlegen


def test_ausblenden_und_projektanlage_enden_immer_konsistent(
    factory: sessionmaker[Session], organisation: uuid.UUID
) -> None:
    """Der Kern von Phase 2.1.

    Nur zwei Ergebnisse sind zulaessig:

    * Projektanlage gewinnt -> Ausblenden scheitert mit ``409``.
    * Ausblenden gewinnt     -> Projektanlage scheitert mit ``404``.

    Verboten ist: ausgeblendeter Kunde **und** sichtbares Projekt.
    """
    customer_id = _kunde_anlegen(factory, organisation)
    barriere = threading.Barrier(2, timeout=15)

    def arbeiten(session: Session, name: str) -> str:
        customers = CustomerService(session, organisation)
        projects = ProjectService(session, organisation)
        # Beide Seiten stehen am selben Startpunkt, bevor gesperrt wird.
        barriere.wait()
        if name == "ausblenden":
            customer = customers.get_for_update(customer_id)
            offen = count_projects_of_customer(
                session, organization_id=organisation, customer_id=customer_id
            )
            if offen:
                raise ConflictError(f"Noch {offen} Projekte am Kunden.")
            customers.soft_delete(customer, actor_user_id=ACTOR)
        else:
            projects.create(
                ProjectCreate(customer_id=customer_id, name="Neubau"), actor_user_id=ACTOR
            )
        return name

    lauf = gleichzeitig(factory, arbeiten, namen=("ausblenden", "projekt"))

    assert len(lauf.erfolge) == 1, (
        f"Genau eine Seite darf gewinnen. Erfolge={lauf.erfolge}, Fehler={lauf.fehler}"
    )
    verlierer = lauf.fehler[0]
    assert isinstance(verlierer, AppError)

    session = factory()
    try:
        kunde = session.get(Customer, customer_id)
        assert kunde is not None
        anzahl_projekte = session.execute(
            select(func.count()).where(
                Project.customer_id == customer_id, Project.deleted_at.is_(None)
            )
        ).scalar_one()

        if lauf.erfolge[0] == "projekt":
            # Projekt gewonnen: Kunde bleibt sichtbar, Ausblenden war 409.
            assert kunde.deleted_at is None
            assert anzahl_projekte == 1
            assert isinstance(verlierer, ConflictError)
            assert verlierer.status_code == 409
        else:
            # Ausblenden gewonnen: kein Projekt entstanden, Anlage war 404.
            assert kunde.deleted_at is not None
            assert anzahl_projekte == 0
            assert isinstance(verlierer, NotFoundError)
            assert verlierer.status_code == 404

        # Die verbotene Kombination darf in keinem Fall eintreten.
        assert not (kunde.deleted_at is not None and anzahl_projekte > 0)
    finally:
        session.close()


def test_anonymisieren_und_projektanlage_enden_immer_konsistent(
    factory: sessionmaker[Session], organisation: uuid.UUID
) -> None:
    """Dieselbe Sperre schuetzt auch die Anonymisierung.

    Entweder die Zuordnung ist zuerst fertig und die Anonymisierung behaelt
    die bestehende Referenz, oder die Anonymisierung gewinnt und die neue
    Zuordnung wird abgelehnt.
    """
    customer_id = _kunde_anlegen(factory, organisation, name="Erika Musterfrau")
    barriere = threading.Barrier(2, timeout=15)

    def arbeiten(session: Session, name: str) -> str:
        customers = CustomerService(session, organisation)
        projects = ProjectService(session, organisation)
        barriere.wait()
        if name == "anonymisieren":
            customers.anonymize(customer_id, expected_version=1, actor_user_id=ACTOR)
        else:
            projects.create(
                ProjectCreate(customer_id=customer_id, name="Neubau"), actor_user_id=ACTOR
            )
        return name

    lauf = gleichzeitig(factory, arbeiten, namen=("anonymisieren", "projekt"))

    session = factory()
    try:
        kunde = session.get(Customer, customer_id)
        assert kunde is not None
        projekte = session.execute(
            select(func.count()).where(Project.customer_id == customer_id)
        ).scalar_one()

        if "anonymisieren" in lauf.erfolge and "projekt" in lauf.erfolge:
            # Beide koennen gewinnen - aber nur in dieser Reihenfolge:
            # erst die Zuordnung, dann die Anonymisierung.
            assert kunde.anonymized_at is not None
            assert projekte == 1
        elif lauf.erfolge == ["anonymisieren"]:
            assert kunde.anonymized_at is not None
            assert projekte == 0
            assert isinstance(lauf.fehler[0], NotFoundError)
        else:
            assert projekte == 1

        # Personenbezug ist nach der Anonymisierung in jedem Fall weg.
        if kunde.anonymized_at is not None:
            assert "Musterfrau" not in kunde.name
            assert kunde.email is None
    finally:
        session.close()


def test_kundenzeile_wird_bei_projektanlage_gesperrt(
    factory: sessionmaker[Session], organisation: uuid.UUID, engine: Engine
) -> None:
    """Belegt am tatsaechlich abgesetzten SQL, dass ``FOR UPDATE`` laeuft."""
    customer_id = _kunde_anlegen(factory, organisation)
    anweisungen: list[str] = []

    def mitschreiben(
        conn: Any, cursor: Any, statement: str, parameters: Any, context: Any, executemany: bool
    ) -> None:
        anweisungen.append(" ".join(statement.split()))

    event.listen(engine, "before_cursor_execute", mitschreiben)
    session = factory()
    try:
        ProjectService(session, organisation).create(
            ProjectCreate(customer_id=customer_id, name="Neubau"), actor_user_id=ACTOR
        )
        session.commit()
    finally:
        session.close()
        event.remove(engine, "before_cursor_execute", mitschreiben)

    sperren = [sql for sql in anweisungen if "FROM customers" in sql and sql.endswith("FOR UPDATE")]
    assert sperren, f"Kein 'SELECT ... FOR UPDATE' auf customers gefunden: {anweisungen}"


def test_kundenzeile_wird_bei_neuzuordnung_gesperrt(
    factory: sessionmaker[Session], organisation: uuid.UUID, engine: Engine
) -> None:
    """Auch beim Umhaengen eines Projekts wird der Zielkunde gesperrt."""
    from app.core.projects.schemas import ProjectUpdate

    alt = _kunde_anlegen(factory, organisation, name="Alter Kunde")
    neu = _kunde_anlegen(factory, organisation, name="Neuer Kunde")
    session = factory()
    try:
        projekt = ProjectService(session, organisation).create(
            ProjectCreate(customer_id=alt, name="Neubau"), actor_user_id=ACTOR
        )
        session.commit()
        project_id = projekt.id
    finally:
        session.close()

    anweisungen: list[str] = []

    def mitschreiben(
        conn: Any, cursor: Any, statement: str, parameters: Any, context: Any, executemany: bool
    ) -> None:
        anweisungen.append(" ".join(statement.split()))

    event.listen(engine, "before_cursor_execute", mitschreiben)
    session = factory()
    try:
        ProjectService(session, organisation).update(
            project_id,
            ProjectUpdate(customer_id=neu),
            expected_version=1,
            actor_user_id=ACTOR,
        )
        session.commit()
    finally:
        session.close()
        event.remove(engine, "before_cursor_execute", mitschreiben)

    sperren = [sql for sql in anweisungen if "FROM customers" in sql and sql.endswith("FOR UPDATE")]
    assert sperren, f"Kein 'SELECT ... FOR UPDATE' auf customers gefunden: {anweisungen}"


def test_ausblenden_sperrt_die_kundenzeile(
    factory: sessionmaker[Session], organisation: uuid.UUID, engine: Engine
) -> None:
    """Dieselbe Zeile, dieselbe Reihenfolge - Voraussetzung gegen Deadlocks."""
    customer_id = _kunde_anlegen(factory, organisation)
    anweisungen: list[str] = []

    def mitschreiben(
        conn: Any, cursor: Any, statement: str, parameters: Any, context: Any, executemany: bool
    ) -> None:
        anweisungen.append(" ".join(statement.split()))

    event.listen(engine, "before_cursor_execute", mitschreiben)
    session = factory()
    try:
        service = CustomerService(session, organisation)
        kunde = service.get_for_update(customer_id)
        service.soft_delete(kunde, actor_user_id=ACTOR)
        session.commit()
    finally:
        session.close()
        event.remove(engine, "before_cursor_execute", mitschreiben)

    sperren = [sql for sql in anweisungen if "FROM customers" in sql and sql.endswith("FOR UPDATE")]
    assert sperren, f"Kein 'SELECT ... FOR UPDATE' auf customers gefunden: {anweisungen}"


def test_fremder_kunde_bleibt_auch_beim_sperren_unsichtbar(
    factory: sessionmaker[Session], organisation: uuid.UUID
) -> None:
    """Der Mandantenfilter gilt auch fuer den sperrenden Zugriff."""
    from app.core.organizations.models import Organization

    session = factory()
    try:
        fremd = Organization(name="Elektro Fremd GmbH", slug="elektro-fremd-parallel")
        session.add(fremd)
        session.commit()
        fremde_organisation = fremd.id
    finally:
        session.close()

    customer_id = _kunde_anlegen(factory, organisation)

    session = factory()
    try:
        with pytest.raises(NotFoundError):
            CustomerService(session, fremde_organisation).get_for_update(customer_id)
        with pytest.raises(NotFoundError):
            ProjectService(session, fremde_organisation).create(
                ProjectCreate(customer_id=customer_id, name="Fremdprojekt"), actor_user_id=ACTOR
            )
    finally:
        session.close()


# --------------------------------- 3. Geschossebene unter Parallelitaet


def test_parallele_anlage_derselben_ebene_erzeugt_nur_ein_geschoss(
    factory: sessionmaker[Session], organisation: uuid.UUID
) -> None:
    """Die Invariante unter echter Parallelitaet: genau ein Geschoss.

    Ob der Verlierer an der Vorpruefung oder am eindeutigen Index scheitert,
    haengt vom Ablauf ab - beide Wege liefern dieselbe Antwort. Geprueft wird
    deshalb die Invariante, nicht der Weg. Den Indexpfad allein sichert
    ``test_unique_verletzung_wird_zuverlaessig_uebersetzt`` deterministisch ab.
    """
    customer_id = _kunde_anlegen(factory, organisation)
    building_id = _gebaeude_anlegen(factory, organisation, customer_id)
    barriere = threading.Barrier(2, timeout=15)

    def anlegen(session: Session, name: str) -> str:
        service = ProjectService(session, organisation)
        # Vorpruefung auf beiden Seiten, bevor eine Seite schreibt.
        service._require_free_level(building_id, 0, exclude_floor_id=None)
        barriere.wait()
        service.create_floor(building_id, FloorCreate(name=f"Erdgeschoss {name}", level=0))
        return name

    lauf = gleichzeitig(factory, anlegen)

    assert len(lauf.erfolge) == 1, f"Nur eine Anlage darf gewinnen: {lauf.erfolge}"
    verlierer = lauf.fehler[0]
    assert isinstance(verlierer, ValidationFailedError), f"Erhalten: {verlierer!r}"
    assert verlierer.status_code == 422
    assert "Ebene 0" in str(verlierer)

    session = factory()
    try:
        anzahl = session.execute(
            select(func.count()).where(Floor.building_id == building_id, Floor.level == 0)
        ).scalar_one()
        assert anzahl == 1
    finally:
        session.close()


def test_unique_verletzung_wird_zuverlaessig_uebersetzt(
    factory: sessionmaker[Session], organisation: uuid.UUID
) -> None:
    """Deterministischer Nachweis des Datenbankpfads - ohne Threads.

    Der threadbasierte Test oben sichert die *Invariante* ab, kann aber je
    nach Ablauf schon an der Vorpruefung scheitern. Hier wird die Vorpruefung
    bewusst uebersprungen, damit wirklich der eindeutige Index in PostgreSQL
    zuschlaegt - und damit belegt ist, dass der Constraint-Name stimmt.
    """
    customer_id = _kunde_anlegen(factory, organisation)
    building_id = _gebaeude_anlegen(factory, organisation, customer_id)

    session = factory()
    try:
        ProjectService(session, organisation).create_floor(
            building_id, FloorCreate(name="Erdgeschoss", level=0)
        )
        session.commit()
    finally:
        session.close()

    session = factory()
    try:
        service = ProjectService(session, organisation)
        service.floors.add(
            Floor(
                organization_id=organisation,
                building_id=building_id,
                name="Zweites Erdgeschoss",
                level=0,
            )
        )
        with pytest.raises(ValidationFailedError) as fehler:
            service._flush_floor(0)
        assert "Ebene 0" in str(fehler.value)
        assert "uq_floors" not in str(fehler.value)
        assert "psycopg" not in str(fehler.value)
    finally:
        session.rollback()
        session.close()

    session = factory()
    try:
        anzahl = session.execute(
            select(func.count()).where(Floor.building_id == building_id, Floor.level == 0)
        ).scalar_one()
        assert anzahl == 1
    finally:
        session.close()


def test_paralleles_verschieben_auf_dieselbe_ebene_wird_abgefangen(
    factory: sessionmaker[Session], organisation: uuid.UUID
) -> None:
    """Zwei Geschosse wollen gleichzeitig auf Ebene 5."""
    customer_id = _kunde_anlegen(factory, organisation)
    building_id = _gebaeude_anlegen(factory, organisation, customer_id)

    session = factory()
    try:
        service = ProjectService(session, organisation)
        unten = service.create_floor(building_id, FloorCreate(name="Unten", level=0))
        oben = service.create_floor(building_id, FloorCreate(name="Oben", level=1))
        session.commit()
        ids = {"A": unten.id, "B": oben.id}
    finally:
        session.close()

    barriere = threading.Barrier(2, timeout=15)

    def verschieben(session: Session, name: str) -> str:
        service = ProjectService(session, organisation)
        service.floors.get_or_404(ids[name])
        barriere.wait()
        service.update_floor(ids[name], FloorUpdate(level=5), expected_version=1)
        return name

    lauf = gleichzeitig(factory, verschieben)

    assert len(lauf.erfolge) == 1
    assert isinstance(lauf.fehler[0], ValidationFailedError)

    session = factory()
    try:
        anzahl = session.execute(
            select(func.count()).where(Floor.building_id == building_id, Floor.level == 5)
        ).scalar_one()
        assert anzahl == 1
    finally:
        session.close()


def test_andere_integritaetsfehler_werden_nicht_als_ebenenkonflikt_getarnt(
    factory: sessionmaker[Session], organisation: uuid.UUID
) -> None:
    """Nur die eine erwartete Constraint wird uebersetzt."""
    from sqlalchemy.exc import IntegrityError

    from app.core.persistence import unique_violation_translated

    customer_id = _kunde_anlegen(factory, organisation)
    session = factory()
    try:
        vorhanden = session.get(Customer, customer_id)
        assert vorhanden is not None
        session.add(
            Customer(
                organization_id=organisation,
                customer_number=vorhanden.customer_number,
                name="Doppelte Nummer",
            )
        )
        with (
            pytest.raises(IntegrityError),
            unique_violation_translated(
                session,
                constraint="uq_floors_building_id_level",
                error=ValidationFailedError("Ebene belegt"),
            ),
        ):
            session.flush()
    finally:
        session.rollback()
        session.close()


def test_mandantentrennung_bleibt_bei_geschossen_erhalten(
    factory: sessionmaker[Session], organisation: uuid.UUID
) -> None:
    """Ein fremdes Gebaeude ist auch fuer die Geschossanlage unsichtbar."""
    from app.core.organizations.models import Organization

    customer_id = _kunde_anlegen(factory, organisation)
    building_id = _gebaeude_anlegen(factory, organisation, customer_id)

    session = factory()
    try:
        fremd = Organization(name="Elektro Fremd Geschoss", slug="fremd-geschoss")
        session.add(fremd)
        session.commit()
        fremde_organisation = fremd.id
    finally:
        session.close()

    session = factory()
    try:
        with pytest.raises(NotFoundError):
            ProjectService(session, fremde_organisation).create_floor(
                building_id, FloorCreate(name="Fremdgeschoss", level=0)
            )
    finally:
        session.close()
