"""Echte Parallelitaet im Benutzerlebenszyklus (Phase 4e, ADR 0021).

Zwei Threads, zwei Sessions, eine Barriere vor dem Commit - geprueft wird am
Ende der Datenbankzustand. Benoetigt PostgreSQL; Zeilensperren werden nicht
simuliert.

1. Zwei Administratoren sperren gleichzeitig den jeweils anderen.
2. Die letzten zwei Administratoren werden gleichzeitig entfernt oder herabgestuft.
3. Rollenaenderung gegen Sperren.
4. Rollenaenderung gegen Entfernen.
5. E-Mail-Aenderung gegen Einladung derselben Adresse.
6. Zwei Geraete legen erstmalig Einstellungen an.
7. Zwei Geraete aendern dieselbe Version.
8. Zwei Einloesungen desselben Reset-Links.
9. Passwortreset gegen Entfernen und gegen Sperren - eine Sperre entwertet jeden
   zuvor ausgestellten Reset-Link (Sicherheitsstopp); Entsperren belebt ihn nicht.
10. Erneuerung der Sitzung gegen Sperren.
11. Erneuerung der Sitzung gegen Passwortaenderung.
12. Ein fremder Betrieb versucht jede Lebenszyklusaktion.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.auth.models import RefreshToken
from app.core.auth.security import verify_password
from app.core.auth.service import AuthService, _login_limiter
from app.core.authorization.models import MemberRole, Role
from app.core.invitations.models import MemberInvitation
from app.core.invitations.service import InvitationService
from app.core.members.service import Actor, MemberAdminService
from app.core.module_registry.registry import ModuleRegistry
from app.core.organizations.models import OrganizationMember
from app.core.password_reset.models import PasswordResetToken
from app.core.password_reset.service import (
    PasswordResetRedemption,
    PasswordResetService,
    reset_password_reset_limiters,
)
from app.core.preferences.models import UserPreferences
from app.core.preferences.schemas import PreferencesIn
from app.core.preferences.service import PreferencesService
from app.core.seed import seed_initial_data
from app.core.users.models import User
from app.errors import (
    AuthenticationError,
    ConflictError,
    EmailUnavailableError,
    LastAdministratorError,
    MemberRemovedError,
    NotFoundError,
    PasswordResetInvalidError,
    PermissionDeniedError,
    PreferencesExistError,
    VersionConflictError,
)
from tests.conftest import ADMIN_PASSWORD, requires_database
from tests.test_member_concurrency import gleichzeitig
from tests.verwaltung_hilfen import (
    Person,
    admin_mitglied,
    eigene_rolle_anlegen,
    person_anlegen,
)

pytestmark = [requires_database, pytest.mark.database]

Arbeit = Callable[[Session], None]
NEU = "ein-neues-passwort-2026"
VERWALTER = "test_lebenszyklus"
VERWALTER_RECHTE = (
    "user.account.read",
    "user.account.write",
    "user.account.lock",
    "user.account.remove",
    "user.profile.write",
    "user.password.reset",
    "role.assignment.read",
    "role.assignment.write",
)


@dataclass(frozen=True)
class Aufbau:
    organization_id: uuid.UUID
    admin_a: Person
    admin_b: Person
    verwalter_1: Person
    verwalter_2: Person
    planer: Person


@pytest.fixture
def factory(engine: Engine, clean_database: None) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture(autouse=True)
def _limiter() -> Iterator[None]:
    reset_password_reset_limiters()
    _login_limiter.clear()
    yield
    reset_password_reset_limiters()
    _login_limiter.clear()


def _betrieb(
    factory: sessionmaker[Session], registry: ModuleRegistry, name: str, admin: str
) -> uuid.UUID:
    session = factory()
    try:
        organization_id = seed_initial_data(
            session,
            registry,
            organization_name=name,
            admin_email=admin,
            admin_password=ADMIN_PASSWORD,
        ).organization_id
        session.commit()
        return organization_id
    finally:
        session.close()


@pytest.fixture
def aufbau(engine: Engine, factory: sessionmaker[Session], registry: ModuleRegistry) -> Aufbau:
    organization_id = _betrieb(
        factory, registry, "Elektro Lebenszyklus GmbH", "admin-a@zyklus.example"
    )
    session = factory()
    try:
        eigene_rolle_anlegen(session, organization_id, VERWALTER, VERWALTER_RECHTE)
        session.commit()
    finally:
        session.close()
    return Aufbau(
        organization_id=organization_id,
        admin_a=admin_mitglied(engine, organization_id, "admin-a@zyklus.example"),
        admin_b=person_anlegen(engine, organization_id, "admin-b@zyklus.example", ["admin"]),
        verwalter_1=person_anlegen(
            engine, organization_id, "verwalter-1@zyklus.example", [VERWALTER]
        ),
        verwalter_2=person_anlegen(
            engine, organization_id, "verwalter-2@zyklus.example", [VERWALTER]
        ),
        planer=person_anlegen(engine, organization_id, "planer@zyklus.example", ["planer"]),
    )


def _actor(person: Person) -> Actor:
    return Actor(user_id=person.user_id, member_id=person.member_id)


def _version(factory: sessionmaker[Session], person: Person) -> int:
    session = factory()
    try:
        member = session.get(OrganizationMember, person.member_id)
        assert member is not None
        return member.version
    finally:
        session.close()


def _aktive_admins(factory: sessionmaker[Session], organization_id: uuid.UUID) -> int:
    session = factory()
    try:
        return int(
            session.execute(
                select(func.count())
                .select_from(OrganizationMember)
                .join(MemberRole, MemberRole.member_id == OrganizationMember.id)
                .join(Role, Role.id == MemberRole.role_id)
                .join(User, User.id == OrganizationMember.user_id)
                .where(
                    OrganizationMember.organization_id == organization_id,
                    OrganizationMember.status == "active",
                    Role.key == "admin",
                    User.is_active.is_(True),
                )
            ).scalar_one()
        )
    finally:
        session.close()


def _sperren(a: Aufbau, wer: Person, ziel: Person, version: int) -> Arbeit:
    return lambda s: (
        MemberAdminService(s, a.organization_id).suspend(
            ziel.member_id,
            expected_version=version,
            actor=_actor(wer),
            permission="user.account.lock",
        ),
        None,
    )[1]


def _entfernen(a: Aufbau, wer: Person, ziel: Person, version: int) -> Arbeit:
    return lambda s: (
        MemberAdminService(s, a.organization_id).remove(
            ziel.member_id,
            confirm_email=ziel.email,
            expected_version=version,
            actor=_actor(wer),
            permission="user.account.remove",
        ),
        None,
    )[1]


def _herabstufen(a: Aufbau, wer: Person, ziel: Person, version: int) -> Arbeit:
    return lambda s: (
        MemberAdminService(s, a.organization_id).replace_roles(
            ziel.member_id,
            ["planer"],
            expected_version=version,
            actor=_actor(wer),
            permission="role.assignment.write",
        ),
        None,
    )[1]


# ------------------------------------------------- 1-4: letzter Administrator


def test_1_zwei_administratoren_sperren_sich_gegenseitig(
    factory: sessionmaker[Session], aufbau: Aufbau
) -> None:
    lauf = gleichzeitig(
        factory,
        {
            "a sperrt b": _sperren(
                aufbau, aufbau.admin_a, aufbau.admin_b, _version(factory, aufbau.admin_b)
            ),
            "b sperrt a": _sperren(
                aufbau, aufbau.admin_b, aufbau.admin_a, _version(factory, aufbau.admin_a)
            ),
        },
    )
    assert len(lauf.erfolge) == 1, lauf.fehler
    # Der zweite ist entweder schon gesperrt (keine Berechtigung mehr) oder der letzte.
    assert len(lauf.fehler) == 1
    assert isinstance(lauf.fehler[0], PermissionDeniedError | LastAdministratorError)
    assert _aktive_admins(factory, aufbau.organization_id) == 1


VORGAENGE: dict[str, tuple[Callable[..., Arbeit], Callable[..., Arbeit]]] = {
    "2 entfernen + entfernen": (_entfernen, _entfernen),
    "2 herabstufen + herabstufen": (_herabstufen, _herabstufen),
    "2 entfernen + herabstufen": (_entfernen, _herabstufen),
    "3 herabstufen + sperren": (_herabstufen, _sperren),
    "4 herabstufen + entfernen": (_herabstufen, _entfernen),
}


@pytest.mark.parametrize("vorgang", sorted(VORGAENGE))
def test_2_bis_4_letzter_administrator_bleibt_unter_parallelitaet(
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
    assert [type(f) for f in lauf.fehler] == [LastAdministratorError]
    assert _aktive_admins(factory, aufbau.organization_id) == 1


# --------------------------------------------- 5: E-Mail gegen Einladung


def test_5_email_aenderung_gegen_einladung_derselben_adresse(
    factory: sessionmaker[Session], aufbau: Aufbau
) -> None:
    adresse = "umzug@zyklus.example"

    def aendern(s: Session) -> None:
        MemberAdminService(s, aufbau.organization_id).update_profile(
            aufbau.planer.member_id,
            full_name=None,
            email=adresse,
            expected_version=_version(factory, aufbau.planer),
            actor=_actor(aufbau.verwalter_1),
            permission="user.profile.write",
        )

    def einladen(s: Session) -> None:
        InvitationService(s, aufbau.organization_id).create(
            email=adresse,
            full_name=None,
            role_keys=["monteur"],
            actor_user_id=aufbau.verwalter_2.user_id,
        )

    lauf = gleichzeitig(factory, {"aendern": aendern, "einladen": einladen})
    assert len(lauf.erfolge) == 1, lauf.fehler
    assert len(lauf.fehler) == 1
    assert isinstance(lauf.fehler[0], EmailUnavailableError | ConflictError)
    session = factory()
    try:
        konto = session.execute(select(User).where(User.email == adresse)).first()
        einladung = session.execute(
            select(MemberInvitation).where(
                MemberInvitation.email == adresse, MemberInvitation.accepted_at.is_(None)
            )
        ).first()
        # Nie beides: Konto **und** offene Einladung derselben Adresse im Betrieb.
        assert (konto is None) != (einladung is None)
    finally:
        session.close()


# ------------------------------------------------ 6-7: zwei Geraete


def _einstellungen(a: Aufbau, person: Person, s: Session) -> PreferencesService:
    return PreferencesService(s, organization_id=a.organization_id, member_id=person.member_id)


def test_6_zwei_geraete_legen_gleichzeitig_an(
    factory: sessionmaker[Session], aufbau: Aufbau
) -> None:
    def geraet(einheit: str) -> Arbeit:
        return lambda s: (
            _einstellungen(aufbau, aufbau.planer, s).create(
                PreferencesIn(theme_mode="dark", accent="teal", length_unit=einheit)  # type: ignore[arg-type]
            ),
            None,
        )[1]

    lauf = gleichzeitig(factory, {"laptop": geraet("m"), "tablet": geraet("mm")})
    assert len(lauf.erfolge) == 1, lauf.fehler
    assert [type(f) for f in lauf.fehler] == [PreferencesExistError]
    session = factory()
    try:
        zeilen = (
            session.execute(
                select(UserPreferences).where(UserPreferences.member_id == aufbau.planer.member_id)
            )
            .scalars()
            .all()
        )
        assert len(zeilen) == 1
        assert zeilen[0].version == 1
    finally:
        session.close()


def test_7_zwei_geraete_aendern_dieselbe_version(
    factory: sessionmaker[Session], aufbau: Aufbau
) -> None:
    session = factory()
    try:
        _einstellungen(aufbau, aufbau.planer, session).create(
            PreferencesIn(theme_mode="system", accent="blue", length_unit="cm")
        )
        session.commit()
    finally:
        session.close()

    def geraet(akzent: str) -> Arbeit:
        return lambda s: (
            _einstellungen(aufbau, aufbau.planer, s).replace(
                PreferencesIn(theme_mode="light", accent=akzent, length_unit="m"),  # type: ignore[arg-type]
                expected_version=1,
            ),
            None,
        )[1]

    lauf = gleichzeitig(factory, {"laptop": geraet("green"), "tablet": geraet("orange")})
    assert len(lauf.erfolge) == 1, lauf.fehler
    assert [type(f) for f in lauf.fehler] == [VersionConflictError]
    session = factory()
    try:
        stand = session.execute(
            select(UserPreferences).where(UserPreferences.member_id == aufbau.planer.member_id)
        ).scalar_one()
        assert stand.version == 2
        assert stand.accent in {"green", "orange"}
    finally:
        session.close()


# ------------------------------------------------ 8-9: Reset-Link


def _reset_link(factory: sessionmaker[Session], a: Aufbau, ziel: Person) -> str:
    session = factory()
    try:
        ausgestellt = PasswordResetService(session, a.organization_id).issue(
            ziel.member_id, actor=_actor(a.admin_a), permission="user.password.reset"
        )
        session.commit()
        return ausgestellt.token
    finally:
        session.close()


def _einloesen(token: str, passwort: str) -> Arbeit:
    return lambda s: (
        PasswordResetRedemption(s, client_ip="198.51.100.7").complete(token, password=passwort),
        None,
    )[1]


def test_8_derselbe_reset_link_gelingt_genau_einmal(
    factory: sessionmaker[Session], aufbau: Aufbau
) -> None:
    token = _reset_link(factory, aufbau, aufbau.planer)
    lauf = gleichzeitig(
        factory,
        {
            "eins": _einloesen(token, "erstes-passwort-2026"),
            "zwei": _einloesen(token, "zweites-passwort-2026"),
        },
    )
    assert len(lauf.erfolge) == 1, lauf.fehler
    assert [type(f) for f in lauf.fehler] == [PasswordResetInvalidError]
    session = factory()
    try:
        konto = session.get(User, aufbau.planer.user_id)
        assert konto is not None
        gewonnen = "erstes-passwort-2026" if lauf.erfolge == ["eins"] else "zweites-passwort-2026"
        assert verify_password(konto.password_hash, gewonnen)
        assert session.execute(select(PasswordResetToken)).first() is None
    finally:
        session.close()


def test_9a_reset_gegen_entfernen(factory: sessionmaker[Session], aufbau: Aufbau) -> None:
    token = _reset_link(factory, aufbau, aufbau.planer)
    lauf = gleichzeitig(
        factory,
        {
            "reset": _einloesen(token, NEU),
            "entfernen": _entfernen(
                aufbau, aufbau.admin_a, aufbau.planer, _version(factory, aufbau.planer)
            ),
        },
    )
    assert "entfernen" in lauf.erfolge, lauf.fehler
    assert all(isinstance(f, PasswordResetInvalidError) for f in lauf.fehler)
    session = factory()
    try:
        konto = session.get(User, aufbau.planer.user_id)
        assert konto is not None
        # Gleich welche Reihenfolge: Das Konto ist bereinigt und nicht anmeldbar.
        assert konto.is_active is False
        assert not verify_password(konto.password_hash, NEU)
        assert session.execute(select(PasswordResetToken)).first() is None
    finally:
        session.close()


def _stand_nach_sperre_ohne_pruefung(
    factory: sessionmaker[Session], aufbau: Aufbau
) -> tuple[str, int, str]:
    session = factory()
    try:
        member = session.get(OrganizationMember, aufbau.planer.member_id)
        konto = session.get(User, aufbau.planer.user_id)
        assert member is not None and konto is not None
        return member.status, member.session_version, konto.password_hash
    finally:
        session.close()


def _stand_nach_sperre(factory: sessionmaker[Session], aufbau: Aufbau) -> tuple[str, int, str]:
    """Status, Sitzungsversion und Passworthash des Planers - und kein offener Link."""
    session = factory()
    try:
        member = session.get(OrganizationMember, aufbau.planer.member_id)
        konto = session.get(User, aufbau.planer.user_id)
        assert member is not None and konto is not None
        # Nach jeder abgeschlossenen Sperre bleibt nie ein zuvor ausgestellter Link uebrig.
        offen = session.execute(
            select(PasswordResetToken).where(PasswordResetToken.member_id == member.id)
        ).first()
        assert offen is None
        return member.status, member.session_version, konto.password_hash
    finally:
        session.close()


def _erst_a_dann_b(
    factory: sessionmaker[Session], erste: Arbeit, zweite: Arbeit
) -> BaseException | None:
    """``erste`` haelt ihre Sperren, ``zweite`` startet und muss warten; dann Commit.

    Liefert den Fehler der zweiten Arbeit (oder ``None``). Haengt die zweite
    nach dem Commit der ersten noch, waere das ein Deadlock - der Test bricht ab.
    """
    halter = factory()
    ergebnis: list[BaseException | None] = []

    def zweiter_lauf() -> None:
        session = factory()
        try:
            zweite(session)
            session.commit()
            ergebnis.append(None)
        except BaseException as fehler:
            session.rollback()
            ergebnis.append(fehler)
        finally:
            session.close()

    try:
        erste(halter)
        thread = threading.Thread(target=zweiter_lauf, daemon=True)
        thread.start()
        thread.join(timeout=1.0)
        assert thread.is_alive(), "Die zweite Arbeit haette auf die Sperre warten muessen."
        halter.commit()
    finally:
        halter.close()
    thread.join(timeout=30)
    assert not thread.is_alive(), "Deadlock: die zweite Arbeit endet nicht."
    return ergebnis[0]


def test_9b_sperre_vor_der_einloesung_entwertet_den_alten_link(
    factory: sessionmaker[Session], aufbau: Aufbau
) -> None:
    """Die Sperre haelt die Mitgliedschaft; die Einloesung wartet und findet keinen Link."""
    token = _reset_link(factory, aufbau, aufbau.planer)
    _, _, vorher = _stand_nach_sperre_ohne_pruefung(factory, aufbau)
    fehler = _erst_a_dann_b(
        factory,
        _sperren(aufbau, aufbau.admin_a, aufbau.planer, _version(factory, aufbau.planer)),
        _einloesen(token, NEU),
    )
    assert isinstance(fehler, PasswordResetInvalidError)
    status, version, passwort = _stand_nach_sperre(factory, aufbau)
    assert status == "disabled"
    assert version == 2
    assert passwort == vorher
    assert not verify_password(passwort, NEU)


def test_9c_einloesung_vor_der_sperre_dann_ist_gesperrt(
    factory: sessionmaker[Session], aufbau: Aufbau
) -> None:
    """Die Einloesung committet zuerst; die Sperre wartet und gelingt danach."""
    token = _reset_link(factory, aufbau, aufbau.planer)
    version = _version(factory, aufbau.planer)
    fehler = _erst_a_dann_b(
        factory,
        _einloesen(token, NEU),
        _sperren(aufbau, aufbau.admin_a, aufbau.planer, version),
    )
    assert fehler is None
    status, sitzungsversion, passwort = _stand_nach_sperre(factory, aufbau)
    assert status == "disabled"
    assert sitzungsversion == 3  # Einloesung und Sperre zaehlen hoch
    assert verify_password(passwort, NEU)
    session = factory()
    try:
        # Gesperrt: Anmeldung trotz neuem Passwort unmoeglich.
        with pytest.raises(AuthenticationError):
            AuthService(session).login(email=aufbau.planer.email, password=NEU)
    finally:
        session.rollback()
        session.close()


def test_9d_reset_gegen_sperren_gleichzeitig(
    factory: sessionmaker[Session], aufbau: Aufbau
) -> None:
    """Echte Gleichzeitigkeit: kein Deadlock, die Sperre gelingt immer, kein Link bleibt."""
    token = _reset_link(factory, aufbau, aufbau.planer)
    lauf = gleichzeitig(
        factory,
        {
            "reset": _einloesen(token, NEU),
            "sperren": _sperren(
                aufbau, aufbau.admin_a, aufbau.planer, _version(factory, aufbau.planer)
            ),
        },
    )
    assert "sperren" in lauf.erfolge, lauf.fehler
    assert all(isinstance(f, PasswordResetInvalidError) for f in lauf.fehler), lauf.fehler
    status, version, passwort = _stand_nach_sperre(factory, aufbau)
    assert status == "disabled"
    if "reset" in lauf.erfolge:
        assert verify_password(passwort, NEU)
        assert version == 3
    else:
        assert not verify_password(passwort, NEU)
        assert version == 2


def test_9e_entsperren_belebt_weder_link_noch_sitzung(
    factory: sessionmaker[Session], aufbau: Aufbau
) -> None:
    roh = _anmelden(factory, aufbau.planer)
    token = _reset_link(factory, aufbau, aufbau.planer)
    for arbeit in (
        _sperren(aufbau, aufbau.admin_a, aufbau.planer, _version(factory, aufbau.planer)),
    ):
        session = factory()
        try:
            arbeit(session)
            session.commit()
        finally:
            session.close()
    session = factory()
    try:
        MemberAdminService(session, aufbau.organization_id).reactivate(
            aufbau.planer.member_id,
            expected_version=_version(factory, aufbau.planer),
            actor=_actor(aufbau.admin_a),
            permission="user.account.lock",
        )
        session.commit()
    finally:
        session.close()
    session = factory()
    try:
        with pytest.raises(PasswordResetInvalidError):
            _einloesen(token, NEU)(session)
    finally:
        session.rollback()
        session.close()
    _keine_gueltige_sitzung(factory, aufbau.planer, [roh])


# ------------------------------------------- 10-11: Erneuerung der Sitzung


def _anmelden(
    factory: sessionmaker[Session], person: Person, passwort: str = ADMIN_PASSWORD
) -> str:
    session = factory()
    try:
        tokens = AuthService(session).login(email=person.email, password=passwort)
        session.commit()
        return tokens.refresh_token
    finally:
        session.close()


def _erneuern(roh: str, ergebnis: list[str]) -> Arbeit:
    def arbeit(s: Session) -> None:
        ergebnis.append(AuthService(s).refresh(roh).refresh_token)

    return arbeit


def _keine_gueltige_sitzung(
    factory: sessionmaker[Session], person: Person, rohe: list[str]
) -> None:
    """Jedes vorhandene Token - auch ein waehrenddessen ausgestelltes - ist wertlos."""
    for roh in rohe:
        session = factory()
        try:
            with pytest.raises(AuthenticationError):
                AuthService(session).refresh(roh)
        finally:
            session.rollback()
            session.close()
    session = factory()
    try:
        member = session.get(OrganizationMember, person.member_id)
        assert member is not None
        lebendig = session.execute(
            select(RefreshToken).where(
                RefreshToken.user_id == person.user_id,
                RefreshToken.revoked_at.is_(None),
                RefreshToken.session_version == member.session_version,
            )
        ).first()
        assert lebendig is None
    finally:
        session.close()


def test_10_erneuerung_gegen_sperren(factory: sessionmaker[Session], aufbau: Aufbau) -> None:
    roh = _anmelden(factory, aufbau.planer)
    neu: list[str] = []
    lauf = gleichzeitig(
        factory,
        {
            "erneuern": _erneuern(roh, neu),
            "sperren": _sperren(
                aufbau, aufbau.admin_a, aufbau.planer, _version(factory, aufbau.planer)
            ),
        },
    )
    assert "sperren" in lauf.erfolge, lauf.fehler
    _keine_gueltige_sitzung(factory, aufbau.planer, [roh, *neu])
    # Entsperren belebt nichts davon wieder.
    session = factory()
    try:
        MemberAdminService(session, aufbau.organization_id).reactivate(
            aufbau.planer.member_id,
            expected_version=_version(factory, aufbau.planer),
            actor=_actor(aufbau.admin_a),
            permission="user.account.lock",
        )
        session.commit()
    finally:
        session.close()
    _keine_gueltige_sitzung(factory, aufbau.planer, [roh, *neu])


def test_11_erneuerung_gegen_passwortaenderung(
    factory: sessionmaker[Session], aufbau: Aufbau
) -> None:
    roh = _anmelden(factory, aufbau.planer)
    token = _reset_link(factory, aufbau, aufbau.planer)
    neu: list[str] = []
    lauf = gleichzeitig(factory, {"erneuern": _erneuern(roh, neu), "reset": _einloesen(token, NEU)})
    assert "reset" in lauf.erfolge, lauf.fehler
    _keine_gueltige_sitzung(factory, aufbau.planer, [roh, *neu])


# ------------------------------------------------------- 12: fremder Betrieb


def test_12_fremder_betrieb_erreicht_nichts(
    factory: sessionmaker[Session], aufbau: Aufbau, registry: ModuleRegistry, engine: Engine
) -> None:
    fremd = _betrieb(factory, registry, "Elektro Fremd GmbH", "admin@fremd-zyklus.example")
    fremder_admin = admin_mitglied(engine, fremd, "admin@fremd-zyklus.example")
    ziel = aufbau.planer
    version = _version(factory, ziel)
    versuche: dict[str, Arbeit] = {
        "sperren": lambda s: (
            MemberAdminService(s, fremd).suspend(
                ziel.member_id,
                expected_version=version,
                actor=_actor(fremder_admin),
                permission="user.account.lock",
            ),
            None,
        )[1],
        "profil": lambda s: (
            MemberAdminService(s, fremd).update_profile(
                ziel.member_id,
                full_name="Uebernommen",
                email=None,
                expected_version=version,
                actor=_actor(fremder_admin),
                permission="user.profile.write",
            ),
            None,
        )[1],
        "entfernen": lambda s: (
            MemberAdminService(s, fremd).remove(
                ziel.member_id,
                confirm_email=ziel.email,
                expected_version=version,
                actor=_actor(fremder_admin),
                permission="user.account.remove",
            ),
            None,
        )[1],
        "reset": lambda s: (
            PasswordResetService(s, fremd).issue(
                ziel.member_id, actor=_actor(fremder_admin), permission="user.password.reset"
            ),
            None,
        )[1],
        "einstellungen": lambda s: (
            PreferencesService(s, organization_id=fremd, member_id=ziel.member_id).create(
                PreferencesIn(theme_mode="dark", accent="teal", length_unit="m")
            ),
            None,
        )[1],
    }
    for name, arbeit in versuche.items():
        session = factory()
        try:
            if name == "einstellungen":
                # Der zusammengesetzte Fremdschluessel laesst den Verweis gar nicht zu.
                with pytest.raises(Exception):  # noqa: B017
                    arbeit(session)
            else:
                with pytest.raises(NotFoundError):
                    arbeit(session)
        finally:
            session.rollback()
            session.close()
    session = factory()
    try:
        member = session.get(OrganizationMember, ziel.member_id)
        konto = session.get(User, ziel.user_id)
        assert member is not None and member.status == "active" and member.version == version
        assert konto is not None and konto.full_name != "Uebernommen"
        assert session.execute(select(PasswordResetToken)).first() is None
    finally:
        session.close()


def test_entfernte_mitgliedschaft_bleibt_unter_parallelitaet_entfernt(
    factory: sessionmaker[Session], aufbau: Aufbau
) -> None:
    """Entfernen gegen Entsperren: Ein entferntes Konto kehrt nie zurueck."""
    session = factory()
    try:
        MemberAdminService(session, aufbau.organization_id).suspend(
            aufbau.planer.member_id,
            expected_version=_version(factory, aufbau.planer),
            actor=_actor(aufbau.admin_a),
            permission="user.account.lock",
        )
        session.commit()
    finally:
        session.close()
    version = _version(factory, aufbau.planer)

    def entsperren(s: Session) -> None:
        MemberAdminService(s, aufbau.organization_id).reactivate(
            aufbau.planer.member_id,
            expected_version=version,
            actor=_actor(aufbau.admin_b),
            permission="user.account.lock",
        )

    lauf = gleichzeitig(
        factory,
        {
            "entfernen": _entfernen(aufbau, aufbau.admin_a, aufbau.planer, version),
            "entsperren": entsperren,
        },
    )
    assert len(lauf.erfolge) == 1, lauf.fehler
    assert isinstance(lauf.fehler[0], VersionConflictError | MemberRemovedError)
    session = factory()
    try:
        member = session.get(OrganizationMember, aufbau.planer.member_id)
        assert member is not None
        assert member.status in {"removed", "active"}
        if "entfernen" in lauf.erfolge:
            assert member.status == "removed"
    finally:
        session.close()
