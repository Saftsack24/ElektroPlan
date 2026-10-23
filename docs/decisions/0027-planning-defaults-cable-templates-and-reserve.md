# 0027 — Planungsvorgaben, Kabelvorlagen und Leitungsreserve (Phase 6c)

Status: **proposed** (2026-10-15). **Einzelentscheidungen bestätigt** (2026-10-15):
F1 (Vorrang, abweichend von der ursprünglichen Empfehlung) und F2 (Rundung) – siehe Nr. 3 und Nr. 5.
**Teilweise umgesetzt (2026-10-23, V1, uncommittet):** Nr. 1–6, 8, 9, 11 im Backend samt Längenfunktion,
Frontend-Spiegel und Mengenübersicht (Entwurf §20); **offen:** Nr. 7 (zentrale Anwendung, 6c.6), die
Oberflächen für Vorgaben und Abschlussdialog (L2/L3), Nr. 10 (Phase-7-Vertrag). Der Status bleibt
*proposed*, bis 6c abgenommen ist.
Betrifft: Phase 6c (Schritte 6c.4–6c.6)
Löst ab: [ADR 0026](0026-circuits-cables-and-cable-paths.md) **D5** (Zugaben/Reserve nur ausdrücklich je
Leitung, keine Projektstandardwerte); präzisiert ADR 0026 Nr. 4 und Nr. 9
Baut auf: [ADR 0005](0005-money-rounding-and-quantities.md), [ADR 0006](0006-tenant-isolation-and-data-separation.md),
[ADR 0007](0007-identifiers-and-geometry-units.md), [ADR 0026](0026-circuits-cables-and-cable-paths.md)
Entwurf: [`docs/phase-6c-design.md`](../phase-6c-design.md) §7, §8

## Context

Seit 6b trägt jede Leitung ihre tatsächlichen Kabelangaben, Zugaben und eine feste Reserve in mm; die
einzige Vorschlagsquelle ist der Stromkreis (D6), Projekt- oder Betriebsstandards sind ausdrücklich
ausgeschlossen (D5). In der Praxis wiederholt der Planer dieselben Werte für jede Leitung (z. B. 20 %
Reserve, NYM-J 3 × 1,5 für Steckdosen). Gewünscht sind Betriebsstandards, projektbezogene Vorgaben und
ausdrückliche Abweichungen je Leitung – ohne dass bestehende Leitungen still umgeschrieben werden und
ohne doppelte Reserve in der späteren Materialberechnung.

## Decision (vorgeschlagen)

1. **Ebenen:** Betriebsstandard (je Organisation), Projektvorgabe (je Projekt, feldweise leer =
   Betriebsstandard), Stromkreisvorgabe (vorhandene `proposed_*`, wirksam nur bei ausdrücklicher
   Aktivierung), Leitung. Eigentümer ist das Modul `electrical`;
   kein Fachwissen im Core.
2. **Kabelvorlage** = technisches Tripel (Typ, Leiteranzahl, Querschnitt) mit Name, ohne Preis; je
   Organisation; Zuordnung einer Vorlage je Gerätetyp (Betrieb, im Projekt abweichend).
3. **Eine Kette je Wertegruppe**, erste Stufe mit Wert gewinnt, keine Mischung:
   Kabelangaben: ausdrücklich abweichende Angaben an der Leitung → **ausdrücklich aktivierte**
   Stromkreisvorgabe → Vorlage je Gerätetyp (Projekt, sonst Betrieb) → allgemeine Standardvorlage
   (Projekt, sonst Betrieb) → sichtbar fehlende Angaben. *(F1 bestätigt)* Aktiviert wird am Stromkreis
   mit „Für neue Leitungen dieses Stromkreises diese Kabelvorgabe verwenden“
   (`proposal_overrides_templates`, Standard `false`); ohne Aktivierung sind die Stromkreiswerte nur ein
   Hinweis und werden nicht vorbelegt. Reserve und Anschlusszugaben: Leitung → Projekt →
   Betrieb → 0. Maßgeblich für die Gerätetypvorlage ist das Zielgerät; eine Verteilung bestimmt nie die
   Vorlage.
4. **Keine Laufzeitvererbung:** Vorgaben belegen beim Anlegen bzw. im Abschlussdialog vor; gespeichert
   werden die Werte an der Leitung mit ihrer **Herkunft** je Gruppe (`circuit_override`,
   `device_type_template`, `default_template`, `project_default`, `office_default`, `manual`, `legacy`).
5. **Reserve in Prozent** der geometrischen Länge (`numeric(5,2)`, API-String), abgeleitet und nicht
   gespeichert: `r = ⌈g · p / 100⌉` ganzzahlig (auf ganze mm **aufgerundet**, Prozentsatz mit höchstens zwei
   Nachkommastellen – *F2 bestätigt*), nur bei Status `confirmed`. Feste Anschlusszugaben je
   Endpunktart (Verteilung, Abzweigdose, Gerät) getrennt. Die bisherige feste Reserve bleibt als Modus
   `fixed`.
