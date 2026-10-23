import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import { AKTION } from "../../../core/ui/aktionssymbole";
import { seitenScrollSperren } from "../../../core/ui/scrollsperre";
import { SymbolKnopf } from "../../../core/ui/SymbolKnopf";
import { istBreit, useKompakt } from "./kompakt";
import { useStabil } from "./stabil";

/**
 * Ansichtszustand der Planungsarbeitsfläche (Phase 6c.0, Entwurf §4): Eigenschaften
 * auf/zu und Maximierung. **Reine Ansicht** im Komponentenzustand – nichts davon wird
 * gespeichert, nichts Fachliches hängt daran.
 */
export interface Arbeitsflaechenzustand {
  readonly eigenschaftenOffen: boolean;
  readonly maximiert: boolean;
  readonly setEigenschaftenOffen: (offen: boolean) => void;
  readonly setMaximiert: (maximiert: boolean) => void;
  /**
   * Escape als letzte Stufe vor „Ansicht schließen“: zuerst ein überlagerndes
   * Eigenschaftenpanel (schmale Fenster), dann die Maximierung. `true`: erledigt.
   */
  readonly escape: () => boolean;
}

export function useArbeitsflaeche(): Arbeitsflaechenzustand {
  // Standard: eingeklappt – die Zeichenfläche hat Vorrang (Entwurf §4.2).
  const [eigenschaftenOffen, setEigenschaftenOffen] = useState(false);
  const [maximiert, setMaximiert] = useState(false);
  const escape = useCallback((): boolean => {
    if (eigenschaftenOffen && !istBreit()) {
      setEigenschaftenOffen(false);
      return true;
    }
    if (maximiert) {
      setMaximiert(false);
      return true;
    }
    return false;
  }, [eigenschaftenOffen, maximiert]);
  return { eigenschaftenOffen, maximiert, setEigenschaftenOffen, setMaximiert, escape };
}

/** Ein Tastenkürzel gehört nicht der Arbeitsfläche, wenn getippt wird oder ein anderer Dialog oben liegt. */
function fremdeEingabe(event: KeyboardEvent, wurzel: HTMLElement): boolean {
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return true;
  const ziel = event.target instanceof Element ? event.target : null;
  if (ziel?.closest("input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select, [contenteditable='true']")) {
    return true;
  }
  // Jeder offene Dialog muss die Arbeitsfläche enthalten: Liegt eine Rückfrage oder eine
  // andere Ansicht darüber, gehört die Taste ihr.
  for (const dialog of document.querySelectorAll("dialog[open]")) {
    if (!dialog.contains(wurzel)) return true;
  }
  return false;
}

/** Kleinste sinnvolle Höhe der Zeichenfläche; darunter scrollt die Seite (einziger Scrollbereich). */
export const MINDESTHOEHE_FLAECHE = 220;
/** Abstand zum unteren Fensterrand in Pixeln. */
const RAND_UNTEN = 12;

/**
 * Gemeinsamer Rahmen für Grundriss, Wand- und Deckenansicht (Phase 6c.0, überarbeitet in L1).
 *
 * ```
 * ┌ kopf (Pfad, Status, Speichern) ──────────────────────────┐
 * │ werkzeuge …                         [Eigenschaften] [⛶] │
 * ├──────────────────────────────────────────────┬──────────┤
 * │                ZEICHENFLÄCHE                 │ Panel    │  (schmal: überlagernd)
 * ├──────────────────────────────────────────────┴──────────┤
 * │ kontext: nur, was gerade nötig ist                       │
 * └─────────────────────────────────────────────────────────┘
 * ```
 *
 * **Höhenregel (L1):** Der Rahmen füllt die restliche Fensterhöhe unter dem, was
 * über ihm steht. Kopf, Werkzeuge und Kontextleiste behalten ihre natürliche Höhe
 * und bleiben damit immer erreichbar; die Zeichenfläche erhält den Rest. Reicht der
 * Rest nicht für {@link MINDESTHOEHE_FLAECHE}, wird der Rahmen so hoch wie nötig und
 * die **Seite** scrollt – ein einziger Scrollbereich, keine verschachtelten. Die
 * Höhe wird ohne React-Zustand direkt gesetzt (kein Neuzeichnen beim Messen).
 *
 * **Kein Neueinhängen.** Alle Zustände (eingeklappt, aufgeklappt, überlagernd,
 * maximiert, ausgeblendet) schalten nur Klassen an denselben Elementen. So erhalten
 * die Flächen ihren Viewport – eine Größenänderung behält Maßstab und Weltmitte
 * (`groesseAendern`), eingepasst wird nie.
 *
 * Während eine Wand- oder Deckenfläche offen ist, hängt der Grundriss ganz aus (keine
 * versteckten Flächen); seinen Viewport hält der Editor.
 */
