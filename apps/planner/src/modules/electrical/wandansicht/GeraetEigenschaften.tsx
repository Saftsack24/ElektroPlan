import { useState } from "react";

import { Marke } from "../../../core/ui/Marke";
import { useMasse } from "../../../core/ui/masseinheit";
import { FELD, FELD_BESCHRIFTUNG, FELD_HINWEIS, eingabefeld, knopf, meldungsflaeche } from "../../../core/ui/stil";
import { befundText } from "../geraete/geraetepruefung";
import type { Geraetetyp } from "../geraete/katalog";
import { FLAECHE_LABEL } from "../geraete/katalog";
import { Geraetesymbol } from "../geraete/symbole";
import type { Wandbezug } from "./wandbezug";
import type { AnsichtsGeraet } from "./wandgeraete";
import { flaecheDerSeite, geraeteName } from "./wandgeraete";
import { MassFeld } from "./WandEigenschaften";

const LISTENKNOPF = `${knopf()} w-full text-left`;
const LISTENKNOPF_GEWAEHLT = `${knopf("gewaehlt")} w-full text-left`;
const MAX_BESCHRIFTUNG = 60;

/** Kurze, freie Beschriftung - übernommen mit Enter oder beim Verlassen. */
export function BeschriftungsFeld({
  id,
  wert,
  gesperrt,
  onUebernehmen,
}: {
  id: string;
  wert: string | null;
  gesperrt: boolean;
  onUebernehmen: (text: string | null) => void;
}) {
  const [text, setText] = useState(wert ?? "");
  const [stand, setStand] = useState(wert);
  if (stand !== wert) {
    setStand(wert);
    setText(wert ?? "");
  }
  const uebernehmen = () => {
    const neu = text.trim() === "" ? null : text.trim().slice(0, MAX_BESCHRIFTUNG);
    if (neu !== wert) onUebernehmen(neu);
  };
  return (
    <label className={FELD} htmlFor={id}>
      <span className={FELD_BESCHRIFTUNG}>Beschriftung (optional)</span>
      <input
        id={id}
        className={eingabefeld()}
        value={text}
        maxLength={MAX_BESCHRIFTUNG}
        disabled={gesperrt}
        placeholder="z. B. Bett links"
        onChange={(event) => setText(event.target.value)}
        onBlur={uebernehmen}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            uebernehmen();
          }
        }}
      />
      <span className={FELD_HINWEIS}>Kurz und ohne Personennamen.</span>
    </label>
  );
}

/**
 * Typ des gewählten Geräts mit „Typ ändern …“ (Phase 6c, K1): öffnet den Gerätekatalog im
 * Modus „Typ übernehmen“. Ein deaktivierter Bestandstyp bleibt verständlich sichtbar. Das
 * Lagegerät einer Verteilung wechselt seinen Typ nie (Server: `distribution-board-type-changed`).
 */
export function TypFeld({
  typ,
  schluessel,
  editierbar,
  onAendern,
}: {
  typ: Geraetetyp | undefined;
  schluessel: string;
  editierbar: boolean;
  onAendern: () => void;
}) {
  const verteilung = typ?.category === "distribution";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={FELD_BESCHRIFTUNG}>Gerätetyp</span>
      <span className="inline-flex items-center gap-1.5 font-semibold" data-testid="geraet-typ">
        <Geraetesymbol typ={typ} groesse={18} />
        {typ?.label ?? schluessel}
      </span>
      {typ !== undefined && !typ.is_active && <Marke art="warnung">nicht mehr angeboten</Marke>}
      {editierbar && !verteilung && (
        <button type="button" className={knopf("neutral", { klein: true })} onClick={onAendern}>
          Typ ändern …
        </button>
      )}
      {verteilung && <span className="text-muted">Lage einer Verteilung – Typ fest; Position über „Stromkreise“.</span>}
    </div>
  );
}

/**
 * Geräte der betrachteten Wandseite und Eigenschaften des gewählten Geräts.
 * Handwerkliche Maße zur **Gerätemitte** (Achsmaß) statt roher Koordinaten.
 */
