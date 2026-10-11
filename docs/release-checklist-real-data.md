# Freigabe-Checkliste für echte Daten

**Stand:** 2026-10-10 (Sicherheitsauftrag, Befund 6) · **Ergebnis:** **nicht freigegeben**

Diese Liste ist **keine** Rechtsauskunft und **keine** Produktionsfreigabe. Sie hält fest,
was vor der ersten Verarbeitung echter personenbezogener Daten (Kunden, Ansprechpartner,
Mitarbeitende) vorliegen und **nachgewiesen** sein muss. Grundlage: `security.md`,
Abschnitte 8, 13, 14 und 16. Bis jeder Punkt den Status **erfüllt** trägt, gilt weiterhin:
**ausschließlich synthetische Testdaten**.

Nichts hier behauptet eine rechtliche Erfüllung. Personen sind bewusst **nicht** benannt –
die Zuordnung der Rollen zu Personen ist selbst ein offener Punkt (O-1).

## Statuswerte

| Status | Bedeutung |
|---|---|
| **offen** | nichts vorhanden |
| **teilweise** | Bausteine vorhanden, Nachweis oder Verfahren fehlt |
| **Entscheidung offen** | braucht eine Entscheidung des Auftraggebers, bevor gebaut oder dokumentiert werden kann |
| **erfüllt** | vorhanden **und** mit dem genannten Nachweis belegt |

## Rollen (ohne Personen)

| Rolle | Aufgabe in dieser Liste |
|---|---|
| **Verantwortlicher** | Betriebsinhaber bzw. Geschäftsleitung des Elektrofachbetriebs (Art. 4 Nr. 7 DSGVO); entscheidet, gibt frei |
| **Datenschutzberatung** | Datenschutzbeauftragte(r) oder externe Beratung – **ob** eine Benennung nötig ist, ist selbst offen (O-2) |
| **Betrieb/IT** | wer Server, Sicherung und Wiederherstellung betreibt |
| **Entwicklung** | Umsetzung in ElektroPlan |

## A. Auskunft und Export (Art. 15, 20)

| # | Punkt | Status | Benötigter Nachweis | Rolle |
|---|---|---|---|---|
| A-1 | Verfahren, alle Daten zu **einer** Person zusammenzustellen (Kunde, Ansprechpartner, Mitarbeitende) – je Tabelle aus `security.md` §13 „Feldliste“ | **offen** | dokumentiertes Verfahren + Probelauf mit synthetischer Person, Ergebnis vollständig gegen die Feldliste abgeglichen | Entwicklung, Verantwortlicher |
| A-2 | Export in einem gängigen, maschinenlesbaren Format | **offen** (keine Exportfunktion) | Funktion oder Skript + Test | Entwicklung |
| A-3 | Auskunft enthält auch Audit-Einträge mit Bezug zur Person und Dateien in Projekten | **offen** | Abgleich im Probelauf | Entwicklung |
| A-4 | Identitätsprüfung und Frist (ein Monat) für Anfragen | **Entscheidung offen** | schriftlicher Ablauf | Verantwortlicher, Datenschutzberatung |

## B. Aufbewahrung

| # | Punkt | Status | Benötigter Nachweis | Rolle |
|---|---|---|---|---|
| B-1 | Festlegung je Tabelle: löschbar oder aufbewahrungspflichtig (HGB/AO/GoBD 6 bzw. 10 Jahre) | **Entscheidung offen** | Tabelle je Entität mit Frist und Grund, freigegeben | Verantwortlicher, Datenschutzberatung |
| B-2 | Audit 12 Monate, Anwendungslogs 30 Tage (Vorgabe `security.md` §13 Punkt 9) | **teilweise** – Vorgabe dokumentiert, **keine** automatische Bereinigung | Job oder Betriebsanweisung + Nachweis eines Laufs | Entwicklung, Betrieb/IT |
| B-3 | Einladungen nach Frist entfernen | **teilweise** – `python -m app.cli purge-invitations` vorhanden, nicht geplant | geplanter Lauf + Protokoll | Betrieb/IT |
| B-4 | Aufbewahrungsfrist der Datensicherungen | **Entscheidung offen** | festgelegte Frist, im Sicherungskonzept (D) | Verantwortlicher, Betrieb/IT |

