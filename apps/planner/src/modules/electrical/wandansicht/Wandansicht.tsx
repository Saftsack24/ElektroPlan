import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, KeyboardEvent } from "react";

import { AKTION } from "../../../core/ui/aktionssymbole";
import { MitSymbol, Symbol } from "../../../core/ui/Symbol";
import { useMasse } from "../../../core/ui/masseinheit";
import { knopf, meldungsflaeche } from "../../../core/ui/stil";
import type { EntwurfGeraet, EntwurfWand, Oeffnungsart, RaumImPlan } from "../editor/entwurf";
import { geraetAendern, geraetEntfernen } from "../geraete/geraeteentwurf";
import type { Geraetetypen } from "../geraete/katalog";
import { typenFuer } from "../geraete/katalog";
import { Geraetelegende } from "../geraete/symbole";
import { GeraetEigenschaften, TypAuswahl } from "./GeraetEigenschaften";
import { flaecheDerSeite, geraeteInAnsicht, geraetLagePruefen } from "./wandgeraete";
import type { EditorEinordnung, EditorTopologie } from "../editor/platzierung";
import { oeffnungAendern, oeffnungEntfernen } from "../editor/werkzeuge";
import type { Aktion, EditorZustand } from "../editor/zustand";
import type { Gegenseite } from "./WandEigenschaften";
import { WandEigenschaften } from "./WandEigenschaften";
import type { Ansichtsrechteck } from "./wandbezug";
import { wandbezug } from "./wandbezug";
import type { Wandseite } from "./wandbezug";
import type { AnsichtsOeffnung } from "./wandmodell";
import { wandmodell } from "./wandmodell";
import { lagePruefen } from "./wandpruefung";
import type { Wandwerkzeug, ZeichenflaecheGriff } from "./WandZeichenflaeche";
import { WandZeichenflaeche } from "./WandZeichenflaeche";
import type { Leitungskontext } from "../leitung/kontext";
import { Leitungsbereich } from "../leitung/Leitungsbereich";
import { useWandleitungen } from "../leitung/Wandleitungen";
import { Zeichenleiste } from "../leitung/Zeichenleiste";
import { Planungsarbeitsflaeche } from "../arbeitsflaeche/Planungsarbeitsflaeche";
import type { Arbeitsflaechenzustand } from "../arbeitsflaeche/Planungsarbeitsflaeche";
import { AnsichtMenue, HilfeDialog, LeitungHinzufuegenKnopf, Werkzeuggruppe, Werkzeugknopf, Werkzeugwahl, Zoomgruppe } from "../arbeitsflaeche/Werkzeuggruppen";
import { useKompakt } from "../arbeitsflaeche/kompakt";
import { WERKZEUGSYMBOL } from "../arbeitsflaeche/werkzeugsymbole";
import type { Ansichtsgedaechtnis } from "../arbeitsflaeche/ansichtsgedaechtnis";
import { wandSchluessel } from "../arbeitsflaeche/ansichtsgedaechtnis";
import { useStabil } from "../arbeitsflaeche/stabil";
import { Entwurfsleiste, Raumrueckmeldung, RueckgaengigKnoepfe } from "../arbeitsflaeche/Kontextleiste";


const WERKZEUGE: readonly { wert: Wandwerkzeug; label: string; taste: string; schreibend: boolean; icon: LucideIcon }[] = [
  { wert: "auswahl", label: "Auswählen", taste: "V", schreibend: false, icon: WERKZEUGSYMBOL.auswaehlen },
  { wert: "pan", label: "Ansicht verschieben", taste: "H", schreibend: false, icon: WERKZEUGSYMBOL.verschieben },
  { wert: "door", label: "Tür", taste: "T", schreibend: true, icon: WERKZEUGSYMBOL.tuer },
  { wert: "window", label: "Fenster", taste: "N", schreibend: true, icon: WERKZEUGSYMBOL.fenster },
  { wert: "passage", label: "Durchgang", taste: "D", schreibend: true, icon: WERKZEUGSYMBOL.durchgang },
  { wert: "geraet", label: "Gerät", taste: "G", schreibend: true, icon: WERKZEUGSYMBOL.geraet },
];

/** Werkzeuge der Leitungsplanung (6b.4) - nur mit offenem Leitungs- bzw. Zuordnungsentwurf. */
const LEITUNGSWERKZEUGE: readonly { wert: Wandwerkzeug; label: string; taste: string; icon: LucideIcon }[] = [
  { wert: "durchfuehrung", label: "Durchführung", taste: "U", icon: WERKZEUGSYMBOL.durchfuehrung },
  { wert: "zuordnen", label: "Zuordnen", taste: "Z", icon: WERKZEUGSYMBOL.zuordnen },
];

export interface Wandziel {
  readonly raumId: string;
  readonly wandId: string;
  /** Beim Öffnen aktives Platzierungswerkzeug (Einstieg über Tür/Fenster/Durchgang oder Gerät). */
  readonly werkzeug?: Oeffnungsart | "geraet";
  /** Beim Öffnen ausgewählte Öffnung (Einstieg über eine vorhandene Öffnung). */
  readonly oeffnungId?: string;
  /** Beim Öffnen ausgewähltes Gerät (Phase 5, etwa „An Wand bearbeiten“ aus 3D). */
  readonly geraetId?: string;
  /**
   * Betrachtete Seite (Ansichtskontext, Phase 4f): Innenseite des Raums oder
   * Außenseite. Standard: innen. Bearbeitet wird immer dieselbe Raumwand.
   */
  readonly seite?: Wandseite;
  /** Woher die Ansicht geöffnet wurde - dorthin führt das Schließen zurück. */
  readonly herkunft?: "2d" | "3d";
}

