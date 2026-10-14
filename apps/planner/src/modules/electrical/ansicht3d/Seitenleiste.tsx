/**
 * Textliche Seite der 3D-Ansicht: Auswahl, ausgelassene Räume, Hinweise.
 *
 * Eine 3D-Szene ist allein nicht barrierefrei. Alles, was sie zeigt, steht
 * deshalb auch hier als Text - und vollständig in „Tabellen & Details".
 * Keine Eingabefelder, kein Speichern: Die 3D-Ansicht ist schreibgeschützt.
 */
import { useMasse } from "../../../core/ui/masseinheit";
import { knopf } from "../../../core/ui/stil";
import { OEFFNUNGSART_LABEL, flaecheAnzeigen } from "../texte";
import type { Auswahl, Szenenmodell, Wand3d, Warnung } from "./modell";
import { auswahlSchluessel, raumBezeichnung } from "./modell";
import type { Objekt } from "./szenenmodell";
import type { Geraet3d } from "./geraete3d";
import { FLAECHE_LABEL } from "../geraete/katalog";
import { Geraetesymbol } from "../geraete/symbole";
import { warnungenZu } from "./szenenmodell";
import type { Leitung3d, Leitungsflaeche3d } from "./leitungen3d";
import { LEITUNGSSTATUS_TEXT } from "./leitungen3d";

/** Wo eine gewählte Leitung bearbeitet wird - die passende Fläche ihres Teilstücks. */
export type Leitungsziel3d =
  | { readonly art: "grundriss" }
  | { readonly art: "wand"; readonly raumId: string; readonly wandId: string }
  | { readonly art: "decke"; readonly raumId: string };

const FLAECHE3D_TEXT: Record<Leitungsflaeche3d, string> = { wand: "Wand", decke: "Decke", fussboden: "Fußboden", steigweg: "Steigweg" };

/** Hinweise und ausgelassene Elemente. */
const LISTE = "m-0 flex list-none flex-col gap-2 p-0 text-[0.88rem]";


function Werte({ zeilen }: { zeilen: readonly (readonly [string, string])[] }) {
  return (
    <dl className="mt-0 mb-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-small *:contents [&_dd]:m-0 [&_dd]:wrap-anywhere [&_dt]:text-muted">
      {zeilen.map(([name, wert]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{wert}</dd>
        </div>
      ))}
    </dl>
  );
}

