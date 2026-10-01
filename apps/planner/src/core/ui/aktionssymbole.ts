import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  DownloadIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  SettingsIcon,
  Trash2Icon,
  UploadIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";

/**
 * Welche Aktion welches Icon trägt - eine Stelle für die ganze Oberfläche.
 *
 * Fachneutral: Module verwenden dieselben Einträge, damit „Löschen" überall
 * gleich aussieht. Ein neues Icon kommt nur hinzu, wenn eine Aktion es
 * wirklich braucht.
 */
export const AKTION = {
  anlegen: PlusIcon,
  einladen: UserPlusIcon,
  einstellungen: SettingsIcon,
  bearbeiten: PencilIcon,
  loeschen: Trash2Icon,
  archivieren: ArchiveIcon,
  wiederaufnehmen: RotateCcwIcon,
  speichern: SaveIcon,
  hochladen: UploadIcon,
  herunterladen: DownloadIcon,
  zurueck: ArrowLeftIcon,
  weiter: ArrowRightIcon,
  schliessen: XIcon,
} as const;
