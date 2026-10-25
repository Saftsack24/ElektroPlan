"""Verteilung direkt im Plan platzieren (Phase 6c, Schritt VP, ADR 0028).

Schwerpunkte: Lagegeraet und Verknuepfung entstehen **atomar** (oder gar nicht),
dieselben Lageregeln wie im Raumentwurf, Versionen von Verteilung und Raum,
Verschieben auf derselben Wand, Umsetzen nur ohne Leitungen (F5, die Meldung nennt
die Leitungen), Rechte (``circuit.write`` **und** ``plan.write``), Schreibschutz,
Gebaeude- und Mandantengrenzen, ein Event je betroffenem Raum.

Jeder abgelehnte Fall prueft, dass nichts gespeichert wurde. Synthetische Daten.
Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import sessionmaker

from app.core.events.models import DomainEventRecord
from app.modules.electrical.events import PLAN_UPDATED
from app.modules.electrical.models import ElectricalDevice, ElectricalDistributionBoard
from app.modules.electrical.permissions import CIRCUIT_WRITE, PLAN_READ, PLAN_WRITE
from tests import test_electrical_cables as leitungen
from tests import test_electrical_circuits as kreise
from tests import test_electrical_devices_api as geraete
from tests import test_electrical_rooms as raeume
from tests.conftest import auth_headers, login, requires_database

pytestmark = [requires_database, pytest.mark.database]

betrieb = raeume.betrieb
ereignisse = raeume.ereignisse
token = raeume.token
geschoss = raeume.geschoss
BASIS = raeume.BASIS
fehlercodes = raeume.fehlercodes


# ------------------------------------------------------------------ Helfer


def _platzieren(
    api: TestClient,
    token: str,
    board: dict[str, Any],
    raum: dict[str, Any],
    wand: int | str = 0,
    mitte: int = 1_000,
    hoehe: int = 1_400,
    *,
    version: int | str | None = None,
    raumversion: int | None = None,
) -> Any:
    wall_id = raum["walls"][wand]["id"] if isinstance(wand, int) else wand
    return api.put(
        f"{BASIS}/distribution-boards/{board['id']}/placement",
        headers={
            **auth_headers(token),
            "If-Match": str(board["version"] if version is None else version),
        },
        json={
            "room_id": raum["id"],
            "wall_id": wall_id,
            "center_offset_mm": mitte,
            "center_height_mm": hoehe,
            "expected_room_version": raum["version"] if raumversion is None else raumversion,
        },
    )


def _verteilung(api: TestClient, token: str, building_id: str, board_id: str) -> dict[str, Any]:
    boards = kreise._verteilungen(api, token, building_id)
    return next(b for b in boards if b["id"] == board_id)


def _lagegeraete(engine: Engine) -> list[ElectricalDevice]:
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        return list(
            session.execute(
                select(ElectricalDevice).where(
                    ElectricalDevice.device_type_key == "distribution_board"
                )
            ).scalars()
        )
    finally:
        session.close()


def _verknuepfungen(engine: Engine) -> list[uuid.UUID | None]:
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        return [
            board.placement_device_id
            for board in session.execute(
                select(ElectricalDistributionBoard).order_by(ElectricalDistributionBoard.code)
            ).scalars()
        ]
    finally:
        session.close()


def _platzierungsereignisse(engine: Engine) -> list[dict[str, Any]]:
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        return [
            dict(event.payload)
            for event in session.execute(
                select(DomainEventRecord)
                .where(DomainEventRecord.event_type == PLAN_UPDATED)
                .order_by(DomainEventRecord.occurred_at.asc())
            ).scalars()
        ]
    finally:
        session.close()


def _zwei_raeume(api: TestClient, token: str, floor_id: str) -> tuple[dict[str, Any], ...]:
    diele = geraete._raum_mit_plan(api, token, floor_id, name="Diele")
    kueche = geraete._raum_mit_plan(api, token, floor_id, x=6_000, name="Kueche")
    return diele, kueche


# ------------------------------------------------------------------- Tests


def test_platzieren_legt_lagegeraet_und_verknuepfung_gemeinsam_an(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor = geschoss["floor"]["id"]
    haus = geschoss["building"]["id"]
    diele, _ = _zwei_raeume(api, token, floor)
    uv1 = kreise._angelegte_verteilung(api, token, haus)
    vorher = len(_platzierungsereignisse(engine))

    response = _platzieren(api, token, uv1, diele, 0, 1_000, 1_400)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["board"]["placement_device_id"] == body["device"]["id"]
    assert body["board"]["version"] == uv1["version"] + 1
    assert body["device"]["device_type_key"] == "distribution_board"
    assert body["device"]["mounting_surface"] == "wall_interior"
    assert body["device"]["wall_id"] == diele["walls"][0]["id"]
    assert (body["device"]["center_offset_mm"], body["device"]["center_height_mm"]) == (
        1_000,
        1_400,
    )
    assert body["rooms"] == [
        {"id": diele["id"], "floor_id": floor, "version": diele["version"] + 1}
    ]
    # Neu geladen: dieselbe Lage am Raum und an der Verteilung.
    gespeichert = geraete._plan_raum(api, token, floor, diele["id"])
    assert [g["id"] for g in gespeichert["devices"]] == [body["device"]["id"]]
    assert _verteilung(api, token, haus, uv1["id"])["placement_device_id"] == body["device"]["id"]
    # Genau ein Event fuer den Raum, nach dem Commit.
    neu = _platzierungsereignisse(engine)[vorher:]
    assert [(e["room_id"], e["change_kind"]) for e in neu] == [(diele["id"], "devices_changed")]


def test_lage_wird_wie_im_raumentwurf_geprueft(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor = geschoss["floor"]["id"]
    haus = geschoss["building"]["id"]
    raum = geraete._raum_mit_plan(api, token, floor)
    wand = raum["walls"][0]["id"]
    raum = geraete._plan_raum(
        api,
        token,
        floor,
        raum["id"],
    )
    belegt = geraete._speichern(api, token, raum, devices=[geraete._wandgeraet(wand, 3_000, 1_400)])
    assert belegt.status_code == 200, belegt.text
    raum = geraete._plan_raum(api, token, floor, raum["id"])
    uv1 = kreise._angelegte_verteilung(api, token, haus)

    abgelehnt = [
        _platzieren(api, token, uv1, raum, 0, 100, 1_400),  # ragt ueber den Wandanfang
        _platzieren(api, token, uv1, raum, 0, 1_000, 2_400),  # ueber die Raumhoehe
        _platzieren(api, token, uv1, raum, 0, 3_200, 1_400),  # ueberdeckt die Steckdose
    ]
    for response in abgelehnt:
        assert response.status_code == 422, response.text
        assert fehlercodes(response) & {
            "device-outside-wall",
            "device-exceeds-room-height",
            "devices-overlap",
        }
    assert len(_lagegeraete(engine)) == 0
    assert _verknuepfungen(engine) == [None]
    assert _verteilung(api, token, haus, uv1["id"])["version"] == uv1["version"]
    assert geraete._plan_raum(api, token, floor, raum["id"])["version"] == raum["version"]


def test_versionen_von_verteilung_und_raum(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor = geschoss["floor"]["id"]
    haus = geschoss["building"]["id"]
    diele, _ = _zwei_raeume(api, token, floor)
    uv1 = kreise._angelegte_verteilung(api, token, haus)

    ohne = api.put(
        f"{BASIS}/distribution-boards/{uv1['id']}/placement",
        headers=auth_headers(token),
        json={
            "room_id": diele["id"],
            "wall_id": diele["walls"][0]["id"],
            "center_offset_mm": 1_000,
            "center_height_mm": 1_400,
            "expected_room_version": diele["version"],
        },
    )
    assert ohne.status_code == 428
    verteilung_alt = _platzieren(api, token, uv1, diele, version=uv1["version"] + 3)
    raum_alt = _platzieren(api, token, uv1, diele, raumversion=diele["version"] + 3)
    for response in (verteilung_alt, raum_alt):
        assert response.status_code == 409, response.text
        assert response.json()["type"].endswith("version-conflict")
    assert "Raum" in raum_alt.json()["detail"]
    assert len(_lagegeraete(engine)) == 0

    # Doppelt abgeschickt (gleiche Version): genau ein Lagegeraet.
    erste = _platzieren(api, token, uv1, diele)
    zweite = _platzieren(api, token, uv1, diele, 0, 2_000)
    assert erste.status_code == 200, erste.text
    assert zweite.status_code == 409
    assert len(_lagegeraete(engine)) == 1


def test_verschieben_auf_derselben_wand_behaelt_das_geraet(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor = geschoss["floor"]["id"]
    haus = geschoss["building"]["id"]
    diele, _ = _zwei_raeume(api, token, floor)
    uv1 = kreise._angelegte_verteilung(api, token, haus)
    erste = _platzieren(api, token, uv1, diele).json()
    diele = geraete._plan_raum(api, token, floor, diele["id"])

    response = _platzieren(api, token, erste["board"], diele, 0, 2_500, 1_600)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["device"]["id"] == erste["device"]["id"]
    assert (body["device"]["center_offset_mm"], body["device"]["center_height_mm"]) == (
        2_500,
        1_600,
    )
    assert body["board"]["version"] == erste["board"]["version"] + 1
    assert body["rooms"][0]["version"] == diele["version"] + 1
    assert len(_lagegeraete(engine)) == 1


def test_umsetzen_an_eine_andere_wand_ohne_leitungen(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor = geschoss["floor"]["id"]
    haus = geschoss["building"]["id"]
    diele, kueche = _zwei_raeume(api, token, floor)
    uv1 = kreise._angelegte_verteilung(api, token, haus)
    erste = _platzieren(api, token, uv1, diele).json()
    diele = geraete._plan_raum(api, token, floor, diele["id"])
    vorher = len(_platzierungsereignisse(engine))

    response = _platzieren(api, token, erste["board"], kueche, 2, 1_500, 1_400)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["device"]["id"] != erste["device"]["id"]
    assert body["device"]["room_id"] == kueche["id"]
    assert body["board"]["placement_device_id"] == body["device"]["id"]
    assert [r["id"] for r in body["rooms"]] == [kueche["id"], diele["id"]]
    assert [str(g.id) for g in _lagegeraete(engine)] == [body["device"]["id"]]
    assert geraete._plan_raum(api, token, floor, diele["id"])["version"] == diele["version"] + 1
    neu = _platzierungsereignisse(engine)[vorher:]
    assert sorted(e["room_id"] for e in neu) == sorted([kueche["id"], diele["id"]])


def test_umsetzen_mit_leitungen_wird_abgelehnt_und_nennt_sie(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    sz = leitungen._szenario(api, token, geschoss)
    angelegt = leitungen._anlegen(api, token, sz, leitungen._beispiel(sz))
    assert angelegt.status_code == 201, angelegt.text
    board = _verteilung(api, token, sz["building"], sz["board"]["id"])
    kueche = geraete._plan_raum(api, token, sz["floor"], sz["kueche"]["id"])
    diele = geraete._plan_raum(api, token, sz["floor"], sz["diele"]["id"])

    andere_wand = _platzieren(api, token, board, diele, 2, 2_000, 1_400)
    anderer_raum = _platzieren(api, token, board, kueche, 1, 1_500, 1_400)

    for response in (andere_wand, anderer_raum):
        assert response.status_code == 409, response.text
        assert fehlercodes(response) == {"board-placement-has-cables"}
        assert "F1 · L1" in response.json()["detail"]
    assert _verteilung(api, token, sz["building"], board["id"]) == board
    assert [str(g.id) for g in _lagegeraete(engine)] == [sz["uv1"]]
    assert geraete._plan_raum(api, token, sz["floor"], diele["id"])["version"] == diele["version"]


def test_bezuege_ausserhalb_des_gebaeudes_oder_raums(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor = geschoss["floor"]["id"]
    haus = geschoss["building"]["id"]
    diele, kueche = _zwei_raeume(api, token, floor)
    garage = kreise._zweites_gebaeude(api, token, geschoss["project"]["id"])
    fremd = geraete._raum_mit_plan(api, token, garage["floor"]["id"], name="Garage")
    uv1 = kreise._angelegte_verteilung(api, token, haus)

    anderes_gebaeude = _platzieren(api, token, uv1, fremd)
    fremde_wand = _platzieren(api, token, uv1, diele, kueche["walls"][0]["id"])
    unbekannt = api.put(
        f"{BASIS}/distribution-boards/{uuid.uuid4()}/placement",
        headers={**auth_headers(token), "If-Match": "1"},
        json={
            "room_id": diele["id"],
            "wall_id": diele["walls"][0]["id"],
            "center_offset_mm": 1_000,
            "center_height_mm": 1_400,
            "expected_room_version": diele["version"],
        },
    )

    assert anderes_gebaeude.status_code == 422
    assert fehlercodes(anderes_gebaeude) == {"board-placement-not-in-building"}
    assert fremde_wand.status_code == 422
    assert fehlercodes(fremde_wand) == {"board-placement-wall-unknown"}
    assert unbekannt.status_code == 404
    assert len(_lagegeraete(engine)) == 0


def test_rechte_verlangen_stromkreise_und_plan(
    api: TestClient, token: str, betrieb: uuid.UUID, engine: Engine, geschoss: dict[str, Any]
) -> None:
    floor = geschoss["floor"]["id"]
    diele, _ = _zwei_raeume(api, token, floor)
    uv1 = kreise._angelegte_verteilung(api, token, geschoss["building"]["id"])
    for email, rechte in (
        ("leser@vp.example", (PLAN_READ,)),
        ("raumplaner@vp.example", (PLAN_READ, PLAN_WRITE)),
        ("kreise@vp.example", (PLAN_READ, CIRCUIT_WRITE)),
    ):
        raeume._mitglied_mit_permissions(engine, betrieb, email, rechte)
        response = _platzieren(api, login(api, email), uv1, diele)
        assert response.status_code == 403, email
    raeume._mitglied_mit_permissions(
        engine, betrieb, "beides@vp.example", (PLAN_READ, PLAN_WRITE, CIRCUIT_WRITE)
    )
    assert len(_lagegeraete(engine)) == 0
    assert _platzieren(api, login(api, "beides@vp.example"), uv1, diele).status_code == 200


@pytest.mark.parametrize("status", ["completed", "archived"])
def test_abgeschlossene_und_archivierte_projekte_sind_schreibgeschuetzt(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine, status: str
) -> None:
    floor = geschoss["floor"]["id"]
    diele, _ = _zwei_raeume(api, token, floor)
    uv1 = kreise._angelegte_verteilung(api, token, geschoss["building"]["id"])
    projekt = geschoss["project"]
    schritte = (
        ("activate", "complete") if status == "completed" else ("activate", "complete", "archive")
    )
    for schritt in schritte:
        aktuell = api.get(f"/api/v1/projects/{projekt['id']}", headers=auth_headers(token)).json()
        response = api.post(
            f"/api/v1/projects/{projekt['id']}/{schritt}",
            headers={**auth_headers(token), "If-Match": str(aktuell["version"])},
        )
        assert response.status_code == 200, response.text

    response = _platzieren(api, token, uv1, diele)

    assert response.status_code == 409, response.text
    assert response.json()["type"].endswith(f"project-{status}")
    assert len(_lagegeraete(engine)) == 0


# ------------------------------------------- Sperre im Raumentwurf (VP-Nacharbeit)


def test_raumentwurf_legt_kein_lagegeraet_an_und_speichert_dann_nichts(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor = geschoss["floor"]["id"]
    raum = geraete._raum_mit_plan(api, token, floor)
    wand = raum["walls"][0]["id"]

    # Zusammen mit einer zulaessigen Steckdose: alles oder nichts.
    response = geraete._speichern(
        api,
        token,
        raum,
        devices=[
            geraete._wandgeraet(wand, 3_500, 300),
            geraete._wandgeraet(wand, 1_000, 1_400, typ="distribution_board"),
        ],
    )

    assert response.status_code == 422, response.text
    assert fehlercodes(response) == {"distribution-board-via-placement"}
    nachher = geraete._plan_raum(api, token, floor, raum["id"])
    assert nachher["version"] == raum["version"]
    assert nachher["devices"] == []
    assert _lagegeraete(engine) == []


def test_raumentwurf_typisiert_kein_geraet_zur_verteilung_um(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor = geschoss["floor"]["id"]
    raum = geraete._raum_mit_plan(api, token, floor)
    wand = raum["walls"][0]["id"]
    gesetzt = geraete._speichern(
        api, token, raum, devices=[geraete._wandgeraet(wand, 1_000, 1_400)]
    )
    assert gesetzt.status_code == 200, gesetzt.text
    raum = geraete._plan_raum(api, token, floor, raum["id"])
    umtypisiert = [{**g, "device_type_key": "distribution_board"} for g in geraete._geraete(raum)]

    response = geraete._speichern(api, token, raum, devices=umtypisiert)

    assert response.status_code == 422, response.text
    assert fehlercodes(response) == {"distribution-board-via-placement"}
    nachher = geraete._plan_raum(api, token, floor, raum["id"])
    assert nachher["version"] == raum["version"]
    assert [g["device_type_key"] for g in nachher["devices"]] == ["socket_single"]
    assert _lagegeraete(engine) == []


def test_vorhandene_lagegeraete_bleiben_beim_unveraenderten_speichern(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor = geschoss["floor"]["id"]
    haus = geschoss["building"]["id"]
    diele, _ = _zwei_raeume(api, token, floor)
    wand = diele["walls"][0]["id"]
    # VP legt genau ein Lagegeraet samt Verknuepfung an.
    uv1 = kreise._platziert(
        api, token, kreise._angelegte_verteilung(api, token, haus), diele, wand, 1_000, 1_400
    )
    assert [str(g.id) for g in _lagegeraete(engine)] == [uv1["placement_device_id"]]
    # Altbestand: unverknuepftes Geraet „Verteilung“ an derselben Wand.
    alt = kreise._altes_lagegeraet(api, token, diele, wand, 3_500, 1_400)
    diele = geraete._plan_raum(api, token, floor, diele["id"])

    # Unveraendert speichern und eine Steckdose ergaenzen: beides zulaessig.
    response = geraete._speichern(
        api, token, diele, devices=[*geraete._geraete(diele), geraete._wandgeraet(wand, 2_300, 300)]
    )

    assert response.status_code == 200, response.text
    gespeichert = {str(g.id) for g in _lagegeraete(engine)}
    assert gespeichert == {uv1["placement_device_id"], alt}
    assert _verknuepfungen(engine) == [uuid.UUID(uv1["placement_device_id"])]
