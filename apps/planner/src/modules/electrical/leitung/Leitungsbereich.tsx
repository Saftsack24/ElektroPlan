import { useState } from "react";

import { Marke } from "../../../core/ui/Marke";
import type { MarkenArt } from "../../../core/ui/Marke";
import { useMasse } from "../../../core/ui/masseinheit";
import { useRueckfrage } from "../../../core/ui/Rueckfrage";
import { FELD, FELD_BESCHRIFTUNG, KNOPFZEILE, eingabefeld, knopf, meldungsflaeche } from "../../../core/ui/stil";
import { querschnittAnzeigen } from "../stromkreise/daten";
import { geraetezustand } from "../stromkreise/zuordnung";
import { MassFeld } from "../wandansicht/WandEigenschaften";
import type { Wandbezug } from "../wandansicht/wandbezug";
import type { DurchfuehrungAusServer, LeitungAusServer } from "./daten";
import { WEGPUNKTART_LABEL } from "./daten";
import { befundOrt, wandpunktInAnsicht } from "./flaechen";
import type { Bearbeitungsflaeche, Leitungskontext } from "./kontext";
import type { Leitungsplanung } from "./useLeitungsplanung";
import type { Wegpunkt } from "./laenge";
import { leitungsbefundText } from "./laenge";

const STATUS: Record<string, { text: string; art: MarkenArt }> = {
  confirmed: { text: "Bestätigt", art: "erfolg" },
  incomplete: { text: "Unvollständig", art: "warnung" },
  conflict: { text: "Konflikt", art: "gefahr" },
};

const LISTENKNOPF = `${knopf("neutral", { klein: true })} w-full text-left`;
const LISTENKNOPF_GEWAEHLT = `${knopf("gewaehlt", { klein: true })} w-full text-left`;

/** Länge, Zugaben und Teilsumme - getrennt und ausdrücklich bezeichnet. */
export function Laengenangabe({
  status,
  geometrischMm,
  zugabenMm,
  laengeMm,
  bekanntMm,
  reserveOffen = false,
}: {
  status: string;
  geometrischMm: number;
  zugabenMm: number;
  laengeMm: number | null;
  bekanntMm: number;
  /** Prozentreserve noch nicht berechenbar (Phase 6c V1) - nie als 0 ausgeben. */
  reserveOffen?: boolean;
}) {
  const masse = useMasse();
  const s = STATUS[status] ?? { text: status, art: "neutral" as const };
  return (
    <div className="flex flex-col gap-0.5" data-testid="leitungslaenge">
      <p className="m-0 flex flex-wrap items-center gap-1.5">
        <Marke art={s.art}>{s.text}</Marke>
        {laengeMm !== null ? (
          <strong>Leitungslänge {masse.anzeigen(laengeMm)}</strong>
        ) : (
          <strong>Teilsumme {masse.anzeigen(bekanntMm)} – keine vollständige Leitungslänge</strong>
        )}
      </p>
      <p className="m-0 text-muted">
        Weg (geometrisch) {masse.anzeigen(geometrischMm)} · Zugaben {masse.anzeigen(zugabenMm)}
        {laengeMm !== null ? ` · zusammen ${masse.anzeigen(laengeMm)}` : ""}
        {reserveOffen ? " · Prozentreserve erst mit vollständigem Weg" : ""}
      </p>
    </div>
  );
}

