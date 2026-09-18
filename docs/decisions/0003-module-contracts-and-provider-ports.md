# 0003 — Modul-Contracts und Provider-Ports

Status: accepted
Datum: 2026-09-18

## Context

Shared Business Modules (materials, inventory, calculation, offers) müssen mit Daten
arbeiten, die nur Fachmodule kennen — z. B. Leitungswege und Geräte aus der
Elektroplanung. Gleichzeitig gilt die Kernregel: Ein Modul kennt die Interna eines anderen
Moduls nicht, und Shared Modules kennen Fachmodule überhaupt nicht.

## Problem

Wie erzeugt die Material Engine Materialbedarf aus der Elektroplanung, ohne `electrical`
zu importieren — und ohne dass `electrical` Preis- und Regellogik enthält?

## Considered Options

**A) `materials` liest Elektro-Tabellen.** Verletzt die Kernregel. Jedes neue Fachmodul
erzwingt Änderungen im Materialmodul.

**B) `electrical` rechnet selbst und schreibt fertige Requirements.** Verschnittregeln,
Verpackungsrundung und Katalogwissen lägen dann in jedem Fachmodul — n-fach dupliziert und
n-fach abweichend.

**C) Event-basiert: `electrical` sendet Drafts per Event.** Zustellung ist "at most once";
Materialbedarf ist geschäftskritisch und darf nicht verloren gehen. Zudem braucht die
Engine die Daten *auf Anforderung*, nicht wenn der Sender sie gerade schickt.

**D) Abhängigkeitsumkehr über Ports.** Das Shared-Modul definiert ein `Protocol`, das
Fachmodul implementiert es, die Module Registry verdrahtet beide.

## Decision

**Option D.** Drei Ports werden eingeführt:

| Port | Definiert von | Implementiert von |
|---|---|---|
| `MaterialRequirementProvider` | materials | jedes Fachmodul |
| `LaborRequirementProvider` | materials | jedes Fachmodul |
| `OfferItemSuggestionProvider` | offers | jedes Fachmodul |

Ergänzende Festlegungen:

1. **Eine** Material Engine. ServiceTemplates liefern objektbezogene Stücklisten und
   Zeiten; globale Regeln verändern ausschließlich Mengen (Verschnitt, Rundung,
   Mindestmenge) und erzeugen kein neues Fachmaterial.
2. **Drei Mengen** je Bedarfszeile: `required_quantity` (technischer Bedarf),
   `planned_quantity` (inkl. Verschnitt), `procurement_quantity` (auf Verpackungseinheit
   gerundet). Welche Menge kalkuliert wird, steuert `materials.calculation_basis`.
3. Ports liefern Daten und schreiben nicht. Der Aufrufer persistiert.
4. Ein neuer Port braucht einen eigenen ADR.
5. ServiceTemplates liegen im Modul `materials` (Katalogdaten), nicht in `calculation`.

## Consequences

**Positiv**
- PV, KNX oder Wallbox schließen sich an, ohne dass ein Shared Module geändert wird.
  Das ist der Prüfstein der Plattformidee.
- Regel- und Preiswissen bleibt an genau einer Stelle.
- Ports sind zur Startzeit prüfbar (Protocol-Konformität).

**Negativ**
- Eine zusätzliche Indirektion gegenüber einem direkten Aufruf.
- Die Engine muss Provider-Ausfälle behandeln (ein Provider mit Fehler darf den Lauf nicht
  stillschweigend unvollständig machen — der Lauf schlägt sichtbar fehl).
- Drei Mengen statt einer erhöhen die Modellkomplexität; ohne sie wäre die Nachkalkulation
  aber systematisch falsch.
