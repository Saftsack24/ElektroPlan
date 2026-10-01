"""Lebenszyklus eines Projekts (Phase 4d, ADR 0020) - ueber die API.

* Loeschregeln: Status, leer oder mit Inhalt, Berechtigungen, Bestaetigung
* ``If-Match`` (428/409), Mandantentrennung
* Wiedereroeffnung ``completed -> active``
* Ersteller und letzter Bearbeiter - aus Core und Electrical
* Listenfilter laufend/historisch, Nichtwiederverwendung der Nummern

Ausschliesslich synthetische Daten. Benoetigt PostgreSQL.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import sessionmaker

from app.core.files.models import FileRecord, StorageCleanupJob
from app.core.module_registry.registry import ModuleRegistry
from app.core.projects.models import Building, Floor, Project
from app.core.seed import seed_initial_data
from app.modules.electrical.models import ElectricalOpening, ElectricalRoom, ElectricalWall
from tests.conftest import ADMIN_PASSWORD, auth_headers, login, requires_database
from tests.verwaltung_hilfen import person_anlegen

pytestmark = [requires_database, pytest.mark.database]

ADMIN_EMAIL = "admin@lebenszyklus.example"
PLANER_EMAIL = "planer@lebenszyklus.example"
MONTEUR_EMAIL = "monteur@lebenszyklus.example"


@pytest.fixture
def betrieb(engine: Engine, registry: ModuleRegistry, clean_database: None) -> uuid.UUID:
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        result = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Lebenszyklus GmbH",
            admin_email=ADMIN_EMAIL,
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
        organization_id = result.organization_id
    finally:
        session.close()
    person_anlegen(engine, organization_id, PLANER_EMAIL, ["planer"], name="Paula Planer")
    person_anlegen(engine, organization_id, MONTEUR_EMAIL, ["monteur"], name="Max Monteur")
    return organization_id


@pytest.fixture
def admin(api: TestClient, betrieb: uuid.UUID) -> str:
    return login(api, ADMIN_EMAIL)


@pytest.fixture
def planer(api: TestClient, betrieb: uuid.UUID) -> str:
    return login(api, PLANER_EMAIL)


@pytest.fixture
def monteur(api: TestClient, betrieb: uuid.UUID) -> str:
    return login(api, MONTEUR_EMAIL)


@pytest.fixture
def kunde(api: TestClient, admin: str) -> dict[str, Any]:
    response = api.post(
        "/api/v1/customers", headers=auth_headers(admin), json={"name": "Bauherr Beispiel"}
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


# ------------------------------------------------------------------ Helfer


def _projekt(api: TestClient, token: str, kunde: dict[str, Any], name: str = "Neubau") -> Any:
    response = api.post(
        "/api/v1/projects",
        headers=auth_headers(token),
        json={"customer_id": kunde["id"], "name": name},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _startstruktur(api: TestClient, token: str, projekt: Any) -> tuple[str, str]:
    gebaeude = api.post(
        f"/api/v1/projects/{projekt['id']}/buildings",
        headers=auth_headers(token),
        json={"name": "Hauptgebaeude"},
    )
    assert gebaeude.status_code == 201, gebaeude.text
    geschoss = api.post(
        f"/api/v1/buildings/{gebaeude.json()['id']}/floors",
        headers=auth_headers(token),
        json={"name": "Erdgeschoss", "level": 0},
    )
    assert geschoss.status_code == 201, geschoss.text
    return gebaeude.json()["id"], geschoss.json()["id"]


def _raum(api: TestClient, token: str, geschoss_id: str) -> Any:
    response = api.post(
        f"/api/v1/modules/electrical/floors/{geschoss_id}/rooms",
        headers=auth_headers(token),
        json={
            "name": "Wohnen",
            "walls": [
                {"x1_mm": 0, "y1_mm": 0, "x2_mm": 4000, "y2_mm": 0},
                {"x1_mm": 4000, "y1_mm": 0, "x2_mm": 4000, "y2_mm": 3000},
                {"x1_mm": 4000, "y1_mm": 3000, "x2_mm": 0, "y2_mm": 3000},
                {"x1_mm": 0, "y1_mm": 3000, "x2_mm": 0, "y2_mm": 0},
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _aktuell(api: TestClient, token: str, projekt: Any) -> Any:
    response = api.get(f"/api/v1/projects/{projekt['id']}", headers=auth_headers(token))
    assert response.status_code == 200, response.text
    return response.json()


def _status(api: TestClient, token: str, projekt: Any, *wege: str) -> Any:
    aktuell = _aktuell(api, token, projekt)
    for weg in wege:
        response = api.post(
            f"/api/v1/projects/{projekt['id']}/{weg}",
            headers={**auth_headers(token), "If-Match": str(aktuell["version"])},
        )
        assert response.status_code == 200, response.text
        aktuell = response.json()
    return aktuell


def _loeschen(
    api: TestClient,
    token: str,
    projekt: Any,
    *,
    version: object | None = None,
    bestaetigung: str | None = None,
) -> Any:
    headers = auth_headers(token)
    if version is not False:
        headers["If-Match"] = str(
            version if version is not None else _aktuell(api, token, projekt)["version"]
        )
    params = {"confirm_project_number": bestaetigung} if bestaetigung else None
    return api.delete(f"/api/v1/projects/{projekt['id']}", headers=headers, params=params)


def _pruefung(api: TestClient, token: str, projekt: Any) -> Any:
    response = api.get(
        f"/api/v1/projects/{projekt['id']}/deletion-check", headers=auth_headers(token)
    )
    assert response.status_code == 200, response.text
    return response.json()


def _anzahl(engine: Engine, model: type[Any], **filter_: object) -> int:
    factory = sessionmaker(bind=engine)
    session = factory()
    try:
        stmt = select(func.count()).select_from(model)
        for spalte, wert in filter_.items():
            stmt = stmt.where(getattr(model, spalte) == wert)
        return int(session.execute(stmt).scalar_one())
    finally:
        session.close()


def _datei_zeile(engine: Engine, organization_id: uuid.UUID, project_id: str) -> str:
    """Dateizeile ohne echten Upload - fuer die Inhaltserkennung genuegt die Zeile."""
    key = f"org/{organization_id}/project/{project_id}/{uuid.uuid4()}.pdf"
    factory = sessionmaker(bind=engine)
    session = factory()
    try:
        session.add(
            FileRecord(
                organization_id=organization_id,
                project_id=uuid.UUID(project_id),
                storage_key=key,
                filename="plan.pdf",
                content_type="application/pdf",
                size_bytes=10,
                sha256="0" * 64,
            )
        )
        session.commit()
    finally:
        session.close()
    return key


# ------------------------------------------------------------ Leere Projekte


def test_leeres_draft_projekt_loescht_der_planer(
    api: TestClient, engine: Engine, admin: str, planer: str, kunde: dict[str, Any]
) -> None:
    projekt = _projekt(api, planer, kunde)
    _startstruktur(api, planer, projekt)

    pruefung = _pruefung(api, planer, projekt)
    assert pruefung["is_empty"] is True
    assert pruefung["can_delete"] is True
    assert pruefung["requires_number_confirmation"] is False

    response = _loeschen(api, planer, projekt)

    assert response.status_code == 204, response.text
    assert api.get(
        f"/api/v1/projects/{projekt['id']}", headers=auth_headers(admin)
    ).status_code == (404)
    # Die leere Startstruktur verschwindet mit - physisch.
    pid = uuid.UUID(projekt["id"])
    assert _anzahl(engine, Project, id=pid) == 0
    assert _anzahl(engine, Building, project_id=pid) == 0
    assert _anzahl(engine, Floor) == 0


def test_leeres_aktives_projekt_ist_loeschbar(
    api: TestClient, planer: str, kunde: dict[str, Any]
) -> None:
    projekt = _projekt(api, planer, kunde)
    _status(api, planer, projekt, "activate")

    assert _loeschen(api, planer, projekt).status_code == 204


def test_leser_darf_nicht_loeschen(
    api: TestClient, planer: str, monteur: str, kunde: dict[str, Any]
) -> None:
    projekt = _projekt(api, planer, kunde)

    pruefung = _pruefung(api, monteur, projekt)
    response = _loeschen(api, monteur, projekt, version=1)

    assert pruefung["can_delete"] is False
    assert pruefung["blocked_code"] == "permission"
    assert response.status_code == 403
    assert _aktuell(api, planer, projekt)["id"] == projekt["id"]


def test_zweites_geschoss_ist_inhalt(api: TestClient, planer: str, kunde: dict[str, Any]) -> None:
    projekt = _projekt(api, planer, kunde)
    gebaeude_id, _ = _startstruktur(api, planer, projekt)
    api.post(
        f"/api/v1/buildings/{gebaeude_id}/floors",
        headers=auth_headers(planer),
        json={"name": "Obergeschoss", "level": 1},
    )

    pruefung = _pruefung(api, planer, projekt)

    assert pruefung["is_empty"] is False
    assert [inhalt["code"] for inhalt in pruefung["contents"]] == ["core.structure"]
    assert _loeschen(api, planer, projekt).status_code == 403


def test_leerheit_haengt_nicht_an_namen(
    api: TestClient, planer: str, kunde: dict[str, Any]
) -> None:
    """Ein umbenanntes Startgebaeude bleibt leer - Namen zaehlen nicht."""
    projekt = _projekt(api, planer, kunde)
    gebaeude = api.post(
        f"/api/v1/projects/{projekt['id']}/buildings",
        headers=auth_headers(planer),
        json={"name": "Scheune Nord"},
    ).json()
    api.post(
        f"/api/v1/buildings/{gebaeude['id']}/floors",
        headers=auth_headers(planer),
        json={"name": "Dachboden", "level": 3},
    )

    assert _pruefung(api, planer, projekt)["is_empty"] is True


# ------------------------------------------------------- Projekte mit Inhalt


def test_projekt_mit_raum_nur_fuer_den_administrator(
    api: TestClient, engine: Engine, admin: str, planer: str, kunde: dict[str, Any]
) -> None:
    projekt = _projekt(api, planer, kunde)
    _, geschoss_id = _startstruktur(api, planer, projekt)
    raum = _raum(api, planer, geschoss_id)
    wand_id = api.get(
        f"/api/v1/modules/electrical/rooms/{raum['id']}/walls", headers=auth_headers(planer)
    ).json()[0]["id"]
    oeffnung = api.post(
        f"/api/v1/modules/electrical/walls/{wand_id}/openings",
        headers=auth_headers(planer),
        json={"kind": "door", "offset_mm": 500, "width_mm": 900, "height_mm": 2000},
    )
    assert oeffnung.status_code == 201, oeffnung.text

    pruefung_planer = _pruefung(api, planer, projekt)
    assert pruefung_planer["is_empty"] is False
    assert pruefung_planer["requires_admin"] is True
    assert pruefung_planer["can_delete"] is False
    codes = {inhalt["code"]: inhalt["count"] for inhalt in pruefung_planer["contents"]}
    assert codes == {"electrical.rooms": 1, "electrical.walls": 4, "electrical.openings": 1}
    assert _loeschen(api, planer, projekt).status_code == 403

    pruefung_admin = _pruefung(api, admin, projekt)
    assert pruefung_admin["can_delete"] is True
    assert pruefung_admin["requires_number_confirmation"] is True

    # Ohne Bestaetigung der Projektnummer: kein stilles Loeschen von Inhalt.
    ohne = _loeschen(api, admin, projekt)
    assert ohne.status_code == 409
    assert ohne.json()["type"].endswith("/deletion-confirmation-required")
    falsch = _loeschen(api, admin, projekt, bestaetigung="PR-0000-0000")
    assert falsch.status_code == 409

    response = _loeschen(api, admin, projekt, bestaetigung=projekt["project_number"])

    assert response.status_code == 204, response.text
    assert _anzahl(engine, ElectricalRoom) == 0
    assert _anzahl(engine, ElectricalWall) == 0
    assert _anzahl(engine, ElectricalOpening) == 0
    assert _anzahl(engine, Floor) == 0
    assert _anzahl(engine, Project, id=uuid.UUID(projekt["id"])) == 0


def test_datei_macht_projekt_zum_projekt_mit_inhalt_und_wird_vorgemerkt(
    api: TestClient,
    engine: Engine,
    betrieb: uuid.UUID,
    admin: str,
    planer: str,
    kunde: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Die Dateizeile verschwindet, der Schluessel landet in der Warteschlange.

    Der Storage ist hier eine Attrappe, die scheitert: Der Auftrag bleibt stehen,
    die Antwort ist trotzdem ``204`` - das Projekt ist geloescht.
    """
    from app.core.files.storage import get_object_storage
    from app.main import app as _unused  # noqa: F401 - stellt sicher, dass die App geladen ist

    projekt = _projekt(api, planer, kunde)
    key = _datei_zeile(engine, betrieb, projekt["id"])

    class Kaputt:
        def delete(self, key: str) -> None:
            raise ConnectionError("Storage nicht erreichbar")

    api.app.dependency_overrides[get_object_storage] = lambda: Kaputt()  # type: ignore[attr-defined]
    try:
        assert _pruefung(api, planer, projekt)["contents"][0]["code"] == "core.files"
        assert _loeschen(api, planer, projekt).status_code == 403
        response = _loeschen(api, admin, projekt, bestaetigung=projekt["project_number"])
    finally:
        api.app.dependency_overrides.pop(get_object_storage, None)  # type: ignore[attr-defined]

    assert response.status_code == 204, response.text
    assert _anzahl(engine, FileRecord) == 0
    assert _anzahl(engine, StorageCleanupJob, storage_key=key) == 1
    factory = sessionmaker(bind=engine)
    session = factory()
    try:
        job = session.execute(select(StorageCleanupJob)).scalar_one()
        assert job.attempts == 1
        assert job.last_error is not None
        assert "ConnectionError" in job.last_error
    finally:
        session.close()


