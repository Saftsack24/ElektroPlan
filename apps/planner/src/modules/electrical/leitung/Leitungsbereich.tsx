import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { Marke } from "../../../core/ui/Marke";
import type { MarkenArt } from "../../../core/ui/Marke";
import { useMasse } from "../../../core/ui/masseinheit";
import { useRueckfrage } from "../../../core/ui/Rueckfrage";
import { FELD, FELD_BESCHRIFTUNG, FELD_FEHLER, FELD_HINWEIS, KNOPFZEILE, eingabefeld, knopf, meldungsflaeche } from "../../../core/ui/stil";
import { querschnittAnzeigen } from "../stromkreise/daten";
import { geraetezustand } from "../stromkreise/zuordnung";
import { MassFeld } from "../wandansicht/WandEigenschaften";
import type { Wandbezug } from "../wandansicht/wandbezug";
import type { DurchfuehrungAusServer, LeitungAusServer } from "./daten";
import { WEGPUNKTART_LABEL, inAnsichtBearbeitbar } from "./daten";
import type { Leitungswerte, Vorschlagsvergleich } from "./entwurf";
import { vorschlagVergleichen, wegpunktEntfernen } from "./entwurf";
import { befundOrt, wandpunktInAnsicht } from "./flaechen";
import type { Arbeitsflaeche, Leitungskontext } from "./kontext";
import type { Leitungsergebnis, Wegpunkt } from "./laenge";
import { leitungsbefundText } from "./laenge";

const STATUS: Record<string, { text: string; art: MarkenArt }> = {
  confirmed: { text: "Bestätigt", art: "erfolg" },
  incomplete: { text: "Unvollständig", art: "warnung" },
  conflict: { text: "Konflikt", art: "gefahr" },
};

const VERGLEICH: Record<Vorschlagsvergleich, { text: string; art: MarkenArt } | null> = {
  "wie-vorschlag": { text: "aus Vorschlag", art: "info" },
  abweichend: { text: "abweichend vom Vorschlag", art: "warnung" },
  "kein-vorschlag": null,
};

const LISTENKNOPF = `${knopf("neutral", { klein: true })} w-full text-left`;
const LISTENKNOPF_GEWAEHLT = `${knopf("gewaehlt", { klein: true })} w-full text-left`;

/** Textfeld, das erst beim Verlassen oder mit Enter übernimmt - ein Rückgängig-Schritt je Eingabe. */
function UebernahmeFeld({
  id,
  label,
  wert,
  gesperrt,
  hinweis,
  marke,
  onUebernehmen,
}: {
  id: string;
  label: string;
  wert: string;
  gesperrt: boolean;
  hinweis?: string;
  marke?: ReactNode;
  onUebernehmen: (text: string) => void;
}) {
  const [text, setText] = useState(wert);
  const [stand, setStand] = useState(wert);
  if (stand !== wert) {
    setStand(wert);
    setText(wert);
  }
  const uebernehmen = () => {
    if (text !== wert) onUebernehmen(text);
  };
  return (
    <div className={FELD}>
      <label className={`${FELD_BESCHRIFTUNG} flex flex-wrap items-center gap-1.5`} htmlFor={id}>
        {label} {marke}
      </label>
      <input
        id={id}
        className={eingabefeld({ kompakt: true })}
        value={text}
        disabled={gesperrt}
        onChange={(event) => setText(event.target.value)}
        onBlur={uebernehmen}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") {
            event.preventDefault();
            uebernehmen();
          }
        }}
      />
      {hinweis !== undefined && <span className={FELD_HINWEIS}>{hinweis}</span>}
    </div>
  );
}

/** Länge, Zugaben und Teilsumme - getrennt und ausdrücklich bezeichnet. */
export function Laengenangabe({
  status,
  geometrischMm,
  zugabenMm,
  laengeMm,
  bekanntMm,
}: {
  status: string;
  geometrischMm: number;
  zugabenMm: number;
  laengeMm: number | null;
  bekanntMm: number;
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
      </p>
    </div>
  );
}