export function Planungsarbeitsflaeche({
  zustand,
  name,
  kopf,
  werkzeuge,
  kontext,
  eigenschaften,
  eigenschaftenTitel = "Eigenschaften",
  markierung,
  children,
}: {
  zustand: Arbeitsflaechenzustand;
  /** Zugänglicher Name der Arbeitsfläche, etwa „Grundriss-Arbeitsfläche“. */
  name: string;
  kopf?: ReactNode;
  werkzeuge: ReactNode;
  kontext?: ReactNode;
  eigenschaften: ReactNode;
  eigenschaftenTitel?: string;
  /** Kurzer Hinweis am Eigenschaftenknopf, solange das Panel zu ist (etwa „Leitung“). */
  markierung?: string | null;
  children: ReactNode;
}) {
  const { eigenschaftenOffen: offen, maximiert, setEigenschaftenOffen, setMaximiert } = zustand;
  const kompakt = useKompakt();
  const wurzel = useRef<HTMLElement>(null);
  const koerperRef = useRef<HTMLDivElement>(null);
  const panelKopf = useRef<HTMLHeadingElement>(null);
  const panelId = useId();
  /** Eine Zeigerbewegung läuft: Layoutwechsel erst danach (Bild- und Weltkoordinaten springen sonst). */
  const zieht = useRef(false);
  /** Fokus nach dem Öffnen per Knopf in den Panelkopf, nach dem Schließen zurück zum Auslöser. */
  const fokusNachOeffnen = useRef(false);
  const ausloeser = useRef<HTMLElement | null>(null);

  const oeffnen = (perKnopf: boolean) => {
    if (perKnopf && document.activeElement instanceof HTMLElement) ausloeser.current = document.activeElement;
    fokusNachOeffnen.current = perKnopf;
    setEigenschaftenOffen(true);
  };
  const schliessen = () => {
    setEigenschaftenOffen(false);
    const ziel = ausloeser.current;
    ausloeser.current = null;
    // Lag der Fokus im Panel, ginge er mit `inert` verloren.
    if (wurzel.current?.querySelector(`[id="${panelId}"]`)?.contains(document.activeElement) === true) {
      (ziel?.isConnected === true ? ziel : wurzel.current.querySelector<HTMLElement>("[data-eigenschaften-knopf] button"))?.focus();
    }
  };

  // Stabil (L1): Die Knöpfe der Arbeitsfläche zeichnen nur bei sichtbaren Änderungen neu,
  // nicht bei jedem Neuzeichnen der Zeichenfläche (Profil der langen Integrationstests).
  const eigenschaftenUmschalten = useStabil(() => (offen ? schliessen() : oeffnen(true)));
  const maximierenUmschalten = useStabil(() => {
    if (!zieht.current) setMaximiert(!maximiert);
  });

  useEffect(() => {
    if (offen && fokusNachOeffnen.current) panelKopf.current?.focus();
    fokusNachOeffnen.current = false;
  }, [offen]);

  // Maximiert: Die Seite dahinter scrollt nicht mit.
  useEffect(() => (maximiert ? seitenScrollSperren() : undefined), [maximiert]);

  // Höhenregel: restliche Fensterhöhe, mindestens Platz für Werkzeuge, Kontext und die Mindestfläche.
  useEffect(() => {
    const root = wurzel.current;
    const koerper = koerperRef.current;
    if (root === null || koerper === null) return undefined;
    if (maximiert) {
      root.style.height = "";
      return undefined;
    }
    const messen = () => {
      const oben = root.getBoundingClientRect().top + window.scrollY;
      const verfuegbar = Math.floor(window.innerHeight - oben - RAND_UNTEN);
      // Alles außer der Fläche (Kopf, Werkzeuge, Kontext, Abstände) behält seine Höhe.
      const ohneFlaeche = root.getBoundingClientRect().height - koerper.getBoundingClientRect().height;
      const mindestens = Math.ceil(ohneFlaeche) + MINDESTHOEHE_FLAECHE;
      // Reicht der Rest des Fensters nicht (schmal steht viel darüber), füllt die Arbeitsfläche nach
      // einmaligem Scrollen das ganze Fenster – statt dauerhaft nur die Mindestfläche zu zeigen.
      const hoehe = verfuegbar >= mindestens ? verfuegbar : Math.max(Math.floor(window.innerHeight - 2 * RAND_UNTEN), mindestens);
      const neu = `${hoehe}px`;
      if (root.style.height !== neu) root.style.height = neu;
    };
    messen();
    window.addEventListener("resize", messen);
    const beobachter = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(messen);
    // Was über dem Rahmen steht (Kopf der Seite) und die eigenen Leisten ändern ihre Höhe.
    beobachter?.observe(document.body);
    for (const kind of root.children) if (kind !== koerper) beobachter?.observe(kind);
    return () => {
      window.removeEventListener("resize", messen);
      beobachter?.disconnect();
      root.style.height = "";
    };
  }, [maximiert]);

  const tasteRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  tasteRef.current = (event: KeyboardEvent) => {
    const root = wurzel.current;
    if (root === null || zieht.current || fremdeEingabe(event, root)) return;
    const k = event.key.toLowerCase();
    if (k === "m") {
      event.preventDefault();
      setMaximiert(!maximiert);
    } else if (k === "e") {
      event.preventDefault();
      if (offen) schliessen();
      else oeffnen(false);
    }
  };
  useEffect(() => {
    const weiter = (event: KeyboardEvent) => tasteRef.current(event);
    window.addEventListener("keydown", weiter);
    return () => window.removeEventListener("keydown", weiter);
  }, []);

  const rahmen = maximiert
    ? "fixed inset-0 z-40 flex flex-col gap-2 overflow-y-auto overscroll-contain bg-page p-3"
    : "flex flex-col gap-2";
  // Die Fläche bekommt den Rest; nie unter die Mindesthöhe.
  const koerper = "relative flex min-h-[220px] flex-[1_1_0px] gap-3";
  // Schmal überlagert das Panel die Fläche (deren Größe bleibt), breit steht es daneben.
  const panel = offen
    ? "absolute inset-y-0 right-0 z-[5] flex w-[min(90%,340px)] flex-col rounded-ep border border-line bg-raised shadow-popup split:static split:z-auto split:w-[clamp(280px,26vw,340px)] split:shrink-0 split:shadow-none"
    : "invisible absolute inset-y-0 right-0 flex w-0 flex-col overflow-hidden";

  return (
    <section
      ref={wurzel}
      className={rahmen}
      aria-label={name}
      data-arbeitsflaeche=""
      data-maximiert={maximiert ? "" : undefined}
      data-eigenschaften={offen ? "offen" : "zu"}
      onPointerDownCapture={() => {
        zieht.current = true;
      }}
      onPointerUpCapture={() => {
        zieht.current = false;
      }}
      onPointerCancelCapture={() => {
        zieht.current = false;
      }}
    >
      {/* Kopf und Werkzeuge werden nie gestaucht: Bei fester Höhe gibt nur die Zeichenfläche nach (L1). */}
      {kopf != null && <div className="shrink-0">{kopf}</div>}
      {/* Eigenschaften und Maximieren stehen oben rechts; die Werkzeuge brechen daneben um,
          statt den beiden Knöpfen eine eigene Zeile zu überlassen (L1). */}
      <div className="flex shrink-0 items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-0">{werkzeuge}</div>
        <Flaechenknoepfe
          offen={offen}
          maximiert={maximiert}
          kompakt={kompakt}
          markierung={markierung ?? null}
          panelId={panelId}
          onEigenschaften={eigenschaftenUmschalten}
          onMaximieren={maximierenUmschalten}
        />
      </div>
      <div ref={koerperRef} className={koerper}>
        <div className="relative min-w-0 flex-auto" data-zeichenbereich="">
          {/* Absolut im Bereich: die Fläche hat damit immer eine feste Größe zum Messen. */}
          <div className="absolute inset-0">{children}</div>
        </div>
        <aside id={panelId} className={panel} aria-label={eigenschaftenTitel} inert={!offen} aria-hidden={offen ? undefined : true} data-testid="eigenschaftenpanel">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-1.5">
            <h3 ref={panelKopf} tabIndex={-1} className="m-0 text-small font-semibold outline-none">
              {eigenschaftenTitel}
            </h3>
            <SymbolKnopf icon={AKTION.eigenschaftenSchliessen} label="Eigenschaften einklappen" kuerzel="E" ariaKuerzel="E" hinweisAm="ende" onClick={schliessen} />
          </div>
          {/* Der eine Scrollbereich des Panels. */}
          <div className="min-h-0 flex-auto overflow-y-auto overscroll-contain px-3 py-2">{eigenschaften}</div>
        </aside>
      </div>
      {kontext !== undefined && <div className="shrink-0">{kontext}</div>}
    </section>
  );
}

