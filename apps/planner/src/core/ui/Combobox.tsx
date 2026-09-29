import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";

export type Comboboxzustand = "laedt" | "fehler" | "bereit";

/** Größte Höhe der Vorschlagsliste; darüber scrollt nur die Liste selbst. */
const MAX_HOEHE = 280;
const MIN_HOEHE = 120;
const ABSTAND = 4;

/**
 * Wo die schwebende Liste steht - reine Funktion, damit prüfbar.
 *
 * Unter dem Feld, wenn dort genug Platz ist, sonst darüber; nie breiter als
 * das Fenster und nie außerhalb davon.
 */
export function listenposition(
  feld: { top: number; bottom: number; left: number; width: number },
  fenster: { breite: number; hoehe: number },
): CSSProperties {
  const unten = fenster.hoehe - feld.bottom - ABSTAND * 2;
  const oben = feld.top - ABSTAND * 2;
  const nachOben = unten < Math.min(MAX_HOEHE, MIN_HOEHE * 1.5) && oben > unten;
  const verfuegbar = Math.max(MIN_HOEHE, Math.min(MAX_HOEHE, nachOben ? oben : unten));
  const breite = Math.min(Math.max(feld.width, 200), fenster.breite - ABSTAND * 2);
  const links = Math.min(Math.max(ABSTAND, feld.left), fenster.breite - breite - ABSTAND);
  return {
    position: "fixed",
    left: links,
    width: breite,
    maxHeight: verfuegbar,
    ...(nachOben ? { bottom: fenster.hoehe - feld.top + ABSTAND } : { top: feld.bottom + ABSTAND }),
  };
}

/**
 * Suchfeld mit schwebender Vorschlagsliste (WAI-ARIA-Muster „Combobox mit
 * Listbox").
 *
 * **Die Liste liegt außerhalb des Formularflusses.** Sie ist `position:
 * fixed` am Eingabefeld verankert: Öffnen, Laden und Aktualisieren der
 * Vorschläge verändern weder die Höhe eines umgebenden Dialogs noch die Lage
 * anderer Felder, und sie erzeugen keinen zweiten Scrollbereich im Dialog.
 * Nur eine lange Liste scrollt in sich. Ein Portal wäre falsch: Ein modaler
 * `<dialog>` liegt im Top Layer, ein Portal nach `body` läge darunter.
 *
 * Tastatur: Pfeil ab/auf bewegt die Markierung (und öffnet die Liste),
 * Enter wählt, Escape schließt die Liste - ein offener Dialog bleibt dabei
 * offen. Der Fokus bleibt immer im Eingabefeld (`aria-activedescendant`).
 *
 * Die Komponente sucht nicht selbst: Eingabetext, Zustand und Optionen
 * kommen von außen.
 */
