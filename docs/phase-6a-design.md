# Phase 6a – Entwurf: physische Wandzuordnung (T10) und Steigwege (T4)

**Status:** 2. Fassung · **Empfehlungen D1–D12 vom Auftraggeber als begrenzte MVP-Richtung
bestätigt (2026-10-06)** · **6a.0–6a.3 umgesetzt** (Checkpoint `595e8ac`) · **6a.4–6a.5
(Steigwege) umgesetzt** (2026-10-11, committet) · manuelle Gesamtprüfung nach Phase 6 ·
Umsetzungsstand und Präzisierungen: **§10**
**Stand:** 2026-10-04 (Entwurf), 2026-10-06 (Umsetzung 6a.0–6a.3), 2026-10-11 (Umsetzung 6a.4–6a.5)
**ADRs (accepted):**
[0024 – Wandkopplung](decisions/0024-wall-links-physical-wall-assignment.md) (umgesetzt),
[0025 – Steigwege und bestätigte Höhenlage](decisions/0025-risers-between-floors.md)
(Höhenlage und Steigwege umgesetzt)

> §1–§9 sind der bestätigte Entwurf. Wo die Umsetzung präzisiert oder abweicht, steht das in §10 –
> maßgeblich ist dann §10. Alle Beispiele sind synthetisch.

**Änderungen gegenüber der 1. Fassung:** fachliche Wirkung von `shared`/`separate` und
„unentschieden“ für Öffnungen, Geräte, Montageseite, 3D und Mengen (§2.2); Unterscheidung
Außenfläche/Zwischenfläche (§2.3); **bestätigte Höhenlage im Core** statt Plausibilität als
Ersatz (§2.5); Trennung von geometrischer Länge, Verlässlichkeit und Hinweisen – der Widerspruch
zur Standard-Deckenhöhe ist behoben (§4.4); **definierter Verlauf** je Steigwegabschnitt (§2.6);
ehrliche Reichweite des Paarmodells und korrigierter Alternativenvergleich (§7.3, §7.4).

Freigegebene **Grundrichtung**: Raumwände und ihre Bedienung bleiben; eine zusätzliche physische
Zuordnung verbindet zusammengehörige Wandabschnitte; Geräte behalten Montagefläche und Lage;
Geschossübergänge sind ausdrücklich angelegte, benannte Steigwege. Die technische Ausgestaltung
ist ein Vorschlag.

---

## 1. Befund zum vorhandenen Modell

Geprüft am Code (`apps/backend/app/modules/electrical/*`, `app/core/projects/*`,
`apps/planner/src/modules/electrical/*`) und an ADR 0013, 0016, 0022, 0023.

### 1.1 Wände, Öffnungen, Geräte

| Befund | Beleg | Folge |
|---|---|---|
| Eine Wand gehört genau **einem Raum**; gerichtete Strecke, ganzzahlige mm, eigene `thickness_mm` | `ElectricalWall` | dieselbe Bauwand ist bei zwei Räumen doppelt beschrieben, Stärken können abweichen |
| Raumhöhe je Raum (eigene Höhe oder Geschoss-Standardhöhe) | `ElectricalRoom.height_mm`, `FloorPlanningContext` | zwei Wandseiten können verschieden hoch sein |
| Öffnung **einmal** an der Eigentümerwand, Gegenseite abgeleitet | ADR 0016, `topology.foreign_openings` | Muster „eine Quelle, abgeleitete Gegenseite“ |
| Öffnungen und Geräte **wechseln nie ihre Wand** | Server: `opening-wall-changed`, Geräte-Wandprüfung in `service.py`; Editor: `wandTeilen` lehnt ab | Referenzen auf Raumwände sind stabil |
| Konturumkehr rechnet Abstände um (`L − x`) | `werkzeuge.ts konturUmkehren` | keine Abstände an fremder Bezugslinie speichern |
| Gemeinsame Stücke **abgeleitet**: exakt kollinear, positive Überlappung, atomare Abschnitte, Lagen `ganz + stufen·√m` | Frontend `topologie/`, Backend `topology.py` | exakte Grundlage vorhanden, kein Toleranzvergleich |
| 3D kennt je Abschnitt nur `gemeinsam` oder `aussen`; abweichende Stärke ist ein Konflikt | `ansicht3d/modell.ts` (`Wandlage`, `wand-staerke-abweichend`) | „getrennt“ ist heute nicht darstellbar |
| Fassade = abgeleitete Ansichtsgruppe | ADR 0022 §11 | bleibt Ansicht |
| Serverseitige Geräteprüfung nutzt die Ableitung: Öffnung des Nachbarn blockiert, Außenmontage auf geteiltem Stück verboten | `devices.py` (ADR 0023) | heute **nur ablehnend** genutzt; mit Kopplung muss die Wirkung je Zustand definiert werden (§2.2) |
| Mehrdeutiges (drei Räume, 1 mm Versatz, beidseitige Öffnungen) wird gemeldet, nicht bereinigt | ADR 0016 Präzisierung 4b.2 | Backfill darf nicht raten |

### 1.2 Geschosse und Höhen

| Feld | Vorhanden | Bedeutung | Verlässlichkeit |
|---|---|---|---|
| `floors.level` | `NOT NULL`, je Gebäude eindeutig | Geschossnummer | verlässlich für die **Reihenfolge** |
| `floors.elevation_mm` | `NOT NULL DEFAULT 0`; Schema-Default `0`; die Projektanlage setzt `0` | Höhenlage FFB über Gebäudebezug | **nicht unterscheidbar, ob gepflegt** |
| `floors.default_ceiling_height_mm` | Standard 2500 | lichte Standardhöhe | Raumhöhe, **keine** Geschosshöhe |
| Rohdecke, Deckenstärke, Geschosshöhe | **nein** | – | – |

Das Fachmodul liest Geschosse über `FloorPlanningAccess.context()`. Geschoss und Gebäude lassen
sich nicht umhängen. Ein Geschoss/Gebäude mit Planungsdaten lässt sich nicht löschen (FK, `409`).

---

## 2. Empfohlenes Datenmodell

### 2.1 Wandkopplung – gespeicherte Zuordnung, abgeleitete Geometrie

Eine **Wandkopplung** (`electrical_wall_links`) verbindet genau **zwei Raumwände verschiedener
Räume desselben Geschosses**, die exakt kollinear sind und sich überlappen. Sie speichert nur die
**Entscheidung**: `relation = shared` (eine Bauwand) oder `separate` (zwei Bauwände auf derselben
Achse). Lage, Länge und Bereich werden **immer** aus den Raumwänden abgeleitet. Die Raumwand
bleibt **einzige Geometriequelle**; Stärke und Höhe kommen aus Raumwand bzw. Raum.

```
Flur.f1  (0,3000) ───────────────────────────────────── (9000,3000)
Bad.b3   (3000,3000) ─────── (0,3000)
Kind.k3                (6000,3000) ─────── (3000,3000)
             ├── Kopplung f1↔b3 ──┤├── Kopplung f1↔k3 ──┤├── ohne Partner ──┤
```

Positionen auf einer Kopplung (ab 6b: Durchführungen) werden – wie Öffnungen – an einer
**Eigentümerwand** gespeichert; die Kopplung selbst speichert keine Abstände.

**Service-Regeln (exakt):** gleiche Organisation und Geschoss, verschiedene Räume, exakt
kollinear, positive Überlappung; je Raumwand überlappen sich ihre Kopplungsbereiche nicht (sonst
drei Räume auf einem Stück → `422 wall-link-ambiguous`); ein Paar höchstens einmal (`UNIQUE`,
kanonisch `wall_a_id < wall_b_id`).

