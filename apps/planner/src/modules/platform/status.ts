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

/**
 * Nur Entwuerfe und laufende Projekte lassen sich loeschen (ADR 0020). Ob der
 * Benutzer darf und ob Inhalte vorhanden sind, entscheidet die Vorpruefung -
 * und verbindlich erst der Server.
 */
export function istLoeschbar(status: ProjectStatus): boolean {
  return status === "draft" || status === "active";
}

/** Nur ein abgeschlossenes Projekt laesst sich wieder in Bearbeitung setzen. */
export function istWiedereroeffenbar(status: ProjectStatus): boolean {
  return status === "completed";
}

/**
 * Die zwei Ansichten der Projektliste (Phase 4d). ``laufend`` ist der Standard;
 * ``abgeschlossen`` zeigt abgeschlossene und archivierte Projekte.
 */
export type Ansicht = "laufend" | "abgeschlossen";

export const ANSICHT: Record<
  Ansicht,
  {
    gruppe: "current" | "closed";
    status: readonly ProjectStatus[];
    titel: string;
    alle: string;
    leer: string;
    umschalten: string;
  }
> = {
  laufend: {
    gruppe: "current",
    status: ["draft", "active"],
    titel: "Laufende Projekte",
    alle: "Alle laufenden",
    leer: "Keine laufenden Projekte. Abgeschlossene und archivierte finden Sie über die Umschaltung.",
    umschalten: "Abgeschlossene & archivierte anzeigen",
  },
  abgeschlossen: {
    gruppe: "closed",
    status: ["completed", "archived"],
    titel: "Abgeschlossene & archivierte Projekte",
    alle: "Alle abgeschlossenen und archivierten",
    leer: "Keine abgeschlossenen oder archivierten Projekte.",
    umschalten: "Laufende Projekte anzeigen",
  },
};

/** Liest die Ansicht aus der Adresse; alles Unbekannte ist die Standardansicht. */
export function ansichtAus(wert: string | null): Ansicht {
  return wert === "abgeschlossen" ? "abgeschlossen" : "laufend";
}
