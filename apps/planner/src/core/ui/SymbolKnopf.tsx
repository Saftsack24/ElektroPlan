import type { LucideIcon } from "lucide-react";
import { useId } from "react";

import { KNOPF_GRUND } from "./stil";
import { Symbol } from "./Symbol";

/**
 * Icon-Knopf für enge Werkzeugleisten (Regel aus `Symbol.tsx`).
 *
 * * Zugänglicher Name über `label` (`aria-label`); ein sichtbarer Text ist
 *   optional (`text`) und ersetzt den Namen dann nicht.
 * * Hinweis bei Zeigen **und** Tastaturfokus: ein eigenes Tooltip-Element
 *   (`role="tooltip"`, über `aria-describedby` verbunden) mit dem Tastenkürzel –
 *   der Browser-Tooltip (`title`) erscheint weder beim Fokus noch an gesperrten
 *   Knöpfen.
 * * **Gesperrt** bleibt der Knopf fokussierbar (`aria-disabled`), damit der
 *   Hinweis erreichbar ist; er ist deutlich blasser, zeigt den Grund und löst
 *   nichts aus.
 */
export function SymbolKnopf({
  icon,
  label,
  kuerzel,
  ariaKuerzel,
  gesperrt = false,
  gesperrtGrund,
  onClick,
  gedrueckt,
  aufgeklappt,
  steuert,
  text,
  hinweisUnten = true,
  hinweisAm = "start",
  beschreibung,
}: {
  icon: LucideIcon;
  label: string;
  /** Tastenkürzel in Lesefassung, etwa „Strg+Z“. */
  kuerzel?: string;
  /** Tastenkürzel für `aria-keyshortcuts`, etwa „Control+Z“. */
  ariaKuerzel?: string;
  gesperrt?: boolean;
  /** Warum die Aktion gerade nicht geht – steht im Hinweis. */
  gesperrtGrund?: string;
  onClick: () => void;
  gedrueckt?: boolean;
  aufgeklappt?: boolean;
  steuert?: string;
  text?: string;
  /** Hinweis unter (Standard) oder über dem Knopf. */
  hinweisUnten?: boolean;
  /**
   * Ausrichtung des Hinweises am Knopfrand: `start` (links bündig) oder `ende` (rechts bündig,
   * für Knöpfe am rechten Rand). Nie mittig – sonst ragt er am Rand aus der Fläche.
   */
  hinweisAm?: "start" | "ende";
  /** Längerer Hinweistext statt des Namens, etwa „Tür: Wand anklicken …“ (Name bleibt `label`). */
  beschreibung?: string;
}) {
  const hinweisId = useId();
  const grund = beschreibung ?? label;
  const hinweis = [kuerzel === undefined ? grund : `${grund} (${kuerzel})`, gesperrt && gesperrtGrund !== undefined ? gesperrtGrund : null]
    .filter((x) => x !== null)
    .join(" – ");
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className={`${KNOPF_GRUND} inline-flex items-center gap-1.5 px-2 py-[5px] text-small focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus ${
          gedrueckt === true ? "border-accent bg-accent text-on-accent" : "border-control bg-surface text-fg"
        } ${gesperrt ? "cursor-not-allowed opacity-40" : ""}`}
        aria-label={label}
        aria-describedby={hinweisId}
        aria-keyshortcuts={ariaKuerzel}
        aria-disabled={gesperrt || undefined}
        aria-pressed={gedrueckt}
        aria-expanded={aufgeklappt}
        aria-controls={steuert}
        data-gesperrt={gesperrt ? "" : undefined}
        onClick={() => {
          if (!gesperrt) onClick();
        }}
      >
        <Symbol icon={icon} />
        {text !== undefined && <span aria-hidden="true">{text}</span>}
      </button>
      <span
        id={hinweisId}
        role="tooltip"
        className={`pointer-events-none absolute z-30 hidden rounded-ep border border-line bg-raised px-2 py-1 text-label whitespace-nowrap text-fg shadow-hint group-hover:block group-has-[:focus-visible]:block ${
          hinweisUnten ? "top-full mt-1" : "bottom-full mb-1"
        } ${hinweisAm === "ende" ? "right-0" : "left-0"}`}
      >
        {hinweis}
      </span>
    </span>
  );
}
