# 0020 — Datenlebenszyklus: Löschregeln, Wiedereröffnung, Löschschutz-Protokoll

Status: accepted
Datum: 2026-09-30
Betrifft: Phase 4d (Datenlebenszyklus, Löschregeln, Bearbeitungsmetadaten)
Baut auf: [ADR 0001](0001-modular-monolith.md), [ADR 0003](0003-module-contracts-and-provider-ports.md),
[ADR 0006](0006-tenant-isolation-and-data-separation.md), [ADR 0012](0012-event-delivery-guarantee.md)
Hebt auf: die Kundenanonymisierung aus Phase 2 (`docs/security.md`, Abschnitt 13, Stand
vor 4d) und das Ausblenden (Soft Delete) von Kunden und Projekten

## Context

Bis Phase 4c.2 kannte ElektroPlan drei „Löschwege": Ausblenden (`deleted_at`) für Kunden
und Projekte, die Anonymisierung von Kunden (`anonymized_at`, Art. 17 DSGVO) und das harte
Löschen von Struktur (Gebäude, Geschosse, Räume). Versehentlich angelegte Projekte ließen
sich nicht entfernen, abgeschlossene Projekte blieben in der Hauptliste, und ein
abgeschlossenes Projekt konnte niemand wieder öffnen. Gleichzeitig darf der Core keine
Tabelle eines Fachmoduls kennen (ADR 0001) – muss aber vor dem Löschen eines Projekts
**verbindlich** wissen, ob ein Modul Daten daran hat.

## Problem

1. Welche Projekte und Kunden dürfen wer wann endgültig löschen?
2. Wie fragt der Core Fachmodule nach Projektinhalten und lässt sie löschen, ohne sie zu
   kennen – synchron, atomar und erweiterbar?
3. Wie bleiben Datenbank und Object Storage konsistent, obwohl sie keine gemeinsame
   Transaktion haben?
4. Wie kommt ein abgeschlossenes Projekt zurück, ohne die Statusregeln aufzuweichen?
5. Was bleibt nach einer Löschung übrig (Audit, Nummern, Backups)?

## Considered Options

* **A) Weiter ausblenden, Anonymisierung behalten.** Keine Datenänderung, aber drei
  Zustände nebeneinander, keine echte Löschung versehentlicher Projekte, und Kunden mit
  Platzhalternamen bleiben dauerhaft in Listen.
* **B) Cascade in der Datenbank.** Ein `ON DELETE CASCADE` von Projekt bis Raum würde
  alles mitnehmen – auch Storage-Schlüssel ohne Spur, und der Core müsste Modultabellen
  per FK kennen. Keine Leerheitsprüfung über Module hinweg.
* **C) Event „Projekt wird gelöscht".** Module räumen per Event auf. Widerspricht ADR
  0004/0012: *at most once*, nach dem Commit – für eine Löschentscheidung ungeeignet.
* **D) Synchroner Teilnehmer-Contract über die Module Registry, physische Löschung,
  persistente Storage-Aufräumwarteschlange.**

## Decision

**Option D.**

### Löschregeln

| Objekt | Bedingung | Berechtigung | Standardrollen |
|---|---|---|---|
| Projekt, leer | Status `draft` oder `active` | `project.record.delete` | Administrator, Planer (genau die Rollen mit `project.record.write`) |
| Projekt mit Inhalt | Status `draft` oder `active`, Projektnummer als Bestätigung | `project.record.purge` | **nur** Administrator |
| Projekt `completed`/`archived` | nie direkt | – | `409 project-not-deletable` |
| Kunde | kein einziges Projekt zugeordnet (jeder Status) | `customer.record.delete` | **nur** Administrator |
| Wiedereröffnung `completed → active` | nur aus `completed`; `archived` bleibt endgültig | `project.record.reopen` | **nur** Administrator |

`ADMIN_ONLY_PERMISSIONS` hält die drei Administratorrechte fest; ein Architekturtest
verhindert, dass eine andere Systemrolle oder ein `default_roles` eines Moduls sie
vergibt. `customer.record.anonymize` ist entfernt.

**Leeres Projekt** (deterministisch, ohne Namen): keine Dateizeile mit dieser
`project_id`, höchstens **ein** Gebäude mit insgesamt höchstens **einem** Geschoss, und
kein Teilnehmer meldet Inhalte. Die leere Startstruktur der Projektanlage wird mit dem
Projekt entfernt.