## C. Löschung und Anonymisierung – auch nach einer Wiederherstellung

| # | Punkt | Status | Benötigter Nachweis | Rolle |
|---|---|---|---|---|
| C-1 | Kunde ohne Projekte physisch löschen | **teilweise** – umgesetzt und getestet (Phase 4d, ADR 0020); Kunden **mit** Projekten nicht löschbar | Verfahren für Kunden mit aufbewahrungspflichtigen Projekten (Abwägung B-1) | Verantwortlicher, Entwicklung |
| C-2 | Mitglied entfernen mit Bereinigung des Kontos (Tombstone) | **teilweise** – umgesetzt (Phase 4e, ADR 0021); nur für exklusive Konten | Verfahren für geteilte Konten | Entwicklung |
| C-3 | **Wiederholung von Löschungen nach einem Restore** (`security.md` §13 Punkt 8) | **offen** | Löschprotokoll, das einen Restore überdauert (z. B. getrennt gesichert) + Verfahren „nach Restore erneut anwenden“ + Probelauf | Entwicklung, Betrieb/IT |
| C-4 | Dateien gelöschter Projekte aus dem Object Storage | **teilweise** – Warteschlange `storage_cleanup_jobs`; nach einem Restore offen wie C-3 | Probelauf: Projekt löschen → Restore eines älteren Stands → Dateien wieder entfernt | Entwicklung, Betrieb/IT |
| C-5 | Löschung in Datensicherungen | **Entscheidung offen** – Sicherungen enthalten Daten bis zum Ablauf ihrer Frist | dokumentierte Regel (B-4 + C-3) | Verantwortlicher |

## D. Konsistente Sicherung von Datenbank und Dateien

| # | Punkt | Status | Benötigter Nachweis | Rolle |
|---|---|---|---|---|
| D-1 | PostgreSQL: tägliche Vollsicherung + WAL-Archivierung (`security.md` §14) | **offen** – nur ad hoc `pg_dump` in der Entwicklung | Sicherungsjob, Aufbewahrung, Überwachung | Betrieb/IT |
| D-2 | Object Storage getrennt gesichert, **konsistent** zum Datenbankstand (gleicher Zeitpunkt oder dokumentierte Reihenfolge) | **offen** | Verfahren + Nachweis, dass nach Restore jede `files`-Zeile ihr Objekt hat und umgekehrt | Betrieb/IT, Entwicklung |
| D-3 | Sicherungen verschlüsselt und getrennt vom Produktivsystem | **Entscheidung offen** | Speicherort, Zugriff, Schlüsselverwaltung | Betrieb/IT, Verantwortlicher |
| D-4 | RPO ≤ 24 h, RTO ≤ 8 h (Vorgabe `security.md` §14) | **offen** | gemessen im Restore-Test (E) | Betrieb/IT |

## E. Nachgewiesener Restore

| # | Punkt | Status | Benötigter Nachweis | Rolle |
|---|---|---|---|---|
| E-1 | Vollständiger Restore von Datenbank **und** Dateien in eine **getrennte** Umgebung | **offen** | Protokoll: Datum, Sicherungsstand, Dauer, Ergebnis der Prüfungen | Betrieb/IT |
| E-2 | Prüfung nach Restore: `alembic current` = Head, Anmeldung, Stichprobe Projekte/Dateien, Zuordnung `files` ↔ Objekte | **offen** | Prüfliste im Protokoll | Betrieb/IT, Entwicklung |
| E-3 | C-3 im Restore-Test ausgeführt | **offen** | Protokoll | Betrieb/IT |
| E-4 | Wiederholung (z. B. jährlich und nach größeren Änderungen) | **Entscheidung offen** | Turnus | Verantwortlicher |

