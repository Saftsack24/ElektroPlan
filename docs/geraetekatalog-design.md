# Entwurf: Gerätekatalog – Auswahl, Platzierung und eigene Gerätetypen

**Status:** Entwurf, 2. Fassung (2026-10-25) – **R1–R3 entschieden** (§10). **Nicht umgesetzt**; K1, K2 und die
neue Kategorie werden erst in ihren ausdrücklich freigegebenen Schritten implementiert.
**Einordnung:** Erweiterung von Phase 6c (Bedienung), Schritte **K1/K2** nach **VP** (Verteilung direkt platzieren,
6c.3) – siehe §9. Schrittbezeichnung: **VP** statt des früheren „P“, weil „P“ im 6c-Entwurf (§18.7) die
gemeinsame Bedienungsprüfung bezeichnet. Phase 7 bleibt zurückgestellt.
**Grundlage:** Arbeitsstand `3cf83cd` (L1/L2/L3), [ADR 0023](decisions/0023-electrical-devices-symbols-room-types.md)
(Geräte, Symbole, Raumtypen), [ADR 0026](decisions/0026-circuits-cables-and-cable-paths.md) (Verteilung,
Stromkreise), [ADR 0027](decisions/0027-planning-defaults-cable-templates-and-reserve.md) (Vorgaben,
Kabelvorlagen), [ADR 0028](decisions/0028-distribution-board-placement-and-layout.md) (Verteilungslage),
[`phase-6c-design.md`](phase-6c-design.md) §6, [`modules/materials.md`](modules/materials.md),
[`modules/inventory.md`](modules/inventory.md).
**ADR-Entwurf:** [ADR 0030 – Betriebseigene Gerätetypen im Gerätekatalog](decisions/0030-organization-device-types.md)
(*proposed*).

> ElektroPlan plant und dokumentiert. Ein Gerätetyp beschreibt, **was geplant wird** – Symbol, Planungsmaß,
> Montageflächen und fachliche Rolle. Er ist kein Herstellerartikel, kein Preis und kein Lagerbestand und
> trifft keine Aussage über Normkonformität ([`security.md`](security.md) §17).

---

## 0. Kurzfassung

* **„Gerät“** in der Werkzeugleiste öffnet einen **Katalogdialog**: Suche, Kategorien, Kacheln mit Symbol,
  kurze Details, „Platzieren“. Gesetzt wird mit der **vorhandenen** Geräteplatzierung von Wand- und
  Deckenansicht – keine zweite Platzierung.
* Der Dialog liest den **vorhandenen Katalog** (`electrical_device_types`, `GET …/device-types`). Eigene Typen
  sind **Zeilen desselben Katalogs** mit Geltungsbereich Betrieb – keine zweite Liste.
* Die fachliche Rolle eines Typs ist die **Kategorie** aus einer festen Liste; sie bestimmt Zuordenbarkeit,
  Zugaben und Leitungsendpunkte. Eigene Typen dürfen nie „Verteilung“ sein.
* Bestandserhalt ohne Typversionen: Sobald ein eigener Typ verwendet wird, sind **Kategorie und Planungsmaß
  gesperrt**; Montageflächen nur erweiterbar. Für Abweichendes: „Als neuen Typ anlegen“.
* Artikel (Phase 7) und Lager (Phase 12) hängen später **über Contracts** an – nie automatisch erraten, nie
  eine Lagerbuchung beim Platzieren. Mehrere Herstellerartikel desselben Planungstyps sind dann **unterscheidbar
  auswählbar** (Artikelauswahl in der Gerätekachel, §6.2).
* Neue Kategorie **„Geräteanschluss“** (`connection`, R1) – durchgängig in Zuordnung, Vorlagen, Endpunkten,
  Zugaben, Symbolen und Mengen (§3.1).
* **Layoutbeurteilung:** Der Auftraggeber hat das aktuelle Planungslayout (L1–L3) persönlich angesehen und
  für gut befunden (2026-10-25). Das ist **keine** vollständige Funktionsabnahme der Planungsfunktionen.

---

## 1. Befund zum vorhandenen Katalog

### 1.1 Speicherung und Bereitstellung

