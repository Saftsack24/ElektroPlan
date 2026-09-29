import type { ApiClient } from "@elektroplan/api-client";

/**
 * Der Planungsstand eines Geschosses - eine Abfrage für alle Ansichten.
 *
 * 2D-Editor und 3D-Ansicht lesen denselben Eintrag im Query-Cache. Speichert
 * der Editor, ersetzt er diesen Eintrag durch die Serverantwort und lässt ihn
 * neu laden; die 3D-Ansicht zeigt damit beim nächsten Aufruf denselben
 * Serverstand. Einen zweiten, ansichtsspezifischen Datenstand gibt es nicht.
 *
 * Eigene Datei statt Export aus dem Editor: Die lazy geladene 3D-Ansicht
 * soll den Editor-Code nicht mitziehen.
 */
export function planSchluessel(floorId: string) {
  return ["electrical", "plan", floorId] as const;
}

export function planAbfrage(api: ApiClient, floorId: string) {
  return {
    queryKey: planSchluessel(floorId),
    queryFn: () =>
      api.get("/api/v1/modules/electrical/floors/{floor_id}/plan", { path: { floor_id: floorId } }),
  };
}
