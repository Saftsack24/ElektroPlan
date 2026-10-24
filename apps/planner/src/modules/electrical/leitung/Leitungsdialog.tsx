import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { useAuth } from "../../../core/auth/AuthProvider";
import { Dialog, DialogAktionen } from "../../../core/ui/Dialog";
import { Marke } from "../../../core/ui/Marke";
import type { MarkenArt } from "../../../core/ui/Marke";
import { useMasse } from "../../../core/ui/masseinheit";
import { useRueckfrage, verwerfenOptionen } from "../../../core/ui/Rueckfrage";
import { FELD_FEHLER, eingabefeld, knopf, meldungsflaeche } from "../../../core/ui/stil";
import { querschnittAlsEingabe } from "../stromkreise/daten";
import type { WirksameVorgaben } from "../vorgaben/daten";
import { HINWEIS_TEXT, herkunftText, prozentAlsEingabe, prozentAnzeigen, prozentLesen, vorlageText, vorlagenAbfrage, wirksamAbfrage, wirksamSchluessel } from "../vorgaben/daten";
import type { Leitungswerte, Wertequelle, Wertequellen } from "./entwurf";
import { befundOrt } from "./flaechen";
import { leitungsbefundText } from "./laenge";
import { LEITUNG_MELDUNG } from "./meldungen";
import { stromkreisAbleiten } from "./stromkreisableitung";
import type { Leitungsplanung } from "./useLeitungsplanung";

const STATUS: Record<string, { text: string; art: MarkenArt }> = {
  confirmed: { text: "Bestätigt", art: "erfolg" },
  incomplete: { text: "Unvollständig", art: "warnung" },
  conflict: { text: "Konflikt", art: "gefahr" },
};

type Gruppe = keyof Wertequellen;

/** Werte der Gruppen mit Quelle `vorgabe` aus den wirksamen Vorgaben - der Rest bleibt, wie er ist. */
export function mitVorgaben(w: Leitungswerte, v: WirksameVorgaben): Leitungswerte {
  const f = v.for_cable;
  if (f === null) return w;
  let neu = w;
  if (w.quellen.kabel === "vorgabe") {
    neu = {
      ...neu,
      kabeltyp: f.spec.cable_type ?? "",
      leiterzahl: f.spec.conductor_count === null ? "" : String(f.spec.conductor_count),
      querschnitt: querschnittAlsEingabe(f.spec.cross_section_mm2),
    };
  }
  if (w.quellen.reserve === "vorgabe") neu = { ...neu, reserveProzent: f.reserve.percent, reserveMm: 0 };
  if (w.quellen.zugaben === "vorgabe") neu = { ...neu, startzugabeMm: f.allowances.start_mm, endzugabeMm: f.allowances.end_mm };
  return neu;
}

function gleich(a: Leitungswerte, b: Leitungswerte): boolean {
  return (
    a.kabeltyp === b.kabeltyp &&
    a.leiterzahl === b.leiterzahl &&
    a.querschnitt === b.querschnitt &&
    a.reserveProzent === b.reserveProzent &&
    a.reserveMm === b.reserveMm &&
    a.startzugabeMm === b.startzugabeMm &&
    a.endzugabeMm === b.endzugabeMm
  );
}

