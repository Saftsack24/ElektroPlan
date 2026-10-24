import type { Wandseite } from "../wandansicht/wandbezug";
import type { useZuordnungsentwurf } from "../stromkreise/zuordnung";
import type { Leitungsplanung } from "./useLeitungsplanung";

/**
 * Gemeinsamer Kontext der Leitungsplanung für Wand- und Deckenansicht
 * (Phase 6b.4). Der Grundrisseditor hält ihn für sein Geschoss - den
 * Planungskontext. Wand- und Deckenansichten sind nur **Arbeitsflächen**
 * darin: Ein Wechsel zwischen ihnen behält jeden Entwurf, speichert nichts und
 * verwirft nichts.
 *
 * Höchstens **ein** Entwurf ist aktiv - Raum, Gerätezuordnung oder Leitung.
 */
export type Arbeitsflaeche =
  | { readonly art: "wand"; readonly raumId: string; readonly wandId: string; readonly seite?: Wandseite }
  | { readonly art: "decke"; readonly raumId: string };

/** Fläche, auf der der Leitungsbereich gezeigt wird; der Grundriss bearbeitet alle Wegpunktarten (6b.5). */
export type Bearbeitungsflaeche = Arbeitsflaeche | { readonly art: "grundriss"; readonly floorId: string };

export interface Leitungskontext {
  readonly planung: Leitungsplanung;
  readonly zuordnung: ReturnType<typeof useZuordnungsentwurf>;
  /** Grund, warum gerade kein neuer Entwurf beginnen kann - sonst `null`. */
  readonly sperrgrund: string | null;
  arbeitsflaecheWechseln(ziel: Arbeitsflaeche): void;
  /** Zurück in den Grundriss desselben Entwurfs (6c L2) - nichts wird gespeichert oder verworfen. */
  zumGrundriss(): void;
  raumName(raumId: string): string;
  /** „Wand 2“ eines Raums - für verständliche Orte ohne IDs. */
  wandName(wandId: string): string;
  /** Verwirft (nach Rückfrage) bzw. schließt die Gerätezuordnung; `false` = abgebrochen. */
  zuordnungSchliessen(): Promise<boolean>;
  /** Schließt den Leitungsentwurf (nach Rückfrage bei ungespeicherten Änderungen). */
  leitungSchliessen(): Promise<boolean>;
  /**
   * „Leitung hinzufügen“ (Phase 6c, L2): startet den Zeichenablauf oder setzt ihn am offenen Entwurf
   * fort. Liefert einen Grund, wenn gerade nicht möglich (etwa ungespeicherter Raumentwurf).
   */
  leitungZeichnen(): string | null;
}