function Hinweisliste({
  warnungen,
  onZeigen,
  auswahl,
}: {
  warnungen: readonly Warnung[];
  onZeigen?: (auswahl: Auswahl) => void;
  auswahl?: Auswahl | null;
}) {
  return (
    <ul className={LISTE}>
      {warnungen.map((w) => {
        const ziel = w.bezug[0];
        const bereitsGewaehlt =
          ziel !== undefined && auswahl != null && auswahlSchluessel(ziel) === auswahlSchluessel(auswahl);
        return (
          <li key={w.id} className="border-l-4 border-warning py-0.5 pl-2 [&_p]:mt-0 [&_p]:mb-1">
            <p>
              <span className="text-warning" aria-hidden="true">
                ⚠
              </span>{" "}
              <strong>Hinweis: {w.titel}</strong>
            </p>
            <p>{w.text}</p>
            {onZeigen !== undefined && ziel !== undefined && !bereitsGewaehlt && (
              <button type="button" className={knopf()} onClick={() => onZeigen(ziel)}>
                In der Ansicht zeigen
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Auswahlinfo({
  modell,
  objekt,
  onAuswahl,
  onWandansicht,
  onGeraetBearbeiten,
  onLeitungBearbeiten,
  leitungSperre,
}: {
  modell: Szenenmodell;
  objekt: Objekt;
  onAuswahl: (auswahl: Auswahl | null) => void;
  onWandansicht?: (ziel: { raumId: string; wandId: string; seite: "innen" | "aussen" }) => void;
  /** Phase 5: Gerät in der Wand- bzw. Deckenansicht des 2D-Editors bearbeiten. */
  onGeraetBearbeiten?: (geraet: Geraet3d) => void;
  /** Phase 6b.5: die gewählte Leitung auf der passenden Fläche bearbeiten. */
  onLeitungBearbeiten?: (leitung: Leitung3d, ziel: Leitungsziel3d) => void;
  /** Warum gerade nicht bearbeitet werden kann - sonst `null`. */
  leitungSperre?: string | null;
}) {
  // Längen in der persönlichen Anzeigeeinheit - dieselbe wie im 2D-Editor.
  const { anzeigen: mm } = useMasse();
  const name = (raumId: string) => {
    const raum = modell.raeume.find((r) => r.id === raumId);
    return raum === undefined ? "unbekannter Raum" : raumBezeichnung(raum);
  };

  if (objekt.art === "raum") {
    const { raum } = objekt;
    return (
      <>
        <h3 className="mt-0 mb-1.5 text-[1rem]">Raum {raumBezeichnung(raum)}</h3>
        <Werte
          zeilen={[
            ["Bezeichnung", raum.name],
            ["Raumnummer", raum.nummer ?? "—"],
            ["Effektive Höhe", mm(raum.hoeheMm)],
            ["Fläche", flaecheAnzeigen(raum.flaecheM2)],
            ["Wände", String(raum.wandanzahl)],
          ]}
        />
      </>
    );
  }

  if (objekt.art === "raumwand") {
    const { raumwand: w } = objekt;
    const hoehe = (raumId: string) => modell.raeume.find((r) => r.id === raumId)?.hoeheMm ?? null;
    return (
      <>
        <h3 className="mt-0 mb-1.5 text-[1rem]">
          Wand {w.nummer} von „{name(w.raumId)}“
        </h3>
        <Werte
          zeilen={[
            ["Länge", `${mm(w.laengeMm)} (ganze Wand dieses Raums)`],
            ["Stärke", mm(w.staerkeMm)],
            ["Raumhöhe", mm(w.hoeheMm)],
            ["Öffnungen", String(w.oeffnungIds.length)],
          ]}
        />
        <p className="mt-0 mb-1 text-muted">Abschnitte (ab Wandanfang):</p>
        <ul className="mt-0 mb-2 pl-[18px] text-small" aria-label="Abschnitte der Wand">
          {w.abschnitte.map((a) => (
            <li key={a.id}>
              {mm(a.vonMm)} bis {mm(a.bisMm)}:{" "}
              {a.mehrdeutig
                ? "mehr als zwei Räume – Zuordnung nicht eindeutig"
                : a.nachbarn.length === 0
                  ? "nicht geteilt (außen)"
                  : `grenzt an ${a.nachbarn
                      .map((n) => {
                        const h = hoehe(n);
                        return `„${name(n)}“${h !== null && h !== w.hoeheMm ? ` (Raumhöhe ${mm(h)})` : ""}`;
                      })
                      .join(", ")}`}
            </li>
          ))}
        </ul>
        {onWandansicht !== undefined && (
          <button type="button" className={`${knopf("primaer")} mb-2`} onClick={() => onWandansicht({ raumId: w.raumId, wandId: w.id, seite: "innen" })}>
            In der Wandansicht öffnen (Innenseite)
          </button>
        )}
      </>
    );
  }

  if (objekt.art === "fassade") {
    const { fassade, abschnitt } = objekt;
    const angeklickt = fassade.abschnitte.find((a) => a.id === abschnitt);
    // Von außen gewählt: die Außenseite der eindeutig gewählten Raumwand.
    const ziel = (a: (typeof fassade.abschnitte)[number]) => ({ raumId: a.raumId, wandId: a.wandId, seite: "aussen" as const });
    return (
      <>
        <h3 className="mt-0 mb-1.5 text-[1rem]">Außenwand (Fassade)</h3>
        <Werte
          zeilen={[
            ["Länge", `${mm(fassade.laengeMm)} (durchgehend)`],
            ["Räume dahinter", String(new Set(fassade.abschnitte.map((a) => a.raumId)).size)],
            ["Öffnungen", String(fassade.oeffnungIds.length)],
          ]}
        />
        <p className="mt-0 mb-1 text-muted">
          Ansichtsgruppe aus den nicht geteilten Wandstücken auf einer Linie – nicht gespeichert.
        </p>
        <ul className="mt-0 mb-2 pl-[18px] text-small" aria-label="Abschnitte der Fassade">
          {fassade.abschnitte.map((a) => (
            <li key={a.id}>
              {mm(a.vonMm)} bis {mm(a.bisMm)}: Wand von „{name(a.raumId)}“{a.id === abschnitt ? " (angeklickt)" : ""}
            </li>
          ))}
        </ul>
        {onWandansicht !== undefined &&
          (angeklickt !== undefined ? (
            <button type="button" className={`${knopf("primaer")} mb-2`} onClick={() => onWandansicht(ziel(angeklickt))}>
              In der Wandansicht öffnen (Außenseite, Wand von „{name(angeklickt.raumId)}“)
            </button>
          ) : (
            <div className="mb-2 flex flex-col gap-1">
              <p className="m-0">In der Wandansicht öffnen – welcher Raum?</p>
              {fassade.abschnitte.map((a) => (
                <button key={a.id} type="button" className={knopf()} onClick={() => onWandansicht(ziel(a))}>
                  Wand von „{name(a.raumId)}“ ({mm(a.vonMm)} bis {mm(a.bisMm)})
                </button>
              ))}
            </div>
          ))}
      </>
    );
  }

  if (objekt.art === "wandseite") {
    // Krone oder Stirnseite einer gemeinsamen Wand: Welche Raumseite gemeint
    // ist, lässt sich nicht bestimmen - nichts raten, ausdrücklich wählen lassen.
    const quellen = [...objekt.wand.quellen].sort((a, b) => name(a.raumId).localeCompare(name(b.raumId), "de"));
    const fassade = objekt.wand.lage === "aussen" ? modell.fassaden.find((f) => f.abschnitte.some((a) => a.id === objekt.wand.id)) : undefined;
    return (
      <>
        <h3 className="mt-0 mb-1.5 text-[1rem]">Welche Wandseite?</h3>
        <p className="mt-0 mb-1.5">
          Getroffen wurde die Oberkante oder eine Stirnseite der Wand. Von hier aus ist nicht eindeutig, welche Seite gemeint
          ist. Bitte wählen:
        </p>
        <div className="mb-2 flex flex-col gap-1">
          {quellen.map((q) => (
            <button key={q.id} type="button" className={knopf()} onClick={() => onAuswahl({ art: "raumwand", id: q.id })}>
              Innenseite – Wand von „{name(q.raumId)}“
            </button>
          ))}
          {fassade !== undefined && (
            <button type="button" className={knopf()} onClick={() => onAuswahl({ art: "fassade", id: fassade.id, abschnitt: objekt.wand.id })}>
              Außenseite – Fassade
            </button>
          )}
        </div>
      </>
    );
  }

  if (objekt.art === "leitung") {
    const { leitung: l } = objekt;
    const anzahl = (f: Leitungsflaeche3d) => l.stuecke.filter((s) => s.flaeche === f).length;
    const flaechen = (["wand", "decke", "fussboden", "steigweg"] as const).filter((f) => anzahl(f) > 0);
    const wand = l.stuecke.find((s) => s.flaeche === "wand" && s.wandId !== null && s.raumId !== null);
    const decke = l.stuecke.find((s) => s.flaeche === "decke" && s.raumId !== null);
    return (
      <>
        <h3 className="mt-0 mb-1.5 text-[1rem]">Leitung {l.bezeichnung}</h3>
        <Werte
          zeilen={[
            ["Status", LEITUNGSSTATUS_TEXT[l.status]],
            ["Länge", l.laengeMm !== null ? mm(l.laengeMm) : `Teilsumme ${mm(l.bekanntMm)} – keine Gesamtlänge`],
            ["Auf diesem Geschoss", flaechen.length === 0 ? "nur Fortsetzung" : flaechen.map((f) => `${FLAECHE3D_TEXT[f]} (${anzahl(f)})`).join(", ")],
          ]}
        />
        {l.fortsetzungen.length > 0 && (
          <ul className="mt-0 mb-2 pl-[18px] text-small" aria-label="Fortsetzungen in andere Geschosse">
            {l.fortsetzungen.map((f, i) => (
              <li key={i}>{f.text}</li>
            ))}
          </ul>
        )}
        <p className="mt-0 mb-1.5 text-muted">Gezeigt wird der gespeicherte Stand; bearbeitet wird im Leitungsentwurf.</p>
        {onLeitungBearbeiten !== undefined &&
          (leitungSperre != null ? (
            <p className="mt-0 mb-1.5" role="status">
              {leitungSperre}
            </p>
          ) : (
            <div className="mb-2 flex flex-col gap-1.5">
              {wand !== undefined && wand.wandId !== null && wand.raumId !== null && (
                <button type="button" className={knopf("primaer")} onClick={() => onLeitungBearbeiten(l, { art: "wand", raumId: wand.raumId as string, wandId: wand.wandId as string })}>
                  In der Wandansicht bearbeiten
                </button>
              )}
              {decke !== undefined && decke.raumId !== null && (
                <button type="button" className={knopf(wand === undefined ? "primaer" : "neutral")} onClick={() => onLeitungBearbeiten(l, { art: "decke", raumId: decke.raumId as string })}>
                  In der Deckenansicht bearbeiten
                </button>
              )}
              <button type="button" className={knopf(wand === undefined && decke === undefined ? "primaer" : "neutral")} onClick={() => onLeitungBearbeiten(l, { art: "grundriss" })}>
                Im Grundriss bearbeiten
              </button>
            </div>
          ))}
      </>
    );
  }

  if (objekt.art === "geraet") {
    const { geraet: g } = objekt;
    const decke = g.flaeche === "ceiling";
    return (
      <>
        <h3 className="mt-0 mb-1.5 flex items-center gap-2 text-[1rem]">
          <Geraetesymbol typ={g.typ} />
          {g.name}
        </h3>
        <Werte
          zeilen={[
            ["Typ", g.typ?.label ?? g.typKey],
            ["Montagefläche", FLAECHE_LABEL[g.flaeche]],
            ["Raum", name(g.raumId)],
            ...(decke
              ? ([["Montagehöhe", `${mm(g.hoeheMm)} = Deckenhöhe des Raums (folgt ihr)`]] as const)
              : ([
                  ["Wand", g.wandNummer === null ? "—" : `Wand ${g.wandNummer}`],
                  ["Mitte über Boden", mm(g.hoeheMm)],
                ] as const)),
            ["Planungsmaß", `${mm(g.breiteMm)} × ${mm(g.hoeheMassMm)}`],
          ]}
        />
        {onGeraetBearbeiten !== undefined && (
          <button type="button" className={`${knopf("primaer")} mb-2`} onClick={() => onGeraetBearbeiten(g)}>
            {decke ? "An Decke bearbeiten" : "An Wand bearbeiten"}
          </button>
        )}
      </>
    );
  }

  const { wand } = objekt;
  const staerken = [...new Set(wand.quellen.map((q) => q.staerkeMm))];
  const raeume = wand.raumIds.map(name);
  const getrennt = wand.zuordnung === "separate";
  const lage =
    wand.lage === "gemeinsam"
      ? `${getrennt ? "Zwei Wände" : "Wand"} zwischen ${raeume.map((r) => `„${r}“`).join(" und ")} – exakt auf derselben Linie erfasst`
      : "Außenseite – kein modellierter Nachbarraum";

  if (objekt.art === "wand") {
    return (
      <>
        <h3 className="mt-0 mb-1.5 text-[1rem]">{zuordnungsTitel(wand)}</h3>
        <Werte
          zeilen={[
            ["Länge", mm(wand.laengeMm)],
            [
              "Stärke",
              getrennt
                ? wand.quellen.map((q) => `„${name(q.raumId)}“ ${mm(q.staerkeMm)}`).join(" · ")
                : staerken.length > 1
                  ? `${mm(wand.staerkeMm)} dargestellt (erfasst: ${staerken.map(mm).join(" / ")})`
                  : mm(wand.staerkeMm),
            ],
            ["Darstellungshöhe", getrennt ? wand.quellen.map((q) => `„${name(q.raumId)}“ ${mm(q.raumhoeheMm)}`).join(" · ") : mm(wand.hoeheMm)],
            ["Lage", lage],
            ...(wand.lage === "gemeinsam" ? ([["Wandzuordnung", zuordnungsText(wand)]] as const) : []),
            ["Räume", wand.raumIds.map(name).join(", ")],
            ["Öffnungen", String(wand.oeffnungen.length)],
          ]}
        />
        {wand.lage === "gemeinsam" && (
          <p className="mt-0 mb-1.5 text-muted">Die Wandzuordnung wird im Grundriss an der Wand festgelegt.</p>
        )}
      </>
    );
  }

  const { oeffnung } = objekt;
  const q = oeffnung.quellen[0];
  const erfasstIn = [...new Set(oeffnung.quellen.map((x) => x.raumId))].map(name);
  // Die Maße stammen aus der gespeicherten Öffnung - das Rechteck in der
  // Szene ist bei einer über eine Abschnittsgrenze reichenden Öffnung beschnitten.
  const verbindung =
    oeffnung.klasse === "gemeinsam"
      ? `Verbindet ${oeffnung.raumIds.map((r) => `„${name(r)}“`).join(" und ")}`
      : oeffnung.klasse === "aussen"
        ? "Nicht geteilte Wand – kein zweiter Raum"
        : oeffnung.klasse === "getrennt"
          ? `Nur in der Wand von „${name(q?.raumId ?? "")}“ – die Wände sind als getrennt festgelegt`
          : "Nicht eindeutig – siehe Hinweis";
  return (
    <>
      <h3 className="mt-0 mb-1.5 text-[1rem]">{oeffnung.arten.map((a) => OEFFNUNGSART_LABEL[a]).join(" / ")}</h3>
      <p className="mt-0 mb-1.5 font-semibold">{verbindung}</p>
      <Werte
        zeilen={[
          ["Art", oeffnung.arten.map((a) => OEFFNUNGSART_LABEL[a]).join(" / ")],
          ["Breite", q === undefined ? "—" : mm(q.breiteMm)],
          ["Höhe", q === undefined ? "—" : mm(q.hoeheMm)],
          ["Brüstung", q === undefined ? "—" : mm(q.bruestungMm)],
          ["Abstand vom Wandanfang", q === undefined ? "—" : `${mm(q.offsetMm)} (an der Wand von „${name(q.raumId)}“)`],
          ["Wand", `${mm(wand.laengeMm)} · ${wand.lage === "gemeinsam" ? zuordnungsText(wand) : "nicht geteilt"}`],
          ["Räume der Wand", wand.raumIds.map(name).join(", ")],
          ["Gespeichert in", erfasstIn.join(", ")],
        ]}
      />
    </>
  );
}

/** Überschrift einer Darstellungswand nach ihrem Kopplungszustand (Phase 6a). */
function zuordnungsTitel(wand: Wand3d): string {
  if (wand.lage !== "gemeinsam") return "Wand";
  if (wand.zuordnung === "shared") return "Gemeinsame Bauwand";
  if (wand.zuordnung === "separate") return "Getrennte Wände";
  return "Gemeinsame Wand – Zuordnung offen";
}

function zuordnungsText(wand: Wand3d): string {
  if (wand.zuordnung === "shared") {
    const staerken = new Set(wand.quellen.map((q) => q.staerkeMm));
    return staerken.size > 1 ? "gemeinsame Bauwand – widersprüchliche Stärke" : "gemeinsame Bauwand";
  }
  if (wand.zuordnung === "separate") {
    return "getrennte Wände – vereinfacht als zwei Halbkörper dargestellt (je Raum die eigene halbe Stärke), keine maßstäbliche Aussage über den Wandaufbau";
  }
  if (wand.kandidat?.art === "suggested") return "offen – Vorschlag: gemeinsame Bauwand";
  if (wand.kandidat?.art === "not-linkable" || wand.raumIds.length > 2) return "nicht eindeutig zuordenbar";
  return "offen – vorsichtig wie bisher behandelt";
}

export function Seitenleiste({
  modell,
  auswahl,
  objekt,
  onAuswahl,
  onWandansicht,
  onGeraetBearbeiten,
  leitungen = [],
  onLeitungBearbeiten,
  leitungSperre = null,
  entwurfHinweis = null,
}: {
  modell: Szenenmodell;
  auswahl: Auswahl | null;
  objekt: Objekt | null;
  onAuswahl: (auswahl: Auswahl | null) => void;
  /** Phase 4f: die gewählte Raumwand in der Wandansicht des 2D-Editors öffnen. */
  onWandansicht?: (ziel: { raumId: string; wandId: string; seite: "innen" | "aussen" }) => void;
  onGeraetBearbeiten?: (geraet: Geraet3d) => void;
  /** Phase 6b.5: gespeicherte Leitungen dieses Geschosses - auch als Text wählbar. */
  leitungen?: readonly Leitung3d[];
  onLeitungBearbeiten?: (leitung: Leitung3d, ziel: Leitungsziel3d) => void;
  leitungSperre?: string | null;
  /** Hinweis auf einen offenen Leitungsentwurf - er bleibt erhalten, 3D zeigt den gespeicherten Stand. */
  entwurfHinweis?: string | null;
}) {
  const eigene = auswahl !== null && objekt !== null ? warnungenZu(modell, auswahl) : [];
  return (
    <aside className="flex flex-col gap-3 overflow-auto split:max-h-[62vh]" aria-label="Informationen zur 3D-Ansicht">
      <section className="rounded-ep border border-line px-3 py-2.5" aria-live="polite">
        <h2 className="mt-0 mb-1.5 text-[0.95rem]">Auswahl</h2>
        {objekt === null ? (
          <p className="text-muted">
            Nichts ausgewählt. Einen Raum (Boden), eine Wand, eine Öffnung oder ein Gerät in der
            Ansicht anklicken.
          </p>
        ) : (
          <>
            <Auswahlinfo
              modell={modell}
              objekt={objekt}
              onAuswahl={onAuswahl}
              {...(onWandansicht !== undefined ? { onWandansicht } : {})}
              {...(onGeraetBearbeiten !== undefined ? { onGeraetBearbeiten } : {})}
              {...(onLeitungBearbeiten !== undefined ? { onLeitungBearbeiten, leitungSperre } : {})}
            />
            {eigene.length > 0 && <Hinweisliste warnungen={eigene} />}
            <button type="button" className={knopf()} onClick={() => onAuswahl(null)}>
              Auswahl aufheben (Esc)
            </button>
          </>
        )}
      </section>

      {(leitungen.length > 0 || entwurfHinweis !== null) && (
        <section className="rounded-ep border border-line px-3 py-2.5" aria-label="Leitungen in der 3D-Ansicht">
          <h2 className="mt-0 mb-1.5 text-[0.95rem]">Leitungen ({leitungen.length})</h2>
          {entwurfHinweis !== null && (
            <p className="mt-0 mb-1.5 text-muted" role="status">
              {entwurfHinweis}
            </p>
          )}
          <ul className={LISTE}>
            {leitungen.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  className={knopf(auswahl?.art === "leitung" && auswahl.id === l.id ? "gewaehlt" : "einfach")}
                  aria-pressed={auswahl?.art === "leitung" && auswahl.id === l.id}
                  onClick={() => onAuswahl({ art: "leitung", id: l.id })}
                >
                  {l.bezeichnung} – {LEITUNGSSTATUS_TEXT[l.status]}
                  {l.fortsetzungen.length > 0 ? " · geschossübergreifend" : ""}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 mb-0 text-label text-muted">
            Strichart: bestätigt durchgezogen, unvollständig gestrichelt, Konflikt kurz gestrichelt. Kugeln markieren die
            Fortsetzung in ein anderes Geschoss.
          </p>
        </section>
      )}

      {modell.ausgelassen.length > 0 && (
        <section className="rounded-ep border border-line px-3 py-2.5">
          <h2 className="mt-0 mb-1.5 text-[0.95rem]">Nicht dargestellt ({modell.ausgelassen.length})</h2>
          <p className="text-muted">
            Diese Räume haben noch keine vollständige Geometrie und erscheinen deshalb nicht in 3D:
          </p>
          <ul className={LISTE}>
            {modell.ausgelassen.map((raum) => (
              <li key={raum.id}>
                <strong>{raum.bezeichnung}</strong> – {raum.grund}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-ep border border-line px-3 py-2.5">
        <h2 className="mt-0 mb-1.5 text-[0.95rem]">Hinweise zur Darstellung ({modell.warnungen.length})</h2>
        {modell.warnungen.length === 0 ? (
          <p className="text-muted">Keine Auffälligkeiten in den erfassten Daten.</p>
        ) : (
          <>
            <p className="text-muted">
              Die 3D-Ansicht zeigt die gespeicherten Daten, ohne sie zu ändern. Wo sie sich
              widersprechen, gilt eine Darstellungsregel – korrigiert wird im 2D-Editor.
            </p>
            <Hinweisliste warnungen={modell.warnungen} onZeigen={onAuswahl} auswahl={auswahl} />
          </>
        )}
      </section>
    </aside>
  );
}
