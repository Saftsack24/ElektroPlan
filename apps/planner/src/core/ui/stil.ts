/**
 * Wiederkehrende Oberflächenmuster als Tailwind-Klassenrezepte (ADR 0018).
 *
 * Hier steht nur, was an vielen Stellen gleich aussehen muss - Knöpfe,
 * Eingabefelder, Meldungen, Karten, Tabellen, Reiter. Einmalige Layouts
 * gehören als Utilities direkt an ihr Element.
 *
 * Regeln:
 *
 * * Jede Klasse steht hier als **vollständige, statische Zeichenkette**.
 *   Tailwind findet Klassen durch Lesen des Quelltexts; ein zusammengesetzter
 *   Name wie `bg-${farbe}` würde im Produktionsbuild fehlen.
 * * Farben nur über semantische Tokens (`bg-accent`, `text-muted`,
 *   `border-line`, `border-control` …), siehe core/theme/tokens.css.
 * * Bedienelemente (Eingabefelder, Knöpfe) tragen den Kontrollrahmen
 *   `border-control` (≥ 3 : 1); Karten und Trennlinien den dezenten
 *   `border-line`.
 * * Rezepte liefern sich gegenseitig ausschließende Varianten, nie zwei
 *   Klassen für dieselbe Eigenschaft: Bei Tailwind entscheidet die Reihenfolge
 *   im Stylesheet, nicht die im `className`.
 */

/** Grundform jedes Knopfs, ohne Abstand und Farbe - für Sonderknöpfe mit eigenem Maß. */
export const KNOPF_GRUND = "cursor-pointer rounded-ep border";

export type KnopfArt = "primaer" | "neutral" | "gewaehlt" | "gefahr" | "einfach";

const KNOPF_ART: Record<KnopfArt, string> = {
  primaer:
    "border-transparent bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:cursor-progress disabled:opacity-60",
  neutral: "border-control bg-transparent text-fg",
  // Wie `neutral`, der Rahmen markiert den gewählten Eintrag einer Liste.
  gewaehlt: "border-selected bg-transparent text-fg",
  gefahr: "border-transparent bg-danger text-surface disabled:cursor-progress disabled:opacity-60",
  // Browserdarstellung des Knopfs, nur mit gemeinsamer Form und Abstand.
  einfach: "border-transparent",
};

/**
 * Klassen eines Knopfs - auch für Links, die wie ein Knopf aussehen
 * (`link: true`).
 */
export function knopf(
  art: KnopfArt = "neutral",
  { klein = false, link = false }: { klein?: boolean; link?: boolean } = {},
): string {
  const abstand = klein ? "px-2 py-1 text-label" : "px-3.5 py-[9px]";
  const alsLink = link ? " inline-block no-underline" : "";
  return `${KNOPF_GRUND} ${abstand} ${KNOPF_ART[art]}${alsLink}`;
}

/** Senkrechter Stapel mit Standardabstand. */
export const STAPEL = "flex flex-col gap-4";

/** Knöpfe nebeneinander unter einem Formular oder Abschnitt. */
export const KNOPFZEILE = "mt-3 flex flex-wrap gap-2";

// --------------------------------------------------------------- Formulare

/** Beschriftetes Feld: Beschriftung, Eingabe, Fehler und Hinweis untereinander. */
export const FELD = "flex flex-col gap-1";
export const FELD_BESCHRIFTUNG = "text-label text-muted";
export const FELD_FEHLER = "text-label text-danger";
export const FELD_HINWEIS = "text-label text-muted";
/** Kontrollkästchen oder Optionsfeld mit Beschriftung daneben. */
export const SCHALTERFELD = "flex items-center gap-2";

/**
 * Eingabefeld, Auswahlliste oder Textbereich. `kompakt` für schmale
 * Bedienleisten: weniger Innenabstand, Breite nach Inhalt.
 */
export function eingabefeld({ fehler = false, kompakt = false }: { fehler?: boolean; kompakt?: boolean } = {}): string {
  const mass = kompakt ? "w-auto px-1.5 py-1" : "px-[11px] py-[9px]";
  return `rounded-ep border bg-page text-fg focus-visible:outline-offset-1 ${mass} ${
    fehler ? "border-danger" : "border-control"
  }`;
}

