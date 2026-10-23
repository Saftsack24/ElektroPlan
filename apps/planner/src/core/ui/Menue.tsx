import type { LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { KNOPF_GRUND } from "./stil";
import { Symbol } from "./Symbol";

/**
 * Ein Eintrag eines Menüs. `aktion` führt aus, `schalter` ist an/aus
 * (`menuitemcheckbox`), `wahl` ist eine von mehreren Möglichkeiten
 * (`menuitemradio`). Ein gesperrter Eintrag bleibt sichtbar und nennt den Grund.
 */
export interface Menuepunkt {
  readonly art?: "aktion" | "schalter" | "wahl";
  readonly label: string;
  readonly kuerzel?: string;
  readonly gewaehlt?: boolean;
  readonly gesperrt?: boolean;
  readonly gesperrtGrund?: string;
  readonly onWahl: () => void;
}

/** Abschnitt eines Menüs mit optionaler Überschrift. */
export interface Menueabschnitt {
  readonly titel?: string;
  readonly punkte: readonly Menuepunkt[];
}

/**
 * Aufklappmenü (Phase 6c, L1) für seltenere Einstellungen und Gruppen von
 * Werkzeugen – fachneutral.
 *
 * * Knopf mit `aria-haspopup="menu"` und `aria-expanded`; das Menü hat die Rolle
 *   `menu`, Einträge `menuitem`/`menuitemcheckbox`/`menuitemradio`.
 * * Tastatur: Pfeil auf/ab, Pos1/Ende, Enter/Leertaste wählen; **Escape schließt nur
 *   das Menü** (das Ereignis endet hier – keine zweite Wirkung) und gibt den Fokus an
 *   den Knopf zurück; Tab schließt.
 * * Ein Klick außerhalb schließt. Nach einer Wahl geht der Fokus an den Knopf zurück.
 */
export function Menue({
  label,
  text,
  icon,
  abschnitte,
  gedrueckt,
  amEnde = false,
}: {
  /** Zugänglicher Name des Knopfs. */
  label: string;
  /** Sichtbarer Text; ohne ihn nur das Symbol (dann mit Hinweis über `title`). */
  text?: string;
  icon?: LucideIcon;
  abschnitte: readonly Menueabschnitt[];
  /** Hebt den Knopf hervor, etwa wenn ein Werkzeug aus dem Menü aktiv ist. */
  gedrueckt?: boolean;
  /** Menü rechtsbündig am Knopf öffnen (Knöpfe am rechten Rand). */
  amEnde?: boolean;
}) {
  const [offen, setOffen] = useState(false);
  const knopf = useRef<HTMLButtonElement>(null);
  const liste = useRef<HTMLDivElement>(null);
  const menueId = useId();
  const hinweisId = useId();

  const eintraege = () => [...(liste.current?.querySelectorAll<HTMLButtonElement>("[data-menuepunkt]") ?? [])];

  useEffect(() => {
    if (!offen) return undefined;
    eintraege()[0]?.focus();
    const aussen = (event: PointerEvent) => {
      const ziel = event.target as Node | null;
      if (ziel !== null && (liste.current?.contains(ziel) === true || knopf.current?.contains(ziel) === true)) return;
      setOffen(false);
    };
    document.addEventListener("pointerdown", aussen, true);
    return () => document.removeEventListener("pointerdown", aussen, true);
  }, [offen]);

  const schliessen = (fokus: boolean) => {
    setOffen(false);
    if (fokus) knopf.current?.focus();
  };

  const tasten = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const alle = eintraege();
    const jetzt = alle.indexOf(document.activeElement as HTMLButtonElement);
    const gehe = (i: number) => alle[(i + alle.length) % alle.length]?.focus();
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        gehe(jetzt + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        gehe(jetzt - 1);
        break;
      case "Home":
        event.preventDefault();
        gehe(0);
        break;
      case "End":
        event.preventDefault();
        gehe(alle.length - 1);
        break;
      case "Escape":
        // Nur das Menü schließen - weder Werkzeug noch Ansicht reagieren auf dieselbe Taste.
        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        schliessen(true);
        break;
      case "Tab":
        schliessen(false);
        break;
      default:
        // Buchstaben sind im offenen Menü keine Werkzeugkürzel.
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) event.stopPropagation();
    }
  };

  return (
    <span className="group relative inline-flex">
      <button
        ref={knopf}
        type="button"
        className={`${KNOPF_GRUND} inline-flex items-center gap-1.5 px-2.5 py-[5px] text-small focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus ${
          gedrueckt === true ? "border-accent bg-accent text-on-accent" : "border-control bg-surface text-fg"
        }`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={offen}
        aria-controls={offen ? menueId : undefined}
        aria-describedby={text === undefined ? hinweisId : undefined}
        onClick={() => setOffen((o) => !o)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !offen) {
            event.preventDefault();
            setOffen(true);
          }
        }}
      >
        {icon !== undefined && <Symbol icon={icon} />}
        {text !== undefined && <span aria-hidden="true">{text}</span>}
        <span aria-hidden="true" className="text-[0.7em]">
          ▾
        </span>
      </button>
      {/* Nur ein Symbol sichtbar: Hinweis bei Zeigen und Tastaturfokus (wie `SymbolKnopf`). */}
      {text === undefined && (
        <span
          id={hinweisId}
          role="tooltip"
          className={`pointer-events-none absolute top-full z-30 mt-1 hidden rounded-ep border border-line bg-raised px-2 py-1 text-label whitespace-nowrap text-fg shadow-hint ${
            offen ? "" : "group-hover:block group-has-[:focus-visible]:block"
          } ${amEnde ? "right-0" : "left-0"}`}
        >
          {label}
        </span>
      )}
      {offen && (
        <div
          ref={liste}
          id={menueId}
          role="menu"
          aria-label={label}
          className={`absolute top-full z-40 mt-1 flex min-w-[220px] flex-col rounded-ep border border-line bg-raised py-1 text-small shadow-popup ${
            amEnde ? "right-0" : "left-0"
          }`}
          onKeyDown={tasten}
        >
          {abschnitte.map((abschnitt, i) => (
            <div key={abschnitt.titel ?? i} role="group" aria-label={abschnitt.titel} className={i > 0 ? "mt-1 border-t border-line pt-1" : ""}>
              {abschnitt.titel !== undefined && <p className="m-0 px-3 py-1 text-label text-muted" aria-hidden="true">{abschnitt.titel}</p>}
              {abschnitt.punkte.map((p) => {
                const art = p.art ?? "aktion";
                const rolle = art === "schalter" ? "menuitemcheckbox" : art === "wahl" ? "menuitemradio" : "menuitem";
                return (
                  <button
                    key={p.label}
                    type="button"
                    role={rolle}
                    data-menuepunkt=""
                    aria-checked={art === "aktion" ? undefined : p.gewaehlt === true}
                    aria-disabled={p.gesperrt === true || undefined}
                    title={p.gesperrt === true ? p.gesperrtGrund : undefined}
                    // Menüzeile über die volle Breite, ohne Browserdarstellung eines Knopfs (Rahmen, Fläche).
                    className={`flex w-full items-center justify-between gap-4 border-0 bg-transparent px-3 py-1.5 text-left text-fg hover:bg-page focus-visible:bg-page focus-visible:outline-none ${
                      p.gesperrt === true ? "cursor-not-allowed opacity-45" : "cursor-pointer"
                    }`}
                    onClick={() => {
                      if (p.gesperrt === true) return;
                      schliessen(true);
                      p.onWahl();
                    }}
                  >
                    <span className="flex items-center gap-2">
                      {art !== "aktion" && (
                        <span aria-hidden="true" className="inline-block w-3 text-center">
                          {p.gewaehlt === true ? (art === "schalter" ? "✓" : "●") : ""}
                        </span>
                      )}
                      {p.label}
                    </span>
                    {p.kuerzel !== undefined && <span className="text-label text-muted">{p.kuerzel}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
