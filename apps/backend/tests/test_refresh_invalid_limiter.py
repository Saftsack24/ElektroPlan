"""Grenze fuer ungueltige Erneuerungen je IP schuetzt Unbeteiligte (Review 2026-10-10).

Zwei Benutzer A und B hinter **derselben** IP. Nur echte ungueltige Versuche
duerfen das gemeinsame Kontingent verbrauchen - unbekannte, widerrufene,
abgelaufene Tokens und die Wiederverwendung eines ersetzten Tokens. Ein
harmloser paralleler Refresh im Toleranzfenster, die persoenliche Kontogrenze
und interne Fehler geben die **eigene** Reservierung zurueck; fremde
Reservierungen bleiben unberuehrt, keine wird doppelt zurueckgegeben oder geht
verloren. Gegen echtes PostgreSQL.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.core.auth import service as auth_service
from app.core.auth.rate_limit import SlidingWindowLimiter
from app.core.auth.service import AuthService, IssuedTokens
from app.core.module_registry.registry import ModuleRegistry
from app.core.seed import seed_initial_data
from app.errors import AuthenticationError, RateLimitedError, RefreshConflictError
from tests.conftest import ADMIN_PASSWORD, requires_database
from tests.verwaltung_hilfen import person_anlegen

IP = "10.20.30.40"
KEY = f"ip:{IP}"
A = "anna@gemeinsame-ip.example"
B = "bert@gemeinsame-ip.example"

limiter: SlidingWindowLimiter = auth_service._refresh_invalid_limiter


# ------------------------------------------------------------ ohne Datenbank


def test_rueckgabe_entfernt_genau_die_eigene_reservierung() -> None:
    eigener = SlidingWindowLimiter(name="test", limit=10, window_seconds=60, clock=lambda: 5.0)
    erste = eigener.acquire("k")
    zweite = eigener.acquire("k")  # gleicher Zeitstempel
    dritte = eigener.acquire("k")
    eigener.release(zweite)
    eigener.release(zweite)  # doppelt: wirkungslos
    assert eigener.count("k") == 2
    eigener.release(erste)
    assert eigener.count("k") == 1
    eigener.release(dritte)
    assert eigener.count("k") == 0


def test_parallele_rueckgaben_verlieren_und_verdoppeln_nichts() -> None:
    eigener = SlidingWindowLimiter(name="test", limit=1000, window_seconds=60)
    start = threading.Barrier(60)

    def arbeit(i: int) -> None:
        start.wait()
        reservierung = eigener.acquire("k")
        if i % 2 == 0:
            eigener.release(reservierung)
            eigener.release(reservierung)

    threads = [threading.Thread(target=arbeit, args=(i,)) for i in range(60)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert eigener.count("k") == 30


# ------------------------------------------------------------ mit Datenbank


@pytest.fixture
def factory(engine: Engine, clean_database: None) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture
def betrieb(engine: Engine, factory: sessionmaker[Session], registry: ModuleRegistry) -> uuid.UUID:
    session = factory()
    try:
        organization_id = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Gemeinsame IP GmbH",
            admin_email=A,
            admin_password=ADMIN_PASSWORD,
        ).organization_id
        session.commit()
    finally:
        session.close()
    person_anlegen(engine, organization_id, B, ["planer"])
    return organization_id


def _anmelden(factory: sessionmaker[Session], email: str) -> IssuedTokens:
    session = factory()
    try:
        tokens = AuthService(session).login(email=email, password=ADMIN_PASSWORD)
        session.commit()
        return tokens
    finally:
        session.close()


def _erneuern(factory: sessionmaker[Session], roh: str) -> IssuedTokens:
    session = factory()
    try:
        tokens = AuthService(session).refresh(roh, client_ip=IP)
        session.commit()
        return tokens
    except BaseException:
        session.rollback()
        raise
    finally:
        session.close()


def _ergebnis(factory: sessionmaker[Session], roh: str) -> str:
    try:
        _erneuern(factory, roh)
    except RefreshConflictError:
        return "konflikt"
    except RateLimitedError:
        return "429"
    except AuthenticationError:
        return "401"
    return "ok"


@pytest.mark.usefixtures("betrieb")
@requires_database
@pytest.mark.database
def test_viele_harmlose_konflikte_von_a_blockieren_b_nicht(
    factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(limiter, "limit", 3)
    a1 = _anmelden(factory, A)
    a2 = _erneuern(factory, a1.refresh_token)
    # A legt den ersetzten Token zehnmal parallel-artig im Toleranzfenster vor.
    assert [_ergebnis(factory, a1.refresh_token) for _ in range(10)] == ["konflikt"] * 10
    assert limiter.count(KEY) == 0
    b = _anmelden(factory, B)
    assert _ergebnis(factory, b.refresh_token) == "ok"
    assert _ergebnis(factory, a2.refresh_token) == "ok"


@pytest.mark.usefixtures("betrieb")
@requires_database
@pytest.mark.database
def test_kontogrenze_von_a_blockiert_b_nicht_ueber_die_ip(
    factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(limiter, "limit", 3)
    monkeypatch.setattr(auth_service._refresh_limiter, "limit", 2)
    roh = _anmelden(factory, A).refresh_token
    for _ in range(2):
        roh = _erneuern(factory, roh).refresh_token
    assert [_ergebnis(factory, roh) for _ in range(8)] == ["429"] * 8
    assert limiter.count(KEY) == 0
    b = _anmelden(factory, B)
    assert _ergebnis(factory, b.refresh_token) == "ok"


@pytest.mark.usefixtures("betrieb")
@requires_database
@pytest.mark.database
def test_echte_ungueltige_versuche_verbrauchen_das_gemeinsame_kontingent(
    factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(limiter, "limit", 4)
    monkeypatch.setattr(get_settings(), "refresh_race_grace_seconds", 0)
    a1 = _anmelden(factory, A)
    a2 = _erneuern(factory, a1.refresh_token)
    abgemeldet = _anmelden(factory, A)
    session = factory()
    try:
        AuthService(session).logout(abgemeldet.refresh_token)
        session.commit()
    finally:
        session.close()
    assert _ergebnis(factory, "unbekannt-1") == "401"  # unbekannt
    assert _ergebnis(factory, abgemeldet.refresh_token) == "401"  # widerrufene Familie
    assert _ergebnis(factory, a1.refresh_token) == "401"  # Wiederverwendung nach Fenster
    assert _ergebnis(factory, a2.refresh_token) == "401"  # Familie inzwischen widerrufen
    assert limiter.count(KEY) == 4
    b = _anmelden(factory, B)
    assert _ergebnis(factory, b.refresh_token) == "429"  # gemeinsame IP ist erschoepft


@pytest.mark.usefixtures("betrieb")
@requires_database
@pytest.mark.database
def test_interner_fehler_zaehlt_nicht_als_ungueltiger_token(
    factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    a = _anmelden(factory, A)

    def kaputt(*_: object, **__: object) -> None:
        raise RuntimeError("Datenbank weg")

    monkeypatch.setattr(auth_service, "_lock_family", kaputt)
    with pytest.raises(RuntimeError):
        _erneuern(factory, a.refresh_token)
    assert limiter.count(KEY) == 0


@pytest.mark.usefixtures("betrieb")
@requires_database
@pytest.mark.database
def test_gemischte_parallele_ergebnisse_entfernen_keine_fremden_reservierungen(
    factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Gleichzeitig: 8 gueltige, 8 Konflikte, 8 unbekannte Tokens - genau 8 zaehlen."""
    monkeypatch.setattr(limiter, "limit", 1000)
    # Der Aufbau (16 Anmeldungen mit Argon2) darf das Toleranzfenster nicht
    # ausschoepfen - sonst waeren die Konflikte echte Wiederverwendungen.
    monkeypatch.setattr(get_settings(), "refresh_race_grace_seconds", 120)
    gueltige = [_anmelden(factory, A if i % 2 else B).refresh_token for i in range(8)]
    ersetzte = []
    for i in range(8):
        alt = _anmelden(factory, B if i % 2 else A).refresh_token
        _erneuern(factory, alt)
        ersetzte.append(alt)
    unbekannte = [f"unbekannt-{i}" for i in range(8)]
    auftraege: list[tuple[str, str]] = (
        [("ok", r) for r in gueltige]
        + [("konflikt", r) for r in ersetzte]
        + [("401", r) for r in unbekannte]
    )
    start = threading.Barrier(len(auftraege))
    ergebnisse: list[tuple[str, str]] = []
    schloss = threading.Lock()

    def arbeit(erwartet: str, roh: str) -> Callable[[], None]:
        def lauf() -> None:
            start.wait()
            ist = _ergebnis(factory, roh)
            with schloss:
                ergebnisse.append((erwartet, ist))

        return lauf

    threads = [threading.Thread(target=arbeit(e, r)) for e, r in auftraege]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    assert sorted(ergebnisse) == sorted((e, e) for e, _ in auftraege)
    assert limiter.count(KEY) == 8


@pytest.mark.usefixtures("betrieb")
@requires_database
@pytest.mark.database
def test_ueber_die_api_konflikte_von_a_blockieren_b_nicht(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Integrationsfall ueber HTTP: beide Clients mit derselben Adresse (``testclient``)."""
    monkeypatch.setattr(limiter, "limit", 2)
    anna = TestClient(api.app)
    bert = TestClient(api.app)
    assert (
        anna.post("/api/v1/auth/login", json={"email": A, "password": ADMIN_PASSWORD}).status_code
        == 200
    )
    assert (
        bert.post("/api/v1/auth/login", json={"email": B, "password": ADMIN_PASSWORD}).status_code
        == 200
    )
    alt = anna.cookies.get("elektroplan_refresh")
    assert anna.post("/api/v1/auth/refresh").status_code == 200
    for _ in range(6):
        konflikt = TestClient(api.app).post(
            "/api/v1/auth/refresh", headers={"Cookie": f"elektroplan_refresh={alt}"}
        )
        assert konflikt.status_code == 401
        assert konflikt.json()["type"].endswith("refresh-conflict")
    assert limiter.count("ip:testclient") == 0
    assert bert.post("/api/v1/auth/refresh").status_code == 200
