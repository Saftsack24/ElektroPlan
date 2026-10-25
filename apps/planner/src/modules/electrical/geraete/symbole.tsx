/**
 * Planungssymbole der Elektrogeräte (Phase 5, ADR 0023, T1).
 *
 * **Eigene, einfache SVG-Symbole** - keine Emojis, keine Menü-Icons und
 * ausdrücklich **keine behauptete DIN-Konformität**. Die Zuordnung
 * Symbolschlüssel → Zeichnung steht nur hier; der Server liefert je Typ einen
 * `symbol_key`. Ein unbekannter Schlüssel fällt auf das Symbol seiner
 * Kategorie zurück. Austausch der Symbolbibliothek = diese Datei ersetzen.
 *
 * Alle Symbole liegen in einem 24 × 24-Raster um die Mitte (12, 12), gezeichnet
 * mit `currentColor` - sie folgen damit Theme und Auswahlzustand. Die
 * Symbolgröße ist reine Darstellung: Geprüft wird mit dem Planungsmaß des Typs,
 * nie mit der Größe dieses Bildes.
 *
 * Nur kontrollierte, mitgelieferte Zeichnungen: kein Upload, kein SVG- oder
 * HTML-Text von außen.
 */
import type { ReactNode } from "react";

import type { Geraetekategorie, Geraetetyp, Geraetetypen } from "./katalog";
import { FLAECHE_LABEL, KATEGORIEN, KATEGORIE_LABEL } from "./katalog";

const LINIE = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const FLAECHE = { fill: "currentColor", stroke: "none" } as const;

function Dose({ cx = 12, r = 6.5 }: { cx?: number; r?: number }) {
  return (
    <>
      <circle cx={cx} cy={12} r={r} {...LINIE} />
      <circle cx={cx - r * 0.38} cy={12} r={r * 0.16} {...FLAECHE} />
      <circle cx={cx + r * 0.38} cy={12} r={r * 0.16} {...FLAECHE} />
    </>
  );
}

function Leuchte({ r = 7 }: { r?: number }) {
  const d = r * 0.7;
  return (
    <>
      <circle cx={12} cy={12} r={r} {...LINIE} />
      <path d={`M${12 - d} ${12 - d}L${12 + d} ${12 + d}M${12 + d} ${12 - d}L${12 - d} ${12 + d}`} {...LINIE} />
    </>
  );
}

function Netzwerkdose({ cx = 12, b = 12 }: { cx?: number; b?: number }) {
  const l = cx - b / 2;
  const r = cx + b / 2;
  return (
    <>
      <rect x={l} y={6} width={b} height={12} rx={1.5} {...LINIE} />
      <path d={`M${l + b * 0.22} 15V10.5H${l + b * 0.34}V9H${r - b * 0.34}V10.5H${r - b * 0.22}V15Z`} {...LINIE} strokeWidth={1.2} />
    </>
  );
}