### 2.2 Drei Zustände eines überlappenden Abschnitts und ihre Wirkung

Jedes atomare Stück, auf dem Raumwände **verschiedener Räume** exakt überlappen, ist in genau
einem Zustand:

* **unentschieden** – keine Kopplung (Bestand, neue Wände, mehrdeutige Fälle);
* **shared** – bestätigt: dieselbe Bauwand;
* **separate** – bestätigt: zwei Bauwände (z. B. zweischalige Trennwand, Gebäudefuge,
  Vorsatzschale), die im Achsmodell auf derselben Linie erfasst sind.

| Wirkung auf | unentschieden (konservativ) | shared | separate |
|---|---|---|---|
| **Öffnung des Nachbarraums** | wie heute abgeleitet und beidseitig angezeigt | abgeleitet: **durchgehende Öffnung** derselben Bauwand | **nicht übertragen** – die Öffnung gehört nur ihrer Wand; liegt im Bereich nur auf einer Seite eine Öffnung, Hinweis „Öffnung nur in einer der getrennten Wände“ |
| **Geräteprüfung** gegen die Nachbaröffnung | blockiert (wie heute) | blockiert | **blockiert nicht** – geprüft wird nur gegen Öffnungen der eigenen Wand |
| **Innenmontage** (`wall_interior`) | erlaubt (eigene Raumseite) | erlaubt | erlaubt |
| **Außenmontage** (`wall_exterior`) | verboten (wie heute: andere Seite könnte Nachbar sein) | verboten: die andere Seite ist die Innenfläche des Nachbarn | verboten im MVP: die äußere Seite ist eine **Zwischenfläche** (§2.3), keine Fassade |
| **3D** | ein Körper (wie heute) | ein Körper; abweichende Stärke = Konflikt (wie heute) | **zwei Halbkörper**: je Raum nur auf der eigenen Achsseite, Tiefe = eigene halbe Stärke; eine Öffnung schneidet nur den eigenen Halbkörper |
| **Durchführung (6b)** | nicht möglich – zuerst entscheiden | **eine** Durchführung, gehört zur Kopplung | nicht im MVP 6b; wäre fachlich zwei Durchführungen (je Bauwand) – offen (D9) |
| **Mengen (6b)** | Status „Zuordnung offen“ – keine Menge für Durchführungen dort | Öffnung und Durchführung je **einmal** | je Bauwand getrennt; keine Doppelzählung, weil es zwei Bauwände sind |

**Konsistenz:** Server (`devices.py`), Editorspiegel (`geraetepruefung.ts`), 2D-Topologie und
3D-Modell lesen die Kopplungen **gleich**; die gemeinsame Fixture `geraete.v1.json` wird um
Kopplungsfälle erweitert. Ein **Wechsel des Zustands** ist ein Schreibvorgang wie jeder andere und
unterliegt der Phase-5-Regel „keine neuen und keine größeren Gerätekonflikte“: Wird `separate` zu
`shared` (oder gelöst und damit unentschieden), und steht dann ein Gerät in der Nachbaröffnung,
wird der Wechsel mit `422` abgelehnt; nichts wird verschoben.

### 2.3 Außenfläche oder Zwischenfläche?

Eine Raumwand kennt nur **ihren** Raum. Was jenseits liegt – Außenluft, ein nicht modellierter
Raum (Garage, Nachbargebäude), ein Schacht oder eine Fuge – ist im Modell **nicht** gespeichert.
Das ist eine echte Grenze.

**MVP-Regel (eindeutig, ohne neue Daten):**

| Abschnitt | Bedeutung der äußeren Seite | `wall_exterior` |
|---|---|---|
| kein anderer Raum auf der exakten Geraden | „äußere Fläche – kein modellierter Nachbarraum“ | erlaubt (wie Phase 5) |
| unentschieden | möglicherweise Innenfläche eines Nachbarn | verboten |
| shared | Innenfläche des Nachbarn | verboten |
| separate | **Zwischenfläche** zwischen zwei Bauwänden | verboten |

`separate` wird damit **nicht** zur Fassade. Die Oberfläche benennt die erste Zeile ehrlich
(„Außenseite – kein modellierter Nachbarraum“), nicht als gesicherte Fassade. Eine ausdrückliche
Kennzeichnung der äußeren Seite (z. B. „grenzt an Nachbargebäude“) wäre eine spätere,
eigenständige Erweiterung (D10) – nicht Teil von 6a.

### 2.4 Steigweg

| Tabelle | Inhalt |
|---|---|
| `electrical_risers` | benannter Steigweg eines **Gebäudes** (`name`, eindeutig im Gebäude; optionale Notiz; `offset_mode = orthogonal \| direct`), versioniert |
| `electrical_riser_stops` | **Übergabepunkt** je angebundenem Geschoss: `floor_id`, `x_mm`, `y_mm`; höchstens einer je Steigweg und Geschoss |

Halte werden nach `level` sortiert; je zwei aufeinanderfolgende Halte bilden einen **Abschnitt**.
Ausgelassene Geschosse werden durchquert, ohne Anschluss. Kein Bezug zu Räumen; „liegt in Raum X“
wird nur angezeigt.

### 2.5 Bestätigte Höhenlage (Core)

Plausibilität ersetzt keine Bestätigung. Vorschlag: **eine neue Core-Spalte**
`floors.elevation_confirmed boolean NOT NULL DEFAULT false`.

| Regel | Festlegung |
|---|---|
| Bestand | Migration setzt **alle** vorhandenen Geschosse auf `false` – auch plausible Werte, auch das EG mit `0`. Keine automatische Bestätigung |
| Neuanlage | `FloorCreate.elevation_confirmed` optional, Standard `false`; die Projektanlage (Start-EG) bleibt unbestätigt |
| Nullwert | `elevation_mm = 0` **mit** `elevation_confirmed = true` ist ein zulässiger bestätigter Gebäudebezug |
| Ändern eines bestätigten Werts | ändert `FloorUpdate` die `elevation_mm`, ohne im selben Request `elevation_confirmed: true` zu senden, setzt der Server die Bestätigung auf `false`. Eine Bestätigung gilt immer genau für den gespeicherten Wert |
| Bestätigung zurücknehmen | `elevation_confirmed: false` ohne Wertänderung ist erlaubt |
| Rechte, Status | wie jede Geschossänderung (`If-Match`, Projektsperre, `completed`/`archived` schreibgeschützt) |
| Anzeige | Projektstruktur zeigt „Höhenlage bestätigt“ bzw. „nicht bestätigt“ neben dem Wert; Steigwege zeigen je Abschnitt den Status (§4.4) |
| Contract | `FloorPlanningContext` erhält additiv `elevation_confirmed: bool` (nur der Core erzeugt den Kontext; kein Fachmodul bricht) |
| Migration | eigene Core-Migration vor den Electrical-Tabellen (§6) |

### 2.6 Verlauf eines Steigwegabschnitts

Eine **einzige reine Funktion** `riser_course(abschnitt)` liefert den Verlauf als ganzzahlige
3D-Polylinie in mm (Geschosskoordinaten x/y, z = absolute Höhe über Gebäudebezug). Länge, 2D- und
3D-Darstellung verwenden ausschließlich diese Polylinie.

Für den Abschnitt vom unteren Halt `U = (xu, yu)` auf Geschoss `i` zum oberen Halt `O = (xo, yo)`
auf Geschoss `j` (`level_i < level_j`, `zi = elevation_i`, `zj = elevation_j`):