function Befundliste({ befunde }: { befunde: readonly { code: string; ort: string; text?: string }[] }) {
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
 * Seitenfeld „Leitungen“ der Wand- und Deckenansicht (Phase 6b.4).
 *
 * Ohne Entwurf: Leitungen dieser Arbeitsfläche, Auswahl mit Angaben, Länge und
 * Befunden; neue Leitung, Bearbeiten, Vorschlag übernehmen, Entfernen und die
 * Gerätezuordnung eines Stromkreises. Mit Entwurf: Ablauf, Endgeräte,
 * Kabelangaben, Zugaben, Wegpunkte, Ergebnis und bewusstes Speichern.
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
  flaeche: Arbeitsflaeche;
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
  if (p.entwurf !== null) return <Entwurfsfeld k={k} flaeche={flaeche} bezug={bezug} onWerkzeug={onWerkzeug} />;
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

  const neu = () => {
    if (kreis === undefined) return;
    if (k.sperrgrund !== null) {
      setMeldung(k.sperrgrund);
      return;
    }
    setMeldung(null);
    p.neueLeitung(kreis.id);
    onWerkzeug("leitung");
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

  const bearbeiten = (l: LeitungAusServer) => {
    if (k.sperrgrund !== null) {
      setMeldung(k.sperrgrund);
      return;
    }
    setMeldung(null);
    p.bearbeiten(l);
    onWerkzeug("leitung");
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
              />
              <Befundliste befunde={auswahl.problems.map((b) => ({ code: b.code, ort: b.ref }))} />
              {p.unlesbar(auswahl) && (
                <p className={meldungsflaeche("schlicht")}>Diese Leitung enthält Wegpunkte, die hier nicht gelesen werden können – Bearbeiten ist gesperrt.</p>
              )}
              <div className={KNOPFZEILE}>
                {p.darfLeitungen && (
                  <button type="button" className={knopf("primaer", { klein: true })} disabled={p.unlesbar(auswahl)} onClick={() => bearbeiten(auswahl)}>
                    Leitung bearbeiten
                  </button>
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
          {(p.darfLeitungen || p.darfStromkreise) && p.kreise.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-line pt-2">
              <label className={FELD}>
                <span className={FELD_BESCHRIFTUNG}>Stromkreis</span>
                <select className={eingabefeld({ kompakt: true })} value={kreis?.id ?? ""} onChange={(event) => setKreisWahl(event.target.value)}>
                  {p.kreise.map((kr) => (
                    <option key={kr.id} value={kr.id}>
                      {p.kreisName(kr)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                {p.darfLeitungen && (
                  <button type="button" className={knopf("primaer", { klein: true })} onClick={neu}>
                    Neue Leitung
                  </button>
                )}
                {p.darfStromkreise && (
                  <button type="button" className={knopf("neutral", { klein: true })} onClick={zuordnen}>
                    Geräte zuordnen
                  </button>
                )}
              </div>
            </div>
          )}
          {p.kreise.length === 0 && (
            <p className="m-0 text-muted">Für Leitungen zuerst in der Ansicht „Stromkreise“ eine Verteilung und einen Stromkreis anlegen.</p>
          )}
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
      return `${k.raumName(wp.raumId)} · x ${anzeigen(wp.x)}, y ${anzeigen(wp.y)}`;
    case "durchfuehrung": {
      const d = k.planung.durchfuehrungen.find((x) => x.id === wp.durchfuehrungId);
      return d === undefined ? "unbekannte Durchführung" : `${k.wandName(d.wall_a_id)} ↔ ${k.wandName(d.wall_b_id)} · ${anzeigen(d.height_mm)} hoch`;
    }
    case "uebergang":
      return `${k.wandName(wp.wandId)} · ${anzeigen(wp.abstandMm)} ab Wandanfang`;
    case "steigweg":
      return "Steigweg zwischen Geschossen";
  }
}

/** Nächster Schritt des Ablaufs - verständlich, ohne Fachcodes. */
function naechsterSchritt(w: Leitungswerte, ergebnis: Leitungsergebnis | null): string {
  if (w.startId === null) return "1. Startgerät wählen – im Feld oder mit dem Werkzeug „Leitung“ auf ein Gerät des Stromkreises klicken.";
  if (w.wegpunkte.length === 0) return "2. Verlauf setzen – Werkzeug „Leitung“ (L), dann auf die Wand bzw. Decke klicken.";
  if (w.endId === null) return "3. Endgerät wählen – im Feld oder auf das Gerät klicken.";
  if (ergebnis !== null && ergebnis.status !== "confirmed") return "4. Befunde prüfen – der Weg ist noch nicht vollständig gültig.";
  return "4. Länge prüfen und bewusst speichern.";
}

function Entwurfsfeld({
  k,
  flaeche,
  bezug,
  onWerkzeug,
}: {
  k: Leitungskontext;
  flaeche: Arbeitsflaeche;
  bezug: Pick<Wandbezug, "anfangLinks" | "laengeMm" | "wandId"> | undefined;
  onWerkzeug: (w: "leitung" | "zuordnen" | "auswahl") => void;
}) {
  const p = k.planung;
  const masse = useMasse();
  const e = p.entwurf;
  if (e === null) return null;
  const w = e.werte;
  const kreis = p.kreisVon(w.circuitId);
  const darf = p.darfLeitungen && e.status !== "speichert";
  const aendern = (neu: Leitungswerte) => p.dispatch({ typ: "aendern", werte: neu });
  const vergleich = kreis === undefined ? null : vorschlagVergleichen(w, kreis);
  const marke = (feld: "kabeltyp" | "leiterzahl" | "querschnitt") => {
    const v = vergleich === null ? null : VERGLEICH[vergleich[feld]];
    return v === null ? undefined : <Marke art={v.art}>{v.text}</Marke>;
  };
  const endpunkte = p.endpunkte(w.circuitId);
  const geraetOption = (id: string | null) => (
    <option key={id ?? "leer"} value={id ?? ""}>
      {id === null ? "– noch nicht gewählt –" : p.geraetName(id)}
    </option>
  );
  const ergebnis = p.ergebnis;
  const lokaleFehler = new Map((e.fehler?.eintraege ?? []).map((x) => [x.feld, x.meldung]));

  return (
    <section aria-label="Leitungsentwurf" className="flex flex-col gap-2 border-t border-line pt-2 text-small">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="m-0">
          {e.cableId === null ? "Neue Leitung" : `Leitung ${w.label === "" ? "ohne Bezeichnung" : w.label}`}
          {kreis !== undefined ? ` · ${p.kreisName(kreis)}` : ""}
        </h4>
        <Marke art={e.fehler !== null ? "gefahr" : p.ungespeichert ? "warnung" : "neutral"}>
          {e.status === "speichert"
            ? "Wird gespeichert …"
            : e.status === "konflikt"
              ? "Konflikt – nicht gespeichert"
              : e.fehler !== null
                ? "Nicht gespeichert"
                : p.ungespeichert
                  ? "Ungespeichert"
                  : "Gespeichert"}
        </Marke>
      </div>
      {p.hinweis !== null && (
        <p className="m-0 text-muted" role="status" data-testid="leitung-hinweis">
          {p.hinweis}
        </p>
      )}
      <p className="m-0 text-muted" data-testid="leitung-schritt">
        {naechsterSchritt(w, ergebnis)}
      </p>

      <UebernahmeFeld id="leitung-label" label="Bezeichnung" wert={w.label} gesperrt={!darf} onUebernehmen={(t) => aendern({ ...w, label: t.trim() })} />
      <label className={FELD}>
        <span className={FELD_BESCHRIFTUNG}>Startgerät</span>
        <select
          className={eingabefeld({ kompakt: true })}
          value={w.startId ?? ""}
          disabled={!darf}
          onChange={(event) => aendern({ ...w, startId: event.target.value === "" ? null : event.target.value })}
        >
          {geraetOption(null)}
          {endpunkte.filter((g) => g.id !== w.endId).map((g) => geraetOption(g.id))}
        </select>
      </label>
      <label className={FELD}>
        <span className={FELD_BESCHRIFTUNG}>Endgerät</span>
        <select
          className={eingabefeld({ kompakt: true, fehler: lokaleFehler.has("end_device_id") })}
          value={w.endId ?? ""}
          disabled={!darf}
          onChange={(event) => aendern({ ...w, endId: event.target.value === "" ? null : event.target.value })}
        >
          {geraetOption(null)}
          {endpunkte.filter((g) => g.id !== w.startId).map((g) => geraetOption(g.id))}
        </select>
        {lokaleFehler.has("end_device_id") && <span className={FELD_FEHLER}>{lokaleFehler.get("end_device_id")}</span>}
      </label>
      <p className="m-0 text-muted">
        Endgeräte: die Verteilung und dem Stromkreis zugeordnete Geräte. Außen montierte Geräte werden noch nicht angeschlossen.
      </p>

      <fieldset className="m-0 flex flex-col gap-1.5 rounded-ep border border-line p-2">
        <legend className="px-1 text-label text-muted">Kabelangaben an dieser Leitung</legend>
        <UebernahmeFeld id="leitung-typ" label="Leitungstyp" wert={w.kabeltyp} gesperrt={!darf} marke={marke("kabeltyp")} onUebernehmen={(t) => aendern({ ...w, kabeltyp: t })} />
        <UebernahmeFeld id="leitung-leiter" label="Leiterzahl" wert={w.leiterzahl} gesperrt={!darf} marke={marke("leiterzahl")} onUebernehmen={(t) => aendern({ ...w, leiterzahl: t })} />
        <UebernahmeFeld
          id="leitung-querschnitt"
          label="Querschnitt (mm²)"
          wert={w.querschnitt}
          gesperrt={!darf}
          marke={marke("querschnitt")}
          onUebernehmen={(t) => aendern({ ...w, querschnitt: t })}
        />
        {(lokaleFehler.has("conductor_count") || lokaleFehler.has("cross_section_mm2")) && (
          <span className={FELD_FEHLER}>{lokaleFehler.get("conductor_count") ?? lokaleFehler.get("cross_section_mm2")}</span>
        )}
        <p className="m-0 text-muted">Angaben der Elektrofachkraft – ElektroPlan prüft und bemisst nichts.</p>
      </fieldset>

      <fieldset className="m-0 grid grid-cols-1 gap-1.5 rounded-ep border border-line p-2">
        <legend className="px-1 text-label text-muted">Zugaben (ausdrücklich je Leitung)</legend>
        <MassFeld id="leitung-zugabe-start" label="Zugabe am Start" wertMm={w.startzugabeMm} gesperrt={!darf} onUebernehmen={(mm) => zugabe(mm, (v) => aendern({ ...w, startzugabeMm: v }))} />
        <MassFeld id="leitung-zugabe-ende" label="Zugabe am Ende" wertMm={w.endzugabeMm} gesperrt={!darf} onUebernehmen={(mm) => zugabe(mm, (v) => aendern({ ...w, endzugabeMm: v }))} />
        <MassFeld id="leitung-reserve" label="Reserve" wertMm={w.reserveMm} gesperrt={!darf} onUebernehmen={(mm) => zugabe(mm, (v) => aendern({ ...w, reserveMm: v }))} />
      </fieldset>

      <div>
        <h5 className="m-0 mb-1">Wegpunkte ({w.wegpunkte.length})</h5>
        {w.wegpunkte.length === 0 ? (
          <p className="m-0 text-muted">Noch kein Wegpunkt gesetzt.</p>
        ) : (
          <ol className="m-0 flex flex-col gap-0.5 pl-[22px]" aria-label="Wegpunkte">
            {w.wegpunkte.map((wp, i) => {
              const bearbeitbar = inAnsichtBearbeitbar(wp);
              return (
                <li key={i}>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      className={e.auswahl === i ? LISTENKNOPF_GEWAEHLT : LISTENKNOPF}
                      aria-current={e.auswahl === i ? "true" : undefined}
                      onClick={() => p.dispatch({ typ: "auswaehlen", auswahl: e.auswahl === i ? null : i })}
                    >
                      {WEGPUNKTART_LABEL[wp.art]} · {wegpunktText(wp, k, bezug, masse.anzeigen)}
                    </button>
                    {!bearbeitbar && <Marke art="neutral">hier nicht bearbeitbar – bleibt unverändert</Marke>}
                    {bearbeitbar && darf && (
                      <button
                        type="button"
                        className={knopf("einfach", { klein: true })}
                        aria-label={`Wegpunkt ${i + 1} entfernen`}
                        onClick={() => p.dispatch({ typ: "aendern", werte: wegpunktEntfernen(w, i), auswahl: null })}
                      >
                        Entfernen
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        <p className="m-0 mt-1 text-muted">
          Ein neuer Punkt folgt dem gewählten Wegpunkt, sonst kommt er ans Ende. Fußboden-, Bodenübergangs- und Steigwegpunkte
          werden mit dem Grundriss (6b.5) bearbeitet; hier bleiben sie unverändert erhalten.
        </p>
      </div>

      {ergebnis !== null && (
        <div className="border-t border-line pt-2" role="group" aria-label="Ergebnis der Leitung">
          <Laengenangabe
            status={ergebnis.status}
            geometrischMm={ergebnis.geometrischMm}
            zugabenMm={ergebnis.zugabenMm}
            laengeMm={ergebnis.laengeMm}
            bekanntMm={ergebnis.bekanntMm}
          />
          <Befundliste befunde={ergebnis.befunde} />
        </div>
      )}

      {/* Rückmeldung zum Speichern direkt an den Knöpfen - sonst läge sie außerhalb des sichtbaren Bereichs. */}
      {e.fehler !== null && (
        <div className={meldungsflaeche()} role="alert">
          <p className="m-0">{e.fehler.meldung}</p>
          {e.fehler.eintraege.length > 0 && (
            <ul className="my-1 pl-[18px]">
              {e.fehler.eintraege.map((x, i) => (
                <li key={`${x.code}-${i}`}>{x.meldung}</li>
              ))}
            </ul>
          )}
          <div className={KNOPFZEILE}>
            {e.status === "konflikt" && (
              <button type="button" className={knopf("neutral", { klein: true })} onClick={() => void p.verwerfenUndNeuLaden()}>
                Entwurf verwerfen und Serverstand laden
              </button>
            )}
            <button type="button" className={knopf("neutral", { klein: true })} onClick={() => p.dispatch({ typ: "hinweis-schliessen" })}>
              {e.status === "konflikt" ? "Entwurf vorerst behalten" : "Hinweis schließen"}
            </button>
          </div>
        </div>
      )}

      {p.darfLeitungen && (
        <div className={KNOPFZEILE}>
          <button type="button" className={knopf("primaer")} disabled={!p.ungespeichert || e.status === "speichert"} onClick={() => void p.speichern()}>
            Leitung speichern
          </button>
          <button type="button" className={knopf()} disabled={!p.ungespeichert || e.status === "speichert"} onClick={() => p.dispatch({ typ: "verwerfen" })}>
            Änderungen verwerfen
          </button>
          <button type="button" className={knopf()} disabled={e.status === "speichert"} onClick={() => void k.leitungSchliessen().then((ok) => ok && onWerkzeug("auswahl"))}>
            Entwurf schließen
          </button>
        </div>
      )}
      <Arbeitsflaechen k={k} flaeche={flaeche} />
      <details className="text-[0.85rem] text-muted">
        <summary className="cursor-pointer">Modellgrenzen</summary>
        <p className="m-0">
          Gemessen wird auf der Wandachse; Übergänge über Ecken, zur Decke und durch Durchführungen haben die Länge 0. Keine
          Wegfindung, keine Bemessung, keine Normaussage. Hilfslinien sind eine unverbindliche Planungshilfe. Außen- und
          gebäudeübergreifende Leitungen sind nicht vorgesehen.
        </p>
      </details>
    </section>
  );
}

function zugabe(mm: number, setzen: (v: number) => void): string | undefined {
  if (!Number.isInteger(mm) || mm < 0 || mm > 20000) return "Zugaben liegen zwischen 0 und 20 m.";
  setzen(mm);
  return undefined;
}

/** Wechsel der Arbeitsfläche im selben Entwurf - nichts wird gespeichert oder verworfen. */
function Arbeitsflaechen({ k, flaeche }: { k: Leitungskontext; flaeche: Arbeitsflaeche }) {
  const p = k.planung;
  const raum = p.vorbereitet?.raeume.get(flaeche.raumId);
  if (raum === undefined) return null;
  const wand = flaeche.art === "wand" ? raum.waende.findIndex((x) => x.id === flaeche.wandId) : -1;
  const n = raum.waende.length;
  const ziele: { label: string; ziel: Arbeitsflaeche }[] = [];
  if (flaeche.art === "wand" && wand >= 0) {
    const vor = raum.waende[(wand - 1 + n) % n];
    const nach = raum.waende[(wand + 1) % n];
    if (vor !== undefined) ziele.push({ label: `${k.wandName(vor.id)} (Ecke am Wandanfang)`, ziel: { art: "wand", raumId: raum.id, wandId: vor.id } });
    if (nach !== undefined && nach.id !== vor?.id) ziele.push({ label: `${k.wandName(nach.id)} (Ecke am Wandende)`, ziel: { art: "wand", raumId: raum.id, wandId: nach.id } });
    ziele.push({ label: "Decke dieses Raums", ziel: { art: "decke", raumId: raum.id } });
  } else {
    raum.waende.forEach((x) => ziele.push({ label: k.wandName(x.id), ziel: { art: "wand", raumId: raum.id, wandId: x.id } }));
  }
  return (
    <details className="text-small">
      <summary className="cursor-pointer">Arbeitsfläche wechseln (Entwurf bleibt erhalten)</summary>
      <div className="mt-1 flex flex-wrap gap-1">
        {ziele.map((z) => (
          <button key={z.label} type="button" className={knopf("neutral", { klein: true })} onClick={() => k.arbeitsflaecheWechseln(z.ziel)}>
            {z.label}
          </button>
        ))}
      </div>
    </details>
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
