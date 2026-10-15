# Prüfliste für die manuelle Gesamtprüfung Phase 6

**Stand:** 2026-10-14 · Phase 6 technisch umgesetzt und geprüft; **diese manuelle Gesamtprüfung durch
den Auftraggeber steht aus.** Die Liste ersetzt sie nicht – sie bereitet sie vor.

Kennzeichnung je Punkt: **[geprüft]** = von der KI im laufenden Stack über die Oberfläche geprüft
(Quelle in Klammern), **[offen]** = noch nie im Browser geprüft, **[nur Test]** = nur durch
automatisierte Tests abgedeckt. Alles Übrige ist bisher nicht durch eine Person geprüft.

---

## 0. Vorbereitung

1. Stack starten: Docker Desktop, dann im Projektordner `docker compose up -d`. Planner unter
   `http://localhost:5173`, Anmeldung mit dem Entwicklungskonto aus `.env.example`.
   Hinweis Windows: Der Planner-Container übernimmt Codeänderungen nicht selbst
   (`docker restart elektroplan-planner`); das Backend läuft aus dem Image
   (`docker compose build backend` nach Backendänderungen).
2. Prüfprojekte (alle synthetisch, keine Echtdaten):
   * **PR-2026-0010 „Gesamtprüfung Phase 6 (synthetisch)“** – für diese Liste angelegt (Entwurf §21.6):
     EG/OG/DG mit bestätigten Höhen, Diele mit Tür zur Küche und Durchgang zum Bad, gemeinsame
     Bauwände, Steigweg S1 mit **drei** Halten, UV1, F1/F2, Leitungen L1–L6 in allen Zuständen,
     eine nicht zugeordnete Steckdose, eine Netzwerkdose. **Empfohlen.**
   * PR-2026-0009 „Leitungsplanung 6b.5 (synthetisch)“ – Grundriss/Steigweg/3D (Entwurf §20.5).
   * PR-2026-0007 (archiviert) – Lesemodus (Entwurf §19.8).
3. Einstellungen bereithalten: Darstellung Hell/Dunkel, Maßeinheit mm/cm/m (Einstellungen oben rechts;
   „Abbrechen“ verwirft die Vorschau).

## 1. Verteilungen, Stromkreise, Gerätezuordnung (Ansicht „Stromkreise“)

* [ ] Verteilung anlegen, Lagegerät wählen; Code doppelt → verständliche Ablehnung.
* [ ] Stromkreis anlegen, Vorschlag (Typ, Leiter, Querschnitt) als „Vorschlag – wird nicht geprüft“.
* [ ] Geräte zuordnen und speichern; Gerät eines anderen Stromkreises wird nicht still umgehängt.
* [ ] Datendose und Lagegerät sind nicht zuordenbar.
* [offen] Zuordnungsmodus „Zuordnen“ (Z) in Wand- und Deckenansicht (6b.4, Gesamtprüfliste).

## 2. Wand-, Decken- und Fußbodenleitungen

* [geprüft] Neue Leitung in der Wandansicht zeichnen, Endgerät, Länge, speichern, neu laden (§19.8).
* [geprüft] Ziehen eines Wegpunkts = ein Rückgängig-Schritt; Pfeiltasten, Entf (§19.8).
* [geprüft] Wand → Decke → Wand im selben Entwurf (§19.8).
* [geprüft] Grundriss: Ebenenwahl Fußboden/Wand/Decke, Fußbodenpunkte nur in der Kontur,
  Raumwechsel ohne Übergang abgelehnt (§20.5).
* [geprüft] Ecke im Grundriss nahe der Raumecke ohne Fehlablehnung (§20.5).
* [ ] Deckenweg in der Deckenansicht mit Übergang von der Wand.
* [ ] Schnelles Klicken/Ziehen in Wand- und Deckenansicht übernimmt immer die letzte Lage (§20.7 A).

## 3. Durchführungen und Bodenübergänge

* [geprüft] Neue Durchführung im Grundriss, Gegenlage, speichern; Verwerfen hinterlässt nichts (§20.5).
* [ ] Neue Durchführung in der Wandansicht (Werkzeug „Durchführung“, U), Gegenseite ansehen.
* [ ] Ablehnungen: Wand ohne Nachbarraum, Zuordnung offen/getrennt, Abschnittsgrenze.
* [offen] Durchführung verschieben und entfernen im Browser (6b.4, Gesamtprüfliste).
* [geprüft] Bodenübergang an einer **Tür** (§20.5).
* [offen] Bodenübergang an einem **Durchgang** (Prüfprojekt: Diele ↔ Bad, L3).
* [ ] Fenster wird als Bodenübergang abgelehnt.

## 4. Steigwege und Geschosswechsel