6. **Bestand:** Migration setzt Modus `fixed` und Herkunft `legacy`, ändert keinen Wert – jede Leitung
   bleibt gleich lang. Alle vorhandenen Stromkreise erhalten `proposal_overrides_templates = false`;
   vorhandene Stromkreiswerte gelten nie automatisch als aktivierter Vorrang. Umstellung nur über die zentrale Anwendung.
7. **Zentrale Anwendung** nur ausdrücklich: Vorschau (lesend) und Anwenden (atomar, Versionen aller
   Leitungen und der Vorgabenbasis, bei einer Abweichung `409` und nichts geändert). Abweichende und
   Altbestandsleitungen nur bei ausdrücklicher Wahl.
8. **Vorgabenbasis beim Speichern:** Gruppen mit Vorgabenherkunft senden die Versionen der genutzten
   Vorgaben; geänderte Vorgaben → `409 planning-defaults-changed`, nichts gespeichert, ausdrückliche
   Entscheidung in der Oberfläche.
9. **Endgerät optional:** eine Leitung ohne Endgerät ist zulässig und `incomplete` („Endgerät fehlt“).
   Ein nicht zugeordnetes Endgerät kann beim Speichern ausdrücklich dem Stromkreis zugeordnet werden
   (gleiche Transaktion, zusätzlich `electrical.circuit.write`); nie Umhängen.
10. **Trennung für Phase 7/8:** Electrical übergibt Bedarf (Weg + Zugaben) und Planungsreserve getrennt;
    auf Leitungen mit Planungsreserve wird kein Material-Verschnitt angewandt; Verpackungsrundung danach.
    Die Contract-Änderung entscheidet ein Phase-7-ADR.
11. Neues Recht `electrical.defaults.manage` (Betriebsstandard, Vorlagen); Projektvorgaben, Anwendung und
    Abweichungen mit `electrical.route.write`. Keine Events.

## Considered Options

* **Laufzeitvererbung** (Leitung liest Vorgabe bei jedem Lesen): eine Vorgabenänderung würde geplante
  Mengen still ändern. Verworfen.
* **Allgemeine Regel-Engine / Bedingungsausdrücke:** mächtig, aber nicht vorhersehbar und schwer prüfbar.
  Verworfen; eine feste, dokumentierte Kette genügt.
* **Stromkreisvorschlag stets vor Gerätetypvorlage** (ursprüngliche Empfehlung): würde die vorhandenen,
  bisher nur informativen Stromkreiswerte unbemerkt zur stärksten Quelle machen und Sonderfälle wie
  Schalterleitungen überstimmen. Vom Auftraggeber verworfen (F1); stattdessen ausdrückliche Aktivierung
  je Stromkreis.
* **Gespeicherter Reservebetrag:** veraltet bei jeder Wegänderung. Verworfen; Prozentsatz speichern.
* **Kaufmännisch runden:** kann die Reserve um 0,5 mm unterschreiten. Aufrunden bestätigt (F2).
* **Teilweises Anwenden bei Konflikten:** schwer nachvollziehbar. Verworfen; atomar.

## Umsetzungsnotizen (V1, 2026-10-23)

* Tabellen gekürzt benannt (`electrical_type_templates`, `electrical_project_defaults`,
  `electrical_proj_type_templates`), weil abgeleitete Constraint-Namen sonst 63 Zeichen überschritten.
* Sperre betriebsweiter Vorgaben: PostgreSQL-Advisory-Sperre je Betrieb (exklusiv beim Schreiben, geteilt nach
  der Projektsperre beim Lesen und Prüfen) – deckt auch die noch nicht angelegte Zeile ab; kein Zyklus.
* Vorgabenbasis: Versionen im Körper (`expected_version`, `defaults_basis`); `0` = noch keine Zeile.
* Herkunft zusätzlich `none` (Kette ohne Wert). Bisherige Clients ohne Herkunftsangabe: unveränderte Gruppen
  behalten ihre Herkunft, geänderte werden `manual`.

## Consequences

* Eine Migration (Vorlagen, Vorgaben, neue Spalten an `electrical_cables`, `end_device_id` NULL), Seed für
  das neue Recht; Längenfunktion und Fixture erhalten die Prozentreserve (Backend und Frontend-Spiegel).
* API: `CableIn`/`CableOut` erweitert; `allowance_mm` behält seine Bedeutung, neue getrennte Felder.
* Core erhält generisch `writable_project_context` (kein Fachwissen).
* Die Mengenübersicht weist Weg, Reserve und Zugaben getrennt aus.
* Phase 7 muss die Trennung Planungsreserve/Verschnitt im Contract abbilden.
