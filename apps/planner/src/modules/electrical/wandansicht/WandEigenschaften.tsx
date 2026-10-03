import { useState } from "react";
import type { KeyboardEvent } from "react";

import { eingabeUmrechnen } from "../../../core/masse";
import { useEinheitenwechsel, useMasse } from "../../../core/ui/masseinheit";
import { FELD, FELD_BESCHRIFTUNG, FELD_FEHLER, FELD_HINWEIS, eingabefeld, knopf, meldungsflaeche } from "../../../core/ui/stil";
import type { Oeffnungsart } from "../editor/entwurf";
import type { EditorEinordnung } from "../editor/platzierung";
import { verbindungsText } from "../editor/platzierung";
import { OEFFNUNGSARTEN, OEFFNUNGSART_LABEL } from "../texte";
import type { Ansichtsrechteck, Wandbezug } from "./wandbezug";
import type { AnsichtsOeffnung, Wandmodell } from "./wandmodell";
import { befundText } from "./wandmodell";

const LISTENKNOPF = `${knopf()} w-full text-left`;
const LISTENKNOPF_GEWAEHLT = `${knopf("gewaehlt")} w-full text-left`;

/**
 * Ein Maß, das beim Bestätigen (Enter oder Verlassen des Felds) übernommen
 * wird - genau so, wie eingegeben: kein Fang, kein Raster, keine Rundung.
 * Ein unzulässiger Wert ändert nichts und nennt den Grund am Feld.
 */
function MassFeld({
  id,
  label,
  wertMm,
  gesperrt,
  hinweis,
  onUebernehmen,
}: {
  id: string;
  label: string;
  wertMm: number;
  gesperrt: boolean;
  hinweis?: string;
  onUebernehmen: (mm: number) => string | undefined;
}) {
  const masse = useMasse();
  const [text, setText] = useState(() => masse.alsEingabe(wertMm));
  const [stand, setStand] = useState(wertMm);
  const [fehler, setFehler] = useState<string | null>(null);
  // Neuer Wert von außen (Ziehen, Rückgängig): Feld nachziehen.
  if (stand !== wertMm) {
    setStand(wertMm);
    setText(masse.alsEingabe(wertMm));
    setFehler(null);
  }
  useEinheitenwechsel((von, nach) => setText((alt) => eingabeUmrechnen(alt, von, nach)));

  const uebernehmen = () => {
    if (text === masse.alsEingabe(wertMm)) return;
    const gelesen = masse.lesen(text);
    if (!gelesen.ok) {
      setFehler(gelesen.fehler);
      return;
    }
    const grund = onUebernehmen(gelesen.mm);
    setFehler(grund ?? null);
  };

  return (
    <label className={FELD} htmlFor={id}>
      <span className={FELD_BESCHRIFTUNG}>{masse.label(label)}</span>
      <input
        id={id}
        className={eingabefeld({ fehler: fehler !== null })}
        inputMode="decimal"
        value={text}
        disabled={gesperrt}
        aria-invalid={fehler !== null}
        onChange={(event) => setText(event.target.value)}
        onBlur={uebernehmen}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") {
            event.preventDefault();
            uebernehmen();
          }
        }}
      />
      {hinweis !== undefined && <span className={FELD_HINWEIS}>{hinweis}</span>}
      {fehler !== null && (
        <span className={FELD_FEHLER} role="alert">
          {fehler}
        </span>
      )}
    </label>
  );
}

export interface Gegenseite {
  readonly raumId: string;
  readonly wandId: string;
}

