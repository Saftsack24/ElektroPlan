import { ApiError } from "@elektroplan/api-client";
import type { components } from "@elektroplan/api-client";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useReducer, useState } from "react";

import { useAuth } from "../../../core/auth/AuthProvider";
import { katalogAbfrage, typenNachSchluessel } from "../geraete/katalog";
import { planAbfrage } from "../plan";
import { steigwegSchluessel } from "../steigweg/Steigwege";
import type { Planergeraet, Stromkreis, Verteilung } from "../stromkreise/daten";
import {
  geraeteDesGebaeudes,
  querschnittAlsEingabe,
  querschnittLesen,
  stromkreiseAbfrage,
  stromkreiseSchluessel,
  verteilungenAbfrage,
} from "../stromkreise/daten";
import { mengenSchluessel } from "../mengen/daten";
import { BestaetigungAbgelehnt, bestaetigungsfeld, useLeitungsbestaetigung } from "./bestaetigung";
import type { DurchfuehrungAusServer, LeitungAusServer } from "./daten";
import {
  durchfuehrungenAbfrage,
  durchfuehrungenSchluessel,
  leitungAusServer,
  leitungenAbfrage,
  leitungenSchluessel,
  leitungsplanAus,
  liste,
  wegpunktAlsAnfrage,
} from "./daten";
import type { Leitungsaktion, Leitungsentwurf, Leitungsfehler, Leitungswerte, Wertequelle } from "./entwurf";
import type { NeueDurchfuehrung } from "./durchfuehrung";
import {
  BESTAND_QUELLEN,
  NEUE_QUELLEN,
  entwurfAus,
  leiterzahlLesen,
  leitungUngespeichert,
  leitungsReducer,
  ungenutzteDurchfuehrungenEntfernen,
} from "./entwurf";
import type { Kandidatenpruefung } from "./flaechen";
import { kandidatPruefen } from "./flaechen";
import type { Wandhoehe } from "./grundriss";
import { geraetEignung } from "./stromkreisableitung";
import type { Leitung, Leitungsergebnis, Leitungsplan, VorbereiteterPlan } from "./laenge";
import { leitungAuswerten, planVorbereiten } from "./laenge";

type Schemas = components["schemas"];
type Geschossplan = Schemas["FloorPlanOut"];
type RiserOut = Schemas["RiserOut"];
type FloorOut = Schemas["FloorOut"];

// Feste Funktionen: `combine` läuft nur neu, wenn sich ein Abfrageergebnis ändert -
// das Ergebnis bleibt sonst dasselbe Objekt, und die Längenvorbereitung läuft nicht bei jedem Rendern.
function plaeneSammeln(ergebnisse: readonly { data?: Geschossplan | undefined }[]) {
  return {
    plaene: ergebnisse.map((r) => r.data),
    fertig: ergebnisse.every((r) => r.data !== undefined),
  };
}

function durchfuehrungenSammeln(ergebnisse: readonly { data?: unknown }[]) {
  return ergebnisse.flatMap((r) => liste<DurchfuehrungAusServer>(r.data, "penetrations"));
}

/**
 * Leitungsplanung eines Gebäudes für Wand- und Deckenansicht (Phase 6b.4).
 *
 * Hält höchstens **einen** Leitungsentwurf. Er gehört zum Planungskontext
 * (Geschoss im 2D-Editor); ein Wechsel zwischen Wand- und Deckenansichten
 * ändert ihn nicht, speichert nicht und verwirft nicht.
 *
 * * Vorschau, Länge und Befunde rechnen mit der gemeinsamen Längenfunktion
 *   über denselben gespeicherten Planungsstand wie der Server.
 * * Gespeichert wird nur ausdrücklich: `POST /circuits/{id}/cables` bzw.
 *   `PUT /cables/{id}` mit `If-Match`. Ein Versionskonflikt überschreibt nie;
 *   der Entwurf bleibt, bis bewusst verworfen und neu geladen wird.
 * * Der Server prüft Rechte, Schreibschutz, Versionen und den Weg selbst.
 */

/** Schritt des Zeichenablaufs (Entwurf §18.3): 1 Startgerät, 2 Verlauf und Ziel. */
export type Ablaufschritt = "start" | "verlauf";

/**
 * Zeichenablauf „Leitung hinzufügen“ (Phase 6c, L2) - gehört wie der Entwurf zum Gebäude und übersteht
 * Flächen- und Geschosswechsel. Reine Bedienung, nie Teil des Entwurfs oder seiner Historie.
 */
export interface Zeichenablauf {
  readonly schritt: Ablaufschritt;
  /** L-Führung: zuerst waagerecht (Standard) oder zuerst senkrecht - gilt bis zum nächsten Punkt. */
  readonly ecke: "waagerecht" | "senkrecht";
  /** Fußboden und Decke: rechtwinklig (Standard, F6) oder gerade. An der Wand immer rechtwinklig. */
  readonly fuehrung: "rechtwinklig" | "gerade";
  /** Grundriss: ein Klick im Raum setzt einen Fußboden- oder Deckenpunkt. */
  readonly raumpunkt: "fussboden" | "decke";
  /** Ausdrückliches Einfügen: der nächste Punkt folgt diesem Wegpunkt - sonst kommt er ans Ende. */
  readonly einfuegenNach: number | null;
  /**
   * Grundriss: Höhe neuer Wandpunkte - „folgen“ übernimmt sie vom Vorgänger (Wandpunkt, Fußboden 0,
   * Decke, Gerätemitte); sonst ausdrücklich gewählt. Genau wird in der Wandfläche gearbeitet.
   */
  readonly wandhoehe: "folgen" | Wandhoehe;
}

