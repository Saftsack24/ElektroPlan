import type { ReactNode } from "react";

import { Dialog } from "./Dialog";

/**
 * Rückfrage vor einer folgenreichen Aktion - Sperren, Widerrufen,
 * Rollen ändern.
 *
 * Der Fokus startet auf „Abbrechen": Wer versehentlich Enter drückt, löst
 * nichts aus. Während die Anfrage läuft, sind beide Knöpfe gesperrt und
 * Escape schließt nicht - eine halb abgeschickte Aktion soll nicht aus dem
 * Blick geraten. Ein Fehler bleibt im Dialog sichtbar.
 */
export function Bestaetigung({
  offen,
  titel,
  children,
  bestaetigenLabel,
  gefaehrlich = false,
  laeuft = false,
  fehler = null,
  onBestaetigen,
  onAbbrechen,
}: {
  offen: boolean;
  titel: string;
  children: ReactNode;
  bestaetigenLabel: string;
  /** Rote Hervorhebung für Aktionen, die jemandem den Zugang nehmen. */
  gefaehrlich?: boolean;
  laeuft?: boolean;
  fehler?: string | null;
  onBestaetigen: () => void;
  onAbbrechen: () => void;
}) {
  const abbrechen = () => {
    if (!laeuft) onAbbrechen();
  };
  return (
    <Dialog offen={offen} titel={titel} onClose={abbrechen}>
      <div className="bestaetigung">
        <div className="bestaetigung__text">{children}</div>
        {fehler !== null && (
          <p className="alert alert--error" role="alert">
            {fehler}
          </p>
        )}
        <div className="button-row dialog__aktionen">
          <button
            type="button"
            className={gefaehrlich ? "button button--gefahr" : "button button--primary"}
            disabled={laeuft}
            onClick={onBestaetigen}
          >
            {laeuft ? "Wird ausgeführt ..." : bestaetigenLabel}
          </button>
          <button
            type="button"
            className="button button--ghost"
            data-autofocus
            disabled={laeuft}
            onClick={abbrechen}
          >
            Abbrechen
          </button>
        </div>
      </div>
    </Dialog>
  );
}
