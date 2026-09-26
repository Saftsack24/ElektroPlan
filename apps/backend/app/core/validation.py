"""Gemeinsame Validatoren fuer Ein- und Ausgabeschemas.

Hier liegen Pruefungen, die jedes Modul braucht und kein Modul zweimal
schreiben soll. Sie sind fachneutral: kein Wissen ueber Kunden, Projekte oder
Planung.

Bis Phase 2 stand :func:`reject_explicit_null` in
``app/core/customers/schemas.py`` - dort war er zuerst gebraucht worden. Mit
Phase 3 hat er einen dritten Aufrufer ausserhalb des Core; ein Schema eines
Fachmoduls darf die Schemadatei eines Core-Fachbereichs nicht importieren
(docs/modules.md, Abschnitt 2). Deshalb der Umzug an eine oeffentliche Stelle.
"""

from __future__ import annotations


def reject_explicit_null[T](value: T | None) -> T | None:
    """Lehnt ein ausdruecklich gesendetes ``null`` ab.

    In einem ``PATCH`` bedeutet ein fehlendes Feld "unveraendert" und ``null``
    "leeren". Bei Feldern, die in der Datenbank ``NOT NULL`` sind, waere
    Leeren nicht moeglich - ohne diese Pruefung endete es in einem
    Datenbankfehler (``500``) statt in einer Eingabemeldung (``422``).

    Der Validator laeuft nur fuer ausdruecklich uebergebene Werte: Pydantic
    prueft Standardwerte nicht (``validate_default`` ist aus). Ein
    weggelassenes Feld erreicht ihn also nie.
    """
    if value is None:
        msg = "Dieses Feld darf nicht auf null gesetzt werden."
        raise ValueError(msg)
    return value