export const NEUER_ABLAUF: Zeichenablauf = { schritt: "start", ecke: "waagerecht", fuehrung: "rechtwinklig", raumpunkt: "fussboden", einfuegenNach: null, wandhoehe: "folgen" };

export type Geraetepruefung = { readonly ok: true } | { readonly ok: false; readonly grund: string };

export interface Leitungsplanung {
  readonly projektId: string;
  readonly geladen: boolean;
  readonly ladefehler: boolean;
  readonly leitungen: readonly LeitungAusServer[];
  readonly kreise: readonly Stromkreis[];
  readonly verteilungen: readonly Verteilung[];
  readonly geraete: readonly Planergeraet[];
  readonly durchfuehrungen: readonly DurchfuehrungAusServer[];
  /** Geschosse und Steigwege des Gebäudes (6b.5) - für gebäudeweite Entwürfe. */
  readonly geschosse: readonly FloorOut[];
  readonly steigwege: readonly RiserOut[];
  readonly vorbereitet: VorbereiteterPlan | null;
  /** Wie `vorbereitet`, zusätzlich mit den neuen Durchführungen des Entwurfs - für Vorschau und Kandidaten. */
  readonly vorbereitetEntwurf: VorbereiteterPlan | null;
  /** Ergebnisse der gespeicherten Leitungen mit derselben Funktion - zum Zeichnen der Läufe. */
  readonly ergebnisse: ReadonlyMap<string, Leitungsergebnis>;
  readonly entwurf: Leitungsentwurf | null;
  readonly ungespeichert: boolean;
  readonly ergebnis: Leitungsergebnis | null;
  /** Leitung des Entwurfs als Eingabe der Längenfunktion - für Kandidaten. */
  readonly entwurfsleitung: Leitung | null;
  readonly dispatch: (a: Leitungsaktion) => void;
  readonly darfLeitungen: boolean;
  readonly darfStromkreise: boolean;
  readonly hinweis: string | null;
  setHinweis(text: string | null): void;
  kreisVon(id: string): Stromkreis | undefined;
  kreisName(kreis: Pick<Stromkreis, "designation" | "name" | "board_id">): string;
  geraetName(id: string | null): string;
  /** „Küche (EG)“ - Raum mit Geschoss, eindeutig im ganzen Gebäude. */
  raumMitGeschoss(raumId: string): string;
  geschossName(floorId: string): string;
  /**
   * Prüft geänderte Werte des Entwurfs an Wegpunkt `index` - mit genau den neuen
   * Durchführungen dieser Werte. `null`, solange der Plan nicht geladen ist.
   */
  pruefen(werte: Leitungswerte, index: number | readonly number[]): Kandidatenpruefung | null;
  /** Lagegerät der Verteilung und zugeordnete Geräte des Stromkreises. */
  endpunkte(circuitId: string): Planergeraet[];
  /** Hat diese gespeicherte Leitung Wegpunkte, die nicht gelesen werden können? */
  unlesbar(cable: LeitungAusServer): boolean;
  /** Zeichenablauf - `null`: kein Leitungswerkzeug aktiv. */
  readonly ablauf: Zeichenablauf | null;
  /** Abschluss- bzw. Angabendialog offen. */
  readonly dialogOffen: boolean;
  /**
   * Kennzeichen des sichtbaren Ablaufzustands (Entwurf neu/bestehend/keiner, Schritt, Dialog). Ändert es
   * sich, sind Rückmeldungen der Flächen zum vorigen Zustand veraltet und werden verworfen (6c L2/L3).
   */
  readonly ablaufSchluessel: string;
  setAblauf(aenderung: Partial<Omit<Zeichenablauf, "schritt">>): void;
  /** „Leitung hinzufügen“: neuer Entwurf ohne Stromkreis, Schritt 1 - oder weiter am offenen Entwurf. */
  leitungZeichnen(): void;
  /** Kann dieses Gerät Start oder Ziel sein? Mit verständlichem Grund. */
  geraetPruefen(id: string): Geraetepruefung;
  /** Klick auf ein Gerät im Zeichenablauf - liefert den Text für die Statuszeile. */
  geraetGewaehlt(id: string): string;
  /** Doppelklick, Enter oder „Abschließen …“: Zeichnen endet, der Dialog öffnet. `null` = geöffnet ohne Hinweis. */
  abschliessen(): string | null;
  /** Dialog → zurück zu 2: Verlauf und Eingaben bleiben, das Ziel einer neuen Leitung wird gelöst. */
  weiterzeichnen(): void;
  /** Dialog schließen, ohne zu zeichnen (Angaben einer bestehenden Leitung). */
  dialogSchliessen(): void;
  /** Werkzeug beenden; ein leerer neuer Entwurf entfällt, sonst bleibt er. */
  ablaufBeenden(): void;
  /** Bestehende Leitung: Verlauf in der Fläche bearbeiten. */
  verlaufBearbeiten(cable: LeitungAusServer): void;
  /** Bestehende Leitung: Angaben im Dialog bearbeiten. */
  angabenBearbeiten(cable: LeitungAusServer): void;
  bearbeiten(cable: LeitungAusServer): boolean;
  schliessen(): void;
  speichern(): Promise<boolean>;
  verwerfenUndNeuLaden(): Promise<void>;
  loeschen(cable: LeitungAusServer): Promise<string | null>;
  vorschlagUebernehmen(cable: LeitungAusServer): Promise<string | null>;
  durchfuehrungAendern(d: DurchfuehrungAusServer, werte: { offset_mm: number; height_mm: number }): Promise<string | null>;
  durchfuehrungEntfernen(d: DurchfuehrungAusServer): Promise<string | null>;
}

