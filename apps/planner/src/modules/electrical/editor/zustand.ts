/**
 * Zustand des Grundrisseditors - ein Reducer, keine verstreuten `useState`-Ketten.
 *
 * Getrennt gehalten werden:
 *
 * | Teil | Feld | Herkunft |
 * |---|---|---|
 * | zuletzt geladener Serverstand | `basis` | Plan-Endpunkt oder Speicherantwort |
 * | lokaler Entwurf | `entwurf` | Bearbeitung, nur bis zum Speichern |
 * | Auswahl | `auswahl` | Zeiger/Tastatur - **keine** Historie |
 * | aktives Werkzeug und laufende Zeichnung | `werkzeug`, `zeichnung` | Werkzeugleiste |
 * | Undo/Redo | `zurueck`, `vor` | nur fachliche Entwurfsänderungen |
 * | Speicherstatus | `status` | Ablauf des Speicherns |
 * | serverseitige Fehler | `serverFehler` | Fehlerantwort des Servers |
 *
 * Der **Viewport** gehört bewusst nicht hierher: Zoom und Pan sind reine
 * Ansicht, ändern keinen Entwurf und erzeugen keinen Historieneintrag.
 *
 * Der Entwurf umfasst immer **einen** Raum - denselben, den
 * `PUT /rooms/{id}/contour` atomar speichert.
 */
import type { Punkt } from "./geometrie";
import type { Raumbasis, Raumentwurf } from "./entwurf";
import { basisAus, gleicherStand } from "./entwurf";
import type { RaumImPlan } from "./entwurf";
import type { components } from "@elektroplan/api-client";

type RaumStammdaten = components["schemas"]["RoomOut"];

export type Werkzeug = "auswahl" | "pan" | "rechteck" | "polygon" | "oeffnung";

export type Speicherstatus =
  | "sauber"
  | "geaendert"
  | "speichert"
  | "gespeichert"
  | "konflikt"
  | "validierung"
  | "fehler";

export type Auswahl =
  | { art: "raum"; raumId: string }
  | { art: "wand"; raumId: string; wandId: string }
  | { art: "ecke"; raumId: string; punkt: Punkt }
  | { art: "oeffnung"; raumId: string; wandId: string; oeffnungId: string }
  | null;

export interface Fehlereintrag {
  readonly code: string;
  readonly meldung: string;
  readonly keys: readonly string[];
}

export interface ServerFehler {
  readonly meldung: string;
  readonly eintraege: readonly Fehlereintrag[];
}

export interface EditorZustand {
  readonly basis: Raumbasis | null;
  readonly entwurf: Raumentwurf | null;
  readonly auswahl: Auswahl;
  readonly werkzeug: Werkzeug;
  /** Bereits gesetzte Punkte des laufenden Rechteck- oder Polygonzugs. */
  readonly zeichnung: readonly Punkt[];
  readonly zurueck: readonly Raumentwurf[];
  readonly vor: readonly Raumentwurf[];
  /** Stand zu Beginn einer Ziehbewegung - daraus wird **ein** Historienschritt. */
  readonly ziehenAb: Raumentwurf | null;
  readonly status: Speicherstatus;
  readonly serverFehler: ServerFehler | null;
}

/** Obergrenze der Historie: genug für eine lange Sitzung, kein unbegrenzter Speicher. */
export const MAX_HISTORIE = 100;

export const ANFANG: EditorZustand = {
  basis: null,
  entwurf: null,
  auswahl: null,
  werkzeug: "auswahl",
  zeichnung: [],
  zurueck: [],
  vor: [],
  ziehenAb: null,
  status: "sauber",
  serverFehler: null,
};

export type Aktion =
  | { typ: "raum-aktivieren"; raum: RaumImPlan; auswahl?: Auswahl }
  | { typ: "raum-verlassen" }
  | { typ: "serverstand"; raum: RaumImPlan }
  | { typ: "stammdaten"; raum: RaumStammdaten }
  | { typ: "aendern"; entwurf: Raumentwurf }
  | { typ: "ziehen-beginnen" }
  | { typ: "ziehen-vorschau"; entwurf: Raumentwurf }
  | { typ: "ziehen-beenden" }
  | { typ: "ziehen-abbrechen" }
  | { typ: "rueckgaengig" }
  | { typ: "wiederholen" }
  | { typ: "auswaehlen"; auswahl: Auswahl }
  | { typ: "werkzeug"; werkzeug: Werkzeug }
  | { typ: "zeichnung"; punkte: readonly Punkt[] }
  | { typ: "speichern-beginnt" }
  | { typ: "gespeichert"; raum: RaumImPlan }
  | { typ: "speichern-gescheitert"; status: "konflikt" | "validierung" | "fehler"; fehler: ServerFehler }
  | { typ: "hinweis-schliessen" }
  | { typ: "verwerfen" };

/** Hat der Entwurf ungespeicherte Änderungen gegenüber dem Serverstand? */
export function ungespeichert(z: EditorZustand): boolean {
  if (z.basis === null || z.entwurf === null) return false;
  return !gleicherStand(z.basis.entwurf, z.entwurf);
}

