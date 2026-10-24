import type { components } from "@elektroplan/api-client";

import type { Masse } from "../../../core/ui/masseinheit";
import type { Betriebsstandard, Projektvorgabe } from "./daten";
import { prozentAlsEingabe, prozentLesen } from "./daten";

/**
 * Formular für Betriebsstandard und Projektvorgabe (Phase 6c, Entwurf §8.1/§8.2) - rein.
 *
 * Jedes Feld ist entweder **eigen** (ein ausdrücklicher Wert, auch 0) oder nicht: im
 * Betriebsstandard heißt das „nicht gesetzt“, in der Projektvorgabe „Betriebsstandard
 * übernehmen“. 0 % und 0 mm sind gültige ausdrückliche Werte und werden nie mit „nicht
 * gesetzt“ verwechselt (`NULL` gegen `0`, ADR 0027).
 */
export type Feldname = "reserve" | "board" | "junction" | "device";
export const FELDER: readonly Feldname[] = ["reserve", "board", "junction", "device"];
export const ZUGABEFELDER = { board: "board_allowance_mm", junction: "junction_allowance_mm", device: "device_allowance_mm" } as const;

export interface Feldwert {
  readonly eigen: boolean;
  /** Eingabetext (Prozent bzw. Länge in der persönlichen Einheit). */
  readonly text: string;
}

export interface Vorgabenformular {
  readonly felder: Readonly<Record<Feldname, Feldwert>>;
  /** Standardvorlage; `null` = nicht gesetzt bzw. Betriebsstandard übernehmen. */
  readonly standardvorlage: string | null;
  /** Vorlage je Gerätetyp; fehlender Schlüssel = keine bzw. Betriebsstandard übernehmen. */
  readonly typen: Readonly<Record<string, string>>;
}

export type Formularfehler = Partial<Record<Feldname | "standardvorlage", string>>;

type Stand = Pick<
  Betriebsstandard | Projektvorgabe,
  "reserve_percent" | "board_allowance_mm" | "junction_allowance_mm" | "device_allowance_mm" | "default_cable_template_id" | "device_type_templates"
>;

export function formularAus(stand: Stand, masse: Pick<Masse, "alsEingabeOptional">): Vorgabenformular {
  const mm = (wert: number | null): Feldwert => ({ eigen: wert !== null, text: masse.alsEingabeOptional(wert) });
  return {
    felder: {
      reserve: { eigen: stand.reserve_percent !== null, text: prozentAlsEingabe(stand.reserve_percent) },
      board: mm(stand.board_allowance_mm),
      junction: mm(stand.junction_allowance_mm),
      device: mm(stand.device_allowance_mm),
    },
    standardvorlage: stand.default_cable_template_id,
    typen: Object.fromEntries(stand.device_type_templates.map((t) => [t.device_type_key, t.cable_template_id])),
  };
}

export type Vorgabenanfrage = components["schemas"]["PlanningDefaultsIn"];

/** Anfragekörper (`PUT`, ersetzt alle Felder) - oder Feldfehler. */
export function anfrageAus(
  form: Vorgabenformular,
  version: number,
  masse: Pick<Masse, "lesen">,
): { ok: true; anfrage: Vorgabenanfrage } | { ok: false; fehler: Formularfehler } {
  const fehler: Formularfehler = {};
  const leer = "Bitte einen Wert angeben – 0 ist ein gültiger Wert.";
  let reserve: string | null = null;
  if (form.felder.reserve.eigen) {
    const p = prozentLesen(form.felder.reserve.text);
    if (!p.ok) fehler.reserve = p.fehler;
    else if (p.wert === null) fehler.reserve = leer;
    else reserve = p.wert;
  }
  const zugabe = (feld: Exclude<Feldname, "reserve">): number | null => {
    const f = form.felder[feld];
    if (!f.eigen) return null;
    if (f.text.trim() === "") {
      fehler[feld] = leer;
      return null;
    }
    const m = masse.lesen(f.text);
    if (!m.ok) {
      fehler[feld] = m.fehler;
      return null;
    }
    if (!Number.isInteger(m.mm) || m.mm < 0 || m.mm > 20_000) {
      fehler[feld] = "Zugaben liegen zwischen 0 und 20 m.";
      return null;
    }
    return m.mm;
  };
  const board = zugabe("board");
  const junction = zugabe("junction");
  const device = zugabe("device");
  if (Object.keys(fehler).length > 0) return { ok: false, fehler };
  return {
    ok: true,
    anfrage: {
      expected_version: version,
      reserve_percent: reserve,
      board_allowance_mm: board,
      junction_allowance_mm: junction,
      device_allowance_mm: device,
      default_cable_template_id: form.standardvorlage,
      device_type_templates: Object.entries(form.typen)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([device_type_key, cable_template_id]) => ({ device_type_key, cable_template_id })),
    },
  };
}

export function feldSetzen(form: Vorgabenformular, feld: Feldname, wert: Partial<Feldwert>): Vorgabenformular {
  return { ...form, felder: { ...form.felder, [feld]: { ...form.felder[feld], ...wert } } };
}

export function typSetzen(form: Vorgabenformular, typ: string, vorlage: string | null): Vorgabenformular {
  const typen = { ...form.typen };
  if (vorlage === null) delete typen[typ];
  else typen[typ] = vorlage;
  return { ...form, typen };
}

/** Feldnamen des Servers (`errors[].field`) → Formularfeld. */
export function serverFeld(feld: string): Feldname | "standardvorlage" | null {
  if (feld === "reserve_percent") return "reserve";
  if (feld === "board_allowance_mm") return "board";
  if (feld === "junction_allowance_mm") return "junction";
  if (feld === "device_allowance_mm") return "device";
  if (feld === "default_cable_template_id") return "standardvorlage";
  return null;
}
