import { seitenfolge } from "./seitenfolge";
import { KNOPF_GRUND } from "./stil";

const SEITENKNOPF = `${KNOPF_GRUND} min-w-[2.4em] px-2 py-1.5 border-control bg-transparent text-fg`;
const SEITENKNOPF_AKTIV = `${KNOPF_GRUND} min-w-[2.4em] px-2 py-1.5 border-transparent bg-accent font-semibold text-on-accent`;

/**
 * Nummerierte Seitennavigation für serverseitig gezählte Listen (ADR 0017).
 *
 * Die Seitenzahlen sind echte Seiten des Servers - `total_pages` kommt aus
 * derselben Abfrage wie die Einträge. Erste/letzte, vorige/nächste Seite und
 * benachbarte Seitenzahlen, Lücken als „…". Die aktuelle Seite trägt
 * `aria-current="page"`.
 *
 * Bei höchstens einer Seite bleibt nur die Anzahl stehen - Knöpfe ohne
 * Wirkung wären Rauschen.
 */
export function Seitennavigation({
  seite,
  gesamtSeiten,
  gesamtEintraege,
  onSeite,
  wechselt = false,
  bezeichnung = "Seiten",
}: {
  seite: number;
  gesamtSeiten: number;
  gesamtEintraege: number;
  onSeite: (seite: number) => void;
  /** Eine andere Seite wird gerade geladen. */
  wechselt?: boolean;
  bezeichnung?: string;
}) {
  const anzahl =
    gesamtEintraege === 1 ? "1 Eintrag" : `${gesamtEintraege.toLocaleString("de-DE")} Einträge`;
  if (gesamtSeiten <= 1) {
    return gesamtEintraege > 0 ? <p className="m-0 text-muted">{anzahl}</p> : null;
  }

  const gehe = (ziel: number) => {
    if (ziel !== seite && ziel >= 1 && ziel <= gesamtSeiten) onSeite(ziel);
  };
  const erste = seite <= 1;
  const letzte = seite >= gesamtSeiten;

  return (
    <nav className="mt-3 flex flex-wrap items-center justify-between gap-2" aria-label={bezeichnung}>
      <p className="m-0 text-muted" aria-live="polite">
        Seite {seite} von {gesamtSeiten} · {anzahl}
        {wechselt ? " · wird geladen …" : ""}
      </p>
      <ul className="m-0 flex list-none flex-wrap items-center gap-1 p-0">
        <li>
          <button type="button" className={SEITENKNOPF} disabled={erste} onClick={() => gehe(1)} aria-label="Erste Seite">
            «
          </button>
        </li>
        <li>
          <button type="button" className={SEITENKNOPF} disabled={erste} onClick={() => gehe(seite - 1)} aria-label="Vorige Seite">
            ‹
          </button>
        </li>
        {seitenfolge(seite, gesamtSeiten).map((position, index) =>
          position === "…" ? (
            <li key={`luecke-${index}`} className="px-1 text-muted" aria-hidden="true">
              …
            </li>
          ) : (
            <li key={position}>
              <button
                type="button"
                className={position === seite ? SEITENKNOPF_AKTIV : SEITENKNOPF}
                aria-current={position === seite ? "page" : undefined}
                aria-label={`Seite ${position}`}
                onClick={() => gehe(position)}
              >
                {position}
              </button>
            </li>
          ),
        )}
        <li>
          <button type="button" className={SEITENKNOPF} disabled={letzte} onClick={() => gehe(seite + 1)} aria-label="Nächste Seite">
            ›
          </button>
        </li>
        <li>
          <button type="button" className={SEITENKNOPF} disabled={letzte} onClick={() => gehe(gesamtSeiten)} aria-label="Letzte Seite">
            »
          </button>
        </li>
      </ul>
    </nav>
  );
}
