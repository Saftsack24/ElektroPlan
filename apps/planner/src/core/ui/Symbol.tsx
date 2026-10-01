import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Einheitliches Icon-System (Phase 4d).
 *
 * Icons stammen ausschließlich aus `lucide-react` (baumschüttelbar: Jedes Icon
 * ist ein eigener Export, nur importierte landen im Bundle). Keine Emojis,
 * keine kopierten SVG-Sammlungen.
 *
 * Regeln:
 *
 * * Ein Icon **begleitet** Text. Es ist dann rein dekorativ und trägt
 *   `aria-hidden` - der zugängliche Name kommt vom Text.
 * * Ein Icon ohne sichtbaren Text gibt es nur in engen Werkzeugleisten
 *   (`SymbolKnopf`): mit eindeutigem `aria-label` **und** Tooltip (`title`).
 * * Größe und Abstand kommen von hier - keine zusammengesetzten
 *   Tailwind-Klassennamen, keine Größen je Aufrufer.
 *
 * Welches Icon welche Aktion bedeutet, steht in `aktionssymbole.ts` - eine
 * Aktion sieht überall gleich aus.
 */

/** Einheitliche Icongröße in Pixeln; folgt über `1em` nicht der Schrift. */
const GROESSE = 16;

/** Dekoratives Icon - immer `aria-hidden`, nie fokussierbar. */
export function Symbol({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <Icon
      size={GROESSE}
      strokeWidth={2}
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
      data-symbol=""
    />
  );
}

/**
 * Inhalt eines Knopfs oder Links: Icon und Text nebeneinander.
 *
 * `inline-flex` hält beide zusammen und zentriert das Icon auf der Textzeile.
 */
export function MitSymbol({ icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Symbol icon={icon} />
      <span>{children}</span>
    </span>
  );
}
