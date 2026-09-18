# 0005 — Geld, Rundung und Mengen

Status: accepted
Datum: 2026-09-18

## Context

ElektroPlan erzeugt Kalkulationen und Angebote. Ein Rundungsfehler von einem Cent pro
Position ist bei 300 Positionen ein sichtbarer Fehler; ein Fließkommafehler in einer
Marge ist ein wirtschaftlicher Schaden. Materialpreise haben vier Nachkommastellen
(0,7400 €/m), Summen zwei.

## Problem

Welcher Datentyp, welche Rundungsregel, welche Reihenfolge — und wie überstehen Beträge den
Weg durch JSON und JavaScript?

## Considered Options

**A) Float/Double.** Ausgeschlossen. `0.1 + 0.2 != 0.3`.

**B) Integer in Cent.** Exakt, aber Einzelpreise mit vier Nachkommastellen und
Mengen mit drei Nachkommastellen erzwingen ständige Skalierungsarithmetik.

**C) `Decimal` / `numeric` mit festgelegten Stellen und expliziter Rundungsreihenfolge.**

## Decision

**Option C.**

| Größe | Datentyp | Stellen |
|---|---|---|
| Einzelpreis | `numeric(12,4)` / `Decimal` | 4 |
| Positionssumme, Gesamtsumme, Steuer | `numeric(12,2)` | 2 |
| Menge | `numeric(14,3)` | 3 |
| Prozentsatz | `numeric(6,3)` | 3 |

**Rundungsreihenfolge (verbindlich):**

1. Position: `menge × einzelpreis` → auf 2 Stellen, `ROUND_HALF_UP`.
2. Nettosumme: Summe der **bereits gerundeten** Positionssummen.
3. Steuer: je Steuersatzgruppe auf deren Nettosumme, dann runden.
4. Brutto = Netto + Summe der gerundeten Steuerbeträge.

**Transport:** Geldbeträge und Mengen werden über die API als **Dezimal-String**
übertragen (`"1234.56"`), nie als JSON-Number. Im Frontend werden sie nicht in `number`
konvertiert, sondern mit einer Decimal-Bibliothek verarbeitet und nur zur Anzeige
formatiert.

**Währung:** Einzelwährung EUR im MVP, aber `currency` wird gespeichert und übertragen.

**Verbot:** `float` für fachliche Werte im gesamten Backend. Ein Test prüft alle
`numeric`-Spalten und alle Money-Schemas.

## Consequences

**Positiv**
- Summen sind reproduzierbar und testbar; Nachkalkulation und Angebot stimmen überein.
- Die Rundungsreihenfolge ist dokumentiert und einklagbar statt implizit.
- Der Genauigkeitsgewinn im Backend geht an der Schnittstelle nicht verloren.

**Negativ**
- Das Frontend kann nicht mit nativer Zahlenarithmetik rechnen; Summenbildung in der UI
  erfordert eine Bibliothek.
- `Decimal` ist langsamer als `float` — bei diesen Datenmengen irrelevant.
- Entwickler müssen bewusst mit Strings umgehen; ein häufiger Fehler beim Anschluss neuer
  Clients, deshalb explizit in `docs/api.md` festgehalten.
