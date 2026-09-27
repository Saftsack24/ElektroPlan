"""Echte Parallelitaet in der Benutzerverwaltung (Phase 4.2, ADR 0015).

**Letzter Administrator.** Zwei Verwalter entfernen gleichzeitig je einem der
beiden Administratoren die Rolle oder sperren ihn. Jede Anfrage fuer sich ist
zulaessig - zusammen liessen sie den Betrieb ohne Administrator zurueck. Die
Organisationszeile ist deshalb die Sperrwurzel: Die zweite Anfrage wartet,
zaehlt danach neu und wird abgelehnt.

**Gegenprobe.** Derselbe Ablauf mit vorübergehend entfernter Sperre fuehrt
nachweislich zu **null** Administratoren. Der Test beweist damit, dass er die
Luecke erkennen wuerde - und dass die Sperre sie schliesst.

**Einladung.** Zwei gleichzeitige Annahmen desselben Tokens erzeugen genau
ein Konto; zwei gleichzeitige Einladungen derselben Adresse genau eine.

Zwei Threads, zwei Sessions, explizite Barrieren; geprueft wird am Ende der
Datenbankzustand. Benoetigt PostgreSQL.
"""

from __future__ import annotations

import contextlib
import threading
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.authorization.models import MemberRole, Role
from app.core.invitations.models import MemberInvitation
from app.core.invitations.service import (
    InvitationAcceptance,
    InvitationService,
    reset_acceptance_limiter,
)
from app.core.members.service import Actor, MemberAdminService
from app.core.module_registry.registry import ModuleRegistry
from app.core.organizations.models import OrganizationMember
from app.core.seed import seed_initial_data
from app.core.users.models import User
from app.errors import (
    ConflictError,
    InvitationInvalidError,
    InvitationRequiresLoginError,
    LastAdministratorError,
)
from tests.conftest import ADMIN_PASSWORD, requires_database
from tests.verwaltung_hilfen import (
    VERWALTER_ROLLE,
    Person,
    admin_mitglied,
    person_anlegen,
    rollen_fuer_tests_anlegen,
)

pytestmark = [requires_database, pytest.mark.database]

ROLLEN_SCHREIBEN = "role.assignment.write"
KONTEN_SCHREIBEN = "user.account.write"
#: So lange wartet eine Seite an der Barriere auf die andere. Haelt die andere
#: die Organisationssperre nicht, sondern wartet selbst darauf, kommt sie nie
#: an - die Barriere bricht dann ab, und jede Seite committet fuer sich.
BARRIERE_SEKUNDEN = 2.0


@dataclass
class Lauf:
    erfolge: list[str] = field(default_factory=list)
    fehler: list[BaseException] = field(default_factory=list)


def gleichzeitig(
    factory: sessionmaker[Session], arbeiten: dict[str, Callable[[Session], None]]
) -> Lauf:
    """Fuehrt je Name eine Arbeit in eigenem Thread und eigener Session aus.

    Nach der Arbeit warten beide an einer Barriere und committen erst dann.
    Ohne Sperre haben damit **beide** gezaehlt, bevor eine committet.
    """
    lauf = Lauf()
    schloss = threading.Lock()
    barriere = threading.Barrier(len(arbeiten))

    def ausfuehren(name: str, arbeit: Callable[[Session], None]) -> None:
        session = factory()
        try:
            arbeit(session)
            with contextlib.suppress(threading.BrokenBarrierError):
                barriere.wait(timeout=BARRIERE_SEKUNDEN)
            session.commit()
            with schloss:
                lauf.erfolge.append(name)
        except BaseException as exc:
            session.rollback()
            with schloss:
                lauf.fehler.append(exc)
            with contextlib.suppress(threading.BrokenBarrierError):
                barriere.abort()
        finally:
            session.close()

    threads = [
        threading.Thread(target=ausfuehren, args=(name, arbeit), daemon=True)
        for name, arbeit in arbeiten.items()
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert all(not thread.is_alive() for thread in threads), "Ein Thread haengt."
    return lauf


@dataclass(frozen=True)
class Aufbau:
    organization_id: uuid.UUID
    admin_a: Person
    admin_b: Person
    verwalter_1: Person
    verwalter_2: Person


@pytest.fixture
def factory(engine: Engine, clean_database: None) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture
def aufbau(engine: Engine, factory: sessionmaker[Session], registry: ModuleRegistry) -> Aufbau:
    session = factory()
    try:
        organization_id = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Parallel GmbH",
            admin_email="admin-a@parallel.example",
            admin_password=ADMIN_PASSWORD,
        ).organization_id
        session.commit()
    finally:
        session.close()
    rollen_fuer_tests_anlegen(engine, organization_id)
    return Aufbau(
        organization_id=organization_id,
        admin_a=admin_mitglied(engine, organization_id, "admin-a@parallel.example"),
        admin_b=person_anlegen(engine, organization_id, "admin-b@parallel.example", ["admin"]),
        verwalter_1=person_anlegen(
            engine, organization_id, "verwalter-1@parallel.example", [VERWALTER_ROLLE]
        ),
        verwalter_2=person_anlegen(
            engine, organization_id, "verwalter-2@parallel.example", [VERWALTER_ROLLE]
        ),
    )


