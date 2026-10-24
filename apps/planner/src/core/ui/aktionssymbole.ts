import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CableIcon,
  ChevronRightIcon,
  CircleHelpIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  KeyRoundIcon,
  LockIcon,
  LockOpenIcon,
  Maximize2Icon,
  Minimize2Icon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PencilIcon,
  PlusIcon,
  Redo2Icon,
  RotateCcwIcon,
  ScanIcon,
  SaveIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  Undo2Icon,
  UploadIcon,
  UserPlusIcon,
  UserXIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
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
  // Benutzerlebenszyklus (Phase 4e)
  sperren: LockIcon,
  entsperren: LockOpenIcon,
  passwortZuruecksetzen: KeyRoundIcon,
  entfernen: UserXIcon,
  kopieren: CopyIcon,
  // Planungsarbeitsfläche (Phase 6c.0): gebogene Pfeile, Eigenschaften, Maximieren
  rueckgaengig: Undo2Icon,
  wiederholen: Redo2Icon,
  eigenschaftenOeffnen: PanelRightOpenIcon,
  eigenschaftenSchliessen: PanelRightCloseIcon,
  maximieren: Maximize2Icon,
  normaleAnsicht: Minimize2Icon,
  // Planungslayout (6c, L1)
  leitungHinzufuegen: CableIcon,
  ganzZeigen: ScanIcon,
  vergroessern: ZoomInIcon,
  verkleinern: ZoomOutIcon,
  ansichtEinstellungen: SlidersHorizontalIcon,
  mehr: EllipsisIcon,
  pfadTrenner: ChevronRightIcon,
  hilfe: CircleHelpIcon,
} as const;
