# 0019 — Persönliche Darstellungseinstellungen: lokal je Benutzer, versioniert

Status: superseded by [0021](0021-user-lifecycle-account-locks-password-reset-preferences.md) (Speicherort)
Datum: 2026-09-30

> **Abgelöst in Phase 4e:** Die Einstellungen liegen jetzt serverseitig je Benutzer und
> Betrieb; der Browser hält nur einen Cache je Mitgliedschaft
> (`elektroplan.einstellungen.<member_id>`). Die lokalen Schlüssel dieses ADR werden einmalig
> an den Server übertragen und danach gelöscht. Vorschau, Validierung, Wurzelattribute und
> „keine Anwendung vor der Anmeldung“ gelten unverändert.
Betrifft: Phase 4c.2 (persönliche Darstellung)
Baut auf: [ADR 0018](0018-frontend-styling-tailwind-and-theme-tokens.md) (Tokens und
Wurzelattribute)

## Context

Phase 4c.2 führt persönliche Einstellungen für Darstellungsmodus (Wie das System, Hell,
Dunkel) und Akzentfarbe ein. Seit Bedienungsnacharbeit 2 gibt es mit der Maßeinheit bereits
eine persönliche Einstellung, die lokal im Browser je `user_id` liegt
(`elektroplan.masseinheit.<user_id>`). Die Phase schließt Backend-, API- und
Datenbankänderungen ausdrücklich aus.

## Problem

1. Wo liegt die Wahl, ohne das Backend zu ändern – und ohne dass ein zweiter Benutzer
   desselben Browsers sie sieht?
2. Wie bleibt ein gespeicherter Wert lesbar, wenn sich das Format später ändert?
3. Wie wird eine spätere serverseitige Speicherung möglich, ohne Komponenten umzuschreiben?

## Considered Options

* **A) Serverseitig am Benutzerkonto.** Geräteübergreifend, aber Migration, API und
  Berechtigung – in dieser Phase ausgeschlossen.
* **B) Browserweit ein Schlüssel.** Einfach, aber ein zweiter Benutzer desselben Browsers
  sähe fremde Einstellungen; nach dem Abmelden bliebe das Theme des Vorgängers stehen.
* **C) Lokal je `user_id`, versioniertes JSON, gekapselt in einer Core-Datei.** Wie die
  Maßeinheit, dazu ein Versionsfeld und Validierung.

## Decision

**Option C.**

* Schlüssel `elektroplan.darstellung.<user_id>`, Wert
  `{"version":1,"modus":"system"|"light"|"dark","akzent":"blue"|"teal"|"green"|"violet"|"orange"}`.
* **Validierung:** unlesbares JSON, ein anderer Typ oder eine andere Version → Standard
  (`system`, `blue`). Ein fehlendes oder unbekanntes Feld → nur dieses Feld auf Standard.
* **Benutzerbindung:** `AuthProvider` meldet die `user_id` (oder `null` beim Laden und
  nach dem Abmelden) – dieselbe Stelle, die schon die Maßeinheit bindet. Die
  Darstellungslogik selbst liegt ausschließlich in `core/theme/darstellung.ts`.
  Ohne angemeldeten Benutzer gilt der Standard; ein Betriebswechsel behält dieselbe
  `user_id` und damit die Einstellung.
* **Mehrere Tabs:** Das `storage`-Ereignis für den eigenen Schlüssel übernimmt eine
  Änderung aus einem anderen Tab sofort; Schlüssel anderer Benutzer werden ignoriert.
* **Ohne nutzbaren Speicher** (gesperrt, privates Fenster, Kontingent) gilt die Wahl bis
  zum Neuladen; die Anwendung bleibt bedienbar.
* **Einstellungsdialog:** Darstellung, Akzent und Maßeinheit verhalten sich gleich – Wahl
  sofort als Vorschau, gespeichert erst mit „Übernehmen", Abbrechen/Escape/✕ stellen den
  gespeicherten Stand her. Die Maßeinheit hat dafür ebenfalls eine Vorschau erhalten; ihr
  früheres Sofort-Speichern entfällt.
* Keine Anwendung vor der Anmeldung: Anmeldeseite und Ladezustand zeigen den Standard
  (Wie das System, Blau). Ein anderes Theme erscheint erst nach der Anmeldung, vor dem
  ersten Bild der Anwendung (`useLayoutEffect`).

## Consequences

* Die Einstellung ist **browser- und gerätebezogen**: Auf einem anderen Gerät oder in
  einem anderen Browser gilt wieder der Standard. Sie bleibt, bis der Browser-Speicher
  gelöscht wird; Abmelden löscht sie nicht.
* Eine spätere Serverspeicherung ersetzt nur Lesen und Schreiben in
  `core/theme/darstellung.ts` (und analog `masseinheit.ts`); Komponenten, CSS und 3D-Szene
  bleiben unverändert. Das Versionsfeld erlaubt dann eine Übernahme bestehender lokaler
  Werte.
* Bei einer Wahl abweichend vom System kann beim Laden kurz der Standard erscheinen, bis
  die Sitzung geprüft ist. Das ist gewollt: Vor der Anmeldung ist nicht bekannt, wessen
  Einstellung gilt.
* Die Werte sind keine personenbezogenen Daten im Sinne einer Verarbeitung durch den
  Betrieb; sie verlassen den Browser nicht.
