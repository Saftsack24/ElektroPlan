"""Planungsstand und atomares Konturspeichern fuer den 2D-Editor (Phase 4a).

Zwei neue Endpunkte, beide im Fachmodul ``electrical``:

* ``GET /floors/{floor_id}/plan`` - Raeume, Waende, Oeffnungen eines Geschosses
  in einer Antwort und in konstant vielen Abfragen.
* ``PUT /rooms/{room_id}/contour`` - der vollstaendige Zielzustand einer
  Raumgeometrie in **einer** Transaktion.

Jeder abgelehnte Fall prueft zusaetzlich den **Datenbankzustand**: Nach einem
Fehler darf weder eine Wand noch eine Oeffnung noch die Raumversion anders
sein als vorher.

Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import sessionmaker

from app.core.events.models import DomainEventRecord
from app.modules.electrical.events import PLAN_UPDATED
from tests import test_electrical_rooms as raeume
from tests.conftest import auth_headers, login, requires_database

pytestmark = [requires_database, pytest.mark.database]

# Fixtures und Helfer der Raummodell-Tests - bewusst wiederverwendet statt
# kopiert, damit beide Dateien dieselbe Testwelt aufbauen.
betrieb = raeume.betrieb
ereignisse = raeume.ereignisse
token = raeume.token
geschoss = raeume.geschoss
BASIS = raeume.BASIS
fehlercodes = raeume.fehlercodes
raum_anlegen = raeume.raum_anlegen
raumversion = raeume.raumversion
_mitglied_mit_permissions = raeume._mitglied_mit_permissions


# ------------------------------------------------------------------ Helfer


def _rechteck(
    breite: int = 5_000, tiefe: int = 4_000, x: int = 0, y: int = 0
) -> list[dict[str, Any]]:
    """Vier Waende gegen den Uhrzeigersinn, je mit clientseitig erzeugter ID."""
    ecken = [(x, y), (x + breite, y), (x + breite, y + tiefe), (x, y + tiefe)]
    return [
        {
            "id": str(uuid.uuid4()),
            "x1_mm": ecken[index][0],
            "y1_mm": ecken[index][1],
            "x2_mm": ecken[(index + 1) % 4][0],
            "y2_mm": ecken[(index + 1) % 4][1],
            "openings": [],
        }
        for index in range(4)
    ]


def _speichern(
    api: TestClient,
    token: str,
    room_id: str,
    walls: list[dict[str, Any]],
    *,
    version: str | None = None,
    removed: list[str] | None = None,
) -> Any:
    return api.put(
        f"{BASIS}/rooms/{room_id}/contour",
        headers={
            **auth_headers(token),
            "If-Match": version if version is not None else raumversion(api, token, room_id),
        },
        json={"walls": walls, "removed_opening_ids": removed or []},
    )


def _als_eingabe(raum: dict[str, Any]) -> list[dict[str, Any]]:
    """Gespeicherter Stand eines Raums als Zielzustand fuer ``PUT``."""
    return [
        {
            "id": wand["id"],
            "x1_mm": wand["x1_mm"],
            "y1_mm": wand["y1_mm"],
            "x2_mm": wand["x2_mm"],
            "y2_mm": wand["y2_mm"],
            "thickness_mm": wand["thickness_mm"],
            "openings": [
                {
                    key: oeffnung[key]
                    for key in (
                        "id",
                        "kind",
                        "offset_mm",
                        "width_mm",
                        "height_mm",
                        "sill_height_mm",
                    )
                }
                for oeffnung in wand["openings"]
            ],
        }
        for wand in raum["walls"]
    ]


def _plan(api: TestClient, token: str, floor_id: str) -> dict[str, Any]:
    response = api.get(f"{BASIS}/floors/{floor_id}/plan", headers=auth_headers(token))
    assert response.status_code == 200, response.text
    return dict(response.json())


def _raum_im_plan(api: TestClient, token: str, floor_id: str, room_id: str) -> dict[str, Any]:
    return next(raum for raum in _plan(api, token, floor_id)["rooms"] if raum["id"] == room_id)


def _plan_events(engine: Engine) -> list[DomainEventRecord]:
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        return list(
            session.execute(
                select(DomainEventRecord)
                .where(DomainEventRecord.event_type == PLAN_UPDATED)
                .order_by(DomainEventRecord.occurred_at.asc())
            )
            .scalars()
            .all()
        )
    finally:
        session.close()


@pytest.fixture
def rechteckraum(api: TestClient, token: str, geschoss: dict[str, Any]) -> dict[str, Any]:
    """Ein Raum 5000 x 4000 mit Tuer in der ersten Wand - gespeichert ueber ``PUT``."""
    raum = raum_anlegen(api, token, geschoss["floor"]["id"], room_number="0.01")
    waende = _rechteck()
    waende[0]["openings"] = [
        {
            "id": str(uuid.uuid4()),
            "kind": "door",
            "offset_mm": 1_000,
            "width_mm": 1_010,
            "height_mm": 2_010,
            "sill_height_mm": 0,
        }
    ]
    response = _speichern(api, token, raum["id"], waende)
    assert response.status_code == 200, response.text
    return dict(response.json())


# --------------------------------------------------------- Planungsstand


def test_plan_liefert_den_vollstaendigen_stand_eines_geschosses(
    api: TestClient, token: str, geschoss: dict[str, Any], rechteckraum: dict[str, Any]
) -> None:
    floor_id = geschoss["floor"]["id"]
    leer = raum_anlegen(api, token, floor_id, name="Abstellraum", room_number="0.02")

    plan = _plan(api, token, floor_id)

    assert plan["floor_id"] == floor_id
    assert plan["project_id"] == geschoss["project"]["id"]
    # Deterministisch: nach Raumnummer, dann Name, dann ID.
    assert [raum["id"] for raum in plan["rooms"]] == [rechteckraum["id"], leer["id"]]

    raum = plan["rooms"][0]
    assert raum["contour_status"] == "valid"
    assert raum["area_mm2"] == 20_000_000
    assert raum["area_m2"] == "20.000"
    assert raum["perimeter_mm"] == 18_000
    assert raum["version"] == rechteckraum["version"]
    assert raum["contour_problems"] == []
    assert [wand["sort_order"] for wand in raum["walls"]] == [0, 1, 2, 3]
    assert [wand["length_mm"] for wand in raum["walls"]] == [5_000, 4_000, 5_000, 4_000]
    assert raum["walls"][0]["opening_count"] == 1
    assert raum["walls"][0]["openings"][0]["kind"] == "door"
    assert raum["walls"][0]["openings"][0]["offset_mm"] == 1_000

    assert plan["rooms"][1]["walls"] == []
    assert plan["rooms"][1]["contour_status"] == "draft"


def test_plan_nennt_konturprobleme_mit_betroffenen_waenden(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    """Eine offene Kontur ist erlaubt - der Plan sagt, wo sie offen ist."""
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    waende = _rechteck()[:3]
    assert _speichern(api, token, raum["id"], waende).status_code == 200

    im_plan = _raum_im_plan(api, token, geschoss["floor"]["id"], raum["id"])

    assert im_plan["contour_status"] == "draft"
    offen = [p for p in im_plan["contour_problems"] if p["code"] == "contour-not-closed"]
    assert offen and set(offen[0]["wall_ids"]) == {waende[2]["id"], waende[0]["id"]}


def test_plan_kommt_ohne_n_plus_1_abfragen_aus(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    """Die Zahl der Abfragen haengt nicht von der Zahl der Raeume ab."""
    floor_id = geschoss["floor"]["id"]

    def abfragen() -> int:
        anweisungen: list[str] = []

        def mitschreiben(*args: Any) -> None:
            anweisungen.append(str(args[2]))

        event.listen(engine, "before_cursor_execute", mitschreiben)
        try:
            _plan(api, token, floor_id)
        finally:
            event.remove(engine, "before_cursor_execute", mitschreiben)
        return len(anweisungen)

    raum = raum_anlegen(api, token, floor_id, name="Raum 1")
    assert _speichern(api, token, raum["id"], _rechteck()).status_code == 200
    mit_einem_raum = abfragen()

    for nummer in range(2, 8):
        weiterer = raum_anlegen(api, token, floor_id, name=f"Raum {nummer}")
        waende = _rechteck(x=nummer * 6_000)
        waende[0]["openings"] = [
            {
                "kind": "window",
                "offset_mm": 500,
                "width_mm": 1_000,
                "height_mm": 1_000,
                "sill_height_mm": 900,
            }
        ]
        assert _speichern(api, token, weiterer["id"], waende).status_code == 200
    mit_sieben_raeumen = abfragen()

    assert mit_sieben_raeumen == mit_einem_raum, (mit_einem_raum, mit_sieben_raeumen)


def test_plan_ohne_leserecht_ist_verboten(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine, betrieb: uuid.UUID
) -> None:
    _mitglied_mit_permissions(engine, betrieb, "ohne-plan@elektro.example", ())
    fremder = login(api, "ohne-plan@elektro.example")

    response = api.get(
        f"{BASIS}/floors/{geschoss['floor']['id']}/plan", headers=auth_headers(fremder)
    )

    assert response.status_code == 403


def test_unbekanntes_geschoss_liefert_404(api: TestClient, token: str) -> None:
    response = api.get(f"{BASIS}/floors/{uuid.uuid4()}/plan", headers=auth_headers(token))
    assert response.status_code == 404


# -------------------------------------------------- Kontur speichern: Erfolg


def test_neue_kontur_wird_mit_den_ids_des_clients_gespeichert(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    vorher = int(raumversion(api, token, raum["id"]))
    events_vorher = len(_plan_events(engine))
    waende = _rechteck()

    response = _speichern(api, token, raum["id"], waende)

    assert response.status_code == 200, response.text
    antwort = response.json()
    assert [wand["id"] for wand in antwort["walls"]] == [wand["id"] for wand in waende]
    assert [wand["sort_order"] for wand in antwort["walls"]] == [0, 1, 2, 3]
    assert antwort["contour_status"] == "valid"
    assert antwort["area_m2"] == "20.000"
    # Vier neue Waende, aber die Raumversion zaehlt genau einmal weiter.
    assert antwort["version"] == vorher + 1
    # Genau ein Event, nach dem Commit, mit dem erwarteten Schluessel.
    neue = _plan_events(engine)[events_vorher:]
    assert len(neue) == 1
    assert neue[0].payload["change_kind"] == "walls_changed"
    assert neue[0].payload["room_id"] == raum["id"]
    # Die Antwort ist exakt der gespeicherte Stand.
    im_plan = _raum_im_plan(api, token, geschoss["floor"]["id"], raum["id"])
    assert im_plan == antwort


def test_bestehende_waende_werden_geaendert_und_behalten_ihre_ids(
    api: TestClient, token: str, geschoss: dict[str, Any], rechteckraum: dict[str, Any]
) -> None:
    """Ein Eckpunkt wird verschoben: beide angrenzenden Waende gemeinsam."""
    eingabe = _als_eingabe(rechteckraum)
    eingabe[0]["x2_mm"] = 6_000
    eingabe[1]["x1_mm"] = 6_000

    response = _speichern(
        api, token, rechteckraum["id"], eingabe, version=str(rechteckraum["version"])
    )

    assert response.status_code == 200, response.text
    waende = response.json()["walls"]
    assert [wand["id"] for wand in waende] == [wand["id"] for wand in rechteckraum["walls"]]
    assert waende[0]["length_mm"] == 6_000
    assert waende[1]["length_mm"] == 4_123  # sqrt(1000^2 + 4000^2) = 4123,1
    # Nur die geaenderten Waende zaehlen ihre Version weiter.
    alt = {wand["id"]: wand["version"] for wand in rechteckraum["walls"]}
    assert [wand["version"] - alt[wand["id"]] for wand in waende] == [1, 1, 0, 0]
    # Die Tuer haengt weiter an derselben Wand, mit derselben ID.
    assert waende[0]["openings"][0]["id"] == rechteckraum["walls"][0]["openings"][0]["id"]
    assert response.json()["contour_status"] == "valid"


def test_reihenfolge_wird_aus_der_liste_uebernommen(
    api: TestClient, token: str, rechteckraum: dict[str, Any]
) -> None:
    eingabe = _als_eingabe(rechteckraum)
    gedreht = [eingabe[2], eingabe[3], eingabe[0], eingabe[1]]

    response = _speichern(api, token, rechteckraum["id"], gedreht)

    assert response.status_code == 200, response.text
    assert [wand["id"] for wand in response.json()["walls"]] == [wand["id"] for wand in gedreht]
    assert [wand["sort_order"] for wand in response.json()["walls"]] == [0, 1, 2, 3]
    assert response.json()["contour_status"] == "valid"


def test_wand_hinzufuegen_und_entfernen_in_einem_vorgang(
    api: TestClient, token: str, rechteckraum: dict[str, Any]
) -> None:
    """Die obere Wand wird in zwei Waende geteilt, eine andere danach entfernt.

    Erst Teilen (5 Waende), dann in einem zweiten Speichern die beiden Teile
    wieder durch eine neue Wand ersetzen - jeweils ein Vorgang.
    """
    eingabe = _als_eingabe(rechteckraum)
    oben = eingabe[2]  # (5000,4000) -> (0,4000)
    teil_a = {**oben, "x2_mm": 2_500, "openings": []}
    teil_b = {**oben, "id": str(uuid.uuid4()), "x1_mm": 2_500, "openings": []}
    geteilt = [eingabe[0], eingabe[1], teil_a, teil_b, eingabe[3]]

    erste = _speichern(api, token, rechteckraum["id"], geteilt)
    assert erste.status_code == 200, erste.text
    assert len(erste.json()["walls"]) == 5
    assert erste.json()["contour_status"] == "valid"

    ersatz = {**oben, "id": str(uuid.uuid4())}
    zusammen = [eingabe[0], eingabe[1], ersatz, eingabe[3]]
    zweite = _speichern(api, token, rechteckraum["id"], zusammen)

    assert zweite.status_code == 200, zweite.text
    ids = [wand["id"] for wand in zweite.json()["walls"]]
    assert ids == [eingabe[0]["id"], eingabe[1]["id"], ersatz["id"], eingabe[3]["id"]]
    assert teil_a["id"] not in ids and teil_b["id"] not in ids


def test_zielzustand_wird_als_ganzes_geprueft(
    api: TestClient, token: str, rechteckraum: dict[str, Any]
) -> None:
    """Umlaufsinn umkehren: jede Wand einzeln waere ein ungueltiger Zwischenstand.

    Einzeln nacheinander geaendert, liefe die erste umgedrehte Wand auf ihre
    Nachbarin zurueck. Der Zielzustand als Ganzes ist dagegen gueltig - und nur
    er zaehlt. Die Tuer zaehlt danach vom anderen Ende (Wandrichtung!).
    """
    eingabe = _als_eingabe(rechteckraum)
    umgedreht = []
    for wand in reversed(eingabe):
        neu = {
            **wand,
            "x1_mm": wand["x2_mm"],
            "y1_mm": wand["y2_mm"],
            "x2_mm": wand["x1_mm"],
            "y2_mm": wand["y1_mm"],
        }
        for oeffnung in neu["openings"]:
            oeffnung["offset_mm"] = 5_000 - oeffnung["offset_mm"] - oeffnung["width_mm"]
        umgedreht.append(neu)

    response = _speichern(api, token, rechteckraum["id"], umgedreht)

    assert response.status_code == 200, response.text
    assert response.json()["contour_status"] == "valid"
    assert response.json()["area_m2"] == "20.000"
    tuerwand = next(w for w in response.json()["walls"] if w["id"] == eingabe[0]["id"])
    assert (tuerwand["x1_mm"], tuerwand["y1_mm"]) == (5_000, 0)
    assert tuerwand["openings"][0]["offset_mm"] == 2_990


def test_oeffnungen_anlegen_aendern_und_ausdruecklich_entfernen(
    api: TestClient, token: str, rechteckraum: dict[str, Any]
) -> None:
    eingabe = _als_eingabe(rechteckraum)
    tuer_id = eingabe[0]["openings"][0]["id"]
    eingabe[0]["openings"][0]["offset_mm"] = 2_000
    fenster_id = str(uuid.uuid4())
    eingabe[1]["openings"] = [
        {
            "id": fenster_id,
            "kind": "window",
            "offset_mm": 1_000,
            "width_mm": 1_500,
            "height_mm": 1_200,
            "sill_height_mm": 900,
        }
    ]

    geaendert = _speichern(api, token, rechteckraum["id"], eingabe)
    assert geaendert.status_code == 200, geaendert.text
    assert geaendert.json()["walls"][0]["openings"][0]["offset_mm"] == 2_000
    assert geaendert.json()["walls"][1]["openings"][0]["id"] == fenster_id

    ohne_tuer = _als_eingabe(geaendert.json())
    ohne_tuer[0]["openings"] = []
    entfernt = _speichern(api, token, rechteckraum["id"], ohne_tuer, removed=[tuer_id])

    assert entfernt.status_code == 200, entfernt.text
    assert entfernt.json()["walls"][0]["openings"] == []
    assert entfernt.json()["walls"][1]["opening_count"] == 1


def test_wand_mit_oeffnung_wird_mit_ausdruecklich_entfernter_oeffnung_entfernt(
    api: TestClient, token: str, rechteckraum: dict[str, Any]
) -> None:
    """Wand und Tuer gehen gemeinsam - weil die Tuer ausdruecklich genannt ist."""
    eingabe = _als_eingabe(rechteckraum)
    tuer_id = eingabe[0]["openings"][0]["id"]

    response = _speichern(api, token, rechteckraum["id"], eingabe[1:], removed=[tuer_id])

    assert response.status_code == 200, response.text
    assert len(response.json()["walls"]) == 3
    assert response.json()["contour_status"] == "draft"


def test_raum_samt_kontur_in_einem_vorgang_anlegen(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    """Rechteckwerkzeug: Raum und vier Waende atomar, genau ein Event."""
    events_vorher = len(_plan_events(engine))
    waende = _rechteck()

    response = api.post(
        f"{BASIS}/floors/{geschoss['floor']['id']}/rooms",
        headers=auth_headers(token),
        json={"name": "Kueche", "room_number": "0.03", "walls": waende},
    )

    assert response.status_code == 201, response.text
    assert response.json()["contour_status"] == "valid"
    assert response.json()["wall_count"] == 4
    assert response.json()["version"] == 1
    neue = _plan_events(engine)[events_vorher:]
    assert [e.payload["change_kind"] for e in neue] == ["room_created"]
    im_plan = _raum_im_plan(api, token, geschoss["floor"]["id"], response.json()["id"])
    assert [wand["id"] for wand in im_plan["walls"]] == [wand["id"] for wand in waende]


def test_raum_mit_ungueltiger_kontur_entsteht_gar_nicht(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    events_vorher = len(_plan_events(engine))
    waende = _rechteck()
    # Die rechte Wand laeuft quer durch den Raum und kreuzt die linke.
    waende[1]["x2_mm"] = -1_000
    waende[2]["x1_mm"] = -1_000

    response = api.post(
        f"{BASIS}/floors/{geschoss['floor']['id']}/rooms",
        headers=auth_headers(token),
        json={"name": "Kaputt", "walls": waende},
    )

    assert response.status_code == 422, response.text
    assert "walls-intersect" in fehlercodes(response)
    assert _plan(api, token, geschoss["floor"]["id"])["rooms"] == []
    assert len(_plan_events(engine)) == events_vorher


# ------------------------------------------ Kontur speichern: Ablehnungen


def _unveraendert(
    api: TestClient, token: str, floor_id: str, vorher: dict[str, Any], engine: Engine, events: int
) -> None:
    """Nichts hat sich geaendert - weder Waende, Oeffnungen, Version noch Events."""
    assert _raum_im_plan(api, token, floor_id, vorher["id"]) == vorher
    assert len(_plan_events(engine)) == events


@pytest.fixture
def ausgang(
    api: TestClient,
    token: str,
    geschoss: dict[str, Any],
    rechteckraum: dict[str, Any],
    engine: Engine,
) -> tuple[dict[str, Any], int]:
    """Gespeicherter Ausgangsstand und Zahl der Events davor."""
    return _raum_im_plan(api, token, geschoss["floor"]["id"], rechteckraum["id"]), len(
        _plan_events(engine)
    )


def test_ungueltige_kontur_wird_vollstaendig_zurueckgerollt(
    api: TestClient,
    token: str,
    geschoss: dict[str, Any],
    ausgang: tuple[dict[str, Any], int],
    engine: Engine,
) -> None:
    vorher, events = ausgang
    eingabe = _als_eingabe(vorher)
    # Die rechte Wand kreuzt die linke: Selbstueberschneidung.
    eingabe[1]["x2_mm"] = -1_000
    eingabe[2]["x1_mm"] = -1_000

    response = _speichern(api, token, vorher["id"], eingabe)

    assert response.status_code == 422, response.text
    assert "walls-intersect" in fehlercodes(response)
    betroffen = {k for e in response.json()["errors"] for k in e.get("keys", [])}
    assert eingabe[1]["id"] in betroffen
    _unveraendert(api, token, geschoss["floor"]["id"], vorher, engine, events)


def test_ungueltig_gewordene_oeffnung_rollt_alles_zurueck(
    api: TestClient,
    token: str,
    geschoss: dict[str, Any],
    ausgang: tuple[dict[str, Any], int],
    engine: Engine,
) -> None:
    """Die Tuerwand wird so kurz, dass die Tuer nicht mehr hineinpasst."""
    vorher, events = ausgang
    eingabe = _als_eingabe(vorher)
    eingabe[0]["x2_mm"] = 1_500
    eingabe[1]["x1_mm"] = 1_500

    response = _speichern(api, token, vorher["id"], eingabe)

    assert response.status_code == 422, response.text
    fehler = response.json()["errors"]
    tuer = next(e for e in fehler if e["code"] == "opening-exceeds-wall")
    assert tuer["keys"] == [eingabe[0]["openings"][0]["id"]]
    _unveraendert(api, token, geschoss["floor"]["id"], vorher, engine, events)


def test_ueberlappende_oeffnungen_werden_einmal_gemeldet(
    api: TestClient,
    token: str,
    geschoss: dict[str, Any],
    ausgang: tuple[dict[str, Any], int],
    engine: Engine,
) -> None:
    vorher, events = ausgang
    eingabe = _als_eingabe(vorher)
    eingabe[0]["openings"].append(
        {
            "id": str(uuid.uuid4()),
            "kind": "door",
            "offset_mm": 1_500,
            "width_mm": 900,
            "height_mm": 2_000,
            "sill_height_mm": 0,
        }
    )

    response = _speichern(api, token, vorher["id"], eingabe)

    assert response.status_code == 422
    assert [e["code"] for e in response.json()["errors"]] == ["openings-overlap"]
    _unveraendert(api, token, geschoss["floor"]["id"], vorher, engine, events)


def test_doppelte_wand_id_wird_abgelehnt(
    api: TestClient,
    token: str,
    geschoss: dict[str, Any],
    ausgang: tuple[dict[str, Any], int],
    engine: Engine,
) -> None:
    vorher, events = ausgang
    eingabe = _als_eingabe(vorher)
    eingabe[3]["id"] = eingabe[1]["id"]

    response = _speichern(api, token, vorher["id"], eingabe)

    assert response.status_code == 422
    assert "wall-id-duplicate" in fehlercodes(response)
    _unveraendert(api, token, geschoss["floor"]["id"], vorher, engine, events)


def test_wand_aus_anderem_raum_wird_abgelehnt(
    api: TestClient,
    token: str,
    geschoss: dict[str, Any],
    ausgang: tuple[dict[str, Any], int],
    engine: Engine,
) -> None:
    vorher, events = ausgang
    anderer = raum_anlegen(api, token, geschoss["floor"]["id"], name="Nachbar")
    fremd = _rechteck(x=10_000)
    assert _speichern(api, token, anderer["id"], fremd).status_code == 200
    events = len(_plan_events(engine))
    eingabe = _als_eingabe(vorher)
    eingabe[3]["id"] = fremd[3]["id"]

    response = _speichern(api, token, vorher["id"], eingabe)

    assert response.status_code == 422
    assert "wall-foreign" in fehlercodes(response)
    _unveraendert(api, token, geschoss["floor"]["id"], vorher, engine, events)
    nachbar = _raum_im_plan(api, token, geschoss["floor"]["id"], anderer["id"])
    assert [wand["id"] for wand in nachbar["walls"]] == [wand["id"] for wand in fremd]


def test_oeffnung_wechselt_ihre_wand_nicht(
    api: TestClient,
    token: str,
    geschoss: dict[str, Any],
    ausgang: tuple[dict[str, Any], int],
    engine: Engine,
) -> None:
    vorher, events = ausgang
    eingabe = _als_eingabe(vorher)
    eingabe[2]["openings"] = eingabe[0]["openings"]
    eingabe[0]["openings"] = []

    response = _speichern(api, token, vorher["id"], eingabe)

    assert response.status_code == 422
    assert "opening-wall-changed" in fehlercodes(response)
    _unveraendert(api, token, geschoss["floor"]["id"], vorher, engine, events)


def test_wand_mit_oeffnung_verschwindet_nicht_stillschweigend(
    api: TestClient,
    token: str,
    geschoss: dict[str, Any],
    ausgang: tuple[dict[str, Any], int],
    engine: Engine,
) -> None:
    vorher, events = ausgang
    eingabe = _als_eingabe(vorher)

    response = _speichern(api, token, vorher["id"], eingabe[1:])

    assert response.status_code == 409, response.text
    assert "wall-has-openings" in fehlercodes(response)
    assert vorher["walls"][0]["id"] in response.json()["errors"][0]["keys"]
    _unveraendert(api, token, geschoss["floor"]["id"], vorher, engine, events)


def test_fehlende_oeffnung_ist_ein_unvollstaendiger_stand(
    api: TestClient,
    token: str,
    geschoss: dict[str, Any],
    ausgang: tuple[dict[str, Any], int],
    engine: Engine,
) -> None:
    vorher, events = ausgang
    eingabe = _als_eingabe(vorher)
    eingabe[0]["openings"] = []

    response = _speichern(api, token, vorher["id"], eingabe)

    assert response.status_code == 422
    assert "opening-missing" in fehlercodes(response)
    _unveraendert(api, token, geschoss["floor"]["id"], vorher, engine, events)


def test_veraltete_raumversion_liefert_409(
    api: TestClient,
    token: str,
    geschoss: dict[str, Any],
    ausgang: tuple[dict[str, Any], int],
    engine: Engine,
) -> None:
    vorher, events = ausgang
    eingabe = _als_eingabe(vorher)
    eingabe[0]["thickness_mm"] = 240

    response = _speichern(api, token, vorher["id"], eingabe, version=str(vorher["version"] - 1))

    assert response.status_code == 409
    assert response.json()["type"].endswith("/version-conflict")
    _unveraendert(api, token, geschoss["floor"]["id"], vorher, engine, events)


@pytest.mark.parametrize("wert", ['W/"1"', "abc", "0", "1, 2"])
def test_ungueltiges_if_match_liefert_428(
    api: TestClient, token: str, rechteckraum: dict[str, Any], wert: str
) -> None:
    response = _speichern(api, token, rechteckraum["id"], _als_eingabe(rechteckraum), version=wert)
    assert response.status_code == 428


def test_formularaenderung_zwischendurch_wird_nicht_ueberschrieben(
    api: TestClient,
    token: str,
    geschoss: dict[str, Any],
    ausgang: tuple[dict[str, Any], int],
) -> None:
    """Der Editor hat Version n geladen; das Formular aendert eine Wand.

    Weil jede Wandaenderung die Raumversion weiterzaehlt (ADR 0014), faellt der
    Editor mit seinem alten Stand in einen Versionskonflikt - statt die
    Formularaenderung still zu ueberschreiben.
    """
    vorher, _ = ausgang
    wand = vorher["walls"][3]
    formular = api.patch(
        f"{BASIS}/walls/{wand['id']}",
        headers={**auth_headers(token), "If-Match": str(wand["version"])},
        json={"thickness_mm": 300},
    )
    assert formular.status_code == 200, formular.text

    editor = _speichern(
        api, token, vorher["id"], _als_eingabe(vorher), version=str(vorher["version"])
    )

    assert editor.status_code == 409
    assert editor.json()["type"].endswith("/version-conflict")
    danach = _raum_im_plan(api, token, geschoss["floor"]["id"], vorher["id"])
    assert danach["walls"][3]["thickness_mm"] == 300


def test_speichern_ohne_schreibrecht_ist_verboten(
    api: TestClient, token: str, rechteckraum: dict[str, Any], engine: Engine, betrieb: uuid.UUID
) -> None:
    from app.modules.electrical.permissions import PLAN_READ

    _mitglied_mit_permissions(engine, betrieb, "nur-lesen@elektro.example", (PLAN_READ,))
    leser = login(api, "nur-lesen@elektro.example")

    response = api.put(
        f"{BASIS}/rooms/{rechteckraum['id']}/contour",
        headers={**auth_headers(leser), "If-Match": str(rechteckraum["version"])},
        json={"walls": _als_eingabe(rechteckraum)},
    )

    # ``electrical.plan.write`` fehlt - Lesen allein erlaubt kein Speichern.
    assert response.status_code == 403
