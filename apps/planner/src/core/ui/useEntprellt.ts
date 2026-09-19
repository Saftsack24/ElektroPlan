import { useEffect, useState } from "react";

/**
 * Verzoegert einen Wert, bis er sich eine Weile nicht mehr geaendert hat.
 *
 * Damit feuert ein Suchfeld nicht bei jedem Tastendruck eine Anfrage. Die
 * Wartezeit ist kurz genug, dass sich die Suche unmittelbar anfuehlt, und
 * lang genug, dass ein getipptes Wort eine Anfrage erzeugt und nicht acht.
 */
export function useEntprellt<WertT>(wert: WertT, millisekunden = 300): WertT {
  const [verzoegert, setVerzoegert] = useState(wert);

  useEffect(() => {
    const zeitgeber = setTimeout(() => setVerzoegert(wert), millisekunden);
    return () => clearTimeout(zeitgeber);
  }, [wert, millisekunden]);

  return verzoegert;
}
