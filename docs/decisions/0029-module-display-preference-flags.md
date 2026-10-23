# 0029 — Modulbezogene persönliche Anzeigeeinstellungen (Phase 6c)

Status: **proposed** (2026-10-15) – Entwurf, nicht umgesetzt. **F4 bestätigt** (2026-10-15): auch Wandgeräte,
Deckengeräte und Beschriftungen werden so gespeichert (Umsetzung in 6c.1)
Betrifft: Phase 6c (Schritt 6c.1)
Erweitert: [ADR 0021](0021-user-lifecycle-account-locks-password-reset-preferences.md) (serverseitige
Einstellungen: bisher genau drei typisierte Werte)
Baut auf: [ADR 0003](0003-module-contracts-and-provider-ports.md), [ADR 0006](0006-tenant-isolation-and-data-separation.md),
[ADR 0021](0021-user-lifecycle-account-locks-password-reset-preferences.md)
Entwurf: [`docs/phase-6c-design.md`](../phase-6c-design.md) §5

## Context

Die 3D-Ansicht soll Leitungen ausblenden können; die Einstellung soll persönlich gespeichert werden und
nach dem Neuladen gelten. Persönliche Einstellungen liegen seit 4e im Core (`user_preferences`, genau
Darstellung, Akzent, Maßeinheit; `PUT` als Ganzes mit `If-Match`; Browser nur Cache je Mitgliedschaft).
Eine Spalte „Leitungen in 3D“ im Core wäre Electrical-Wissen im Core; eine zweite Ablage im Modul oder
im `localStorage` wäre eine parallele Speicherung. Die vorhandenen 3D-Schalter (Wandgeräte, Deckengeräte,
Beschriftungen) gehen heute beim Neuladen verloren.

## Decision (vorgeschlagen)

1. Module **deklarieren** typisierte Ja/Nein-Anzeigeschalter im `ModuleDescriptor`
   (`display_flags: tuple[DisplayFlagDef, ...]` mit `key`, `default`, `label`), analog zu ihren
   Berechtigungen. Schlüssel im Namensraum des Moduls (`electrical.plan3d.show_cables`).
2. Der Core speichert sie **generisch** in `user_preference_flags (organization_id, member_id, key, value)`
   je Mitgliedschaft, `ON DELETE CASCADE` mit der Mitgliedschaft.
3. Dieselbe Ressource `/me/preferences`: `flags` in `PreferencesIn`/`PreferencesOut`; `PUT` ersetzt den
   ganzen Stand, fehlende Schalter gelten als Standard; jede Änderung zählt die **eine** Version des
   Einstellungsstands hoch; Konflikte wie bisher (`409`, Serverstand gewinnt).
4. Nur registrierte Schlüssel aktiver Module, nur `bool` – unbekannte Schlüssel `422`. Keine JSON-Ablage,
   keine Freitexte, keine Zahlen.
5. Frontend: derselbe Cache je Mitgliedschaft (`elektroplan.einstellungen.<member_id>`, Cache-Version 3),
   angewendet über `core/einstellungen/persoenlich.ts`; Module lesen ihren Schalter über einen kleinen
   Hook. Keine weitere Ablage.

## Considered Options

* **Spalte im Core** (`show_cables_3d`): einfach, aber Fachbegriff im Core und je Schalter eine
  Core-Migration. Verworfen.
* **Eigene Tabelle und Route im Modul:** zweite Einstellungsressource mit eigener Version und eigenem
  Cache – genau die parallele Speicherung, die vermieden werden soll. Verworfen.
* **Nur `localStorage`:** gerätegebunden, widerspricht ADR 0021 (Server ist die Wahrheit). Verworfen.
* **Freie JSON-Ablage für Module:** unprüfbar. Verworfen.

## Consequences

* Eine Core-Migration (`user_preference_flags`), Erweiterung des `ModuleDescriptor` und der
  Einstellungsschemas; API-Client neu erzeugt.
* Zweiter Anwendungsfall vorhanden und bestätigt (F4): die bisherigen 3D-Schalter Wandgeräte,
  Deckengeräte und Beschriftungen nutzen denselben Weg.
* Entfernt ein Modul einen Schalter, bleiben gespeicherte Zeilen ungelesen; eine Bereinigung erfolgt mit
  der Migration, die den Schalter entfernt.
