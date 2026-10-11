"""Anfragegrenzen (docs/security.md, Abschnitt 11; Sicherheitsauftrag, Befund 5).

Ohne Datenbank: Atomaritaet unter echten Threads, Rueckgabe, Wartezeit,
begrenzter Speicher. Mit Datenbank: Anmeldung unter Parallelitaet,
Sitzungserneuerung, allgemeine Schreibgrenze, einheitliche 429-Antwort mit
``Retry-After`` und keine personenbezogenen Schluessel im Log.
"""

from __future__ import annotations

import threading
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.auth import dependencies, service
from app.core.auth.rate_limit import (
    RateLimitExceededError,
    SlidingWindowLimiter,
    enforce,
    pseudonymous_key,
)
from app.core.auth.service import AuthService
from app.core.module_registry.registry import ModuleRegistry
from app.core.seed import seed_initial_data
from app.errors import AuthenticationError, RateLimitedError
from tests.conftest import ADMIN_PASSWORD, auth_headers, login, requires_database
from tests.verwaltung_hilfen import person_anlegen

ORIGIN = "http://localhost:5173"


class Uhr:
    def __init__(self) -> None:
        self.jetzt = 1000.0

    def __call__(self) -> float:
        return self.jetzt


# ------------------------------------------------------------ ohne Datenbank


