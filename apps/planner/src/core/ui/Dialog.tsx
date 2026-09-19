import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * Modaler Dialog auf Basis des nativen `<dialog>`-Elements.
 *
 * Bewusst ohne Bibliothek: `showModal()` bringt Fokusfalle, Escape-Verhalten,
 * Backdrop und die ARIA-Rolle `dialog` schon mit. Eine zusätzliche
 * Abhängigkeit würde hier nur wiederholen, was der Browser kann.
 *
 * Ergänzt werden nur die Dinge, die das Element nicht selbst löst:
 *
 * * Escape und Klick auf den Backdrop melden an `onClose`, damit der
 *   aufrufende Zustand mitgeführt wird.
 * * Der Fokus wandert beim Öffnen auf das erste Eingabefeld.
 * * `aria-labelledby` verweist auf die Überschrift.
 *
 * Auf schmalen Bildschirmen füllt der Dialog per CSS nahezu die ganze
 * Fläche — eine eigene Vollbildvariante ist dafür nicht nötig.
 */
export function Dialog({
  offen,
  titel,
  beschreibung,
  onClose,
  children,
}: {
  offen: boolean;
  titel: string;
  beschreibung?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const element = useRef<HTMLDialogElement>(null);
  const titelId = useRef(`dialog-titel-${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    const dialog = element.current;
    if (dialog === null) return;
    // jsdom kennt showModal() nicht in jeder Version - der Dialog bleibt
    // dann ein gewöhnliches Element und ist trotzdem prüfbar.
    if (offen && !dialog.open) {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
      // Erst das erste Eingabefeld, sonst der erste Knopf. Der
      // Schliessen-Knopf steht im Markup vor den Feldern - auf ihm zu landen
      // waere unangenehm, weil Enter dann den Dialog schliesst.
      const erstes =
        dialog.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea") ??
        dialog.querySelector<HTMLElement>("button");
      erstes?.focus();
    }
    if (!offen && dialog.open) {
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
    }
  }, [offen]);

  if (!offen) return null;

  return (
    <dialog
      ref={element}
      className="dialog"
      aria-labelledby={titelId.current}
      onCancel={(event) => {
        // Escape: Der Browser würde das Element ohne unser Wissen schließen.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // Ein Klick auf den Backdrop trifft das <dialog> selbst.
        if (event.target === element.current) onClose();
      }}
    >
      <div className="dialog__inhalt">
        <div className="dialog__kopf">
          <h2 id={titelId.current}>{titel}</h2>
          <button
            type="button"
            className="button button--ghost"
            aria-label="Dialog schließen"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        {beschreibung !== undefined && <p className="muted">{beschreibung}</p>}
        {children}
      </div>
    </dialog>
  );
}
