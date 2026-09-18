# 0001 — Modularer Monolith statt Microservices

Status: accepted
Datum: 2026-09-18

## Context

ElektroPlan soll langfristig mehrere Fachmodule (Elektro, PV, KNX, Wallbox) und mehrere
Elektrofachbetriebe bedienen. Entwickelt wird zunächst für einen Betrieb, mit sehr kleinem
Team und KI-gestützter Umsetzung. Die Geschäftsprozesse sind stark verkettet: Planung →
Material → Kalkulation → Angebot → Auftrag → Lager → Nachkalkulation.

## Problem

Wie wird die Plattform geschnitten, damit sie heute schnell entwickelbar und morgen
erweiterbar bleibt, ohne dass ein Fachmodul-Silo entsteht?

## Considered Options

**A) Microservices von Anfang an.** Klare Grenzen, unabhängige Deployments.
Kosten: verteilte Transaktionen über einen Prozess, der fachlich eine Einheit ist
(Reservierung + Bestand + Auftrag), Netzwerklatenz, eigene Infrastruktur pro Dienst,
Betriebsaufwand, der ein kleines Team vollständig auslastet.

**B) Klassischer Monolith ohne Modulgrenzen.** Schnellster Start.
Kosten: nach 12–18 Monaten greifen Fachmodule direkt auf Lager- und Preistabellen zu; die
Plattformidee ist dann nicht mehr herstellbar.

**C) Modularer Monolith.** Ein Prozess, eine Datenbank, aber harte interne Grenzen mit
Contracts, eigenen Tabellenpräfixen und maschinell geprüften Abhängigkeitsrichtungen.

## Decision

**Option C.**

- Ein Repository, ein Backend-Prozess, eine PostgreSQL-Datenbank, eine Authentifizierung.
- Drei Ebenen: Core · Shared Business Modules · Fachmodule.
- Erlaubte Richtungen: Fachmodul → Shared → Core. Fachmodul → Fachmodul ist verboten,
  Shared → Fachmodul ist verboten.
- Kommunikation ausschließlich über Service-Contracts, Provider-Ports und Domain Events.
- Durchsetzung über `import-linter` (Backend), ESLint-Pfadregeln (Frontend) und einen
  Tabellenpräfix-Test — nicht nur über Dokumentation.

## Consequences

**Positiv**
- Transaktionale Konsistenz über Modulgrenzen hinweg ohne verteilte Transaktionen.
- Ein Deployment, ein Logstream, eine Migrationskette.
- Ein Modul kann später herausgelöst werden, weil seine Schnittstelle bereits explizit ist.

**Negativ**
- Skalierung nur als Ganzes. Für einen Betrieb bzw. wenige Betriebe unkritisch.
- Grenzen sind freiwillig und müssen aktiv durchgesetzt werden — deshalb die CI-Prüfungen.
- Ein fehlerhaftes Modul kann den gesamten Prozess beeinträchtigen.

**Nicht impliziert**
Diese Entscheidung ist keine Vorbereitung auf Microservices. Ein Herauslösen erfolgt nur,
wenn ein konkretes Problem es erzwingt, und benötigt einen eigenen ADR.
