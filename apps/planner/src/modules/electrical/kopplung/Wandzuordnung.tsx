import { ApiError } from "@elektroplan/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useAuth } from "../../../core/auth/AuthProvider";
import { Bestaetigung } from "../../../core/ui/Bestaetigung";
import { Marke } from "../../../core/ui/Marke";
import type { MarkenArt } from "../../../core/ui/Marke";
import { useMasse } from "../../../core/ui/masseinheit";
import { knopf, meldungsflaeche } from "../../../core/ui/stil";
import { geometrietext } from "../editor/speichern";
import { planSchluessel } from "../plan";
import type { TopoWand, Wandtopologie } from "../topologie/wandtopologie";
import type { Partnerzustand, Wandpartner } from "./wandpartner";
import { partnerzustand, wandpartner } from "./wandpartner";
import type { KandidatImPlan, KopplungImPlan } from "./zuordnung";
import { BEZIEHUNG_ERKLAERUNG, GRUND_TEXT, OFFEN_ERKLAERUNG, STATUS_TEXT } from "./zuordnung";
import { BestaetigungAbgelehnt, bestaetigungsfeld, useLeitungsbestaetigung } from "../leitung/bestaetigung";
import { durchfuehrungenSchluessel } from "../leitung/daten";

const ZUSTAND: Record<Partnerzustand, { titel: string; art: MarkenArt }> = {
  offen: { titel: "Zuordnung offen", art: "neutral" },
  vorschlag: { titel: "Zuordnung offen – Vorschlag: gemeinsame Bauwand", art: "info" },
  "nicht-eindeutig": { titel: "Nicht eindeutig zuordenbar", art: "warnung" },
  gemeinsam: { titel: "Gemeinsame Bauwand", art: "erfolg" },
  getrennt: { titel: "Getrennte Wände", art: "erfolg" },
  unterbrochen: { titel: "Kopplung unterbrochen", art: "warnung" },
};

type Aktion =
  | { readonly art: "anlegen"; readonly partner: Wandpartner; readonly beziehung: KopplungImPlan["relation"] }
  | { readonly art: "aendern"; readonly kopplung: KopplungImPlan; readonly beziehung: KopplungImPlan["relation"] }
  | { readonly art: "loesen"; readonly kopplung: KopplungImPlan };

/** Fehlerantwort verständlich - Gerätebefunde und Zuordnungsgründe mit deutschem Text. */
function fehlertext(error: unknown): string {
  if (!(error instanceof ApiError)) return "Der Server ist nicht erreichbar. Es wurde nichts gespeichert.";
  if (error.errorType === "version-conflict") {
    return "Die Zuordnung wurde zwischenzeitlich an anderer Stelle geändert. Der aktuelle Stand wird geladen – bitte erneut wählen.";
  }
  const einzeln = (error.problem?.errors ?? []).map((e) => geometrietext(e.code, e.message));
  return [error.userMessage, ...new Set(einzeln)].join(" ");
}

/**
 * Wandzuordnung der gewählten Raumwand (Phase 6a, ADR 0024): Zustand je
 * Nachbarwand, Vorschlag des Servers und - mit Schreibrecht - Bestätigen,
 * Ändern und Lösen. Es wird nie automatisch gekoppelt.
 *
 * Gespeichert wird sofort (eigener Vorgang, nicht Teil des Raumentwurfs). Die
 * Raumversion beider Räume zählt dabei weiter; deshalb nur bei gespeichertem
 * Entwurf - sonst liefe das nächste Speichern in einen Versionskonflikt.
 */
