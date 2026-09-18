# Architektur-Review des Masterplans (Phase 0)

Datum: 2026-09-18
Status: abgeschlossen — Ergebnisse sind in die Architekturdokumente eingeflossen
Grundlage: ELEKTROPLAN – MASTERPLAN / ARCHITECTURE v1.0 (§1–§60)

Dieses Dokument ist die kritische Prüfung des Masterplans **vor** dem Festschreiben der
Architektur. Es hält fest, was übernommen wurde, was korrigiert wurde und warum.
Die daraus folgenden verbindlichen Entscheidungen stehen in `docs/decisions/`.

---

## 1. Gesamtbewertung

Der Masterplan ist fachlich und technisch überdurchschnittlich konsistent. Insbesondere
folgende Grundentscheidungen sind für dieses Projekt richtig und werden unverändert
übernommen:

| Entscheidung | Bewertung |
|---|---|
| Modularer Monolith statt Microservices | **Richtig.** Ein Betrieb, ein Team, stark verkettete Geschäftsprozesse. Microservices würden hier nur Latenz, Transaktionsprobleme und Betriebsaufwand erzeugen. |
| Project als Core-Entität, Fachmodule hängen sich an | **Richtig und der wichtigste Hebel.** Ohne das entsteht später ein PV-Silo neben einem Elektro-Silo. |
| MaterialRequirement als gemeinsamer Contract | **Richtig.** Das ist der Mechanismus, der Elektro/PV/KNX/Wallbox überhaupt erst zu einer Plattform macht. |
| Lagerbestand nur über Transaktionen, nie über `UPDATE stock` | **Richtig.** Bestandsführung ohne Bewegungsjournal ist nicht auditierbar und nicht rekonstruierbar. |
| Preis-Snapshots für Kalkulation und Angebot | **Richtig und geschäftskritisch.** |
| Strikte Trennung interne Kalkulation / Kundenangebot | **Richtig**, aber im Plan nur als Regel formuliert — wird hier zu einer Struktureigenschaft verschärft (siehe B-06). |
| Strukturiertes Raummodell statt GLB als Datenmodell | **Richtig.** GLB ist ein Exportformat, kein Fachdatenmodell. |
| Deterministische Berechnung statt KI bei Längen, Mengen, Preisen | **Richtig.** |
| Dokumentation als verbindlicher Teil jedes Arbeitsauftrags | **Richtig** und für eine KI-gestützte Entwicklung faktisch Voraussetzung. |

Es gibt keinen fundamentalen Architekturfehler. Die folgenden Punkte sind Lücken,
Unklarheiten oder Stellen, an denen der Plan eine Regel nennt, aber keinen Mechanismus,
der sie durchsetzt.

---

## 2. Befunde — Inkonsistenzen und Lücken

### B-01 `packages/contracts` als TypeScript-Paket ist mit einem Python-Backend nicht haltbar

**Problem:** §5 fordert ein zentrales Contract-Paket unter `/packages/contracts`, §9 legt
das Backend auf Python fest. Ein handgeschriebenes TS-Paket wäre eine zweite Quelle der
Wahrheit neben den Python-Modellen. Zwei handgepflegte Definitionen desselben Contracts
driften garantiert auseinander — und zwar still.

**Auswirkung:** Falsche Mengen/Preise im Frontend, die erst im Angebot auffallen.

**Entscheidung:** Es gibt zwei getrennte Contract-Arten:

- **Interne Modul-Contracts** (Modul ↔ Modul, nur Backend): Quelle der Wahrheit sind
  Python-/Pydantic-Definitionen unter `apps/backend/contracts/v1/`. Kein TypeScript.
- **Wire-Contracts** (Backend ↔ Frontend/App): Quelle der Wahrheit ist das aus FastAPI
  generierte OpenAPI-Dokument. `packages/api-client` wird daraus **generiert**, nie von
  Hand gepflegt. Ein Drift-Check läuft in CI.

