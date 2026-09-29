/**
 * Synthetische Testpläne der 3D-Ansicht - ein Baukasten statt kopierter Daten.
 *
 * Räume entstehen aus Eckpunkten; die Wände laufen in dieser Reihenfolge,
 * die Wand-IDs sind `<raum>-w<index>`. Die Formen der Einzelfälle stammen,
 * wo es passt, aus der gemeinsamen Geometrie-Fixture
 * `testdata/geometry/raumgeometrie.v1.json` (siehe Tests).
 */
import type { Geschossplan, Oeffnungsart, RaumImPlan, WandImPlan } from "./modell";

export interface OeffnungsAngabe {
  readonly id: string;
  readonly art?: Oeffnungsart;
  readonly offset: number;
  readonly breite: number;
  readonly hoehe: number;
  readonly bruestung?: number;
}

export interface RaumAngabe {
  readonly nummer?: string | null;
  readonly hoehe?: number;
  readonly status?: "draft" | "valid";
  readonly floorId?: string;
  /** Eine Stärke für alle Wände oder je Wand. */
  readonly staerke?: number | readonly number[];
  /** Öffnungen je Wandindex. */
  readonly oeffnungen?: Readonly<Record<number, readonly OeffnungsAngabe[]>>;
  /** Offene Kontur: die letzte Wand weglassen. */
  readonly offen?: boolean;
}

const ZEIT = "2026-09-27T08:00:00Z";

export function raum(
  id: string,
  name: string,
  punkte: readonly (readonly [number, number])[],
  angabe: RaumAngabe = {},
): RaumImPlan {
  const hoehe = angabe.hoehe ?? 2500;
  const anzahl = angabe.offen ? punkte.length - 1 : punkte.length;
  const walls: WandImPlan[] = [];
  for (let i = 0; i < anzahl; i += 1) {
    const [x1, y1] = punkte[i] as readonly [number, number];
    const [x2, y2] = punkte[(i + 1) % punkte.length] as readonly [number, number];
    const staerke = typeof angabe.staerke === "number" ? angabe.staerke : (angabe.staerke?.[i] ?? 115);
    const oeffnungen = angabe.oeffnungen?.[i] ?? [];
    walls.push({
      id: `${id}-w${i}`,
      room_id: id,
      sort_order: i,
      x1_mm: x1,
      y1_mm: y1,
      x2_mm: x2,
      y2_mm: y2,
      thickness_mm: staerke,
      length_mm: Math.round(Math.hypot(x2 - x1, y2 - y1)),
      opening_count: oeffnungen.length,
      version: 1,
      created_at: ZEIT,
      updated_at: ZEIT,
      openings: oeffnungen.map((o) => ({
        id: o.id,
        wall_id: `${id}-w${i}`,
        kind: o.art ?? "door",
        offset_mm: o.offset,
        width_mm: o.breite,
        height_mm: o.hoehe,
        sill_height_mm: o.bruestung ?? 0,
        version: 1,
        created_at: ZEIT,
        updated_at: ZEIT,
      })),
    });
  }
  return {
    id,
    floor_id: angabe.floorId ?? "geschoss-1",
    name,
    room_number: angabe.nummer ?? null,
    height_mm: null,
    effective_height_mm: hoehe,
    contour_status: angabe.status ?? (angabe.offen ? "draft" : "valid"),
    wall_count: walls.length,
    area_mm2: null,
    area_m2: null,
    perimeter_mm: null,
    version: 1,
    created_at: ZEIT,
    updated_at: ZEIT,
    walls,
    contour_problems: [],
  };
}

export function rechteck(
  id: string,
  name: string,
  [x0, y0]: readonly [number, number],
  [x1, y1]: readonly [number, number],
  angabe: RaumAngabe = {},
): RaumImPlan {
  // Gegen den Uhrzeigersinn: unten, rechts, oben, links.
  return raum(
    id,
    name,
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
    angabe,
  );
}

