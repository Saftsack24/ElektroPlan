import { useInfiniteQuery } from "@tanstack/react-query";

import { eintraegeAus } from "./seiten";

/** Eine Seite, wie die API sie liefert (docs/api.md, Abschnitt 4). */
export interface Seite<ItemT> {
  items: ItemT[];
  next_cursor?: string | null;
  has_more?: boolean;
}

/**
 * Cursorbasierte Liste mit „Weitere laden".
 *
 * Gemeinsam genutzt von der Kunden- und der Projektliste — zwei Aufrufer,
 * also keine Abstraktion auf Vorrat.
 *
 * **Das Zurücksetzen bei Such- und Filteränderungen steckt im `schluessel`.**
 * Ändert sich dort etwas, ist es für TanStack Query eine andere Abfrage: Die
 * bisherigen Seiten gelten nicht mehr, und der Cursor beginnt zwangsläufig
 * von vorn. Ein eigenes Zurücksetzen von Hand wäre eine zweite Wahrheit, die
 * irgendwann von der ersten abweicht.
 */
export function useCursorListe<ItemT extends { id: string }>({
  schluessel,
  laden,
  aktiv = true,
}: {
  /** Query-Key inklusive aller Filter. */
  schluessel: readonly unknown[];
  /** Lädt eine Seite; `cursor` ist beim ersten Aufruf `undefined`. */
  laden: (cursor: string | undefined) => Promise<Seite<ItemT>>;
  aktiv?: boolean;
}) {
  const abfrage = useInfiniteQuery({
    queryKey: schluessel,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => laden(pageParam),
    getNextPageParam: (letzte: Seite<ItemT>) => letzte.next_cursor ?? undefined,
    enabled: aktiv,
  });

  return {
    eintraege: eintraegeAus(abfrage.data?.pages),
    laedt: abfrage.isPending,
    fehlgeschlagen: abfrage.isError,
    geladen: abfrage.isSuccess,
    hatWeitere: abfrage.hasNextPage,
    laedtWeitere: abfrage.isFetchingNextPage,
    weitereLaden: () => void abfrage.fetchNextPage(),
    erneutVersuchen: () => void abfrage.refetch(),
  };
}
