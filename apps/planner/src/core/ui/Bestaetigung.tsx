import type { ReactNode } from "react";

import { Dialog, DialogAktionen } from "./Dialog";
import { knopf, meldungsflaeche } from "./stil";

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
      <div className="flex flex-col gap-2">
        <div>{children}</div>
        {fehler !== null && (
          <p className={meldungsflaeche()} role="alert">
            {fehler}
          </p>
        )}
        <DialogAktionen>
          <button
            type="button"
            className={knopf(gefaehrlich ? "gefahr" : "primaer")}
            disabled={laeuft}
            onClick={onBestaetigen}
          >
            {laeuft ? "Wird ausgeführt ..." : bestaetigenLabel}
          </button>
          <button
            type="button"
            className={knopf()}
            data-autofocus
            disabled={laeuft}
            onClick={abbrechen}
          >
            Abbrechen
          </button>
        </DialogAktionen>
      </div>
    </Dialog>
  );
}