function nachAenderung(z: EditorZustand, entwurf: Raumentwurf, zurueck: readonly Raumentwurf[], vor: readonly Raumentwurf[]): EditorZustand {
  const neu: EditorZustand = { ...z, entwurf, zurueck, vor };
  const offen = ungespeichert(neu);
  // Ein Konflikt bleibt sichtbar, bis der Benutzer entscheidet; sonst folgt
  // der Status dem Vergleich mit dem Serverstand.
  const status = z.status === "konflikt" ? "konflikt" : offen ? "geaendert" : "sauber";
  // Zurück auf dem Serverstand gibt es nichts mehr zu melden; sonst bleiben
  // die Markierungen bis zum nächsten Speichern sichtbar.
  return { ...neu, status, serverFehler: offen || status === "konflikt" ? z.serverFehler : null };
}

function begrenzt(liste: readonly Raumentwurf[]): readonly Raumentwurf[] {
  return liste.length > MAX_HISTORIE ? liste.slice(liste.length - MAX_HISTORIE) : liste;
}

function frisch(z: EditorZustand, raum: RaumImPlan, auswahl: Auswahl): EditorZustand {
  const basis = basisAus(raum);
  return {
    ...z,
    basis,
    entwurf: basis.entwurf,
    auswahl,
    zurueck: [],
    vor: [],
    ziehenAb: null,
    status: "sauber",
    serverFehler: null,
  };
}

export function editorReducer(z: EditorZustand, a: Aktion): EditorZustand {
  switch (a.typ) {
    case "raum-aktivieren":
      return frisch(z, a.raum, a.auswahl ?? { art: "raum", raumId: a.raum.id });

    case "raum-verlassen":
      return { ...z, basis: null, entwurf: null, auswahl: null, zurueck: [], vor: [], ziehenAb: null, status: "sauber", serverFehler: null };

    case "serverstand": {
      // Ein neu geladener Serverstand ersetzt nur einen **unveränderten**
      // Entwurf. Lokale Änderungen werden nie still verworfen.
      if (z.basis === null || z.basis.raum.id !== a.raum.id) return z;
      if (ungespeichert(z) || z.status === "speichert") return z;
      return { ...frisch(z, a.raum, z.auswahl), status: z.status === "gespeichert" ? "gespeichert" : "sauber" };
    }

    case "stammdaten":
      // Name, Nummer oder Höhe wurden mit ``If-Match`` der Basisversion
      // gespeichert. Die neue Version gehört damit zu genau diesem Stand und
      // darf in die Basis übernommen werden - die Kontur bleibt unberührt.
      if (z.basis === null || z.basis.raum.id !== a.raum.id) return z;
      return { ...z, basis: { ...z.basis, raum: { ...z.basis.raum, ...a.raum } } };

    case "aendern":
      if (z.entwurf === null || gleicherStand(z.entwurf, a.entwurf)) return z;
      return nachAenderung(z, a.entwurf, begrenzt([...z.zurueck, z.entwurf]), []);

    case "ziehen-beginnen":
      return z.entwurf === null ? z : { ...z, ziehenAb: z.entwurf };

    case "ziehen-vorschau":
      // Während des Ziehens wandert nur der Entwurf - keine Historie.
      return z.ziehenAb === null ? z : { ...z, entwurf: a.entwurf };

    case "ziehen-beenden": {
      if (z.ziehenAb === null || z.entwurf === null) return { ...z, ziehenAb: null };
      if (gleicherStand(z.ziehenAb, z.entwurf)) return { ...z, entwurf: z.ziehenAb, ziehenAb: null };
      return { ...nachAenderung(z, z.entwurf, begrenzt([...z.zurueck, z.ziehenAb]), []), ziehenAb: null };
    }

    case "ziehen-abbrechen":
      return z.ziehenAb === null ? z : { ...z, entwurf: z.ziehenAb, ziehenAb: null };

    case "rueckgaengig": {
      const vorher = z.zurueck[z.zurueck.length - 1];
      if (vorher === undefined || z.entwurf === null) return z;
      return nachAenderung(z, vorher, z.zurueck.slice(0, -1), [z.entwurf, ...z.vor]);
    }

    case "wiederholen": {
      const naechster = z.vor[0];
      if (naechster === undefined || z.entwurf === null) return z;
      return nachAenderung(z, naechster, begrenzt([...z.zurueck, z.entwurf]), z.vor.slice(1));
    }

    case "auswaehlen":
      return { ...z, auswahl: a.auswahl };

    case "werkzeug":
      return { ...z, werkzeug: a.werkzeug, zeichnung: [] };

    case "zeichnung":
      return { ...z, zeichnung: a.punkte };

    case "speichern-beginnt":
      return { ...z, status: "speichert", serverFehler: null };

    case "gespeichert": {
      // Die Serverantwort wird die neue Basis; die Historie beginnt neu.
      const neu = frisch(z, a.raum, z.auswahl);
      return { ...neu, status: "gespeichert" };
    }

    case "speichern-gescheitert":
      // Der lokale Entwurf bleibt in jedem Fall erhalten.
      return { ...z, status: a.status, serverFehler: a.fehler };

    case "hinweis-schliessen":
      return { ...z, serverFehler: null, status: ungespeichert(z) ? "geaendert" : "sauber" };

    case "verwerfen":
      if (z.basis === null) return z;
      return frisch(z, z.basis.raum, z.auswahl);
  }
}

/** IDs, die der Server in seiner letzten Fehlerantwort genannt hat. */
export function fehlerhafteKeys(z: EditorZustand): ReadonlySet<string> {
  return new Set(z.serverFehler?.eintraege.flatMap((e) => e.keys) ?? []);
}