**Bestätigung.** Ein Projekt mit Inhalt wird nur gelöscht, wenn die Anfrage
`confirm_project_number` exakt mitsendet (`409 deletion-confirmation-required` sonst).
Das ist Absichtserklärung, keine Autorisierung: Es schützt davor, dass eine veraltete
Vorprüfung („leer") Inhalte löscht, die inzwischen entstanden sind.

### Transaktionsgrenze der Projektlöschung

In **einer** Transaktion, die der Core besitzt:

1. Projektzeile sperren (`SELECT … FOR UPDATE`, fremder Mandant: `404`),
2. `If-Match` prüfen (`428`/`409`),
3. Status prüfen (`409`),
4. Inhalte über Core und Teilnehmer ermitteln,
5. Berechtigung prüfen (`403`), Bestätigung prüfen (`409`),
6. jeder Teilnehmer löscht seine Daten; danach Nachkontrolle, dass keiner mehr Inhalte
   meldet,
7. Storage-Schlüssel der Dateien in `storage_cleanup_jobs` vormerken, Dateizeilen löschen,
8. Projekt löschen (Gebäude und Geschosse per `CASCADE`; ein verbleibender `RESTRICT`
   bricht kontrolliert ab),
9. Audit-Eintrag, Commit.

Jeder Schreibweg, der Projektinhalte erzeugt, sperrt dieselbe Projektzeile zuerst
(Phase 3.1). Nach der Sperre kann nichts mehr entstehen, was Schritt 4 nicht gesehen
hätte; ein wartender Schreibvorgang findet das Projekt danach nicht mehr (`404`). Ein
Datei-Upload, dessen Fremdschlüsselprüfung auf die Löschung wartet, endet ebenfalls in
`404` statt `500`.

### Löschschutz-Protokoll Core – Registry – Fachmodule

Contract `app/contracts/v1/project_lifecycle.py`:

* `ProjectContentRequest(organization_id, project_id)`
* `ProjectContentReport(module_id, has_content, items)`; `items` sind
  `ProjectContentItem(code, label, count)`, Code stabil als `<modul>.<art>`
* `ProjectContentParticipant` (Protocol):
  `describe_project_content(session, request)` – nur lesen;
  `delete_project_content(session, request)` – nur eigene Daten, ohne Commit

Registrierung über die **bestehende** Module Registry: `ModuleDescriptor.provides =
(bind_port(ProjectContentParticipant, Implementierung),)`. `ModuleRegistry.
port_implementations(port)` liefert die Teilnehmer **nach Modul-ID sortiert**; je Modul
und Port ist höchstens eine Bindung erlaubt (sonst verweigert die Registry den Start),
Signaturen werden wie bei jedem Port geprüft. Ein neues Modul nimmt teil, ohne dass sich
`ProjectDeletionService` ändert.

Fehler: Wirft ein Teilnehmer, rollt die gesamte Löschung zurück (`500
project-deletion-failed`, „es wurde nichts verändert"). Fachliche `AppError` eines
Teilnehmers werden unverändert weitergereicht.

**Abweichung von Regel 4 der Provider-Ports** (docs/modules.md, Abschnitt 4: „Ein Port
darf nicht schreiben"): Der Teilnehmer ist kein Datenlieferant, sondern Teil einer vom
Core koordinierten Operation. Er schreibt ausschließlich löschend, ausschließlich eigene
Tabellen, ausschließlich in der vom Core gehaltenen Transaktion.

Electrical implementiert den Contract für Räume, Wände und Öffnungen; die Geschosse eines
Projekts erfährt es über den öffentlichen Zugang `FloorPlanningAccess.floor_ids_of_project`.
Dateien und Gebäudestruktur prüft der Core selbst.

Domain Events melden die Löschung nicht: Es gibt keinen Konsumenten (docs/events.md,
Abschnitt 6). Das Audit-Protokoll hält sie fest. Ein späteres Event
`core.project.deleted` dürfte die Löschung melden, nie entscheiden.

### Storage-Grenze

Keine atomare Transaktion zwischen PostgreSQL und MinIO – und keine solche Behauptung.
Die Schlüssel stehen **vor** dem Löschen der Dateizeilen in derselben Transaktion in
`storage_cleanup_jobs`. Nach dem Commit wird gelöscht; Erfolg entfernt den Auftrag, ein
Fehler erhöht `attempts` und hält `last_attempt_at` und `last_error` (ohne Adressen)
fest. `python -m app.cli storage-cleanup` arbeitet offene Aufträge idempotent ab
(`SKIP LOCKED`). Die API antwortet auch bei Storage-Fehler `204` – das Projekt ist
gelöscht, das Objekt steht zur Wiederholung an.

### Wiedereröffnung

Eigener Endpunkt `POST /projects/{id}/reopen`, eigene Berechtigung, eigene Konstante –
**kein** Eintrag in `PROJECT_STATUS_TRANSITIONS`, keine freie Statusauswahl. Ein
wiedereröffnetes Projekt ist ein gewöhnliches aktives Projekt: beschreibbar, erneut
abschließbar, archivierbar und – als aktives Projekt – nach den Regeln oben löschbar.

### Kunden

Physische Löschung aus der operativen Datenbank unter der Kundensperre; Projektanlage
und Kundenwechsel sperren dieselbe Zeile. Die Anonymisierung ist ersatzlos entfallen
(Route, Service, Berechtigung, Spalte `anonymized_at` per Migration `0006`). Bereits
anonymisierte Entwicklungsdatensätze bleiben mit ihrem Platzhalternamen stehen.

### Ausblenden (Soft Delete) abgeschafft

Soft Delete für Kunden und Projekte ist mit Phase 4d **abgeschafft**: Migration `0006`
entfernt `customers.deleted_at` und `projects.deleted_at`, **löscht dabei keine Zeile**,
und zuvor ausgeblendete Kunden und Projekte sind danach wieder normal sichtbar (Projekte
je nach Status in der laufenden oder historischen Ansicht). Für sie gelten die Regeln
dieser ADR. Archivierung ist ausschließlich der Projektstatus `archived`.

Warum nicht ausgeblendet lassen: Ein unsichtbares Altprojekt ließe sich weder öffnen
noch löschen, würde die Kundenlöschung aber korrekt blockieren – der Kunde wäre dauerhaft
unlöschbar. `DELETE` bedeutet für Kunden und Projekte endgültiges Löschen.

**Downgrade-Grenze:** Ein Rückbau von `0006` legt `deleted_at` wieder leer (nullable) an;
frühere Ausblendemarkierungen lassen sich nicht rekonstruieren.

### Minimale Auditdaten

`project.deleted`: Projekt-ID, Projektnummer, Inhaltscodes, Dateianzahl.
`customer.deleted`: Kunden-ID, Kundennummer. Dazu wie immer Mandant, Akteur, Zeitpunkt,
Request-ID. **Keine** Namen, Anschriften, E-Mail-Adressen. „Physisch gelöscht" heißt:
aus der operativen Datenbank. Backups enthalten den Datensatz bis zum Ablauf ihrer
Aufbewahrungsfrist.

### Nummern

Projekt- und Kundennummern werden nie wiederverwendet: Die Nummernkreise zählen nur hoch
(`number_sequences`), eine Löschung setzt sie nicht zurück.

### Bearbeitungsmetadaten

`created_by_user_id`/`updated_by_user_id` (seit `0003`, `ON DELETE SET NULL`) werden als
`created_by`/`updated_by` (`kind` = `member` | `unknown` | `system`) ausgeliefert, je
Liste mit einer gesammelten Abfrage. Namen nur für Mitglieder des eigenen Betriebs.
Änderungen unterhalb des Projekts (Gebäude, Geschosse, Dateien, Planungsdaten) „berühren"
das Projekt (`updated_at`, `updated_by_user_id`) **ohne Versionssprung** – Fachmodule über
`FloorPlanningAccess.record_project_change`.

## Consequences

**Positiv:** Ein klarer Lebenszyklus; versehentliche Projekte verschwinden restlos; die
Löschentscheidung ist atomar und unter Nebenläufigkeit nachgewiesen (echte
PostgreSQL-Tests gegen Upload, Raumanlage und Statuswechsel); neue Module nehmen ohne
Core-Änderung teil; Storage-Reste sind sichtbar und nachholbar.

**Negativ:** Die Aufräumwarteschlange ist nicht zeitgesteuert (Werkzeug, kein Job). Das
Löschen eines Projekts hält die Projektsperre, solange alle Teilnehmer arbeiten. Ein
archiviertes Projekt hält seinen Kunden dauerhaft (bewusst: archiviert ist endgültig).

**Neutral:** Die Projektversion schützt weiterhin nur Stammdaten und Status; das Berühren
ändert sie bewusst nicht.
