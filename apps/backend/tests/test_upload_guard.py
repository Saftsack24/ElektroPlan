"""Fruehe Upload-Schranke vor der Multipart-Verarbeitung (Sicherheitsauftrag, Befund 2).

Die Anfragen gehen als **rohes ASGI** an die Anwendung. ``receive`` liefert
den Koerper stueckweise und zaehlt mit, wie viele Bytes die Anwendung
tatsaechlich abgeholt hat. Damit ist nachgewiesen, *wann* die Schranke
greift - nicht nur, *dass* am Ende ein Fehler steht:

* Unangemeldet, ohne Upload-Recht, zu grosse ``Content-Length`` oder
  ausgeschoepfte Upload-Grenze: **kein einziges** Byte wird gelesen.
* Fehlende oder falsche ``Content-Length``: abgebrochen, sobald die
  tatsaechlich empfangenen Bytes die Anfragegrenze ueberschreiten - weit vor
  dem Ende des angebotenen Koerpers.
* Abgewiesene Anfragen hinterlassen keine temporaeren Dateien.
* CORS und Problem-Details bleiben erhalten.
"""

from __future__ import annotations

import tempfile
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import anyio
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from starlette.formparsers import MultiPartParser

from app.config import get_settings
from app.core.files import upload_form
from app.core.module_registry.registry import ModuleRegistry
from app.core.seed import seed_initial_data
from tests.conftest import (
    ADMIN_PASSWORD,
    login,
    requires_database,
    requires_object_storage,
)
from tests.verwaltung_hilfen import person_anlegen

pytestmark = [requires_database, pytest.mark.database]

ADMIN_EMAIL = "admin@upload-schranke.example"
GRENZE = b"----elektroplan-grenze"
STUECK = 64 * 1024
ORIGIN = "http://localhost:5173"


@pytest.fixture
def betrieb(engine: Engine, registry: ModuleRegistry, clean_database: None) -> uuid.UUID:
    from sqlalchemy.orm import sessionmaker

    session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    try:
        result = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Upload GmbH",
            admin_email=ADMIN_EMAIL,
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
        return result.organization_id
    finally:
        session.close()


@pytest.fixture
def kleines_limit(monkeypatch: pytest.MonkeyPatch) -> int:
    """Dateilimit 64 KiB, Zuschlag 16 KiB -> Anfragegrenze 80 KiB."""
    settings = get_settings()
    monkeypatch.setattr(settings, "upload_max_bytes", 64 * 1024)
    monkeypatch.setattr(settings, "upload_request_overhead_bytes", 16 * 1024)
    return settings.upload_request_max_bytes


@dataclass
class Antwort:
    status: int
    headers: dict[str, str]
    body: bytes
    gelesen: int
    angeboten: int
    meldungen: list[dict[str, Any]] = field(default_factory=list)


def _teil(name: str, wert: bytes, dateiname: str | None = None, typ: str | None = None) -> bytes:
    kopf = f'Content-Disposition: form-data; name="{name}"'
    if dateiname is not None:
        kopf += f'; filename="{dateiname}"'
    zeilen = [b"--" + GRENZE, kopf.encode()]
    if typ is not None:
        zeilen.append(f"Content-Type: {typ}".encode())
    return b"\r\n".join(zeilen) + b"\r\n\r\n" + wert + b"\r\n"


def _formular(*teile: bytes) -> bytes:
    return b"".join(teile) + b"--" + GRENZE + b"--\r\n"


def _pdf_strom(groesse: int) -> Iterator[bytes]:
    """Ein Dateiteil, dessen Inhalt erst beim Lesen entsteht."""
    yield (
        b"--"
        + GRENZE
        + b'\r\nContent-Disposition: form-data; name="upload"; filename="gross.pdf"\r\n'
        + b"Content-Type: application/pdf\r\n\r\n%PDF-1.7\n"
    )
    rest = groesse
    while rest > 0:
        n = min(STUECK, rest)
        rest -= n
        yield b"x" * n
    yield b"\r\n--" + GRENZE + b"--\r\n"


