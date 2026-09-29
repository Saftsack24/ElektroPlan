import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/** Eine nummerierte Seite, wie die API sie liefert (ADR 0017). */
export interface NummerierteSeite<ItemT> {
  items: ItemT[];
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
}

/**
 * Liste mit echten, serverseitig gezählten Seiten - gemeinsam genutzt von
 * Kundenliste, Projektliste und den Projekten eines Kunden.
 *
 * * **Filterwechsel beginnt auf Seite 1.** Suche, Status, Kunde usw. stehen
 *   im `schluessel`; ändert er sich, wird die Seite noch im selben Render
 *   zurückgesetzt. So wird nie Seite 5 einer neuen Suche angefragt.
 * * **Keine dauerhaft ungültige Seite.** Liegt die angefragte Seite hinter
 *   der letzten (etwa nach dem Ausblenden des letzten Eintrags), liefert der
 *   Server die letzte vorhandene und nennt sie in `page`; die Liste übernimmt
 *   diese Seitenzahl.
 * * Beim Blättern bleibt die bisherige Seite sichtbar, bis die neue da ist -
 *   die Tabelle springt nicht auf „wird geladen".
 */
export function useNummerierteListe<ItemT>({
  schluessel,
  laden,
  aktiv = true,
}: {
  /** Query-Key inklusive aller Filter - ohne die Seite. */
  schluessel: readonly unknown[];
  laden: (seite: number) => Promise<NummerierteSeite<ItemT>>;
  aktiv?: boolean;
}) {
  const kennung = JSON.stringify(schluessel);
  const [stand, setStand] = useState({ kennung, seite: 1 });
  const seite = stand.kennung === kennung ? stand.seite : 1;
  if (stand.kennung !== kennung) setStand({ kennung, seite: 1 });

  const abfrage = useQuery({
    queryKey: [...schluessel, "seite", seite],
    queryFn: () => laden(seite),
    // Die vorige Seite bleibt nur beim **Blättern** stehen. Nach einem
    // Filterwechsel wäre sie ein veraltetes Suchergebnis.
    placeholderData: (vorher, vorherigeAbfrage) =>
      vorherigeAbfrage !== undefined &&
      JSON.stringify(vorherigeAbfrage.queryKey.slice(0, -2)) === kennung
        ? keepPreviousData(vorher)
        : undefined,
    enabled: aktiv,
  });

  const gelieferteSeite = abfrage.isPlaceholderData ? undefined : abfrage.data?.page;
  useEffect(() => {
    if (gelieferteSeite !== undefined && gelieferteSeite !== seite) {
      setStand({ kennung, seite: gelieferteSeite });
    }
  }, [gelieferteSeite, seite, kennung]);

  return {
    eintraege: abfrage.data?.items ?? [],
    seite: abfrage.data !== undefined && !abfrage.isPlaceholderData ? abfrage.data.page : seite,
    gesamtSeiten: abfrage.data?.total_pages ?? 0,
    gesamtEintraege: abfrage.data?.total_items ?? 0,
    laedt: abfrage.isPending,
    wechselt: abfrage.isPlaceholderData && abfrage.isFetching,
    fehlgeschlagen: abfrage.isError,
    geladen: abfrage.isSuccess,
    zuSeite: (ziel: number) => setStand({ kennung, seite: Math.max(1, ziel) }),
    erneutVersuchen: () => void abfrage.refetch(),
  };
}