export function plan(rooms: readonly RaumImPlan[], floorId = "geschoss-1"): Geschossplan {
  return { floor_id: floorId, project_id: "projekt-1", rooms: [...rooms] };
}

const tuer = (id: string, offset: number, breite = 885): OeffnungsAngabe => ({
  id,
  art: "door",
  offset,
  breite,
  hoehe: 2010,
});
const fenster = (id: string, offset: number, breite = 1260): OeffnungsAngabe => ({
  id,
  art: "window",
  offset,
  breite,
  hoehe: 1385,
  bruestung: 900,
});

/**
 * Einfamilienhaus-Erdgeschoss 11 × 9 m (vgl. Messlauf Phase 4a) - 7 Räume,
 * 32 Wände, davon 10 Paare exakt deckungsgleich, 17 erfasste Öffnungen,
 * die zu 15 Darstellungsöffnungen werden. Enthält bewusst einseitig
 * erfasste Türen, eine beidseitig gleich erfasste Tür und eine mit
 * abweichender Art.
 */
export function einfamilienhaus(): Geschossplan {
  return plan([
    rechteck("wohnen", "Wohnen", [0, 0], [5000, 5000], {
      nummer: "0.01",
      oeffnungen: {
        0: [fenster("f-wohnen-sued", 1500, 2000)],
        1: [tuer("t-wohnen-flur-w", 3000)], // Wand (5000,0)→(5000,5000)
        3: [fenster("f-wohnen-west", 1800)],
      },
    }),
    rechteck("hwr", "HWR", [7000, 0], [8500, 4000], {
      nummer: "0.05",
      oeffnungen: { 0: [fenster("f-hwr", 300, 900)] },
    }),
    rechteck("kueche", "Küche", [8500, 0], [11000, 4000], {
      nummer: "0.02",
      oeffnungen: { 0: [fenster("f-kueche-sued", 600)], 1: [fenster("f-kueche-ost", 1400)] },
    }),
    raum(
      "flur",
      "Flur",
      [
        [5000, 0],
        [7000, 0],
        [7000, 4000],
        [8500, 4000],
        [11000, 4000],
        [11000, 5000],
        [7000, 5000],
        [5000, 5000],
      ],
      {
        nummer: "0.03",
        oeffnungen: {
          0: [{ ...tuer("t-haustuer", 500, 1010), hoehe: 2135 }],
          1: [tuer("t-hwr", 1500)], // (7000,0)→(7000,4000), nur Flurseite
          3: [tuer("t-kueche", 800)], // (8500,4000)→(11000,4000), nur Flurseite
          6: [tuer("t-bad-flur", 600, 760)], // (7000,5000)→(5000,5000)
          7: [tuer("t-wohnen-flur-f", 1115)], // (5000,5000)→(5000,0): 5000−3000−885
        },
      },
    ),
    rechteck("schlafen", "Schlafen", [0, 5000], [5000, 9000], {
      nummer: "0.06",
      oeffnungen: { 0: [tuer("t-schlafen", 3500)], 2: [fenster("f-schlafen", 1800)] },
    }),
    rechteck("bad", "Bad", [5000, 5000], [7000, 9000], {
      nummer: "0.04",
      oeffnungen: {
        // Unterwand (5000,5000)→(7000,5000): gleiches Rechteck wie im Flur, aber Durchgang.
        0: [{ ...tuer("t-bad-bad", 640, 760), art: "passage" }],
        2: [{ ...fenster("f-bad", 700, 600), bruestung: 1200, hoehe: 800 }],
      },
    }),
    rechteck("kind", "Kind", [7000, 5000], [11000, 9000], {
      nummer: "0.07",
      oeffnungen: { 0: [tuer("t-kind", 500)], 2: [fenster("f-kind", 1400)] },
    }),
  ]);
}