`packages/contracts` entfällt als handgepflegtes Paket. Siehe ADR 0009.

---

### B-02 Der Event-Bus hat keine Transaktionssemantik

**Problem:** §6 fordert einen internen Event Bus, sagt aber nicht, wann Events relativ zur
Datenbanktransaktion ausgelöst werden. Das ist die Stelle, an der In-Process-Event-Busse
regelmäßig Daten zerstören: Ein Event wird mitten in der Transaktion ausgelöst, ein
Listener schreibt in eine andere Tabelle, die auslösende Transaktion rollt zurück — und
der Folgezustand bleibt bestehen. Umgekehrt: Ein Listener wirft eine Exception und rollt
die Transaktion des Auslösers mit zurück.

**Entscheidung:** Events werden während der Unit of Work nur **gesammelt** und
ausschließlich **nach erfolgreichem Commit** synchron im Prozess zugestellt. Handler
dürfen nicht in die Transaktion des Auslösers zurückwirken. Daraus folgt zwingend:

> **Zustellung ist "at most once".** Jede eventgetriebene Ableitung muss zusätzlich als
> idempotenter, direkt aufrufbarer Recompute-Befehl existieren.

Beispiel: `MaterialRequirementsUpdated` ist eine Benachrichtigung. Die Neuberechnung des
Materialbedarfs muss immer auch über `POST .../material-requirements/recompute`
erzwingbar sein. Ohne diese Regel entstehen Projekte, deren Bedarf stillschweigend
veraltet ist. Siehe ADR 0004 und `docs/events.md`.

---

### B-03 Doppelte Kalkulation von Leitungen ist im Plan als Risiko benannt, aber nicht verhindert

**Problem:** §22 warnt davor, dass Leitungen aus der Leitungsplanung und gleichzeitig über
ServiceTemplates kalkuliert werden. Es fehlt der Mechanismus.

**Entscheidung:** Drei Festlegungen:

1. `ServiceTemplate.includes_cable` ist ein Pflichtfeld (Default `false`). Ein Template mit
   `includes_cable = true` darf keine Position erzeugen, deren Material die Kategorie
   *Leitung* hat, solange für dasselbe Projekt Leitungswege existieren.
2. Jede `MaterialRequirement`-Zeile trägt `source_entity_type`. Materialbedarf aus
   Leitungen entsteht ausschließlich aus `cable_route`, Bedarf aus Geräten ausschließlich
   aus `device`.
3. Die Material Engine führt nach jedem Lauf eine Plausibilitätsprüfung aus und meldet
   dieselbe Material-ID aus zwei verschiedenen `source_entity_type` als Warnung ins
   Lauf-Protokoll.

---

### B-04 Materialbedarf, Reservierung und Angebot brauchen definierte Einfrierpunkte

**Problem:** §21 beschreibt laufend neu berechneten Materialbedarf, §23 Reservierungen,
§26 Preis-Snapshots. Nicht definiert ist, was passiert, wenn sich die Planung **nach**
Angebot oder Reservierung ändert. Wenn der Bedarf live bleibt, verändern sich Angebote
rückwirkend; wenn er einfriert, veraltet die Planung unbemerkt.

**Entscheidung — vier klar getrennte Zustände:**

| Stufe | Objekt | Verhalten |
|---|---|---|
| 1 | `material_requirements` (aktueller Lauf) | **live**, wird bei jeder Planänderung neu berechnet |
| 2 | `calculations` mit Status `final` | **eingefroren**: Mengen *und* Preise als Snapshot |
| 3 | `offer_versions` | **eingefroren**: eigene Kopie, unabhängig von der Kalkulation |
| 4 | `work_order_materials` | **eingefroren**: eigene Planmenge, Grundlage für Soll/Ist |

Eine Planänderung nach `final` erzeugt **nie** eine stille Änderung, sondern setzt ein
Kennzeichen `is_stale` auf der Kalkulation und einen Hinweis in der UI. Neue Zahlen
erfordern eine neue Kalkulations- bzw. Angebotsversion.

