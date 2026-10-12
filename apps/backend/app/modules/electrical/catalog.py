"""Feste Wertelisten der Elektroplanung: Raumtypen, Montageflaechen, Geraetekatalog.

Phase 5 (ADR 0023). Rein: keine Datenbank, kein Framework - Modelle,
Schemas, Pruefung und Seed lesen dieselben Werte.

**Raumtypen (T7).** Nur zur Einordnung eines Raums. Stabile technische
Schluessel; die deutschen Anzeigenamen stehen in der Oberflaeche. Kein Typ
loest etwas aus - keine Ausstattungsvorlage, kein automatisch platziertes
Geraet. Bestehende Raeume bleiben ohne Typ.

**Geraetekatalog (T1).** Ein kleiner, nachvollziehbarer Startumfang. Ein
Geraetetyp ist **kein Herstellerartikel und keine Materialposition** - er
beschreibt, was geplant wird. Je Typ:

* zulaessige Montageflaechen (Wandinnenseite, Fassadenaussenseite, Decke),
* ein **Planungsmass** in ganzen, geraden Millimetern - die Flaeche, mit der
  die Platzierung gegen Wandkanten, Oeffnungen und andere Geraete geprueft
  wird (an der Wand Breite x Hoehe, an der Decke Breite in x und Hoehe in y
  des Grundrisses). Es ist ein vereinfachtes Rahmen- bzw. Auslassmass, keine
  Herstellerangabe und keine Abstandsregel; die Groesse des SVG-Symbols spielt
  dafuer keine Rolle,
* eine **Standard-Montagehoehe** (Mitte ueber Fertigfussboden) als blosser
  Startwert fuer Wandgeraete - frei aenderbar, **keine Normvorgabe**
  (docs/security.md, Abschnitt 17),
* ein Symbolschluessel, den die Oberflaeche zentral auf ein eigenes
  SVG-Symbol abbildet (austauschbar, keine behauptete DIN-Konformitaet).

Der Katalog ist ein Systemkatalog: Er wird mit dem idempotenten Seed
ausgeliefert (``reference_data.py``). Ein Typ, der hier entfaellt, wird nicht
geloescht, sondern deaktiviert - vorhandene Geraete behalten ihn, neue
koennen ihn nicht mehr waehlen.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

# ---------------------------------------------------------------- Raumtypen

ROOM_TYPES: tuple[str, ...] = (
    "living_room",
    "bedroom",
    "children_room",
    "kitchen",
    "bathroom",
    "hallway",
    "office",
    "utility_room",
    "technical_room",
    "basement",
    "garage",
    "other",
)


# ----------------------------------------------------------- Montageflaechen


class MountingSurface(StrEnum):
    """Die tatsaechliche Montageflaeche eines Geraets - dauerhaft gespeichert.

    ``wall_interior``  Innenseite einer Wand, aus dem Raum gesehen.
    ``wall_exterior``  Aussenseite derselben Raumwand (Fassade).
    ``ceiling``        Decke des Raums; die Hoehe ist immer die effektive
                       Raumhoehe und wird nicht gespeichert.

    Innen und aussen sind getrennte Flaechen: Ein Geraet innen und eines aussen
    an derselben Wand sind zwei Geraete, nichts wird gespiegelt.
    """

    WALL_INTERIOR = "wall_interior"
    WALL_EXTERIOR = "wall_exterior"
    CEILING = "ceiling"


MOUNTING_SURFACES: tuple[str, ...] = tuple(item.value for item in MountingSurface)
WALL_SURFACES: frozenset[str] = frozenset(
    {MountingSurface.WALL_INTERIOR.value, MountingSurface.WALL_EXTERIOR.value}
)


class DeviceCategory(StrEnum):
    SOCKET = "socket"
    SWITCH = "switch"
    LIGHT = "light"
    DATA = "data"
    #: Lage einer Verteilung (Phase 6b.0, ADR 0026) - kein Verbraucher.
    DISTRIBUTION = "distribution"
    #: Abzweigdose (Phase 6b.0) - Verzweigungspunkt kuenftiger Leitungen, kein Verbraucher.
    JUNCTION = "junction"


DEVICE_CATEGORIES: tuple[str, ...] = tuple(item.value for item in DeviceCategory)

#: Kategorien, deren Geraete einem Stromkreis zugeordnet werden koennen
#: (ADR 0026): Verbraucher (Steckdose, Schalter, Leuchte) und Abzweigdosen
#: (Verzweigungspunkt eines Stromkreises, ab 6b.3 Leitungsendpunkt). Nicht
#: zuordenbar: Datendosen (kein Stromkreis) und das Lagegeraet einer Verteilung
#: (``distribution``) - es ist der Bezugspunkt der Verteilung selbst.
ASSIGNABLE_CATEGORIES: frozenset[str] = frozenset(
    {
        DeviceCategory.SOCKET.value,
        DeviceCategory.SWITCH.value,
        DeviceCategory.LIGHT.value,
        DeviceCategory.JUNCTION.value,
    }
)
#: Katalogtyp, dessen Geraet die Lage einer Verteilung ist (D1, ADR 0026).
DISTRIBUTION_BOARD_TYPE = "distribution_board"

#: Grenzen des Planungsmasses - plausibel fuer Dosen, Rahmen und Auslaesse.
MIN_DEVICE_SIZE_MM = 20
MAX_DEVICE_SIZE_MM = 1_000
#: Mehr Geraete in einem Raum sind kein Grundriss mehr; haelt die Pruefung berechenbar.
MAX_DEVICES_PER_ROOM = 300
#: Freitext je Geraet (z. B. "Bett links") - kurz, ohne Personenbezug.
MAX_DEVICE_LABEL_LENGTH = 60


# ------------------------------------------------------------ Geraetekatalog


@dataclass(frozen=True, slots=True)
class DeviceTypeDef:
    """Ein Eintrag des ausgelieferten Systemkatalogs."""

    key: str
    label: str
    category: DeviceCategory
    symbol_key: str
    allows_wall_interior: bool
    allows_wall_exterior: bool
    allows_ceiling: bool
    #: Startwert der Mitte ueber FFB fuer Wandgeraete; ``None`` fuer reine Deckengeraete.
    default_center_height_mm: int | None
    width_mm: int
    height_mm: int
    sort_order: int


def _wall(
    key: str,
    label: str,
    category: DeviceCategory,
    *,
    height: int,
    width: int = 80,
    depth: int = 80,
    interior: bool = True,
    exterior: bool = False,
    order: int,
) -> DeviceTypeDef:
    return DeviceTypeDef(
        key=key,
        label=label,
        category=category,
        symbol_key=key,
        allows_wall_interior=interior,
        allows_wall_exterior=exterior,
        allows_ceiling=False,
        default_center_height_mm=height,
        width_mm=width,
        height_mm=depth,
        sort_order=order,
    )


def _ceiling(key: str, label: str, *, size: int = 100, order: int) -> DeviceTypeDef:
    return DeviceTypeDef(
        key=key,
        label=label,
        category=DeviceCategory.LIGHT,
        symbol_key=key,
        allows_wall_interior=False,
        allows_wall_exterior=False,
        allows_ceiling=True,
        default_center_height_mm=None,
        width_mm=size,
        height_mm=size,
        sort_order=order,
    )


_S = DeviceCategory.SOCKET
_W = DeviceCategory.SWITCH
_L = DeviceCategory.LIGHT
_D = DeviceCategory.DATA

#: Der ausgelieferte Startumfang. Reihenfolge = Reihenfolge in der Auswahl.
DEVICE_TYPE_CATALOG: tuple[DeviceTypeDef, ...] = (
    _wall("socket_single", "Steckdose", _S, height=300, order=10),
    _wall("socket_double", "Steckdose zweifach", _S, height=300, width=150, order=20),
    _wall("socket_triple", "Steckdose dreifach", _S, height=300, width=220, order=30),
    _wall("socket_outdoor", "Steckdose, außen geeignet", _S, height=300, exterior=True, order=40),
    _wall("switch_single", "Ausschalter", _W, height=1_050, order=50),
    _wall("switch_two_way", "Wechselschalter", _W, height=1_050, order=60),
    _wall("switch_series", "Serienschalter", _W, height=1_050, order=70),
    _ceiling("light_ceiling", "Deckenleuchte (Auslass)", order=80),
    _ceiling("light_recessed", "Einbauleuchte", order=90),
    _wall("light_wall", "Wandleuchte (Auslass)", _L, height=1_800, width=100, depth=100, order=100),
    _wall(
        "light_outdoor",
        "Außenleuchte (Wand)",
        _L,
        height=2_000,
        width=100,
        depth=100,
        interior=False,
        exterior=True,
        order=110,
    ),
    _wall("data_single", "Netzwerkdose einfach", _D, height=300, order=120),
    _wall("data_double", "Netzwerkdose zweifach", _D, height=300, order=130),
    # Phase 6b.0 (ADR 0026): Lage einer Verteilung und Abzweigdose. Planungsmass
    # und Standardhoehe sind Startwerte, keine Herstellerangabe und keine Norm.
    _wall(
        DISTRIBUTION_BOARD_TYPE,
        "Verteilung",
        DeviceCategory.DISTRIBUTION,
        height=1_400,
        width=550,
        depth=700,
        order=140,
    ),
    DeviceTypeDef(
        key="junction_box",
        label="Abzweigdose",
        category=DeviceCategory.JUNCTION,
        symbol_key="junction_box",
        allows_wall_interior=True,
        allows_wall_exterior=False,
        allows_ceiling=True,
        default_center_height_mm=2_200,
        width_mm=80,
        height_mm=80,
        sort_order=150,
    ),
)
