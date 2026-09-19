/**
 * Zusammenfuehren der Seiten einer cursorbasierten Liste.
 *
 * Die API liefert Keyset-Seiten (docs/api.md, Abschnitt 4). Beim Nachladen
 * duerfen keine Eintraege doppelt erscheinen - der Cursor schliesst das
 * serverseitig bereits aus, aber ein gleichzeitiger Schreibvorgang oder ein
 * doppelt ausgeloestes Nachladen soll die Liste trotzdem nicht verfaelschen.
 * Deshalb wird hier zusaetzlich ueber die ID entdoppelt.
 */
export function eintraegeAus<ItemT extends { id: string }>(
  seiten: readonly { items: ItemT[] }[] | undefined,
): ItemT[] {
  const gesehen = new Set<string>();
  const ergebnis: ItemT[] = [];
  for (const seite of seiten ?? []) {
    for (const eintrag of seite.items) {
      if (gesehen.has(eintrag.id)) continue;
      gesehen.add(eintrag.id);
      ergebnis.push(eintrag);
    }
  }
  return ergebnis;
}