/** Formularraster: Felder nebeneinander, so viele wie passen. */
export const FORMULARRASTER = "mt-3 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3";
/** Zeile über die volle Breite des Formularrasters (Aktionen, Hinweise). */
export const FORMULARRASTER_AKTIONEN = "col-span-full flex flex-col items-start gap-2";
/** Umrandeter Block über die volle Breite des Formularrasters (`<fieldset>`). */
export const FORMULARRASTER_BLOCK = "col-span-full rounded-ep border border-line p-3";
export const FORMULARRASTER_LEGENDE = "px-1 text-label text-muted";

/**
 * Feldzeile: Felder nebeneinander, oben bündig. Hinweise und Fehler wachsen
 * nur unter ihrem eigenen Feld; auf schmalen Flächen brechen die Felder um.
 */
export const FELDZEILE =
  "mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] items-start gap-3";

/** Begriff-Wert-Liste (`<dl>`) in zwei Spalten; schmal untereinander. */
export const KENNWERTE =
  "m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 max-sm:grid-cols-1 [&_dd]:m-0 [&_dt]:text-muted";

/** Felder in einer umbrechenden Reihe, unten bündig (Knopf neben Feld). */
export const FELDREIHE = "mt-3 flex flex-wrap items-end gap-3";

/** Such- und Filterfelder über einer Liste. */
export const FILTERZEILE = "mb-2 flex flex-wrap gap-3 *:min-w-[220px]";

// ------------------------------------------------------ Meldungen, Karten

export type MeldungArt = "fehler" | "erfolg" | "schlicht";

const MELDUNG_ART: Record<MeldungArt, string> = {
  fehler: "bg-danger-soft text-danger",
  erfolg: "border border-line bg-surface",
  schlicht: "",
};

/** Meldungsfläche, etwa ein Fehler unter einem Formular. */
export function meldungsflaeche(art: MeldungArt = "fehler"): string {
  return `m-0 rounded-ep px-3 py-2.5 ${MELDUNG_ART[art]}`.trimEnd();
}

export type KartenArt = "normal" | "kompakt" | "eingerueckt";

const KARTEN_ART: Record<KartenArt, string> = {
  normal: "p-5",
  kompakt: "p-3",
  eingerueckt: "border-dashed p-5",
};

/** Umrandete Fläche für einen Inhaltsbereich. */
export function karte(art: KartenArt = "normal"): string {
  return `rounded-ep border border-line bg-surface ${KARTEN_ART[art]}`;
}

/** Kopfzeile einer Karte: Titel links, Aktionen rechts; bricht schmal um. */
export const KARTENKOPF = "flex flex-wrap items-center justify-between gap-3";
/** Überschrift einer Karte. */
export const KARTENTITEL = "m-0 text-[1.1rem]";

// ------------------------------------------------------- Tabellen, Reiter

/** Datentabelle; Zellen und Kopfzeile werden über die Tabelle gestaltet. */
export const TABELLE =
  "mt-3 w-full border-collapse text-small [&_:is(th,td)]:border-b [&_:is(th,td)]:border-line [&_:is(th,td)]:px-2 [&_:is(th,td)]:py-[7px] [&_:is(th,td)]:text-left [&_th]:font-semibold [&_th]:text-muted";

/**
 * Hülle einer breiten Tabelle: scrollt waagrecht statt die Seite zu verbreitern.
 *
 * `relative`, damit absolut positionierte, nur für Screenreader sichtbare Texte
 * (`sr-only`) in der Tabelle sich auf diese Hülle beziehen - sonst ragen sie aus
 * ihr heraus und verbreitern doch die Seite (gemessen in Phase 4e bei 320 px).
 */
export const TABELLENRAHMEN = "relative max-w-full min-w-0 overflow-x-auto";

/** Reiterleiste über einem Bereich. */
export const REITERLEISTE = "flex flex-wrap gap-1 border-b border-line";

/** Einzelner Reiter; `aktiv` hebt den gewählten hervor. */
export function reiter(aktiv: boolean): string {
  return `cursor-pointer rounded-t-ep border border-b-0 px-3.5 py-2 ${
    aktiv ? "border-line bg-surface font-semibold text-fg" : "border-transparent bg-transparent text-muted hover:text-fg"
  }`;
}