---

### B-05 `users.organization_id` würde Mandantenfähigkeit später blockieren

**Problem:** §11/§13 nennen Organization und User, ohne die Beziehung festzulegen. Die
naheliegende Umsetzung (`users.organization_id`) macht es unmöglich, dass eine Person
später für zwei Betriebe arbeitet (Subunternehmer, Betriebsübernahme, Holding), und
verhindert einen sauberen Organisationswechsel.

**Entscheidung:** `users` ist eine **globale Identität** (E-Mail, Passwort-Hash).
Die Zugehörigkeit läuft über `organization_members(organization_id, user_id, status)`.
Rollen hängen an der Mitgliedschaft, nicht am User. Das kostet jetzt eine Tabelle und
spart später eine schmerzhafte Migration inklusive Neuanmeldung aller Nutzer.

---

### B-06 "Interne Daten dürfen nicht im Kundendokument erscheinen" ist als Regel zu schwach

**Problem:** §29 fordert die Trennung und will sie mit Tests absichern. Tests prüfen aber
nur, woran jemand gedacht hat. Solange Einkaufspreis und Marge technisch in derselben
Zeile stehen wie der Angebotstext, ist ein Leak nur einen `SELECT *` oder ein vergessenes
`exclude=` entfernt.

**Entscheidung:** Die Trennung wird strukturell:

> **Die Tabellen `offer_versions` und `offer_items` enthalten keine Kostenspalten.**
> Kein `unit_cost`, kein `purchase_price`, kein `markup_percent`, keine Marge.

Ein Angebot kennt nur Verkaufspreise. Der Bezug zur Kalkulation läuft über
`offer_versions.calculation_id`. Die Trennung kann damit nicht durch einen
Serialisierungsfehler verletzt werden, sondern nur durch einen bewussten Join — und
dieser Join existiert im kundenseitigen Renderpfad nicht. Ein Test prüft zusätzlich, dass
kein PDF-/DTO-Pfad `calculation_*` importiert.

---

### B-07 Geometrie in Fließkommazahlen ist nicht deterministisch testbar

**Problem:** §18/§39 fordern geprüfte Leitungslängen. Werden Koordinaten als `float`
gespeichert, sind Summen abhängig von Reihenfolge und Rundung — Tests werden unscharf und
Soll/Ist-Vergleiche sind nicht reproduzierbar.

**Entscheidung:** Alle Geometriekoordinaten und Bauteilmaße werden als **ganzzahlige
Millimeter** gespeichert (`x_mm`, `height_mm`, …). Längenberechnung erfolgt in mm, wird
auf ganze Millimeter gerundet und erst an der Fachgrenze in Meter mit drei
Nachkommastellen (`Decimal`) überführt. Damit sind Längen exakt reproduzierbar.
Siehe ADR 0007.

---

### B-08 Geld über JSON ist in JavaScript ohne Zusatzregel unsicher

**Problem:** §25 verlangt Decimal/Money im Backend. Sobald ein `Decimal` als JSON-Zahl
übertragen wird, ist es im Browser ein IEEE-754-Double — die Absicherung im Backend
verpufft an der Schnittstelle.

**Entscheidung:** Geldbeträge werden über die API **als Dezimal-String** übertragen
(`"1234.56"`), nie als JSON-Number. Im Frontend werden sie nicht in `number` konvertiert,
sondern mit einer Decimal-Bibliothek verarbeitet. Die Regel gilt auch für Mengen mit
Nachkommastellen. Siehe ADR 0005.

---

### B-09 Verpackungseinheiten fehlen — mit direkter Auswirkung auf die Marge

**Problem:** §21 rechnet 42,5 m + 8 % = 45,9 m. In der Praxis kauft der Betrieb einen
50-m-Ring. Der Plan kennt nur *eine* Menge und vermischt damit drei verschiedene Dinge.