1. **senkrecht** am **unteren** Übergabepunkt: `(xu, yu, zi) → (xu, yu, zj)`;
2. **waagerecht** auf der Ebene des **oberen Fertigfußbodens** `zj` zum oberen Übergabepunkt:
   * `orthogonal`: zuerst entlang x, dann entlang y:
     `(xu, yu, zj) → (xo, yu, zj) → (xo, yo, zj)`;
   * `direct`: **eine** waagerechte Gerade `(xu, yu, zj) → (xo, yo, zj)` – keine diagonale
     3D-Luftlinie;
3. Teilstrecken der Länge 0 entfallen.

**Länge** = Summe der Teilstrecken: achsparallele Teile exakt ganzzahlig, die `direct`-Gerade
einmal kaufmännisch gerundet (ADR 0013). **2D:** im unteren Geschoss ein Steigwegsymbol am
Übergabepunkt, im oberen Geschoss der waagerechte Versatz als Linie zum Halt. **3D:** die Polylinie.

**Anschluss am Fertigfußboden – Einschränkungen:** Der Übergabepunkt liegt auf FFB-Höhe seines
Geschosses. Der Versatz auf der Ebene des oberen FFB steht stellvertretend für eine Führung im
Bodenaufbau bzw. in der Decke darunter; Deckenstärke und Aufbau sind nicht modelliert. Leitungen
verlassen einen Schacht in Wirklichkeit oft unter der Decke des unteren Geschosses – die Strecke
vom Übergabepunkt zur Austrittshöhe gehört in 6b zum **Leitungsweg**, der am Übergabepunkt
beginnt. So gibt es keine Doppelzählung (der Steigweg endet genau am Halt), aber auch keine
Aussage über bauliche Machbarkeit, Brandschutz oder Normen.

---

## 3. Beispiele (synthetisch)

### 3.1 Gemeinsame Wand (`shared`)

```
Raum A (0,0)–(4000,3000), Raum B (4000,0)–(7000,3000)
A.w1 (4000,0)→(4000,3000), B.w3 (4000,3000)→(4000,0), Stärke je 115
Tür an A.w1: offset 1000, Breite 900
```

Eindeutig → Backfill bzw. Vorschlag `shared`. Tür einmal gespeichert, auf B.w3 abgeleitet bei
`3000 − 1000 − 900 = 1100`, gezählt einmal. Steckdose innen an B.w3 bei Mitte 1500 (Tür B-seitig
1100–2000) → **abgelehnt** (Nachbaröffnung).

### 3.2 Getrennte Wände (`separate`)

Dieselbe Lage, aber bestätigt `separate` (zweischalige Trennwand).

* Die Tür an A.w1 erscheint **nicht** auf B.w3; Hinweis „Öffnung nur in einer der getrennten
  Wände“.
* Steckdose innen an B.w3 bei Mitte 1500 → **zulässig**.
* `wall_exterior` an A.w1 oder B.w3 → **abgelehnt** (Zwischenfläche).
* 3D: zwei Halbkörper (je halbe eigene Stärke, 57,5 mm Darstellung je Seite der Achse), die Tür schneidet nur den Halbkörper von A.
* Zurück auf `shared` bei vorhandener Steckdose → **422** (`device-in-opening`), nichts geändert.

### 3.3 Teilweise überlappend, abweichende Stärke

```
Flur.f1 (0,3000)→(9000,3000) Stärke 115
Bad.b3  (3000,3000)→(0,3000) Stärke 115
Kind.k3 (8000,3000)→(3000,3000) Stärke 240
```

f1↔b3 eindeutig; f1↔k3 **nicht** im Backfill (Stärke verschieden) – unentschieden, Konflikt
sichtbar; f1 8000–9000 ohne Partner: äußere Fläche ohne modellierten Nachbarn.

### 3.4 Steigweg mit seitlichem Versatz

```
Haupthaus: KG level −1 elevation −2800 (bestätigt)
           EG level  0 elevation     0 (bestätigt, Gebäudebezug)
           OG level  1 elevation  2900 (bestätigt)
Steigweg „Installationsschacht Flur“, orthogonal
  Halt KG (1200,3400) · Halt EG (1200,3400) · Halt OG (1650,3700)
```

| Abschnitt | Verlauf | Länge |
|---|---|---|
| KG → EG | senkrecht (1200,3400) z −2800 → 0 | 2800 |
| EG → OG | senkrecht (1200,3400) z 0 → 2900; waagerecht auf z 2900: x 1200 → 1650, dann y 3400 → 3700 | 2900 + 450 + 300 = 3650 |
| **Summe** | | **6450 mm (6,45 m)**, Status `confirmed` |

Mit `direct`: EG → OG waagerecht `√(450² + 300²) = 540,8…` → **541**; Summe 2800 + 2900 + 541 = 6241 mm.

**Unbestätigt:** OG-Höhenlage `2900`, aber `elevation_confirmed = false` → EG → OG Status
`elevation-unconfirmed`; der waagerechte Teil (750) ist bekannt, der senkrechte nicht; Summe
`incomplete` (bekannt: 2800 + 750). Keine Länge aus `level` oder Standardhöhe.

**Ausgelassenes EG:** Halte KG und OG → ein Abschnitt: senkrecht bei (1200,3400) von −2800 bis
2900 (5700), Versatz auf z 2900; EG „durchquert“, ohne Anschluss.

---

## 4. Geometrieänderungs- und Lebenszyklusregeln

### 4.1 Raumwand-Bearbeitung

Grundsatz: **Keine Referenz wechselt still Wand oder Montagefläche**; Kopplungen werden nie
automatisch angelegt, umgehängt oder geteilt.

| Vorgang | Kopplung | Geräte/Öffnungen |
|---|---|---|
| Verschieben, Ecke ziehen, Kürzen, Verlängern | Paar bleibt; Bereich neu abgeleitet; ohne Überlappung **„Kopplung unterbrochen“** (Zustand des Abschnitts dann: unentschieden bzw. ohne Partner) | unverändert; Phase-5-Prüfung läuft für den neuen Zustand |
| Teilen | ursprüngliche ID behält die Kopplung (Bereich schrumpft); das neue Stück ist unentschieden | wechseln nie die Wand |
| Zusammenführen (Ecke entfernen) / Wand entfernen | nur ausdrücklich: `removed_wall_link_ids`, sonst `409 wall-has-links` | wie bisher (`wall-has-devices`) |
| Wand einzeln löschen | `409 wall-has-links` | wie bisher |
| Kontur umkehren | keine Wirkung | Abstände wie bisher umgerechnet |
| Stärke ändern | bei `shared` Konflikt „Stärke widersprüchlich“; bei `separate` keiner (zwei Bauwände) | – |
| Raum löschen | Wände → Kopplungen `CASCADE`; Bestätigung nennt die Anzahl | wie bisher |

**Unterbrochene Kopplung:** bleibt gespeichert und sichtbar, bis sie neu bestätigt wird (sobald
die Geometrie wieder passt, gilt sie von selbst wieder) oder gelöst wird. Der Abschnitt verhält
sich währenddessen **konservativ** (unentschieden). Da der Zustand dadurch strenger werden kann,
läuft die Phase-5-Geräteprüfung ohnehin mit. In 6a gibt es keine weiteren abhängigen Daten; ab 6b
werden Änderungen abgelehnt, die eine Durchführung aus ihrer Kopplung schieben würden.

### 4.2 Vorschlag und Bestätigung

