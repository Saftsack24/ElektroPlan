/**
 * Ist eine Lage in der Wandansicht zulässig? - dieselben Regeln wie der Server.
 *
 * Geprüft wird ein vollständiges Rechteck in Ansichtskoordinaten. Es wird
 * zuerst über die eine Transformation (`wandbezug.ts`) in gespeicherte Werte
 * zurückgerechnet und dann mit genau den Funktionen geprüft, die auch der
 * Grundriss verwendet:
 *
 * * Größe 10 cm bis 20 m (`MIN/MAX_OPENING_SIZE_MM`),
 * * Höhenlage gegen die Raumhöhe, Brüstung nur beim Fenster
 *   (`oeffnungsHoehenBefunde`, Spiegel von `opening_height_problems`),
 * * vollständig in der Wand, eindeutige Raumverbindung, keine Überlappung -
 *   auch nicht mit einer auf der Gegenseite gespeicherten Öffnung
 *   (`bereichPruefen`).
 *
 * Die neue Ansicht verschärft und lockert damit keine Regel. Die
 * verbindliche Prüfung bleibt serverseitig.
 */
import type { Oeffnungsart } from "../editor/entwurf";
import { MAX_OEFFNUNG_MM, MIN_OEFFNUNG_MM, oeffnungsHoehenBefunde } from "../editor/geometrie";
import type { EditorWand } from "../editor/platzierung";
import { bereichPruefen } from "../editor/platzierung";
import type { Wandteilung } from "../topologie/wandtopologie";
import type { Ansichtsrechteck, Wandbezug } from "./wandbezug";
import { inAnsicht, rechteckAusAnsicht } from "./wandbezug";

export interface Oeffnungswerte {
  readonly offset_mm: number;
  readonly width_mm: number;
  readonly height_mm: number;
  readonly sill_height_mm: number;
}

export type Lagepruefung = { readonly ok: true; readonly werte: Oeffnungswerte } | { readonly ok: false; readonly grund: string };

const HOEHENGRUND: Record<string, string> = {
  "opening-height-not-positive": "Die Öffnung braucht eine Höhe.",
  "opening-sill-negative": "Die Öffnung kann nicht unter dem Fußboden beginnen.",
  "window-needs-sill": "Ein Fenster braucht eine Brüstung über dem Boden – sonst wäre es eine Tür.",
  "sill-only-for-window": "Türen und Durchgänge stehen auf dem Boden; eine Brüstung gibt es nur beim Fenster.",
};

export function lagePruefen(
  bezug: Wandbezug,
  teilung: Wandteilung<EditorWand> | undefined,
  art: Oeffnungsart,
  rechteck: Ansichtsrechteck,
  optionen: { ohneOeffnungId?: string | undefined; laengeText: (mm: number) => string; raumName: (raumId: string) => string },
): Lagepruefung {
  const mm = optionen.laengeText;
  const werte = rechteckAusAnsicht(bezug, rechteck);
  if (![werte.offset_mm, werte.width_mm, werte.height_mm, werte.sill_height_mm].every(Number.isSafeInteger)) {
    return { ok: false, grund: "Gespeichert werden nur ganze Millimeter." };
  }
  if (werte.width_mm < MIN_OEFFNUNG_MM || werte.height_mm < MIN_OEFFNUNG_MM) {
    return { ok: false, grund: `Breite und Höhe müssen mindestens ${mm(MIN_OEFFNUNG_MM)} betragen.` };
  }
  if (werte.width_mm > MAX_OEFFNUNG_MM || werte.height_mm > MAX_OEFFNUNG_MM) {
    return { ok: false, grund: `Breite und Höhe dürfen höchstens ${mm(MAX_OEFFNUNG_MM)} betragen.` };
  }
  const hoehe = oeffnungsHoehenBefunde("o", art, werte.height_mm, werte.sill_height_mm, bezug.hoeheMm);
  if (hoehe.length > 0) {
    const code = hoehe[0]?.code ?? "";
    return {
      ok: false,
      grund:
        code === "opening-exceeds-room-height"
          ? `Die Oberkante (${mm(werte.sill_height_mm + werte.height_mm)}) läge über der Decke (${mm(bezug.hoeheMm)}).`
          : (HOEHENGRUND[code] ?? "Die Höhenlage ist nicht zulässig."),
    };
  }
  if (teilung === undefined) return { ok: false, grund: "Die Wand ist im aktuellen Stand nicht vorhanden." };
  // Vorhandene Öffnungen in der Sprache der Ansicht benennen, nicht ab Wandanfang.
  const lageText = (offsetMm: number, breiteMm: number) => `${mm(inAnsicht(bezug, offsetMm, breiteMm).links)} von links`;
  const bereich = bereichPruefen(teilung, werte.offset_mm, werte.width_mm, { ...optionen, lageText });
  if (!bereich.ok) return { ok: false, grund: bereich.grund };
  return { ok: true, werte };
}
