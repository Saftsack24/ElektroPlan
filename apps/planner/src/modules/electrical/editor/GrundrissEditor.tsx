import { ApiError } from "@elektroplan/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { alsFormularfehler } from "../../../core/api/fehler";
import { useAuth } from "../../../core/auth/AuthProvider";
import { useUngespeicherteAenderungen } from "../../../core/ui/ungespeichert";
import { RaumDialog } from "../RaumDialog";
import type { Raumwerte } from "../RaumDialog";
import { Eigenschaften, flaecheText } from "./Eigenschaften";
import type { EntwurfWand, Geschossplan, Oeffnungsart, RaumImPlan, Raumentwurf } from "./entwurf";
import { alsKonturanfrage, basisAus, neueId, segmenteAus, STANDARD_WANDSTAERKE_MM } from "./entwurf";
import { STANDARD_RASTER_MM } from "./fang";
import { konturbericht, oeffnungsBefunde, streckenlaenge } from "./geometrie";
import type { Punkt } from "./geometrie";
import { fehlerAuswerten } from "./speichern";
import type { Groesse, Viewport } from "./viewport";
import { START_VIEWPORT, einpassen, grenzenVon, zoomen } from "./viewport";
import { Werkzeugleiste } from "./Werkzeugleiste";
import {
  letztenPunktEntfernen,
  oeffnungEntfernen,
  oeffnungSetzen,
  polygonWaende,
  rechteckWaende,
  wandEntfernen,
} from "./werkzeuge";
import { Zeichenflaeche } from "./Zeichenflaeche";
import type { Raumdarstellung } from "./Zeichenflaeche";
import { ANFANG, editorReducer, fehlerhafteKeys, ungespeichert } from "./zustand";
import type { Auswahl, Speicherstatus, Werkzeug } from "./zustand";

export function planSchluessel(floorId: string) {
  return ["electrical", "plan", floorId] as const;
}

const STATUS_TEXT: Record<Speicherstatus, string> = {
  sauber: "Keine ungespeicherten Änderungen",
  geaendert: "Ungespeicherte Änderungen",
  speichert: "Wird gespeichert …",
  gespeichert: "Gespeichert",
  konflikt: "Konflikt - nicht gespeichert",
  validierung: "Nicht gespeichert - bitte prüfen",
  fehler: "Nicht gespeichert",
};

const VERWERFEN_FRAGE =
  "Der aktive Raum hat ungespeicherte Änderungen. Wenn Sie fortfahren, gehen sie verloren. Trotzdem fortfahren?";

/** Darstellung eines nicht aktiven Raums - je Serverobjekt einmal berechnet. */
const darstellungen = new WeakMap<RaumImPlan, Raumdarstellung>();
function ruhend(raum: RaumImPlan): Raumdarstellung {
  let d = darstellungen.get(raum);
  if (d === undefined) {
    d = {
      id: raum.id,
      name: raum.name,
      nummer: raum.room_number,
      walls: basisAus(raum).entwurf.walls,
      aktiv: false,
      flaecheText: flaecheText(raum.area_mm2),
    };
    darstellungen.set(raum, d);
  }
  return d;
}

/**
 * Grafischer Grundrisseditor eines Geschosses (Phase 4a).
 *
 * Lädt den Planungsstand in **einer** Anfrage, hält genau einen Raum als
 * lokalen Entwurf und speichert ihn **bewusst** und atomar über
 * `PUT /rooms/{id}/contour`. Kein Autosave; jede Bewegung bleibt lokal, bis
 * gespeichert wird. Die Serverantwort wird danach die neue Basis.
 */
