# 0009 — Quelle der Wahrheit für Contracts

Status: accepted
Datum: 2026-09-18
Ersetzt: Masterplan §5 (handgepflegtes TypeScript-Paket `/packages/contracts`)

## Context

Der Masterplan sieht ein zentrales Contract-Paket unter `/packages/contracts` vor. Das
Backend ist jedoch Python (FastAPI, Pydantic), die Clients sind TypeScript (React,
Capacitor). Contracts existieren auf zwei unterschiedlichen Ebenen: zwischen Backend-Modulen
und zwischen Backend und Client.

## Problem

Wo liegt die Quelle der Wahrheit, sodass Definitionen nicht doppelt gepflegt werden und
nicht unbemerkt auseinanderlaufen?

## Considered Options

**A) Handgepflegtes TypeScript-Paket, Python spiegelt es.** Zwei gepflegte Definitionen.
Drift ist nur eine Frage der Zeit und fällt erst im Angebot auf.

**B) Neutrale Schemasprache (JSON Schema / Protobuf) als Quelle, beide Seiten generiert.**
Sauber, aber ein zusätzlicher Generierungsschritt für beide Seiten und ein Verlust an
Ausdruckskraft gegenüber Pydantic-Validatoren.

**C) Zwei getrennte Contract-Arten mit je einer Quelle.**

## Decision

**Option C.**

| Art | Zwischen | Quelle der Wahrheit | Client-Seite |
|---|---|---|---|
| **Modul-Contract** | Backend-Modul ↔ Backend-Modul | `apps/backend/app/contracts/v1/*.py` | existiert nicht |
| **Wire-Contract** | Backend ↔ Frontend/App | OpenAPI aus FastAPI | `packages/api-client` wird **generiert** |

Festlegungen:

1. `packages/contracts` als handgepflegtes TypeScript-Paket entfällt.
2. `packages/api-client` wird per `openapi-typescript` erzeugt und nie von Hand geändert.
3. CI erzeugt neu und bricht bei Abweichung ab (Drift-Check).
4. `operation_id` ist stabil und sprechend, weil daraus Client-Funktionsnamen entstehen.
5. Modul-Contracts liegen versioniert unter `contracts/v1/`; additive Änderungen innerhalb
   von `v1`, brechende Änderungen erzeugen `v2`.
6. SQLAlchemy-Modelle, Repositories und Tabellen sind **niemals** Contracts.

## Consequences

**Positiv**
- Eine Definition je Contract-Art; kein stiller Drift zwischen Backend und Frontend.
- Typsicherheit im Frontend ohne doppelte Pflege.
- Pydantic-Validierung bleibt vollständig nutzbar.

**Negativ**
- Das Frontend ist an den Generierungsschritt gebunden; ein Backend-Fehler in der
  OpenAPI-Beschreibung wirkt sich sofort auf den Client aus.
- Modul-Contracts sind nur im Backend sichtbar — für Frontend-Entwickler weniger
  auffindbar. Gegenmaßnahme: `docs/contracts.md` beschreibt sie vollständig.
