import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";

import { AKTION } from "../../../core/ui/aktionssymbole";
import { MitSymbol, Symbol } from "../../../core/ui/Symbol";
import { useMasse } from "../../../core/ui/masseinheit";
import { knopf, meldungsflaeche } from "../../../core/ui/stil";
import "../darstellung.css";
import "../wandansicht/wandansicht.css";
import type { EntwurfGeraet, EntwurfWand } from "../editor/entwurf";
import { neueId } from "../editor/entwurf";
import type { Bildpunkt, Groesse, Viewport } from "../editor/viewport";
import { bildZuWelt, einpassen, grenzenVon, groesseAendern, sichtbareGrenzen, verschieben, weltZuBild, zoomen } from "../editor/viewport";
import type { Aktion, EditorZustand } from "../editor/zustand";
import { befundText } from "../geraete/geraetepruefung";
import { geraetAendern, geraetEinfuegen, geraetEntfernen, neuesDeckengeraet } from "../geraete/geraeteentwurf";
import type { Geraetetyp, Geraetetypen } from "../geraete/katalog";
import { typenFuer } from "../geraete/katalog";
import { Geraetelegende, Geraetesymbol, SymbolImPlan } from "../geraete/symbole";
import { flaecheText } from "../editor/Eigenschaften";
import { BeschriftungsFeld, TypFeld } from "../wandansicht/GeraetEigenschaften";
import { Geraetekatalog } from "../geraete/Geraetekatalog";
import type { Katalogmodus, Verteilungsangebot } from "../geraete/Geraetekatalog";
import { MassFeld } from "../wandansicht/WandEigenschaften";
import type { Fangziel } from "../wandansicht/wandfang";
import type { AnsichtsDeckengeraet, Richtung, Wandtreffer } from "./deckengeraete";
import { deckengeraeteAus, deckenlage, deckenlagePruefen, wandabstaende } from "./deckengeraete";
import { deckenmodell, imRaum, naechsteWand } from "./deckenmodell";
import { useDeckenleitungen } from "../leitung/Deckenleitungen";
import { Zeichenleiste } from "../leitung/Zeichenleiste";
import type { Leitungskontext } from "../leitung/kontext";
import { Leitungsbereich } from "../leitung/Leitungsbereich";
import { Planungsarbeitsflaeche } from "../arbeitsflaeche/Planungsarbeitsflaeche";
import type { Arbeitsflaechenzustand } from "../arbeitsflaeche/Planungsarbeitsflaeche";
import { AnsichtMenue, HilfeDialog, LeitungHinzufuegenKnopf, Werkzeuggruppe, Werkzeugknopf, Zoomgruppe } from "../arbeitsflaeche/Werkzeuggruppen";
import { useKompakt } from "../arbeitsflaeche/kompakt";
import { WERKZEUGSYMBOL } from "../arbeitsflaeche/werkzeugsymbole";
import type { Ansichtsgedaechtnis } from "../arbeitsflaeche/ansichtsgedaechtnis";
import { deckenSchluessel } from "../arbeitsflaeche/ansichtsgedaechtnis";
import { useStabil } from "../arbeitsflaeche/stabil";
import { Entwurfsleiste, Raumrueckmeldung, RueckgaengigKnoepfe } from "../arbeitsflaeche/Kontextleiste";

const LISTENKNOPF = `${knopf()} w-full text-left`;
const LISTENKNOPF_GEWAEHLT = `${knopf("gewaehlt")} w-full text-left`;
const RUECKFALL: Groesse = { breite: 900, hoehe: 520 };

type Deckenwerkzeug = "auswahl" | "pan" | "geraet" | "leitung" | "zuordnen";

const RICHTUNG_LABEL: Record<Richtung, string> = { links: "links", rechts: "rechts", oben: "oben", unten: "unten" };

interface Laufend {
  readonly art: "pan" | "bewegen" | "platzieren" | "zusatz";
  readonly pointerId: number;
  readonly element: Element;
  readonly startBild: Bildpunkt;
  readonly startViewport: Viewport;
  readonly geraetId?: string;
  readonly start?: { x: number; y: number };
  gueltig?: boolean;
  vorherX?: string | null;
  vorherY?: string | null;
}

interface Vorschau {
  readonly typ: Geraetetyp;
  readonly x: number;
  readonly y: number;
  readonly ok: boolean;
  readonly grund: string | null;
  readonly zielX: Fangziel | null;
  readonly zielY: Fangziel | null;
  readonly geraetId: string | null;
}

/**
 * Deckenansicht eines Raums (Phase 4f, ADR 0022; Geräte seit Phase 5, ADR 0023).
 *
 * Reale Raumkontur in Grundrissausrichtung (Deckenspiegel, nicht gespiegelt).
 * Deckengeräte werden hier gesetzt, verschoben, bearbeitet und entfernt - im
 * **gemeinsamen Entwurf** des Grundrisseditors (derselbe Reducer, dieselbe
 * Undo-Historie, derselbe Speicherweg). Geprüft wird gegen die echte Kontur,
 * nicht gegen ein umschließendes Rechteck. Deckengeräte haben keine eigene
 * Höhe: Sie sitzen auf der Deckenhöhe des Raums und folgen jeder Änderung.
 */