Ein Restore wird **nie** auf die bestehende Entwicklungsdatenbank gespielt; ein Test nutzt
eine eigene Datenbank und einen eigenen Bucket.

## F. Organisatorische Datenschutzvoraussetzungen

| # | Punkt | Status | Benötigter Nachweis | Rolle |
|---|---|---|---|---|
| F-1 | Zweck und Rechtsgrundlage je Datenkategorie | **teilweise** – Entwurf in `security.md` §13 (Feldliste) | vom Verantwortlichen geprüft und freigegeben | Verantwortlicher, Datenschutzberatung |
| F-2 | Verzeichnis von Verarbeitungstätigkeiten (Art. 30) | **offen** | Verzeichnis | Verantwortlicher |
| F-3 | Technische und organisatorische Maßnahmen (Art. 32) | **offen** – Bausteine in `security.md` | TOM-Dokument | Verantwortlicher, Betrieb/IT |
| F-4 | Auftragsverarbeitungsverträge mit allen Dienstleistern (Hosting, Sicherung, Storage, Monitoring, später E-Mail) | **Entscheidung offen** – Dienstleister nicht festgelegt | unterschriebene AV-Verträge | Verantwortlicher |
| F-5 | Informationspflichten (Art. 13/14) gegenüber Kunden und Mitarbeitenden | **offen** | Datenschutzhinweise | Verantwortlicher, Datenschutzberatung |
| F-6 | Meldeweg bei Datenpannen (Art. 33/34), Incident Response | **offen** | Betriebshandbuch mit Ablauf und Fristen | Verantwortlicher, Betrieb/IT |
| F-7 | Zugriffsberechtigungen geprüft (wer ist Administrator) | **offen** | dokumentierte Prüfung der Rollenvergabe | Verantwortlicher |

## G. Technische Betriebsblocker (bewusst offen)

| # | Punkt | Status | Benötigter Nachweis | Rolle |
|---|---|---|---|---|
| G-1 | Eigene **Produktionskonfiguration** (Secrets außerhalb des Repos, TLS, `Secure`-Cookie, keine Entwicklungswerte – das Backend verweigert diese inzwischen) | **offen – Freigabepunkt** | Konfiguration + Startprotokoll ohne Warnungen | Betrieb/IT, Entwicklung |
| G-2 | Anfragegrenzen bei **mehr als einem** Prozess oder einer Instanz | **offen** – Zähler je Prozess (`security.md` §11) | gemeinsamer Zähler **oder** dokumentierter Betrieb mit genau einem Prozess | Entwicklung, Betrieb/IT |
| G-3 | Reverse Proxy: Größenlimit für alle Anfragekörper, `--forwarded-allow-ips` passend gesetzt | **offen** | Proxy-Konfiguration | Betrieb/IT |
| G-4 | Virenscan für Uploads, externes Security Review, MFA für Administratoren (`security.md` §16) | **offen** | jeweils eigener Nachweis | Entwicklung, Verantwortlicher |

## O. Offene Entscheidungen des Auftraggebers

| # | Entscheidung |
|---|---|
| O-1 | Welche Personen übernehmen die Rollen Verantwortlicher, Datenschutzberatung, Betrieb/IT? |
| O-2 | Ist eine Datenschutzbeauftragte bzw. ein Datenschutzbeauftragter zu benennen (Betriebsgröße, Art der Verarbeitung)? |
| O-3 | Hosting- und Sicherungsdienstleister (Grundlage für F-4, D-3) |
| O-4 | Aufbewahrungsfristen je Datenkategorie und für Sicherungen (B-1, B-4) |
| O-5 | Umgang mit Löschbegehren für Kunden mit aufbewahrungspflichtigen Projekten (C-1) |
