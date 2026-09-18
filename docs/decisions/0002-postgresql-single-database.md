# 0002 — PostgreSQL als einzige Datenbank

Status: accepted
Datum: 2026-09-18

## Context

Das System führt Geschäftsdaten (Kunden, Angebote, Aufträge), Lagerbewegungen,
Kalkulationen mit Geldbeträgen und Planungsgeometrie (Räume, Wände, Leitungswege).
Dazu kommen Dateien (Pläne, Fotos, PDFs).

## Problem

Eine Datenbank oder mehrere spezialisierte Speicher? Und wie werden Geometrie und
Dokumente abgelegt?

## Considered Options

**A) PostgreSQL für alles inkl. Dateien (BYTEA/Large Objects).** Einfach, aber Backups
werden groß und langsam, Streaming ist unhandlich.

**B) PostgreSQL + Dokumentendatenbank für Geometrie.** Zwei Systeme, zwei Backups, keine
Transaktion über beide — für Planungsdaten, die zu Preisen führen, nicht akzeptabel.

**C) PostgreSQL + S3-kompatibler Object Storage für Dateien.** Ein transaktionaler
Datenspeicher, ein Blob-Speicher.

**D) PostgreSQL mit PostGIS für Geometrie.** Mächtig, aber die Geometrie ist projektlokal,
klein und wird nie geografisch abgefragt — reiner Zusatzaufwand.

## Decision

**Option C, ohne PostGIS.**

- PostgreSQL 17 als einzige transaktionale Datenbank für alle Module.
- Logische Trennung über Tabellenpräfixe pro Modul, kein separates Schema pro Modul
  (Alembic bleibt damit einfach, ein Strang).
- Dateien in S3-kompatiblem Object Storage (lokal MinIO); in der Datenbank nur Metadaten.
- Geometrie als normalisierte Integer-Spalten in Millimetern; JSONB nur für Punktlisten,
  die stets als Ganzes gelesen werden (Raumpolygon).
- Genutzte Erweiterungen: `pgcrypto`, `citext`.

## Consequences

**Positiv**
- Fremdschlüssel, CHECK-Constraints und Transaktionen über Modulgrenzen hinweg nutzbar.
- Ein Backup-/Restore-Verfahren für alle Geschäftsdaten.
- JSONB steht für Snapshots und Metadaten zur Verfügung, ohne ein zweites System.

**Negativ**
- Dateien und Datenbank müssen konsistent gesichert werden (zwei Sicherungen, ein
  Wiederherstellungsplan).
- Ohne PostGIS sind geometrische Abfragen Anwendungslogik — bei dieser Datenmenge
  unproblematisch.
- Tabellenpräfixe statt Schemata bedeuten, dass Grenzen durch Tests geprüft werden müssen.
