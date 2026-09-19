# 0012 — Zustellgarantie des Event Bus: at most once, keine Outbox

Status: accepted
Datum: 2026-09-18
Ersetzt: die Outbox-Aussage in [ADR 0004](0004-internal-event-bus.md); die
uebrigen Festlegungen aus ADR 0004 (Post-Commit-Zustellung, Fehlerisolierung,
Recompute-Pflicht, azyklischer Graph) bleiben unveraendert gueltig.

## Context

ADR 0004 bezeichnete die Tabelle `domain_events` als "fertige Outbox" und
stellte einen einfachen Migrationspfad zu *at least once* in Aussicht.

Die Umsetzung sieht anders aus: Der Fachzustand wird zuerst committet, und
**danach** wird das Event in einer eigenen Transaktion protokolliert. Stuerzt
der Prozess zwischen beiden Schritten ab, ist das Event verloren — es steht
nirgends, auch nicht als `pending`.

Eine transaktionale Outbox verlangt, dass der Eventdatensatz in **derselben**
Transaktion wie der Fachzustand persistiert wird. Das ist hier nicht der Fall.
Die Aussage war also falsch.

## Problem

Wird die Implementierung zu einer echten Outbox ausgebaut, oder wird die
Dokumentation an die Implementierung angepasst?

## Considered Options

**A) Einfacher Post-Commit-Bus mit ausdruecklich akzeptiertem *at most once*.**
`domain_events` ist ein Best-Effort-Ereignisprotokoll fuer Nachvollziehbarkeit
und Fehlersuche. Keine fachlich notwendige Wirkung haengt allein davon ab; jede
Ableitung braucht weiterhin einen idempotenten Recompute-Befehl.

**B) Echte transaktionale Outbox.** Der Eventdatensatz wird in derselben
Transaktion geschrieben; ein Worker stellt spaeter zu. Das erfordert einen
Zustellstatus je Event **und Handler**, einen Worker oder einen Scheduler,
Wiederaufnahme nach Absturz und Tests fuer Mehrfachzustellung.

## Decision

**Option A.**

Phase 1 hat keinen einzigen geschaeftskritischen Eventkonsumenten: Es sind
keine Subscriptions registriert. Alles, was Geld oder Bestand veraendert, laeuft
ohnehin ueber synchrone Service-Aufrufe (ADR 0004, Regel 5). Ein Worker waere
Infrastruktur ohne gegenwaertigen Nutzen.

Verbindlich gilt damit:

1. Zustellung ist **at most once**. Das wird so dokumentiert und nicht
   beschoenigt.
2. `domain_events` ist ein **Best-Effort-Protokoll**, keine Outbox. Der Status
   `pending` bedeutet "Zustellung begonnen", nicht "wird garantiert nachgeholt".
3. Keine fachlich notwendige Wirkung darf allein von einem Event abhaengen.
4. Jede eventgetriebene Ableitung braucht einen idempotenten, direkt
   aufrufbaren Recompute-Befehl.
5. Der Event Bus wird vor dem Verdrahten geleert, damit mehrfaches Erzeugen der
   Anwendung (Tests) keine Handler doppelt registriert.

## Consequences

**Positiv**
- Die Dokumentation beschreibt, was der Code tatsaechlich leistet.
- Kein Worker, kein Broker, kein Zustellstatus je Handler — deutlich weniger
  bewegliche Teile.
- Die Recompute-Pflicht bleibt der eigentliche Verlaesslichkeitsmechanismus.

**Negativ**
- Events koennen verloren gehen. Fuer Protokoll- und Benachrichtigungszwecke
  ist das hinnehmbar, fuer Geschaeftslogik nicht — deshalb Regel 3.
- Ein spaeterer Umstieg auf eine echte Outbox ist **kein** reiner
  Worker-Nachbau: Das Schreiben des Events muss dann in die Transaktion des
  Ausloesers wandern, und es braucht einen Zustellstatus je Event und Handler.
  Dieser Aufwand wird hier ausdruecklich benannt, statt ihn zu verschweigen.

## Wann diese Entscheidung neu zu bewerten ist

Sobald ein Handler eine fachlich notwendige Wirkung erzeugt, die nicht ueber
einen Recompute nachholbar ist — etwa ein Versand nach aussen oder eine
Buchung. Dann ist Option B mit eigenem ADR umzusetzen.
