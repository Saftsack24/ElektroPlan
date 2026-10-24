import { useState } from "react";

import { Marke } from "../../../core/ui/Marke";
import { useMasse } from "../../../core/ui/masseinheit";
import { FELD, FELD_BESCHRIFTUNG, KNOPFZEILE, eingabefeld, knopf, meldungsflaeche } from "../../../core/ui/stil";
import { SEHR_BREIT, useMedium } from "../arbeitsflaeche/kompakt";
import { MassFeld } from "../wandansicht/WandEigenschaften";
import { wegpunktEinfuegen } from "./entwurf";
import type { Wandhoehe } from "./grundriss";
import type { Steigwahl } from "./Grundrissleitungen";
import type { Leitungskontext } from "./kontext";
import { leitungsbefundText } from "./laenge";
import type { Grundrisseinstellung } from "./LeitungsplanungProvider";

/** Übliche Höhen für grobe Wandpunkte (auch die Wahl im Zeichenablauf, 6c L2) (Planungshilfe wie die Zonenhilfslinien); genaue Lage in der Wandansicht. */
export const WANDHOEHEN: readonly { wert: Wandhoehe; text: string; kurz: string }[] = [
  { wert: 0, text: "Fußboden (Übergang)", kurz: "Fußboden" },
  { wert: 300, text: "untere Zone", kurz: "unten" },
  { wert: 1100, text: "mittlere Zone", kurz: "Mitte" },
  { wert: "obere-zone", text: "obere Zone – 30 cm unter der Decke", kurz: "obere Zone" },
  { wert: "decke", text: "Raumhöhe – Decke (Übergang)", kurz: "Decke" },
];

/**
 * Zusatzwerkzeug im Grundriss (Phase 6b.5, seit 6c L2 schlank, nach §21.5 ohne Dauertexte): „Durchführung
 * hier“ (U) mit der Höhe der neuen Durchführung - als Teil der Zeichenleiste. Welcher Punkt entsteht,
 * ergibt sich aus dem Klickziel; die Erklärung steht in der Hilfe ({@link GrundrissLeitungshilfe}).
 */
