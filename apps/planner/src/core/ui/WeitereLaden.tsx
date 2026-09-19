/**
 * Bedienung fuer cursorbasiertes Nachladen.
 *
 * Die API liefert einen undurchsichtigen Cursor, keine Seitenzahlen
 * (docs/api.md, Abschnitt 4). Deshalb gibt es bewusst **keine**
 * Seitennummern in der Oberflaeche - sie waeren eine Behauptung, die die
 * Schnittstelle nicht deckt. Kein Infinite Scrolling: Ein Knopf ist
 * vorhersehbar, per Tastatur bedienbar und ohne Scroll-Listener.
 */
export function WeitereLaden({
  sichtbar,
  laedt,
  anzahl,
  onLaden,
}: {
  sichtbar: boolean;
  laedt: boolean;
  anzahl: number;
  onLaden: () => void;
}) {
  if (!sichtbar) {
    return anzahl > 0 ? (
      <p className="muted">Alle {anzahl} Einträge geladen.</p>
    ) : null;
  }
  return (
    <div className="nachladen">
      <button
        type="button"
        className="button button--ghost"
        disabled={laedt}
        onClick={onLaden}
      >
        {laedt ? "Wird geladen ..." : "Weitere laden"}
      </button>
      <span className="muted">{anzahl} Einträge geladen</span>
    </div>
  );
}
