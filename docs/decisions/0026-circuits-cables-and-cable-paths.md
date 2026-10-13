# 0026 — Stromkreise, Leitungen und Leitungswege (Phase 6b)

Status: **accepted** (2026-10-11) – Gesamtentwurf (2. Fassung) vom Auftraggeber als
Umsetzungsgrundlage freigegeben; D1, D2, D4, D5, D11 bestätigt, D6 und D7 auf seine Vorgabe
geändert. Umsetzung schrittweise: **6b.0 und 6b.1 umgesetzt** (Checkpoint `541bae9` vom 2026-10-12), **6b.2 und 6b.3 technisch umgesetzt und geprüft** (reine Längenfunktion, Persistenz und API; Checkpoint `53fdc19` vom 2026-10-13; Entwurf §17/§18), **6b.4 technisch umgesetzt und funktional geprüft** (Leitungsplanung in Wand- und Deckenansicht; Checkpoint vom 2026-10-13; Entwurf §19), 6b.5–6b.6 offen.
Präzisierung 6b.1: Abzweigdosen sind einem Stromkreis zuordenbar (Verzweigungspunkt); das
Lagegerät einer Verteilung und Datendosen nicht.
Betrifft: Phase 6b
Baut auf: [ADR 0005](0005-money-rounding-and-quantities.md), [ADR 0007](0007-identifiers-and-geometry-units.md),
[ADR 0010](0010-2d-first-editor-with-installation-zones.md), [ADR 0013](0013-room-contour-as-ordered-wall-segments.md),
[ADR 0023](0023-electrical-devices-symbols-room-types.md), [ADR 0024](0024-wall-links-physical-wall-assignment.md),
[ADR 0025](0025-risers-between-floors.md)
Entwurf: [`docs/phase-6b-design.md`](../phase-6b-design.md) (2. Fassung)

## Context

Phase 6 soll Leitungslängen deterministisch berechnen. Vorhanden sind Räume, Wände, Öffnungen,
Geräte mit gespeicherter Montagefläche, Wandkopplungen mit exakter Abschnittstopologie und
Steigwege mit einer Verlaufsfunktion. Die Phase-0-Planung (`electrical.md` §4–§5) sah Wege als
Polygonzug im Grundriss, gespeicherte Längen, stille Standardzugaben und den Leitungstyp am
Stromkreis vor. Das passt nicht zum Modell und würde Mengen verfälschen.

## Decision (vorgeschlagen)

1. **Verteilung** = elektrischer Bezugspunkt je Gebäude, **mehrere je Gebäude**; Lage über ein
   Gerät `distribution_board`, keine zweite Geometrie. *(D1, D2 bestätigt)*
2. **Stromkreis** je Verteilung; seine Kabelangaben sind **Vorschläge** für neue Leitungen.
   Schutzorgan, RCD-Gruppe usw. sind manuelle, ungeprüfte Angaben (`security.md` §17).
3. **Gerätezuordnung** als eigene Tabelle; ein Gerät in höchstens einem Stromkreis; nie still
   umgehängt.
4. **Leitung** = physisches Kabel zwischen zwei Geräten (Verteilung, Abzweigdose, Verbraucher)
   mit **eigenen tatsächlichen Kabelangaben** (Typ, Leiteranzahl, Querschnitt). Keine Vererbung
   zur Laufzeit: Vorbelegung aus dem Vorschlag beim Anlegen, Übernahme späterer
   Vorschlagsänderungen nur ausdrücklich je Leitung. *(D6 geändert)*