| Aspekt | Ist-Stand | Fundstelle |
|---|---|---|
| Quelle | **Systemkatalog im Code** (`DEVICE_TYPE_CATALOG`, 15 Typen), per idempotentem Seed in `electrical_device_types` gespiegelt; entfallene Typen werden **deaktiviert**, nie gelöscht | `catalog.py`, `reference_data.py` |
| Tabelle | **global, ohne `organization_id`**; Primärschlüssel `key` (String 40); Felder `label`, `category`, `symbol_key`, drei Flächen-Flags, `default_center_height_mm`, `width_mm`/`height_mm` (Planungsmaß, gerade, 20–1 000 mm), `sort_order`, `is_active`; CHECKs für Kategorie, Fläche, Maß | `models.py` `ElectricalDeviceType` |
| Gerät | `device_type_key` → Typ (`RESTRICT`), Fläche, Lage; **keine eigenen Maße** – Prüfung und Darstellung lesen immer das Planungsmaß des Typs | `ElectricalDevice`, `device_rules.type_specs` |
| API | `GET /modules/electrical/device-types` (`plan.read`), alle Typen inkl. deaktivierter, keine Schreibroute | `api.py`, `DeviceTypeOut` |
| Frontend | lädt den Katalog (`katalogAbfrage`, 10 min frisch), Labels der Kategorien/Flächen zentral; Auswahl heute als **einfache Liste** (`TypAuswahl`) in der Werkzeugleiste von Wand- und Deckenansicht | `geraete/katalog.ts`, `Wandansicht.tsx`, `Deckenansicht.tsx` |
| Sitzung | Abfrage-Cache wird bei Sitzungs-/Betriebswechsel geleert | `core/sitzung/sitzungsraum.ts` |

### 1.2 Fachliche Bedeutung – fest programmiert

| Bedeutung | Ausgewertet über | Fundstellen |
|---|---|---|
| Stromkreiszuordnung erlaubt | **Kategorie** ∈ `ASSIGNABLE_CATEGORIES` (socket, switch, light, junction) | `service.py`, `distribution.py`, `cables.py`, `planning_defaults.py`, `cabling_summary.py` |
| Lage einer Verteilung | **fester Schlüssel** `distribution_board` | `distribution.py`, `service.py` (Typwechsel gesperrt), Frontend `stromkreise/daten.ts` |
| Anschlusszugabe Verteilung/Abzweigdose/Gerät | **Kategorie** distribution / junction / sonst | `defaults_chain.py` |
| Kabelvorlage je Gerätetyp | `device_type_key` (FK auf den globalen Katalog) in Betriebsstandard und Projektvorgabe | `ElectricalDeviceTypeCableTemplate`, Projekt-Gegenstück |
| Leitungsendpunkt | zuordenbare Kategorie oder Verteilungslage; Datendose und außen nicht | `cables.py`, Frontend `stromkreisableitung.ts` |
| Inaktiver Typ | darf an bestehenden Geräten bleiben, nicht neu gewählt werden (`device-type-inactive`) | `service.py` |

### 1.3 Symbole, Geometrie, Darstellung

* **Symbole:** eigene SVG-Zeichnungen je `symbol_key` (15 Zeichnungen), **Rückfall je Kategorie** für
  unbekannte Schlüssel; nur mitgelieferte Zeichnungen, kein Upload (`geraete/symbole.tsx`). Damit ist eine
  **kontrollierte Symbolauswahl** für eigene Typen ohne neue Zeichnung möglich.
* **Prüfung:** Planungsmaß gegen Wandkanten, Öffnungen, andere Geräte (Backend `device_rules.py`, Frontend
  `geraetepruefung.ts`); bestehende Konflikte dürfen nicht größer werden (Ausgangslage-Regel).
* **3D:** Breite aus dem Planungsmaß (`geraete3d.ts`), Tiefe fest. **2D:** Symbol in fester Bildgröße.
* **Hinweis:** Schon heute gleicht der Seed geänderte Systemmaße an – vorhandene Geräte übernehmen sie still.
  Für den Systemkatalog bleibt das so (ausgelieferte Werte); für eigene Typen wird es ausgeschlossen (§4.3).

### 1.4 Folgerungen

1. Der Katalog ist **bereits dynamisch bereitgestellt** (Server-Abfrage); Frontend-Annahmen beschränken sich
   auf Kategorie-Labels, Symbolzeichnungen und den Verteilungsschlüssel.
2. Die fachliche Rolle hängt fast überall an der **Kategorie** – eigene Typen fügen sich ein, wenn ihre
   Kategorie aus der festen Liste stammt.
3. Einzige Ausnahme ist die **Verteilung** (fester Schlüssel): Sie bleibt Systemtyp und wird nicht über den
   Katalogdialog frei gesetzt (deckt sich mit 6c §6.2 „Verteilung platzieren …“).
4. Der Systemkatalog ist **global**; betriebseigene Typen brauchen einen Geltungsbereich – das ist die eine
   echte Architekturfrage (ADR 0030).

---

## 2. Ablauf und Oberfläche

### 2.1 Einstieg

