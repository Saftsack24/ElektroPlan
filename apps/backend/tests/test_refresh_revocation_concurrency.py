"""Refresh-Rotation gegen Sitzungswiderruf - echte PostgreSQL-Transaktionen.

Sicherheitsauftrag 2026-10-10, Befund 4: Eine Rotation sperrt nur den
vorgelegten Refresh Token. Ein Widerruf, der nur die zum Abfragezeitpunkt
sichtbaren Zeilen einer Familie widerruft, uebersieht einen Nachfolger, den
eine gleichzeitige Rotation gerade anlegt - der Nachfolger ermoeglicht dann
trotz abgeschlossenem Widerruf eine neue Sitzung.

Synchronisation ohne Sleeps als Mittel der Wahl: Eine Transaktion wird im
Hauptthread offen gehalten, die zweite laeuft in einem Thread. Gewartet wird,
bis PostgreSQL deren Backend nachweislich auf eine Sperre warten laesst
(``pg_stat_activity.wait_event_type = 'Lock'``) - erst dann committet die
erste. Damit ist die Reihenfolge erzwungen, nicht erhofft.

Geprueft wird jeweils der Zustand **nach** beiden Commits: Kein Token der
widerrufenen Familie darf noch eine Sitzung erneuern.
"""

from __future__ import annotations

import threading
import time
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.core.auth import service as auth_service
from app.core.auth.service import (
    AuthService,
    IssuedTokens,
    _login_limiter,
    revoke_membership_sessions,
)
from app.core.members.service import Actor, MemberAdminService
from app.core.module_registry.registry import ModuleRegistry
from app.core.organizations.models import OrganizationMember
from app.core.seed import seed_initial_data
from app.errors import AuthenticationError
from tests.conftest import ADMIN_PASSWORD, requires_database
from tests.verwaltung_hilfen import admin_mitglied, person_anlegen

pytestmark = [requires_database, pytest.mark.database]

EMAIL = "admin@rotation.example"
#: Obergrenze fuer das Warten auf eine Sperre - nur Schutz gegen Haenger.
WARTEN_SEKUNDEN = 10.0


@pytest.fixture
def factory(engine: Engine, clean_database: None) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture(autouse=True)
def _limiter() -> Iterator[None]:
    _login_limiter.clear()
    yield
    _login_limiter.clear()


@pytest.fixture
def betrieb(factory: sessionmaker[Session], registry: ModuleRegistry) -> dict[str, uuid.UUID]:
    session = factory()
    try:
        result = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Rotation GmbH",
            admin_email=EMAIL,
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
        return {"organization_id": result.organization_id, "user_id": result.admin_user_id}
    finally:
        session.close()


def _anmelden(factory: sessionmaker[Session]) -> IssuedTokens:
    session = factory()
    try:
        tokens = AuthService(session).login(email=EMAIL, password=ADMIN_PASSWORD)
        session.commit()
        return tokens
    finally:
        session.close()


def _erneuern(factory: sessionmaker[Session], raw: str) -> IssuedTokens:
    session = factory()
    try:
        tokens = AuthService(session).refresh(raw)
        session.commit()
        return tokens
    finally:
        session.close()


def _erneuerung_scheitert(factory: sessionmaker[Session], raw: str) -> bool:
    try:
        _erneuern(factory, raw)
    except AuthenticationError:
        return True
    return False


@dataclass
class Gegenspieler:
    """Zweite Transaktion in eigenem Thread mit eigener Session."""

    thread: threading.Thread
    pid: list[int] = field(default_factory=list)
    fehler: list[BaseException] = field(default_factory=list)
    gestartet: threading.Event = field(default_factory=threading.Event)


def _starten(
    factory: sessionmaker[Session], arbeit: Callable[[Session], None], name: str | None = None
) -> Gegenspieler:
    gegenspieler = Gegenspieler(thread=threading.Thread(daemon=True))

    def laufen() -> None:
        session = factory()
        try:
            pid = session.execute(text("SELECT pg_backend_pid()")).scalar_one()
            gegenspieler.pid.append(int(pid))
            gegenspieler.gestartet.set()
            arbeit(session)
            session.commit()
        except BaseException as exc:
            session.rollback()
            gegenspieler.fehler.append(exc)
        finally:
            gegenspieler.gestartet.set()
            session.close()

    gegenspieler.thread = threading.Thread(target=laufen, daemon=True, name=name)
    gegenspieler.thread.start()
    return gegenspieler