def test_pruefen_und_reservieren_sind_atomar() -> None:
    """50 Threads gleichzeitig - genau ``limit`` erhalten einen Versuch."""
    limiter = SlidingWindowLimiter(name="test", limit=10, window_seconds=60)
    start = threading.Barrier(50)
    erlaubt: list[int] = []
    schloss = threading.Lock()

    def versuchen() -> None:
        start.wait()
        try:
            limiter.acquire("ip:1", "user:x")
        except RateLimitExceededError:
            return
        with schloss:
            erlaubt.append(1)

    threads = [threading.Thread(target=versuchen) for _ in range(50)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(erlaubt) == 10


def test_alles_oder_nichts_und_rueckgabe() -> None:
    limiter = SlidingWindowLimiter(name="test", limit=1, window_seconds=60)
    limiter.acquire("voll")
    with pytest.raises(RateLimitExceededError):
        limiter.acquire("frei", "voll")
    # "frei" wurde nicht mitgezaehlt.
    reservierung = limiter.acquire("frei")
    limiter.release(reservierung)
    limiter.acquire("frei")


def test_wartezeit_und_ablauf_des_fensters() -> None:
    uhr = Uhr()
    limiter = SlidingWindowLimiter(name="test", limit=2, window_seconds=60, clock=uhr)
    limiter.acquire("k")
    uhr.jetzt += 20
    limiter.acquire("k")
    with pytest.raises(RateLimitExceededError) as fehler:
        limiter.acquire("k")
    assert fehler.value.retry_after == 40
    uhr.jetzt += 40
    limiter.acquire("k")


def test_speicher_ist_begrenzt_und_alte_schluessel_verschwinden(
    capfd: pytest.CaptureFixture[str],
) -> None:
    uhr = Uhr()
    limiter = SlidingWindowLimiter(name="test", limit=5, window_seconds=10, max_keys=100, clock=uhr)
    for i in range(100):
        limiter.acquire(f"ip:{i}")
    assert limiter.key_count() == 100
    # Abgelaufene Schluessel werden beim naechsten neuen Schluessel bereinigt.
    uhr.jetzt += 11
    limiter.acquire("ip:neu")
    assert limiter.key_count() == 1
    # Ohne Ablauf verdraengt der Limiter die am laengsten unbenutzten.
    capfd.readouterr()
    for i in range(150):
        limiter.acquire(f"ip:flut-{i}")
    assert limiter.key_count() == 100
    ausgabe = capfd.readouterr().out
    assert "rate_limit_keys_evicted" in ausgabe
    assert "flut" not in ausgabe


def test_enforce_antwortet_mit_429_und_wartezeit() -> None:
    limiter = SlidingWindowLimiter(name="test", limit=1, window_seconds=30)
    enforce(limiter, "k", message="zu viel", log_event="test_limited")
    with pytest.raises(RateLimitedError) as fehler:
        enforce(limiter, "k", message="zu viel", log_event="test_limited")
    assert fehler.value.status_code == 429
    assert fehler.value.retry_after == 30


def test_pseudonymer_schluessel_enthaelt_keinen_klartext() -> None:
    schluessel = pseudonymous_key("user", "anna@example.test")
    assert "anna" not in schluessel
    assert schluessel.startswith("user:")


# ------------------------------------------------------------ mit Datenbank

EMAIL = "admin@grenzen.example"


@pytest.fixture
def factory(engine: Engine, clean_database: None) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture
def betrieb(factory: sessionmaker[Session], registry: ModuleRegistry) -> uuid.UUID:
    session = factory()
    try:
        result = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Grenzen GmbH",
            admin_email=EMAIL,
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
        return result.organization_id
    finally:
        session.close()


@requires_database
@pytest.mark.database
def test_parallele_fehlversuche_ueberschreiten_die_anmeldegrenze_nicht(
    factory: sessionmaker[Session], betrieb: uuid.UUID
) -> None:
    """20 gleichzeitige falsche Passwoerter - genau 10 werden geprueft."""
    start = threading.Barrier(20)
    ergebnisse: list[str] = []
    schloss = threading.Lock()

    def versuchen() -> None:
        session = factory()
        try:
            start.wait()
            AuthService(session).login(email=EMAIL, password="falsch-falsch-falsch")
        except RateLimitedError:
            with schloss:
                ergebnisse.append("429")
        except AuthenticationError:
            with schloss:
                ergebnisse.append("401")
        finally:
            session.rollback()
            session.close()

    threads = [threading.Thread(target=versuchen) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    assert sorted(ergebnisse) == ["401"] * 10 + ["429"] * 10


@requires_database
@pytest.mark.database
def test_erfolgreiche_anmeldung_zaehlt_nicht(
    factory: sessionmaker[Session], betrieb: uuid.UUID
) -> None:
    for _ in range(15):
        session = factory()
        try:
            AuthService(session).login(email=EMAIL, password=ADMIN_PASSWORD, client_ip="10.0.0.1")
            session.commit()
        finally:
            session.close()


@requires_database
@pytest.mark.database
def test_gesperrte_anmeldung_antwortet_einheitlich_ohne_personenbezug_im_log(
    api: TestClient, betrieb: uuid.UUID, capfd: pytest.CaptureFixture[str]
) -> None:
    capfd.readouterr()
    for _ in range(10):
        api.post("/api/v1/auth/login", json={"email": EMAIL, "password": "falsch-falsch-falsch"})
    antwort = api.post(
        "/api/v1/auth/login",
        json={"email": EMAIL, "password": ADMIN_PASSWORD},
        headers={"Origin": ORIGIN},
    )
    assert antwort.status_code == 429
    assert antwort.headers["content-type"].startswith("application/problem+json")
    assert antwort.json()["type"].endswith("/rate-limited")
    assert 1 <= int(antwort.headers["Retry-After"]) <= 900
    assert antwort.headers["access-control-allow-origin"] == ORIGIN
    assert "Retry-After" in antwort.headers["access-control-expose-headers"]
    ausgabe = capfd.readouterr().out
    assert "login_rate_limited" in ausgabe
    assert EMAIL not in ausgabe
    assert "grenzen" not in ausgabe


@requires_database
@pytest.mark.database
def test_sitzungserneuerung_je_konto_begrenzt(
    api: TestClient, betrieb: uuid.UUID, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(service._refresh_limiter, "limit", 3)
    login(api, EMAIL)
    for _ in range(3):
        assert api.post("/api/v1/auth/refresh").status_code == 200
    antwort = api.post("/api/v1/auth/refresh")
    assert antwort.status_code == 429
    assert int(antwort.headers["Retry-After"]) >= 1


@requires_database
@pytest.mark.database
def test_ungueltige_erneuerungen_je_ip_begrenzt_gueltige_nicht(
    api: TestClient, betrieb: uuid.UUID, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(service._refresh_invalid_limiter, "limit", 3)
    login(api, EMAIL)
    # Gueltige Erneuerungen verbrauchen das Kontingent fuer ungueltige nicht.
    for _ in range(5):
        assert api.post("/api/v1/auth/refresh").status_code == 200
    fremd = TestClient(api.app)
    for _ in range(3):
        antwort = fremd.post(
            "/api/v1/auth/refresh", headers={"Cookie": "elektroplan_refresh=unbekannt"}
        )
        assert antwort.status_code == 401
    antwort = fremd.post(
        "/api/v1/auth/refresh", headers={"Cookie": "elektroplan_refresh=unbekannt"}
    )
    assert antwort.status_code == 429


def _kunde_anlegen(api: TestClient, token: str, name: str) -> int:
    return api.post(
        "/api/v1/customers",
        headers=auth_headers(token),
        json={"name": name},
    ).status_code


@requires_database
@pytest.mark.database
def test_schreibgrenze_je_mitglied_und_lesen_bleibt_frei(
    api: TestClient, betrieb: uuid.UUID, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(dependencies._write_limiter_member, "limit", 3)
    token = login(api, EMAIL)
    assert [_kunde_anlegen(api, token, f"Kunde {i}") for i in range(3)] == [201] * 3
    antwort = api.post(
        "/api/v1/customers",
        headers=auth_headers(token),
        json={"name": "Kunde 4"},
    )
    assert antwort.status_code == 429
    assert antwort.headers["Retry-After"]
    assert api.get("/api/v1/customers", headers=auth_headers(token)).status_code == 200


@requires_database
@pytest.mark.database
def test_schreibgrenze_je_betrieb_ueber_mehrere_mitglieder(
    api: TestClient,
    engine: Engine,
    betrieb: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(dependencies._write_limiter_organization, "limit", 4)
    person_anlegen(engine, betrieb, "kalk@grenzen.example", ["kalkulator"])
    admin = login(api, EMAIL)
    kalkulator = login(api, "kalk@grenzen.example")
    ergebnisse = [
        _kunde_anlegen(api, token, f"Kunde {i}")
        for i, token in enumerate([admin, kalkulator, admin, kalkulator, admin])
    ]
    assert ergebnisse == [201, 201, 201, 201, 429]


@requires_database
@pytest.mark.database
def test_unangemeldete_schreibanfrage_verbraucht_kein_kontingent(
    api: TestClient, betrieb: uuid.UUID, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(dependencies._write_limiter_organization, "limit", 1)
    for _ in range(5):
        antwort = api.post("/api/v1/customers", json={"name": "x"})
        assert antwort.status_code == 401
    token = login(api, EMAIL)
    assert _kunde_anlegen(api, token, "Kunde") == 201