def _senden(
    app: FastAPI,
    *,
    koerper: Iterator[bytes],
    token: str | None = None,
    content_length: int | None = None,
    abbruch_nach: int | None = None,
    origin: str | None = None,
) -> Antwort:
    """Ruft die Anwendung als ASGI auf und zaehlt die gelesenen Bytes."""
    headers = [
        (b"host", b"testserver"),
        (b"content-type", b"multipart/form-data; boundary=" + GRENZE),
    ]
    if token is not None:
        headers.append((b"authorization", f"Bearer {token}".encode()))
    if content_length is not None:
        headers.append((b"content-length", str(content_length).encode()))
    if origin is not None:
        headers.append((b"origin", origin.encode()))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/v1/files",
        "raw_path": b"/api/v1/files",
        "query_string": b"",
        "root_path": "",
        "headers": headers,
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
    }
    stuecke = list(koerper)
    angeboten = sum(len(s) for s in stuecke)
    stand = {"gelesen": 0, "index": 0, "aufrufe": 0}
    meldungen: list[dict[str, Any]] = []

    async def receive() -> dict[str, Any]:
        stand["aufrufe"] += 1
        if abbruch_nach is not None and stand["index"] >= abbruch_nach:
            return {"type": "http.disconnect"}
        if stand["index"] >= len(stuecke):
            return {"type": "http.disconnect"}
        stueck = stuecke[stand["index"]]
        stand["index"] += 1
        stand["gelesen"] += len(stueck)
        return {
            "type": "http.request",
            "body": stueck,
            "more_body": stand["index"] < len(stuecke),
        }

    async def send(message: dict[str, Any]) -> None:
        meldungen.append(message)

    async def ausfuehren() -> None:
        await app(scope, receive, send)

    anyio.run(ausfuehren)
    start = next(m for m in meldungen if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in meldungen if m["type"] == "http.response.body")
    return Antwort(
        status=start["status"],
        headers={k.decode().lower(): v.decode() for k, v in start["headers"]},
        body=body,
        gelesen=stand["gelesen"],
        angeboten=angeboten,
        meldungen=meldungen,
    )


# ------------------------------------------------- vor jedem Byte abgewiesen


def test_unangemeldeter_grosser_upload_liest_kein_byte(
    api: TestClient, betrieb: uuid.UUID, kleines_limit: int
) -> None:
    antwort = _senden(api.app, koerper=_pdf_strom(2 * 1024 * 1024))  # type: ignore[arg-type]
    assert antwort.status == 401
    assert antwort.gelesen == 0
    assert antwort.angeboten > 2 * 1024 * 1024


def test_ohne_upload_recht_liest_kein_byte(
    api: TestClient, engine: Engine, betrieb: uuid.UUID, kleines_limit: int
) -> None:
    person_anlegen(engine, betrieb, "monteur@upload-schranke.example", ["monteur"])
    token = login(api, "monteur@upload-schranke.example")
    antwort = _senden(api.app, koerper=_pdf_strom(1024 * 1024), token=token)  # type: ignore[arg-type]
    assert antwort.status == 403
    assert antwort.gelesen == 0


def test_zu_grosse_content_length_liest_kein_byte_und_behaelt_cors(
    api: TestClient, betrieb: uuid.UUID, kleines_limit: int
) -> None:
    token = login(api, ADMIN_EMAIL)
    antwort = _senden(
        api.app,  # type: ignore[arg-type]
        koerper=_pdf_strom(1024 * 1024),
        token=token,
        content_length=kleines_limit + 1,
        origin=ORIGIN,
    )
    assert antwort.status == 413
    assert antwort.gelesen == 0
    assert antwort.headers["content-type"].startswith("application/problem+json")
    assert b"payload-too-large" in antwort.body
    assert antwort.headers["access-control-allow-origin"] == ORIGIN