| Fall | Verhalten |
|---|---|
| exakt kollinear, Überlappung > 0, verschiedene Räume, auf **jedem** atomaren Abschnitt genau zwei Räume, beide Konturen gültig, gleiche Stärke, keine beidseitig erfasste Öffnung im Bereich, keine andere Kopplung dieser Wände im Bereich | **eindeutig** → Vorschlag `shared`; Backfill legt `shared` (`origin = backfill`) an |
| sonst gleich, aber Stärke verschieden, Öffnungsdublette, offene Kontur | Bestätigung nötig (`shared` oder `separate`), kein Backfill |
| drei oder mehr Räume, Bereich überschneidet vorhandene Kopplung | nicht koppelbar (`422`), Konflikt sichtbar |
| Endpunktberührung, Versatz, nicht parallel, anderes Geschoss | nie ein Vorschlag |

`separate` wird **nie** vorgeschlagen oder per Backfill angelegt – nur ausdrücklich.

### 4.3 Geräte und Öffnungen

Keine Positionsänderung, keine Duplikate, keine neue Spalte. Innen bleibt `wall_interior` der
eigenen Raumwand. Wirkungen je Zustand: §2.2. Öffnungen bleiben eine Zeile an ihrer
Eigentümerwand.

### 4.4 Steigwege: Länge, Verlässlichkeit, Hinweise – getrennt

| Ebene | Inhalt | Abhängig von |
|---|---|---|
| **Geometrische Länge** | Polylinie aus §2.6 | Halte, `offset_mode`, `elevation_mm`, `level` |
| **Verlässlichkeit** (Status) | `confirmed`, wenn beide Geschosse `elevation_confirmed`; sonst `elevation-unconfirmed` (senkrechter Teil ohne Wert); `elevation-inconsistent`, wenn beide bestätigt und das höhere `level` **nicht** höher liegt (`Δz ≤ 0`); `single-stop` | `elevation_confirmed`, `level` |
| **Plausibilitätshinweis** (blockiert nichts, ändert keine Länge) | „Geschossabstand kleiner als lichte Höhe des unteren Geschosses“ (`Δz < default_ceiling_height_mm` unten) | `default_ceiling_height_mm` |

Die Standard-Deckenhöhe beeinflusst damit **nur den Hinweis**, nie Länge oder Status.

| Vorgang | Wirkung |
|---|---|
| `elevation_mm` ändern | Länge neu; Bestätigung fällt weg, wenn nicht mitgesendet (§2.5) → Status `elevation-unconfirmed` |
| `elevation_confirmed` setzen/entziehen | nur Status |
| `level` ändern | Reihenfolge und Abschnitte neu |
| Standardhöhe ändern | nur Hinweis neu |
| Geschoss / Gebäude löschen | FK `RESTRICT` → vorhandenes `409` |
| Projekt löschen | `ProjectContentParticipant` löscht Steigwege vor dem Core-Kaskadieren |
| Raum ändern/löschen | keine Wirkung |

Summe des Steigwegs: `confirmed` nur, wenn alle Abschnitte `confirmed`; sonst `incomplete` mit
bekannter Teilsumme (waagerechte Teile sind immer bekannt).

---

## 5. Architektur und Konsistenz

* **Fachlogik in `electrical`:** Kopplungsregeln, Zustandswirkung, Steigwege, Verlauf, Länge.
* **Core:** nur die neue Spalte `elevation_confirmed` samt Schema/API/Oberfläche der
  Projektstruktur und das additive Feld im `FloorPlanningContext`. Der Core importiert nichts aus
  `electrical`.
* **Keine neuen Teilnehmer-Contracts:** Projektlöschung (`ProjectContentParticipant`, + Inhalte
  `electrical.risers`, `electrical.wall_links`), Geschoss-/Gebäudelöschung (FK `409`),
  Standardhöhe (`FloorCeilingHeightParticipant` unberührt), Höhenlage/Bestätigung (nichts
  Abgeleitetes gespeichert).
* **Kleine Core-Erweiterung (D5):** `FloorPlanningAccess.building_context()` /
  `writable_building_context()` für gebäudebezogene Steigweg-Endpunkte.
* **API-Skizze** (Pydantic/OpenAPI bleibt Quelle):

  ```
  GET    /floors/{floor_id}/wall-links       Kopplungen, abgeleiteter Status, Vorschläge
  POST   /floors/{floor_id}/wall-links       {wall_a_id, wall_b_id, relation}
  PATCH  /wall-links/{id}                    {relation}, If-Match
  DELETE /wall-links/{id}                    If-Match
  PUT    /rooms/{id}/contour                 + removed_wall_link_ids (optional)
  GET    /buildings/{building_id}/risers     inkl. Halte, Verlauf, Längenstatus
  POST   /buildings/{building_id}/risers
  PUT    /risers/{id}                        ganze Halteliste, If-Match
  DELETE /risers/{id}                        If-Match
  PATCH  /floors/{id}                        (Core) + elevation_confirmed
  ```
* **Rechte:** `electrical.plan.read/write`; Geschoss wie bisher über die Projektstruktur-Rechte.
* **Events:** Kopplungen über `plan_updated` mit additivem `change_kind = wall_links_changed`;
  Steigwege kein Event im MVP (kein Konsument, nichts abgeleitet gespeichert).

**Transaktionen und Sperrreihenfolge** („Projekt zuerst“):

| Vorgang | Reihenfolge in **einer** Transaktion |
|---|---|
| Kopplung anlegen/ändern/lösen | Projektzeile → (Kopplung `If-Match`) → beide Raumwände und Geräte des Geschosses lesen → **Geräte-Baseline** → schreiben → Gerätebefunde „nicht neu, nicht größer“ |
| Konturspeichern | Projektzeile → Raum → Wände/Öffnungen/Geräte → Kopplungen der entfallenden Wände nur mit `removed_wall_link_ids` → Gerätebefunde (jetzt mit Kopplungen) |
| Steigweg schreiben | Projektzeile → Steigweg `If-Match` → Halte ersetzen → Geschosse über `context()` gegen dasselbe Gebäude prüfen |
| Höhenlage bestätigen/ändern | Projektzeile → Geschoss `If-Match` → Bestätigungsregel |
| Projekt abschließen/archivieren/löschen | Projektzeile – serialisiert gegen alle obigen; Löschen: Teilnehmer vor Core |

Weil jeder Schreibvorgang zuerst die Projektzeile sperrt, entsteht keine neue Deadlock-Reihenfolge.

---

## 6. Migrationsstrategie (Entwurf, nicht ausführbar)

Zwei neue Migrationen im einzigen Strang; 0001–0008 bleiben unverändert.

**0009_elevation_confirmed (Core)** – ursprünglich `0009_floor_elevation_confirmation`, vor jeder
Anwendung gekürzt (Revision-ID länger als 32 Zeichen, siehe §10)

```text
floors.elevation_confirmed boolean NOT NULL DEFAULT false   -- Bestand: false
```

Downgrade entfernt die Spalte (Bestätigungen gehen verloren, Höhenlagen bleiben).

**0010_wall_links_and_risers (Electrical)**

