import { useId } from "react";

import { useMasse } from "../../../core/ui/masseinheit";
import { FELD_FEHLER, FORMULARRASTER_BLOCK, FORMULARRASTER_LEGENDE, eingabefeld } from "../../../core/ui/stil";
import type { Geraetetyp } from "../geraete/katalog";
import { istEigenerTyp } from "../geraete/katalog";
import type { Betriebsstandard, Endpunktart, Kabelvorlage, WirksameVorgaben } from "./daten";
import { ENDPUNKTART_TEXT, herkunftText, prozentAnzeigen, vorlageText } from "./daten";
import type { Feldname, Formularfehler, Vorgabenformular } from "./formular";
import { feldSetzen, typSetzen } from "./formular";

export type Vorgabenmodus = "betrieb" | "projekt";

const FELD_TEXT: Record<Feldname, string> = {
  reserve: "Reserve in % der geometrischen Länge",
  board: `Anschlusszugabe ${ENDPUNKTART_TEXT.board}`,
  junction: `Anschlusszugabe ${ENDPUNKTART_TEXT.junction}`,
  device: `Anschlusszugabe ${ENDPUNKTART_TEXT.device}`,
};
const ENDPUNKT: Record<Exclude<Feldname, "reserve">, Endpunktart> = { board: "board", junction: "junction", device: "device" };

/**
 * Felder des Betriebsstandards bzw. der Projektvorgabe (Phase 6c, Entwurf §8.1, §8.2).
 *
 * Je Feld eine ausdrückliche Wahl: **nicht gesetzt** (Betrieb) bzw. **Betriebsstandard
 * übernehmen** (Projekt) – oder ein eigener Wert, auch 0. In der Projektvorgabe stehen der
 * geerbte Wert und – zur Kontrolle – der wirksame Wert mit seiner Herkunft daneben.
 * Keine Vorgabe ist vorbelegt; ElektroPlan schlägt keine Werte vor.
 */
