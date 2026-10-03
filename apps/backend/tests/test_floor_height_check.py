"""Neue Standardhoehe eines Geschosses gegen vorhandene Oeffnungen (Phase 4f, ADR 0022).

Ein Raum ohne eigene Hoehe erbt die Standardhoehe seines Geschosses. Der Core
fragt vor jeder Aenderung dieser Hoehe die Teilnehmer des Contracts
``FloorCeilingHeightParticipant``; die Elektroplanung meldet Oeffnungen, die
durch die Aenderung hoeher als ihr Raum wuerden. Dann scheitert der gesamte
Geschoss-PATCH mit ``422``, und nichts aendert sich.

Benoetigt PostgreSQL (``ELEKTROPLAN_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import threading
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from app.contracts.v1.floor_planning import FloorCeilingHeightChange
from app.core.projects.floor_height import registered_height_participants
from app.core.projects.models import Floor
from app.core.projects.schemas import FloorUpdate
from app.core.projects.service import ProjectService
from app.errors import ValidationFailedError
from app.modules.electrical.floor_height import ElectricalFloorHeightCheck
from app.modules.electrical.models import ElectricalOpening, ElectricalRoom
from app.modules.electrical.schemas import OpeningCreate, OpeningUpdate
from app.modules.electrical.service import ElectricalRoomService
from tests.conftest import auth_headers, requires_database
from tests.test_archive_concurrency import Welt, factory, welt  # noqa: F401 - Fixtures
from tests.test_concurrency import ACTOR, gleichzeitig
from tests.test_electrical_rooms import (  # noqa: F401 - Fixtures
    BASIS,
    betrieb,
    ereignisse,
    geschoss,
    raum_anlegen,
    rechteck_anlegen,
    token,
)

pytestmark = [requires_database, pytest.mark.database]


# ------------------------------------------------------------------- ueber die API


def _tuer(api: TestClient, token: str, wand_id: str, hoehe: int = 2_010) -> dict[str, Any]:  # noqa: F811
    response = api.post(
        f"{BASIS}/walls/{wand_id}/openings",
        headers=auth_headers(token),
        json={"kind": "door", "offset_mm": 1_000, "width_mm": 885, "height_mm": hoehe},
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


def _geschoss_patch(
    api: TestClient,
    token: str,  # noqa: F811
    geschoss: dict[str, Any],  # noqa: F811
    **werte: object,
) -> Any:
    aktuell = api.get(
        f"/api/v1/buildings/{geschoss['building']['id']}/floors", headers=auth_headers(token)
    ).json()[0]
    return api.patch(
        f"/api/v1/floors/{geschoss['floor']['id']}",
        headers={**auth_headers(token), "If-Match": str(aktuell["version"])},
        json=werte,
    )


def test_absenkung_unter_eine_geerbte_oeffnung_wird_abgelehnt(
    api: TestClient,
    token: str,  # noqa: F811
    geschoss: dict[str, Any],  # noqa: F811
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"], name="Bad", room_number="0.03")
    wand = rechteck_anlegen(api, token, raum["id"])[0]
    tuer = _tuer(api, token, wand["id"])

    antwort = _geschoss_patch(api, token, geschoss, default_ceiling_height_mm=2_000)

    assert antwort.status_code == 422, antwort.text
    problem = antwort.json()
    assert problem["type"].endswith("/validation-failed")
    [fehler] = problem["errors"]
    assert fehler["field"] == "default_ceiling_height_mm"
    assert fehler["code"] == "opening-exceeds-room-height"
    assert fehler["keys"] == [raum["id"], tuer["id"]]
    assert '"0.03 Bad"' in fehler["message"]
    assert "2010 mm" in fehler["message"] and "2000 mm" in fehler["message"]

    # Nichts hat sich geaendert: Geschoss, Raum, Oeffnung.
    stand = api.get(
        f"/api/v1/buildings/{geschoss['building']['id']}/floors", headers=auth_headers(token)
    ).json()[0]
    assert stand["default_ceiling_height_mm"] == 2_500
    assert stand["version"] == geschoss["floor"]["version"]
    nachher = api.get(f"{BASIS}/walls/{wand['id']}/openings", headers=auth_headers(token)).json()
    assert [(o["id"], o["height_mm"], o["version"]) for o in nachher] == [
        (tuer["id"], 2_010, tuer["version"])
    ]


def test_zulaessige_absenkung_und_anhebung_gehen_durch(
    api: TestClient,
    token: str,  # noqa: F811
    geschoss: dict[str, Any],  # noqa: F811
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    _tuer(api, token, rechteck_anlegen(api, token, raum["id"])[0]["id"])

    tiefer = _geschoss_patch(api, token, geschoss, default_ceiling_height_mm=2_010)
    assert tiefer.status_code == 200, tiefer.text
    assert tiefer.json()["default_ceiling_height_mm"] == 2_010
    hoeher = _geschoss_patch(api, token, geschoss, default_ceiling_height_mm=2_800)
    assert hoeher.status_code == 200, hoeher.text


def test_raum_mit_eigener_hoehe_ist_nicht_betroffen(
    api: TestClient,
    token: str,  # noqa: F811
    geschoss: dict[str, Any],  # noqa: F811
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"], height_mm=2_500)
    _tuer(api, token, rechteck_anlegen(api, token, raum["id"])[0]["id"])

    antwort = _geschoss_patch(api, token, geschoss, default_ceiling_height_mm=2_000)

    assert antwort.status_code == 200, antwort.text
    assert antwort.json()["default_ceiling_height_mm"] == 2_000


def test_nur_namensaenderung_fragt_keine_hoehe(
    api: TestClient,
    token: str,  # noqa: F811
    geschoss: dict[str, Any],  # noqa: F811
) -> None:
    raum = raum_anlegen(api, token, geschoss["floor"]["id"])
    _tuer(api, token, rechteck_anlegen(api, token, raum["id"])[0]["id"])

    antwort = _geschoss_patch(api, token, geschoss, name="EG", default_ceiling_height_mm=2_500)

    assert antwort.status_code == 200, antwort.text
    assert antwort.json()["name"] == "EG"


def test_die_elektroplanung_ist_als_teilnehmer_registriert() -> None:
    teilnehmer = registered_height_participants()
    assert [modul for modul, _ in teilnehmer] == ["electrical"]
    assert isinstance(teilnehmer[0][1], ElectricalFloorHeightCheck)


# ------------------------------------------------------------- Teilnehmer direkt


def _mit_tuer(factory: sessionmaker[Session], welt: Welt, hoehe: int = 2_010) -> uuid.UUID:  # noqa: F811
    session = factory()
    try:
        oeffnung = ElectricalRoomService(session, welt.organization_id).create_opening(
            welt.wall_id,
            OpeningCreate(kind="door", offset_mm=1_000, width_mm=885, height_mm=hoehe),
        )[0]
        session.commit()
        return oeffnung.id
    finally:
        session.close()


def _pruefen(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
    *,
    organisation: uuid.UUID | None = None,
    aktuell: int = 2_500,
    neu: int,
) -> list[str]:
    session = factory()
    try:
        konflikte = ElectricalFloorHeightCheck().check_floor_ceiling_height(
            session,
            FloorCeilingHeightChange(
                organization_id=organisation or welt.organization_id,
                floor_id=welt.floor_id,
                current_default_ceiling_height_mm=aktuell,
                proposed_default_ceiling_height_mm=neu,
            ),
        )
        return [k.code for k in konflikte]
    finally:
        session.close()


def test_fremder_mandant_sieht_keine_konflikte(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    _mit_tuer(factory, welt)
    assert _pruefen(factory, welt, neu=2_000) == ["opening-exceeds-room-height"]
    assert _pruefen(factory, welt, organisation=uuid.uuid4(), neu=2_000) == []


def _bestandskonflikt(factory: sessionmaker[Session], welt: Welt, hoehe: int = 2_700) -> uuid.UUID:  # noqa: F811
    """Tuer, die schon jetzt hoeher als der Raum (2500 mm) ist - Bestand, nur per SQL erzeugbar."""
    oeffnung_id = _mit_tuer(factory, welt)
    session = factory()
    try:
        session.execute(
            update(ElectricalOpening)
            .where(ElectricalOpening.id == oeffnung_id)
            .values(height_mm=hoehe)
        )
        session.commit()
    finally:
        session.close()
    return oeffnung_id


def _standardhoehe_setzen(factory: sessionmaker[Session], welt: Welt, hoehe: int) -> None:  # noqa: F811
    """Der echte Core-Pfad: Projektsperre, Neulesen, Teilnehmer, Commit."""
    session = factory()
    try:
        _geschoss_absenken(session, welt, hoehe)
        session.commit()
    finally:
        session.close()


def _stand(factory: sessionmaker[Session], welt: Welt, oeffnung_id: uuid.UUID) -> tuple[int, int]:  # noqa: F811
    session = factory()
    try:
        geschoss = session.execute(
            select(Floor.default_ceiling_height_mm).where(Floor.id == welt.floor_id)
        ).scalar_one()
        tuer = session.execute(
            select(ElectricalOpening.height_mm).where(ElectricalOpening.id == oeffnung_id)
        ).scalar_one()
        return geschoss, tuer
    finally:
        session.close()


def test_bestehender_konflikt_darf_nicht_weiter_abgesenkt_werden(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    """Tuer 2700 mm in einem 2500 mm hohen Raum: Absenkung auf 2400 vergroessert den Konflikt."""
    oeffnung_id = _bestandskonflikt(factory, welt)
    with pytest.raises(ValidationFailedError) as fehler:
        _standardhoehe_setzen(factory, welt, 2_400)
    [eintrag] = fehler.value.errors or []
    assert eintrag.field == "default_ceiling_height_mm"
    assert eintrag.code == "opening-exceeds-room-height"
    assert "schon jetzt" in eintrag.message and "vergroessern" in eintrag.message
    assert eintrag.keys == [str(welt.room_id), str(oeffnung_id)]
    # Nichts geaendert - weder Geschoss noch Oeffnung.
    assert _stand(factory, welt, oeffnung_id) == (2_500, 2_700)


def test_bestehender_konflikt_unveraenderte_hoehe_ist_zulaessig(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    oeffnung_id = _bestandskonflikt(factory, welt)
    assert _pruefen(factory, welt, aktuell=2_500, neu=2_500) == []
    # Ueber den Core: ein PATCH ohne Hoehenaenderung (nur Name) fragt nicht und geht durch.
    session = factory()
    try:
        version = session.execute(
            select(Floor.version).where(Floor.id == welt.floor_id)
        ).scalar_one()
        ProjectService(session, welt.organization_id).update_floor(
            welt.floor_id,
            FloorUpdate(name="EG", default_ceiling_height_mm=2_500),
            expected_version=version,
            actor_user_id=ACTOR,
            height_participants=registered_height_participants(),
        )
        session.commit()
    finally:
        session.close()
    assert _stand(factory, welt, oeffnung_id) == (2_500, 2_700)


def test_bestehender_konflikt_teilweise_verbesserung_ist_zulaessig(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    """2500 -> 2600: die Tuer (2700) passt noch nicht, der Konflikt wird aber kleiner."""
    oeffnung_id = _bestandskonflikt(factory, welt)
    _standardhoehe_setzen(factory, welt, 2_600)
    # Der verbleibende Konflikt bleibt bestehen und unveraendert - nichts wird angepasst.
    assert _stand(factory, welt, oeffnung_id) == (2_600, 2_700)
    # Und von dort darf wieder nicht abgesenkt werden.
    with pytest.raises(ValidationFailedError):
        _standardhoehe_setzen(factory, welt, 2_550)
    assert _stand(factory, welt, oeffnung_id) == (2_600, 2_700)


def test_bestehender_konflikt_vollstaendige_behebung_ist_zulaessig(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    oeffnung_id = _bestandskonflikt(factory, welt)
    _standardhoehe_setzen(factory, welt, 2_800)
    assert _stand(factory, welt, oeffnung_id) == (2_800, 2_700)
    # Danach gilt die gewoehnliche Regel: bis zur Oberkante absenken geht, darunter nicht.
    _standardhoehe_setzen(factory, welt, 2_700)
    with pytest.raises(ValidationFailedError):
        _standardhoehe_setzen(factory, welt, 2_699)
    assert _stand(factory, welt, oeffnung_id) == (2_700, 2_700)


def test_raum_mit_eigener_hoehe_und_bestandskonflikt_ist_unberuehrt(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    oeffnung_id = _bestandskonflikt(factory, welt)
    session = factory()
    try:
        session.execute(
            update(ElectricalRoom).where(ElectricalRoom.id == welt.room_id).values(height_mm=2_500)
        )
        session.commit()
    finally:
        session.close()
    _standardhoehe_setzen(factory, welt, 2_000)
    assert _stand(factory, welt, oeffnung_id) == (2_000, 2_700)


def test_teilnehmer_veraendert_nichts(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
) -> None:
    _mit_tuer(factory, welt)
    session = factory()
    try:
        ElectricalFloorHeightCheck().check_floor_ceiling_height(
            session,
            FloorCeilingHeightChange(
                organization_id=welt.organization_id,
                floor_id=welt.floor_id,
                current_default_ceiling_height_mm=2_500,
                proposed_default_ceiling_height_mm=1_800,
            ),
        )
        assert not session.dirty and not session.new and not session.deleted
    finally:
        session.close()


# ------------------------------------------------------------- Nebenlaeufigkeit


def _geschoss_absenken(session: Session, welt: Welt, hoehe: int) -> None:  # noqa: F811
    projects = ProjectService(session, welt.organization_id)
    version = session.execute(select(Floor.version).where(Floor.id == welt.floor_id)).scalar_one()
    projects.update_floor(
        welt.floor_id,
        FloorUpdate(default_ceiling_height_mm=hoehe),
        expected_version=version,
        actor_user_id=ACTOR,
        height_participants=registered_height_participants(),
    )


def _tuer_erhoehen(session: Session, welt: Welt, oeffnung_id: uuid.UUID, hoehe: int) -> None:  # noqa: F811
    service = ElectricalRoomService(session, welt.organization_id)
    version = session.execute(
        select(ElectricalOpening.version).where(ElectricalOpening.id == oeffnung_id)
    ).scalar_one()
    service.update_opening(oeffnung_id, OpeningUpdate(height_mm=hoehe), expected_version=version)


def _endstand(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
    oeffnung_id: uuid.UUID,
) -> tuple[int, int]:
    session = factory()
    try:
        geschoss = session.execute(
            select(Floor.default_ceiling_height_mm).where(Floor.id == welt.floor_id)
        ).scalar_one()
        tuer = session.execute(
            select(ElectricalOpening.height_mm).where(ElectricalOpening.id == oeffnung_id)
        ).scalar_one()
        raumhoehe = session.execute(
            select(ElectricalRoom.height_mm).where(ElectricalRoom.id == welt.room_id)
        ).scalar_one()
        assert raumhoehe is None
        return geschoss, tuer
    finally:
        session.close()


@pytest.mark.parametrize("zuerst", ["geschoss", "oeffnung"])
def test_absenkung_und_hoehere_tuer_gleichzeitig(
    factory: sessionmaker[Session],  # noqa: F811
    welt: Welt,  # noqa: F811
    zuerst: str,
) -> None:
    """Geschoss auf 2200 mm, Tuer auf 2300 mm - einzeln zulaessig, zusammen nicht.

    Beide Seiten sperren dieselbe Projektzeile. Wer zuerst committet, gewinnt;
    der Wartende sieht danach den neuen Stand und erhaelt ``422``. Ohne das
    Neulesen der Standardhoehe nach der Sperre (``writable_context``) commitete
    die Tuer im Fall „geschoss zuerst" gegen die alte Hoehe - der Endstand waere
    ungueltig.
    """
    oeffnung_id = _mit_tuer(factory, welt)
    gesperrt = threading.Event()

    def arbeiten(session: Session, name: str) -> str:
        if name == zuerst:
            if name == "geschoss":
                _geschoss_absenken(session, welt, 2_200)
            else:
                _tuer_erhoehen(session, welt, oeffnung_id, 2_300)
            gesperrt.set()
            # Sperre noch etwas halten, damit die andere Seite sicher wartet.
            threading.Event().wait(0.5)
        else:
            assert gesperrt.wait(timeout=20)
            if name == "geschoss":
                _geschoss_absenken(session, welt, 2_200)
            else:
                _tuer_erhoehen(session, welt, oeffnung_id, 2_300)
        return name

    lauf = gleichzeitig(factory, arbeiten, namen=("geschoss", "oeffnung"))

    assert lauf.erfolge == [zuerst], lauf.fehlerklassen
    assert len(lauf.fehler) == 1
    assert isinstance(lauf.fehler[0], ValidationFailedError)
    codes = {e.code for e in lauf.fehler[0].errors or []}
    assert codes == {"opening-exceeds-room-height"}
    geschosshoehe, tuerhoehe = _endstand(factory, welt, oeffnung_id)
    assert tuerhoehe <= geschosshoehe
    erwartet = (2_200, 2_010) if zuerst == "geschoss" else (2_500, 2_300)
    assert (geschosshoehe, tuerhoehe) == erwartet
