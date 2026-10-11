"""Wandkopplungen ueber die API (Phase 6a.1, ADR 0024).

Schwerpunkte: die drei Zustaende (unentschieden, ``shared``, ``separate``) und
ihre Wirkung auf die Geraetepruefung, Geometrieaenderungen (Verschieben,
Teilen, Konturumkehr, Entfernen), Lebenszyklus (Raum- und Projektloeschung),
veraltete Entwuerfe, ``If-Match``, Rechte und Schreibschutz.

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

from app.core.events.models import DomainEventRecord
from app.modules.electrical.events import PLAN_UPDATED
from app.modules.electrical.models import ElectricalWallLink
from app.modules.electrical.permissions import PLAN_READ
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


# ------------------------------------------------------------------ Helfer


def _plan(api: TestClient, token: str, floor_id: str) -> dict[str, Any]:
    response = api.get(f"{BASIS}/floors/{floor_id}/plan", headers=auth_headers(token))
    assert response.status_code == 200, response.text
    return dict(response.json())


def _paar(api: TestClient, token: str, floor_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """Beispiel 3.1: A (0,0)-(4000,3000), B (4000,0)-(7000,3000).

    ``A.walls[1]`` (4000,0)->(4000,3000) und ``B.walls[3]`` (4000,3000)->(4000,0)
    liegen gegenlaeufig deckungsgleich.
    """
    a = _raum(api, token, floor_id, _rechteck(4_000, 3_000), name="A")
    b = _raum(api, token, floor_id, _rechteck(3_000, 3_000, x=4_000), name="B")
    return _plan_raum(api, token, floor_id, a["id"]), _plan_raum(api, token, floor_id, b["id"])


def _kontur(
    api: TestClient,
    token: str,
    raum: dict[str, Any],
    *,
    walls: list[dict[str, Any]] | None = None,
    devices: list[dict[str, Any]] | None = None,
    removed_links: list[str] | None = None,
    version: str | None = None,
) -> Any:
    body: dict[str, Any] = {
        "walls": walls if walls is not None else _waende(raum),
        "devices": devices if devices is not None else _geraete(raum),
    }
    if removed_links is not None:
        body["removed_wall_link_ids"] = removed_links
    return api.put(
        f"{BASIS}/rooms/{raum['id']}/contour",
        headers={
            **auth_headers(token),
            "If-Match": version if version is not None else raumversion(api, token, raum["id"]),
        },
        json=body,
    )


def _tuer_in_a(api: TestClient, token: str, floor_id: str, a: dict[str, Any]) -> dict[str, Any]:
    """Tuer an ``A.walls[1]`` bei 1000..2010 - auf ``B.walls[3]`` bei 990..2000."""
    walls = _waende(a)
    walls[1]["openings"] = [
        {"kind": "door", "offset_mm": 1_000, "width_mm": 1_010, "height_mm": 2_010}
    ]
    response = _kontur(api, token, a, walls=walls)
    assert response.status_code == 200, response.text
    return _plan_raum(api, token, floor_id, a["id"])


def _koppeln(
    api: TestClient, token: str, floor_id: str, wand_a: str, wand_b: str, relation: str
) -> Any:
    return api.post(
        f"{BASIS}/floors/{floor_id}/wall-links",
        headers=auth_headers(token),
        json={"wall_a_id": wand_a, "wall_b_id": wand_b, "relation": relation},
    )


def _gekoppelt(
    api: TestClient, token: str, floor_id: str, wand_a: str, wand_b: str, relation: str
) -> dict[str, Any]:
    response = _koppeln(api, token, floor_id, wand_a, wand_b, relation)
    assert response.status_code == 201, response.text
    return dict(response.json())


def _link_im_plan(api: TestClient, token: str, floor_id: str, link_id: str) -> dict[str, Any]:
    return next(item for item in _plan(api, token, floor_id)["wall_links"] if item["id"] == link_id)


def _links_in_db(engine: Engine) -> list[ElectricalWallLink]:
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        return list(session.execute(select(ElectricalWallLink)).scalars())
    finally:
        session.close()


def _steckdose_in_tuer(b: dict[str, Any]) -> dict[str, Any]:
    """Steckdose innen an ``B.walls[3]`` in Hoehe der Tuer von A."""
    return _wandgeraet(b["walls"][3]["id"], 1_500, 1_000)


# ---------------------------------------------------------- Zustaende 3.1/3.2


def test_unentschieden_verhaelt_sich_wie_phase_5_und_wird_vorgeschlagen(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor_id = geschoss["floor"]["id"]
    a, b = _paar(api, token, floor_id)
    _tuer_in_a(api, token, floor_id, a)

    response = _kontur(api, token, b, devices=[_steckdose_in_tuer(b)])
    assert response.status_code == 422
    assert fehlercodes(response) == {"device-in-opening"}

    plan = _plan(api, token, floor_id)
    assert plan["wall_links"] == []
    assert plan["wall_link_candidates"] == [
        {
            "wall_a_id": min(a["walls"][1]["id"], b["walls"][3]["id"]),
            "wall_b_id": max(a["walls"][1]["id"], b["walls"][3]["id"]),
            "kind": "suggested",
            "reasons": [],
        }
    ]


def test_shared_uebertraegt_die_tuer_und_blockiert_die_steckdose(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor_id = geschoss["floor"]["id"]
    a, b = _paar(api, token, floor_id)
    a = _tuer_in_a(api, token, floor_id, a)
    link = _gekoppelt(api, token, floor_id, b["walls"][3]["id"], a["walls"][1]["id"], "shared")

    # Kanonisch gespeichert, Herkunft und Status nachvollziehbar.
    assert link["wall_a_id"] < link["wall_b_id"]
    assert (link["relation"], link["origin"], link["status"], link["version"]) == (
        "shared",
        "user",
        "active",
        1,
    )
    response = _kontur(api, token, b, devices=[_steckdose_in_tuer(b)])
    assert response.status_code == 422
    assert fehlercodes(response) == {"device-in-opening"}
    # Aussenmontage auf dem gemeinsamen Stueck bleibt verboten.
    aussen = _wandgeraet(
        b["walls"][3]["id"], 2_500, 300, typ="socket_outdoor", flaeche="wall_exterior"
    )
    response = _kontur(api, token, b, devices=[aussen])
    assert response.status_code == 422
    assert fehlercodes(response) == {"device-exterior-on-shared-wall"}
    assert _plan_raum(api, token, floor_id, b["id"])["devices"] == []
    assert len(_links_in_db(engine)) == 1


def test_separate_uebertraegt_nichts_und_ist_keine_fassade(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor_id = geschoss["floor"]["id"]
    a, b = _paar(api, token, floor_id)
    a = _tuer_in_a(api, token, floor_id, a)
    _gekoppelt(api, token, floor_id, a["walls"][1]["id"], b["walls"][3]["id"], "separate")

    # Die Tuer von A gehoert nur zu ihrer Wand: Die Steckdose in B ist zulaessig.
    response = _kontur(api, token, b, devices=[_steckdose_in_tuer(b)])
    assert response.status_code == 200, response.text

    # Die aeussere Seite ist eine Zwischenflaeche - auf beiden Seiten verboten.
    for raum, wand in ((a, 1), (b, 3)):
        aktuell = _plan_raum(api, token, floor_id, raum["id"])
        aussen = _wandgeraet(
            aktuell["walls"][wand]["id"], 2_500, 300, typ="socket_outdoor", flaeche="wall_exterior"
        )
        response = _kontur(api, token, aktuell, devices=[*_geraete(aktuell), aussen])
        assert response.status_code == 422, raum["name"]
        assert fehlercodes(response) == {"device-exterior-on-shared-wall"}

    # Ohne Partner (B.walls[1], x = 7000) bleibt die Aussenmontage wie in Phase 5 zulaessig.
    aktuell = _plan_raum(api, token, floor_id, b["id"])
    aussen = _wandgeraet(
        aktuell["walls"][1]["id"], 1_500, 300, typ="socket_outdoor", flaeche="wall_exterior"
    )
    response = _kontur(api, token, aktuell, devices=[*_geraete(aktuell), aussen])
    assert response.status_code == 200, response.text


def test_wechsel_auf_shared_oder_loesen_mit_geraet_in_der_tuer_wird_abgelehnt(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor_id = geschoss["floor"]["id"]
    a, b = _paar(api, token, floor_id)
    a = _tuer_in_a(api, token, floor_id, a)
    link = _gekoppelt(api, token, floor_id, a["walls"][1]["id"], b["walls"][3]["id"], "separate")
    assert _kontur(api, token, b, devices=[_steckdose_in_tuer(b)]).status_code == 200
    versionen = (raumversion(api, token, a["id"]), raumversion(api, token, b["id"]))

    wechsel = api.patch(
        f"{BASIS}/wall-links/{link['id']}",
        headers={**auth_headers(token), "If-Match": str(link["version"])},
        json={"relation": "shared"},
    )
    assert wechsel.status_code == 422
    assert fehlercodes(wechsel) == {"device-in-opening"}

    loesen = api.delete(
        f"{BASIS}/wall-links/{link['id']}",
        headers={**auth_headers(token), "If-Match": str(link["version"])},
    )
    assert loesen.status_code == 422
    assert fehlercodes(loesen) == {"device-in-opening"}

    # Nichts gespeichert, nichts verschoben, Raumversionen unveraendert.
    gespeichert = _links_in_db(engine)
    assert [(item.relation, item.version) for item in gespeichert] == [("separate", 1)]
    assert len(_plan_raum(api, token, floor_id, b["id"])["devices"]) == 1
    assert (raumversion(api, token, a["id"]), raumversion(api, token, b["id"])) == versionen


def test_aendern_und_loesen_mit_if_match_und_events(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor_id = geschoss["floor"]["id"]
    a, b = _paar(api, token, floor_id)
    link = _gekoppelt(api, token, floor_id, a["walls"][1]["id"], b["walls"][3]["id"], "shared")
    ohne = api.patch(
        f"{BASIS}/wall-links/{link['id']}",
        headers=auth_headers(token),
        json={"relation": "separate"},
    )
    assert ohne.status_code == 428
    falsch = api.patch(
        f"{BASIS}/wall-links/{link['id']}",
        headers={**auth_headers(token), "If-Match": "99"},
        json={"relation": "separate"},
    )
    assert falsch.status_code == 409
    assert falsch.json()["type"].endswith("/version-conflict")

    geaendert = api.patch(
        f"{BASIS}/wall-links/{link['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"relation": "separate"},
    )
    assert geaendert.status_code == 200, geaendert.text
    assert (geaendert.json()["relation"], geaendert.json()["version"]) == ("separate", 2)

    geloest = api.delete(
        f"{BASIS}/wall-links/{link['id']}", headers={**auth_headers(token), "If-Match": "2"}
    )
    assert geloest.status_code == 204
    assert _links_in_db(engine) == []

    session = sessionmaker(bind=engine)()
    try:
        arten = [
            (row.payload["change_kind"], row.payload["room_id"])
            for row in session.execute(
                select(DomainEventRecord)
                .where(DomainEventRecord.event_type == PLAN_UPDATED)
                .order_by(DomainEventRecord.occurred_at)
            ).scalars()
            if row.payload["change_kind"] == "wall_links_changed"
        ]
    finally:
        session.close()
    # Anlegen, Aendern, Loesen - je beteiligtem Raum ein Event.
    assert len(arten) == 6
    assert {room for _, room in arten} == {a["id"], b["id"]}


def test_doppeltes_paar_wird_abgelehnt(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor_id = geschoss["floor"]["id"]
    a, b = _paar(api, token, floor_id)
    _gekoppelt(api, token, floor_id, a["walls"][1]["id"], b["walls"][3]["id"], "shared")
    zweites = _koppeln(api, token, floor_id, b["walls"][3]["id"], a["walls"][1]["id"], "separate")
    assert zweites.status_code == 409
    assert fehlercodes(zweites) == {"wall-link-exists"}
    assert len(_links_in_db(engine)) == 1


# ---------------------------------------------- Geometrische Voraussetzungen


def test_lange_flurwand_drei_partner_und_vierter_raum_ist_mehrdeutig(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor_id = geschoss["floor"]["id"]
    flur = _plan_raum(
        api, token, floor_id, _raum(api, token, floor_id, _rechteck(9_000, 2_000, y=3_000))["id"]
    )
    flurwand = flur["walls"][0]["id"]  # (0,3000)->(9000,3000)
    partner = []
    for index in range(3):
        raum = _raum(
            api, token, floor_id, _rechteck(3_000, 3_000, x=index * 3_000), name=f"R{index}"
        )
        partner.append(_plan_raum(api, token, floor_id, raum["id"]))
    for raum, relation in zip(partner, ("shared", "separate", "shared"), strict=True):
        _gekoppelt(api, token, floor_id, flurwand, raum["walls"][2]["id"], relation)
    assert {item["status"] for item in _plan(api, token, floor_id)["wall_links"]} == {"active"}

    # Ein vierter Raum, dessen Wand auf einem gekoppelten Stueck liegt: dort mehrdeutig.
    vierter = _raum(api, token, floor_id, _rechteck(1_000, 1_000, x=500, y=2_000), name="R3")
    plan = _plan(api, token, floor_id)
    status = {(item["wall_a_id"], item["wall_b_id"]): item["status"] for item in plan["wall_links"]}
    erste = tuple(sorted((flurwand, partner[0]["walls"][2]["id"])))
    assert status[erste] == "ambiguous"
    vierte_wand = _plan_raum(api, token, floor_id, vierter["id"])["walls"][2]["id"]
    neu = _koppeln(api, token, floor_id, flurwand, vierte_wand, "shared")
    assert neu.status_code == 422
    assert fehlercodes(neu) == {"wall-link-ambiguous"}
    assert len(_links_in_db(engine)) == 3


@pytest.mark.parametrize(
    ("b_waende", "code"),
    [
        # 1 mm Versatz: andere Gerade.
        ([(4_001, 3_000, 4_001, 0)], "wall-link-no-overlap"),
        # Nur Endpunktberuehrung auf derselben Geraden.
        ([(4_000, 3_000, 4_000, 6_000)], "wall-link-no-overlap"),
        # Nicht parallel.
        ([(4_000, 0, 5_000, 3_000)], "wall-link-no-overlap"),
    ],
    ids=["versatz-1mm", "endpunkt", "schraeg"],
)
def test_ohne_exakte_ueberlappung_keine_kopplung(
    api: TestClient,
    token: str,
    geschoss: dict[str, Any],
    b_waende: list[tuple[int, int, int, int]],
    code: str,
) -> None:
    floor_id = geschoss["floor"]["id"]
    a = _plan_raum(api, token, floor_id, _raum(api, token, floor_id, _rechteck(4_000, 3_000))["id"])
    b = _raum(
        api,
        token,
        floor_id,
        [{"x1_mm": w[0], "y1_mm": w[1], "x2_mm": w[2], "y2_mm": w[3]} for w in b_waende],
        name="B",
    )
    b = _plan_raum(api, token, floor_id, b["id"])
    response = _koppeln(api, token, floor_id, a["walls"][1]["id"], b["walls"][0]["id"], "shared")
    assert response.status_code == 422
    assert fehlercodes(response) == {code}
    assert _plan(api, token, floor_id)["wall_link_candidates"] == []


def test_schraege_teilueberlappung_wird_exakt_erkannt(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    """Gerade (1,2): A (0,0)->(2000,4000), B (3000,6000)->(1000,2000) - Grenze bei 1000·√5."""
    floor_id = geschoss["floor"]["id"]
    a = _raum(api, token, floor_id, [{"x1_mm": 0, "y1_mm": 0, "x2_mm": 2_000, "y2_mm": 4_000}])
    b = _raum(
        api,
        token,
        floor_id,
        [{"x1_mm": 3_000, "y1_mm": 6_000, "x2_mm": 1_000, "y2_mm": 2_000}],
        name="B",
    )
    a = _plan_raum(api, token, floor_id, a["id"])
    b = _plan_raum(api, token, floor_id, b["id"])
    kandidaten = _plan(api, token, floor_id)["wall_link_candidates"]
    assert [(k["kind"], k["reasons"]) for k in kandidaten] == [
        ("decision-needed", ["contour-open"])
    ]
    link = _gekoppelt(api, token, floor_id, a["walls"][0]["id"], b["walls"][0]["id"], "separate")
    assert link["status"] == "active"


def test_abweichende_staerke_shared_mit_konflikt_separate_ohne(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor_id = geschoss["floor"]["id"]
    a, b = _paar(api, token, floor_id)
    walls = _waende(b)
    walls[3]["thickness_mm"] = 240
    assert _kontur(api, token, b, walls=walls).status_code == 200
    kandidat = _plan(api, token, floor_id)["wall_link_candidates"][0]
    assert (kandidat["kind"], kandidat["reasons"]) == ("decision-needed", ["thickness-differs"])

    link = _gekoppelt(api, token, floor_id, a["walls"][1]["id"], b["walls"][3]["id"], "shared")
    assert link["thickness_conflict"] is True
    geaendert = api.patch(
        f"{BASIS}/wall-links/{link['id']}",
        headers={**auth_headers(token), "If-Match": "1"},
        json={"relation": "separate"},
    )
    assert geaendert.json()["thickness_conflict"] is False


def test_andere_waende_sind_nicht_koppelbar(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor_id = geschoss["floor"]["id"]
    a, _ = _paar(api, token, floor_id)
    selbst = _koppeln(api, token, floor_id, a["walls"][1]["id"], a["walls"][1]["id"], "shared")
    assert fehlercodes(selbst) == {"wall-link-same-wall"}
    gleicher_raum = _koppeln(
        api, token, floor_id, a["walls"][0]["id"], a["walls"][1]["id"], "shared"
    )
    assert fehlercodes(gleicher_raum) == {"wall-link-same-room"}
    unbekannt = _koppeln(api, token, floor_id, a["walls"][0]["id"], str(uuid.uuid4()), "shared")
    assert fehlercodes(unbekannt) == {"wall-link-wall-unknown"}


def test_anderes_geschoss_ist_nicht_koppelbar(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor_id = geschoss["floor"]["id"]
    obergeschoss = api.post(
        f"/api/v1/buildings/{geschoss['building']['id']}/floors",
        headers=auth_headers(token),
        json={"name": "Obergeschoss", "level": 1},
    ).json()
    a = _plan_raum(api, token, floor_id, _raum(api, token, floor_id, _rechteck(4_000, 3_000))["id"])
    oben = _raum(api, token, obergeschoss["id"], _rechteck(3_000, 3_000, x=4_000), name="B")
    oben = _plan_raum(api, token, obergeschoss["id"], oben["id"])
    response = _koppeln(api, token, floor_id, a["walls"][1]["id"], oben["walls"][3]["id"], "shared")
    assert response.status_code == 422
    assert fehlercodes(response) == {"wall-link-other-floor"}


# ------------------------------------------------ Geometrie und Lebenszyklus


def _verschoben(raum: dict[str, Any], dx: int) -> list[dict[str, Any]]:
    walls = _waende(raum)
    for wall in walls:
        wall["x1_mm"] += dx
        wall["x2_mm"] += dx
    return walls


def test_verschieben_unterbricht_und_zurueckschieben_stellt_wieder_her(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor_id = geschoss["floor"]["id"]
    a, b = _paar(api, token, floor_id)
    link = _gekoppelt(api, token, floor_id, a["walls"][1]["id"], b["walls"][3]["id"], "shared")
    b = _plan_raum(api, token, floor_id, b["id"])

    weg = _kontur(api, token, b, walls=_verschoben(b, 500))
    assert weg.status_code == 200, weg.text
    unterbrochen = _link_im_plan(api, token, floor_id, link["id"])
    assert (unterbrochen["status"], unterbrochen["relation"]) == ("broken", "shared")

    b = _plan_raum(api, token, floor_id, b["id"])
    zurueck = _kontur(api, token, b, walls=_verschoben(b, -500))
    assert zurueck.status_code == 200, zurueck.text
    assert _link_im_plan(api, token, floor_id, link["id"])["status"] == "active"
    # IDs unveraendert - keine automatische Umhaengung.
    assert _plan_raum(api, token, floor_id, b["id"])["walls"][3]["id"] == b["walls"][3]["id"]


def test_wiederherstellung_einer_getrennten_kopplung_prueft_die_geraete(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    """``separate`` unterbrochen: Die Rueckkehr der Geometrie macht die Kopplung wieder wirksam."""
    floor_id = geschoss["floor"]["id"]
    a, b = _paar(api, token, floor_id)
    a = _tuer_in_a(api, token, floor_id, a)
    link = _gekoppelt(api, token, floor_id, a["walls"][1]["id"], b["walls"][3]["id"], "separate")
    b = _plan_raum(api, token, floor_id, b["id"])
    assert _kontur(api, token, b, devices=[_steckdose_in_tuer(b)]).status_code == 200

    # A weg und zurueck: unterbrochen, danach wieder separate - die Steckdose bleibt zulaessig.
    a = _plan_raum(api, token, floor_id, a["id"])
    assert _kontur(api, token, a, walls=_verschoben(a, -500)).status_code == 200
    assert _link_im_plan(api, token, floor_id, link["id"])["status"] == "broken"
    a = _plan_raum(api, token, floor_id, a["id"])
    assert _kontur(api, token, a, walls=_verschoben(a, 500)).status_code == 200
    assert _link_im_plan(api, token, floor_id, link["id"])["status"] == "active"

    # Ohne die Kopplung waere die Rueckkehr unzulaessig (unentschieden blockiert).
    a = _plan_raum(api, token, floor_id, a["id"])
    assert _kontur(api, token, a, walls=_verschoben(a, -500)).status_code == 200
    geloest = api.delete(
        f"{BASIS}/wall-links/{link['id']}", headers={**auth_headers(token), "If-Match": "1"}
    )
    assert geloest.status_code == 204
    a = _plan_raum(api, token, floor_id, a["id"])
    zurueck = _kontur(api, token, a, walls=_verschoben(a, 500))
    assert zurueck.status_code == 422
    assert fehlercodes(zurueck) == {"device-in-opening"}


def test_dritter_raum_auf_getrennter_kopplung_mit_geraet_wird_abgelehnt(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor_id = geschoss["floor"]["id"]
    a, b = _paar(api, token, floor_id)
    a = _tuer_in_a(api, token, floor_id, a)
    _gekoppelt(api, token, floor_id, a["walls"][1]["id"], b["walls"][3]["id"], "separate")
    b = _plan_raum(api, token, floor_id, b["id"])
    assert _kontur(api, token, b, devices=[_steckdose_in_tuer(b)]).status_code == 200

    # Eine dritte Wand auf dem Stueck macht es mehrdeutig -> konservativ -> Konflikt.
    response = api.post(
        f"{BASIS}/floors/{floor_id}/rooms",
        headers=auth_headers(token),
        json={
            "name": "Schacht",
            "walls": [{"x1_mm": 4_000, "y1_mm": 0, "x2_mm": 4_000, "y2_mm": 3_000}],
        },
    )
    assert response.status_code == 422
    assert fehlercodes(response) == {"device-in-opening"}
    assert len(_plan(api, token, floor_id)["rooms"]) == 2


def test_teilen_laesst_die_kopplung_an_der_urspruenglichen_wand(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor_id = geschoss["floor"]["id"]
    a, b = _paar(api, token, floor_id)
    link = _gekoppelt(api, token, floor_id, a["walls"][1]["id"], b["walls"][3]["id"], "shared")
    a = _plan_raum(api, token, floor_id, a["id"])
    walls = _waende(a)
    # A.walls[1] (4000,0)->(4000,3000) bei y = 1000 teilen; die neue Haelfte ist neu.
    original = walls[1]
    zweite = {**original, "id": str(uuid.uuid4()), "y1_mm": 1_000, "openings": []}
    walls[1] = {**original, "y2_mm": 1_000}
    walls.insert(2, zweite)
    assert _kontur(api, token, a, walls=walls).status_code == 200

    plan = _plan(api, token, floor_id)
    assert [(item["id"], item["status"]) for item in plan["wall_links"]] == [(link["id"], "active")]
    # Das neue Stueck ist unentschieden - nur ein Vorschlag, keine automatische Kopplung.
    assert [
        (k["kind"], zweite["id"] in (k["wall_a_id"], k["wall_b_id"]))
        for k in plan["wall_link_candidates"]
    ] == [("suggested", True)]


def test_konturumkehr_laesst_die_kopplung_wirksam(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor_id = geschoss["floor"]["id"]
    a, b = _paar(api, token, floor_id)
    link = _gekoppelt(api, token, floor_id, a["walls"][1]["id"], b["walls"][3]["id"], "separate")
    a = _plan_raum(api, token, floor_id, a["id"])
    umgekehrt = [
        {**w, "x1_mm": w["x2_mm"], "y1_mm": w["y2_mm"], "x2_mm": w["x1_mm"], "y2_mm": w["y1_mm"]}
        for w in reversed(_waende(a))
    ]
    assert _kontur(api, token, a, walls=umgekehrt).status_code == 200
    assert _link_im_plan(api, token, floor_id, link["id"])["status"] == "active"
    assert _link_im_plan(api, token, floor_id, link["id"])["relation"] == "separate"


def test_entfernen_einer_gekoppelten_wand_nur_ausdruecklich(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor_id = geschoss["floor"]["id"]
    a, b = _paar(api, token, floor_id)
    link = _gekoppelt(api, token, floor_id, a["walls"][1]["id"], b["walls"][3]["id"], "shared")
    # Eine unbeteiligte Kopplung desselben Geschosses.
    c = _raum(api, token, floor_id, _rechteck(4_000, 2_000, y=3_000), name="C")
    c = _plan_raum(api, token, floor_id, c["id"])
    fremd = _gekoppelt(api, token, floor_id, a["walls"][2]["id"], c["walls"][0]["id"], "shared")
    a = _plan_raum(api, token, floor_id, a["id"])
    b_version = raumversion(api, token, b["id"])

    # A ohne Wand 1 (Dreieck (0,0),(4000,0) ... ersetzt durch eine Diagonale).
    walls = _waende(a)
    ohne = [
        walls[0],
        {
            **walls[0],
            "id": str(uuid.uuid4()),
            "x1_mm": 4_000,
            "y1_mm": 0,
            "x2_mm": 4_000,
            "y2_mm": 3_000,
            "openings": [],
        },
        walls[2],
        walls[3],
    ]

    fehlt = _kontur(api, token, a, walls=ohne)
    assert fehlt.status_code == 409
    assert fehlercodes(fehlt) == {"wall-has-links"}

    unbeteiligt = _kontur(api, token, a, walls=ohne, removed_links=[link["id"], fremd["id"]])
    assert unbeteiligt.status_code == 422
    assert fehlercodes(unbeteiligt) == {"wall-link-not-affected"}

    doppelt = _kontur(api, token, a, walls=ohne, removed_links=[link["id"], link["id"]])
    assert doppelt.status_code == 422
    assert "wall-link-id-duplicate" in fehlercodes(doppelt)
    assert len(_links_in_db(engine)) == 2

    ok = _kontur(api, token, a, walls=ohne, removed_links=[link["id"]])
    assert ok.status_code == 200, ok.text
    assert [item.id for item in _links_in_db(engine)] == [uuid.UUID(fremd["id"])]
    # Der Partnerraum zaehlt seine Version weiter - ein offener Entwurf bemerkt es.
    assert raumversion(api, token, b["id"]) != b_version


def test_einzelne_gekoppelte_wand_laesst_sich_nicht_loeschen(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    floor_id = geschoss["floor"]["id"]
    a, b = _paar(api, token, floor_id)
    _gekoppelt(api, token, floor_id, a["walls"][1]["id"], b["walls"][3]["id"], "shared")
    wand = api.get(f"{BASIS}/rooms/{a['id']}/walls", headers=auth_headers(token)).json()[1]
    response = api.delete(
        f"{BASIS}/walls/{wand['id']}",
        headers={**auth_headers(token), "If-Match": str(wand["version"])},
    )
    assert response.status_code == 409
    assert fehlercodes(response) == {"wall-has-links"}


def test_veralteter_entwurf_ueberschreibt_keine_neue_kopplung(
    api: TestClient, token: str, geschoss: dict[str, Any]
) -> None:
    """Ein Entwurf von B, geoeffnet vor der Kopplung, kann sie nicht still unterbrechen."""
    floor_id = geschoss["floor"]["id"]
    a, b = _paar(api, token, floor_id)
    alte_version = raumversion(api, token, b["id"])
    _gekoppelt(api, token, floor_id, a["walls"][1]["id"], b["walls"][3]["id"], "separate")

    veraltet = _kontur(api, token, b, walls=_verschoben(b, 500), version=alte_version)
    assert veraltet.status_code == 409
    assert veraltet.json()["type"].endswith("/version-conflict")
    assert _plan_raum(api, token, floor_id, b["id"])["walls"][3]["x1_mm"] == 4_000


def test_raumloeschung_nimmt_kopplungen_mit_und_partner_bleibt(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor_id = geschoss["floor"]["id"]
    a, b = _paar(api, token, floor_id)
    _gekoppelt(api, token, floor_id, a["walls"][1]["id"], b["walls"][3]["id"], "separate")
    b_vorher = _plan_raum(api, token, floor_id, b["id"])
    response = api.delete(
        f"{BASIS}/rooms/{a['id']}",
        headers={**auth_headers(token), "If-Match": raumversion(api, token, a["id"])},
    )
    assert response.status_code == 204
    assert _links_in_db(engine) == []
    b_nachher = _plan_raum(api, token, floor_id, b["id"])
    assert _waende(b_nachher) == _waende(b_vorher)
    assert b_nachher["version"] > b_vorher["version"]


def test_projektinhalt_zaehlt_kopplungen_und_loeschung_entfernt_sie(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine
) -> None:
    floor_id = geschoss["floor"]["id"]
    a, b = _paar(api, token, floor_id)
    _gekoppelt(api, token, floor_id, a["walls"][1]["id"], b["walls"][3]["id"], "shared")
    projekt = geschoss["project"]
    pruefung = api.get(
        f"/api/v1/projects/{projekt['id']}/deletion-check", headers=auth_headers(token)
    )
    assert pruefung.status_code == 200, pruefung.text
    inhalte = {item["code"]: item["count"] for item in pruefung.json()["contents"]}
    assert inhalte["electrical.wall_links"] == 1

    aktuell = api.get(f"/api/v1/projects/{projekt['id']}", headers=auth_headers(token)).json()
    geloescht = api.delete(
        f"/api/v1/projects/{projekt['id']}",
        headers={**auth_headers(token), "If-Match": str(aktuell["version"])},
        params={"confirm_project_number": aktuell["project_number"]},
    )
    assert geloescht.status_code == 204, geloescht.text
    assert _links_in_db(engine) == []


# ------------------------------------------------------- Rechte und Status


def test_leserecht_sieht_kopplungen_aber_schreibt_nicht(
    api: TestClient, token: str, betrieb: uuid.UUID, engine: Engine, geschoss: dict[str, Any]
) -> None:
    floor_id = geschoss["floor"]["id"]
    a, b = _paar(api, token, floor_id)
    link = _gekoppelt(api, token, floor_id, a["walls"][1]["id"], b["walls"][3]["id"], "shared")
    raeume._mitglied_mit_permissions(engine, betrieb, "leser@kopplung.example", (PLAN_READ,))
    leser = login(api, "leser@kopplung.example")

    uebersicht = api.get(f"{BASIS}/floors/{floor_id}/wall-links", headers=auth_headers(leser))
    assert uebersicht.status_code == 200
    assert [item["id"] for item in uebersicht.json()["links"]] == [link["id"]]
    neu = _koppeln(api, leser, floor_id, a["walls"][1]["id"], b["walls"][3]["id"], "shared")
    patch = api.patch(
        f"{BASIS}/wall-links/{link['id']}",
        headers={**auth_headers(leser), "If-Match": "1"},
        json={"relation": "separate"},
    )
    delete = api.delete(
        f"{BASIS}/wall-links/{link['id']}", headers={**auth_headers(leser), "If-Match": "1"}
    )
    assert (neu.status_code, patch.status_code, delete.status_code) == (403, 403, 403)


@pytest.mark.parametrize("status", ["completed", "archived"])
def test_abgeschlossene_und_archivierte_projekte_sind_schreibgeschuetzt(
    api: TestClient, token: str, geschoss: dict[str, Any], engine: Engine, status: str
) -> None:
    floor_id = geschoss["floor"]["id"]
    a, b = _paar(api, token, floor_id)
    link = _gekoppelt(api, token, floor_id, a["walls"][1]["id"], b["walls"][3]["id"], "shared")
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
        api.patch(
            f"{BASIS}/wall-links/{link['id']}",
            headers={**auth_headers(token), "If-Match": "1"},
            json={"relation": "separate"},
        ),
        api.delete(
            f"{BASIS}/wall-links/{link['id']}", headers={**auth_headers(token), "If-Match": "1"}
        ),
    ]
    for response in antworten:
        assert response.status_code == 409
        assert response.json()["type"].endswith(f"project-{status}")
    neu = _koppeln(api, token, floor_id, a["walls"][0]["id"], b["walls"][0]["id"], "shared")
    assert neu.status_code == 409
    assert neu.json()["type"].endswith(f"project-{status}")
    assert [(item.relation, item.version) for item in _links_in_db(engine)] == [("shared", 1)]
    # Lesen bleibt moeglich.
    lesen = api.get(f"{BASIS}/floors/{floor_id}/wall-links", headers=auth_headers(token))
    assert lesen.status_code == 200
