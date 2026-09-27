import { useState } from "react";
import type { FormEvent } from "react";

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
import type { Auswahl, EditorZustand } from "./zustand";

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
 * Präzise Eingabe in ganzen Millimetern. Ändert nur den **lokalen** Entwurf -
 * gespeichert wird erst mit „Speichern“.
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
  const [werte, setWerte] = useState<Record<string, string>>(() =>
    Object.fromEntries(felder.map((f) => [f.name, String(f.wert)])),
  );
  const [fehler, setFehler] = useState<string | null>(null);

  const absenden = (event: FormEvent) => {
    event.preventDefault();
    const zahlen: Record<string, number> = {};
    for (const f of felder) {
      const text = (werte[f.name] ?? "").trim();
      if (!/^-?\d+$/.test(text)) {
        setFehler(`„${f.label}“ braucht eine ganze Zahl in Millimetern.`);
        return;
      }
      zahlen[f.name] = Number.parseInt(text, 10);
    }
    setFehler(onUebernehmen(zahlen) ?? null);
  };

  return (
    <form className="eigenschaften__formular" onSubmit={absenden} noValidate>
      <div className="eigenschaften__felder">
        {felder.map((f) => (
          <label key={f.name} className="field" htmlFor={`${id}-${f.name}`}>
            <span className="field__label">{f.label}</span>
            <input
              id={`${id}-${f.name}`}
              className="field__input"
              inputMode="numeric"
              value={werte[f.name] ?? ""}
              disabled={gesperrt}
              onChange={(event) => setWerte({ ...werte, [f.name]: event.target.value })}
            />
          </label>
        ))}
      </div>
      {fehler !== null && (
        <p className="field__fehler" role="alert">
          {fehler}
        </p>
      )}
      {!gesperrt && (
        <button type="submit" className="button button--ghost">
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
}: {
  zustand: EditorZustand;
  raeume: readonly RaumImPlan[];
  darfSchreiben: boolean;
  onAendern: (entwurf: Raumentwurf) => void;
  onWaehlen: (auswahl: Auswahl) => void;
  onRaumBearbeiten: () => void;
  neueId: () => string;
}) {
  const [hinweis, setHinweis] = useState<string | null>(null);
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
      <div className="eigenschaften">
        <h3>Räume dieses Geschosses</h3>
        <Raumliste raeume={raeume} auswahl={auswahl} onWaehlen={onWaehlen} />
        <p className="muted">
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
    <div className="eigenschaften">
      <div className="eigenschaften__kopf">
        <h3>
          {basis.raum.room_number !== null ? `${basis.raum.room_number} ` : ""}
          {basis.raum.name}
        </h3>
        {darfSchreiben && (
          <button type="button" className="button button--ghost" onClick={onRaumBearbeiten}>
            Raumdaten
          </button>
        )}
      </div>
      <p className="eigenschaften__kennzahlen">
        <strong>{KONTURZUSTAND_LABEL[bericht.status]}</strong> · {entwurf.walls.length} Wände · Fläche{" "}
        {flaecheText(bericht.flaecheMm2)} · Umfang {bericht.umfangMm === null ? "—" : `${bericht.umfangMm} mm`}
      </p>
      {bericht.befunde.length > 0 && <Befundliste befunde={bericht.befunde} />}
      {hinweis !== null && (
        <p className="alert" role="status">
          {hinweis}
        </p>
      )}

      {auswahl?.art === "ecke" && (
        <section className="eigenschaften__abschnitt" aria-label="Eckpunkt">
          <h4>Eckpunkt</h4>
          <Zahlenformular
            key={`ecke-${auswahl.punkt.x},${auswahl.punkt.y}`}
            id="ecke"
            gesperrt={gesperrt}
            aktion="Punkt setzen"
            felder={[
              { name: "x", label: "X (mm)", wert: auswahl.punkt.x },
              { name: "y", label: "Y (mm)", wert: auswahl.punkt.y },
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
        <section className="eigenschaften__abschnitt" aria-label={`Wand ${wandNummer}`}>
          <h4>
            Wand {wandNummer} · {streckenlaenge(start(wand), ende(wand))} mm
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
            felder={[{ name: "laenge", label: "Länge (mm)", wert: streckenlaenge(start(wand), ende(wand)) }]}
            onUebernehmen={(w) => anwenden(wandlaengeSetzen(entwurf, wand.id, w.laenge as number))}
          />
          {darfSchreiben && (
            <div className="button-row">
              <button type="button" className="button button--ghost" onClick={() => anwenden(wandTeilen(entwurf, wand.id, neueId()))}>
                Wand teilen
              </button>
              <button type="button" className="button button--ghost" onClick={() => anwenden(eckeEntfernen(entwurf, wand.id))}>
                Eckpunkt am Wandende entfernen
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  if (anwenden(wandEntfernen(entwurf, wand.id)) === undefined) onWaehlen({ art: "raum", raumId: entwurf.roomId });
                }}
              >
                Wand entfernen
              </button>
            </div>
          )}
          <OeffnungenDerWand wand={wand} onWaehlen={onWaehlen} raumId={entwurf.roomId} />
        </section>
      )}

      {wand !== undefined && oeffnung !== undefined && (
        <section className="eigenschaften__abschnitt" aria-label="Öffnung">
          <h4>
            {OEFFNUNGSART_LABEL[oeffnung.kind]} in Wand {wandNummer} · {oeffnung.width_mm} mm breit
          </h4>
          {darfSchreiben ? (
            <label className="field" htmlFor="oeffnung-art">
              <span className="field__label">Art</span>
              <select
                id="oeffnung-art"
                className="field__input"
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
              { name: "offset_mm", label: "Abstand vom Wandanfang", wert: oeffnung.offset_mm },
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
          <p className="muted">Der Abstand zählt vom Anfang der gerichteten Wand ({wand.x1_mm} / {wand.y1_mm}).</p>
          {darfSchreiben && (
            <button
              type="button"
              className="button button--ghost"
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
        <div className="button-row">
          <button type="button" className="button button--ghost" onClick={() => onAendern(konturUmkehren(entwurf))}>
            Umlaufrichtung umkehren
          </button>
        </div>
      )}

      <h4>Räume dieses Geschosses</h4>
      <Raumliste raeume={raeume} auswahl={auswahl} onWaehlen={onWaehlen} />
    </div>
  );
}

function Befundliste({ befunde }: { befunde: readonly Befund[] }) {
  const codes = [...new Set(befunde.map((b) => b.code))];
  return (
    <ul className="eigenschaften__befunde" aria-label="Hinweise zur Kontur">
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
  if (wand.openings.length === 0) return <p className="muted">Keine Öffnung in dieser Wand.</p>;
  return (
    <ul className="eigenschaften__liste">
      {wand.openings.map((o) => (
        <li key={o.id}>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => onWaehlen({ art: "oeffnung", raumId, wandId: wand.id, oeffnungId: o.id })}
          >
            {OEFFNUNGSART_LABEL[o.kind]} bei {o.offset_mm} mm, {o.width_mm} mm breit
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
  if (raeume.length === 0) return <p className="muted">Noch kein Raum auf diesem Geschoss.</p>;
  return (
    <ul className="eigenschaften__liste">
      {raeume.map((raum) => (
        <li key={raum.id}>
          <button
            type="button"
            className={auswahl?.raumId === raum.id ? "button button--ghost eigenschaften__gewaehlt" : "button button--ghost"}
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