**Entscheidung:** Drei Mengen werden getrennt geführt:

| Menge | Bedeutung | Beispiel |
|---|---|---|
| `required_quantity` | technischer Bedarf aus der Planung | 42,500 m |
| `planned_quantity` | Bedarf + Verschnitt/Reserve | 45,900 m |
| `procurement_quantity` | auf Verpackungseinheit gerundet | 50,000 m (1 Ring) |

Welche Menge in die Kalkulation eingeht, ist pro Material über `calculation_basis`
konfigurierbar (Standard: `planned`, für Ringware sinnvoll `procurement`). Ohne diese
Trennung ist die Nachkalkulation systematisch falsch.

---

### B-10 3D-Bearbeitung als MVP-Anforderung ist das größte Zeitrisiko

**Problem:** §17 fordert einen 2D-**und** 3D-Editor in Phase 4, vor Geräten, Leitungen und
Kalkulation. Ein 3D-Editor mit Snapping, Auswahl, Undo und Constraints ist die mit Abstand
aufwendigste Komponente des gesamten Plans — und sie liegt auf dem kritischen Pfad zum
MVP-Nutzen (§52).

**Entscheidung — 2D ist die Autorenfläche, 3D ist eine abgeleitete Ansicht:**

- Phase 4a: 2D-Editor (Räume, Wände, Öffnungen) — vollwertig bearbeitbar.
- Phase 4b: 3D-Ansicht (Three.js) — Darstellung, Navigation, Auswahl; **kein** Bearbeiten
  von Geometrie in 3D im MVP.

Damit das trägt, wird die dritte Dimension nicht gezeichnet, sondern fachlich abgeleitet:

> **Installationszonen.** Leitungswege werden in 2D mit einer Zone gezeichnet
> (z. B. "waagerecht 30 cm über Fertigfußboden", "senkrecht über Schalter",
> "30 cm unter Rohdecke", angelehnt an DIN 18015-3). Die Z-Koordinate und die
> Stichleitungen zu den Gerätehöhen ergeben sich daraus deterministisch.

Das ist keine Vereinfachung auf Kosten der Qualität: Leitungen werden ohnehin nicht frei im
Raum verlegt, sondern in Zonen. Realistische Längen inklusive Auf- und Abgängen entstehen
so aus einer 2D-Eingabe. 3D bleibt Kontrolle und Präsentation. Siehe ADR 0010.

---

### B-11 Materialregeln (§21) und ServiceTemplates (§22) sind zwei Engines für dasselbe

**Problem:** Beide erzeugen aus Planungsobjekten Materialmengen. Zwei Regelwerke
nebeneinander bedeuten doppelte Pflege und widersprüchliche Ergebnisse.

**Entscheidung:** Es gibt **eine** Material Engine mit zwei Eingaben:

1. **ServiceTemplates** — objektbezogene Stücklisten und Arbeitszeiten (Gerät → Material).
2. **Globale Regeln** — nur mengenbezogene Nachbearbeitung: Verschnitt-/Reserveprozente,
   Verpackungsrundung, Mindestmengen, Kleinmaterialpauschalen.

Globale Regeln erzeugen **kein** neues Fachmaterial, sie transformieren nur Mengen. Damit
gibt es genau eine Stelle, an der "wie viel Material" entschieden wird.

---

### B-12 Angebotsversionierung ist ohne Datenmodell nicht eindeutig

**Problem:** §30 fordert Versionen, §27 beschreibt `Offer` als flaches Objekt. Unklar
bleibt, ob eine Version eine Kopie, ein Diff oder ein Statuswechsel ist.

**Entscheidung:** Drei Ebenen — `offers` (Nummer, Kunde, Projekt, Zeiger auf aktuelle
Version) → `offer_versions` (Version, Status, Summen, Snapshot) → `offer_items`.
Positionen hängen an der Version. Eine neue Version ist eine vollständige Kopie.
Freigegebene Versionen sind unveränderlich (nur Statusfelder dürfen fortschreiten).