```text
electrical_wall_links
  id, organization_id, wall_a_id, wall_b_id
  relation varchar(16) CHECK in ('shared','separate')
  origin   varchar(16) CHECK in ('user','backfill')
  created_by_user_id NULL, version, created_at, updated_at
  UNIQUE (organization_id, id), UNIQUE (organization_id, wall_a_id, wall_b_id)
  CHECK (wall_a_id < wall_b_id)
  FK (organization_id, wall_a_id|wall_b_id) -> electrical_walls ON DELETE CASCADE
  INDEX (organization_id, wall_a_id), INDEX (organization_id, wall_b_id)

electrical_risers
  id, organization_id, building_id, name varchar(120), note varchar(500) NULL
  offset_mode varchar(16) CHECK in ('orthogonal','direct'), version, timestamps
  UNIQUE (organization_id, id), UNIQUE (organization_id, building_id, name)
  FK (organization_id, building_id) -> buildings ON DELETE RESTRICT

electrical_riser_stops
  id, organization_id, riser_id, floor_id, x_mm int, y_mm int, timestamps
  CHECK (abs(x_mm) <= 1000000 AND abs(y_mm) <= 1000000)
  UNIQUE (organization_id, id), UNIQUE (organization_id, riser_id, floor_id)
  FK (organization_id, riser_id) -> electrical_risers ON DELETE CASCADE
  FK (organization_id, floor_id) -> floors ON DELETE RESTRICT
  INDEX (organization_id, floor_id)
```

Tabellenübergreifende Regeln (selbes Geschoss, verschiedene Räume, Halt im selben Gebäude) prüft
der Service unter der Projektsperre.

**Backfill – kein Teil der Migration:** idempotenter Befehl
`python -m app.cli wall-links-backfill [--project PR-…] [--apply]` (Standard: Probelauf).

1. je Projekt eine Transaktion mit Projektsperre; `completed`/`archived` nur berichten;
2. nur eindeutige Fälle (§4.2) als `shared`, `origin = backfill`; nie `separate`;
3. vorhandene Paare überspringen (`UNIQUE`) → wiederholbar, nach Abbruch fortsetzbar;
4. **Unveränderlichkeit:** Prüfsumme über Wand-, Öffnungs- und Gerätefelder vorher = nachher,
   sonst Rollback; zusätzlich Gerätebefunde vorher/nachher gleich (eindeutige Fälle entsprechen dem
   konservativen Bestand, es darf kein Befund entstehen);
5. Bericht: angelegt, vorhanden, mehrdeutig mit Grund – mehrdeutige Fälle bleiben unentschieden.

Höhenlagen werden **nicht** gebackfillt (keine automatische Bestätigung).

**Rückfall:** Downgrade von 0010 entfernt Kopplungen und Steigwege, von 0009 die Bestätigungen.
Wände, Öffnungen, Geräte und Höhenlagen bleiben unberührt. Vor dem Upgrade Backup; bestätigte
Entscheidungen (`separate`, nicht eindeutige `shared`, Höhenbestätigungen) sind nach einer
Rückmigration nicht wiederherstellbar.

---

## 7. Risiken, Reichweite und Entscheidungen

### 7.1 Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Unterbrochene Kopplungen beim raumweisen Bearbeiten | sichtbar, gelten von selbst wieder bei passender Geometrie; Abschnitt währenddessen konservativ |
| Abweichende Stärken verhindern Backfills | Bericht; Angleichen ist normale Wandbearbeitung |
| Alle Bestands-Höhenlagen unbestätigt → keine senkrechten Längen bis zur Bestätigung | gewollt; Projektstruktur zeigt den offenen Punkt deutlich |
| Zustandswechsel einer Kopplung kann Gerätekonflikte auslösen | Phase-5-Regel greift, Wechsel wird abgelehnt statt Geräte zu verschieben |
| Außenfläche bedeutet nur „kein modellierter Nachbar“ | ehrliche Bezeichnung; Erweiterung D10 |

### 7.2 Reichweite des Paarmodells (T10)

| Bedarf | Gelöst? | Wie / warum nicht |
|---|---|---|
| stabile Referenz für eine Bauwand zwischen **zwei modellierten Räumen** | **ja** | Kopplungs-ID; Position an Eigentümerwand |
| Entscheidung „eine oder zwei Bauwände“ in mehrdeutigen Fällen speichern | **ja** | `shared`/`separate` |
| Öffnungen und Durchführungen zwischen zwei Räumen **einmal** zählen | **ja** (Öffnung sofort, Durchführung ab 6b) | eine Zeile je Kopplung |
| stabile Referenz für eine **ungepaarte Außenwand** | **teilweise** | die Raumwand-ID ist stabil und genügt für Montage, Wegführung auf der Fläche und eine Durchführung nach außen; **nicht** gelöst: eine Außenwand hinter mehreren Räumen als **eine** Bauwand |
| Mengen bei **unterschiedlichen Höhen** | **teilweise** | flächenbezogene Mengen je Wandfläche (eigene Raumhöhe) sind eindeutig; eine Bauwand-Fläche/-Höhe als eine Größe gibt es nicht |
| Mengen bei **unterschiedlichen Stärken** | **nein** (nur erkannt) | zwei Werte; bei `shared` Konflikt, Durchführungslänge erst nach Angleichen |
| **Wandteilung** mit späteren abhängigen Daten | **teilweise** | Kopplung bleibt an der ursprünglichen ID; Daten wechseln nie die Wand (Teilung wird abgelehnt, wenn etwas in die neue Hälfte fiele); **nicht** gelöst: Übertragen einer Kopplung auf das neue Stück – nur ausdrücklich, als spätere Bedienhilfe (D11) |
| **unterbrochene Kopplungen** | **teilweise** | sichtbar, konservativ, selbstheilend; ab 6b blockierend bei abhängigen Daten; **nicht** gelöst: gleichzeitiges Verschieben beider Raumseiten in einem Schritt |
| Bauwandkonstruktion (Mauerwerksmengen, Wandaufbau) | **nein** | nicht im Elektro-Umfang |

### 7.3 Phase-6b-Anwendungsfälle und Deckung

| Fall | Referenz | Paarmodell genügt |
|---|---|---|
| U1 Leitungsweg auf einer Wandfläche | Raumwand + Seite + Abstände | ja (ohne Kopplung) |
| U2 Durchführung zwischen zwei Räumen | `shared`-Kopplung + Lage an Eigentümerwand | ja |
| U3 Durchführung nach außen | Raumwand ohne Partner im Bereich | ja |
| U4 Mengen ohne Doppelzählung (Durchführungen, Dosen, Schlitze je Fläche) | Kopplung bzw. Fläche | ja |
| U5 Anschluss an Steigweg | `riser_stop_id` | ja |
| U6 Durchführung durch getrennte Wände | zwei Bauwände | offen (D9) |

### 7.4 Alternativen (korrigiert)

| | A: nur Ableitung | **B: Paar (Empfehlung)** | C′: physische Referenztabelle **ohne** eigene Geometrie | C: physische Wand **mit** Geometrie |
|---|---|---|---|---|
| Geometriequellen | 1 | 1 | 1 (Mitglieder verweisen auf Raumwandbereiche) | 2 |
| stabile Referenz Raum↔Raum | nein | ja | ja | ja |
| stabile Referenz Außenwand über mehrere Räume | nein | nein | **ja** | ja |
| Entscheidung speicherbar | nein | ja | ja | ja |
| Pflegeaufwand | – | Zeile nur bei überlappenden Paaren | Zeile für **jede** Bauwand; Mitgliedschaft je Teilbereich bei jedem Anlegen, Teilen, Löschen, Verschieben nachführen | Synchronisation zweier Geometrien |
| Backfill | eindeutige Paare | eindeutige Paare | **alle** Wände, inkl. Außenwandgruppen (wo eine Fassadengruppe gerade nicht automatisch eine Bauwand ist) | Umbau |

C′ hätte **keine** zweite Geometriequelle – die Einschätzung der 1. Fassung war insoweit zu grob.
Ihr zusätzlicher Nutzen (eine Außenwand hinter mehreren Räumen, Bauwand-Eigenschaften) wird von
keinem 6b-Fall (§7.3) gebraucht, kostet aber Mitgliedschaftspflege bei jeder Wandbearbeitung und
einen Backfill mit genau den Mehrdeutigkeiten, die eine Fassadengruppe hat. **Empfehlung B**, mit
offenem Weg: Wird später eine Bauwand-Referenz gebraucht, lässt sich jede Kopplung als zwei
Mitglieder einer C′-Zeile übernehmen.