export function Combobox<OptionT>({
  id,
  label,
  eingabe,
  onEingabe,
  optionen,
  zustand,
  schluessel,
  darstellen,
  onWaehlen,
  leerText,
  fehlerText = "Die Suche ist fehlgeschlagen.",
  onErneut,
  fusszeile,
  platzhalter,
  required = false,
  disabled = false,
  fehler,
  hinweis,
}: {
  id: string;
  label: string;
  eingabe: string;
  onEingabe: (text: string) => void;
  optionen: readonly OptionT[];
  zustand: Comboboxzustand;
  schluessel: (option: OptionT) => string;
  darstellen: (option: OptionT) => ReactNode;
  onWaehlen: (option: OptionT) => void;
  leerText: string;
  fehlerText?: string;
  onErneut?: () => void;
  /** Zusatzzeile unter den Vorschlägen, etwa „weitere Treffer - bitte eingrenzen". */
  fusszeile?: ReactNode;
  platzhalter?: string;
  required?: boolean;
  disabled?: boolean;
  fehler?: string | undefined;
  hinweis?: string | undefined;
}) {
  const feld = useRef<HTMLInputElement>(null);
  const [offen, setOffen] = useState(false);
  const [aktiv, setAktiv] = useState(-1);
  const [lage, setLage] = useState<CSSProperties>({ position: "fixed", visibility: "hidden" });

  const listeId = `${id}-vorschlaege`;
  const optionId = (index: number) => `${id}-vorschlag-${index}`;
  const fehlerId = `${id}-fehler`;
  const hinweisId = `${id}-hinweis`;

  // Neue Vorschläge: keine alte Markierung auf einen anderen Eintrag übertragen.
  // Verglichen wird über die Schlüssel, nicht über die Array-Identität.
  const optionsKennung = optionen.map(schluessel).join("|");
  useEffect(() => setAktiv(-1), [optionsKennung]);

  const ausrichten = useCallback(() => {
    const element = feld.current;
    if (element === null) return;
    const r = element.getBoundingClientRect();
    setLage(listenposition(r, { breite: window.innerWidth, hoehe: window.innerHeight }));
  }, []);

  useLayoutEffect(() => {
    if (!offen) return undefined;
    ausrichten();
    let rahmen = 0;
    const spaeter = () => {
      cancelAnimationFrame(rahmen);
      rahmen = requestAnimationFrame(ausrichten);
    };
    // Capture: auch das Scrollen eines Dialoginhalts verschiebt das Feld.
    window.addEventListener("scroll", spaeter, true);
    window.addEventListener("resize", spaeter);
    return () => {
      cancelAnimationFrame(rahmen);
      window.removeEventListener("scroll", spaeter, true);
      window.removeEventListener("resize", spaeter);
    };
  }, [offen, ausrichten]);

  // Geschlossen gibt es keine Markierung - beim nächsten Öffnen beginnt sie oben.
  const schliessen = () => {
    setOffen(false);
    setAktiv(-1);
  };

  useEffect(() => {
    if (disabled) setOffen(false);
  }, [disabled]);

  const waehlen = (option: OptionT) => {
    onWaehlen(option);
    schliessen();
  };

  const tasten = (event: KeyboardEvent<HTMLInputElement>) => {
    const anzahl = zustand === "bereit" ? optionen.length : 0;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!offen) setOffen(true);
        if (anzahl > 0) setAktiv((i) => (i + 1) % anzahl);
        return;
      case "ArrowUp":
        event.preventDefault();
        if (!offen) setOffen(true);
        if (anzahl > 0) setAktiv((i) => (i <= 0 ? anzahl - 1 : i - 1));
        return;
      case "Home":
        if (offen && anzahl > 0) {
          event.preventDefault();
          setAktiv(0);
        }
        return;
      case "End":
        if (offen && anzahl > 0) {
          event.preventDefault();
          setAktiv(anzahl - 1);
        }
        return;
      case "Enter": {
        if (!offen) return;
        // Nie das umgebende Formular absenden, solange Vorschläge offen sind.
        event.preventDefault();
        const option = aktiv >= 0 ? optionen[aktiv] : undefined;
        if (option !== undefined) waehlen(option);
        return;
      }
      case "Escape":
        if (!offen) return;
        // Nur die Liste schließen - nicht den Dialog, in dem das Feld steht.
        event.preventDefault();
        event.stopPropagation();
        schliessen();
        return;
      case "Tab":
        schliessen();
        return;
    }
  };

  const beschrieben = [fehler ? fehlerId : null, hinweis !== undefined ? hinweisId : null]
    .filter((teil) => teil !== null)
    .join(" ");
  const aktiveOption = offen && aktiv >= 0 && zustand === "bereit" ? optionId(aktiv) : undefined;

  return (
    <div className="field combobox">
      <label className="field__label" htmlFor={id}>
        {label}
        {required ? " *" : ""}
      </label>
      <input
        ref={feld}
        id={id}
        className={fehler ? "field__input field__input--fehler" : "field__input"}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={offen}
        aria-controls={listeId}
        aria-activedescendant={aktiveOption}
        aria-invalid={fehler ? true : undefined}
        aria-describedby={beschrieben || undefined}
        value={eingabe}
        disabled={disabled}
        placeholder={platzhalter}
        onChange={(event) => {
          onEingabe(event.target.value);
          setOffen(true);
        }}
        onFocus={() => setOffen(true)}
        onClick={() => setOffen(true)}
        onBlur={schliessen}
        onKeyDown={tasten}
      />
      {fehler !== undefined && (
        <span id={fehlerId} className="field__fehler" role="alert">
          {fehler}
        </span>
      )}
      {hinweis !== undefined && (
        <span id={hinweisId} className="field__hinweis">
          {hinweis}
        </span>
      )}

      {offen && (
        <div
          className="combobox__popup"
          style={lage}
          data-testid={`${id}-popup`}
          // Ein Klick in die Liste nimmt dem Feld nicht den Fokus.
          onMouseDown={(event) => event.preventDefault()}
        >
          {zustand === "laedt" && (
            <p className="combobox__status" role="status">
              Wird gesucht …
            </p>
          )}
          {zustand === "fehler" && (
            <p className="combobox__status combobox__status--fehler" role="alert">
              {fehlerText}{" "}
              {onErneut !== undefined && (
                <button type="button" className="button button--ghost" onClick={onErneut}>
                  Erneut versuchen
                </button>
              )}
            </p>
          )}
          {zustand === "bereit" && optionen.length === 0 && (
            <p className="combobox__status" role="status">
              {leerText}
            </p>
          )}
          <ul id={listeId} role="listbox" aria-label={label} className="combobox__liste">
            {zustand === "bereit" &&
              optionen.map((option, index) => (
                <li
                  key={schluessel(option)}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === aktiv}
                  className={index === aktiv ? "combobox__option combobox__option--aktiv" : "combobox__option"}
                  onMouseEnter={() => setAktiv(index)}
                  onClick={() => waehlen(option)}
                >
                  {darstellen(option)}
                </li>
              ))}
          </ul>
          {zustand === "bereit" && fusszeile !== undefined && fusszeile !== null && (
            <p className="combobox__status muted">{fusszeile}</p>
          )}
        </div>
      )}
    </div>
  );
}
