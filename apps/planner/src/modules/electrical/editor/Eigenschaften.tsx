import { useState } from "react";
import type { FormEvent } from "react";

import { eingabeUmrechnen } from "../../../core/masse";
import { useEinheitenwechsel, useMasse } from "../../../core/ui/masseinheit";
import { FELD, FELD_BESCHRIFTUNG, FELD_FEHLER, KNOPFZEILE, eingabefeld, knopf, meldungsflaeche } from "../../../core/ui/stil";
import { KONTURZUSTAND_LABEL, OEFFNUNGSARTEN, OEFFNUNGSART_LABEL } from "../texte";
import type { EntwurfWand, Oeffnungsart, RaumImPlan, Raumentwurf } from "./entwurf";
import { ende, segmenteAus, start } from "./entwurf";
import { konturbericht, streckenlaenge } from "./geometrie";
import type { Befund } from "./geometrie";
import { geometrietext } from "./speichern";
import {
  eckeEntfernen,
  eckeVerschieben,
  konturUmkehren,
  oeffnungAendern,
  oeffnungEntfernen,
  wandEntfernen,
  wandKoordinatenSetzen,
  wandTeilen,
  wandlaengeSetzen,
} from "./werkzeuge";
import type { Ergebnis } from "./werkzeuge";
import type { EditorEinordnung, EditorTopologie } from "./platzierung";
import { verbindungsText } from "./platzierung";
import type { Auswahl, EditorZustand } from "./zustand";

/** Seitenleiste: scrollt selbst, damit die Zeichenfläche daneben stehen bleibt. */
const SEITENLEISTE = "flex max-h-[62vh] flex-col gap-2 overflow-y-auto text-small [&_:is(h3,h4)]:my-1";
/** Eintrag einer Auswahlliste: ganze Breite, Text linksbündig. */
const LISTENKNOPF = `${knopf()} w-full text-left`;
const LISTENKNOPF_GEWAEHLT = `${knopf("gewaehlt")} w-full text-left`;

