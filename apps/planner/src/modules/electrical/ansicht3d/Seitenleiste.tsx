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

function Auswahlinfo({ modell, objekt }: { modell: Szenenmodell; objekt: Objekt }) {
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
}: {
  modell: Szenenmodell;
  auswahl: Auswahl | null;
  objekt: Objekt | null;
  onAuswahl: (auswahl: Auswahl | null) => void;
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
            <Auswahlinfo modell={modell} objekt={objekt} />
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
