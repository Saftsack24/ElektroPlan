# Offline-Vorbereitung (Datenmodellkonzept)

Version: 1.0 · Stand: 2026-09-18
Umsetzung: Phase 13 (App) und Phase 16 (Sync) — **hier wird noch nichts gebaut**

Zweck dieses Dokuments: sicherstellen, dass die spätere Baustellen-App nicht an
grundlegenden Modellfehlern scheitert. Es legt fest, **welche** Daten offline
entstehen dürfen und **wie** sie wieder zusammengeführt werden — nicht mehr.

> Es wird bewusst **kein** `sync_status` auf alle Tabellen gelegt. Ein Feld, das
> auf `customers` oder `offers` nie einen sinnvollen Wert annimmt, ist Ballast in
> jedem Schema, jeder Migration und jedem DTO.

---

## 1. Was offline entstehen darf

Nur diese Aggregate werden von der App geschrieben. Alles andere ist auf der
Baustelle **lesend**.

| Aggregat | Tabelle (geplant) | Art | Phase |
|---|---|---|---|
| Materialverbrauch | `inventory_transactions` (`issue`) | append-only | 14 |
| Materialrückgabe | `inventory_transactions` (`return`) | append-only | 14 |
| Arbeitszeiteintrag | `work_order_time_entries` | änderbar bis Auftragsabschluss | 14 |
| Foto | `files` + `work_order_notes` | append-only | 14 |
| Baustellennotiz / Bemerkung | `work_order_notes` | änderbar durch den Verfasser | 14 |
| Statusmeldung des Auftrags | `work_orders.status` | änderbar, konfliktträchtig | 14 |

Nicht offline schreibbar: Kunden, Projekte, Planung, Material- und Preisstamm,
Kalkulationen, Angebote, Rollen und Rechte.

**Das Raummodell (Phase 3) ist damit ausdrücklich nicht offline schreibbar.** Räume,
Wände und Öffnungen erhalten deshalb **kein** `client_txn_id` und **kein** `sync_status` —
ein Feld, das nie einen sinnvollen Wert annimmt, ist Ballast in Schema, Migration und
DTO. Was das Modell trotzdem einhält, steht in Abschnitt 5.

---

## 2. Grundmechanismen

### 2.1 Clientseitig erzeugte UUIDs

Alle Primärschlüssel sind UUIDs und werden **auf dem Gerät** erzeugt
([ADR 0007](decisions/0007-identifiers-and-geometry-units.md)). Ein Datensatz
hat damit seine endgültige Identität, bevor er den Server je gesehen hat — es
gibt keine „vorläufige“ ID, die später ersetzt werden müsste.

### 2.2 Idempotenzschlüssel je Operation

Jede offline erzeugte **Operation** trägt eine `client_txn_id` (UUID), die das
Gerät vergibt. Serverseitig gilt `UNIQUE (organization_id, client_txn_id)`.

- Kommt dieselbe Operation ein zweites Mal an, liefert der Server das Ergebnis
  des ersten Aufrufs zurück — ohne erneut zu buchen.
- Das löst den häufigsten Offline-Fall: Die Anfrage kam an, die Antwort ging
  verloren, der Client wiederholt sie.

`client_txn_id` ist bereits für `inventory_transactions` vorgesehen
(`docs/database.md`, Abschnitt 6). **Zusätzlich vorzusehen — und hier ergänzt:**
`work_order_time_entries`, `work_order_notes` und Datei-Uploads erhalten
denselben Schlüssel, weil auch sie offline entstehen.

### 2.3 Optimistische Versionierung

Änderbare Aggregate tragen `version integer`. Der Client sendet die Version, die
er gelesen hat (`If-Match`). Weicht sie ab, antwortet der Server mit `409`
(`version-conflict`) und dem aktuellen Stand.

### 2.4 Löschen über Tombstones

Offline erzeugte Daten werden **nicht** hart gelöscht. Ein Löschen setzt
`deleted_at` und wird wie eine Änderung synchronisiert. Andernfalls könnte ein
Gerät, das die Löschung nicht gesehen hat, den Datensatz beim nächsten Sync
wieder „auferstehen“ lassen.

---

## 3. Konfliktklassen

| Klasse | Daten | Auflösung |
|---|---|---|
| **A — append-only** | Verbrauch, Rückgabe, Fotos | Kein Konflikt möglich. Reihenfolge egal, Summe zählt. Doppelte Übertragung fängt `client_txn_id` ab. |
| **B — Eigentümerdaten** | Arbeitszeiten und Notizen des eigenen Nutzers | Letzter Stand des **Verfassers** gewinnt. Ein anderer Nutzer kann sie nicht ändern. |
| **C — geteilter Zustand** | `work_orders.status`, Auftragszuordnung | Versionskonflikt → `409`. **Nur manuelle Auflösung**: Der Monteur sieht beide Stände und entscheidet. |
| **D — serverseitig geführt** | Bestände, Preise, Kalkulationen | Client hat nie Schreibrecht; er lädt neu. |

