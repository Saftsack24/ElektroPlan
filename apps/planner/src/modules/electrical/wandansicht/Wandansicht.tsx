import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, KeyboardEvent } from "react";

import { Dialog } from "../../../core/ui/Dialog";
import { useMasse } from "../../../core/ui/masseinheit";
import { KNOPF_GRUND, eingabefeld, knopf, meldungsflaeche } from "../../../core/ui/stil";
import type { EntwurfWand, Oeffnungsart, RaumImPlan } from "../editor/entwurf";
import { RASTERGROESSEN_MM } from "../editor/fang";
import type { EditorEinordnung, EditorTopologie } from "../editor/platzierung";
import { oeffnungAendern, oeffnungEntfernen } from "../editor/werkzeuge";
import type { Aktion, EditorZustand } from "../editor/zustand";
import { ANSICHT_ZURUECKSETZEN } from "../texte";
import type { Gegenseite } from "./WandEigenschaften";
import { WandEigenschaften } from "./WandEigenschaften";
import type { Ansichtsrechteck } from "./wandbezug";
import { wandbezug } from "./wandbezug";
import type { Wandseite } from "./wandbezug";
import type { AnsichtsOeffnung } from "./wandmodell";
import { wandmodell } from "./wandmodell";
import { lagePruefen } from "./wandpruefung";
import type { Wandwerkzeug, ZeichenflaecheGriff } from "./WandZeichenflaeche";
import { WandZeichenflaeche } from "./WandZeichenflaeche";

const WERKZEUG = `${KNOPF_GRUND} border-control bg-surface px-2.5 py-[5px] text-fg disabled:cursor-not-allowed disabled:opacity-45`;
const WERKZEUG_AKTIV = `${KNOPF_GRUND} border-accent bg-accent px-2.5 py-[5px] text-on-accent`;

const WERKZEUGE: readonly { wert: Wandwerkzeug; label: string; taste: string; schreibend: boolean }[] = [
  { wert: "auswahl", label: "Auswählen", taste: "V", schreibend: false },
  { wert: "pan", label: "Ansicht verschieben", taste: "H", schreibend: false },
  { wert: "door", label: "Tür", taste: "T", schreibend: true },
  { wert: "window", label: "Fenster", taste: "N", schreibend: true },
  { wert: "passage", label: "Durchgang", taste: "D", schreibend: true },
];

export interface Wandziel {
  readonly raumId: string;
  readonly wandId: string;
  /** Beim Öffnen aktives Platzierungswerkzeug (Einstieg über Tür/Fenster/Durchgang). */
  readonly werkzeug?: Oeffnungsart;
  /** Beim Öffnen ausgewählte Öffnung (Einstieg über eine vorhandene Öffnung). */
  readonly oeffnungId?: string;
  /**
   * Betrachtete Seite (Ansichtskontext, Phase 4f): Innenseite des Raums oder
   * Außenseite. Standard: innen. Bearbeitet wird immer dieselbe Raumwand.
   */
  readonly seite?: Wandseite;
  /** Woher die Ansicht geöffnet wurde - dorthin führt das Schließen zurück. */
  readonly herkunft?: "2d" | "3d";
}

/**
 * Wandansicht (Phase 4f, ADR 0022): eine Wand frontal aus ihrem Raum,
 * maßstäblich wie auf einem Blatt.
 *
 * **Kein eigener Entwurf.** Die Ansicht arbeitet mit `zustand` und `dispatch`
 * des Grundrisseditors - derselbe Reducer, dieselbe Undo-Historie, derselbe
 * Speicherweg (`PUT …/contour`). Bearbeitbar ist nur eine Wand des aktiven
 * Raums; jede andere Wand wird gezeigt, ihre Öffnungen lassen sich über
 * „bearbeiten“ an der Quelle öffnen (mit der üblichen Rückfrage).
 */