/** Eigenschaften und Maximieren – gemerkt, abhängig nur von dem, was sie zeigen. */
const Flaechenknoepfe = memo(function Flaechenknoepfe({
  offen,
  maximiert,
  kompakt,
  markierung,
  panelId,
  onEigenschaften,
  onMaximieren,
}: {
  offen: boolean;
  maximiert: boolean;
  kompakt: boolean;
  markierung: string | null;
  panelId: string;
  onEigenschaften: () => void;
  onMaximieren: () => void;
}) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1" role="group" aria-label="Arbeitsfläche">
      <span className="relative inline-flex" data-eigenschaften-knopf="">
        <SymbolKnopf
          icon={offen ? AKTION.eigenschaftenSchliessen : AKTION.eigenschaftenOeffnen}
          label="Eigenschaften"
          {...(kompakt ? {} : { text: "Eigenschaften" })}
          kuerzel="E"
          ariaKuerzel="E"
          hinweisAm="ende"
          aufgeklappt={offen}
          steuert={panelId}
          onClick={onEigenschaften}
        />
        {!offen && markierung !== null && (
          <span className="pointer-events-none absolute -top-2 -right-2 rounded-full bg-accent px-1.5 text-[0.7rem] leading-4 text-on-accent" data-testid="eigenschaften-markierung">
            {markierung}
          </span>
        )}
      </span>
      <SymbolKnopf
        icon={maximiert ? AKTION.normaleAnsicht : AKTION.maximieren}
        label={maximiert ? "Normale Ansicht" : "Zeichenfläche maximieren"}
        {...(maximiert && !kompakt ? { text: "Normale Ansicht" } : {})}
        kuerzel="M"
        ariaKuerzel="M"
        hinweisAm="ende"
        gedrueckt={maximiert}
        onClick={onMaximieren}
      />
    </div>
  );
});
