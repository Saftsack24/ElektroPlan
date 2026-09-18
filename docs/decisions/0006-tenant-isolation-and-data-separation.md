# 0006 — Mandantentrennung und Trennung interner Daten

Status: accepted
Datum: 2026-09-18

## Context

Die Plattform soll mehrere Elektrofachbetriebe bedienen. Ein Betrieb darf unter keinen
Umständen Daten eines anderen sehen. Zusätzlich gilt intern: Einkaufspreise, Stundensätze
und Margen dürfen niemals in einem Kundendokument erscheinen.

## Problem

Wie werden beide Trennungen so umgesetzt, dass ein einzelner Programmierfehler sie nicht
aufhebt?

## Considered Options

**Mandant:** (A) Datenbank pro Mandant — sauber, aber Migrationen und Betrieb vervielfachen
sich. (B) Schema pro Mandant — ähnliche Probleme, dazu Verbindungspool-Aufwand.
(C) Gemeinsame Tabellen mit `organization_id` und mehrstufiger Absicherung.

**Interne Daten:** (D) Trennung nur über Serialisierung/DTOs. (E) Trennung über die
Tabellenstruktur.

## Decision

**Mandant: Option C, vierstufig.**

1. **Schema:** `organization_id NOT NULL` auf jeder mandantenbezogenen Tabelle.
2. **Referenzen:** zusammengesetzte Fremdschlüssel `(organization_id, ref_id)` →
   `ziel(organization_id, id)`. Ein mandantenübergreifender Verweis ist damit auf
   Datenbankebene unmöglich, nicht nur unerwünscht.
3. **Zugriffsschicht:** `TenantRepository` setzt den Filter automatisch; fehlender
   Organisationskontext wirft `MissingTenantContext` statt ungefilterte Daten zu liefern.
4. **Test:** automatischer Sweep über alle registrierten Routen mit zwei Testorganisationen;
   fremde IDs müssen `404` liefern.

Der aktive Mandant stammt ausschließlich aus dem geprüften Token, nie aus Header, Query
oder Body. RLS (`SET LOCAL app.current_organization`) wird vorbereitet, im MVP aber nicht
aktiviert.

Zusätzlich: `users` ist eine **globale Identität**; die Zugehörigkeit läuft über
`organization_members`. Rollen hängen an der Mitgliedschaft.

**Interne Daten: Option E.**

> Die Tabellen `offer_versions` und `offer_items` enthalten **keine Kostenspalten** —
> kein `unit_cost`, kein `purchase_price`, kein `markup_percent`, keine Marge.

Der Bezug zur Kalkulation läuft über `offer_versions.calculation_id`. Ein Leak ist damit
nicht durch einen vergessenen Serialisierungsausschluss möglich, sondern nur durch einen
bewusst geschriebenen Join, den es im kundenseitigen Renderpfad nicht gibt. Ein Test prüft,
dass kein PDF-/DTO-Pfad `calculation_*` importiert.

## Consequences

**Positiv**
- Ein einzelner Fehler in einer Abfrage führt nicht zu einem Datenabfluss.
- Kostenangaben im Kundendokument sind strukturell ausgeschlossen.
- Mehrfachmitgliedschaft (Subunternehmer, Betriebsübernahme) ist ohne Migration möglich.

**Negativ**
- Zusammengesetzte Fremdschlüssel erfordern `UNIQUE (organization_id, id)` auf jeder
  referenzierten Tabelle und etwas mehr Schreibarbeit in Modellen und Migrationen.
- Die Angebotsansicht kann Deckungsbeiträge nicht "nebenbei" anzeigen; dafür ist ein
  expliziter, berechtigungsgeprüfter Kalkulationsendpunkt nötig. Das ist beabsichtigt.