Ergänzend: Belegnummern werden über eine Tabelle `number_sequences` mit Zeilensperre
vergeben, nicht über `MAX(number)+1` — sonst entstehen unter Parallelzugriff doppelte
Nummern, was bei Geschäftsdokumenten nicht akzeptabel ist.

---

### B-13 Modulgrenzen ohne maschinelle Durchsetzung halten nicht

**Problem:** §4/§57 formulieren die wichtigste Regel des Projekts — Module dürfen keine
fremden Interna kennen. Regeln, die nur in einem Dokument stehen, werden unter Zeitdruck
verletzt, und bei KI-gestützter Entwicklung besonders leicht.

**Entscheidung:** Grenzen werden in CI geprüft:

- Backend: `import-linter` mit expliziten Layer-/Forbidden-Contracts
  (z. B. "`modules.calculation` darf `modules.electrical` nicht importieren").
- Frontend: ESLint `no-restricted-imports` mit Pfadgrenzen zwischen Modulordnern.
- Datenbank: Tabellenpräfix pro Modul; ein Test prüft, dass die Modelle eines Moduls nur
  Tabellen mit eigenem Präfix (plus Core-Tabellen) referenzieren.

Ohne diese drei Prüfungen ist der Rest dieser Architektur eine Absichtserklärung.

---

### B-14 Wie erfährt das Materialmodul vom Elektromodul, ohne es zu kennen?

**Problem:** Der Plan sagt "Fachmodule erzeugen MaterialRequirements" (§21). Wenn die
Material Engine im Shared-Modul liegt, müsste sie Elektro-Tabellen lesen — genau das ist
verboten. Wenn das Elektromodul selbst rechnet, liegt Preis- und Regellogik im Fachmodul —
ebenfalls verboten (§20).

**Entscheidung — Abhängigkeitsumkehr über Provider-Ports:** Das Shared-Modul definiert den
Port, das Fachmodul implementiert ihn, die Module Registry verdrahtet beides.

```
materials (Shared)          electrical (Fachmodul)
  definiert Port    <----   implementiert Port
  MaterialRequirementProvider.collect(project_id) -> list[MaterialRequirementDraft]
```

Die Material Engine iteriert über alle registrierten Provider. Sie kennt keine
Fachmodule — nur Ports. PV, KNX oder Wallbox registrieren später denselben Port, ohne dass
eine Zeile im Materialmodul geändert wird. Dieselbe Mechanik gilt für
`LaborRequirementProvider` und `OfferItemSuggestionProvider`. Siehe ADR 0003.

---

### B-15 Offline-Felder auf allen Entitäten sind unnötiger Ballast

**Problem:** §33 fordert `version` und `sync_status` auf allen Objekten. Synchronisiert
wird aber nur, was die Baustellen-App bearbeitet (Verbrauch, Fotos, Zeiten, Notizen).
`sync_status` auf `customers` oder `offers` wäre ein Feld, das nie einen sinnvollen Wert
annimmt, aber in jedem Schema, jeder Migration und jedem DTO mitgeschleppt wird.

**Entscheidung:** UUID, `created_at`, `updated_at` und `version` (optimistisches Sperren —
auch ohne Offline nützlich) erhalten alle Geschäftsentitäten. `sync_status` und
`client_txn_id` erhalten **nur** die von der App beschriebenen Tabellen, und zwar in
Phase 13/16. Das Sync-Konzept wird in Phase 0 dokumentiert, aber nicht vorgebaut.

---

### B-16 Kleinere Punkte

