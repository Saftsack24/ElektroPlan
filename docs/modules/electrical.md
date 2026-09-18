# Modul: electrical (Elektroplanung)

Art: Fachmodul · Präfix: `electrical_` · Status: geplant (Phasen 3–6)
Abhängig von: `core`, `materials`

---

## 1. Zweck

Technische Planung der Elektroinstallation eines Projekts: Räume, Wände, Öffnungen,
Elektroelemente, Verteilungen, Stromkreise und Leitungswege. Das Modul liefert den
**technischen Bedarf** — Material und Arbeitszeit — an die Plattform.

## 2. Abgrenzung

| Das Modul … | … tut es nicht |
|---|---|
| beschreibt Geometrie und Technik | kennt keine Preise, keine Margen, keine Stundensätze |
| erzeugt Bedarfs-Drafts | schreibt keine `material_requirements` selbst |
| berechnet Leitungslängen | bucht keine Bestände |
| schlägt Angebotspositionen vor | erzeugt keine Angebote |
| bildet Stromkreise ab | **prüft keine Normkonformität und dimensioniert keine Schutzorgane** |

Die letzte Zeile ist eine bewusste Sicherheitsgrenze (siehe `docs/security.md`, Abs. 17).

---

## 3. Koordinatensystem

- Projektlokales, kartesisches System. Ursprung `(0,0)` je Geschoss, frei wählbar
  (üblicherweise linke untere Ecke des Grundrisses).
- **x/y** in der Grundrissebene, **z** in der Höhe, jeweils ganzzahlige Millimeter.
- `z = 0` ist der Fertigfußboden des jeweiligen Geschosses.
  Die absolute Höhe ergibt sich aus `floors.elevation_mm + z`.
- Positive Drehrichtung mathematisch (gegen den Uhrzeigersinn), `rotation_deg` ganzzahlig.

---

## 4. Entitäten

### `electrical_rooms`
Raum mit Bodenpolygon (`floor_polygon_mm`, JSONB-Punktliste), Raumhöhe, Raumtyp
(`living`, `kitchen`, `bathroom`, `utility`, `outdoor`, …). Der Raumtyp ist später die
Grundlage für Ausstattungsvorlagen.

**Validierung:** mindestens 3 Punkte, geschlossen, keine Selbstüberschneidung,
Fläche > 0, Höhe zwischen 1500 und 6000 mm.

### `electrical_walls`
Gerade Wandsegmente mit Start-/Endpunkt, Höhe, Dicke, Typ (`exterior`, `interior`,
`partition`). Wände sind im MVP nicht zwingend an Räume gebunden — sie tragen Öffnungen und
dienen als Anschlagpunkt für Geräte.

### `electrical_openings`
Tür, Fenster oder Durchgang an einer Wand (`kind`), beschrieben über den Abstand vom
Wandanfang (`offset_mm`), Breite, Höhe und Brüstungshöhe. Türen und Fenster sind
zusammengefasst, weil Geometrie und Bearbeitung identisch sind.

### `electrical_device_types`
Katalog der Elementtypen: Steckdose, Doppelsteckdose, Schalter, Wechselschalter, Taster,
Leuchtenauslass, Netzwerkdose, Abzweigdose, Bewegungsmelder, Unterverteilung.
Je Typ: Standard-Montagehöhe, Symbolschlüssel, Standard-ServiceTemplate.
Systemtypen werden als Seed ausgeliefert; die Organisation kann eigene ergänzen.

### `electrical_devices`
Konkretes Element im Raum: Position (`x_mm`, `y_mm`), Montagehöhe, Drehung, optionale
Wandzuordnung, Stromkreis, abweichendes ServiceTemplate, freie `properties` (JSONB).

### `electrical_distribution_boards`
Verteilungen mit Code (`HV`, `UV1`, …), Standort und Hauptabsicherung.

### `electrical_circuits`
Stromkreis: Nummer, Bezeichnung, Verteilung, Leitungstyp, Querschnitt, Schutzorgantyp und
-nennstrom, RCD-Gruppe, Phasenzahl. **Werte werden erfasst, nicht berechnet.**

### `electrical_cable_routes` und `electrical_cable_route_points`
Leitungsweg zwischen zwei Punkten (Verteilung ↔ Gerät, Gerät ↔ Gerät) mit Zone,
Verlegeart und normalisierter Punktliste. Gespeichert werden `computed_length_mm`
(Geometrie) und `allowance_mm` (Zugaben) getrennt.

---

## 5. Installationszonen und Längenberechnung

Der zentrale Mechanismus des MVP (siehe
[ADR 0010](../decisions/0010-2d-first-editor-with-installation-zones.md)): Der Weg wird in
2D gezeichnet, die Höhe ergibt sich aus der Zone.

| `zone_key` | Höhe (Standard) |
|---|---|
| `horizontal_lower` | 300 mm über FFB |
| `horizontal_middle` | 1050 mm |
| `horizontal_upper` | 300 mm unter Rohdecke |
| `vertical` | senkrecht zum Gerät |
| `ceiling` | Raumhöhe |
| `floor` | 0 mm |
| `custom` | freie Eingabe |

### Formel

```
computed_length_mm = Σ_i  round( sqrt( (x₂−x₁)² + (y₂−y₁)² + (z₂−z₁)² ) )
allowance_mm       = Zugabe(Startpunkt) + Zugabe(Endpunkt)
total_length_mm    = computed_length_mm + allowance_mm
```

Standardzugaben (konfigurierbar): 200 mm je Geräteanschluss, 500 mm je Verteilung.

### Beispiel