export function VorgabenFelder({
  modus,
  form,
  onForm,
  fehler,
  gesperrt,
  vorlagen,
  typen,
  betrieb,
  wirksam,
}: {
  modus: Vorgabenmodus;
  form: Vorgabenformular;
  onForm: (form: Vorgabenformular) => void;
  fehler: Formularfehler;
  gesperrt: boolean;
  vorlagen: readonly Kabelvorlage[];
  /** Zuordenbare Gerätetypen (Steckdose, Schalter, Leuchte, Abzweigdose, Geräteanschluss) – auch eigene (K2); deaktivierte nur mit Zuordnung. */
  typen: readonly Geraetetyp[];
  /** Betriebsstandard - für „Betriebsstandard übernehmen“ in der Projektvorgabe. */
  betrieb?: Betriebsstandard | undefined;
  /** Wirksame Werte des Projekts mit Herkunft (gespeicherter Stand). */
  wirksam?: WirksameVorgaben | undefined;
}) {
  const masse = useMasse();
  const id = useId();
  const erben = modus === "betrieb" ? "nicht gesetzt" : "Betriebsstandard übernehmen";
  const eigen = modus === "betrieb" ? "Wert" : "abweichender Projektwert";

  const geerbt = (feld: Feldname): string | null => {
    if (modus !== "projekt" || betrieb === undefined) return null;
    if (feld === "reserve") return betrieb.reserve_percent === null ? "nicht gesetzt" : prozentAnzeigen(betrieb.reserve_percent);
    const mm = betrieb[`${feld}_allowance_mm`];
    return mm === null ? "nicht gesetzt" : masse.anzeigen(mm);
  };
  const wirksamText = (feld: Feldname): string | null => {
    if (wirksam === undefined) return null;
    if (feld === "reserve") return `${prozentAnzeigen(wirksam.reserve.percent)} (${herkunftText(wirksam.reserve.origin)})`;
    const z = wirksam.allowances.find((a) => a.endpoint_kind === ENDPUNKT[feld]);
    return z === undefined ? null : `${masse.anzeigen(z.value_mm)} (${herkunftText(z.origin)})`;
  };
  const aktiveOderGewaehlt = (gewaehlt: string | null) => vorlagen.filter((v) => v.is_active || v.id === gewaehlt);
  const vorlageName = (vid: string | null | undefined) => {
    const v = vorlagen.find((x) => x.id === vid);
    return v === undefined ? "keine" : `${vorlageText(v)}${v.is_active ? "" : " (deaktiviert)"}`;
  };

  const feld = (f: Feldname) => {
    const wert = form.felder[f];
    const name = `${id}-${f}`;
    const einheit = f === "reserve" ? "%" : masse.einheit;
    const g = geerbt(f);
    const w = wirksamText(f);
    return (
      <fieldset key={f} className="m-0 flex flex-col gap-1 border-0 p-0" data-testid={`vorgabe-${f}`}>
        <legend className="mb-1 p-0 text-small font-semibold">{FELD_TEXT[f]}</legend>
        <label className="flex items-center gap-2 text-small">
          <input type="radio" name={name} checked={!wert.eigen} disabled={gesperrt} onChange={() => onForm(feldSetzen(form, f, { eigen: false }))} />
          {erben}
          {g !== null && <span className="text-muted">({g})</span>}
        </label>
        <label className="flex flex-wrap items-center gap-2 text-small">
          <input type="radio" name={name} checked={wert.eigen} disabled={gesperrt} onChange={() => onForm(feldSetzen(form, f, { eigen: true }))} />
          {eigen}
          <input
            className={`${eingabefeld({ kompakt: true, fehler: fehler[f] !== undefined })} w-28`}
            aria-label={`${FELD_TEXT[f]} (${einheit})`}
            inputMode="decimal"
            value={wert.text}
            disabled={gesperrt}
            onFocus={() => !wert.eigen && onForm(feldSetzen(form, f, { eigen: true }))}
            onChange={(event) => onForm(feldSetzen(form, f, { eigen: true, text: event.target.value }))}
          />
          <span className="text-muted">{einheit}</span>
        </label>
        {fehler[f] !== undefined && (
          <span className={FELD_FEHLER} role="alert">
            {fehler[f]}
          </span>
        )}
        {w !== null && <span className="text-label text-muted">Wirksam im Projekt: {w}</span>}
      </fieldset>
    );
  };

  const vorlagenwahl = (label: string, wert: string | null, setzen: (v: string | null) => void, testId: string, geerbtText: string | null) => (
    <label className="flex flex-col gap-1 text-small" data-testid={testId}>
      <span className="text-label text-muted">{label}</span>
      <select className={eingabefeld({ kompakt: true })} value={wert ?? ""} disabled={gesperrt} onChange={(event) => setzen(event.target.value === "" ? null : event.target.value)}>
        <option value="">{modus === "betrieb" ? "– keine –" : `Betriebsstandard übernehmen${geerbtText === null ? "" : ` (${geerbtText})`}`}</option>
        {aktiveOderGewaehlt(wert).map((v) => (
          <option key={v.id} value={v.id}>
            {vorlageText(v)}
            {v.is_active ? "" : " (deaktiviert)"}
          </option>
        ))}
      </select>
    </label>
  );

  const betriebTyp = (key: string) => betrieb?.device_type_templates.find((t) => t.device_type_key === key)?.cable_template_id;

  return (
    <div className="flex flex-col gap-3">
      <fieldset className={FORMULARRASTER_BLOCK}>
        <legend className={FORMULARRASTER_LEGENDE}>Reserve und Anschlusszugaben</legend>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">{(["reserve", "board", "junction", "device"] as const).map(feld)}</div>
        <p className="m-0 mt-2 text-label text-muted">
          Die Reserve zählt auf den geometrischen Weg einer vollständig geplanten Leitung, aufgerundet auf ganze Millimeter. Die
          Anschlusszugaben gelten je nach Art des Start- und Endgeräts. 0 ist ein ausdrücklicher Wert.
        </p>
      </fieldset>
      <fieldset className={FORMULARRASTER_BLOCK}>
        <legend className={FORMULARRASTER_LEGENDE}>Kabelvorlagen für neue Leitungen</legend>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
          {vorlagenwahl(
            "Standardvorlage (wenn der Gerätetyp keine eigene hat)",
            form.standardvorlage,
            (v) => onForm({ ...form, standardvorlage: v }),
            "vorgabe-standardvorlage",
            modus === "projekt" ? vorlageName(betrieb?.default_cable_template_id) : null,
          )}
          {typen.map((t) =>
            vorlagenwahl(
              `Gerätetyp ${t.label}${istEigenerTyp(t) ? " (eigen)" : ""}${t.is_active ? "" : " (deaktiviert)"}`,
              form.typen[t.key] ?? null,
              (v) => onForm(typSetzen(form, t.key, v)),
              `vorgabe-typ-${t.key}`,
              modus === "projekt" ? vorlageName(betriebTyp(t.key)) : null,
            ),
          )}
        </div>
        {fehler.standardvorlage !== undefined && (
          <span className={FELD_FEHLER} role="alert">
            {fehler.standardvorlage}
          </span>
        )}
        <p className="m-0 mt-2 text-label text-muted">
          Maßgeblich ist das Zielgerät einer Leitung, eine Verteilung nie. Deaktivierte Vorlagen werden nicht vorgeschlagen.
          Bestehende Leitungen ändern sich durch Vorgaben nicht.
        </p>
      </fieldset>
    </div>
  );
}
