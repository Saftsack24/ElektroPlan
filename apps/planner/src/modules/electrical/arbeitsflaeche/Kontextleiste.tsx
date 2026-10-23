import type { ReactNode } from "react";

import { AKTION } from "../../../core/ui/aktionssymbole";
import { SymbolKnopf } from "../../../core/ui/SymbolKnopf";
import { knopf, meldungsflaeche } from "../../../core/ui/stil";
import type { Leitungskontext } from "../leitung/kontext";
import { knopftext, useKompakt } from "./kompakt";

/**
 * Rückgängig/Wiederholen der Arbeitsfläche (Phase 6c.0): gebogene Pfeile aus dem
 * Icon-System, Kürzel im Hinweis und in `aria-keyshortcuts`. Ein Paar je Fläche –
 * es wirkt auf den gerade aktiven Entwurf (Leitung oder Raum).
 */
export function RueckgaengigKnoepfe({
  kannZurueck,
  kannVor,
  onZurueck,
  onVor,
  bezug,
}: {
  kannZurueck: boolean;
  kannVor: boolean;
  onZurueck: () => void;
  onVor: () => void;
  /** Wofür die Schritte gelten, etwa „im Leitungsentwurf“ – steht im Gruppennamen. */
  bezug?: string;
}) {
  const zusatz = bezug === undefined ? "" : ` ${bezug}`;
  return (
    <span className="inline-flex items-center gap-1" role="group" aria-label={`Rückgängig und Wiederholen${zusatz}`}>
      <SymbolKnopf
        icon={AKTION.rueckgaengig}
        label="Rückgängig"
        kuerzel="Strg+Z"
        ariaKuerzel="Control+Z"
        gesperrt={!kannZurueck}
        gesperrtGrund="nichts rückgängig zu machen"
        onClick={onZurueck}
      />
      <SymbolKnopf
        icon={AKTION.wiederholen}
        label="Wiederholen"
        kuerzel="Strg+Y oder Strg+Umschalt+Z"
        ariaKuerzel="Control+Y Control+Shift+Z"
        gesperrt={!kannVor}
        gesperrtGrund="nichts zu wiederholen"
        onClick={onVor}
      />
    </span>
  );
}

/**
 * Fehler oder Konflikt eines Leitungs- bzw. Zuordnungsentwurfs, kompakt (Phase 6c.0).
 * Nur zeigen, solange das Eigenschaftenpanel zu ist – dort steht die ausführliche
 * Meldung samt Entscheidung; „Details“ öffnet es.
 */
export function Entwurfsfehler({ k, onDetails }: { k: Leitungskontext | undefined; onDetails: () => void }) {
  if (k === undefined) return null;
  const e = k.planung.entwurf;
  const text =
    e !== null && e.fehler !== null
      ? `${e.status === "konflikt" ? "Konflikt – Leitung nicht gespeichert" : "Leitung nicht gespeichert"}: ${e.fehler.meldung}`
      : k.zuordnung.entwurf !== null && k.zuordnung.fehler !== null
        ? `${k.zuordnung.konflikt ? "Konflikt – Zuordnung nicht gespeichert" : "Zuordnung nicht gespeichert"}: ${k.zuordnung.fehler}`
        : null;
  if (text === null) return null;
  return (
    <div className={`${meldungsflaeche()} flex w-full flex-wrap items-center gap-2 text-[0.88rem]`} role="alert" data-testid="entwurfsfehler">
      <span className="mr-auto">{text}</span>
      <button type="button" className={knopf("neutral", { klein: true })} onClick={onDetails}>
        Details und Entscheidung
      </button>
    </div>
  );
}

/**
 * Offener Leitungs- oder Zuordnungsentwurf in der Kontextleiste der Wand- und
 * Deckenansicht (Phase 6c.0). Solange das Eigenschaftenpanel zu ist, stehen hier
 * Speichern und Schließen sowie Fehler und Konflikte – sie dürfen hinter dem
 * eingeklappten Panel nicht unsichtbar werden. Ist das Panel offen, gilt dessen
 * ausführliches Formular; die Leiste nennt dann nur den Stand.
 */