* **„Gerät“** (Taste G) in Grundriss, Wand- und Deckenansicht öffnet den Katalogdialog (vorhandener
  `Dialog`). Heute führt „Gerät“ im Grundriss direkt in die Wandwahl, in Wand/Decke in eine Liste – beides
  wird durch den Dialog ersetzt.
* Ist schon ein Typ gewählt, zeigt die Werkzeugleiste ihn als kompakten Chip **„Gerät: Steckdose ▾“**; ein
  Klick darauf öffnet den Dialog mit dieser Auswahl.
* **Ein vorhandenes Gerät anklicken** öffnet nie den Katalog: Klick wählt es (Eigenschaften), Doppelklick
  öffnet seine Fläche – wie heute. „Typ ändern …“ in den Eigenschaften öffnet den Dialog im Modus
  **„Typ wählen“** (Aktion „Typ übernehmen“ statt „Platzieren“, nur Typen der Fläche des Geräts).

### 2.2 Layoutskizze (breit)

```
┌ Gerät auswählen ───────────────────────────────────────────────────── [×] ┐
│ [🔍 Suchen: Name, Kategorie …                     ]   Fläche: Wand innen   │
│ ┌ Kategorien ─────┐ ┌ Kacheln ───────────────────────────────────────────┐ │
│ │ Alle            │ │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │ │
│ │ Steckdosen   4  │ │ │ ⊙⊙   │ │ ⊙⊙⊙  │ │  ⊙   │ │ ⊙ ⌂  │ │ ⊙ ★  │       │ │
│ │ Schalter     3  │ │ │Steck-│ │Steck-│ │Steck-│ │außen │ │Herd- │       │ │
│ │ Leuchten     4  │ │ │dose  │ │dose 2│ │dose 3│ │      │ │anschl│       │ │
│ │ Netzwerk     2  │ │ │30 cm │ │30 cm │ │30 cm │ │nur   │ │eigen │       │ │
│ │ Abzweigdosen 1  │ │ └──────┘ └──────┘ └──────┘ │außen │ └──────┘       │ │
│ │ ─────────────── │ │                            └──────┘ (gedimmt)      │ │
│ │ Eigene Typen 1  │ └────────────────────────────────────────────────────┘ │
│ │ Verteilung      │ ┌ Steckdose (gewählt) ───────────────────────────────┐ │
│ │ platzieren …    │ │ Wand innen · Planungsmaß 8 × 8 cm · Mitte 30 cm     │ │
│ └─────────────────┘ │ Systemtyp · Stromkreis zuordenbar                   │ │
│                     └────────────────────────────────────────────────────┘ │
│ [Platzieren]  [Abbrechen]                 [Eigenen Typ anlegen …] [Verwalten]│
└───────────────────────────────────────────────────────────────────────────┘
```

* **Schmal (< 60 rem):** Kategorien als waagerechte, umbrechende Chips über den Kacheln; Kacheln zweispaltig;
  Details als Zeile unter der Auswahl; Aktionen in der festen Fußzeile des Dialogs.
* **Kacheln:** Symbol (32 px, `Geraetesymbol`), Name, eine Zeile Kurzangabe (Standardhöhe oder „Decke“);
  Auswahl über `aria-pressed`/Radiogruppe mit Akzentrahmen; Tastatur: Pfeile in der Kachelgruppe,
  Enter = Platzieren. Marke „eigen“ für Betriebstypen, „deaktiviert“ nur im Modus „Typ wählen“ bei Bestand.
* **Nicht auf dieser Fläche möglich:** Kachel gedimmt mit Grund im Hinweis („nur Decke“); im Grundriss ist
  jede Fläche erreichbar, dort ist nichts gedimmt.
* **Details:** Montageflächen, Planungsmaß, Standardhöhe, Herkunft (System/eigener Typ), fachliche Rolle in
  Worten („Stromkreis zuordenbar“, „kein Stromkreis – Datendose“), Beschreibung. Technische Werte dominieren
  nicht: zwei kurze Zeilen.
* Suche über Name, Beschreibung und Kategoriebezeichnung; Treffer bleiben nach Kategorie geordnet. Die
  zuletzt gewählte Kategorie und Suche merkt sich der Dialog für die Sitzung (nicht gespeichert).
* Nur vorhandene Bausteine: `Dialog`, `knopf()`, `eingabefeld()`, `Marke`, Theme-Tokens, `useMasse` für cm/m/mm.

### 2.3 Platzieren je Fläche