export function Wandansicht({
  ziel,
  zustand,
  dispatch,
  raeume,
  waendeVon,
  topologie,
  einordnung,
  raumName,
  darfSchreiben,
  rasterMm,
  onRaster,
  fangAktiv,
  onFang,
  status,
  offen,
  onSpeichern,
  onVerwerfen,
  onWechseln,
  onQuelleBearbeiten,
  onSchliessen,
}: {
  ziel: Wandziel;
  zustand: EditorZustand;
  dispatch: Dispatch<Aktion>;
  raeume: readonly RaumImPlan[];
  /** Wände eines Raums im gezeigten Stand - aktiver Raum aus dem Entwurf. */
  waendeVon: (raumId: string) => readonly EntwurfWand[];
  topologie: EditorTopologie;
  einordnung: EditorEinordnung;
  raumName: (raumId: string) => string;
  darfSchreiben: boolean;
  rasterMm: number;
  onRaster: (mm: number) => void;
  fangAktiv: boolean;
  onFang: (aktiv: boolean) => void;
  /** Speicherstatus des gemeinsamen Entwurfs - derselbe Text wie im Grundriss. */
  status: { text: string; farbe: string; speichert: boolean };
  offen: boolean;
  onSpeichern: () => void;
  onVerwerfen: () => void;
  onWechseln: (ziel: Wandziel) => void;
  /** Wechselt (mit Rückfrage) in den Quellraum und zeigt dort die Wand. */
  onQuelleBearbeiten: (ziel: Wandziel, oeffnungId: string | null) => void;
  onSchliessen: () => void;
}) {
  const masse = useMasse();
  const [werkzeug, setWerkzeug] = useState<Wandwerkzeug>(ziel.werkzeug ?? "auswahl");
  const [statuszeile, setStatuszeile] = useState("Eine Öffnung anklicken oder ein Werkzeug wählen.");
  const flaeche = useRef<ZeichenflaecheGriff>(null);

  const aktiverRaum = zustand.entwurf?.roomId ?? null;
  const editierbar = darfSchreiben && aktiverRaum === ziel.raumId;
  const raum = raeume.find((r) => r.id === ziel.raumId);
  const raumhoehe =
    aktiverRaum === ziel.raumId ? (zustand.basis?.raum.effective_height_mm ?? raum?.effective_height_mm ?? 0) : (raum?.effective_height_mm ?? 0);
  const walls = waendeVon(ziel.raumId);
  const seite: Wandseite = ziel.seite ?? "innen";
  const ergebnis = useMemo(() => wandbezug(ziel.raumId, walls, ziel.wandId, raumhoehe, seite), [ziel, walls, raumhoehe, seite]);
  const wand = walls.find((w) => w.id === ziel.wandId);
  const modell = useMemo(
    () => (ergebnis.ok && wand !== undefined ? wandmodell(ergebnis.bezug, wand, topologie, einordnung) : null),
    [ergebnis, wand, topologie, einordnung],
  );
  const teilung = topologie.teilung.get(ziel.wandId);

  // Auswahl: im aktiven Raum dieselbe wie im Grundriss; sonst nur hier.
  const ausGrundriss = zustand.auswahl?.art === "oeffnung" && zustand.auswahl.wandId === ziel.wandId ? zustand.auswahl.oeffnungId : null;
  const [lokal, setLokal] = useState<string | null>(ziel.oeffnungId ?? ausGrundriss);
  // Anderes Ziel (Gegenseite, Quelle, neuer Einstieg): Auswahl und Werkzeug neu.
  const [gezeigt, setGezeigt] = useState(ziel);
  if (gezeigt !== ziel) {
    setGezeigt(ziel);
    setLokal(ziel.oeffnungId ?? ausGrundriss);
    setWerkzeug(ziel.werkzeug ?? "auswahl");
  }
  const gewaehlt = modell?.oeffnungen.some((o) => o.id === lokal) === true ? lokal : null;
  const waehlen = (id: string | null) => {
    setLokal(id);
    if (aktiverRaum !== ziel.raumId) return;
    // Eine gerade gesetzte Öffnung steht noch nicht im Modell dieses Renderlaufs;
    // sie gehört aber sicher zu dieser Wand. Abgeleitete gehören einem anderen Raum.
    const o = modell?.oeffnungen.find((x) => x.id === id);
    const eigen = id !== null && (o === undefined || o.eigen);
    dispatch({
      typ: "auswaehlen",
      auswahl:
        eigen && id !== null
          ? { art: "oeffnung", raumId: ziel.raumId, wandId: ziel.wandId, oeffnungId: id }
          : { art: "wand", raumId: ziel.raumId, wandId: ziel.wandId },
    });
  };

  // Ohne Schreibrecht nur betrachten; ein anderes Werkzeug ist dann nicht wählbar.
  useEffect(() => {
    if (!editierbar && werkzeug !== "auswahl" && werkzeug !== "pan") setWerkzeug("auswahl");
  }, [editierbar, werkzeug]);

  const gegenseiten: Gegenseite[] = useMemo(() => {
    if (teilung === undefined) return [];
    const gesehen = new Map<string, Gegenseite>();
    for (const a of teilung.abschnitte) {
      if (a.lage !== "gemeinsam" || a.mehrdeutig) continue;
      for (const q of a.quellen) {
        if (q.wand.raumId === ziel.raumId) continue;
        gesehen.set(`${q.wand.raumId}|${q.wand.id}`, { raumId: q.wand.raumId, wandId: q.wand.id });
      }
    }
    return [...gesehen.values()];
  }, [teilung, ziel.raumId]);

  const nachbarHoehe = (raumId: string) => raeume.find((r) => r.id === raumId)?.effective_height_mm ?? null;

  /** Exakte Werte - geprüft wie beim Server; unzulässig: nichts ändern, Grund nennen. */
  const rechteckSetzen = (id: string, r: Ansichtsrechteck, art?: Oeffnungsart): string | undefined => {
    if (!ergebnis.ok || zustand.entwurf === null || !editierbar) return "Nur im bearbeiteten Raum änderbar.";
    const o = modell?.oeffnungen.find((x) => x.id === id);
    if (o === undefined) return "Öffnung nicht gefunden.";
    const p = lagePruefen(ergebnis.bezug, teilung, art ?? o.art, r, { ohneOeffnungId: id, laengeText: masse.anzeigen, raumName });
    if (!p.ok) return p.grund;
    dispatch({ typ: "aendern", entwurf: oeffnungAendern(zustand.entwurf, ziel.wandId, id, { ...p.werte, ...(art !== undefined ? { kind: art } : {}) }) });
    setStatuszeile("Übernommen - noch nicht gespeichert.");
    return undefined;
  };

  const artSetzen = (id: string, art: Oeffnungsart): string | undefined => {
    const o = modell?.oeffnungen.find((x) => x.id === id);
    if (o === undefined) return undefined;
    // Wie im Grundriss: Fenster mit Brüstung (mind. 900 mm), Tür und Durchgang auf dem Boden.
    const unten = art === "window" ? Math.max(o.unten, 900) : 0;
    const grund = rechteckSetzen(id, { ...o, unten, oben: unten + (o.oben - o.unten) }, art);
    if (grund !== undefined) setStatuszeile(`Art nicht geändert: ${grund}`);
    return grund;
  };

  const entfernen = (id: string) => {
    if (zustand.entwurf === null || zustand.basis === null || !editierbar) return;
    const gespeichert = new Set(zustand.basis.entwurf.walls.flatMap((w) => w.openings.map((x) => x.id)));
    dispatch({ typ: "aendern", entwurf: oeffnungEntfernen(zustand.entwurf, ziel.wandId, id, gespeichert) });
    waehlen(null);
    setStatuszeile("Öffnung entfernt - noch nicht gespeichert.");
  };

  const quelle = (o: AnsichtsOeffnung) => onQuelleBearbeiten({ raumId: o.quelleRaumId, wandId: o.quelleWandId }, o.id);

  // Pfeiltasten: 1 cm, mit Umschalt 10 cm - jeder Druck ein Rückgängig-Schritt.
  const schieben = (du: number, dh: number) => {
    const o = modell?.oeffnungen.find((x) => x.id === gewaehlt);
    if (o === undefined || !o.eigen || !editierbar) return;
    if (dh !== 0 && o.art !== "window") {
      setStatuszeile("Türen und Durchgänge stehen auf dem Boden - nur waagerecht verschiebbar.");
      return;
    }
    const grund = rechteckSetzen(o.id, { links: o.links + du, rechts: o.rechts + du, unten: o.unten + dh, oben: o.oben + dh });
    setStatuszeile(grund === undefined ? `Verschoben: ${masse.anzeigen(o.links + du)} von links` : `Nicht verschoben: ${grund}`);
  };

  const taste = (event: KeyboardEvent<HTMLDivElement>) => {
    const element = event.target instanceof Element ? event.target : null;
    // Eingabefelder behalten ihre eigenen Tasten (Pfeile, Rücktaste, Strg+Z).
    const imFeld = element?.closest("input:not([type=checkbox]), textarea, select") != null;
    const strg = event.ctrlKey || event.metaKey;
    const k = event.key.toLowerCase();
    if (strg && k === "s") {
      event.preventDefault();
      onSpeichern();
      return;
    }
    if (imFeld) return;
    if (strg && k === "z" && !event.shiftKey) {
      event.preventDefault();
      dispatch({ typ: "rueckgaengig" });
      return;
    }
    if (strg && (k === "y" || (k === "z" && event.shiftKey))) {
      event.preventDefault();
      dispatch({ typ: "wiederholen" });
      return;
    }
    if (strg || event.altKey) return;
    const schritt = event.shiftKey ? 100 : 10;
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        schieben(-schritt, 0);
        return;
      case "ArrowRight":
        event.preventDefault();
        schieben(schritt, 0);
        return;
      case "ArrowUp":
        event.preventDefault();
        schieben(0, schritt);
        return;
      case "ArrowDown":
        event.preventDefault();
        schieben(0, -schritt);
        return;
      case "Delete":
      case "Backspace":
        if (gewaehlt !== null && modell?.oeffnungen.find((x) => x.id === gewaehlt)?.eigen === true) {
          event.preventDefault();
          entfernen(gewaehlt);
        }
        return;
      case "+":
        flaeche.current?.zoom(1.25);
        return;
      case "-":
        flaeche.current?.zoom(0.8);
        return;
    }
    const werkzeuge: Record<string, Wandwerkzeug> = { v: "auswahl", h: "pan" };
    if (editierbar) Object.assign(werkzeuge, { t: "door", n: "window", d: "passage" });
    const w = werkzeuge[k];
    if (w !== undefined) setWerkzeug(w);
    else if (k === "f") flaeche.current?.ansichtZuruecksetzen();
  };

  /** Escape: erst die Bewegung, dann das Werkzeug, dann die Auswahl - zuletzt schließen. */
  const escape = (): boolean => {
    if (flaeche.current?.abbrechen() === true) return true;
    if (werkzeug !== "auswahl") {
      setWerkzeug("auswahl");
      return true;
    }
    if (gewaehlt !== null) {
      waehlen(null);
      return true;
    }
    return false;
  };

  const titel = `Wandansicht · Wand ${ergebnis.ok ? ergebnis.bezug.wandNummer : ""} · ${raumName(ziel.raumId)}${
    seite === "aussen" ? " · Außenseite" : ""
  }`;
  // Die Außenseite ist nur dort eine Fassade, wo die Wand an keinen anderen Raum grenzt.
  const hatFassade = modell?.abschnitte.some((a) => a.nachbarn.length === 0) === true;
  const seitenname = seite === "innen" ? `Innenseite – ${raumName(ziel.raumId)}` : hatFassade ? "Außenseite – Fassade" : "Außenseite";
  const seiteWechseln = () => onWechseln({ raumId: ziel.raumId, wandId: ziel.wandId, seite: seite === "innen" ? "aussen" : "innen", ...(ziel.herkunft !== undefined ? { herkunft: ziel.herkunft } : {}), ...(gewaehlt !== null ? { oeffnungId: gewaehlt } : {}) });

  return (
    <Dialog offen titel={titel} groesse="gross" onClose={onSchliessen} onEscape={escape}>
      <div className="flex flex-col gap-2 split:h-full split:min-h-0" onKeyDown={taste}>
        <div className="flex min-h-10 flex-wrap items-center justify-between gap-2" role="status" aria-live="polite">
          <span className="flex flex-wrap items-center gap-x-3">
            <strong data-testid="wandseite">{seitenname}</strong>
            <span className="text-muted">
              {seite === "innen" ? `Blick aus Raum „${raumName(ziel.raumId)}“` : "Blick von außen auf die Wand"}
              {ergebnis.ok ? ` · im Grundriss ${ergebnis.bezug.blick}` : ""}
            </span>
            {ergebnis.ok && (
              <button type="button" className={knopf("neutral", { klein: true })} onClick={seiteWechseln}>
                {seite === "innen" ? "Außenseite ansehen" : "Innenseite ansehen"}
              </button>
            )}
            <span className={`font-semibold ${status.farbe}`}>{editierbar ? status.text : "Nur Ansicht"}</span>
          </span>
          {darfSchreiben && aktiverRaum !== null && (
            <span className="flex flex-wrap gap-2">
              <button type="button" className={knopf("primaer")} disabled={!offen || status.speichert} onClick={onSpeichern} title="Speichert den gemeinsamen Entwurf (Strg+S)">
                Speichern
              </button>
              <button type="button" className={knopf()} disabled={!offen || status.speichert} onClick={onVerwerfen}>
                Änderungen verwerfen
              </button>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3" role="toolbar" aria-label="Werkzeuge der Wandansicht">
          <div className="flex flex-wrap items-center gap-1">
            {WERKZEUGE.filter((w) => editierbar || !w.schreibend).map((w) => (
              <button
                key={w.wert}
                type="button"
                className={werkzeug === w.wert ? WERKZEUG_AKTIV : WERKZEUG}
                aria-pressed={werkzeug === w.wert}
                title={`${w.label} (${w.taste})`}
                onClick={() => setWerkzeug(w.wert)}
              >
                {w.label}
              </button>
            ))}
          </div>
          {editierbar && (
            <div className="flex flex-wrap items-center gap-1">
              <button type="button" className={WERKZEUG} disabled={zustand.zurueck.length === 0} title="Rückgängig (Strg+Z)" onClick={() => dispatch({ typ: "rueckgaengig" })}>
                Rückgängig
              </button>
              <button type="button" className={WERKZEUG} disabled={zustand.vor.length === 0} title="Wiederholen (Strg+Y)" onClick={() => dispatch({ typ: "wiederholen" })}>
                Wiederholen
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1">
            <button type="button" className={WERKZEUG} aria-label="Vergrößern" title="Vergrößern (+)" onClick={() => flaeche.current?.zoom(1.25)}>
              +
            </button>
            <button type="button" className={WERKZEUG} aria-label="Verkleinern" title="Verkleinern (−)" onClick={() => flaeche.current?.zoom(0.8)}>
              −
            </button>
            <button type="button" className={WERKZEUG} title="Ganze Wand zeigen (F)" onClick={() => flaeche.current?.ansichtZuruecksetzen()}>
              {ANSICHT_ZURUECKSETZEN}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-small" title="Alt beim Ziehen setzt das Einrasten vorübergehend aus">
              <input type="checkbox" checked={fangAktiv} onChange={(event) => onFang(event.target.checked)} />
              Einrasten
            </label>
            <label className="flex items-center gap-1.5 text-small">
              Raster
              <select className={eingabefeld({ kompakt: true })} value={rasterMm} onChange={(event) => onRaster(Number(event.target.value))}>
                {RASTERGROESSEN_MM.map((mm) => (
                  <option key={mm} value={mm}>
                    {masse.anzeigen(mm)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {!ergebnis.ok || modell === null ? (
          <p className={meldungsflaeche()} role="alert">
            {ergebnis.ok ? "Diese Wand gibt es im aktuellen Stand nicht." : ergebnis.grund}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 split:min-h-0 split:flex-auto split:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex min-w-0 flex-col gap-1 split:min-h-0">
              <div className="h-[55dvh] min-h-[300px] split:h-auto split:min-h-0 split:flex-auto">
                <WandZeichenflaeche
                  griff={flaeche}
                  bezug={ergebnis.bezug}
                  modell={modell}
                  teilung={teilung}
                  entwurf={editierbar ? zustand.entwurf : null}
                  dispatch={dispatch}
                  editierbar={editierbar}
                  werkzeug={werkzeug}
                  onWerkzeug={setWerkzeug}
                  gewaehlt={gewaehlt}
                  onWaehlen={waehlen}
                  rasterMm={rasterMm}
                  fangAktiv={fangAktiv}
                  raumName={raumName}
                  nachbarHoehe={nachbarHoehe}
                  onStatus={setStatuszeile}
                />
              </div>
              {/* Feste Höhe: Die Fläche springt nicht, wenn der Text wechselt. */}
              <p className="m-0 h-11 overflow-hidden text-[0.82rem] text-muted" aria-live="polite" data-testid="wand-statuszeile">
                {statuszeile}
              </p>
            </div>
            <aside className="min-w-0 split:min-h-0 split:overflow-y-auto" aria-label="Eigenschaften der Wand">
              {!editierbar && aktiverRaum !== ziel.raumId && (
                <div className={`${meldungsflaeche("schlicht")} mb-2`}>
                  <p className="m-0">
                    Diese Wand gehört zu „{raumName(ziel.raumId)}“. Bearbeitet wird gerade{" "}
                    {aktiverRaum === null ? "kein Raum" : `„${raumName(aktiverRaum)}“`}.
                  </p>
                  {darfSchreiben && (
                    <button type="button" className={`${knopf()} mt-2`} onClick={() => onQuelleBearbeiten(ziel, gewaehlt)}>
                      „{raumName(ziel.raumId)}“ bearbeiten
                    </button>
                  )}
                </div>
              )}
              <WandEigenschaften
                bezug={ergebnis.bezug}
                modell={modell}
                raumName={raumName}
                editierbar={editierbar}
                gewaehlt={gewaehlt}
                onWaehlen={waehlen}
                onRechteck={(id, r) => rechteckSetzen(id, r)}
                onArt={artSetzen}
                onEntfernen={entfernen}
                einordnung={einordnung}
                nachbarHoehe={nachbarHoehe}
                gegenseiten={gegenseiten}
                onGegenseite={(g) => {
                  setLokal(null);
                  onWechseln(g);
                }}
                onQuelle={quelle}
              />
              <details className="mt-2 text-[0.85rem] text-muted">
                <summary className="cursor-pointer">Bedienung</summary>
                <ul className="pl-[18px]">
                  <li>Links und rechts gelten so, wie man vor der betrachteten Seite steht – innen im Raum, außen vor der Fassade. Ein Seitenwechsel verschiebt keine Öffnung.</li>
                  <li>Tür (T), Fenster (N), Durchgang (D): Vorschau folgt dem Zeiger, ein Klick setzt die Öffnung mit Standardmaßen.</li>
                  <li>Öffnung ziehen verschiebt sie (Fenster auch in der Höhe); die Griffe ändern Breite, Höhe und Brüstung.</li>
                  <li>Einrasten an Wandkanten, Wandmitte, Kanten und Mitten anderer Öffnungen, gleicher Brüstung und Oberkante, sonst am Raster. Alt hält es beim Ziehen aus.</li>
                  <li>Pfeiltasten verschieben die gewählte Öffnung um 1 cm, mit Umschalt um 10 cm. Entf entfernt sie, Escape bricht ab.</li>
                  <li>Strg+Z / Strg+Y gelten für den gemeinsamen Entwurf mit dem Grundriss. Schließen behält alle Änderungen – gespeichert wird nur mit „Speichern“.</li>
                </ul>
              </details>
            </aside>
          </div>
        )}
      </div>
    </Dialog>
  );
}