### 7.5 Offene Entscheidungen

| # | Frage | Empfehlung |
|---|---|---|
| D1 | Kopplung als Raumwandpaar | **ja (B)** |
| D2 | eindeutige Bestandsfälle per Backfill als `shared` | **ja** – entspricht dem heutigen konservativen Verhalten, ohne Befundänderung |
| D3 | bestätigte Höhenlage als Core-Spalte `elevation_confirmed` (Bestand `false`) | **ja** |
| D4 | eigene Höhe am Übergabepunkt | **nein im MVP** (Anschluss am FFB, Rest im Leitungsweg) |
| D5 | `building_context()` im `FloorPlanningAccess` | **ja** |
| D6 | Geräteprüfung liest Kopplungen (`separate` wirkt, unentschieden konservativ) | **ja, in 6a** – sonst hätte `separate` keine definierte Wirkung |
| D7 | `separate` im MVP | **ja** |
| D8 | neue Wand auf exakter Überlappung: nur Vorschlag | **ja** |
| D9 | Durchführung durch `separate`-Wände in 6b | **zurückstellen**; zuerst `shared`-Durchführungen |
| D10 | Kennzeichnung der äußeren Seite (Nachbargebäude, Schacht) | **nicht in 6a** |
| D11 | Bedienhilfe „Kopplung auf neues Teilstück übertragen“ | **nicht in 6a**, nach Bedarf |
| D12 | Versatzebene des Steigwegs am oberen FFB, rechtwinklig x vor y | **ja** (deterministisch, einfach) |

---

## 8. Begrenzte Umsetzungsschritte (nach Freigabe)

| Schritt | Inhalt | Umfang (Schätzung) |
|---|---|---|
| 6a.0 | Core: `elevation_confirmed` (Migration 0009, Schema, API, Projektstruktur-UI, Context-Feld) | ~5 Dateien, ~12 Tests |
| 6a.1 | Kopplung Backend: Migration 0010 (Kopplungsteil), Modelle, Regeln, Zustandswirkung in `devices.py`, API, `removed_wall_link_ids`, `wall-has-links` | ~7 Dateien, ~40 Tests |
| 6a.2 | Kopplung Frontend: Topologie/3D mit Zuständen (Halbkörper bei `separate`), Editorspiegel, Vorschlag/Bestätigen/Lösen, erweiterte Fixture | ~7 Dateien, ~25 Tests |
| 6a.3 | Backfill-Befehl (Probelauf, Bericht, Prüfsumme, Befundvergleich) | 1–2 Dateien, ~10 Tests |
| 6a.4 | Steigwege Backend: Migration 0010 (Steigwegteil), `riser_course`, Status, Service, API, Löschteilnehmer, `building_context` | ~7 Dateien, ~30 Tests |
| 6a.5 | Steigwege Frontend: Liste/Formular je Gebäude, Symbol und Versatzlinie im Grundriss, Polylinie in 3D, Längen mit Status | ~6 Dateien, ~15 Tests |

Gesamt grob: **zwei** Migrationen, **zwei** ADRs, ~35 Dateien, ~130 Tests. 6a.0 zuerst (Voraussetzung
für 6a.4); 6a.1–6a.3 und 6a.4–6a.5 sind voneinander unabhängig.

**Nicht in 6a:** Leitungsrouting, Durchführungen, Mengen, Kollisionsprüfung, Schachtplanung,
Normprüfung (CLAUDE.md Regel 12).

---

## 9. Abnahmekriterien und Testfälle

**Kopplung – Zustände**

1. `shared` (3.1): Tür auf B.w3 abgeleitet; Steckdose in der Tür B-seitig → `422`.
2. `separate` (3.2): Tür **nicht** auf B.w3; dieselbe Steckdose → zulässig; Hinweis „Öffnung nur
   in einer der getrennten Wände“.
3. `separate`: `wall_exterior` an beiden Wänden → `422` (Zwischenfläche); ohne Partner →
   zulässig (Phase-5-Verhalten unverändert).
4. Unentschieden: Verhalten exakt wie Phase 5 (Regressionssuite unverändert grün).
5. Wechsel `separate → shared` bzw. Lösen mit Steckdose in der Tür → `422`, nichts gespeichert.
6. 3D: `separate` ergibt zwei Halbkörper, Öffnung nur im eigenen; `shared`/unentschieden ein
   Körper.
7. Server, Editorspiegel und 3D liefern für die erweiterte Fixture dieselben Zustände und Befunde.

**Kopplung – Geometrie und Lebenszyklus**

8. Lange Flurwand mit drei Partnern: drei Kopplungen; vierter Raum auf gekoppeltem Stück → `422`.
9. Teilüberlappung auf schräger Wand: Bereich exakt (`√m`-Grenzen).
10. Stärke verschieden → kein Backfill; `shared` danach mit Konflikt, `separate` ohne.
11. 1 mm Versatz, Endpunktberührung, anderes Geschoss → nie Vorschlag; `separate` nie Vorschlag.
12. Verschieben → „unterbrochen“, Abschnitt konservativ, Speichern erlaubt (sofern keine neuen
    Gerätebefunde); Zurückschieben → wieder gültig.
13. Teilen → Kopplung an ursprünglicher ID, neues Stück unentschieden.
14. Entfernen ohne `removed_wall_link_ids` → `409 wall-has-links`; mit → gelöst.
15. Konturumkehr → Kopplung gültig, nichts umgerechnet.
16. Raum löschen → Kopplungen weg, Partnerraum unverändert.
17. Mandantentrennung, Leserecht, `completed`/`archived`, If-Match, gleichzeitiges
    Konturspeichern und Koppeln (PostgreSQL, Barrieren).

**Backfill**

18. Probelauf ändert nichts; `--apply` nur eindeutige `shared`; zweiter Lauf 0 neu; Fortsetzen nach
    Abbruch.
19. Prüfsumme Wände/Öffnungen/Geräte und Gerätebefunde vorher = nachher; künstliche Abweichung →
    Rollback.
20. Mehrdeutige Fälle im Bericht mit Grund; keine Höhenlage bestätigt.

**Höhenlage**

21. Nach Migration sind alle Geschosse unbestätigt (auch EG mit 0).
22. EG `0` bestätigt → gültiger Gebäudebezug.
23. Bestätigte Höhenlage ändern ohne `elevation_confirmed: true` → unbestätigt; mit → bestätigt.
24. Bestätigung ohne Wertänderung entziehen → unbestätigt.

**Steigwege**

25. Beispiel 3.4 `orthogonal`: Verlauf `(1200,3400,−2800)→(1200,3400,0)→(1200,3400,2900)→
    (1650,3400,2900)→(1650,3700,2900)`, Summe 6450, `confirmed`.
26. `direct`: waagerecht 541 (gerundet einmal), Summe 6241; keine 3D-Diagonale.
27. OG unbestätigt → Abschnitt `elevation-unconfirmed`, Summe `incomplete` (bekannt 3550).
28. Beide bestätigt, OG tiefer als EG → `elevation-inconsistent`.
29. Δz 2200 bei lichter Höhe 2500 → Hinweis, Länge und Status unverändert; Standardhöhe ändern
    ändert nur den Hinweis.
