# 0010 — 2D-First-Editor mit abgeleiteten Installationszonen

Status: accepted
Datum: 2026-09-18
Betrifft: Masterplan §17 (2D- und 3D-Editor in Phase 4)

## Context

Der MVP-Nutzen entsteht erst am Ende der Kette: Planung → Material → Kalkulation →
Angebot. Ein vollwertiger 3D-Editor mit Auswahl, Snapping, Constraints und Undo ist die
aufwendigste Einzelkomponente des gesamten Plans und liegt auf dem kritischen Pfad dorthin.
Gleichzeitig brauchen Leitungslängen eine dritte Dimension, sonst sind sie zu kurz.

## Problem

Wie entstehen realistische, dreidimensionale Leitungslängen, ohne dass zuerst ein
3D-Editor gebaut werden muss?

## Considered Options

**A) Voller 3D-Editor in Phase 4.** Höchste Genauigkeit, höchstes Zeitrisiko. Erfahrungsgemäß
die Stelle, an der Projekte dieses Zuschnitts stehenbleiben.

**B) Nur 2D, Längen ohne Höhenanteil.** Schnell, aber Längen sind systematisch zu kurz —
die Kalkulation wäre falsch, und der MVP damit wertlos.

**C) 2D als Autorenfläche, Z-Koordinate fachlich abgeleitet, 3D als Ansicht.**

## Decision

**Option C.**

- **Phase 4a:** 2D-Editor — Räume, Wände, Öffnungen, vollwertig bearbeitbar.
- **Phase 4b:** 3D-Ansicht auf Three.js — Darstellung, Navigation, Auswahl.
  **Kein** Bearbeiten von Geometrie in 3D im MVP.

**Installationszonen als Mechanismus:** Ein Leitungsweg wird in 2D gezeichnet und erhält
eine Zone. Aus der Zone ergibt sich die Höhe, aus den Geräteanschlusspunkten ergeben sich
die senkrechten Stichleitungen.

| Zonenschlüssel | Bedeutung | Höhe (Standard, konfigurierbar) |
|---|---|---|
| `horizontal_lower` | waagerechte Zone unten | 300 mm über Fertigfußboden |
| `horizontal_middle` | waagerechte Zone mittig | 1050 mm (Schalterhöhe) |
| `horizontal_upper` | waagerechte Zone oben | 300 mm unter Rohdecke |
| `vertical` | senkrechte Zone | über/unter dem Gerät |
| `ceiling` | Deckenhohlraum / Rohdecke | Raumhöhe |
| `floor` | Fußbodenaufbau | 0 mm |
| `custom` | frei definierte Höhe | Eingabe |

Die Standardwerte orientieren sich an den üblichen Installationszonen (DIN 18015-3) und
sind pro Organisation konfigurierbar. Sie sind eine **Planungshilfe**, keine
Normprüfung — ElektroPlan prüft keine Normkonformität (siehe `docs/security.md`,
Abschnitt 17).

**Längenformel** (deterministisch, testabgesichert):

```
Gesamtlänge = Σ waagerechte Segmente (2D-Abstand)
            + Σ senkrechte Segmente (Zonenhöhe ↔ Gerätehöhe)
            + Anschlusszugabe je Ende (konfigurierbar, z. B. 200 mm Gerät / 500 mm Verteilung)
```

`computed_length_mm` (Geometrie) und `allowance_mm` (Zugaben) werden getrennt
gespeichert, damit im Angebot nachvollziehbar bleibt, wie viel Zuschlag enthalten ist.

## Consequences

**Positiv**
- Realistische 3D-Längen aus einer 2D-Eingabe; die Kalkulation wird brauchbar, bevor ein
  3D-Editor existiert.
- Erheblich kürzerer Weg zum MVP-Nutzen.
- Entspricht der realen Arbeitsweise: Leitungen werden in Zonen verlegt, nicht frei im Raum.
- Die 3D-Ansicht bleibt wertvoll für Kontrolle und Kundenpräsentation, ohne Editorlast.

**Negativ**
- Sonderverlegungen (Schräge, Aufputz, Kanal, Steigezone über Geschosse) brauchen die Zone
  `custom` oder manuelle Punkte.
- Höhenwerte müssen gepflegt werden; falsche Standardwerte wirken sich auf alle Längen aus
  (deshalb sichtbar im Kalkulationsnachweis).
- Ein späterer 3D-Editor muss dieselbe Datenstruktur bedienen — das ist gegeben, weil
  Streckenpunkte bereits vollständig dreidimensional gespeichert werden.