export function GrundrissEditor({
  floorId,
  geschossLabel,
  standardhoehe_mm,
  darfSchreiben,
  onUngespeichert,
  onGespeichert,
}: {
  floorId: string;
  geschossLabel: string;
  standardhoehe_mm: number;
  darfSchreiben: boolean;
  onUngespeichert: (offen: boolean) => void;
  /** Nach jedem erfolgreichen Schreibvorgang - damit die Tabellenansicht nachzieht. */
  onGespeichert: (roomId: string | null) => Promise<void>;
}) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const [zustand, dispatch] = useReducer(editorReducer, ANFANG);
  const [viewport, setViewport] = useState<Viewport>(START_VIEWPORT);
  const groesse = useRef<Groesse>({ breite: 900, hoehe: 560 });
  const [rasterMm, setRasterMm] = useState<number>(STANDARD_RASTER_MM);
  const [fangAktiv, setFangAktiv] = useState(true);
  const [oeffnungsart, setOeffnungsart] = useState<Oeffnungsart>("door");
  const [neuerRaum, setNeuerRaum] = useState<readonly EntwurfWand[] | null>(null);
  const [raumdaten, setRaumdaten] = useState(false);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const eingepasst = useRef(false);
  const nachLadenAktivieren = useRef<string | null>(null);

  const plan = useQuery({
    queryKey: planSchluessel(floorId),
    queryFn: () =>
      api.get("/api/v1/modules/electrical/floors/{floor_id}/plan", { path: { floor_id: floorId } }),
  });
  const raeume: readonly RaumImPlan[] = useMemo(
    () => (Array.isArray(plan.data?.rooms) ? plan.data.rooms : []),
    [plan.data],
  );

  const offen = ungespeichert(zustand);
  const schreibbar = darfSchreiben;
  useUngespeicherteAenderungen(offen);
  useEffect(() => onUngespeichert(offen), [offen, onUngespeichert]);

  // Neu geladener Serverstand: ersetzt nur einen unveränderten Entwurf.
  useEffect(() => {
    const aktiv = zustand.basis?.raum.id;
    if (aktiv !== undefined) {
      const raum = raeume.find((r) => r.id === aktiv);
      if (raum !== undefined) dispatch({ typ: "serverstand", raum });
      else if (!offen) dispatch({ typ: "raum-verlassen" });
    }
    const neu = nachLadenAktivieren.current;
    if (neu !== null) {
      const raum = raeume.find((r) => r.id === neu);
      if (raum !== undefined) {
        nachLadenAktivieren.current = null;
        dispatch({ typ: "raum-aktivieren", raum });
      }
    }
    // Bewusst nur auf neue Serverdaten reagieren - nicht auf jede
    // Entwurfsänderung; der Reducer entscheidet selbst, ob er übernimmt.
  }, [raeume]);

  // Beim ersten Laden des Geschosses die Ansicht einpassen.
  useEffect(() => {
    if (eingepasst.current || !plan.isSuccess) return;
    eingepasst.current = true;
    setViewport(einpassen(grenzenVon(raeume.flatMap((r) => r.walls.flatMap((w) => [{ x: w.x1_mm, y: w.y1_mm }, { x: w.x2_mm, y: w.y2_mm }]))), groesse.current));
  }, [plan.isSuccess, raeume]);

  // ----------------------------------------------------------- Darstellung

  const darstellung: readonly Raumdarstellung[] = useMemo(() => {
    const entwurf = zustand.entwurf;
    return raeume.map((raum) => {
      if (entwurf === null || raum.id !== entwurf.roomId) return ruhend(raum);
      return {
        id: raum.id,
        name: zustand.basis?.raum.name ?? raum.name,
        nummer: zustand.basis?.raum.room_number ?? raum.room_number,
        walls: entwurf.walls,
        aktiv: true,
        flaecheText: flaecheText(konturbericht(segmenteAus(entwurf.walls)).flaecheMm2),
      };
    });
  }, [raeume, zustand.entwurf, zustand.basis]);

  const lokaleKeys = useMemo(() => {
    const entwurf = zustand.entwurf;
    const keys = new Set<string>();
    if (entwurf === null) return keys;
    for (const befund of konturbericht(segmenteAus(entwurf.walls)).befunde) {
      // Eine offene Kontur ist ein zulässiger Entwurf - nur echte Fehler markieren.
      if (befund.code.startsWith("contour-")) continue;
      befund.keys.forEach((k) => keys.add(k));
    }
    for (const w of entwurf.walls) {
      const laenge = streckenlaenge({ x: w.x1_mm, y: w.y1_mm }, { x: w.x2_mm, y: w.y2_mm });
      const spannen = w.openings.map((o) => ({ key: o.id, abstand: o.offset_mm, breite: o.width_mm }));
      spannen.forEach((s, i) => oeffnungsBefunde(s, laenge, spannen.slice(i + 1)).forEach((b) => b.keys.forEach((k) => keys.add(k))));
    }
    return keys;
  }, [zustand.entwurf]);

  const fehlerKeys = useMemo(() => fehlerhafteKeys(zustand), [zustand]);

  // -------------------------------------------------------------- Aktionen

  const aendern = useCallback((entwurf: Raumentwurf) => dispatch({ typ: "aendern", entwurf }), []);

  /**
   * Vor dem Wechsel zu einem anderen Raum: Ungespeicherte Änderungen werden
   * nie still verworfen. Der Benutzer entscheidet ausdrücklich, ob jetzt
   * gespeichert wird; lehnt er ab, bleibt er beim bisherigen Raum.
   */
  const vorRaumwechsel = async (): Promise<boolean> => {
    if (!offen) return true;
    const name = zustand.basis?.raum.name ?? "";
    if (!window.confirm(`Der Raum „${name}“ hat ungespeicherte Änderungen.

OK: jetzt speichern und wechseln.
Abbrechen: beim Raum bleiben.`)) {
      return false;
    }
    return speichern();
  };

  const raumAktivieren = async (raumId: string, auswahl: Auswahl): Promise<boolean> => {
    if (zustand.entwurf?.roomId === raumId) {
      dispatch({ typ: "auswaehlen", auswahl });
      return true;
    }
    const raum = raeume.find((r) => r.id === raumId);
    if (raum === undefined || !(await vorRaumwechsel())) return false;
    dispatch({ typ: "raum-aktivieren", raum, auswahl });
    return true;
  };

  const waehlen = (auswahl: Auswahl) => {
    if (auswahl === null) {
      dispatch({ typ: "auswaehlen", auswahl: zustand.entwurf === null ? null : { art: "raum", raumId: zustand.entwurf.roomId } });
      return;
    }
    void raumAktivieren(auswahl.raumId, auswahl);
  };

  const neuenRaumVorbereiten = (walls: readonly EntwurfWand[]) => {
    if (!schreibbar) return;
    setHinweis(null);
    setNeuerRaum(walls);
  };

  const rechteckFertig = (a: Punkt, b: Punkt) => {
    const ergebnis = rechteckWaende(a, b, STANDARD_WANDSTAERKE_MM, [neueId(), neueId(), neueId(), neueId()]);
    if ("fehler" in ergebnis) setHinweis(ergebnis.fehler);
    else neuenRaumVorbereiten(ergebnis.wert);
  };

  const polygonFertig = (punkte: readonly Punkt[]) => {
    const ergebnis = polygonWaende(punkte, STANDARD_WANDSTAERKE_MM, punkte.map(() => neueId()));
    if ("fehler" in ergebnis) setHinweis(ergebnis.fehler);
    else neuenRaumVorbereiten(ergebnis.wert);
  };

  const oeffnungPlatzieren = async (raumId: string, wandId: string, punkt: Punkt) => {
    let entwurf = zustand.entwurf;
    if (entwurf === null || entwurf.roomId !== raumId) {
      const raum = raeume.find((r) => r.id === raumId);
      if (raum === undefined || !(await vorRaumwechsel())) return;
      dispatch({ typ: "raum-aktivieren", raum });
      entwurf = basisAus(raum).entwurf;
    }
    const id = neueId();
    const ergebnis = oeffnungSetzen(entwurf, wandId, oeffnungsart, punkt, id, { rasterMm, fangen: fangAktiv });
    if ("fehler" in ergebnis) {
      setHinweis(ergebnis.fehler);
      return;
    }
    setHinweis(null);
    dispatch({ typ: "aendern", entwurf: ergebnis.wert });
    dispatch({ typ: "auswaehlen", auswahl: { art: "oeffnung", raumId, wandId, oeffnungId: id } });
  };

  const nachSchreiben = async (roomId: string | null) => {
    await onGespeichert(roomId);
  };

  /** Speichert den Entwurf des aktiven Raums; `true` bei Erfolg. */
  const speichern = async (): Promise<boolean> => {
    const { entwurf, basis } = zustand;
    if (!schreibbar || entwurf === null || basis === null || zustand.status === "speichert") return false;
    // Minimale lokale Prüfung: nur ganze Millimeter gehen über die Leitung.
    const ganzzahlig = entwurf.walls.every(
      (w) =>
        [w.x1_mm, w.y1_mm, w.x2_mm, w.y2_mm, w.thickness_mm].every(Number.isSafeInteger) &&
        w.openings.every((o) => [o.offset_mm, o.width_mm, o.height_mm, o.sill_height_mm].every(Number.isSafeInteger)),
    );
    if (!ganzzahlig) {
      setHinweis("Der Entwurf enthält Werte, die keine ganzen Millimeter sind. Bitte prüfen.");
      return false;
    }
    dispatch({ typ: "speichern-beginnt" });
    try {
      const gespeichert = await api.put("/api/v1/modules/electrical/rooms/{room_id}/contour", {
        path: { room_id: basis.raum.id },
        ifMatch: basis.raum.version,
        body: alsKonturanfrage(entwurf),
      });
      dispatch({ typ: "gespeichert", raum: gespeichert });
      queryClient.setQueryData<Geschossplan>(planSchluessel(floorId), (alt) =>
        alt === undefined ? alt : { ...alt, rooms: alt.rooms.map((r) => (r.id === gespeichert.id ? gespeichert : r)) },
      );
      await nachSchreiben(gespeichert.id);
      return true;
    } catch (error: unknown) {
      const auswertung = fehlerAuswerten(error);
      dispatch({ typ: "speichern-gescheitert", status: auswertung.status, fehler: auswertung.fehler });
      return false;
    }
  };

  const serverstandLaden = async () => {
    const aktiv = zustand.basis?.raum.id;
    const frisch = await queryClient.fetchQuery({
      queryKey: planSchluessel(floorId),
      queryFn: () =>
        api.get("/api/v1/modules/electrical/floors/{floor_id}/plan", { path: { floor_id: floorId } }),
      staleTime: 0,
    });
    const raum = frisch.rooms.find((r) => r.id === aktiv);
    if (raum === undefined) dispatch({ typ: "raum-verlassen" });
    else dispatch({ typ: "raum-aktivieren", raum });
  };

  const verwerfen = () => {
    if (offen && !window.confirm(VERWERFEN_FRAGE)) return;
    dispatch({ typ: "verwerfen" });
  };

  const raumAnlegen = async (werte: Raumwerte) => {
    if (neuerRaum === null) return undefined;
    const hoehe = werte.height_mm.trim();
    try {
      const raum = await api.post("/api/v1/modules/electrical/floors/{floor_id}/rooms", {
        path: { floor_id: floorId },
        body: {
          name: werte.name.trim(),
          room_number: werte.room_number.trim() === "" ? null : werte.room_number.trim(),
          height_mm: hoehe === "" ? null : Number.parseInt(hoehe, 10),
          walls: neuerRaum.map((w) => ({ ...w, openings: [] })),
        },
      });
      setNeuerRaum(null);
      // Den neuen Raum gleich bearbeitbar machen - aber nie einen offenen
      // Entwurf eines anderen Raums dafür verwerfen.
      if (!offen) nachLadenAktivieren.current = raum.id;
      await queryClient.invalidateQueries({ queryKey: planSchluessel(floorId) });
      await nachSchreiben(raum.id);
      setHinweis(`Raum „${raum.name}“ angelegt.`);
      return undefined;
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 422 && (error.problem?.errors ?? []).some((e) => e.field === "geometry")) {
        return { fehler: "Die gezeichnete Kontur ist nicht zulässig (z. B. überschneidende Wände). Bitte neu zeichnen." };
      }
      return alsFormularfehler(error, ["name", "room_number", "height_mm"] as const);
    }
  };

  const raumdatenSpeichern = async (werte: Raumwerte) => {
    const basis = zustand.basis;
    if (basis === null) return undefined;
    const hoehe = werte.height_mm.trim();
    try {
      // If-Match mit der Basisversion: Nur wenn niemand sonst dazwischen war,
      // darf die neue Version in den Entwurf übernommen werden.
      const raum = await api.patch("/api/v1/modules/electrical/rooms/{room_id}", {
        path: { room_id: basis.raum.id },
        ifMatch: basis.raum.version,
        body: {
          name: werte.name.trim(),
          room_number: werte.room_number.trim() === "" ? null : werte.room_number.trim(),
          height_mm: hoehe === "" ? null : Number.parseInt(hoehe, 10),
        },
      });
      setRaumdaten(false);
      dispatch({ typ: "stammdaten", raum });
      await queryClient.invalidateQueries({ queryKey: planSchluessel(floorId) });
      await nachSchreiben(raum.id);
      return undefined;
    } catch (error: unknown) {
      if (error instanceof ApiError && error.errorType === "version-conflict") {
        return { fehler: "Der Raum wurde zwischenzeitlich geändert. Bitte zuerst den Serverstand laden." };
      }
      return alsFormularfehler(error, ["name", "room_number", "height_mm"] as const);
    }
  };

  const zoom = (faktor: number) =>
    setViewport((v) => zoomen(v, faktor, { x: groesse.current.breite / 2, y: groesse.current.hoehe / 2 }));

  const einpassenAlle = () =>
    setViewport(
      einpassen(
        grenzenVon(darstellung.flatMap((r) => r.walls.flatMap((w) => [{ x: w.x1_mm, y: w.y1_mm }, { x: w.x2_mm, y: w.y2_mm }]))),
        groesse.current,
      ),
    );

  const werkzeugWaehlen = (werkzeug: Werkzeug) => {
    setHinweis(null);
    dispatch({ typ: "werkzeug", werkzeug });
  };

  const auswahlEntfernen = () => {
    const { auswahl, entwurf, basis } = zustand;
    if (!schreibbar || entwurf === null || basis === null || auswahl === null) return;
    if (auswahl.art === "oeffnung") {
      const gespeichert = new Set(basis.entwurf.walls.flatMap((w) => w.openings.map((o) => o.id)));
      aendern(oeffnungEntfernen(entwurf, auswahl.wandId, auswahl.oeffnungId, gespeichert));
      dispatch({ typ: "auswaehlen", auswahl: { art: "wand", raumId: auswahl.raumId, wandId: auswahl.wandId } });
    } else if (auswahl.art === "wand") {
      const ergebnis = wandEntfernen(entwurf, auswahl.wandId);
      if ("fehler" in ergebnis) setHinweis(ergebnis.fehler);
      else {
        aendern(ergebnis.wert);
        dispatch({ typ: "auswaehlen", auswahl: { art: "raum", raumId: auswahl.raumId } });
      }
    }
  };

  // --------------------------------------------------------------- Tastatur

  const taste = (event: KeyboardEvent) => {
    if (document.querySelector("dialog[open]") !== null) return;
    const strg = event.ctrlKey || event.metaKey;
    const k = event.key.toLowerCase();
    // Strg+S speichert auch aus einem Feld der Eigenschaften heraus - kein
    // Textfeld braucht das Kürzel, und der Browser würde sonst die Seite
    // speichern wollen.
    if (strg && k === "s") {
      event.preventDefault();
      void speichern();
      return;
    }
    const ziel = event.target instanceof Element ? event.target : null;
    // Texteingaben behalten ihre eigenen Kürzel (Strg+Z im Feld, Backspace).
    if (
      ziel?.closest(
        "input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select, [contenteditable='true']",
      )
    ) {
      return;
    }
    if (strg && k === "z" && !event.shiftKey) {
      event.preventDefault();
      if (zustand.zeichnung.length > 0) dispatch({ typ: "zeichnung", punkte: letztenPunktEntfernen(zustand.zeichnung) });
      else dispatch({ typ: "rueckgaengig" });
      return;
    }
    if (strg && (k === "y" || (k === "z" && event.shiftKey))) {
      event.preventDefault();
      dispatch({ typ: "wiederholen" });
      return;
    }
    if (strg || event.altKey) return;
    switch (event.key) {
      case "Escape":
        if (zustand.ziehenAb !== null) dispatch({ typ: "ziehen-abbrechen" });
        else if (zustand.zeichnung.length > 0) dispatch({ typ: "zeichnung", punkte: [] });
        else waehlen(null);
        return;
      case "Backspace":
      case "Delete":
        event.preventDefault();
        if (zustand.zeichnung.length > 0) dispatch({ typ: "zeichnung", punkte: letztenPunktEntfernen(zustand.zeichnung) });
        else auswahlEntfernen();
        return;
      case "Enter":
        if (zustand.werkzeug === "polygon" && zustand.zeichnung.length >= 3) {
          polygonFertig(zustand.zeichnung);
          dispatch({ typ: "zeichnung", punkte: [] });
        }
        return;
      case "+":
        zoom(1.25);
        return;
      case "-":
        zoom(0.8);
        return;
    }
    const werkzeuge: Record<string, Werkzeug> = { v: "auswahl", h: "pan" };
    if (schreibbar) Object.assign(werkzeuge, { r: "rechteck", p: "polygon", o: "oeffnung" });
    const w = werkzeuge[k];
    if (w !== undefined) werkzeugWaehlen(w);
    else if (k === "f") einpassenAlle();
  };
  const tastenRef = useRef(taste);
  useEffect(() => {
    tastenRef.current = taste;
  });
  useEffect(() => {
    const weiter = (event: KeyboardEvent) => tastenRef.current(event);
    window.addEventListener("keydown", weiter);
    return () => window.removeEventListener("keydown", weiter);
  }, []);

  const groesseMerken = useCallback((g: Groesse) => {
    groesse.current = g;
  }, []);

  // ------------------------------------------------------------------ Ansicht

  if (plan.isPending) return <p className="muted">Grundriss wird geladen ...</p>;
  if (plan.isError) {
    return (
      <p className="alert alert--error" role="alert">
        Der Grundriss dieses Geschosses konnte nicht geladen werden.
      </p>
    );
  }

  const status = zustand.status;
  const aktiverName = zustand.basis?.raum.name;

  return (
    <div className="grundriss">
      <Werkzeugleiste
        werkzeug={zustand.werkzeug}
        onWerkzeug={werkzeugWaehlen}
        oeffnungsart={oeffnungsart}
        onOeffnungsart={setOeffnungsart}
        rasterMm={rasterMm}
        onRaster={setRasterMm}
        fangAktiv={fangAktiv}
        onFang={setFangAktiv}
        kannRueckgaengig={zustand.zurueck.length > 0}
        kannWiederholen={zustand.vor.length > 0}
        onRueckgaengig={() => dispatch({ typ: "rueckgaengig" })}
        onWiederholen={() => dispatch({ typ: "wiederholen" })}
        onZoom={zoom}
        onEinpassen={einpassenAlle}
        darfSchreiben={schreibbar}
      />

      <div className="grundriss__speicherleiste" role="status" aria-live="polite">
        <span className={`grundriss__status grundriss__status--${status}`}>
          {!schreibbar
            ? "Nur Ansicht - Bearbeiten ist hier nicht möglich"
            : aktiverName === undefined
              ? "Kein Raum in Bearbeitung"
              : `${aktiverName}: ${STATUS_TEXT[status]}`}
        </span>
        {/* Immer vorhanden, nur deaktiviert: Die Leiste behält ihre Höhe, und
            die Zeichenfläche springt beim Aktivieren eines Raums nicht. */}
        {schreibbar && (
          <span className="button-row grundriss__speicheraktionen">
            <button
              type="button"
              className="button button--primary"
              disabled={!offen || status === "speichert"}
              onClick={() => void speichern()}
              title="Speichern (Strg+S)"
            >
              Speichern
            </button>
            <button type="button" className="button button--ghost" disabled={!offen || status === "speichert"} onClick={verwerfen}>
              Änderungen verwerfen
            </button>
          </span>
        )}
      </div>

      <div className="grundriss__arbeitsbereich">
        {/* Hinweise liegen über der Zeichenfläche statt darüber: Die Fläche
            darf nicht springen, während jemand zeichnet. */}
        <div className="grundriss__buehne">
        {hinweis !== null && (
          <p className="grundriss__hinweis" role="status">
            <span>{hinweis}</span>
            <button type="button" className="button button--ghost" aria-label="Hinweis schließen" onClick={() => setHinweis(null)}>
              ✕
            </button>
          </p>
        )}
        <Zeichenflaeche
          raeume={darstellung}
          zustand={zustand}
          dispatch={dispatch}
          viewport={viewport}
          setViewport={setViewport}
          onGroesse={groesseMerken}
          darfSchreiben={schreibbar}
          rasterMm={rasterMm}
          fangAktiv={fangAktiv}
          fehlerKeys={fehlerKeys}
          lokaleKeys={lokaleKeys}
          onWaehlen={waehlen}
          onPolygonFertig={polygonFertig}
          onRechteckFertig={rechteckFertig}
          onOeffnungSetzen={(raumId, wandId, punkt) => void oeffnungPlatzieren(raumId, wandId, punkt)}
          oeffnungsart={oeffnungsart}
          geschossLabel={geschossLabel}
        />
        </div>
        {/* Rückmeldungen des Servers stehen in der Seitenleiste: Die
            Zeichenfläche bleibt an ihrem Platz, während korrigiert wird. */}
        <div className="grundriss__seite">
        {zustand.serverFehler !== null && (
          <div className="alert alert--error grundriss__serverfehler" role="alert">
            <p>{zustand.serverFehler.meldung}</p>
            {zustand.serverFehler.eintraege.length > 0 && (
              <ul>
                {zustand.serverFehler.eintraege.map((e, i) => (
                  <li key={`${e.code}-${i}`}>{e.meldung}</li>
                ))}
              </ul>
            )}
            <div className="button-row">
              {status === "konflikt" && (
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => {
                    if (window.confirm("Den aktuellen Serverstand laden und Ihre lokalen Änderungen verwerfen?")) void serverstandLaden();
                  }}
                >
                  Serverstand laden (lokale Änderungen verwerfen)
                </button>
              )}
              <button type="button" className="button button--ghost" onClick={() => dispatch({ typ: "hinweis-schliessen" })}>
                {status === "konflikt" ? "Entwurf vorerst behalten" : "Hinweis schließen"}
              </button>
            </div>
          </div>
        )}
        <Eigenschaften
          zustand={zustand}
          raeume={raeume}
          darfSchreiben={schreibbar}
          onAendern={aendern}
          onWaehlen={waehlen}
          onRaumBearbeiten={() => setRaumdaten(true)}
          neueId={neueId}
        />
        </div>
      </div>

      <details className="grundriss__hilfe">
        <summary>Bedienung und Tastenkürzel</summary>
        <ul>
          <li>Rechteckraum (R): erste Ecke klicken, gegenüberliegende Ecke klicken, Namen vergeben.</li>
          <li>Polygonraum (P): Punkte nacheinander klicken; Klick auf den Startpunkt, Doppelklick oder Enter schließt. Rücktaste oder Strg+Z entfernt den letzten Punkt, Escape bricht ab.</li>
          <li>Öffnung (O): Art wählen, dann auf die Wand klicken. Verschieben: im Auswahlwerkzeug ziehen.</li>
          <li>Eckpunkt ziehen verschiebt beide angrenzenden Wände. Alt beim Ziehen setzt den Fang aus.</li>
          <li>Mausrad zoomt um den Zeiger, mittlere Maustaste oder H verschiebt die Ansicht, F passt ein.</li>
          <li>Strg+Z / Strg+Y (oder Strg+Umschalt+Z): Rückgängig / Wiederholen · Strg+S: Speichern · Entf: Auswahl entfernen.</li>
          <li>Änderungen bleiben lokal, bis „Speichern“ gedrückt wird. Die Ansicht „Tabellen &amp; Details“ bietet dieselben Daten als Formular.</li>
        </ul>
      </details>

      {neuerRaum !== null && (
        <RaumDialog
          key="neuer-raum"
          offen
          titel={`Neuer Raum (${neuerRaum.length} Wände)`}
          standardhoehe_mm={standardhoehe_mm}
          onSubmit={raumAnlegen}
          onClose={() => setNeuerRaum(null)}
        />
      )}
      {raumdaten && zustand.basis !== null && (
        <RaumDialog
          key={`raumdaten-${zustand.basis.raum.id}`}
          offen
          titel="Raumdaten bearbeiten"
          standardhoehe_mm={standardhoehe_mm}
          startwerte={{
            name: zustand.basis.raum.name,
            room_number: zustand.basis.raum.room_number ?? "",
            height_mm: zustand.basis.raum.height_mm === null ? "" : String(zustand.basis.raum.height_mm),
          }}
          onSubmit={raumdatenSpeichern}
          onClose={() => setRaumdaten(false)}
        />
      )}
    </div>
  );
}
