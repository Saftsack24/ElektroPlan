# 0008 — Sprache in Dokumentation und Code

Status: accepted
Datum: 2026-09-18

## Context

Anwender sind deutsche Elektrofachbetriebe. Die Fachsprache ist Deutsch und teils normativ
geprägt (Stromkreis, Verteilung, Installationszone, Aufmaß). Code, Bibliotheken und
Werkzeuge sind englisch. Die Entwicklung erfolgt KI-gestützt über viele Sessions.

## Problem

In welcher Sprache werden Dokumentation, Bezeichner, API-Felder und Benutzeroberfläche
geschrieben — und wie wird Begriffsdrift vermieden?

## Considered Options

**A) Alles Deutsch.** Deutsche Bezeichner im Code kollidieren mit Framework-Konventionen
und wirken in gemischten Ausdrücken unleserlich (`get_Stromkreis_für_Gerät`).

**B) Alles Englisch.** Fachbegriffe verlieren an Präzision; die Dokumentation wird für den
Betrieb schwerer nutzbar; Rückübersetzungen erzeugen Missverständnisse.

**C) Getrennt nach Zielgruppe, mit verbindlichem Glossar.**

## Decision

**Option C.**

| Artefakt | Sprache |
|---|---|
| Dokumentation in `/docs`, `README.md`, `CLAUDE.md` | **Deutsch** |
| ADRs | **Deutsch** |
| Code, Bezeichner, Dateinamen, Tabellen, Spalten | **Englisch** |
| API-Felder, `operation_id`, Enum-Werte | **Englisch** |
| Commit-Nachrichten | **Englisch** (Conventional Commits) |
| Benutzeroberfläche | **Deutsch** |
| Fehlermeldungen für Benutzer | **Deutsch** |
| Log-Meldungen | **Englisch** |
| Code-Kommentare | Deutsch erlaubt, wenn fachlich; sonst Englisch |

`docs/glossary.md` ist das verbindliche Begriffspaar-Verzeichnis (Stromkreis = circuit,
Verteilung = distribution board, Aufmaß = survey/measurement, Leitungsweg = cable route,
Verschnitt = waste, Aufschlag = markup, Angebot = offer, Auftrag = work order). Ein neuer
Fachbegriff wird dort eingetragen, bevor er im Code verwendet wird.

## Consequences

**Positiv**
- Der Betrieb kann die Dokumentation ohne Übersetzung lesen und prüfen.
- Der Code bleibt mit Werkzeugen, Bibliotheken und KI-Unterstützung kompatibel.
- Das Glossar verhindert, dass derselbe Begriff in drei Varianten im Code landet.

**Negativ**
- Sprachwechsel zwischen Dokument und Code erfordert Disziplin.
- Das Glossar muss gepflegt werden; ohne Pflege entsteht genau die Drift, die es
  verhindern soll.
