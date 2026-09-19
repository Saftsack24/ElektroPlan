"""Optimistisches Sperren ueber ``If-Match`` (docs/api.md, Abschnitt 5).

Jede versionierte Geschaeftsentitaet traegt eine ``version``-Spalte
(architecture.md, Abschnitt 16). Aendernde Anfragen senden die Version, die
der Client gelesen hat::

    PATCH /api/v1/projects/{id}
    If-Match: "3"

Drei Faelle, drei Antworten:

* Header fehlt        -> ``428`` (``precondition-required``)
* Header passt nicht  -> ``409`` (``version-conflict``)
* Header passt        -> Aenderung wird ausgefuehrt

Der Header ist **Pflicht** und nicht optional. Ein ``PATCH`` ohne ``If-Match``
waere ein stilles Ueberschreiben - die Versionsspalte haette dann keinerlei
Wirkung, und genau das soll sie verhindern.

**Syntax.** Die Anwendung braucht bewusst nur eine positive ganze Zahl - keine
vollstaendige ETag-Grammatik. Akzeptiert werden ausschliesslich::

    If-Match: 3
    If-Match: "3"

Alles andere wird abgelehnt, darunter ``W/"3"`` (schwacher Vergleich),
unpaarige oder doppelte Anfuehrungszeichen (``"3``, ``3"``, ``""3""``),
Listen (``3, 4``), der Platzhalter ``*``, ``0``, negative Werte,
Nachkommastellen und fuehrende Nullen.
"""

from __future__ import annotations

import re
from typing import Annotated, Protocol

from fastapi import Header

from app.errors import PreconditionRequiredError, VersionConflictError

#: Genau eine positive Ganzzahl, wahlweise in Anfuehrungszeichen. Die
#: Alternation ist bewusst vollstaendig ausgeschrieben - ein optionales
#: Anfuehrungszeichen auf beiden Seiten wuerde ``"3`` und ``3"`` durchlassen.
_IF_MATCH_PATTERN = re.compile(r'\A(?:"(?P<quoted>[1-9][0-9]*)"|(?P<bare>[1-9][0-9]*))\Z')


class Versionable(Protocol):
    """Alles, was eine Versionsspalte fuehrt."""

    version: int


def parse_if_match(raw: str | None) -> int:
    """Liest den ``If-Match``-Header als Versionsnummer.

    Akzeptiert ``3`` und ``"3"``. Alles andere - schwache ETags, unpaarige
    Anfuehrungszeichen, Listen, ``*``, Null, negative und gebrochene Zahlen -
    wird abgelehnt. Eine Version ist ein exakter Wert, kein semantisch
    aehnlicher; ein beschaedigter Header darf nicht versehentlich als
    gueltige Vorbedingung durchgehen.
    """
    if raw is None or not raw.strip():
        raise PreconditionRequiredError(
            'Diese Aenderung verlangt den Header If-Match mit der gelesenen Version, z. B. "3".'
        )
    match = _IF_MATCH_PATTERN.match(raw.strip())
    if match is None:
        # Der Rohwert wird bewusst nicht zurueckgespiegelt: Er stammt vom
        # Client und gehoert nicht ungeprueft in eine Antwort.
        raise PreconditionRequiredError(
            'If-Match muss genau eine positive Ganzzahl enthalten, z. B. 3 oder "3".'
        )
    return int(match.group("quoted") or match.group("bare"))


def require_if_match(if_match: Annotated[str | None, Header(alias="If-Match")] = None) -> int:
    """FastAPI-Dependency: ``expected_version: int = Depends(require_if_match)``."""
    return parse_if_match(if_match)


def check_version(entity: Versionable, expected_version: int) -> None:
    """Vergleicht die erwartete mit der gespeicherten Version."""
    if entity.version != expected_version:
        raise VersionConflictError(
            f"Der Datensatz wurde zwischenzeitlich geaendert "
            f"(erwartet: {expected_version}, aktuell: {entity.version}). "
            "Bitte neu laden und die Aenderung wiederholen."
        )
