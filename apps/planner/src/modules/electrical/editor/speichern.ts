/**
 * Auswertung einer Fehlerantwort beim Speichern der Raumkontur.
 *
 * Der Server liefert RFC 9457 mit stabilem `type`, und bei Geometriefehlern
 * je Befund einen `code` samt `keys` (IDs der betroffenen Wände oder
 * Öffnungen). Die Oberfläche zeigt **keine** Rohmeldungen: Bekannte Codes
 * erhalten einen deutschen Satz; unbekannte fallen auf die Servermeldung
 * zurück, die ebenfalls für Menschen geschrieben ist.
 */
import { ApiError } from "@elektroplan/api-client";

import type { Fehlereintrag, ServerFehler } from "./zustand";

export const GEOMETRIEFEHLER: Record<string, string> = {
  "wall-degenerate": "Start- und Endpunkt einer Wand sind identisch.",
  "coordinate-out-of-range": "Ein Punkt liegt außerhalb des zulässigen Bereichs von ±1 km.",
  "wall-length-implausible": "Eine Wand ist kürzer als 10 cm (100 mm) oder länger als 100 m.",
  "wall-duplicate": "Zwei Wände verlaufen zwischen denselben Punkten.",
  "walls-intersect": "Zwei Wände überschneiden oder berühren sich.",
  "wall-backtracks": "Zwei aufeinanderfolgende Wände laufen übereinander zurück.",
  "contour-too-few-walls": "Eine geschlossene Raumkontur braucht mindestens drei Wände.",
  "contour-gap": "Zwischen zwei Wänden ist eine Lücke.",
  "contour-not-closed": "Die Kontur ist nicht geschlossen.",
  "contour-without-area": "Die Kontur umschließt keine Fläche.",
  "opening-exceeds-wall": "Eine Öffnung ragt über ihre Wand hinaus.",
  "openings-overlap": "Zwei Öffnungen derselben Wand überschneiden sich.",
  "opening-offset-negative": "Der Abstand einer Öffnung vom Wandanfang ist negativ.",
  "opening-width-not-positive": "Die Breite einer Öffnung muss größer als null sein.",
  "opening-exceeds-room-height": "Eine Öffnung ist höher als der Raum.",
  "window-needs-sill": "Ein Fenster braucht eine Brüstungshöhe größer als null.",
  "sill-only-for-window": "Eine Brüstungshöhe gibt es nur beim Fenster.",
  "wall-has-openings": "Eine Wand, die entfernt werden soll, trägt noch Öffnungen.",
  "opening-missing": "Eine gespeicherte Öffnung fehlt im Entwurf.",
  "opening-wall-changed": "Eine Öffnung kann ihre Wand nicht wechseln.",
  "wall-foreign": "Eine Wand gehört nicht zu diesem Raum.",
  "opening-foreign": "Eine Öffnung gehört nicht zu diesem Raum.",
  "wall-id-duplicate": "Eine Wand-ID kommt mehrfach vor.",
  "opening-id-duplicate": "Eine Öffnungs-ID kommt mehrfach vor.",
};

export function geometrietext(code: string, rueckfall?: string): string {
  return GEOMETRIEFEHLER[code] ?? rueckfall ?? "Die Geometrie ist an dieser Stelle nicht zulässig.";
}

export interface Auswertung {
  readonly status: "konflikt" | "validierung" | "fehler";
  readonly fehler: ServerFehler;
}

function eintraege(error: ApiError): Fehlereintrag[] {
  return (error.problem?.errors ?? []).map((e) => ({
    code: e.code,
    meldung: e.field === "geometry" ? geometrietext(e.code, e.message) : e.message,
    keys: e.keys ?? [],
  }));
}

export function fehlerAuswerten(error: unknown): Auswertung {
  if (!(error instanceof ApiError)) {
    return {
      status: "fehler",
      fehler: {
        meldung:
          "Der Server ist nicht erreichbar. Ihr Entwurf ist unverändert erhalten - bitte später erneut speichern.",
        eintraege: [],
      },
    };
  }
  const typ = error.errorType;
  if (error.status === 409 && typ === "version-conflict") {
    return {
      status: "konflikt",
      fehler: {
        meldung:
          "Dieser Raum wurde zwischenzeitlich an anderer Stelle geändert. Ihre Änderungen wurden nicht gespeichert und sind hier weiterhin vorhanden.",
        eintraege: [],
      },
    };
  }
  if (error.status === 409 && typ === "project-archived") {
    return {
      status: "fehler",
      fehler: {
        meldung: "Das Projekt wurde inzwischen archiviert und ist schreibgeschützt. Es wurde nichts gespeichert.",
        eintraege: [],
      },
    };
  }
  const liste = eintraege(error);
  if (error.status === 422 || (error.status === 409 && liste.length > 0)) {
    return {
      status: "validierung",
      fehler: {
        meldung:
          "Der Server hat den Entwurf nicht angenommen. Die betroffenen Stellen sind rot markiert; es wurde nichts gespeichert.",
        eintraege: liste,
      },
    };
  }
  return { status: "fehler", fehler: { meldung: error.userMessage, eintraege: liste } };
}