| Ausgangsfläche | nach „Platzieren“ |
|---|---|
| **Wandansicht** | Dialog schließt; Werkzeug „Gerät“ mit gewähltem Typ aktiv; Symbol folgt dem Zeiger, Prüfung, Fang und Hilfslinien wie heute (`geraetepruefung.ts`); Klick setzt in den Raumentwurf; Werkzeug bleibt für weitere Geräte; Escape beendet. Außenseite: nur fassadentaugliche Typen wählbar. |
| **Deckenansicht** | wie Wand, mit Deckenprüfung; nur deckentaugliche Typen wählbar. |
| **Grundriss** | Dialog schließt; Kontextleiste: **„Steckdose platzieren – Wand anklicken“** bzw. **„… – Raum anklicken (Decke)“**; Wand-und-Decke-Typen: Wandlinie → Wandansicht, Rauminneres → Deckenansicht. Die Fläche öffnet sich mit Werkzeug und Typ (vorhandener Weg `onWandFuerOeffnung`). Die Schaltfläche heißt dann „Wand im Grundriss wählen …“. |

* Gesetzt wird **immer** über die vorhandene Platzierung der Fläche und den **Raumentwurf** (`PUT
  /rooms/{id}/contour`); der Katalog fügt keine eigene Speicherung hinzu.
* **„Verteilung platzieren …“** führt in den Ablauf aus 6c §6.2 (Liste der unplatzierten Verteilungen); der
  Typ „Verteilung“ erscheint nie als frei setzbare Kachel.

### 2.4 Eigene Typen im Dialog

* **„Eigenen Typ anlegen …“** wechselt **innerhalb desselben Dialogs** auf das Formular (kein zweiter Dialog
  darüber); „Zurück“ bzw. Speichern kehrt zur Auswahl zurück, der neue Typ ist gewählt und fokussiert.
* **„Verwalten“** führt auf die Seite „Elektro-Vorgaben“, Abschnitt **„Gerätetypen“** (Liste mit Bearbeiten,
  Deaktivieren, Entfernen – wie Kabelvorlagen). Dort und im Dialog dasselbe Formular.
* Ohne Verwaltungsrecht sind beide Aktionen ausgeblendet; die Auswahl bleibt nutzbar.

### 2.5 Entwurfsschutz und Zustände

* Öffnen/Schließen des Katalogs **speichert und verwirft nichts**; ein offener Raum-, Zuordnungs- oder
  Leitungsentwurf bleibt; Auswahl, Ausschnitt und Zoom bleiben. Fokus kehrt beim Schließen zum Auslöser
  (Werkzeugknopf bzw. Chip) zurück.
* Während eines **Leitungs- oder Zuordnungsentwurfs** ist „Gerät“ gesperrt wie heute die Raumbearbeitung
  (höchstens ein aktiver Entwurf) – mit Grund.
* **Abgeschlossene/archivierte Projekte:** Katalog nur ansehen; „Platzieren“ und „Typ übernehmen“ gesperrt mit
  Grund; Typverwaltung ist betriebsweit und unabhängig vom Projektstatus, aber nur mit Recht.
* **Benutzer-/Betriebswechsel:** Katalog-Abfrage hängt am sitzungsgebundenen Cache (wird geleert); eigene Typen
  eines anderen Betriebs erscheinen nie (Server filtert, §5).

---

## 3. Fachliche Rolle: Kategorie statt Name

| Kategorie | Bedeutung (unverändert) | für eigene Typen |
|---|---|---|
| `socket` | Steckdose, zuordenbar, Gerätezugabe | ja |
| `switch` | Schalter/Taster, zuordenbar | ja |
| `light` | Leuchte/Auslass, zuordenbar | ja |
| `data` | Kommunikation, **nicht** zuordenbar, kein Leitungsendpunkt | ja |
| `junction` | Abzweigdose, zuordenbar, Abzweigdosenzugabe | ja |
| `distribution` | Lage einer Verteilung (nur Systemtyp `distribution_board`) | **nein** |
| **`connection`** (neu, R1 entschieden) | Geräteanschluss/Festanschluss (Herd, Durchlauferhitzer, Rollladen), zuordenbar, Gerätezugabe | ja |

* Die Rolle ergibt sich **nur** aus der Kategorie; ein Name wie „Verteilung“ hat keine Wirkung. Eigene Typen
  mit Kategorie `distribution` lehnt der Server ab (CHECK und Prüfung).
* Eine neue Kategorie ist eine bewusste Codeänderung (Liste in `catalog.py` + Labels + Symbol-Rückfall) – nie
  pro Gerätetyp.

### 3.1 Kategorie „Geräteanschluss“ (R1, entschieden 2026-10-25)

Bezeichnung „Geräteanschluss“, Schlüssel `connection`. Sie wird **durchgängig** wie eine zuordenbare Gerätekategorie
behandelt; jede Stelle wird bei der Umsetzung geprüft und getestet:

