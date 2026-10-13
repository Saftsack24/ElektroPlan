import { ApiError } from "@elektroplan/api-client";
import { useCallback } from "react";

import { useRueckfrage } from "../../../core/ui/Rueckfrage";

/**
 * Bestätigung für Änderungen, die Leitungen unterbrechen (Entwurf §7, D4).
 *
 * Der Server prüft unter der Projektsperre, welche Leitungen eine Änderung
 * unterbrechen würde, und antwortet ohne Bestätigung mit
 * `409 cables-would-break` - je Leitung ein Eintrag mit ihrer ID und einer
 * verständlichen Beschreibung (Stromkreis, Bezeichnung, Endgeräte, Grund).
 *
 * Diese Rückfrage nennt genau diese Leitungen, erklärt die Wirkung und sendet
 * nach der Bestätigung **genau** ihre IDs (`acknowledged_cable_ids`) - nie eine
 * pauschale Erlaubnis. Hat sich der Stand inzwischen geändert und sind andere
 * Leitungen betroffen, antwortet der Server erneut mit `409`; dann wird
 * erneut gefragt. Harte Schutzregeln (`422`, etwa Durchführungen) lassen sich
 * hier nie bestätigen - sie kommen als gewöhnlicher Fehler zurück.
 */
export interface BetroffeneLeitung {
  readonly id: string;
  readonly text: string;
}

/** Betroffene Leitungen aus einer `409`-Antwort - oder `null`, wenn es keine solche ist. */
export function betroffeneLeitungen(error: unknown): BetroffeneLeitung[] | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const eintraege = (error.problem?.errors ?? []).filter((e) => e.code === "cables-would-break");
  if (eintraege.length === 0) return null;
  const ergebnis: BetroffeneLeitung[] = [];
  for (const e of eintraege) {
    for (const id of e.keys ?? []) if (!ergebnis.some((b) => b.id === id)) ergebnis.push({ id, text: e.message });
  }
  return ergebnis.length === 0 ? null : ergebnis;
}

/** Bestätigungsfeld der Anfrage - nur, wenn wirklich bestätigt wurde; sonst bleibt die Anfrage wie bisher. */
export function bestaetigungsfeld(bestaetigt: readonly string[]): { acknowledged_cable_ids?: string[] } {
  return bestaetigt.length > 0 ? { acknowledged_cable_ids: [...bestaetigt] } : {};
}

/** Die Rückfrage wurde abgelehnt - nichts gespeichert, kein Fehler. */
export class BestaetigungAbgelehnt extends Error {
  constructor() {
    super("Leitungsunterbrechung nicht bestätigt");
    this.name = "BestaetigungAbgelehnt";
  }
}

/** Höchstens so oft wird nach einer geänderten Lage erneut gefragt. */
const MAX_RUNDEN = 4;

/**
 * Liefert `mitBestaetigung(senden)`: `senden(ids)` schickt die Änderung mit
 * genau diesen bestätigten Leitungen (zuerst keine). Ablehnung wirft
 * {@link BestaetigungAbgelehnt}; jeder andere Fehler wird unverändert
 * weitergereicht.
 */
export function useLeitungsbestaetigung() {
  const fragen = useRueckfrage();
  return useCallback(
    async <T,>(senden: (bestaetigt: string[]) => Promise<T>): Promise<T> => {
      let bestaetigt: string[] = [];
      for (let runde = 0; ; runde += 1) {
        try {
          return await senden(bestaetigt);
        } catch (error: unknown) {
          const betroffen = betroffeneLeitungen(error);
          if (betroffen === null || runde >= MAX_RUNDEN) throw error;
          const erneut = bestaetigt.length > 0;
          const antwort = await fragen({
            titel: betroffen.length === 1 ? "Eine Leitung würde unterbrochen" : `${betroffen.length} Leitungen würden unterbrochen`,
            text: (
              <>
                {erneut && (
                  <p>
                    <strong>Der Stand hat sich seit Ihrer Bestätigung geändert.</strong> Jetzt sind diese Leitungen betroffen –
                    bitte erneut entscheiden.
                  </p>
                )}
                <p>Diese Änderung unterbricht {betroffen.length === 1 ? "folgende Leitung" : "folgende Leitungen"}:</p>
                <ul data-testid="betroffene-leitungen">
                  {betroffen.map((b) => (
                    <li key={b.id}>{b.text}</li>
                  ))}
                </ul>
                <p>
                  Nach dem Speichern {betroffen.length === 1 ? "bleibt sie" : "bleiben sie"} bestehen, {betroffen.length === 1 ? "ist" : "sind"}{" "}
                  aber im <strong>Konflikt</strong>: ohne Gesamtlänge und nicht in bestätigten Mengen, bis der Weg neu geplant
                  ist. Nichts wird automatisch verschoben oder gelöscht.
                </p>
              </>
            ),
            bestaetigenLabel: betroffen.length === 1 ? "Speichern – Leitung wird Konflikt" : "Speichern – Leitungen werden Konflikt",
            abbrechenLabel: "Nicht speichern",
          });
          if (antwort !== "bestaetigt") throw new BestaetigungAbgelehnt();
          bestaetigt = betroffen.map((b) => b.id);
        }
      }
    },
    [fragen],
  );
}