export function GeraetEigenschaften({
  bezug,
  geraete,
  gewaehlt,
  editierbar,
  andereSeite,
  onWaehlen,
  onLage,
  onTypAendern,
  onLabel,
  onEntfernen,
}: {
  bezug: Wandbezug;
  geraete: readonly AnsichtsGeraet[];
  gewaehlt: string | null;
  editierbar: boolean;
  /** Geräte auf der anderen Seite derselben Wand - nur als Zahl genannt. */
  andereSeite: number;
  onWaehlen: (id: string) => void;
  onLage: (id: string, u: number, h: number) => string | undefined;
  /** „Typ ändern …“: öffnet den Gerätekatalog für dieses Gerät (K1). */
  onTypAendern: (id: string) => void;
  onLabel: (id: string, label: string | null) => void;
  onEntfernen: (id: string) => void;
}) {
  const masse = useMasse();
  const L = bezug.laengeMm;
  const H = bezug.hoeheMm;
  const g = geraete.find((x) => x.id === gewaehlt);
  const flaeche = flaecheDerSeite(bezug.seite);

  return (
    <section aria-label="Geräte dieser Wandseite" className="flex flex-col gap-1.5 border-b border-line pb-2 text-small">
      <h4 className="m-0">
        Geräte · {FLAECHE_LABEL[flaeche]} ({geraete.length})
      </h4>
      {geraete.length === 0 ? (
        <p className="m-0 text-muted">
          Noch kein Gerät auf dieser Seite.{editierbar ? " „Gerät“ (G) öffnet den Katalog: Typ wählen, „Platzieren“, auf die Wand klicken." : ""}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {geraete.map((x, i) => (
            <li key={x.id}>
              <button
                type="button"
                className={x.id === gewaehlt ? LISTENKNOPF_GEWAEHLT : LISTENKNOPF}
                aria-current={x.id === gewaehlt ? "true" : undefined}
                onClick={() => onWaehlen(x.id)}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Geraetesymbol typ={x.typ} groesse={16} />
                  {geraeteName(x, i + 1)}
                  {x.label !== null ? ` „${x.label}“` : ""} · Mitte {masse.anzeigen(x.u)} von links
                  {x.befunde.length > 0 ? " ⚠" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {andereSeite > 0 && (
        <p className="m-0 text-muted">
          Auf der {bezug.seite === "innen" ? "Außenseite" : "Innenseite"} dieser Wand: {andereSeite} Gerät(e) – dort eigene Fläche,
          hier nicht dargestellt.
        </p>
      )}

      {g !== undefined && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-2" aria-label="Gewähltes Gerät">
          <TypFeld typ={g.typ} schluessel={g.schluessel} editierbar={editierbar} onAendern={() => onTypAendern(g.id)} />
          <div className="grid grid-cols-2 gap-1.5">
            <MassFeld id="geraet-links" label="Mitte von links" wertMm={g.u} gesperrt={!editierbar} hinweis="Achsmaß" onUebernehmen={(mm) => onLage(g.id, mm, g.h)} />
            <MassFeld id="geraet-rechts" label="Mitte von rechts" wertMm={L - g.u} gesperrt={!editierbar} hinweis="Achsmaß" onUebernehmen={(mm) => onLage(g.id, L - mm, g.h)} />
            <MassFeld id="geraet-hoehe" label="Höhe Mitte über Boden" wertMm={g.h} gesperrt={!editierbar} hinweis="ab Fertigfußboden" onUebernehmen={(mm) => onLage(g.id, g.u, mm)} />
            <p className="m-0 self-end">
              Oberkante bis Decke: <strong>{g.oben <= H ? masse.anzeigen(H - g.oben) : `${masse.anzeigen(g.oben - H)} darüber`}</strong>
            </p>
          </div>
          <BeschriftungsFeld id="wand-geraet-label" wert={g.label} gesperrt={!editierbar} onUebernehmen={(text) => onLabel(g.id, text)} />
          <p className="m-0 text-muted">
            Planungsmaß {masse.anzeigen(g.typ?.width_mm ?? 0)} × {masse.anzeigen(g.typ?.height_mm ?? 0)} – vereinfachtes Rahmen- bzw.
            Auslassmaß zur Prüfung, keine Herstellerangabe. Standardhöhen sind Startwerte, keine Normvorgabe.
          </p>
          {g.befunde.length > 0 && (
            <div className={meldungsflaeche("schlicht")} role="status">
              <p className="m-0 font-semibold">Hinweis: Lage prüfen</p>
              <ul className="my-1 pl-[18px]">
                {g.befunde.map((code) => (
                  <li key={code}>{befundText(code)}</li>
                ))}
              </ul>
              <p className="m-0 text-muted">Nichts wird automatisch verschoben oder gelöscht.</p>
            </div>
          )}
          {editierbar && (
            <button type="button" className={knopf()} onClick={() => onEntfernen(g.id)}>
              Gerät entfernen
            </button>
          )}
        </div>
      )}
    </section>
  );
}
