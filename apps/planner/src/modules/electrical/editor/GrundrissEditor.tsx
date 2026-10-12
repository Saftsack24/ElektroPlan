import { ApiError } from "@elektroplan/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { alsFormularfehler } from "../../../core/api/fehler";
import { useAuth } from "../../../core/auth/AuthProvider";
import { BEHALTEN_LABEL, VERWERFEN_LABEL, useRueckfrage } from "../../../core/ui/Rueckfrage";
import { useUngespeicherteAenderungen } from "../../../core/ui/ungespeichert";
import { KNOPFZEILE, knopf, meldungsflaeche } from "../../../core/ui/stil";
import { planAbfrage, planSchluessel } from "../plan";
import { RaumDialog } from "../RaumDialog";
import { raumtypAusWert } from "../texte";
import type { Raumwerte } from "../RaumDialog";
import { Eigenschaften, flaecheText } from "./Eigenschaften";
import type { EntwurfGeraet, EntwurfWand, Geschossplan, Oeffnungsart, RaumImPlan, Raumentwurf } from "./entwurf";
import { alsKonturanfrage, basisAus, ende, geraetAus, neueId, segmenteAus, start, STANDARD_WANDSTAERKE_MM } from "./entwurf";
import type { Geraetedarstellung } from "./Zeichenflaeche";
import { geraetebefunde } from "../geraete/geraetepruefung";
import type { PruefGeraet, PruefRaum } from "../geraete/geraetepruefung";
import { geraetEntfernen, pruefmass } from "../geraete/geraeteentwurf";
import { geraetName, katalogAbfrage, typenNachSchluessel } from "../geraete/katalog";
import {
  kreisBezeichnung,
  stromkreiseAbfrage,
  stromkreiseSchluessel,
  verteilungenAbfrage,
  zuordnungNachGeraet,
} from "../stromkreise/daten";
import { STANDARD_RASTER_MM } from "./fang";
import { konturbericht, oeffnungsBefunde, oeffnungsHoehenBefunde, streckenlaenge } from "./geometrie";
import type { Punkt } from "./geometrie";
import { fehlerAuswerten } from "./speichern";
import type { Groesse, Viewport } from "./viewport";
import { START_VIEWPORT, einpassen, grenzenVon, zoomen } from "./viewport";
import { Werkzeugleiste } from "./Werkzeugleiste";
import { editorEinordnung, editorTopologie } from "./platzierung";
import { kopplungenAus, kopplungenDerWaende } from "../kopplung/zuordnung";
import {
  letztenPunktEntfernen,
  oeffnungEntfernen,
  polygonWaende,
  rechteckWaende,
  wandEntfernen,
} from "./werkzeuge";
import { Zeichenflaeche } from "./Zeichenflaeche";
import type { Raumdarstellung } from "./Zeichenflaeche";
import { ANFANG, editorReducer, fehlerhafteKeys, ungespeichert } from "./zustand";
import { Deckenansicht } from "../deckenansicht/Deckenansicht";
import { Wandansicht } from "../wandansicht/Wandansicht";
import type { Wandziel } from "../wandansicht/Wandansicht";
import { umlaufsinn } from "../wandansicht/wandbezug";
import type { Auswahl, Speicherstatus, Werkzeug } from "./zustand";
import { AKTION } from "../../../core/ui/aktionssymbole";
import { Symbol } from "../../../core/ui/Symbol";


const STATUS_TEXT: Record<Speicherstatus, string> = {
  sauber: "Keine ungespeicherten Änderungen",
  geaendert: "Ungespeicherte Änderungen",
  speichert: "Wird gespeichert …",
  gespeichert: "Gespeichert",
  konflikt: "Konflikt - nicht gespeichert",
  validierung: "Nicht gespeichert - bitte prüfen",
  fehler: "Nicht gespeichert",
};

// Vollständige Klassen je Status: Tailwind erkennt nur statisch ausgeschriebene Namen.
const STATUS_FARBE: Record<Speicherstatus, string> = {
  sauber: "",
  geaendert: "text-warning",
  speichert: "",
  gespeichert: "text-success",
  konflikt: "text-danger",
  validierung: "text-danger",
  fehler: "text-danger",
};

/** Ziel einer Deckenansicht - mit optional gewähltem Gerät und Herkunft (Phase 5). */
export interface Deckenziel {
  readonly raumId: string;
  readonly geraetId?: string;
  readonly herkunft?: "2d" | "3d";
}

const RAUM_MELDUNG =
  "Der aktive Raum hat ungespeicherte Änderungen. Wenn Sie fortfahren, gehen sie verloren.";

