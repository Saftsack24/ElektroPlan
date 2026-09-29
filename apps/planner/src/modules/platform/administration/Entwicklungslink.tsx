import { useState } from "react";

import { config } from "../../../core/config";
import { eingabefeld, knopf } from "../../../core/ui/stil";

/**
 * Zeigt einen Einladungslink **nur in der Entwicklungsumgebung**.
 *
 * Doppelt abgesichert: Der Server liefert den Link nur mit
 * `ELEKTROPLAN_INVITATION_DELIVERY=development_link` (in Produktion
 * verboten), und die Oberfläche zeigt ihn nur im Vite-Entwicklungsmodus.
 * Der Link lebt ausschließlich im Zustand dieser Seite; er wird weder
 * gespeichert noch später erneut vom Server abgerufen.
 */
export function Entwicklungslink({ link }: { link: string | null | undefined }) {
  const [kopiert, setKopiert] = useState(false);
  if (!config.entwicklungsfunktionen || !link) return null;
  return (
    <div
      className="my-2 rounded-ep border-2 border-dashed border-warning p-2.5"
      role="group" aria-labelledby="entwicklungslink-titel">
      <p id="entwicklungslink-titel" className="m-0 font-bold text-warning">
        Entwicklungsfunktion: Einladungslink
      </p>
      <p className="text-muted">
        In dieser Umgebung wird keine E-Mail verschickt. Der Link wird nur jetzt angezeigt und
        ist später nicht mehr abrufbar. Nicht in Produktion verfügbar.
      </p>
      <div className="flex gap-2">
        <input
          className={`${eingabefeld()} min-w-0 flex-1`}
          readOnly
          value={link}
          aria-label="Einladungslink"
          onFocus={(event) => event.target.select()}
        />
        <button
          type="button"
          className={knopf()}
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => setKopiert(true));
          }}
        >
          {kopiert ? "Kopiert" : "Kopieren"}
        </button>
      </div>
    </div>
  );
}
