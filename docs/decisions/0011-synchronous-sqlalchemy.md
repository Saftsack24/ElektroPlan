# 0011 — Synchrones SQLAlchemy statt async

Status: accepted
Datum: 2026-09-18

## Context

FastAPI unterstuetzt sowohl asynchrone (`async def`) als auch synchrone (`def`)
Endpunkte. Bei synchronen Endpunkten fuehrt Starlette sie in einem Threadpool aus.
ElektroPlan ist zunaechst eine interne Anwendung fuer einen Elektrofachbetrieb mit
einer zweistelligen Zahl gleichzeitiger Benutzer. Die Geschaeftslogik ist
transaktional dicht: Bestandsbuchungen, Reservierungen, Kalkulationen und
Angebotsfreigaben.

## Problem

Asynchroner oder synchroner Datenbankzugriff?

## Considered Options

**A) Async (`asyncpg`, `AsyncSession`, `async def`).** Hoehere Nebenlaeufigkeit bei
E/A-lastigen Anwendungen. Kosten: Jede Bibliothek muss async koennen, Lazy Loading
im ORM ist unbrauchbar, Tests brauchen eine Eventloop, und ein versehentlich
blockierender Aufruf blockiert den gesamten Worker - ein Fehler, der im Betrieb
schwer zu finden ist.

**B) Synchron (`psycopg`, `Session`, `def`).** Starlette fuehrt Endpunkte im
Threadpool aus. Einfachere Fehlersuche, vollstaendiger ORM-Funktionsumfang,
einfachere Tests.

## Decision

**Option B.**

- Endpunkte werden als `def` definiert, nicht als `async def`.
- Datenbankzugriff ueber `sqlalchemy.orm.Session` mit `psycopg` (Version 3).
- Die Unit of Work (ADR 0004) ist synchron; die Post-Commit-Zustellung der Events
  laeuft im selben Thread.
- Ausnahme: Middleware und ASGI-nahe Bestandteile bleiben `async`, weil das
  Framework es verlangt.

## Consequences

**Positiv**
- Deutlich einfachere Geschaeftslogik und Tests; kein Eventloop-Management.
- Voller ORM-Funktionsumfang einschliesslich Lazy Loading.
- Kein Risiko, den Eventloop durch einen synchronen Aufruf zu blockieren.

**Negativ**
- Die Nebenlaeufigkeit ist durch die Threadpool-Groesse begrenzt (Standard 40).
  Fuer den geplanten Einsatz weit ausreichend; bei Bedarf ueber mehrere
  Uvicorn-Worker skalierbar.
- Ein spaeterer Wechsel auf async waere aufwendig. Er waere nur noetig, wenn die
  Plattform viele Betriebe gleichzeitig bedient - dann mit eigenem ADR.

## Verbindliche Folgeregel

Ein `time.sleep`, ein blockierender HTTP-Aufruf oder eine lange Berechnung in
einem Endpunkt belegt einen Threadpool-Platz. Solche Arbeiten gehoeren in einen
Hintergrundprozess, nicht in den Request.
