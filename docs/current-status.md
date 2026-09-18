# Aktueller Projektstand

**Letzte Aktualisierung:** 2026-09-18
**Aktualisiert nach:** Task 0001 — Phase 0: Architektur und Dokumentation

> Dieses Dokument soll einer neuen Session in wenigen Minuten vermitteln, wo das Projekt
> steht. Es wird nach **jedem** Arbeitsauftrag aktualisiert.

---

## 1. Entwicklungsphase

**Phase 0 — Architektur: ABGESCHLOSSEN**
**Phase 1 — Platform Foundation: NICHT BEGONNEN, wartet auf Freigabe**

Es existiert **kein Anwendungscode**. Kein Backend, kein Frontend, keine Datenbank, keine
Migrationen, keine Docker-Umgebung. Das Repository enthält ausschließlich Dokumentation.
Das ist der beabsichtigte Zustand am Ende von Phase 0.

---

## 2. Zuletzt abgeschlossene Aufgabe

**Task 0001 — Phase 0: Architekturanalyse und Dokumentationsgrundlage**

- Masterplan v1.0 vollständig analysiert und kritisch geprüft
- 16 Befunde (Inkonsistenzen, Lücken, fehlende Mechanismen) dokumentiert
- 10 Risiken mit Gegenmaßnahmen erfasst
- 11 bewusste Abweichungen vom Masterplan festgelegt und begründet
- Konkretes ER-Modell für Core und alle geplanten Module entworfen
- Modulgrenzen, Contracts, Provider-Ports und Event-Regeln definiert
- Backend- und Frontend-Modulregistrierung spezifiziert
- 10 ADRs angelegt
- Detailplan für Phase 1 mit 18 Aufgaben erstellt

---

## 3. Was aktuell funktioniert

Nichts im Sinne lauffähiger Software — das ist erwartungsgemäß.

Fertig und nutzbar ist die **Entscheidungsgrundlage**:

| Ergebnis | Ort |
|---|---|
| Architektur mit Ebenen, Grenzen und Datenfluss | `docs/architecture.md` |
| ER-Modell mit Tabellen, Constraints, Indizes | `docs/database.md` |
| Modullandschaft und Registrierung | `docs/modules.md` |
| Contracts inkl. Provider-Ports | `docs/contracts.md` |
| Event-Regeln und Event-Katalog | `docs/events.md` |
| Sicherheits- und Datenschutzkonzept | `docs/security.md` |
| API-Richtlinien | `docs/api.md` |
| Fachdokumentation je Modul | `docs/modules/*.md` |
| Architekturentscheidungen | `docs/decisions/*.md` |
| Phasenplan und Meilensteine | `docs/roadmap.md` |
| Detailplan Phase 1 | `docs/phase-1-plan.md` |

---

## 4. Bekannte Probleme

Keine — es gibt keinen Code, der Probleme haben könnte.

Ein Hinweis zur Dokumentation: Spaltenlisten in `docs/database.md` sind ein Entwurf. Bei
der Umsetzung in Phase 1/2 werden sich Details ändern (Feldnamen, Nullable-Eigenschaften).
**Entitäten, Beziehungen und Modulgrenzen ändern sich nur über einen ADR.**

---

## 5. Technische Schulden

Keine.

Bewusst aufgeschobene Punkte (keine Schulden, sondern Planung):

| Punkt | Geplant für |
|---|---|
| Row Level Security als fünfte Isolationsebene | nach dem Pilot, vor externen Mandanten |
| Virenscan für Uploads | vor kommerziellem Einsatz |
| MFA für administrative Konten | vor kommerziellem Einsatz |
| Offline-Sync-Felder (`sync_status`) | Phase 13/16 |
| `packages/ui`, `packages/3d-engine` | erst bei zweitem Consumer (Phase 13) |
| Datanorm-/IDS-Import | nach dem Pilot |
| §13b Reverse Charge | nach dem Pilot |

---

## 6. Offene Entscheidungen

### Technisch — vor der jeweiligen Phase zu klären

| # | Frage | Spätestens vor |
|---|---|---|
| T1 | Symbolbibliothek: eigene SVGs oder Anlehnung an DIN EN 60617 | Phase 4a |
| T2 | PDF-Erzeugung: WeasyPrint (Empfehlung) oder ReportLab | Phase 10 |
| T3 | Kleinmaterial: eigenes Material oder prozentualer Zuschlag | Phase 8 |
| T4 | Mehrgeschossige Steigezonen für Leitungswege | Phase 6 |
| T5 | Reservierungsstrategie bei mehreren Lagerorten | Phase 12 |

### Fachlich — Angaben aus dem Betrieb erforderlich

| # | Frage | Spätestens vor |
|---|---|---|
| F1 | Verschnittzuschläge je Materialgruppe, tatsächliche Ringgrößen | Phase 7 |
| F2 | 20–30 reale ServiceTemplates mit Zeiten | Phase 8 |
| F3 | Ein Stundensatz oder mehrere? Gemeinkostenaufschlag worauf? | Phase 9 |
| F4 | Angebotsstruktur und bestehende Angebotsvorlage als Muster | Phase 10 |
| F5 | Nummernkreise: Format und Startwerte | Phase 10 |
| F6 | Reale Lagerorte (Hauptlager, Fahrzeuge, Container) | Phase 12 |
| F7 | Vorkommende Umsatzsteuerfälle | Phase 10 |

---

## 7. Nächste geplante Aufgabe

**Phase 1 — Platform Foundation**, beginnend mit T-0001 (Monorepo und Werkzeuge).
Vollständiger Plan: `docs/phase-1-plan.md`.

> **Diese Phase wird erst nach ausdrücklicher Freigabe begonnen.**

---

## 8. Hinweise für die nächste Session

1. Zuerst `CLAUDE.md`, dieses Dokument und `docs/roadmap.md` lesen.
2. Die 14 unverhandelbaren Regeln in `CLAUDE.md` Abschnitt 3 sind das Wichtigste.
3. Phase 1 baut **kein** Fachwissen — keine Kunden, keine Projekte, keine Elektroplanung.
4. Wenn etwas an der Architektur unpassend erscheint: Befund melden und einen ADR
   vorschlagen, nicht stillschweigend abweichen.