export function flaecheText(mm2: number | null): string {
  if (mm2 === null) return "Kontur offen";
  return `${(mm2 / 1_000_000).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
}

// --------------------------------------------------------- Zahlenformular

interface Feldbeschreibung {
  readonly name: string;
  readonly label: string;
  readonly wert: number;
}

/**
 * Präzise Maßeingabe in der persönlichen Anzeigeeinheit. Übernommen werden
 * immer ganze Millimeter (`core/masse.ts`). Ändert nur den **lokalen**
 * Entwurf - gespeichert wird erst mit „Speichern“.
 */
function Zahlenformular({
  id,
  felder,
  aktion,
  onUebernehmen,
  gesperrt,
}: {
  id: string;
  felder: readonly Feldbeschreibung[];
  aktion: string;
  onUebernehmen: (werte: Record<string, number>) => string | undefined;
  gesperrt: boolean;
}) {
  const masse = useMasse();
  const [werte, setWerte] = useState<Record<string, string>>(() =>
    Object.fromEntries(felder.map((f) => [f.name, masse.alsEingabe(f.wert)])),
  );
  const [fehler, setFehler] = useState<string | null>(null);
  useEinheitenwechsel((von, nach) =>
    setWerte((alt) => Object.fromEntries(Object.entries(alt).map(([k, v]) => [k, eingabeUmrechnen(v, von, nach)]))),
  );

  const absenden = (event: FormEvent) => {
    event.preventDefault();
    const zahlen: Record<string, number> = {};
    for (const f of felder) {
      const gelesen = masse.lesen(werte[f.name] ?? "");
      if (!gelesen.ok) {
        setFehler(`„${f.label}“: ${gelesen.fehler}`);
        return;
      }
      zahlen[f.name] = gelesen.mm;
    }
    setFehler(onUebernehmen(zahlen) ?? null);
  };

  return (
    <form className="mb-2 flex flex-col gap-1.5" onSubmit={absenden} noValidate>
      {/* Die Beschriftung nimmt den freien Platz ein: So beginnt jedes Eingabefeld
          einer Zeile auf derselben Höhe, auch wenn eine Beschriftung umbricht. */}
      <div className="grid grid-cols-2 gap-1.5">
        {felder.map((f) => (
          <label key={f.name} className={FELD} htmlFor={`${id}-${f.name}`}>
            <span className={`${FELD_BESCHRIFTUNG} flex-auto`}>{masse.label(f.label)}</span>
            <input
              id={`${id}-${f.name}`}
              className={eingabefeld()}
              inputMode="decimal"
              value={werte[f.name] ?? ""}
              disabled={gesperrt}
              onChange={(event) => setWerte({ ...werte, [f.name]: event.target.value })}
            />
          </label>
        ))}
      </div>
      {fehler !== null && (
        <p className={FELD_FEHLER} role="alert">
          {fehler}
        </p>
      )}
      {!gesperrt && (
        <button type="submit" className={knopf()}>
          {aktion}
        </button>
      )}
    </form>
  );
}

// -------------------------------------------------------------- Bereich

export function Eigenschaften({
  zustand,
  raeume,
  darfSchreiben,
  onAendern,
  onWaehlen,
  onRaumBearbeiten,
  neueId,
  einordnung,
  topologie,
  raumName,
}: {
  zustand: EditorZustand;
  raeume: readonly RaumImPlan[];
  darfSchreiben: boolean;
  onAendern: (entwurf: Raumentwurf) => void;
  onWaehlen: (auswahl: Auswahl) => void;
  onRaumBearbeiten: () => void;
  neueId: () => string;
  /** Abgeleitete Raumverbindungen und Wandabschnitte (Phase 4b.2). */
  einordnung: EditorEinordnung;
  topologie: EditorTopologie;
  raumName: (raumId: string) => string;
}) {
  const [hinweis, setHinweis] = useState<string | null>(null);
  const masse = useMasse();
  const { entwurf, basis, auswahl } = zustand;

  const anwenden = (ergebnis: Ergebnis<Raumentwurf>): string | undefined => {
    if ("fehler" in ergebnis) {
      setHinweis(ergebnis.fehler);
      return ergebnis.fehler;
    }
    setHinweis(null);
    onAendern(ergebnis.wert);
    return undefined;
  };

  if (entwurf === null || basis === null) {
    return (
      <div className={SEITENLEISTE}>
        <h3>Räume dieses Geschosses</h3>
        <Raumliste raeume={raeume} auswahl={auswahl} onWaehlen={onWaehlen} />
        <p className="text-muted">
          Einen Raum anklicken, um ihn zu bearbeiten.
          {darfSchreiben ? " Mit „Rechteckraum“ oder „Polygonraum“ entsteht ein neuer Raum." : ""}
        </p>
      </div>
    );
  }

  const bericht = konturbericht(segmenteAus(entwurf.walls));
  const gespeicherteOeffnungen = new Set(basis.entwurf.walls.flatMap((w) => w.openings.map((o) => o.id)));
  const gesperrt = !darfSchreiben;
  const wand = auswahl?.art === "wand" || auswahl?.art === "oeffnung" ? entwurf.walls.find((w) => w.id === auswahl.wandId) : undefined;
  const oeffnung = auswahl?.art === "oeffnung" ? wand?.openings.find((o) => o.id === auswahl.oeffnungId) : undefined;
  const wandNummer = wand === undefined ? 0 : entwurf.walls.indexOf(wand) + 1;

  return (
    <div className={SEITENLEISTE}>
      <div className="flex items-center justify-between gap-2">
        <h3>
          {basis.raum.room_number !== null ? `${basis.raum.room_number} ` : ""}
          {basis.raum.name}
        </h3>
        {darfSchreiben && (
          <button type="button" className={knopf()} onClick={onRaumBearbeiten}>
            Raumdaten
          </button>
        )}
      </div>
      <p className="m-0">
        <strong>{KONTURZUSTAND_LABEL[bericht.status]}</strong> · {entwurf.walls.length} Wände · Fläche{" "}
        {flaecheText(bericht.flaecheMm2)} · Umfang {masse.anzeigenOptional(bericht.umfangMm)}
      </p>
      {bericht.befunde.length > 0 && <Befundliste befunde={bericht.befunde} />}
      {hinweis !== null && (
        <p className={meldungsflaeche("schlicht")} role="status">
          {hinweis}
        </p>
      )}

      {auswahl?.art === "ecke" && (
        <section className="border-t border-line pt-2" aria-label="Eckpunkt">
          <h4>Eckpunkt</h4>
          <Zahlenformular
            key={`ecke-${auswahl.punkt.x},${auswahl.punkt.y}`}
            id="ecke"
            gesperrt={gesperrt}
            aktion="Punkt setzen"
            felder={[
              { name: "x", label: "X", wert: auswahl.punkt.x },
              { name: "y", label: "Y", wert: auswahl.punkt.y },
            ]}
            onUebernehmen={(w) => {
              const neu = { x: w.x as number, y: w.y as number };
              onAendern(eckeVerschieben(entwurf, auswahl.punkt, neu));
              onWaehlen({ ...auswahl, punkt: neu });
              return undefined;
            }}
          />
        </section>
      )}

      {wand !== undefined && oeffnung === undefined && (
        <section className="border-t border-line pt-2" aria-label={`Wand ${wandNummer}`}>
          <h4>
            Wand {wandNummer} · {masse.anzeigen(streckenlaenge(start(wand), ende(wand)))}
          </h4>
          <Zahlenformular
            key={`wand-${wand.id}-${wand.x1_mm},${wand.y1_mm},${wand.x2_mm},${wand.y2_mm},${wand.thickness_mm}`}
            id="wand"
            gesperrt={gesperrt}
            aktion="Koordinaten übernehmen"
            felder={[
              { name: "x1_mm", label: "Von X", wert: wand.x1_mm },
              { name: "y1_mm", label: "Von Y", wert: wand.y1_mm },
              { name: "x2_mm", label: "Nach X", wert: wand.x2_mm },
              { name: "y2_mm", label: "Nach Y", wert: wand.y2_mm },
              { name: "thickness_mm", label: "Stärke", wert: wand.thickness_mm },
            ]}
            onUebernehmen={(w) =>
              anwenden({
                wert: wandKoordinatenSetzen(entwurf, wand.id, {
                  x1_mm: w.x1_mm as number,
                  y1_mm: w.y1_mm as number,
                  x2_mm: w.x2_mm as number,
                  y2_mm: w.y2_mm as number,
                  thickness_mm: w.thickness_mm as number,
                }),
              })
            }
          />
          <Zahlenformular
            key={`laenge-${wand.id}-${streckenlaenge(start(wand), ende(wand))}`}
            id="wandlaenge"
            gesperrt={gesperrt}
            aktion="Länge setzen"
            felder={[{ name: "laenge", label: "Länge", wert: streckenlaenge(start(wand), ende(wand)) }]}
            onUebernehmen={(w) => anwenden(wandlaengeSetzen(entwurf, wand.id, w.laenge as number))}
          />
          {darfSchreiben && (
            <div className={KNOPFZEILE}>
              <button type="button" className={knopf()} onClick={() => anwenden(wandTeilen(entwurf, wand.id, neueId()))}>
                Wand teilen
              </button>
              <button type="button" className={knopf()} onClick={() => anwenden(eckeEntfernen(entwurf, wand.id))}>
                Eckpunkt am Wandende entfernen
              </button>
              <button
                type="button"
                className={knopf()}
                onClick={() => {
                  if (anwenden(wandEntfernen(entwurf, wand.id)) === undefined) onWaehlen({ art: "raum", raumId: entwurf.roomId });
                }}
              >
                Wand entfernen
              </button>
            </div>
          )}
          <OeffnungenDerWand wand={wand} onWaehlen={onWaehlen} raumId={entwurf.roomId} />
          <AbgeleiteteOeffnungen
            wandId={wand.id}
            topologie={topologie}
            einordnung={einordnung}
            raumName={raumName}
            onWaehlen={onWaehlen}
          />
        </section>
      )}

      {wand !== undefined && oeffnung !== undefined && (
        <section className="border-t border-line pt-2" aria-label="Öffnung">
          <h4>
            {OEFFNUNGSART_LABEL[oeffnung.kind]} in Wand {wandNummer} · {masse.anzeigen(oeffnung.width_mm)} breit
          </h4>
          <Verbindung einordnung={einordnung} oeffnungId={oeffnung.id} raumName={raumName} wandNummer={wandNummer} />
          {darfSchreiben ? (
            <label className={FELD} htmlFor="oeffnung-art">
              <span className={FELD_BESCHRIFTUNG}>Art</span>
              <select
                id="oeffnung-art"
                className={eingabefeld()}
                value={oeffnung.kind}
                onChange={(event) => {
                  const art = event.target.value as Oeffnungsart;
                  onAendern(
                    oeffnungAendern(entwurf, wand.id, oeffnung.id, {
                      kind: art,
                      sill_height_mm: art === "window" ? Math.max(oeffnung.sill_height_mm, 900) : 0,
                    }),
                  );
                }}
              >
                {OEFFNUNGSARTEN.map((a) => (
                  <option key={a.wert} value={a.wert}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Zahlenformular
            key={`oeffnung-${oeffnung.id}-${oeffnung.offset_mm}-${oeffnung.width_mm}-${oeffnung.height_mm}-${oeffnung.sill_height_mm}`}
            id="oeffnung"
            gesperrt={gesperrt}
            aktion="Maße übernehmen"
            felder={[
              { name: "offset_mm", label: "Abstand", wert: oeffnung.offset_mm },
              { name: "width_mm", label: "Breite", wert: oeffnung.width_mm },
              { name: "height_mm", label: "Höhe", wert: oeffnung.height_mm },
              { name: "sill_height_mm", label: "Brüstung", wert: oeffnung.sill_height_mm },
            ]}
            onUebernehmen={(w) =>
              anwenden({
                wert: oeffnungAendern(entwurf, wand.id, oeffnung.id, {
                  offset_mm: w.offset_mm as number,
                  width_mm: w.width_mm as number,
                  height_mm: w.height_mm as number,
                  sill_height_mm: w.sill_height_mm as number,
                }),
              })
            }
          />
          <p className="text-muted">Der Abstand wird vom Anfang der gerichteten Wand gemessen ({masse.punkt(wand.x1_mm, wand.y1_mm)}).</p>
          {darfSchreiben && (
            <button
              type="button"
              className={knopf()}
              onClick={() => {
                onAendern(oeffnungEntfernen(entwurf, wand.id, oeffnung.id, gespeicherteOeffnungen));
                onWaehlen({ art: "wand", raumId: entwurf.roomId, wandId: wand.id });
              }}
            >
              Öffnung entfernen
            </button>
          )}
        </section>
      )}

      {darfSchreiben && (auswahl === null || auswahl.art === "raum") && (
        <div className={KNOPFZEILE}>
          <button type="button" className={knopf()} onClick={() => onAendern(konturUmkehren(entwurf))}>
            Umlaufrichtung umkehren
          </button>
        </div>
      )}

      <h4>Räume dieses Geschosses</h4>
      <Raumliste raeume={raeume} auswahl={auswahl} onWaehlen={onWaehlen} />
    </div>
  );
}

/**
 * Abgeleitete Raumverbindung der gewählten Öffnung. Die Öffnung ist genau
 * einmal gespeichert - an dieser Wand; ein Nachbarraum ist nur abgeleitet.
 */
function Verbindung({
  einordnung,
  oeffnungId,
  raumName,
  wandNummer,
}: {
  einordnung: EditorEinordnung;
  oeffnungId: string;
  raumName: (raumId: string) => string;
  wandNummer: number;
}) {
  const e = einordnung.get(oeffnungId);
  if (e === undefined) return null;
  const konflikt = e.klasse === "konflikt" || e.klasse === "ungueltig";
  return (
    <div className={konflikt ? `${meldungsflaeche("schlicht")} [&_p]:my-0.5` : "[&_p]:my-0.5"} role="status">
      <p>
        <strong>{verbindungsText(e, raumName)}</strong>
      </p>
      <p className="text-muted">
        Gespeichert einmal an Wand {wandNummer} von „{raumName(e.wand.raumId)}“
        {e.klasse === "gemeinsam" ? " – im Nachbarraum erscheint sie abgeleitet, ohne zweiten Datensatz." : "."}
      </p>
      {e.dubletten.length > 0 && (
        <p className="text-muted">
          Hinweis: Dieselbe Öffnung ist zusätzlich auf der Gegenseite gespeichert. Eine Erfassung genügt; die zweite kann
          entfernt werden.
        </p>
      )}
      {konflikt && <p className="text-muted">Bitte die Öffnung verschieben oder die Wände bereinigen – es wird nichts geraten.</p>}
    </div>
  );
}

/**
 * Öffnungen, die ein Nachbarraum auf demselben Wandstück gespeichert hat -
 * im aktiven Raum nur abgeleitet. Bearbeiten oder Löschen geht nur an der
 * einen gespeicherten Öffnung; die Schaltfläche führt dorthin.
 */
function AbgeleiteteOeffnungen({
  wandId,
  topologie,
  einordnung,
  raumName,
  onWaehlen,
}: {
  wandId: string;
  topologie: EditorTopologie;
  einordnung: EditorEinordnung;
  raumName: (raumId: string) => string;
  onWaehlen: (auswahl: Auswahl) => void;
}) {
  const masse = useMasse();
  const teilung = topologie.teilung.get(wandId);
  if (teilung === undefined) return null;
  const abschnitte = new Set(teilung.abschnitte.map((a) => a.id));
  const fremde = [...einordnung.values()].filter(
    (e) =>
      e.klasse === "gemeinsam" &&
      e.nachbarRaumId === teilung.wand.raumId &&
      e.abschnitte.some((a) => abschnitte.has(a.id)),
  );
  if (fremde.length === 0) return null;
  return (
    <>
      <p className="text-muted">Abgeleitet aus dem Nachbarraum (dort gespeichert):</p>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {fremde.map((e) => (
          <li key={e.oeffnung.oeffnungId}>
            <button
              type="button"
              className={LISTENKNOPF}
              onClick={() =>
                onWaehlen({ art: "oeffnung", raumId: e.wand.raumId, wandId: e.wand.id, oeffnungId: e.oeffnung.oeffnungId })
              }
            >
              {OEFFNUNGSART_LABEL[e.oeffnung.art]}, {masse.anzeigen(e.oeffnung.breiteMm)} breit – gespeichert in „
              {raumName(e.wand.raumId)}“
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Befundliste({ befunde }: { befunde: readonly Befund[] }) {
  const codes = [...new Set(befunde.map((b) => b.code))];
  return (
    <ul className="m-0 pl-[18px] text-warning" aria-label="Hinweise zur Kontur">
      {codes.map((code) => (
        <li key={code}>{geometrietext(code)}</li>
      ))}
    </ul>
  );
}

function OeffnungenDerWand({
  wand,
  raumId,
  onWaehlen,
}: {
  wand: EntwurfWand;
  raumId: string;
  onWaehlen: (auswahl: Auswahl) => void;
}) {
  const masse = useMasse();
  if (wand.openings.length === 0) return <p className="text-muted">Keine Öffnung in dieser Wand.</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {wand.openings.map((o) => (
        <li key={o.id}>
          <button
            type="button"
            className={LISTENKNOPF}
            onClick={() => onWaehlen({ art: "oeffnung", raumId, wandId: wand.id, oeffnungId: o.id })}
          >
            {OEFFNUNGSART_LABEL[o.kind]} bei {masse.anzeigen(o.offset_mm)}, {masse.anzeigen(o.width_mm)} breit
          </button>
        </li>
      ))}
    </ul>
  );
}

function Raumliste({
  raeume,
  auswahl,
  onWaehlen,
}: {
  raeume: readonly RaumImPlan[];
  auswahl: Auswahl;
  onWaehlen: (auswahl: Auswahl) => void;
}) {
  if (raeume.length === 0) return <p className="text-muted">Noch kein Raum auf diesem Geschoss.</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {raeume.map((raum) => (
        <li key={raum.id}>
          <button
            type="button"
            className={auswahl?.raumId === raum.id ? LISTENKNOPF_GEWAEHLT : LISTENKNOPF}
            aria-current={auswahl?.raumId === raum.id ? "true" : undefined}
            onClick={() => onWaehlen({ art: "raum", raumId: raum.id })}
          >
            {raum.room_number !== null ? `${raum.room_number} ` : ""}
            {raum.name} · {KONTURZUSTAND_LABEL[raum.contour_status]}
          </button>
        </li>
      ))}
    </ul>
  );
}