Verteilung `UV1` in der Diele bei `(500, 500)`, Montagehöhe 1400 mm.
Steckdose in der Küche bei `(4200, 2600)`, Montagehöhe 300 mm.
Zone `horizontal_upper`, Raumhöhe 2500 mm → Zonenhöhe 2200 mm.

| Segment | Berechnung | Länge |
|---|---|---|
| Aufstieg Verteilung → Zone | 2200 − 1400 | 800 mm |
| waagerecht in der Zone | Polygonzug (500,500) → (4200,500) → (4200,2600) | 5800 mm |
| Abstieg Zone → Steckdose | 2200 − 300 | 1900 mm |
| **computed_length_mm** | | **8500 mm** |
| Zugaben | 500 (UV) + 200 (Gerät) | 700 mm |
| **total_length_mm** | | **9200 mm = 9,200 m** |

Die Berechnung ist vollständig ganzzahlig und damit exakt reproduzierbar — Grundlage der
Tests aus §39 des Masterplans.

---

## 6. Erzeugter Bedarf (Provider)

### `ElectricalMaterialProvider`

| Quelle | Ergebnis |
|---|---|
| jedes `electrical_device` | Draft mit `service_template_id` (aus Gerät oder Gerätetyp), Menge 1 Stück |
| jeder `electrical_cable_route` | Draft mit dem Material des Leitungstyps, Menge = `total_length_mm / 1000` m |
| jede Verteilung | Draft mit dem ServiceTemplate der Verteilung |

**Doppelzählungsschutz:** Leitungsmaterial entsteht **ausschließlich** aus
`source_entity_type = "cable_route"`. Ein ServiceTemplate mit `includes_cable = true` wird
von der Material Engine beanstandet, sobald für dasselbe Projekt Leitungswege existieren.

### `ElectricalLaborProvider`

Arbeitszeit je Gerät aus dem ServiceTemplate (`labor_minutes`), Arbeitszeit je Leitung aus
Meter × Minuten-pro-Meter des Verlegeart-Schlüssels.

---

## 7. Permissions

| Key | Bedeutung |
|---|---|
| `electrical.plan.read` | Planung ansehen |
| `electrical.plan.write` | Räume, Wände, Öffnungen bearbeiten |
| `electrical.device.write` | Elektroelemente bearbeiten |
| `electrical.circuit.write` | Stromkreise und Verteilungen bearbeiten |
| `electrical.route.write` | Leitungswege bearbeiten |
| `electrical.settings.write` | Gerätetypen und Zonen-Standardwerte pflegen |

---

## 8. Events

**Erzeugt:** `electrical.plan.updated`, `electrical.circuit.changed`
**Konsumiert:** keine

Beide Events sind reine Benachrichtigungen ("Materialbedarf könnte veraltet sein").
Die verbindliche Neuberechnung läuft über den Recompute-Endpunkt des Materialmoduls.

---

## 9. API (Auszug)

```
GET    /api/v1/modules/electrical/projects/{project_id}/plan     vollständiger Planungsstand
GET    /api/v1/modules/electrical/projects/{project_id}/rooms
POST   /api/v1/modules/electrical/projects/{project_id}/rooms
PATCH  /api/v1/modules/electrical/rooms/{room_id}
DELETE /api/v1/modules/electrical/rooms/{room_id}
POST   /api/v1/modules/electrical/rooms/{room_id}/devices
GET    /api/v1/modules/electrical/projects/{project_id}/circuits
POST   /api/v1/modules/electrical/projects/{project_id}/cable-routes
PUT    /api/v1/modules/electrical/cable-routes/{route_id}/points   (gesamte Punktliste)
GET    /api/v1/modules/electrical/projects/{project_id}/summary    Mengenübersicht
```

`GET …/plan` liefert den gesamten Planungsstand eines Projekts in einem Aufruf — der
Editor braucht ihn ohnehin vollständig, und viele Einzelabrufe wären langsamer.
Punktlisten werden als Ganzes ersetzt (`PUT`), nicht punktweise gepatcht.

---

## 10. Editor (Phasen 4a/4b)

**2D (4a):** Räume zeichnen (Rechteck und Polygon), Wände, Öffnungen, Geräte setzen,
Leitungswege zeichnen, Raster und Fangfunktion, Undo/Redo, Maßanzeige in mm.

**3D (4b):** extrudierte Räume aus Polygon und Höhe, Wände, Öffnungen als Aussparungen,
Geräte als Symbole, Leitungswege als Linienzüge; Orbit, Zoom, Pan, Auswahl.
**Keine Geometriebearbeitung in 3D im MVP.**

Performance-Regel: Die Three.js-Szene wird **nicht** an den React-State gekoppelt.
React hält die fachlichen Daten, eine imperative Szenenschicht hält Objekte und wird über
gezielte Aktualisierungen synchronisiert.

---

## 11. Offene Punkte

1. Ausstattungsvorlagen pro Raumtyp ("Küche Standard" setzt n Steckdosen) — sinnvoll, aber
   erst nach Phase 5 zu entscheiden.
2. Mehrgeschossige Steigezonen: Leitungswege über Geschossgrenzen brauchen einen
   definierten Übergabepunkt. Entwurf offen, Datenmodell erlaubt es bereits
   (Punkte tragen z, Route ist nicht an ein Geschoss gebunden).
3. Import bestehender Grundrisse (PDF/DWG) — nicht im MVP.
4. Symbolbibliothek: eigene SVG-Symbole oder Anlehnung an DIN EN 60617 — vor Phase 4a zu
   klären.
5. Kanäle, Rohre und Verlegesysteme als eigene Materialposition je Meter — Entwurf mit
   Phase 7 abstimmen.