# -------------------------------------------------------- Status und Version


@pytest.mark.parametrize(
    ("wege", "status"),
    [(("activate", "complete"), "completed"), (("archive",), "archived")],
)
def test_abgeschlossene_und_archivierte_projekte_sind_nicht_loeschbar(
    api: TestClient, admin: str, kunde: dict[str, Any], wege: tuple[str, ...], status: str
) -> None:
    projekt = _projekt(api, admin, kunde)
    _status(api, admin, projekt, *wege)

    pruefung = _pruefung(api, admin, projekt)
    response = _loeschen(api, admin, projekt, bestaetigung=projekt["project_number"])

    assert pruefung["status"] == status
    assert pruefung["blocked_code"] == "status"
    assert response.status_code == 409
    assert response.json()["type"].endswith("/project-not-deletable")


def test_loeschen_ohne_if_match_ist_428(
    api: TestClient, planer: str, kunde: dict[str, Any]
) -> None:
    projekt = _projekt(api, planer, kunde)

    assert _loeschen(api, planer, projekt, version=False).status_code == 428


def test_loeschen_mit_veralteter_version_ist_409(
    api: TestClient, planer: str, kunde: dict[str, Any]
) -> None:
    projekt = _projekt(api, planer, kunde)
    _status(api, planer, projekt, "activate")

    response = _loeschen(api, planer, projekt, version=1)

    assert response.status_code == 409
    assert response.json()["type"].endswith("/version-conflict")