export function Entwurfsleiste({
  k,
  panelOffen,
  onDetails,
  nachSchliessen,
}: {
  k: Leitungskontext | undefined;
  panelOffen: boolean;
  /** Öffnet das Eigenschaftenpanel am Entwurf. */
  onDetails: () => void;
  nachSchliessen?: () => void;
}) {
  const kompakt = useKompakt();
  if (k === undefined) return null;
  const p = k.planung;
  const e = p.entwurf;
  const z = k.zuordnung;
  const kurz = (voll: string, knapp: string) => knopftext(kompakt, voll, knapp);

  if (e !== null) {
    const stand =
      e.status === "speichert"
        ? "wird gespeichert …"
        : e.status === "konflikt"
          ? "Konflikt – nicht gespeichert"
          : e.fehler !== null
            ? "nicht gespeichert"
            : p.ungespeichert
              ? "ungespeichert"
              : "gespeichert";
    return (
      <Leiste testId="entwurfsleiste-leitung" text={`Leitungsentwurf: ${stand}`}>
        {!panelOffen && (
          <>
            {p.darfLeitungen && (
              <button
                type="button"
                className={knopf("primaer", { klein: true })}
                disabled={!p.ungespeichert || e.status === "speichert"}
                onClick={() => void p.speichern()}
                {...kurz("Leitung speichern", "Speichern")}
              />
            )}
            <button
              type="button"
              className={knopf("neutral", { klein: true })}
              disabled={e.status === "speichert"}
              onClick={() => void k.leitungSchliessen().then((ok) => ok && nachSchliessen?.())}
              {...kurz("Entwurf schließen", "Schließen")}
            />
            <button type="button" className={knopf("neutral", { klein: true })} onClick={onDetails} {...kurz("Angaben und Wegpunkte", "Angaben")} />
            <Entwurfsfehler k={k} onDetails={onDetails} />
          </>
        )}
      </Leiste>
    );
  }

  if (z.entwurf === null) return null;
  return (
    <Leiste testId="entwurfsleiste-zuordnung" text={`Gerätezuordnung: ${z.speichert ? "wird gespeichert …" : z.offen ? "ungespeichert" : "gespeichert"}`}>
      {!panelOffen && (
        <>
          {p.darfStromkreise && (
            <button type="button" className={knopf("primaer", { klein: true })} disabled={!z.offen || z.speichert} onClick={() => void z.speichern()}>
              Zuordnung speichern
            </button>
          )}
          <button type="button" className={knopf("neutral", { klein: true })} onClick={() => void k.zuordnungSchliessen().then((ok) => ok && nachSchliessen?.())}>
            Zuordnung schließen
          </button>
          <button type="button" className={knopf("neutral", { klein: true })} onClick={onDetails}>
            Zugeordnete Geräte
          </button>
          <Entwurfsfehler k={k} onDetails={onDetails} />
        </>
      )}
    </Leiste>
  );
}

function Leiste({ testId, text, children }: { testId: string; text: string; children: ReactNode }) {
  return (
    <div className={`${meldungsflaeche("schlicht")} flex flex-wrap items-center gap-2 text-small`} data-testid={testId}>
      <strong className="mr-auto">{text}</strong>
      {children}
    </div>
  );
}

/** Rückmeldung des Raumentwurfs (Speicherfehler, Konflikt) – kompakt, unabhängig vom Panel sichtbar. */
export function Raumrueckmeldung({
  fehler,
  konflikt,
  onSchliessen,
  onServerstand,
}: {
  fehler: { readonly meldung: string; readonly eintraege: readonly { readonly code: string; readonly meldung: string }[] } | null;
  konflikt: boolean;
  onSchliessen: () => void;
  /** Nur wo der Serverstand ausdrücklich geladen werden kann (Grundriss). */
  onServerstand?: () => void;
}) {
  if (fehler === null) return null;
  return (
    <div className={`${meldungsflaeche()} flex flex-col gap-1 text-[0.88rem]`} role="alert" data-testid="raum-rueckmeldung">
      <p className="m-0">{fehler.meldung}</p>
      {fehler.eintraege.length > 0 && (
        <ul className="m-0 pl-[18px]">
          {fehler.eintraege.map((e, i) => (
            <li key={`${e.code}-${i}`}>{e.meldung}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {konflikt && onServerstand !== undefined && (
          <button type="button" className={knopf("neutral", { klein: true })} onClick={onServerstand}>
            Serverstand laden (lokale Änderungen verwerfen)
          </button>
        )}
        <button type="button" className={knopf("neutral", { klein: true })} onClick={onSchliessen}>
          {konflikt ? "Entwurf vorerst behalten" : "Hinweis schließen"}
        </button>
      </div>
    </div>
  );
}
