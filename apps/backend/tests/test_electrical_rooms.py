"""Raeume, Waende und Oeffnungen ueber die API (Phase 3).

Schwerpunkte: CRUD, Mandantentrennung, Berechtigungen, Geometriepruefung
serverseitig, ``If-Match``, Schreibschutz archivierter Projekte, Loeschregeln
und die Events.

Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``): Die Constraints, die
partielle Eindeutigkeit und die aufgeschobene Unique-Constraint verhalten sich
nur dort wie im Betrieb.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import sessionmaker

from app.core.auth.security import hash_password
from app.core.authorization.models import MemberRole, Permission, Role, RolePermission
from app.core.events.bus import EventBus, get_event_bus
from app.core.events.models import DomainEventRecord
from app.core.module_registry.registry import ModuleRegistry
from app.core.organizations.models import MEMBER_STATUS_ACTIVE, OrganizationMember
from app.core.seed import seed_initial_data
from app.core.users.models import User
from app.modules.electrical.events import PLAN_UPDATED
from app.modules.electrical.permissions import PLAN_READ, PLAN_WRITE
from tests.conftest import ADMIN_PASSWORD, auth_headers, login, requires_database

pytestmark = [requires_database, pytest.mark.database]

ADMIN_EMAIL = "admin@elektro.example"
BASIS = "/api/v1/modules/electrical"


# --------------------------------------------------------------- Testaufbau


@pytest.fixture
def betrieb(engine: Engine, registry: ModuleRegistry, clean_database: None) -> uuid.UUID:
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        result = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Raumplanung GmbH",
            admin_email=ADMIN_EMAIL,
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
        return result.organization_id
    finally:
        session.close()


@pytest.fixture
def ereignisse(app: FastAPI, engine: Engine, betrieb: uuid.UUID) -> Iterator[EventBus]:
    """Event Bus auf die Testdatenbank umgelenkt.

    Der prozessweite Bus schreibt in die Entwicklungsdatenbank. Weil der Bus
    eine FastAPI-Dependency ist, laesst er sich wie jede andere ersetzen -
    genau dafuer wird er als Dependency deklariert und nicht als globaler
    Zugriff im Service.
    """
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    bus = EventBus(session_factory=lambda: factory())
    app.dependency_overrides[get_event_bus] = lambda: bus
    yield bus
    app.dependency_overrides.pop(get_event_bus, None)


@pytest.fixture
def token(api: TestClient, betrieb: uuid.UUID, ereignisse: EventBus) -> str:
    return login(api, ADMIN_EMAIL)


@pytest.fixture
def geschoss(api: TestClient, token: str) -> dict[str, Any]:
    """Kunde, Projekt, Gebaeude, Geschoss - synthetische Testdaten."""
    return _struktur(api, token, name="Neubau Musterweg 1")


def _struktur(api: TestClient, token: str, *, name: str) -> dict[str, Any]:
    kunde = api.post(
        "/api/v1/customers",
        headers=auth_headers(token),
        json={"name": "Bauherr Beispiel", "kind": "private"},
    )
    assert kunde.status_code == 201, kunde.text
    projekt = api.post(
        "/api/v1/projects",
        headers=auth_headers(token),
        json={"customer_id": kunde.json()["id"], "name": name},
    )
    assert projekt.status_code == 201, projekt.text
    gebaeude = api.post(
        f"/api/v1/projects/{projekt.json()['id']}/buildings",
        headers=auth_headers(token),
        json={"name": "Haupthaus"},
    )
    assert gebaeude.status_code == 201, gebaeude.text
    stockwerk = api.post(
        f"/api/v1/buildings/{gebaeude.json()['id']}/floors",
        headers=auth_headers(token),
        json={"name": "Erdgeschoss", "level": 0, "default_ceiling_height_mm": 2_500},
    )
    assert stockwerk.status_code == 201, stockwerk.text
    return {
        "project": projekt.json(),
        "building": gebaeude.json(),
        "floor": stockwerk.json(),
    }


def raum_anlegen(api: TestClient, token: str, floor_id: str, **overrides: object) -> dict[str, Any]:
    payload: dict[str, object] = {"name": "Wohnzimmer"}
    payload.update(overrides)
    response = api.post(
        f"{BASIS}/floors/{floor_id}/rooms", headers=auth_headers(token), json=payload
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


def wand_anlegen(
    api: TestClient, token: str, room_id: str, x1: int, y1: int, x2: int, y2: int, **kw: object
) -> dict[str, Any]:
    payload: dict[str, object] = {"x1_mm": x1, "y1_mm": y1, "x2_mm": x2, "y2_mm": y2}
    payload.update(kw)
    response = api.post(f"{BASIS}/rooms/{room_id}/walls", headers=auth_headers(token), json=payload)
    assert response.status_code == 201, response.text
    return dict(response.json())


def rechteck_anlegen(
    api: TestClient,
    token: str,
    room_id: str,
    breite: int = 5_000,
    tiefe: int = 4_000,
) -> list[dict[str, Any]]:
    """Vier Waende gegen den Uhrzeigersinn - eine gueltige Kontur."""
    ecken = [(0, 0), (breite, 0), (breite, tiefe), (0, tiefe)]
    waende = []
    for index in range(4):
        x1, y1 = ecken[index]
        x2, y2 = ecken[(index + 1) % 4]
        waende.append(wand_anlegen(api, token, room_id, x1, y1, x2, y2))
    return waende


def fehlercodes(response: Any) -> set[str]:
    return {eintrag["code"] for eintrag in response.json().get("errors") or []}


# ------------------------------------------------------------------ CRUD Raum


def test_raum_anlegen_liefert_entwurfskontur(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"], room_number="1.01")

    assert raum["name"] == "Wohnzimmer"
    assert raum["room_number"] == "1.01"
    assert raum["version"] == 1
    assert raum["contour_status"] == "draft"
    assert raum["wall_count"] == 0
    assert raum["area_mm2"] is None
    assert raum["area_m2"] is None
    # Ohne eigene Hoehe gilt die Standardhoehe des Geschosses.
    assert raum["height_mm"] is None
    assert raum["effective_height_mm"] == 2_500


def test_eigene_raumhoehe_ueberschreibt_den_geschossstandard(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"], height_mm=2_800)

    assert raum["height_mm"] == 2_800
    assert raum["effective_height_mm"] == 2_800


def test_raum_lesen_aendern_und_loeschen(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])

    gelesen = api.get(f"{BASIS}/rooms/{raum['id']}", headers=auth_headers(token))
    assert gelesen.status_code == 200
    assert gelesen.json()["id"] == raum["id"]

    geaendert = api.patch(
        f"{BASIS}/rooms/{raum['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"name": "Kueche", "height_mm": 2_600},
    )
    assert geaendert.status_code == 200, geaendert.text
    assert geaendert.json()["name"] == "Kueche"
    assert geaendert.json()["version"] == 2

    geloescht = api.delete(
        f"{BASIS}/rooms/{raum['id']}", headers={**auth_headers(token), "If-Match": "2"}
    )
    assert geloescht.status_code == 204
    assert api.get(f"{BASIS}/rooms/{raum['id']}", headers=auth_headers(token)).status_code == 404


def test_raumnummer_ist_je_geschoss_eindeutig(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum_anlegen(api, token, geschoss["floor"]["id"], name="Bad", room_number="1.02")

    zweiter = api.post(
        f"{BASIS}/floors/{geschoss['floor']['id']}/rooms",
        headers=auth_headers(token),
        json={"name": "WC", "room_number": "1.02"},
    )

    assert zweiter.status_code == 422
    assert zweiter.json()["type"].endswith("/validation-failed")


def test_mehrere_raeume_ohne_nummer_sind_erlaubt(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    """Der eindeutige Index ist partiell - ``NULL`` bleibt unbeschraenkt."""
    raum_anlegen(api, token, geschoss["floor"]["id"], name="Flur")
    raum_anlegen(api, token, geschoss["floor"]["id"], name="Diele")

    liste = api.get(f"{BASIS}/floors/{geschoss['floor']['id']}/rooms", headers=auth_headers(token))
    assert liste.status_code == 200
    assert len(liste.json()) == 2


def test_raumliste_ist_deterministisch_sortiert(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    """Zuerst die numerierten Raeume, dann die uebrigen nach Name."""
    floor_id = geschoss["floor"]["id"]
    raum_anlegen(api, token, floor_id, name="Zimmer B", room_number="1.02")
    raum_anlegen(api, token, floor_id, name="Zimmer A", room_number="1.01")
    raum_anlegen(api, token, floor_id, name="Speisekammer")
    raum_anlegen(api, token, floor_id, name="Abstellraum")

    namen = [
        raum["name"]
        for raum in api.get(f"{BASIS}/floors/{floor_id}/rooms", headers=auth_headers(token)).json()
    ]

    assert namen == ["Zimmer A", "Zimmer B", "Abstellraum", "Speisekammer"]


def test_fremdes_geschoss_liefert_404(api: TestClient, token: str) -> None:
    response = api.post(
        f"{BASIS}/floors/{uuid.uuid4()}/rooms",
        headers=auth_headers(token),
        json={"name": "Nirgendwo"},
    )

    assert response.status_code == 404
    assert response.json()["type"].endswith("/not-found")


@pytest.mark.parametrize(
    ("feld", "wert"),
    [
        ("name", ""),
        ("height_mm", 0),
        ("height_mm", 1_499),
        ("height_mm", 6_001),
        ("room_number", ""),
    ],
)
def test_ungueltige_raumwerte_werden_abgelehnt(
    api: TestClient, token: str, geschoss: dict[str, Any], feld: str, wert: object
) -> None:
    response = api.post(
        f"{BASIS}/floors/{geschoss['floor']['id']}/rooms",
        headers=auth_headers(token),
        json={"name": "Raum", feld: wert},
    )

    assert response.status_code == 422


def test_unbekanntes_feld_wird_abgelehnt(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    """``extra="forbid"``: Ein Tippfehler verschwindet nicht stillschweigend."""
    response = api.post(
        f"{BASIS}/floors/{geschoss['floor']['id']}/rooms",
        headers=auth_headers(token),
        json={"name": "Raum", "floor_polygon_mm": [[0, 0]]},
    )

    assert response.status_code == 422


# ------------------------------------------------------------------ CRUD Wand


def test_waende_werden_hinten_angehaengt(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])

    erste = wand_anlegen(api, token, raum["id"], 0, 0, 5_000, 0)
    zweite = wand_anlegen(api, token, raum["id"], 5_000, 0, 5_000, 4_000)

    assert erste["sort_order"] == 0
    assert zweite["sort_order"] == 1
    assert erste["length_mm"] == 5_000
    assert erste["thickness_mm"] == 115
    assert erste["opening_count"] == 0


def test_wand_mit_identischem_start_und_endpunkt_wird_abgelehnt(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])

    response = api.post(
        f"{BASIS}/rooms/{raum['id']}/walls",
        headers=auth_headers(token),
        json={"x1_mm": 1_000, "y1_mm": 1_000, "x2_mm": 1_000, "y2_mm": 1_000},
    )

    assert response.status_code == 422
    assert "wall-degenerate" in fehlercodes(response)


def test_sich_ueberschneidende_wand_wird_abgelehnt(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    wand_anlegen(api, token, raum["id"], 0, 0, 5_000, 5_000)

    response = api.post(
        f"{BASIS}/rooms/{raum['id']}/walls",
        headers=auth_headers(token),
        json={"x1_mm": 0, "y1_mm": 5_000, "x2_mm": 5_000, "y2_mm": 0},
    )

    assert response.status_code == 422
    assert "walls-intersect" in fehlercodes(response)


def test_doppelte_wand_wird_abgelehnt(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    wand_anlegen(api, token, raum["id"], 0, 0, 5_000, 0)

    response = api.post(
        f"{BASIS}/rooms/{raum['id']}/walls",
        headers=auth_headers(token),
        json={"x1_mm": 5_000, "y1_mm": 0, "x2_mm": 0, "y2_mm": 0},
    )

    assert response.status_code == 422
    assert "wall-duplicate" in fehlercodes(response)


@pytest.mark.parametrize("thickness", [0, 19, 1_001])
def test_unplausible_wandstaerke_wird_abgelehnt(
    api: TestClient, token: str, geschoss: dict[str, Any], thickness: int
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])

    response = api.post(
        f"{BASIS}/rooms/{raum['id']}/walls",
        headers=auth_headers(token),
        json={
            "x1_mm": 0,
            "y1_mm": 0,
            "x2_mm": 5_000,
            "y2_mm": 0,
            "thickness_mm": thickness,
        },
    )

    assert response.status_code == 422


def test_wand_aendern_und_laenge_neu_berechnen(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    wand = wand_anlegen(api, token, raum["id"], 0, 0, 5_000, 0)

    response = api.patch(
        f"{BASIS}/walls/{wand['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"x2_mm": 3_000, "y2_mm": 4_000},
    )

    assert response.status_code == 200, response.text
    assert response.json()["length_mm"] == 5_000
    assert response.json()["version"] == 2


def test_waende_umordnen(api: TestClient, token: str, geschoss: dict[str, Any]) -> None:
    """Die Reihenfolge ist explizit und wird als Ganzes gesetzt."""
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    waende = rechteck_anlegen(api, token, raum["id"])
    gedreht = [waende[3]["id"], waende[0]["id"], waende[1]["id"], waende[2]["id"]]

    response = api.post(
        f"{BASIS}/rooms/{raum['id']}/walls/reorder",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"wall_ids": gedreht},
    )

    assert response.status_code == 200, response.text
    assert [wand["id"] for wand in response.json()] == gedreht
    assert [wand["sort_order"] for wand in response.json()] == [0, 1, 2, 3]
    # Der Raum traegt die Reihenfolge - seine Version zaehlt weiter.
    assert (
        api.get(f"{BASIS}/rooms/{raum['id']}", headers=auth_headers(token)).json()["version"] == 2
    )
    # Und die Kontur bleibt gueltig, nur anders herum aufgezaehlt.
    bericht = api.get(f"{BASIS}/rooms/{raum['id']}/contour", headers=auth_headers(token))
    assert bericht.json()["contour_status"] == "valid"


def test_unvollstaendige_reihenfolge_wird_abgelehnt(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    waende = rechteck_anlegen(api, token, raum["id"])

    response = api.post(
        f"{BASIS}/rooms/{raum['id']}/walls/reorder",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"wall_ids": [waende[0]["id"], waende[1]["id"]]},
    )

    assert response.status_code == 422
    assert "genau die Waende" in response.json()["detail"]


def test_doppelte_wand_in_der_reihenfolge_wird_abgelehnt(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    waende = rechteck_anlegen(api, token, raum["id"])
    ids = [waende[0]["id"], waende[0]["id"], waende[1]["id"], waende[2]["id"]]

    response = api.post(
        f"{BASIS}/rooms/{raum['id']}/walls/reorder",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"wall_ids": ids},
    )

    assert response.status_code == 422
    assert "mehrfach" in response.json()["detail"]


def test_wand_loeschen_schliesst_die_luecke_in_der_reihenfolge(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    waende = rechteck_anlegen(api, token, raum["id"])

    geloescht = api.delete(
        f"{BASIS}/walls/{waende[1]['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
    )

    assert geloescht.status_code == 204
    verbleibend = api.get(f"{BASIS}/rooms/{raum['id']}/walls", headers=auth_headers(token)).json()
    assert [wand["sort_order"] for wand in verbleibend] == [0, 1, 2]


# ----------------------------------------------------------- Raumkontur


def test_gueltige_rechteckige_kontur(api: TestClient, token: str, geschoss: dict[str, Any]) -> None:
    """Exit-Kriterium: vier Waende, geschlossen, Flaeche berechnet."""
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    rechteck_anlegen(api, token, raum["id"], breite=5_000, tiefe=4_000)

    bericht = api.get(f"{BASIS}/rooms/{raum['id']}/contour", headers=auth_headers(token))

    assert bericht.status_code == 200
    body = bericht.json()
    assert body["contour_status"] == "valid"
    assert body["problems"] == []
    assert body["wall_count"] == 4
    assert body["area_mm2"] == 20_000_000
    assert body["area_m2"] == "20.000"
    assert body["perimeter_mm"] == 18_000


def test_flaeche_erscheint_auch_am_raum(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    rechteck_anlegen(api, token, raum["id"], breite=4_250, tiefe=3_600)

    gelesen = api.get(f"{BASIS}/rooms/{raum['id']}", headers=auth_headers(token)).json()

    assert gelesen["contour_status"] == "valid"
    assert gelesen["area_mm2"] == 15_300_000
    assert gelesen["area_m2"] == "15.300"


def test_offene_kontur_bleibt_entwurf(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    wand_anlegen(api, token, raum["id"], 0, 0, 5_000, 0)
    wand_anlegen(api, token, raum["id"], 5_000, 0, 5_000, 4_000)
    wand_anlegen(api, token, raum["id"], 5_000, 4_000, 0, 4_000)

    bericht = api.get(f"{BASIS}/rooms/{raum['id']}/contour", headers=auth_headers(token)).json()

    assert bericht["contour_status"] == "draft"
    assert bericht["area_mm2"] is None
    assert "contour-not-closed" in {problem["code"] for problem in bericht["problems"]}
    # Der Umfang ist auch im Entwurf nuetzlich.
    assert bericht["perimeter_mm"] == 14_000


def test_nicht_anschliessende_waende_werden_im_bericht_benannt(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    wand_anlegen(api, token, raum["id"], 0, 0, 5_000, 0)
    wand_anlegen(api, token, raum["id"], 5_200, 0, 5_200, 4_000)
    wand_anlegen(api, token, raum["id"], 5_200, 4_000, 0, 4_000)
    wand_anlegen(api, token, raum["id"], 0, 4_000, 0, 0)

    bericht = api.get(f"{BASIS}/rooms/{raum['id']}/contour", headers=auth_headers(token)).json()

    assert bericht["contour_status"] == "draft"
    codes = {problem["code"] for problem in bericht["problems"]}
    assert "contour-gap" in codes


def test_bericht_nennt_die_betroffenen_waende(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    """Die Oberflaeche soll die schuldigen Waende hervorheben koennen."""
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    erste = wand_anlegen(api, token, raum["id"], 0, 0, 5_000, 0)
    zweite = wand_anlegen(api, token, raum["id"], 5_200, 0, 5_200, 4_000)
    wand_anlegen(api, token, raum["id"], 5_200, 4_000, 0, 4_000)
    wand_anlegen(api, token, raum["id"], 0, 4_000, 0, 0)

    bericht = api.get(f"{BASIS}/rooms/{raum['id']}/contour", headers=auth_headers(token)).json()

    luecken = [problem for problem in bericht["problems"] if problem["code"] == "contour-gap"]
    assert len(luecken) == 1
    assert set(luecken[0]["wall_ids"]) == {erste["id"], zweite["id"]}


def test_kontur_mit_schraegen_waenden_ist_gueltig(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    """Senkrecht, waagerecht und schraeg muessen gleich gut funktionieren."""
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    wand_anlegen(api, token, raum["id"], 0, 0, 4_000, 0)
    wand_anlegen(api, token, raum["id"], 4_000, 0, 4_000, 2_000)
    wand_anlegen(api, token, raum["id"], 4_000, 2_000, 0, 5_000)
    wand_anlegen(api, token, raum["id"], 0, 5_000, 0, 0)

    bericht = api.get(f"{BASIS}/rooms/{raum['id']}/contour", headers=auth_headers(token)).json()

    assert bericht["contour_status"] == "valid"
    assert bericht["area_mm2"] == 14_000_000


# ------------------------------------------------------------------ Oeffnungen


def test_oeffnung_in_der_wand_anlegen(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    wand = wand_anlegen(api, token, raum["id"], 0, 0, 5_000, 0)

    response = api.post(
        f"{BASIS}/walls/{wand['id']}/openings",
        headers=auth_headers(token),
        json={"kind": "door", "offset_mm": 1_000, "width_mm": 1_010, "height_mm": 2_010},
    )

    assert response.status_code == 201, response.text
    assert response.json()["kind"] == "door"
    assert response.json()["sill_height_mm"] == 0
    assert response.json()["version"] == 1

    liste = api.get(f"{BASIS}/walls/{wand['id']}/openings", headers=auth_headers(token))
    assert len(liste.json()) == 1


def test_wandliste_zaehlt_die_oeffnungen(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    waende = rechteck_anlegen(api, token, raum["id"])
    api.post(
        f"{BASIS}/walls/{waende[0]['id']}/openings",
        headers=auth_headers(token),
        json={"kind": "door", "offset_mm": 500, "width_mm": 1_010, "height_mm": 2_010},
    )

    liste = api.get(f"{BASIS}/rooms/{raum['id']}/walls", headers=auth_headers(token)).json()

    assert [wand["opening_count"] for wand in liste] == [1, 0, 0, 0]


def test_oeffnung_ausserhalb_der_wand_wird_abgelehnt(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    wand = wand_anlegen(api, token, raum["id"], 0, 0, 5_000, 0)

    response = api.post(
        f"{BASIS}/walls/{wand['id']}/openings",
        headers=auth_headers(token),
        json={"kind": "door", "offset_mm": 4_500, "width_mm": 1_010, "height_mm": 2_010},
    )

    assert response.status_code == 422
    assert "opening-exceeds-wall" in fehlercodes(response)


def test_ueberlappende_oeffnungen_werden_abgelehnt(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    wand = wand_anlegen(api, token, raum["id"], 0, 0, 5_000, 0)
    api.post(
        f"{BASIS}/walls/{wand['id']}/openings",
        headers=auth_headers(token),
        json={"kind": "door", "offset_mm": 1_000, "width_mm": 1_010, "height_mm": 2_010},
    )

    response = api.post(
        f"{BASIS}/walls/{wand['id']}/openings",
        headers=auth_headers(token),
        json={
            "kind": "window",
            "offset_mm": 1_500,
            "width_mm": 1_010,
            "height_mm": 1_400,
            "sill_height_mm": 900,
        },
    )

    assert response.status_code == 422
    assert "openings-overlap" in fehlercodes(response)


def test_beruehrende_oeffnungen_sind_erlaubt(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    """Dokumentierte Entscheidung: gemeinsamer Rahmenpfosten ist zulaessig."""
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    wand = wand_anlegen(api, token, raum["id"], 0, 0, 5_000, 0)
    api.post(
        f"{BASIS}/walls/{wand['id']}/openings",
        headers=auth_headers(token),
        json={"kind": "door", "offset_mm": 1_000, "width_mm": 1_000, "height_mm": 2_010},
    )

    response = api.post(
        f"{BASIS}/walls/{wand['id']}/openings",
        headers=auth_headers(token),
        json={"kind": "door", "offset_mm": 2_000, "width_mm": 1_000, "height_mm": 2_010},
    )

    assert response.status_code == 201, response.text


def test_fenster_ohne_bruestung_wird_abgelehnt(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    wand = wand_anlegen(api, token, raum["id"], 0, 0, 5_000, 0)

    response = api.post(
        f"{BASIS}/walls/{wand['id']}/openings",
        headers=auth_headers(token),
        json={"kind": "window", "offset_mm": 1_000, "width_mm": 1_200, "height_mm": 1_400},
    )

    assert response.status_code == 422
    assert "window-needs-sill" in fehlercodes(response)


def test_oeffnung_hoeher_als_der_raum_wird_abgelehnt(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"], height_mm=2_500)
    wand = wand_anlegen(api, token, raum["id"], 0, 0, 5_000, 0)

    response = api.post(
        f"{BASIS}/walls/{wand['id']}/openings",
        headers=auth_headers(token),
        json={
            "kind": "window",
            "offset_mm": 1_000,
            "width_mm": 1_200,
            "height_mm": 1_400,
            "sill_height_mm": 1_500,
        },
    )

    assert response.status_code == 422
    assert "opening-exceeds-room-height" in fehlercodes(response)


def test_oeffnung_aendern_und_loeschen(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    wand = wand_anlegen(api, token, raum["id"], 0, 0, 5_000, 0)
    oeffnung = api.post(
        f"{BASIS}/walls/{wand['id']}/openings",
        headers=auth_headers(token),
        json={"kind": "door", "offset_mm": 1_000, "width_mm": 1_010, "height_mm": 2_010},
    ).json()

    geaendert = api.patch(
        f"{BASIS}/openings/{oeffnung['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"offset_mm": 2_000},
    )
    assert geaendert.status_code == 200, geaendert.text
    assert geaendert.json()["offset_mm"] == 2_000
    assert geaendert.json()["version"] == 2

    geloescht = api.delete(
        f"{BASIS}/openings/{oeffnung['id']}",
        headers={**auth_headers(token), "If-Match": "2"},
    )
    assert geloescht.status_code == 204
    assert api.get(f"{BASIS}/walls/{wand['id']}/openings", headers=auth_headers(token)).json() == []


# ----------------------------------------------- Folgen einer Wandaenderung


def test_wandaenderung_darf_eine_oeffnung_nicht_ungueltig_machen(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    """Die Wand wird gekuerzt - die Tuer laege ausserhalb. Das ist ``422``."""
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    wand = wand_anlegen(api, token, raum["id"], 0, 0, 5_000, 0)
    api.post(
        f"{BASIS}/walls/{wand['id']}/openings",
        headers=auth_headers(token),
        json={"kind": "door", "offset_mm": 3_500, "width_mm": 1_010, "height_mm": 2_010},
    )

    response = api.patch(
        f"{BASIS}/walls/{wand['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"x2_mm": 4_000},
    )

    assert response.status_code == 422
    assert "opening-exceeds-wall" in fehlercodes(response)
    # Die Wand ist unveraendert geblieben.
    unveraendert = api.get(f"{BASIS}/rooms/{raum['id']}/walls", headers=auth_headers(token)).json()
    assert unveraendert[0]["x2_mm"] == 5_000
    assert unveraendert[0]["version"] == 1


def test_raumhoehe_darf_eine_oeffnung_nicht_ungueltig_machen(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"], height_mm=2_800)
    wand = wand_anlegen(api, token, raum["id"], 0, 0, 5_000, 0)
    api.post(
        f"{BASIS}/walls/{wand['id']}/openings",
        headers=auth_headers(token),
        json={
            "kind": "window",
            "offset_mm": 1_000,
            "width_mm": 1_200,
            "height_mm": 1_600,
            "sill_height_mm": 1_100,
        },
    )

    response = api.patch(
        f"{BASIS}/rooms/{raum['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"height_mm": 2_500},
    )

    assert response.status_code == 422
    assert "opening-exceeds-room-height" in fehlercodes(response)
    assert (
        api.get(f"{BASIS}/rooms/{raum['id']}", headers=auth_headers(token)).json()["height_mm"]
        == 2_800
    )


def test_wand_mit_oeffnung_laesst_sich_nicht_loeschen(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    """Dokumentierte Entscheidung: Ablehnen statt stiller Kaskade."""
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    wand = wand_anlegen(api, token, raum["id"], 0, 0, 5_000, 0)
    api.post(
        f"{BASIS}/walls/{wand['id']}/openings",
        headers=auth_headers(token),
        json={"kind": "door", "offset_mm": 1_000, "width_mm": 1_010, "height_mm": 2_010},
    )

    response = api.delete(
        f"{BASIS}/walls/{wand['id']}", headers={**auth_headers(token), "If-Match": "1"}
    )

    assert response.status_code == 409
    assert "Oeffnung" in response.json()["detail"]
    assert api.get(f"{BASIS}/rooms/{raum['id']}/walls", headers=auth_headers(token)).json()


def test_raum_loeschen_nimmt_waende_und_oeffnungen_mit(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    """Die Kaskade ist gewollt: Eine Wand ohne Raum hat keine Bedeutung."""
    from app.modules.electrical.models import ElectricalOpening, ElectricalWall

    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    waende = rechteck_anlegen(api, token, raum["id"])
    api.post(
        f"{BASIS}/walls/{waende[0]['id']}/openings",
        headers=auth_headers(token),
        json={"kind": "door", "offset_mm": 1_000, "width_mm": 1_010, "height_mm": 2_010},
    )

    geloescht = api.delete(
        f"{BASIS}/rooms/{raum['id']}", headers={**auth_headers(token), "If-Match": "1"}
    )

    assert geloescht.status_code == 204
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        assert session.execute(select(ElectricalWall)).scalars().all() == []
        assert session.execute(select(ElectricalOpening)).scalars().all() == []
    finally:
        session.close()


# ------------------------------------------------------------------ If-Match


@pytest.mark.parametrize(
    ("methode", "pfad_vorlage", "koerper"),
    [
        ("PATCH", "{basis}/rooms/{room_id}", {"name": "Neu"}),
        ("DELETE", "{basis}/rooms/{room_id}", None),
        ("PATCH", "{basis}/walls/{wall_id}", {"x2_mm": 4_000}),
        ("DELETE", "{basis}/walls/{wall_id}", None),
        ("POST", "{basis}/rooms/{room_id}/walls/reorder", {"wall_ids": []}),
    ],
)
def test_fehlender_if_match_header_liefert_428(
    api: TestClient,
    token: str,
    geschoss: dict[str, Any],
    methode: str,
    pfad_vorlage: str,
    koerper: dict[str, Any] | None,
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    wand = wand_anlegen(api, token, raum["id"], 0, 0, 5_000, 0)
    pfad = pfad_vorlage.format(basis=BASIS, room_id=raum["id"], wall_id=wand["id"])

    response = api.request(methode, pfad, headers=auth_headers(token), json=koerper)

    assert response.status_code == 428
    assert response.json()["type"].endswith("/precondition-required")


@pytest.mark.parametrize("wert", ['W/"1"', '"1', '1"', "1, 2", "*", "0", "-1", "abc", "1.0", "01"])
def test_ungueltiger_if_match_header_liefert_428(
    api: TestClient, token: str, geschoss: dict[str, Any], wert: str
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])

    response = api.patch(
        f"{BASIS}/rooms/{raum['id']}",
        headers={**auth_headers(token), "If-Match": wert},
        json={"name": "Neu"},
    )

    assert response.status_code == 428


def test_veraltete_version_liefert_409(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    api.patch(
        f"{BASIS}/rooms/{raum['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"name": "Kueche"},
    )

    response = api.patch(
        f"{BASIS}/rooms/{raum['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"name": "Bad"},
    )

    assert response.status_code == 409
    assert response.json()["type"].endswith("/version-conflict")


def test_etag_schreibweise_wird_akzeptiert(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])

    response = api.patch(
        f"{BASIS}/rooms/{raum['id']}",
        headers={**auth_headers(token), "If-Match": '"1"'},
        json={"name": "Kueche"},
    )

    assert response.status_code == 200


# ---------------------------------------------------- archiviertes Projekt


@pytest.fixture
def archiviert(api: TestClient, token: str, geschoss: dict[str, Any]) -> dict[str, Any]:
    """Raum mit Wand und Oeffnung, danach das Projekt archivieren."""
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    waende = rechteck_anlegen(api, token, raum["id"])
    oeffnung = api.post(
        f"{BASIS}/walls/{waende[0]['id']}/openings",
        headers=auth_headers(token),
        json={"kind": "door", "offset_mm": 1_000, "width_mm": 1_010, "height_mm": 2_010},
    )
    assert oeffnung.status_code == 201, oeffnung.text
    archivieren = api.post(
        f"/api/v1/projects/{geschoss['project']['id']}/archive",
        headers={**auth_headers(token), "If-Match": str(geschoss["project"]["version"])},
    )
    assert archivieren.status_code == 200, archivieren.text
    return {
        "floor": geschoss["floor"],
        "room": raum,
        "walls": waende,
        "opening": oeffnung.json(),
    }


def test_archiviertes_projekt_bleibt_lesbar(
    api: TestClient, token: str, archiviert: dict[str, Any]
) -> None:
    kopf = auth_headers(token)
    raum_id = archiviert["room"]["id"]

    assert (
        api.get(f"{BASIS}/floors/{archiviert['floor']['id']}/rooms", headers=kopf).status_code
        == 200
    )
    assert api.get(f"{BASIS}/rooms/{raum_id}", headers=kopf).status_code == 200
    assert api.get(f"{BASIS}/rooms/{raum_id}/contour", headers=kopf).status_code == 200
    assert api.get(f"{BASIS}/rooms/{raum_id}/walls", headers=kopf).status_code == 200
    assert (
        api.get(f"{BASIS}/walls/{archiviert['walls'][0]['id']}/openings", headers=kopf).status_code
        == 200
    )


def test_archiviertes_projekt_ist_vollstaendig_schreibgeschuetzt(
    api: TestClient, token: str, archiviert: dict[str, Any]
) -> None:
    """Alle acht schreibenden Endpunkte liefern ``409 project-archived``."""
    kopf = auth_headers(token)
    mit_version = {**kopf, "If-Match": "1"}
    raum_id = archiviert["room"]["id"]
    wand_id = archiviert["walls"][0]["id"]
    oeffnung_id = archiviert["opening"]["id"]

    versuche: list[tuple[str, str, str, dict[str, str], dict[str, Any] | None]] = [
        (
            "Raum anlegen",
            "POST",
            f"{BASIS}/floors/{archiviert['floor']['id']}/rooms",
            kopf,
            {"name": "X"},
        ),
        ("Raum aendern", "PATCH", f"{BASIS}/rooms/{raum_id}", mit_version, {"name": "X"}),
        ("Raum loeschen", "DELETE", f"{BASIS}/rooms/{raum_id}", mit_version, None),
        (
            "Wand anlegen",
            "POST",
            f"{BASIS}/rooms/{raum_id}/walls",
            kopf,
            {"x1_mm": 0, "y1_mm": 9_000, "x2_mm": 1_000, "y2_mm": 9_000},
        ),
        ("Wand aendern", "PATCH", f"{BASIS}/walls/{wand_id}", mit_version, {"thickness_mm": 240}),
        ("Wand loeschen", "DELETE", f"{BASIS}/walls/{wand_id}", mit_version, None),
        (
            "Waende umordnen",
            "POST",
            f"{BASIS}/rooms/{raum_id}/walls/reorder",
            mit_version,
            {"wall_ids": [wand["id"] for wand in archiviert["walls"]]},
        ),
        (
            "Oeffnung anlegen",
            "POST",
            f"{BASIS}/walls/{wand_id}/openings",
            kopf,
            {"kind": "door", "offset_mm": 3_000, "width_mm": 1_010, "height_mm": 2_010},
        ),
        (
            "Oeffnung aendern",
            "PATCH",
            f"{BASIS}/openings/{oeffnung_id}",
            mit_version,
            {"offset_mm": 2_000},
        ),
        ("Oeffnung loeschen", "DELETE", f"{BASIS}/openings/{oeffnung_id}", mit_version, None),
    ]

    for bezeichnung, methode, pfad, kopfzeilen, koerper in versuche:
        antwort = api.request(methode, pfad, headers=kopfzeilen, json=koerper)
        assert antwort.status_code == 409, f"{bezeichnung}: {antwort.status_code} {antwort.text}"
        assert antwort.json()["type"].endswith("/project-archived"), bezeichnung


# -------------------------------------------------------------- Berechtigungen


def _mitglied_mit_permissions(
    engine: Engine, organization_id: uuid.UUID, email: str, permissions: tuple[str, ...]
) -> None:
    """Legt einen Benutzer mit genau diesen Berechtigungen an."""
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        user = User(
            email=email,
            password_hash=hash_password(ADMIN_PASSWORD),
            full_name="Testperson",
        )
        session.add(user)
        session.flush()
        member = OrganizationMember(
            organization_id=organization_id, user_id=user.id, status=MEMBER_STATUS_ACTIVE
        )
        session.add(member)
        role = Role(
            organization_id=organization_id,
            key=f"test-{uuid.uuid4().hex[:8]}",
            name="Testrolle",
            description="nur fuer diesen Test",
            is_system=False,
        )
        session.add(role)
        session.flush()
        for key in permissions:
            permission = session.execute(
                select(Permission).where(Permission.key == key)
            ).scalar_one()
            session.add(RolePermission(role_id=role.id, permission_id=permission.id))
        session.add(
            MemberRole(organization_id=organization_id, member_id=member.id, role_id=role.id)
        )
        session.commit()
    finally:
        session.close()


def test_lesen_ohne_schreibrecht(
    api: TestClient, token: str, betrieb: uuid.UUID, engine: Engine, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    _mitglied_mit_permissions(engine, betrieb, "leser@elektro.example", (PLAN_READ,))
    leser = login(api, "leser@elektro.example")

    assert api.get(f"{BASIS}/rooms/{raum['id']}", headers=auth_headers(leser)).status_code == 200
    verboten = api.post(
        f"{BASIS}/floors/{geschoss['floor']['id']}/rooms",
        headers=auth_headers(leser),
        json={"name": "Neu"},
    )
    assert verboten.status_code == 403
    assert verboten.json()["type"].endswith("/permission-denied")


def test_ohne_leserecht_kein_zugriff(
    api: TestClient, token: str, betrieb: uuid.UUID, engine: Engine, geschoss: dict[str, Any]
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    _mitglied_mit_permissions(engine, betrieb, "fremd@elektro.example", ("project.record.read",))
    fremd = login(api, "fremd@elektro.example")

    response = api.get(f"{BASIS}/rooms/{raum['id']}", headers=auth_headers(fremd))

    assert response.status_code == 403


def test_schreibrecht_genuegt_fuer_die_ganze_kontur(
    api: TestClient, token: str, betrieb: uuid.UUID, engine: Engine, geschoss: dict[str, Any]
) -> None:
    """Zwei Berechtigungen reichen: lesen und bearbeiten."""
    _mitglied_mit_permissions(engine, betrieb, "planer@elektro.example", (PLAN_READ, PLAN_WRITE))
    planer = login(api, "planer@elektro.example")

    raum = raum_anlegen(api, planer, geschoss["floor"]["id"])
    waende = rechteck_anlegen(api, planer, raum["id"])
    oeffnung = api.post(
        f"{BASIS}/walls/{waende[0]['id']}/openings",
        headers=auth_headers(planer),
        json={"kind": "door", "offset_mm": 1_000, "width_mm": 1_010, "height_mm": 2_010},
    )

    assert oeffnung.status_code == 201, oeffnung.text


def test_administrator_erhaelt_die_modulrechte_aus_dem_seed(api: TestClient, token: str) -> None:
    """Der Seed verteilt die Berechtigungen neuer Module mit."""
    body = api.get("/api/v1/me", headers=auth_headers(token)).json()

    assert PLAN_READ in body["permissions"]
    assert PLAN_WRITE in body["permissions"]
    # Bestehende Rechte bleiben unberuehrt.
    assert "project.record.write" in body["permissions"]


def test_electrical_ist_fuer_den_betrieb_aktiv(api: TestClient, token: str) -> None:
    """Die Sichtbarkeit im Frontend haengt an dieser Liste."""
    eintraege = api.get("/api/v1/me/modules", headers=auth_headers(token)).json()

    aktiv = {eintrag["id"] for eintrag in eintraege if eintrag["enabled"]}
    assert "electrical" in aktiv


# ------------------------------------------------------------------- Events


def _events(engine: Engine) -> list[DomainEventRecord]:
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        return list(
            session.execute(select(DomainEventRecord).order_by(DomainEventRecord.occurred_at.asc()))
            .scalars()
            .all()
        )
    finally:
        session.close()


def test_raum_anlegen_erzeugt_ein_event(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])

    eintraege = [event for event in _events(engine) if event.event_type == PLAN_UPDATED]

    assert len(eintraege) == 1
    event = eintraege[0]
    assert event.event_version == 1
    assert event.aggregate_type == "project"
    assert str(event.aggregate_id) == geschoss["project"]["id"]
    assert event.payload == {
        "project_id": geschoss["project"]["id"],
        "floor_id": geschoss["floor"]["id"],
        "room_id": raum["id"],
        "change_kind": "room_created",
    }
    # Ohne Empfaenger gilt die Zustellung als erledigt.
    assert event.handler_status == "ok"


def test_event_nutzlast_enthaelt_keine_namen(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    """Nur IDs und ein Schluessel - keine personenbezogenen Daten."""
    raum_anlegen(api, token, geschoss["floor"]["id"], name="Schlafzimmer", room_number="1.03")

    for event in _events(engine):
        assert "Schlafzimmer" not in str(event.payload)
        assert "1.03" not in str(event.payload)
        assert "Bauherr" not in str(event.payload)


@pytest.mark.parametrize(
    ("aktion", "erwartetes_kind"),
    [
        ("wand", "walls_changed"),
        ("oeffnung", "openings_changed"),
    ],
)
def test_aenderungsart_im_event(
    api: TestClient,
    token: str,
    geschoss: dict[str, Any],
    engine: Engine,
    aktion: str,
    erwartetes_kind: str,
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    wand = wand_anlegen(api, token, raum["id"], 0, 0, 5_000, 0)
    if aktion == "oeffnung":
        api.post(
            f"{BASIS}/walls/{wand['id']}/openings",
            headers=auth_headers(token),
            json={"kind": "door", "offset_mm": 1_000, "width_mm": 1_010, "height_mm": 2_010},
        )

    arten = [event.payload["change_kind"] for event in _events(engine)]

    assert arten[-1] == erwartetes_kind


def test_abgelehnte_aenderung_erzeugt_kein_event(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    """Vor dem Commit ist nichts Tatsache - ein 422 darf nichts melden."""
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    vorher = len(_events(engine))

    response = api.post(
        f"{BASIS}/rooms/{raum['id']}/walls",
        headers=auth_headers(token),
        json={"x1_mm": 0, "y1_mm": 0, "x2_mm": 0, "y2_mm": 0},
    )

    assert response.status_code == 422
    assert len(_events(engine)) == vorher


def test_konturbericht_erzeugt_kein_event(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    """Der Bericht aendert nichts - und ein Event ist eine Tatsache."""
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    rechteck_anlegen(api, token, raum["id"])
    vorher = len(_events(engine))

    api.get(f"{BASIS}/rooms/{raum['id']}/contour", headers=auth_headers(token))

    assert len(_events(engine)) == vorher


# -------------------------------------------------- Geschoss mit Planungsdaten


def test_geschoss_mit_raeumen_laesst_sich_nicht_loeschen(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    """Der Fremdschluessel schuetzt die Planung - Antwort ist ein ``409``."""
    raum_anlegen(api, token, geschoss["floor"]["id"])

    response = api.delete(
        f"/api/v1/floors/{geschoss['floor']['id']}",
        headers={**auth_headers(token), "If-Match": str(geschoss["floor"]["version"])},
    )

    assert response.status_code == 409
    assert "Planungsdaten" in response.json()["detail"]
    assert (
        api.get(
            f"/api/v1/buildings/{geschoss['building']['id']}/floors", headers=auth_headers(token)
        ).status_code
        == 200
    )


def test_gebaeude_mit_planungsdaten_laesst_sich_nicht_loeschen(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    raum_anlegen(api, token, geschoss["floor"]["id"])

    response = api.delete(
        f"/api/v1/buildings/{geschoss['building']['id']}",
        headers={**auth_headers(token), "If-Match": str(geschoss["building"]["version"])},
    )

    assert response.status_code == 409
    assert "Planungsdaten" in response.json()["detail"]


def test_leeres_geschoss_bleibt_loeschbar(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    response = api.delete(
        f"/api/v1/floors/{geschoss['floor']['id']}",
        headers={**auth_headers(token), "If-Match": str(geschoss["floor"]["version"])},
    )

    assert response.status_code == 204
