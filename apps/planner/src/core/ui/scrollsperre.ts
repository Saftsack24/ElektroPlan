/**
 * Sperrt das Scrollen der Seite hinter modalen Dialogen - referenzgezählt.
 *
 * Ein natives `<dialog>` hält Fokus und Eingaben fest, nicht aber das
 * Scrollen der Seite dahinter. Mehrere Dialoge können sich überlappen (etwa
 * eine Rückfrage über einem Formular) oder schnell nacheinander öffnen: Erst
 * wenn der **letzte** freigibt, wird der ursprüngliche Zustand
 * wiederhergestellt - samt Scrollposition. Jede Freigabe wirkt genau einmal;
 * ein doppelter Aufruf (StrictMode) verschiebt den Zähler nicht.
 */
let anzahl = 0;
let vorher: { overflow: string; scrollY: number } | null = null;

export function seitenScrollSperren(): () => void {
  const wurzel = document.documentElement;
  if (anzahl === 0) {
    vorher = { overflow: wurzel.style.overflow, scrollY: window.scrollY };
    wurzel.style.overflow = "hidden";
  }
  anzahl += 1;

  let freigegeben = false;
  return () => {
    if (freigegeben) return;
    freigegeben = true;
    anzahl -= 1;
    if (anzahl > 0 || vorher === null) return;
    wurzel.style.overflow = vorher.overflow;
    if (window.scrollY !== vorher.scrollY) window.scrollTo(0, vorher.scrollY);
    vorher = null;
  };
}

/** Für Tests: Wie viele Dialoge sperren gerade? */
export function aktiveScrollsperren(): number {
  return anzahl;
}