def _warte_auf_sperre(engine: Engine, gegenspieler: Gegenspieler) -> bool:
    """True, sobald PostgreSQL den Gegenspieler auf eine Sperre warten laesst.

    False, wenn der Gegenspieler fertig ist, ohne je zu warten.
    """
    assert gegenspieler.gestartet.wait(WARTEN_SEKUNDEN)
    if not gegenspieler.pid:
        return False
    ende = time.monotonic() + WARTEN_SEKUNDEN
    with engine.connect() as beobachter:
        while time.monotonic() < ende:
            if not gegenspieler.thread.is_alive():
                return False
            wartet = beobachter.execute(
                text("SELECT wait_event_type = 'Lock' FROM pg_stat_activity WHERE pid = :pid"),
                {"pid": gegenspieler.pid[0]},
            ).scalar_one_or_none()
            beobachter.rollback()
            if wartet:
                return True
            time.sleep(0.005)
    pytest.fail("Der Gegenspieler hat weder gewartet noch beendet.")


def _beenden(gegenspieler: Gegenspieler) -> None:
    gegenspieler.thread.join(timeout=WARTEN_SEKUNDEN * 2)
    assert not gegenspieler.thread.is_alive(), "Der Gegenspieler haengt."


# ------------------------------------------------------------ Logout


def test_logout_waehrend_laufender_rotation_erfasst_den_nachfolger(
    engine: Engine, factory: sessionmaker[Session], betrieb: dict[str, uuid.UUID]
) -> None:
    """Rotation zuerst (offen), Logout wartet - danach ist auch T2 wertlos."""
    t1 = _anmelden(factory)

    rotation = factory()
    t2 = AuthService(rotation).refresh(t1.refresh_token)
    abmeldung = _starten(factory, lambda s: AuthService(s).logout(t1.refresh_token))
    assert _warte_auf_sperre(engine, abmeldung), "Logout haette auf die Rotation warten muessen."
    rotation.commit()
    rotation.close()
    _beenden(abmeldung)
    assert abmeldung.fehler == []

    assert _erneuerung_scheitert(factory, t2.refresh_token), (
        "Der Nachfolger einer gleichzeitigen Rotation hat den Logout ueberlebt."
    )
    assert _erneuerung_scheitert(factory, t1.refresh_token)


def test_rotation_nach_begonnenem_logout_scheitert(
    engine: Engine, factory: sessionmaker[Session], betrieb: dict[str, uuid.UUID]
) -> None:
    """Logout zuerst (offen, Sperren gehalten), Rotation wartet und scheitert."""
    t1 = _anmelden(factory)

    abmeldung = factory()
    AuthService(abmeldung).logout(t1.refresh_token)
    abmeldung.flush()
    ergebnis: list[IssuedTokens] = []
    rotation = _starten(
        factory, lambda s: ergebnis.append(AuthService(s).refresh(t1.refresh_token))
    )
    assert _warte_auf_sperre(engine, rotation), "Die Rotation haette warten muessen."
    abmeldung.commit()
    abmeldung.close()
    _beenden(rotation)

    assert ergebnis == []
    assert len(rotation.fehler) == 1
    assert isinstance(rotation.fehler[0], AuthenticationError)


# ------------------------------------------------- Wiederverwendung


