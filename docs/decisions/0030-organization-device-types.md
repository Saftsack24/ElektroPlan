# 0030 — Betriebseigene Gerätetypen im Gerätekatalog

Status: **accepted** (2026-10-25) – mit K2 freigegeben und umgesetzt (Migration `0015_organization_device_types`;
Umsetzungsstand: [`geraetekatalog-design.md`](../geraetekatalog-design.md) §12)
Betrifft: Gerätekatalog, Schritt K2 ([`docs/geraetekatalog-design.md`](../geraetekatalog-design.md) §4–§5)
Erweitert: [ADR 0023](0023-electrical-devices-symbols-room-types.md) (globaler Systemkatalog; dort:
„Betriebseigene Typen … brauchen einen eigenen ADR“)
Baut auf: [ADR 0006](0006-tenant-isolation-and-data-separation.md), [ADR 0026](0026-circuits-cables-and-cable-paths.md),
[ADR 0027](0027-planning-defaults-cable-templates-and-reserve.md), [ADR 0028](0028-distribution-board-placement-and-layout.md)

## Context

Der Gerätekatalog (`electrical_device_types`) ist global und wird per Seed aus dem Code gepflegt. Betriebe
sollen eigene Planungstypen (z. B. „Herdanschluss“, „Rollladenschalter“) anlegen können – ohne Code je Typ, ohne
zweite Liste und ohne dass bestehende Geräte still ihre Lage, ihr Maß oder ihre Bedeutung ändern. Geräte,
Betriebs- und Projektvorlagen je Gerätetyp verweisen über `device_type_key` auf den Katalog. Die fachliche
Rolle eines Typs hängt an der Kategorie; nur die Verteilung hängt am festen Schlüssel `distribution_board`.

## Decision

1. **Ein Katalog mit Geltungsbereich.** `electrical_device_types` erhält `organization_id` (NULL = Systemtyp),
   `description`, `version`, Zeitstempel. Eigene Typen erhalten einen serververgebenen Schlüssel `c_<32 hex>`;
   CHECK `(organization_id IS NULL) = (key NOT LIKE 'c\_%')`; eigene Typen nie Kategorie `distribution`.
2. **Mandantenschutz durch die Datenbank.** Referenzierende Tabellen (`electrical_devices`,
   `electrical_type_templates`, `electrical_proj_type_templates`) erhalten eine berechnete Spalte
   `device_type_org_id = CASE WHEN device_type_key LIKE 'c\_%' THEN organization_id END` (stored) und einen
   zusammengesetzten Fremdschlüssel auf `(organization_id, key)`. Für Systemtypen ist sie NULL; der bestehende
   FK auf `key` bleibt. API-Felder und Schreibpfade bleiben unverändert.
3. **Lesen gefiltert:** Katalog und Typauflösung liefern nur Systemtypen und Typen des eigenen Betriebs.
4. **Bestandserhalt ohne Typversionen:** Geräte haben keine eigenen Maße. Ist ein eigener Typ verwendet, sind
   Kategorie und Planungsmaß gesperrt, Montageflächen nur erweiterbar; Name, Beschreibung, Standardhöhe frei,
   Symbol mit Rückfrage. Löschen nur ohne Verweis, sonst deaktivieren.
5. **Symbole** nur aus der kontrollierten Liste mitgelieferter Zeichnungen (serverseitig geprüft).
6. **Recht** `electrical.device_types.manage`, ohne Standardrolle; Auswahl mit `plan.write`.
7. Die Rolle ergibt sich ausschließlich aus der Kategorie; der Name hat keine fachliche Wirkung.
8. **Neue Kategorie `connection` „Geräteanschluss“** (R1 entschieden 2026-10-25): zuordenbar, gültiger
   Leitungsendpunkt, Gerätezugabe, Vorlage je Typ, eigenes Symbol, in Mengen gezählt; Systemtyp per Seed;
   mit derselben Migration (Kategorie-CHECK).

R2 (eigenes Recht, nur Administrator) und R3 (Reihenfolge VP → K1 → K2) sind entschieden; K2 ist freigegeben.

**Bei der Umsetzung präzisiert:**

* Schlüssel und Eigentümer sind per Trigger unveränderlich (`trg_el_device_types_scope_fixed`); Name eindeutig
  unter aktiven eigenen Typen je Betrieb (`lower(label)`, `device-type-label-taken`).
* **Sperrstrategie:** Jeder Weg, der einen eigenen Typ verwendet (Raumentwurf, Vorlagen je Typ), sperrt dessen
  Zeile `FOR KEY SHARE`; Ändern und Entfernen sperren `FOR UPDATE` und zählen die Verweise erst danach. Eine
  vorherige Zählung allein wäre kein Schutz.
* `GET /device-types` liefert `device_count`/`template_count` (statt `in_use`) und kein `placeable` – die
  Verteilung erkennt die Oberfläche an der Kategorie. Systemtyp ändern: `409 device-type-system`; fremder
  Schlüssel: `404`.
* Eigene Typen dürfen auch das Verteilungssymbol nicht verwenden (kein Typ, der wie eine Verteilung aussieht).
* Architekturtest: `electrical_device_types` ist als **gemischter Katalog** ausdrücklich von
  „`organization_id NOT NULL`“ ausgenommen; stattdessen muss jede verweisende Mandantentabelle den berechneten,
  zusammengesetzten FK tragen (`test_gemischte_kataloge_sind_abgesichert`).

## Alternatives

* **Eigene Tabelle `electrical_org_device_types`** mit zweiter Referenzspalte am Gerät: jede Typauswertung,
  Vorgabenkette und Mengenermittlung doppelt; verworfen.
* **Systemkatalog je Betrieb kopieren** (Katalog vollständig mandantenbezogen): Migration aller Geräte- und
  Vorlagenverweise, Seed je Betrieb; verworfen.
* **Typversionen** (unveränderliche Fassungen, Gerät verweist auf die Fassung): löst ein Problem, das die
  Feldsperre kleiner löst; verworfen bis Maße pro Gerät nötig werden.
* **Mandantenprüfung nur im Service:** widerspricht ADR 0006 (Datenbank erzwingt Mandantengleichheit).

## Consequences

* Eine Migration (Spalten, CHECKs, berechnete Spalten, FKs) – Bestand unverändert, Systemschlüssel unberührt.
* Seed fasst nur Systemzeilen an; `load_device_types` und `GET /device-types` filtern nach Betrieb.
* Tests gegen PostgreSQL: Mandantentrennung (auch manipulierte Schlüssel), Feldsperren, Referenzschutz,
  Rechte, Bestand vor/nach Migration.
* Spätere Artikelzuordnung (Phase 7) knüpft an denselben Schlüssel an (Zuordnung in electrical, Prüfung über
  einen materials-Contract).
