import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import type { ReactNode } from "react";

import { useAuth } from "../../../core/auth/AuthProvider";
import { Marke } from "../../../core/ui/Marke";
import type { MarkenArt } from "../../../core/ui/Marke";
import { useMasse } from "../../../core/ui/masseinheit";
import { KARTENKOPF, KARTENTITEL, TABELLE, TABELLENRAHMEN, karte, knopf, meldungsflaeche } from "../../../core/ui/stil";
import { leitungsbefundText } from "../leitung/laenge";
import { useGrundrisseinstellung, useLeitungsplanungImKontext } from "../leitung/LeitungsplanungProvider";
import type { Mengeneimer, Mengengruppe, Mengenleitung, Mengenuebersicht as Uebersicht } from "./daten";
import { FLAECHE_TEXT, STATUS_TEXT, angabenText, fehlendText, gruppenName, mengenAbfrage } from "./daten";

const STATUS_ART: Record<Mengenleitung["status"], MarkenArt> = { confirmed: "erfolg", incomplete: "warnung", conflict: "gefahr" };

/**
 * Mengenübersicht eines Gebäudes (Phase 6b.6, Entwurf §6.5/§21) - nur Anzeige.
 *
 * Zeigt den **gespeicherten** Stand, wie der Server ihn ableitet: Gruppen nach den
 * tatsächlichen Kabelangaben (bestätigt, offen, Konflikt getrennt), unvollständig
 * angegebene Leitungen, Trassenmeter je Fläche, Durchführungen, Bodenübergänge und
 * Geräte. Öffnen speichert und verwirft nichts; ein offener Leitungsentwurf ist nicht
 * enthalten und wird so benannt. „Bestätigt“ heißt vollständig im Planungsmodell -
 * keine Normprüfung, keine Bemessung, keine Aussage über Ausführbarkeit.
 */