function werteAusServer(c: LeitungAusServer, wegpunkte: Leitungswerte["wegpunkte"]): Leitungswerte {
  return {
    circuitId: c.circuit_id,
    label: c.label ?? "",
    startId: c.start_device_id,
    endId: c.end_device_id,
    kabeltyp: c.cable_type ?? "",
    leiterzahl: c.conductor_count === null ? "" : String(c.conductor_count),
    querschnitt: querschnittAlsEingabe(c.cross_section_mm2),
    startzugabeMm: c.start_allowance_mm,
    endzugabeMm: c.end_allowance_mm,
    reserveMm: c.reserve_mm,
    reserveProzent: c.reserve_mode === "percent" ? c.reserve_percent : null,
    wegpunkte,
    neueDurchfuehrungen: [],
    // Bloßes Öffnen und unverändertes Speichern ändert nichts - auch nicht die Herkunft.
    quellen: BESTAND_QUELLEN,
    zuordnen: [],
  };
}

/** Leerer Entwurf einer neuen Leitung - Stromkreis und Angaben folgen im Abschlussdialog. */
export function neueLeitungswerte(): Leitungswerte {
  return {
    circuitId: "",
    label: "",
    startId: null,
    endId: null,
    kabeltyp: "",
    leiterzahl: "",
    querschnitt: "",
    startzugabeMm: 0,
    endzugabeMm: 0,
    reserveMm: 0,
    reserveProzent: null,
    wegpunkte: [],
    neueDurchfuehrungen: [],
    quellen: NEUE_QUELLEN,
    zuordnen: [],
  };
}

const QUELLE_API: Record<Wertequelle, "defaults" | "manual" | null> = { vorgabe: "defaults", manuell: "manual", bestand: null };

/** Eingabe der Längenfunktion aus dem Entwurf - Kabelangaben nur für „vollständig angegeben“. */
export function leitungAusWerten(id: string, w: Leitungswerte): Leitung {
  const zahl = leiterzahlLesen(w.leiterzahl);
  const querschnitt = querschnittLesen(w.querschnitt);
  return {
    id,
    startGeraetId: w.startId,
    endGeraetId: w.endId,
    wegpunkte: w.wegpunkte,
    startzugabeMm: w.startzugabeMm,
    endzugabeMm: w.endzugabeMm,
    reserveMm: w.reserveMm,
    reserveProzent: w.reserveProzent,
    kabeltyp: w.kabeltyp.trim() === "" ? null : w.kabeltyp.trim(),
    leiterzahl: zahl.ok ? zahl.wert : null,
    querschnittMm2: querschnitt.ok ? querschnitt.wert : null,
  };
}

const KEINE_NEUEN: readonly NeueDurchfuehrung[] = [];

/** Gespeicherter Plan plus neue Durchführungen eines Entwurfs - nur im Browser. */
function planMitNeuen(plan: Leitungsplan, neue: readonly NeueDurchfuehrung[]): VorbereiteterPlan {
  return planVorbereiten({
    ...plan,
    durchfuehrungen: [...plan.durchfuehrungen, ...neue.map((d) => ({ id: d.schluessel, kopplungId: d.kopplungId, abstandMm: d.abstandMm, hoeheMm: d.hoeheMm }))],
  });
}

const VERSION_KONFLIKT =
  "Diese Leitung wurde zwischenzeitlich an anderer Stelle geändert. Ihr Entwurf wurde nicht gespeichert und ist hier weiterhin vorhanden.";

function fehlerAus(error: unknown, rueckfall: string): { status: "konflikt" | "fehler"; fehler: Leitungsfehler } {
  if (!(error instanceof ApiError)) {
    return { status: "fehler", fehler: { meldung: "Der Server ist nicht erreichbar. Ihr Entwurf ist unverändert erhalten.", eintraege: [] } };
  }
  if (error.status === 409 && error.errorType === "version-conflict") {
    return { status: "konflikt", fehler: { meldung: VERSION_KONFLIKT, eintraege: [] } };
  }
  if (error.status === 409 && (error.errorType === "project-archived" || error.errorType === "project-completed")) {
    return { status: "fehler", fehler: { meldung: "Das Projekt ist inzwischen schreibgeschützt. Es wurde nichts gespeichert.", eintraege: [] } };
  }
  const eintraege = (error.problem?.errors ?? []).map((e) => ({ code: e.code, meldung: e.message, feld: e.field }));
  return { status: "fehler", fehler: { meldung: error.userMessage === "" ? rueckfall : error.userMessage, eintraege } };
}

function meldung(error: unknown, rueckfall: string): string {
  if (!(error instanceof ApiError)) return rueckfall;
  if (error.errorType === "version-conflict") {
    return "Die Daten wurden inzwischen an anderer Stelle geändert. Es wurde nichts überschrieben – die Ansicht wurde neu geladen.";
  }
  const eintraege = (error.problem?.errors ?? []).map((e) => e.message);
  return [error.userMessage, ...eintraege].filter((t) => t !== "").join(" ");
}