export function Deckenansicht({
  raumId,
  raumName,
  walls,
  deckenhoeheMm,
  eigeneHoehe,
  rasterMm,
  onRaster,
  onSchliessen,
  zustand,
  dispatch,
  typen = new Map(),
  geraete = [],
  geraetebefunde = new Map(),
  editierbar = false,
  fangAktiv = true,
  onFang,
  status,
  offen = false,
  onSpeichern,
  onVerwerfen,
  startGeraetId,
  leitungen,
  arbeitsflaeche,
  ansichten,
  geschossLabel,
  zurueckZu3d = false,
  startTyp = null,
  verteilungsangebot,
}: {
  raumId?: string;
  raumName: string;
  walls: readonly EntwurfWand[];
  deckenhoeheMm: number;
  /** `true`: eigene Raumhöhe, `false`: geerbt vom Geschoss. */
  eigeneHoehe: boolean;
  rasterMm: number;
  onRaster: (mm: number) => void;
  onSchliessen: () => void;
  /** Phase 5: gemeinsamer Entwurf des Grundrisseditors. */
  zustand?: EditorZustand;
  dispatch?: Dispatch<Aktion>;
  typen?: Geraetetypen;
  /** Geräte dieses Raums im gezeigten Stand (aktiver Raum aus dem Entwurf). */
  geraete?: readonly EntwurfGeraet[];
  geraetebefunde?: ReadonlyMap<string, readonly string[]>;
  /** Darf hier bearbeitet werden (Schreibrecht und aktiver Raum)? */
  editierbar?: boolean;
  fangAktiv?: boolean;
  onFang?: (aktiv: boolean) => void;
  status?: { text: string; farbe: string; speichert: boolean };
  offen?: boolean;
  onSpeichern?: () => void;
  onVerwerfen?: () => void;
  /** Beim Öffnen ausgewähltes Gerät (etwa „An Decke bearbeiten“ aus 3D). */
  startGeraetId?: string | null;
  /** Phase 6b.4: Leitungsplanung und Gerätezuordnung des Planungskontexts. */
  leitungen?: Leitungskontext | undefined;
  /** L1: Panel und Maximierung gehören der ganzen Planungsarbeitsfläche (geteilt mit dem Grundriss). */
  arbeitsflaeche: Arbeitsflaechenzustand;
  /** L1: Viewport je besuchter Fläche – beim Zurückkehren kein Einpassen. */
  ansichten?: Ansichtsgedaechtnis;
  geschossLabel?: string;
  /** Aus 3D geöffnet: Der Rückweg führt dorthin. */
  zurueckZu3d?: boolean;
  /** K1: im Grundriss aus dem Gerätekatalog gewählter Typ – das Werkzeug „Gerät“ ist dann aktiv. */
  startTyp?: string | null;
  /** K1: „Verteilung platzieren …“ im Katalog – an der Decke gesperrt, mit Grund. */
  verteilungsangebot?: Verteilungsangebot | undefined;
}) {
  const masse = useMasse();
  const huelle = useRef<HTMLDivElement>(null);
  const flaeche = useRef<SVGSVGElement>(null);
  const [groesse, setGroesse] = useState<Groesse>(RUECKFALL);
  const groesseRef = useRef(groesse);
  const grenzen = useMemo(() => grenzenVon(walls.flatMap((w) => [{ x: w.x1_mm, y: w.y1_mm }, { x: w.x2_mm, y: w.y2_mm }])), [walls]);
  const [viewport, setViewport] = useState<Viewport>(() => einpassen(grenzen, RUECKFALL, 56));
  const [zeiger, setZeiger] = useState<string>("Zeiger über die Decke bewegen.");
  // Wie in der Wandansicht: Ein Ablaufwechsel verwirft die Rückmeldung zum vorigen Zustand (6c L2/L3).
  const ablaufSchluessel = leitungen?.planung.ablaufSchluessel;
  const zeichnetJetzt = leitungen?.planung.ablauf != null;
  useEffect(() => {
    setZeiger(zeichnetJetzt ? "" : "Zeiger über die Decke bewegen.");
    // Nur beim Wechsel des Ablaufs - nicht bei jeder Meldung.
  }, [ablaufSchluessel]);
  const [werkzeug, setWerkzeug] = useState<Deckenwerkzeug>(startTyp !== null && editierbar ? "geraet" : "auswahl");
  // Gerätekatalog (K1): Platzieren mit dem Werkzeug „Gerät“ oder „Typ ändern …“ eines Geräts.
  const [katalog, setKatalog] = useState<{ modus: Katalogmodus; geraetId: string | null } | null>(null);
  /** Panel und Maximierung – reine Ansicht (Phase 6c.0). */
  const af = arbeitsflaeche;
  const [hilfe, setHilfe] = useState(false);
  const flaechenRef = useRef<HTMLElement>(null);
  const kompakt = useKompakt();
  const schluessel = deckenSchluessel(raumId ?? raumName);
  const gemerktRef = useRef(ansichten?.lesen(schluessel) ?? null);
  // Beim Öffnen liegt der Fokus in der Fläche: Tasten wirken sofort.
  useEffect(() => {
    flaechenRef.current?.focus({ preventScroll: true });
  }, []);
  const [gewaehlt, setGewaehlt] = useState<string | null>(startGeraetId ?? null);
  const [vorschau, setVorschau] = useState<Vorschau | null>(null);
  const [typWahl, setTypWahl] = useState<string | null>(startTyp);
  const laufend = useRef<Laufend | null>(null);
  // Beschriftung 14 px ins Rauminnere - in Millimetern des aktuellen Maßstabs.
  const modell = useMemo(() => deckenmodell(walls, 16 / viewport.massstab), [walls, viewport.massstab]);
  const deckengeraete = useMemo(() => deckengeraeteAus(geraete, typen, geraetebefunde), [geraete, typen, geraetebefunde]);
  const waehlbar = typenFuer(typen, "ceiling");
  const geraetetyp = waehlbar.find((t) => t.key === typWahl) ?? waehlbar[0] ?? null;
  const entwurf = zustand?.entwurf ?? null;
  const darfAendern = editierbar && dispatch !== undefined && entwurf !== null;
  const gewaehltesGeraet = deckengeraete.find((g) => g.id === gewaehlt);

  const zuruecksetzen = () => setViewport(einpassen(grenzen, groesseRef.current, 56));
  // Jeden Viewport melden – beim Verlassen ist der letzte gemerkt (nur Ansicht). Nie den
  // ungemessenen Startwert: Er überschriebe den gemerkten Ausschnitt (erneutes Einhängen, StrictMode).
  const startwert = useRef(viewport);
  useEffect(() => {
    if (viewport === startwert.current) return;
    const ansicht = { viewport, groesse: groesseRef.current };
    gemerktRef.current = ansicht;
    ansichten?.merken(schluessel, ansicht);
  }, [viewport, groesse, ansichten, schluessel]);

  useEffect(() => {
    const element = huelle.current;
    if (element === null) return undefined;
    let erstesMal = true;
    const messen = () => {
      const r = element.getBoundingClientRect();
      const neu = r.width > 0 && r.height > 0 ? { breite: r.width, hoehe: r.height } : RUECKFALL;
      const alt = groesseRef.current;
      if (!erstesMal && alt.breite === neu.breite && alt.hoehe === neu.hoehe) return;
      groesseRef.current = neu;
      setGroesse(neu);
      // Nicht verbrauchen: Im StrictMode läuft dieser Effekt beim Einhängen zweimal.
      const gemerkt = gemerktRef.current;
      // Den Wert jetzt festhalten: Der Updater läuft erst später, dann ist `erstesMal` schon false.
      const erste = erstesMal;
      setViewport((v) =>
        erste
          ? // Zurück auf einer besuchten Decke: deren Ausschnitt, an die jetzige Größe angepasst – kein Einpassen.
            gemerkt !== null
            ? groesseAendern(gemerkt.viewport, gemerkt.groesse, neu)
            : einpassen(grenzen, neu, 56)
          : groesseAendern(v, alt, neu),
      );
      erstesMal = false;
    };
    messen();
    if (typeof ResizeObserver === "undefined") return undefined;
    const b = new ResizeObserver(messen);
    b.observe(element);
    return () => b.disconnect();
  }, [grenzen]);

  useEffect(() => {
    const svg = flaeche.current;
    if (svg === null) return undefined;
    const rad = (event: WheelEvent) => {
      event.preventDefault();
      const r = svg.getBoundingClientRect();
      setViewport((v) => zoomen(v, Math.exp(-event.deltaY * 0.0015), { x: event.clientX - r.left, y: event.clientY - r.top }));
    };
    svg.addEventListener("wheel", rad, { passive: false });
    return () => svg.removeEventListener("wheel", rad);
  }, []);

  const leitungsentwurf = leitungen?.planung.entwurf ?? null;
  const zuordnungsentwurf = leitungen?.zuordnung.entwurf ?? null;
  const leitungErlaubt = leitungsentwurf !== null && leitungen?.planung.darfLeitungen === true;
  const zuordnenErlaubt = zuordnungsentwurf !== null;
  // Ohne Bearbeitungsrecht nur betrachten; Leitungswerkzeuge nur mit ihrem Entwurf.
  useEffect(() => {
    if ((!darfAendern && werkzeug === "geraet") || (werkzeug === "leitung" && !leitungErlaubt) || (werkzeug === "zuordnen" && !zuordnenErlaubt)) {
      setWerkzeug("auswahl");
    }
  }, [darfAendern, werkzeug, leitungErlaubt, zuordnenErlaubt]);

  const dl = useDeckenleitungen({
    k: leitungen,
    raumId,
    waende: modell.waende,
    geraete: deckengeraete,
    werkzeug,
    setWerkzeug,
    fangAktiv,
    rasterMm,
    onStatus: setZeiger,
  });
  const zusatz = leitungen !== undefined ? dl.zusatz : undefined;
  const zusatzRef = useRef(zusatz);
  zusatzRef.current = zusatz;
  // Beim Schließen darf auch keine Bewegung der Leitungsebene hängen bleiben (sie kennt ihren Stand selbst).
  useEffect(() => () => void zusatzRef.current?.abbrechen(), []);

  // Beim Schließen darf keine Bewegung hängen bleiben.
  useEffect(
    () => () => {
      if (laufend.current?.art === "bewegen") dispatch?.({ typ: "ziehen-abbrechen" });
      laufend.current = null;
    },
    [dispatch],
  );

  const zoom = (f: number) => setViewport((v) => zoomen(v, f, { x: groesseRef.current.breite / 2, y: groesseRef.current.hoehe / 2 }));
  const bild = (event: ReactPointerEvent) => {
    const r = flaeche.current?.getBoundingClientRect();
    return { x: event.clientX - (r?.left ?? 0), y: event.clientY - (r?.top ?? 0) };
  };

  const waehlen = (id: string | null) => {
    setGewaehlt(id);
    if (dispatch !== undefined && raumId !== undefined && entwurf?.roomId === raumId) {
      dispatch({ typ: "auswaehlen", auswahl: id === null ? { art: "raum", raumId } : { art: "geraet", raumId, geraetId: id } });
    }
  };

  const vorschauFuer = (typ: Geraetetyp, rohX: number, rohY: number, altKey: boolean, ohne: string | null, l?: Laufend | null): Vorschau => {
    const andere = deckengeraete.filter((g) => g.id !== ohne);
    const lage = deckenlage(rohX, rohY, typ, modell.waende, andere, {
      aktiv: fangAktiv,
      ausgesetzt: altKey,
      massstab: viewport.massstab,
      rasterMm,
      vorherX: l?.vorherX ?? null,
      vorherY: l?.vorherY ?? null,
    });
    let { x, y } = lage;
    let zielX = lage.zielX;
    let zielY = lage.zielY;
    let p = deckenlagePruefen(typ, x, y, modell.waende, andere, ohne ?? undefined);
    if (!p.ok && (zielX !== null || zielY !== null)) {
      const fx = Math.round(rohX);
      const fy = Math.round(rohY);
      const p2 = deckenlagePruefen(typ, fx, fy, modell.waende, andere, ohne ?? undefined);
      if (p2.ok) {
        x = fx;
        y = fy;
        p = p2;
        zielX = null;
        zielY = null;
      }
    }
    return { typ, x, y, ok: p.ok, grund: p.ok ? null : p.grund, zielX, zielY, geraetId: ohne };
  };

  const statusText = (v: Vorschau, aktion: string) => {
    const fang = [...new Set([v.zielX, v.zielY].filter((z): z is Fangziel => z !== null && z.art !== "raster").map((z) => z.text))];
    setZeiger(v.ok ? `${v.typ.label} ${aktion}${fang.length > 0 ? ` · eingerastet: ${fang.join(", ")}` : ""}` : `Nicht möglich: ${v.grund ?? ""}`);
  };

  const einfangen = (event: ReactPointerEvent<SVGSVGElement>, art: Laufend["art"], extra: Partial<Laufend> = {}) => {
    // Einfangen ist eine Hilfe gegen verlorene Zeiger, keine Voraussetzung.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // ohne Einfangen weiter
    }
    laufend.current = { art, pointerId: event.pointerId, element: event.currentTarget, startBild: bild(event), startViewport: viewport, ...extra };
  };
  const freigeben = () => {
    const l = laufend.current;
    laufend.current = null;
    if (l !== null && l.element.hasPointerCapture?.(l.pointerId)) l.element.releasePointerCapture?.(l.pointerId);
  };

  /** Bricht eine laufende Bewegung ab - Entwurf zurück, keine Historie. */
  const abbrechen = (): boolean => {
    const l = laufend.current;
    if (l === null) return false;
    freigeben();
    setVorschau(null);
    if (l.art === "zusatz") return zusatz?.abbrechen() ?? true;
    if (l.art === "bewegen") dispatch?.({ typ: "ziehen-abbrechen" });
    setZeiger("Bewegung abgebrochen - nichts geändert.");
    return true;
  };

  const druecken = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.button === 1 || werkzeug === "pan") {
      einfangen(event, "pan");
      return;
    }
    // Leitungsplanung (6b.4): Übernimmt die Zusatzebene, gilt nur sie - sonst alles wie bisher.
    if (zusatz?.druecken({ welt: bildZuWelt(viewport, bild(event)), ziel: event.target as Element, altKey: event.altKey, massstab: viewport.massstab }) === true) {
      einfangen(event, "zusatz");
      return;
    }
    const geraetId = (event.target as Element).closest?.("[data-geraet]")?.getAttribute("data-geraet") ?? null;
    if (geraetId !== null) {
      waehlen(geraetId);
      const g = deckengeraete.find((x) => x.id === geraetId);
      if (g === undefined || !darfAendern || entwurf === null) return;
      dispatch?.({ typ: "ziehen-beginnen" });
      einfangen(event, "bewegen", { geraetId, start: { x: g.x, y: g.y }, gueltig: false });
      return;
    }
    if (werkzeug === "geraet" && darfAendern) {
      if (geraetetyp === null) {
        setZeiger("Bitte zuerst einen Gerätetyp wählen.");
        return;
      }
      const welt = bildZuWelt(viewport, bild(event));
      const v = vorschauFuer(geraetetyp, welt.x, welt.y, event.altKey, null);
      setVorschau(v);
      statusText(v, "setzen");
      einfangen(event, "platzieren");
      return;
    }
    // Auswahlwerkzeug auf freier Fläche: Auswahl aufheben und die Ansicht verschieben.
    waehlen(null);
    einfangen(event, "pan");
  };

  const bewegen = (event: ReactPointerEvent<SVGSVGElement>) => {
    const p = bild(event);
    const welt = bildZuWelt(viewport, p);
    const l = laufend.current;
    if (l?.art === "pan") {
      setViewport(verschieben(l.startViewport, p.x - l.startBild.x, p.y - l.startBild.y));
      return;
    }
    if (zusatz !== undefined && (l === null || l.art === "zusatz")) {
      const ereignis = { welt, ziel: event.target as Element, altKey: event.altKey, massstab: viewport.massstab };
      if (zusatz.bewegen(ereignis, l !== null) || l !== null) return;
    }
    if (l?.art === "bewegen" && l.start !== undefined && l.geraetId !== undefined && entwurf !== null) {
      const g = deckengeraete.find((x) => x.id === l.geraetId);
      if (g?.typ === undefined) return;
      const start = bildZuWelt(l.startViewport, l.startBild);
      const v = vorschauFuer(g.typ, l.start.x + welt.x - start.x, l.start.y + welt.y - start.y, event.altKey, g.id, l);
      l.vorherX = v.zielX?.id ?? null;
      l.vorherY = v.zielY?.id ?? null;
      setVorschau(v);
      statusText(v, `verschieben: Mitte ${masse.punkt(v.x, v.y)}`);
      if (!v.ok) return; // Die letzte gültige Lage bleibt.
      l.gueltig = true;
      dispatch?.({ typ: "ziehen-vorschau", entwurf: geraetAendern(zustand?.ziehenAb ?? entwurf, g.id, { x_mm: v.x, y_mm: v.y }) });
      return;
    }
    if ((l?.art === "platzieren" || (l === null && werkzeug === "geraet" && darfAendern)) && geraetetyp !== null) {
      const v = vorschauFuer(geraetetyp, welt.x, welt.y, event.altKey, null, l);
      if (l !== null) {
        l.vorherX = v.zielX?.id ?? null;
        l.vorherY = v.zielY?.id ?? null;
      }
      setVorschau(v);
      statusText(v, "setzen");
      return;
    }
    if (!modell.geschlossen || !imRaum(modell.waende, welt)) {
      setZeiger("Zeiger außerhalb des Raums");
      return;
    }
    const w = naechsteWand(modell.waende, welt);
    setZeiger(w === null ? "—" : `Nächste Wand: Wand ${w.nummer}, senkrechter Abstand ${masse.anzeigen(w.abstandMm)}`);
  };

  const loslassen = () => {
    const l = laufend.current;
    if (l === null) return;
    freigeben();
    if (l.art === "zusatz") {
      zusatz?.loslassen();
      return;
    }
    if (l.art === "bewegen") {
      setVorschau(null);
      dispatch?.({ typ: "ziehen-beenden" });
      if (l.gueltig !== true) setZeiger("Keine gültige neue Lage - nichts geändert.");
      return;
    }
    if (l.art === "platzieren") {
      const v = vorschau;
      setVorschau(null);
      if (v === null || entwurf === null) return;
      if (!v.ok) {
        setZeiger(`Nicht gesetzt: ${v.grund ?? ""}`);
        return;
      }
      const id = neueId();
      dispatch?.({ typ: "aendern", entwurf: geraetEinfuegen(entwurf, neuesDeckengeraet(id, v.typ, v.x, v.y)) });
      waehlen(id);
      setZeiger(`${v.typ.label} gesetzt - noch nicht gespeichert.`);
    }
  };

  /** Exakte Lage aus den Eigenschaften - geprüft wie beim Server. */
  const lageSetzen = (id: string, x: number, y: number, typKey?: string): string | undefined => {
    if (!darfAendern || entwurf === null) return "Nur im bearbeiteten Raum änderbar.";
    const g = deckengeraete.find((d) => d.id === id);
    const typ = typen.get(typKey ?? g?.schluessel ?? "");
    if (g === undefined || typ === undefined) return "Gerät nicht gefunden.";
    const p = deckenlagePruefen(typ, x, y, modell.waende, deckengeraete, id);
    if (!p.ok) return p.grund;
    dispatch?.({ typ: "aendern", entwurf: geraetAendern(entwurf, id, { x_mm: x, y_mm: y, ...(typKey !== undefined ? { device_type_key: typKey } : {}) }) });
    setZeiger("Übernommen - noch nicht gespeichert.");
    return undefined;
  };

  const entfernen = (id: string) => {
    if (!darfAendern || entwurf === null || zustand?.basis === null || zustand === undefined) return;
    dispatch?.({ typ: "aendern", entwurf: geraetEntfernen(entwurf, id, new Set(zustand.basis?.entwurf.geraete.map((g) => g.id) ?? [])) });
    waehlen(null);
    setZeiger("Gerät entfernt - noch nicht gespeichert.");
  };

  const taste = (event: KeyboardEvent<HTMLDivElement>) => {
    const ziel = event.target as Element;
    const strg = event.ctrlKey || event.metaKey;
    const k = event.key.toLowerCase();
    const imFeld = ziel.closest?.("select, input, textarea") != null;
    // Leitungs- oder Zuordnungsentwurf offen: seine Tasten zuerst (Strg+S auch aus einem Feld).
    if ((leitungsentwurf !== null || zuordnungsentwurf !== null) && (!imFeld || (strg && k === "s")) && dl.taste(event)) return;
    if (strg && k === "s" && onSpeichern !== undefined) {
      event.preventDefault();
      onSpeichern();
      return;
    }
    if (ziel.closest?.("select, input, textarea") != null) return;
    if (strg && k === "z" && !event.shiftKey) {
      event.preventDefault();
      dispatch?.({ typ: "rueckgaengig" });
      return;
    }
    if (strg && (k === "y" || (k === "z" && event.shiftKey))) {
      event.preventDefault();
      dispatch?.({ typ: "wiederholen" });
      return;
    }
    if (strg || event.altKey) return;
    const schritt = event.shiftKey ? 100 : 10;
    const schieben = (dx: number, dy: number) => {
      if (gewaehltesGeraet === undefined) return;
      event.preventDefault();
      const grund = lageSetzen(gewaehltesGeraet.id, gewaehltesGeraet.x + dx, gewaehltesGeraet.y + dy);
      setZeiger(grund === undefined ? "Verschoben - noch nicht gespeichert." : `Nicht verschoben: ${grund}`);
    };
    switch (event.key) {
      case "+":
        zoom(1.25);
        return;
      case "-":
        zoom(0.8);
        return;
      case "ArrowLeft":
        schieben(-schritt, 0);
        return;
      case "ArrowRight":
        schieben(schritt, 0);
        return;
      case "ArrowUp":
        schieben(0, schritt);
        return;
      case "ArrowDown":
        schieben(0, -schritt);
        return;
      case "Delete":
      case "Backspace":
        if (gewaehltesGeraet !== undefined && darfAendern) {
          event.preventDefault();
          entfernen(gewaehltesGeraet.id);
        }
        return;
    }
    if (k === "f") zuruecksetzen();
    else if (k === "v") setWerkzeug("auswahl");
    else if (k === "h") setWerkzeug("pan");
    else if (k === "g" && darfAendern) katalogOeffnen();
  };

  /** Escape: erst die Bewegung, dann das Werkzeug, dann die Auswahl - zuletzt schließen. */
  const escape = (): boolean => {
    if (abbrechen()) return true;
    if (dl.escape()) return true;
    if (werkzeug !== "auswahl") {
      setWerkzeug("auswahl");
      setVorschau(null);
      return true;
    }
    if (leitungsentwurf !== null && leitungsentwurf.auswahl !== null) {
      leitungen?.planung.dispatch({ typ: "auswaehlen", auswahl: null });
      return true;
    }
    if (dl.gewaehlt !== null) {
      dl.setGewaehlt(null);
      return true;
    }
    if (gewaehlt !== null) {
      waehlen(null);
      return true;
    }
    // Zuletzt: überlagerndes Eigenschaftenpanel, dann die Maximierung (Phase 6c.0).
    return af.escape();
  };

  // Raster über die sichtbare Fläche - wie im Grundriss vergröbert, damit es lesbar bleibt.
  let schritt = rasterMm;
  while (schritt * viewport.massstab < 8) schritt *= schritt % 250 === 0 ? 2 : 5;
  const g = sichtbareGrenzen(viewport, groesse);
  const raster: string[] = [];
  for (let x = Math.ceil(g.minX / schritt) * schritt; x <= g.maxX; x += schritt) raster.push(`M${weltZuBild(viewport, { x, y: 0 }).x.toFixed(1)} 0V${groesse.hoehe}`);
  for (let y = Math.ceil(g.minY / schritt) * schritt; y <= g.maxY; y += schritt) raster.push(`M0 ${weltZuBild(viewport, { x: 0, y }).y.toFixed(1)}H${groesse.breite}`);
  const punkte = modell.waende.map((w) => weltZuBild(viewport, w.start)).map((p) => `${p.x},${p.y}`).join(" ");

  // Maße der gewählten bzw. bewegten Mitte zu den tatsächlichen Wänden.
  const massMitte = vorschau ?? (gewaehltesGeraet !== undefined ? { x: gewaehltesGeraet.x, y: gewaehltesGeraet.y } : null);
  const treffer = massMitte !== null && modell.geschlossen ? wandabstaende(modell.waende, massMitte) : null;

  const geraeteElemente: ReactNode[] = deckengeraete.map((d, i) => {
    const r = deckenRechteckBild(viewport, d.x, d.y, d.typ);
    const m = weltZuBild(viewport, { x: d.x, y: d.y });
    const k = ["ansicht__geraet"];
    if (d.befunde.length > 0) k.push("ansicht__geraet--fehler");
    if (d.id === gewaehlt) k.push("ansicht__geraet--ausgewaehlt");
    if (vorschau?.geraetId === d.id) k.push("ansicht__geraet--gezogen");
    const name = `${d.typ?.label ?? d.schluessel} ${i + 1}`;
    const titel = `${name}${d.label !== null ? ` „${d.label}“` : ""}${darfAendern ? " - ziehen zum Verschieben" : ""}${d.befunde.length > 0 ? " - Lage prüfen" : ""}`;
    const symbol = Math.min(30, Math.max(16, Math.min(r.breite, r.hoehe) * 1.1));
    const hit = Math.max(22, r.breite, r.hoehe);
    return (
      <g key={d.id} className={k.join(" ")} data-geraet={d.id} data-testid={`decke-geraet-${d.id}`} aria-label={titel}>
        <title>{titel}</title>
        <rect x={r.x} y={r.y} width={r.breite} height={r.hoehe} className="ansicht__geraet-mass" />
        <SymbolImPlan typ={d.typ} x={m.x} y={m.y} groesse={symbol} />
        <rect x={m.x - hit / 2} y={m.y - hit / 2} width={hit} height={hit} className="ansicht__geraet-treffer" />
        {d.label !== null && (
          <text x={m.x} y={m.y + symbol / 2 + 12} textAnchor="middle" className="ansicht__text ansicht__text--klein">
            {d.label}
          </text>
        )}
        {d.befunde.length > 0 && (
          <text x={m.x + symbol / 2 + 2} y={m.y - symbol / 2} className="ansicht__text ansicht__text--warnung">
            ⚠
          </text>
        )}
      </g>
    );
  });

  const zurueckText = zurueckZu3d ? "Zurück zur 3D-Ansicht" : "Zurück zum Grundriss";
  const kopfzeile = (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <h2 className="sr-only">Deckenansicht · {raumName}</h2>
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
        <span className="text-muted">{zurueckZu3d ? "3D-Ansicht" : `Grundriss${geschossLabel !== undefined && !kompakt ? ` · ${geschossLabel}` : ""}`}</span>
        <Symbol icon={AKTION.pfadTrenner} />
        <span className="text-muted">{raumName}</span>
        <Symbol icon={AKTION.pfadTrenner} />
        <span className="font-semibold" aria-current="page">
          Decke
        </span>
      </nav>
      <span className="text-small" role="status" aria-live="polite">
        <strong className={kompakt ? "sr-only" : undefined}>Deckenansicht „{raumName}“ · </strong>Deckenhöhe {masse.anzeigen(deckenhoeheMm)}
        {eigeneHoehe ? "" : " (Standard des Geschosses)"}
        {status !== undefined && (
          <span className={`ml-3 font-semibold ${status.farbe}`}>
            {leitungsentwurf !== null
              ? `Leitungsentwurf: ${leitungen?.planung.ungespeichert === true ? "ungespeichert" : "gespeichert"}`
              : zuordnungsentwurf !== null
                ? `Gerätezuordnung: ${leitungen?.zuordnung.offen === true ? "ungespeichert" : "gespeichert"}`
                : darfAendern
                  ? status.text
                  : "Nur Ansicht"}
          </span>
        )}
      </span>
      {darfAendern && onSpeichern !== undefined && (
        <span className="flex flex-wrap gap-2">
          <button type="button" className={knopf("primaer", { klein: true })} disabled={!offen || status?.speichert === true} onClick={onSpeichern} title="Speichert den gemeinsamen Entwurf (Strg+S)">
            Speichern
          </button>
          <button
            type="button"
            className={knopf("neutral", { klein: true })}
            disabled={!offen || status?.speichert === true}
            onClick={onVerwerfen}
            aria-label={kompakt ? "Änderungen verwerfen" : undefined}
          >
            {kompakt ? "Verwerfen" : "Änderungen verwerfen"}
          </button>
        </span>
      )}
    </div>
  );
  // „Leitung hinzufügen“ (6c, L2): direkt zeichnen – 1 Startgerät anklicken.
  const leitungMoeglich = leitungen !== undefined && leitungen.planung.darfLeitungen;
  const zeichnet = leitungen?.planung.ablauf != null;
  const leitungHinzufuegen = useStabil(() => {
    if (leitungen === undefined) return;
    setWerkzeug("auswahl");
    setZeiger(leitungen.leitungZeichnen() ?? "1 Startgerät wählen – auf ein markiertes Gerät klicken.");
  });
  /** Ein anderes Werkzeug beendet den Zeichenablauf (der Entwurf bleibt). */
  /** „Gerät“ (Knopf, Taste G, Typ-Chip) öffnet den Gerätekatalog der Decke (K1). */
  const katalogOeffnen = useStabil(() => {
    if (!darfAendern) return;
    setKatalog({ modus: { art: "platzieren", flaeche: "ceiling", start: typWahl }, geraetId: null });
  });
  const werkzeugWaehlen = useStabil((w: typeof werkzeug) => {
    if (w !== "zuordnen" && leitungen?.planung.ablauf != null) leitungen.planung.ablaufBeenden();
    if (w === "geraet") {
      katalogOeffnen();
      return;
    }
    setWerkzeug(w);
  });
  const rueckgaengig = useStabil(() => (leitungsentwurf !== null ? leitungen?.planung.dispatch({ typ: "rueckgaengig" }) : dispatch?.({ typ: "rueckgaengig" })));
  const wiederholen = useStabil(() => (leitungsentwurf !== null ? leitungen?.planung.dispatch({ typ: "wiederholen" }) : dispatch?.({ typ: "wiederholen" })));
  const zoomStabil = useStabil(zoom);
  const ganzStabil = useStabil(zuruecksetzen);
  const fangStabil = useStabil((x: boolean) => onFang?.(x));
  const kannZurueck = leitungsentwurf !== null ? leitungsentwurf.zurueck.length > 0 : (zustand?.zurueck.length ?? 0) > 0;
  const kannVor = leitungsentwurf !== null ? leitungsentwurf.vor.length > 0 : (zustand?.vor.length ?? 0) > 0;
  const hatLeitungsentwurf = leitungsentwurf !== null;
  const hatZuordnungsentwurf = zuordnungsentwurf !== null;
  const typKey = geraetetyp?.key ?? null;
  // Gemerkt (L1): Die Leiste zeichnet nur bei sichtbaren Änderungen neu, nicht bei jeder Zeigerbewegung.
  const werkzeugleiste = useMemo(() => (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5" role="toolbar" aria-label="Werkzeuge der Deckenansicht">
      <Werkzeuggruppe label="Auswahl">
        <Werkzeugknopf label="Auswählen" taste="V" icon={WERKZEUGSYMBOL.auswaehlen} aktiv={werkzeug === "auswahl" && !zeichnet} onClick={() => werkzeugWaehlen("auswahl")} />
        <Werkzeugknopf label="Ansicht verschieben" taste="H" icon={WERKZEUGSYMBOL.verschieben} aktiv={werkzeug === "pan"} onClick={() => werkzeugWaehlen("pan")} />
      </Werkzeuggruppe>
      {darfAendern && (
        <Werkzeuggruppe label="Gerät">
          <Werkzeugknopf label="Gerät" taste="G" hinweis="Deckengerät setzen" icon={WERKZEUGSYMBOL.geraet} aktiv={werkzeug === "geraet"} onClick={() => werkzeugWaehlen("geraet")} />
          {werkzeug === "geraet" && geraetetyp !== null && (
            <button
              type="button"
              className={`${knopf("neutral", { klein: true })} inline-flex items-center gap-1.5`}
              aria-label={`Gerät: ${geraetetyp.label} – anderen Typ wählen`}
              title="Gerätekatalog öffnen (G)"
              onClick={katalogOeffnen}
              data-testid="geraet-chip"
            >
              <Geraetesymbol typ={geraetetyp} groesse={16} />
              Gerät: {geraetetyp.label}
            </button>
          )}
        </Werkzeuggruppe>
      )}
      {(leitungMoeglich || zuordnenErlaubt) && (
        <Werkzeuggruppe label="Leitung">
          {!hatZuordnungsentwurf && leitungMoeglich && <LeitungHinzufuegenKnopf aktiv={zeichnet} gesperrtGrund={null} onClick={leitungHinzufuegen} />}
          {zuordnenErlaubt && <Werkzeugknopf label="Zuordnen" taste="Z" icon={WERKZEUGSYMBOL.zuordnen} aktiv={werkzeug === "zuordnen"} onClick={() => setWerkzeug("zuordnen")} />}
        </Werkzeuggruppe>
      )}
      {(hatLeitungsentwurf || darfAendern) && (
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
      <Zoomgruppe onZoom={zoomStabil} onGanz={ganzStabil} ganzHinweis="Ganzen Raum zeigen" />
      <AnsichtMenue fangAktiv={fangAktiv} onFang={fangStabil} fangLabel="Einrasten" rasterMm={rasterMm} onRaster={onRaster} onHilfe={() => setHilfe(true)} />
    </div>
    // Rückrufe sind stabil (Zustandssetzer, `useStabil`); abhängig ist die Leiste nur von dem, was sie zeigt.
  ), [werkzeug, darfAendern, typen, typKey, leitungMoeglich, zeichnet, hatLeitungsentwurf, hatZuordnungsentwurf, zuordnenErlaubt, kannZurueck, kannVor, fangAktiv, rasterMm, onRaster, leitungHinzufuegen, werkzeugWaehlen, rueckgaengig, wiederholen, zoomStabil, ganzStabil, fangStabil]);

  const hilfeInhalt = (
    <>
      <ul className="pl-[18px] text-muted">
        <li>Gerät (G): Gerätekatalog öffnen, Typ wählen, „Platzieren“ – Vorschau folgt dem Zeiger, ein Klick setzt es. Ziehen verschiebt es; Pfeiltasten 1 cm, mit Umschalt 10 cm; Entf entfernt es.</li>
        <li>Eingerastet wird bündig an achsparallelen Wänden, in der Flucht anderer Deckengeräte, sonst am Raster. Alt hält es beim Ziehen aus.</li>
        <li>Die Maße gehen von der Gerätemitte bis zur ersten tatsächlichen Wand in jeder Richtung – auch in L-förmigen Räumen.</li>
        <li>Strg+Z / Strg+Y gelten für den gemeinsamen Entwurf mit dem Grundriss. Schließen behält alle Änderungen – gespeichert wird nur mit „Speichern“.</li>
      </ul>
      <p className="m-0">Escape beendet zuerst die laufende Bewegung, dann das Werkzeug und die Auswahl, schließt ein überlagerndes Panel, beendet die Maximierung und führt zuletzt zurück.</p>
      <h3 className="mt-3 text-small">Legende der Gerätesymbole</h3>
      <Geraetelegende typen={typen} />
    </>
  );

  return (
    // L1: keine modale Oberfläche mehr – die Deckenfläche steht an Ort und Stelle in der Arbeitsfläche.
    <section ref={flaechenRef} aria-label={`Deckenansicht · ${raumName}`} tabIndex={-1} className="outline-none" data-flaeche="decke">
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
        {!modell.geschlossen ? (
          <>
            {kopfzeile}
            {werkzeugleiste}
            <p className={meldungsflaeche()} role="alert">
              Die Raumkontur ist nicht geschlossen - eine Deckenansicht braucht eine geschlossene Kontur.
            </p>
          </>
        ) : (
          <Planungsarbeitsflaeche
            zustand={af}
            name="Arbeitsfläche Decke"
            eigenschaftenTitel="Raumangaben und Deckengeräte"
            markierung={leitungsentwurf !== null ? "Leitung" : zuordnungsentwurf !== null ? "Zuordnung" : null}
            kopf={kopfzeile}
            werkzeuge={werkzeugleiste}
            kontext={
              <div className="flex flex-col gap-1.5">
                {!zeichnetJetzt && (
                  <p className="m-0 h-6 overflow-hidden text-[0.82rem] text-muted" aria-live="polite" data-testid="decke-zeiger">
                    {zeiger}
                  </p>
                )}
                {zustand !== undefined && dispatch !== undefined && (
                  <Raumrueckmeldung fehler={zustand.serverFehler} konflikt={zustand.status === "konflikt"} onSchliessen={() => dispatch({ typ: "hinweis-schliessen" })} />
                )}
                {leitungen !== undefined && raumId !== undefined && (
                  <Zeichenleiste k={leitungen} flaeche={{ art: "decke", raumId }} meldung={zeiger} meldungTestId="decke-zeiger" />
                )}
                <Entwurfsleiste k={leitungen} panelOffen={af.eigenschaftenOffen} onDetails={() => af.setEigenschaftenOffen(true)} nachSchliessen={() => setWerkzeug("auswahl")} />
              </div>
            }
            eigenschaften={
              <div className="flex flex-col gap-2 text-small">
                {leitungen !== undefined && raumId !== undefined && (
                  <Leitungsbereich
                    k={leitungen}
                    flaeche={{ art: "decke", raumId }}
                    relevant={dl.relevant}
                    gewaehlt={dl.gewaehlt}
                    onWaehlen={dl.setGewaehlt}
                    onWerkzeug={setWerkzeug}
                  />
                )}
                <div>
                  <p className="m-0">
                    Fläche {flaecheText(modell.flaecheMm2)} · Umfang {masse.anzeigenOptional(modell.umfangMm)}
                  </p>
                  {modell.rechteck !== null ? (
                    <p className="m-0">
                      Raummaß {masse.anzeigen(modell.rechteck.breiteMm)} × {masse.anzeigen(modell.rechteck.tiefeMm)}
                    </p>
                  ) : (
                    <p className="m-0 text-muted">Kein Rechteck - Maße stehen an den einzelnen Wänden.</p>
                  )}
                  <ul className="my-1 pl-[18px]" aria-label="Wände">
                    {modell.waende.map((w) => (
                      <li key={w.id}>
                        Wand {w.nummer}: {masse.anzeigen(w.laengeMm)}
                      </li>
                    ))}
                  </ul>
                </div>
                <Deckengeraeteliste
                  geraete={deckengeraete}
                  gewaehlt={gewaehlt}
                  darfAendern={darfAendern}
                  deckenhoeheMm={deckenhoeheMm}
                  treffer={treffer}
                  onWaehlen={waehlen}
                  onLage={lageSetzen}
                  onTypAendern={(id) => {
                    const g = deckengeraete.find((x) => x.id === id);
                    if (g !== undefined && darfAendern) setKatalog({ modus: { art: "typ", flaeche: "ceiling", aktuell: g.schluessel }, geraetId: id });
                  }}
                  onLabel={(id, label) => {
                    if (entwurf !== null && darfAendern) dispatch?.({ typ: "aendern", entwurf: geraetAendern(entwurf, id, { label }) });
                  }}
                  onEntfernen={entfernen}
                />
                <p className="m-0 text-muted">
                  Ausrichtung wie im Grundriss (Deckenspiegel): die Decke so, wie sie sich in einem Spiegel auf dem Fußboden zeigt –
                  nicht seitenverkehrt. Was hier links oben liegt, liegt auch im Grundriss links oben. Ziehen auf freier Fläche
                  verschiebt die Ansicht, das Mausrad zoomt.
                </p>
              </div>
            }
          >
            <div ref={huelle} className="relative h-full touch-none overflow-hidden rounded-ep border border-line bg-canvas">
              <svg
                ref={flaeche}
                className="ansicht__svg"
                role="application"
                aria-label={`Deckenansicht ${raumName}, Ausrichtung wie im Grundriss`}
                tabIndex={0}
                width={groesse.breite}
                height={groesse.hoehe}
                style={{ cursor: zusatz?.cursor ?? (werkzeug === "geraet" ? "crosshair" : "grab") }}
                onPointerDown={druecken}
                onPointerMove={bewegen}
                onPointerUp={loslassen}
                onPointerCancel={() => abbrechen()}
                onLostPointerCapture={() => {
                  if (laufend.current !== null && laufend.current.art !== "pan") abbrechen();
                }}
                onPointerLeave={() => {
                  if (laufend.current === null) {
                    setVorschau(null);
                    zusatz?.abbrechen();
                  }
                }}
                onDoubleClick={() => zusatz?.doppelklick?.()}
              >
                <path d={raster.join("")} className="ansicht__raster" aria-hidden="true" />
                <polygon points={punkte} className="ansicht__decke-flaeche" data-testid="deckenkontur" />
                {modell.waende.map((w) => {
                  const p = weltZuBild(viewport, w.beschriftung);
                  return (
                    <text key={w.id} x={p.x} y={p.y + 4} textAnchor="middle" className="ansicht__masstext" data-testid={`decke-wand-${w.nummer}`}>
                      {`W${w.nummer} · ${masse.anzeigen(w.laengeMm)}`}
                    </text>
                  );
                })}
                {geraeteElemente}
                {vorschau !== null && (
                  <g data-testid="decke-vorschau" data-gueltig={vorschau.ok ? "ja" : "nein"} className={vorschau.ok ? "ansicht__geraet-vorschau" : "ansicht__geraet-vorschau ansicht__geraet-vorschau--fehler"}>
                    {(() => {
                      const r = deckenRechteckBild(viewport, vorschau.x, vorschau.y, vorschau.typ);
                      const m = weltZuBild(viewport, { x: vorschau.x, y: vorschau.y });
                      return (
                        <>
                          <rect x={r.x} y={r.y} width={r.breite} height={r.hoehe} className="ansicht__vorschau" />
                          <SymbolImPlan typ={vorschau.typ} x={m.x} y={m.y} groesse={22} />
                          {!vorschau.ok && (
                            <text x={m.x} y={m.y - 16} textAnchor="middle" className="ansicht__text ansicht__masstext--ueberschneidung">
                              nicht möglich
                            </text>
                          )}
                        </>
                      );
                    })()}
                  </g>
                )}
                {zusatz?.zeichnen((x, y) => weltZuBild(viewport, { x, y }))}
                {massMitte !== null && treffer !== null && <Wandmasse mitte={massMitte} treffer={treffer} viewport={viewport} mm={masse.anzeigen} />}
                <text x={groesse.breite - 10} y={20} textAnchor="end" className="ansicht__text ansicht__text--klein">
                  ↑ oben wie im Grundriss
                </text>
              </svg>
            </div>
          </Planungsarbeitsflaeche>
        )}
      </div>
      {katalog !== null && (
        <Geraetekatalog
          typen={typen}
          modus={katalog.modus}
          onClose={() => setKatalog(null)}
          onWahl={(key) => {
            if (katalog.geraetId !== null) {
              const g = deckengeraete.find((x) => x.id === katalog.geraetId);
              const grund = g === undefined ? "Gerät nicht gefunden." : lageSetzen(g.id, g.x, g.y, key);
              if (grund !== undefined) return grund;
              setKatalog(null);
              setZeiger(`Typ geändert: ${typen.get(key)?.label ?? key} – noch nicht gespeichert.`);
              return undefined;
            }
            setTypWahl(key);
            setWerkzeug("geraet");
            setKatalog(null);
            setZeiger(`${typen.get(key)?.label ?? key}: in den Raum klicken – Vorschau, Fang und Prüfung wie gewohnt.`);
            return undefined;
          }}
          verteilung={
            katalog.geraetId === null && verteilungsangebot !== undefined
              ? { ...verteilungsangebot, gesperrt: "Verteilungen sitzen an der Wand – bitte eine Wandansicht öffnen oder im Grundriss eine Wand wählen." }
              : undefined
          }
        />
      )}
      <HilfeDialog offen={hilfe} titel="Deckenfläche – Bedienung und Legende" onClose={() => setHilfe(false)}>
        {hilfeInhalt}
      </HilfeDialog>
    </section>
  );
}

/** Planungsmaß eines Deckengeräts im Bildraum (y nach unten). */
function deckenRechteckBild(viewport: Viewport, x: number, y: number, typ: Geraetetyp | undefined) {
  const hb = Math.floor((typ?.width_mm ?? 100) / 2);
  const hh = Math.floor((typ?.height_mm ?? 100) / 2);
  const a = weltZuBild(viewport, { x: x - hb, y: y + hh });
  const b = weltZuBild(viewport, { x: x + hb, y: y - hh });
  return { x: a.x, y: a.y, breite: Math.max(b.x - a.x, 1), hoehe: Math.max(b.y - a.y, 1) };
}

/** Maßlinien von der Gerätemitte zur ersten Wand in jeder Richtung. */
function Wandmasse({
  mitte,
  treffer,
  viewport,
  mm,
}: {
  mitte: { x: number; y: number };
  treffer: Record<Richtung, Wandtreffer | null>;
  viewport: Viewport;
  mm: (wert: number) => string;
}) {
  const m = weltZuBild(viewport, mitte);
  return (
    <g data-testid="decke-masse">
      {(Object.values(treffer)).map((t) => {
        if (t === null) return null;
        const z = weltZuBild(viewport, t.punkt);
        const waagerecht = t.richtung === "links" || t.richtung === "rechts";
        const text = `${mm(Math.round(t.abstand))} bis W${t.wandNummer}`;
        return (
          <g key={t.richtung} data-testid={`decke-mass-${t.richtung}`} aria-label={`Mitte bis Wand ${t.wandNummer} (${RICHTUNG_LABEL[t.richtung]}): ${mm(Math.round(t.abstand))}`}>
            <line x1={m.x} y1={m.y} x2={z.x} y2={z.y} className="ansicht__mass ansicht__mass--nachbar" />
            <line x1={z.x - (waagerecht ? 0 : 5)} y1={z.y - (waagerecht ? 5 : 0)} x2={z.x + (waagerecht ? 0 : 5)} y2={z.y + (waagerecht ? 5 : 0)} className="ansicht__mass" />
            <text
              x={(m.x + z.x) / 2 + (waagerecht ? 0 : 6)}
              y={(m.y + z.y) / 2 + (waagerecht ? -6 : 4)}
              textAnchor={waagerecht ? "middle" : "start"}
              className="ansicht__masstext"
            >
              {text}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Liste der Deckengeräte und Eigenschaften des gewählten. */
function Deckengeraeteliste({
  geraete,
  gewaehlt,
  darfAendern,
  deckenhoeheMm,
  treffer,
  onWaehlen,
  onLage,
  onTypAendern,
  onLabel,
  onEntfernen,
}: {
  geraete: readonly AnsichtsDeckengeraet[];
  gewaehlt: string | null;
  darfAendern: boolean;
  deckenhoeheMm: number;
  treffer: Record<Richtung, Wandtreffer | null> | null;
  onWaehlen: (id: string) => void;
  onLage: (id: string, x: number, y: number, typKey?: string) => string | undefined;
  onTypAendern: (id: string) => void;
  onLabel: (id: string, label: string | null) => void;
  onEntfernen: (id: string) => void;
}) {
  const masse = useMasse();
  const g = geraete.find((x) => x.id === gewaehlt);
  /** Ein Abstand zur Wand in einer Richtung - verschiebt das Gerät entlang dieser Achse. */
  const abstandFeld = (richtung: Richtung) => {
    const t = treffer?.[richtung] ?? null;
    if (g === undefined || t === null) return null;
    const label = `Mitte bis Wand ${t.wandNummer} (${RICHTUNG_LABEL[richtung]})`;
    return (
      <MassFeld
        key={richtung}
        id={`decke-abstand-${richtung}`}
        label={label}
        wertMm={Math.round(t.abstand)}
        gesperrt={!darfAendern || !Number.isInteger(t.abstand)}
        hinweis={Number.isInteger(t.abstand) ? "Achsmaß" : "schräge Wand – nur Anzeige"}
        onUebernehmen={(mm) => {
          const d = mm - t.abstand;
          if (richtung === "links") return onLage(g.id, g.x + d, g.y);
          if (richtung === "rechts") return onLage(g.id, g.x - d, g.y);
          if (richtung === "unten") return onLage(g.id, g.x, g.y + d);
          return onLage(g.id, g.x, g.y - d);
        }}
      />
    );
  };
  return (
    <section aria-label="Deckengeräte" className="flex flex-col gap-1.5 border-t border-line pt-2">
      <h4 className="m-0">Deckengeräte ({geraete.length})</h4>
      <p className="m-0 text-muted">
        Montagehöhe = Deckenhöhe des Raums ({masse.anzeigen(deckenhoeheMm)}). Es wird keine eigene Höhe gespeichert; ändert sich
        die Decke, folgen die Geräte.
      </p>
      {geraete.length === 0 ? (
        <p className="m-0 text-muted">Noch kein Deckengerät.{darfAendern ? " „Gerät“ (G) öffnet den Katalog: Typ wählen, „Platzieren“, in den Raum klicken." : ""}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {geraete.map((x, i) => (
            <li key={x.id}>
              <button type="button" className={x.id === gewaehlt ? LISTENKNOPF_GEWAEHLT : LISTENKNOPF} aria-current={x.id === gewaehlt ? "true" : undefined} onClick={() => onWaehlen(x.id)}>
                <span className="inline-flex items-center gap-1.5">
                  <Geraetesymbol typ={x.typ} groesse={16} />
                  {x.typ?.label ?? x.schluessel} {i + 1}
                  {x.label !== null ? ` „${x.label}“` : ""}
                  {x.befunde.length > 0 ? " ⚠" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {g !== undefined && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-2" aria-label="Gewähltes Deckengerät">
          <TypFeld typ={g.typ} schluessel={g.schluessel} editierbar={darfAendern} onAendern={() => onTypAendern(g.id)} />
          <div className="grid grid-cols-2 gap-1.5">{(["links", "rechts", "oben", "unten"] as const).map(abstandFeld)}</div>
          <BeschriftungsFeld id="decke-geraet-label" wert={g.label} gesperrt={!darfAendern} onUebernehmen={(text) => onLabel(g.id, text)} />
          <p className="m-0 text-muted">
            Planungsmaß {masse.anzeigen(g.typ?.width_mm ?? 0)} × {masse.anzeigen(g.typ?.height_mm ?? 0)} – vereinfachtes Auslassmaß zur
            Prüfung, keine Herstellerangabe.
          </p>
          {g.befunde.length > 0 && (
            <div className={meldungsflaeche("schlicht")} role="status">
              <p className="m-0 font-semibold">Hinweis: Lage prüfen</p>
              <ul className="my-1 pl-[18px]">
                {g.befunde.map((code) => (
                  <li key={code}>{befundText(code)}</li>
                ))}
              </ul>
              <p className="m-0 text-muted">Nichts wird automatisch verschoben oder gelöscht.</p>
            </div>
          )}
          {darfAendern && (
            <button type="button" className={knopf()} onClick={() => onEntfernen(g.id)}>
              Gerät entfernen
            </button>
          )}
        </div>
      )}
    </section>
  );
}
