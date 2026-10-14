import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { useAuth } from "../../../core/auth/AuthProvider";
import { useMasse } from "../../../core/ui/masseinheit";
import { KNOPFZEILE, knopf } from "../../../core/ui/stil";
import "../darstellung.css";
import { planAbfrage } from "../plan";
import { ANSICHT_ZURUECKSETZEN, ANSICHT_ZURUECKSETZEN_3D } from "../texte";
import { MESSUNG, messen } from "./messung";
import type { Auswahl, Szenenmodell } from "./modell";
import { gleicheAuswahl } from "./modell";
import { Seitenleiste } from "./Seitenleiste";
import { Grundrissszene, STANDARD_GERAETESICHTBARKEIT } from "./szene";
import type { Geraetesichtbarkeit, Kamerastand } from "./szene";
import type { Rueckmeldung } from "./szene";
import type { Geraet3d } from "./geraete3d";
import { katalogAbfrage, typenNachSchluessel } from "../geraete/katalog";
import { raumseite } from "../leitung/grundriss";
import { useGrundrisseinstellung, useLeitungsplanungImKontext } from "../leitung/LeitungsplanungProvider";
import type { Leitung3d } from "./leitungen3d";
import { leitungen3d } from "./leitungen3d";
import type { Leitungsziel3d } from "./Seitenleiste";
import { objektZu, szenenmodellAus } from "./szenenmodell";
import { browserUmgebung } from "./umgebung";

/** Lade-, Fehler- und Leerzustände über der Zeichenfläche; die Szene bleibt dahinter erkennbar. */
const UEBERLAGERUNG =
  "absolute inset-0 flex flex-col items-center justify-center gap-2 bg-canvas/86 p-4 text-center";

/** Was React von der Szene benutzt - eine Attrappe in Tests erfüllt es. */
export type Szenensteuerung = Pick<
  Grundrissszene,
  "setzePlan" | "setzeAuswahl" | "einpassen" | "standardansicht" | "draufsicht" | "zoomen" | "entsorgen"
> &
  Partial<Pick<Grundrissszene, "kamerastand" | "kamerastandSetzen" | "setzeGeraetesichtbarkeit" | "setzeLeitungen">>;

/**
 * Was die 3D-Ansicht beim Wechsel in die Wandansicht abgibt und bei der
 * Rückkehr wieder aufnimmt (Phase 4f): Kamera und Auswahl. Reine Ansicht.
 */
export interface Rueckkehr3d {
  readonly floorId: string;
  readonly kamera: Kamerastand | null;
  readonly auswahl: Auswahl | null;
  /** Phase 5: Schalter Wandgeräte, Deckengeräte, Beschriftungen. */
  readonly sichtbarkeit?: Geraetesichtbarkeit;
}

/** Ziel „An Decke bearbeiten“ aus 3D (Phase 5). */
export interface Deckenansichtsziel3d {
  readonly raumId: string;
  readonly geraetId?: string;
}

export type { Leitungsziel3d };

/** Ziel einer Wandansicht aus 3D - mit der angeklickten Seite. */
export interface Wandansichtsziel3d {
  readonly raumId: string;
  readonly wandId: string;
  readonly seite: "innen" | "aussen";
  /** Phase 5: „An Wand bearbeiten“ wählt das Gerät in der Wandansicht aus. */
  readonly geraetId?: string;
}

export type SzeneErzeugen = (behaelter: HTMLElement, rueckmeldung: Rueckmeldung) => Szenensteuerung;

const echteSzene: SzeneErzeugen = (behaelter, rueckmeldung) =>
  new Grundrissszene(behaelter, browserUmgebung(), rueckmeldung);

export type Ansichtsziel = "editor" | "tabelle";

type Stoerung = "kein-webgl" | "kontext-verloren" | null;

function zusammenfassung(modell: Szenenmodell): string {
  const gemeinsam = modell.waende.filter((w) => w.lage === "gemeinsam").length;
  const teile = [
    `${modell.raeume.length} von ${modell.raumanzahlGesamt} Räumen dargestellt`,
    `${modell.waende.length} Wandkörper, davon ${gemeinsam} gemeinsam`,
    `${modell.oeffnungen.length} Öffnungen`,
    `${modell.geraete.length} Geräte`,
    `${modell.warnungen.length} Hinweise`,
  ];
  return teile.join(" · ");
}