30. Ausgelassenes EG: ein Abschnitt, senkrecht 5700, EG „durchquert“.
31. Halt auf Geschoss eines anderen Gebäudes / zweiter Halt im selben Geschoss → `422`.
32. Geschoss mit Halt bzw. Gebäude mit Steigweg löschen → `409`; Projekt löschen → Steigwege weg.
33. Länge, 2D-Linie und 3D-Polylinie stammen aus derselben Funktion (Test vergleicht).

**Architektur**

34. import-linter grün; Core importiert keine Electrical-Tabellen; `FloorPlanningContext` nur
    additiv erweitert.
35. Ein Alembic-Head; OpenAPI-Drift-Check grün; alle neuen Längen/Lagen ganzzahlige mm.

---

## 10. Umsetzungsstand 6a.0–6a.3 (2026-10-06)

> **Historischer Stand vom 2026-10-06.** Aussagen über Steigwege („NOT STARTED“, „keine API,
> kein Service“) sind **überholt**: 6a.4–6a.5 sind seit 2026-10-11 umgesetzt, siehe **§10.5**.

Freigegeben und umgesetzt: **6a.0** (bestätigte Höhenlage), **6a.1** (Wandkopplungen im Backend),
**6a.2** (Darstellung und Bedienung), **6a.3** (Backfill-Befehl). **Nicht** umgesetzt und weiterhin
**NOT STARTED:** 6a.4–6a.5 (Steigweg-API, -Service, -Oberfläche, Verlauf, Längen),
Leitungsrouting, Stromkreise, Durchführungen, Mengen. T10 gilt im begrenzten Umfang des
Paarmodells als entschieden; T4 ist architektonisch beschlossen, aber nicht implementiert.
Abnahmekriterien 1–24 und 34–35 (§9) sind durch Tests belegt (Zuordnung in §10.4); 25–33
(Steigwege) sind offen.

### 10.1 Präzisierungen gegenüber §1–§9

| Thema | Umsetzung |
|---|---|
| Zustandsauflösung | Eine Kopplung wirkt auf einem atomaren Abschnitt genau dann, wenn **genau ihre beiden Wände** ihn überdecken. Bei einer dritten Wand (dritter Raum, doppelte Wand, überschneidende Kopplungen) ist der Abschnitt `undecided`. Server (`topology.section_state`) und Frontend (`abschnittsZuordnung`) sind gleichlautend; gemeinsame Fixture `testdata/geometry/wandkopplung.v1.json` (10 Fälle) |
| Kopplungsstatus | abgeleitet, nicht gespeichert: `active`, `ambiguous` (teilweise dritte Wand – dort konservativ), `broken` („unterbrochen“, kein gemeinsamer Abschnitt). Planungsstand und `GET …/wall-links` liefern ihn |
| Anlegen | `422` bei fehlender exakter Überlappung (`wall-link-no-overlap`), dritter Wand auf einem Stück des Bereichs (`wall-link-ambiguous`), gleicher Wand, gleichem Raum, anderem Geschoss, unbekannter oder fremder Wand; `409 wall-link-exists` für ein schon gekoppeltes Paar |
| Wirkung je Zustand | nur `separate` ändert die Geräteprüfung (keine Nachbaröffnung); Außenmontage bleibt auf **jedem** Stück mit Nachbarraum verboten (`shared`: Innenfläche des Nachbarn; `separate`: Zwischenfläche, keine Fassade) |
| Versionen, veraltete Entwürfe | Jede Kopplungsänderung zählt die **Raumversion beider Räume** weiter (Anlegen, Ändern, Lösen, Lösen beim Konturspeichern, Backfill, Partner bei Raumlöschung). Ein vor der Zuordnung geöffneter Entwurf erhält beim Speichern `409 version-conflict` und kann sie nicht still unterbrechen. Im Editor sind Zuordnungsaktionen nur bei gespeichertem Entwurf möglich |
| Entfernen gekoppelter Wände | Konturspeichern: jede Kopplung einer entfallenden Wand muss in `removed_wall_link_ids` stehen (sonst `409 wall-has-links`); jede genannte muss eine entfallende Wand **dieses** Raums betreffen (sonst `422 wall-link-not-affected`); Duplikate `422`. Der Editor fragt vor dem Speichern ausdrücklich nach. Einzellöschen einer gekoppelten Wand: `409 wall-has-links` |
| Raumlöschung | Kopplungen per `CASCADE`; die Partnerräume zählen ihre Version weiter; die Rückfrage in „Tabellen & Details“ nennt die Anzahl der Wandzuordnungen |
| Kandidaten | `suggested` (eindeutig); `decision-needed` mit Gründen `thickness-differs`, `contour-open`, `openings-on-both-sides`; `not-linkable` mit `ambiguous`. Berechnet nur der Server; der Planungsstand liefert sie. Nichts wird automatisch gekoppelt |
| Events | `electrical.plan.updated` mit `change_kind = wall_links_changed`, je beteiligtem Raum ein Event; eine unveränderte Entscheidung (gleiche `relation`) schreibt und sendet nichts |
| Fremdschlüssel | die beiden zusammengesetzten FKs auf `electrical_walls` sind ausdrücklich benannt, weil die Namenskonvention beiden denselben Namen gäbe |
| Revision-ID 0009 | `0009_floor_elevation_confirmation` (33 Zeichen) passt nicht in `alembic_version.version_num varchar(32)` – auf der Wegwerf-Testdatenbank aufgefallen und vor jeder dauerhaften Anwendung auf `0009_elevation_confirmed` gekürzt |
| Steigweg-Tabellen | in `0010` vollständig nach §6 angelegt (ORM-Modelle nur für den Schema-Abgleich); keine API, kein Service, keine Oberfläche, keine Daten. Der Löschteilnehmer für Steigwege fehlt bis 6a.4 bewusst – ohne Daten blockiert das `RESTRICT` auf `buildings` nichts |
| Backfill | `python -m app.cli wall-links-backfill [--project PR-…] [--apply]`. Projekte findet das Modul über die eigenen Räume und `FloorPlanningAccess` (keine Core-Tabelle). Je Projekt eine Transaktion unter Projektsperre; Prüfsumme (Wände, Öffnungen, Geräte samt Version und Zeitstempel) und Gerätebefunde vorher/nachher; Abweichung oder inzwischen schreibgeschütztes Projekt → Rollback des Projekts, Rückgabewert 1. Der Probelauf rollt immer zurück |

### 10.2 Oberfläche

* **Projektstruktur:** „Höhenlage bestätigt“/„nicht bestätigt“ neben jeder Höhenlage; Hinweis,
  dass unbestätigte Höhenlagen nicht als verlässlich gelten; je Geschoss „Höhenlage“ bearbeiten
  (Wert und Häkchen; bei geändertem Wert wird das Häkchen zurückgesetzt und heißt „Neue Höhenlage
  bestätigen“); beim Anlegen optional bestätigen. Die Startstruktur bestätigt nichts.
* **Grundriss-Editor:** an der gewählten Wand der Bereich „Wandzuordnung“ je Nachbarwand: Zustand
  (Zuordnung offen, Vorschlag, gemeinsame Bauwand, getrennte Wände, unterbrochen, nicht
  eindeutig; dazu „Widersprüchliche Stärke“, „aus Bestand übernommen“), betroffener Bereich in der
  Anzeigeeinheit, Erklärung der Wirkung, Aktionen „Als gemeinsame Bauwand bestätigen“, „Als
  getrennte Wände festlegen“, „Auf … ändern“ und „Zuordnung lösen“ (die beiden letzten mit
  Rückfrage). Keine technischen IDs. Im Grundriss: getrennte Wände mit einer Fuge auf der Achse,
  offene Zuordnungen fein gestrichelt, mehrdeutige in Warnfarbe.
