/**
 * Projektstatus in der Sprache der Oberflaeche (ADR 0008).
 *
 * Eigene Datei, damit weder Projekt- noch Detailseite Bausteine der jeweils
 * anderen importieren muss.
 */
export type ProjectStatus = "draft" | "active" | "completed" | "archived";

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: "Entwurf",
  active: "In Bearbeitung",
  completed: "Abgeschlossen",
  archived: "Archiviert",
};

/** Ein archiviertes Projekt ist serverseitig vollstaendig schreibgeschuetzt. */
export function istSchreibgeschuetzt(status: ProjectStatus): boolean {
  return status === "archived";
}
