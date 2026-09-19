"""Projekte, Gebaeude und Geschosse.

Schwerpunkte: Nummernvergabe, Statuswechsel als eigene Endpunkte, die
Geschossstruktur samt Plausibilitaetsgrenzen (ganzzahlige Millimeter, ADR 0007)
und das Exit-Kriterium von Phase 2 - Projekt mit Kunde, Gebaeude und
Geschossen anlegen.

Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

from app.core.module_registry.registry import ModuleRegistry
from app.core.seed import seed_initial_data
from tests.conftest import ADMIN_PASSWORD, auth_headers, login, requires_database

pytestmark = [requires_database, pytest.mark.database]

ADMIN_EMAIL = "admin@projekte.example"


@pytest.fixture
def betrieb(engine: Engine, registry: ModuleRegistry, clean_database: None) -> uuid.UUID:
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        result = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Projekte GmbH",
            admin_email=ADMIN_EMAIL,
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
        return result.organization_id
    finally:
        session.close()


@pytest.fixture
def token(api: TestClient, betrieb: uuid.UUID) -> str:
    return login(api, ADMIN_EMAIL)


@pytest.fixture
def kunde(api: TestClient, token: str) -> dict[str, object]:
    response = api.post(
        "/api/v1/customers",
        headers=auth_headers(token),
        json={"name": "Bauherr Beispiel", "kind": "private"},
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


def _projekt(
    api: TestClient, token: str, kunde_id: object, **overrides: object
) -> dict[str, object]:
    payload: dict[str, object] = {"customer_id": kunde_id, "name": "Neubau Einfamilienhaus"}
    payload.update(overrides)
    response = api.post("/api/v1/projects", headers=auth_headers(token), json=payload)
    assert response.status_code == 201, response.text
    return dict(response.json())


# ------------------------------------------------------------------ Anlegen


def test_anlegen_vergibt_projektnummer_und_startstatus(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    projekt = _projekt(api, token, kunde["id"])

    assert projekt["project_number"].startswith("PR-")  # type: ignore[union-attr]
    assert projekt["status"] == "draft"
    assert projekt["version"] == 1
    assert projekt["customer_id"] == kunde["id"]


def test_projekt_ohne_bekannten_kunden_wird_abgelehnt(api: TestClient, token: str) -> None:
    response = api.post(
        "/api/v1/projects",
        headers=auth_headers(token),
        json={"customer_id": str(uuid.uuid4()), "name": "Luftprojekt"},
    )

    assert response.status_code == 404


def test_projekt_ohne_kunden_ist_kein_gueltiger_antrag(api: TestClient, token: str) -> None:
    response = api.post(
        "/api/v1/projects", headers=auth_headers(token), json={"name": "Ohne Kunde"}
    )

    assert response.status_code == 422


def test_projektnummern_laufen_hoch(api: TestClient, token: str, kunde: dict[str, object]) -> None:
    erstes = _projekt(api, token, kunde["id"], name="Projekt A")
    zweites = _projekt(api, token, kunde["id"], name="Projekt B")

    assert erstes["project_number"] != zweites["project_number"]


# --------------------------------------------------------------- Statuslauf


def test_statuslauf_draft_active_completed_archived(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    projekt = _projekt(api, token, kunde["id"])
    pfad = ["activate", "complete", "archive"]
    erwartet = ["active", "completed", "archived"]
    version = 1

    for schritt, ziel in zip(pfad, erwartet, strict=True):
        response = api.post(
            f"/api/v1/projects/{projekt['id']}/{schritt}",
            headers={**auth_headers(token), "If-Match": str(version)},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == ziel
        version = body["version"]


def test_unzulaessiger_statuswechsel_ist_ein_konflikt(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    """Ein Entwurf kann nicht direkt abgeschlossen werden."""
    projekt = _projekt(api, token, kunde["id"])

    response = api.post(
        f"/api/v1/projects/{projekt['id']}/complete",
        headers={**auth_headers(token), "If-Match": "1"},
    )

    assert response.status_code == 409
    assert response.json()["type"].endswith("/conflict")


def test_aus_archiviert_fuehrt_kein_weg_zurueck(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    projekt = _projekt(api, token, kunde["id"])
    archiviert = api.post(
        f"/api/v1/projects/{projekt['id']}/archive",
        headers={**auth_headers(token), "If-Match": "1"},
    ).json()

    response = api.post(
        f"/api/v1/projects/{projekt['id']}/activate",
        headers={**auth_headers(token), "If-Match": str(archiviert["version"])},
    )

    assert response.status_code == 409


def test_status_laesst_sich_nicht_per_patch_setzen(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    """Zustandswechsel sind eigene Endpunkte (docs/api.md, Abschnitt 5)."""
    projekt = _projekt(api, token, kunde["id"])

    response = api.patch(
        f"/api/v1/projects/{projekt['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"status": "archived"},
    )

    assert response.status_code == 422


def test_statuswechsel_wird_protokolliert(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    projekt = _projekt(api, token, kunde["id"])
    api.post(
        f"/api/v1/projects/{projekt['id']}/activate",
        headers={**auth_headers(token), "If-Match": "1"},
    )

    protokoll = api.get(
        "/api/v1/audit",
        headers=auth_headers(token),
        params={"action": "project.status_changed"},
    ).json()

    assert len(protokoll["items"]) == 1


# ------------------------------------------------------- Liste und Filter


def test_liste_enthaelt_den_kundennamen(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    _projekt(api, token, kunde["id"])

    body = api.get("/api/v1/projects", headers=auth_headers(token)).json()

    assert body["items"][0]["customer_name"] == kunde["name"]


def test_filter_nach_status_und_kunde(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    entwurf = _projekt(api, token, kunde["id"], name="Entwurf")
    laufend = _projekt(api, token, kunde["id"], name="Laufend")
    api.post(
        f"/api/v1/projects/{laufend['id']}/activate",
        headers={**auth_headers(token), "If-Match": "1"},
    )

    nur_aktiv = api.get(
        "/api/v1/projects", headers=auth_headers(token), params={"status": "active"}
    ).json()
    nach_kunde = api.get(
        "/api/v1/projects",
        headers=auth_headers(token),
        params={"customer_id": str(kunde["id"])},
    ).json()

    assert [item["id"] for item in nur_aktiv["items"]] == [laufend["id"]]
    assert {item["id"] for item in nach_kunde["items"]} == {entwurf["id"], laufend["id"]}


def test_suche_findet_ueber_den_kundennamen(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    _projekt(api, token, kunde["id"], name="Voellig anderer Titel")

    body = api.get("/api/v1/projects", headers=auth_headers(token), params={"q": "Bauherr"}).json()

    assert len(body["items"]) == 1


def test_ausgeblendetes_projekt_verschwindet(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    projekt = _projekt(api, token, kunde["id"])

    response = api.delete(
        f"/api/v1/projects/{projekt['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
    )

    assert response.status_code == 204
    assert api.get("/api/v1/projects", headers=auth_headers(token)).json()["items"] == []


# --------------------------------------------------- Gebaeude und Geschosse


def test_projekt_mit_gebaeude_und_geschossen(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    """Exit-Kriterium Phase 2: Projekt mit Kunde, Gebaeude und Geschossen."""
    projekt = _projekt(api, token, kunde["id"])

    gebaeude = api.post(
        f"/api/v1/projects/{projekt['id']}/buildings",
        headers=auth_headers(token),
        json={"name": "Haupthaus", "sort_order": 1},
    )
    assert gebaeude.status_code == 201, gebaeude.text
    gebaeude_id = gebaeude.json()["id"]

    for name, level, hoehe in (
        ("Untergeschoss", -1, -2_750),
        ("Erdgeschoss", 0, 0),
        ("Obergeschoss", 1, 2_750),
    ):
        response = api.post(
            f"/api/v1/buildings/{gebaeude_id}/floors",
            headers=auth_headers(token),
            json={"name": name, "level": level, "elevation_mm": hoehe},
        )
        assert response.status_code == 201, response.text

    geschosse = api.get(
        f"/api/v1/buildings/{gebaeude_id}/floors", headers=auth_headers(token)
    ).json()

    assert [floor["level"] for floor in geschosse] == [-1, 0, 1]
    assert geschosse[1]["default_ceiling_height_mm"] == 2_500


def test_gebaeude_sind_nach_reihenfolge_sortiert(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    projekt = _projekt(api, token, kunde["id"])
    for name, order in (("Nebengebaeude", 2), ("Haupthaus", 1)):
        api.post(
            f"/api/v1/projects/{projekt['id']}/buildings",
            headers=auth_headers(token),
            json={"name": name, "sort_order": order},
        )

    gebaeude = api.get(
        f"/api/v1/projects/{projekt['id']}/buildings", headers=auth_headers(token)
    ).json()

    assert [item["name"] for item in gebaeude] == ["Haupthaus", "Nebengebaeude"]


def test_doppelte_geschossebene_wird_abgelehnt(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    projekt = _projekt(api, token, kunde["id"])
    gebaeude_id = api.post(
        f"/api/v1/projects/{projekt['id']}/buildings",
        headers=auth_headers(token),
        json={"name": "Haupthaus"},
    ).json()["id"]
    api.post(
        f"/api/v1/buildings/{gebaeude_id}/floors",
        headers=auth_headers(token),
        json={"name": "Erdgeschoss", "level": 0},
    )

    response = api.post(
        f"/api/v1/buildings/{gebaeude_id}/floors",
        headers=auth_headers(token),
        json={"name": "Noch ein Erdgeschoss", "level": 0},
    )

    assert response.status_code == 422


@pytest.mark.parametrize(
    "feld,wert",
    [
        ("level", 9_999),
        ("elevation_mm", 99_000_000),
        ("default_ceiling_height_mm", 100),
        ("default_ceiling_height_mm", 99_000),
    ],
)
def test_unplausible_geometrie_wird_abgelehnt(
    api: TestClient, token: str, kunde: dict[str, object], feld: str, wert: int
) -> None:
    projekt = _projekt(api, token, kunde["id"])
    gebaeude_id = api.post(
        f"/api/v1/projects/{projekt['id']}/buildings",
        headers=auth_headers(token),
        json={"name": "Haupthaus"},
    ).json()["id"]

    payload: dict[str, object] = {"name": "Testgeschoss", "level": 0}
    payload[feld] = wert
    response = api.post(
        f"/api/v1/buildings/{gebaeude_id}/floors", headers=auth_headers(token), json=payload
    )

    assert response.status_code == 422


def test_geometrie_bleibt_ganzzahlig(api: TestClient, token: str, kunde: dict[str, object]) -> None:
    """ADR 0007: Millimeter sind Integer, keine Fliesskommazahl."""
    projekt = _projekt(api, token, kunde["id"])
    gebaeude_id = api.post(
        f"/api/v1/projects/{projekt['id']}/buildings",
        headers=auth_headers(token),
        json={"name": "Haupthaus"},
    ).json()["id"]

    response = api.post(
        f"/api/v1/buildings/{gebaeude_id}/floors",
        headers=auth_headers(token),
        json={"name": "Erdgeschoss", "level": 0, "elevation_mm": 2750.5},
    )

    assert response.status_code == 422


def test_geschoss_umhaengen_auf_belegte_ebene_wird_abgelehnt(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    projekt = _projekt(api, token, kunde["id"])
    gebaeude_id = api.post(
        f"/api/v1/projects/{projekt['id']}/buildings",
        headers=auth_headers(token),
        json={"name": "Haupthaus"},
    ).json()["id"]
    api.post(
        f"/api/v1/buildings/{gebaeude_id}/floors",
        headers=auth_headers(token),
        json={"name": "Erdgeschoss", "level": 0},
    )
    oben = api.post(
        f"/api/v1/buildings/{gebaeude_id}/floors",
        headers=auth_headers(token),
        json={"name": "Obergeschoss", "level": 1},
    ).json()

    response = api.patch(
        f"/api/v1/floors/{oben['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"level": 0},
    )

    assert response.status_code == 422


def test_gebaeude_loeschen_entfernt_seine_geschosse(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    projekt = _projekt(api, token, kunde["id"])
    gebaeude_id = api.post(
        f"/api/v1/projects/{projekt['id']}/buildings",
        headers=auth_headers(token),
        json={"name": "Haupthaus"},
    ).json()["id"]
    geschoss = api.post(
        f"/api/v1/buildings/{gebaeude_id}/floors",
        headers=auth_headers(token),
        json={"name": "Erdgeschoss", "level": 0},
    ).json()

    response = api.delete(
        f"/api/v1/buildings/{gebaeude_id}",
        headers={**auth_headers(token), "If-Match": "1"},
    )

    assert response.status_code == 204
    nachher = api.patch(
        f"/api/v1/floors/{geschoss['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"name": "Weg"},
    )
    assert nachher.status_code == 404


def test_gebaeude_eines_unbekannten_projekts_liefert_404(api: TestClient, token: str) -> None:
    response = api.get(f"/api/v1/projects/{uuid.uuid4()}/buildings", headers=auth_headers(token))

    assert response.status_code == 404


# --------------------------------------------- Ausdrueckliches null im PATCH


@pytest.mark.parametrize("feld", ["name", "customer_id", "site_country_code"])
def test_pflichtfeld_des_projekts_laesst_sich_nicht_auf_null_setzen(
    api: TestClient, token: str, kunde: dict[str, object], feld: str
) -> None:
    projekt = _projekt(api, token, kunde["id"])

    response = api.patch(
        f"/api/v1/projects/{projekt['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={feld: None},
    )

    assert response.status_code == 422


@pytest.mark.parametrize("feld", ["name", "level", "elevation_mm"])
def test_pflichtfeld_des_geschosses_laesst_sich_nicht_auf_null_setzen(
    api: TestClient, token: str, kunde: dict[str, object], feld: str
) -> None:
    projekt = _projekt(api, token, kunde["id"])
    gebaeude_id = api.post(
        f"/api/v1/projects/{projekt['id']}/buildings",
        headers=auth_headers(token),
        json={"name": "Haupthaus"},
    ).json()["id"]
    geschoss = api.post(
        f"/api/v1/buildings/{gebaeude_id}/floors",
        headers=auth_headers(token),
        json={"name": "Erdgeschoss", "level": 0},
    ).json()

    response = api.patch(
        f"/api/v1/floors/{geschoss['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={feld: None},
    )

    assert response.status_code == 422


def test_optionale_projektadresse_laesst_sich_leeren(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    projekt = _projekt(api, token, kunde["id"], site_city="Hannover")

    response = api.patch(
        f"/api/v1/projects/{projekt['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"site_city": None},
    )

    assert response.status_code == 200
    assert response.json()["site_city"] is None


# ------------------------------- Zustand des Kunden bei der Projektzuordnung


def _kunde(api: TestClient, token: str, name: str) -> dict[str, object]:
    response = api.post(
        "/api/v1/customers",
        headers=auth_headers(token),
        json={"name": name, "kind": "private"},
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


def test_projektanlage_mit_aktivem_kunden_funktioniert(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    projekt = _projekt(api, token, kunde["id"])

    assert projekt["customer_id"] == kunde["id"]


def test_projektanlage_mit_ausgeblendetem_kunden_wird_abgelehnt(
    api: TestClient, token: str
) -> None:
    ausgeblendet = _kunde(api, token, "Ausgeblendet GmbH")
    assert (
        api.delete(
            f"/api/v1/customers/{ausgeblendet['id']}",
            headers={**auth_headers(token), "If-Match": "1"},
        ).status_code
        == 204
    )

    response = api.post(
        "/api/v1/projects",
        headers=auth_headers(token),
        json={"customer_id": ausgeblendet["id"], "name": "Neubau", "site_country_code": "DE"},
    )

    assert response.status_code == 404


def test_projektanlage_mit_anonymisiertem_kunden_wird_abgelehnt(
    api: TestClient, token: str
) -> None:
    """Ein anonymisierter Kunde bleibt lesbar, aber nicht reaktivierbar."""
    anonym = _kunde(api, token, "Erika Musterfrau")
    assert (
        api.post(
            f"/api/v1/customers/{anonym['id']}/anonymize",
            headers={**auth_headers(token), "If-Match": "1"},
        ).status_code
        == 200
    )

    response = api.post(
        "/api/v1/projects",
        headers=auth_headers(token),
        json={"customer_id": anonym["id"], "name": "Neubau", "site_country_code": "DE"},
    )

    assert response.status_code == 404


def test_projekt_laesst_sich_auf_einen_anderen_aktiven_kunden_umhaengen(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    projekt = _projekt(api, token, kunde["id"])
    anderer = _kunde(api, token, "Zweiter Bauherr")

    response = api.patch(
        f"/api/v1/projects/{projekt['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"customer_id": anderer["id"]},
    )

    assert response.status_code == 200, response.text
    assert response.json()["customer_id"] == anderer["id"]


def test_umhaengen_auf_ausgeblendeten_kunden_wird_abgelehnt(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    projekt = _projekt(api, token, kunde["id"])
    ausgeblendet = _kunde(api, token, "Ausgeblendet GmbH")
    api.delete(
        f"/api/v1/customers/{ausgeblendet['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
    )

    response = api.patch(
        f"/api/v1/projects/{projekt['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"customer_id": ausgeblendet["id"]},
    )

    assert response.status_code == 404


def test_umhaengen_auf_anonymisierten_kunden_wird_abgelehnt(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    projekt = _projekt(api, token, kunde["id"])
    anonym = _kunde(api, token, "Erika Musterfrau")
    api.post(
        f"/api/v1/customers/{anonym['id']}/anonymize",
        headers={**auth_headers(token), "If-Match": "1"},
    )

    response = api.patch(
        f"/api/v1/projects/{projekt['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"customer_id": anonym["id"]},
    )

    assert response.status_code == 404


def test_bestehendes_projekt_bleibt_nach_der_anonymisierung_lesbar(
    api: TestClient, token: str
) -> None:
    """Belege muessen zuordenbar bleiben - das ist der Zweck der Anonymisierung."""
    bauherr = _kunde(api, token, "Erika Musterfrau")
    projekt = _projekt(api, token, bauherr["id"])
    api.post(
        f"/api/v1/customers/{bauherr['id']}/anonymize",
        headers={**auth_headers(token), "If-Match": "1"},
    )

    response = api.get(f"/api/v1/projects/{projekt['id']}", headers=auth_headers(token))

    assert response.status_code == 200
    assert response.json()["customer_id"] == bauherr["id"]


def test_projektliste_zeigt_nach_der_anonymisierung_nur_den_platzhalter(
    api: TestClient, token: str
) -> None:
    """Keine frueheren Personendaten in der Liste."""
    bauherr = _kunde(api, token, "Erika Musterfrau")
    _projekt(api, token, bauherr["id"])
    api.post(
        f"/api/v1/customers/{bauherr['id']}/anonymize",
        headers={**auth_headers(token), "If-Match": "1"},
    )

    body = api.get("/api/v1/projects", headers=auth_headers(token)).json()

    assert len(body["items"]) == 1
    assert "Musterfrau" not in str(body)
    assert body["items"][0]["customer_name"] == "Geloeschter Kunde"


def test_unbekannter_kunde_liefert_beim_umhaengen_404(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    projekt = _projekt(api, token, kunde["id"])

    response = api.patch(
        f"/api/v1/projects/{projekt['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"customer_id": str(uuid.uuid4())},
    )

    assert response.status_code == 404


# ------------------------------------------- Bedeutung des Status "archived"


def test_archiviertes_projekt_bleibt_fachlich_bearbeitbar(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    """Haelt den **dokumentierten Ist-Zustand** fest, keine neue Zusage.

    ``archived`` ist heute ein endgueltiger Workflowstatus: Aus ihm fuehrt
    kein Statuswechsel zurueck. Ein vollstaendiger Schreibschutz ist in
    keinem Projektdokument festgelegt und wird deshalb auch nicht
    stillschweigend eingefuehrt (docs/api.md, Abschnitt "Projektstatus").

    Faellt die fachliche Entscheidung spaeter fuer Unveraenderlichkeit, muss
    dieser Test bewusst geaendert werden - genau das ist seine Aufgabe.
    """
    projekt = _projekt(api, token, kunde["id"])
    archiviert = api.post(
        f"/api/v1/projects/{projekt['id']}/archive",
        headers={**auth_headers(token), "If-Match": "1"},
    ).json()
    version = archiviert["version"]

    geaendert = api.patch(
        f"/api/v1/projects/{projekt['id']}",
        headers={**auth_headers(token), "If-Match": str(version)},
        json={"site_city": "Celle"},
    )
    gebaeude = api.post(
        f"/api/v1/projects/{projekt['id']}/buildings",
        headers=auth_headers(token),
        json={"name": "Nachtrag"},
    )
    geschoss = api.post(
        f"/api/v1/buildings/{gebaeude.json()['id']}/floors",
        headers=auth_headers(token),
        json={"name": "Erdgeschoss", "level": 0},
    )

    assert archiviert["status"] == "archived"
    assert geaendert.status_code == 200
    assert gebaeude.status_code == 201
    assert geschoss.status_code == 201


def test_aus_archiviert_fuehrt_weiterhin_kein_statuswechsel_zurueck(
    api: TestClient, token: str, kunde: dict[str, object]
) -> None:
    """Das ist die einzige Zusage, die ``archived`` heute gibt."""
    projekt = _projekt(api, token, kunde["id"])
    archiviert = api.post(
        f"/api/v1/projects/{projekt['id']}/archive",
        headers={**auth_headers(token), "If-Match": "1"},
    ).json()

    for schritt in ("activate", "complete", "archive"):
        antwort = api.post(
            f"/api/v1/projects/{projekt['id']}/{schritt}",
            headers={**auth_headers(token), "If-Match": str(archiviert["version"])},
        )
        assert antwort.status_code == 409, schritt
