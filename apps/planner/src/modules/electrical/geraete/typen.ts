/**
 * Eigene Gerätetypen des Betriebs (Phase 6c, K2, ADR 0030) – Formularwerte, Prüfung und
 * Fehlertexte. Ein Katalog: Systemtypen und eigene Typen kommen aus derselben Abfrage
 * (`katalogAbfrage`); nach jeder Änderung wird genau dieser Schlüssel neu geladen.
 *
 * Schlüssel und Betrieb vergibt der Server. Ist ein Typ verwendet (Geräte oder
 * Vorlagenzuordnungen), bleiben Kategorie und Planungsmaß gesperrt – für eine Variante legt man
 * einen neuen Typ an. Geprüft wird hier nur als Bedienhilfe; verbindlich ist der Server.
 */
import type { components } from "@elektroplan/api-client";
import { ApiError } from "@elektroplan/api-client";

import type { Masse } from "../../../core/ui/masseinheit";
import type { Montageflaeche } from "../editor/entwurf";
import type { Geraetetyp } from "./katalog";
import { EIGENE_KATEGORIEN } from "./katalog";

export const GERAETETYPEN_RECHT = "electrical.device_types.manage";

export type EigeneKategorie = (typeof EIGENE_KATEGORIEN)[number];
export type TypAnlage = components["schemas"]["DeviceTypeCreate"];
export type TypAenderung = components["schemas"]["DeviceTypeUpdate"];

/** Spiegel der Servergrenzen (`catalog.py`, `schemas.py`). */
export const NAME_MAX = 80;
export const BESCHREIBUNG_MAX = 300;
export const MASS_MIN_MM = 20;
export const MASS_MAX_MM = 1_000;
export const HOEHE_MAX_MM = 6_000;

export interface Typwerte {
  readonly name: string;
  readonly beschreibung: string;
  readonly kategorie: EigeneKategorie | "";
  readonly symbol: string;
  readonly innen: boolean;
  readonly aussen: boolean;
  readonly decke: boolean;
  /** Eingabetexte in der Anzeigeeinheit. */
  readonly hoehe: string;
  readonly breite: string;
  readonly tiefe: string;
  readonly reihenfolge: string;
  readonly aktiv: boolean;
}

export type Typfeld = "name" | "beschreibung" | "kategorie" | "symbol" | "flaechen" | "hoehe" | "breite" | "tiefe" | "reihenfolge";
export type Typfehler = Partial<Record<Typfeld, string>>;

/** Leeres Formular; eine vorgegebene Fläche (Katalog auf einer Wand/Decke) ist vorbelegt. */
export function leereTypwerte(flaeche: Montageflaeche | null): Typwerte {
  return {
    name: "",
    beschreibung: "",
    kategorie: "",
    symbol: "",
    innen: flaeche === "wall_interior",
    aussen: flaeche === "wall_exterior",
    decke: flaeche === "ceiling",
    hoehe: "",
    breite: "",
    tiefe: "",
    reihenfolge: "1000",
    aktiv: true,
  };
}

export function typwerteAus(typ: Geraetetyp, masse: Masse): Typwerte {
  return {
    name: typ.label,
    beschreibung: typ.description ?? "",
    kategorie: typ.category === "distribution" ? "" : typ.category,
    symbol: typ.symbol_key,
    innen: typ.allows_wall_interior,
    aussen: typ.allows_wall_exterior,
    decke: typ.allows_ceiling,
    hoehe: masse.alsEingabeOptional(typ.default_center_height_mm),
    breite: masse.alsEingabe(typ.width_mm),
    tiefe: masse.alsEingabe(typ.height_mm),
    reihenfolge: String(typ.sort_order),
    aktiv: typ.is_active,
  };
}

/** „Als neuen Typ anlegen“: dieselben Angaben unter neuem Namen, aktiv, ohne Bestand. */
export function alsNeuerTyp(werte: Typwerte): Typwerte {
  const zusatz = " (Variante)";
  const name = werte.name.trim();
  return { ...werte, name: `${name.slice(0, NAME_MAX - zusatz.length)}${zusatz}`, aktiv: true };
}