| Stelle | Verhalten | Fundstellen heute |
|---|---|---|
| Stromkreiszuordnung | zuordenbar (`ASSIGNABLE_CATEGORIES`, Frontend-Spiegel) | `catalog.py`, `stromkreise/daten.ts` |
| Kabelvorlagen | Vorlage je Gerätetyp wie bei anderen Typen; maßgeblich ist das Zielgerät | `planning_defaults.py`, `defaults_chain.py` |
| Leitungsendpunkte | gültiger Start- und Endpunkt | `cables.py`, `stromkreisableitung.ts` |
| Anschlusszugaben | Gerätezugabe (wie Steckdose/Leuchte) | `defaults_chain.py` |
| Symbole | eigene Zeichnung `connection_outlet` + Kategorie-Rückfall | `geraete/symbole.tsx` |
| Mengen | in Mengenübersicht und `ElectricalMaterialProvider` wie andere Geräte gezählt | `cabling_summary.py`, Provider |
| Kategorie-CHECK, Labels | Migration für den CHECK; Label „Geräteanschluss“ | `models.py`, `katalog.ts` |

Ein **Systemtyp** „Geräteanschluss“ (Wand und Decke, 80 × 80 mm) wird mit der Kategorie per Seed geliefert, damit
die Kategorie auch ohne eigene Typen nutzbar ist. Umsetzung als Teil von **K2** (gleiche Migration); bis dahin
ändert sich nichts. Keine elektrotechnische Auslegung (Absicherung, Querschnitt) aus der Kategorie.

---

## 4. Eigene Gerätetypen – Datenmodell und Bestandserhalt

### 4.1 Angaben

| Feld | Regel |
|---|---|
| Name | 1–80 Zeichen, eindeutig je Betrieb unter aktiven Typen (`device-type-name-taken`) |
| Beschreibung | optional, bis 300 Zeichen |
| Kategorie | aus §3, nicht `distribution` |
| Symbol | `symbol_key` aus der **kontrollierten Liste** der mitgelieferten Zeichnungen (gleiche Liste im Backend zur Prüfung; gemeinsame Fixture gegen Drift) |
| Montageflächen | mindestens eine von Wand innen / Fassade außen / Decke |
| Planungsmaß | Breite × Höhe in mm, gerade, 20–1 000 (wie Systemtypen) |
| Standardhöhe (Mitte) | Startwert für Wandgeräte, 0 bis max. Raumhöhe; leer bei reinen Deckentypen – **keine Normvorgabe** |
| Reihenfolge, aktiv | wie Kabelvorlagen |

Keine Freitext-Symbole, kein Upload, keine Programmierung pro Typ.

### 4.2 Speicherung (empfohlen: ein Katalog mit Geltungsbereich)

* **Dieselbe Tabelle** `electrical_device_types` erhält: `organization_id` (NULL = Systemtyp), `description`,
  `version` (optimistische Sperre), `created_at`/`updated_at`. Eigene Typen erhalten einen **serververgebenen
  Schlüssel** `c_<32 hex>` (≤ 40 Zeichen); Systemschlüssel beginnen nie mit `c_` (CHECK
  `(organization_id IS NULL) = (key NOT LIKE 'c\_%')`), eigene Typen nie Kategorie `distribution` (CHECK).
* **Mandantensicherheit in der Datenbank** (ADR 0006 sinngemäß): `electrical_devices` und die beiden
  Vorlagen-je-Typ-Tabellen erhalten eine **berechnete Spalte** `device_type_org_id = CASE WHEN device_type_key
  LIKE 'c\_%' THEN organization_id END` (stored) und einen **zusammengesetzten FK** `(device_type_org_id,
  device_type_key)` → `electrical_device_types(organization_id, key)`. Für Systemtypen ist die Spalte NULL
  (FK greift nicht, der bestehende FK auf `key` bleibt); für eigene Typen erzwingt die Datenbank denselben
  Betrieb. Kein Schreibpfad muss die Spalte setzen.
* **Vorteil:** Schlüssel, API-Felder (`device_type_key`), Vorlagen je Typ, Leitungs- und Mengenlogik bleiben
  unverändert; der Seed fasst nur Systemzeilen an. Lesepfade filtern auf „System oder eigener Betrieb“
  (`load_device_types` heute ungefiltert → künftig gefiltert, damit kein fremder Typname in Meldungen erscheint).
* **Verworfen:** eigene Tabelle mit zweiter Referenzspalte am Gerät (jede Typauswertung doppelt); Kopie des
  Systemkatalogs je Betrieb (Migration aller Geräte- und Vorlagenverweise). Details ADR 0030.

