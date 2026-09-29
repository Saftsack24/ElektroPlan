/**
 * Die eine Stelle, an der fachliche Millimeter zu Szenenmetern werden.
 *
 * Fachlich bleibt alles ganzzahlig in Millimetern (ADR 0007). Erst hier, an
 * der Grenze zur 3D-Szene, wird **einmalig** umgerechnet - und nie zurück:
 * Die 3D-Ansicht schreibt nichts (ADR 0016).
 *
 * Achsen (Grundriss nach ADR 0013: x nach rechts, y in der Draufsicht nach
 * oben, z = Höhe über Fertigfußboden):
 *
 * | Grundriss | Three.js |
 * |---|---|
 * | x         | +X       |
 * | y         | −Z       |
 * | z (Höhe)  | +Y       |
 *
 * Mit dieser Wahl zeigt eine Draufsicht von +Y (Blick nach unten, „oben"
 * am Bildschirm = −Z) den Grundriss genau so, wie der 2D-Editor ihn zeigt:
 * nicht gespiegelt, gleicher Umlaufsinn. Ein im Grundriss gegen den
 * Uhrzeigersinn laufendes Dreieck hat in der Szene eine nach oben (+Y)
 * zeigende Normale.
 *
 * Der Grundriss wird um den Mittelpunkt seiner Ausdehnung zentriert. Große,
 * aber erlaubte absolute Koordinaten (±1 km) landen so nahe am Ursprung und
 * belasten die Float-Genauigkeit von WebGL nicht.
 */

/** Achsenparalleler Bereich des Grundrisses in ganzen Millimetern. */
export interface GrenzenMm {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Nachvollziehbare Umrechnung - steht vollständig im Szenenmodell. */
export interface Transformation {
  /** Grundrisspunkt, der im Szenenursprung liegt (ganze Millimeter). */
  readonly mitteXMm: number;
  readonly mitteYMm: number;
  /** Meter je Millimeter - fest, nur zur Dokumentation mitgeführt. */
  readonly meterJeMm: number;
}

export interface Szenenpunkt {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const METER_JE_MM = 0.001;

/**
 * Transformation für einen Grundriss. Der Mittelpunkt wird auf ganze
 * Millimeter abgerundet, damit auch die Transformation selbst ganzzahlig und
 * reproduzierbar bleibt. Ein leerer Plan liegt im Ursprung.
 */
export function transformationFuer(grenzen: GrenzenMm | null): Transformation {
  if (grenzen === null) return { mitteXMm: 0, mitteYMm: 0, meterJeMm: METER_JE_MM };
  return {
    mitteXMm: Math.floor((grenzen.minX + grenzen.maxX) / 2),
    mitteYMm: Math.floor((grenzen.minY + grenzen.maxY) / 2),
    meterJeMm: METER_JE_MM,
  };
}

/** Länge oder Höhe in Metern - ohne Verschiebung. */
export function inMeter(mm: number): number {
  return mm * METER_JE_MM;
}

/** Grundrisspunkt (mm) samt Höhe über FFB (mm) als Szenenpunkt (m). */
export function inSzene(
  transformation: Transformation,
  xMm: number,
  yMm: number,
  hoeheMm = 0,
): Szenenpunkt {
  return {
    x: (xMm - transformation.mitteXMm) * transformation.meterJeMm,
    y: hoeheMm * transformation.meterJeMm,
    // Als Differenz geschrieben statt als Negation: kein −0 für die Mitte.
    z: (transformation.mitteYMm - yMm) * transformation.meterJeMm,
  };
}