export function WandEigenschaften({
  bezug,
  modell,
  raumName,
  editierbar,
  gewaehlt,
  onWaehlen,
  onRechteck,
  onArt,
  onEntfernen,
  einordnung,
  nachbarHoehe,
  gegenseiten,
  onGegenseite,
  onQuelle,
}: {
  bezug: Wandbezug;
  modell: Wandmodell;
  raumName: (raumId: string) => string;
  editierbar: boolean;
  gewaehlt: string | null;
  onWaehlen: (id: string | null) => void;
  /** Exakte Werte übernehmen - `undefined` bei Erfolg, sonst der Grund. */
  onRechteck: (id: string, rechteck: Ansichtsrechteck) => string | undefined;
  onArt: (id: string, art: Oeffnungsart) => string | undefined;
  onEntfernen: (id: string) => void;
  einordnung: EditorEinordnung;
  nachbarHoehe: (raumId: string) => number | null;
  gegenseiten: readonly Gegenseite[];
  onGegenseite: (ziel: Gegenseite) => void;
  onQuelle: (o: AnsichtsOeffnung) => void;
}) {
  const masse = useMasse();
  const L = bezug.laengeMm;
  const H = bezug.hoeheMm;
  const o = modell.oeffnungen.find((x) => x.id === gewaehlt);
  const nummer = (id: string) => modell.oeffnungen.findIndex((x) => x.id === id) + 1;
  const gesperrt = !editierbar || o === undefined || !o.eigen;
  const fehlerhaft = modell.oeffnungen.filter((x) => x.befunde.length > 0);

  return (
    <div className="flex flex-col gap-2 text-small [&_:is(h3,h4)]:my-1">
      <section aria-label="Wand">
        <h3>
          Wand {bezug.wandNummer} von „{raumName(bezug.raumId)}“
        </h3>
        <p className="m-0">
          {masse.anzeigen(L)} breit · Raumhöhe {masse.anzeigen(H)} · Stärke {masse.anzeigen(bezug.staerkeMm)}
        </p>
        <p className="m-0 text-muted">
          {bezug.seite === "innen" ? `Blick aus Raum „${raumName(bezug.raumId)}“ auf die Wand` : "Blick von außen auf die Wand"} – im
          Grundriss {bezug.blick}. Links schließt
          {bezug.nachbarLinks !== null ? ` Wand ${bezug.nachbarLinks}` : " nichts"} an, rechts
          {bezug.nachbarRechts !== null ? ` Wand ${bezug.nachbarRechts}` : " nichts"}.
        </p>
        <ul className="my-1 pl-[18px]" aria-label="Angrenzende Räume">
          {modell.abschnitte.map((a, i) => {
            const bereich = `${masse.anzeigen(Math.round(a.links))} bis ${masse.anzeigen(Math.round(a.rechts))} von links`;
            if (a.mehrdeutig) return <li key={i}>{bereich}: mehr als zwei Räume – Zuordnung nicht eindeutig</li>;
            if (a.nachbarn.length === 0) return <li key={i}>{bereich}: nicht geteilt (Außenwand)</li>;
            return (
              <li key={i}>
                {bereich}: grenzt an{" "}
                {a.nachbarn.map((n) => {
                  const h = nachbarHoehe(n);
                  return `„${raumName(n)}“${h !== null && h !== H ? ` (Decke ${masse.anzeigen(h)} – abweichend)` : ""}`;
                }).join(", ")}
              </li>
            );
          })}
        </ul>
        {gegenseiten.map((g) => (
          <button key={`${g.raumId}-${g.wandId}`} type="button" className={`${knopf()} mt-1 w-full`} onClick={() => onGegenseite(g)}>
            Gegenseite aus „{raumName(g.raumId)}“ ansehen
          </button>
        ))}
      </section>

      {fehlerhaft.length > 0 && (
        <div className={meldungsflaeche("schlicht")} role="status">
          <p className="m-0 font-semibold">Hinweis: Nicht alle Öffnungen sind gültig</p>
          <ul className="my-1 pl-[18px]">
            {fehlerhaft.map((x) => (
              <li key={x.id}>
                {OEFFNUNGSART_LABEL[x.art]} {nummer(x.id)}: {x.befunde.map(befundText).join(", ")}
              </li>
            ))}
          </ul>
          <p className="m-0 text-muted">Nichts wird automatisch verschoben oder gelöscht – bitte die Öffnung anpassen.</p>
        </div>
      )}

      <section aria-label="Öffnungen dieser Wand" className="border-t border-line pt-2">
        <h4>Türen, Fenster, Durchgänge</h4>
        {modell.oeffnungen.length === 0 ? (
          <p className="text-muted">Keine Öffnung in dieser Wand.{editierbar ? " Werkzeug Tür, Fenster oder Durchgang wählen und auf die Wand klicken." : ""}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {modell.oeffnungen.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  className={x.id === gewaehlt ? LISTENKNOPF_GEWAEHLT : LISTENKNOPF}
                  aria-current={x.id === gewaehlt ? "true" : undefined}
                  onClick={() => onWaehlen(x.id)}
                >
                  {OEFFNUNGSART_LABEL[x.art]} {nummer(x.id)} · {masse.anzeigen(Math.round(x.links))} von links
                  {x.eigen ? "" : ` · gespeichert in „${raumName(x.quelleRaumId)}“`}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {o !== undefined && (
        <section aria-label="Gewählte Öffnung" className="border-t border-line pt-2">
          <h4>
            {OEFFNUNGSART_LABEL[o.art]} {nummer(o.id)}
          </h4>
          <p className="m-0">
            <strong>{verbindungsText(einordnung.get(o.id), raumName)}</strong>
          </p>
          {!o.eigen ? (
            <div className="flex flex-col gap-1">
              <p className="m-0 text-muted">
                Diese Öffnung ist einmal in „{raumName(o.quelleRaumId)}“ gespeichert und erscheint hier gespiegelt. Bearbeiten
                lässt sie sich nur dort – es entsteht keine zweite Öffnung.
              </p>
              <button type="button" className={knopf()} onClick={() => onQuelle(o)}>
                In „{raumName(o.quelleRaumId)}“ bearbeiten
              </button>
            </div>
          ) : (
            <>
              {editierbar ? (
                <label className={FELD} htmlFor="wand-oeffnung-art">
                  <span className={FELD_BESCHRIFTUNG}>Art</span>
                  <select
                    id="wand-oeffnung-art"
                    className={eingabefeld()}
                    value={o.art}
                    onChange={(event) => onArt(o.id, event.target.value as Oeffnungsart)}
                  >
                    {OEFFNUNGSARTEN.map((a) => (
                      <option key={a.wert} value={a.wert}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="grid grid-cols-2 gap-1.5">
                <MassFeld
                  id="wand-links"
                  label="Abstand von links"
                  wertMm={o.links}
                  gesperrt={gesperrt}
                  onUebernehmen={(mm) => onRechteck(o.id, { ...o, links: mm, rechts: mm + (o.rechts - o.links) })}
                />
                <MassFeld
                  id="wand-rechts"
                  label="Abstand von rechts"
                  wertMm={L - o.rechts}
                  gesperrt={gesperrt}
                  onUebernehmen={(mm) => onRechteck(o.id, { ...o, rechts: L - mm, links: L - mm - (o.rechts - o.links) })}
                />
                <MassFeld
                  id="wand-breite"
                  label="Breite"
                  wertMm={o.rechts - o.links}
                  gesperrt={gesperrt}
                  hinweis="linke Kante bleibt"
                  onUebernehmen={(mm) => onRechteck(o.id, { ...o, rechts: o.links + mm })}
                />
                <MassFeld
                  id="wand-hoehe"
                  label="Höhe"
                  wertMm={o.oben - o.unten}
                  gesperrt={gesperrt}
                  hinweis="Unterkante bleibt"
                  onUebernehmen={(mm) => onRechteck(o.id, { ...o, oben: o.unten + mm })}
                />
                {o.art === "window" ? (
                  <MassFeld
                    id="wand-bruestung"
                    label="Brüstung über Boden"
                    wertMm={o.unten}
                    gesperrt={gesperrt}
                    hinweis="Höhe bleibt"
                    onUebernehmen={(mm) => onRechteck(o.id, { ...o, unten: mm, oben: mm + (o.oben - o.unten) })}
                  />
                ) : (
                  <p className="m-0 self-end text-muted">Steht auf dem Boden (Brüstung 0).</p>
                )}
                <p className="m-0 self-end">
                  Abstand zur Decke: <strong>{o.oben <= H ? masse.anzeigen(H - o.oben) : `${masse.anzeigen(o.oben - H)} darüber`}</strong>
                </p>
              </div>
              <p className="m-0 text-muted">
                Achsmaß (Mitte der Öffnung) von links: {masse.anzeigen(Math.round((o.links + o.rechts) / 2))}. Abstände von
                links und rechts sind lichte Maße bis zur Öffnungskante.
              </p>
              {editierbar && (
                <button type="button" className={knopf()} onClick={() => onEntfernen(o.id)}>
                  Öffnung entfernen
                </button>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