/**
 * Belastungsprobe: 6 × 5 Rechteckräume (30 Räume, 120 logische Wände, 60
 * Öffnungen). Nachbarn teilen exakt deckungsgleiche Wände; je Raum ein
 * Fenster und eine einseitig erfasste Tür.
 */
export function belastungsplan(): Geschossplan {
  const rooms: RaumImPlan[] = [];
  const b = 4000;
  const t = 3500;
  for (let zeile = 0; zeile < 5; zeile += 1) {
    for (let spalte = 0; spalte < 6; spalte += 1) {
      const id = `r${zeile}-${spalte}`;
      rooms.push(
        rechteck(id, `Raum ${zeile}.${spalte}`, [spalte * b, zeile * t], [(spalte + 1) * b, (zeile + 1) * t], {
          nummer: `${zeile}.${String(spalte).padStart(2, "0")}`,
          oeffnungen: {
            0: [fenster(`${id}-f`, 1200)],
            1: [tuer(`${id}-t`, 1300)],
          },
        }),
      );
    }
  }
  return plan(rooms);
}

/**
 * Der reale Grundriss aus dem Messlauf der Phase 4a (`PR-2026-0006`), aus der
 * Entwicklungsdatenbank übernommen: 7 Räume, 30 Wände, 15 Öffnungen. Nur 4
 * Wandpaare sind exakt deckungsgleich; 7 Paare liegen nur **teilweise**
 * übereinander (lange Flurwand gegen Bad, Schlafen, Kind; Wohnen gegen Küche
 * und Flur; Schlafen gegen Bad und HWR). Bad-, Schlafen- und Kindertür sind
 * nur an der jeweils kurzen Raumwand gespeichert.
 */
export function messlauf4a(): Geschossplan {
  const t = (id: string, offset: number) => tuer(id, offset, 885);
  const f = (id: string, offset: number) => ({ ...fenster(id, offset, 1010), hoehe: 1260 });
  return plan([
    rechteck("wohnen", "Wohnen", [0, 0], [5000, 5000], {
      nummer: "0.01",
      oeffnungen: { 0: [f("f-wohnen-s", 2000)], 3: [f("f-wohnen-w", 2000)] },
    }),
    rechteck("kueche", "Küche", [0, 5000], [4000, 9000], {
      nummer: "0.02",
      oeffnungen: { 2: [f("f-kueche-n", 1500)], 3: [f("f-kueche-w", 1500)] },
    }),
    raum(
      "flur",
      "Flur",
      [
        [5000, 0],
        [6500, 0],
        [6500, 9000],
        [4000, 9000],
        [4000, 5000],
        [5000, 5000],
      ],
      {
        nummer: "0.03",
        oeffnungen: {
          0: [t("t-haustuer", 300)],
          3: [t("t-kueche", 1500)], // (4000,9000)→(4000,5000), gemeinsam mit Küche
          5: [t("t-wohnen", 1100)], // (5000,5000)→(5000,0), gemeinsam mit Wohnen
        },
      },
    ),
    rechteck("bad", "Bad", [6500, 0], [9000, 3000], {
      nummer: "0.04",
      // Wand 3 (6500,3000)→(6500,0) liegt auf der langen Flurwand.
      oeffnungen: { 0: [f("f-bad", 700)], 3: [t("t-bad", 1000)] },
    }),
    rechteck("hwr", "HWR", [9000, 0], [11000, 3000], {
      nummer: "0.05",
      oeffnungen: { 0: [f("f-hwr", 500)], 3: [t("t-hwr", 1000)] },
    }),
    rechteck("schlafen", "Schlafen", [6500, 3000], [11000, 6500], {
      nummer: "0.06",
      oeffnungen: { 1: [f("f-schlafen", 1300)], 3: [t("t-schlafen", 1800)] },
    }),
    rechteck("kind", "Kind", [6500, 6500], [11000, 9000], {
      nummer: "0.07",
      oeffnungen: { 2: [f("f-kind", 1800)], 3: [t("t-kind", 800)] },
    }),
  ]);
}
