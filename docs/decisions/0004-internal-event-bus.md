# 0004 — Interner Event Bus mit Post-Commit-Zustellung

Status: accepted
Datum: 2026-09-18

## Context

Module sollen auf Vorgänge anderer Module reagieren können (Planänderung → Materialbedarf
veraltet), ohne dass eine harte Kopplung entsteht. Ein externer Message Broker ist für
einen Einzelbetrieb unverhältnismäßig.

## Problem

Wann werden Events relativ zur Datenbanktransaktion ausgelöst, welche Zustellgarantie gilt,
und was passiert bei Handler-Fehlern?

## Considered Options

**A) Sofortige Zustellung beim Auslösen.** Handler sehen Daten, die noch nicht committet
sind; ein Rollback des Auslösers hinterlässt inkonsistente Folgezustände.

**B) Zustellung im selben Commit (Handler in derselben Transaktion).** Ein Handler-Fehler
rollt die Arbeit des Auslösers zurück — eine Nebenwirkung zerstört die Hauptwirkung.

**C) Post-Commit-Zustellung, synchron im Prozess.** Events werden in der Unit of Work
gesammelt und nach erfolgreichem Commit zugestellt.

**D) Outbox mit Worker.** Zuverlässiger, aber zusätzlicher Prozess, Reihenfolgeprobleme,
Betriebsaufwand — im MVP nicht gerechtfertigt.

## Decision

**Option C**, mit persistiertem Event-Log als Vorbereitung auf D.

1. Events werden während der Unit of Work nur gesammelt.
2. Zustellung erfolgt nach erfolgreichem Commit, synchron, im selben Prozess.
3. Handler laufen in eigenen Transaktionen und dürfen nicht in die Transaktion des
   Auslösers zurückwirken; Fehler werden geloggt und in `domain_events.handler_status`
   vermerkt.
4. Zustellung ist **at most once**. Daraus folgt verbindlich:
   **Jede eventgetriebene Ableitung braucht einen idempotenten Recompute-Endpunkt.**
5. Alles, was Geld oder Bestand verändert, läuft **nie** über Events, sondern über
   synchrone Service-Aufrufe mit Ergebnis.
6. Events sind Tatsachen in der Vergangenheitsform, transportieren nur IDs und kleine
   Skalare, enthalten keine personenbezogenen Daten.
7. Maximal eine Folgeebene; der Event-Graph muss azyklisch sein (beim Start geprüft).
8. Jedes zugestellte Event wird in `domain_events` geschrieben.

## Consequences

**Positiv**
- Keine Inkonsistenz durch Events aus zurückgerollten Transaktionen.
- Ein Handler-Fehler kann keine bereits erfolgreiche Geschäftsoperation vernichten.
- `domain_events` liefert Nachvollziehbarkeit und ist zugleich eine fertige Outbox.

**Negativ**
- Events können verloren gehen — akzeptiert, weil jede Ableitung zusätzlich erzwingbar ist.
- Handler verlängern die Antwortzeit des auslösenden Requests; sie müssen kurz bleiben.
- Die Recompute-Pflicht ist zusätzliche Arbeit pro eventgetriebener Funktion. Sie ist der
  Preis dafür, keinen Broker zu betreiben.

## Migrationspfad

Ein Worker, der `domain_events` abarbeitet, statt direkt zuzustellen, macht daraus
*at least once*, ohne Produzenten oder Handler zu ändern. Deshalb wird die Tabelle von
Anfang an geschrieben.