/** Wände eines Raums in Entwurfsform - Serverstand oder Entwurf. */
function basisWaende(walls: RaumImPlan["walls"] | Raumentwurf["walls"]): Raumentwurf["walls"] {
  return walls.map((w) => ({
    id: w.id,
    x1_mm: w.x1_mm,
    y1_mm: w.y1_mm,
    x2_mm: w.x2_mm,
    y2_mm: w.y2_mm,
    thickness_mm: w.thickness_mm,
    openings: [],
  }));
}

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
  buildingId,
  geschossLabel,
  standardhoehe_mm,
  darfSchreiben,
  onUngespeichert,
  onGespeichert,
  startWandansicht = null,
  startDeckenansicht = null,
  onStartVerbraucht,
  onZurueck3d,
}: {
  floorId: string;
  /** Gebäude des Geschosses (Phase 6b.1) - für die Rückfrage zu zugeordneten Geräten. */
  buildingId?: string | undefined;
  geschossLabel: string;
  standardhoehe_mm: number;
  darfSchreiben: boolean;
  onUngespeichert: (offen: boolean) => void;
  /** Nach jedem erfolgreichen Schreibvorgang - damit die Tabellenansicht nachzieht. */
  onGespeichert: (roomId: string | null) => Promise<void>;
  /** Phase 4f: nach dem Laden diese Wand in der Wandansicht öffnen (Einstieg aus 3D). */
  startWandansicht?: Wandziel | null;
  /** Phase 5: nach dem Laden die Deckenansicht dieses Raums öffnen (Einstieg aus 3D). */
  startDeckenansicht?: Deckenziel | null;
  onStartVerbraucht?: () => void;
  /** Wandansicht wurde aus 3D geöffnet und geschlossen: zurück zur 3D-Ansicht. */
  onZurueck3d?: () => void;
}) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const fragen = useRueckfrage();
  const [zustand, dispatch] = useReducer(editorReducer, ANFANG);
  const [viewport, setViewport] = useState<Viewport>(START_VIEWPORT);
  const groesse = useRef<Groesse>({ breite: 900, hoehe: 560 });
  const [rasterMm, setRasterMm] = useState<number>(STANDARD_RASTER_MM);
  const [fangAktiv, setFangAktiv] = useState(true);
  const [oeffnungsart, setOeffnungsart] = useState<Oeffnungsart>("door");
  const [neuerRaum, setNeuerRaum] = useState<readonly EntwurfWand[] | null>(null);
  const [raumdaten, setRaumdaten] = useState(false);
  const [hinweis, setHinweis] = useState<string | null>(null);
  // Wand- und Deckenansicht (Phase 4f): reine Sichten auf denselben Entwurf.
  const [wandansicht, setWandansicht] = useState<Wandziel | null>(null);
  // Woher die Wandansicht kam - bleibt über Seiten- und Wandwechsel erhalten.
  const herkunft = useRef<"2d" | "3d">("2d");
  const [deckenansicht, setDeckenansicht] = useState<Deckenziel | null>(null);
  const eingepasst = useRef(false);
  const nachLadenAktivieren = useRef<string | null>(null);

  const plan = useQuery(planAbfrage(api, floorId));
  const katalog = useQuery(katalogAbfrage(api));
  // Stromkreiszuordnung der Geräte (Phase 6b.1) - nur gelesen, für die Rückfrage beim Speichern.
  const stromkreise = useQuery({ ...stromkreiseAbfrage(api, buildingId ?? ""), enabled: buildingId !== undefined });
  const verteilungen = useQuery({ ...verteilungenAbfrage(api, buildingId ?? ""), enabled: buildingId !== undefined });
  const typen = useMemo(() => typenNachSchluessel(katalog.data), [katalog.data]);
  const raeume: readonly RaumImPlan[] = useMemo(
    () => (Array.isArray(plan.data?.rooms) ? plan.data.rooms : []),
    [plan.data],
  );
  // Wandkopplungen (Phase 6a) - gespeichert, mit Status und Vorschlägen des Servers.
  const planKopplungen = useMemo(() => (Array.isArray(plan.data?.wall_links) ? plan.data.wall_links : []), [plan.data]);
  const planKandidaten = useMemo(
    () => (Array.isArray(plan.data?.wall_link_candidates) ? plan.data.wall_link_candidates : []),
    [plan.data],
  );
  const kopplungen = useMemo(() => kopplungenAus(planKopplungen), [planKopplungen]);

  const offen = ungespeichert(zustand);
  const schreibbar = darfSchreiben;
  useUngespeicherteAenderungen(offen, RAUM_MELDUNG);
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

  // ------------------------------------------------- Geräte (Phase 5, ADR 0023)

  /** Geräte eines Raums im gezeigten Stand - aktiver Raum aus dem Entwurf. */
  const geraeteVon = useCallback(
    (raumId: string): readonly EntwurfGeraet[] => {
      if (zustand.entwurf !== null && zustand.entwurf.roomId === raumId) return zustand.entwurf.geraete;
      const raum = raeume.find((r) => r.id === raumId);
      return (Array.isArray(raum?.devices) ? raum.devices : []).map(geraetAus);
    },
    [raeume, zustand.entwurf],
  );

  /**
   * Befunde je Gerät im gezeigten Stand des ganzen Geschosses - dieselben
   * Regeln wie der Server (abgeleitete Öffnungen und geteilte Wandstücke
   * der Nachbarräume eingeschlossen), dazu die Codes der letzten Serverantwort.
   */
  const geraeteBefunde = useMemo(() => {
    const raeumePruef: PruefRaum[] = darstellung.map((r) => ({
      id: r.id,
      hoeheMm: r.aktiv ? (zustand.basis?.raum.effective_height_mm ?? standardhoehe_mm) : (raeume.find((x) => x.id === r.id)?.effective_height_mm ?? standardhoehe_mm),
      waende: r.walls.map((w) => ({
        id: w.id,
        raumId: r.id,
        start: start(w),
        ende: ende(w),
        oeffnungen: w.openings.map((o) => ({ oeffnungId: o.id, art: o.kind, offsetMm: o.offset_mm, breiteMm: o.width_mm, hoeheMm: o.height_mm, bruestungMm: o.sill_height_mm })),
      })),
    }));
    const geraetePruef: PruefGeraet[] = darstellung.flatMap((r) =>
      geraeteVon(r.id).map((g) => ({
        id: g.id,
        raumId: r.id,
        typ: g.device_type_key,
        flaeche: g.mounting_surface,
        wandId: g.wall_id,
        mitte: g.center_offset_mm,
        mittelhoehe: g.center_height_mm,
        x: g.x_mm,
        y: g.y_mm,
      })),
    );
    const je = new Map<string, Set<string>>();
    if (typen.size > 0) {
      const masse = new Map([...typen].map(([k, t]) => [k, pruefmass(t)] as const));
      for (const b of geraetebefunde(floorId, raeumePruef, geraetePruef, masse, kopplungen)) {
        const id = b.keys[0];
        if (id !== undefined) je.set(id, (je.get(id) ?? new Set()).add(b.code));
      }
    }
    const geraeteIds = new Set(geraetePruef.map((g) => g.id));
    for (const e of zustand.serverFehler?.eintraege ?? []) {
      const id = e.keys[0];
      if (id !== undefined && geraeteIds.has(id)) je.set(id, (je.get(id) ?? new Set()).add(e.code));
    }
    return new Map([...je].map(([id, codes]) => [id, [...codes]] as const));
  }, [darstellung, geraeteVon, typen, floorId, zustand.basis, zustand.serverFehler, raeume, standardhoehe_mm, kopplungen]);

  /** Geräte für den Grundriss: Wandgeräte auf ihrer Montageseite neben der Wand. */
  const geraeteDarstellung: readonly Geraetedarstellung[] = useMemo(() => {
    const liste: Geraetedarstellung[] = [];
    for (const r of darstellung) {
      const umlauf = umlaufsinn(r.walls);
      for (const g of geraeteVon(r.id)) {
        const typ = typen.get(g.device_type_key);
        const basis = { id: g.id, raumId: r.id, aktiv: r.aktiv, typ, name: geraetName(typ, g.label, g.device_type_key), fehler: (geraeteBefunde.get(g.id) ?? []).length > 0 };
        if (g.mounting_surface === "ceiling") {
          if (g.x_mm === null || g.y_mm === null) continue;
          liste.push({ ...basis, anker: { x: g.x_mm, y: g.y_mm }, versatzMm: 0, richtung: { x: 0, y: 0 }, decke: true });
          continue;
        }
        const w = r.walls.find((x) => x.id === g.wall_id);
        if (w === undefined || g.center_offset_mm === null) continue;
        const dx = w.x2_mm - w.x1_mm;
        const dy = w.y2_mm - w.y1_mm;
        const l = Math.hypot(dx, dy) || 1;
        const t = g.center_offset_mm / l;
        // Innen liegt links der Wandrichtung bei gegen den Uhrzeigersinn, sonst rechts.
        const links = { x: -dy / l, y: dx / l };
        const innen = umlauf === "im-uhrzeigersinn" ? { x: -links.x, y: -links.y } : links;
        const richtung = umlauf === null ? { x: 0, y: 0 } : g.mounting_surface === "wall_interior" ? innen : { x: -innen.x, y: -innen.y };
        liste.push({ ...basis, anker: { x: w.x1_mm + dx * t, y: w.y1_mm + dy * t }, versatzMm: w.thickness_mm / 2, richtung, decke: false });
      }
    }
    return liste;
  }, [darstellung, geraeteVon, typen, geraeteBefunde]);

  const lokaleKeys = useMemo(() => {
    const entwurf = zustand.entwurf;
    const keys = new Set<string>();
    if (entwurf === null) return keys;
    for (const befund of konturbericht(segmenteAus(entwurf.walls)).befunde) {
      // Eine offene Kontur ist ein zulässiger Entwurf - nur echte Fehler markieren.
      if (befund.code.startsWith("contour-")) continue;
      befund.keys.forEach((k) => keys.add(k));
    }
    // Geräte des aktiven Raums mit Befund (Phase 5).
    for (const g of entwurf.geraete) if ((geraeteBefunde.get(g.id) ?? []).length > 0) keys.add(g.id);
    for (const w of entwurf.walls) {
      const laenge = streckenlaenge({ x: w.x1_mm, y: w.y1_mm }, { x: w.x2_mm, y: w.y2_mm });
      const spannen = w.openings.map((o) => ({ key: o.id, abstand: o.offset_mm, breite: o.width_mm }));
      spannen.forEach((s, i) => oeffnungsBefunde(s, laenge, spannen.slice(i + 1)).forEach((b) => b.keys.forEach((k) => keys.add(k))));
      // Höhenlage gegen die Raumhöhe - dieselbe Regel wie der Server (Phase 4f).
      const raumhoehe = zustand.basis?.raum.effective_height_mm;
      if (raumhoehe !== undefined) {
        for (const o of w.openings) {
          oeffnungsHoehenBefunde(o.id, o.kind, o.height_mm, o.sill_height_mm, raumhoehe).forEach((b) => b.keys.forEach((k) => keys.add(k)));
        }
      }
    }
    return keys;
  }, [zustand.entwurf, zustand.basis, geraeteBefunde]);

  const fehlerKeys = useMemo(() => fehlerhafteKeys(zustand), [zustand]);

  // Gemeinsame Wandtopologie des gezeigten Stands: aktiver Raum aus dem
  // Entwurf, alle anderen vom Server - dieselbe Ableitung wie in der
  // 3D-Ansicht. Daraus: welche Öffnung welche zwei Räume verbindet.
  const topologie = useMemo(() => editorTopologie(floorId, darstellung, kopplungen), [floorId, darstellung, kopplungen]);
  const einordnung = useMemo(() => editorEinordnung(topologie), [topologie]);
  const waendeVon = useCallback(
    (raumId: string) => darstellung.find((r) => r.id === raumId)?.walls ?? [],
    [darstellung],
  );
  const raumName = useCallback(
    (raumId: string) => {
      const raum = darstellung.find((r) => r.id === raumId);
      return raum === undefined ? "unbekannter Raum" : raum.nummer !== null ? `${raum.nummer} ${raum.name}` : raum.name;
    },
    [darstellung],
  );

  // -------------------------------------------------------------- Aktionen

  const aendern = useCallback((entwurf: Raumentwurf) => dispatch({ typ: "aendern", entwurf }), []);

  /**
   * Vor dem Wechsel zu einem anderen Raum: Ungespeicherte Änderungen werden
   * nie still verworfen. Der Benutzer entscheidet ausdrücklich: speichern
   * und wechseln, verwerfen und wechseln oder beim Raum bleiben.
   */
  const vorRaumwechsel = async (): Promise<boolean> => {
    if (!offen) return true;
    const name = zustand.basis?.raum.name ?? "";
    const antwort = await fragen({
      titel: "Raum wechseln?",
      text: (
        <p>
          Der Raum „{name}“ hat ungespeicherte Änderungen. Sie können sie vor dem Wechsel speichern
          oder verwerfen.
        </p>
      ),
      alternativeLabel: "Speichern und wechseln",
      bestaetigenLabel: VERWERFEN_LABEL,
      abbrechenLabel: "Beim Raum bleiben",
    });
    if (antwort === "alternative") return speichern();
    if (antwort === "bestaetigt") {
      dispatch({ typ: "verwerfen" });
      return true;
    }
    return false;
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

  /**
   * Der Standardweg für Öffnungen (Phase 4f): die Wandansicht der Wand öffnen -
   * mit Platzierungswerkzeug (Tür, Fenster, Durchgang) oder mit einer
   * vorhandenen Öffnung ausgewählt. Gehört die Wand zu einem anderen Raum,
   * wird er über den üblichen Raumwechsel aktiviert (Rückfrage bei
   * ungespeicherten Änderungen). Hier entsteht keine Öffnung.
   */
  const wandansichtOeffnen = async (ziel: Wandziel) => {
    const auswahl: Auswahl =
      ziel.geraetId !== undefined
        ? { art: "geraet", raumId: ziel.raumId, geraetId: ziel.geraetId }
        : ziel.oeffnungId !== undefined
          ? { art: "oeffnung", raumId: ziel.raumId, wandId: ziel.wandId, oeffnungId: ziel.oeffnungId }
          : { art: "wand", raumId: ziel.raumId, wandId: ziel.wandId };
    const walls =
      zustand.entwurf?.roomId === ziel.raumId ? zustand.entwurf.walls : (raeume.find((r) => r.id === ziel.raumId)?.walls ?? []);
    if (umlaufsinn(basisWaende(walls)) === null) {
      if (await raumAktivieren(ziel.raumId, auswahl)) {
        setHinweis("Die Wandansicht braucht eine geschlossene Raumkontur. Bitte zuerst die Kontur schließen.");
      }
      return;
    }
    if (!(await raumAktivieren(ziel.raumId, auswahl))) return;
    setHinweis(null);
    herkunft.current = ziel.herkunft ?? "2d";
    setWandansicht(ziel);
  };

  /** Deckenansicht eines Raums öffnen - über den üblichen Raumwechsel (Rückfrage). */
  const deckenansichtOeffnen = async (ziel: Deckenziel) => {
    const auswahl: Auswahl = ziel.geraetId !== undefined ? { art: "geraet", raumId: ziel.raumId, geraetId: ziel.geraetId } : { art: "raum", raumId: ziel.raumId };
    const walls = zustand.entwurf?.roomId === ziel.raumId ? zustand.entwurf.walls : (raeume.find((r) => r.id === ziel.raumId)?.walls ?? []);
    if (!(await raumAktivieren(ziel.raumId, auswahl))) return;
    if (umlaufsinn(basisWaende(walls)) === null) {
      setHinweis("Die Deckenansicht braucht eine geschlossene Raumkontur. Bitte zuerst die Kontur schließen.");
      return;
    }
    setHinweis(null);
    herkunft.current = ziel.herkunft ?? "2d";
    setDeckenansicht(ziel);
  };

  /** Ein Gerät in seiner Wand- bzw. Deckenansicht bearbeiten. */
  const geraetBearbeiten = (raumId: string, geraetId: string) => {
    const g = geraeteVon(raumId).find((x) => x.id === geraetId);
    if (g === undefined) return;
    if (g.mounting_surface === "ceiling") void deckenansichtOeffnen({ raumId, geraetId });
    else if (g.wall_id !== null) {
      void wandansichtOeffnen({ raumId, wandId: g.wall_id, geraetId, seite: g.mounting_surface === "wall_exterior" ? "aussen" : "innen" });
    }
  };

  const nachSchreiben = async (roomId: string | null) => {
    await onGespeichert(roomId);
  };

  /** Speichert den Entwurf des aktiven Raums; `true` bei Erfolg. */
  const speichern = async (): Promise<boolean> => {
    const { entwurf, basis } = zustand;
    if (!schreibbar || entwurf === null || basis === null || zustand.status === "speichert") return false;
    // Minimale lokale Prüfung: nur ganze Millimeter gehen über die Leitung.
    const ganzzahlig =
      entwurf.walls.every(
        (w) =>
          [w.x1_mm, w.y1_mm, w.x2_mm, w.y2_mm, w.thickness_mm].every(Number.isSafeInteger) &&
          w.openings.every((o) => [o.offset_mm, o.width_mm, o.height_mm, o.sill_height_mm].every(Number.isSafeInteger)),
      ) &&
      entwurf.geraete.every((g) => [g.center_offset_mm, g.center_height_mm, g.x_mm, g.y_mm].every((v) => v === null || Number.isSafeInteger(v)));
    if (!ganzzahlig) {
      setHinweis("Der Entwurf enthält Werte, die keine ganzen Millimeter sind. Bitte prüfen.");
      return false;
    }
    // Wandkopplungen entfallender Wände (Phase 6a): nie nebenbei - ausdrücklich bestätigen.
    const verbleibend = new Set(entwurf.walls.map((w) => w.id));
    const entfallend = new Set(basis.entwurf.walls.map((w) => w.id).filter((id) => !verbleibend.has(id)));
    const betroffen = kopplungenDerWaende(planKopplungen, entfallend);
    // Entfernte Geräte mit Stromkreiszuordnung (Phase 6b.1): Die Zuordnung geht beim Speichern verloren.
    const zuordnung = zuordnungNachGeraet(stromkreise.data?.circuits ?? []);
    const zugeordnet = entwurf.entfernteGeraete.flatMap((id) => {
      const kreis = zuordnung.get(id);
      const geraet = basis.entwurf.geraete.find((g) => g.id === id);
      return kreis === undefined ? [] : [{ id, kreis, geraet }];
    });
    if (betroffen.length > 0 || zugeordnet.length > 0) {
      const titel =
        betroffen.length > 0 && zugeordnet.length > 0
          ? "Wandzuordnung und Stromkreiszuordnung mit entfernen?"
          : betroffen.length > 0
            ? betroffen.length === 1
              ? "Wandzuordnung mit lösen?"
              : `${betroffen.length} Wandzuordnungen mit lösen?`
            : zugeordnet.length === 1
              ? "Stromkreiszuordnung mit entfernen?"
              : `${zugeordnet.length} Stromkreiszuordnungen mit entfernen?`;
      const antwort = await fragen({
        titel,
        text: (
          <>
            {zugeordnet.length > 0 && (
              <>
                <p>
                  {zugeordnet.length === 1 ? "Ein entferntes Gerät ist" : "Entfernte Geräte sind"} einem Stromkreis
                  zugeordnet. Beim Speichern geht diese Zuordnung verloren; der Stromkreis selbst bleibt.
                </p>
                <ul>
                  {zugeordnet.map(({ id, kreis, geraet }) => (
                    <li key={id}>
                      {geraet === undefined ? "Gerät" : geraetName(typen.get(geraet.device_type_key), geraet.label, geraet.device_type_key)}{" "}
                      – Stromkreis {kreisBezeichnung(kreis, verteilungen.data?.boards ?? [])}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {betroffen.length > 0 && (
              <>
                <p>
                  Mindestens eine Wand, die entfernt wird, ist einer Wand eines Nachbarraums zugeordnet
                  (gemeinsame Bauwand oder getrennte Wände). Beim Speichern wird diese Zuordnung gelöst; der Nachbarraum
                  bleibt unverändert.
                </p>
                <ul>
                  {betroffen.map((k) => {
                    const andere = entfallend.has(k.wall_a_id) ? k.wall_b_id : k.wall_a_id;
                    const raum = raeume.find((r) => r.walls.some((w) => w.id === andere));
                    return (
                      <li key={k.id}>
                        {k.relation === "shared" ? "Gemeinsame Bauwand" : "Getrennte Wände"} mit „
                        {raum === undefined ? "einem anderen Raum" : raumName(raum.id)}“
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </>
        ),
        bestaetigenLabel: betroffen.length > 0 ? "Speichern und Zuordnung lösen" : "Speichern und Zuordnung entfernen",
        abbrechenLabel: "Nicht speichern",
      });
      if (antwort !== "bestaetigt") return false;
    }
    dispatch({ typ: "speichern-beginnt" });
    try {
      const gespeichert = await api.put("/api/v1/modules/electrical/rooms/{room_id}/contour", {
        path: { room_id: basis.raum.id },
        ifMatch: basis.raum.version,
        body: { ...alsKonturanfrage(entwurf), removed_wall_link_ids: betroffen.map((k) => k.id) },
      });
      dispatch({ typ: "gespeichert", raum: gespeichert });
      queryClient.setQueryData<Geschossplan>(planSchluessel(floorId), (alt) =>
        alt === undefined ? alt : { ...alt, rooms: alt.rooms.map((r) => (r.id === gespeichert.id ? gespeichert : r)) },
      );
      // Kopplungsstatus und Versionen der Partnerräume kann das Speichern ändern.
      await queryClient.invalidateQueries({ queryKey: planSchluessel(floorId) });
      // Entfernte Geräte verlieren ihre Stromkreiszuordnung (CASCADE).
      if (buildingId !== undefined) await queryClient.invalidateQueries({ queryKey: stromkreiseSchluessel(buildingId) });
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

  const verwerfen = async () => {
    if (offen) {
      const antwort = await fragen({
        titel: "Änderungen verwerfen?",
        text: <p>{RAUM_MELDUNG}</p>,
        bestaetigenLabel: "Änderungen verwerfen",
        abbrechenLabel: BEHALTEN_LABEL,
      });
      if (antwort !== "bestaetigt") return;
    }
    dispatch({ typ: "verwerfen" });
  };

  const serverstandBestaetigen = async () => {
    const antwort = await fragen({
      titel: "Serverstand laden?",
      text: (
        <p>
          Der aktuelle Serverstand ersetzt Ihren lokalen Entwurf dieses Raums. Ihre lokalen
          Änderungen gehen dabei verloren.
        </p>
      ),
      bestaetigenLabel: "Lokale Änderungen verwerfen und Serverstand laden",
      abbrechenLabel: BEHALTEN_LABEL,
    });
    if (antwort === "bestaetigt") await serverstandLaden();
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
          room_type: raumtypAusWert(werte.room_type),
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
          room_type: raumtypAusWert(werte.room_type),
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

  /**
   * Zur gespeicherten Quelle einer Öffnung bzw. in einen anderen Raum: über
   * den üblichen Raumwechsel - bei ungespeicherten Änderungen mit Rückfrage
   * (speichern und wechseln, verwerfen, bleiben). Kein Entwurf geht verloren.
   */
  const wandansichtOeffnenRef = useRef(wandansichtOeffnen);
  useEffect(() => {
    wandansichtOeffnenRef.current = wandansichtOeffnen;
  });

  // Einstieg aus der 3D-Ansicht: sobald der Plan da ist, genau einmal. Steht
  // bewusst hinter der Aktualisierung des Verweises - Effekte laufen in
  // Deklarationsreihenfolge, sonst sähe er noch die leere Raumliste.
  const deckenansichtOeffnenRef = useRef(deckenansichtOeffnen);
  useEffect(() => {
    deckenansichtOeffnenRef.current = deckenansichtOeffnen;
  });
  const startRef = useRef(startWandansicht);
  const startDeckeRef = useRef(startDeckenansicht);
  useEffect(() => {
    if (!plan.isSuccess) return;
    const start = startRef.current;
    if (start !== null && raeume.some((r) => r.id === start.raumId)) {
      startRef.current = null;
      onStartVerbraucht?.();
      void wandansichtOeffnenRef.current(start);
      return;
    }
    const decke = startDeckeRef.current;
    if (decke !== null && raeume.some((r) => r.id === decke.raumId)) {
      startDeckeRef.current = null;
      onStartVerbraucht?.();
      void deckenansichtOeffnenRef.current(decke);
    }
  }, [plan.isSuccess, raeume, onStartVerbraucht]);

  const quelleBearbeiten = async (ziel: Wandziel, oeffnungId: string | null) => {
    const auswahl: Auswahl =
      oeffnungId !== null
        ? { art: "oeffnung", raumId: ziel.raumId, wandId: ziel.wandId, oeffnungId }
        : { art: "wand", raumId: ziel.raumId, wandId: ziel.wandId };
    if (await raumAktivieren(ziel.raumId, auswahl)) setWandansicht({ ...ziel, ...(oeffnungId !== null ? { oeffnungId } : {}) });
  };

  const deckenansichtSchliessen = () => {
    setDeckenansicht(null);
    if (herkunft.current === "3d") {
      herkunft.current = "2d";
      onZurueck3d?.();
    }
    if (offen) {
      setHinweis(`Die Änderungen sind im Entwurf von „${zustand.basis?.raum.name ?? ""}“ erhalten – noch nicht gespeichert.`);
    }
  };

  const wandansichtSchliessen = () => {
    setWandansicht(null);
    // Aus 3D geöffnet: dorthin zurück. Ungespeicherte Änderungen fragt der
    // Ansichtswechsel wie immer nach - nichts wird still gespeichert oder verworfen.
    if (herkunft.current === "3d") {
      herkunft.current = "2d";
      onZurueck3d?.();
    }
    if (offen) {
      setHinweis(`Die Änderungen sind im Entwurf von „${zustand.basis?.raum.name ?? ""}“ erhalten – noch nicht gespeichert.`);
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
    if (auswahl.art === "geraet") {
      aendern(geraetEntfernen(entwurf, auswahl.geraetId, new Set(basis.entwurf.geraete.map((g) => g.id))));
      dispatch({ typ: "auswaehlen", auswahl: { art: "raum", raumId: auswahl.raumId } });
      return;
    }
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
    // Tür (T), Fenster (N), Durchgang (D) - wie in der Wandansicht.
    const arten: Record<string, Oeffnungsart> = { t: "door", n: "window", d: "passage" };
    const w = werkzeuge[k];
    const art = schreibbar ? arten[k] : undefined;
    if (art !== undefined) {
      setOeffnungsart(art);
      werkzeugWaehlen("oeffnung");
    } else if (w !== undefined) werkzeugWaehlen(w);
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

  if (plan.isPending) return <p className="text-muted">Grundriss wird geladen ...</p>;
  if (plan.isError) {
    return (
      <p className={meldungsflaeche()} role="alert">
        Der Grundriss dieses Geschosses konnte nicht geladen werden.
      </p>
    );
  }

  const status = zustand.status;
  const aktiverName = zustand.basis?.raum.name;

  return (
    <div className="flex flex-col gap-2.5">
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

      <div className="flex min-h-10 flex-wrap items-center justify-between gap-3" role="status" aria-live="polite">
        <span className={`font-semibold ${STATUS_FARBE[status]}`}>
          {!schreibbar
            ? "Nur Ansicht - Bearbeiten ist hier nicht möglich"
            : aktiverName === undefined
              ? "Kein Raum in Bearbeitung"
              : `${aktiverName}: ${STATUS_TEXT[status]}`}
        </span>
        {/* Immer vorhanden, nur deaktiviert: Die Leiste behält ihre Höhe, und
            die Zeichenfläche springt beim Aktivieren eines Raums nicht. */}
        {schreibbar && (
          <span className="flex flex-wrap gap-2">
            <button
              type="button"
              className={knopf("primaer")}
              disabled={!offen || status === "speichert"}
              onClick={() => void speichern()}
              title="Speichern (Strg+S)"
            >
              Speichern
            </button>
            <button type="button" className={knopf()} disabled={!offen || status === "speichert"} onClick={() => void verwerfen()}>
              Änderungen verwerfen
            </button>
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 split:grid-cols-[minmax(0,1fr)_300px]">
        {/* Hinweise liegen über der Zeichenfläche statt darüber: Die Fläche
            darf nicht springen, während jemand zeichnet. */}
        <div className="relative min-w-0">
        {hinweis !== null && (
          // Klicks gehen durch den Hinweis hindurch auf die Zeichenfläche - nur
          // das Schließen-Kreuz fängt sie ab. Sonst verdeckte er den oberen Zeichenrand.
          <p
            className="pointer-events-none absolute top-2 right-2 z-[1] m-0 flex max-w-[min(420px,calc(100%-16px))] items-center justify-between gap-2 rounded-ep border border-line bg-surface py-1 pr-1 pl-2.5 text-[0.88rem] shadow-hint"
            role="status"
          >
            <span>{hinweis}</span>
            <button
              type="button"
              className={`${knopf()} pointer-events-auto`}
              aria-label="Hinweis schließen"
              title="Hinweis schließen"
              onClick={() => setHinweis(null)}
            >
              <Symbol icon={AKTION.schliessen} />
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
          onWandFuerOeffnung={(raumId, wandId) => void wandansichtOeffnen({ raumId, wandId, werkzeug: oeffnungsart })}
          onOeffnungBearbeiten={(raumId, wandId, oeffnungId) => void wandansichtOeffnen({ raumId, wandId, oeffnungId })}
          onHinweis={setHinweis}
          oeffnungsart={oeffnungsart}
          geschossLabel={geschossLabel}
          topologie={topologie}
          einordnung={einordnung}
          raumName={raumName}
          geraete={geraeteDarstellung}
          onGeraetBearbeiten={geraetBearbeiten}
        />
        </div>
        {/* Rückmeldungen des Servers stehen in der Seitenleiste: Die
            Zeichenfläche bleibt an ihrem Platz, während korrigiert wird. */}
        <div className="flex min-w-0 flex-col gap-2">
        {zustand.serverFehler !== null && (
          <div className={`${meldungsflaeche()} text-[0.88rem]`} role="alert">
            <p>{zustand.serverFehler.meldung}</p>
            {zustand.serverFehler.eintraege.length > 0 && (
              <ul className="my-1 pl-[18px]">
                {zustand.serverFehler.eintraege.map((e, i) => (
                  <li key={`${e.code}-${i}`}>{e.meldung}</li>
                ))}
              </ul>
            )}
            <div className={KNOPFZEILE}>
              {status === "konflikt" && (
                <button
                  type="button"
                  className={knopf()}
                  onClick={() => void serverstandBestaetigen()}
                >
                  Serverstand laden (lokale Änderungen verwerfen)
                </button>
              )}
              <button type="button" className={knopf()} onClick={() => dispatch({ typ: "hinweis-schliessen" })}>
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
          onWandansicht={(wandId, oeffnungId) => {
            if (zustand.entwurf !== null) {
              void wandansichtOeffnen({ raumId: zustand.entwurf.roomId, wandId, ...(oeffnungId !== undefined ? { oeffnungId } : {}) });
            }
          }}
          onDeckenansicht={() => {
            if (zustand.entwurf !== null) void deckenansichtOeffnen({ raumId: zustand.entwurf.roomId });
          }}
          neueId={neueId}
          einordnung={einordnung}
          topologie={topologie}
          raumName={raumName}
          typen={typen}
          geraetebefunde={geraeteBefunde}
          kopplungen={planKopplungen}
          kandidaten={planKandidaten}
          onGeraetBearbeiten={(geraetId) => {
            if (zustand.entwurf !== null) geraetBearbeiten(zustand.entwurf.roomId, geraetId);
          }}
        />
        </div>
      </div>

      <details className="text-[0.88rem] text-muted">
        <summary className="cursor-pointer">Bedienung und Tastenkürzel</summary>
        <ul>
          <li>Rechteckraum (R): erste Ecke klicken, gegenüberliegende Ecke klicken, Namen vergeben.</li>
          <li>Polygonraum (P): Punkte nacheinander klicken; Klick auf den Startpunkt, Doppelklick oder Enter schließt. Rücktaste oder Strg+Z entfernt den letzten Punkt, Escape bricht ab.</li>
          <li>Tür (T), Fenster (N), Durchgang (D): Wand anklicken – ihre Wandansicht öffnet sich mit diesem Werkzeug, gesetzt wird dort. Der Klick im Grundriss legt noch keine Öffnung an. Bei einer gemeinsamen Wand zählt die Raumseite, auf die geklickt wurde. Eine vorhandene Öffnung mit dem Werkzeug anklicken oder doppelklicken: Sie wird in der Wandansicht bearbeitet. Im Auswahlwerkzeug lässt sie sich weiterhin entlang ihrer Wand ziehen.</li>
          <li>Eine Öffnung auf einer gemeinsamen Wand wird nur einmal gespeichert und gilt für beide Räume; im Nachbarraum erscheint sie gestrichelt als abgeleitete Darstellung.</li>
          <li>Geräte (Steckdosen, Schalter, Leuchten, Netzwerkdosen) werden in der Wandansicht (innen oder außen) bzw. in der Deckenansicht gesetzt und verschoben. Im Grundriss erscheinen sie als Symbol auf ihrer Montageseite; Klick wählt, Doppelklick öffnet die passende Ansicht.</li>
          <li>Eckpunkt ziehen verschiebt beide angrenzenden Wände. Alt beim Ziehen setzt den Fang aus.</li>
          <li>Mausrad zoomt um den Zeiger, mittlere Maustaste oder H verschiebt die Ansicht, F setzt die Ansicht zurück (ganzer Grundriss).</li>
          <li>Strg+Z / Strg+Y (oder Strg+Umschalt+Z): Rückgängig / Wiederholen · Strg+S: Speichern · Entf: Auswahl entfernen.</li>
          <li>Änderungen bleiben lokal, bis „Speichern“ gedrückt wird. Die Ansicht „Tabellen &amp; Details“ bietet dieselben Daten als Formular.</li>
        </ul>
      </details>

      {wandansicht !== null && (
        <Wandansicht
          ziel={wandansicht}
          zustand={zustand}
          dispatch={dispatch}
          raeume={raeume}
          waendeVon={waendeVon}
          topologie={topologie}
          einordnung={einordnung}
          raumName={raumName}
          darfSchreiben={schreibbar}
          rasterMm={rasterMm}
          onRaster={setRasterMm}
          fangAktiv={fangAktiv}
          onFang={setFangAktiv}
          status={{
            text: aktiverName === undefined ? STATUS_TEXT[status] : `${aktiverName}: ${STATUS_TEXT[status]}`,
            farbe: STATUS_FARBE[status],
            speichert: status === "speichert",
          }}
          offen={offen}
          onSpeichern={() => void speichern()}
          onVerwerfen={() => void verwerfen()}
          onWechseln={setWandansicht}
          onQuelleBearbeiten={(ziel, oeffnungId) => void quelleBearbeiten(ziel, oeffnungId)}
          onSchliessen={wandansichtSchliessen}
          typen={typen}
          geraeteVon={geraeteVon}
          geraetebefunde={geraeteBefunde}
        />
      )}
      {deckenansicht !== null && (
        <Deckenansicht
          raumId={deckenansicht.raumId}
          raumName={raumName(deckenansicht.raumId)}
          walls={waendeVon(deckenansicht.raumId)}
          deckenhoeheMm={
            zustand.basis?.raum.id === deckenansicht.raumId
              ? zustand.basis.raum.effective_height_mm
              : (raeume.find((r) => r.id === deckenansicht.raumId)?.effective_height_mm ?? standardhoehe_mm)
          }
          eigeneHoehe={(raeume.find((r) => r.id === deckenansicht.raumId)?.height_mm ?? null) !== null}
          rasterMm={rasterMm}
          onRaster={setRasterMm}
          onSchliessen={deckenansichtSchliessen}
          zustand={zustand}
          dispatch={dispatch}
          typen={typen}
          geraete={geraeteVon(deckenansicht.raumId)}
          geraetebefunde={geraeteBefunde}
          editierbar={schreibbar && zustand.entwurf?.roomId === deckenansicht.raumId}
          fangAktiv={fangAktiv}
          onFang={setFangAktiv}
          status={{
            text: aktiverName === undefined ? STATUS_TEXT[status] : `${aktiverName}: ${STATUS_TEXT[status]}`,
            farbe: STATUS_FARBE[status],
            speichert: status === "speichert",
          }}
          offen={offen}
          onSpeichern={() => void speichern()}
          onVerwerfen={() => void verwerfen()}
          startGeraetId={deckenansicht.geraetId ?? null}
        />
      )}
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
            room_type: zustand.basis.raum.room_type ?? "",
          }}
          onSubmit={raumdatenSpeichern}
          onClose={() => setRaumdaten(false)}
        />
      )}
    </div>
  );
}
