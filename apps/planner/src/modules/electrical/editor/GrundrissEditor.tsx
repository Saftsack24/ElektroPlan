import { ApiError } from "@elektroplan/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { alsFormularfehler } from "../../../core/api/fehler";
import { useAuth, usePermission } from "../../../core/auth/AuthProvider";
import { BEHALTEN_LABEL, VERWERFEN_LABEL, useRueckfrage, verwerfenOptionen } from "../../../core/ui/Rueckfrage";
import { useUngespeicherteAenderungen } from "../../../core/ui/ungespeichert";
import { knopf, meldungsflaeche } from "../../../core/ui/stil";
import { planAbfrage, planSchluessel } from "../plan";
import { RaumDialog } from "../RaumDialog";
import { raumtypAusWert } from "../texte";
import type { Raumwerte } from "../RaumDialog";
import { Eigenschaften, flaecheText } from "./Eigenschaften";
import type { EntwurfGeraet, EntwurfWand, Geschossplan, RaumImPlan, Raumentwurf } from "./entwurf";
import { alsKonturanfrage, basisAus, ende, geraetAus, neueId, segmenteAus, start, STANDARD_WANDSTAERKE_MM } from "./entwurf";
import type { Geraetedarstellung } from "./Zeichenflaeche";
import { geraetebefunde, punktImPolygon } from "../geraete/geraetepruefung";
import type { PruefGeraet, PruefRaum } from "../geraete/geraetepruefung";
import { geraetEntfernen, pruefmass } from "../geraete/geraeteentwurf";
import { geraetName, katalogAbfrage, typenNachSchluessel } from "../geraete/katalog";
import {
  kreisBezeichnung,
  stromkreiseAbfrage,
  stromkreiseSchluessel,
  verteilungenAbfrage,
  verteilungenSchluessel,
  zuordnungNachGeraet,
} from "../stromkreise/daten";
import { STANDARD_RASTER_MM } from "./fang";
import { konturbericht, oeffnungsBefunde, oeffnungsHoehenBefunde, streckenlaenge } from "./geometrie";
import type { Punkt } from "./geometrie";
import { fehlerAuswerten } from "./speichern";
import type { Groesse, Viewport } from "./viewport";
import { START_VIEWPORT, einpassen, grenzenVon, zoomen } from "./viewport";
import { Werkzeugleiste } from "./Werkzeugleiste";
import type { Wandwahl } from "./Werkzeugleiste";
import { HilfeDialog } from "../arbeitsflaeche/Werkzeuggruppen";
import { useAnsichtsgedaechtnis } from "../arbeitsflaeche/ansichtsgedaechtnis";
import { knopftext, useKompakt } from "../arbeitsflaeche/kompakt";
import { useStabil } from "../arbeitsflaeche/stabil";
import { GrundrissLegende } from "../leitung/GrundrissLeitungsfeld";
import { Planungsarbeitsflaeche, arbeitsflaecheZeigen, useArbeitsflaeche } from "../arbeitsflaeche/Planungsarbeitsflaeche";
import type { Arbeitsflaechenzustand } from "../arbeitsflaeche/Planungsarbeitsflaeche";
import { Entwurfsfehler, Raumrueckmeldung } from "../arbeitsflaeche/Kontextleiste";
import { editorEinordnung, editorTopologie, raumwandUnterZeiger } from "./platzierung";
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
import { BestaetigungAbgelehnt, bestaetigungsfeld, useLeitungsbestaetigung } from "../leitung/bestaetigung";
import { durchfuehrungenSchluessel, leitungenSchluessel } from "../leitung/daten";
import type { Arbeitsflaeche, Leitungskontext } from "../leitung/kontext";
import type { Leitungsplanung } from "../leitung/useLeitungsplanung";
import { LEITUNG_MELDUNG, LeitungsplanungProvider, useGrundrisseinstellung, useLeitungsplanungImKontext } from "../leitung/LeitungsplanungProvider";
import { useGrundrissleitungen } from "../leitung/Grundrissleitungen";
import type { Wandtreffer } from "../leitung/Grundrissleitungen";
import { GrundrissLeitungshilfe, GrundrissLeitungsleiste, Steigwegwahl } from "../leitung/GrundrissLeitungsfeld";
import { Leitungsbereich } from "../leitung/Leitungsbereich";
import { Zeichenleiste } from "../leitung/Zeichenleiste";
import { ZUORDNUNG_MELDUNG } from "../stromkreise/texte";
import type { Platzierungsfehler, Verteilungsplatzierung } from "../stromkreise/platzierung";
import { GERAETETYPEN_RECHT } from "../geraete/typen";
import { Geraetekatalog } from "../geraete/Geraetekatalog";
import type { Verteilungsangebot } from "../geraete/Geraetekatalog";
import { Geraetesymbol } from "../geraete/symbole";
import { erlaubt } from "../geraete/katalog";
import { platzierungSpeichern, platzierungsfehler } from "../stromkreise/platzierung";
import { useZuordnungsentwurf } from "../stromkreise/zuordnung";


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
  /** K1: aus dem Gerätekatalog gewählter Typ – das Werkzeug „Gerät“ ist beim Öffnen aktiv. */
  readonly geraetetyp?: string;
  readonly herkunft?: "2d" | "3d";
}

/** Woher eine Wand- oder Deckenansicht geöffnet wurde - dorthin führt das Schließen zurück. */
type Herkunft = "2d" | "3d" | "stromkreise";

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

type EditorProps = Parameters<typeof GrundrissEditorInhalt>[0] extends infer P ? Omit<P, "planung"> : never;

/**
 * Grafischer Grundrisseditor eines Geschosses (Phase 4a).
 *
 * Die Leitungsplanung gehört seit 6b.5 zum Gebäude (`LeitungsplanungProvider`):
 * Im Projekt-Tab umschließt sie alle Ansichten eines Gebäudes, damit ein
 * Leitungsentwurf Geschoss- und Ansichtswechsel übersteht. Wird der Editor ohne
 * diesen Rahmen gezeigt, erhält er einen eigenen.
 */
export function GrundrissEditor(props: EditorProps) {
  const planung = useLeitungsplanungImKontext();
  if (planung !== null) return <GrundrissEditorInhalt {...props} planung={planung} />;
  return (
    <LeitungsplanungProvider
      buildingId={props.buildingId}
      darfLeitungen={props.darfLeitungen ?? false}
      darfStromkreise={props.darfStromkreise ?? false}
      onGeschrieben={props.onGeschrieben}
    >
      <EigenerRahmen {...props} />
    </LeitungsplanungProvider>
  );
}

function EigenerRahmen(props: EditorProps) {
  const planung = useLeitungsplanungImKontext();
  return planung === null ? null : <GrundrissEditorInhalt {...props} planung={planung} />;
}

/**
 * Lädt den Planungsstand in **einer** Anfrage, hält genau einen Raum als
 * lokalen Entwurf und speichert ihn **bewusst** und atomar über
 * `PUT /rooms/{id}/contour`. Kein Autosave; jede Bewegung bleibt lokal, bis
 * gespeichert wird. Die Serverantwort wird danach die neue Basis.
 */
