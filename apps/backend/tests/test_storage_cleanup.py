"""Persistente Storage-Aufraeum-Warteschlange (Phase 4d, ADR 0020).

* Vormerken in der Transaktion, idempotent je Schluessel
* Storage-Fehler: Auftrag bleibt mit Zaehler, Zeitpunkt und Meldung
* Erfolgreiche Wiederholung entfernt den Auftrag
* Keine Adressen in der gespeicherten Meldung
* CLI ``storage-cleanup``
* Ende-zu-Ende gegen MinIO: Projekt mit hochgeladener Datei loeschen -
  Datenbankzeile und Objekt sind weg.

Ausschliesslich synthetische Daten.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.files import cleanup
from app.core.files.models import FileRecord, StorageCleanupJob
from app.core.module_registry.registry import ModuleRegistry
from app.core.organizations.models import Organization
from app.core.seed import seed_initial_data
from tests.conftest import (
    ADMIN_PASSWORD,
    auth_headers,
    login,
    requires_database,
    requires_object_storage,
)

pytestmark = [requires_database, pytest.mark.database]


class Storage:
    """Attrappe: scheitert, solange ``kaputt`` gesetzt ist."""

    def __init__(self, *, kaputt: bool) -> None:
        self.kaputt = kaputt
        self.geloescht: list[str] = []

    def delete(self, key: str) -> None:
        if self.kaputt:
            raise ConnectionError(
                'Could not connect to the endpoint URL: "http://minio:9000/elektroplan/x"'
            )
        self.geloescht.append(key)


@pytest.fixture
def factory(engine: Engine, clean_database: None) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture
def organisation(factory: sessionmaker[Session]) -> uuid.UUID:
    session = factory()
    try:
        organization = Organization(name="Aufraeumen GmbH", slug="aufraeumen")
        session.add(organization)
        session.commit()
        return organization.id
    finally:
        session.close()


def _jobs(factory: sessionmaker[Session]) -> list[StorageCleanupJob]:
    session = factory()
    try:
        return list(session.execute(select(StorageCleanupJob)).scalars().all())
    finally:
        session.close()


def test_fehler_bleibt_stehen_und_wiederholung_raeumt_ab(
    factory: sessionmaker[Session], organisation: uuid.UUID
) -> None:
    session = factory()
    try:
        cleanup.enqueue(
            session,
            organization_id=organisation,
            storage_keys=["org/a/1.pdf", "org/a/2.pdf", "org/a/1.pdf"],
            reason=cleanup.REASON_PROJECT_DELETED,
        )
        session.commit()

        kaputt = Storage(kaputt=True)
        ergebnis = cleanup.process_jobs(session, kaputt)
        assert (ergebnis.removed, ergebnis.failed) == (0, 2)
        ergebnis = cleanup.process_jobs(session, kaputt)
        assert ergebnis.failed == 2
    finally:
        session.close()

    jobs = _jobs(factory)
    assert sorted(job.storage_key for job in jobs) == ["org/a/1.pdf", "org/a/2.pdf"]
    for job in jobs:
        assert job.attempts == 2
        assert job.last_attempt_at is not None
        assert job.last_error is not None
        assert job.last_error.startswith("ConnectionError")
        assert "http://" not in job.last_error

    session = factory()
    try:
        heil = Storage(kaputt=False)
        ergebnis = cleanup.process_jobs(session, heil)
        assert (ergebnis.removed, ergebnis.failed) == (2, 0)
        # Idempotent: ein weiterer Lauf hat nichts mehr zu tun.
        assert cleanup.process_jobs(session, heil).processed == 0
        assert cleanup.pending_count(session) == 0
    finally:
        session.close()
    assert sorted(heil.geloescht) == ["org/a/1.pdf", "org/a/2.pdf"]


def test_vormerken_ist_idempotent(factory: sessionmaker[Session], organisation: uuid.UUID) -> None:
    session = factory()
    try:
        for _ in range(2):
            cleanup.enqueue(
                session,
                organization_id=organisation,
                storage_keys=["org/b/1.pdf"],
                reason=cleanup.REASON_PROJECT_DELETED,
            )
            session.commit()
        assert cleanup.pending_count(session) == 1
    finally:
        session.close()


def test_rollback_hinterlaesst_keinen_auftrag(
    factory: sessionmaker[Session], organisation: uuid.UUID
) -> None:
    session = factory()
    try:
        cleanup.enqueue(
            session,
            organization_id=organisation,
            storage_keys=["org/c/1.pdf"],
            reason=cleanup.REASON_PROJECT_DELETED,
        )
        session.rollback()
        assert cleanup.pending_count(session) == 0
    finally:
        session.close()


def test_lauf_nur_fuer_bestimmte_schluessel(
    factory: sessionmaker[Session], organisation: uuid.UUID
) -> None:
    session = factory()
    try:
        cleanup.enqueue(
            session,
            organization_id=organisation,
            storage_keys=["org/d/1.pdf", "org/d/2.pdf"],
            reason=cleanup.REASON_PROJECT_DELETED,
        )
        session.commit()
        storage = Storage(kaputt=False)
        cleanup.process_jobs(session, storage, storage_keys=["org/d/2.pdf"])
        assert storage.geloescht == ["org/d/2.pdf"]
        assert cleanup.pending_count(session) == 1
    finally:
        session.close()


def test_cli_arbeitet_offene_auftraege_ab(
    factory: sessionmaker[Session], organisation: uuid.UUID, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app import cli

    session = factory()
    try:
        cleanup.enqueue(
            session,
            organization_id=organisation,
            storage_keys=["org/e/1.pdf"],
            reason=cleanup.REASON_PROJECT_DELETED,
        )
        session.commit()
    finally:
        session.close()

    storage = Storage(kaputt=True)
    monkeypatch.setattr(cli, "get_object_storage", lambda: storage)
    monkeypatch.setattr(cli, "session_scope", _scope(factory))

    assert cli.main(["storage-cleanup"]) == 1
    storage.kaputt = False
    assert cli.main(["storage-cleanup"]) == 0
    assert storage.geloescht == ["org/e/1.pdf"]


def _scope(factory: sessionmaker[Session]):  # type: ignore[no-untyped-def]
    from contextlib import contextmanager

    @contextmanager
    def scope():  # type: ignore[no-untyped-def]
        session = factory()
        try:
            yield session
            session.commit()
        finally:
            session.close()

    return scope


# --------------------------------------------------------- Ende zu Ende MinIO


@requires_object_storage
def test_projektloeschung_entfernt_datei_und_objekt(
    api: TestClient, engine: Engine, registry: ModuleRegistry
) -> None:
    from botocore.exceptions import ClientError

    from app.config import get_settings
    from app.core.files.storage import get_object_storage

    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        seed_initial_data(
            session,
            registry,
            organization_name="Speicher GmbH",
            admin_email="admin@speicher.example",
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
    finally:
        session.close()
    token = login(api, "admin@speicher.example")
    kunde = api.post(
        "/api/v1/customers", headers=auth_headers(token), json={"name": "Bauherr"}
    ).json()
    projekt = api.post(
        "/api/v1/projects",
        headers=auth_headers(token),
        json={"customer_id": kunde["id"], "name": "Mit Plan"},
    ).json()
    upload = api.post(
        "/api/v1/files",
        headers=auth_headers(token),
        files={"upload": ("plan.pdf", b"%PDF-1.4 synthetisch", "application/pdf")},
        data={"project_id": projekt["id"]},
    )
    assert upload.status_code == 201, upload.text
    session = factory()
    try:
        key = session.execute(select(FileRecord.storage_key)).scalar_one()
    finally:
        session.close()
    storage = get_object_storage()
    storage._client.head_object(Bucket=get_settings().s3_bucket, Key=key)

    response = api.delete(
        f"/api/v1/projects/{projekt['id']}",
        headers={**auth_headers(token), "If-Match": str(projekt["version"])},
        params={"confirm_project_number": projekt["project_number"]},
    )

    assert response.status_code == 204, response.text
    session = factory()
    try:
        assert session.execute(select(FileRecord)).first() is None
        assert session.execute(select(StorageCleanupJob)).first() is None
    finally:
        session.close()
    with pytest.raises(ClientError):
        storage._client.head_object(Bucket=get_settings().s3_bucket, Key=key)