**Automatisch aufgelöst werden ausschließlich A und B.** C erfordert immer eine
Entscheidung durch einen Menschen — ein automatisch überschriebener
Auftragsstatus wäre auf der Baustelle gefährlich.

---

## 4. Ablauf einer Synchronisation (Entwurf)

```
1. Gerät sendet seine Sync-Queue (Operationen, jeweils mit client_txn_id)
2. Server verarbeitet in Reihenfolge:
     bekannt (client_txn_id vorhanden)  -> altes Ergebnis zurueckgeben
     unbekannt, Version passt           -> anwenden
     unbekannt, Version veraltet        -> 409 mit aktuellem Stand
3. Gerät markiert erfolgreiche Operationen als übertragen
4. Gerät lädt geänderte Lesedaten (Auftrag, Plan, Material) neu
5. Konflikte der Klasse C landen in einer Liste zur manuellen Klärung
```

Die Queue wird **nicht** bei einem Konflikt abgebrochen: Klasse-A-Operationen
laufen weiter durch, damit ein einzelner Statuskonflikt nicht die
Verbrauchsmeldung eines ganzen Tages blockiert.

---

## 5. Was daraus für das Datenmodell folgt

Verbindlich für die Phasen 11–14, damit Phase 16 nicht umbauen muss:

1. `inventory_transactions`: `client_txn_id` mit `UNIQUE (organization_id, client_txn_id)`
   — **bereits vorgesehen**.
2. `work_order_time_entries`: `client_txn_id` (unique je Organisation) und
   `version`. Arbeitszeiten entstehen offline und werden nachträglich korrigiert.
3. `work_order_notes`: `client_txn_id`, `version`, `deleted_at`.
4. `files`: `client_txn_id` für den Upload-Vorgang (ein Foto darf nach einem
   Netzabbruch nicht doppelt entstehen).
5. `work_orders`: `version` für den Statuswechsel (Klasse C).
6. `sync_status` wird **erst in Phase 16** und **nur** auf den oben genannten
   Tabellen eingeführt, falls sich dann zeigt, dass ein serverseitiger
   Zustandswert überhaupt gebraucht wird. Die Queue liegt primär auf dem Gerät.

### Was das Raummodell aus Phase 3 einhält

Auch nicht offline beschreibbare Aggregate müssen mit diesem Konzept vereinbar bleiben —
sonst wäre eine späte Erweiterung ein Umbau. Erfüllt sind:

| Regel | Umsetzung in `electrical_rooms/_walls/_openings` |
|---|---|
| Stabile, clientseitig erzeugbare UUIDs | Primärschlüssel ist eine UUID; der Server erzeugt sie **vor** dem Schreiben im Anwendungscode, nicht erst in der Datenbank. Ein Gerät könnte sie genauso vergeben |
| Versionsinformation | `version` auf allen drei Tabellen, `If-Match` Pflicht bei jeder Änderung |
| Deterministische Änderungszeitpunkte | `created_at`, `updated_at` als `timestamptz` in UTC |
| Keine rein positionsabhängige Identität | Eine Wand ist über ihre UUID identifiziert, nicht über ihre Position in der Kontur |
| Explizite Reihenfolge | `sort_order` je Raum, lückenlos ab 0, eindeutig — nicht aus der Geometrie abgeleitet |
| Keine stille Last-Write-Wins-Annahme | Jede Änderung braucht `If-Match`; eine veraltete Version ist `409` |

**Ein zweiter Synchronisationsvertrag entsteht nicht.** Das Modul erfindet keine eigene
Idempotenz und keine eigene Konfliktklasse; sollte Planung je offline entstehen, gilt
dieses Dokument.

---

## 6. Ausdrücklich nicht Teil dieses Konzepts

Keine CRDTs, kein automatisches Zusammenführen von Textfeldern, keine
Mehrgeräte-Bearbeitung desselben Datensatzes, keine Offline-Planung (Räume,
Leitungen), keine Offline-Kalkulation. Die Baustellen-App **erfasst**, sie plant
nicht.

Phase 3 setzt **nichts** davon um: Es gibt keinen Synchronisationsmechanismus, keine
Queue und keinen Client, der offline schreibt. Das Modell ist lediglich so gebaut, dass
Phase 16 nicht umbauen muss.