def test_fremder_mandant_sieht_das_projekt_nicht(
    api: TestClient, engine: Engine, registry: ModuleRegistry, admin: str, kunde: dict[str, Any]
) -> None:
    projekt = _projekt(api, admin, kunde)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        fremd = seed_initial_data(
            session,
            registry,
            organization_name="Fremdbetrieb GmbH",
            admin_email="admin@fremd-lebenszyklus.example",
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
    finally:
        session.close()
    fremd_token = login(
        api, "admin@fremd-lebenszyklus.example", organization_id=fremd.organization_id
    )

    pruefung = api.get(
        f"/api/v1/projects/{projekt['id']}/deletion-check", headers=auth_headers(fremd_token)
    )
    loeschen = _loeschen(
        api, fremd_token, projekt, version=1, bestaetigung=projekt["project_number"]
    )
    wieder = api.post(
        f"/api/v1/projects/{projekt['id']}/reopen",
        headers={**auth_headers(fremd_token), "If-Match": "1"},
    )

    assert pruefung.status_code == 404
    assert loeschen.status_code == 404
    assert wieder.status_code == 404
    assert _aktuell(api, admin, projekt)["id"] == projekt["id"]


def test_projektnummer_wird_nicht_wiederverwendet(
    api: TestClient, planer: str, kunde: dict[str, Any]
) -> None:
    erstes = _projekt(api, planer, kunde, "Versehen")
    assert _loeschen(api, planer, erstes).status_code == 204

    zweites = _projekt(api, planer, kunde, "Richtig")

    assert zweites["project_number"] > erstes["project_number"]


def test_loeschung_wird_ohne_personendaten_protokolliert(
    api: TestClient, admin: str, planer: str, kunde: dict[str, Any]
) -> None:
    projekt = _projekt(api, planer, kunde, "Neubau Musterweg 1")
    assert _loeschen(api, planer, projekt).status_code == 204

    eintraege = api.get(
        "/api/v1/audit", headers=auth_headers(admin), params={"action": "project.deleted"}
    ).json()["items"]

    assert len(eintraege) == 1
    assert eintraege[0]["entity_id"] == projekt["id"]
    assert "Musterweg" not in str(eintraege[0])
    assert "Bauherr" not in str(eintraege[0])


# ------------------------------------------------------------ Wiedereroeffnung


def test_administrator_oeffnet_abgeschlossenes_projekt_wieder(
    api: TestClient, admin: str, planer: str, kunde: dict[str, Any]
) -> None:
    projekt = _projekt(api, planer, kunde)
    abgeschlossen = _status(api, planer, projekt, "activate", "complete")

    response = api.post(
        f"/api/v1/projects/{projekt['id']}/reopen",
        headers={**auth_headers(admin), "If-Match": str(abgeschlossen["version"])},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "active"
    assert body["updated_by"]["display_name"] == "Administrator"
    laufend = api.get(
        "/api/v1/projects", headers=auth_headers(planer), params={"status_group": "current"}
    ).json()
    assert [item["id"] for item in laufend["items"]] == [projekt["id"]]
    protokoll = api.get(
        "/api/v1/audit", headers=auth_headers(admin), params={"action": "project.reopened"}
    ).json()["items"]
    assert len(protokoll) == 1
    # Danach wieder ein gewoehnliches aktives Projekt: erneut abschliessbar.
    assert _status(api, planer, projekt, "complete")["status"] == "completed"


def test_planer_darf_nicht_wiedereroeffnen(
    api: TestClient, planer: str, kunde: dict[str, Any]
) -> None:
    projekt = _projekt(api, planer, kunde)
    abgeschlossen = _status(api, planer, projekt, "activate", "complete")

    response = api.post(
        f"/api/v1/projects/{projekt['id']}/reopen",
        headers={**auth_headers(planer), "If-Match": str(abgeschlossen["version"])},
    )

    assert response.status_code == 403


def test_archiviertes_projekt_bleibt_archiviert(
    api: TestClient, admin: str, kunde: dict[str, Any]
) -> None:
    projekt = _projekt(api, admin, kunde)
    archiviert = _status(api, admin, projekt, "archive")

    response = api.post(
        f"/api/v1/projects/{projekt['id']}/reopen",
        headers={**auth_headers(admin), "If-Match": str(archiviert["version"])},
    )

    assert response.status_code == 409
    assert response.json()["type"].endswith("/project-archived")
    assert _aktuell(api, admin, projekt)["status"] == "archived"


@pytest.mark.parametrize("wege", [(), ("activate",)])
def test_nur_abgeschlossene_projekte_lassen_sich_wiedereroeffnen(
    api: TestClient, admin: str, kunde: dict[str, Any], wege: tuple[str, ...]
) -> None:
    projekt = _projekt(api, admin, kunde)
    aktuell = _status(api, admin, projekt, *wege)

    response = api.post(
        f"/api/v1/projects/{projekt['id']}/reopen",
        headers={**auth_headers(admin), "If-Match": str(aktuell["version"])},
    )

    assert response.status_code == 409


def test_wiedereroeffnung_verlangt_if_match(
    api: TestClient, admin: str, kunde: dict[str, Any]
) -> None:
    projekt = _projekt(api, admin, kunde)
    abgeschlossen = _status(api, admin, projekt, "activate", "complete")

    ohne = api.post(f"/api/v1/projects/{projekt['id']}/reopen", headers=auth_headers(admin))
    veraltet = api.post(
        f"/api/v1/projects/{projekt['id']}/reopen",
        headers={**auth_headers(admin), "If-Match": str(abgeschlossen["version"] - 1)},
    )

    assert ohne.status_code == 428
    assert veraltet.status_code == 409


def test_normale_statuswechsel_bleiben_unveraendert(
    api: TestClient, admin: str, kunde: dict[str, Any]
) -> None:
    """``complete -> activate`` ist weiterhin kein normaler Uebergang."""
    projekt = _projekt(api, admin, kunde)
    abgeschlossen = _status(api, admin, projekt, "activate", "complete")

    response = api.post(
        f"/api/v1/projects/{projekt['id']}/activate",
        headers={**auth_headers(admin), "If-Match": str(abgeschlossen["version"])},
    )

    assert response.status_code == 409


# ------------------------------------------------------------ Listenfilter


def test_laufende_und_historische_ansicht(
    api: TestClient, admin: str, kunde: dict[str, Any]
) -> None:
    entwurf = _projekt(api, admin, kunde, "Entwurf")
    aktiv = _projekt(api, admin, kunde, "Aktiv")
    _status(api, admin, aktiv, "activate")
    fertig = _projekt(api, admin, kunde, "Fertig")
    _status(api, admin, fertig, "activate", "complete")
    archiv = _projekt(api, admin, kunde, "Archiv")
    _status(api, admin, archiv, "archive")

    def ids(**params: object) -> set[str]:
        body = api.get("/api/v1/projects", headers=auth_headers(admin), params=params).json()
        return {item["id"] for item in body["items"]}

    assert ids(status_group="current") == {entwurf["id"], aktiv["id"]}
    assert ids(status_group="closed") == {fertig["id"], archiv["id"]}
    assert ids(status_group="closed", q="Fertig") == {fertig["id"]}
    assert ids(status_group="current", customer_id=kunde["id"]) == {entwurf["id"], aktiv["id"]}
    # Direkter Zugriff auf ein historisches Projekt bleibt moeglich.
    assert _aktuell(api, admin, archiv)["status"] == "archived"


# ---------------------------------------------------- Ersteller und Bearbeiter


def test_bearbeiter_folgen_core_und_electrical(
    api: TestClient, admin: str, planer: str, kunde: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    projekt = _projekt(api, admin, kunde)
    angelegt = _aktuell(api, admin, projekt)
    assert angelegt["created_by"] == angelegt["updated_by"]
    assert angelegt["created_by"]["kind"] == "member"
    assert angelegt["created_by"]["display_name"] == "Administrator"
    assert "email" not in angelegt["created_by"]

    # Struktur durch den Planer: updated_by wandert, Version bleibt.
    _, geschoss_id = _startstruktur(api, planer, projekt)
    nach_struktur = _aktuell(api, admin, projekt)
    assert nach_struktur["updated_by"]["display_name"] == "Paula Planer"
    assert nach_struktur["created_by"]["display_name"] == "Administrator"
    assert nach_struktur["version"] == angelegt["version"]

    # Electrical durch den Administrator: ueber den oeffentlichen Core-Zugang.
    _raum(api, admin, geschoss_id)
    nach_raum = _aktuell(api, admin, projekt)
    assert nach_raum["updated_by"]["display_name"] == "Administrator"
    assert nach_raum["updated_at"] > nach_struktur["updated_at"]
    assert nach_raum["version"] == angelegt["version"]

    # Stammdaten durch den Planer.
    geaendert = api.patch(
        f"/api/v1/projects/{projekt['id']}",
        headers={**auth_headers(planer), "If-Match": str(nach_raum["version"])},
        json={"name": "Neubau Sued"},
    ).json()
    assert geaendert["updated_by"]["display_name"] == "Paula Planer"

    # Statuswechsel durch den Administrator.
    aktiv = _status(api, admin, projekt, "activate")
    assert aktiv["updated_by"]["display_name"] == "Administrator"

    # Liste liefert dieselben Angaben.
    liste = api.get("/api/v1/projects", headers=auth_headers(planer)).json()
    assert liste["items"][0]["updated_by"]["display_name"] == "Administrator"


def test_bearbeiter_der_kunden(api: TestClient, admin: str, planer: str) -> None:
    kunde = api.post(
        "/api/v1/customers", headers=auth_headers(admin), json={"name": "Meta GmbH"}
    ).json()
    assert kunde["created_by"]["display_name"] == "Administrator"

    kalkulator_patch = api.patch(
        f"/api/v1/customers/{kunde['id']}",
        headers={**auth_headers(admin), "If-Match": str(kunde["version"])},
        json={"billing_city": "Hameln"},
    ).json()
    assert kalkulator_patch["updated_by"]["display_name"] == "Administrator"


def test_bestandsdaten_und_fremde_bearbeiter(
    api: TestClient, engine: Engine, admin: str, kunde: dict[str, Any]
) -> None:
    """``NULL`` erscheint als System/Bestandsdaten, Fremde ohne Namen und ohne ID."""
    from app.core.auth.security import hash_password
    from app.core.users.models import User

    bestand = _projekt(api, admin, kunde, "Bestand")
    fremd = _projekt(api, admin, kunde, "Fremd")
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        fremder = User(
            email="aussen@fremd.example",
            password_hash=hash_password(ADMIN_PASSWORD),
            full_name="Geheime Person",
        )
        session.add(fremder)
        session.flush()
        zeile = session.get(Project, uuid.UUID(bestand["id"]))
        assert zeile is not None
        zeile.created_by_user_id = None
        zeile.updated_by_user_id = None
        andere = session.get(Project, uuid.UUID(fremd["id"]))
        assert andere is not None
        andere.updated_by_user_id = fremder.id
        session.commit()
    finally:
        session.close()

    bestand_neu = _aktuell(api, admin, bestand)
    fremd_neu = _aktuell(api, admin, fremd)

    assert bestand_neu["created_by"] == {"kind": "system", "user_id": None, "display_name": None}
    assert bestand_neu["updated_by"]["kind"] == "system"
    assert fremd_neu["updated_by"] == {"kind": "unknown", "user_id": None, "display_name": None}
    assert "Geheime Person" not in str(
        api.get("/api/v1/projects", headers=auth_headers(admin)).json()
    )


def test_datei_upload_beruehrt_das_projekt(
    api: TestClient, admin: str, planer: str, kunde: dict[str, Any]
) -> None:
    from tests.conftest import object_storage_available

    if not object_storage_available():
        pytest.skip("Object Storage (MinIO) ist nicht erreichbar.")
    projekt = _projekt(api, admin, kunde)
    vorher = _aktuell(api, admin, projekt)

    response = api.post(
        "/api/v1/files",
        headers=auth_headers(planer),
        files={"upload": ("plan.pdf", b"%PDF-1.4 test", "application/pdf")},
        data={"project_id": projekt["id"]},
    )

    assert response.status_code == 201, response.text
    nachher = _aktuell(api, admin, projekt)
    assert nachher["updated_by"]["display_name"] == "Paula Planer"
    assert nachher["version"] == vorher["version"]
