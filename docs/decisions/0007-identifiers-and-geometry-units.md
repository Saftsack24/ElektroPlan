# 0007 — UUIDs als Schlüssel, Geometrie in ganzzahligen Millimetern

Status: accepted
Datum: 2026-09-18

## Context

Planungsdaten entstehen künftig auch offline auf Baustellen und später per AR-Aufmaß.
Leitungslängen aus der Geometrie fließen direkt in Materialmengen und damit in Preise.

## Problem

Welche Primärschlüssel, und in welcher Einheit und welchem Datentyp wird Geometrie
gespeichert?

## Considered Options

**Schlüssel:** (A) `bigserial` — kompakt, aber offline nicht vergebbar und in URLs
aufzählbar. (B) UUIDv4 — offline vergebbar, nicht aufzählbar, schlechtere Indexlokalität.
(C) UUIDv7 — zeitsortiert, bessere Lokalität, in PostgreSQL 17 nicht nativ erzeugbar.

**Geometrie:** (D) `double precision` in Metern — Standard in 3D-Bibliotheken, aber
Summenfehler und reihenfolgenabhängige Ergebnisse. (E) `numeric` in Metern — exakt, aber
umständlich in geometrischen Berechnungen. (F) `integer` in Millimetern.

## Decision

**Schlüssel: Option B** (UUIDv4, `gen_random_uuid()`), mit der Option, später auf
anwendungsseitig erzeugte UUIDv7 zu wechseln, ohne Spaltentyp oder Contracts zu ändern.

**Geometrie: Option F.**

- Alle Koordinaten, Höhen, Dicken, Abstände: `integer`, Einheit Millimeter, Spaltensuffix
  `_mm`.
- Berechnungen (Streckenlängen über Pythagoras) erfolgen in Millimetern; das Ergebnis wird
  auf ganze Millimeter kaufmännisch gerundet.
- Die Umwandlung in Meter erfolgt erst an der Fachgrenze:
  `Decimal(total_length_mm) / 1000` mit drei Nachkommastellen.
- Fließkomma ist ausschließlich als Zwischenschritt innerhalb einer einzelnen
  geometrischen Operation erlaubt, niemals als Speicherformat und niemals über mehrere
  Summanden hinweg.
- Das Frontend rechnet ebenfalls in Millimetern und formatiert nur zur Anzeige.

## Consequences

**Positiv**
- Leitungslängen sind exakt reproduzierbar; Tests prüfen exakte Werte statt Toleranzen.
- Offline erzeugte Datensätze kollidieren nicht.
- Millimeter sind die gewohnte Einheit im Bauwesen; keine Einheitenverwirrung.
- Soll/Ist-Vergleiche sind belastbar, weil der Sollwert stabil ist.

**Negativ**
- UUIDs benötigen mehr Speicher und haben schlechtere Indexlokalität als `bigserial`;
  bei diesen Datenmengen unkritisch.
- Three.js arbeitet intern mit Floats — an der Grenze zur Szene wird einmal konvertiert,
  zurückgeschrieben wird auf ganze Millimeter gerundet.
- Der maximale darstellbare Bereich beträgt rund ±2.000 km; für Gebäude ausreichend.
