# 0017 — Nummerierte Seiten für Kunden- und Projektlisten

Status: accepted
Datum: 2026-09-28

## Context

`docs/api.md`, Abschnitt 4, legte seit Phase 0 fest: Auflistungen sind **cursorbasiert,
ohne `offset`** – stabil bei gleichzeitigen Änderungen. Kunden und Projekte folgten dem
seit Phase 2 (Keyset-Cursor, Antwort `items`/`next_cursor`/`has_more`), die Oberfläche
bot dazu „Weitere laden“.

Die manuelle Abnahme nach Phase 4b hat gezeigt, dass das für die Backoffice-Listen nicht
trägt: Wer 600 Projekte hat, will „Seite 6 von 24“ sehen, direkt auf die letzte Seite
springen und nach einem Filterwechsel wissen, wie viele Treffer es gibt. Ein Keyset-Cursor
kann weder eine beliebige Seite adressieren noch eine Gesamtzahl liefern.

## Problem

Die Umstellung hebt zwei dokumentierte Regeln auf: „kein `offset`“ (`api.md` §4) und
„Feldnamen in `v1` ändern sich nicht“ (`api.md` §9) – die Antwort verliert `next_cursor`
und `has_more`. Eine Zählung neben der Seite birgt außerdem zwei Risiken, die es beim
Cursor nicht gab: Die Gesamtzahl kann von der Seite abweichen (andere Filter), und sie
kann Daten fremder Betriebe mitzählen.

## Considered Options

1. **Cursor behalten, Seitenzahl nur anzeigen** (wie in der Benutzerverwaltung): keine
   Sprünge, keine Gesamtzahl – genau das, was fehlt.
2. **Cursor plus separate Zählung**: Seiten bleiben nicht adressierbar; zwei Mechanismen.
3. **Offset-Seiten mit Gesamtzahl** (`page`, `page_size`, `total_items`, `total_pages`),
   begrenzt auf Kunden und Projekte.
4. **Neue API-Version `v2`** für beide Listen und `v1` parallel weiterführen.

## Decision

Option 3, ausschließlich für `GET /customers` und `GET /projects`:

- Anfrage `page` (ab 1) und `page_size` (Standard 25, höchstens 100); `limit`/`cursor`
  entfallen dort.
- Antwort `items`, `page`, `page_size`, `total_items`, `total_pages` (Schema
  `NumberedPage`).
- **Zählung und Daten aus derselben Abfrage:** gezählt wird die bereits gefilterte,
  mandantenbeschränkte Abfrage als Unterabfrage (`app/core/pagination.py`,
  `fetch_numbered_page`). Eine zweite, von Hand gebaute Zählabfrage gibt es nicht.
- **Stabile Reihenfolge:** Sortierspalte, dann die ID in derselben Richtung.
- **Seite hinter der letzten** liefert die letzte vorhandene Seite; `page` nennt sie.
  Leere Treffermenge: `page = 1`, `total_pages = 0`.
- Audit und Benutzerverwaltung bleiben beim Keyset-Cursor; es gibt keinen Anlass, sie
  umzustellen.

Keine `v2`: ElektroPlan ist nicht in Produktion, der einzige Client wird im selben
Repository aus dem Schema erzeugt und gleichzeitig angepasst (ADR 0009). Die
Stabilitätszusage aus `api.md` §9 gilt ab dem ersten externen Client oder dem
Produktivbetrieb; ab dann erzwingt eine vergleichbare Änderung `v2`.

## Consequences

- Zwischen zwei Seitenaufrufen kann sich die Liste ändern; Einträge verschieben sich
  dann um eine Position (ein Eintrag erscheint doppelt oder wird übersprungen). Für die
  Backoffice-Listen ist das bewusst akzeptiert – niemand verarbeitet sie maschinell
  vollständig. Für Listen, die vollständig und exakt einmal durchlaufen werden müssen
  (Export, Synchronisation), bleibt der Keyset-Cursor das Mittel der Wahl.
- `COUNT` kostet eine zweite Abfrage je Seite. Bei Betriebsbeständen im vier- bis
  fünfstelligen Bereich ist das unkritisch; gemessen wurde es nicht.
- Hohe Seitenzahlen bedeuten große Offsets. Die Seite ist auf 1 000 000 begrenzt und
  wird ohnehin auf die letzte vorhandene abgebildet.
- `docs/api.md` §4 beschreibt jetzt beide Muster.
