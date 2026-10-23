import { memo } from "react";

import { AnsichtMenue, LeitungHinzufuegenKnopf, Werkzeuggruppe, Werkzeugknopf, Werkzeugwahl, Zoomgruppe } from "../arbeitsflaeche/Werkzeuggruppen";
import { RueckgaengigKnoepfe } from "../arbeitsflaeche/Kontextleiste";
import { WERKZEUGSYMBOL } from "../arbeitsflaeche/werkzeugsymbole";
import { ANSICHT_ZURUECKSETZEN_2D } from "../texte";
import type { Oeffnungsart } from "./entwurf";
import type { Werkzeug } from "./zustand";

/** Was ein Klick auf eine Wand im Grundriss öffnet: eine Öffnungsart oder das Gerätewerkzeug der Wandfläche. */
export type Wandwahl = Oeffnungsart | "geraet";

const OEFFNUNGEN = [
  { art: "door", label: "Tür", taste: "T", icon: WERKZEUGSYMBOL.tuer },
  { art: "window", label: "Fenster", taste: "N", icon: WERKZEUGSYMBOL.fenster },
  { art: "passage", label: "Durchgang", taste: "D", icon: WERKZEUGSYMBOL.durchgang },
] as const satisfies readonly { art: Oeffnungsart; label: string; taste: string; icon: unknown }[];

/**
 * Werkzeugleiste des Grundrisses (Phase 6c, L1) – gruppiert: Auswahl · Raum ·
 * Öffnung · Gerät · Leitung · Verlauf · Zoom · Ansicht. Jedes Werkzeug hat ein
 * Kürzel; es steht im Hinweis und in der Hilfe („Ansicht ▾“).
 *
 * Tür, Fenster, Durchgang und Gerät werden an der Wand gesetzt: Ein Klick auf eine
 * Wand öffnet deren Wandfläche mit diesem Werkzeug.
 */
export const Werkzeugleiste = memo(function Werkzeugleiste({
  werkzeug,
  onWerkzeug,
  wandwahl,
  onWandwahl,
  rasterMm,
  onRaster,
  fangAktiv,
  onFang,
  kannRueckgaengig,
  kannWiederholen,
  onRueckgaengig,
  onWiederholen,
  rueckgaengigBezug,
  onZoom,
  onEinpassen,
  onHilfe,
  leitungVorhanden,
  leitungAktiv,
  onLeitungHinzufuegen,
  darfSchreiben,
}: {
  werkzeug: Werkzeug;
  onWerkzeug: (w: Werkzeug) => void;
  wandwahl: Wandwahl;
  onWandwahl: (w: Wandwahl) => void;
  rasterMm: number;
  onRaster: (mm: number) => void;
  fangAktiv: boolean;
  onFang: (aktiv: boolean) => void;
  kannRueckgaengig: boolean;
  kannWiederholen: boolean;
  onRueckgaengig: () => void;
  onWiederholen: () => void;
  /** Schritte gelten gerade für einen anderen Entwurf als den Raum, etwa „im Leitungsentwurf“. */
  rueckgaengigBezug?: string | undefined;
  onZoom: (faktor: number) => void;
  onEinpassen: () => void;
  onHilfe: () => void;
  /** „Leitung hinzufügen“ – nur mit Leitungsplanung im Gebäude und Recht. */
  leitungVorhanden: boolean;
  leitungAktiv: boolean;
  onLeitungHinzufuegen: () => void;
  darfSchreiben: boolean;
}) {
  const wandwerkzeug = (w: Wandwahl) => {
    onWandwahl(w);
    onWerkzeug("oeffnung");
  };
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5" role="toolbar" aria-label="Werkzeuge des Grundrisseditors">
      <Werkzeuggruppe label="Auswahl">
        <Werkzeugknopf label="Auswählen" taste="V" icon={WERKZEUGSYMBOL.auswaehlen} aktiv={werkzeug === "auswahl"} onClick={() => onWerkzeug("auswahl")} />
        <Werkzeugknopf
          label="Verschieben"
          taste="H"
          hinweis="Ansicht verschieben"
          icon={WERKZEUGSYMBOL.verschieben}
          aktiv={werkzeug === "pan"}
          onClick={() => onWerkzeug("pan")}
        />
      </Werkzeuggruppe>
      {darfSchreiben && (
        <>
          <Werkzeugwahl
            gruppe="Raum"
            menueLabel="Raum zeichnen"
            icon={WERKZEUGSYMBOL.rechteck}
            werkzeuge={[
              { label: "Rechteckraum", text: "Rechteck", taste: "R", icon: WERKZEUGSYMBOL.rechteck, aktiv: werkzeug === "rechteck", onClick: () => onWerkzeug("rechteck") },
              { label: "Polygonraum", text: "Polygon", taste: "P", icon: WERKZEUGSYMBOL.polygon, aktiv: werkzeug === "polygon", onClick: () => onWerkzeug("polygon") },
            ]}
          />
          <Werkzeugwahl
            gruppe="Öffnung"
            menueLabel="Öffnung setzen"
            icon={WERKZEUGSYMBOL.tuer}
            werkzeuge={OEFFNUNGEN.map((o) => ({
              label: o.label,
              taste: o.taste,
              icon: o.icon,
              hinweis: `${o.label}: Wand anklicken – die Wandansicht öffnet sich zum Setzen`,
              aktiv: werkzeug === "oeffnung" && wandwahl === o.art,
              onClick: () => wandwerkzeug(o.art),
            }))}
          />
          <Werkzeuggruppe label="Gerät">
            <Werkzeugknopf
              label="Gerät"
              taste="G"
              icon={WERKZEUGSYMBOL.geraet}
              hinweis="Gerät: Wand anklicken – die Wandansicht öffnet sich zum Setzen (Deckengeräte in der Deckenfläche)"
              aktiv={werkzeug === "oeffnung" && wandwahl === "geraet"}
              onClick={() => wandwerkzeug("geraet")}
            />
          </Werkzeuggruppe>
        </>
      )}
      {leitungVorhanden && (
        <Werkzeuggruppe label="Leitung">
          <LeitungHinzufuegenKnopf aktiv={leitungAktiv} gesperrtGrund={null} onClick={onLeitungHinzufuegen} />
        </Werkzeuggruppe>
      )}
      {(darfSchreiben || rueckgaengigBezug !== undefined) && (
        <Werkzeuggruppe label="Verlauf">
          <RueckgaengigKnoepfe
            kannZurueck={kannRueckgaengig}
            kannVor={kannWiederholen}
            onZurueck={onRueckgaengig}
            onVor={onWiederholen}
            {...(rueckgaengigBezug !== undefined ? { bezug: rueckgaengigBezug } : {})}
          />
        </Werkzeuggruppe>
      )}
      <Zoomgruppe onZoom={onZoom} onGanz={onEinpassen} ganzHinweis={ANSICHT_ZURUECKSETZEN_2D} />
      <AnsichtMenue fangAktiv={fangAktiv} onFang={onFang} rasterMm={rasterMm} onRaster={onRaster} onHilfe={onHilfe} />
    </div>
  );
});