/** Eingabe, die erst beim Verlassen oder mit Enter übernimmt - ein Rückgängig-Schritt je Eingabe. */
function Eingabe({
  id,
  label,
  wert,
  gesperrt,
  breite = "w-28",
  zusatz,
  onUebernehmen,
  onOffen,
}: {
  id: string;
  label: string;
  wert: string;
  gesperrt: boolean;
  breite?: string;
  zusatz?: ReactNode;
  /** Prüft und übernimmt den Text; liefert einen Fehlertext - dann bleibt die Eingabe offen. */
  onUebernehmen: (text: string) => string | undefined;
  /** Meldet, ob gerade eine ungültige oder unvollständige Eingabe im Feld steht. */
  onOffen?: (offen: boolean) => void;
}) {
  const [text, setText] = useState(wert);
  const [stand, setStand] = useState(wert);
  const [fehler, setFehler] = useState<string | undefined>(undefined);
  /** Fehler erst nach Verlassen oder Enter zeigen - beim Tippen ist „12,“ ein normaler Zwischenstand. */
  const [zeigen, setZeigen] = useState(false);
  const fokus = useRef(false);
  if (stand !== wert) {
    setStand(wert);
    // Eigene Übernahmen ändern den Text beim Tippen nicht; Änderungen von außen (Vorgabe übernehmen,
    // Rückgängig) gelten, sobald das Feld nicht bearbeitet wird.
    if (!fokus.current) {
      setText(wert);
      setFehler(undefined);
      setZeigen(false);
    }
  }
  const meldenRef = useRef(onOffen);
  meldenRef.current = onOffen;
  useEffect(() => {
    meldenRef.current?.(fehler !== undefined);
  }, [fehler]);
  useEffect(() => () => meldenRef.current?.(false), []);
  // Jeder gültige Stand geht sofort in den Entwurf (6c L3, §21.5): Das Ergebnis ist aktuell, und
  // „Leitung speichern“ speichert genau, was im Feld steht - ohne vorher ein anderes Feld anzuklicken.
  const pruefen = (t: string) => setFehler(t === wert ? undefined : onUebernehmen(t));
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-1.5">
        <label className="text-label text-muted" htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          className={`${eingabefeld({ kompakt: true, fehler: zeigen && fehler !== undefined })} ${breite}`}
          value={text}
          disabled={gesperrt}
          aria-invalid={fehler !== undefined ? true : undefined}
          onFocus={() => {
            fokus.current = true;
          }}
          onChange={(event) => {
            setText(event.target.value);
            pruefen(event.target.value);
          }}
          onBlur={() => {
            fokus.current = false;
            setZeigen(true);
            // Gültig: in der üblichen Schreibweise anzeigen (etwa „12.5“ → „12,5“).
            if (fehler === undefined) setText(wert);
          }}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") {
              event.preventDefault();
              setZeigen(true);
            }
          }}
        />
        {zusatz}
      </span>
      {zeigen && fehler !== undefined && (
        <span className={FELD_FEHLER} role="alert">
          {fehler}
        </span>
      )}
    </span>
  );
}

function Herkunft({ text, abweichend }: { text: string; abweichend: boolean }) {
  return (
    <Marke art={abweichend ? "warnung" : "info"}>
      <span data-testid="herkunft">{text}</span>
    </Marke>
  );
}

/**
 * Abschlussdialog einer Leitung (Phase 6c, L3, Entwurf §18.5).
 *
 * Öffnet nach dem Zeichnen (Klick aufs Zielgerät, Doppelklick, Enter, „Abschließen …“) und für
 * „Angaben …“ einer bestehenden Leitung. Die Werte stehen im Entwurf - Schließen, Escape und ein
 * Klick daneben verlieren nichts (bei einer neuen Leitung = Weiterzeichnen). Vorbelegt wird nach der
 * bestätigten Kette über `…/planning-defaults/effective`; der Server prüft beim Speichern selbst.
 * Länge und Reserve rechnet dieselbe Funktion wie Vorschau und Server (`laenge.ts`).
 */