### 4.3 Änderungen an verwendeten Typen – kleinste konsistente Lösung

Geräte speichern **keine eigenen Maße**; Prüfung, 2D und 3D lesen das Planungsmaß des Typs. Statt Typversionen
gilt eine **Feldsperre bei Verwendung** („verwendet“ = mindestens ein Gerät oder eine Vorlage-je-Typ verweist):

| Feld | unbenutzt | verwendet |
|---|---|---|
| Name, Beschreibung, Reihenfolge | frei | frei (Bezeichnung, keine Bedeutung) |
| Standardhöhe | frei | frei (nur Startwert neuer Geräte) |
| Symbol | frei | änderbar **mit Rückfrage** („ändert die Darstellung von N Geräten“) |
| Kategorie | frei | **gesperrt** (`409 device-type-in-use`, Feld genannt) |
| Planungsmaß | frei | **gesperrt** |
| Montageflächen | frei | nur **hinzufügen**; Entfernen einer Fläche, auf der Geräte sitzen: gesperrt |
| aktiv | frei | Deaktivieren erlaubt: Bestand bleibt lesbar und behält den Typ, neue Geräte nicht |

* Für Abweichendes: **„Als neuen Typ anlegen“** (Formular vorbelegt, `POST`). Bestehende Geräte wechseln nie
  still; ein Wechsel ist der vorhandene Typwechsel am Gerät mit allen bisherigen Prüfungen.
* **Entfernen** nur ohne jeden Verweis (Geräte, Vorlage-je-Typ in Betriebsstandard und Projektvorgabe) –
  sonst `409 device-type-in-use`; sonst deaktivieren. Deaktivierte und historische Typen bleiben lesbar
  (Katalogabfrage liefert sie mit `is_active = false`).
* **Typversionen** (unveränderliche Fassungen je Gerät) sind damit **nicht nötig**. Werden später Maße pro Gerät
  gebraucht (Phase 7 Artikelmaße), wäre das eine eigene Entscheidung.

---

## 5. API, Contracts, Rechte

### 5.1 Endpunkte (unter `/api/v1/modules/electrical`)

| Methode, Pfad | Recht | Inhalt |
|---|---|---|
| `GET /device-types` (vorhanden) | `plan.read` | System- **und eigene** Typen des Betriebs, inkl. deaktivierter; neu: `origin` (`system`/`organization`), `description`, `version`, `in_use`, `placeable` (false für `distribution_board`) |
| `POST /device-types` | `device_types.manage` | eigenen Typ anlegen; Schlüssel vergibt der Server |
| `PATCH /device-types/{key}` | `device_types.manage` | mit `If-Match`; Feldsperren nach §4.3 (`409 device-type-in-use`, `409 version-conflict`); Systemtypen `403`/`409 device-type-system` |
| `DELETE /device-types/{key}` | `device_types.manage` | nur unbenutzt; Systemtypen nie |

Fehler nach RFC 9457 mit Feld- und Codeangabe; Contracts in Python, TS-Client generiert (ADR 0009).

### 5.2 Rechte (Empfehlung)

* **Neu `electrical.device_types.manage`** (R2 entschieden) – „Betriebseigene Gerätetypen anlegen, bearbeiten,
  deaktivieren“, **Standardrollen: keine** (nur Administrator, zuweisbar). Begründung: betriebsweite Wirkung auf alle
  Projekte, vergleichbar mit `defaults.manage`; bewusst getrennt, weil Katalogpflege und Kabelvorgaben
  verschiedene Personen betreffen können.
* **Auswählen und Platzieren** aktiver Typen: berechtigte Planer mit `plan.write` (wie heute). **Ansehen:**
  `plan.read`.
* Rechte jeder schreibenden Route explizit; Seed legt das neue Recht an.

### 5.3 Kabelvorlagen

Eigene Typen erscheinen im Betriebsstandard und in der Projektvorgabe als „Vorlage je Gerätetyp“ (gleiche
Tabellen, Mandanten-FK aus §4.2). Die Vorgabenkette bleibt: maßgeblich ist das Zielgerät, eine Verteilung nie.

---

## 6. Artikel- und Lageranbindung (vorbereitet, nicht umgesetzt)

### 6.1 Drei getrennte Begriffe

| Begriff | Modul | Inhalt |
|---|---|---|
| **Planungstyp** | electrical | Symbol, Planungsmaß, Montageflächen, Kategorie – „was geplant wird“ |
| **Materialartikel** | materials (Phase 7) | Hersteller, Artikelnummer, Produktdaten, Einheit, später Preis; ServiceTemplates |
| **Lagerbestand** | inventory (Phase 12) | Menge, Lagerort, Reservierung, Verbrauch |

