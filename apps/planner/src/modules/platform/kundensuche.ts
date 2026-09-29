import type { ApiClient } from "@elektroplan/api-client";

import { zuordenbareKunden } from "./auswahl";
import type { Suchergebnis } from "./KundenAuswahl";

/** Treffer je Suchanfrage - bewusst klein und sichtbar. */
export const TREFFER_PRO_SEITE = 20;

/**
 * Serverseitige Kundensuche nach Name, Kundennummer und Ort.
 *
 * Es wird nie der Kundenstamm geladen, nur die erste Trefferseite; `weitere`
 * sagt, ob es mehr gibt (`total_items`). `nurZuordenbar` lässt anonymisierte
 * Kunden weg - der Server lehnt sie für **neue** Zuordnungen ohnehin ab. Als
 * Filter bestehender Projekte bleiben sie auffindbar.
 */
export async function kundenSuchen(
  api: ApiClient,
  begriff: string,
  { nurZuordenbar }: { nurZuordenbar: boolean },
): Promise<Suchergebnis> {
  const seite = await api.get("/api/v1/customers", {
    query: {
      sort: "name",
      page: 1,
      page_size: TREFFER_PRO_SEITE,
      ...(begriff.trim() ? { q: begriff.trim() } : {}),
    },
  });
  return {
    treffer: nurZuordenbar ? zuordenbareKunden(seite.items) : seite.items,
    weitere: seite.total_items > seite.items.length,
  };
}
