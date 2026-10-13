import { ApiError } from "@elektroplan/api-client";
import type { components } from "@elektroplan/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";

import { useAuth } from "../../../core/auth/AuthProvider";
import { Marke } from "../../../core/ui/Marke";
import { useMasse } from "../../../core/ui/masseinheit";
import { useRueckfrage, verwerfenOptionen } from "../../../core/ui/Rueckfrage";
import { Auswahl, Schalter } from "../../../core/ui/Feld";
import {
  FELD,
  FELD_BESCHRIFTUNG,
  FELD_FEHLER,
  FELD_HINWEIS,
  KARTENKOPF,
  KARTENTITEL,
  KNOPFZEILE,
  TABELLE,
  TABELLENRAHMEN,
  eingabefeld,
  karte,
  knopf,
  meldungsflaeche,
} from "../../../core/ui/stil";
import { useUngespeicherteAenderungen } from "../../../core/ui/ungespeichert";
import { planAbfrage } from "../plan";
import "../darstellung.css";
import "./steigweg.css";
import type { Steigwegentwurf } from "./entwurf";
import {
  anfrage,
  ausServer,
  fehlendeLagen,
  geschossAnbinden,
  geschossLoesen,
  gesetzteHalte,
  haltAuf,
  haltSetzen,
  istGeaendert,
  koordinateSetzen,
  neuerEntwurf,
} from "./entwurf";
import { SteigwegFlaeche } from "./SteigwegFlaeche";
import type { Steigwegdarstellung } from "./SteigwegFlaeche";
import { ABSCHNITTHINWEIS, ABSCHNITTSTATUS, PLANUNGSHINWEIS, STEIGWEG_MELDUNG, STEIGWEGSTATUS, VERSATZART } from "./texte";
import type { SteigwegGeschoss, Steigwegauswertung, Versatzart } from "./verlauf";
import { steigwegAuswerten } from "./verlauf";
import { Vorschau3d } from "./Vorschau3d";
import { BestaetigungAbgelehnt, bestaetigungsfeld, useLeitungsbestaetigung } from "../leitung/bestaetigung";
import { leitungenSchluessel } from "../leitung/daten";

type FloorOut = components["schemas"]["FloorOut"];
type RiserOut = components["schemas"]["RiserOut"];

/** Cache-Schlüssel der Steigwege eines Gebäudes. */
export function steigwegSchluessel(buildingId: string) {
  return ["electrical", "risers", buildingId] as const;
}

const NEU = "neu";

function alsGeschoss(g: FloorOut): SteigwegGeschoss {
  return {
    id: g.id,
    level: g.level,
    elevation_mm: g.elevation_mm,
    elevation_confirmed: g.elevation_confirmed,
    default_ceiling_height_mm: g.default_ceiling_height_mm,
  };
}

/**
 * Steigwegverwaltung eines Gebäudes (Phase 6a.5, ADR 0025).
 *
 * Eigene Ansicht neben 2D-Editor und 3D-Ansicht - bewusst getrennt vom
 * Raumentwurf: Ein Steigweg ist an kein Zimmer gebunden und wird für sich
 * gespeichert. Ungespeicherte Änderungen melden sich beim Navigationsschutz
 * und beim Ansichtswechsel; nichts wird automatisch gespeichert.
 *
 * Verlauf, Längen, 2D-Symbole und 3D-Vorschau stammen aus **einer** Funktion
 * (`verlauf.ts`, Spiegel von `riser_course.py`) und werden aus den aktuellen
 * Geschossdaten berechnet. Ändert sich eine Höhenlage, ihre Bestätigung oder
 * die Geschossreihenfolge, lädt die Geschossabfrage neu und Anzeige und
 * Längen folgen - es bleibt keine veraltete Länge stehen.
 */
