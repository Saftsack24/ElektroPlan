import { useState } from "react";
import type { ReactNode } from "react";

import { AKTION } from "../../../core/ui/aktionssymbole";
import { Marke } from "../../../core/ui/Marke";
import { useMasse } from "../../../core/ui/masseinheit";
import { eingabefeld, knopf, meldungsflaeche } from "../../../core/ui/stil";
import { SymbolKnopf } from "../../../core/ui/SymbolKnopf";
import { SEHR_BREIT, useKompakt, useMedium } from "../arbeitsflaeche/kompakt";
import { HilfeDialog } from "../arbeitsflaeche/Werkzeuggruppen";
import { Flaechenwechsel } from "./Flaechenwechsel";
import { WANDHOEHEN } from "./GrundrissLeitungsfeld";
import type { Bearbeitungsflaeche, Leitungskontext } from "./kontext";
import type { Leitungsplanung } from "./useLeitungsplanung";

/** Was im aktuellen Schritt zu tun ist - abgeleitet aus dem Zustand, nie veraltet (6c L2/L3). */
export function anweisung(p: Leitungsplanung): string {
  const a = p.ablauf;
  const e = p.entwurf;
  if (a === null || e === null) return "";
  if (p.dialogOffen) return "Angaben im Dialog prüfen und speichern.";
  if (a.schritt === "start") return "Startgerät anklicken – markierte Geräte sind möglich.";
  if (e.cableId !== null) return "Punkte setzen, ziehen oder entfernen; „Angaben …“ öffnet den Dialog.";
  return e.werte.wegpunkte.length === 0
    ? "Ersten Punkt setzen oder das Zielgerät anklicken."
    : "Weiterzeichnen oder Zielgerät anklicken – Enter schließt offen ab.";
}

/**
 * Kontextleiste des Zeichenablaufs (Phase 6c, L2, überarbeitet nach §21.5) - gleich in Grundriss, Wand
 * und Decke. **Eine Zeile**, soweit die Breite reicht: der aktuelle Schritt, eine Rückmeldung (die letzte
 * Meldung der Fläche oder, ohne sie, die Anweisung zum Schritt), die für diesen Schritt nötigen Aktionen
 * und die Hilfe. Erklärungen stehen im Hilfedialog statt dauerhaft unter der Zeichenfläche.
 *
 * Die Rückmeldung ist die einzige Statusanzeige des Ablaufs: Die Flächen verwerfen ihre Meldung, sobald
 * sich `ablaufSchluessel` ändert (Escape, Dialog, Speichern, nächste Leitung).
 */
