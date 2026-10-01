import type { ProjectOut } from "@elektroplan/api-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useAuth } from "../../core/auth/AuthProvider";
import { AKTION } from "../../core/ui/aktionssymbole";
import { Bestaetigung } from "../../core/ui/Bestaetigung";
import { FELD, FELD_BESCHRIFTUNG, eingabefeld } from "../../core/ui/stil";
import { aktionsfehler } from "./aktionsfehler";

/**
 * Endgültiges Löschen eines Projekts (ADR 0020) - zwei Varianten:
 *
 * * **Leeres Projekt:** Name und Nummer, Hinweis „leer" und „endgültig".
 * * **Projekt mit Inhalt** (nur Administrator): erkannte Inhaltsarten, eine
 *   ausdrückliche Warnung und die Projektnummer als Bestätigung. Der Knopf
 *   wird erst aktiv, wenn die Eingabe exakt passt.
 *
 * Grundlage ist die Vorprüfung des Servers. Sie ist **keine** Zusage: Die
 * Löschung prüft alles erneut unter der Projektsperre. Entsteht zwischendurch
 * Inhalt, lehnt der Server eine Löschung ohne Bestätigung ab (`409`).
 */
export function ProjektLoeschenDialog({
  offen,
  projekt,
  onAbbrechen,
  onGeloescht,
}: {
  offen: boolean;
  projekt: ProjectOut;
  onAbbrechen: () => void;
  onGeloescht: () => void | Promise<void>;
}) {
  const { api } = useAuth();
  const [eingabe, setEingabe] = useState("");

  const pruefung = useQuery({
    queryKey: ["project", projekt.id, "deletion-check"],
    queryFn: () =>
      api.get("/api/v1/projects/{project_id}/deletion-check", {
        path: { project_id: projekt.id },
      }),
    enabled: offen,
    staleTime: 0,
    gcTime: 0,
  });

  const loeschen = useMutation({
    mutationFn: () => {
      const stand = pruefung.data;
      return api.delete("/api/v1/projects/{project_id}", {
        path: { project_id: projekt.id },
        ifMatch: stand?.version ?? projekt.version,
        query: stand?.requires_number_confirmation ? { confirm_project_number: eingabe.trim() } : {},
      });
    },
    onSuccess: () => onGeloescht(),
  });

  const stand = pruefung.data;
  const mitInhalt = stand !== undefined && !stand.is_empty;
  const nummerPasst = eingabe.trim() === projekt.project_number;
  const gesperrt =
    stand === undefined || !stand.can_delete || (stand.requires_number_confirmation && !nummerPasst);
  const fehler = loeschen.isError
    ? aktionsfehler(loeschen.error, "Das Projekt konnte nicht gelöscht werden.")
    : pruefung.isError
      ? aktionsfehler(pruefung.error, "Die Löschwirkung konnte nicht geprüft werden.")
      : null;

  return (
    <Bestaetigung
      offen={offen}
      titel={mitInhalt ? "Projekt mit Inhalt endgültig löschen?" : "Projekt endgültig löschen?"}
      bestaetigenLabel="Projekt endgültig löschen"
      bestaetigenSymbol={AKTION.loeschen}
      gefaehrlich
      laeuft={loeschen.isPending}
      bestaetigenGesperrt={gesperrt}
      fehler={fehler}
      onBestaetigen={() => loeschen.mutate()}
      onAbbrechen={() => {
        setEingabe("");
        loeschen.reset();
        onAbbrechen();
      }}
    >
      <p>
        Projekt <code>{projekt.project_number}</code> <strong>{projekt.name}</strong>
      </p>
      {pruefung.isPending && <p className="text-muted">Inhalte des Projekts werden geprüft ...</p>}

      {stand !== undefined && !stand.can_delete && stand.blocked_code !== null && (
        <p role="alert">{sperrgrund(stand.blocked_code, stand.is_empty)}</p>
      )}

      {stand !== undefined && stand.is_empty && stand.can_delete && (
        <>
          <p>Das Projekt ist leer: keine Dateien, keine Planungsdaten, höchstens die leere Startstruktur.</p>
          <p>
            Die Löschung ist <strong>endgültig</strong>. Die Projektnummer wird nicht erneut vergeben.
          </p>
        </>
      )}

      {mitInhalt && (
        <>
          <p>Das Projekt enthält:</p>
          <ul className="my-1 pl-5" aria-label="Erkannte Inhalte">
            {stand.contents.map((inhalt) => (
              <li key={inhalt.code}>
                {inhalt.label}
                {inhalt.count !== null && inhalt.code !== "core.structure" ? `: ${inhalt.count}` : ""}
              </li>
            ))}
          </ul>
          {stand.can_delete && (
            <>
              <p role="note">
                <strong>Achtung:</strong> Alle diese Inhalte gehen unwiederbringlich verloren -
                Gebäude, Geschosse, Planungsdaten und Dateien. Die Projektnummer wird nicht
                erneut vergeben.
              </p>
              <div className={`${FELD} mt-2`}>
                <label className={FELD_BESCHRIFTUNG} htmlFor="projekt-loeschen-nummer">
                  Zur Bestätigung die Projektnummer {projekt.project_number} eingeben
                </label>
                <input
                  id="projekt-loeschen-nummer"
                  className={eingabefeld()}
                  value={eingabe}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={eingabe !== "" && !nummerPasst}
                  onChange={(event) => setEingabe(event.target.value)}
                />
              </div>
            </>
          )}
        </>
      )}
    </Bestaetigung>
  );
}

/** Warum nicht gelöscht werden kann - in der Sprache der Oberfläche. */
function sperrgrund(code: "status" | "permission", leer: boolean): string {
  if (code === "status") {
    return "Abgeschlossene und archivierte Projekte lassen sich nicht löschen. Löschen können Sie nur Entwürfe und Projekte in Bearbeitung.";
  }
  return leer
    ? "Für das Löschen von Projekten fehlt Ihnen die Berechtigung."
    : "Dieses Projekt enthält bereits Inhalte. Projekte mit Inhalt kann nur ein Administrator löschen.";
}