/**
 * Wandansicht (Phase 4f, ADR 0022): eine Wand frontal aus ihrem Raum,
 * maßstäblich wie auf einem Blatt.
 *
 * **Kein eigener Entwurf.** Die Ansicht arbeitet mit `zustand` und `dispatch`
 * des Grundrisseditors - derselbe Reducer, dieselbe Undo-Historie, derselbe
 * Speicherweg (`PUT …/contour`). Bearbeitbar ist nur eine Wand des aktiven
 * Raums; jede andere Wand wird gezeigt, ihre Öffnungen lassen sich über
 * „bearbeiten“ an der Quelle öffnen (mit der üblichen Rückfrage).
 */
export function Wandansicht({
  ziel,
  zustand,
  dispatch,
  raeume,
  waendeVon,
  topologie,
  einordnung,
  raumName,
  darfSchreiben,
  rasterMm,
  onRaster,
  fangAktiv,
  onFang,
  status,
  offen,
  onSpeichern,
  onVerwerfen,
  onWechseln,
  onQuelleBearbeiten,
  onSchliessen,
  typen = new Map(),
  geraeteVon = () => [],
  geraetebefunde = new Map(),
  leitungen,
  arbeitsflaeche,
  ansichten,
  geschossLabel,
}: {
  ziel: Wandziel;
  zustand: EditorZustand;
  dispatch: Dispatch<Aktion>;
  raeume: readonly RaumImPlan[];
  /** Wände eines Raums im gezeigten Stand - aktiver Raum aus dem Entwurf. */
  waendeVon: (raumId: string) => readonly EntwurfWand[];
  topologie: EditorTopologie;
  einordnung: EditorEinordnung;
  raumName: (raumId: string) => string;
  darfSchreiben: boolean;
  rasterMm: number;
  onRaster: (mm: number) => void;
  fangAktiv: boolean;
  onFang: (aktiv: boolean) => void;
  /** Speicherstatus des gemeinsamen Entwurfs - derselbe Text wie im Grundriss. */
  status: { text: string; farbe: string; speichert: boolean };
  offen: boolean;
  onSpeichern: () => void;
  onVerwerfen: () => void;
  onWechseln: (ziel: Wandziel) => void;
  /** Wechselt (mit Rückfrage) in den Quellraum und zeigt dort die Wand. */
  onQuelleBearbeiten: (ziel: Wandziel, oeffnungId: string | null) => void;
  onSchliessen: () => void;
  /** Phase 5: Gerätekatalog. */
  typen?: Geraetetypen;
  /** Geräte eines Raums im gezeigten Stand - aktiver Raum aus dem Entwurf. */
  geraeteVon?: (raumId: string) => readonly EntwurfGeraet[];
  /** Befundcodes je Gerät (lokale Prüfung und letzte Serverantwort). */
  geraetebefunde?: ReadonlyMap<string, readonly string[]>;
  /** Phase 6b.4: Leitungsplanung und Gerätezuordnung des Planungskontexts. */
  leitungen?: Leitungskontext | undefined;
  /** L1: Panel und Maximierung gehören der ganzen Planungsarbeitsfläche (geteilt mit dem Grundriss). */
  arbeitsflaeche: Arbeitsflaechenzustand;
  /** L1: Viewport je besuchter Fläche – beim Zurückkehren kein Einpassen. */
  ansichten?: Ansichtsgedaechtnis;
  /** Geschoss für den Pfad „Grundriss › Raum › Wand“. */
  geschossLabel?: string;
}) {
  const masse = useMasse();
  const [werkzeug, setWerkzeug] = useState<Wandwerkzeug>(ziel.werkzeug ?? "auswahl");
  /** Panel und Maximierung – reine Ansicht (Phase 6c.0). */
  const af = arbeitsflaeche;
  const [hilfe, setHilfe] = useState(false);
  // Beim Öffnen (und Wandwechsel) liegt der Fokus in der Fläche: Tasten wirken sofort.
  useEffect(() => {
    flaechenRef.current?.focus({ preventScroll: true });
  }, [ziel.wandId, ziel.seite]);
  const flaechenRef = useRef<HTMLElement>(null);
  const kompakt = useKompakt();
  const [statuszeile, setStatuszeile] = useState("Eine Öffnung anklicken oder ein Werkzeug wählen.");
  // Ein Wechsel des Zeichenablaufs (Escape, Dialog, Speichern, nächste Leitung) macht die Rückmeldung
  // zum vorigen Zustand ungültig (6c L2/L3); beim Zeichnen gilt dann die Anweisung der Zeichenleiste.
  const ablaufSchluessel = leitungen?.planung.ablaufSchluessel;
  const zeichnetJetzt = leitungen?.planung.ablauf != null;
  useEffect(() => {
    setStatuszeile(zeichnetJetzt ? "" : "Eine Öffnung anklicken oder ein Werkzeug wählen.");
    // Nur beim Wechsel des Ablaufs - nicht bei jeder Meldung.
  }, [ablaufSchluessel]);
  const flaeche = useRef<ZeichenflaecheGriff>(null);

  const aktiverRaum = zustand.entwurf?.roomId ?? null;
  const editierbar = darfSchreiben && aktiverRaum === ziel.raumId;
  const raum = raeume.find((r) => r.id === ziel.raumId);
  const raumhoehe =
    aktiverRaum === ziel.raumId ? (zustand.basis?.raum.effective_height_mm ?? raum?.effective_height_mm ?? 0) : (raum?.effective_height_mm ?? 0);
  const walls = waendeVon(ziel.raumId);
  const seite: Wandseite = ziel.seite ?? "innen";
  const ergebnis = useMemo(() => wandbezug(ziel.raumId, walls, ziel.wandId, raumhoehe, seite), [ziel, walls, raumhoehe, seite]);
  const wand = walls.find((w) => w.id === ziel.wandId);
  const modell = useMemo(
    () => (ergebnis.ok && wand !== undefined ? wandmodell(ergebnis.bezug, wand, topologie, einordnung) : null),
    [ergebnis, wand, topologie, einordnung],
  );
  const teilung = topologie.teilung.get(ziel.wandId);
  const raumGeraete = geraeteVon(ziel.raumId);
  const geraete = useMemo(
    () => (ergebnis.ok ? geraeteInAnsicht(ergebnis.bezug, raumGeraete, typen, geraetebefunde) : []),
    [ergebnis, raumGeraete, typen, geraetebefunde],
  );
  const andereSeite = raumGeraete.filter((g) => g.wall_id === ziel.wandId && g.mounting_surface !== flaecheDerSeite(seite)).length;
  // Typ für das Werkzeug „Gerät“ - nur Typen, die auf dieser Seite zulässig sind.
  const waehlbar = typenFuer(typen, flaecheDerSeite(seite));
  const [geraetetypWahl, setGeraetetypWahl] = useState<string | null>(null);
  const geraetetyp = waehlbar.find((t) => t.key === geraetetypWahl) ?? waehlbar[0] ?? null;

  // Auswahl: im aktiven Raum dieselbe wie im Grundriss; sonst nur hier.
  const ausGrundriss =
    zustand.auswahl?.art === "oeffnung" && zustand.auswahl.wandId === ziel.wandId
      ? zustand.auswahl.oeffnungId
      : zustand.auswahl?.art === "geraet"
        ? zustand.auswahl.geraetId
        : null;
  const [lokal, setLokal] = useState<string | null>(ziel.oeffnungId ?? ziel.geraetId ?? ausGrundriss);
  // Anderes Ziel (Gegenseite, Quelle, neuer Einstieg): Auswahl und Werkzeug neu.
  const [gezeigt, setGezeigt] = useState(ziel);
  if (gezeigt !== ziel) {
    setGezeigt(ziel);
    setLokal(ziel.oeffnungId ?? ziel.geraetId ?? ausGrundriss);
    setWerkzeug(ziel.werkzeug ?? "auswahl");
  }
  const gewaehlt = modell?.oeffnungen.some((o) => o.id === lokal) === true || geraete.some((g) => g.id === lokal) ? lokal : null;
  const gewaehltesGeraet = geraete.find((g) => g.id === gewaehlt);
  const waehlen = (id: string | null) => {
    setLokal(id);
    if (aktiverRaum !== ziel.raumId) return;
    // Eine gerade gesetzte Öffnung steht noch nicht im Modell dieses Renderlaufs;
    // sie gehört aber sicher zu dieser Wand. Abgeleitete gehören einem anderen Raum.
    const istGeraet = id !== null && (geraete.some((g) => g.id === id) || zustand.entwurf?.geraete.some((g) => g.id === id) === true);
    if (istGeraet && id !== null) {
      dispatch({ typ: "auswaehlen", auswahl: { art: "geraet", raumId: ziel.raumId, geraetId: id } });
      return;
    }
    const o = modell?.oeffnungen.find((x) => x.id === id);
    const eigen = id !== null && (o === undefined || o.eigen);
    dispatch({
      typ: "auswaehlen",
      auswahl:
        eigen && id !== null
          ? { art: "oeffnung", raumId: ziel.raumId, wandId: ziel.wandId, oeffnungId: id }
          : { art: "wand", raumId: ziel.raumId, wandId: ziel.wandId },
    });
  };

  // ------------------------------------------------------------ Geräte (Phase 5)

  /** Exakte Lage eines Geräts (Mitte in der Ansicht) - geprüft wie beim Server. */
  const geraetLageSetzen = (id: string, u: number, h: number, typKey?: string): string | undefined => {
    if (!ergebnis.ok || zustand.entwurf === null || !editierbar) return "Nur im bearbeiteten Raum änderbar.";
    const g = geraete.find((x) => x.id === id);
    const typ = typen.get(typKey ?? g?.schluessel ?? "");
    if (g === undefined || typ === undefined) return "Gerät nicht gefunden.";
    const wand = teilung?.wand;
    if (wand === undefined) return "Die Wand ist im aktuellen Stand nicht vorhanden.";
    const p = geraetLagePruefen(ergebnis.bezug, wand, teilung, typ, u, h, geraete, id);
    if (!p.ok) return p.grund;
    dispatch({
      typ: "aendern",
      entwurf: geraetAendern(zustand.entwurf, id, { center_offset_mm: p.mitte, center_height_mm: p.mittelhoehe, ...(typKey !== undefined ? { device_type_key: typKey } : {}) }),
    });
    setStatuszeile("Übernommen - noch nicht gespeichert.");
    return undefined;
  };

  const geraetEntfernenAktion = (id: string) => {
    if (zustand.entwurf === null || zustand.basis === null || !editierbar) return;
    const gespeichert = new Set(zustand.basis.entwurf.geraete.map((g) => g.id));
    dispatch({ typ: "aendern", entwurf: geraetEntfernen(zustand.entwurf, id, gespeichert) });
    waehlen(null);
    setStatuszeile("Gerät entfernt - noch nicht gespeichert.");
  };

  const geraetLabelSetzen = (id: string, label: string | null) => {
    if (zustand.entwurf === null || !editierbar) return;
    dispatch({ typ: "aendern", entwurf: geraetAendern(zustand.entwurf, id, { label }) });
    setStatuszeile("Beschriftung übernommen - noch nicht gespeichert.");
  };

  // Ohne Schreibrecht nur betrachten; ein anderes Werkzeug ist dann nicht wählbar.
  const leitungsentwurf = leitungen?.planung.entwurf ?? null;
  const zuordnungsentwurf = leitungen?.zuordnung.entwurf ?? null;
  const leitungErlaubt = leitungsentwurf !== null && leitungen?.planung.darfLeitungen === true && seite === "innen";
  const zuordnenErlaubt = zuordnungsentwurf !== null;
  useEffect(() => {
    const erlaubt =
      werkzeug === "auswahl" || werkzeug === "pan" || (werkzeug === "leitung" || werkzeug === "durchfuehrung" ? leitungErlaubt : werkzeug === "zuordnen" ? zuordnenErlaubt : editierbar);
    if (!erlaubt) setWerkzeug("auswahl");
  }, [editierbar, werkzeug, leitungErlaubt, zuordnenErlaubt]);

  const wl = useWandleitungen({
    k: leitungen,
    bezug: ergebnis.ok ? ergebnis.bezug : null,
    modell,
    geraete,
    werkzeug,
    setWerkzeug,
    fangAktiv,
    rasterMm,
    onStatus: setStatuszeile,
  });

  const gegenseiten: Gegenseite[] = useMemo(() => {
    if (teilung === undefined) return [];
    const gesehen = new Map<string, Gegenseite>();
    for (const a of teilung.abschnitte) {
      if (a.lage !== "gemeinsam" || a.mehrdeutig) continue;
      for (const q of a.quellen) {
        if (q.wand.raumId === ziel.raumId) continue;
        gesehen.set(`${q.wand.raumId}|${q.wand.id}`, { raumId: q.wand.raumId, wandId: q.wand.id });
      }
    }
    return [...gesehen.values()];
  }, [teilung, ziel.raumId]);

  const nachbarHoehe = (raumId: string) => raeume.find((r) => r.id === raumId)?.effective_height_mm ?? null;

  /** Exakte Werte - geprüft wie beim Server; unzulässig: nichts ändern, Grund nennen. */
  const rechteckSetzen = (id: string, r: Ansichtsrechteck, art?: Oeffnungsart): string | undefined => {
    if (!ergebnis.ok || zustand.entwurf === null || !editierbar) return "Nur im bearbeiteten Raum änderbar.";
    const o = modell?.oeffnungen.find((x) => x.id === id);
    if (o === undefined) return "Öffnung nicht gefunden.";
    const p = lagePruefen(ergebnis.bezug, teilung, art ?? o.art, r, { ohneOeffnungId: id, laengeText: masse.anzeigen, raumName });
    if (!p.ok) return p.grund;
    dispatch({ typ: "aendern", entwurf: oeffnungAendern(zustand.entwurf, ziel.wandId, id, { ...p.werte, ...(art !== undefined ? { kind: art } : {}) }) });
    setStatuszeile("Übernommen - noch nicht gespeichert.");
    return undefined;
  };

  const artSetzen = (id: string, art: Oeffnungsart): string | undefined => {
    const o = modell?.oeffnungen.find((x) => x.id === id);
    if (o === undefined) return undefined;
    // Wie im Grundriss: Fenster mit Brüstung (mind. 900 mm), Tür und Durchgang auf dem Boden.
    const unten = art === "window" ? Math.max(o.unten, 900) : 0;
    const grund = rechteckSetzen(id, { ...o, unten, oben: unten + (o.oben - o.unten) }, art);
    if (grund !== undefined) setStatuszeile(`Art nicht geändert: ${grund}`);
    return grund;
  };

  const entfernen = (id: string) => {
    if (zustand.entwurf === null || zustand.basis === null || !editierbar) return;
    const gespeichert = new Set(zustand.basis.entwurf.walls.flatMap((w) => w.openings.map((x) => x.id)));
    dispatch({ typ: "aendern", entwurf: oeffnungEntfernen(zustand.entwurf, ziel.wandId, id, gespeichert) });
    waehlen(null);
    setStatuszeile("Öffnung entfernt - noch nicht gespeichert.");
  };

  const quelle = (o: AnsichtsOeffnung) => onQuelleBearbeiten({ raumId: o.quelleRaumId, wandId: o.quelleWandId }, o.id);

  // Pfeiltasten: 1 cm, mit Umschalt 10 cm - jeder Druck ein Rückgängig-Schritt.
  const schieben = (du: number, dh: number) => {
    if (gewaehltesGeraet !== undefined) {
      const grund = geraetLageSetzen(gewaehltesGeraet.id, gewaehltesGeraet.u + du, gewaehltesGeraet.h + dh);
      setStatuszeile(grund === undefined ? `Verschoben: Mitte ${masse.anzeigen(gewaehltesGeraet.u + du)} von links, ${masse.anzeigen(gewaehltesGeraet.h + dh)} über Boden` : `Nicht verschoben: ${grund}`);
      return;
    }
    const o = modell?.oeffnungen.find((x) => x.id === gewaehlt);
    if (o === undefined || !o.eigen || !editierbar) return;
    if (dh !== 0 && o.art !== "window") {
      setStatuszeile("Türen und Durchgänge stehen auf dem Boden - nur waagerecht verschiebbar.");
      return;
    }
    const grund = rechteckSetzen(o.id, { links: o.links + du, rechts: o.rechts + du, unten: o.unten + dh, oben: o.oben + dh });
    setStatuszeile(grund === undefined ? `Verschoben: ${masse.anzeigen(o.links + du)} von links` : `Nicht verschoben: ${grund}`);
  };

  const taste = (event: KeyboardEvent<HTMLDivElement>) => {
    const element = event.target instanceof Element ? event.target : null;
    // Eingabefelder behalten ihre eigenen Tasten (Pfeile, Rücktaste, Strg+Z).
    const imFeld = element?.closest("input:not([type=checkbox]), textarea, select") != null;
    const strg = event.ctrlKey || event.metaKey;
    const k = event.key.toLowerCase();
    // Leitungs- oder Zuordnungsentwurf offen: seine Tasten zuerst (Strg+S auch aus einem Feld).
    if ((leitungsentwurf !== null || zuordnungsentwurf !== null) && (!imFeld || (strg && k === "s")) && wl.taste(event)) return;
    if (strg && k === "s") {
      event.preventDefault();
      onSpeichern();
      return;
    }
    if (imFeld) return;
    if (strg && k === "z" && !event.shiftKey) {
      event.preventDefault();
      dispatch({ typ: "rueckgaengig" });
      return;
    }
    if (strg && (k === "y" || (k === "z" && event.shiftKey))) {
      event.preventDefault();
      dispatch({ typ: "wiederholen" });
      return;
    }
    if (strg || event.altKey) return;
    const schritt = event.shiftKey ? 100 : 10;
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        schieben(-schritt, 0);
        return;
      case "ArrowRight":
        event.preventDefault();
        schieben(schritt, 0);
        return;
      case "ArrowUp":
        event.preventDefault();
        schieben(0, schritt);
        return;
      case "ArrowDown":
        event.preventDefault();
        schieben(0, -schritt);
        return;
      case "Delete":
      case "Backspace":
        if (gewaehltesGeraet !== undefined && editierbar) {
          event.preventDefault();
          geraetEntfernenAktion(gewaehltesGeraet.id);
          return;
        }
        if (gewaehlt !== null && modell?.oeffnungen.find((x) => x.id === gewaehlt)?.eigen === true) {
          event.preventDefault();
          entfernen(gewaehlt);
        }
        return;
      case "+":
        flaeche.current?.zoom(1.25);
        return;
      case "-":
        flaeche.current?.zoom(0.8);
        return;
    }
    const werkzeuge: Record<string, Wandwerkzeug> = { v: "auswahl", h: "pan" };
    if (editierbar) Object.assign(werkzeuge, { t: "door", n: "window", d: "passage", g: "geraet" });
    const w = werkzeuge[k];
    if (w !== undefined) setWerkzeug(w);
    else if (k === "f") flaeche.current?.ansichtZuruecksetzen();
  };

  /** Escape: erst die Bewegung, dann das Werkzeug, dann die Auswahl - zuletzt schließen. */
  const escape = (): boolean => {
    if (flaeche.current?.abbrechen() === true) return true;
    // Zeichenablauf (6c, L2): Vorschau, Punktauswahl, Einfügen, zuletzt das Werkzeug - nie der Entwurf.
    if (wl.escape()) return true;
    if (werkzeug !== "auswahl") {
      setWerkzeug("auswahl");
      return true;
    }
    if (leitungsentwurf !== null && leitungsentwurf.auswahl !== null) {
      leitungen?.planung.dispatch({ typ: "auswaehlen", auswahl: null });
      return true;
    }
    if (wl.gewaehlt !== null) {
      wl.setGewaehlt(null);
      return true;
    }
    if (gewaehlt !== null) {
      waehlen(null);
      return true;
    }
    // Zuletzt: überlagerndes Eigenschaftenpanel, dann die Maximierung (Phase 6c.0).
    return af.escape();
  };

  const titel = `Wandansicht · Wand ${ergebnis.ok ? ergebnis.bezug.wandNummer : ""} · ${raumName(ziel.raumId)}${
    seite === "aussen" ? " · Außenseite" : ""
  }`;
  // Die Außenseite ist nur dort eine Fassade, wo die Wand an keinen anderen Raum grenzt.
  const hatFassade = modell?.abschnitte.some((a) => a.nachbarn.length === 0) === true;
  const seitenname = seite === "innen" ? `Innenseite – ${raumName(ziel.raumId)}` : hatFassade ? "Außenseite – Fassade" : "Außenseite";
  // Ein Gerät gehört zu seiner Seite; beim Seitenwechsel bleibt nur eine Öffnung gewählt.
  const gewaehlteOeffnung = gewaehltesGeraet === undefined ? gewaehlt : null;
  const seiteWechseln = () => onWechseln({ raumId: ziel.raumId, wandId: ziel.wandId, seite: seite === "innen" ? "aussen" : "innen", ...(ziel.herkunft !== undefined ? { herkunft: ziel.herkunft } : {}), ...(gewaehlteOeffnung !== null ? { oeffnungId: gewaehlteOeffnung } : {}) });

  const zurueckText = ziel.herkunft === "3d" ? "Zurück zur 3D-Ansicht" : "Zurück zum Grundriss";
  const kopfzeile = (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <h2 className="sr-only">{titel}</h2>
      <nav className="flex flex-wrap items-center gap-1.5 text-small" aria-label="Pfad">
        {/* Schmal nur das Symbol – Name und Hinweis bleiben („Zurück zum Grundriss“, Escape). */}
        <button
          type="button"
          className={knopf("neutral", { klein: true })}
          onClick={onSchliessen}
          title={`${zurueckText} (Escape)`}
          aria-label={kompakt ? zurueckText : undefined}
        >
          {kompakt ? <Symbol icon={AKTION.zurueck} /> : <MitSymbol icon={AKTION.zurueck}>{zurueckText}</MitSymbol>}
        </button>
        <span className="text-muted">{ziel.herkunft === "3d" ? "3D-Ansicht" : `Grundriss${geschossLabel !== undefined && !kompakt ? ` · ${geschossLabel}` : ""}`}</span>
        <Symbol icon={AKTION.pfadTrenner} />
        <span className="text-muted">{raumName(ziel.raumId)}</span>
        <Symbol icon={AKTION.pfadTrenner} />
        <span className="font-semibold" aria-current="page">
          Wand {ergebnis.ok ? ergebnis.bezug.wandNummer : ""}
        </span>
      </nav>
      <span className="flex flex-wrap items-center gap-x-3" role="status" aria-live="polite">
        <strong data-testid="wandseite">{seitenname}</strong>
        <span className={kompakt ? "sr-only" : "text-muted"}>
          {seite === "innen" ? `Blick aus Raum „${raumName(ziel.raumId)}“` : "Blick von außen auf die Wand"}
          {ergebnis.ok ? ` · im Grundriss ${ergebnis.bezug.blick}` : ""}
        </span>
        {ergebnis.ok && (
          <button
            type="button"
            className={knopf("neutral", { klein: true })}
            onClick={seiteWechseln}
            aria-label={kompakt ? (seite === "innen" ? "Außenseite ansehen" : "Innenseite ansehen") : undefined}
          >
            {seite === "innen" ? (kompakt ? "Außenseite" : "Außenseite ansehen") : kompakt ? "Innenseite" : "Innenseite ansehen"}
          </button>
        )}
        <span className={`text-small font-semibold ${status.farbe}`}>
          {leitungsentwurf !== null
            ? `Leitungsentwurf: ${leitungen?.planung.ungespeichert === true ? "ungespeichert" : "gespeichert"}`
            : zuordnungsentwurf !== null
              ? `Gerätezuordnung: ${leitungen?.zuordnung.offen === true ? "ungespeichert" : "gespeichert"}`
              : editierbar
                ? status.text
                : "Nur Ansicht"}
        </span>
      </span>
      {darfSchreiben && aktiverRaum !== null && (
        <span className="flex flex-wrap gap-2">
          <button type="button" className={knopf("primaer", { klein: true })} disabled={!offen || status.speichert} onClick={onSpeichern} title="Speichert den gemeinsamen Entwurf (Strg+S)">
            Speichern
          </button>
          <button
            type="button"
            className={knopf("neutral", { klein: true })}
            disabled={!offen || status.speichert}
            onClick={onVerwerfen}
            aria-label={kompakt ? "Änderungen verwerfen" : undefined}
          >
            {kompakt ? "Verwerfen" : "Änderungen verwerfen"}
          </button>
        </span>
      )}
    </div>
  );
  // „Leitung hinzufügen“ (6c, L2): direkt zeichnen – 1 Startgerät anklicken. Kein Panel, keine Stromkreiswahl.
  const leitungMoeglich = leitungen !== undefined && leitungen.planung.darfLeitungen && seite === "innen";
  const zeichnet = leitungen?.planung.ablauf != null;
  const leitungHinzufuegen = useStabil(() => {
    if (leitungen === undefined) return;
    setWerkzeug("auswahl");
    setStatuszeile(leitungen.leitungZeichnen() ?? "1 Startgerät wählen – auf ein markiertes Gerät klicken.");
  });
  /** Ein anderes Werkzeug beendet den Zeichenablauf (der Entwurf bleibt); Durchführung und Zuordnen ergänzen ihn. */
  const werkzeugWaehlen = useStabil((w: Wandwerkzeug) => {
    if (w !== "durchfuehrung" && w !== "zuordnen" && leitungen?.planung.ablauf != null) leitungen.planung.ablaufBeenden();
    setWerkzeug(w);
  });
  const rueckgaengig = useStabil(() => (leitungsentwurf !== null ? leitungen?.planung.dispatch({ typ: "rueckgaengig" }) : dispatch({ typ: "rueckgaengig" })));
  const wiederholen = useStabil(() => (leitungsentwurf !== null ? leitungen?.planung.dispatch({ typ: "wiederholen" }) : dispatch({ typ: "wiederholen" })));
  const kannZurueck = leitungsentwurf !== null ? leitungsentwurf.zurueck.length > 0 : zustand.zurueck.length > 0;
  const kannVor = leitungsentwurf !== null ? leitungsentwurf.vor.length > 0 : zustand.vor.length > 0;
  const hatLeitungsentwurf = leitungsentwurf !== null;
  const hatZuordnungsentwurf = zuordnungsentwurf !== null;
  const typKey = geraetetyp?.key ?? null;
  const werkzeugknopf = (w: { wert: Wandwerkzeug; label: string; taste: string; icon: LucideIcon }) => (
    <Werkzeugknopf key={w.wert} label={w.label} taste={w.taste} icon={w.icon} aktiv={werkzeug === w.wert && !(zeichnet && w.wert === "auswahl")} onClick={() => werkzeugWaehlen(w.wert)} />
  );
  // Gemerkt (L1): Die Leiste zeichnet nur bei sichtbaren Änderungen neu, nicht bei jeder Zeigerbewegung.
  const werkzeugleiste = useMemo(() => (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5" role="toolbar" aria-label="Werkzeuge der Wandansicht">
      <Werkzeuggruppe label="Auswahl">{WERKZEUGE.filter((w) => !w.schreibend).map(werkzeugknopf)}</Werkzeuggruppe>
      {editierbar && (
        <>
          <Werkzeugwahl
            gruppe="Öffnung"
            menueLabel="Öffnung setzen"
            icon={WERKZEUGSYMBOL.tuer}
            werkzeuge={WERKZEUGE.filter((w) => w.wert === "door" || w.wert === "window" || w.wert === "passage").map((w) => ({
              label: w.label,
              taste: w.taste,
              icon: w.icon,
              aktiv: werkzeug === w.wert,
              onClick: () => werkzeugWaehlen(w.wert),
            }))}
          />
          <Werkzeuggruppe label="Gerät">
            {WERKZEUGE.filter((w) => w.wert === "geraet").map(werkzeugknopf)}
            {werkzeug === "geraet" && (
              <div className="min-w-[200px]">
                <TypAuswahl
                  id="wand-werkzeug-typ"
                  label={seite === "innen" ? "Gerät für die Innenseite" : "Gerät für die Fassade"}
                  typen={typen}
                  flaeche={flaecheDerSeite(seite)}
                  wert={typKey}
                  onWahl={setGeraetetypWahl}
                />
              </div>
            )}
          </Werkzeuggruppe>
        </>
      )}
      {(leitungMoeglich || zuordnenErlaubt) && (
        <Werkzeuggruppe label="Leitung">
          {!hatZuordnungsentwurf && leitungMoeglich && <LeitungHinzufuegenKnopf aktiv={zeichnet} gesperrtGrund={null} onClick={leitungHinzufuegen} />}
          {LEITUNGSWERKZEUGE.filter((w) => (w.wert === "zuordnen" ? zuordnenErlaubt : leitungErlaubt)).map(werkzeugknopf)}
        </Werkzeuggruppe>
      )}
      {(hatLeitungsentwurf || editierbar) && (
        <Werkzeuggruppe label="Verlauf">
          <RueckgaengigKnoepfe
            kannZurueck={kannZurueck}
            kannVor={kannVor}
            onZurueck={rueckgaengig}
            onVor={wiederholen}
            {...(hatLeitungsentwurf ? { bezug: "im Leitungsentwurf" } : {})}
          />
        </Werkzeuggruppe>
      )}
      <Zoomgruppe onZoom={(f) => flaeche.current?.zoom(f)} onGanz={() => flaeche.current?.ansichtZuruecksetzen()} ganzHinweis="Ganze Wand zeigen" />
      <AnsichtMenue fangAktiv={fangAktiv} onFang={onFang} fangLabel="Einrasten" rasterMm={rasterMm} onRaster={onRaster} onHilfe={() => setHilfe(true)} />
    </div>
    // Rückrufe sind stabil (Zustandssetzer, `useStabil`); abhängig ist die Leiste nur von dem, was sie zeigt.
  ), [werkzeug, editierbar, seite, typen, typKey, leitungMoeglich, zeichnet, hatLeitungsentwurf, hatZuordnungsentwurf, zuordnenErlaubt, leitungErlaubt, kannZurueck, kannVor, fangAktiv, rasterMm, onFang, onRaster]);

  const hilfeInhalt = (
    <>
      <ul className="pl-[18px]">
        <li>Links und rechts gelten so, wie man vor der betrachteten Seite steht – innen im Raum, außen vor der Fassade. Ein Seitenwechsel verschiebt keine Öffnung.</li>
        <li>Tür (T), Fenster (N), Durchgang (D): Vorschau folgt dem Zeiger, ein Klick setzt die Öffnung mit Standardmaßen.</li>
        <li>Öffnung ziehen verschiebt sie (Fenster auch in der Höhe); die Griffe ändern Breite, Höhe und Brüstung.</li>
        <li>Einrasten an Wandkanten, Wandmitte, Kanten und Mitten anderer Öffnungen, gleicher Brüstung und Oberkante, sonst am Raster. Alt hält es beim Ziehen aus.</li>
        <li>Pfeiltasten verschieben die gewählte Öffnung um 1 cm, mit Umschalt um 10 cm. Entf entfernt sie, Escape bricht ab.</li>
        <li>Gerät (G): Typ wählen, Vorschau folgt dem Zeiger, ein Klick setzt es auf genau dieser Seite. Ziehen verschiebt es; Pfeiltasten 1 cm, mit Umschalt 10 cm; Entf entfernt es. Eingerastet wird an Wandmitte, Kanten, Achsen anderer Geräte, der Standardhöhe des Typs, Boden und Decke.</li>
        <li>Innen und außen sind getrennte Montageflächen: Ein Gerät außen bleibt außen, der Seitenwechsel der Ansicht ändert nichts.</li>
        <li>Strg+Z / Strg+Y gelten für den gemeinsamen Entwurf mit dem Grundriss. Schließen behält alle Änderungen – gespeichert wird nur mit „Speichern“.</li>
      </ul>
      <p className="m-0">Escape beendet zuerst die laufende Bewegung, dann das Werkzeug und die Auswahl, schließt ein überlagerndes Panel, beendet die Maximierung und führt zuletzt zurück zum Grundriss.</p>
      <h3 className="mt-3 text-small">Legende der Gerätesymbole</h3>
      <Geraetelegende typen={typen} />
    </>
  );

  return (
    // L1: keine modale Oberfläche mehr – die Wandfläche steht an Ort und Stelle in der Arbeitsfläche.
    <section ref={flaechenRef} aria-label={titel} tabIndex={-1} className="outline-none" data-flaeche="wand">
      <div
        className="flex flex-col gap-2"
        onKeyDown={(event) => {
          // Escape: Bewegung → Werkzeug → Auswahl → Panel/Maximierung → zurück. Eine Wirkung je Druck.
          if (event.key === "Escape" && !event.defaultPrevented) {
            event.preventDefault();
            if (!escape()) onSchliessen();
            return;
          }
          taste(event);
        }}
      >
        {!ergebnis.ok || modell === null ? (
          <>
            {kopfzeile}
            {werkzeugleiste}
          <p className={meldungsflaeche()} role="alert">
            {ergebnis.ok ? "Diese Wand gibt es im aktuellen Stand nicht." : ergebnis.grund}
          </p>
          </>
        ) : (
          <Planungsarbeitsflaeche
            zustand={af}
            name="Arbeitsfläche Wand"
            eigenschaftenTitel="Eigenschaften der Wand"
            markierung={leitungsentwurf !== null ? "Leitung" : zuordnungsentwurf !== null ? "Zuordnung" : null}
            kopf={kopfzeile}
            werkzeuge={werkzeugleiste}
            kontext={
              <div className="flex flex-col gap-1.5">
              {/* Feste Höhe: Die Fläche springt nicht, wenn der Text wechselt. Beim Zeichnen steht die
                  Rückmeldung in der Zeichenleiste - eine Zeile statt zwei Stellen. */}
              {!zeichnetJetzt && (
                <p className="m-0 h-11 overflow-hidden text-[0.82rem] text-muted" aria-live="polite" data-testid="wand-statuszeile">
                  {statuszeile}
                </p>
              )}
                {seite === "aussen" && leitungsentwurf !== null && (
                  <p className={`${meldungsflaeche("schlicht")} m-0 mb-2`}>
                    Leitungen werden innen geplant – Außenleitungen sind nicht vorgesehen. Mit „Innenseite ansehen“ weiterzeichnen.
                  </p>
                )}
              {!editierbar && aktiverRaum !== ziel.raumId && (
                <div className={`${meldungsflaeche("schlicht")} mb-2`}>
                  <p className="m-0">
                    Diese Wand gehört zu „{raumName(ziel.raumId)}“. Bearbeitet wird gerade{" "}
                    {aktiverRaum === null ? "kein Raum" : `„${raumName(aktiverRaum)}“`}.
                  </p>
                  {darfSchreiben && (
                    <button type="button" className={`${knopf()} mt-2`} onClick={() => onQuelleBearbeiten(ziel, gewaehlt)}>
                      „{raumName(ziel.raumId)}“ bearbeiten
                    </button>
                  )}
                </div>
              )}
                <Raumrueckmeldung fehler={zustand.serverFehler} konflikt={zustand.status === "konflikt"} onSchliessen={() => dispatch({ typ: "hinweis-schliessen" })} />
                {leitungen !== undefined && (
                  <Zeichenleiste k={leitungen} flaeche={{ art: "wand", raumId: ziel.raumId, wandId: ziel.wandId, seite }} meldung={statuszeile} meldungTestId="wand-statuszeile" />
                )}
                <Entwurfsleiste k={leitungen} panelOffen={af.eigenschaftenOffen} onDetails={() => af.setEigenschaftenOffen(true)} nachSchliessen={() => setWerkzeug("auswahl")} />
              </div>
            }
            eigenschaften={
              <>
                {leitungen !== undefined && (
                  <div className="mb-2">
                    <Leitungsbereich
                      k={leitungen}
                      flaeche={{ art: "wand", raumId: ziel.raumId, wandId: ziel.wandId, seite }}
                      bezug={ergebnis.ok ? ergebnis.bezug : undefined}
                      relevant={wl.relevant}
                      gewaehlt={wl.gewaehlt}
                      onWaehlen={wl.setGewaehlt}
                      gewaehlteDurchfuehrung={wl.gewaehlteDurchfuehrung}
                      onDurchfuehrung={wl.setDurchfuehrungId}
                      onWerkzeug={(w) => setWerkzeug(w === "leitung" && seite === "aussen" ? "auswahl" : w)}
                    />
                  </div>
                )}
                <GeraetEigenschaften
                  bezug={ergebnis.bezug}
                  geraete={geraete}
                  gewaehlt={gewaehlt}
                  typen={typen}
                  editierbar={editierbar}
                  andereSeite={andereSeite}
                  onWaehlen={waehlen}
                  onLage={(id, u, h) => geraetLageSetzen(id, u, h)}
                  onTyp={(id, key) => {
                    const g = geraete.find((x) => x.id === id);
                    return g === undefined ? "Gerät nicht gefunden." : geraetLageSetzen(id, g.u, g.h, key);
                  }}
                  onLabel={geraetLabelSetzen}
                  onEntfernen={geraetEntfernenAktion}
                />
                <WandEigenschaften
                  bezug={ergebnis.bezug}
                  modell={modell}
                  raumName={raumName}
                  editierbar={editierbar}
                  gewaehlt={gewaehlt}
                  onWaehlen={waehlen}
                  onRechteck={(id, r) => rechteckSetzen(id, r)}
                  onArt={artSetzen}
                  onEntfernen={entfernen}
                  einordnung={einordnung}
                  nachbarHoehe={nachbarHoehe}
                  gegenseiten={gegenseiten}
                  onGegenseite={(g) => {
                    setLokal(null);
                    onWechseln(g);
                  }}
                  onQuelle={quelle}
                />
              </>
            }
          >
            <WandZeichenflaeche
              key={wandSchluessel(ziel.wandId, seite)}
              gemerkt={ansichten?.lesen(wandSchluessel(ziel.wandId, seite)) ?? null}
              onAnsicht={(ansicht) => ansichten?.merken(wandSchluessel(ziel.wandId, seite), ansicht)}
              griff={flaeche}
              bezug={ergebnis.bezug}
              modell={modell}
              teilung={teilung}
              entwurf={editierbar ? zustand.entwurf : null}
              dispatch={dispatch}
              editierbar={editierbar}
              werkzeug={werkzeug}
              onWerkzeug={setWerkzeug}
              gewaehlt={gewaehlt}
              onWaehlen={waehlen}
              rasterMm={rasterMm}
              fangAktiv={fangAktiv}
              raumName={raumName}
              nachbarHoehe={nachbarHoehe}
              onStatus={setStatuszeile}
              geraete={geraete}
              geraetetyp={geraetetyp}
              zusatz={leitungen !== undefined ? wl.zusatz : undefined}
            />
          </Planungsarbeitsflaeche>
        )}
      </div>
      <HilfeDialog offen={hilfe} titel="Wandfläche – Bedienung und Legende" onClose={() => setHilfe(false)}>
        {hilfeInhalt}
      </HilfeDialog>
    </section>
  );
}