### 6.2 Phase 7 – optionale Artikelverknüpfung

* Ein **platzierbarer Artikel** wird im Planungskatalog verfügbar, wenn (a) materials ihn ausdrücklich als
  „platzierbares Gerät“ einordnet, (b) ihm **ausdrücklich ein Planungstyp zugeordnet** ist (System- oder
  eigener Typ) und (c) das Recht vorliegt. Fehlt (b), zeigt die Artikelpflege „Planungstyp fehlt – zuordnen“;
  **nichts wird erraten** (Symbol, Maß, Kategorie).
* Speicherung der Zuordnung in **electrical** (Fachmodul → Shared ist erlaubt): `(organization_id,
  device_type_key, material_item_id)` mit opaker ID; Prüfung über einen **materials-Contract** (etwa
  `PlaceableMaterialLookup.describe(ids)` → Bezeichnung, Hersteller, Artikelnummer, aktiv). Keine Imports von
  materials-Interna, keine fremden Tabellenzugriffe.
* **Mehrere Artikel je Planungstyp, unterscheidbar wählbar:** Einem Planungstyp können mehrere Artikel zugeordnet
  sein (z. B. drei Hersteller einer Doppelsteckdose). Die Kachel bleibt der Planungstyp und zeigt „3 Artikel“; die
  Auswahl öffnet in der **Kachel bzw. im Detailbereich eine Artikelauswahl** (Liste mit Hersteller, Bezeichnung,
  Artikelnummer, optional Standardartikel des Betriebs). Gewählt wird „ohne Artikel“ oder genau ein Artikel; der
  gewählte Artikel wird beim Platzieren **am Gerät gespeichert** (`material_item_id`, opak, optional) und ist in
  den Eigenschaften sichtbar und änderbar. Eine Artikelangabe nur im Beschreibungstext genügt ausdrücklich nicht.
* Der Artikel ändert **nie** Symbol, Planungsmaß, Kategorie oder Fläche – maßgeblich bleibt der Planungstyp.
  Weicht ein Produkt im Maß ab, ist das ein eigener Planungstyp („Als neuen Typ anlegen“).
* Speicherung (Phase 7, eigener Schritt): Zuordnungstabelle Typ ↔ Artikel und die optionale Gerätespalte in
  electrical; Artikeldaten nur über den materials-Contract. Für neue Herstellerprodukte genügt ein Datensatz in
  materials plus Zuordnung – **kein Code je Produkt**. **Bis Phase 7 wird davon nichts angelegt.**
* **Verbrauchsmaterial** (Kabel, Dosen-Zubehör, Befestigung) ist nie platzierbar; Kabel entsteht weiter aus
  Leitungen (`ElectricalMaterialProvider`, Doppelzählungsschutz bleibt).

### 6.3 Phase 12 – Bestandsanzeige

* Details zeigen optional „verfügbar: n (Lager A)“ über den `InventoryService`-Lesevertrag – nur Anzeige.
* **Platzieren bucht nichts.** Reservierung und Verbrauch bleiben spätere, ausdrückliche Vorgänge (Auftrag,
  Montage); keine Events für Bestand (ADR 0004).
* Keine Material-, Preis- oder Lagertabellen auf Vorrat.

---

## 7. Begrenzte Umsetzungsschritte

| Schritt | Inhalt | Backend | Umfang |
|---|---|---|---|
| **K1 Katalogdialog** | Dialog (Suche, Kategorien, Kacheln, Details), Einstieg „Gerät“/G in Grundriss, Wand, Decke; Chip „Gerät: …“; Typ wählen am Gerät; Grundriss-Weg zur Fläche; „Verteilung platzieren …“-Eintrag (verlinkt den VP-Ablauf) | keins (nutzt `GET /device-types`) | klein–mittel |
| **K2 Eigene Gerätetypen und Kategorie „Geräteanschluss“** | ADR 0030, Migration (Spalten, berechnete Spalten, CHECKs inkl. Kategorie `connection`, FKs), Systemtyp „Geräteanschluss“ (§3.1), Recht, `POST/PATCH/DELETE`, gefilterte Lesepfade, Feldsperren, Symbolliste mit gemeinsamer Fixture; Formular im Dialog, Abschnitt „Gerätetypen“ auf „Elektro-Vorgaben“; Vorlage-je-Typ für eigene Typen | ja | mittel–groß |
| Phase 7/12 | Artikelzuordnung, Bestandsanzeige (§6) | – | später |

