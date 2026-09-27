import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { Seite } from "../../../core/api/useCursorListe";

/**
 * Blättern mit Vor und Zurück auf Basis des Keyset-Cursors.
 *
 * Die API kennt nur „weiter ab hier" (docs/api.md, Abschnitt 4). Zurück
 * geht es deshalb über einen Stapel der bereits benutzten Cursor: Seite 3
 * ist genau die Seite, die mit dem dritten gemerkten Cursor geladen wurde.
 * Eine Seitenzahl wird nur für die Orientierung angezeigt - eine
 * Gesamtzahl gibt die API bewusst nicht her.
 *
 * Ändert sich der `schluessel` (Suche, Filter), beginnt die Liste wieder auf
 * Seite 1: Die gemerkten Cursor gehören zur alten Abfrage.
 */
export function useSeitenweise<ItemT>({
  schluessel,
  laden,
}: {
  schluessel: readonly unknown[];
  laden: (cursor: string | undefined) => Promise<Seite<ItemT>>;
}) {
  const kennung = JSON.stringify(schluessel);
  const [stapel, setStapel] = useState<{ kennung: string; cursor: (string | undefined)[] }>({
    kennung,
    cursor: [undefined],
  });
  // Zurücksetzen während des Renderns statt in einem Effekt: So erscheint
  // nie eine Seite 3 der neuen Suche mit dem Cursor der alten.
  const aktuell = stapel.kennung === kennung ? stapel.cursor : [undefined];
  if (stapel.kennung !== kennung) {
    setStapel({ kennung, cursor: [undefined] });
  }
  const cursor = aktuell[aktuell.length - 1];

  const abfrage = useQuery({
    queryKey: [...schluessel, "seite", cursor ?? null],
    queryFn: () => laden(cursor),
    placeholderData: keepPreviousData,
  });

  const naechster = abfrage.data?.has_more ? (abfrage.data.next_cursor ?? undefined) : undefined;

  return {
    seite: aktuell.length,
    eintraege: abfrage.data?.items ?? [],
    laedt: abfrage.isPending,
    wechselt: abfrage.isFetching && !abfrage.isPending,
    fehlgeschlagen: abfrage.isError,
    geladen: abfrage.isSuccess,
    hatWeiter: naechster !== undefined,
    hatZurueck: aktuell.length > 1,
    weiter: () => {
      if (naechster === undefined) return;
      setStapel({ kennung, cursor: [...aktuell, naechster] });
    },
    zurueck: () => {
      if (aktuell.length <= 1) return;
      setStapel({ kennung, cursor: aktuell.slice(0, -1) });
    },
    erneutVersuchen: () => void abfrage.refetch(),
  };
}