export function Steigwege({
  buildingId,
  buildingName,
  aktivesGeschossId,
  onGeschoss,
  darfSchreiben,
  onUngespeichert,
  zurueck,
  onGeschrieben,
}: {
  buildingId: string;
  buildingName: string;
  aktivesGeschossId: string;
  onGeschoss: (floorId: string) => void;
  darfSchreiben: boolean;
  onUngespeichert: (offen: boolean) => void;
  zurueck?: { label: string; onClick: () => void } | undefined;
  /** Nach einem erfolgreichen Schreibvorgang - die Seite lädt die Projektabfrage gezielt nach. */
  onGeschrieben?: (() => Promise<void>) | undefined;
}) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const mitBestaetigung = useLeitungsbestaetigung();
  const masse = useMasse();
  const fragen = useRueckfrage();

  const geschosse = useQuery({
    queryKey: ["floors", buildingId],
    queryFn: () => api.get("/api/v1/buildings/{building_id}/floors", { path: { building_id: buildingId } }),
    staleTime: 0,
  });
  const steigwege = useQuery({
    queryKey: steigwegSchluessel(buildingId),
    queryFn: () =>
      api.get("/api/v1/modules/electrical/buildings/{building_id}/risers", { path: { building_id: buildingId } }),
    staleTime: 0,
  });
  const plan = useQuery({ ...planAbfrage(api, aktivesGeschossId), enabled: aktivesGeschossId !== "" });

  const [auswahl, setAuswahl] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState<Steigwegentwurf | null>(null);
  const [basis, setBasis] = useState<Steigwegentwurf | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [namensfehler, setNamensfehler] = useState<string | undefined>(undefined);
  const [konflikt, setKonflikt] = useState(false);
  const [speichert, setSpeichert] = useState(false);

  const offen = darfSchreiben && entwurf !== null && basis !== null && istGeaendert(entwurf, basis);
  useUngespeicherteAenderungen(offen, STEIGWEG_MELDUNG);
  useEffect(() => onUngespeichert(offen), [offen, onUngespeichert]);
  useEffect(() => () => onUngespeichert(false), [onUngespeichert]);

  const etagen: FloorOut[] = [...(geschosse.data ?? [])].sort((a, b) => b.level - a.level);
  const geschossdaten = etagen.map(alsGeschoss);
  const geschossName = new Map(etagen.map((g) => [g.id, g.name]));
  const liste: RiserOut[] = steigwege.data?.risers ?? [];

  const auswerten = (halteVon: Steigwegentwurf | RiserOut, versatz: Versatzart): Steigwegauswertung =>
    steigwegAuswerten(
      geschossdaten,
      "halte" in halteVon
        ? gesetzteHalte(halteVon)
        : halteVon.stops.map((s) => ({ schluessel: s.id, floor_id: s.floor_id, x_mm: s.x_mm, y_mm: s.y_mm })),
      versatz,
    );

  const darstellungen: Steigwegdarstellung[] = [
    ...liste.map((r) => {
      const imEntwurf = entwurf !== null && entwurf.id === r.id;
      return {
        schluessel: r.id,
        name: imEntwurf ? entwurf.name || r.name : r.name,
        aktiv: auswahl === r.id,
        auswertung: imEntwurf ? auswerten(entwurf, entwurf.offset_mode) : auswerten(r, r.offset_mode),
      };
    }),
    ...(entwurf !== null && entwurf.id === null
      ? [{ schluessel: NEU, name: entwurf.name || "Neuer Steigweg", aktiv: true, auswertung: auswerten(entwurf, entwurf.offset_mode) }]
      : []),
  ];
  const aktiveAuswertung = darstellungen.find((d) => d.aktiv)?.auswertung ?? null;

  const verwerfenErlaubt = async (titel: string, situation: string): Promise<boolean> => {
    if (!offen) return true;
    return (await fragen(verwerfenOptionen(titel, situation, STEIGWEG_MELDUNG))) === "bestaetigt";
  };

  const zuruecksetzen = () => {
    setFehler(null);
    setNamensfehler(undefined);
    setKonflikt(false);
  };

  const oeffnen = async (riser: RiserOut) => {
    if (auswahl === riser.id) return;
    if (!(await verwerfenErlaubt("Anderen Steigweg öffnen?", `Sie wollen „${riser.name}“ öffnen.`))) return;
    const neu = ausServer(riser);
    zuruecksetzen();
    setAuswahl(riser.id);
    setEntwurf(neu);
    setBasis(neu);
  };

  const anlegen = async () => {
    if (!(await verwerfenErlaubt("Neuen Steigweg anlegen?", "Sie wollen einen neuen Steigweg anlegen."))) return;
    const neu = neuerEntwurf();
    zuruecksetzen();
    setAuswahl(NEU);
    setEntwurf(neu);
    setBasis(neu);
  };

  const schliessen = async () => {
    if (!(await verwerfenErlaubt("Steigweg schließen?", "Sie wollen die Bearbeitung schließen."))) return;
    zuruecksetzen();
    setAuswahl(null);
    setEntwurf(null);
    setBasis(null);
  };

  const neuLaden = async () => {
    zuruecksetzen();
    const frisch = await queryClient.fetchQuery({
      queryKey: steigwegSchluessel(buildingId),
      queryFn: () =>
        api.get("/api/v1/modules/electrical/buildings/{building_id}/risers", { path: { building_id: buildingId } }),
      staleTime: 0,
    });
    const aktuell = frisch.risers.find((r) => r.id === entwurf?.id);
    if (aktuell === undefined) {
      setAuswahl(null);
      setEntwurf(null);
      setBasis(null);
      return;
    }
    const neu = ausServer(aktuell);
    setEntwurf(neu);
    setBasis(neu);
  };

  const speichern = async () => {
    if (entwurf === null) return;
    zuruecksetzen();
    if (entwurf.name.trim() === "") {
      setNamensfehler("Bitte einen Namen angeben.");
      return;
    }
    const fehlend = fehlendeLagen(entwurf);
    if (fehlend.length > 0) {
      setFehler(
        `Für ${fehlend.map((id) => geschossName.get(id) ?? "ein Geschoss").join(", ")} ist der Übergabepunkt noch nicht gesetzt. Bitte im Grundriss setzen, Maße eingeben oder das Geschoss lösen.`,
      );
      return;
    }
    setSpeichert(true);
    try {
      const antwort =
        entwurf.id === null || entwurf.version === null
          ? await api.post("/api/v1/modules/electrical/buildings/{building_id}/risers", {
              path: { building_id: buildingId },
              body: anfrage(entwurf),
            })
          : await mitBestaetigung((bestaetigt) =>
              // Verschobene Halte können Leitungsübergänge unterbrechen (6b.3/6b.4): genau diese bestätigen.
              api.put("/api/v1/modules/electrical/risers/{riser_id}", {
                path: { riser_id: entwurf.id as string },
                ifMatch: entwurf.version as number,
                body: { ...anfrage(entwurf), ...bestaetigungsfeld(bestaetigt) },
              }),
            );
      const neu = ausServer(antwort);
      await queryClient.invalidateQueries({ queryKey: steigwegSchluessel(buildingId) });
      await queryClient.invalidateQueries({ queryKey: leitungenSchluessel(buildingId) });
      await onGeschrieben?.();
      setAuswahl(antwort.id);
      setEntwurf(neu);
      setBasis(neu);
    } catch (error: unknown) {
      if (error instanceof BestaetigungAbgelehnt) {
        setFehler("Nicht gespeichert – die Leitungen bleiben unverändert.");
      } else if (error instanceof ApiError) {
        if (error.errorType === "version-conflict") setKonflikt(true);
        const name = error.problem?.errors?.find((e) => e.code === "riser-name-taken");
        if (name !== undefined) setNamensfehler("Dieser Name ist in diesem Gebäude bereits vergeben.");
        setFehler(error.status === 404 ? "Der Steigweg wurde inzwischen entfernt. Bitte neu laden." : error.userMessage);
      } else {
        setFehler("Der Steigweg konnte nicht gespeichert werden.");
      }
    } finally {
      setSpeichert(false);
    }
  };

  const entfernen = async () => {
    if (basis === null || basis.id === null || basis.version === null) return;
    const antwort = await fragen({
      titel: "Steigweg entfernen?",
      text: (
        <p>
          Der Steigweg „{basis.name}“ wird mit {basis.halte.length === 1 ? "seinem Übergabepunkt" : `${basis.halte.length} Übergabepunkten`}{" "}
          entfernt. Räume und Geschosse bleiben unverändert.
        </p>
      ),
      bestaetigenLabel: "Steigweg entfernen",
      abbrechenLabel: "Abbrechen",
      gefaehrlich: true,
    });
    if (antwort !== "bestaetigt") return;
    try {
      await api.delete("/api/v1/modules/electrical/risers/{riser_id}", {
        path: { riser_id: basis.id },
        ifMatch: basis.version,
      });
      zuruecksetzen();
      setAuswahl(null);
      setEntwurf(null);
      setBasis(null);
      await queryClient.invalidateQueries({ queryKey: steigwegSchluessel(buildingId) });
      await onGeschrieben?.();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.errorType === "version-conflict") setKonflikt(true);
      setFehler(error instanceof ApiError ? error.userMessage : "Der Steigweg konnte nicht entfernt werden.");
    }
  };

  if (geschosse.isPending || steigwege.isPending) return <p className="text-muted">Steigwege werden geladen ...</p>;
  if (geschosse.isError || steigwege.isError) {
    return (
      <p className={meldungsflaeche()} role="alert">
        Die Steigwege dieses Gebäudes konnten nicht geladen werden.
      </p>
    );
  }

  const aktivesGeschoss = etagen.find((g) => g.id === aktivesGeschossId);
  const bearbeitbar = darfSchreiben && entwurf !== null;
  const waende = (plan.data?.rooms ?? []).flatMap((r) => r.walls);
  const unbestaetigt = etagen.filter((g) => !g.elevation_confirmed);

  const laengeText = (a: Steigwegauswertung) =>
    a.laenge_mm !== null
      ? masse.anzeigen(a.laenge_mm)
      : a.abschnitte.length === 0
        ? "—"
        : `Teilsumme ${masse.anzeigen(a.bekannt_mm)} (unvollständig)`;

  return (
    <div className="flex flex-col gap-4">
      <div className={KARTENKOPF}>
        <h3 className={KARTENTITEL}>Steigwege · {buildingName}</h3>
        <div className="flex flex-wrap gap-2">
          {zurueck !== undefined && (
            <button type="button" className={knopf()} onClick={zurueck.onClick}>
              {zurueck.label}
            </button>
          )}
          {darfSchreiben && (
            <button type="button" className={knopf("primaer")} onClick={() => void anlegen()}>
              Steigweg anlegen
            </button>
          )}
        </div>
      </div>
      <p className="text-label text-muted">{PLANUNGSHINWEIS}</p>
      {unbestaetigt.length > 0 && (
        <p className={meldungsflaeche("schlicht")}>
          Nicht bestätigte Höhenlage: {unbestaetigt.map((g) => g.name).join(", ")}. Senkrechte Längen an diesen Geschossen
          gelten erst nach der Bestätigung im Tab „Gebäude &amp; Geschosse“; bis dahin erscheint nur eine Teilsumme.
        </p>
      )}

      {liste.length === 0 && entwurf === null ? (
        <p className="text-muted">
          In diesem Gebäude ist noch kein Steigweg angelegt. Steigwege entstehen nur ausdrücklich – nie automatisch aus
          übereinanderliegenden Räumen.
        </p>
      ) : (
        <div className={TABELLENRAHMEN}>
          <table className={TABELLE}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Geschosse</th>
                <th>Status</th>
                <th>Länge</th>
                <th>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {darstellungen.map((d) => {
                const server = liste.find((r) => r.id === d.schluessel);
                return (
                  <tr key={d.schluessel} aria-current={d.aktiv ? "true" : undefined}>
                    <td>
                      {d.name}
                      {d.aktiv && offen ? " (ungespeichert)" : ""}
                    </td>
                    <td>{d.auswertung.halte.map((h) => geschossName.get(h.floor_id) ?? "?").join(" → ") || "—"}</td>
                    <td>
                      <Marke art={STEIGWEGSTATUS[d.auswertung.status].art}>{STEIGWEGSTATUS[d.auswertung.status].label}</Marke>
                    </td>
                    <td>{laengeText(d.auswertung)}</td>
                    <td>
                      {server !== undefined && !d.aktiv && (
                        <button
                          type="button"
                          className={knopf("neutral", { klein: true })}
                          aria-label={`Steigweg ${server.name} ${darfSchreiben ? "bearbeiten" : "ansehen"}`}
                          onClick={() => void oeffnen(server)}
                        >
                          {darfSchreiben ? "Bearbeiten" : "Ansehen"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {entwurf !== null && aktiveAuswertung !== null && (
        <section className={karte("eingerueckt")} aria-label="Steigweg bearbeiten">
          <div className={KARTENKOPF}>
            <h4 className={KARTENTITEL}>
              {entwurf.id === null ? "Neuer Steigweg" : darfSchreiben ? `Steigweg „${basis?.name ?? ""}“ bearbeiten` : `Steigweg „${entwurf.name}“`}
            </h4>
            <Marke art={offen ? "warnung" : "neutral"}>{offen ? "Ungespeicherte Änderungen" : "Gespeichert"}</Marke>
          </div>

          {fehler !== null && (
            <div className={meldungsflaeche()} role="alert">
              <p className="m-0">{fehler}</p>
              {konflikt && (
                <button type="button" className={`${knopf("neutral", { klein: true })} mt-2`} onClick={() => void neuLaden()}>
                  Änderungen verwerfen und neu laden
                </button>
              )}
            </div>
          )}

          <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
            <Textfeld
              id="steigweg-name"
              label="Name *"
              value={entwurf.name}
              disabled={!bearbeitbar}
              fehler={namensfehler}
              onChange={(name) => setEntwurf({ ...entwurf, name })}
            />
            <Textfeld
              id="steigweg-notiz"
              label="Notiz (optional)"
              value={entwurf.note}
              disabled={!bearbeitbar}
              onChange={(note) => setEntwurf({ ...entwurf, note })}
            />
            <Auswahl
              id="steigweg-versatz"
              label="Waagerechter Versatz"
              value={entwurf.offset_mode}
              disabled={!bearbeitbar}
              onChange={(wert) => setEntwurf({ ...entwurf, offset_mode: wert === "direct" ? "direct" : "orthogonal" })}
            >
              <option value="orthogonal">{VERSATZART.orthogonal.label}</option>
              <option value="direct">{VERSATZART.direct.label}</option>
            </Auswahl>
          </div>
          <p className={`${FELD_HINWEIS} mt-1`}>{VERSATZART[entwurf.offset_mode].erklaerung}</p>

          <h5 className="mt-4 mb-1 text-base">Angebundene Geschosse und Übergabepunkte</h5>
          <p className={FELD_HINWEIS}>
            Höchstens ein Übergabepunkt je Geschoss, auf Höhe des Fertigfußbodens. Geschosse dazwischen ohne Übergabepunkt
            werden durchquert. Maße in {masse.einheit}, Geschosskoordinaten.
          </p>
          <div className={TABELLENRAHMEN}>
            <table className={TABELLE}>
              <thead>
                <tr>
                  <th>Geschoss</th>
                  <th>Höhenlage</th>
                  <th>Übergabepunkt</th>
                  <th>{masse.label("x")}</th>
                  <th>{masse.label("y")}</th>
                  <th>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {etagen.map((g) => {
                  const halt = haltAuf(entwurf, g.id);
                  const darunter = etagen
                    .filter((u) => u.level < g.level)
                    .map((u) => haltAuf(entwurf, u.id))
                    .find((h) => h !== undefined && h.x_mm !== null && h.y_mm !== null);
                  return (
                    <tr key={g.id} aria-current={g.id === aktivesGeschossId ? "true" : undefined}>
                      <td>{g.name}</td>
                      <td>
                        {masse.anzeigen(g.elevation_mm)}{" "}
                        <Marke art={g.elevation_confirmed ? "erfolg" : "warnung"}>
                          {g.elevation_confirmed ? "bestätigt" : "nicht bestätigt"}
                        </Marke>
                      </td>
                      <td>
                        <Schalter
                          id={`steigweg-anbinden-${g.id}`}
                          label="angebunden"
                          checked={halt !== undefined}
                          disabled={!bearbeitbar}
                          onChange={(an) => setEntwurf(an ? geschossAnbinden(entwurf, g.id) : geschossLoesen(entwurf, g.id))}
                        />
                        {halt !== undefined && (halt.x_mm === null || halt.y_mm === null) && (
                          <span className={FELD_FEHLER}>Noch nicht gesetzt</span>
                        )}
                      </td>
                      <td>
                        {halt !== undefined && (
                          <MassFeld
                            id={`steigweg-x-${g.id}`}
                            label={`x auf ${g.name}`}
                            mm={halt.x_mm}
                            disabled={!bearbeitbar}
                            onWert={(mm) => setEntwurf(koordinateSetzen(entwurf, g.id, "x_mm", mm))}
                          />
                        )}
                      </td>
                      <td>
                        {halt !== undefined && (
                          <MassFeld
                            id={`steigweg-y-${g.id}`}
                            label={`y auf ${g.name}`}
                            mm={halt.y_mm}
                            disabled={!bearbeitbar}
                            onWert={(mm) => setEntwurf(koordinateSetzen(entwurf, g.id, "y_mm", mm))}
                          />
                        )}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {g.id !== aktivesGeschossId && (
                            <button type="button" className={knopf("neutral", { klein: true })} onClick={() => onGeschoss(g.id)}>
                              Im Grundriss zeigen
                            </button>
                          )}
                          {bearbeitbar && halt !== undefined && darunter?.x_mm != null && darunter.y_mm != null && (
                            <button
                              type="button"
                              className={knopf("neutral", { klein: true })}
                              onClick={() => setEntwurf(haltSetzen(entwurf, g.id, darunter.x_mm ?? 0, darunter.y_mm ?? 0))}
                            >
                              Lage von {geschossName.get(darunter.floor_id)} übernehmen
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h5 className="mt-4 mb-1 text-base">Abschnitte (vereinfachter Planungsverlauf)</h5>
          {aktiveAuswertung.abschnitte.length === 0 ? (
            <p className="text-muted">{STEIGWEGSTATUS[aktiveAuswertung.status].label}. Ein Abschnitt entsteht ab zwei gesetzten Übergabepunkten.</p>
          ) : (
            <div className={TABELLENRAHMEN}>
              <table className={TABELLE} aria-label="Abschnitte des Steigwegs">
                <thead>
                  <tr>
                    <th>Abschnitt</th>
                    <th>Status</th>
                    <th>Senkrecht</th>
                    <th>Waagerecht</th>
                    <th>Länge</th>
                  </tr>
                </thead>
                <tbody>
                  {aktiveAuswertung.abschnitte.map((a) => (
                    <tr key={`${a.unten.schluessel}-${a.oben.schluessel}`}>
                      <td>
                        {geschossName.get(a.unten.floor_id)} → {geschossName.get(a.oben.floor_id)}
                        {a.durchquert.length > 0 && (
                          <span className="block text-label text-muted">
                            durchquert: {a.durchquert.map((id) => geschossName.get(id)).join(", ")} (ohne Anschluss)
                          </span>
                        )}
                        {a.hinweise.map((h) => (
                          <span key={h} className="block text-label text-warning">
                            {ABSCHNITTHINWEIS[h]}
                          </span>
                        ))}
                      </td>
                      <td>
                        <Marke art={ABSCHNITTSTATUS[a.status].art}>{ABSCHNITTSTATUS[a.status].label}</Marke>
                      </td>
                      <td>{a.senkrecht_mm === null ? "unbekannt" : masse.anzeigen(a.senkrecht_mm)}</td>
                      <td>{masse.anzeigen(a.waagerecht_mm)}</td>
                      <td>{a.laenge_mm === null ? "unbekannt" : masse.anzeigen(a.laenge_mm)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={4}>
                      {aktiveAuswertung.laenge_mm !== null
                        ? "Gesamtlänge des Steigwegs"
                        : "Bekannte Teilsumme – keine vollständige Leitungslänge"}
                    </th>
                    <td data-testid="steigweg-summe">
                      {masse.anzeigen(aktiveAuswertung.laenge_mm ?? aktiveAuswertung.bekannt_mm)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {darfSchreiben && (
            <div className={KNOPFZEILE}>
              <button type="button" className={knopf("primaer")} disabled={!offen || speichert} onClick={() => void speichern()}>
                {speichert ? "Wird gespeichert ..." : "Speichern"}
              </button>
              <button
                type="button"
                className={knopf()}
                disabled={!offen || speichert}
                onClick={() => {
                  zuruecksetzen();
                  setEntwurf(basis);
                }}
              >
                Änderungen verwerfen
              </button>
              <button type="button" className={knopf()} onClick={() => void schliessen()}>
                Schließen
              </button>
              {entwurf.id !== null && (
                <button type="button" className={knopf("gefahr")} disabled={speichert} onClick={() => void entfernen()}>
                  Steigweg entfernen
                </button>
              )}
            </div>
          )}
          {!darfSchreiben && (
            <div className={KNOPFZEILE}>
              <button type="button" className={knopf()} onClick={() => void schliessen()}>
                Schließen
              </button>
            </div>
          )}
        </section>
      )}

      <section aria-label="Grundriss">
        <h4 className="mt-0 mb-1 text-base">Grundriss · {aktivesGeschoss?.name ?? "?"}</h4>
        <p className={FELD_HINWEIS}>
          {bearbeitbar
            ? "Klick in den Grundriss setzt oder versetzt den Übergabepunkt dieses Geschosses (Raster 1 cm); das Symbol lässt sich ziehen. Räume dienen nur der Orientierung – Steigwege sind an keinen Raum gebunden."
            : "Übergabepunkte (Kreis mit Kreuz), waagerechter Versatz auf dem oberen Geschoss (Linie) und durchquerte Geschosse (gestrichelter Kreis)."}
          {plan.data !== undefined && plan.data.rooms.length === 0 && " Auf diesem Geschoss sind keine Räume erfasst – die Fläche ist trotzdem bedienbar."}
        </p>
        <SteigwegFlaeche
          geschossName={aktivesGeschoss?.name ?? ""}
          floorId={aktivesGeschossId}
          waende={waende}
          steigwege={darstellungen}
          setzbar={bearbeitbar}
          onSetzen={(x, y) => {
            if (entwurf === null || !darfSchreiben) return;
            setEntwurf(haltSetzen(entwurf, aktivesGeschossId, x, y));
          }}
        />
        <Legende />
      </section>

      <section aria-label="3D-Vorschau">
        <h4 className="mt-0 mb-1 text-base">3D-Vorschau (vereinfacht, nur Steigwege)</h4>
        <Vorschau3d
          geschosse={etagen.map((g) => ({
            id: g.id,
            name: g.name,
            elevation_mm: g.elevation_mm,
            elevation_confirmed: g.elevation_confirmed,
          }))}
          steigwege={darstellungen}
        />
        <Legende />
      </section>
    </div>
  );
}

function Legende() {
  return (
    <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-label text-muted">
      <span>
        <span className="steigweg__legende-linie" aria-hidden="true" /> bestätigt
      </span>
      <span>
        <span className="steigweg__legende-linie steigweg__legende-linie--vorlaeufig" aria-hidden="true" /> vorläufig –
        Höhenlage nicht bestätigt
      </span>
      <span>
        <span className="steigweg__legende-linie steigweg__legende-linie--konflikt" aria-hidden="true" /> Höhenlage
        widersprüchlich
      </span>
    </p>
  );
}

function Textfeld({
  id,
  label,
  value,
  onChange,
  disabled,
  fehler,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (wert: string) => void;
  disabled: boolean;
  fehler?: string | undefined;
}) {
  return (
    <div className={FELD}>
      <label className={FELD_BESCHRIFTUNG} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={eingabefeld({ fehler: fehler !== undefined })}
        value={value}
        disabled={disabled}
        maxLength={id === "steigweg-name" ? 120 : 500}
        aria-invalid={fehler !== undefined ? true : undefined}
        aria-describedby={fehler !== undefined ? `${id}-fehler` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {fehler !== undefined && (
        <span id={`${id}-fehler`} className={FELD_FEHLER} role="alert">
          {fehler}
        </span>
      )}
    </div>
  );
}

/**
 * Maßfeld in der Anzeigeeinheit. Übernommen wird beim Verlassen oder mit
 * Enter; solange das Feld nicht bearbeitet wird, zeigt es den Entwurfswert
 * (etwa nach einem Klick im Grundriss).
 */
function MassFeld({
  id,
  label,
  mm,
  disabled,
  onWert,
}: {
  id: string;
  label: string;
  mm: number | null;
  disabled: boolean;
  onWert: (mm: number) => void;
}) {
  const masse = useMasse();
  const fehlerId = useId();
  const [text, setText] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | undefined>(undefined);
  const anzeige = text ?? masse.alsEingabeOptional(mm);

  const uebernehmen = () => {
    if (text === null) return;
    if (text.trim() === "") {
      setFehler("Bitte einen Wert angeben.");
      return;
    }
    const gelesen = masse.lesen(text);
    if (!gelesen.ok) {
      setFehler(gelesen.fehler);
      return;
    }
    if (Math.abs(gelesen.mm) > 1_000_000) {
      setFehler("Höchstens 1 km vom Ursprung.");
      return;
    }
    setFehler(undefined);
    setText(null);
    onWert(gelesen.mm);
  };

  return (
    <div className="flex min-w-[7rem] flex-col gap-1">
      <input
        id={id}
        aria-label={masse.label(label)}
        className={eingabefeld({ fehler: fehler !== undefined, kompakt: true })}
        inputMode="decimal"
        value={anzeige}
        disabled={disabled}
        aria-invalid={fehler !== undefined ? true : undefined}
        aria-describedby={fehler !== undefined ? fehlerId : undefined}
        onChange={(event) => setText(event.target.value)}
        onBlur={uebernehmen}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            uebernehmen();
          }
          if (event.key === "Escape") {
            setText(null);
            setFehler(undefined);
          }
        }}
      />
      {fehler !== undefined && (
        <span id={fehlerId} className={FELD_FEHLER} role="alert">
          {fehler}
        </span>
      )}
    </div>
  );
}