| # | Punkt | Entscheidung |
|---|---|---|
| a | `Door` und `Window` als getrennte Entitäten (§16) | Zusammengefasst zu `electrical_openings` mit `kind` (door/window/passage). Identische Geometrie, identische Bearbeitung. |
| b | Rollen als feste Namen (§12) | Rollen sind Daten (pro Organisation), Permissions sind der Autorisierungsmechanismus. Systemrollen werden als Seed ausgeliefert und sind kopierbar. |
| c | Audit über generische ORM-Hooks | Nicht verwenden. Audit-Einträge werden an fachlich definierten Punkten explizit geschrieben (Freigabe, Preisänderung, Bestandskorrektur, Rechtevergabe). Generisches Auditing erzeugt Rauschen statt Nachvollziehbarkeit. |
| d | `packages/ui` und `packages/3d-engine` ab Start | Erst anlegen, wenn ein zweiter Consumer existiert (Android-App, Phase 13). Vorher unnötige Build-Komplexität. |
| e | Modul-Aktivierung pro Organisation (§7) | Tabelle `organization_modules` ab Phase 1, alle Module aktiv. Kein Plugin-Loader, keine Lizenzlogik. |
| f | DSGVO-Löschung | Soft Delete (`deleted_at`) für Geschäftsdokumente **plus** dokumentierter Hard-Delete-/Anonymisierungspfad für personenbezogene Daten. Soft Delete allein erfüllt kein Löschbegehren. |
| g | Idempotenz | `client_txn_id` mit Unique-Constraint bereits beim Entwurf der Lagerbewegungen vorsehen. Nachträglich einzuführen ist teuer. |
| h | Three.js auf Android-Tablets (§9/§32) | Auf der Baustelle zunächst nur 2D-Plan. 3D auf Mobilgeräten erst nach Messung auf realer Zielhardware. |
| i | Normative Prüfungen (§19) | Bleiben außerhalb des MVP. ElektroPlan schlägt vor, die Elektrofachkraft entscheidet. Keine automatische Schutzorgan-Dimensionierung. |

---

## 3. Risiken

| ID | Risiko | Auswirkung | Gegenmaßnahme |
|---|---|---|---|
| R-01 | Umfang: 20 Phasen sind mehrere Personenjahre | Projekt erreicht den Pilotbetrieb nie | Harte Phasengrenzen, dünne vertikale Schnitte, Pilot-Meilenstein nach Phase 10 ist verbindlicher Stopp |
| R-02 | Editor-Ergonomie | Planung dauert länger als Zeichnen auf Papier → keine Akzeptanz | Früh mit echten Grundrissen testen; 2D-first (B-10); Bedienung vor Funktionsumfang |
| R-03 | Falsche Kalkulationswerte | Wirtschaftlicher Schaden durch zu günstige Angebote | Preis- und Mengensnapshots, Nachkalkulation ab Phase 15, Tests auf Rundung/USt/Summen |
| R-04 | Verletzung der Mandantentrennung | Schwerwiegender Datenschutzvorfall | Mehrstufig: `organization_id` überall, zusammengesetzte Fremdschlüssel, Repository-Basisklasse, automatisierter Endpoint-Sweep-Test, RLS vorbereitet |
| R-05 | Stiller Contract-Drift Backend↔Frontend | Falsche Zahlen in der UI | Generierter API-Client + Drift-Check in CI (B-01) |
| R-06 | Veralteter Materialbedarf durch verlorene Events | Falsche Mengen im Angebot | Recompute-Pflicht (B-02), `is_stale`-Kennzeichen (B-04) |
| R-07 | Haftung bei elektrotechnischen Fehlern | Rechtliches und personelles Risiko | Keine normativen Automatismen im MVP, Planung ist Vorschlag, Freigabe durch Fachkraft, Audit |
| R-08 | Wissensverlust zwischen KI-Sessions | Architekturzerfall durch widersprüchliche Änderungen | `current-status.md`, `task-history.md`, ADRs als Pflicht nach jedem Auftrag (§41–§47) |
| R-09 | AR-Messgenauigkeit | Unbrauchbare Aufmaße | Erst Phase 17; Messwerte immer gegen manuelle Korrektur prüfbar halten |
| R-10 | Migrationen mit mehreren Alembic-Heads | Blockierte Deployments | Ein einziger Migrationsstrang für die gesamte Datenbank, Head-Check in CI |

