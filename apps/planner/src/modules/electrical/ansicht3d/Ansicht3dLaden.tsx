import { Component, Suspense, lazy, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";

import { KNOPFZEILE, knopf } from "../../../core/ui/stil";
import type { Ansichtsziel } from "./Ansicht3d";

/**
 * Lade-Grenze der 3D-Ansicht.
 *
 * Three.js ist groß und wird nur gebraucht, wenn jemand die 3D-Ansicht
 * öffnet. Diese Datei enthält deshalb **kein** Three.js: Sie lädt
 * `Ansicht3d` (und damit Three.js) als eigenen Chunk erst beim ersten Öffnen
 * und fängt ein Scheitern des Nachladens ab, statt den Tab abstürzen zu
 * lassen.
 */
type Props = { floorId: string; geschossLabel: string; onAnsicht: (ziel: Ansichtsziel) => void };
type Modul = { default: ComponentType<Props> };

const standardLaden = (): Promise<Modul> => import("./Ansicht3d");

class Ladefehler extends Component<{ children: ReactNode; ersatz: ReactNode }, { fehler: boolean }> {
  override state = { fehler: false };

  static getDerivedStateFromError() {
    return { fehler: true };
  }

  override render() {
    return this.state.fehler ? this.props.ersatz : this.props.children;
  }
}

export function Ansicht3dLaden({
  laden = standardLaden,
  ...props
}: Props & { laden?: () => Promise<Modul> }) {
  const [versuch, setVersuch] = useState(0);
  // Ein neuer Versuch braucht eine neue lazy-Komponente: React merkt sich
  // das gescheiterte Nachladen sonst dauerhaft.
  const Ansicht = useMemo(() => lazy(laden), [laden, versuch]);

  const ersatz = (
    <div className="p-4" role="alert">
      <p>
        <strong>Die 3D-Ansicht konnte nicht geladen werden.</strong> Möglicherweise ist die
        Verbindung unterbrochen.
      </p>
      <div className={KNOPFZEILE}>
        <button type="button" className={knopf("primaer")} onClick={() => setVersuch((n) => n + 1)}>
          Erneut versuchen
        </button>
        <button type="button" className={knopf("einfach")} onClick={() => props.onAnsicht("editor")}>
          Zum 2D-Editor
        </button>
      </div>
    </div>
  );

  return (
    <Ladefehler key={versuch} ersatz={ersatz}>
      <Suspense fallback={<p className="text-muted">3D-Ansicht wird geladen …</p>}>
        <Ansicht {...props} />
      </Suspense>
    </Ladefehler>
  );
}
