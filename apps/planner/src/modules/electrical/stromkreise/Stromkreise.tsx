import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "../../../core/auth/AuthProvider";
import { AKTION } from "../../../core/ui/aktionssymbole";
import { Marke } from "../../../core/ui/Marke";
import { useRueckfrage, verwerfenOptionen } from "../../../core/ui/Rueckfrage";
import { MitSymbol } from "../../../core/ui/Symbol";
import {
  KARTENKOPF,
  KARTENTITEL,
  KNOPFZEILE,
  TABELLE,
  TABELLENRAHMEN,
  karte,
  knopf,
  meldungsflaeche,
} from "../../../core/ui/stil";
import { useUngespeicherteAenderungen } from "../../../core/ui/ungespeichert";
import "../darstellung.css";
import { katalogAbfrage, typenNachSchluessel } from "../geraete/katalog";
import { Geraetesymbol } from "../geraete/symbole";
import { planAbfrage } from "../plan";
import type { Planergeraet, Stromkreis, Verteilung } from "./daten";
import {
  freieLagegeraete,
  geraeteDesGebaeudes,
  kreisBezeichnung,
  querschnittAlsEingabe,
  querschnittAnzeigen,
  stromkreiseAbfrage,
  stromkreiseSchluessel,
  verteilungenAbfrage,
  verteilungenSchluessel,
  zuordnungNachGeraet,
} from "./daten";
import type { Stromkreisanfrage, Stromkreisergebnis, Stromkreiswerte } from "./StromkreisDialog";
import { LEERER_STROMKREIS, StromkreisDialog } from "./StromkreisDialog";
import "./stromkreise.css";
import { feldfehler, fehlermeldung, ZUORDNUNG_MELDUNG } from "./texte";
import type { Verteilungsergebnis, Verteilungswerte } from "./VerteilungDialog";
import { VerteilungDialog } from "./VerteilungDialog";
import { ZuordnungsFlaeche } from "./ZuordnungsFlaeche";
import { geraetezustand, useZuordnungsentwurf } from "./zuordnung";

type Dialogzustand =
  | { art: "verteilung"; verteilung: Verteilung | null }
  | { art: "stromkreis"; verteilung: Verteilung; kreis: Stromkreis | null };

function vorschlagText(kreis: Stromkreis): string {
  const teile = [
    kreis.proposed_cable_type,
    kreis.proposed_conductor_count === null && kreis.proposed_cross_section_mm2 === null
      ? null
      : `${kreis.proposed_conductor_count ?? "?"} × ${querschnittAnzeigen(kreis.proposed_cross_section_mm2).replace("—", "?")}`,
  ].filter((t) => t !== null);
  return teile.length === 0 ? "kein Vorschlag" : teile.join(" ");
}

/** Allgemeine Meldung: bei Feldfehlern nur der Hinweis darauf, sonst die verständliche Meldung. */
function allgemein(felder: Record<string, string | undefined>, error: unknown, rueckfall: string): string {
  return Object.values(felder).some((t) => t !== undefined) ? "Bitte die markierten Felder prüfen." : fehlermeldung(error, rueckfall);
}

function alsWerte(kreis: Stromkreis): Stromkreiswerte {
  return {
    designation: kreis.designation,
    name: kreis.name,
    proposed_cable_type: kreis.proposed_cable_type ?? "",
    proposed_conductor_count: kreis.proposed_conductor_count === null ? "" : String(kreis.proposed_conductor_count),
    proposed_cross_section: querschnittAlsEingabe(kreis.proposed_cross_section_mm2),
    protective_device: kreis.protective_device ?? "",
    rcd_group: kreis.rcd_group ?? "",
    phase_count: kreis.phase_count === null ? "" : String(kreis.phase_count),
    note: kreis.note ?? "",
  };
}

