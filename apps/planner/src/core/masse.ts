/**
 * Längenmaße an der Oberflächengrenze - reine Funktionen, ohne React.
 *
 * **Gespeichert, übertragen und gerechnet wird ausschließlich in ganzen
 * Millimetern** (ADR 0007). Die Anzeigeeinheit ist nur eine Eingabe- und
 * Darstellungsschicht: Diese Datei ist die einzige Stelle, an der zwischen
 * Millimetern, Zentimetern und Metern umgerechnet wird. Komponenten rechnen
 * nie selbst mit `/ 10`, `* 10` oder `/ 1000`.
 *
 * Kein Fließkomma: Ein Wert mit Nachkommastellen wird als Ganzzahl plus
 * Ziffernfolge gelesen (`11,5 cm` → 11 · 10 + 5 = 115 mm, `1,25 m` →
 * 1 · 1000 + 250 = 1250 mm). So entsteht nie `114.99999`, und jede Rundreise
 * Millimeter → Anzeige → Millimeter ist exakt.
 *
 * | Einheit | Nachkommastellen | Beispiel (1250 mm) |
 * |---|---|---|
 * | `mm` | keine | `1.250 mm` |
 * | `cm` | höchstens eine, ohne unnötige Null | `125 cm` (115 mm: `11,5 cm`) |
 * | `m`  | immer drei - ein Millimeter ist genau darstellbar | `1,250 m` |
 *
 * Flächen bleiben in Quadratmetern und sind nicht Teil dieser Umrechnung.
 */

export type Masseinheit = "mm" | "cm" | "m";

export const MASSEINHEITEN: readonly Masseinheit[] = ["cm", "mm", "m"];

/** Voreinstellung für Benutzer ohne gespeicherte Wahl. */
export const STANDARD_MASSEINHEIT: Masseinheit = "cm";

export function istMasseinheit(wert: unknown): wert is Masseinheit {
  return wert === "cm" || wert === "mm" || wert === "m";
}

export const EINHEIT_NAME: Record<Masseinheit, string> = {
  cm: "Zentimeter",
  mm: "Millimeter",
  m: "Meter",
};

/** Kurzer Satz über das erwartete Eingabeformat. */
export const EINGABEHINWEIS: Record<Masseinheit, string> = {
  cm: "Maße in Zentimetern, höchstens eine Nachkommastelle (z. B. 11,5).",
  mm: "Maße in ganzen Millimetern.",
  m: "Maße in Metern, höchstens drei Nachkommastellen (z. B. 1,25 oder 1.25).",
};

/** Wie viele Millimeter eine Einheit hat - als Zehnerpotenz. */
const STELLEN: Record<Masseinheit, 0 | 1 | 3> = { mm: 0, cm: 1, m: 3 };
const FAKTOR: Record<Masseinheit, number> = { mm: 1, cm: 10, m: 1000 };
/** Meter zeigen immer alle drei Stellen; Zentimeter nur eine nötige. */
const FESTE_STELLEN: Record<Masseinheit, boolean> = { mm: false, cm: false, m: true };

/** `„Breite" + cm → „Breite (cm)"`. */
export function mitEinheit(label: string, einheit: Masseinheit): string {
  return `${label} (${einheit})`;
}

const GRUPPIERT = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

function zerlegen(mm: number, einheit: Masseinheit): { vorzeichen: string; ganz: number; bruch: string } {
  const betrag = Math.abs(Math.trunc(mm));
  const vorzeichen = mm < 0 && betrag !== 0 ? "-" : "";
  const faktor = FAKTOR[einheit];
  const rest = betrag % faktor;
  const ganz = (betrag - rest) / faktor;
  const stellen = STELLEN[einheit];
  if (stellen === 0) return { vorzeichen, ganz, bruch: "" };
  const ziffern = String(rest).padStart(stellen, "0");
  const bruch = FESTE_STELLEN[einheit] ? ziffern : ziffern.replace(/0+$/, "");
  return { vorzeichen, ganz, bruch };
}

/**
 * Maß für die Anzeige, mit Einheit und Tausenderpunkten:
 * `115 → „11,5 cm"`, `2500 → „250 cm"`, `12500 mm → „1.250 cm"`,
 * `1250 → „1,250 m"`.
 */
export function mmAnzeigen(mm: number, einheit: Masseinheit): string {
  return `${zahlAnzeigen(mm, einheit)} ${einheit}`;
}

/** Nur die Zahl, ohne Einheit - für Spalten mit Einheit im Kopf. */
export function zahlAnzeigen(mm: number, einheit: Masseinheit): string {
  const { vorzeichen, ganz, bruch } = zerlegen(mm, einheit);
  return `${vorzeichen}${GRUPPIERT.format(ganz)}${bruch === "" ? "" : `,${bruch}`}`;
}

