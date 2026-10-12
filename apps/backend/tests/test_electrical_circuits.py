"""Verteilungen, Stromkreise und Geraetezuordnung ueber die API (Phase 6b.0, ADR 0026).

Schwerpunkte: mehrere Verteilungen je Gebaeude, Lage nur ueber ein Geraet
``distribution_board`` desselben Gebaeudes, Stromkreis-Vorschlaege als
Dezimalstrings, Zuordnung (nur zuordenbare Geraete, nie gebaeudeuebergreifend,
nie still umgehaengt), Schutz der Lage und Zuordnung im Raumentwurf,
``If-Match``, Rechte, Schreibschutz und Loeschwege.

Jeder abgelehnte Fall prueft zusaetzlich, dass nichts gespeichert wurde.
Synthetische Daten. Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import sessionmaker

from app.modules.electrical.catalog import ASSIGNABLE_CATEGORIES, DEVICE_CATEGORIES
from app.modules.electrical.models import (
    ElectricalCircuit,
    ElectricalCircuitDevice,
    ElectricalDistributionBoard,
)
from app.modules.electrical.permissions import PLAN_READ, PLAN_WRITE
from app.modules.electrical.schemas import DeviceCategoryValue
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
raumversion = raeume.raumversion

_rechteck = geraete._rechteck
_raum = geraete._raum
_plan_raum = geraete._plan_raum
_waende = geraete._waende
_geraete = geraete._geraete
_wandgeraet = geraete._wandgeraet
_deckengeraet = geraete._deckengeraet
_speichern = geraete._speichern


# ------------------------------------------------------------------ Helfer


def _raum_mit_geraeten(api: TestClient, token: str, floor_id: str, *, x: int = 0) -> dict[str, Any]:
    """Raum 5 x 4 m mit Verteilung, Steckdose, Datendose, Schalter und Deckenleuchte."""
    raum = _raum(api, token, floor_id, _rechteck(5_000, 4_000, x=x), name=f"Raum {x}")
    plan = _plan_raum(api, token, floor_id, raum["id"])
    wand = plan["walls"][0]["id"]
    neu = [
        _wandgeraet(wand, 1_000, 1_400, typ="distribution_board"),
        _wandgeraet(wand, 2_500, 300, typ="socket_single"),
        _wandgeraet(wand, 3_500, 300, typ="data_single"),
        _wandgeraet(wand, 4_500, 1_050, typ="switch_single"),
        _deckengeraet(x + 2_500, 2_000),
    ]
    response = _speichern(api, token, plan, devices=neu)
    assert response.status_code == 200, response.text
    gespeichert = _plan_raum(api, token, floor_id, raum["id"])
    nach_typ = {g["device_type_key"]: g for g in gespeichert["devices"]}
    return {"room": gespeichert, "devices": nach_typ}


def _zweites_gebaeude(api: TestClient, token: str, project_id: str) -> dict[str, Any]:
    haus = api.post(
        f"/api/v1/projects/{project_id}/buildings",
        headers=auth_headers(token),
        json={"name": "Garage"},
    )
    assert haus.status_code == 201, haus.text
    stockwerk = api.post(
        f"/api/v1/buildings/{haus.json()['id']}/floors",
        headers=auth_headers(token),
        json={"name": "EG Garage", "level": 0},
    )
    assert stockwerk.status_code == 201, stockwerk.text
    return {"building": haus.json(), "floor": stockwerk.json()}


def _verteilung(
    api: TestClient, token: str, building_id: str, code: str = "UV1", **extra: object
) -> Any:
    return api.post(
        f"{BASIS}/buildings/{building_id}/distribution-boards",
        headers=auth_headers(token),
        json={"code": code, "name": f"Verteilung {code}", **extra},
    )


def _angelegte_verteilung(
    api: TestClient, token: str, building_id: str, code: str = "UV1", **extra: object
) -> dict[str, Any]:
    response = _verteilung(api, token, building_id, code, **extra)
    assert response.status_code == 201, response.text
    return dict(response.json())


def _stromkreis(
    api: TestClient, token: str, board_id: str, designation: str = "F1", **extra: object
) -> Any:
    return api.post(
        f"{BASIS}/distribution-boards/{board_id}/circuits",
        headers=auth_headers(token),
        json={"designation": designation, "name": f"Stromkreis {designation}", **extra},
    )


def _angelegter_stromkreis(
    api: TestClient, token: str, board_id: str, designation: str = "F1", **extra: object
) -> dict[str, Any]:
    response = _stromkreis(api, token, board_id, designation, **extra)
    assert response.status_code == 201, response.text
    return dict(response.json())


def _zuordnen(
    api: TestClient,
    token: str,
    circuit: dict[str, Any],
    device_ids: list[str],
    *,
    version: int | None = None,
) -> Any:
    return api.put(
        f"{BASIS}/circuits/{circuit['id']}/devices",
        headers={
            **auth_headers(token),
            "If-Match": str(version if version is not None else circuit["version"]),
        },
        json={"device_ids": device_ids},
    )


def _stromkreise(api: TestClient, token: str, building_id: str) -> list[dict[str, Any]]:
    response = api.get(f"{BASIS}/buildings/{building_id}/circuits", headers=auth_headers(token))
    assert response.status_code == 200, response.text
    return list(response.json()["circuits"])


def _verteilungen(api: TestClient, token: str, building_id: str) -> list[dict[str, Any]]:
    response = api.get(
        f"{BASIS}/buildings/{building_id}/distribution-boards", headers=auth_headers(token)
    )
    assert response.status_code == 200, response.text
    return list(response.json()["boards"])


def _db(engine: Engine) -> tuple[int, int, int]:
    session = sessionmaker(bind=engine)()
    try:
        return (
            len(list(session.execute(select(ElectricalDistributionBoard)).scalars())),
            len(list(session.execute(select(ElectricalCircuit)).scalars())),
            len(list(session.execute(select(ElectricalCircuitDevice)).scalars())),
        )
    finally:
        session.close()


# --------------------------------------------------------------- Katalog


def test_kategorien_und_zuordenbarkeit_sind_konsistent() -> None:
    assert tuple(DeviceCategoryValue.__args__) == DEVICE_CATEGORIES  # type: ignore[attr-defined]
    assert {"socket", "switch", "light", "junction"} == ASSIGNABLE_CATEGORIES


def test_katalog_enthaelt_verteilung_und_abzweigdose(api: TestClient, token: str) -> None:
    typen = {
        t["key"]: t for t in api.get(f"{BASIS}/device-types", headers=auth_headers(token)).json()
    }
    assert typen["distribution_board"]["category"] == "distribution"
    assert typen["distribution_board"]["allows_wall_interior"]
    assert not typen["distribution_board"]["allows_ceiling"]
    assert typen["junction_box"]["category"] == "junction"
    assert typen["junction_box"]["allows_wall_interior"] and typen["junction_box"]["allows_ceiling"]


# ------------------------------------------------------------- Verteilung


def test_mehrere_verteilungen_je_gebaeude_code_eindeutig(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    haus = geschoss["building"]["id"]
    uv1 = _angelegte_verteilung(api, token, haus, "UV1", note="  Flur  ")
    _angelegte_verteilung(api, token, haus, "HV")
    assert uv1["note"] == "Flur" and uv1["placement_device_id"] is None
    assert [b["code"] for b in _verteilungen(api, token, haus)] == ["HV", "UV1"]

    doppelt = _verteilung(api, token, haus, "UV1")
    assert doppelt.status_code == 422
    assert fehlercodes(doppelt) == {"board-code-taken"}
    # Im anderen Gebaeude ist der Code frei.
    garage = _zweites_gebaeude(api, token, geschoss["project"]["id"])
    assert _verteilung(api, token, garage["building"]["id"], "UV1").status_code == 201
    assert _db(engine)[0] == 3

    for koerper in ({"code": " ", "name": "X"}, {"code": "x" * 17, "name": "X"}, {"code": "A"}):
        response = api.post(
            f"{BASIS}/buildings/{haus}/distribution-boards",
            headers=auth_headers(token),
            json=koerper,
        )
        assert response.status_code == 422, koerper


def test_lage_nur_ueber_verteilungsgeraet_desselben_gebaeudes(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    haus = geschoss["building"]["id"]
    eg = _raum_mit_geraeten(api, token, geschoss["floor"]["id"])
    garage = _zweites_gebaeude(api, token, geschoss["project"]["id"])
    fremd = _raum_mit_geraeten(api, token, garage["floor"]["id"])
    uv_geraet = eg["devices"]["distribution_board"]["id"]

    falscher_typ = _verteilung(
        api, token, haus, placement_device_id=eg["devices"]["socket_single"]["id"]
    )
    anderes_haus = _verteilung(
        api, token, haus, placement_device_id=fremd["devices"]["distribution_board"]["id"]
    )
    unbekannt = _verteilung(api, token, haus, placement_device_id=str(uuid.uuid4()))
    assert fehlercodes(falscher_typ) == {"board-placement-wrong-type"}
    assert fehlercodes(anderes_haus) == {"board-placement-not-in-building"}
    assert fehlercodes(unbekannt) == {"board-placement-not-in-building"}
    assert _db(engine)[0] == 0

    uv1 = _angelegte_verteilung(api, token, haus, "UV1", placement_device_id=uv_geraet)
    zweite = _verteilung(api, token, haus, "UV2", placement_device_id=uv_geraet)
    assert zweite.status_code == 409
    assert fehlercodes(zweite) == {"board-placement-taken"}

    # Lage loesen (null) und wieder setzen.
    geloest = api.patch(
        f"{BASIS}/distribution-boards/{uv1['id']}",
        headers={**auth_headers(token), "If-Match": str(uv1["version"])},
        json={"placement_device_id": None},
    )
    assert geloest.status_code == 200, geloest.text
    assert geloest.json()["placement_device_id"] is None
    assert geloest.json()["version"] == uv1["version"] + 1


def test_lagegeraet_ist_im_raumentwurf_geschuetzt(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor_id = geschoss["floor"]["id"]
    eg = _raum_mit_geraeten(api, token, floor_id)
    raum = eg["room"]
    uv_geraet = eg["devices"]["distribution_board"]
    uv1 = _angelegte_verteilung(
        api, token, geschoss["building"]["id"], placement_device_id=uv_geraet["id"]
    )
    version_vorher = raumversion(api, token, raum["id"])

    ohne = [g for g in _geraete(raum) if g["id"] != uv_geraet["id"]]
    entfernen = _speichern(api, token, raum, devices=ohne, removed_devices=[uv_geraet["id"]])
    assert entfernen.status_code == 409, entfernen.text
    assert fehlercodes(entfernen) == {"device-is-distribution-board"}

    anderer_typ = [
        {**g, "device_type_key": "socket_single"} if g["id"] == uv_geraet["id"] else g
        for g in _geraete(raum)
    ]
    umtypen = _speichern(api, token, raum, devices=anderer_typ)
    assert umtypen.status_code == 422, umtypen.text
    assert "distribution-board-type-changed" in fehlercodes(umtypen)

    loeschen = api.delete(
        f"{BASIS}/rooms/{raum['id']}",
        headers={**auth_headers(token), "If-Match": version_vorher},
    )
    assert loeschen.status_code == 409, loeschen.text
    assert fehlercodes(loeschen) == {"room-has-distribution-board"}
    assert raumversion(api, token, raum["id"]) == version_vorher

    # Lage loesen, dann ist der Raum loeschbar - die Verteilung bleibt ohne Lage.
    assert (
        api.patch(
            f"{BASIS}/distribution-boards/{uv1['id']}",
            headers={**auth_headers(token), "If-Match": str(uv1["version"])},
            json={"placement_device_id": None},
        ).status_code
        == 200
    )
    assert (
        api.delete(
            f"{BASIS}/rooms/{raum['id']}",
            headers={**auth_headers(token), "If-Match": version_vorher},
        ).status_code
        == 204
    )
    assert _db(engine)[0] == 1


def test_gebaeude_mit_verteilung_laesst_sich_nicht_loeschen(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    garage = _zweites_gebaeude(api, token, geschoss["project"]["id"])
    _angelegte_verteilung(api, token, garage["building"]["id"])
    loeschen = api.delete(
        f"/api/v1/buildings/{garage['building']['id']}",
        headers={**auth_headers(token), "If-Match": str(garage["building"]["version"])},
    )
    assert loeschen.status_code == 409, loeschen.text


# ------------------------------------------------------------- Stromkreis


def test_stromkreis_mit_vorschlaegen_als_dezimalstring(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    uv1 = _angelegte_verteilung(api, token, geschoss["building"]["id"])
    f1 = _angelegter_stromkreis(
        api,
        token,
        uv1["id"],
        "F1",
        proposed_cable_type=" NYM-J ",
        proposed_conductor_count=3,
        proposed_cross_section_mm2="1.5",
        protective_device="B16",
        rcd_group="RCD 1",
        phase_count=1,
    )
    assert f1["proposed_cable_type"] == "NYM-J"
    assert f1["proposed_cross_section_mm2"] == "1.50"
    assert (f1["device_ids"], f1["sort_order"], f1["version"]) == ([], 0, 1)

    for falsch in ("1,5", "0", "0.00", "1.505", "-1", "12345"):
        response = _stromkreis(api, token, uv1["id"], "F9", proposed_cross_section_mm2=falsch)
        assert response.status_code == 422, falsch
    assert _stromkreis(api, token, uv1["id"], "F9", phase_count=4).status_code == 422
    assert _stromkreis(api, token, uv1["id"], "F9", proposed_conductor_count=0).status_code == 422
    doppelt = _stromkreis(api, token, uv1["id"], "F1")
    assert doppelt.status_code == 422
    assert fehlercodes(doppelt) == {"circuit-designation-taken"}
    assert _db(engine)[1] == 1

    geaendert = api.patch(
        f"{BASIS}/circuits/{f1['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"proposed_cross_section_mm2": "2.5", "protective_device": None},
    )
    assert geaendert.status_code == 200, geaendert.text
    body = geaendert.json()
    assert (body["proposed_cross_section_mm2"], body["protective_device"], body["version"]) == (
        "2.50",
        None,
        2,
    )
    # Unveraendert: keine neue Version.
    gleich = api.patch(
        f"{BASIS}/circuits/{f1['id']}",
        headers={**auth_headers(token), "If-Match": "2"},
        json={"proposed_cross_section_mm2": "2.50", "name": body["name"]},
    )
    assert gleich.status_code == 200 and gleich.json()["version"] == 2
    leer = api.patch(
        f"{BASIS}/circuits/{f1['id']}",
        headers={**auth_headers(token), "If-Match": "2"},
        json={"designation": None},
    )
    assert leer.status_code == 422


def test_verteilung_mit_stromkreisen_laesst_sich_nicht_loeschen(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    eg = _raum_mit_geraeten(api, token, geschoss["floor"]["id"])
    uv1 = _angelegte_verteilung(api, token, geschoss["building"]["id"])
    f1 = _angelegter_stromkreis(api, token, uv1["id"])
    assert _zuordnen(api, token, f1, [eg["devices"]["socket_single"]["id"]]).status_code == 200

    verteilung_weg = api.delete(
        f"{BASIS}/distribution-boards/{uv1['id']}",
        headers={**auth_headers(token), "If-Match": str(uv1["version"])},
    )
    assert verteilung_weg.status_code == 409
    assert fehlercodes(verteilung_weg) == {"board-has-circuits"}

    stromkreis_weg = api.delete(
        f"{BASIS}/circuits/{f1['id']}", headers={**auth_headers(token), "If-Match": "2"}
    )
    assert stromkreis_weg.status_code == 204
    assert _db(engine) == (1, 0, 0)
    # Das Geraet bleibt.
    assert eg["devices"]["socket_single"]["id"] in {
        g["id"]
        for g in _plan_raum(api, token, geschoss["floor"]["id"], eg["room"]["id"])["devices"]
    }
    assert (
        api.delete(
            f"{BASIS}/distribution-boards/{uv1['id']}",
            headers={**auth_headers(token), "If-Match": str(uv1["version"])},
        ).status_code
        == 204
    )


# ------------------------------------------------------------- Zuordnung


def test_zuordnung_nur_zuordenbarer_geraete_desselben_gebaeudes(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    eg = _raum_mit_geraeten(api, token, geschoss["floor"]["id"])
    garage = _zweites_gebaeude(api, token, geschoss["project"]["id"])
    fremd = _raum_mit_geraeten(api, token, garage["floor"]["id"])
    uv1 = _angelegte_verteilung(api, token, geschoss["building"]["id"])
    f1 = _angelegter_stromkreis(api, token, uv1["id"])
    g = eg["devices"]

    gut = [g["socket_single"]["id"], g["switch_single"]["id"], g["light_ceiling"]["id"]]
    response = _zuordnen(api, token, f1, gut)
    assert response.status_code == 200, response.text
    assert response.json()["device_ids"] == sorted(gut)
    assert response.json()["version"] == 2

    faelle = {
        "circuit-device-not-assignable": [g["data_single"]["id"]],
        "circuit-device-not-in-building": [fremd["devices"]["socket_single"]["id"]],
        "circuit-device-duplicate": [g["socket_single"]["id"], g["socket_single"]["id"]],
    }
    for code, ids in faelle.items():
        abgelehnt = _zuordnen(api, token, f1, ids, version=2)
        assert abgelehnt.status_code == 422, (code, abgelehnt.text)
        assert fehlercodes(abgelehnt) == {code}
    verteilung_selbst = _zuordnen(api, token, f1, [g["distribution_board"]["id"]], version=2)
    assert fehlercodes(verteilung_selbst) == {"circuit-device-not-assignable"}
    unbekannt = _zuordnen(api, token, f1, [str(uuid.uuid4())], version=2)
    assert fehlercodes(unbekannt) == {"circuit-device-not-in-building"}
    assert [c["device_ids"] for c in _stromkreise(api, token, geschoss["building"]["id"])] == [
        sorted(gut)
    ]

    # Unveraenderte Liste: keine neue Version. Verkleinern entfernt nur die Zuordnung.
    gleich = _zuordnen(api, token, f1, list(reversed(gut)), version=2)
    assert gleich.json()["version"] == 2
    kleiner = _zuordnen(api, token, f1, [g["socket_single"]["id"]], version=2)
    assert kleiner.status_code == 200
    assert (kleiner.json()["device_ids"], kleiner.json()["version"]) == (
        [g["socket_single"]["id"]],
        3,
    )
    assert _db(engine)[2] == 1


def test_geraet_wird_nie_still_umgehaengt(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    eg = _raum_mit_geraeten(api, token, geschoss["floor"]["id"])
    uv1 = _angelegte_verteilung(api, token, geschoss["building"]["id"])
    hv = _angelegte_verteilung(api, token, geschoss["building"]["id"], "HV")
    f1 = _angelegter_stromkreis(api, token, uv1["id"], "F1")
    f2 = _angelegter_stromkreis(api, token, hv["id"], "F1")
    steckdose = eg["devices"]["socket_single"]["id"]
    assert _zuordnen(api, token, f1, [steckdose]).status_code == 200

    umhaengen = _zuordnen(api, token, f2, [steckdose])
    assert umhaengen.status_code == 409
    assert fehlercodes(umhaengen) == {"device-assigned-elsewhere"}
    nach = {c["id"]: c["device_ids"] for c in _stromkreise(api, token, geschoss["building"]["id"])}
    assert (nach[f1["id"]], nach[f2["id"]]) == ([steckdose], [])


def test_zuordnung_im_raumentwurf(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    """Zugeordnetes Geraet: kein Wechsel in nicht zuordenbare Art; Entfernen nimmt Zuordnung mit."""
    floor_id = geschoss["floor"]["id"]
    eg = _raum_mit_geraeten(api, token, floor_id)
    raum = eg["room"]
    uv1 = _angelegte_verteilung(api, token, geschoss["building"]["id"])
    f1 = _angelegter_stromkreis(api, token, uv1["id"])
    steckdose = eg["devices"]["socket_single"]["id"]
    assert _zuordnen(api, token, f1, [steckdose]).status_code == 200

    zu_daten = [
        {**g, "device_type_key": "data_single"} if g["id"] == steckdose else g
        for g in _geraete(raum)
    ]
    abgelehnt = _speichern(api, token, raum, devices=zu_daten)
    assert abgelehnt.status_code == 422, abgelehnt.text
    assert "assigned-device-not-assignable" in fehlercodes(abgelehnt)
    # Zweifachsteckdose bleibt zuordenbar.
    zu_doppel = [
        {**g, "device_type_key": "socket_double"} if g["id"] == steckdose else g
        for g in _geraete(raum)
    ]
    assert _speichern(api, token, raum, devices=zu_doppel).status_code == 200

    raum = _plan_raum(api, token, floor_id, raum["id"])
    ohne = [g for g in _geraete(raum) if g["id"] != steckdose]
    assert (
        _speichern(api, token, raum, devices=ohne, removed_devices=[steckdose]).status_code == 200
    )
    assert _stromkreise(api, token, geschoss["building"]["id"])[0]["device_ids"] == []
    assert _db(engine)[2] == 0


# ---------------------------------------------- If-Match, Rechte, Status


def test_if_match(api: TestClient, token: str, geschoss: dict[str, Any]) -> None:
    uv1 = _angelegte_verteilung(api, token, geschoss["building"]["id"])
    f1 = _angelegter_stromkreis(api, token, uv1["id"])
    ohne = [
        api.patch(
            f"{BASIS}/distribution-boards/{uv1['id']}",
            headers=auth_headers(token),
            json={"name": "X"},
        ),
        api.patch(f"{BASIS}/circuits/{f1['id']}", headers=auth_headers(token), json={"name": "X"}),
        api.put(
            f"{BASIS}/circuits/{f1['id']}/devices",
            headers=auth_headers(token),
            json={"device_ids": []},
        ),
        api.delete(f"{BASIS}/circuits/{f1['id']}", headers=auth_headers(token)),
    ]
    assert [r.status_code for r in ohne] == [428, 428, 428, 428]
    veraltet = [
        api.patch(
            f"{BASIS}/distribution-boards/{uv1['id']}",
            headers={**auth_headers(token), "If-Match": "7"},
            json={"name": "X"},
        ),
        api.patch(
            f"{BASIS}/circuits/{f1['id']}",
            headers={**auth_headers(token), "If-Match": "7"},
            json={"name": "X"},
        ),
        _zuordnen(api, token, f1, [], version=7),
        api.delete(
            f"{BASIS}/circuits/{f1['id']}", headers={**auth_headers(token), "If-Match": "7"}
        ),
    ]
    for response in veraltet:
        assert response.status_code == 409
        assert response.json()["type"].endswith("version-conflict")


def test_rechte(
    api: TestClient, token: str, betrieb: uuid.UUID, engine: Engine, geschoss: dict[str, Any]
) -> None:
    eg = _raum_mit_geraeten(api, token, geschoss["floor"]["id"])
    haus = geschoss["building"]["id"]
    uv1 = _angelegte_verteilung(api, token, haus)
    f1 = _angelegter_stromkreis(api, token, uv1["id"])
    raeume._mitglied_mit_permissions(engine, betrieb, "leser@kreis.example", (PLAN_READ,))
    raeume._mitglied_mit_permissions(
        engine, betrieb, "raumplaner@kreis.example", (PLAN_READ, PLAN_WRITE)
    )
    for email in ("leser@kreis.example", "raumplaner@kreis.example"):
        wer = login(api, email)
        assert len(_verteilungen(api, wer, haus)) == 1
        assert len(_stromkreise(api, wer, haus)) == 1
        antworten = [
            _verteilung(api, wer, haus, "UV2"),
            api.patch(
                f"{BASIS}/distribution-boards/{uv1['id']}",
                headers={**auth_headers(wer), "If-Match": "1"},
                json={"name": "X"},
            ),
            api.delete(
                f"{BASIS}/distribution-boards/{uv1['id']}",
                headers={**auth_headers(wer), "If-Match": "1"},
            ),
            _stromkreis(api, wer, uv1["id"], "F2"),
            api.patch(
                f"{BASIS}/circuits/{f1['id']}",
                headers={**auth_headers(wer), "If-Match": "1"},
                json={"name": "X"},
            ),
            _zuordnen(api, wer, f1, [eg["devices"]["socket_single"]["id"]]),
            api.delete(
                f"{BASIS}/circuits/{f1['id']}", headers={**auth_headers(wer), "If-Match": "1"}
            ),
        ]
        assert [r.status_code for r in antworten] == [403] * 7, email
    assert _db(engine) == (1, 1, 0)


@pytest.mark.parametrize("status", ["completed", "archived"])
def test_abgeschlossene_und_archivierte_projekte_sind_schreibgeschuetzt(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine, status: str
) -> None:
    eg = _raum_mit_geraeten(api, token, geschoss["floor"]["id"])
    haus = geschoss["building"]["id"]
    uv1 = _angelegte_verteilung(api, token, haus)
    f1 = _angelegter_stromkreis(api, token, uv1["id"])
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

    antworten = [
        _verteilung(api, token, haus, "UV2"),
        api.patch(
            f"{BASIS}/distribution-boards/{uv1['id']}",
            headers={**auth_headers(token), "If-Match": "1"},
            json={"name": "X"},
        ),
        api.delete(
            f"{BASIS}/distribution-boards/{uv1['id']}",
            headers={**auth_headers(token), "If-Match": "1"},
        ),
        _stromkreis(api, token, uv1["id"], "F2"),
        api.patch(
            f"{BASIS}/circuits/{f1['id']}",
            headers={**auth_headers(token), "If-Match": "1"},
            json={"name": "X"},
        ),
        _zuordnen(api, token, f1, [eg["devices"]["socket_single"]["id"]]),
        api.delete(
            f"{BASIS}/circuits/{f1['id']}", headers={**auth_headers(token), "If-Match": "1"}
        ),
    ]
    for response in antworten:
        assert response.status_code == 409, response.text
        assert response.json()["type"].endswith(f"project-{status}")
    assert _db(engine) == (1, 1, 0)
    assert len(_stromkreise(api, token, haus)) == 1


def test_projektloeschung_entfernt_verteilungen_und_stromkreise(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    eg = _raum_mit_geraeten(api, token, geschoss["floor"]["id"])
    haus = geschoss["building"]["id"]
    uv1 = _angelegte_verteilung(
        api, token, haus, placement_device_id=eg["devices"]["distribution_board"]["id"]
    )
    _angelegte_verteilung(api, token, haus, "HV")
    f1 = _angelegter_stromkreis(api, token, uv1["id"])
    _angelegter_stromkreis(api, token, uv1["id"], "F2")
    assert _zuordnen(api, token, f1, [eg["devices"]["socket_single"]["id"]]).status_code == 200

    projekt = geschoss["project"]
    pruefung = api.get(
        f"/api/v1/projects/{projekt['id']}/deletion-check", headers=auth_headers(token)
    )
    assert pruefung.status_code == 200, pruefung.text
    inhalte = {item["code"]: item["count"] for item in pruefung.json()["contents"]}
    assert (
        inhalte["electrical.distribution_boards"],
        inhalte["electrical.circuits"],
        inhalte["electrical.circuit_devices"],
    ) == (2, 2, 1)

    aktuell = api.get(f"/api/v1/projects/{projekt['id']}", headers=auth_headers(token)).json()
    geloescht = api.delete(
        f"/api/v1/projects/{projekt['id']}",
        headers={**auth_headers(token), "If-Match": str(aktuell["version"])},
        params={"confirm_project_number": aktuell["project_number"]},
    )
    assert geloescht.status_code == 204, geloescht.text
    assert _db(engine) == (0, 0, 0)


# ------------------------------------------------- Abzweigdosen (6b.1, Korrektur)


def _abzweigdose(api: TestClient, token: str, floor_id: str, eg: dict[str, Any]) -> dict[str, Any]:
    """Abzweigdose an der Wand des Raums; liefert den aktualisierten Raum."""
    raum = eg["room"]
    wand = raum["walls"][1]["id"]
    neu = [*_geraete(raum), _wandgeraet(wand, 2_000, 2_200, typ="junction_box")]
    response = _speichern(api, token, raum, devices=neu)
    assert response.status_code == 200, response.text
    return _plan_raum(api, token, floor_id, raum["id"])


def test_abzweigdose_ist_zuordenbar_wie_ein_verbraucher(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor_id = geschoss["floor"]["id"]
    eg = _raum_mit_geraeten(api, token, floor_id)
    raum = _abzweigdose(api, token, floor_id, eg)
    dose = next(g for g in raum["devices"] if g["device_type_key"] == "junction_box")
    uv1 = _angelegte_verteilung(api, token, geschoss["building"]["id"])
    hv = _angelegte_verteilung(api, token, geschoss["building"]["id"], "HV")
    f1 = _angelegter_stromkreis(api, token, uv1["id"])
    f2 = _angelegter_stromkreis(api, token, hv["id"])

    zugeordnet = _zuordnen(api, token, f1, [dose["id"], eg["devices"]["socket_single"]["id"]])
    assert zugeordnet.status_code == 200, zugeordnet.text
    assert dose["id"] in zugeordnet.json()["device_ids"]

    # Hoechstens ein Stromkreis, nie still umgehaengt.
    umhaengen = _zuordnen(api, token, f2, [dose["id"]])
    assert umhaengen.status_code == 409
    assert fehlercodes(umhaengen) == {"device-assigned-elsewhere"}

    # Gebaeudegrenze gilt auch fuer Abzweigdosen.
    garage = _zweites_gebaeude(api, token, geschoss["project"]["id"])
    fremd = _raum_mit_geraeten(api, token, garage["floor"]["id"])
    fremde_dose = _abzweigdose(api, token, garage["floor"]["id"], fremd)
    fremde_id = next(
        g["id"] for g in fremde_dose["devices"] if g["device_type_key"] == "junction_box"
    )
    anderes_haus = _zuordnen(api, token, f2, [fremde_id])
    assert fehlercodes(anderes_haus) == {"circuit-device-not-in-building"}
    assert _db(engine)[2] == 2


def test_zugeordnete_abzweigdose_nur_in_zulaessige_arten(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor_id = geschoss["floor"]["id"]
    eg = _raum_mit_geraeten(api, token, floor_id)
    raum = _abzweigdose(api, token, floor_id, eg)
    dose = next(g for g in raum["devices"] if g["device_type_key"] == "junction_box")
    uv1 = _angelegte_verteilung(api, token, geschoss["building"]["id"])
    f1 = _angelegter_stromkreis(api, token, uv1["id"])
    assert _zuordnen(api, token, f1, [dose["id"]]).status_code == 200

    def umtypen(typ: str) -> Any:
        aktuell = _plan_raum(api, token, floor_id, raum["id"])
        geraete_neu = [
            {**g, "device_type_key": typ} if g["id"] == dose["id"] else g for g in _geraete(aktuell)
        ]
        return _speichern(api, token, aktuell, devices=geraete_neu)

    for unzulaessig in ("data_single", "distribution_board"):
        abgelehnt = umtypen(unzulaessig)
        assert abgelehnt.status_code == 422, (unzulaessig, abgelehnt.text)
        assert "assigned-device-not-assignable" in fehlercodes(abgelehnt)
    # Zwischen zuordenbaren Arten ist ein Wechsel zulaessig, die Zuordnung bleibt.
    assert umtypen("socket_single").status_code == 200
    assert umtypen("junction_box").status_code == 200
    assert _stromkreise(api, token, geschoss["building"]["id"])[0]["device_ids"] == [dose["id"]]


def test_lagegeraet_einer_verteilung_bleibt_unzuordenbar(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    eg = _raum_mit_geraeten(api, token, geschoss["floor"]["id"])
    uv_geraet = eg["devices"]["distribution_board"]["id"]
    uv1 = _angelegte_verteilung(
        api, token, geschoss["building"]["id"], placement_device_id=uv_geraet
    )
    f1 = _angelegter_stromkreis(api, token, uv1["id"])
    response = _zuordnen(api, token, f1, [uv_geraet])
    assert response.status_code == 422
    assert fehlercodes(response) == {"circuit-device-not-assignable"}
