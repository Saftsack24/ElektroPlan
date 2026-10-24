import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useUngespeicherteAenderungen } from "../../../core/ui/ungespeichert";
import type { Ebene, Wandhoehe } from "./grundriss";
import { Leitungsdialog } from "./Leitungsdialog";
import type { Leitungsplanung } from "./useLeitungsplanung";
import { useLeitungsplanung } from "./useLeitungsplanung";

import { LEITUNG_MELDUNG } from "./meldungen";

export { LEITUNG_MELDUNG };

const Kontext = createContext<Leitungsplanung | null>(null);

/** Werkzeug der Leitungsplanung im Grundriss; „aus“ = Grundriss wie bisher. */
export type Grundrisswerkzeug = "aus" | "leitung" | "durchfuehrung";

/**
 * Einstellungen des Grundrisswerkzeugs. Sie gehören wie der Entwurf zum Gebäude und
 * überstehen den Geschosswechsel über einen Steigweg - der Grundriss des Zielgeschosses
 * setzt mit demselben Werkzeug fort. Reine Bedienung, nie Teil des Entwurfs oder der Historie.
 */
export interface Grundrisseinstellung {
  readonly werkzeug: Grundrisswerkzeug;
  readonly ebene: Ebene;
  /** Höhe neuer Wandpunkte und Durchführungen im Grundriss. */
  readonly wandhoehe: Wandhoehe;
  setWerkzeug(w: Grundrisswerkzeug): void;
  setEbene(e: Ebene): void;
  setWandhoehe(h: Wandhoehe): void;
}

const EinstellungKontext = createContext<Grundrisseinstellung | null>(null);

/**
 * Leitungsplanung eines **Gebäudes** (Phase 6b.5, Entwurf §19.9).
 *
 * Seit 6b.5 gehört der Leitungsentwurf zum Gebäude, nicht mehr zum Geschoss:
 * Eine Leitung kann über einen Steigweg in ein anderes Geschoss weitergeführt
 * werden. Jeder Wegpunkt behält seinen eigenen Raum-, Wand- bzw. Halt-Bezug;
 * die gerade sichtbare Arbeitsfläche ist nicht ihr Eigentümer.
 *
 * Der Provider umschließt Grundriss, Wand-, Decken- und 3D-Ansicht desselben
 * Gebäudes (Schlüssel: Gebäude). Ein Geschoss- oder Ansichtswechsel innerhalb
 * des Gebäudes behält den Entwurf, ohne zu speichern oder zu verwerfen; ein
 * Wechsel des Gebäudes, Projekts oder Benutzers baut ihn ab - davor fragt der
 * Navigationsschutz.
 */
export function LeitungsplanungProvider({
  projectId,
  buildingId,
  darfLeitungen,
  darfStromkreise,
  onGeschrieben,
  onUngespeichert,
  onPlanung,
  children,
}: {
  /** Projekt - für die wirksamen Planungsvorgaben im Abschlussdialog (Phase 6c). */
  projectId?: string | undefined;
  buildingId: string | undefined;
  darfLeitungen: boolean;
  darfStromkreise: boolean;
  onGeschrieben?: (() => Promise<void>) | undefined;
  /** Meldet, ob ein ungespeicherter Leitungsentwurf besteht. */
  onUngespeichert?: ((offen: boolean) => void) | undefined;
  /** Gibt die Planung nach außen - etwa zum ausdrücklichen Schließen vor einem Kontextwechsel. */
  onPlanung?: ((planung: Leitungsplanung) => void) | undefined;
  children: ReactNode;
}) {
  const planung = useLeitungsplanung({ projectId, buildingId, darfLeitungen, darfStromkreise, onGeschrieben });
  useUngespeicherteAenderungen(planung.ungespeichert, LEITUNG_MELDUNG);
  useEffect(() => onUngespeichert?.(planung.ungespeichert), [planung.ungespeichert, onUngespeichert]);
  useEffect(() => () => onUngespeichert?.(false), [onUngespeichert]);
  useEffect(() => onPlanung?.(planung));
  const [werkzeug, setWerkzeug] = useState<Grundrisswerkzeug>("aus");
  const [ebene, setEbene] = useState<Ebene>("fussboden");
  const [wandhoehe, setWandhoehe] = useState<Wandhoehe>(300);
  // Ohne Entwurf gibt es nichts zu zeichnen: Das Werkzeug fällt auf den Grundriss zurück.
  const ohneEntwurf = planung.entwurf === null;
  useEffect(() => {
    if (ohneEntwurf) setWerkzeug("aus");
  }, [ohneEntwurf]);
  const einstellung = useMemo(() => ({ werkzeug, ebene, wandhoehe, setWerkzeug, setEbene, setWandhoehe }), [werkzeug, ebene, wandhoehe]);
  return (
    <Kontext.Provider value={planung}>
      <EinstellungKontext.Provider value={einstellung}>
        {children}
        {/* Ein Dialog für alle Flächen des Gebäudes: Er gehört zum Entwurf, nicht zu einer Ansicht. */}
        {planung.dialogOffen && planung.entwurf !== null && <Leitungsdialog planung={planung} />}
      </EinstellungKontext.Provider>
    </Kontext.Provider>
  );
}

/** Grundrisswerkzeug des Gebäudes - `null` außerhalb eines Providers. */
export function useGrundrisseinstellung(): Grundrisseinstellung | null {
  return useContext(EinstellungKontext);
}

/** Die Leitungsplanung des umgebenden Gebäudes - `null` außerhalb eines Providers. */
export function useLeitungsplanungImKontext(): Leitungsplanung | null {
  return useContext(Kontext);
}
