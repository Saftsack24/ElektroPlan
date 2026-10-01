import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import { AKTION } from "./aktionssymbole";
import { seitenScrollSperren } from "./scrollsperre";
import { knopf } from "./stil";
import { Symbol } from "./Symbol";

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
 * * Der Fokus wandert beim Öffnen auf ein Element mit `data-autofocus`,
 *   sonst auf das erste Eingabefeld. Bestätigungsdialoge setzen
 *   `data-autofocus` auf „Abbrechen": Enter löst dann nichts Folgenreiches aus.
 * * Beim Schließen kehrt der Fokus auf das Element zurück, das ihn vorher
 *   hatte - meist der auslösende Knopf. Der Dialog wird ausgehängt, deshalb
 *   übernimmt das nicht der Browser.
 * * `aria-labelledby` verweist auf die Überschrift.
 *
 * Auf schmalen Bildschirmen füllt der Dialog per CSS nahezu die ganze
 * Fläche — eine eigene Vollbildvariante ist dafür nicht nötig.
 *
 * **Genau ein Scrollbereich.** Der Dialog selbst scrollt nicht; Kopf mit
 * Titel und Schließen-Knopf steht fest, darunter scrollt allein der Inhalt
 * (`data-dialog-scrollbereich`). Aktionen in `<DialogAktionen>` bleiben dort
 * unten angeheftet sichtbar. Solange ein Dialog offen ist, ist die Seite dahinter
 * gesperrt (`scrollsperre.ts`).
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

  // Vor dem Öffnen-Effekt deklariert: Er muss das fokussierte Element
  // festhalten, bevor der Dialog den Fokus übernimmt.
  //
  // Gemerkt wird nur ein Element **außerhalb** des Dialogs. Unter StrictMode
  // läuft dieser Effekt ein zweites Mal, wenn der Fokus schon im Dialog
  // liegt; ohne diese Prüfung ginge der Fokus beim Schließen auf ein
  // entferntes Element - und damit auf `body`.
  //
  // Zurückgegeben wird der Fokus erst, wenn der Dialog wirklich aus dem DOM
  // ist: Das simulierte Aushängen unter StrictMode lässt ihn stehen und darf
  // den Fokus nicht aus dem offenen Dialog ziehen.
  const vorher = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!offen) return;
    const dialog = element.current;
    const aktiv = document.activeElement;
    if (aktiv instanceof HTMLElement && dialog?.contains(aktiv) !== true) {
      vorher.current = aktiv;
    }
    return () => {
      setTimeout(() => {
        if (dialog?.isConnected === true) return;
        const ziel = vorher.current;
        if (ziel !== null && ziel.isConnected) ziel.focus();
      }, 0);
    };
  }, [offen]);

  // Die Seite dahinter scrollt nicht mit; referenzgezählt über alle Dialoge.
  useEffect(() => (offen ? seitenScrollSperren() : undefined), [offen]);

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
        dialog.querySelector<HTMLElement>("[data-autofocus]") ??
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
      className="max-h-[calc(100dvh-32px)] w-[min(720px,calc(100vw-32px))] overflow-hidden rounded-ep border border-line bg-raised p-0 text-fg open:flex open:flex-col max-sm:h-dvh max-sm:max-h-dvh max-sm:w-screen max-sm:max-w-screen max-sm:rounded-none"
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
      <div className="flex flex-none items-center justify-between gap-3 px-5 pt-4 pb-2">
        <h2 id={titelId.current} className="m-0">
          {titel}
        </h2>
        <button
          type="button"
          className={knopf()}
          aria-label="Dialog schließen"
          title="Dialog schließen"
          onClick={onClose}
        >
          <Symbol icon={AKTION.schliessen} />
        </button>
      </div>
      <div
        className="min-h-0 flex-auto overflow-y-auto overscroll-contain px-5 after:block after:h-4 after:content-['']"
        data-dialog-scrollbereich
      >
        {beschreibung !== undefined && <p className="text-muted">{beschreibung}</p>}
        {children}
      </div>
    </dialog>
  );
}

/**
 * Aktionsleiste am unteren Rand eines Dialogs: bleibt beim Scrollen des
 * Inhalts angeheftet sichtbar.
 *
 * `anordnung="formular"` stapelt Knöpfe und Hinweise linksbündig und nimmt
 * in einem Formularraster die volle Breite ein.
 */
export function DialogAktionen({
  anordnung = "zeile",
  children,
}: {
  anordnung?: "zeile" | "formular";
  children: ReactNode;
}) {
  const layout =
    anordnung === "formular" ? "col-span-full flex flex-col items-start gap-2" : "flex flex-wrap gap-2";
  return (
    <div
      className={`sticky bottom-0 z-[1] mt-1 border-t border-line bg-raised pt-3 ${layout}`}
      data-dialog-aktionen
    >
      {children}
    </div>
  );
}