@pytest.fixture(autouse=True)
def _limiter() -> Iterator[None]:
    reset_acceptance_limiter()
    yield
    reset_acceptance_limiter()


def aktive_admins(factory: sessionmaker[Session], organization_id: uuid.UUID) -> int:
    session = factory()
    try:
        return int(
            session.execute(
                select(func.count())
                .select_from(OrganizationMember)
                .join(MemberRole, MemberRole.member_id == OrganizationMember.id)
                .join(Role, Role.id == MemberRole.role_id)
                .where(
                    OrganizationMember.organization_id == organization_id,
                    OrganizationMember.status == "active",
                    Role.key == "admin",
                )
            ).scalar_one()
        )
    finally:
        session.close()


def _version(factory: sessionmaker[Session], person: Person) -> int:
    session = factory()
    try:
        member = session.get(OrganizationMember, person.member_id)
        assert member is not None
        return member.version
    finally:
        session.close()


Arbeit = Callable[[Session], None]


def _entmachten(aufbau: Aufbau, verwalter: Person, ziel: Person, version: int) -> Arbeit:
    def arbeit(session: Session) -> None:
        MemberAdminService(session, aufbau.organization_id).replace_roles(
            ziel.member_id,
            ["planer"],
            expected_version=version,
            actor=Actor(user_id=verwalter.user_id, member_id=verwalter.member_id),
            permission=ROLLEN_SCHREIBEN,
        )

    return arbeit


def _sperren(aufbau: Aufbau, verwalter: Person, ziel: Person, version: int) -> Arbeit:
    def arbeit(session: Session) -> None:
        MemberAdminService(session, aufbau.organization_id).suspend(
            ziel.member_id,
            expected_version=version,
            actor=Actor(user_id=verwalter.user_id, member_id=verwalter.member_id),
            permission=KONTEN_SCHREIBEN,
        )

    return arbeit


VORGAENGE = {
    "rollen entziehen": (_entmachten, _entmachten),
    "sperren": (_sperren, _sperren),
    "sperren und entziehen": (_sperren, _entmachten),
}


@pytest.mark.parametrize("vorgang", sorted(VORGAENGE))
def test_parallel_bleibt_ein_administrator(
    factory: sessionmaker[Session], aufbau: Aufbau, vorgang: str
) -> None:
    erster, zweiter = VORGAENGE[vorgang]
    lauf = gleichzeitig(
        factory,
        {
            "1": erster(
                aufbau, aufbau.verwalter_1, aufbau.admin_a, _version(factory, aufbau.admin_a)
            ),
            "2": zweiter(
                aufbau, aufbau.verwalter_2, aufbau.admin_b, _version(factory, aufbau.admin_b)
            ),
        },
    )
    assert len(lauf.erfolge) == 1, lauf.fehler
    assert [type(fehler) for fehler in lauf.fehler] == [LastAdministratorError]
    assert aktive_admins(factory, aufbau.organization_id) == 1