export function Befundliste({ befunde }: { befunde: readonly { code: string; ort: string; text?: string }[] }) {
  if (befunde.length === 0) return null;
  return (
    <ul className="my-1 pl-[18px]" aria-label="Befunde der Leitung">
      {befunde.map((b, i) => (
        <li key={`${b.code}-${b.ort}-${i}`}>
          {befundOrt(b.ort)}: {b.text ?? leitungsbefundText(b.code)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Seitenfeld „Leitungen“ (Phase 6b.4, seit 6c L2/L3 kompakt).
 *
 * Ohne Entwurf: Leitungen dieser Arbeitsfläche, Auswahl mit Angaben, Länge und Befunden;
 * „Verlauf bearbeiten“, „Angaben …“ (Abschlussdialog), Vorschlag übernehmen, Entfernen und
 * die Gerätezuordnung eines Stromkreises. Mit Entwurf: nur eine Übersicht mit den Wegpunkten
 * (lesen, auswählen) – das lange Formular ist entfallen; Angaben stehen im Dialog, neue
 * Leitungen beginnen oben mit „Leitung hinzufügen“.
 */
export function Leitungsbereich({
  k,
  flaeche,
  bezug,
  relevant,
  gewaehlt,
  onWaehlen,
  gewaehlteDurchfuehrung,
  onDurchfuehrung,
  onWerkzeug,
}: {
  k: Leitungskontext;
  flaeche: Bearbeitungsflaeche;
  /** Wandbezug der gezeigten Wand - für „von links“. */
  bezug?: Pick<Wandbezug, "anfangLinks" | "laengeMm" | "wandId"> | undefined;
  /** Leitungen, die diese Arbeitsfläche berühren. */
  relevant: ReadonlySet<string>;
  gewaehlt: string | null;
  onWaehlen: (id: string | null) => void;
  gewaehlteDurchfuehrung?: DurchfuehrungAusServer | null;
  onDurchfuehrung?: (id: string | null) => void;
  onWerkzeug: (w: "leitung" | "zuordnen" | "auswahl") => void;
}) {
  const p = k.planung;
  if (k.zuordnung.entwurf !== null) return <Zuordnungsfeld k={k} />;
  if (p.entwurf !== null) return <Entwurfsuebersicht k={k} flaeche={flaeche} bezug={bezug} />;
  return (
    <section aria-label="Leitungen" className="flex flex-col gap-2 border-t border-line pt-2 text-small">
      {gewaehlteDurchfuehrung != null && onDurchfuehrung !== undefined && (
        <Durchfuehrungsfeld k={k} d={gewaehlteDurchfuehrung} bezug={bezug} onSchliessen={() => onDurchfuehrung(null)} />
      )}
      <Leitungsliste k={k} relevant={relevant} gewaehlt={gewaehlt} onWaehlen={onWaehlen} onWerkzeug={onWerkzeug} />
    </section>
  );
}

// ------------------------------------------------------------------ Liste

function Leitungsliste({
  k,
  relevant,
  gewaehlt,
  onWaehlen,
  onWerkzeug,
}: {
  k: Leitungskontext;
  relevant: ReadonlySet<string>;
  gewaehlt: string | null;
  onWaehlen: (id: string | null) => void;
  onWerkzeug: (w: "leitung" | "zuordnen" | "auswahl") => void;
}) {
  const p = k.planung;
  const masse = useMasse();
  const fragen = useRueckfrage();
  const [kreisWahl, setKreisWahl] = useState("");
  const [meldung, setMeldung] = useState<string | null>(null);
  const [alle, setAlle] = useState(false);
  const kreis = p.kreise.find((x) => x.id === kreisWahl) ?? p.kreise[0];
  const hier = p.leitungen.filter((l) => relevant.has(l.id));
  const gezeigt = alle ? p.leitungen : hier;
  const auswahl = p.leitungen.find((l) => l.id === gewaehlt);

  const name = (l: LeitungAusServer) => {
    const kr = p.kreisVon(l.circuit_id);
    return `${kr === undefined ? "Stromkreis" : kr.designation} · ${l.label ?? "Leitung"}: ${p.geraetName(l.start_device_id)} → ${p.geraetName(l.end_device_id)}`;
  };

  const zuordnen = () => {
    if (kreis === undefined) return;
    if (k.sperrgrund !== null) {
      setMeldung(k.sperrgrund);
      return;
    }
    setMeldung(null);
    k.zuordnung.oeffnen(kreis);
    onWerkzeug("zuordnen");
  };

  const verlauf = (l: LeitungAusServer) => {
    if (k.sperrgrund !== null) {
      setMeldung(k.sperrgrund);
      return;
    }
    setMeldung(null);
    p.verlaufBearbeiten(l);
  };

  const angaben = (l: LeitungAusServer) => {
    if (k.sperrgrund !== null) {
      setMeldung(k.sperrgrund);
      return;
    }
    setMeldung(null);
    p.angabenBearbeiten(l);
  };

  const entfernen = async (l: LeitungAusServer) => {
    const antwort = await fragen({
      titel: "Leitung entfernen?",
      text: <p>Die Leitung {name(l)} wird mit allen Wegpunkten entfernt. Durchführungen bleiben bestehen.</p>,
      bestaetigenLabel: "Leitung entfernen",
      abbrechenLabel: "Abbrechen",
      gefaehrlich: true,
    });
    if (antwort !== "bestaetigt") return;
    const fehler = await p.loeschen(l);
    setMeldung(fehler);
    if (fehler === null) onWaehlen(null);
  };

  const vorschlag = async (l: LeitungAusServer) => {
    const kr = p.kreisVon(l.circuit_id);
    if (kr === undefined) return;
    const neuText = `${kr.proposed_cable_type ?? "—"} · ${kr.proposed_conductor_count ?? "—"} Leiter · ${querschnittAnzeigen(kr.proposed_cross_section_mm2)}`;
    const antwort = await fragen({
      titel: "Stromkreisvorschlag übernehmen?",
      text: (
        <>
          <p>Für die Leitung {name(l)} werden die Kabelangaben durch den aktuellen Vorschlag von {p.kreisName(kr)} ersetzt:</p>
          <p>
            <strong>{neuText}</strong>
          </p>
          <p>Weg, Endgeräte, Zugaben und Bezeichnung bleiben unverändert. Andere Leitungen ändern sich nicht.</p>
        </>
      ),
      bestaetigenLabel: "Vorschlag übernehmen",
      abbrechenLabel: "Abbrechen",
      gefaehrlich: false,
    });
    if (antwort !== "bestaetigt") return;
    setMeldung((await p.vorschlagUebernehmen(l)) ?? "Vorschlag übernommen.");
  };

  return (
    <>
      <h4 className="m-0">Leitungen</h4>
      {meldung !== null && (
        <p className={`${meldungsflaeche("schlicht")} m-0`} role="status">
          {meldung}
        </p>
      )}
      {p.hinweis !== null && (
        <p className="m-0 text-muted" role="status">
          {p.hinweis}
        </p>
      )}
      {!p.geladen ? (
        <p className="m-0 text-muted">Leitungen werden geladen …</p>
      ) : p.ladefehler ? (
        <p className={meldungsflaeche()} role="alert">
          Leitungen und Stromkreise konnten nicht geladen werden.
        </p>
      ) : (
        <>
          {gezeigt.length === 0 ? (
            <p className="m-0 text-muted">{alle ? "Im Gebäude ist noch keine Leitung geplant." : "Hier verläuft noch keine Leitung."}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label="Leitungsliste">
              {gezeigt.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    className={l.id === gewaehlt ? LISTENKNOPF_GEWAEHLT : LISTENKNOPF}
                    aria-current={l.id === gewaehlt ? "true" : undefined}
                    onClick={() => onWaehlen(l.id === gewaehlt ? null : l.id)}
                  >
                    <span className="flex flex-wrap items-center gap-1.5">
                      {name(l)}
                      <Marke art={STATUS[l.status]?.art ?? "neutral"}>{STATUS[l.status]?.text ?? l.status}</Marke>
                      <span className="text-muted">
                        {l.length_mm !== null ? masse.anzeigen(l.length_mm) : `Teilsumme ${masse.anzeigen(l.known_mm)}`}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {p.leitungen.length > hier.length && (
            <button type="button" className={knopf("einfach", { klein: true })} onClick={() => setAlle((a) => !a)}>
              {alle ? "Nur Leitungen dieser Fläche" : `Alle Leitungen des Gebäudes (${p.leitungen.length})`}
            </button>
          )}
          {auswahl !== undefined && (
            <div className="flex flex-col gap-1.5 border-t border-line pt-2" role="group" aria-label="Gewählte Leitung">
              <p className="m-0">
                <strong>{name(auswahl)}</strong>
              </p>
              <p className="m-0">
                Kabel: {auswahl.cable_type ?? "Typ fehlt"} · {auswahl.conductor_count ?? "?"} Leiter · {querschnittAnzeigen(auswahl.cross_section_mm2)}
                {!auswahl.spec_complete && " (unvollständig angegeben)"}
              </p>
              {auswahl.deviates_from_proposal && (
                <p className="m-0">
                  <Marke art="warnung">weicht vom aktuellen Stromkreisvorschlag ab</Marke>
                </p>
              )}
              <Laengenangabe
                status={auswahl.status}
                geometrischMm={auswahl.geometric_mm}
                zugabenMm={auswahl.allowance_mm}
                laengeMm={auswahl.length_mm}
                bekanntMm={auswahl.known_mm}
                reserveOffen={auswahl.reserve_pending}
              />
              <Befundliste befunde={auswahl.problems.map((b) => ({ code: b.code, ort: b.ref }))} />
              {p.unlesbar(auswahl) && (
                <p className={meldungsflaeche("schlicht")}>Diese Leitung enthält Wegpunkte, die hier nicht gelesen werden können – Bearbeiten ist gesperrt.</p>
              )}
              <div className={KNOPFZEILE}>
                {p.darfLeitungen && (
                  <>
                    <button type="button" className={knopf("primaer", { klein: true })} disabled={p.unlesbar(auswahl)} onClick={() => verlauf(auswahl)}>
                      Verlauf bearbeiten
                    </button>
                    <button type="button" className={knopf("neutral", { klein: true })} disabled={p.unlesbar(auswahl)} onClick={() => angaben(auswahl)}>
                      Angaben …
                    </button>
                  </>
                )}
                {p.darfStromkreise && auswahl.deviates_from_proposal && (
                  <button type="button" className={knopf("neutral", { klein: true })} onClick={() => void vorschlag(auswahl)}>
                    Vorschlag übernehmen
                  </button>
                )}
                {p.darfLeitungen && (
                  <button type="button" className={knopf("neutral", { klein: true })} onClick={() => void entfernen(auswahl)}>
                    Leitung entfernen
                  </button>
                )}
              </div>
            </div>
          )}
          {p.darfStromkreise && p.kreise.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-line pt-2">
              <label className={FELD}>
                <span className={FELD_BESCHRIFTUNG}>Geräte einem Stromkreis zuordnen</span>
                <select className={eingabefeld({ kompakt: true })} value={kreis?.id ?? ""} onChange={(event) => setKreisWahl(event.target.value)}>
                  {p.kreise.map((kr) => (
                    <option key={kr.id} value={kr.id}>
                      {p.kreisName(kr)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={knopf("neutral", { klein: true })} onClick={zuordnen}>
                  Geräte zuordnen
                </button>
              </div>
            </div>
          )}
          {p.kreise.length === 0 && (
            <p className="m-0 text-muted">Für Leitungen zuerst in der Ansicht „Stromkreise“ eine Verteilung und einen Stromkreis anlegen.</p>
          )}
          {p.darfLeitungen && <p className="m-0 text-muted">Neue Leitungen: oben „Leitung hinzufügen“ (L), dann Startgerät anklicken.</p>}
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Entwurf

/** Verständlicher Ort eines Wegpunkts - ohne IDs. */
function wegpunktText(
  wp: Wegpunkt,
  k: Leitungskontext,
  bezug: Pick<Wandbezug, "anfangLinks" | "laengeMm" | "wandId"> | undefined,
  anzeigen: (mm: number) => string,
): string {
  switch (wp.art) {
    case "wand": {
      if (bezug !== undefined && bezug.wandId === wp.wandId) {
        const a = wandpunktInAnsicht(bezug, wp.abstandMm, wp.hoeheMm);
        return `diese Wand · ${anzeigen(a.u)} von links · ${anzeigen(a.h)} hoch`;
      }
      return `${k.wandName(wp.wandId)} · ${anzeigen(wp.abstandMm)} ab Wandanfang · ${anzeigen(wp.hoeheMm)} hoch`;
    }
    case "ceiling":
    case "floor":
      // Gebäudeweiter Entwurf (6b.5): Raum immer mit Geschoss - eindeutig auch nach einem Geschosswechsel.
      return `${k.planung.raumMitGeschoss(wp.raumId)} · x ${anzeigen(wp.x)}, y ${anzeigen(wp.y)}`;
    case "durchfuehrung": {
      const d = k.planung.durchfuehrungen.find((x) => x.id === wp.durchfuehrungId);
      if (d !== undefined) return `${k.wandName(d.wall_a_id)} ↔ ${k.wandName(d.wall_b_id)} · ${anzeigen(d.height_mm)} hoch`;
      const neu = k.planung.entwurf?.werte.neueDurchfuehrungen.find((x) => x.schluessel === wp.durchfuehrungId);
      const kopplung = neu === undefined ? undefined : k.planung.vorbereitet?.kopplungen.get(neu.kopplungId);
      if (neu === undefined || kopplung === undefined) return "unbekannte Durchführung";
      return `neu, entsteht beim Speichern · ${k.wandName(kopplung.wandA)} ↔ ${k.wandName(kopplung.wandB)} · ${anzeigen(neu.hoeheMm)} hoch`;
    }
    case "uebergang":
      return `${k.wandName(wp.wandId)} · ${anzeigen(wp.abstandMm)} ab Wandanfang`;
    case "steigweg":
      return steigwegText(wp, k.planung, anzeigen);
  }
}

/** „Steigweg S1: EG (Einstieg 0 cm) → OG (Ausstieg 0 cm)“ - ohne IDs. */
export function steigwegText(
  wp: Extract<Wegpunkt, { art: "steigweg" }>,
  p: Pick<Leitungsplanung, "steigwege" | "geschossName">,
  anzeigen: (mm: number) => string,
): string {
  const s = p.steigwege.find((x) => x.id === wp.steigwegId);
  if (s === undefined) return "unbekannter Steigweg";
  const halt = (id: string) => {
    const h = s.stops.find((x) => x.id === id);
    return h === undefined ? "unbekannter Halt" : p.geschossName(h.floor_id);
  };
  return `${s.name}: ${halt(wp.vonHalt)} (Einstieg ${anzeigen(wp.vonHoeheMm)}) → ${halt(wp.nachHalt)} (Ausstieg ${anzeigen(wp.nachHoeheMm)})`;
}

/**
 * Offener Leitungsentwurf im Eigenschaftenpanel (6c, L3): kompakt - Stand, Start und Ziel,
 * Ergebnis und die Wegpunkte zum Lesen und Auswählen. Angaben stehen im Abschlussdialog,
 * Punkte werden in der Fläche gesetzt, verschoben und (mit Entf) entfernt.
 */
function Entwurfsuebersicht({
  k,
  flaeche,
  bezug,
}: {
  k: Leitungskontext;
  flaeche: Bearbeitungsflaeche;
  bezug: Pick<Wandbezug, "anfangLinks" | "laengeMm" | "wandId"> | undefined;
}) {
  const p = k.planung;
  const masse = useMasse();
  const e = p.entwurf;
  if (e === null) return null;
  const w = e.werte;
  const kreis = p.kreisVon(w.circuitId);
  const ergebnis = p.ergebnis;
  return (
    <section aria-label="Leitungsentwurf" className="flex flex-col gap-2 border-t border-line pt-2 text-small">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="m-0">
          {e.cableId === null ? "Neue Leitung" : `Leitung ${w.label === "" ? "ohne Bezeichnung" : w.label}`}
          {kreis !== undefined ? ` · ${p.kreisName(kreis)}` : ""}
        </h4>
        <Marke art={e.fehler !== null ? "gefahr" : p.ungespeichert ? "warnung" : "neutral"}>
          {e.status === "speichert" ? "Wird gespeichert …" : e.fehler !== null ? "Nicht gespeichert" : p.ungespeichert ? "Ungespeichert" : "Gespeichert"}
        </Marke>
      </div>
      {p.hinweis !== null && (
        <p className="m-0 text-muted" role="status" data-testid="leitung-hinweis">
          {p.hinweis}
        </p>
      )}
      <p className="m-0">
        {w.startId === null ? "Startgerät noch nicht gewählt" : p.geraetName(w.startId)} → {w.endId === null ? "offen" : p.geraetName(w.endId)}
      </p>
      {ergebnis !== null && (
        <>
          <Laengenangabe
            status={ergebnis.status}
            geometrischMm={ergebnis.geometrischMm}
            zugabenMm={ergebnis.zugabenMm}
            laengeMm={ergebnis.laengeMm}
            bekanntMm={ergebnis.bekanntMm}
            reserveOffen={ergebnis.reserveOffen}
          />
          <Befundliste befunde={ergebnis.befunde} />
        </>
      )}
      <div>
        <h5 className="m-0 mb-1">Wegpunkte ({w.wegpunkte.length})</h5>
        {w.wegpunkte.length === 0 ? (
          <p className="m-0 text-muted">Noch kein Wegpunkt gesetzt.</p>
        ) : (
          <ol className="m-0 flex flex-col gap-0.5 pl-[22px]" aria-label="Wegpunkte">
            {w.wegpunkte.map((wp, i) => (
              <li key={i}>
                <button
                  type="button"
                  className={e.auswahl === i ? LISTENKNOPF_GEWAEHLT : LISTENKNOPF}
                  aria-current={e.auswahl === i ? "true" : undefined}
                  onClick={() => p.dispatch({ typ: "auswaehlen", auswahl: e.auswahl === i ? null : i })}
                >
                  {WEGPUNKTART_LABEL[wp.art]} · {wegpunktText(wp, k, bezug, masse.anzeigen)}
                </button>
              </li>
            ))}
          </ol>
        )}
        <p className="m-0 mt-1 text-muted">
          Neue Punkte kommen immer ans Ende. Ein gewählter Punkt lässt sich in der Fläche ziehen, mit den Pfeiltasten verschieben und
          mit Entf entfernen.{flaeche.art === "grundriss" ? "" : " Fußboden-, Bodenübergangs- und Steigwegpunkte bearbeitet der Grundriss."}
        </p>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ Durchführung

function Durchfuehrungsfeld({
  k,
  d,
  bezug,
  onSchliessen,
}: {
  k: Leitungskontext;
  d: DurchfuehrungAusServer;
  bezug: Pick<Wandbezug, "anfangLinks" | "laengeMm" | "wandId"> | undefined;
  onSchliessen: () => void;
}) {
  const p = k.planung;
  const masse = useMasse();
  const fragen = useRueckfrage();
  const [meldung, setMeldung] = useState<string | null>(null);
  const eigentuemer = bezug !== undefined && bezug.wandId === d.wall_a_id;
  const darf = p.darfLeitungen && p.entwurf === null;
  const u = bezug !== undefined && eigentuemer ? wandpunktInAnsicht(bezug, d.offset_mm, d.height_mm).u : null;
  const verschieben = (werte: { offset_mm: number; height_mm: number }) => {
    void p.durchfuehrungAendern(d, werte).then(setMeldung);
    return undefined;
  };
  return (
    <div className="flex flex-col gap-1.5 rounded-ep border border-line p-2" role="group" aria-label="Gewählte Durchführung">
      <div className="flex items-center justify-between gap-2">
        <strong>Durchführung</strong>
        <button type="button" className={knopf("einfach", { klein: true })} onClick={onSchliessen}>
          Schließen
        </button>
      </div>
      <p className="m-0">
        {k.wandName(d.wall_a_id)} ↔ {k.wandName(d.wall_b_id)} · Höhe {masse.anzeigen(d.height_mm)} · genutzt von{" "}
        {d.cable_ids.length === 1 ? "einer Leitung" : `${d.cable_ids.length} Leitungen`}
      </p>
      {d.problem_code !== null && <p className="m-0 text-danger">{leitungsbefundText(d.problem_code)}</p>}
      {meldung !== null && (
        <p className={meldungsflaeche("schlicht")} role="status">
          {meldung}
        </p>
      )}
      {!eigentuemer ? (
        <p className="m-0 text-muted">Die Lage wird an der Wand bearbeitet, an der die Durchführung gespeichert ist ({k.wandName(d.wall_a_id)}).</p>
      ) : (
        <>
          <MassFeld
            id="durchfuehrung-links"
            label="Abstand von links"
            wertMm={u ?? 0}
            gesperrt={!darf}
            onUebernehmen={(mm) => (bezug === undefined ? undefined : verschieben({ offset_mm: bezug.anfangLinks ? mm : bezug.laengeMm - mm, height_mm: d.height_mm }))}
          />
          <MassFeld id="durchfuehrung-hoehe" label="Höhe über Boden" wertMm={d.height_mm} gesperrt={!darf} onUebernehmen={(mm) => verschieben({ offset_mm: d.offset_mm, height_mm: mm })} />
          {p.entwurf !== null && <p className="m-0 text-muted">Nur ohne offenen Leitungsentwurf änderbar.</p>}
          <p className="m-0 text-muted">
            Verschoben wird nur an eine zulässige Stelle. Unterbricht das Leitungen, fragt ElektroPlan nach und nennt sie.
          </p>
        </>
      )}
      {darf && d.cable_ids.length === 0 && (
        <button
          type="button"
          className={knopf("neutral", { klein: true })}
          onClick={() =>
            void fragen({
              titel: "Durchführung entfernen?",
              text: <p>Die ungenutzte Durchführung wird entfernt.</p>,
              bestaetigenLabel: "Durchführung entfernen",
              abbrechenLabel: "Abbrechen",
              gefaehrlich: true,
            }).then(async (a) => {
              if (a !== "bestaetigt") return;
              const fehler = await p.durchfuehrungEntfernen(d);
              setMeldung(fehler);
              if (fehler === null) onSchliessen();
            })
          }
        >
          Durchführung entfernen
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Zuordnung

function Zuordnungsfeld({ k }: { k: Leitungskontext }) {
  const z = k.zuordnung;
  const p = k.planung;
  const e = z.entwurf;
  if (e === null) return null;
  const kreis = p.kreisVon(e.circuitId);
  const zuordnung = new Map(p.kreise.flatMap((kr) => kr.device_ids.map((id) => [id, kr] as const)));
  const zuordenbar = p.geraete.filter((g) => g.zuordenbar);
  const gewaehlt = zuordenbar.filter((g) => geraetezustand(g.id, true, e, zuordnung) === "dieser");
  return (
    <section aria-label="Gerätezuordnung" className="flex flex-col gap-2 border-t border-line pt-2 text-small">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="m-0">Geräte zuordnen · {kreis === undefined ? "Stromkreis" : p.kreisName(kreis)}</h4>
        <Marke art={z.offen ? "warnung" : "neutral"}>{z.offen ? "Ungespeicherte Zuordnung" : "Gespeichert"}</Marke>
      </div>
      <p className="m-0 text-muted">
        Werkzeug „Zuordnen“ (Z): Klick auf ein Gerät schaltet es im Entwurf um. Geräte eines anderen Stromkreises bleiben dort;
        Datendosen und die Lage einer Verteilung sind nicht zuordenbar. Dieselbe Zuordnung wie in der Ansicht „Stromkreise“.
      </p>
      {z.fehler !== null && (
        <div className={meldungsflaeche()} role="alert">
          <p className="m-0">{z.fehler}</p>
          {z.konflikt && (
            <button type="button" className={`${knopf("neutral", { klein: true })} mt-2`} onClick={() => void z.neuLaden()}>
              Zuordnung verwerfen und neu laden
            </button>
          )}
        </div>
      )}
      <p className="m-0">
        Zugeordnet: {gewaehlt.length === 0 ? "keine Geräte" : gewaehlt.map((g) => `${g.name} (${g.raum})`).join(", ")}
      </p>
      <div className={KNOPFZEILE}>
        {p.darfStromkreise && (
          <>
            <button type="button" className={knopf("primaer")} disabled={!z.offen || z.speichert} onClick={() => void z.speichern()}>
              {z.speichert ? "Wird gespeichert ..." : "Zuordnung speichern"}
            </button>
            <button type="button" className={knopf()} disabled={!z.offen || z.speichert || kreis === undefined} onClick={() => kreis !== undefined && z.verwerfen(kreis)}>
              Verwerfen
            </button>
          </>
        )}
        <button type="button" className={knopf()} onClick={() => void k.zuordnungSchliessen()}>
          Schließen
        </button>
      </div>
    </section>
  );
}
