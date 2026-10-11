# 0025 — Steigwege zwischen Geschossen und bestätigte Höhenlage (T4)

Status: **accepted** (2026-10-06) – **Teil „bestätigte Höhenlage“ umgesetzt** (Phase 6a.0);
**Teil „Steigwege“ architektonisch beschlossen, aber NICHT implementiert** (6a.4–6a.5
NOT STARTED; nur die Tabellen sind in Migration `0010` als Schema-Vorbereitung angelegt)
Datum: 2026-10-04 (Entwurf), 2026-10-06 (angenommen)
Betrifft: Phase 6a (Vorbereitung Leitungsrouting) und eine kleine Core-Ergänzung
Baut auf: [ADR 0007](0007-identifiers-and-geometry-units.md) (ganze Millimeter),
[ADR 0013](0013-room-contour-as-ordered-wall-segments.md) (Rundungsregel),
[ADR 0020](0020-data-lifecycle-deletion-and-reopen.md) (Löschteilnehmer)
Entwurf: [`docs/phase-6a-design.md`](../phase-6a-design.md) §1.2, §2.4–2.6, §4.4, Umsetzungsstand §10

## Context

Leitungswege über mehrere Geschosse brauchen ausdrücklich angelegte Übergänge; übereinanderliegende
Räume sagen nichts über einen Schacht aus. Je Geschoss gibt es `level` (verlässliche Reihenfolge),
`elevation_mm` (`NOT NULL DEFAULT 0`; „nicht gepflegt“ ist von 0 nicht unterscheidbar) und
`default_ceiling_height_mm` (lichte Höhe, keine Geschosshöhe). Eine Plausibilitätsprüfung kann
eine fehlende Bestätigung nicht ersetzen.

## Decision

**Core – bestätigte Höhenlage (umgesetzt, Migration `0009_elevation_confirmed`)**

1. `floors.elevation_confirmed boolean NOT NULL DEFAULT false`; Bestand wird **nicht**
   automatisch bestätigt (auch nicht plausible Werte oder das EG mit 0). Keine Ableitung aus
   `level` oder Deckenhöhe.
2. `0` mit Bestätigung ist ein zulässiger Gebäudebezug.
3. Ändert ein Request `elevation_mm` **tatsächlich**, ohne zugleich `elevation_confirmed: true` zu
   senden, fällt die Bestätigung weg. Ein unveränderter Wert lässt sie stehen. Setzen und
   Entziehen ohne Wertänderung ist erlaubt. `If-Match`, Projektsperre und Schreibschutz für
   `completed`/`archived` gelten unverändert.
4. `FloorPlanningContext` erhält additiv `elevation_confirmed`. Kein neuer Teilnehmer-Contract.
5. Die Projektstruktur zeigt neben jeder Höhenlage „Höhenlage bestätigt“ bzw. „nicht
   bestätigt“; Bearbeiten setzt das Häkchen bei geändertem Wert zurück.

**Electrical – Steigwege (beschlossen, nicht implementiert)**

6. `electrical_risers` je Gebäude (Name eindeutig im Gebäude, `offset_mode = orthogonal | direct`)
   und `electrical_riser_stops` je Geschoss (`x_mm`, `y_mm`, höchstens ein Halt je Geschoss); FKs
   zu Gebäude und Geschoss `RESTRICT`, Halte `CASCADE`. **Die Tabellen bestehen seit `0010`;
   API, Service, Oberfläche und Daten fehlen bewusst.**
7. Halte nach `level` sortiert; ein Abschnitt je zwei aufeinanderfolgende Halte; ausgelassene
   Geschosse werden durchquert, ohne Anschluss.
8. **Verlauf** (eine reine Funktion für Länge, 2D und 3D): senkrecht am **unteren** Übergabepunkt
   von FFB unten bis FFB oben; dann waagerecht auf der Ebene des **oberen** FFB zum oberen
   Übergabepunkt – `orthogonal` zuerst x, dann y; `direct` eine waagerechte Gerade (keine
   3D-Diagonale). Länge = Summe der Teilstrecken, nur die `direct`-Gerade einmal kaufmännisch
   gerundet.
9. **Getrennt bewertet:** geometrische Länge; Verlässlichkeit (`confirmed` nur, wenn beide
   Höhenlagen bestätigt; sonst `elevation-unconfirmed` ohne senkrechten Wert;
   `elevation-inconsistent`, wenn bestätigt und das höhere Geschoss nicht höher liegt);
   Plausibilitätshinweis – der Hinweis ändert weder Länge noch Status. **Unbestätigte Höhen
   erscheinen nie als verlässliche Leitungslänge.**
10. Längen werden nicht gespeichert; Projektlöschung über den vorhandenen
    `ProjectContentParticipant` (muss mit 6a.4 die Steigwege vor dem Core löschen – das
    `RESTRICT` auf `buildings` verlangt es); kleine Erweiterung
    `FloorPlanningAccess.building_context()`.
11. Übergabepunkt am FFB, ohne eigene Höhe; die Strecke zur tatsächlichen Austrittshöhe gehört zum
    Leitungsweg (6b). Keine Aussage über Machbarkeit, Brandschutz oder Normen.

## Considered Options

* **Automatisch aus übereinanderliegenden Räumen ableiten:** verworfen (Auftrag).
* **Nur Plausibilitätsprüfung der Höhenlage:** verwechselt „plausibel“ mit „bestätigt“; verworfen.
* **`elevation_mm` nullable:** bricht vorhandene Clients und den Contract stärker als eine
  zusätzliche Spalte; verworfen.
* **Frei gezeichnete 3D-Polylinie je Steigweg:** genauer, für den MVP zu aufwendig.

## Consequences

* Zwei Migrationen: `0009_elevation_confirmed` (Core, Spalte; die ursprünglich geplante
  Revision-ID `0009_floor_elevation_confirmation` war mit 33 Zeichen zu lang für
  `alembic_version.version_num varchar(32)` und wurde vor jeder Anwendung gekürzt) und
  `0010_wall_links_and_risers` (Electrical, mit ADR 0024).
* Bis zur Bestätigung haben Bestandsprojekte keine senkrechten Steigweglängen – gewollt, sichtbar.
* Offen für 6a.4–6a.5: Steigweg-API, `riser_course`, Längenstatus, Löschteilnehmer,
  `building_context()`, Oberfläche (Entwurf §8).
