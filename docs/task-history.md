# Task History

Kompakter Eintrag nach **jedem** abgeschlossenen Arbeitsauftrag. Zweck: nachvollziehbar
halten, *warum* etwas geändert wurde — auch Monate später und in einer neuen Session.

Format:

```
Task NNNN – Titel
Datum:
Ziel:
Durchgeführte Änderungen:
Betroffene Module:
Betroffene wichtige Dateien:
Tests:
Ergebnis:
Offene Punkte:
Nächster sinnvoller Schritt:
```

---

## Task 0001 – Phase 0: Architekturanalyse und Dokumentationsgrundlage

**Datum:** 2026-09-18

**Ziel:**
Masterplan v1.0 vollständig analysieren, technische Konsistenz prüfen, Risiken und
Overengineering identifizieren, Verbesserungen vorschlagen und die Architektur inklusive
ER-Modell, Modulgrenzen, Contracts, Event-Regeln und Modulregistrierung schriftlich
festschreiben. Ausdrücklich **kein** Anwendungscode.

**Durchgeführte Änderungen:**

1. Kritische Prüfung des Masterplans: 16 Befunde, 10 Risiken, 11 begründete Abweichungen
   (`docs/architecture-review.md`)
2. Architektur festgeschrieben: drei Ebenen (Core / Shared / Fachmodule), erlaubte
   Abhängigkeitsrichtungen, Unit of Work mit Post-Commit-Events, Einfrierpunkte für
   Mengen und Preise, maschinelle Durchsetzung der Grenzen
3. Konkretes ER-Modell für Core und alle geplanten Module mit Constraints, Indizes und
   Konventionen (ganzzahlige Millimeter, `numeric` für Geld, zusammengesetzte
   Fremdschlüssel)
4. Zentraler Mechanismus definiert: **Provider-Ports** als Abhängigkeitsumkehr, damit
   Shared Business Modules Fachmodul-Daten erhalten, ohne Fachmodule zu kennen
5. Contracts spezifiziert: `MaterialRequirementDraft`/`MaterialRequirement`,
   `LaborRequirementDraft`, `OfferItemSuggestion`, `InventoryService`, `PricingService`,
   `ModuleDescriptor`, `DomainEvent`
6. Event-Bus-Regeln festgelegt (Post-Commit, at-most-once, Recompute-Pflicht,
   keine Geld-/Bestandsänderung über Events, azyklischer Event-Graph)
7. Backend- und Frontend-Modulregistrierung spezifiziert inkl. Startprüfungen und
   Contribution Points
8. Sicherheitskonzept: Schutzbedarf, Bedrohungsmodell, vierstufige Mandantentrennung,
   Upload-Härtung, DSGVO-Anforderungen, Backup
9. API-Richtlinien: Versionierung, RFC 9457, Geld als String, Cursor-Pagination,
   Idempotenz, Zustandswechsel als eigene Endpunkte
10. Roadmap mit Exit-Kriterien je Phase, Phase 4 in 4a/4b geteilt, Pilot-Meilenstein als
    verbindlicher Stopp
11. Detailplan Phase 1 mit 18 Aufgaben, Abhängigkeiten und Definition of Done
12. 10 ADRs angelegt

**Betroffene Module:** keine (kein Code) — dokumentiert wurden core, materials, inventory,
calculation, offers, work_orders, electrical

**Betroffene wichtige Dateien:**

```
CLAUDE.md                     README.md
docs/architecture.md          docs/architecture-review.md
docs/database.md              docs/modules.md
docs/contracts.md             docs/events.md
docs/api.md                   docs/security.md
docs/roadmap.md               docs/phase-1-plan.md
docs/glossary.md              docs/current-status.md
docs/changelog.md             docs/task-history.md
docs/decisions/0001…0010 + README.md
docs/modules/{electrical,materials,inventory,calculation,offers,work-orders}.md
```

**Tests:**
Nicht anwendbar — es existiert kein Code, keine Testinfrastruktur und keine
Build-Konfiguration. Typecheck und Build entfallen aus demselben Grund. Geprüft wurde die
Vollständigkeit und Widerspruchsfreiheit der Dokumente sowie die Gültigkeit aller internen
Querverweise.

**Ergebnis:**
Phase 0 abgeschlossen. Die Architektur ist entscheidungsfähig festgeschrieben; alle
Abweichungen vom Masterplan sind begründet und als ADR nachvollziehbar.

**Offene Punkte:**
- 5 technische Entscheidungen (T1–T5) und 7 fachliche Angaben aus dem Betrieb (F1–F7),
  siehe `docs/current-status.md` Abschnitt 6
- Spaltendetails im ER-Modell sind Entwurf und werden bei der Umsetzung präzisiert

**Nächster sinnvoller Schritt:**
Phase 1 (Platform Foundation) beginnen, startend mit T-0001 (Monorepo und Werkzeuge).
**Wartet auf ausdrückliche Freigabe.**