* [geprüft] EG → OG über S1: Vorschau, übernehmen, „Weiter in OG“, Fortsetzung am Halt, speichern (§20.5).
* [offen] **Rückwärtige Nutzung** (OG → EG): Leitung im OG beginnen, Steigweg nach EG.
* [offen] **Teilnutzung mit drei Halten**: EG → OG, wenn S1 bis DG reicht; und EG → DG (Zwischenhalt
  durchfahren). Prüfprojekt: L5 (EG → OG), L6 (EG → DG).
* [nur Test] Unbestätigte Höhe: „unvollständig“, Teilsumme; widersprüchliche Höhe: nicht übernehmbar.
* [ ] Geschosswechsel im selben Gebäude behält den Entwurf ohne Rückfrage; anderes Gebäude fragt.
* [ ] Kleiner Maßstab/schmal: am Halt nur Pfeil, volle Angabe am gewählten Wegpunkt (§20.7 B).

## 5. 3D-Auswahl und Rückkehr

* [geprüft] Leitung wählen (Liste oder Szene), Status als Text, Fortsetzung an Geschossgrenze (§20.5).
* [geprüft] „Im Grundriss bearbeiten“ und zurück mit Kamera und Auswahl (§20.5, Nachweis §20.5 Nr. 6).
* [ ] „In der Wandansicht bearbeiten“ und Schließen → zurück in 3D.
* [offen] „In der Deckenansicht bearbeiten“ aus 3D.
* [offen] 3D im dunklen Theme optisch.

## 6. Bearbeiten, Undo/Redo, Speichern, Neuladen

* [geprüft] Rückgängig/Wiederholen über einen Geschosswechsel (kein eigener Schritt) (§20.5, Test).
* [ ] Navigationsschutz: Seite neu laden oder Projekt wechseln mit ungespeichertem Entwurf → Rückfrage.
* [ ] Speichern, F5, Vergleich von Wegpunkten, Länge und Status.

## 7. Konflikte, Löschschutz, Projektstatus

* [geprüft] Versionskonflikt: nichts überschrieben, Entwurf behalten, bewusst Serverstand laden (§19.8, §20.5).
* [geprüft] Unterbrechung nur mit genauer Bestätigung (§19.8); Tür entfernen → Leitung „Konflikt“.
* [ ] Löschschutz: Gerät, Wand, Raum, Öffnung, Steigweghalt mit Leitung → verständliche Ablehnung.
* [geprüft] Archiviertes Projekt nur lesbar (§19.8); [ ] abgeschlossenes Projekt ebenso, Mengen lesbar.

## 8. Mengenübersicht (Ansicht „Mengen“, 6b.6)

* [geprüft] Gruppen nach tatsächlichen Angaben; „1.5“ und „1.50“ in einer Gruppe (Prüfprojekt L1/L2) (§21.5).
* [geprüft] Bestätigt, offen (L4) und Konflikt getrennt; Weg und Zugaben getrennt; L3 unter
  „unvollständig spezifiziert“ mit „Querschnitt fehlt“.
* [ ] Trassen: Steigweg EG–OG von L5 und L6 einmal, Leitungsmeter je Leitung.
* [geprüft] Durchführungen in Stück (genutzt/ungenutzt), Bodenübergänge als Nutzungen.
* [geprüft] Geräte je Stromkreis; nicht zugeordnete Steckdose; Netzwerkdose nicht gemeldet.
* [geprüft] Aufschlüsseln bis zur Leitung, „Bearbeiten“, zurück mit aufgeklappter Gruppe.
* [ ] Offener Entwurf ist benannt; Übersicht speichert/verwirft nichts.
* [geprüft] Leitung ändern bzw. Durchgang mit Bestätigung entfernen → Menge wechselt von „bestätigt“ zu „Konflikt“.
* [geprüft] cm, Hell bei 375 px, Dunkel (§21.5); [nur Test] mm/m.

## 9. Darstellung (bisher nicht vollständig optisch geprüft)

* [offen] Dunkles Theme in Grundriss, Wand-/Deckenansicht, 3D und Mengen.
* [offen] Maßeinheit Meter in allen Leitungsansichten.
* [offen] Echte Touch-Bedienung (Tablet/Telefon) – mit den vorhandenen Werkzeugen nicht prüfbar.

## 10. Kurzregression früherer Phasen

* [ ] Anmelden, Abmelden, Sitzung nach Neuladen; Benutzerwechsel zeigt keine fremden Entwürfe/Mengen.
* [ ] Kunden: anlegen, suchen, bearbeiten.
* [ ] Projekte: anlegen, Status „In Bearbeitung“, abschließen, archivieren, Löschprüfung.
* [ ] Gebäude/Geschosse: anlegen, Höhenlage bestätigen.
* [ ] Dateien: hochladen, herunterladen, löschen.
* [ ] Administration: Mitglied einladen, Rolle ändern, sperren/entsperren; persönliche Einstellungen.
* [ ] Räume: Rechteck- und Polygonraum, Tür/Fenster in der Wandansicht, Geräte setzen, Wandzuordnung.

**Nicht Bestandteil:** Material, Artikel, Preise, Kalkulation (Phase 7+), Normprüfung oder Bemessung.
