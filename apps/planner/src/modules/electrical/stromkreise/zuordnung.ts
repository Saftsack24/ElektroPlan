import { ApiError } from "@elektroplan/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { useAuth } from "../../../core/auth/AuthProvider";
import type { Stromkreis, Zuordnungsentwurf } from "./daten";
import {
  stromkreiseAbfrage,
  stromkreiseSchluessel,
  verteilungenSchluessel,
  zuordnungAus,
  zuordnungGeaendert,
  zuordnungUmschalten,
} from "./daten";
import { fehlermeldung } from "./texte";
import type { Geraetezustand } from "./ZuordnungsFlaeche";

/**
 * Der **eine** Zuordnungsentwurf eines Stromkreises (Phase 6b.1, seit 6b.4 auch
 * in Wand- und Deckenansicht): dieselben Regeln, derselbe Speicherweg, dieselbe
 * Konfliktbehandlung - unabhängig davon, wo zugeordnet wird.
 *
 * * Ziele sind nur **gespeicherte**, zuordenbare Geräte des Gebäudes.
 * * Ein Gerät eines anderen Stromkreises bleibt dort; es wird nie still umgehängt.
 * * Gespeichert wird nur ausdrücklich (`PUT /circuits/{id}/devices`, `If-Match`).
 * * Bei einem Konflikt bleibt der Entwurf, bis bewusst verworfen und neu geladen wird.
 *
 * Rückfragen vor dem Verwerfen stellt der Aufrufer - er kennt die Situation.
 */
export function geraetezustand(
  id: string,
  zuordenbar: boolean,
  entwurf: Zuordnungsentwurf | null,
  zuordnung: ReadonlyMap<string, Stromkreis>,
): Geraetezustand {
  if (!zuordenbar) return "nicht-zuordenbar";
  if (entwurf?.auswahl.has(id) === true) return "dieser";
  const anderer = zuordnung.get(id);
  if (anderer !== undefined && anderer.id !== entwurf?.circuitId) return "anderer";
  return "frei";
}

export function useZuordnungsentwurf({
  buildingId,
  darfSchreiben,
  onGeschrieben,
}: {
  buildingId: string;
  darfSchreiben: boolean;
  onGeschrieben?: (() => Promise<void>) | undefined;
}) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const [entwurf, setEntwurf] = useState<Zuordnungsentwurf | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [konflikt, setKonflikt] = useState(false);
  const [speichert, setSpeichert] = useState(false);

  const offen = darfSchreiben && entwurf !== null && zuordnungGeaendert(entwurf);

  const neuLadenAlle = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: verteilungenSchluessel(buildingId) });
    await queryClient.invalidateQueries({ queryKey: stromkreiseSchluessel(buildingId) });
  }, [queryClient, buildingId]);

  const oeffnen = useCallback((kreis: Stromkreis) => {
    setFehler(null);
    setKonflikt(false);
    setEntwurf(zuordnungAus(kreis));
  }, []);

  const schliessen = useCallback(() => {
    setEntwurf(null);
    setFehler(null);
    setKonflikt(false);
  }, []);

  const umschalten = useCallback((id: string) => {
    setEntwurf((e) => (e === null ? e : zuordnungUmschalten(e, id)));
  }, []);

  const verwerfen = useCallback((kreis: Stromkreis) => setEntwurf(zuordnungAus(kreis)), []);

  const speichern = useCallback(async (): Promise<boolean> => {
    if (entwurf === null) return false;
    setSpeichert(true);
    setFehler(null);
    try {
      const gespeichert = await api.put("/api/v1/modules/electrical/circuits/{circuit_id}/devices", {
        path: { circuit_id: entwurf.circuitId },
        ifMatch: entwurf.version,
        body: { device_ids: [...entwurf.auswahl].sort() },
      });
      setEntwurf(zuordnungAus(gespeichert));
      setKonflikt(false);
      await neuLadenAlle();
      await onGeschrieben?.();
      return true;
    } catch (error: unknown) {
      const konfliktfall =
        error instanceof ApiError &&
        (error.errorType === "version-conflict" ||
          (error.problem?.errors ?? []).some((e) => e.code === "device-assigned-elsewhere" || e.code === "circuit-device-not-in-building"));
      setKonflikt(konfliktfall);
      setFehler(fehlermeldung(error, "Die Zuordnung konnte nicht gespeichert werden."));
      return false;
    } finally {
      setSpeichert(false);
    }
  }, [api, entwurf, neuLadenAlle, onGeschrieben]);

  /** Nach einem Konflikt: Entwurf bewusst verwerfen und den Serverstand laden. */
  const neuLaden = useCallback(async () => {
    if (entwurf === null) return;
    const frisch = await queryClient.fetchQuery({ ...stromkreiseAbfrage(api, buildingId) });
    const kreis = frisch.circuits.find((k) => k.id === entwurf.circuitId);
    setKonflikt(false);
    setFehler(null);
    setEntwurf(kreis === undefined ? null : zuordnungAus(kreis));
    await queryClient.invalidateQueries({ queryKey: verteilungenSchluessel(buildingId) });
  }, [api, buildingId, entwurf, queryClient]);

  return { entwurf, offen, fehler, konflikt, speichert, oeffnen, schliessen, umschalten, verwerfen, speichern, neuLaden, neuLadenAlle };
}