export function useLeitungsplanung({
  projectId = "",
  buildingId,
  darfLeitungen,
  darfStromkreise,
  onGeschrieben,
}: {
  /** Projekt - für die wirksamen Planungsvorgaben (Phase 6c). */
  projectId?: string | undefined;
  buildingId: string | undefined;
  /** `electrical.route.write` und Projekt nicht schreibgeschützt. */
  darfLeitungen: boolean;
  /** `electrical.circuit.write` und Projekt nicht schreibgeschützt (Vorschlag übernehmen). */
  darfStromkreise: boolean;
  onGeschrieben?: (() => Promise<void>) | undefined;
}): Leitungsplanung {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const mitBestaetigung = useLeitungsbestaetigung();
  const haus = buildingId ?? "";
  const aktiv = buildingId !== undefined;
  const [entwurf, dispatch] = useReducer(leitungsReducer, null);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [ablauf, setAblaufState] = useState<Zeichenablauf | null>(null);
  const [dialogOffen, setDialogOffen] = useState(false);

  const geschosse = useQuery({
    queryKey: ["floors", haus],
    queryFn: () => api.get("/api/v1/buildings/{building_id}/floors", { path: { building_id: haus } }),
    enabled: aktiv,
  });
  const floorListe = useMemo(() => (Array.isArray(geschosse.data) ? geschosse.data : []), [geschosse.data]);
  const plaene = useQueries({ queries: floorListe.map((g) => ({ ...planAbfrage(api, g.id), enabled: aktiv })), combine: plaeneSammeln });
  const durchfuehrungen = useQueries({
    queries: floorListe.map((g) => ({ ...durchfuehrungenAbfrage(api, g.id), enabled: aktiv })),
    combine: durchfuehrungenSammeln,
  });
  const steigwege = useQuery({
    queryKey: steigwegSchluessel(haus),
    queryFn: ({ signal }) => api.get("/api/v1/modules/electrical/buildings/{building_id}/risers", { path: { building_id: haus }, signal }),
    enabled: aktiv,
  });
  const leitungenQ = useQuery({ ...leitungenAbfrage(api, haus), enabled: aktiv });
  const kreiseQ = useQuery({ ...stromkreiseAbfrage(api, haus), enabled: aktiv });
  const verteilungenQ = useQuery({ ...verteilungenAbfrage(api, haus), enabled: aktiv });
  const katalog = useQuery(katalogAbfrage(api));

  const leitungen = useMemo(() => liste<LeitungAusServer>(leitungenQ.data, "cables"), [leitungenQ.data]);
  const kreise = useMemo(() => liste<Stromkreis>(kreiseQ.data, "circuits"), [kreiseQ.data]);
  const verteilungen = useMemo(() => liste<Verteilung>(verteilungenQ.data, "boards"), [verteilungenQ.data]);
  const typen = useMemo(() => typenNachSchluessel(Array.isArray(katalog.data) ? katalog.data : undefined), [katalog.data]);
  const plaeneGeladen = plaene.fertig;
  const planListe = useMemo(
    () => plaene.plaene.filter((p): p is Geschossplan => p !== undefined && Array.isArray(p.rooms)),
    [plaene.plaene],
  );
  const steigwegListe = useMemo(() => liste<RiserOut>(steigwege.data, "risers"), [steigwege.data]);

  const geraete = useMemo(() => {
    const plaeneNachGeschoss = new Map(
      floorListe.flatMap((g, i) => {
        const p = plaene.plaene[i];
        return p === undefined || !Array.isArray(p.rooms) ? [] : [[g.id, p] as const];
      }),
    );
    return geraeteDesGebaeudes(floorListe, plaeneNachGeschoss, typen);
  }, [floorListe, typen, plaene.plaene]);

  const gespeicherterPlan = useMemo(
    () => (plaeneGeladen ? leitungsplanAus({ geschosse: floorListe, plaene: planListe, durchfuehrungen, steigwege: steigwegListe }) : null),
    [plaeneGeladen, floorListe, planListe, durchfuehrungen, steigwegListe],
  );
  const vorbereitet = useMemo(() => (gespeicherterPlan === null ? null : planVorbereiten(gespeicherterPlan)), [gespeicherterPlan]);

  // Neue Durchführungen des Entwurfs (6b.5) zählen für Vorschau und Prüfung mit - nur im Browser,
  // bis die Leitung gespeichert ist. Ohne neue bleibt es derselbe vorbereitete Plan.
  const neueImEntwurf = entwurf?.werte.neueDurchfuehrungen ?? KEINE_NEUEN;
  const vorbereitetEntwurf = useMemo(() => {
    if (gespeicherterPlan === null) return null;
    if (neueImEntwurf.length === 0) return vorbereitet;
    return planMitNeuen(gespeicherterPlan, neueImEntwurf);
  }, [gespeicherterPlan, vorbereitet, neueImEntwurf]);

  const pruefen = useCallback(
    (werte: Leitungswerte, index: number | readonly number[]): Kandidatenpruefung | null => {
      if (gespeicherterPlan === null || vorbereitet === null) return null;
      const neue = werte.neueDurchfuehrungen;
      const plan =
        neue.length === 0
          ? vorbereitet
          : JSON.stringify(neue) === JSON.stringify(neueImEntwurf) && vorbereitetEntwurf !== null
            ? vorbereitetEntwurf
            : planMitNeuen(gespeicherterPlan, neue);
      return kandidatPruefen(plan, leitungAusWerten(entwurf?.cableId ?? "neu", werte), index);
    },
    [gespeicherterPlan, vorbereitet, vorbereitetEntwurf, neueImEntwurf, entwurf?.cableId],
  );

  const raumNamen = useMemo(() => {
    const geschossNamen = new Map(floorListe.map((g) => [g.id, g.name]));
    const karte = new Map<string, string>();
    for (const plan of planListe) {
      for (const r of plan.rooms) karte.set(r.id, `${r.name} (${geschossNamen.get(plan.floor_id) ?? "Geschoss"})`);
    }
    return karte;
  }, [floorListe, planListe]);
  const raumMitGeschoss = useCallback((raumId: string) => raumNamen.get(raumId) ?? "unbekannter Raum", [raumNamen]);
  const geschossName = useCallback((floorId: string) => floorListe.find((g) => g.id === floorId)?.name ?? "unbekanntes Geschoss", [floorListe]);

  const ergebnisse = useMemo(() => {
    const karte = new Map<string, Leitungsergebnis>();
    if (vorbereitet === null) return karte;
    for (const c of leitungen) karte.set(c.id, leitungAuswerten(vorbereitet, leitungAusServer(c).leitung));
    return karte;
  }, [vorbereitet, leitungen]);

  const entwurfsleitung = useMemo(() => (entwurf === null ? null : leitungAusWerten(entwurf.cableId ?? "neu", entwurf.werte)), [entwurf]);
  const ergebnis = useMemo(
    () => (vorbereitetEntwurf === null || entwurfsleitung === null ? null : leitungAuswerten(vorbereitetEntwurf, entwurfsleitung)),
    [vorbereitetEntwurf, entwurfsleitung],
  );

  const kreisVon = useCallback((id: string) => kreise.find((k) => k.id === id), [kreise]);
  const kreisName = useCallback(
    (kreis: Pick<Stromkreis, "designation" | "name" | "board_id">) => {
      const v = verteilungen.find((x) => x.id === kreis.board_id);
      return `${v === undefined ? "" : `${v.code} · `}${kreis.designation} ${kreis.name}`.trim();
    },
    [verteilungen],
  );
  const geraetName = useCallback(
    (id: string | null) => {
      if (id === null) return "Verteilung ohne Lage";
      const g = geraete.find((x) => x.id === id);
      return g === undefined ? "unbekanntes Gerät" : `${g.name} (${g.raum})`;
    },
    [geraete],
  );
  const endpunkte = useCallback(
    (circuitId: string) => {
      const kreis = kreise.find((k) => k.id === circuitId);
      if (kreis === undefined) return [];
      const lage = verteilungen.find((v) => v.id === kreis.board_id)?.placement_device_id ?? null;
      // Außen montierte Geräte werden im MVP nicht angeschlossen (D2) - sie bleiben unverändert.
      const aussen = (id: string) => vorbereitet?.geraete.get(id)?.flaeche === "wall_exterior";
      return geraete.filter((g) => (g.id === lage || kreis.device_ids.includes(g.id)) && !aussen(g.id));
    },
    [kreise, verteilungen, geraete, vorbereitet],
  );

  const neuLaden = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: leitungenSchluessel(haus) });
    await queryClient.invalidateQueries({ queryKey: stromkreiseSchluessel(haus) });
    for (const g of floorListe) await queryClient.invalidateQueries({ queryKey: durchfuehrungenSchluessel(g.id) });
    // Die Mengenübersicht (6b.6) leitet sich aus genau diesen Daten ab.
    await queryClient.invalidateQueries({ queryKey: mengenSchluessel(haus) });
  }, [queryClient, haus, floorListe]);

  const unlesbar = useCallback((c: LeitungAusServer) => leitungAusServer(c).unlesbar > 0, []);

  const bearbeiten = useCallback((c: LeitungAusServer): boolean => {
    const { leitung, unlesbar: fehlend } = leitungAusServer(c);
    if (fehlend > 0) {
      // Nie bearbeiten, was beim Speichern still verloren ginge.
      setHinweis("Diese Leitung enthält Wegpunkte, die hier nicht gelesen werden können. Sie wird nicht bearbeitet, damit nichts verloren geht.");
      return false;
    }
    dispatch({ typ: "oeffnen", entwurf: entwurfAus(c.id, c.version, werteAusServer(c, leitung.wegpunkte)) });
    setHinweis(null);
    return true;
  }, []);

  const verlaufBearbeiten = useCallback(
    (c: LeitungAusServer) => {
      if (entwurf?.cableId !== c.id && !bearbeiten(c)) return;
      setDialogOffen(false);
      setAblaufState((a) => ({ ...(a ?? NEUER_ABLAUF), schritt: "verlauf" }));
    },
    [bearbeiten, entwurf?.cableId],
  );

  const angabenBearbeiten = useCallback(
    (c: LeitungAusServer) => {
      if (entwurf?.cableId !== c.id && !bearbeiten(c)) return;
      setDialogOffen(true);
    },
    [bearbeiten, entwurf?.cableId],
  );

  const schliessen = useCallback(() => {
    dispatch({ typ: "schliessen" });
    setAblaufState(null);
    setDialogOffen(false);
    // Ein Hinweis zum geschlossenen Entwurf wäre danach veraltet.
    setHinweis(null);
  }, []);

  // ------------------------------------------------------------ Zeichenablauf (6c, L2)

  const setAblauf = useCallback((aenderung: Partial<Omit<Zeichenablauf, "schritt">>) => {
    setAblaufState((a) => (a === null ? a : { ...a, ...aenderung }));
  }, []);

  const leitungZeichnen = useCallback(() => {
    setDialogOffen(false);
    setHinweis(null);
    if (entwurf !== null) {
      // Weiter am offenen Entwurf: ohne Startgerät wieder bei Schritt 1.
      const schritt: Ablaufschritt = entwurf.werte.startId === null ? "start" : "verlauf";
      setAblaufState((a) => ({ ...(a ?? NEUER_ABLAUF), schritt }));
      return;
    }
    dispatch({ typ: "oeffnen", entwurf: entwurfAus(null, null, neueLeitungswerte()) });
    setAblaufState((a) => ({ ...(a ?? NEUER_ABLAUF), schritt: "start" }));
  }, [entwurf]);

  const geraetPruefen = useCallback(
    (id: string): Geraetepruefung => geraetEignung(id, geraete, verteilungen, (x) => vorbereitet?.geraete.get(x)?.flaeche === "wall_exterior"),
    [geraete, verteilungen, vorbereitet],
  );

  const geraetGewaehlt = useCallback(
    (id: string): string => {
      if (entwurf === null) return "Kein Leitungsentwurf offen.";
      const geprueft = geraetPruefen(id);
      if (!geprueft.ok) return `Nicht möglich: ${geprueft.grund}`;
      const w = entwurf.werte;
      if (w.startId === null) {
        dispatch({ typ: "aendern", werte: { ...w, startId: id } });
        setAblaufState((a) => ({ ...(a ?? NEUER_ABLAUF), schritt: "verlauf" }));
        // „Leitung … gespeichert“ gehörte zur vorigen Leitung.
        setHinweis(null);
        return `Start: ${geraetName(id)} – jetzt den Verlauf zeichnen; ein Klick auf das Zielgerät schließt ab.`;
      }
      if (id === w.startId) return "Dieses Gerät ist bereits das Startgerät – ein anderes Gerät beendet die Leitung.";
      if (id !== w.endId) dispatch({ typ: "aendern", werte: { ...w, endId: id } });
      setDialogOffen(true);
      return `Ziel: ${geraetName(id)} – Angaben im Dialog prüfen.`;
    },
    [entwurf, geraetPruefen, geraetName],
  );

  const abschliessen = useCallback((): string | null => {
    if (entwurf === null || dialogOffen) return null;
    if (entwurf.werte.startId === null) return "Zuerst das Startgerät wählen.";
    setDialogOffen(true);
    return entwurf.werte.endId === null ? "Offen abgeschlossen – ohne Zielgerät." : null;
  }, [entwurf, dialogOffen]);

  const weiterzeichnen = useCallback(() => {
    setDialogOffen(false);
    if (entwurf === null) return;
    // Das Ziel einer neuen Leitung wird gelöst, der letzte Punkt bleibt (Entwurf §18.3 G).
    if (entwurf.cableId === null && entwurf.werte.endId !== null) dispatch({ typ: "ziel-loesen" });
    const schritt: Ablaufschritt = entwurf.werte.startId === null ? "start" : "verlauf";
    setAblaufState((a) => ({ ...(a ?? NEUER_ABLAUF), schritt }));
  }, [entwurf]);

  const dialogSchliessen = useCallback(() => setDialogOffen(false), []);

  const ablaufBeenden = useCallback(() => {
    setAblaufState(null);
    // Ein neuer Entwurf ohne Eingaben ist nichts - er entfällt still (kein vorgetäuschtes „ungespeichert“).
    if (entwurf !== null && entwurf.cableId === null && !leitungUngespeichert(entwurf)) {
      dispatch({ typ: "schliessen" });
    }
  }, [entwurf]);

  const nachSchreiben = useCallback(async () => {
    await neuLaden();
    await onGeschrieben?.();
  }, [neuLaden, onGeschrieben]);

  const speichern = useCallback(async (): Promise<boolean> => {
    if (entwurf === null || !darfLeitungen || entwurf.status === "speichert") return false;
    // Eine neue Leitung wird nur aus dem Abschlussdialog gespeichert: Stromkreis, Angaben und
    // Zuordnung entscheidet der Benutzer dort (Strg+S öffnet ihn).
    if (entwurf.cableId === null && !dialogOffen) {
      if (entwurf.werte.startId !== null) setDialogOffen(true);
      return false;
    }
    const w = entwurf.werte;
    const zahl = leiterzahlLesen(w.leiterzahl);
    const querschnitt = querschnittLesen(w.querschnitt);
    const lokal: Leitungsfehler["eintraege"][number][] = [];
    const kreis = kreise.find((k) => k.id === w.circuitId);
    if (kreis === undefined) lokal.push({ code: "circuit-required", meldung: "Bitte einen Stromkreis wählen.", feld: "circuit_id" });
    if (!zahl.ok) lokal.push({ code: "conductor-count", meldung: zahl.fehler, feld: "conductor_count" });
    if (!querschnitt.ok) lokal.push({ code: "cross-section", meldung: querschnitt.fehler, feld: "cross_section_mm2" });
    if (w.kabeltyp.trim().length > 40) lokal.push({ code: "cable-type", meldung: "Der Leitungstyp ist zu lang (höchstens 40 Zeichen).", feld: "cable_type" });
    if (w.label.trim().length > 60) lokal.push({ code: "label", meldung: "Die Bezeichnung ist zu lang (höchstens 60 Zeichen).", feld: "label" });
    const ausVorgaben = Object.values(w.quellen).includes("vorgabe");
    if (ausVorgaben && entwurf.vorgabenBasis === null) {
      lokal.push({ code: "defaults-pending", meldung: "Die Planungsvorgaben sind noch nicht geladen.", feld: "defaults_basis" });
    }
    if (w.zuordnen.length > 0 && !darfStromkreise) {
      lokal.push({ code: "assign-right", meldung: "Für die Zuordnung zum Stromkreis fehlt das Recht „Stromkreise bearbeiten“.", feld: "assign_devices" });
    }
    if (lokal.length > 0 || kreis === undefined || !zahl.ok || !querschnitt.ok) {
      dispatch({ typ: "gescheitert", status: "fehler", fehler: { meldung: "Nicht gespeichert – bitte die Angaben prüfen.", eintraege: lokal } });
      return false;
    }
    const genutzt = ungenutzteDurchfuehrungenEntfernen(w);
    const neueSchluessel = new Set(genutzt.neueDurchfuehrungen.map((d) => d.schluessel));
    const body = {
      label: w.label.trim() === "" ? null : w.label.trim(),
      start_device_id: w.startId,
      // Ohne Ziel: bewusst offene Planung (V1) - die Leitung bleibt unvollständig.
      end_device_id: w.endId,
      cable_type: w.kabeltyp.trim() === "" ? null : w.kabeltyp.trim(),
      conductor_count: zahl.wert,
      cross_section_mm2: querschnitt.wert,
      start_allowance_mm: w.startzugabeMm,
      end_allowance_mm: w.endzugabeMm,
      reserve_mm: w.reserveMm,
      // Eine Prozentreserve (Phase 6c V1) bleibt beim Speichern erhalten - nie still zu 0 mm.
      reserve_mode: w.reserveProzent === null ? ("fixed" as const) : ("percent" as const),
      reserve_percent: w.reserveProzent,
      // Herkunft je Gruppe: Vorgaben prüft der Server selbst; „bestand“ lässt sie unverändert.
      spec_source: QUELLE_API[w.quellen.kabel],
      reserve_source: QUELLE_API[w.quellen.reserve],
      allowance_source: QUELLE_API[w.quellen.zugaben],
      ...(ausVorgaben && entwurf.vorgabenBasis !== null ? { defaults_basis: entwurf.vorgabenBasis } : {}),
      ...(w.zuordnen.length > 0 ? { assign_devices: [...w.zuordnen], expected_circuit_version: kreis.version } : {}),
      // Neue Durchführungen entstehen atomar mit der Leitung - nur die, die ein Wegpunkt nutzt.
      waypoints: w.wegpunkte.map((wp) => wegpunktAlsAnfrage(wp, neueSchluessel)),
      new_penetrations: genutzt.neueDurchfuehrungen.map((d) => ({
        key: d.schluessel,
        wall_link_id: d.kopplungId,
        offset_mm: d.abstandMm,
        height_mm: d.hoeheMm,
      })),
    };
    dispatch({ typ: "speichern-beginnt" });
    try {
      const gespeichert =
        entwurf.cableId === null
          ? await api.post("/api/v1/modules/electrical/circuits/{circuit_id}/cables", { path: { circuit_id: w.circuitId }, body })
          : await api.put("/api/v1/modules/electrical/cables/{cable_id}", {
              path: { cable_id: entwurf.cableId },
              ifMatch: entwurf.version ?? 0,
              body,
            });
      const { leitung } = leitungAusServer(gespeichert);
      queryClient.setQueryData(leitungenSchluessel(haus), (alt: unknown) => {
        const bisher = liste<LeitungAusServer>(alt, "cables");
        if (bisher.length === 0 && (alt === undefined || Array.isArray(alt))) return alt;
        const ohne = bisher.filter((l) => l.id !== gespeichert.id);
        return { building_id: haus, cables: [...ohne, gespeichert] };
      });
      setDialogOffen(false);
      if (entwurf.cableId === null && ablauf !== null) {
        // Das Werkzeug bleibt aktiv: gleich die nächste Leitung (Entwurf §18.3 G); Escape beendet es.
        dispatch({ typ: "oeffnen", entwurf: entwurfAus(null, null, neueLeitungswerte()) });
        setAblaufState({ ...ablauf, schritt: "start" });
      } else {
        dispatch({ typ: "gespeichert", cableId: gespeichert.id, version: gespeichert.version, werte: werteAusServer(gespeichert, leitung.wegpunkte) });
      }
      setHinweis(`Leitung „${gespeichert.label ?? "ohne Bezeichnung"}“ gespeichert.`);
      await nachSchreiben();
      return true;
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 409 && error.errorType === "planning-defaults-changed") {
        const eintraege = (error.problem?.errors ?? []).map((e) => ({ code: e.code, meldung: e.message, feld: e.field }));
        dispatch({
          typ: "gescheitert",
          status: "konflikt",
          vorgabenGeaendert: true,
          fehler: { meldung: "Die Planungsvorgaben wurden inzwischen geändert. Es wurde nichts gespeichert – bitte entscheiden.", eintraege },
        });
        return false;
      }
      const a = fehlerAus(error, "Die Leitung konnte nicht gespeichert werden.");
      dispatch({ typ: "gescheitert", status: a.status, fehler: a.fehler });
      return false;
    }
  }, [api, ablauf, darfLeitungen, darfStromkreise, dialogOffen, entwurf, haus, kreise, nachSchreiben, queryClient]);

  /** Nach einem Konflikt: Entwurf bewusst verwerfen und die Leitung frisch laden. */
  const verwerfenUndNeuLaden = useCallback(async () => {
    if (entwurf === null) return;
    const frisch = await queryClient.fetchQuery({ ...leitungenAbfrage(api, haus), staleTime: 0 });
    await neuLaden();
    const c = liste<LeitungAusServer>(frisch, "cables").find((l) => l.id === entwurf.cableId);
    if (c === undefined) {
      dispatch({ typ: "schliessen" });
      setHinweis("Die Leitung gibt es nicht mehr – der Entwurf wurde geschlossen.");
      return;
    }
    const { leitung } = leitungAusServer(c);
    dispatch({ typ: "oeffnen", entwurf: entwurfAus(c.id, c.version, werteAusServer(c, leitung.wegpunkte)) });
    setHinweis("Serverstand geladen – Ihr bisheriger Entwurf wurde verworfen.");
  }, [api, entwurf, haus, neuLaden, queryClient]);

  const loeschen = useCallback(
    async (c: LeitungAusServer): Promise<string | null> => {
      try {
        await api.delete("/api/v1/modules/electrical/cables/{cable_id}", { path: { cable_id: c.id }, ifMatch: c.version });
        if (entwurf?.cableId === c.id) dispatch({ typ: "schliessen" });
        await nachSchreiben();
        return null;
      } catch (error: unknown) {
        await neuLaden();
        return meldung(error, "Die Leitung konnte nicht entfernt werden.");
      }
    },
    [api, entwurf, nachSchreiben, neuLaden],
  );

  const vorschlagUebernehmen = useCallback(
    async (c: LeitungAusServer): Promise<string | null> => {
      const kreis = kreise.find((k) => k.id === c.circuit_id);
      if (kreis === undefined) return "Der Stromkreis ist nicht (mehr) bekannt. Bitte neu laden.";
      try {
        // Beide Versionen: die der Leitung (If-Match) und die des gesehenen Vorschlags.
        const neu = await api.post("/api/v1/modules/electrical/cables/{cable_id}/apply-proposal", {
          path: { cable_id: c.id },
          ifMatch: c.version,
          body: { expected_circuit_version: kreis.version },
        });
        if (entwurf?.cableId === c.id && !leitungUngespeichert(entwurf)) {
          const { leitung } = leitungAusServer(neu);
          dispatch({ typ: "oeffnen", entwurf: entwurfAus(neu.id, neu.version, werteAusServer(neu, leitung.wegpunkte)) });
        }
        await nachSchreiben();
        return null;
      } catch (error: unknown) {
        await neuLaden();
        if (error instanceof ApiError && error.status === 409) {
          return "Leitung oder Stromkreisvorschlag wurden inzwischen geändert. Es wurde nichts übernommen – bitte die neu geladenen Angaben prüfen.";
        }
        return meldung(error, "Der Vorschlag konnte nicht übernommen werden.");
      }
    },
    [api, entwurf, kreise, nachSchreiben, neuLaden],
  );

  const durchfuehrungAendern = useCallback(
    async (d: DurchfuehrungAusServer, werte: { offset_mm: number; height_mm: number }): Promise<string | null> => {
      try {
        await mitBestaetigung((bestaetigt) =>
          api.patch("/api/v1/modules/electrical/penetrations/{penetration_id}", {
            path: { penetration_id: d.id },
            ifMatch: d.version,
            body: { ...werte, ...bestaetigungsfeld(bestaetigt) },
          }),
        );
        await nachSchreiben();
        return null;
      } catch (error: unknown) {
        if (error instanceof BestaetigungAbgelehnt) return "Nicht verschoben – die Leitungen bleiben unverändert.";
        await neuLaden();
        return meldung(error, "Die Durchführung konnte nicht verschoben werden.");
      }
    },
    [api, mitBestaetigung, nachSchreiben, neuLaden],
  );

  const durchfuehrungEntfernen = useCallback(
    async (d: DurchfuehrungAusServer): Promise<string | null> => {
      try {
        await api.delete("/api/v1/modules/electrical/penetrations/{penetration_id}", { path: { penetration_id: d.id }, ifMatch: d.version });
        await nachSchreiben();
        return null;
      } catch (error: unknown) {
        await neuLaden();
        return meldung(error, "Die Durchführung konnte nicht entfernt werden.");
      }
    },
    [api, nachSchreiben, neuLaden],
  );

  return {
    projektId: projectId,
    geladen: !geschosse.isPending && plaeneGeladen && !leitungenQ.isPending && !kreiseQ.isPending,
    ladefehler: leitungenQ.isError || kreiseQ.isError,
    leitungen,
    kreise,
    verteilungen,
    geraete,
    durchfuehrungen,
    geschosse: floorListe,
    steigwege: steigwegListe,
    vorbereitet,
    vorbereitetEntwurf,
    ergebnisse,
    entwurf,
    ungespeichert: leitungUngespeichert(entwurf),
    ablaufSchluessel: `${entwurf === null ? "zu" : (entwurf.cableId ?? "neu")}|${ablauf?.schritt ?? "aus"}|${dialogOffen ? "dialog" : "flaeche"}`,
    ergebnis,
    entwurfsleitung,
    dispatch,
    darfLeitungen,
    darfStromkreise,
    hinweis,
    setHinweis,
    kreisVon,
    kreisName,
    geraetName,
    raumMitGeschoss,
    geschossName,
    pruefen,
    endpunkte,
    unlesbar,
    ablauf,
    dialogOffen,
    setAblauf,
    leitungZeichnen,
    geraetPruefen,
    geraetGewaehlt,
    abschliessen,
    weiterzeichnen,
    dialogSchliessen,
    ablaufBeenden,
    verlaufBearbeiten,
    angabenBearbeiten,
    bearbeiten,
    schliessen,
    speichern,
    verwerfenUndNeuLaden,
    loeschen,
    vorschlagUebernehmen,
    durchfuehrungAendern,
    durchfuehrungEntfernen,
  };
}
