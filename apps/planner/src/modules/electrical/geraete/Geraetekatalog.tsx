import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { Dialog, DialogAktionen } from "../../../core/ui/Dialog";
import { Marke } from "../../../core/ui/Marke";
import { useMasse } from "../../../core/ui/masseinheit";
import { eingabefeld, knopf, meldungsflaeche } from "../../../core/ui/stil";
import { useKompakt } from "../arbeitsflaeche/kompakt";
import type { Montageflaeche } from "../editor/entwurf";
import type { Geraetekategorie, Geraetetyp, Geraetetypen } from "./katalog";
import { FLAECHE_LABEL, KATEGORIE_LABEL, KATEGORIEN, erlaubt } from "./katalog";
import { Geraetesymbol } from "./symbole";

/**
 * Gerätekatalog als Dialog (Phase 6c, K1, `docs/geraetekatalog-design.md` §2).
 *
 * Liest ausschließlich den Katalog des Servers (`GET …/device-types`) – keine zweite
 * Typenliste. Der Dialog wählt nur einen Typ: Gesetzt wird mit der vorhandenen Platzierung
 * der Wand- bzw. Deckenansicht, gespeichert mit dem Raumentwurf. Er speichert nichts.
 *
 * * `platzieren`: frei wählbare, aktive Typen; auf einer festgelegten Fläche sind unpassende
 *   Typen sichtbar, aber nicht platzierbar (mit Grund).
 * * `typ`: „Typ ändern …“ eines vorhandenen Geräts – nur Typen seiner Fläche; ein
 *   deaktivierter Bestandstyp bleibt als „aktueller Typ“ sichtbar, wird aber nie neu angeboten.
 * * Die Verteilung ist keine Kachel: „Verteilung platzieren …“ führt in den VP-Ablauf.
 *
 * Kategorien und Bezeichnungen kommen aus den Daten; eine unbekannte Kategorie erscheint mit
 * ihrem Schlüssel, damit spätere Typen (K2) ohne Umbau sichtbar sind.
 */
export type Katalogmodus =
  | { readonly art: "platzieren"; readonly flaeche: Montageflaeche | null; readonly start: string | null }
  | { readonly art: "typ"; readonly flaeche: Montageflaeche; readonly aktuell: string };

/** Einstieg in „Verteilung platzieren …“ (VP) – nur wo ein Platzieren möglich ist. */
export interface Verteilungsangebot {
  readonly verteilungen: readonly { readonly id: string; readonly code: string; readonly name: string }[];
  /** Warum gerade keine Verteilung platziert werden kann – sonst `null`. */
  readonly gesperrt: string | null;
  readonly onWahl: (boardId: string) => void;
}

const VERTEILUNG = "verteilung";
const ALLE = "alle";

/** Weitere Suchbegriffe je Kategorie – Alltagswörter neben den Bezeichnungen des Katalogs. */
const SUCHBEGRIFFE: Partial<Record<Geraetekategorie, string>> = {
  socket: "steckdose dose schuko anschluss",
  switch: "schalter taster lichtschalter",
  light: "leuchte lampe licht auslass strahler",
  data: "netzwerk daten lan datendose rj45",
  junction: "abzweigdose verbindungsdose dose",
};

const FLAECHE_KURZ: Record<Montageflaeche, string> = {
  wall_interior: "Wand",
  wall_exterior: "außen",
  ceiling: "Decke",
};

function flaechenVon(typ: Geraetetyp): Montageflaeche[] {
  return (["wall_interior", "wall_exterior", "ceiling"] as const).filter((f) => erlaubt(typ, f));
}

function kategorieLabel(kategorie: string): string {
  return (KATEGORIE_LABEL as Record<string, string | undefined>)[kategorie] ?? kategorie;
}

function normalisiert(text: string): string {
  return text.toLocaleLowerCase("de").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
}

/** Grund, warum ein Typ auf der gewählten Fläche nicht platzierbar ist – sonst `null`. */
export function flaechengrund(typ: Geraetetyp, flaeche: Montageflaeche | null): string | null {
  if (flaeche === null || erlaubt(typ, flaeche)) return null;
  const moeglich = flaechenVon(typ).map((f) => FLAECHE_LABEL[f]);
  return `Auf „${FLAECHE_LABEL[flaeche]}“ nicht vorgesehen – nur ${moeglich.length === 0 ? "keine Fläche" : moeglich.join(", ")}.`;
}

