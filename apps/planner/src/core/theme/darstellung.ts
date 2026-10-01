import { useSyncExternalStore } from "react";

/**
 * Persönliche Darstellung - fachneutrale Core-Infrastruktur (Phase 4c.2,
 * ADR 0018 und ADR 0019).
 *
 * * **Modell:** Darstellungsmodus (`system`, `light`, `dark`) und ein
 *   kuratiertes Akzentfarbschema. Beliebige Farbwerte gibt es bewusst nicht.
 * * **Speicherung (seit Phase 4e, ADR 0021):** serverseitig je Benutzer und
 *   Betrieb; den Abgleich mit Server und Browser-Cache übernimmt
 *   `core/einstellungen/persoenlich.ts`. Diese Datei hält nur den wirksamen
 *   Zustand und wendet ihn an - sie liest und schreibt keinen Speicher.
 *   {@link darstellungLesen} liest das alte lokale Format (Version 1) für die
 *   einmalige Übernahme.
 * * **Anwendung:** ausschließlich über Attribute am Wurzelelement -
 *   `data-theme` (aufgelöst: `light` | `dark`), `data-theme-mode` (die Wahl)
 *   und `data-accent` - sowie `color-scheme`. Die CSS-Tokens reagieren darauf;
 *   Komponenten fragen nie selbst nach Hell oder Dunkel.
 * * **Vorschau:** Der Einstellungsdialog zeigt einen Entwurf sofort an, ohne
 *   ihn zu speichern ({@link darstellungVorschauen}); Abbrechen stellt den
 *   gespeicherten Stand wieder her.
 * * **Benutzer:** Solange niemand angemeldet ist, gilt der Standard. Was für
 *   den angemeldeten Benutzer gilt, setzt `core/einstellungen/persoenlich.ts`
 *   über {@link darstellungSetzen} - zuerst aus dem Cache, dann vom Server.
 * * **Beobachten:** React über {@link useDarstellung}, alles andere (etwa die
 *   3D-Szene) über {@link darstellungAbonnieren}. Beide werden erst nach dem
 *   Setzen der Wurzelattribute benachrichtigt - berechnete CSS-Werte sind
 *   dann bereits aktuell.
 *
 * `matchMedia` und die Wurzelattribute stehen ausschließlich hier - es gibt
 * keine zweite Theme-Steuerung.
 */

export const DARSTELLUNG_VERSION = 1;

export const DARSTELLUNGSMODI = ["system", "light", "dark"] as const;
export type Darstellungsmodus = (typeof DARSTELLUNGSMODI)[number];

/** Aufgelöstes Farbschema - das, was tatsächlich angezeigt wird. */
export type Farbschema = "light" | "dark";

export const MODUS_NAME: Record<Darstellungsmodus, string> = {
  system: "Wie das System",
  light: "Hell",
  dark: "Dunkel",
};

/**
 * Freigegebene Akzentfarbschemata. Die Farbwerte stehen in
 * `core/theme/akzente.css`; hier stehen nur Kennung und Name.
 */
export const AKZENTE = [
  { id: "blue", name: "ElektroPlan Blau" },
  { id: "teal", name: "Türkis" },
  { id: "green", name: "Grün" },
  { id: "violet", name: "Violett" },
  { id: "orange", name: "Orange" },
] as const;
export type AkzentId = (typeof AKZENTE)[number]["id"];

export interface Darstellung {
  readonly modus: Darstellungsmodus;
  readonly akzent: AkzentId;
}

export const STANDARD_DARSTELLUNG: Darstellung = Object.freeze({ modus: "system", akzent: "blue" });

/** Lokaler Schlüssel aus Phase 4c.2 - nur noch Quelle der einmaligen Übernahme. */
export function alterDarstellungsschluessel(benutzerId: string): string {
  return `elektroplan.darstellung.${benutzerId}`;
}

export function istModus(wert: unknown): wert is Darstellungsmodus {
  return typeof wert === "string" && (DARSTELLUNGSMODI as readonly string[]).includes(wert);
}

export function istAkzent(wert: unknown): wert is AkzentId {
  return typeof wert === "string" && AKZENTE.some((a) => a.id === wert);
}

export function gleicheDarstellung(a: Darstellung, b: Darstellung): boolean {
  return a.modus === b.modus && a.akzent === b.akzent;
}

/**
 * Liest einen alten lokalen Wert (Format Version 1). Unlesbares JSON oder eine
 * andere Version ergibt den Standard; ein fehlendes oder unbekanntes Feld nur
 * für dieses Feld.
 */
export function darstellungLesen(roh: string | null): Darstellung {
  if (roh === null) return STANDARD_DARSTELLUNG;
  let wert: unknown;
  try {
    wert = JSON.parse(roh);
  } catch {
    return STANDARD_DARSTELLUNG;
  }
  if (typeof wert !== "object" || wert === null) return STANDARD_DARSTELLUNG;
  const eintrag = wert as Record<string, unknown>;
  if (eintrag["version"] !== DARSTELLUNG_VERSION) return STANDARD_DARSTELLUNG;
  const modus = istModus(eintrag["modus"]) ? eintrag["modus"] : STANDARD_DARSTELLUNG.modus;
  const akzent = istAkzent(eintrag["akzent"]) ? eintrag["akzent"] : STANDARD_DARSTELLUNG.akzent;
  return { modus, akzent };
}