/**
 * Verteilungen, Stromkreise und Gerätezuordnung eines Gebäudes (Phase 6b.1,
 * ADR 0026). Eigene Ansicht neben 2D-Editor, 3D-Ansicht und Steigwegen.
 *
 * * Verteilungen und Stromkreise werden per Dialog **sofort** gespeichert.
 * * Die Gerätezuordnung eines Stromkreises ist ein **eigener Entwurf** mit
 *   „Zuordnung speichern“/„Verwerfen“, Navigationsschutz und bewusstem
 *   Neuladen bei einem Versionskonflikt. Nie zusammen mit dem Raumentwurf.
 * * Zuordnungsziele sind nur **gespeicherte** Geräte (Planabfrage); ein
 *   offener Raumentwurf ist hier nicht sichtbar.
 * * Schreibaktionen nur mit `electrical.circuit.write` und außerhalb
 *   abgeschlossener/archivierter Projekte – der Server prüft dennoch selbst.
 */
export function Stromkreise({
  buildingId,
  buildingName,
  aktivesGeschossId,
  onGeschoss,
  darfSchreiben,
  onUngespeichert,
  onGeschrieben,
}: {
  buildingId: string;
  buildingName: string;
  aktivesGeschossId: string;
  onGeschoss: (floorId: string) => void;
  darfSchreiben: boolean;
  onUngespeichert: (offen: boolean) => void;
  /**
   * Nach jedem erfolgreichen Schreibvorgang: Der Server vermerkt Bearbeiter
   * und Zeitpunkt am Projekt - die Seite lädt dafür gezielt die Projektabfrage nach.
   */
  onGeschrieben?: (() => Promise<void>) | undefined;
}) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const fragen = useRueckfrage();

  const geschosse = useQuery({
    queryKey: ["floors", buildingId],
    queryFn: () => api.get("/api/v1/buildings/{building_id}/floors", { path: { building_id: buildingId } }),
  });
  const verteilungen = useQuery(verteilungenAbfrage(api, buildingId));
  const stromkreise = useQuery(stromkreiseAbfrage(api, buildingId));
  const katalog = useQuery(katalogAbfrage(api));
  const plaene = useQueries({
    queries: (geschosse.data ?? []).map((g) => planAbfrage(api, g.id)),
  });

  const [dialog, setDialog] = useState<Dialogzustand | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  // Derselbe Zuordnungsentwurf wie in Wand- und Deckenansicht (Phase 6b.4).
  const zuordnungsentwurf = useZuordnungsentwurf({ buildingId, darfSchreiben, onGeschrieben });
  const { entwurf, offen, konflikt, speichert } = zuordnungsentwurf;
  const zuordnungsfehler = zuordnungsentwurf.fehler;
  useUngespeicherteAenderungen(offen, ZUORDNUNG_MELDUNG);
  useEffect(() => onUngespeichert(offen), [offen, onUngespeichert]);
  useEffect(() => () => onUngespeichert(false), [onUngespeichert]);

  const typen = useMemo(() => typenNachSchluessel(katalog.data), [katalog.data]);
  const planNachGeschoss = new Map(
    (geschosse.data ?? []).flatMap((g, i) => {
      const plan = plaene[i]?.data;
      return plan === undefined ? [] : [[g.id, plan] as const];
    }),
  );
  const geraete = geraeteDesGebaeudes(geschosse.data ?? [], planNachGeschoss, typen);
  const liste: Verteilung[] = verteilungen.data?.boards ?? [];
  const kreise: Stromkreis[] = stromkreise.data?.circuits ?? [];
  const zuordnung = zuordnungNachGeraet(kreise);
  const aktiverKreis = entwurf === null ? undefined : kreise.find((k) => k.id === entwurf.circuitId);

  const neuLaden = async ({ geschrieben = false }: { geschrieben?: boolean } = {}) => {
    await queryClient.invalidateQueries({ queryKey: verteilungenSchluessel(buildingId) });
    await queryClient.invalidateQueries({ queryKey: stromkreiseSchluessel(buildingId) });
    if (geschrieben) await onGeschrieben?.();
  };

  const verwerfenErlaubt = async (titel: string, situation: string): Promise<boolean> => {
    if (!offen) return true;
    return (await fragen(verwerfenOptionen(titel, situation, ZUORDNUNG_MELDUNG))) === "bestaetigt";
  };

  // ------------------------------------------------------------- Verteilung

  const verteilungSpeichern = async (werte: Verteilungswerte): Promise<Verteilungsergebnis> => {
    const bestehend = dialog?.art === "verteilung" ? dialog.verteilung : null;
    const body = {
      code: werte.code.trim(),
      name: werte.name.trim(),
      note: werte.note.trim() === "" ? null : werte.note.trim(),
      placement_device_id: werte.placement_device_id === "" ? null : werte.placement_device_id,
    };
    try {
      if (bestehend === null) {
        await api.post("/api/v1/modules/electrical/buildings/{building_id}/distribution-boards", {
          path: { building_id: buildingId },
          body,
        });
      } else {
        await api.patch("/api/v1/modules/electrical/distribution-boards/{board_id}", {
          path: { board_id: bestehend.id },
          ifMatch: bestehend.version,
          body,
        });
      }
      setDialog(null);
      await neuLaden({ geschrieben: true });
      return undefined;
    } catch (error: unknown) {
      const felder = feldfehler(error, ["code", "name", "note", "placement_device_id"] as const);
      return { felder, fehler: allgemein(felder, error, "Die Verteilung konnte nicht gespeichert werden.") };
    }
  };

  const verteilungEntfernen = async (verteilung: Verteilung) => {
    const anzahl = kreise.filter((k) => k.board_id === verteilung.id).length;
    if (anzahl > 0) {
      setFehler(
        `An der Verteilung ${verteilung.code} ${anzahl === 1 ? "hängt noch ein Stromkreis" : `hängen noch ${anzahl} Stromkreise`}. Bitte zuerst die Stromkreise entfernen.`,
      );
      return;
    }
    const antwort = await fragen({
      titel: "Verteilung entfernen?",
      text: (
        <p>
          Die Verteilung {verteilung.code} „{verteilung.name}“ wird entfernt. Ein Gerät „Verteilung“ im Plan bleibt
          erhalten.
        </p>
      ),
      bestaetigenLabel: "Verteilung entfernen",
      abbrechenLabel: "Abbrechen",
      gefaehrlich: true,
    });
    if (antwort !== "bestaetigt") return;
    try {
      await api.delete("/api/v1/modules/electrical/distribution-boards/{board_id}", {
        path: { board_id: verteilung.id },
        ifMatch: verteilung.version,
      });
      setFehler(null);
      await neuLaden({ geschrieben: true });
    } catch (error: unknown) {
      setFehler(fehlermeldung(error, "Die Verteilung konnte nicht entfernt werden."));
      await neuLaden();
    }
  };

  // ------------------------------------------------------------- Stromkreis

  const stromkreisSpeichern = async (anfrage: Stromkreisanfrage): Promise<Stromkreisergebnis> => {
    if (dialog?.art !== "stromkreis") return undefined;
    try {
      if (dialog.kreis === null) {
        await api.post("/api/v1/modules/electrical/distribution-boards/{board_id}/circuits", {
          path: { board_id: dialog.verteilung.id },
          body: anfrage,
        });
      } else {
        await api.patch("/api/v1/modules/electrical/circuits/{circuit_id}", {
          path: { circuit_id: dialog.kreis.id },
          ifMatch: dialog.kreis.version,
          body: anfrage,
        });
      }
      setDialog(null);
      await neuLaden({ geschrieben: true });
      return undefined;
    } catch (error: unknown) {
      const roh = feldfehler(error, ["designation", "name", "proposed_cable_type", "proposed_conductor_count", "proposed_cross_section_mm2", "protective_device", "rcd_group", "note"] as const);
      // Serverfeld des Querschnitts heißt anders als das Formularfeld.
      const { proposed_cross_section_mm2: querschnitt, ...rest } = roh;
      const felder = querschnitt === undefined ? rest : { ...rest, proposed_cross_section: querschnitt };
      return { felder, fehler: allgemein(felder, error, "Der Stromkreis konnte nicht gespeichert werden.") };
    }
  };

  const stromkreisEntfernen = async (kreis: Stromkreis) => {
    const anzahl = kreis.device_ids.length;
    const antwort = await fragen({
      titel: "Stromkreis entfernen?",
      text: (
        <p>
          Der Stromkreis {kreisBezeichnung(kreis, liste)} wird entfernt.
          {anzahl > 0
            ? ` Die Zuordnung von ${anzahl === 1 ? "einem Gerät" : `${anzahl} Geräten`} geht dabei verloren; die Geräte selbst bleiben im Plan.`
            : ""}
        </p>
      ),
      bestaetigenLabel: "Stromkreis entfernen",
      abbrechenLabel: "Abbrechen",
      gefaehrlich: true,
    });
    if (antwort !== "bestaetigt") return;
    try {
      await api.delete("/api/v1/modules/electrical/circuits/{circuit_id}", {
        path: { circuit_id: kreis.id },
        ifMatch: kreis.version,
      });
      setFehler(null);
      if (entwurf?.circuitId === kreis.id) zuordnungsentwurf.schliessen();
      await neuLaden({ geschrieben: true });
    } catch (error: unknown) {
      setFehler(fehlermeldung(error, "Der Stromkreis konnte nicht entfernt werden."));
      await neuLaden();
    }
  };

  // --------------------------------------------------------------- Zuordnung

  const zuordnungOeffnen = async (kreis: Stromkreis) => {
    if (entwurf?.circuitId === kreis.id) return;
    if (!(await verwerfenErlaubt("Anderen Stromkreis bearbeiten?", `Sie wollen die Geräte von ${kreis.designation} bearbeiten.`))) return;
    zuordnungsentwurf.oeffnen(kreis);
  };

  const zuordnungSchliessen = async () => {
    if (!(await verwerfenErlaubt("Zuordnung schließen?", "Sie wollen die Gerätezuordnung schließen."))) return;
    zuordnungsentwurf.schliessen();
  };

  const zustandVon = (id: string) =>
    geraetezustand(id, geraete.find((x) => x.id === id)?.zuordenbar === true, entwurf, zuordnung);

  const beschriftungVon = (id: string): string => {
    const g = geraete.find((x) => x.id === id);
    if (g === undefined) return "";
    const art = zustandVon(id);
    const anderer = zuordnung.get(id);
    const zusatz =
      art === "dieser"
        ? "diesem Stromkreis zugeordnet"
        : art === "anderer" && anderer !== undefined
          ? `zugeordnet zu ${kreisBezeichnung(anderer, liste)}`
          : art === "frei"
            ? "nicht zugeordnet"
            : "nicht zuordenbar";
    return `${g.name}, ${g.raum} – ${zusatz}`;
  };

  // ----------------------------------------------------------------- Anzeige

  if (geschosse.isPending || verteilungen.isPending || stromkreise.isPending) {
    return <p className="text-muted">Stromkreise werden geladen ...</p>;
  }
  if (geschosse.isError || verteilungen.isError || stromkreise.isError) {
    return (
      <p className={meldungsflaeche()} role="alert">
        Verteilungen und Stromkreise dieses Gebäudes konnten nicht geladen werden.
      </p>
    );
  }

  const ortVon = (geraet: Planergeraet | undefined) =>
    geraet === undefined ? "Lagegerät nicht gefunden" : `${geraet.geschoss} · ${geraet.raum}`;
  const zuordenbar = geraete.filter((g) => g.zuordenbar);
  const nichtZugeordnet = zuordenbar.filter((g) => !zuordnung.has(g.id)).length;
  const aktivesGeschoss = (geschosse.data ?? []).find((g) => g.id === aktivesGeschossId);
  const aktiverPlan = planNachGeschoss.get(aktivesGeschossId);

  return (
    <div className="flex flex-col gap-4">
      <div className={KARTENKOPF}>
        <h3 className={KARTENTITEL}>Verteilungen &amp; Stromkreise · Gebäude „{buildingName}“</h3>
        {darfSchreiben && (
          <button type="button" className={knopf("primaer")} onClick={() => setDialog({ art: "verteilung", verteilung: null })}>
            <MitSymbol icon={AKTION.anlegen}>Verteilung anlegen</MitSymbol>
          </button>
        )}
      </div>
      <p className="m-0 text-label text-muted">
        Erfasst werden Planungsangaben. ElektroPlan dimensioniert nichts und trifft keine Aussage zur Normkonformität.
        {zuordenbar.length > 0 && ` Nicht zugeordnete Geräte in diesem Gebäude: ${nichtZugeordnet} von ${zuordenbar.length}.`}
      </p>
      {fehler !== null && (
        <p className={meldungsflaeche()} role="alert">
          {fehler}
        </p>
      )}

      {liste.length === 0 && (
        <p className="text-muted">
          In diesem Gebäude ist noch keine Verteilung angelegt.
          {darfSchreiben ? " Mit „Verteilung anlegen“ geht es los." : ""}
        </p>
      )}

      {liste.map((verteilung) => {
        const lage = verteilung.placement_device_id === null ? undefined : geraete.find((g) => g.id === verteilung.placement_device_id);
        const eigene = kreise.filter((k) => k.board_id === verteilung.id);
        return (
          <section key={verteilung.id} className={karte("kompakt")} aria-label={`Verteilung ${verteilung.code}`}>
            <div className={KARTENKOPF}>
              <h4 className={KARTENTITEL}>
                {verteilung.code} · {verteilung.name}
              </h4>
              {darfSchreiben && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={knopf("neutral", { klein: true })} onClick={() => setDialog({ art: "stromkreis", verteilung, kreis: null })}>
                    <MitSymbol icon={AKTION.anlegen}>Stromkreis anlegen</MitSymbol>
                  </button>
                  <button type="button" className={knopf("neutral", { klein: true })} aria-label={`Verteilung ${verteilung.code} bearbeiten`} onClick={() => setDialog({ art: "verteilung", verteilung })}>
                    <MitSymbol icon={AKTION.bearbeiten}>Bearbeiten</MitSymbol>
                  </button>
                  <button type="button" className={knopf("neutral", { klein: true })} aria-label={`Verteilung ${verteilung.code} entfernen`} onClick={() => void verteilungEntfernen(verteilung)}>
                    <MitSymbol icon={AKTION.loeschen}>Entfernen</MitSymbol>
                  </button>
                </div>
              )}
            </div>
            <p className="m-0 mt-1 text-label">
              {verteilung.placement_device_id === null ? (
                <Marke art="warnung">Noch nicht im Plan platziert</Marke>
              ) : (
                <>Lage: {ortVon(lage)}</>
              )}
              {verteilung.note !== null && <span className="ml-2 text-muted">{verteilung.note}</span>}
            </p>
            {eigene.length === 0 ? (
              <p className="m-0 mt-2 text-muted">Noch kein Stromkreis an dieser Verteilung.</p>
            ) : (
              <div className={`${TABELLENRAHMEN} mt-2`}>
                <table className={TABELLE}>
                  <thead>
                    <tr>
                      <th>Bezeichnung</th>
                      <th>Name</th>
                      <th>Kabel (Vorschlag)</th>
                      <th>Schutzorgan (Angabe)</th>
                      <th>Geräte</th>
                      <th>Aktion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eigene.map((kreis) => {
                      const inBearbeitung = entwurf?.circuitId === kreis.id;
                      return (
                        <tr key={kreis.id} aria-current={inBearbeitung ? "true" : undefined}>
                          <td>{kreis.designation}</td>
                          <td>{kreis.name}</td>
                          <td>{vorschlagText(kreis)}</td>
                          <td>{kreis.protective_device ?? "—"}</td>
                          <td>{kreis.device_ids.length}</td>
                          <td>
                            <div className="flex flex-wrap gap-1">
                              {!inBearbeitung && (
                                <button type="button" className={knopf("neutral", { klein: true })} aria-label={`Geräte von ${kreis.designation} ${darfSchreiben ? "zuordnen" : "ansehen"}`} onClick={() => void zuordnungOeffnen(kreis)}>
                                  {darfSchreiben ? "Geräte zuordnen" : "Geräte ansehen"}
                                </button>
                              )}
                              {darfSchreiben && (
                                <>
                                  <button
                                    type="button"
                                    className={knopf("neutral", { klein: true })}
                                    aria-label={`Stromkreis ${kreis.designation} bearbeiten`}
                                    disabled={inBearbeitung && offen}
                                    title={inBearbeitung && offen ? "Zuerst die Zuordnung speichern oder verwerfen." : undefined}
                                    onClick={() => setDialog({ art: "stromkreis", verteilung, kreis })}
                                  >
                                    <MitSymbol icon={AKTION.bearbeiten}>Bearbeiten</MitSymbol>
                                  </button>
                                  <button
                                    type="button"
                                    className={knopf("neutral", { klein: true })}
                                    aria-label={`Stromkreis ${kreis.designation} entfernen`}
                                    disabled={inBearbeitung && offen}
                                    onClick={() => void stromkreisEntfernen(kreis)}
                                  >
                                    <MitSymbol icon={AKTION.loeschen}>Entfernen</MitSymbol>
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      {entwurf !== null && aktiverKreis !== undefined && (
        <section className={karte("eingerueckt")} aria-label="Gerätezuordnung">
          <div className={KARTENKOPF}>
            <h4 className={KARTENTITEL}>Geräte des Stromkreises {kreisBezeichnung(aktiverKreis, liste)}</h4>
            {darfSchreiben && <Marke art={offen ? "warnung" : "neutral"}>{offen ? "Ungespeicherte Zuordnung" : "Gespeichert"}</Marke>}
          </div>
          <p className="m-0 text-label text-muted">
            Gezeigt werden gespeicherte Geräte dieses Gebäudes. Datendosen und die Lage einer Verteilung werden keinem
            Stromkreis zugeordnet. Geräte eines anderen Stromkreises bleiben dort, bis sie dort entfernt werden.
          </p>
          {zuordnungsfehler !== null && (
            <div className={meldungsflaeche()} role="alert">
              <p className="m-0">{zuordnungsfehler}</p>
              {konflikt && (
                <button type="button" className={`${knopf("neutral", { klein: true })} mt-2`} onClick={() => void zuordnungsentwurf.neuLaden()}>
                  Zuordnung verwerfen und neu laden
                </button>
              )}
            </div>
          )}
          {zuordenbar.length === 0 ? (
            <p className="text-muted">In diesem Gebäude ist noch kein zuordenbares Gerät gespeichert.</p>
          ) : (
            <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0" aria-label="Geräteliste">
              {zuordenbar.map((g) => {
                const art = zustandVon(g.id);
                const anderer = zuordnung.get(g.id);
                const id = `zuordnung-${g.id}`;
                return (
                  <li key={g.id} className="flex flex-wrap items-center gap-2">
                    <input
                      id={id}
                      type="checkbox"
                      checked={art === "dieser"}
                      disabled={!darfSchreiben || art === "anderer" || speichert}
                      onChange={() => zuordnungsentwurf.umschalten(g.id)}
                    />
                    <Geraetesymbol typ={typen.get(g.typKey)} groesse={18} />
                    <label htmlFor={id}>
                      {g.name} · {g.geschoss} · {g.raum}
                    </label>
                    {art === "anderer" && anderer !== undefined && (
                      <Marke art="neutral">in {kreisBezeichnung(anderer, liste)}</Marke>
                    )}
                    {art === "frei" && <Marke art="warnung">nicht zugeordnet</Marke>}
                  </li>
                );
              })}
            </ul>
          )}
          {darfSchreiben && (
            <div className={KNOPFZEILE}>
              <button type="button" className={knopf("primaer")} disabled={!offen || speichert} onClick={() => void zuordnungsentwurf.speichern()}>
                {speichert ? "Wird gespeichert ..." : "Zuordnung speichern"}
              </button>
              <button type="button" className={knopf()} disabled={!offen || speichert} onClick={() => zuordnungsentwurf.verwerfen(aktiverKreis)}>
                Verwerfen
              </button>
              <button type="button" className={knopf()} onClick={() => void zuordnungSchliessen()}>
                Schließen
              </button>
            </div>
          )}
          {!darfSchreiben && (
            <div className={KNOPFZEILE}>
              <button type="button" className={knopf()} onClick={() => void zuordnungSchliessen()}>
                Schließen
              </button>
            </div>
          )}

          <h5 className="mt-4 mb-1 text-base">Grundriss · {aktivesGeschoss?.name ?? ""}</h5>
          <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Geschoss im Grundriss">
            {(geschosse.data ?? []).slice().sort((a, b) => b.level - a.level).map((g) => (
              <button key={g.id} type="button" className={knopf(g.id === aktivesGeschossId ? "gewaehlt" : "neutral", { klein: true })} aria-pressed={g.id === aktivesGeschossId} onClick={() => onGeschoss(g.id)}>
                {g.name}
              </button>
            ))}
          </div>
          {aktiverPlan === undefined ? (
            <p className="text-muted">Grundriss wird geladen ...</p>
          ) : (
            <ZuordnungsFlaeche
              geschoss={aktivesGeschoss?.name ?? ""}
              raeume={aktiverPlan.rooms}
              geraete={geraete.filter((g) => g.floorId === aktivesGeschossId)}
              typen={typen}
              zustand={zustandVon}
              beschriftung={beschriftungVon}
              bedienbar={darfSchreiben && !speichert}
              onUmschalten={(id) => zuordnungsentwurf.umschalten(id)}
            />
          )}
          <p className="mt-1 text-label text-muted">
            Ring gefüllt: diesem Stromkreis zugeordnet · Ring gestrichelt: anderer Stromkreis · dünner Ring: nicht
            zugeordnet · blass: nicht zuordenbar. Klick auf ein Gerät schaltet die Zuordnung im Entwurf um.
          </p>
        </section>
      )}

      {dialog?.art === "verteilung" && (
        <VerteilungDialog
          key={dialog.verteilung?.id ?? "neu"}
          titel={dialog.verteilung === null ? "Verteilung anlegen" : `Verteilung ${dialog.verteilung.code} bearbeiten`}
          gebaeude={buildingName}
          startwerte={{
            code: dialog.verteilung?.code ?? "",
            name: dialog.verteilung?.name ?? "",
            note: dialog.verteilung?.note ?? "",
            placement_device_id: dialog.verteilung?.placement_device_id ?? "",
          }}
          lagegeraete={freieLagegeraete(geraete, liste, dialog.verteilung?.id ?? null)}
          onSubmit={verteilungSpeichern}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.art === "stromkreis" && (
        <StromkreisDialog
          key={dialog.kreis?.id ?? "neu"}
          titel={dialog.kreis === null ? "Stromkreis anlegen" : `Stromkreis ${dialog.kreis.designation} bearbeiten`}
          verteilung={`${dialog.verteilung.code} · ${dialog.verteilung.name}`}
          startwerte={dialog.kreis === null ? LEERER_STROMKREIS : alsWerte(dialog.kreis)}
          onSubmit={stromkreisSpeichern}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