export function Mengenuebersicht({
  buildingId,
  offen,
  onOffen,
  onBearbeitungOeffnen,
}: {
  buildingId: string;
  /** Aufgeklappte Gruppen - bleiben bei der Rückkehr aus der Bearbeitung erhalten. */
  offen: readonly string[];
  onOffen: (offen: readonly string[]) => void;
  /**
   * Zur vorhandenen Bearbeitung wechseln: Der Leitungsentwurf ist dann bereits geöffnet
   * (nie still ein anderer verworfen); `floorId` ist das Geschoss ihres ersten Laufs.
   */
  onBearbeitungOeffnen?: ((ziel: { cableId: string; floorId: string | null }) => void) | undefined;
}) {
  const { api } = useAuth();
  const masse = useMasse();
  const planung = useLeitungsplanungImKontext();
  const einstellung = useGrundrisseinstellung();
  const abfrage = useQuery(mengenAbfrage(api, buildingId));
  const mm = (wert: number) => masse.anzeigen(wert);

  if (abfrage.isPending) {
    return (
      <section className={karte("kompakt")} aria-busy="true">
        <p className="m-0 text-muted">Mengen werden geladen …</p>
      </section>
    );
  }
  if (abfrage.isError) {
    // Nie „0 m“ bei einem Fehler: Es gibt dann schlicht keine Aussage.
    return (
      <section className={karte("kompakt")}>
        <p className={meldungsflaeche()} role="alert">
          Die Mengenübersicht konnte nicht geladen werden. Es werden keine Mengen angezeigt.
        </p>
        <button type="button" className={`${knopf("neutral")} mt-2`} onClick={() => void abfrage.refetch()}>
          Erneut laden
        </button>
      </section>
    );
  }
  const u: Uebersicht = abfrage.data;
  const leitungen = new Map(u.cables.map((c) => [c.id, c]));
  const entwurf = planung?.entwurf ?? null;
  const kreisText = (id: string) => {
    const kreis = planung?.kreisVon(id);
    return kreis === undefined ? "Stromkreis" : planung?.kreisName(kreis) ?? kreis.designation;
  };
  const geraet = (id: string | null) => planung?.geraetName(id) ?? "Gerät";
  const wandText = (wandId: string) => {
    const info = planung?.vorbereitet?.waende.get(wandId);
    if (info === undefined || planung === null) return "Wand";
    const nummer = info.raum.waende.findIndex((w) => w.id === wandId) + 1;
    return `Wand ${nummer} (${planung.raumMitGeschoss(info.raum.id)})`;
  };
  const onLeitungBearbeiten =
    onBearbeitungOeffnen === undefined || planung === null
      ? undefined
      : (cableId: string) => {
          const cable = planung.leitungen.find((c) => c.id === cableId);
          if (cable === undefined || sperrgrund(cableId) !== null) return;
          if (planung.entwurf === null) planung.bearbeiten(cable);
          einstellung?.setWerkzeug("leitung");
          const floorId =
            cable.segments.find((s) => s.floor_id !== null)?.floor_id ?? planung.geraete.find((g) => g.id === cable.end_device_id)?.floorId ?? null;
          onBearbeitungOeffnen({ cableId, floorId });
        };
  const sperrgrund = (cableId: string): string | null => {
    if (planung === null || !planung.darfLeitungen) return "Nur ansehen – Bearbeiten ist hier nicht möglich.";
    if (entwurf !== null && entwurf.cableId !== cableId) return "Ein anderer Leitungsentwurf ist offen – bitte zuerst speichern oder schließen.";
    return null;
  };

  const leitungsliste = (ids: readonly string[], titel: string) => (
    <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0" aria-label={titel}>
      {ids.map((id) => {
        const l = leitungen.get(id);
        if (l === undefined) return null;
        return <Leitungszeile key={id} l={l} kreis={kreisText(l.circuit_id)} von={geraet(l.start_device_id)} nach={geraet(l.end_device_id)} sperrgrund={sperrgrund(id)} onBearbeiten={onLeitungBearbeiten} />;
      })}
    </ul>
  );

  const umschalten = (schluessel: string) => onOffen(offen.includes(schluessel) ? offen.filter((x) => x !== schluessel) : [...offen, schluessel]);

  const zelle = (e: Mengeneimer, art: "bestaetigt" | "teilsumme") =>
    e.count === 0 ? (
      <span className="text-muted">–</span>
    ) : (
      // Mindestbreite: Schmal scrollt die Tabelle in ihrem Rahmen, statt die Angaben Wort für Wort umzubrechen.
      <span className="flex min-w-[10rem] flex-col">
        <strong>{art === "bestaetigt" ? mm(e.total_mm) : `Teilsumme ${mm(e.total_mm)}`}</strong>
        <span className="text-muted">
          {e.count} {e.count === 1 ? "Leitung" : "Leitungen"} · Weg {mm(e.geometric_mm)} + Zugaben {mm(e.allowance_mm)}
        </span>
      </span>
    );

  const zuKlaeren = u.cables.filter((c) => c.status !== "confirmed");
  const genutzt = u.penetrations.filter((p) => p.used);
  const nutzungen = u.crossings.reduce((s, c) => s + c.uses, 0);

  return (
    <div className="flex flex-col gap-3" data-testid="mengenuebersicht">
      <section className={karte("kompakt")} aria-label="Bezug der Mengenübersicht">
        <div className={KARTENKOPF}>
          <h2 className={KARTENTITEL}>Mengenübersicht · Gebäude „{u.building_name}“</h2>
          <button type="button" className={knopf("einfach", { klein: true })} onClick={() => void abfrage.refetch()} disabled={abfrage.isFetching}>
            {abfrage.isFetching ? "Wird aktualisiert …" : "Aktualisieren"}
          </button>
        </div>
        <p className="m-0 mt-1 text-muted">
          Gespeicherter Planungsstand. Mengen sind abgeleitet und werden nicht gespeichert; Längen in Ihrer Maßeinheit,
          Geräte und Durchführungen in Stück, Querschnitte in mm².
        </p>
        {entwurf !== null && (
          <p className={`${meldungsflaeche("schlicht")} mt-2 border border-line`} role="status" data-testid="mengen-entwurf">
            Ein Leitungsentwurf ist offen{planung?.ungespeichert === true ? " und ungespeichert" : ""} – er ist hier nicht enthalten.
            Die Übersicht speichert und verwirft nichts.
          </p>
        )}
        <p className="m-0 mt-2">
          <Marke art="neutral">Bestätigt</Marke> heißt: vollständig im Planungsmodell geplant. Das ist keine Normprüfung, keine
          Bemessung und keine Aussage über die Ausführbarkeit.
        </p>
      </section>

      <section className={karte("kompakt")} aria-label="Leitungsmengen">
        <h3 className="m-0">Leitungsmengen nach Kabelangaben</h3>
        <p className="m-0 text-muted">
          Gruppiert nach den tatsächlichen Angaben jeder Leitung – nicht nach dem Stromkreisvorschlag. Offene und konflikthafte
          Leitungen stehen getrennt und sind nie in der bestätigten Menge enthalten.
        </p>
        {u.groups.length === 0 ? (
          <p className="m-0 mt-2 text-muted">Keine vollständig angegebene Leitung im Gebäude.</p>
        ) : (
          <div className={TABELLENRAHMEN}>
            <table className={TABELLE}>
              <thead>
                <tr>
                  <th>Kabelangaben</th>
                  <th>Bestätigt</th>
                  <th>Offen</th>
                  <th>Konflikt</th>
                  <th>Leitungen</th>
                </tr>
              </thead>
              <tbody>
                {u.groups.map((g) => {
                  const schluessel = gruppenName(g);
                  const auf = offen.includes(schluessel);
                  const ids = alleIds(g);
                  return (
                    <Fragment key={schluessel}>
                      <tr data-testid={`mengen-gruppe-${schluessel}`}>
                        <td>
                          <strong>{schluessel}</strong>
                        </td>
                        <td>{zelle(g.confirmed, "bestaetigt")}</td>
                        <td>{zelle(g.incomplete, "teilsumme")}</td>
                        <td>{zelle(g.conflict, "teilsumme")}</td>
                        <td>
                          <button type="button" className={knopf("neutral", { klein: true })} aria-expanded={auf} onClick={() => umschalten(schluessel)}>
                            {auf ? "Ausblenden" : `Zeigen (${ids.length})`}
                          </button>
                        </td>
                      </tr>
                      {auf && (
                        <tr>
                          <td colSpan={5}>{leitungsliste(ids, `Leitungen der Gruppe ${schluessel}`)}</td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr data-testid="mengen-summe">
                  <th>Summe (vollständig angegeben)</th>
                  <td>{zelle(u.totals.confirmed, "bestaetigt")}</td>
                  <td>{zelle(u.totals.incomplete, "teilsumme")}</td>
                  <td>{zelle(u.totals.conflict, "teilsumme")}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section className={karte("kompakt")} aria-label="Unvollständig spezifiziert">
        <h3 className="m-0">Unvollständig spezifiziert ({u.unspecified.length})</h3>
        <p className="m-0 text-muted">Leitungen mit fehlender Kabelangabe – keiner Gruppe zugeschlagen. Diese Angaben sind zu ergänzen.</p>
        {u.unspecified.length === 0 ? (
          <p className="m-0 mt-2 text-muted">Alle Leitungen sind vollständig angegeben.</p>
        ) : (
          <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0" aria-label="Leitungen mit fehlenden Angaben">
            {u.unspecified.map((l) => (
              <Leitungszeile key={l.id} l={l} kreis={kreisText(l.circuit_id)} von={geraet(l.start_device_id)} nach={geraet(l.end_device_id)} sperrgrund={sperrgrund(l.id)} onBearbeiten={onLeitungBearbeiten} fehlend />
            ))}
          </ul>
        )}
      </section>

      <section className={karte("kompakt")} aria-label="Zu klären">
        <h3 className="m-0">Noch offen oder im Konflikt ({zuKlaeren.length})</h3>
        {zuKlaeren.length === 0 ? (
          <p className="m-0 mt-2 text-muted">Alle Leitungen sind im Planungsmodell bestätigt.</p>
        ) : (
          <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0" aria-label="Leitungen zu klären">
            {zuKlaeren.map((l) => (
              <Leitungszeile key={l.id} l={l} kreis={kreisText(l.circuit_id)} von={geraet(l.start_device_id)} nach={geraet(l.end_device_id)} sperrgrund={sperrgrund(l.id)} onBearbeiten={onLeitungBearbeiten} befunde />
            ))}
          </ul>
        )}
      </section>

      <section className={karte("kompakt")} aria-label="Trassenmeter">
        <h3 className="m-0">Trassen- und Leitungsmeter je Fläche</h3>
        <p className="m-0 text-muted">
          Trassenmeter zählen gemeinsam genutzte Abschnitte einmal, Leitungsmeter je Leitung. Wand, Decke und Fußboden sind
          getrennte Flächen. Zugaben sind keine Trasse. „Mit vorläufigen Teilen“ enthält zusätzlich die gültigen Teilstrecken
          offener und konflikthafter Leitungen.
        </p>
        <div className={TABELLENRAHMEN}>
          <table className={TABELLE}>
            <thead>
              <tr>
                <th>Fläche</th>
                <th>Trasse bestätigt</th>
                <th>Leitungsmeter bestätigt</th>
                <th>Trasse mit vorläufigen Teilen</th>
                <th>Leitungsmeter mit vorläufigen Teilen</th>
              </tr>
            </thead>
            <tbody>
              {u.surfaces.map((s) => (
                <tr key={s.surface} data-testid={`mengen-flaeche-${s.surface}`}>
                  <td>{FLAECHE_TEXT[s.surface]}</td>
                  <td>
                    {mm(s.confirmed_trace_mm)}
                    {!s.confirmed_complete && <span className="text-muted"> (nur bekannter Teil)</span>}
                  </td>
                  <td>{mm(s.confirmed_cable_mm)}</td>
                  <td>
                    {mm(s.all_trace_mm)}
                    {!s.all_complete && <span className="text-muted"> (nur bekannter Teil)</span>}
                  </td>
                  <td>{mm(s.all_cable_mm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={karte("kompakt")} aria-label="Durchführungen und Bodenübergänge">
        <h3 className="m-0">Durchführungen und Bodenübergänge</h3>
        <p className="m-0" data-testid="mengen-durchfuehrungen">
          Durchführungen: <strong>{u.penetrations.length} Stück</strong> · genutzt {genutzt.length} · ungenutzt {u.penetrations.length - genutzt.length}
          <span className="text-muted"> – eine Durchführung zählt einmal, auch wenn mehrere Leitungen sie nutzen.</span>
        </p>
        {u.penetrations.length > 0 && (
          <ul className="m-0 mt-1 pl-[18px]" aria-label="Durchführungen">
            {u.penetrations.map((p, i) => (
              <li key={p.id}>
                Durchführung {i + 1}: {p.used ? `genutzt von ${p.cable_ids.length === 1 ? "einer Leitung" : `${p.cable_ids.length} Leitungen`}` : "ungenutzt"}
                {p.problem_code !== null && <span className="text-danger"> – {leitungsbefundText(p.problem_code)}</span>}
                {p.used && <span className="text-muted"> ({p.cable_ids.map((id) => leitungen.get(id)?.label ?? "Leitung").join(", ")})</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="m-0 mt-2" data-testid="mengen-bodenuebergaenge">
          Bodenübergänge: <strong>{nutzungen} {nutzungen === 1 ? "Nutzung" : "Nutzungen"}</strong> an {u.crossings.length}{" "}
          {u.crossings.length === 1 ? "Öffnung" : "Öffnungen"}
          <span className="text-muted"> – eine Planungsannahme je Leitung, kein Bauteil und keine Stückzahl.</span>
        </p>
        {u.crossings.length > 0 && (
          <ul className="m-0 mt-1 pl-[18px]" aria-label="Bodenübergänge">
            {u.crossings.map((c) => (
              <li key={`${c.opening_id ?? "entfernt"}-${c.wall_id}`}>
                {c.opening_id === null ? "Öffnung entfernt" : "Tür oder Durchgang"} an {wandText(c.wall_id)}: {c.uses}{" "}
                {c.uses === 1 ? "Nutzung" : "Nutzungen"} ({c.cable_ids.map((id) => leitungen.get(id)?.label ?? "Leitung").join(", ")})
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={karte("kompakt")} aria-label="Geräte">
        <h3 className="m-0">Geräte je Stromkreis</h3>
        {u.circuits.length === 0 ? (
          <p className="m-0 mt-2 text-muted">Im Gebäude ist noch kein Stromkreis angelegt.</p>
        ) : (
          <div className={TABELLENRAHMEN}>
            <table className={TABELLE}>
              <thead>
                <tr>
                  <th>Stromkreis</th>
                  <th>Geräte je Typ (Stück)</th>
                  <th>Zugeordnet, ohne Leitung</th>
                </tr>
              </thead>
              <tbody>
                {u.circuits.map((c) => (
                  <tr key={c.circuit_id} data-testid={`mengen-kreis-${c.designation}`}>
                    <td>{kreisText(c.circuit_id)}</td>
                    <td>{c.by_type.length === 0 ? <span className="text-muted">keine Geräte</span> : c.by_type.map((t) => `${t.count} × ${t.label}`).join(", ")}</td>
                    <td>{c.devices_without_cable.length === 0 ? <span className="text-muted">–</span> : c.devices_without_cable.map((id) => geraet(id)).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="m-0 mt-2" data-testid="mengen-nicht-zugeordnet">
          Nicht zugeordnet: <strong>{u.unassigned_device_ids.length} Stück</strong>
          {u.unassigned_device_ids.length > 0 && `: ${u.unassigned_device_ids.map((id) => geraet(id)).join(", ")}`}
          <span className="text-muted"> – nur zuordenbare Geräte; Datendosen und die Lage einer Verteilung zählen nicht.</span>
        </p>
        <p className="m-0 mt-1 text-muted">„Ohne Leitung“ beschreibt den Planungsstand, keine Aussage über die elektrische Ausführung.</p>
      </section>

      <details className="text-small text-muted">
        <summary className="cursor-pointer">Modellgrenzen</summary>
        <ul className="pl-[18px]">
          <li>Wandwege werden auf der Wandachse gemessen; an Innenecken ist die Länge um höchstens eine Wandstärke überschätzt.</li>
          <li>
            Fußbodenwege liegen modellhaft auf Höhe des Fertigfußbodens; Aufbau, Estrich, Leerrohre und tatsächliche Lage sind
            nicht abgebildet.
          </li>
          <li>Steigwege zählen nur mit bestätigten Geschosshöhen vollständig; sonst nur der bekannte Teil.</li>
          <li>Kein Material, keine Artikel, keine Preise, keine Arbeitszeit – das folgt in späteren Phasen.</li>
        </ul>
      </details>
    </div>
  );
}

function alleIds(g: Mengengruppe): string[] {
  return [...g.confirmed.cable_ids, ...g.incomplete.cable_ids, ...g.conflict.cable_ids];
}

function Leitungszeile({
  l,
  kreis,
  von,
  nach,
  sperrgrund,
  onBearbeiten,
  fehlend = false,
  befunde = false,
}: {
  l: Mengenleitung;
  kreis: string;
  von: string;
  nach: string;
  sperrgrund: string | null;
  onBearbeiten?: ((cableId: string) => void) | undefined;
  fehlend?: boolean;
  befunde?: boolean;
}) {
  const masse = useMasse();
  const laenge: ReactNode = l.length_mm !== null ? masse.anzeigen(l.length_mm) : `Teilsumme ${masse.anzeigen(l.known_mm)}`;
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-line py-1" data-testid={`mengen-leitung-${l.id}`}>
      <span className="min-w-0 flex-1">
        <strong>{l.label ?? "Leitung"}</strong> · {kreis} · {von} → {nach}
        <br />
        <span className="text-muted">
          {angabenText(l)} · {laenge} (Weg {masse.anzeigen(l.geometric_mm)}, Zugaben {masse.anzeigen(l.allowance_mm)})
        </span>
        {fehlend && l.missing_spec.length > 0 && <span className="text-danger"> · {fehlendText(l.missing_spec)}</span>}
        {befunde && l.problem_codes.length > 0 && (
          <span className="block text-muted">{[...new Set(l.problem_codes)].map((c) => leitungsbefundText(c)).join(" ")}</span>
        )}
      </span>
      <Marke art={STATUS_ART[l.status]}>{STATUS_TEXT[l.status]}</Marke>
      {onBearbeiten !== undefined &&
        (sperrgrund === null ? (
          <button type="button" className={knopf("neutral", { klein: true })} onClick={() => onBearbeiten(l.id)}>
            Bearbeiten
          </button>
        ) : (
          <span className="text-label text-muted">{sperrgrund}</span>
        ))}
    </li>
  );
}