function planungsmass(text: string, masse: Masse): { mm: number } | { fehler: string } {
  const gelesen = masse.lesen(text);
  if (!gelesen.ok) return { fehler: gelesen.fehler };
  if (gelesen.mm < MASS_MIN_MM || gelesen.mm > MASS_MAX_MM) return { fehler: `Bitte zwischen ${masse.anzeigen(MASS_MIN_MM)} und ${masse.anzeigen(MASS_MAX_MM)}.` };
  if (gelesen.mm % 2 !== 0) return { fehler: "Bitte in geraden Millimetern – die Mitte liegt sonst zwischen zwei Millimetern." };
  return { mm: gelesen.mm };
}

/** Prüft die Eingaben; liefert den vollständigen Körper für Anlegen bzw. Ändern oder die Feldfehler. */
export function typPruefen(werte: Typwerte, masse: Masse): { ok: true; body: TypAnlage } | { ok: false; fehler: Typfehler } {
  const f: Typfehler = {};
  const name = werte.name.trim();
  if (name === "") f.name = "Bitte einen Namen angeben.";
  else if (name.length > NAME_MAX) f.name = `Höchstens ${NAME_MAX} Zeichen.`;
  const beschreibung = werte.beschreibung.trim();
  if (beschreibung.length > BESCHREIBUNG_MAX) f.beschreibung = `Höchstens ${BESCHREIBUNG_MAX} Zeichen.`;
  if (werte.kategorie === "") f.kategorie = "Bitte eine Kategorie wählen.";
  if (werte.symbol === "") f.symbol = "Bitte ein Symbol wählen.";
  if (!werte.innen && !werte.aussen && !werte.decke) f.flaechen = "Bitte mindestens eine Montagefläche wählen.";
  const breite = planungsmass(werte.breite, masse);
  if ("fehler" in breite) f.breite = breite.fehler;
  const tiefe = planungsmass(werte.tiefe, masse);
  if ("fehler" in tiefe) f.tiefe = tiefe.fehler;
  const hoehe = masse.lesenOptional(werte.hoehe);
  if (!hoehe.ok) f.hoehe = hoehe.fehler;
  else if (hoehe.mm !== null && (hoehe.mm < 0 || hoehe.mm > HOEHE_MAX_MM)) f.hoehe = `Bitte zwischen ${masse.anzeigen(0)} und ${masse.anzeigen(HOEHE_MAX_MM)}.`;
  const reihe = Number(werte.reihenfolge.trim() === "" ? "1000" : werte.reihenfolge.trim());
  if (!Number.isInteger(reihe) || reihe < 0 || reihe > 100_000) f.reihenfolge = "Bitte eine ganze Zahl von 0 bis 100 000.";
  if (Object.keys(f).length > 0 || werte.kategorie === "" || "fehler" in breite || "fehler" in tiefe || !hoehe.ok) return { ok: false, fehler: f };
  return {
    ok: true,
    body: {
      label: name,
      description: beschreibung === "" ? null : beschreibung,
      category: werte.kategorie,
      symbol_key: werte.symbol,
      allows_wall_interior: werte.innen,
      allows_wall_exterior: werte.aussen,
      allows_ceiling: werte.decke,
      default_center_height_mm: hoehe.mm,
      width_mm: breite.mm,
      height_mm: tiefe.mm,
      sort_order: reihe,
      is_active: werte.aktiv,
    },
  };
}

/** Nur geänderte Angaben – gesperrte Felder eines verwendeten Typs bleiben so unberührt. */
export function typAenderung(stand: Geraetetyp, body: TypAnlage): TypAenderung {
  const aenderung: Record<string, unknown> = {};
  for (const [feld, wert] of Object.entries(body)) {
    if ((stand as Record<string, unknown>)[feld] !== wert) aenderung[feld] = wert;
  }
  return aenderung;
}