export function Geraetekatalog({
  typen,
  modus,
  onWahl,
  onClose,
  verteilung,
}: {
  typen: Geraetetypen;
  modus: Katalogmodus;
  /** Übernimmt den Typ; liefert einen Grund, wenn das nicht ging – der Dialog bleibt dann offen. */
  onWahl: (key: string) => string | undefined;
  onClose: () => void;
  verteilung?: Verteilungsangebot | undefined;
}) {
  const masse = useMasse();
  const kompakt = useKompakt();
  const typModus = modus.art === "typ";
  const flaeche = modus.flaeche;
  const aktuell = modus.art === "typ" ? modus.aktuell : null;

  // Angebot: aktive, frei wählbare Typen; im Typmodus nur die der Fläche und der aktuelle Typ.
  const angebot = useMemo(() => {
    const liste = [...typen.values()].filter((t) => t.is_active && t.category !== "distribution" && (!typModus || flaeche === null || erlaubt(t, flaeche)));
    const bestand = aktuell === null ? undefined : typen.get(aktuell);
    if (bestand !== undefined && !liste.includes(bestand)) liste.push(bestand);
    return liste.sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, "de"));
  }, [typen, typModus, flaeche, aktuell]);

  const kategorien = useMemo(() => {
    const vorhanden = new Set(angebot.map((t) => t.category as string));
    const bekannt = KATEGORIEN.filter((k) => vorhanden.has(k)) as string[];
    return [...bekannt, ...[...vorhanden].filter((k) => !bekannt.includes(k)).sort()];
  }, [angebot]);

  const [suche, setSuche] = useState("");
  const [kategorie, setKategorie] = useState<string>(ALLE);
  const startwahl = modus.art === "typ" ? modus.aktuell : modus.start;
  const [gewaehlt, setGewaehlt] = useState<string | null>(
    startwahl !== null && angebot.some((t) => t.key === startwahl) ? startwahl : (angebot.find((t) => flaechengrund(t, flaeche) === null)?.key ?? null),
  );
  const [fehler, setFehler] = useState<string | null>(null);
  const kachelnRef = useRef<HTMLDivElement>(null);

  const woerter = normalisiert(suche).split(/\s+/).filter((w) => w !== "");
  const sichtbar =
    kategorie === VERTEILUNG
      ? []
      : angebot.filter((t) => {
          if (kategorie !== ALLE && t.category !== kategorie) return false;
          if (woerter.length === 0) return true;
          const text = normalisiert(
            [t.label, kategorieLabel(t.category), SUCHBEGRIFFE[t.category] ?? "", ...flaechenVon(t).map((f) => FLAECHE_LABEL[f])].join(" "),
          );
          return woerter.every((w) => text.includes(w));
        });
  const typ = gewaehlt === null ? undefined : sichtbar.find((t) => t.key === gewaehlt);
  // Genau eine Kachel ist per Tab erreichbar: die gewählte, sonst die erste (Roving Tabindex).
  const fokusIndex = Math.max(0, sichtbar.findIndex((t) => t.key === gewaehlt));
  const grund = typ === undefined ? null : flaechengrund(typ, flaeche);
  const istAktuell = typ !== undefined && typ.key === aktuell;
  const nichtMehrAngeboten = typ !== undefined && !typ.is_active;
  const uebernehmbar = typ !== undefined && grund === null && !nichtMehrAngeboten && !istAktuell;
  const aktion = typModus ? "Typ übernehmen" : "Platzieren";

  const uebernehmen = () => {
    if (typ === undefined || !uebernehmbar) return;
    const problem = onWahl(typ.key);
    setFehler(problem ?? null);
  };

  const waehlen = (key: string) => {
    setGewaehlt(key);
    setFehler(null);
  };

  /** Pfeiltasten wandern durch die Kacheln, Pos1/Ende springen, Enter übernimmt. */
  const kachelTaste = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const ziel =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? Math.min(index + 1, sichtbar.length - 1)
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? Math.max(index - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? sichtbar.length - 1
              : null;
    if (ziel !== null) {
      event.preventDefault();
      const t = sichtbar[ziel];
      if (t === undefined) return;
      waehlen(t.key);
      kachelnRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[ziel]?.focus();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      uebernehmen();
    }
  };

  const kurzangabe = (t: Geraetetyp) => {
    const flaechen = flaechenVon(t);
    const hoehe = t.default_center_height_mm !== null && flaechen.some((f) => f !== "ceiling") ? ` · ${masse.anzeigen(t.default_center_height_mm)}` : "";
    return `${flaechen.map((f) => FLAECHE_KURZ[f]).join(", ")}${hoehe}`;
  };

  const kategorieWahl = (k: string) => {
    setKategorie(k);
    setFehler(null);
  };
  const anzahl = (k: string) => angebot.filter((t) => t.category === k).length;

  const kategorienListe = kompakt ? (
    <label className="flex flex-col gap-1 text-label text-muted" htmlFor="katalog-kategorie">
      Kategorie
      <select id="katalog-kategorie" className={eingabefeld()} value={kategorie} onChange={(e) => kategorieWahl(e.target.value)}>
        <option value={ALLE}>Alle ({angebot.length})</option>
        {kategorien.map((k) => (
          <option key={k} value={k}>
            {kategorieLabel(k)} ({anzahl(k)})
          </option>
        ))}
        {verteilung !== undefined && <option value={VERTEILUNG}>Verteilung platzieren …</option>}
      </select>
    </label>
  ) : (
    <nav aria-label="Kategorien" className="flex flex-col gap-1">
      {[ALLE, ...kategorien].map((k) => (
        <button
          key={k}
          type="button"
          className={`${knopf(kategorie === k ? "gewaehlt" : "einfach", { klein: true })} flex justify-between gap-2 text-left text-fg`}
          aria-pressed={kategorie === k}
          onClick={() => kategorieWahl(k)}
        >
          <span>{k === ALLE ? "Alle" : kategorieLabel(k)}</span>
          <span className="text-muted">{k === ALLE ? angebot.length : anzahl(k)}</span>
        </button>
      ))}
      {verteilung !== undefined && (
        <button
          type="button"
          className={`${knopf(kategorie === VERTEILUNG ? "gewaehlt" : "einfach", { klein: true })} mt-1 text-left text-fg`}
          aria-pressed={kategorie === VERTEILUNG}
          onClick={() => kategorieWahl(VERTEILUNG)}
        >
          Verteilung platzieren …
        </button>
      )}
    </nav>
  );

  return (
    <Dialog
      offen
      titel={typModus ? "Gerätetyp ändern" : "Gerät auswählen"}
      beschreibung={
        typModus
          ? `Nur Typen für „${FLAECHE_LABEL[modus.flaeche]}“. Lage, Zuordnung und Leitungen werden wie bei jeder Änderung geprüft; gespeichert wird mit dem Raum.`
          : flaeche === null
            ? "Danach im Grundriss eine Wand bzw. einen Raum wählen – gesetzt wird in der Wand- oder Deckenansicht."
            : `Fläche: ${FLAECHE_LABEL[flaeche]}. Nach „Platzieren“ in die Fläche klicken; gespeichert wird mit dem Raum.`
      }
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        <input
          type="search"
          className={eingabefeld()}
          aria-label="Gerät suchen"
          placeholder="Suchen: Name, Kategorie, Fläche …"
          value={suche}
          onChange={(e) => {
            setSuche(e.target.value);
            if (kategorie === VERTEILUNG) setKategorie(ALLE);
          }}
          data-autofocus
        />
        <div className={kompakt ? "flex flex-col gap-3" : "grid grid-cols-[11rem_minmax(0,1fr)] gap-4"}>
          {kategorienListe}
          {kategorie === VERTEILUNG && verteilung !== undefined ? (
            <section aria-label="Verteilung platzieren" className="flex flex-col gap-2 text-small">
              <p className="m-0 text-muted">
                Eine Verteilung ist kein freies Gerät: Ihre Lage entsteht zusammen mit der Verteilung („Im Plan platzieren“). Platzierte
                Verteilungen ändern Sie in der Ansicht „Stromkreise“.
              </p>
              {verteilung.gesperrt !== null ? (
                <p className={meldungsflaeche("schlicht")} role="status">
                  {verteilung.gesperrt}
                </p>
              ) : verteilung.verteilungen.length === 0 ? (
                <p className="m-0">Alle Verteilungen dieses Gebäudes sind im Plan platziert.</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {verteilung.verteilungen.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <strong>{v.code}</strong> · {v.name}
                      </span>
                      <button type="button" className={knopf("neutral", { klein: true })} aria-label={`Verteilung ${v.code} platzieren`} onClick={() => verteilung.onWahl(v.id)}>
                        Platzieren …
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <div className="flex min-w-0 flex-col gap-3">
              {sichtbar.length === 0 ? (
                <p className="m-0 text-muted">Kein Gerätetyp passt zur Suche.</p>
              ) : (
                <div
                  ref={kachelnRef}
                  role="radiogroup"
                  aria-label="Gerätetypen"
                  className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2"
                >
                  {sichtbar.map((t, i) => {
                    const ausgewaehlt = t.key === gewaehlt;
                    const nicht = flaechengrund(t, flaeche) !== null || !t.is_active;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        role="radio"
                        aria-checked={ausgewaehlt}
                        tabIndex={i === fokusIndex ? 0 : -1}
                        aria-describedby={nicht ? `katalog-grund-${t.key}` : undefined}
                        className={`flex min-h-[5.5rem] cursor-pointer flex-col items-center justify-center gap-1 rounded-ep border p-2 text-center text-fg ${
                          ausgewaehlt ? "border-selected bg-selected-soft" : "border-line bg-surface"
                        } ${nicht ? "opacity-60" : ""}`}
                        onClick={() => waehlen(t.key)}
                        onDoubleClick={() => {
                          waehlen(t.key);
                          if (!nicht && t.key !== aktuell) setFehler(onWahl(t.key) ?? null);
                        }}
                        onKeyDown={(e) => kachelTaste(e, i)}
                        data-testid={`katalog-kachel-${t.key}`}
                      >
                        <Geraetesymbol typ={t} groesse={28} />
                        <span className="text-small font-semibold">{t.label}</span>
                        <span className="text-[0.78rem] text-muted">{kurzangabe(t)}</span>
                        {t.key === aktuell && <span className="text-[0.78rem]">aktuell</span>}
                        {nicht && (
                          <span id={`katalog-grund-${t.key}`} className="text-[0.78rem] text-muted">
                            {!t.is_active ? "nicht mehr angeboten" : `nur ${flaechenVon(t).map((f) => FLAECHE_KURZ[f]).join(", ")}`}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {typ !== undefined && (
                <section aria-label="Details" className="flex flex-col gap-1 rounded-ep border border-line p-3 text-small" data-testid="katalog-details">
                  <div className="flex flex-wrap items-center gap-2">
                    <Geraetesymbol typ={typ} groesse={24} />
                    <strong>{typ.label}</strong>
                    <span className="text-muted">{kategorieLabel(typ.category)}</span>
                    {istAktuell && <Marke>aktueller Typ</Marke>}
                    {nichtMehrAngeboten && <Marke art="warnung">nicht mehr angeboten</Marke>}
                  </div>
                  <p className="m-0">
                    Montage: {flaechenVon(typ).map((f) => FLAECHE_LABEL[f]).join(", ")}
                    {typ.default_center_height_mm !== null && flaechenVon(typ).some((f) => f !== "ceiling")
                      ? ` · Standardhöhe Mitte ${masse.anzeigen(typ.default_center_height_mm)}`
                      : ""}
                  </p>
                  <p className="m-0 text-[0.8rem] text-muted">
                    Planungsmaß {masse.anzeigen(typ.width_mm)} × {masse.anzeigen(typ.height_mm)} – Prüfmaß, keine Herstellerangabe.
                  </p>
                  {grund !== null && <p className="m-0 text-danger">{grund}</p>}
                  {nichtMehrAngeboten && !istAktuell && <p className="m-0 text-danger">Dieser Typ wird für neue Geräte nicht mehr angeboten.</p>}
                  {nichtMehrAngeboten && istAktuell && (
                    <p className="m-0 text-muted">Bestand: Das Gerät behält diesen Typ, bis Sie einen anderen übernehmen.</p>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
        {fehler !== null && (
          <p className={meldungsflaeche()} role="alert">
            Nicht übernommen: {fehler}
          </p>
        )}
        <DialogAktionen>
          {kategorie !== VERTEILUNG && (
            <button type="button" className={knopf("primaer")} disabled={!uebernehmbar} onClick={uebernehmen}>
              {aktion}
            </button>
          )}
          <button type="button" className={knopf()} onClick={onClose}>
            Abbrechen
          </button>
        </DialogAktionen>
      </div>
    </Dialog>
  );
}