/** Die Zeichnungen je Symbolschlüssel - die einzige Stelle der Zuordnung. */
const ZEICHNUNGEN: Record<string, () => ReactNode> = {
  socket_single: () => <Dose />,
  socket_double: () => (
    <>
      <Dose cx={7.2} r={4.6} />
      <Dose cx={16.8} r={4.6} />
    </>
  ),
  socket_triple: () => (
    <>
      <Dose cx={4.6} r={3.6} />
      <Dose cx={12} r={3.6} />
      <Dose cx={19.4} r={3.6} />
    </>
  ),
  socket_outdoor: () => (
    <>
      <Dose />
      {/* Tropfen: außen geeignet */}
      <path d="M19.5 2.5c1.6 2.2 2.4 3.4 2.4 4.4a2.4 2.4 0 0 1-4.8 0c0-1 .8-2.2 2.4-4.4Z" {...FLAECHE} />
    </>
  ),
  switch_single: () => (
    <>
      <circle cx={10} cy={14} r={3} {...LINIE} />
      <path d="M12.2 11.8L19 5" {...LINIE} />
    </>
  ),
  switch_two_way: () => (
    <>
      <circle cx={12} cy={12} r={3} {...LINIE} />
      <path d="M14.2 9.8L20 4M9.8 14.2L4 20" {...LINIE} />
    </>
  ),
  switch_series: () => (
    <>
      <circle cx={10} cy={14} r={3} {...LINIE} />
      <path d="M12.2 11.8L19 5M14.5 14.5L21 8" {...LINIE} />
    </>
  ),
  light_ceiling: () => <Leuchte />,
  light_recessed: () => (
    <>
      <rect x={3.5} y={3.5} width={17} height={17} rx={1} {...LINIE} />
      <Leuchte r={5.5} />
    </>
  ),
  light_wall: () => (
    <>
      <path d="M4 19H20M5 19a7 7 0 0 1 14 0" {...LINIE} />
      <path d="M8.5 14.5L15.5 19M15.5 14.5L8.5 19" {...LINIE} strokeWidth={1.3} />
    </>
  ),
  light_outdoor: () => (
    <>
      <Leuchte r={5.5} />
      <path d="M12 1.5V4M12 20V22.5M1.5 12H4M20 12H22.5" {...LINIE} />
    </>
  ),
  data_single: () => <Netzwerkdose />,
  data_double: () => (
    <>
      <Netzwerkdose cx={7} b={9} />
      <Netzwerkdose cx={17} b={9} />
    </>
  ),
  // Phase 6b.0: Verteilung als Kasten mit Sammelschiene, Abzweigdose als Dose mit Punkt.
  distribution_board: () => (
    <>
      <rect x={4} y={3} width={16} height={18} rx={1.5} {...LINIE} />
      <path d="M7 8H17M9 8V16M12 8V16M15 8V16" {...LINIE} strokeWidth={1.3} />
    </>
  ),
  junction_box: () => (
    <>
      <circle cx={12} cy={12} r={6.5} {...LINIE} />
      <circle cx={12} cy={12} r={2} {...FLAECHE} />
    </>
  ),
  // Phase 6c K2: Geräteanschluss/Festanschluss als Kasten mit abgehender Anschlussleitung.
  connection_outlet: () => (
    <>
      <rect x={5} y={5} width={14} height={11} rx={1.5} {...LINIE} />
      <path d="M8.5 10.5H15.5M12 16V21M9 21H15" {...LINIE} />
    </>
  ),
};

/** Deutsche Namen der Zeichnungen – für die kontrollierte Symbolauswahl eigener Typen (K2). */
export const SYMBOL_LABEL: Readonly<Record<string, string>> = {
  socket_single: "Steckdose",
  socket_double: "Steckdose zweifach",
  socket_triple: "Steckdose dreifach",
  socket_outdoor: "Steckdose außen",
  switch_single: "Schalter",
  switch_two_way: "Wechselschalter",
  switch_series: "Serienschalter",
  light_ceiling: "Deckenleuchte",
  light_recessed: "Einbauleuchte",
  light_wall: "Wandleuchte",
  light_outdoor: "Außenleuchte",
  data_single: "Netzwerkdose",
  data_double: "Netzwerkdose zweifach",
  distribution_board: "Verteilung",
  junction_box: "Abzweigdose",
  connection_outlet: "Geräteanschluss",
};

/** Rückfall je Kategorie für einen unbekannten Symbolschlüssel. */
const KATEGORIE_ZEICHNUNG: Record<Geraetekategorie, string> = {
  socket: "socket_single",
  switch: "switch_single",
  light: "light_ceiling",
  data: "data_single",
  distribution: "distribution_board",
  junction: "junction_box",
  connection: "connection_outlet",
};