/**
 * 3D-Ansicht eines Geschosses (Phase 4b, ADR 0016) - ausschließlich lesend.
 *
 * Liest denselben Planungsstand wie der 2D-Editor (gleicher Query-Key) und
 * leitet daraus ein unveränderliches Szenenmodell ab. Die Szene entsteht
 * einmal je Mount und wird bei neuem Plan gezielt aktualisiert - nicht bei
 * jedem Render. In React landet nur die kleine Auswahlreferenz.
 */
export default function Ansicht3d({
  floorId,
  geschossLabel,
  onAnsicht,
  onWandansicht,
  onDeckenansicht,
  anfang,
  onLeitungBearbeiten,
  szeneErzeugen = echteSzene,
}: {
  floorId: string;
  geschossLabel: string;
  onAnsicht: (ziel: Ansichtsziel) => void;
  /** Wandansicht öffnen; die Ansicht gibt dabei Kamera und Auswahl für die Rückkehr ab. */
  onWandansicht?: (ziel: Wandansichtsziel3d, rueckkehr: Rueckkehr3d) => void;
  /** Phase 5: Deckenansicht mit gewähltem Gerät öffnen; Rückkehr wie bei der Wandansicht. */
  onDeckenansicht?: (ziel: Deckenansichtsziel3d, rueckkehr: Rueckkehr3d) => void;
  /** Bei der Rückkehr aus der Wandansicht: Kamera und Auswahl wiederherstellen. */
  anfang?: Rueckkehr3d | null;
  /**
   * Phase 6b.5: Eine gewählte Leitung auf der passenden Fläche bearbeiten. Der
   * Leitungsentwurf ist dann bereits geöffnet; Kamera und Auswahl gehen mit.
   */
  onLeitungBearbeiten?: (ziel: Leitungsziel3d, rueckkehr: Rueckkehr3d) => void;
  szeneErzeugen?: SzeneErzeugen;
}) {
  const { api } = useAuth();
  const plan = useQuery(planAbfrage(api, floorId));
  const katalog = useQuery(katalogAbfrage(api));
  const typen = useMemo(() => typenNachSchluessel(katalog.data), [katalog.data]);
  const masse = useMasse();
  // Die Einheit steckt nur in den Hinweistexten des Modells; die Geometrie
  // bleibt in Millimetern. Ein Einheitenwechsel ersetzt die Szene ohne
  // Einpassen (gleiches Geschoss).
  const modell = useMemo(
    () => messen(MESSUNG.szenenmodell, () => szenenmodellAus(plan.data, masse.anzeigen, typen)),
    [plan.data, masse, typen],
  );

  // Gespeicherte Leitungen des Gebäudes (6b.5) - nur der gespeicherte Stand, nie der Entwurf.
  const planung = useLeitungsplanungImKontext();
  const einstellung = useGrundrisseinstellung();
  const leitungen: readonly Leitung3d[] = useMemo(() => {
    const v = planung?.vorbereitet ?? null;
    if (planung === null || v === null || !Array.isArray(plan.data?.rooms)) return [];
    const staerken = new Map(plan.data.rooms.flatMap((r) => r.walls.map((w) => [w.id, w.thickness_mm] as const)));
    return leitungen3d(planung.leitungen, {
      floorId,
      geschosse: planung.geschosse,
      raumseite: (wandId) => {
        const n = raumseite(v, wandId);
        return n === null ? null : { x: n.x, y: n.y, halbeStaerkeMm: (staerken.get(wandId) ?? 0) / 2 };
      },
      raumDerWand: (wandId) => {
        const info = v.waende.get(wandId);
        return info !== undefined && info.raum.geschossId === floorId ? info.raum.id : null;
      },
      bezeichnung: (c) => {
        const kreis = planung.kreisVon(c.circuit_id);
        return `${kreis === undefined ? "" : `${kreis.designation} · `}${c.label ?? "Leitung"}`;
      },
    });
  }, [planung, plan.data, floorId]);

  const anfangRef = useRef(anfang?.floorId === floorId ? anfang : null);
  const [auswahl, setAuswahl] = useState<Auswahl | null>(anfangRef.current?.auswahl ?? null);
  const [sichtbarkeit, setSichtbarkeit] = useState<Geraetesichtbarkeit>(anfangRef.current?.sichtbarkeit ?? STANDARD_GERAETESICHTBARKEIT);
  const [stoerung, setStoerung] = useState<Stoerung>(null);
  const [start, setStart] = useState(0);
  const behaelter = useRef<HTMLDivElement>(null);
  const szene = useRef<Szenensteuerung | null>(null);
  const gezeigtesGeschoss = useRef<string | null>(null);
  const hilfeId = useId();
  const zusammenfassungId = useId();

  const auswaehlen = useCallback((neu: Auswahl | null) => {
    setAuswahl((alt) => (gleicheAuswahl(alt, neu) ? alt : neu));
  }, []);

  // Szene: genau einmal je Mount (und je bewusstem Neustart).
  useEffect(() => {
    const element = behaelter.current;
    if (element === null) return undefined;
    let instanz: Szenensteuerung;
    try {
      instanz = szeneErzeugen(element, {
        auswahl: auswaehlen,
        kontextVerloren: () => setStoerung("kontext-verloren"),
      });
    } catch {
      setStoerung("kein-webgl");
      return undefined;
    }
    szene.current = instanz;
    gezeigtesGeschoss.current = null;
    return () => {
      instanz.entsorgen();
      if (szene.current === instanz) szene.current = null;
    };
  }, [szeneErzeugen, auswaehlen, start]);

  // Neuer Plan: gezielt ersetzen; beim ersten Plan eines Geschosses einpassen.
  useEffect(() => {
    const instanz = szene.current;
    if (instanz === null) return;
    const erstesMal = gezeigtesGeschoss.current !== modell.floorId;
    const rueckkehr = anfangRef.current;
    if (erstesMal && rueckkehr !== null && rueckkehr.floorId === modell.floorId && rueckkehr.kamera !== null) {
      // Rückkehr aus Wand-, Decken- oder Grundrissbearbeitung: dieselbe Kamera wie vorher, nicht
      // neu einpassen. Die Rückkehr gilt für jedes neue Szenenexemplar dieses Geschosses - im
      // StrictMode entsteht die Szene zweimal, und das zweite Exemplar darf nicht neu einpassen
      // (Befund der Browserabnahme 6b.5). Erst ein anderes Geschoss beendet sie.
      instanz.setzePlan(modell, { einpassen: false });
      instanz.kamerastandSetzen?.(rueckkehr.kamera);
    } else {
      if (rueckkehr !== null && modell.floorId !== null && rueckkehr.floorId !== modell.floorId) anfangRef.current = null;
      instanz.setzePlan(modell, { einpassen: erstesMal });
    }
    gezeigtesGeschoss.current = modell.floorId;
  }, [modell, start]);

  const objekt = objektZu(modell, auswahl, leitungen);
  // Erst mit geladenem Plan (und bei Leitungen: geladener Planung) entscheiden - sonst ginge
  // eine wiederhergestellte Auswahl verloren.
  const fehlt = auswahl !== null && objekt === null && plan.isSuccess && (auswahl.art !== "leitung" || planung?.geladen === true);
  const gueltig = fehlt ? null : auswahl;

  // Eine Auswahl, deren Objekt nach dem Neuladen fehlt, verschwindet.
  useEffect(() => {
    if (fehlt) setAuswahl(null);
  }, [fehlt]);

  // Leitungen vor der Auswahl setzen: Eine gewählte Leitung muss in der Szene schon vorhanden sein,
  // auch in einem neu erzeugten Szenenexemplar (Befund der Browserabnahme 6b.5).
  useEffect(() => {
    szene.current?.setzeLeitungen?.(leitungen);
  }, [leitungen, start]);

  useEffect(() => {
    szene.current?.setzeAuswahl(gueltig);
  }, [gueltig, modell, start, leitungen]);

  // Schalter über der Ansicht: ausgeblendete Geräte sind auch keine Klickziele.
  useEffect(() => {
    szene.current?.setzeGeraetesichtbarkeit?.(sichtbarkeit);
  }, [sichtbarkeit, modell, start]);

  // Wird das gewählte Gerät ausgeblendet, verschwindet auch die Auswahl.
  const gewaehltesGeraet = objekt?.art === "geraet" ? objekt.geraet : null;
  const ausgeblendet =
    gewaehltesGeraet !== null && (gewaehltesGeraet.flaeche === "ceiling" ? !sichtbarkeit.decke : !sichtbarkeit.wand);
  useEffect(() => {
    if (ausgeblendet) setAuswahl(null);
  }, [ausgeblendet]);

  const rueckkehr = (): Rueckkehr3d => ({ floorId, kamera: szene.current?.kamerastand?.() ?? null, auswahl: gueltig, sichtbarkeit });

  const geraetBearbeiten = (g: Geraet3d) => {
    if (g.flaeche === "ceiling") onDeckenansicht?.({ raumId: g.raumId, geraetId: g.id }, rueckkehr());
    else if (g.wandId !== null) {
      onWandansicht?.({ raumId: g.raumId, wandId: g.wandId, seite: g.flaeche === "wall_exterior" ? "aussen" : "innen", geraetId: g.id }, rueckkehr());
    }
  };

  // Leitung bearbeiten (6b.5): Entwurf öffnen (nie still einen anderen verwerfen), dann die passende Fläche.
  const entwurf = planung?.entwurf ?? null;
  const leitungSperre =
    planung === null || !planung.darfLeitungen
      ? "Nur ansehen – Leitungen bearbeiten ist hier nicht möglich."
      : gueltig?.art === "leitung" && entwurf !== null && entwurf.cableId !== gueltig.id
        ? "Ein anderer Leitungsentwurf ist offen – bitte zuerst speichern oder schließen."
        : gueltig?.art === "leitung" && planung.leitungen.some((c) => c.id === gueltig.id && planung.unlesbar(c))
          ? "Diese Leitung enthält Wegpunkte, die hier nicht gelesen werden können – Bearbeiten ist gesperrt."
          : null;
  const leitungBearbeiten = (l: Leitung3d, ziel: Leitungsziel3d) => {
    if (planung === null || leitungSperre !== null) return;
    const cable = planung.leitungen.find((c) => c.id === l.id);
    if (cable === undefined) return;
    if (planung.entwurf === null) planung.bearbeiten(cable);
    if (ziel.art === "grundriss") einstellung?.setWerkzeug("leitung");
    onLeitungBearbeiten?.(ziel, rueckkehr());
  };
  const entwurfHinweis =
    entwurf === null
      ? null
      : `Ein Leitungsentwurf ist offen${planung?.ungespeichert === true ? " und ungespeichert" : ""} – er bleibt erhalten; die 3D-Ansicht zeigt den gespeicherten Stand.`;

  const schalter = (feld: keyof Geraetesichtbarkeit, label: string, anzahl?: number) => (
    <button
      type="button"
      className={knopf(sichtbarkeit[feld] ? "gewaehlt" : "einfach")}
      aria-pressed={sichtbarkeit[feld]}
      title={`${label} ${sichtbarkeit[feld] ? "ausblenden" : "einblenden"}`}
      onClick={() => setSichtbarkeit((alt) => ({ ...alt, [feld]: !alt[feld] }))}
    >
      <span aria-hidden="true">{sichtbarkeit[feld] ? "☑ " : "☐ "}</span>
      {label}
      {anzahl !== undefined ? ` (${anzahl})` : ""}
    </button>
  );

  const tasten = (ereignis: KeyboardEvent) => {
    if (ereignis.key === "Escape" && auswahl !== null) {
      ereignis.preventDefault();
      setAuswahl(null);
    }
  };

  const neuStarten = () => {
    setStoerung(null);
    setStart((n) => n + 1);
  };

  const bereit = stoerung === null;
  const leer = plan.isSuccess && modell.raumanzahlGesamt === 0;
  const nichtsDarstellbar = plan.isSuccess && modell.raumanzahlGesamt > 0 && modell.raeume.length === 0;

  return (
    <div className="flex flex-col gap-2" onKeyDown={tasten}>
      <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label="Kamera der 3D-Ansicht">
        <button
          type="button"
          className={knopf("einfach")}
          disabled={!bereit}
          title={ANSICHT_ZURUECKSETZEN_3D}
          onClick={() => szene.current?.einpassen()}
        >
          {ANSICHT_ZURUECKSETZEN}
        </button>
        <button type="button" className={knopf("einfach")} disabled={!bereit} onClick={() => szene.current?.standardansicht()}>
          Isometrische Ansicht
        </button>
        <button type="button" className={knopf("einfach")} disabled={!bereit} onClick={() => szene.current?.draufsicht()}>
          Draufsicht
        </button>
        <button type="button" className={knopf("einfach")} disabled={!bereit} onClick={() => szene.current?.zoomen(1.25)}>
          Näher
        </button>
        <button type="button" className={knopf("einfach")} disabled={!bereit} onClick={() => szene.current?.zoomen(0.8)}>
          Weiter weg
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Geräte in der 3D-Ansicht">
        <span className="text-label text-muted">Anzeigen:</span>
        {schalter("wand", "Wandgeräte", modell.geraete.filter((g) => g.flaeche !== "ceiling").length)}
        {schalter("decke", "Deckengeräte", modell.geraete.filter((g) => g.flaeche === "ceiling").length)}
        {schalter("beschriftung", "Beschriftungen")}
      </div>
      <p className="m-0 text-label text-muted" id={hilfeId}>
        Drehen: linke Maustaste ziehen · Verschieben: rechte Maustaste, Umschalt + Ziehen oder
        Pfeiltasten · Zoomen: Mausrad · Touch: ein Finger dreht, zwei Finger zoomen und verschieben ·
        Klicken wählt aus, Esc hebt die Auswahl auf. Nur Ansicht – bearbeitet wird im 2D-Editor
        bzw. in der Wand- und Deckenansicht.
      </p>

      <div className="grid grid-cols-1 gap-3 split:grid-cols-[minmax(0,1fr)_320px]">
        <div className="relative h-[62vh] min-h-[360px] overflow-hidden rounded-ep border border-line bg-canvas max-sm:h-[55vh] max-sm:min-h-[300px]">
          {stoerung === "kein-webgl" ? (
            <div className="p-4" role="alert">
              <p>
                <strong>Die 3D-Ansicht ist in diesem Browser nicht verfügbar.</strong> Sie braucht
                WebGL, das hier fehlt oder abgeschaltet ist.
              </p>
              <p>Der Grundriss bleibt im 2D-Editor und in „Tabellen &amp; Details“ vollständig nutzbar.</p>
              <div className={KNOPFZEILE}>
                <button type="button" className={knopf("primaer")} onClick={() => onAnsicht("editor")}>
                  Zum 2D-Editor
                </button>
                <button type="button" className={knopf("einfach")} onClick={() => onAnsicht("tabelle")}>
                  Zu Tabellen &amp; Details
                </button>
                <button type="button" className={knopf()} onClick={neuStarten}>
                  Erneut versuchen
                </button>
              </div>
            </div>
          ) : (
            <div
              ref={behaelter}
              className="absolute inset-0 focus-visible:outline-3 focus-visible:-outline-offset-3"
              tabIndex={0}
              role="application"
              aria-roledescription="3D-Ansicht"
              aria-label={`3D-Ansicht ${geschossLabel}`}
              aria-describedby={`${hilfeId} ${zusammenfassungId}`}
            />
          )}

          {stoerung === "kontext-verloren" && (
            <div className={UEBERLAGERUNG} role="alert">
              <p>Der Browser hat die Grafikausgabe unterbrochen (WebGL-Kontext verloren).</p>
              <button type="button" className={knopf("primaer")} onClick={neuStarten}>
                Ansicht neu starten
              </button>
            </div>
          )}
          {stoerung === null && plan.isPending && (
            <div className={UEBERLAGERUNG}>
              <p>Plan wird geladen …</p>
            </div>
          )}
          {stoerung === null && plan.isError && (
            <div className={UEBERLAGERUNG} role="alert">
              <p>Der Plan dieses Geschosses konnte nicht geladen werden.</p>
              <button type="button" className={knopf("einfach")} onClick={() => void plan.refetch()}>
                Erneut laden
              </button>
            </div>
          )}
          {stoerung === null && leer && (
            <div className={UEBERLAGERUNG}>
              <p>Auf diesem Geschoss ist noch kein Raum erfasst. Räume entstehen im 2D-Editor.</p>
              <button type="button" className={knopf("einfach")} onClick={() => onAnsicht("editor")}>
                Zum 2D-Editor
              </button>
            </div>
          )}
          {stoerung === null && nichtsDarstellbar && (
            <div className={UEBERLAGERUNG}>
              <p>
                Kein Raum dieses Geschosses hat eine geschlossene Kontur – deshalb ist nichts
                darstellbar. Die betroffenen Räume stehen rechts unter „Nicht dargestellt“.
              </p>
            </div>
          )}
        </div>

        <Seitenleiste
          modell={modell}
          auswahl={gueltig}
          objekt={objekt}
          onAuswahl={auswaehlen}
          {...(onWandansicht !== undefined
            ? {
                onWandansicht: (ziel: Wandansichtsziel3d) => onWandansicht(ziel, rueckkehr()),
              }
            : {})}
          {...(onWandansicht !== undefined || onDeckenansicht !== undefined ? { onGeraetBearbeiten: geraetBearbeiten } : {})}
          leitungen={leitungen}
          {...(onLeitungBearbeiten !== undefined ? { onLeitungBearbeiten: leitungBearbeiten } : {})}
          leitungSperre={leitungSperre}
          entwurfHinweis={entwurfHinweis}
        />
      </div>
      <p className="m-0 text-label text-muted" id={zusammenfassungId}>
        {plan.isSuccess ? zusammenfassung(modell) : ""}
      </p>
    </div>
  );
}