/** Verweise eines Typs in Worten: „3 Geräte, 1 Kabelvorlagen-Zuordnung“. */
export function verwendungText(typ: Pick<Geraetetyp, "device_count" | "template_count">): string {
  const teile: string[] = [];
  if (typ.device_count > 0) teile.push(`${typ.device_count} ${typ.device_count === 1 ? "Gerät" : "Geräte"}`);
  if (typ.template_count > 0) teile.push(`${typ.template_count} Kabelvorlagen-${typ.template_count === 1 ? "Zuordnung" : "Zuordnungen"}`);
  return teile.length === 0 ? "nicht verwendet" : teile.join(", ");
}

const SERVERFELD: Record<string, Typfeld> = {
  label: "name",
  description: "beschreibung",
  category: "kategorie",
  symbol_key: "symbol",
  allows_wall_interior: "flaechen",
  allows_wall_exterior: "flaechen",
  allows_ceiling: "flaechen",
  default_center_height_mm: "hoehe",
  width_mm: "breite",
  height_mm: "tiefe",
  sort_order: "reihenfolge",
};

const CODE_TEXT: Record<string, string> = {
  "device-type-label-missing": "Bitte einen Namen angeben.",
  "device-type-label-taken": "Einen aktiven eigenen Typ mit diesem Namen gibt es bereits.",
  "device-type-category-not-allowed": "Diese Kategorie ist für eigene Typen nicht vorgesehen.",
  "device-type-symbol-unknown": "Dieses Symbol steht nicht zur Auswahl.",
  "device-type-surface-missing": "Bitte mindestens eine Montagefläche wählen.",
  "device-type-size-invalid": "Bitte in geraden Millimetern.",
  "device-type-in-use": "Gesperrt, solange der Typ verwendet wird.",
  "device-type-surface-in-use": "Auf dieser Fläche sitzen Geräte dieses Typs – sie bleibt erhalten.",
};

const ART_TEXT: Record<string, string> = {
  "version-conflict": "Dieser Typ wurde inzwischen an anderer Stelle geändert. Ihre Eingaben sind erhalten und wurden nicht gespeichert.",
  "not-found": "Diesen Gerätetyp gibt es nicht (mehr). Bitte neu laden.",
};

/** Meldungen zu Konflikten – vor der (technisch formulierten) Servermeldung. */
const KONFLIKT_TEXT: Record<string, string> = {
  "device-type-in-use":
    "Dieser Typ wird verwendet: Kategorie und Planungsmaß bleiben, damit vorhandene Geräte nicht still ihre Bedeutung oder ihr Maß ändern. Für eine Variante „Als neuen Typ anlegen“. Es wurde nichts geändert.",
  "device-type-surface-in-use": "Auf einer abgewählten Montagefläche sitzen Geräte dieses Typs – die Fläche bleibt erhalten. Es wurde nichts geändert.",
  "device-type-system": "Systemtypen werden mit ElektroPlan ausgeliefert und lassen sich nicht ändern. Für eine Variante „Als neuen Typ anlegen“.",
  "device-type-label-taken": "Einen aktiven eigenen Typ mit diesem Namen gibt es bereits.",
};

/** Feldfehler aus einer Serverantwort (RFC 9457 `errors`). */
export function typFeldfehler(error: unknown): Typfehler {
  const f: Typfehler = {};
  if (!(error instanceof ApiError)) return f;
  for (const e of error.problem?.errors ?? []) {
    const feld = SERVERFELD[e.field];
    if (feld !== undefined && f[feld] === undefined) f[feld] = CODE_TEXT[e.code] ?? e.message;
  }
  return f;
}

/** Gesamtmeldung zu einem Fehler beim Speichern, Umschalten oder Entfernen. */
export function typFehlerText(error: unknown, rueckfall: string): string {
  if (!(error instanceof ApiError)) return "Der Server ist nicht erreichbar. Ihre Eingaben sind erhalten.";
  const art = ART_TEXT[error.errorType];
  if (art !== undefined) return art;
  for (const e of error.problem?.errors ?? []) {
    const text = KONFLIKT_TEXT[e.code];
    if (text !== undefined) return text;
  }
  if (error.status === 422) return "Die Angaben sind so nicht zulässig – bitte die markierten Felder prüfen.";
  return rueckfall;
}