export function GrundrissLeitungsleiste({ k, einstellung }: { k: Leitungskontext; einstellung: Grundrisseinstellung }) {
  const masse = useMasse();
  const sehrBreit = useMedium(SEHR_BREIT);
  const p = k.planung;
  const darf = p.darfLeitungen && p.entwurf !== null && p.entwurf.status !== "speichert";
  if (p.entwurf === null) return null;
  const aktiv = einstellung.werkzeug === "durchfuehrung";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" role="group" aria-label="Leitung im Grundriss">
      <button
        type="button"
        className={knopf(aktiv ? "primaer" : "neutral", { klein: true })}
        aria-pressed={aktiv}
        disabled={!darf}
        title="Neue Durchführung an einer gemeinsamen Bauwand (U) – Klick auf die Bauwand legt sie an; sie entsteht erst beim Speichern der Leitung"
        onClick={() => einstellung.setWerkzeug(aktiv ? "aus" : "durchfuehrung")}
        aria-label="Durchführung hier"
      >
        {sehrBreit ? "Durchführung hier" : "Durchführung"}
      </button>
      {aktiv && (
        <select
          className={eingabefeld({ kompakt: true })}
          aria-label="Höhe der Durchführung"
          value={String(einstellung.wandhoehe)}
          onChange={(event) => {
            const w = event.target.value;
            einstellung.setWandhoehe(w === "decke" || w === "obere-zone" ? w : Number(w));
          }}
        >
          {WANDHOEHEN.map((h) => (
            <option key={h.text} value={String(h.wert)}>
              {typeof h.wert === "number" ? `${masse.anzeigen(h.wert)} – ${h.text}` : h.text}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}

/** Punkte der Zeichenhilfe im Grundriss - Klickziel, Durchführung und Steighalte dieses Geschosses. */
export function GrundrissLeitungshilfe({ k, floorId }: { k: Leitungskontext; floorId: string }) {
  // Steighalte dieses Geschosses als Text - im Plan stehen sie bei kleinem Maßstab nur als Quadrat.
  const halte = k.planung.steigwege.filter((s) => s.stops.some((h) => h.floor_id === floorId)).map((s) => s.name);
  return (
    <>
      <li>Im Grundriss bestimmt das Klickziel den Punkt: Wandlinie = Wandpunkt in der gewählten Höhe („Wand:“), im Raum = Fußboden- oder Deckenpunkt, Tür oder Durchgang = Bodenübergang. Übergänge zwischen Wand und Raumfläche liegen auf der Wandachse und werden mitgesetzt.</li>
      <li>„Durchführung hier“ (U): Klick auf eine gemeinsame Bauwand legt dort eine neue Durchführung an – sie entsteht erst beim Speichern der Leitung.</li>
      <li data-testid="grundriss-steighalte">
        {halte.length > 0
          ? `Steighalte auf diesem Geschoss (Quadrat im Plan): ${halte.join(", ")} – Klick auf einen Halt nutzt den Steigweg.`
          : "Auf diesem Geschoss gibt es keinen Steighalt."}
      </li>
    </>
  );
}

/**
 * Steigweg nutzen (Entwurf §5.3): Zielhalt und Ausstieg wählen, Verlauf und
 * Status vorschauen, ausdrücklich übernehmen, dann ins Zielgeschoss wechseln.
 * Unbestätigte oder widersprüchliche Geschosshöhen werden wie im Server
 * gemeldet - nie still als Länge gezählt.
 */
/** Legende der Leitungsdarstellung im Grundriss – in der Hilfe (L1) statt dauerhaft in der Kontextleiste. */
export function GrundrissLegende() {
  return (
    <section aria-label="Legende der Leitungen" className="mt-2 text-[0.85rem] text-muted">
      <h3 className="m-0 text-small text-fg">Legende und Modellgrenzen der Leitungen</h3>
        <svg width="210" height="54" aria-hidden="true" className="mt-1 block">
        <line x1="4" y1="9" x2="60" y2="9" className="leitung-plan leitung-plan--wand" />
        <text x="68" y="13" className="leitung-plan-text">Wand (an der Raumseite)</text>
        <line x1="4" y1="27" x2="60" y2="27" className="leitung-plan leitung-plan--decke" />
        <text x="68" y="31" className="leitung-plan-text">Decke</text>
        <line x1="4" y1="45" x2="60" y2="45" className="leitung-plan leitung-plan--fussboden" />
        <text x="68" y="49" className="leitung-plan-text">Fußboden</text>
      </svg>
      <p className="m-0">
        Farbe und Text nennen den Status (bestätigt, unvollständig, Konflikt). Fußbodenwege liegen modellhaft auf Höhe des
        Fertigfußbodens. Aufbau, Estrichdicke, Leerrohre und tatsächliche Lage unter dem Belag sind nicht abgebildet; der Übergang
        in den Nachbarraum ist nur an einer Tür, einem Durchgang oder einer Durchführung geplant – keine Aussage über
        Ausführbarkeit. Keine Wegfindung: Jeder Punkt wird ausdrücklich gesetzt.
      </p>
    </section>
  );
}

export function Steigwegwahl({
  k,
  wahl,
  onSchliessen,
  onGeschossWechseln,
}: {
  k: Leitungskontext;
  wahl: Steigwahl;
  onSchliessen: () => void;
  onGeschossWechseln?: ((floorId: string) => void) | undefined;
}) {
  const p = k.planung;
  const masse = useMasse();
  const steigweg = p.steigwege.find((s) => s.id === wahl.steigwegId);
  const ebene = (floorId: string) => p.geschosse.find((g) => g.id === floorId)?.level ?? 0;
  const ziele = (steigweg?.stops ?? []).filter((h) => h.id !== wahl.haltId);
  const eigener = steigweg?.stops.find((h) => h.id === wahl.haltId);
  const vorgabe = [...ziele].sort((a, b) => Math.abs(ebene(a.floor_id) - ebene(eigener?.floor_id ?? "")) - Math.abs(ebene(b.floor_id) - ebene(eigener?.floor_id ?? "")))[0];
  const [zielId, setZielId] = useState(vorgabe?.id ?? "");
  const [ausstiegMm, setAusstiegMm] = useState(0);
  const [uebernommen, setUebernommen] = useState<string | null>(null);
  const e = p.entwurf;
  const ziel = ziele.find((h) => h.id === zielId);
  if (steigweg === undefined || eigener === undefined || e === null) return null;

  const werte =
    ziel === undefined
      ? null
      : wegpunktEinfuegen(
          e.werte,
          { art: "steigweg", steigwegId: steigweg.id, vonHalt: wahl.haltId, vonHoeheMm: wahl.einstiegMm, nachHalt: ziel.id, nachHoeheMm: ausstiegMm },
          wahl.index - 1 < 0 ? null : wahl.index - 1,
        ).werte;
  const geprueft = werte === null ? null : p.pruefen(werte, wahl.index);
  const ort = `w${wahl.index}`;
  const strecken = geprueft?.ergebnis.strecken.filter((s) => s.ort === ort && (s.art === "riser" || s.art === "shaft")) ?? [];
  const fehlend = geprueft?.ergebnis.befunde.filter((b) => b.ort === ort && b.art === "missing") ?? [];
  const darf = p.darfLeitungen && e.status !== "speichert";

  const uebernehmen = () => {
    if (werte === null || geprueft === null || !geprueft.ok || ziel === undefined) return;
    p.dispatch({ typ: "aendern", werte, auswahl: wahl.index });
    setUebernommen(ziel.floor_id);
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-ep border border-line p-2 text-small" role="group" aria-label="Steigweg nutzen">
      <div className="flex items-center justify-between gap-2">
        <strong>Steigweg „{steigweg.name}“ nutzen</strong>
        <button type="button" className={knopf("einfach", { klein: true })} onClick={onSchliessen}>
          Schließen
        </button>
      </div>
      <p className="m-0">
        Einstieg: {p.geschossName(eigener.floor_id)} · {masse.anzeigen(wahl.einstiegMm)} über dem Fußboden (aus dem Wegpunkt davor)
      </p>
      {uebernommen === null ? (
        <>
          <label className={FELD}>
            <span className={FELD_BESCHRIFTUNG}>Zielhalt</span>
            <select className={eingabefeld({ kompakt: true })} value={zielId} disabled={!darf} onChange={(event) => setZielId(event.target.value)}>
              {ziele.map((h) => (
                <option key={h.id} value={h.id}>
                  {p.geschossName(h.floor_id)}
                </option>
              ))}
            </select>
          </label>
          <MassFeld
            id="steigweg-ausstieg"
            label="Ausstieg über dem Fußboden"
            wertMm={ausstiegMm}
            gesperrt={!darf}
            hinweis="0 = Fußboden am Halt. Darüber: Schachtfortsetzung bis zu einem Punkt genau über dem Halt."
            onUebernehmen={(mm) => {
              if (!Number.isInteger(mm) || mm < 0 || mm > 20000) return "Bitte eine Höhe zwischen 0 und 20 m angeben.";
              setAusstiegMm(mm);
              return undefined;
            }}
          />
          <div role="status" aria-label="Vorschau Steigweg" data-testid="steigweg-vorschau">
            {strecken.map((s, i) => (
              <p key={i} className="m-0">
                {s.art === "riser"
                  ? `Steigweg: ${s.laengeMm === null ? `Teilsumme ${masse.anzeigen(s.bekanntMm)} – senkrechte Länge unbekannt` : masse.anzeigen(s.laengeMm)}`
                  : `Schachtfortsetzung: ${masse.anzeigen(s.bekanntMm)}`}
              </p>
            ))}
            {fehlend.map((b, i) => (
              <p key={`f-${i}`} className="m-0">
                <Marke art="warnung">unvollständig</Marke> {leitungsbefundText(b.code)}
              </p>
            ))}
            {geprueft !== null && !geprueft.ok && (
              <p className="m-0 text-danger">
                <Marke art="gefahr">nicht möglich</Marke> {geprueft.grund}
              </p>
            )}
            {geprueft !== null && geprueft.ok && fehlend.length === 0 && <Marke art="erfolg">Verlauf gültig</Marke>}
          </div>
          <div className={KNOPFZEILE}>
            <button type="button" className={knopf("primaer", { klein: true })} disabled={!darf || geprueft === null || !geprueft.ok} onClick={uebernehmen}>
              Steigweg übernehmen
            </button>
          </div>
        </>
      ) : (
        <>
          <p className={`${meldungsflaeche("schlicht")} m-0`} role="status">
            Steigweg übernommen – noch nicht gespeichert. Fortgesetzt wird im Geschoss „{p.geschossName(uebernommen)}“ am Halt des Steigwegs.
          </p>
          {onGeschossWechseln !== undefined && (
            <button type="button" className={knopf("primaer", { klein: true })} onClick={() => onGeschossWechseln(uebernommen)}>
              Weiter in „{p.geschossName(uebernommen)}“
            </button>
          )}
        </>
      )}
    </div>
  );
}
