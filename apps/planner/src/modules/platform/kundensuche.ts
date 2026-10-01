import type { ApiClient } from "@elektroplan/api-client";

import type { Suchergebnis } from "./KundenAuswahl";

/** Treffer je Suchanfrage - bewusst klein und sichtbar. */
export const TREFFER_PRO_SEITE = 20;

/**
 * Serverseitige Kundensuche nach Name, Kundennummer und Ort.
 *
 * Es wird nie der Kundenstamm geladen, nur die erste Trefferseite; `weitere`
 * sagt, ob es mehr gibt (`total_items`). Seit Phase 4d gibt es keine
 * anonymisierten Kunden mehr: Jeder gelistete Kunde ist auch zuordenbar.
 */
export async function kundenSuchen(api: ApiClient, begriff: string): Promise<Suchergebnis> {
  const seite = await api.get("/api/v1/customers", {
    query: {
      sort: "name",
      page: 1,
      page_size: TREFFER_PRO_SEITE,
      ...(begriff.trim() ? { q: begriff.trim() } : {}),
    },
  });
  return { treffer: seite.items, weitere: seite.total_items > seite.items.length };
}