Je Schritt: Tests (Mandantentrennung, Permissions, Feldsperren, Referenzschutz, Bestand unverändert),
Frontendtests, Typprüfung, ESLint, Grenzen, Build, Drift; K2 zusätzlich gegen PostgreSQL und Migrationstest
(Bestand unverändert, Downgrade-Schutz).

---

## 8. Abnahmekriterien

1. „Gerät“ öffnet in Grundriss, Wand und Decke den Katalog; Suche und Kategorie finden einen Typ in ≤ 2 Schritten;
   die Auswahl ist sichtbar und per Tastatur bedienbar; schmal ohne Querscrollen.
2. Nach „Platzieren“ setzt die **vorhandene** Platzierung das Gerät; kein zweiter Speicherweg; der Raumentwurf
   enthält das Gerät, gespeichert wird erst mit „Speichern“.
3. Im Grundriss führt ein Wandtyp verständlich zur Wandwahl, ein Deckentyp zur Raumwahl; auf einer
   unpassenden Fläche ist der Typ gedimmt mit Grund.
4. Klick auf ein vorhandenes Gerät wählt es; der Katalog öffnet nur über Werkzeug, Chip oder „Typ ändern …“.
5. Öffnen/Schließen des Katalogs verändert keinen Entwurf, keine Auswahl, keinen Ausschnitt und Zoom.
6. „Verteilung“ ist nie frei setzbar; „Verteilung platzieren …“ führt in den P-Ablauf.
7. Eigener Typ mit Kategorie, Symbol aus der Liste, Flächen, Maß: anlegen, wählen, platzieren, im Plan, in 3D,
   in Stromkreiszuordnung und Vorgaben wie ein Systemtyp derselben Kategorie.
8. Kategorie `distribution`, fremdes Symbol, unplausibles Maß: abgelehnt mit verständlichem Grund.
9. Verwendeter Typ: Kategorie und Maß gesperrt, Fläche nur erweiterbar, Symbol mit Rückfrage; bestehende
   Geräte behalten Lage, Maß, Bedeutung (Vorher/Nachher-Vergleich).
10. Deaktivierter Typ: Bestand lesbar, neue Geräte nicht; Entfernen nur ohne Verweis, sonst `409`.
11. Betrieb A sieht und nutzt keine Typen von Betrieb B – auch nicht über manipulierte Anfragen (Datenbank-FK).
12. Ohne `device_types.manage` keine Verwaltung; ohne `plan.write` kein Platzieren; abgeschlossen/archiviert nur lesen.
13. Sitzungswechsel lässt keine Katalogdaten oder Entwürfe zurück.

---

## 9. Aufwand und Einordnung

* Offene 6c-Schritte: **VP** (Verteilung direkt platzieren, 6c.3), 6c.2 (Formulare→Dialoge), 6c.6 (zentrale
  Anwendung), 6c.7 (Verteilungsaufbau), P/6c.8 (gemeinsame Bedienungsprüfung); 6c.1 zurückgestellt.
* **Entschieden (R3):** **VP → K1 → K2**, danach 6c.6/6c.7. Begründung: VP ändert ohnehin die Gerätepalette
  („Verteilung platzieren …“) – K1 baut die Palette einmal richtig als Katalog und nimmt den VP-Ablauf auf; K1 ist
  rein Frontend und sofort nutzbar; K2 braucht ADR und Migration und profitiert vom fertigen Dialog.
* Größenordnung: K1 etwa wie L3-Verwaltungsdialoge; K2 etwa wie V1 (Backend mit Migration) plus ein Formular.

---

## 10. Entscheidungen (2026-10-25)

| # | Frage | Entscheidung |
|---|---|---|
| R1 | Neue Kategorie „Geräteanschluss/Festanschluss“? | **Ja** – `connection`, durchgängig bei Stromkreiszuordnung, Kabelvorlagen, Leitungsendpunkten, Anschlusszugaben, Symbolen und Mengen (§3.1); Umsetzung mit K2 |
| R2 | Recht für eigene Typen? | **Neues Recht `electrical.device_types.manage`**, Standard nur Administrator; berechtigte Planer wählen und platzieren aktive Typen weiterhin (§5.2) |
| R3 | Reihenfolge? | **VP → K1 → K2** (VP = Verteilung direkt platzieren) |

Zusätzlich festgelegt: Bestandsschutz eigener Typen wie §4.3 (Kategorie und Maße verwendeter Typen gesperrt,
„Als neuen Typ anlegen“ für Varianten); spätere Artikelanbindung mit unterscheidbarer Artikelauswahl je
Planungstyp (§6.2), umgesetzt erst in Phase 7. Freigegeben zur Umsetzung ist **nur VP**.
