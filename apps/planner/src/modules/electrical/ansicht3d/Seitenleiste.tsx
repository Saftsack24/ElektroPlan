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
import type { Auswahl, Szenenmodell, Warnung } from "./modell";
import { auswahlSchluessel, raumBezeichnung } from "./modell";
import type { Objekt } from "./szenenmodell";
import { warnungenZu } from "./szenenmodell";

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
}: {
  modell: Szenenmodell;
  objekt: Objekt;
  onAuswahl: (auswahl: Auswahl | null) => void;
  onWandansicht?: (ziel: { raumId: string; wandId: string; seite: "innen" | "aussen" }) => void;
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

  const { wand } = objekt;
  const staerken = [...new Set(wand.quellen.map((q) => q.staerkeMm))];
  const raeume = wand.raumIds.map(name);
  const lage =
    wand.lage === "gemeinsam"
      ? `Gemeinsame Wand (innen) zwischen ${raeume.map((r) => `„${r}“`).join(" und ")} – exakt auf derselben Linie erfasst`
      : "Nicht geteilte Wand (als Außenwand dargestellt)";

  if (objekt.art === "wand") {
    return (
      <>
        <h3 className="mt-0 mb-1.5 text-[1rem]">{wand.lage === "gemeinsam" ? "Gemeinsame Wand" : "Wand"}</h3>
        <Werte
          zeilen={[
            ["Länge", mm(wand.laengeMm)],
            [
              "Stärke",
              staerken.length > 1
                ? `${mm(wand.staerkeMm)} dargestellt (erfasst: ${staerken.map(mm).join(" / ")})`
                : mm(wand.staerkeMm),
            ],
            ["Darstellungshöhe", mm(wand.hoeheMm)],
            ["Lage", lage],
            ["Räume", wand.raumIds.map(name).join(", ")],
            ["Öffnungen", String(wand.oeffnungen.length)],
          ]}
        />
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
          ["Wand", `${mm(wand.laengeMm)} · ${wand.lage === "gemeinsam" ? "gemeinsam" : "nicht geteilt"}`],
          ["Räume der Wand", wand.raumIds.map(name).join(", ")],
          ["Gespeichert in", erfasstIn.join(", ")],
        ]}
      />
    </>
  );
}

export function Seitenleiste({
  modell,
  auswahl,
  objekt,
  onAuswahl,
  onWandansicht,
}: {
  modell: Szenenmodell;
  auswahl: Auswahl | null;
  objekt: Objekt | null;
  onAuswahl: (auswahl: Auswahl | null) => void;
  /** Phase 4f: die gewählte Raumwand in der Wandansicht des 2D-Editors öffnen. */
  onWandansicht?: (ziel: { raumId: string; wandId: string; seite: "innen" | "aussen" }) => void;
}) {
  const eigene = auswahl !== null && objekt !== null ? warnungenZu(modell, auswahl) : [];
  return (
    <aside className="flex flex-col gap-3 overflow-auto split:max-h-[62vh]" aria-label="Informationen zur 3D-Ansicht">
      <section className="rounded-ep border border-line px-3 py-2.5" aria-live="polite">
        <h2 className="mt-0 mb-1.5 text-[0.95rem]">Auswahl</h2>
        {objekt === null ? (
          <p className="text-muted">
            Nichts ausgewählt. Einen Raum (Boden), eine Wand oder eine Öffnung in der Ansicht
            anklicken.
          </p>
        ) : (
          <>
            <Auswahlinfo modell={modell} objekt={objekt} onAuswahl={onAuswahl} {...(onWandansicht !== undefined ? { onWandansicht } : {})} />
            {eigene.length > 0 && <Hinweisliste warnungen={eigene} />}
            <button type="button" className={knopf()} onClick={() => onAuswahl(null)}>
              Auswahl aufheben (Esc)
            </button>
          </>
        )}
      </section>

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