function GrundrissEditorInhalt({
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
  darfStromkreise = false,
  onGeschrieben,
  onGeschossWechseln,
  rueckkehr3dAnbieten = false,
  onZurueckZuMengen,
  arbeitsflaeche,
  planung,
  verteilung = null,
  onVerteilungEnde,
  onZurueckStromkreise,
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
  /** Phase 6b.4: `electrical.route.write` und Projekt nicht schreibgeschützt. */
  darfLeitungen?: boolean;
  /** Phase 6b.4: `electrical.circuit.write` und Projekt nicht schreibgeschützt. */
  darfStromkreise?: boolean;
  /** Nach Schreibvorgängen an Leitungen und Zuordnungen (Projektkopf nachladen). */
  onGeschrieben?: (() => Promise<void>) | undefined;
  /** Leitungsplanung des Gebäudes (6b.5) - vom Provider. */
  planung: Leitungsplanung;
  /** Steigweg (6b.5): ins Zielgeschoss wechseln - der Leitungsentwurf bleibt erhalten. */
  onGeschossWechseln?: ((floorId: string) => void) | undefined;
  /** Aus 3D geöffnet (6b.5): Rückweg zur 3D-Ansicht mit gemerkter Kamera anbieten. */
  rueckkehr3dAnbieten?: boolean;
  /** Aus der Mengenübersicht geöffnet (6b.6): Rückweg dorthin - aufgeklappte Gruppen bleiben. */
  onZurueckZuMengen?: (() => void) | undefined;
  /**
   * Panel- und Maximierungszustand von außen (6c.0): Der Projekt-Tab hält ihn, damit er
   * Geschoss- und Ansichtswechsel übersteht. Ohne Angabe hält der Editor ihn selbst.
   */
  arbeitsflaeche?: Arbeitsflaechenzustand | undefined;
  /**
   * Phase 6c (VP): Verteilung direkt platzieren - Wand des gewählten Raums anklicken, in der
   * Wandansicht setzen und speichern. Ein eigener kleiner Entwurf, nie mit dem Raumentwurf.
   */
  verteilung?: Verteilungsplatzierung | null;
  /** Platzierung beendet: Meldung nach dem Speichern, `null` nach „Abbrechen“. */
  onVerteilungEnde?: ((meldung: string | null) => void) | undefined;
  /** Wandansicht aus der Ansicht „Stromkreise“ geöffnet („Im Plan zeigen“) und geschlossen. */
  onZurueckStromkreise?: (() => void) | undefined;
}) {
  const { api } = useAuth();
  const darfTypen = usePermission(GERAETETYPEN_RECHT);
  const queryClient = useQueryClient();
  const fragen = useRueckfrage();
  const [zustand, dispatch] = useReducer(editorReducer, ANFANG);
  const [viewport, setViewport] = useState<Viewport>(START_VIEWPORT);
  const groesse = useRef<Groesse>({ breite: 900, hoehe: 560 });
  const [rasterMm, setRasterMm] = useState<number>(STANDARD_RASTER_MM);
  const [fangAktiv, setFangAktiv] = useState(true);
  /** Was ein Klick auf eine Wand öffnet: Öffnungsart oder Gerätewerkzeug der Wandfläche (L1). */
  const [wandwahl, setWandwahl] = useState<Wandwahl>("door");
  /** Hilfe zur Fläche (Tastenkürzel, Legende) im Dialog statt unter der Zeichenfläche (L1). */
  const [hilfe, setHilfe] = useState(false);
  /** Viewport je besuchter Wand-/Deckenfläche – begrenzt, ohne eingehängte Flächen (L1). */
  const flaechenansichten = useAnsichtsgedaechtnis();
  const kompakt = useKompakt();
  const kurz = (voll: string, knapp: string) => knopftext(kompakt, voll, knapp);
  const [neuerRaum, setNeuerRaum] = useState<readonly EntwurfWand[] | null>(null);
  const [raumdaten, setRaumdaten] = useState(false);
  const [hinweis, setHinweis] = useState<string | null>(null);
  /**
   * Rückmeldung des Zeichenablaufs (6c L2/L3) - steht in der Zeichenleiste, nicht als Hinweis über der
   * Fläche. Sie gilt nur für den Ablaufzustand, in dem sie entstand.
   */
  const [leitungsMeldung, setLeitungsMeldung] = useState<string | null>(null);
  /** Panel und Maximierung - reine Ansicht (Phase 6c.0). */
  const eigeneArbeitsflaeche = useArbeitsflaeche();
  const af = arbeitsflaeche ?? eigeneArbeitsflaeche;
  // Wand- und Deckenansicht (Phase 4f): reine Sichten auf denselben Entwurf.
  const [wandansicht, setWandansicht] = useState<Wandziel | null>(null);
  // Woher die Wandansicht kam - bleibt über Seiten- und Wandwechsel erhalten.
  const herkunft = useRef<Herkunft>("2d");
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
  // Gerätezuordnung gehört zu diesem Geschoss; der Leitungsentwurf (6b.5) zum Gebäude (Provider).
  const zuordnung = useZuordnungsentwurf({ buildingId: buildingId ?? "", darfSchreiben: darfStromkreise, onGeschrieben });
  const mitBestaetigung = useLeitungsbestaetigung();
  const leitungAktiv = planung.entwurf !== null;
  const zuordnungAktiv = zuordnung.entwurf !== null;
  // Höchstens ein aktiver Entwurf: Solange Leitung oder Zuordnung offen ist, ruht die Raumbearbeitung.
  const schreibbar = darfSchreiben && !leitungAktiv && !zuordnungAktiv;
  // Gemeldet werden Raum und Zuordnung - sie gehen mit dem Geschoss verloren. Den Leitungsentwurf
  // meldet und schützt der Provider des Gebäudes; er übersteht einen Geschosswechsel.
  const offenGesamt = offen || zuordnung.offen;
  useUngespeicherteAenderungen(offenGesamt, zuordnung.offen ? ZUORDNUNG_MELDUNG : RAUM_MELDUNG);
  useEffect(() => onUngespeichert(offenGesamt), [offenGesamt, onUngespeichert]);

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

  const raumAktivierenRef = useRef(raumAktivieren);
  useEffect(() => {
    raumAktivierenRef.current = raumAktivieren;
  });

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
      // Unterbricht das Speichern Leitungen, fragt der Server nach - bestätigt werden genau diese (6b.4).
      const gespeichert = await mitBestaetigung((bestaetigt) =>
        api.put("/api/v1/modules/electrical/rooms/{room_id}/contour", {
          path: { room_id: basis.raum.id },
          ifMatch: basis.raum.version,
          body: { ...alsKonturanfrage(entwurf), removed_wall_link_ids: betroffen.map((k) => k.id), ...bestaetigungsfeld(bestaetigt) },
        }),
      );
      dispatch({ typ: "gespeichert", raum: gespeichert });
      queryClient.setQueryData<Geschossplan>(planSchluessel(floorId), (alt) =>
        alt === undefined ? alt : { ...alt, rooms: alt.rooms.map((r) => (r.id === gespeichert.id ? gespeichert : r)) },
      );
      // Kopplungsstatus und Versionen der Partnerräume kann das Speichern ändern.
      await queryClient.invalidateQueries({ queryKey: planSchluessel(floorId) });
      // Entfernte Geräte verlieren ihre Stromkreiszuordnung (CASCADE); Leitungen ändern Status und Länge.
      if (buildingId !== undefined) {
        await queryClient.invalidateQueries({ queryKey: stromkreiseSchluessel(buildingId) });
        await queryClient.invalidateQueries({ queryKey: leitungenSchluessel(buildingId) });
      }
      await queryClient.invalidateQueries({ queryKey: durchfuehrungenSchluessel(floorId) });
      await nachSchreiben(gespeichert.id);
      return true;
    } catch (error: unknown) {
      if (error instanceof BestaetigungAbgelehnt) {
        dispatch({ typ: "hinweis-schliessen" });
        setHinweis("Nicht gespeichert – die Leitungen bleiben unverändert. Ihr Entwurf ist erhalten.");
        return false;
      }
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
      const raum = await mitBestaetigung((bestaetigt) =>
        api.patch("/api/v1/modules/electrical/rooms/{room_id}", {
          path: { room_id: basis.raum.id },
          ifMatch: basis.raum.version,
          body: {
            name: werte.name.trim(),
            room_number: werte.room_number.trim() === "" ? null : werte.room_number.trim(),
            height_mm: hoehe === "" ? null : Number.parseInt(hoehe, 10),
            room_type: raumtypAusWert(werte.room_type),
            ...bestaetigungsfeld(bestaetigt),
          },
        }),
      );
      setRaumdaten(false);
      if (buildingId !== undefined) await queryClient.invalidateQueries({ queryKey: leitungenSchluessel(buildingId) });
      dispatch({ typ: "stammdaten", raum });
      await queryClient.invalidateQueries({ queryKey: planSchluessel(floorId) });
      await nachSchreiben(raum.id);
      return undefined;
    } catch (error: unknown) {
      if (error instanceof BestaetigungAbgelehnt) {
        return { fehler: "Nicht gespeichert – die Leitungen bleiben unverändert." };
      }
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
    } else if (herkunft.current === "stromkreise") {
      herkunft.current = "2d";
      onZurueckStromkreise?.();
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

  // ------------------------------------------------ Leitungsplanung (6b.4)

  const wandName = (wandId: string): string => {
    for (const r of darstellung) {
      const i = r.walls.findIndex((w) => w.id === wandId);
      if (i >= 0) return `Wand ${i + 1} (${raumName(r.id)})`;
    }
    for (const r of planung.vorbereitet?.raeume.values() ?? []) {
      const i = r.waende.findIndex((w) => w.id === wandId);
      // Gebäudeweiter Entwurf (6b.5): Raum mit Geschoss statt nur „anderes Geschoss“.
      if (i >= 0) return `Wand ${i + 1} (${planung.raumMitGeschoss(r.id)})`;
    }
    return "unbekannte Wand";
  };

  /** Wechsel der Arbeitsfläche im selben Entwurf: nichts wird gespeichert oder verworfen. */
  const arbeitsflaecheWechseln = (ziel: Arbeitsflaeche) => {
    const von = herkunft.current;
    // Die Rückmeldung gehörte zur vorigen Fläche.
    setLeitungsMeldung(null);
    if (ziel.art === "wand") {
      setDeckenansicht(null);
      void wandansichtOeffnen({ raumId: ziel.raumId, wandId: ziel.wandId, ...(ziel.seite !== undefined ? { seite: ziel.seite } : {}), herkunft: von });
    } else {
      setWandansicht(null);
      void deckenansichtOeffnen({ raumId: ziel.raumId, herkunft: von === "stromkreise" ? "2d" : von });
    }
  };

  // ------------------------------------------------- Verteilung platzieren (6c, VP)

  // Arbeitskopie: Nach „Neu laden“ zählt die aktuelle Version der Verteilung.
  const [platzierung, setPlatzierung] = useState(verteilung);
  const platzierungGestartet = useRef(false);
  useEffect(() => {
    if (platzierung === null || platzierungGestartet.current || !plan.isSuccess) return;
    platzierungGestartet.current = true;
    // Raum hervorheben und die Wandwahl aktivieren - gesetzt wird in der Wandansicht.
    if (platzierung.raumId !== null) void raumAktivierenRef.current(platzierung.raumId, { art: "raum", raumId: platzierung.raumId });
    setWandwahl("geraet");
    dispatch({ typ: "werkzeug", werkzeug: "oeffnung" });
  }, [platzierung, plan.isSuccess]);

  /** Klick auf eine Wand während der Platzierung: nur Wände des gewählten Raums, Innenseite. */
  const platzierungswand = async (raumId: string, wandId: string) => {
    if (platzierung === null) return;
    if (platzierung.raumId !== null && raumId !== platzierung.raumId) {
      setHinweis(`Bitte eine Wand von „${raumName(platzierung.raumId)}“ anklicken – dort wird ${platzierung.code} platziert.`);
      return;
    }
    if (offen) {
      // Höchstens ein Entwurf (6c §6.3): Die Platzierung speichert nie etwas anderes mit.
      setHinweis(`Im Raum „${zustand.basis?.raum.name ?? ""}“ gibt es ungespeicherte Änderungen – bitte zuerst speichern oder verwerfen. Die Platzierung speichert nur die Verteilung.`);
      return;
    }
    await wandansichtOeffnen({ raumId, wandId, seite: "innen" });
  };

  const platzierungBeenden = (meldung: string | null) => {
    if (platzierungAusKatalog.current && meldung === null) {
      // Aus dem Gerätekatalog (K1): Abbrechen bleibt im Editor - Fläche und Entwurf wie vorher.
      platzierungAusKatalog.current = false;
      platzierungGestartet.current = false;
      setPlatzierung(null);
      dispatch({ typ: "werkzeug", werkzeug: "auswahl" });
      return;
    }
    platzierungAusKatalog.current = false;
    setWandansicht(null);
    dispatch({ typ: "werkzeug", werkzeug: "auswahl" });
    onVerteilungEnde?.(meldung);
  };

  // ------------------------------------------------------ Gerätekatalog (K1)

  const [katalogOffen, setKatalogOffen] = useState(false);
  /** Im Katalog gewählter Typ - danach Wand bzw. Raum anklicken. */
  const [geraetewahl, setGeraetewahl] = useState<string | null>(null);
  const platzierungAusKatalog = useRef(false);
  const geraetewahlTyp = geraetewahl === null ? undefined : typen.get(geraetewahl);
  const geraetewahlAktiv = geraetewahlTyp !== undefined && zustand.werkzeug === "oeffnung" && wandwahl === "geraet";
  const geraetWand = geraetewahlTyp !== undefined && (erlaubt(geraetewahlTyp, "wall_interior") || erlaubt(geraetewahlTyp, "wall_exterior"));
  const geraetDecke = geraetewahlTyp !== undefined && erlaubt(geraetewahlTyp, "ceiling");

  /** „Gerät“ (Knopf, Taste G, Typ-Chip): Katalog - nie neben einem Leitungs- oder Zuordnungsentwurf. */
  const katalogOeffnen = () => {
    if (!schreibbar) {
      if (darfSchreiben && sperrgrund !== null) setHinweis(sperrgrund);
      return;
    }
    setKatalogOffen(true);
  };

  /** Nach „Platzieren“: Wand oder Raum wählen - die passende Fläche öffnet sich mit Werkzeug und Typ. */
  const geraetUebernehmen = (key: string): string | undefined => {
    setGeraetewahl(key);
    setWandwahl("geraet");
    dispatch({ typ: "werkzeug", werkzeug: "oeffnung" });
    setHinweis(null);
    setKatalogOffen(false);
    return undefined;
  };

  /** Wandklick mit gewähltem Typ: Wandtyp → Wandansicht (innen, sonst außen), reiner Deckentyp → Decke des Raums. */
  const geraetAnWand = (raumId: string, wandId: string) => {
    if (geraetewahlTyp === undefined) return;
    if (erlaubt(geraetewahlTyp, "wall_interior") || erlaubt(geraetewahlTyp, "wall_exterior")) {
      void wandansichtOeffnen({
        raumId,
        wandId,
        werkzeug: "geraet",
        geraetetyp: geraetewahlTyp.key,
        seite: erlaubt(geraetewahlTyp, "wall_interior") ? "innen" : "aussen",
      });
    } else {
      void deckenansichtOeffnen({ raumId, geraetetyp: geraetewahlTyp.key });
    }
  };

  /** Klick ins Rauminnere: Deckentyp → Deckenansicht des Raums; sonst der übliche Hinweis. */
  const geraetFlaechenklick = (welt: Punkt): boolean => {
    if (!geraetewahlAktiv || geraetewahlTyp === undefined || !erlaubt(geraetewahlTyp, "ceiling")) return false;
    const raum = darstellung.find((r) => r.walls.length >= 3 && punktImPolygon(welt, r.walls.map((w) => ({ x: w.x1_mm, y: w.y1_mm }))));
    if (raum === undefined) {
      setHinweis(`In einen Raum klicken – die Deckenansicht öffnet sich zum Setzen von „${geraetewahlTyp.label}“.`);
      return true;
    }
    void deckenansichtOeffnen({ raumId: raum.id, geraetetyp: geraetewahlTyp.key });
    return true;
  };

  /** „Verteilung platzieren …“ aus dem Katalog: derselbe VP-Ablauf - auf der offenen Wand oder per Wandwahl. */
  const verteilungAusKatalog = (boardId: string) => {
    const board = verteilungen.data?.boards.find((b) => b.id === boardId);
    setKatalogOffen(false);
    if (board === undefined) return;
    setGeraetewahl(null);
    platzierungAusKatalog.current = true;
    platzierungGestartet.current = false;
    setPlatzierung({ boardId: board.id, code: board.code, name: board.name, version: board.version, geraetId: board.placement_device_id, floorId, raumId: wandansicht?.raumId ?? null });
    if (wandansicht !== null) setWandansicht({ raumId: wandansicht.raumId, wandId: wandansicht.wandId, seite: "innen", herkunft: wandansicht.herkunft ?? "2d" });
  };

  const verteilungsangebot: Verteilungsangebot | undefined =
    buildingId === undefined
      ? undefined
      : {
          verteilungen: (verteilungen.data?.boards ?? []).filter((b) => b.placement_device_id === null).map((b) => ({ id: b.id, code: b.code, name: b.name })),
          gesperrt: !darfStromkreise
            ? "Verteilungen platziert, wer Verteilungen und Stromkreise bearbeiten darf."
            : offen
              ? `Im Raum „${zustand.basis?.raum.name ?? ""}“ gibt es ungespeicherte Änderungen – bitte zuerst speichern oder verwerfen. Die Platzierung speichert nur die Verteilung.`
              : null,
          onWahl: verteilungAusKatalog,
        };

  const platzierungNeuLaden = async () => {
    if (platzierung === null || buildingId === undefined) return;
    await queryClient.invalidateQueries({ queryKey: planSchluessel(floorId) });
    const frisch = (await queryClient.fetchQuery(verteilungenAbfrage(api, buildingId))).boards.find((b) => b.id === platzierung.boardId);
    if (frisch === undefined) {
      platzierungBeenden("Die Verteilung gibt es nicht mehr – es wurde nichts gespeichert.");
      return;
    }
    setPlatzierung({ ...platzierung, version: frisch.version, geraetId: frisch.placement_device_id });
  };

  const platzierungSpeichernAktion = async (raumId: string, wandId: string, lage: { mitteMm: number; hoeheMm: number }): Promise<Platzierungsfehler | null> => {
    const raum = raeume.find((r) => r.id === raumId);
    if (platzierung === null || raum === undefined) return { text: "Der Raum ist nicht mehr vorhanden. Bitte neu laden.", konflikt: true };
    try {
      const antwort = await platzierungSpeichern(api, platzierung, { raumId, raumVersion: raum.version, wandId, mitteMm: lage.mitteMm, hoeheMm: lage.hoeheMm });
      // Plan aller betroffenen Geschosse, Verteilungen und Leitungen (Längen ab dem Lagegerät) nachziehen.
      await Promise.all([
        ...[...new Set(antwort.rooms.map((x) => x.floor_id))].map((id) => queryClient.invalidateQueries({ queryKey: planSchluessel(id) })),
        ...(buildingId === undefined
          ? []
          : [
              queryClient.invalidateQueries({ queryKey: verteilungenSchluessel(buildingId) }),
              queryClient.invalidateQueries({ queryKey: leitungenSchluessel(buildingId) }),
            ]),
      ]);
      await onGeschrieben?.();
      const nummer = (raum.walls.findIndex((w) => w.id === wandId) + 1) || "";
      platzierungBeenden(`${platzierung.code} platziert: ${raum.name} (${geschossLabel}), Wand ${nummer}.`);
      return null;
    } catch (error: unknown) {
      return platzierungsfehler(error);
    }
  };

  const leitungSchliessen = async (): Promise<boolean> => {
    // Eine neue Leitung ohne Startgerät und Punkte ist nichts - schließen ohne Rückfrage.
    const leer = planung.entwurf?.cableId === null && planung.entwurf.werte.startId === null && planung.entwurf.werte.wegpunkte.length === 0;
    if (planung.ungespeichert && !leer && (await fragen(verwerfenOptionen("Leitungsentwurf schließen?", "Sie wollen den Leitungsentwurf schließen.", LEITUNG_MELDUNG))) !== "bestaetigt") {
      return false;
    }
    planung.schliessen();
    return true;
  };

  const zuordnungSchliessen = async (): Promise<boolean> => {
    if (zuordnung.offen && (await fragen(verwerfenOptionen("Zuordnung schließen?", "Sie wollen die Gerätezuordnung schließen.", ZUORDNUNG_MELDUNG))) !== "bestaetigt") {
      return false;
    }
    zuordnung.schliessen();
    return true;
  };

  const sperrgrund = offen
    ? `Der Raum „${zustand.basis?.raum.name ?? ""}“ hat ungespeicherte Änderungen – bitte zuerst speichern oder verwerfen.`
    : leitungAktiv
      ? "Ein Leitungsentwurf ist bereits offen – bitte zuerst speichern oder schließen."
      : zuordnungAktiv
        ? "Eine Gerätezuordnung ist offen – bitte zuerst speichern oder schließen."
        : null;

  /** „Leitung hinzufügen“ (6c, L2): direkt zeichnen - ohne Stromkreiswahl, ohne Formular. */
  const leitungZeichnen = (): string | null => {
    if (offen) return `Der Raum „${zustand.basis?.raum.name ?? ""}“ hat ungespeicherte Änderungen – bitte zuerst speichern oder verwerfen.`;
    if (zuordnungAktiv) return "Eine Gerätezuordnung ist offen – bitte zuerst speichern oder schließen.";
    if (!planung.darfLeitungen) return "Leitungen dürfen hier nicht bearbeitet werden.";
    // Nach „Ansicht verschieben“ wieder zeichnen (Knopf und Taste L): Die Zeichenfläche gäbe Klicks sonst
    // weiter an das Verschieben.
    if (zustand.werkzeug === "pan") dispatch({ typ: "werkzeug", werkzeug: "auswahl" });
    const begonnen = planung.ablauf === null;
    planung.leitungZeichnen();
    // Zeichnen braucht die ganze Fläche: einmal ins Bild (Grundriss, Wand und Decke teilen diesen Einstieg).
    if (begonnen) arbeitsflaecheZeigen();
    return null;
  };

  const leitungskontext: Leitungskontext = {
    planung,
    zuordnung,
    sperrgrund,
    leitungZeichnen,
    arbeitsflaecheWechseln,
    zumGrundriss: () => {
      setLeitungsMeldung(null);
      setWandansicht(null);
      setDeckenansicht(null);
      herkunft.current = "2d";
    },
    raumName,
    wandName,
    zuordnungSchliessen,
    leitungSchliessen,
  };

  // Leitung im Grundriss (6b.5): Fußboden, grobe Wand- und Deckenpunkte, Übergänge, Steigwege.
  const einstellung = useGrundrisseinstellung();
  const wandUnterZeiger = (welt: Punkt, massstab: number): Wandtreffer => {
    // Liegen an einer Ecke Wände mehrerer Räume im Fangradius, entscheidet der Raum, in dem der Zeiger
    // wirklich liegt (Befund der Browserabnahme 6b.5) - auf der Linie selbst bleibt es mehrdeutig.
    const zeigerRaum = darstellung.find((r) => r.walls.length >= 3 && punktImPolygon(welt, r.walls.map((w) => ({ x: w.x1_mm, y: w.y1_mm }))))?.id ?? null;
    const t = raumwandUnterZeiger(topologie, welt, 10 / massstab, darstellung, zeigerRaum);
    if (t === null) return null;
    return t.ok ? { ok: true, raumId: t.treffer.raumId, wandId: t.treffer.wandId } : { ok: false, grund: t.grund };
  };
  // Escape, Dialog, Speichern, Verwerfen, nächste Leitung: Die Rückmeldung zum vorigen Zustand entfällt;
  // die Zeichenleiste zeigt dann die Anweisung zum aktuellen Schritt.
  useEffect(() => setLeitungsMeldung(null), [planung.ablaufSchluessel]);

  const gl = useGrundrissleitungen({
    k: buildingId !== undefined ? leitungskontext : undefined,
    einstellung,
    floorId,
    wandUnterZeiger,
    fangAktiv,
    rasterMm,
    onStatus: (text: string | null) => (planung.ablauf !== null ? setLeitungsMeldung(text) : setHinweis(text)),
    raumBearbeitung: zustand.entwurf !== null,
  });

  /** Aus dem Grundriss zurück in den offenen Leitungsentwurf: an seinen letzten Punkt. */
  const leitungFortsetzen = () => {
    const w = planung.entwurf?.werte;
    if (w === undefined) return;
    for (const wp of [...w.wegpunkte].reverse()) {
      if (wp.art === "wand") {
        const raum = darstellung.find((r) => r.walls.some((x) => x.id === wp.wandId));
        if (raum !== undefined) return arbeitsflaecheWechseln({ art: "wand", raumId: raum.id, wandId: wp.wandId });
      }
      if (wp.art === "ceiling" && darstellung.some((r) => r.id === wp.raumId)) return arbeitsflaecheWechseln({ art: "decke", raumId: wp.raumId });
    }
    const start = planung.geraete.find((g) => g.id === w.startId && g.floorId === floorId);
    if (start === undefined) {
      setHinweis("Der Entwurf hat auf diesem Geschoss noch keinen Punkt – bitte eine Wand oder Decke öffnen.");
      return;
    }
    const g = geraeteVon(start.raumId).find((x) => x.id === start.id);
    if (g?.mounting_surface === "ceiling") arbeitsflaecheWechseln({ art: "decke", raumId: start.raumId });
    else if (g?.wall_id != null) arbeitsflaecheWechseln({ art: "wand", raumId: start.raumId, wandId: g.wall_id });
  };

  // --------------------------------------------------------------- Leitung hinzufügen (L1)

  /**
   * „Leitung hinzufügen“ oben in der Werkzeugleiste (6c, L2): startet sofort den Zeichenablauf –
   * Schritt 1 Startgerät anklicken. Mit offenem Leitungsentwurf geht es dort weiter.
   */
  const leitungHinzufuegenMoeglich = buildingId !== undefined && planung.darfLeitungen;
  const leitungHinzufuegen = () => {
    einstellung?.setWerkzeug("aus");
    // Die Anweisung zum Schritt steht in der Zeichenleiste; hier nur, warum es gerade nicht geht.
    const grund = leitungZeichnen();
    if (grund !== null) setHinweis(grund);
  };

  // --------------------------------------------------------------- Tastatur

  const taste = (event: KeyboardEvent) => {
    if (document.querySelector("dialog[open]") !== null) return;
    // Eine offene Wand- oder Deckenfläche führt ihre eigenen Tasten (L1: an Ort und Stelle statt Dialog).
    if (wandansicht !== null || deckenansicht !== null) return;
    const strg = event.ctrlKey || event.metaKey;
    const k = event.key.toLowerCase();
    // Strg+S speichert auch aus einem Feld der Eigenschaften heraus - kein
    // Textfeld braucht das Kürzel, und der Browser würde sonst die Seite
    // speichern wollen.
    if (strg && k === "s") {
      event.preventDefault();
      if (leitungAktiv) void planung.speichern();
      else if (zuordnungAktiv) void zuordnung.speichern();
      else void speichern();
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
    // Wand- und Deckenansicht führen eigene Tasten; im Grundriss zuerst die Leitungsebene.
    if (wandansicht === null && deckenansicht === null && gl.taste(event)) return;
    if (strg && k === "z" && !event.shiftKey) {
      event.preventDefault();
      if (leitungAktiv) planung.dispatch({ typ: "rueckgaengig" });
      else if (zustand.zeichnung.length > 0) dispatch({ typ: "zeichnung", punkte: letztenPunktEntfernen(zustand.zeichnung) });
      else dispatch({ typ: "rueckgaengig" });
      return;
    }
    if (strg && (k === "y" || (k === "z" && event.shiftKey))) {
      event.preventDefault();
      if (leitungAktiv) planung.dispatch({ typ: "wiederholen" });
      else dispatch({ typ: "wiederholen" });
      return;
    }
    if (strg || event.altKey) return;
    switch (event.key) {
      case "Escape":
        if (zustand.ziehenAb !== null) dispatch({ typ: "ziehen-abbrechen" });
        else if (zustand.zeichnung.length > 0) dispatch({ typ: "zeichnung", punkte: [] });
        // Eine Wand, Ecke, Öffnung oder ein Gerät abwählen; die Raumauswahl eines offenen
        // Entwurfs bleibt ohnehin bestehen.
        else if (zustand.auswahl !== null && zustand.auswahl.art !== "raum") waehlen(null);
        // Zuletzt: überlagerndes Eigenschaftenpanel, dann die Maximierung (Phase 6c.0) -
        // erst danach wie bisher die Raumauswahl.
        else if (!af.escape()) waehlen(null);
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
    if (k === "g") {
      katalogOeffnen();
      return;
    }
    const arten: Record<string, Wandwahl> = { t: "door", n: "window", d: "passage" };
    const w = werkzeuge[k];
    const art = schreibbar ? arten[k] : undefined;
    if (art !== undefined) {
      setWandwahl(art);
      werkzeugWaehlen("oeffnung");
    } else if (w !== undefined) werkzeugWaehlen(w);
    else if (k === "f") einpassenAlle();
    else if (k === "l" && leitungHinzufuegenMoeglich) leitungHinzufuegen();
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

  // Feste Rückrufe für die gemerkte Werkzeugleiste: Sie zeichnet nur bei sichtbaren
  // Änderungen neu, nicht bei jeder Zeigerbewegung (L1).
  const stabilWerkzeug = useStabil(werkzeugWaehlen);
  const stabilRueckgaengig = useStabil(() => (leitungAktiv ? planung.dispatch({ typ: "rueckgaengig" }) : dispatch({ typ: "rueckgaengig" })));
  const stabilWiederholen = useStabil(() => (leitungAktiv ? planung.dispatch({ typ: "wiederholen" }) : dispatch({ typ: "wiederholen" })));
  const stabilZoom = useStabil(zoom);
  const stabilEinpassen = useStabil(einpassenAlle);
  const stabilHilfe = useStabil(() => setHilfe(true));
  const stabilLeitung = useStabil(leitungHinzufuegen);
  const stabilKatalog = useStabil(katalogOeffnen);

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

  // Nur ein Leitungsfeld zugleich: Offene Wand- oder Deckenansichten führen ihr eigenes.
  // Die Werkzeuge des Zeichnens (Ebene, Höhe, Steigwegwahl) stehen in der Kontextleiste,
  // Liste und Angaben im Eigenschaftenpanel (Phase 6c.0).
  const eigeneLeitungsflaeche = wandansicht === null && deckenansicht === null;
  // Rückwege aus Mengenübersicht und 3D - beim Zeichnen in der Zeichenleiste, sonst im Entwurfsblock.
  const leitungsRueckwege = (
    <>
      {onZurueckZuMengen !== undefined && (
        <button type="button" className={knopf("neutral", { klein: true })} onClick={onZurueckZuMengen}>
          Zurück zur Mengenübersicht
        </button>
      )}
      {rueckkehr3dAnbieten && onZurueck3d !== undefined && (
        <button type="button" className={knopf("neutral", { klein: true })} onClick={onZurueck3d}>
          Zurück zur 3D-Ansicht
        </button>
      )}
    </>
  );
  const leitungswerkzeuge = !eigeneLeitungsflaeche ? null : (
    <div className="flex flex-col gap-2" data-testid="grundriss-leitungswerkzeuge">
      {buildingId !== undefined && (
        <Zeichenleiste
          k={leitungskontext}
          flaeche={{ art: "grundriss", floorId }}
          meldung={leitungsMeldung}
          meldungTestId="grundriss-leitungsmeldung"
          zusatz={
            <>
              {gl.uebergaenge.map((u) => (
                <button key={u.art} type="button" className={knopf("neutral", { klein: true })} onClick={() => gl.flaechenwechsel(u.art)} data-testid={`uebergang-${u.art}`}>
                  {u.text}
                </button>
              ))}
              {einstellung !== null && <GrundrissLeitungsleiste k={leitungskontext} einstellung={einstellung} />}
            </>
          }
          nebenaktionen={leitungsRueckwege}
          hilfe={<GrundrissLeitungshilfe k={leitungskontext} floorId={floorId} />}
        />
      )}
      {/* Ohne laufendes Zeichnen (Werkzeug beendet, Entwurf offen) bleibt nur die Durchführung. */}
      {einstellung !== null && planung.ablauf === null && <GrundrissLeitungsleiste k={leitungskontext} einstellung={einstellung} />}
      {gl.steigwahl !== null && (
        <Steigwegwahl
          key={`${gl.steigwahl.steigwegId}|${gl.steigwahl.haltId}|${gl.steigwahl.index}`}
          k={leitungskontext}
          wahl={gl.steigwahl}
          onSchliessen={() => gl.setSteigwahl(null)}
          onGeschossWechseln={onGeschossWechseln}
        />
      )}
    </div>
  );
  const leitungsfeld = !eigeneLeitungsflaeche ? null : (
    <div className="flex flex-col gap-2" data-testid="grundriss-leitungen">
      <Leitungsbereich
        k={leitungskontext}
        flaeche={{ art: "grundriss", floorId }}
        relevant={gl.relevant}
        gewaehlt={gl.gewaehlt}
        onWaehlen={gl.setGewaehlt}
        onWerkzeug={(w) => einstellung?.setWerkzeug(w === "leitung" ? "leitung" : "aus")}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-2.5">
      {/* Während eine Wand- oder Deckenfläche offen ist, ist der Grundriss ausgehängt (L1): keine
          versteckte Zeichenfläche, keine doppelten Tasten. Viewport und Größe hält der Editor. */}
      {wandansicht === null && deckenansicht === null && (
      <Planungsarbeitsflaeche
        zustand={af}
        name="Grundriss-Arbeitsfläche"
        markierung={leitungAktiv ? "Leitung" : zuordnungAktiv ? "Zuordnung" : null}
        kopf={
          <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1">
            {/* Schmal steht das Geschoss schon in der Ansichtszeile darüber – die Überschrift bleibt für Screenreader. */}
            <h2 className={kompakt ? "sr-only" : "m-0 text-small font-semibold"}>
              Grundriss <span className="font-normal text-muted">· {geschossLabel}</span>
            </h2>
            <span className={`text-small font-semibold ${STATUS_FARBE[status]}`} role="status" aria-live="polite">
              {leitungAktiv || zuordnungAktiv
                ? "Raumbearbeitung ruht"
                : !schreibbar
                ? "Nur Ansicht"
                : aktiverName === undefined
                  ? "Kein Raum in Bearbeitung"
                  : `${aktiverName}: ${STATUS_TEXT[status]}`}
            </span>
            {/* Immer vorhanden, nur deaktiviert: Die Leiste behält ihre Höhe, und
                die Zeichenfläche springt beim Aktivieren eines Raums nicht. */}
            {schreibbar && (
              <span className="ml-auto flex flex-wrap gap-2">
                <button
                  type="button"
                  className={knopf("primaer", { klein: true })}
                  disabled={!offen || status === "speichert"}
                  onClick={() => void speichern()}
                  title="Speichern (Strg+S)"
                >
                  Speichern
                </button>
                <button
                  type="button"
                  className={knopf("neutral", { klein: true })}
                  disabled={!offen || status === "speichert"}
                  onClick={() => void verwerfen()}
                  aria-label={kompakt ? "Änderungen verwerfen" : undefined}
                >
                  {kompakt ? "Verwerfen" : "Änderungen verwerfen"}
                </button>
              </span>
            )}
          </div>

        }
        werkzeuge={
          <Werkzeugleiste
            werkzeug={zustand.werkzeug}
            onWerkzeug={stabilWerkzeug}
            wandwahl={wandwahl}
            onWandwahl={setWandwahl}
            rasterMm={rasterMm}
            onRaster={setRasterMm}
            fangAktiv={fangAktiv}
            onFang={setFangAktiv}
            kannRueckgaengig={leitungAktiv ? (planung.entwurf?.zurueck.length ?? 0) > 0 : zustand.zurueck.length > 0}
            kannWiederholen={leitungAktiv ? (planung.entwurf?.vor.length ?? 0) > 0 : zustand.vor.length > 0}
            onRueckgaengig={stabilRueckgaengig}
            onWiederholen={stabilWiederholen}
            rueckgaengigBezug={leitungAktiv ? "im Leitungsentwurf" : undefined}
            onZoom={stabilZoom}
            onEinpassen={stabilEinpassen}
            onHilfe={stabilHilfe}
            leitungVorhanden={leitungHinzufuegenMoeglich}
            leitungAktiv={planung.ablauf !== null}
            onLeitungHinzufuegen={stabilLeitung}
            darfSchreiben={schreibbar}
            onGeraet={stabilKatalog}
            geraetAktiv={geraetewahlAktiv || katalogOffen}
          />

        }
        kontext={
          <div className="flex flex-col gap-2">
            {/* Rückmeldungen des Servers stehen unter der Zeichenfläche an der Aktion:
                Die Fläche bleibt an ihrem Platz, und das eingeklappte Panel verdeckt nichts. */}
            <Raumrueckmeldung
              fehler={zustand.serverFehler}
              konflikt={status === "konflikt"}
              onSchliessen={() => dispatch({ typ: "hinweis-schliessen" })}
              onServerstand={() => void serverstandBestaetigen()}
            />
            {((leitungAktiv && planung.ablauf === null) || zuordnungAktiv) && (
              <div className={`${meldungsflaeche("schlicht")} flex flex-wrap items-center justify-between gap-2`} role="status" data-testid="entwurf-offen">
                <span>
                  {leitungAktiv
                    ? `Leitungsentwurf offen${planung.ungespeichert ? " – ungespeichert" : " – keine ungespeicherten Änderungen"}`
                    : `Gerätezuordnung offen${zuordnung.offen ? " – ungespeichert" : ""}`}
                </span>
                <span className="flex flex-wrap gap-2">
                  {zuordnungAktiv && !af.eigenschaftenOffen && (
                    <button type="button" className={knopf("neutral", { klein: true })} onClick={() => af.setEigenschaftenOffen(true)} {...kurz("Zugeordnete Geräte", "Geräte")} />
                  )}
                  {leitungAktiv && leitungsRueckwege}
                  {leitungAktiv && planung.ablauf === null && (
                    <>
                      {planung.entwurf?.werte.startId != null && (
                        <button type="button" className={knopf("neutral", { klein: true })} onClick={() => planung.abschliessen()} {...kurz("Angaben …", "Angaben")} />
                      )}
                      <button
                        type="button"
                        className={knopf("neutral", { klein: true })}
                        onClick={() => {
                          planung.leitungZeichnen();
                          leitungFortsetzen();
                        }}
                        {...kurz("Weiterzeichnen", "Weiter")}
                      />
                      <button
                        type="button"
                        className={knopf("primaer", { klein: true })}
                        disabled={!planung.ungespeichert}
                        onClick={() => void planung.speichern()}
                        {...kurz("Leitung speichern", "Speichern")}
                      />
                      <button type="button" className={knopf("neutral", { klein: true })} onClick={() => void leitungSchliessen()} {...kurz("Entwurf schließen", "Schließen")} />
                    </>
                  )}
                  {zuordnungAktiv && (
                    <>
                      <button
                        type="button"
                        className={knopf("primaer", { klein: true })}
                        disabled={!zuordnung.offen}
                        onClick={() => void zuordnung.speichern()}
                        {...kurz("Zuordnung speichern", "Speichern")}
                      />
                      <button type="button" className={knopf("neutral", { klein: true })} onClick={() => void zuordnungSchliessen()} {...kurz("Zuordnung schließen", "Schließen")} />
                    </>
                  )}
                </span>
                {buildingId !== undefined && !af.eigenschaftenOffen && (
                  <Entwurfsfehler k={leitungskontext} onDetails={() => af.setEigenschaftenOffen(true)} />
                )}
              </div>
            )}
            {geraetewahlAktiv && geraetewahlTyp !== undefined && (
              <div className={`${meldungsflaeche("erfolg")} flex flex-wrap items-center justify-between gap-2`} role="status" data-testid="geraet-wandwahl">
                <span className="inline-flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={`${knopf("neutral", { klein: true })} inline-flex items-center gap-1.5`}
                    aria-label={`Gerät: ${geraetewahlTyp.label} – anderen Typ wählen`}
                    onClick={katalogOeffnen}
                    data-testid="geraet-chip"
                  >
                    <Geraetesymbol typ={geraetewahlTyp} groesse={16} />
                    Gerät: {geraetewahlTyp.label}
                  </button>
                  <span>
                    {geraetWand && geraetDecke
                      ? "Wand anklicken für die Wandmontage oder in einen Raum klicken für die Decke."
                      : geraetWand
                        ? `Eine Wand anklicken – die Wandansicht${erlaubt(geraetewahlTyp, "wall_interior") ? "" : " (Außenseite)"} öffnet sich zum Setzen.`
                        : "In einen Raum klicken – die Deckenansicht öffnet sich zum Setzen."}
                  </span>
                </span>
                <button
                  type="button"
                  className={knopf("neutral", { klein: true })}
                  onClick={() => {
                    setGeraetewahl(null);
                    dispatch({ typ: "werkzeug", werkzeug: "auswahl" });
                  }}
                >
                  Abbrechen
                </button>
              </div>
            )}
            {platzierung !== null && (
              <div className={`${meldungsflaeche("erfolg")} flex flex-wrap items-center justify-between gap-2`} role="status" data-testid="verteilung-wandwahl">
                <span>
                  <strong>{platzierung.code} platzieren</strong> –{" "}
                  {platzierung.raumId === null ? "eine Wand anklicken" : `eine Wand von „${raumName(platzierung.raumId)}“ anklicken`}; gesetzt wird in
                  der Wandansicht.
                </span>
                <button type="button" className={knopf("neutral", { klein: true })} onClick={() => platzierungBeenden(null)}>
                  Abbrechen
                </button>
              </div>
            )}
            {buildingId !== undefined && leitungswerkzeuge}
          </div>
        }
        eigenschaften={
          <div className="flex flex-col gap-2">
            {buildingId !== undefined && leitungAktiv && leitungsfeld}
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
            {buildingId !== undefined && !leitungAktiv && leitungsfeld}
          </div>
        }
      >
        {/* Hinweise liegen über der Zeichenfläche statt darüber: Die Fläche
            darf nicht springen, während jemand zeichnet. */}
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
          anfangsGroesse={groesse.current}
          darfSchreiben={schreibbar}
          rasterMm={rasterMm}
          fangAktiv={fangAktiv}
          fehlerKeys={fehlerKeys}
          lokaleKeys={lokaleKeys}
          onWaehlen={waehlen}
          onPolygonFertig={polygonFertig}
          onRechteckFertig={rechteckFertig}
          onWandFuerOeffnung={(raumId, wandId) => {
            if (platzierung !== null) void platzierungswand(raumId, wandId);
            else if (wandwahl === "geraet" && geraetewahlTyp !== undefined) geraetAnWand(raumId, wandId);
            else void wandansichtOeffnen({ raumId, wandId, werkzeug: wandwahl });
          }}
          onFlaechenklick={geraetFlaechenklick}
          onOeffnungBearbeiten={(raumId, wandId, oeffnungId) => void wandansichtOeffnen({ raumId, wandId, oeffnungId })}
          onHinweis={setHinweis}
          oeffnungsart={wandwahl}
          geschossLabel={geschossLabel}
          topologie={topologie}
          einordnung={einordnung}
          raumName={raumName}
          geraete={geraeteDarstellung}
          onGeraetBearbeiten={geraetBearbeiten}
          zusatz={buildingId !== undefined ? gl.zusatz : undefined}
        />
      </Planungsarbeitsflaeche>
      )}

      <HilfeDialog offen={hilfe} titel="Grundriss – Bedienung und Tastenkürzel" onClose={() => setHilfe(false)}>
        <ul className="pl-[18px]">
          <li>Rechteckraum (R): erste Ecke klicken, gegenüberliegende Ecke klicken, Namen vergeben.</li>
          <li>Polygonraum (P): Punkte nacheinander klicken; Klick auf den Startpunkt, Doppelklick oder Enter schließt. Rücktaste oder Strg+Z entfernt den letzten Punkt, Escape bricht ab.</li>
          <li>Tür (T), Fenster (N), Durchgang (D), Gerät (G): Wand anklicken – ihre Wandfläche öffnet sich mit diesem Werkzeug, gesetzt wird dort. Der Klick im Grundriss legt noch keine Öffnung an. Bei einer gemeinsamen Wand zählt die Raumseite, auf die geklickt wurde. Eine vorhandene Öffnung mit dem Werkzeug anklicken oder doppelklicken: Sie wird in der Wandansicht bearbeitet. Im Auswahlwerkzeug lässt sie sich weiterhin entlang ihrer Wand ziehen.</li>
          <li>Eine Öffnung auf einer gemeinsamen Wand wird nur einmal gespeichert und gilt für beide Räume; im Nachbarraum erscheint sie gestrichelt als abgeleitete Darstellung.</li>
          <li>Geräte (Steckdosen, Schalter, Leuchten, Netzwerkdosen) werden in der Wandansicht (innen oder außen) bzw. in der Deckenansicht gesetzt und verschoben. Im Grundriss erscheinen sie als Symbol auf ihrer Montageseite; Klick wählt, Doppelklick öffnet die passende Ansicht.</li>
          <li>Eckpunkt ziehen verschiebt beide angrenzenden Wände. Alt beim Ziehen setzt den Fang aus.</li>
          <li>Mausrad zoomt um den Zeiger, mittlere Maustaste oder H verschiebt die Ansicht, F setzt die Ansicht zurück (ganzer Grundriss).</li>
          <li>Strg+Z / Strg+Y (oder Strg+Umschalt+Z): Rückgängig / Wiederholen · Strg+S: Speichern · Entf: Auswahl entfernen.</li>
          <li>E: Eigenschaften ein- und ausklappen · M: Zeichenfläche maximieren bzw. zurück zur normalen Ansicht. Escape schließt zuletzt ein überlagerndes Eigenschaftenpanel und beendet dann die Maximierung. Zoom, Ausschnitt, Auswahl und Entwürfe bleiben dabei erhalten.</li>
          <li>Änderungen bleiben lokal, bis „Speichern“ gedrückt wird. Die Ansicht „Tabellen &amp; Details“ bietet dieselben Daten als Formular.</li>
          <li>„Leitung hinzufügen“ (L): Startgerät anklicken, Verlauf zeichnen, Zielgerät anklicken – die Zeichenleiste unter der Fläche nennt den Schritt; ihre Hilfe (?) erklärt die Bedienung.</li>
        </ul>
        <li className="list-none">Werkzeugleiste: Auswahl · Raum · Öffnung · Gerät · Leitung · Rückgängig/Wiederholen · Zoom · „Ansicht“ (Fang, Raster, diese Hilfe).</li>
        <GrundrissLegende />
      </HilfeDialog>

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
          leitungen={buildingId !== undefined && platzierung === null ? leitungskontext : undefined}
          arbeitsflaeche={af}
          ansichten={flaechenansichten}
          geschossLabel={geschossLabel}
          platzierung={
            platzierung === null
              ? undefined
              : {
                  code: platzierung.code,
                  geraetId: platzierung.geraetId,
                  speichern: (lage) => platzierungSpeichernAktion(wandansicht.raumId, wandansicht.wandId, lage),
                  neuLaden: platzierungNeuLaden,
                  andereWand: () => setWandansicht(null),
                  abbrechen: () => platzierungBeenden(null),
                }
          }
          verteilungsangebot={platzierung === null ? verteilungsangebot : undefined}
          typAnlegen={darfTypen}
        />
      )}
      {deckenansicht !== null && (
        <Deckenansicht
          key={`${deckenansicht.raumId}|${deckenansicht.geraetetyp ?? ""}`}
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
          leitungen={buildingId !== undefined ? leitungskontext : undefined}
          arbeitsflaeche={af}
          ansichten={flaechenansichten}
          geschossLabel={geschossLabel}
          zurueckZu3d={herkunft.current === "3d"}
          startTyp={deckenansicht.geraetetyp ?? null}
          verteilungsangebot={verteilungsangebot}
          typAnlegen={darfTypen}
        />
      )}
      {katalogOffen && (
        <Geraetekatalog
          typen={typen}
          modus={{ art: "platzieren", flaeche: null, start: geraetewahl }}
          onWahl={geraetUebernehmen}
          onClose={() => setKatalogOffen(false)}
          verteilung={platzierung === null ? verteilungsangebot : undefined}
          typAnlegen={darfTypen}
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
