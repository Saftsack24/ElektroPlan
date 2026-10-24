import { knopf } from "../../../core/ui/stil";
import type { Arbeitsflaeche, Bearbeitungsflaeche, Leitungskontext } from "./kontext";
import type { VorbereiteterPlan, Wegpunkt } from "./laenge";
import type { Leitungsentwurf } from "./entwurf";

/** Raum und gegebenenfalls Wand, an denen gerade gezeichnet wird. */
export interface Bezugsort {
  readonly raumId: string;
  readonly wandId: string | null;
}

function ortVon(v: VorbereiteterPlan, wp: Wegpunkt | undefined): Bezugsort | null {
  if (wp === undefined) return null;
  if (wp.art === "wand" || wp.art === "uebergang") {
    const info = v.waende.get(wp.wandId);
    return info === undefined ? null : { raumId: info.raum.id, wandId: wp.wandId };
  }
  if (wp.art === "floor" || wp.art === "ceiling") return { raumId: wp.raumId, wandId: null };
  return null;
}

/**
 * Bezugsort im Grundriss (6c L2): der gewählte Wegpunkt, sonst der letzte Wegpunkt dieses Geschosses,
 * sonst das Startgerät. Daraus folgen die Flächen, die direkt geöffnet werden können.
 */
export function bezugsort(v: VorbereiteterPlan | null, e: Leitungsentwurf | null, floorId: string): Bezugsort | null {
  if (v === null || e === null) return null;
  const imGeschoss = (o: Bezugsort | null) => o !== null && v.raeume.get(o.raumId)?.geschossId === floorId;
  const w = e.werte;
  if (e.auswahl !== null) {
    const o = ortVon(v, w.wegpunkte[e.auswahl]);
    return imGeschoss(o) ? o : null;
  }
  for (const wp of [...w.wegpunkte].reverse()) {
    const o = ortVon(v, wp);
    if (imGeschoss(o)) return o;
  }
  const g = w.startId === null ? undefined : v.geraete.get(w.startId);
  if (g === undefined) return null;
  const o = { raumId: g.raumId, wandId: g.flaeche === "ceiling" ? null : (g.wandId ?? null) };
  return imGeschoss(o) ? o : null;
}

interface Ziel {
  readonly text: string;
  readonly name: string;
  readonly ziel: Arbeitsflaeche | "grundriss";
}

/**
 * Flächenwechsel im selben Leitungsentwurf (6c L2): sichtbare, kurze Knöpfe in der Zeichenleiste.
 * Ein Wechsel speichert nichts, setzt keinen Wegpunkt und behält Schritt, Angaben und Rückgängig;
 * jede Fläche behält ihren eigenen Ausschnitt. Ein Klick in die Zeichenfläche wechselt nie die Ansicht.
 */
export function Flaechenwechsel({ k, flaeche }: { k: Leitungskontext; flaeche: Bearbeitungsflaeche }) {
  const p = k.planung;
  const v = p.vorbereitet;
  if (v === null) return null;
  const kurz = (wandId: string) => k.wandName(wandId).replace(/ \(.*\)$/, "");
  const zurWand = (raumId: string, wandId: string, text: string): Ziel => ({
    text,
    name: `Zur ${k.wandName(wandId)} wechseln`,
    ziel: { art: "wand", raumId, wandId },
  });
  const zurDecke = (raumId: string): Ziel => ({ text: "↑ Decke", name: `Zur Decke von ${k.raumName(raumId)} wechseln`, ziel: { art: "decke", raumId } });
  const ziele: Ziel[] = [];
  if (flaeche.art === "grundriss") {
    const ort = bezugsort(v, p.entwurf, flaeche.floorId);
    if (ort === null) return null;
    if (ort.wandId !== null) ziele.push(zurWand(ort.raumId, ort.wandId, `→ ${kurz(ort.wandId)}`));
    ziele.push(zurDecke(ort.raumId));
  } else {
    const raum = v.raeume.get(flaeche.raumId);
    if (raum === undefined) return null;
    ziele.push({ text: "Grundriss", name: "Zum Grundriss wechseln", ziel: "grundriss" });
    if (flaeche.art === "wand") {
      const n = raum.waende.length;
      const i = raum.waende.findIndex((x) => x.id === flaeche.wandId);
      const vor = i < 0 ? undefined : raum.waende[(i - 1 + n) % n];
      const nach = i < 0 ? undefined : raum.waende[(i + 1) % n];
      if (vor !== undefined) ziele.push(zurWand(raum.id, vor.id, `← ${kurz(vor.id)}`));
      if (nach !== undefined && nach.id !== vor?.id) ziele.push(zurWand(raum.id, nach.id, `${kurz(nach.id)} →`));
      ziele.push(zurDecke(raum.id));
    } else {
      for (const x of raum.waende) ziele.push(zurWand(raum.id, x.id, kurz(x.id)));
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1" role="group" aria-label="Fläche wechseln (Entwurf bleibt erhalten)" data-testid="flaechenwechsel">
      <span className="text-muted max-sm:sr-only">Fläche:</span>
      {ziele.map((z) => (
        <button
          key={z.name}
          type="button"
          className={knopf("neutral", { klein: true })}
          aria-label={z.name}
          title={`${z.name} – der Entwurf bleibt erhalten, nichts wird gespeichert`}
          onClick={() => (z.ziel === "grundriss" ? k.zumGrundriss() : k.arbeitsflaecheWechseln(z.ziel))}
        >
          {z.text}
        </button>
      ))}
    </span>
  );
}