def test_gegenprobe_ohne_organisationssperre_gehen_beide_durch(
    factory: sessionmaker[Session], aufbau: Aufbau, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Beweist, dass der Test die Luecke erkennt: ohne Sperre null Administratoren."""
    monkeypatch.setattr(MemberAdminService, "_lock_organization", lambda self: None)
    lauf = gleichzeitig(
        factory,
        {
            "1": _entmachten(
                aufbau, aufbau.verwalter_1, aufbau.admin_a, _version(factory, aufbau.admin_a)
            ),
            "2": _entmachten(
                aufbau, aufbau.verwalter_2, aufbau.admin_b, _version(factory, aufbau.admin_b)
            ),
        },
    )
    assert sorted(lauf.erfolge) == ["1", "2"], lauf.fehler
    assert aktive_admins(factory, aufbau.organization_id) == 0


def test_entzogenes_recht_wirkt_auch_unter_parallelitaet(
    factory: sessionmaker[Session], aufbau: Aufbau
) -> None:
    """Admin A entzieht B die Rolle, B entzieht A die Rolle - gleichzeitig.

    Die Rechtepruefung der Anfrage lag vor der Sperre. Unter der Sperre wird
    der Handelnde erneut geprueft: Wer eben entmachtet wurde, darf nicht mehr
    verwalten. Genau einer gewinnt, ein Administrator bleibt.
    """
    lauf = gleichzeitig(
        factory,
        {
            "A": _entmachten(
                aufbau, aufbau.admin_a, aufbau.admin_b, _version(factory, aufbau.admin_b)
            ),
            "B": _entmachten(
                aufbau, aufbau.admin_b, aufbau.admin_a, _version(factory, aufbau.admin_a)
            ),
        },
    )
    assert len(lauf.erfolge) == 1, lauf.fehler
    assert aktive_admins(factory, aufbau.organization_id) == 1


def test_token_wird_parallel_nur_einmal_eingeloest(
    factory: sessionmaker[Session], aufbau: Aufbau
) -> None:
    session = factory()
    try:
        _, token = InvitationService(session, aufbau.organization_id).create(
            email="parallel@parallel.example",
            full_name=None,
            role_keys=["monteur"],
            actor_user_id=aufbau.admin_a.user_id,
        )
        session.commit()
    finally:
        session.close()

    def annehmen(passwort: str) -> Callable[[Session], None]:
        def arbeit(session: Session) -> None:
            InvitationAcceptance(session, client_ip="127.0.0.1").accept_with_new_account(
                token, full_name="Parallel", password=passwort
            )

        return arbeit

    lauf = gleichzeitig(
        factory,
        {"1": annehmen("erstes-passwort-123"), "2": annehmen("zweites-passwort-123")},
    )
    assert len(lauf.erfolge) == 1, lauf.fehler
    assert type(lauf.fehler[0]) in (InvitationInvalidError, InvitationRequiresLoginError)

    session = factory()
    try:
        konten = session.execute(
            select(func.count()).select_from(User).where(User.email == "parallel@parallel.example")
        ).scalar_one()
        mitgliedschaften = session.execute(
            select(func.count())
            .select_from(OrganizationMember)
            .join(User, User.id == OrganizationMember.user_id)
            .where(User.email == "parallel@parallel.example")
        ).scalar_one()
        assert (konten, mitgliedschaften) == (1, 1)
    finally:
        session.close()


def test_gleiche_adresse_wird_parallel_nur_einmal_eingeladen(
    factory: sessionmaker[Session], aufbau: Aufbau
) -> None:
    def einladen(session: Session) -> None:
        InvitationService(session, aufbau.organization_id).create(
            email="doppelt@parallel.example",
            full_name=None,
            role_keys=["monteur"],
            actor_user_id=aufbau.admin_a.user_id,
        )

    lauf = gleichzeitig(factory, {"1": einladen, "2": einladen})
    assert len(lauf.erfolge) == 1, lauf.fehler
    assert type(lauf.fehler[0]) is ConflictError
    session = factory()
    try:
        anzahl = session.execute(
            select(func.count())
            .select_from(MemberInvitation)
            .where(MemberInvitation.email == "doppelt@parallel.example")
        ).scalar_one()
        assert anzahl == 1
    finally:
        session.close()
