import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { useAuth } from "../../../core/auth/AuthProvider";
import { useMasse } from "../../../core/ui/masseinheit";
import { planAbfrage } from "../plan";
import { ANSICHT_ZURUECKSETZEN, ANSICHT_ZURUECKSETZEN_3D } from "../texte";
import { MESSUNG, messen } from "./messung";
import type { Auswahl, Szenenmodell } from "./modell";
import { gleicheAuswahl } from "./modell";
import { Seitenleiste } from "./Seitenleiste";
import { Grundrissszene } from "./szene";
import type { Rueckmeldung } from "./szene";
import { objektZu, szenenmodellAus } from "./szenenmodell";
import { browserUmgebung } from "./umgebung";

/** Was React von der Szene benutzt - eine Attrappe in Tests erfüllt es. */
export type Szenensteuerung = Pick<
  Grundrissszene,
  "setzePlan" | "setzeAuswahl" | "einpassen" | "standardansicht" | "draufsicht" | "zoomen" | "entsorgen"
>;

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
  szeneErzeugen = echteSzene,
}: {
  floorId: string;
  geschossLabel: string;
  onAnsicht: (ziel: Ansichtsziel) => void;
  szeneErzeugen?: SzeneErzeugen;
}) {
  const { api } = useAuth();
  const plan = useQuery(planAbfrage(api, floorId));
  const masse = useMasse();
  // Die Einheit steckt nur in den Hinweistexten des Modells; die Geometrie
  // bleibt in Millimetern. Ein Einheitenwechsel ersetzt die Szene ohne
  // Einpassen (gleiches Geschoss).
  const modell = useMemo(
    () => messen(MESSUNG.szenenmodell, () => szenenmodellAus(plan.data, masse.anzeigen)),
    [plan.data, masse],
  );

  const [auswahl, setAuswahl] = useState<Auswahl | null>(null);
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
    instanz.setzePlan(modell, { einpassen: gezeigtesGeschoss.current !== modell.floorId });
    gezeigtesGeschoss.current = modell.floorId;
  }, [modell, start]);

  const objekt = objektZu(modell, auswahl);
  const fehlt = auswahl !== null && objekt === null;
  const gueltig = fehlt ? null : auswahl;

  // Eine Auswahl, deren Objekt nach dem Neuladen fehlt, verschwindet.
  useEffect(() => {
    if (fehlt) setAuswahl(null);
  }, [fehlt]);

  useEffect(() => {
    szene.current?.setzeAuswahl(gueltig);
  }, [gueltig, modell, start]);

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
    <div className="ansicht3d" onKeyDown={tasten}>
      <div className="ansicht3d__leiste" role="toolbar" aria-label="Kamera der 3D-Ansicht">
        <button
          type="button"
          className="button"
          disabled={!bereit}
          title={ANSICHT_ZURUECKSETZEN_3D}
          onClick={() => szene.current?.einpassen()}
        >
          {ANSICHT_ZURUECKSETZEN}
        </button>
        <button type="button" className="button" disabled={!bereit} onClick={() => szene.current?.standardansicht()}>
          Isometrische Ansicht
        </button>
        <button type="button" className="button" disabled={!bereit} onClick={() => szene.current?.draufsicht()}>
          Draufsicht
        </button>
        <button type="button" className="button" disabled={!bereit} onClick={() => szene.current?.zoomen(1.25)}>
          Näher
        </button>
        <button type="button" className="button" disabled={!bereit} onClick={() => szene.current?.zoomen(0.8)}>
          Weiter weg
        </button>
      </div>
      <p className="ansicht3d__hilfe" id={hilfeId}>
        Drehen: linke Maustaste ziehen · Verschieben: rechte Maustaste, Umschalt + Ziehen oder
        Pfeiltasten · Zoomen: Mausrad · Touch: ein Finger dreht, zwei Finger zoomen und verschieben ·
        Klicken wählt aus, Esc hebt die Auswahl auf. Nur Ansicht – bearbeitet wird im 2D-Editor.
      </p>

      <div className="ansicht3d__arbeitsbereich">
        <div className="ansicht3d__flaeche">
          {stoerung === "kein-webgl" ? (
            <div className="ansicht3d__ersatz" role="alert">
              <p>
                <strong>Die 3D-Ansicht ist in diesem Browser nicht verfügbar.</strong> Sie braucht
                WebGL, das hier fehlt oder abgeschaltet ist.
              </p>
              <p>Der Grundriss bleibt im 2D-Editor und in „Tabellen &amp; Details“ vollständig nutzbar.</p>
              <div className="button-row">
                <button type="button" className="button button--primary" onClick={() => onAnsicht("editor")}>
                  Zum 2D-Editor
                </button>
                <button type="button" className="button" onClick={() => onAnsicht("tabelle")}>
                  Zu Tabellen &amp; Details
                </button>
                <button type="button" className="button button--ghost" onClick={neuStarten}>
                  Erneut versuchen
                </button>
              </div>
            </div>
          ) : (
            <div
              ref={behaelter}
              className="ansicht3d__szene"
              tabIndex={0}
              role="application"
              aria-roledescription="3D-Ansicht"
              aria-label={`3D-Ansicht ${geschossLabel}`}
              aria-describedby={`${hilfeId} ${zusammenfassungId}`}
            />
          )}

          {stoerung === "kontext-verloren" && (
            <div className="ansicht3d__overlay" role="alert">
              <p>Der Browser hat die Grafikausgabe unterbrochen (WebGL-Kontext verloren).</p>
              <button type="button" className="button button--primary" onClick={neuStarten}>
                Ansicht neu starten
              </button>
            </div>
          )}
          {stoerung === null && plan.isPending && (
            <div className="ansicht3d__overlay">
              <p>Plan wird geladen …</p>
            </div>
          )}
          {stoerung === null && plan.isError && (
            <div className="ansicht3d__overlay" role="alert">
              <p>Der Plan dieses Geschosses konnte nicht geladen werden.</p>
              <button type="button" className="button" onClick={() => void plan.refetch()}>
                Erneut laden
              </button>
            </div>
          )}
          {stoerung === null && leer && (
            <div className="ansicht3d__overlay">
              <p>Auf diesem Geschoss ist noch kein Raum erfasst. Räume entstehen im 2D-Editor.</p>
              <button type="button" className="button" onClick={() => onAnsicht("editor")}>
                Zum 2D-Editor
              </button>
            </div>
          )}
          {stoerung === null && nichtsDarstellbar && (
            <div className="ansicht3d__overlay">
              <p>
                Kein Raum dieses Geschosses hat eine geschlossene Kontur – deshalb ist nichts
                darstellbar. Die betroffenen Räume stehen rechts unter „Nicht dargestellt“.
              </p>
            </div>
          )}
        </div>

        <Seitenleiste modell={modell} auswahl={gueltig} objekt={objekt} onAuswahl={auswaehlen} />
      </div>
      <p className="ansicht3d__zusammenfassung muted" id={zusammenfassungId}>
        {plan.isSuccess ? zusammenfassung(modell) : ""}
      </p>
    </div>
  );
}
