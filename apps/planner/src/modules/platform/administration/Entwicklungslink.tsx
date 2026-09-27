import { useState } from "react";

import { config } from "../../../core/config";

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
    <div className="entwicklungslink" role="group" aria-labelledby="entwicklungslink-titel">
      <p id="entwicklungslink-titel" className="entwicklungslink__titel">
        Entwicklungsfunktion: Einladungslink
      </p>
      <p className="muted">
        In dieser Umgebung wird keine E-Mail verschickt. Der Link wird nur jetzt angezeigt und
        ist später nicht mehr abrufbar. Nicht in Produktion verfügbar.
      </p>
      <div className="entwicklungslink__zeile">
        <input
          className="field__input"
          readOnly
          value={link}
          aria-label="Einladungslink"
          onFocus={(event) => event.target.select()}
        />
        <button
          type="button"
          className="button button--ghost"
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