* **Wandansicht:** Abschnittsliste mit Zuordnung; „Außenseite – kein modellierter Nachbarraum“
  statt „Außenwand“; Öffnungen getrennter Wände erscheinen nur auf ihrer eigenen Seite; Hinweis
  „Öffnung nur in einer der getrennten Wände“.
* **3D:** `separate` als zwei Halbkörper (je Raum auf der Seite seines Inneren, eigene halbe
  Stärke, eigene Höhe, nur eigene Öffnungen) mit Trennfuge; Auswahlfläche einer Öffnung in der
  Mitte ihres Halbkörpers; Seitenleiste mit Zustand und dem ausdrücklichen Hinweis auf die
  vereinfachte Darstellung; Hinweise für unterbrochene und mehrdeutige Kopplungen und einseitige
  Öffnungen; „widersprüchliche Stärke“ nur bei `shared`.

### 10.3 Bekannte Grenzen (sichtbar)

Siehe §7.2 und ADR 0024 „Reichweite“. Zusätzlich: Ein Vorschlag bezieht sich auf den
**gespeicherten** Stand; neue, noch nicht gespeicherte Wände erhalten erst nach dem Speichern
einen Vorschlag. Eine Zuordnung wird sofort gespeichert und ist nicht Teil der Undo-Historie des
Raumentwurfs.

### 10.4 Abnahmekriterien → Tests

| Kriterien (§9) | Belegt durch |
|---|---|
| 1–7 Zustände, Fixture-Parität | `tests/test_electrical_wall_links.py`, `tests/test_wall_link_parity.py`, `topologie/wandkopplung.test.ts`, `ansicht3d/kopplung3d.test.ts` |
| 8–17 Geometrie, Lebenszyklus, Rechte, Status, Parallelität | `tests/test_electrical_wall_links.py`, `tests/test_tenant_isolation.py`, `tests/test_wall_link_concurrency.py`, `tests/test_archive_concurrency.py`/`test_completed_concurrency.py` (Schreibweg `kopplung-anlegen`), `editor/Wandzuordnung.editor.test.tsx` |
| 18–20 Backfill | `tests/test_wall_link_backfill.py` |
| 21–24 Höhenlage | `tests/test_floor_elevation_confirmation.py`, `tests/test_migration_wall_links.py`, `platform/Hoehenlage.test.tsx` |
| 34–35 Architektur | import-linter, `tests/test_module_boundaries.py`, `tests/test_migration_acceptance.py`, `tests/test_migration_wall_links.py`, OpenAPI-Drift-Check |

### 10.5 Umsetzungsstand 6a.4–6a.5 – Steigwege (2026-10-11)

Umgesetzt nach §2.4–§2.6 und §4.4; **keine** zusätzliche Migration (Head bleibt `0011`).
Phase 6b bleibt NOT STARTED. Präzisierungen stehen zusätzlich in ADR 0025.

| Thema | Umsetzung |
|---|---|
| Core | `FloorPlanningAccess.building_context()` / `writable_building_context()` (Projekt sperren, danach Gebäude und Geschosse frisch lesen) und `building_ids_of_project()`; `BuildingPlanningContext` mit allen Geschossen als `FloorPlanningContext`. Kein Electrical-Import im Core |
| Reine Funktion | `electrical/riser_course.py` (`riser_course`, `analyse_riser`); Spiegel `steigweg/verlauf.ts`; gemeinsame Fixture `testdata/geometry/steigweg.v1.json` (10 Fälle) |
| API | `GET/POST /buildings/{id}/risers`, `PUT/DELETE /risers/{id}` (If-Match). Antwort mit Halten nach Ebene, Abschnitten (`course`, `vertical_mm`, `horizontal_mm`, `length_mm`, `hints`, `traversed_floor_ids`), `status`, `known_length_mm`, `length_mm`. Kein Event |
| Codes | `422` `riser-stop-floor-unknown` (fremd, anderes Gebäude, unbekannt), `riser-stop-floor-duplicate`, `riser-stop-unknown`, `riser-stop-id-duplicate`, `riser-stop-floor-changed`, `riser-name-taken`; `409` `version-conflict`, `project-completed`, `project-archived`; Geschoss bzw. Gebäude mit Steigweg `409` (fachneutrale Core-Meldung) |
| Gesamtstatus | `confirmed`, `incomplete`, `conflict`, `single-stop`, `no-stops` |
| Unverändertes PUT | keine Versionserhöhung, kein Projektvermerk |
| Oberfläche | neue Ansicht „Steigwege“ im Tab „Räume & Grundriss“ (Gebäude des gewählten Geschosses): Liste mit Status und Länge bzw. „Teilsumme … (unvollständig)“; Bearbeitung mit Name, Notiz, Versatzart, Geschosstabelle (anbinden, x/y in mm/cm/m, „Im Grundriss zeigen“, „Lage von … übernehmen“), Abschnittstabelle mit Status, Hinweis und Summe („Gesamtlänge“ bzw. „Bekannte Teilsumme – keine vollständige Leitungslänge“); Speichern, Verwerfen, Schließen, Entfernen; Konflikt mit „Änderungen verwerfen und neu laden“; „Zurück zu …“ zur Ausgangsansicht |
| Grundriss | Wandlinien nur zur Orientierung; leere Geschosse haben eine Standardfläche 10 m × 7,5 m; Klick setzt (Raster 1 cm), Symbol ziehen verschiebt; Kreis mit Kreuz = Übergabepunkt, Pfeil = weiter nach oben, Linie mit Pfeil = Versatz auf dem oberen Geschoss, gestrichelter Kreis = durchquert |
| Verlässlichkeit | bestätigt durchgezogen, vorläufig gestrichelt (Warnfarbe), widersprüchlich strichpunktiert (Fehlerfarbe) – im Grundriss, in der 3D-Vorschau und in der Legende |
| 3D | kleine SVG-Parallelprojektion „3D-Vorschau (vereinfacht, nur Steigwege)“, vier Blickrichtungen; die geschossbezogene WebGL-Ansicht bleibt unverändert |
| Aktualität | Längen werden im Browser aus der Geschossabfrage (`["floors", building]`, `staleTime 0`) und den Halten berechnet; Änderungen an Höhenlage, Bestätigung und Ebene wirken sofort |
| Entwurfsschutz | Ungespeicherte Steigwegänderungen melden sich beim Navigationsschutz, beim Ansichtswechsel und beim Gebäudewechsel; ein Geschosswechsel im selben Gebäude behält den Entwurf. Nie gemischt mit dem Raumentwurf (eigene Ansicht) |

**Abnahmekriterien 25–33 → Tests:** `tests/test_riser_course.py` (25–30, 33),
`tests/test_electrical_risers.py` (25–32, Status, If-Match, Rechte, Löschwege, stabile IDs,
Aktualität), `tests/test_riser_concurrency.py`, `tests/test_archive_concurrency.py` und
`test_completed_concurrency.py` (Schreibweg `steigweg-anlegen`), `tests/test_tenant_isolation.py`,
`steigweg/verlauf.test.ts` (Parität), `steigweg/entwurf.test.ts`, `steigweg/Steigwege.test.tsx`,
`RoomsTab.test.tsx` (Ansichtswechsel).

**Grenzen (sichtbar):** keine Austrittshöhe am Halt (D4); Steigwege erscheinen nicht im
Raum-Grundrisseditor und nicht in der geschossbezogenen 3D-Ansicht, sondern in der eigenen
Ansicht; die 3D-Vorschau zeigt keine Räume.