export function Leitungsdialog({ planung: p }: { planung: Leitungsplanung }) {
  const { api } = useAuth();
  const masse = useMasse();
  const fragen = useRueckfrage();
  const queryClient = useQueryClient();
  // Der zweite Klick eines Doppelklicks aufs Zielgerät träfe den Hintergrund des eben geöffneten
  // Dialogs - er darf ihn nicht gleich wieder schließen.
  const geoeffnet = useRef(Date.now());
  const e = p.entwurf;
  const w = e?.werte;
  const neu = e?.cableId === null;
  const gespeichert = e?.cableId == null ? undefined : p.leitungen.find((l) => l.id === e.cableId);
  const darf = p.darfLeitungen && e?.status !== "speichert";

  // ------------------------------------------------------------ Stromkreis (§7.3)

  const ableitung = useMemo(
    () => (w === undefined || !neu ? null : stromkreisAbleiten(w.startId, w.endId, p.kreise, p.verteilungen, (k) => p.kreisName(k))),
    [w, neu, p],
  );
  const kreisId = w === undefined ? "" : neu && ableitung?.art === "eindeutig" ? ableitung.kreisId : w.circuitId;
  const kreisGueltig =
    !neu || ableitung === null ? true : ableitung.art === "eindeutig" ? true : ableitung.art === "wahl" ? ableitung.kreise.some((k) => k.id === w?.circuitId) : false;
  const kreis = kreisGueltig ? p.kreisVon(kreisId) : undefined;
  const zuordnenNoetig = neu && ableitung !== null && ableitung.art !== "konflikt" ? ableitung.zuordnen : [];

  const [offeneFelder, setOffeneFelder] = useState<Readonly<Record<string, string>>>({});

  // Ein eindeutig abgeleiteter Stromkreis steht im Entwurf - ohne eigenen Rückgängig-Schritt.
  useEffect(() => {
    if (e === null || w === undefined || !neu || ableitung === null) return;
    const ziel = ableitung.art === "eindeutig" ? ableitung.kreisId : ableitung.art === "wahl" && ableitung.kreise.some((k) => k.id === w.circuitId) ? w.circuitId : "";
    const bestaetigt = w.zuordnen.filter((id) => zuordnenNoetig.includes(id));
    if (ziel !== w.circuitId || bestaetigt.length !== w.zuordnen.length) {
      p.dispatch({ typ: "vorgaben-anwenden", werte: { ...w, circuitId: ziel, zuordnen: bestaetigt }, basis: e.vorgabenBasis });
    }
  }, [e, w, neu, ableitung, zuordnenNoetig, p]);

  // ------------------------------------------------------------ Vorgaben (§8.4, §8.6)

  const vorlagen = useQuery(vorlagenAbfrage(api));
  const bezug = kreis === undefined || w === undefined ? null : { circuitId: kreis.id, startId: w.startId, endId: w.endId };
  const wirksam = useQuery({ ...wirksamAbfrage(api, p.projektId, bezug), enabled: bezug !== null && p.projektId !== "" });
  const fuer = wirksam.data?.for_cable ?? null;
  const ausVorgaben = w !== undefined && Object.values(w.quellen).includes("vorgabe");

  useEffect(() => {
    if (e === null || w === undefined || wirksam.data === undefined || fuer === null || e.vorgabenGeaendert) return;
    const mit = mitVorgaben(w, wirksam.data);
    if (!gleich(mit, w) || JSON.stringify(e.vorgabenBasis) !== JSON.stringify(fuer.basis)) {
      p.dispatch({ typ: "vorgaben-anwenden", werte: mit, basis: fuer.basis });
    }
  }, [e, w, wirksam.data, fuer, p]);

  // Nach „Vorgaben geändert“ frisch lesen - angewendet wird erst auf ausdrücklichen Wunsch.
  const geaendert = e?.vorgabenGeaendert === true;
  useEffect(() => {
    if (geaendert) void queryClient.invalidateQueries({ queryKey: wirksamSchluessel(p.projektId) });
  }, [geaendert, queryClient, p.projektId]);

  if (e === null || w === undefined) return null;

  const aendern = (werte: Leitungswerte, feld?: string) => p.dispatch({ typ: "aendern", werte, ...(feld === undefined ? {} : { feld }) });
  const abweichend = (gruppe: Gruppe, werte: Leitungswerte, feld?: string) => {
    // Wer beim Tippen wieder genau beim Vorgabewert ankommt, weicht nicht ab - die Herkunft bleibt. Maßgeblich
    // ist der Stand vor Beginn der Eingabe in diesem Feld (ein Rückgängig-Schritt je Feld).
    const vorEingabe = feld !== undefined && e.eingabeFeld === feld ? (e.zurueck[e.zurueck.length - 1] ?? w) : w;
    if (vorEingabe.quellen[gruppe] === "vorgabe" && wirksam.data !== undefined) {
      const mitVorgabe = mitVorgaben({ ...werte, quellen: { ...werte.quellen, [gruppe]: "vorgabe" } }, wirksam.data);
      // „20“ getippt ist dieselbe Vorgabe wie „20.00“ vom Server.
      const prozent = (x: Leitungswerte): Leitungswerte => ({ ...x, reserveProzent: x.reserveProzent === null ? null : String(Number(x.reserveProzent)) });
      if (gleich(prozent(mitVorgabe), prozent({ ...werte, quellen: mitVorgabe.quellen }))) {
        aendern(mitVorgabe, feld);
        return;
      }
    }
    aendern({ ...werte, quellen: { ...werte.quellen, [gruppe]: "manuell" as Wertequelle } }, feld);
  };
  /** Eingaben, die gerade ungültig oder unvollständig sind (Feld-ID → Beschriftung). */
  const offeneEingabe = (id: string, beschriftung: string) => (o: boolean) =>
    setOffeneFelder((vorher) => {
      if ((id in vorher) === o) return vorher;
      const neu = { ...vorher };
      if (o) neu[id] = beschriftung;
      else delete neu[id];
      return neu;
    });
  const offeneNamen = Object.values(offeneFelder);
  const zurVorgabe = (gruppe: Gruppe) => aendern({ ...w, quellen: { ...w.quellen, [gruppe]: "vorgabe" as Wertequelle } });

  const herkunft = (gruppe: Gruppe): { text: string; abweichend: boolean } => {
    const q = w.quellen[gruppe];
    if (q === "manuell") return { text: "abweichend", abweichend: true };
    if (q === "bestand") {
      const o = gruppe === "kabel" ? gespeichert?.spec_origin : gruppe === "reserve" ? gespeichert?.reserve_origin : gespeichert?.allowance_origin;
      return { text: o === undefined ? "gespeichert" : herkunftText(o), abweichend: o === "manual" };
    }
    if (fuer === null) return { text: kreis === undefined ? "Vorgabe nach Wahl des Stromkreises" : "Vorgaben werden geladen …", abweichend: false };
    if (gruppe === "kabel") return { text: herkunftText(fuer.spec.origin, fuer.spec.level), abweichend: false };
    if (gruppe === "reserve") return { text: herkunftText(fuer.reserve.origin), abweichend: false };
    return { text: herkunftText(fuer.allowances.origin), abweichend: false };
  };
  const vorgabeKnopf = (gruppe: Gruppe) =>
    w.quellen[gruppe] !== "vorgabe" && darf ? (
      <button type="button" className={knopf("einfach", { klein: true })} onClick={() => zurVorgabe(gruppe)} data-testid={`vorgabe-${gruppe}`}>
        ⟲ Vorgabe übernehmen
      </button>
    ) : null;

  const mm = (text: string): { ok: true; mm: number } | { ok: false; fehler: string } => {
    const m = masse.lesen(text);
    if (!m.ok) return m;
    if (!Number.isInteger(m.mm) || m.mm < 0 || m.mm > 20_000) return { ok: false, fehler: "Zwischen 0 und 20 m." };
    return m;
  };

  // ------------------------------------------------------------ Ergebnis (gemeinsame Funktion)

  const r = p.ergebnis;
  const offen = w.endId === null;
  const status = r === null ? null : (STATUS[r.status] ?? { text: r.status, art: "neutral" as const });

  // ------------------------------------------------------------ Aktionen

  const verwerfen = async () => {
    const antwort = await fragen(verwerfenOptionen(neu ? "Leitung verwerfen?" : "Änderungen verwerfen?", neu ? "Sie wollen die neue Leitung verwerfen." : "Sie wollen die Änderungen an der Leitung verwerfen.", LEITUNG_MELDUNG));
    if (antwort !== "bestaetigt") return;
    p.schliessen();
  };
  const zurueck = () => {
    if (p.ablauf !== null) p.weiterzeichnen();
    else p.dialogSchliessen();
  };
  /** Klick daneben oder ×: wie Weiterzeichnen - nur nicht als zweiter Klick eines Doppelklicks. */
  const schliessen = () => {
    if (Date.now() - geoeffnet.current >= 600) zurueck();
  };
  const sperrgrund =
    !p.darfLeitungen
      ? "Ohne das Recht „Leitungen bearbeiten“ nur ansehen."
      : offeneNamen.length > 0
        ? `Bitte die Eingabe in „${offeneNamen.join("“, „")}“ vervollständigen oder korrigieren – das Ergebnis ist sonst nicht aktuell.`
      : neu && ableitung?.art === "konflikt"
        ? ableitung.text
        : kreis === undefined
          ? "Bitte einen Stromkreis wählen."
          : zuordnenNoetig.some((id) => !w.zuordnen.includes(id))
            ? "Bitte die Zuordnung zum Stromkreis bestätigen."
            : ausVorgaben && fuer === null
              ? "Die Planungsvorgaben werden geladen."
              : null;

  const startName = p.geraetName(w.startId);
  const zielName = w.endId === null ? null : p.geraetName(w.endId);
  const titel = neu ? "Leitung abschließen" : `Leitung ${w.label === "" ? "ohne Bezeichnung" : w.label} – Angaben`;

  return (
    <Dialog
      offen
      titel={titel}
      onClose={schliessen}
      onEscape={() => {
        zurueck();
        return true;
      }}
    >
      <div className="flex flex-col gap-3 text-small" data-testid="leitungsdialog">
        <section aria-label="Verlauf">
          <p className="m-0">
            <strong>Verlauf</strong> {startName} → {zielName ?? "offen"} · {w.wegpunkte.length} {w.wegpunkte.length === 1 ? "Punkt" : "Punkte"}
          </p>
          {offen && (
            <p className={`${meldungsflaeche("schlicht")} m-0 mt-1`} role="status" data-testid="leitung-offen">
              Offen – kein Zielgerät. Gespeichert wird eine unvollständige Leitung ohne Gesamtlänge; das Zielgerät lässt sich später ergänzen.
            </p>
          )}
        </section>

        <section aria-label="Stromkreis" className="flex flex-col gap-1">
          <strong>Stromkreis</strong>
          {!neu ? (
            <span>{kreis === undefined ? "unbekannt" : p.kreisName(kreis)}</span>
          ) : ableitung?.art === "konflikt" ? (
            <p className={`${meldungsflaeche()} m-0`} role="alert" data-testid="stromkreis-konflikt">
              {ableitung.text} Speichern ist so nicht möglich – mit „Weiterzeichnen“ ein anderes Ziel wählen oder die Zuordnung in der Ansicht „Stromkreise“ ändern.
            </p>
          ) : ableitung?.art === "wahl" ? (
            <label className="flex flex-col gap-1">
              <span className="text-label text-muted">{ableitung.grund}</span>
              <select
                className={eingabefeld({ kompakt: true })}
                value={kreisGueltig ? w.circuitId : ""}
                disabled={!darf}
                data-testid="stromkreis-wahl"
                onChange={(event) => p.dispatch({ typ: "vorgaben-anwenden", werte: { ...w, circuitId: event.target.value, zuordnen: [] }, basis: e.vorgabenBasis })}
              >
                <option value="">– bitte wählen –</option>
                {ableitung.kreise.map((k) => (
                  <option key={k.id} value={k.id}>
                    {p.kreisName(k)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span data-testid="stromkreis">
              {kreis === undefined ? "–" : p.kreisName(kreis)} <span className="text-muted">({ableitung?.grund})</span>
            </span>
          )}
          {zuordnenNoetig.map((id) => (
            <label key={id} className="flex items-center gap-2" data-testid={`zuordnen-${id}`}>
              <input
                type="checkbox"
                checked={w.zuordnen.includes(id)}
                disabled={!darf || !p.darfStromkreise || kreis === undefined}
                onChange={(event) =>
                  p.dispatch({
                    typ: "aendern",
                    werte: { ...w, zuordnen: event.target.checked ? [...w.zuordnen, id] : w.zuordnen.filter((x) => x !== id) },
                  })
                }
              />
              <span>
                {p.geraetName(id)} ist noch keinem Stromkreis zugeordnet – beim Speichern {kreis === undefined ? "dem gewählten Stromkreis" : p.kreisName(kreis)} zuordnen
              </span>
            </label>
          ))}
          {zuordnenNoetig.length > 0 && !p.darfStromkreise && (
            <p className="m-0 text-muted">Für die Zuordnung fehlt das Recht „Stromkreise bearbeiten“ – bitte zuerst in der Ansicht „Stromkreise“ zuordnen lassen.</p>
          )}
        </section>

        <section>
          <Eingabe id="leitung-bezeichnung" label="Bezeichnung" wert={w.label} gesperrt={!darf} breite="w-40" onUebernehmen={(t) => (aendern({ ...w, label: t.trim() }, "bezeichnung"), undefined)} />
        </section>

        <section aria-label="Kabel" className="flex flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <strong>Kabel</strong>
            <Herkunft {...herkunft("kabel")} />
            {vorgabeKnopf("kabel")}
          </span>
          <label className="flex flex-wrap items-center gap-1.5">
            <span className="text-label text-muted">Vorlage</span>
            <select
              className={eingabefeld({ kompakt: true })}
              value=""
              disabled={!darf}
              aria-label="Kabelvorlage übernehmen"
              onChange={(event) => {
                const v = vorlagen.data?.templates.find((x) => x.id === event.target.value);
                if (v === undefined) return;
                abweichend("kabel", { ...w, kabeltyp: v.cable_type, leiterzahl: String(v.conductor_count), querschnitt: querschnittAlsEingabe(v.cross_section_mm2) });
              }}
            >
              <option value="">Andere Vorlage übernehmen …</option>
              {(vorlagen.data?.templates ?? []).filter((v) => v.is_active).map((v) => (
                <option key={v.id} value={v.id}>
                  {vorlageText(v)}
                </option>
              ))}
            </select>
          </label>
          <span className="flex flex-wrap gap-3">
            <Eingabe id="leitung-kabeltyp" label="Typ" wert={w.kabeltyp} gesperrt={!darf} onUebernehmen={(t) => (abweichend("kabel", { ...w, kabeltyp: t.trim() }, "kabeltyp"), undefined)} />
            <Eingabe id="leitung-leiter" label="Leiter" wert={w.leiterzahl} gesperrt={!darf} breite="w-16" onUebernehmen={(t) => (abweichend("kabel", { ...w, leiterzahl: t.trim() }, "leiterzahl"), undefined)} />
            <Eingabe
              id="leitung-querschnitt"
              label="Querschnitt"
              wert={w.querschnitt}
              gesperrt={!darf}
              breite="w-20"
              zusatz={<span className="text-muted">mm²</span>}
              onUebernehmen={(t) => (abweichend("kabel", { ...w, querschnitt: t.trim() }, "querschnitt"), undefined)}
            />
          </span>
          {(w.kabeltyp === "" || w.leiterzahl === "" || w.querschnitt === "") && (
            <p className="m-0 text-muted" data-testid="kabel-fehlt">
              Kabelangaben unvollständig – die Leitung wird als „unvollständig angegeben“ gespeichert.
            </p>
          )}
          {(fuer?.hints ?? []).map((h, i) => (
            <p key={`${h.code}-${i}`} className="m-0 text-muted" data-testid="vorgaben-hinweis">
              {HINWEIS_TEXT[h.code] ?? h.code}
            </p>
          ))}
        </section>

        <section aria-label="Reserve" className="flex flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <strong>Reserve</strong>
            <Herkunft {...herkunft("reserve")} />
            {vorgabeKnopf("reserve")}
          </span>
          {w.reserveProzent !== null ? (
            <span className="flex flex-wrap items-center gap-2">
              <Eingabe
                id="leitung-reserve-prozent"
                label="Prozentsatz"
                wert={prozentAlsEingabe(w.reserveProzent)}
                gesperrt={!darf}
                breite="w-20"
                zusatz={<span className="text-muted">% der geometrischen Länge</span>}
                onOffen={offeneEingabe("leitung-reserve-prozent", "Prozentsatz")}
                onUebernehmen={(t) => {
                  const pr = prozentLesen(t);
                  if (!pr.ok) return pr.fehler;
                  // Leer ist keine Null: 0 % nur ausdrücklich.
                  if (pr.wert === null) return "Bitte einen Prozentsatz angeben – 0 ist ein gültiger Wert.";
                  abweichend("reserve", { ...w, reserveProzent: pr.wert, reserveMm: 0 }, "reserve");
                  return undefined;
                }}
              />
              {darf && (
                <button type="button" className={knopf("einfach", { klein: true })} onClick={() => abweichend("reserve", { ...w, reserveProzent: null, reserveMm: 0 })}>
                  Feste Reserve eingeben
                </button>
              )}
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-2" data-testid="reserve-fest">
              <Eingabe
                id="leitung-reserve-fest"
                label="Feste Reserve"
                wert={masse.alsEingabe(w.reserveMm)}
                gesperrt={!darf}
                zusatz={<span className="text-muted">{masse.einheit}</span>}
                onOffen={offeneEingabe("leitung-reserve-fest", "Feste Reserve")}
                onUebernehmen={(t) => {
                  const m = mm(t);
                  if (!m.ok) return m.fehler;
                  abweichend("reserve", { ...w, reserveMm: m.mm }, "reserve-fest");
                  return undefined;
                }}
              />
              {darf && (
                <button type="button" className={knopf("einfach", { klein: true })} onClick={() => abweichend("reserve", { ...w, reserveProzent: "0", reserveMm: 0 })}>
                  Auf Prozent umstellen
                </button>
              )}
            </span>
          )}
        </section>

        <section aria-label="Anschlusszugaben" className="flex flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <strong>Anschlusszugaben</strong>
            <Herkunft {...herkunft("zugaben")} />
            {vorgabeKnopf("zugaben")}
          </span>
          <span className="flex flex-wrap gap-3">
            <Eingabe
              id="leitung-zugabe-start"
              label="Start"
              wert={masse.alsEingabe(w.startzugabeMm)}
              gesperrt={!darf}
              zusatz={<span className="text-muted">{masse.einheit}</span>}
              onOffen={offeneEingabe("leitung-zugabe-start", "Anschlusszugabe Start")}
              onUebernehmen={(t) => {
                const m = mm(t);
                if (!m.ok) return m.fehler;
                abweichend("zugaben", { ...w, startzugabeMm: m.mm }, "zugabe-start");
                return undefined;
              }}
            />
            <Eingabe
              id="leitung-zugabe-ende"
              label="Ende"
              wert={masse.alsEingabe(w.endzugabeMm)}
              gesperrt={!darf}
              zusatz={<span className="text-muted">{masse.einheit}</span>}
              onOffen={offeneEingabe("leitung-zugabe-ende", "Anschlusszugabe Ende")}
              onUebernehmen={(t) => {
                const m = mm(t);
                if (!m.ok) return m.fehler;
                abweichend("zugaben", { ...w, endzugabeMm: m.mm }, "zugabe-ende");
                return undefined;
              }}
            />
          </span>
        </section>

        <section aria-label="Ergebnis" className="flex flex-col gap-1 border-t border-line pt-2" data-testid="leitungsergebnis" data-veraltet={offeneNamen.length > 0 ? "" : undefined}>
          {offeneNamen.length > 0 && (
            <p className="m-0" role="status" data-testid="ergebnis-veraltet">
              <Marke art="warnung">Ergebnis nicht aktuell</Marke> Die Eingabe in „{offeneNamen.join("“, „")}“ ist unvollständig oder ungültig – gerechnet ist noch mit dem
              vorigen Wert.
            </p>
          )}
          {r === null || status === null ? (
            <p className="m-0 text-muted">Wird berechnet …</p>
          ) : (
            <div className={offeneNamen.length > 0 ? "flex flex-col gap-1 opacity-55" : "flex flex-col gap-1"}>
              <p className="m-0 flex flex-wrap items-center gap-1.5">
                {offeneNamen.length === 0 && <Marke art={status.art}>{status.text}</Marke>}
                {r.laengeMm !== null ? (
                  <strong data-testid="gesamtbedarf">Gesamtbedarf {masse.anzeigen(r.laengeMm)}</strong>
                ) : (
                  <strong>Teilsumme {masse.anzeigen(r.bekanntMm)} – keine Gesamtlänge</strong>
                )}
              </p>
              <p className="m-0 text-muted" data-testid="bedarf-teile">
                Weg {masse.anzeigen(r.geometrischMm)} · Reserve{" "}
                {r.reserveMm === null
                  ? `${w.reserveProzent === null ? "" : prozentAnzeigen(w.reserveProzent)} erst mit vollständigem Weg`
                  : `${masse.anzeigen(r.reserveMm)}${w.reserveProzent === null ? " (fest)" : ` (${prozentAnzeigen(w.reserveProzent)})`}`}{" "}
                · Zugaben {masse.anzeigen(r.anschlusszugabenMm)}
              </p>
              {r.befunde.length > 0 && (
                <ul className="my-1 pl-[18px]" aria-label="Befunde der Leitung">
                  {r.befunde.map((b, i) => (
                    <li key={`${b.code}-${b.ort}-${i}`}>
                      {befundOrt(b.ort)}: {leitungsbefundText(b.code)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="m-0 text-label text-muted">Vorgaben sind Planungsangaben – ElektroPlan bemisst nichts und prüft keine Norm.</p>
        </section>

        {e.fehler !== null && (
          <div className={meldungsflaeche()} role="alert" data-testid="leitung-fehler">
            <p className="m-0">{e.fehler.meldung}</p>
            {/* Geänderte Vorgaben: Der Vergleich darunter nennt die Unterschiede in Anzeigeeinheiten. */}
            {e.fehler.eintraege.length > 0 && !geaendert && (
              <ul className="my-1 pl-[18px]">
                {e.fehler.eintraege.map((x, i) => (
                  <li key={`${x.code}-${i}`}>{x.meldung}</li>
                ))}
              </ul>
            )}
            {geaendert && wirksam.data !== undefined && <Vorgabenvergleich w={w} neu={mitVorgaben(w, wirksam.data)} />}
            <div className="mt-2 flex flex-wrap gap-2">
              {geaendert && (
                <>
                  <button type="button" className={knopf("neutral", { klein: true })} onClick={() => p.dispatch({ typ: "hinweis-schliessen" })}>
                    Neue Vorgaben übernehmen
                  </button>
                  <button
                    type="button"
                    className={knopf("neutral", { klein: true })}
                    onClick={() => {
                      const quellen = { ...w.quellen };
                      for (const g of ["kabel", "reserve", "zugaben"] as const) if (quellen[g] === "vorgabe") quellen[g] = "manuell";
                      aendern({ ...w, quellen });
                      p.dispatch({ typ: "hinweis-schliessen" });
                    }}
                  >
                    Bisherige Werte als Abweichung behalten
                  </button>
                </>
              )}
              {e.status === "konflikt" && !geaendert && (
                <button type="button" className={knopf("neutral", { klein: true })} onClick={() => void p.verwerfenUndNeuLaden()}>
                  Serverstand laden (Änderungen verwerfen)
                </button>
              )}
              {!geaendert && (
                <button type="button" className={knopf("neutral", { klein: true })} onClick={() => p.dispatch({ typ: "hinweis-schliessen" })}>
                  {e.status === "konflikt" ? "Entwurf vorerst behalten" : "Hinweis schließen"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <DialogAktionen>
        {p.darfLeitungen && (
          <button
            type="button"
            className={knopf("primaer")}
            data-autofocus={sperrgrund === null ? "" : undefined}
            disabled={sperrgrund !== null || e.status === "speichert" || geaendert}
            title={sperrgrund ?? undefined}
            onClick={() => void p.speichern()}
          >
            {e.status === "speichert" ? "Wird gespeichert …" : "Leitung speichern"}
          </button>
        )}
        {p.ablauf !== null ? (
          <button type="button" className={knopf()} onClick={() => p.weiterzeichnen()}>
            Weiterzeichnen
          </button>
        ) : (
          gespeichert !== undefined &&
          p.darfLeitungen && (
            <button type="button" className={knopf()} onClick={() => p.verlaufBearbeiten(gespeichert)}>
              Verlauf bearbeiten
            </button>
          )
        )}
        {p.darfLeitungen && (neu || p.ungespeichert) && (
          <button type="button" className={`${knopf()} ml-auto`} onClick={() => void verwerfen()}>
            {neu ? "Entwurf verwerfen …" : "Änderungen verwerfen …"}
          </button>
        )}
        {sperrgrund !== null && p.darfLeitungen && (
          <p className="m-0 basis-full text-muted" data-testid="speichern-sperrgrund">
            {sperrgrund}
          </p>
        )}
      </DialogAktionen>
    </Dialog>
  );
}

/** „Reserve: bisher 20 %, jetzt 25 %“ - was sich an den Vorgaben geändert hat. */
function Vorgabenvergleich({ w, neu }: { w: Leitungswerte; neu: Leitungswerte }) {
  const masse = useMasse();
  const zeilen: string[] = [];
  const kabel = (x: Leitungswerte) => `${x.kabeltyp || "–"} ${x.leiterzahl || "–"} × ${x.querschnitt || "–"} mm²`;
  if (kabel(w) !== kabel(neu)) zeilen.push(`Kabel: bisher ${kabel(w)}, jetzt ${kabel(neu)}`);
  if (w.reserveProzent !== neu.reserveProzent) zeilen.push(`Reserve: bisher ${prozentAnzeigen(w.reserveProzent)}, jetzt ${prozentAnzeigen(neu.reserveProzent)}`);
  if (w.startzugabeMm !== neu.startzugabeMm || w.endzugabeMm !== neu.endzugabeMm) {
    zeilen.push(`Zugaben: bisher ${masse.anzeigen(w.startzugabeMm)} / ${masse.anzeigen(w.endzugabeMm)}, jetzt ${masse.anzeigen(neu.startzugabeMm)} / ${masse.anzeigen(neu.endzugabeMm)}`);
  }
  if (zeilen.length === 0) return null;
  return (
    <ul className="my-1 pl-[18px]" data-testid="vorgaben-vergleich">
      {zeilen.map((z) => (
        <li key={z}>{z}</li>
      ))}
    </ul>
  );
}