/** Koordinatenpaar: `„30 / -42,5 cm"`. */
export function punktAnzeigen(x: number, y: number, einheit: Masseinheit): string {
  return `${zahlAnzeigen(x, einheit)} / ${zahlAnzeigen(y, einheit)} ${einheit}`;
}

/** Optionales Maß für die Anzeige; `null` wird zum Gedankenstrich. */
export function mmAnzeigenOptional(mm: number | null | undefined, einheit: Masseinheit): string {
  return mm === null || mm === undefined ? "—" : mmAnzeigen(mm, einheit);
}

/**
 * Maß als **editierbarer** Eingabetext - ohne Einheit und ohne
 * Tausenderpunkte, damit er unverändert wieder gelesen werden kann.
 */
export function mmAlsEingabe(mm: number, einheit: Masseinheit): string {
  const { vorzeichen, ganz, bruch } = zerlegen(mm, einheit);
  return `${vorzeichen}${ganz}${bruch === "" ? "" : `,${bruch}`}`;
}

/** Optionaler Eingabetext: `null` bleibt ein leeres Feld. */
export function mmAlsEingabeOptional(mm: number | null | undefined, einheit: Masseinheit): string {
  return mm === null || mm === undefined ? "" : mmAlsEingabe(mm, einheit);
}

export type Masseingabe = { ok: true; mm: number } | { ok: false; fehler: string };
export type OptionaleMasseingabe = { ok: true; mm: number | null } | { ok: false; fehler: string };

const FEHLER_FORMAT: Record<Masseinheit, string> = {
  cm: "Bitte eine Zahl in Zentimetern angeben, z. B. 11,5.",
  mm: "Bitte eine ganze Zahl in Millimetern angeben.",
  m: "Bitte eine Zahl in Metern angeben, z. B. 1,25.",
};

export const FEHLER_GENAUIGKEIT: Record<Masseinheit, string> = {
  mm: "Bitte ganze Millimeter angeben.",
  cm: "Höchstens eine Nachkommastelle - gespeichert werden ganze Millimeter.",
  m: "Höchstens drei Nachkommastellen - gespeichert werden ganze Millimeter.",
};

export const FEHLER_TAUSENDER = "Bitte ohne Tausenderpunkt eingeben (z. B. 1250 statt 1.250).";

const ZAHL = /^([+-]?)(\d*)(?:[.,](\d*))?$/;
/** Ein angehängtes Einheitenzeichen, etwa „125 cm" oder „1,25m". */
const SUFFIX = /^(.*?)(mm|cm|m)$/i;

/**
 * Liest einen Eingabetext als ganze Millimeter.
 *
 * * Komma **und** Punkt sind Dezimaltrenner; Leerzeichen werden ignoriert.
 * * Ein angehängtes Einheitenzeichen (`mm`, `cm`, `m`) gilt und hat Vorrang
 *   vor der Anzeigeeinheit: `„1,25 m"` ergibt im Zentimetermodus 1250 mm.
 * * Zentimeter: höchstens eine (von null verschiedene) Nachkommastelle.
 *   `11,5`, `11.5`, `-3`, `,5` und `11,50` sind gültig; `11,55` wäre kein
 *   ganzer Millimeter und wird abgelehnt.
 * * Meter: höchstens drei Nachkommastellen - `1,250`, `1.25`, `0,005`.
 * * Millimeter: nur ganze Zahlen.
 * * `1.250` ist in Zentimetern und Millimetern mehrdeutig (Tausenderpunkt
 *   oder Dezimalpunkt) und wird nicht geraten; in Metern ist es 1,25 m.
 * * Ein leerer Text ist hier ein Fehler - für optionale Felder gibt es
 *   {@link mmAusEingabeOptional}.
 *
 * Ob ein Wert negativ sein darf oder eine Untergrenze hat, prüft das Feld
 * selbst (und verbindlich der Server).
 */