/** Symbol, mit dem ein neuer eigener Typ einer Kategorie startet (K2). */
export function symbolFuerKategorie(kategorie: Geraetekategorie): string {
  return KATEGORIE_ZEICHNUNG[kategorie];
}

function zeichnung(symbolKey: string, kategorie: Geraetekategorie | undefined): ReactNode {
  const z = ZEICHNUNGEN[symbolKey] ?? ZEICHNUNGEN[KATEGORIE_ZEICHNUNG[kategorie ?? "socket"]];
  return z?.() ?? null;
}

/**
 * Symbol innerhalb einer größeren SVG-Zeichenfläche: Mitte bei (`x`, `y`) im
 * Bildraum, `groesse` in Pixeln. Gleich groß in jeder Zoomstufe.
 */
export function SymbolImPlan({
  typ,
  x,
  y,
  groesse,
}: {
  typ: Pick<Geraetetyp, "symbol_key" | "category"> | undefined;
  x: number;
  y: number;
  groesse: number;
}) {
  const s = groesse / 24;
  return (
    <g transform={`translate(${x - groesse / 2} ${y - groesse / 2}) scale(${s})`} aria-hidden="true">
      {zeichnung(typ?.symbol_key ?? "", typ?.category)}
    </g>
  );
}

/** Eigenständiges Symbol, etwa in der Legende oder einer Auswahlliste. */
export function Geraetesymbol({ typ, groesse = 20 }: { typ: Pick<Geraetetyp, "symbol_key" | "category"> | undefined; groesse?: number }) {
  return (
    <svg width={groesse} height={groesse} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="shrink-0">
      {zeichnung(typ?.symbol_key ?? "", typ?.category)}
    </svg>
  );
}

function flaechen(typ: Geraetetyp): string {
  const teile: string[] = [];
  if (typ.allows_wall_interior) teile.push(FLAECHE_LABEL.wall_interior);
  if (typ.allows_wall_exterior) teile.push(FLAECHE_LABEL.wall_exterior);
  if (typ.allows_ceiling) teile.push(FLAECHE_LABEL.ceiling);
  return teile.join(", ");
}

/** Legende der Planungssymbole - nach Kategorie, mit zulässigen Montageflächen. */
export function Geraetelegende({ typen }: { typen: Geraetetypen }) {
  const aktiv = [...typen.values()].filter((t) => t.is_active).sort((a, b) => a.sort_order - b.sort_order);
  if (aktiv.length === 0) return <p className="m-0 text-muted">Der Gerätekatalog ist nicht geladen.</p>;
  return (
    <div className="flex flex-col gap-1.5" data-testid="geraetelegende">
      {KATEGORIEN.map((kategorie) => {
        const liste = aktiv.filter((t) => t.category === kategorie);
        if (liste.length === 0) return null;
        return (
          <section key={kategorie} aria-label={KATEGORIE_LABEL[kategorie]}>
            <h4 className="m-0 text-label font-semibold">{KATEGORIE_LABEL[kategorie]}</h4>
            <ul className="m-0 list-none p-0">
              {liste.map((t) => (
                <li key={t.key} className="flex items-center gap-2 py-0.5" title={flaechen(t)}>
                  <Geraetesymbol typ={t} />
                  <span>{t.label}</span>
                  <span className="text-label text-muted">· {flaechen(t)}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <p className="m-0 text-label text-muted">Eigene Planungssymbole von ElektroPlan – keine Normdarstellung.</p>
    </div>
  );
}

/** Alle Symbolschlüssel mit eigener Zeichnung – zugleich die kontrollierte Auswahl (K2). */
export const SYMBOLSCHLUESSEL: readonly string[] = Object.keys(ZEICHNUNGEN);

/** Symbole für eigene Typen: ohne Verteilung (die ist nie ein eigener Typ). */
export const WAEHLBARE_SYMBOLE: readonly string[] = SYMBOLSCHLUESSEL.filter((k) => k !== "distribution_board");

export type { Geraetetypen };