def test_ausgeschoepfte_uploadgrenze_liest_kein_byte(
    api: TestClient, betrieb: uuid.UUID, kleines_limit: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(upload_form._upload_limiter, "limit", 1)
    token = login(api, ADMIN_EMAIL)
    erste = _senden(api.app, koerper=iter([_formular()]), token=token)  # type: ignore[arg-type]
    assert erste.status == 422  # Formular ohne Datei - zaehlt trotzdem als Upload
    zweite = _senden(api.app, koerper=_pdf_strom(1024 * 1024), token=token)  # type: ignore[arg-type]
    assert zweite.status == 429
    assert zweite.gelesen == 0
    assert int(zweite.headers["retry-after"]) >= 1


# ------------------------------------------- gezaehlte Bytes, nicht die Angabe


def test_ohne_content_length_bricht_bei_der_anfragegrenze_ab(
    api: TestClient, betrieb: uuid.UUID, kleines_limit: int
) -> None:
    token = login(api, ADMIN_EMAIL)
    antwort = _senden(api.app, koerper=_pdf_strom(4 * 1024 * 1024), token=token)  # type: ignore[arg-type]
    assert antwort.status == 413
    assert antwort.gelesen <= kleines_limit + STUECK
    assert antwort.gelesen < antwort.angeboten // 10


def test_falsche_content_length_wird_nicht_geglaubt(
    api: TestClient, betrieb: uuid.UUID, kleines_limit: int
) -> None:
    token = login(api, ADMIN_EMAIL)
    antwort = _senden(
        api.app,  # type: ignore[arg-type]
        koerper=_pdf_strom(4 * 1024 * 1024),
        token=token,
        content_length=100,
    )
    assert antwort.status == 413
    assert antwort.gelesen <= kleines_limit + STUECK


def test_abgewiesene_anfrage_hinterlaesst_keine_temporaeren_dateien(
    api: TestClient,
    betrieb: uuid.UUID,
    kleines_limit: int,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Der Puffer lagert schon ab 1 KiB auf die Platte aus - und wird geschlossen."""
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    monkeypatch.setattr(MultiPartParser, "spool_max_size", 1024)
    token = login(api, ADMIN_EMAIL)
    zu_gross = _senden(api.app, koerper=_pdf_strom(1024 * 1024), token=token)  # type: ignore[arg-type]
    assert zu_gross.status == 413
    abgebrochen = _senden(
        api.app,  # type: ignore[arg-type]
        koerper=_pdf_strom(40 * 1024),
        token=token,
        abbruch_nach=2,
    )
    assert abgebrochen.status == 422
    assert list(tmp_path.iterdir()) == []


# ------------------------------------------------------------ Formular


def test_mehrere_dateiteile_werden_abgelehnt(
    api: TestClient, betrieb: uuid.UUID, kleines_limit: int
) -> None:
    token = login(api, ADMIN_EMAIL)
    pdf = b"%PDF-1.7\n" + b"a" * 100
    koerper = _formular(
        _teil("upload", pdf, "a.pdf", "application/pdf"),
        _teil("upload", pdf, "b.pdf", "application/pdf"),
    )
    antwort = _senden(api.app, koerper=iter([koerper]), token=token)  # type: ignore[arg-type]
    assert antwort.status == 422


def test_unbekanntes_und_zu_langes_feld_werden_abgelehnt(
    api: TestClient, betrieb: uuid.UUID, kleines_limit: int
) -> None:
    token = login(api, ADMIN_EMAIL)
    pdf = b"%PDF-1.7\n" + b"a" * 100
    fremd = _formular(_teil("upload", pdf, "a.pdf", "application/pdf"), _teil("extra", b"1"))
    assert _senden(api.app, koerper=iter([fremd]), token=token).status == 422  # type: ignore[arg-type]
    lang = _formular(
        _teil("upload", pdf, "a.pdf", "application/pdf"), _teil("entity_type", b"x" * 2000)
    )
    assert _senden(api.app, koerper=iter([lang]), token=token).status == 422  # type: ignore[arg-type]
    falsche_id = _formular(
        _teil("upload", pdf, "a.pdf", "application/pdf"), _teil("project_id", b"keine-id")
    )
    antwort = _senden(api.app, koerper=iter([falsche_id]), token=token)  # type: ignore[arg-type]
    assert antwort.status == 422
    assert b"project_id" in antwort.body


def test_ohne_multipart_wird_nichts_gelesen(
    api: TestClient, betrieb: uuid.UUID, kleines_limit: int
) -> None:
    token = login(api, ADMIN_EMAIL)
    antwort = api.post(
        "/api/v1/files",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        content=b"{}",
    )
    assert antwort.status_code == 422


@requires_object_storage
def test_gueltiger_upload_mit_feldern_und_gestreamt(
    api: TestClient, betrieb: uuid.UUID, kleines_limit: int
) -> None:
    token = login(api, ADMIN_EMAIL)
    pdf = b"%PDF-1.7\n" + b"b" * (32 * 1024)
    koerper = _formular(
        _teil("upload", pdf, "plan.pdf", "application/pdf"),
        _teil("entity_type", b"plan"),
    )
    stuecke = [koerper[i : i + 1000] for i in range(0, len(koerper), 1000)]
    antwort = _senden(api.app, koerper=iter(stuecke), token=token)  # type: ignore[arg-type]
    assert antwort.status == 201, antwort.body
    assert antwort.gelesen == len(koerper)
    assert b'"size_bytes":32777' in antwort.body
    assert b'"entity_type":"plan"' in antwort.body
