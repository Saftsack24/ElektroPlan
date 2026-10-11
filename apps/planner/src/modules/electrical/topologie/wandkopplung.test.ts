import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { Flaeche, PruefGeraet, Pruefmass, PruefRaum } from "../geraete/geraetepruefung";
import { geraetebefunde } from "../geraete/geraetepruefung";
import { fremdeBereiche, oeffnungenEinordnen } from "./oeffnungen";
import type { TopoKopplung, TopoWand } from "./wandtopologie";
import { kopplungsstatus, wandtopologie } from "./wandtopologie";

/**
 * Parität der Wandkopplung zur verbindlichen Serverregel (Phase 6a, ADR 0024):
 * Dieselbe Datei prüft `apps/backend/tests/test_wall_link_parity.py` gegen
 * `topology.py`, `link_rules.py` und `devices.py`. Die Kandidaten
 * (Vorschläge) berechnet nur der Server; der Editor zeigt sie aus dem Plan.
 */
interface Fixture {
  version: number;
  typen: Record<string, { breite: number; hoehe: number; innen: boolean; aussen: boolean; decke: boolean }>;
  faelle: {
    name: string;
    raeume: {
      id: string;
      hoehe: number;
      waende: {
        id: string;
        w: [number, number, number, number];
        oeffnungen: { id: string; abstand: number; breite: number; bruestung: number; hoehe: number }[];
      }[];
    }[];
    kopplungen: { id: string; a: string; b: string; beziehung: "shared" | "separate" }[];
    geraete: { id: string; raum: string; typ: string; flaeche: Flaeche; wand?: string; mitte?: number; mittelhoehe?: number }[];
    erwartet: {
      abschnitte: Record<string, string[]>;
      fremdoeffnungen: Record<string, string[]>;
      geraete: Record<string, string[]>;
      kopplungen: Record<string, string>;
    };
  }[];
}

const pfad = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../testdata/geometry/wandkopplung.v1.json");
const daten = JSON.parse(readFileSync(pfad, "utf-8")) as Fixture;
const typen: ReadonlyMap<string, Pruefmass> = new Map(Object.entries(daten.typen));

function waendeVon(fall: Fixture["faelle"][number]): TopoWand[] {
  return fall.raeume.flatMap((r) =>
    r.waende.map((w) => ({
      id: w.id,
      raumId: r.id,
      start: { x: w.w[0], y: w.w[1] },
      ende: { x: w.w[2], y: w.w[3] },
      oeffnungen: w.oeffnungen.map((o) => ({
        oeffnungId: o.id,
        art: "door" as const,
        offsetMm: o.abstand,
        breiteMm: o.breite,
        hoeheMm: o.hoehe,
        bruestungMm: o.bruestung,
      })),
    })),
  );
}

function kopplungenVon(fall: Fixture["faelle"][number]): TopoKopplung[] {
  return fall.kopplungen.map((k) => ({ id: k.id, wandA: k.a, wandB: k.b, beziehung: k.beziehung }));
}

describe("Wandkopplung - Parität mit dem Backend (Fixture v1)", () => {
  it("liest die erwartete Fassung", () => {
    expect(daten.version).toBe(1);
  });

  for (const fall of daten.faelle) {
    it(fall.name, () => {
      const topologie = wandtopologie("geschoss", waendeVon(fall), kopplungenVon(fall));

      for (const [wandId, zustaende] of Object.entries(fall.erwartet.abschnitte)) {
        expect(topologie.teilung.get(wandId)?.abschnitte.map((a) => a.zuordnung), wandId).toEqual(zustaende);
      }
      for (const [wandId, oeffnungen] of Object.entries(fall.erwartet.fremdoeffnungen)) {
        const teilung = topologie.teilung.get(wandId);
        const gefunden = teilung === undefined ? [] : fremdeBereiche(teilung).map((f) => f.oeffnungId).sort();
        expect(gefunden, wandId).toEqual([...oeffnungen].sort());
      }
      for (const k of kopplungenVon(fall)) {
        expect(kopplungsstatus(topologie, k), k.id).toBe(fall.erwartet.kopplungen[k.id]);
      }

      const raeume: PruefRaum[] = fall.raeume.map((r) => ({
        id: r.id,
        hoeheMm: r.hoehe,
        waende: waendeVon(fall).filter((w) => w.raumId === r.id),
      }));
      const geraete: PruefGeraet[] = fall.geraete.map((g) => ({
        id: g.id,
        raumId: g.raum,
        typ: g.typ,
        flaeche: g.flaeche,
        wandId: g.wand ?? null,
        mitte: g.mitte ?? null,
        mittelhoehe: g.mittelhoehe ?? null,
        x: null,
        y: null,
      }));
      const je = new Map<string, Set<string>>(geraete.map((g) => [g.id, new Set<string>()]));
      for (const b of geraetebefunde("geschoss", raeume, geraete, typen, kopplungenVon(fall))) {
        je.get(b.keys[0] ?? "")?.add(b.code);
      }
      for (const [id, codes] of Object.entries(fall.erwartet.geraete)) {
        expect([...(je.get(id) ?? [])].sort(), id).toEqual(codes);
      }
    });
  }
});

describe("Öffnungen auf getrennten Wänden", () => {
  const fall = daten.faelle[1] as Fixture["faelle"][number];

  it("eine Öffnung auf separate gehört nur ihrer Wand und ist einseitig", () => {
    const einordnung = oeffnungenEinordnen(wandtopologie("geschoss", waendeVon(fall), kopplungenVon(fall)));
    const t1 = einordnung.get("t1");
    expect(t1?.klasse).toBe("getrennt");
    expect(t1?.nachbarRaumId).toBeNull();
    expect(t1?.einseitig).toBe(true);
  });

  it("ohne Kopplung verbindet dieselbe Öffnung beide Räume (Phase 5)", () => {
    const einordnung = oeffnungenEinordnen(wandtopologie("geschoss", waendeVon(fall)));
    expect(einordnung.get("t1")?.klasse).toBe("gemeinsam");
    expect(einordnung.get("t1")?.einseitig).toBe(false);
  });

  it("beidseitig erfasste Öffnungen auf separate sind weder Dublette noch Widerspruch", () => {
    const waende = waendeVon(fall).map((w) =>
      w.id === "b4"
        ? { ...w, oeffnungen: [{ oeffnungId: "t2", art: "door" as const, offsetMm: 1100, breiteMm: 900, hoeheMm: 2000, bruestungMm: 0 }] }
        : w,
    );
    const einordnung = oeffnungenEinordnen(wandtopologie("geschoss", waende, kopplungenVon(fall)));
    for (const id of ["t1", "t2"]) {
      expect(einordnung.get(id)?.klasse).toBe("getrennt");
      expect(einordnung.get(id)?.dubletten).toEqual([]);
      expect(einordnung.get(id)?.widersprueche).toEqual([]);
      expect(einordnung.get(id)?.einseitig).toBe(false);
    }
  });
});