def test_wiederverwendungserkennung_waehrend_rotation_erfasst_den_nachfolger(
    engine: Engine,
    factory: sessionmaker[Session],
    betrieb: dict[str, uuid.UUID],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """T1 wird nach dem Toleranzfenster erneut vorgelegt, waehrend T2 rotiert."""
    monkeypatch.setattr(get_settings(), "refresh_race_grace_seconds", 0)
    t1 = _anmelden(factory)
    t2 = _erneuern(factory, t1.refresh_token)

    rotation = factory()
    t3 = AuthService(rotation).refresh(t2.refresh_token)
    angreifer = _starten(factory, lambda s: AuthService(s).refresh(t1.refresh_token))
    assert _warte_auf_sperre(engine, angreifer), "Die Erkennung haette warten muessen."
    rotation.commit()
    rotation.close()
    _beenden(angreifer)

    assert len(angreifer.fehler) == 1
    assert isinstance(angreifer.fehler[0], AuthenticationError)
    assert _erneuerung_scheitert(factory, t3.refresh_token), (
        "Der Nachfolger hat die Wiederverwendungserkennung ueberlebt."
    )


def test_paralleler_refresh_im_toleranzfenster_bleibt_harmlos(
    factory: sessionmaker[Session], betrieb: dict[str, uuid.UUID]
) -> None:
    """Gegenprobe: Das Toleranzfenster beendet die Sitzung weiterhin nicht."""
    t1 = _anmelden(factory)
    t2 = _erneuern(factory, t1.refresh_token)
    with pytest.raises(AuthenticationError) as fehler:
        _erneuern(factory, t1.refresh_token)
    assert fehler.value.error_type == "refresh-conflict"
    t3 = _erneuern(factory, t2.refresh_token)
    assert t3.refresh_token


# --------------------------------------------------- Familienwiderruf


def test_mitgliedschaftswiderruf_waehrend_rotation_erfasst_den_nachfolger(
    engine: Engine, factory: sessionmaker[Session], betrieb: dict[str, uuid.UUID]
) -> None:
    """Widerruf aller Familien einer Mitgliedschaft waehrend einer Rotation.

    Bewusst **ohne** Hochzaehlen der Sitzungsversion: Geprueft wird, dass der
    gespeicherte Familienzustand allein genuegt. Im Lebenszyklus kommt die
    Sitzungsversion als zweite Schicht hinzu.
    """
    t1 = _anmelden(factory)

    rotation = factory()
    t2 = AuthService(rotation).refresh(t1.refresh_token)
    widerruf = _starten(
        factory,
        lambda s: revoke_membership_sessions(
            s, user_id=betrieb["user_id"], organization_id=betrieb["organization_id"]
        ),
    )
    assert _warte_auf_sperre(engine, widerruf), "Der Widerruf haette warten muessen."
    rotation.commit()
    rotation.close()
    _beenden(widerruf)
    assert widerruf.fehler == []

    assert _erneuerung_scheitert(factory, t2.refresh_token), (
        "Der Nachfolger hat den Familienwiderruf ueberlebt."
    )


def test_logout_einer_sitzung_laesst_andere_sitzungen_bestehen(
    factory: sessionmaker[Session], betrieb: dict[str, uuid.UUID]
) -> None:
    """Ein Logout beendet nur die eigene Familie, nicht weitere Geraete."""
    geraet_a = _anmelden(factory)
    geraet_b = _anmelden(factory)
    session = factory()
    try:
        AuthService(session).logout(geraet_a.refresh_token)
        session.commit()
    finally:
        session.close()
    assert _erneuerung_scheitert(factory, geraet_a.refresh_token)
    assert _erneuern(factory, geraet_b.refresh_token).refresh_token


# ------------------------------------------------ Sperrreihenfolge


def test_email_aenderung_waehrend_rotation_ohne_deadlock(
    engine: Engine,
    factory: sessionmaker[Session],
    betrieb: dict[str, uuid.UUID],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Die Rotation haelt die Familie, eine E-Mail-Aenderung sperrt das Konto.

    Die Rotation braucht beim Anlegen des Nachfolgers eine ``KEY SHARE``-Sperre
    auf ``users``; die E-Mail-Aenderung (eindeutige Spalte) haelt dort eine
    ``FOR UPDATE``-Sperre und wartet dann auf die Familie. Ohne feste
    Reihenfolge (Konto vor Familie) entsteht ein Deadlock. Die Rotation wird
    deshalb direkt nach der Familiensperre angehalten, bis die Aenderung
    nachweislich wartet.
    """
    planer = person_anlegen(
        engine, betrieb["organization_id"], "planer@rotation.example", ["planer"]
    )
    admin = admin_mitglied(engine, betrieb["organization_id"], EMAIL)
    session = factory()
    try:
        t1 = AuthService(session).login(email=planer.email, password=ADMIN_PASSWORD)
        session.commit()
    finally:
        session.close()

    original = auth_service._lock_family
    angehalten = threading.Event()
    weiter = threading.Event()

    def anhalten(s: Session, family_id: uuid.UUID) -> object:
        familie = original(s, family_id)
        if threading.current_thread().name == "rotation":
            angehalten.set()
            assert weiter.wait(WARTEN_SEKUNDEN)
        return familie

    monkeypatch.setattr(auth_service, "_lock_family", anhalten)

    ergebnis: list[IssuedTokens] = []
    rotation = _starten(
        factory, lambda s: ergebnis.append(AuthService(s).refresh(t1.refresh_token)), "rotation"
    )
    assert angehalten.wait(WARTEN_SEKUNDEN)

    def aendern(s: Session) -> None:
        member = s.get(OrganizationMember, planer.member_id)
        assert member is not None
        MemberAdminService(s, betrieb["organization_id"]).update_profile(
            planer.member_id,
            full_name=None,
            email="umgezogen@rotation.example",
            expected_version=member.version,
            actor=Actor(user_id=admin.user_id, member_id=admin.member_id),
            permission="user.profile.write",
        )

    aenderung = _starten(factory, aendern)
    assert _warte_auf_sperre(engine, aenderung), "Die Aenderung haette warten muessen."
    weiter.set()
    _beenden(rotation)
    _beenden(aenderung)

    assert rotation.fehler == [], rotation.fehler
    assert aenderung.fehler == [], aenderung.fehler
    assert _erneuerung_scheitert(factory, ergebnis[0].refresh_token)