export function mmAusEingabe(text: string, anzeigeeinheit: Masseinheit): Masseingabe {
  let roh = text.trim().replace(/\s+/g, "");
  let einheit = anzeigeeinheit;
  const mitSuffix = SUFFIX.exec(roh);
  if (mitSuffix !== null) {
    roh = mitSuffix[1] ?? "";
    einheit = (mitSuffix[2] ?? "").toLowerCase() as Masseinheit;
  }
  if (roh === "") return { ok: false, fehler: FEHLER_FORMAT[einheit] };

  const treffer = ZAHL.exec(roh);
  if (treffer === null) return { ok: false, fehler: FEHLER_FORMAT[einheit] };
  const vorzeichen = treffer[1] ?? "";
  const ganzText = treffer[2] ?? "";
  const bruchRoh = treffer[3];
  if (ganzText === "" && (bruchRoh === undefined || bruchRoh === "")) {
    return { ok: false, fehler: FEHLER_FORMAT[einheit] };
  }
  // „1.250" ist in mm und cm mehrdeutig (Tausenderpunkt oder Dezimalpunkt) - nie raten.
  if (einheit !== "m" && /^\d+\.\d{3}$/.test(roh.replace(/^[+-]/, ""))) {
    return { ok: false, fehler: FEHLER_TAUSENDER };
  }
  if (bruchRoh !== undefined && einheit === "mm") {
    return { ok: false, fehler: FEHLER_FORMAT.mm };
  }
  const nachkomma = (bruchRoh ?? "").replace(/0+$/, "");
  const stellen = STELLEN[einheit];
  if (nachkomma.length > stellen) return { ok: false, fehler: FEHLER_GENAUIGKEIT[einheit] };

  const ganz = ganzText === "" ? 0 : Number(ganzText);
  const bruch = nachkomma === "" ? 0 : Number(nachkomma.padEnd(stellen, "0"));
  const betrag = ganz * FAKTOR[einheit] + bruch;
  if (!Number.isSafeInteger(ganz) || !Number.isSafeInteger(betrag)) {
    return { ok: false, fehler: FEHLER_FORMAT[einheit] };
  }
  // `+ 0` macht aus -0 eine 0.
  return { ok: true, mm: (vorzeichen === "-" ? -betrag : betrag) + 0 };
}

/** Wie {@link mmAusEingabe}; ein leeres Feld ergibt `null`. */
export function mmAusEingabeOptional(text: string, einheit: Masseinheit): OptionaleMasseingabe {
  if (text.trim() === "") return { ok: true, mm: null };
  return mmAusEingabe(text, einheit);
}

// ------------------------------------------------ Mehrere Felder eines Formulars

/**
 * Wandelt Millimeter-Texte (wie sie aus der API in Formularwerte übernommen
 * werden, etwa `"115"`) in Eingabetexte der Anzeigeeinheit um. Leere Felder
 * bleiben leer.
 */
export function eingabenAusMm<WerteT extends Record<string, unknown>, FeldT extends keyof WerteT & string>(
  werte: WerteT,
  felder: readonly FeldT[],
  einheit: Masseinheit,
): WerteT {
  const neu: Record<string, unknown> = { ...werte };
  for (const feld of felder) {
    const text = String(werte[feld] ?? "").trim();
    neu[feld] = text === "" || !/^-?\d+$/.test(text) ? text : mmAlsEingabe(Number(text), einheit);
  }
  return neu as WerteT;
}

/** {@link eingabeUmrechnen} für mehrere Felder. */
export function eingabenUmrechnen<WerteT extends Record<string, unknown>, FeldT extends keyof WerteT & string>(
  werte: WerteT,
  felder: readonly FeldT[],
  von: Masseinheit,
  nach: Masseinheit,
): WerteT {
  const neu: Record<string, unknown> = { ...werte };
  for (const feld of felder) neu[feld] = eingabeUmrechnen(String(werte[feld] ?? ""), von, nach);
  return neu as WerteT;
}

/**
 * Liest mehrere Pflicht-Maßfelder. Liefert die Millimeter aller lesbaren
 * Felder und je unlesbarem Feld eine Meldung.
 */
export function eingabenLesen<FeldT extends string>(
  werte: Readonly<Record<FeldT, string>>,
  felder: readonly FeldT[],
  einheit: Masseinheit,
): { mm: Partial<Record<FeldT, number>>; fehler: Partial<Record<FeldT, string>> } {
  const mm: Partial<Record<FeldT, number>> = {};
  const fehler: Partial<Record<FeldT, string>> = {};
  for (const feld of felder) {
    const gelesen = mmAusEingabe(werte[feld], einheit);
    if (gelesen.ok) mm[feld] = gelesen.mm;
    else fehler[feld] = gelesen.fehler;
  }
  return { mm, fehler };
}

/**
 * Rechnet einen noch nicht übernommenen Eingabetext in eine andere Einheit
 * um - für den Fall, dass die Einheit wechselt, während ein Formular offen
 * ist. Ein unlesbarer Text bleibt unverändert stehen; er wird beim Absenden
 * ohnehin als Fehler gemeldet.
 */
export function eingabeUmrechnen(text: string, von: Masseinheit, nach: Masseinheit): string {
  if (von === nach || text.trim() === "") return text;
  const gelesen = mmAusEingabe(text, von);
  return gelesen.ok ? mmAlsEingabe(gelesen.mm, nach) : text;
}