---

## 4. Was bewusst *nicht* gebaut wird (Overengineering-Schutz)

- Keine Microservices, keine Message Broker, keine Event-Sourcing-Architektur.
- Keine Microfrontends, kein dynamisches Laden von Modulen zur Laufzeit.
- Keine Plugin-, Lizenz- oder Abrechnungslogik.
- Keine generische Rule Engine mit eigener Sprache — Regeln sind konfigurierte Werte.
- Keine CQRS-Trennung mit getrennten Modellen.
- Keine Interfaces ohne zweiten Implementierer (Ausnahme: die drei Provider-Ports, deren
  zweiter Implementierer PV bereits absehbar ist).
- Keine Cache-Schicht, keine Read Replicas, keine Performanceoptimierung ohne Messung.
- Kein Conflict Resolution für Offline-Sync im MVP.

---

## 5. Übernommene Änderungen gegenüber dem Masterplan

Die folgenden Punkte weichen bewusst vom Masterplan ab. Jede Abweichung ist in einem ADR
festgehalten und darf nicht stillschweigend rückgängig gemacht werden.

| Masterplan | Änderung | ADR |
|---|---|---|
| §5 `packages/contracts` (TS) | Python ist Quelle der Wahrheit, TS-Client wird generiert | 0009 |
| §6 Event Bus | Post-Commit-Zustellung, at-most-once, Recompute-Pflicht | 0004 |
| §11/§13 User↔Organization | N:M über `organization_members` | 0006 |
| §16 Door/Window | Zusammengefasst zu `openings` | — (in `docs/modules/electrical.md`) |
| §17 3D-Editor in Phase 4 | 2D-Editor (4a) + 3D-Ansicht (4b), Installationszonen | 0010 |
| §21/§22 zwei Regelwerke | Eine Material Engine, globale Regeln nur mengenverändernd | 0003 |
| §21 eine Menge | Drei Mengen: required / planned / procurement | 0003 |
| §25 Decimal | Zusätzlich: Geld als String über die API | 0005 |
| §29 Regel | Struktur: Angebotstabellen ohne Kostenspalten | 0006 |
| §33 Offline-Felder überall | Nur auf App-beschriebenen Tabellen | — (in `docs/architecture.md`) |
| §18 Koordinaten | Ganzzahlige Millimeter | 0007 |

---

## 6. Offene Entscheidungen für den Betrieb (fachlich, nicht technisch)

Diese Fragen kann die Architektur nicht beantworten; sie werden vor der jeweiligen Phase
benötigt:

1. **Phase 7/8:** Welche Verschnittzuschläge gelten pro Materialgruppe (Leitung, Rohr,
   Kleinmaterial)? Welche Ringgrößen werden tatsächlich beschafft?
2. **Phase 8:** Welche ServiceTemplates mit welchen Zeiten bilden die reale Arbeitsweise
   ab? (Ca. 20–30 Templates reichen für die MVP-Erprobung.)
3. **Phase 9:** Ein Stundensatz oder mehrere (Monteur/Geselle/Meister/Azubi)? Wie werden
   Gemeinkosten aufgeschlagen — prozentual auf Material, auf Lohn oder auf beides?
4. **Phase 10:** Welche Angebotsstruktur erwartet der Kunde (Gewerkegliederung, Pauschalen,
   Eventualpositionen)? Liegt eine bestehende Angebotsvorlage als Muster vor?
5. **Phase 10:** Nummernkreise — Format und Startwerte für Kunden, Projekte, Angebote,
   Aufträge.
6. **Phase 12:** Welche Lagerorte existieren real (Hauptlager, Fahrzeuge,
   Baustellencontainer)?
7. **Querschnitt:** Welche Umsatzsteuerfälle treten auf (19 %, 7 %, §13b Reverse Charge bei
   Bauleistungen)? §13b ist im MVP nicht vorgesehen.