export function Zeichenleiste({
  k,
  flaeche,
  zusatz,
  meldung,
  meldungTestId = "zeichen-meldung",
  nebenaktionen,
  hilfe,
}: {
  k: Leitungskontext;
  flaeche: Bearbeitungsflaeche;
  /** Flächeneigene Aktionen des Schritts (etwa Übergang, Durchführung im Grundriss). */
  zusatz?: ReactNode;
  /** Letzte Rückmeldung der Fläche zum aktuellen Zustand; leer = Anweisung zum Schritt. */
  meldung?: string | null;
  meldungTestId?: string;
  /** Rückwege (Mengenübersicht, 3D) - am Ende der Zeile. */
  nebenaktionen?: ReactNode;
  /** Flächeneigene Punkte der Hilfe. */
  hilfe?: ReactNode;
}) {
  const p = k.planung;
  const masse = useMasse();
  const [hilfeOffen, setHilfeOffen] = useState(false);
  // Schmal: dieselben Aktionen mit kürzeren Texten - jede Zeile weniger kommt der Zeichenfläche zugute.
  const kompakt = useKompakt();
  // Unter 80 rem passen die Werkzeuge von Schritt 2 nur mit kurzen Texten in eine Zeile (§21.6 Nacharbeit).
  const sehrBreit = useMedium(SEHR_BREIT);
  const a = p.ablauf;
  const e = p.entwurf;
  if (a === null || e === null) return null;
  const w = e.werte;
  const bestehend = e.cableId !== null;
  // Ohne Meldung der Fläche: Ergebnis der letzten Aktion (etwa „gespeichert“), dann die Anweisung.
  const text = meldung !== undefined && meldung !== null && meldung !== "" ? meldung : [p.hinweis, anweisung(p)].filter((t) => t !== null && t !== "").join(" ");
  const schritt = bestehend
    ? `Verlauf bearbeiten · ${w.label === "" ? "Leitung" : w.label}`
    : a.schritt === "start"
      ? "1 Startgerät wählen"
      : `2 Verlauf zeichnen${w.wegpunkte.length > 0 ? ` (${w.wegpunkte.length})` : ""}`;
  return (
    <div className="flex flex-col gap-1 rounded-ep border border-line bg-surface px-2 py-1 text-small" data-testid="zeichenleiste" role="group" aria-label="Leitung zeichnen">
      {/* Zwei feste Zeilen (6c, §21.6 Nacharbeit): oben Schritt, Rückmeldung und Abschluss, unten die
          Werkzeuge des Schritts. Die untere Zeile ist auch in Schritt 1 belegt - beim Startklick wächst die
          Leiste nicht, die Zeichenfläche behält ihre Höhe und der Plan seine Lage. Schmal darf umgebrochen werden. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span
          className="rounded-full border border-accent bg-accent px-2 py-0.5 text-on-accent"
          aria-current="step"
          title={
            bestehend
              ? undefined
              : `Schritt ${a.schritt === "start" ? 1 : 2} von 3${w.startId === null ? "" : ` · ab ${p.geraetName(w.startId)}`} – zuletzt das Zielgerät anklicken oder offen abschließen`
          }
        >
          {schritt}
        </span>
        {!bestehend && !kompakt && w.startId !== null && <span className="text-muted">ab {p.geraetName(w.startId)}</span>}
        {p.ungespeichert && <Marke art="warnung">ungespeichert</Marke>}
        {/* Breit einzeilig (voller Text im Hinweis und für Screenreader), damit die Leiste nicht wächst. */}
        <span
          className={`min-w-[9rem] flex-[1_1_11rem] text-muted ${kompakt ? "line-clamp-2" : "truncate"}`}
          aria-live="polite"
          title={text}
          data-testid={meldungTestId}
        >
          {text}
        </span>
        {a.schritt === "verlauf" && (
          <button type="button" className={knopf("primaer", { klein: true })} title="Abschließen (Enter oder Doppelklick)" aria-keyshortcuts="Enter" onClick={() => p.abschliessen()} data-testid="abschliessen">
            {bestehend ? "Angaben …" : "Abschließen …"}
          </button>
        )}
        {bestehend && p.ungespeichert && p.darfLeitungen && (
          <button type="button" className={knopf("neutral", { klein: true })} disabled={e.status === "speichert"} onClick={() => void p.speichern()} title="Speichern (Strg+S)">
            Verlauf speichern
          </button>
        )}
        <button type="button" className={knopf("neutral", { klein: true })} onClick={() => void k.leitungSchliessen()} data-testid="zeichnen-abbrechen" title="Leitung abbrechen – mit Rückfrage, sobald etwas eingegeben ist">
          Abbrechen
        </button>
        {nebenaktionen}
        <SymbolKnopf icon={AKTION.hilfe} label="Hilfe zum Zeichnen" hinweisAm="ende" onClick={() => setHilfeOffen(true)} />
      </div>
      <div className="flex min-h-8 flex-wrap items-center gap-x-1.5 gap-y-1" data-testid="zeichenwerkzeuge">
        {a.schritt === "verlauf" ? (
          <>
              <button
                type="button"
                className={knopf("neutral", { klein: true })}
                title="Ecke wechseln (K)"
                aria-keyshortcuts="K"
                onClick={() => p.setAblauf({ ecke: a.ecke === "waagerecht" ? "senkrecht" : "waagerecht" })}
                data-testid="ecke-wechseln"
              >
                {kompakt || !sehrBreit ? "Ecke: " : "Ecke: zuerst "}
                {a.ecke === "waagerecht" ? "waagerecht" : "senkrecht"}
              </button>
              {flaeche.art !== "wand" && (
                <span className="inline-flex" role="group" aria-label="Führung auf Fußboden und Decke" title="Rechtwinklig oder gerade (W)">
                  {(["rechtwinklig", "gerade"] as const).map((f) => (
                    <button key={f} type="button" className={knopf(a.fuehrung === f ? "primaer" : "neutral", { klein: true })} aria-pressed={a.fuehrung === f} onClick={() => p.setAblauf({ fuehrung: f })}>
                      {f === "rechtwinklig" ? "Rechtwinklig" : "Gerade"}
                    </button>
                  ))}
                </span>
              )}
              {flaeche.art === "grundriss" && (
                <>
                  <span className="inline-flex items-center" role="group" aria-label="Klick im Raum setzt">
                    {(["fussboden", "decke"] as const).map((r) => (
                      <button key={r} type="button" className={knopf(a.raumpunkt === r ? "primaer" : "neutral", { klein: true })} aria-pressed={a.raumpunkt === r} title={r === "fussboden" ? "Klick im Raum setzt einen Fußbodenpunkt (1)" : "Klick im Raum setzt einen Deckenpunkt (3)"} onClick={() => p.setAblauf({ raumpunkt: r })}>
                        {r === "fussboden" ? "Fußboden" : "Decke"}
                      </button>
                    ))}
                  </span>
                  <label className="inline-flex items-center gap-1" title="Höhe eines Wandpunkts, der mit einem Klick auf eine Wandlinie entsteht">
                    <span className="text-muted">Wand:</span>
                    <select
                      className={eingabefeld({ kompakt: true })}
                      aria-label="Höhe neuer Wandpunkte"
                      value={String(a.wandhoehe)}
                      onChange={(event) => {
                        const h = event.target.value;
                        p.setAblauf({ wandhoehe: h === "folgen" || h === "decke" || h === "obere-zone" ? h : Number(h) });
                      }}
                    >
                      <option value="folgen">Höhe wie zuvor</option>
                      {WANDHOEHEN.map((h) => (
                        <option key={h.text} value={String(h.wert)} title={h.text}>
                          {typeof h.wert === "number" ? `${masse.anzeigen(h.wert)} – ${h.kurz}` : h.kurz}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {e.auswahl !== null && (
                <button
                  type="button"
                  className={knopf(a.einfuegenNach === e.auswahl ? "primaer" : "neutral", { klein: true })}
                  aria-pressed={a.einfuegenNach === e.auswahl}
                  title="Der nächste Punkt wird nach dem gewählten Wegpunkt eingefügt statt ans Ende angehängt"
                  onClick={() => p.setAblauf({ einfuegenNach: a.einfuegenNach === e.auswahl ? null : e.auswahl })}
                  data-testid="punkt-einfuegen"
                >
                  Nach Punkt {e.auswahl + 1} einfügen
                </button>
              )}
              {a.einfuegenNach !== null && e.auswahl === null && <span className="text-muted">Nächster Punkt folgt Punkt {a.einfuegenNach + 1}.</span>}
            {/* Übergang und Durchführung setzen Punkte - erst ab Schritt 2 sinnvoll. */}
            {zusatz}
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-muted" title="Danach: Verlauf zeichnen – Wandlinie = Wandpunkt, im Raum = Fußboden- oder Deckenpunkt; Zielgerät anklicken schließt ab">
            Danach: Verlauf zeichnen – Wandlinie = Wandpunkt, im Raum = Fußboden- oder Deckenpunkt; Zielgerät anklicken schließt ab.
          </span>
        )}
        <Flaechenwechsel k={k} flaeche={flaeche} />
      </div>
      {e.fehler !== null && !p.dialogOffen && (
        <div className={`${meldungsflaeche()} flex flex-wrap items-center gap-2`} role="alert" data-testid="zeichen-fehler">
          <span className="mr-auto">{e.fehler.meldung}</span>
          {e.status === "konflikt" && !e.vorgabenGeaendert && (
            <button type="button" className={knopf("neutral", { klein: true })} onClick={() => void p.verwerfenUndNeuLaden()}>
              Serverstand laden (Änderungen verwerfen)
            </button>
          )}
          <button type="button" className={knopf("neutral", { klein: true })} onClick={() => p.dispatch({ typ: "hinweis-schliessen" })}>
            {e.status === "konflikt" ? "Entwurf vorerst behalten" : "Hinweis schließen"}
          </button>
        </div>
      )}
      <HilfeDialog offen={hilfeOffen} titel="Leitung zeichnen – Bedienung" onClose={() => setHilfeOffen(false)}>
        <ul className="pl-[18px]">
          <li>Ablauf: 1 Startgerät anklicken (mögliche Geräte sind markiert) → 2 Verlauf zeichnen → Zielgerät anklicken. Enter, Doppelklick oder „Abschließen …“ schließen ohne Zielgerät offen ab. Danach öffnet der Abschlussdialog.</li>
          <li>Die Vorschau zeigt bis zum Zeiger, was der nächste Klick setzt; bei einer ungültigen Lage steht der Grund in der Rückmeldung, bevor geklickt wird. Ein Klick setzt genau die Vorschau.</li>
          <li>Klick auf einen Wegpunkt wählt ihn; Ziehen verschiebt ihn (ein Rückgängig-Schritt), Entf entfernt ihn. Neue Punkte kommen ans Ende, außer „Nach Punkt N einfügen“ ist gewählt.</li>
          <li>K wechselt die Ecke einer L-Führung, W schaltet auf Fußboden und Decke zwischen rechtwinklig und gerade um. Strg+Z / Strg+Y: Rückgängig / Wiederholen.</li>
          <li>„Fläche“: Wand, Decke und Grundriss desselben Entwurfs – ein Wechsel speichert nichts und setzt keinen Punkt; jede Fläche behält ihren Ausschnitt.</li>
          <li>Escape: zuerst Ziehen, Vorschau, Auswahl oder Einfügen abbrechen, dann das Werkzeug beenden – der Entwurf bleibt. „Abbrechen“ verwirft ihn (mit Rückfrage, sobald etwas eingegeben ist).</li>
          {hilfe}
        </ul>
      </HilfeDialog>
    </div>
  );
}