export function farbschemaAufloesen(modus: Darstellungsmodus, systemDunkel: boolean): Farbschema {
  if (modus === "system") return systemDunkel ? "dark" : "light";
  return modus;
}

// ------------------------------------------------------------ Zustand

export interface Darstellungszustand {
  /** Was gerade angezeigt wird - der Entwurf, solange eine Vorschau läuft. */
  readonly darstellung: Darstellung;
  /** Was für den Benutzer gespeichert ist. */
  readonly gespeichert: Darstellung;
  readonly farbschema: Farbschema;
  readonly vorschau: boolean;
}

const STANDARD_ZUSTAND: Darstellungszustand = Object.freeze({
  darstellung: STANDARD_DARSTELLUNG,
  gespeichert: STANDARD_DARSTELLUNG,
  farbschema: "light",
  vorschau: false,
});

let gespeichert: Darstellung = STANDARD_DARSTELLUNG;
let vorschau: Darstellung | null = null;
let systemDunkel = false;
let zustand: Darstellungszustand = STANDARD_ZUSTAND;
const hoerer = new Set<() => void>();

/** Wurzelattribute setzen; danach (nur bei Änderung) benachrichtigen. */
function aktualisieren() {
  const darstellung = vorschau ?? gespeichert;
  const farbschema = farbschemaAufloesen(darstellung.modus, systemDunkel);
  const wurzel = typeof document === "undefined" ? null : document.documentElement;
  if (wurzel !== null) {
    wurzel.dataset["theme"] = farbschema;
    wurzel.dataset["themeMode"] = darstellung.modus;
    wurzel.dataset["accent"] = darstellung.akzent;
    wurzel.style.colorScheme = farbschema;
  }
  const alt = zustand;
  if (
    alt.farbschema === farbschema &&
    alt.vorschau === (vorschau !== null) &&
    gleicheDarstellung(alt.darstellung, darstellung) &&
    gleicheDarstellung(alt.gespeichert, gespeichert)
  ) {
    return;
  }
  zustand = { darstellung, gespeichert, farbschema, vorschau: vorschau !== null };
  for (const h of [...hoerer]) h();
}

export function darstellungszustand(): Darstellungszustand {
  return zustand;
}

/** Zeigt einen Entwurf sofort an, ohne ihn zu speichern. */
export function darstellungVorschauen(entwurf: Darstellung) {
  vorschau = entwurf;
  aktualisieren();
}

/** Beendet eine Vorschau; es gilt wieder der gespeicherte Stand. */
export function darstellungVorschauBeenden() {
  if (vorschau === null) return;
  vorschau = null;
  aktualisieren();
}

/**
 * Setzt den gültigen (gespeicherten) Stand und beendet eine Vorschau -
 * `null` heißt: niemand angemeldet, es gilt der Standard. Gespeichert wird
 * hier nichts; das ist Sache von `core/einstellungen/persoenlich.ts`.
 */
export function darstellungSetzen(darstellung: Darstellung | null) {
  gespeichert = darstellung ?? STANDARD_DARSTELLUNG;
  vorschau = null;
  aktualisieren();
}

/** Für Nicht-React-Beobachter (3D-Szene); liefert die Abmeldung. */
export function darstellungAbonnieren(hoerer_: () => void): () => void {
  hoerer.add(hoerer_);
  return () => {
    hoerer.delete(hoerer_);
  };
}

export function useDarstellung(): Darstellungszustand {
  return useSyncExternalStore(darstellungAbonnieren, darstellungszustand, () => STANDARD_ZUSTAND);
}

// ------------------------------------------------------------ Start

/**
 * Einmal beim Start der Anwendung (`main.tsx`), vor dem ersten Rendern:
 * setzt die Wurzelattribute und beobachtet das Systemschema. Andere Tabs
 * beobachtet `core/einstellungen/persoenlich.ts`. Liefert die Abmeldung (für
 * Tests).
 */
export function darstellungStarten(): () => void {
  const medien = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const systemGeaendert = () => {
    systemDunkel = medien?.matches ?? false;
    aktualisieren();
  };
  systemDunkel = medien?.matches ?? false;
  medien?.addEventListener("change", systemGeaendert);
  aktualisieren();
  return () => {
    medien?.removeEventListener("change", systemGeaendert);
  };
}

/** Nur für Tests: vergisst Stand, Vorschau und Systemschema. */
export function darstellungZuruecksetzen() {
  gespeichert = STANDARD_DARSTELLUNG;
  vorschau = null;
  systemDunkel = false;
  zustand = STANDARD_ZUSTAND;
  if (typeof document !== "undefined") {
    const wurzel = document.documentElement;
    delete wurzel.dataset["theme"];
    delete wurzel.dataset["themeMode"];
    delete wurzel.dataset["accent"];
    wurzel.style.colorScheme = "";
  }
}