export function Wandzuordnung<W extends TopoWand & { readonly staerkeMm?: number }>({
  topologie,
  wandId,
  kopplungen,
  kandidaten,
  wandName,
  darfSchreiben,
  entwurfOffen,
}: {
  topologie: Wandtopologie<W>;
  wandId: string;
  kopplungen: readonly KopplungImPlan[];
  kandidaten: readonly KandidatImPlan[];
  /** „Wand 3 von „Bad““ - ohne technische IDs. */
  wandName: (wandId: string) => string;
  darfSchreiben: boolean;
  entwurfOffen: boolean;
}) {
  const { api } = useAuth();
  const masse = useMasse();
  const queryClient = useQueryClient();
  // Phase 6b.4: Unterbricht eine Zuordnung Leitungen, werden genau diese bestätigt.
  const mitBestaetigung = useLeitungsbestaetigung();
  const [aktion, setAktion] = useState<Aktion | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const partner = wandpartner(topologie, wandId, kopplungen, kandidaten);
  if (partner.length === 0) return null;

  const ausfuehren = async (a: Aktion) => {
    setLaeuft(true);
    setFehler(null);
    try {
      if (a.art === "anlegen") {
        await mitBestaetigung((bestaetigt) =>
          api.post("/api/v1/modules/electrical/floors/{floor_id}/wall-links", {
            path: { floor_id: topologie.floorId },
            body: { wall_a_id: wandId, wall_b_id: a.partner.wandId, relation: a.beziehung, ...bestaetigungsfeld(bestaetigt) },
          }),
        );
      } else if (a.art === "aendern") {
        await mitBestaetigung((bestaetigt) =>
          api.patch("/api/v1/modules/electrical/wall-links/{link_id}", {
            path: { link_id: a.kopplung.id },
            ifMatch: a.kopplung.version,
            body: { relation: a.beziehung, ...bestaetigungsfeld(bestaetigt) },
          }),
        );
      } else {
        await api.delete("/api/v1/modules/electrical/wall-links/{link_id}", {
          path: { link_id: a.kopplung.id },
          ifMatch: a.kopplung.version,
        });
      }
      setAktion(null);
      await queryClient.invalidateQueries({ queryKey: planSchluessel(topologie.floorId) });
      // Leitungsstatus und Durchführungen hängen an der Zuordnung.
      await queryClient.invalidateQueries({ queryKey: ["electrical", "cables"] });
      await queryClient.invalidateQueries({ queryKey: durchfuehrungenSchluessel(topologie.floorId) });
    } catch (error: unknown) {
      if (error instanceof BestaetigungAbgelehnt) {
        setFehler("Nicht gespeichert – die Leitungen bleiben unverändert.");
        return;
      }
      setFehler(fehlertext(error));
      if (error instanceof ApiError && error.errorType === "version-conflict") {
        await queryClient.invalidateQueries({ queryKey: planSchluessel(topologie.floorId) });
      }
    } finally {
      setLaeuft(false);
    }
  };

  const gesperrt = !darfSchreiben || entwurfOffen || laeuft;
  const bereichText = (p: Wandpartner) =>
    p.bereiche.map((b) => `${masse.anzeigen(b.vonMm)} bis ${masse.anzeigen(b.bisMm)}`).join(", ");

  return (
    <section className="border-t border-line pt-2" aria-label="Wandzuordnung">
      <h4>Wandzuordnung</h4>
      <p className="m-0 mb-1 text-muted">
        Liegt eine Wand eines Nachbarraums genau auf dieser Wand, wird hier festgelegt, ob es eine gemeinsame Bauwand oder
        zwei getrennte Wände sind.
      </p>
      {darfSchreiben && entwurfOffen && (
        <p className={meldungsflaeche("erfolg")}>
          Bitte zuerst speichern oder verwerfen: Eine Zuordnung bezieht sich auf den gespeicherten Stand.
        </p>
      )}
      {fehler !== null && aktion === null && (
        <p className={meldungsflaeche()} role="alert">
          {fehler}
        </p>
      )}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {partner.map((p) => {
          const zustand = partnerzustand(p);
          const { titel, art } = ZUSTAND[zustand];
          const k = p.kopplung;
          return (
            <li key={p.wandId} className="rounded-ep border border-line p-2" data-testid={`zuordnung-${p.wandId}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Marke art={art}>{titel}</Marke>
                {zustand === "gemeinsam" && p.staerkeAbweichend && <Marke art="warnung">Widersprüchliche Stärke</Marke>}
                {k?.origin === "backfill" && <Marke>aus Bestand übernommen</Marke>}
              </div>
              <p className="m-0 mt-1">
                mit {p.raumId === "" ? "einer Wand eines anderen Raums" : wandName(p.wandId)}
                {p.bereiche.length > 0 ? ` · ab Wandanfang ${bereichText(p)}` : ""}
              </p>
              <p className="m-0 mt-1 text-muted">
                {zustand === "gemeinsam" || zustand === "getrennt"
                  ? BEZIEHUNG_ERKLAERUNG[k?.relation ?? "shared"]
                  : zustand === "unterbrochen"
                    ? `Die beiden Wände liegen nicht mehr aufeinander; die Zuordnung „${k?.relation === "separate" ? "getrennte Wände" : "gemeinsame Bauwand"}“ wirkt erst wieder, wenn sie passen. Gespeichert bleibt sie, bis sie gelöst wird.`
                    : zustand === "nicht-eindeutig"
                      ? (p.kandidat?.gruende.map((g) => GRUND_TEXT[g]).join(" ") ?? GRUND_TEXT.ambiguous)
                      : zustand === "vorschlag"
                        ? `Die Wände liegen eindeutig aufeinander. Bitte bestätigen oder als getrennt festlegen – automatisch wird nichts gekoppelt. ${OFFEN_ERKLAERUNG}`
                        : `${(p.kandidat?.gruende ?? []).map((g) => GRUND_TEXT[g]).join(" ")} ${OFFEN_ERKLAERUNG}`.trim()}
              </p>
              {k !== null && k.status === "ambiguous" && zustand !== "unterbrochen" && (
                <p className="m-0 mt-1 text-warning">{STATUS_TEXT.ambiguous}</p>
              )}
              {zustand === "gemeinsam" && p.staerkeAbweichend && (
                <p className="m-0 mt-1 text-warning">
                  Beide Raumwände sind unterschiedlich stark erfasst. Für eine Bauwand bitte die Stärke angleichen.
                </p>
              )}
              {darfSchreiben && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {k === null && zustand !== "nicht-eindeutig" && (
                    <>
                      <button
                        type="button"
                        className={knopf(zustand === "vorschlag" ? "primaer" : "neutral")}
                        disabled={gesperrt}
                        onClick={() => void ausfuehren({ art: "anlegen", partner: p, beziehung: "shared" })}
                      >
                        Als gemeinsame Bauwand bestätigen
                      </button>
                      <button
                        type="button"
                        className={knopf()}
                        disabled={gesperrt}
                        onClick={() => void ausfuehren({ art: "anlegen", partner: p, beziehung: "separate" })}
                      >
                        Als getrennte Wände festlegen
                      </button>
                    </>
                  )}
                  {k !== null && zustand !== "unterbrochen" && (
                    <button
                      type="button"
                      className={knopf()}
                      disabled={gesperrt}
                      onClick={() => {
                        setFehler(null);
                        setAktion({ art: "aendern", kopplung: k, beziehung: k.relation === "shared" ? "separate" : "shared" });
                      }}
                    >
                      {k.relation === "shared" ? "Auf getrennte Wände ändern" : "Auf gemeinsame Bauwand ändern"}
                    </button>
                  )}
                  {k !== null && (
                    <button
                      type="button"
                      className={knopf()}
                      disabled={gesperrt}
                      onClick={() => {
                        setFehler(null);
                        setAktion({ art: "loesen", kopplung: k });
                      }}
                    >
                      Zuordnung lösen
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Bestaetigung
        offen={aktion !== null}
        titel={
          aktion?.art === "loesen"
            ? "Zuordnung lösen?"
            : aktion?.art === "aendern" && aktion.beziehung === "separate"
              ? "Auf getrennte Wände ändern?"
              : "Auf gemeinsame Bauwand ändern?"
        }
        bestaetigenLabel={aktion?.art === "loesen" ? "Zuordnung lösen" : "Ändern"}
        gefaehrlich={aktion?.art === "loesen"}
        laeuft={laeuft}
        fehler={fehler}
        onBestaetigen={() => {
          if (aktion !== null) void ausfuehren(aktion);
        }}
        onAbbrechen={() => {
          setAktion(null);
          setFehler(null);
        }}
      >
        {aktion?.art === "loesen" ? (
          <p className="m-0">
            Der Abschnitt ist danach wieder offen. {OFFEN_ERKLAERUNG} Liegt dadurch ein Gerät in einer Öffnung des Nachbarraums,
            wird das Lösen abgelehnt – Geräte werden nie verschoben.
          </p>
        ) : aktion?.art === "aendern" && aktion.beziehung === "separate" ? (
          <p className="m-0">
            {BEZIEHUNG_ERKLAERUNG.separate} Türen und Fenster erscheinen dann nicht mehr im Nachbarraum. Gespeicherte Öffnungen
            und Geräte bleiben unverändert.
          </p>
        ) : (
          <p className="m-0">
            {BEZIEHUNG_ERKLAERUNG.shared} Liegt dadurch ein Gerät in einer Öffnung des Nachbarraums, wird die Änderung
            abgelehnt – Geräte werden nie verschoben.
          </p>
        )}
      </Bestaetigung>
    </section>
  );
}
