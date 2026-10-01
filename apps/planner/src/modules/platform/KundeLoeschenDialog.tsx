import type { CustomerOut } from "@elektroplan/api-client";
import { useMutation, useQuery } from "@tanstack/react-query";

import { useAuth } from "../../core/auth/AuthProvider";
import { AKTION } from "../../core/ui/aktionssymbole";
import { Bestaetigung } from "../../core/ui/Bestaetigung";
import { aktionsfehler } from "./aktionsfehler";

/**
 * Endgültige Löschung eines Kunden (nur Administrator, ADR 0020).
 *
 * Der Dialog zählt vorab die zugeordneten Projekte - **alle** Zustände - und
 * sperrt die Gefahr-Schaltfläche, solange welche da sind. Das ist Bedienhilfe,
 * keine Sicherung: Der Server prüft unter der Kundensperre erneut - etwa wenn
 * inzwischen ein Projekt angelegt wurde - und antwortet sonst mit `409`.
 */
export function KundeLoeschenDialog({
  offen,
  kunde,
  onAbbrechen,
  onGeloescht,
}: {
  offen: boolean;
  kunde: CustomerOut;
  onAbbrechen: () => void;
  onGeloescht: () => void | Promise<void>;
}) {
  const { api } = useAuth();

  const projekte = useQuery({
    queryKey: ["projects", "kunde", kunde.id, "anzahl"],
    queryFn: () =>
      api.get("/api/v1/projects", { query: { customer_id: kunde.id, page: 1, page_size: 1 } }),
    enabled: offen,
    staleTime: 0,
  });

  const loeschen = useMutation({
    mutationFn: () =>
      api.delete("/api/v1/customers/{customer_id}", {
        path: { customer_id: kunde.id },
        ifMatch: kunde.version,
      }),
    onSuccess: () => onGeloescht(),
  });

  const anzahl = projekte.data?.total_items;
  const hatProjekte = anzahl !== undefined && anzahl > 0;
  const fehler = loeschen.isError
    ? aktionsfehler(loeschen.error, "Der Kunde konnte nicht gelöscht werden.")
    : null;

  return (
    <Bestaetigung
      offen={offen}
      titel="Kunden endgültig löschen?"
      bestaetigenLabel="Kunden endgültig löschen"
      gefaehrlich
      bestaetigenSymbol={AKTION.loeschen}
      laeuft={loeschen.isPending}
      bestaetigenGesperrt={projekte.isPending || hatProjekte}
      fehler={fehler}
      onBestaetigen={() => loeschen.mutate()}
      onAbbrechen={() => {
        loeschen.reset();
        onAbbrechen();
      }}
    >
      <p>
        Kunde <code>{kunde.customer_number}</code> <strong>{kunde.name}</strong>
      </p>
      {projekte.isPending && <p className="text-muted">Zugeordnete Projekte werden geprüft ...</p>}
      {hatProjekte && (
        <p role="alert">
          Diesem Kunden {anzahl === 1 ? "ist noch 1 Projekt" : `sind noch ${anzahl} Projekte`}{" "}
          zugeordnet. Ein Kunde mit Projekten - auch abgeschlossenen oder archivierten - lässt sich
          nicht löschen.
        </p>
      )}
      {anzahl === 0 && (
        <p>Diesem Kunden sind keine Projekte zugeordnet.</p>
      )}
      <p>
        Die Löschung ist <strong>endgültig</strong>: Name, Anschrift und Kontaktdaten werden aus
        dem System entfernt. Die Kundennummer wird nicht erneut vergeben.
      </p>
    </Bestaetigung>
  );
}
