# 0028 — Lage und Aufbau einer Verteilung (Phase 6c)

Status: **proposed** (2026-10-15) – Entwurf. **Einzelentscheidungen bestätigt** (2026-10-15):
F3 (Komponentenarten, manueller Aufbau, keine Auslegung) und F5 (Umsetzen mit Leitungen abgelehnt).
**Teil „Lage“ umgesetzt** (Schritt VP, 2026-10-25, `PUT /distribution-boards/{id}/placement`, Entwurf 6c
§23); Teil „Aufbau“ (6c.7) nicht umgesetzt
Betrifft: Phase 6c (Schritte 6c.3 und 6c.7)
Präzisiert: [ADR 0026](0026-circuits-cables-and-cable-paths.md) Nr. 1 (D1: Lage über ein Gerät
`distribution_board`)
Baut auf: [ADR 0006](0006-tenant-isolation-and-data-separation.md), [ADR 0023](0023-electrical-devices-symbols-room-types.md),
[ADR 0026](0026-circuits-cables-and-cable-paths.md); Sicherheitsgrenze [`security.md`](../security.md) §17
Entwurf: [`docs/phase-6c-design.md`](../phase-6c-design.md) §6, §9

## Context

Eine Verteilung ist seit 6b.0 ein elektrischer Bezugspunkt; ihre Lage ist ein Gerät vom Typ
`distribution_board`. Dieses Gerät entsteht heute im Raumentwurf (`PUT /rooms/{id}/contour`), die
Verknüpfung getrennt über `PATCH /distribution-boards/{id}`. Zwei Entwürfe und zwei Transaktionen
erlauben ein Lagegerät ohne Verteilung, doppelte Lagegeräte und verlorene Zuordnungen. Zusätzlich soll
der **Aufbau** einer Verteilung (Reihen, Teilungseinheiten, Komponenten, Zuordnung zu Stromkreisen,
Vorlagen) planbar werden – ohne Auslegung und ohne zweite Verteilungsidentität.

## Decision (vorgeschlagen)

1. **Eine Identität:** Die Verteilung (`electrical_distribution_boards`) bleibt die einzige Identität.
   Lagegerät = räumliche Lage, Komponenten = eingebaute Teile, Stromkreise = logische Einheiten; alle
   hängen an der vorhandenen Verteilung.
2. **Atomare Platzierung:** `PUT /distribution-boards/{id}/placement` (If-Match der Verteilung,
   `expected_room_version`) legt das Lagegerät an bzw. verschiebt oder setzt es um und verknüpft es in
   **einer** Transaktion (Projekt → Verteilung → Räume nach ID → Prüfung mit den Geräteregeln des
   Raumentwurfs). Rechte `electrical.circuit.write` und `electrical.plan.write`. Umsetzen an eine andere
   Wand nur ohne Leitungen am Lagegerät (`409 board-placement-has-cables`; die Meldung nennt jede
   betroffene Leitung mit Stromkreis, Bezeichnung und Endgeräten – *F5 bestätigt*). `DELETE …/placement` nur
   ohne Leitungen.
3. Der Gerätetyp „Verteilung“ wird **nicht mehr frei** über die Gerätepalette gesetzt; vorhandene
   unverknüpfte Lagegeräte bleiben und werden sichtbar gemeldet.
4. **Aufbau:** Reihen mit konfigurierbarer Kapazität in Teilungseinheiten (TE), Komponenten mit Art
   (Hauptschalter, FI, LS, FI/LS, Überspannungsschutz, Klemme, Sonstiges – *F3 bestätigt*), Platz, Breite, Freitextangaben ohne Auswertung,
   optional geschützter Stromkreis (höchstens eine Komponente je Stromkreis) und vorgeschaltete
   Komponente. Speichern als Ganzes mit `layout_version`, stabile Komponenten-IDs.
5. **Harte Regeln** nur strukturell (Kapazität, Überlappung, gleiche Verteilung, keine Zyklen). Fachliche
   Regeln nur als **nutzerdefinierte Hinweise** (Zielreserve freier TE, höchstens N Stromkreise je FI,
   fehlende Zuordnungen, Abweichung zur Freitextangabe am Stromkreis), nie blockierend, nie als Prüfung
   bezeichnet.
6. **Vorlagen:** Komponentenvorgaben und Aufbauvorlagen je Organisation (`electrical.defaults.manage`),
   anfangs leer – keine mitgelieferten Standardauslegungen. Anwenden auf eine belegte Verteilung nur nach
   Vorschau und Bestätigung; Stromkreise werden weder angelegt noch zugeordnet.
7. Keine Events, kein Core-Fachwissen, keine Material- oder Preisbezüge in 6c.

## Considered Options

* **Platzierung im Raumentwurf mitsenden** (Erweiterung von `PUT /rooms/{id}/contour`): deckt das Umsetzen
  in einen anderen Raum nicht ab und würde fremde ungespeicherte Raumänderungen mitspeichern. Verworfen.
* **Verteilung mit eigener Geometrie** statt Lagegerät: zweite Geometrie, widerspricht D1. Verworfen.
* **Komponenten als Geräte im Raum:** vermischt räumliche und elektrische Ebene. Verworfen.
* **Komponentenkatalog mit Bemessungsdaten und Auswertung:** führt in Dimensionierung (`security.md` §17).
  Verworfen; Freitext bis zu einer eigenen fachlichen Erweiterung.
* **Automatische Aufbauerzeugung aus Stromkreisen:** nicht vorhersehbar ohne fachliche Regeln. Später.

## Consequences

* 6c.3 ohne Migration; 6c.7 mit einer Migration (Reihen, Komponenten, Vorlagen, Spalten an Verteilungen)
  und Löschreihenfolge im `ProjectContentParticipant`.
* Die Freitextfelder `protective_device`/`rcd_group` am Stromkreis bleiben; Abgleich mit dem Aufbau nur
  ausdrücklich.
* Artikel- und Leistungsbezug von Komponenten folgt in Phase 7/8 über öffentliche Contracts.
