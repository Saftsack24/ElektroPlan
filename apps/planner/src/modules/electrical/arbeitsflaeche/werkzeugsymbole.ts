import {
  CircleDotIcon,
  Columns2Icon,
  DoorOpenIcon,
  AppWindowIcon,
  HandIcon,
  Link2Icon,
  MousePointer2Icon,
  PentagonIcon,
  PlugIcon,
  SplineIcon,
  SquareIcon,
} from "lucide-react";

/**
 * Symbole der Planungswerkzeuge (L1) – eine Stelle für Grundriss, Wand und Decke.
 * Schmal stehen die Werkzeuge nur als Symbol da (Name und Kürzel im Hinweis), breit
 * mit Text. Fachbezogen, deshalb hier und nicht in den allgemeinen Aktionssymbolen.
 */
export const WERKZEUGSYMBOL = {
  auswaehlen: MousePointer2Icon,
  verschieben: HandIcon,
  rechteck: SquareIcon,
  polygon: PentagonIcon,
  tuer: DoorOpenIcon,
  fenster: AppWindowIcon,
  durchgang: Columns2Icon,
  geraet: PlugIcon,
  leitung: SplineIcon,
  durchfuehrung: CircleDotIcon,
  zuordnen: Link2Icon,
} as const;