5. **Leitungsweg** = Wegpunktliste je Leitung auf Planungsflächen **Wand** (Innenseite, waagerecht/
   senkrecht), **Decke** (lichte Raumhöhe) und **Fußboden** (FFB-Ebene, vereinfacht), dazu
   Durchführung, Bodenübergang an Tür/Durchgang, Steigweganteil, Schachtfortsetzung. Gerade
   Flächenstrecken nur innerhalb der echten Raumkontur. Keine Luftlinien, kein Raumwechsel ohne
   bauliche Verbindung. Fußbodenwege wechseln Räume nur über eine ausdrücklich geplante
   Durchführung oder einen ausdrücklich gesetzten Bodenübergang an einer Tür/einem Durchgang, der
   beide Räume verbindet – nie automatisch aus einer Tür. *(D7 geändert, D11 bestätigt)*
6. **Trassen** aus exakt überlappenden Wegen derselben Planungsfläche **abgeleitet**; Trassenmeter
   einmal, Leitungsmeter je Leitung.
7. **Durchführung** einmal an der Eigentümerwand (`wall_a`) einer aktiven `shared`-Kopplung; die
   Gegenseite wird über die vorhandene exakte Abschnittstransformation (Quellwand → Abschnitt →
   Partnerwand, Lagen `whole + steps·√m`) abgebildet – nicht über `L − offset`. Hart geschützt.
8. **Steigwege** werden genutzt, nicht kopiert (Einstieg in Höhe h am unteren Halt, Ausstieg am
   oberen Halt; Fußbodeneinstieg mit h = 0).
9. **Längen** aus einer reinen Funktion (Backend Quelle, Frontend Spiegel, gemeinsame Fixture);
   nichts gespeichert. Status `confirmed`/`incomplete`/`conflict`; Länge nur bestätigt, sonst
   Teilsumme. Zugaben/Reserve nur ausdrücklich je Leitung. *(D5 bestätigt)*
10. **Abhängige Änderungen:** keine stillen Verschiebungen; Bruch von Leitungen durch Wand- oder
    Öffnungsänderungen nur nach ausdrücklicher Bestätigung mit verständlicher Liste, danach
    Konflikt ohne Gesamtlänge und ohne bestätigte Menge; Durchführungen hart geschützt. *(D4
    bestätigt)*
11. **Mengen** nach tatsächlichen Kabelangaben; unvollständig spezifizierte Leitungen eigens, nie
    unter einem Standardtyp.
12. Keine neuen Events, keine Core-Änderung, vorhandene Teilnehmer-Contracts intern erweitert.
    Rechte `electrical.circuit.write`, `electrical.route.write`.

## Considered Options

* **Gespeicherter Trassengraph:** zählt Trassen ebenfalls einmal, aber jedes Teilen einer Kante
  schreibt alle Leitungen um. Verworfen für den MVP.
* **Polygonzug im Grundriss mit Zonenhöhe:** Wege durch Räume, gespeicherte Längen veralten.
  Verworfen.
* **Kabeltyp nur am Stromkreis / Laufzeitvererbung:** eine Vorschlagsänderung würde geplante
  Leitungen still ändern; abweichende Leitungen (Schalterleitung) nicht abbildbar. Verworfen.
* **Gegenseite `L − offset`:** falsch bei gleich gerichteten, versetzten oder verschieden langen
  Wänden. Verworfen.
* **Fußboden erst später:** Längen in Bestandsbauten systematisch falsch. Verworfen; vereinfachte
  Fußbodenfläche ohne Schichtenmodell stattdessen.
* **Harte Ablehnung jeder Wandänderung mit Leitung:** sperrt das Bearbeiten. Verworfen (außer
  Durchführungen).

## Consequences

* Zwei Migrationen (6b.0, 6b.3), neue Katalogtypen und Rechte per Seed.
* Konturspeichern, Kopplung, Höhen- und Steigwegänderungen prüfen zusätzlich Leitungsbefunde.
* Wandachsenmaß überschätzt an Innenecken höchstens um eine Wandstärke; Fußbodenwege liegen
  modellhaft auf FFB – beides sichtbar dokumentiert.
* Gebäudeübergreifende, Außen- und Erdleitungen, Durchführungen durch getrennte Wände, Unterqueren
  geschlossener Wände und mehrere Stromkreise in einer Leitung bleiben offen.
