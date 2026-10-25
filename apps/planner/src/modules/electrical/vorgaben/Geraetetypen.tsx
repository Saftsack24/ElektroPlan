import { ApiError } from "@elektroplan/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useAuth, usePermission } from "../../../core/auth/AuthProvider";
import { Dialog } from "../../../core/ui/Dialog";
import { Marke } from "../../../core/ui/Marke";
import { useMasse } from "../../../core/ui/masseinheit";
import { useRueckfrage } from "../../../core/ui/Rueckfrage";
import { KARTENKOPF, KARTENTITEL, TABELLE, TABELLENRAHMEN, karte, knopf, meldungsflaeche } from "../../../core/ui/stil";
import type { Geraetetyp } from "../geraete/katalog";
import { FLAECHE_LABEL, KATEGORIE_LABEL, istEigenerTyp, istVerwendet, katalogAbfrage, katalogSchluessel } from "../geraete/katalog";
import { Geraetesymbol } from "../geraete/symbole";
import { TypFormular } from "../geraete/TypFormular";
import type { Typwerte } from "../geraete/typen";
import { GERAETETYPEN_RECHT, alsNeuerTyp, leereTypwerte, typFehlerText, typwerteAus, verwendungText } from "../geraete/typen";

type Formular = { titel: string; stand: Geraetetyp | null; start: Typwerte };

function flaechen(t: Geraetetyp): string {
  return [t.allows_wall_interior && FLAECHE_LABEL.wall_interior, t.allows_wall_exterior && FLAECHE_LABEL.wall_exterior, t.allows_ceiling && FLAECHE_LABEL.ceiling]
    .filter((x) => x !== false)
    .join(", ");
}

/**
 * Abschnitt „Gerätetypen“ der Elektro-Vorgaben (Phase 6c, K2, ADR 0030): eigene Typen des
 * Betriebs bearbeiten, (de)aktivieren, entfernen und als neuen Typ anlegen. Lesen darf jeder
 * mit Planungsrecht; ändern nur mit „Gerätetypen verwalten“ (Standard: Administrator).
 *
 * Verwendete Typen lassen sich nicht entfernen – nur deaktivieren: Vorhandene Geräte behalten
 * ihren Typ und bleiben lesbar, neu platziert wird er nicht mehr. Systemtypen sind nicht
 * änderbar; „Als neuen Typ anlegen“ übernimmt ihre Angaben in einen eigenen Typ.
 */
export function Geraetetypen() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const masse = useMasse();
  const fragen = useRueckfrage();
  const darf = usePermission(GERAETETYPEN_RECHT);
  // Verwendung ändert sich mit Geräten und Vorgaben anderer Ansichten – hier immer frisch laden.
  const katalog = useQuery({ ...katalogAbfrage(api), staleTime: 0 });
  const [formular, setFormular] = useState<Formular | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);

  const alle = (Array.isArray(katalog.data) ? katalog.data : []).slice().sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, "de"));
  const eigene = alle.filter(istEigenerTyp);
  const system = alle.filter((t) => !istEigenerTyp(t) && t.category !== "distribution");
  const neuLaden = () => queryClient.invalidateQueries({ queryKey: katalogSchluessel() });

  const aktivSchalten = async (t: Geraetetyp) => {
    setMeldung(null);
    try {
      await api.patch("/api/v1/modules/electrical/device-types/{key}", { path: { key: t.key }, ifMatch: t.version, body: { is_active: !t.is_active } });
      setMeldung(
        t.is_active
          ? `„${t.label}“ deaktiviert – wird für neue Geräte nicht mehr angeboten. Vorhandene Geräte behalten den Typ.`
          : `„${t.label}“ wieder aktiv.`,
      );
    } catch (error: unknown) {
      setMeldung(typFehlerText(error, "Der Gerätetyp konnte nicht geändert werden."));
    }
    await neuLaden();
  };

  const entfernen = async (t: Geraetetyp) => {
    const antwort = await fragen({
      titel: "Gerätetyp entfernen?",
      text: <p>Der unbenutzte eigene Typ „{t.label}“ wird entfernt.</p>,
      bestaetigenLabel: "Typ entfernen",
      abbrechenLabel: "Abbrechen",
      gefaehrlich: true,
    });
    if (antwort !== "bestaetigt") return;
    setMeldung(null);
    try {
      await api.delete("/api/v1/modules/electrical/device-types/{key}", { path: { key: t.key }, ifMatch: t.version });
      setMeldung(`„${t.label}“ entfernt.`);
    } catch (error: unknown) {
      const verwendet = error instanceof ApiError && (error.problem?.errors ?? []).some((e) => e.code === "device-type-in-use");
      setMeldung(
        verwendet
          ? `„${t.label}“ wird inzwischen verwendet und bleibt erhalten. Deaktivieren verhindert neue Geräte; der Bestand bleibt lesbar.`
          : typFehlerText(error, "Der Gerätetyp konnte nicht entfernt werden."),
      );
    }
    await neuLaden();
  };

  const kopie = (t: Geraetetyp): Formular => ({ titel: "Als neuen Typ anlegen", stand: null, start: alsNeuerTyp(typwerteAus(t, masse)) });

  return (
    <section className={karte()} aria-labelledby="geraetetypen-titel" data-testid="geraetetypen">
      <div className={KARTENKOPF}>
        <h2 id="geraetetypen-titel" className={KARTENTITEL}>
          Gerätetypen
        </h2>
        {darf && (
          <button type="button" className={knopf("primaer")} onClick={() => setFormular({ titel: "Eigenen Gerätetyp anlegen", stand: null, start: leereTypwerte(null) })}>
            Eigenen Typ anlegen
          </button>
        )}
      </div>
      <p className="m-0 mb-2 text-small text-muted">
        Eigene Typen ergänzen den Gerätekatalog im ganzen Betrieb – ohne Artikel, Preise oder Bemessung.
        {!darf && " Ändern dürfen Benutzer mit dem Recht „Gerätetypen verwalten“."}
      </p>
      {meldung !== null && (
        <p className={`${meldungsflaeche("schlicht")} mb-2`} role="status">
          {meldung}
        </p>
      )}
      {katalog.isPending ? (
        <p className="text-muted">Gerätetypen werden geladen …</p>
      ) : katalog.isError ? (
        <p className={meldungsflaeche()} role="alert">
          Die Gerätetypen konnten nicht geladen werden.
        </p>
      ) : eigene.length === 0 ? (
        <p className="text-muted">Noch kein eigener Gerätetyp angelegt.</p>
      ) : (
        <div className={TABELLENRAHMEN}>
          <table className={TABELLE} aria-label="Eigene Gerätetypen">
            <thead>
              <tr>
                <th>Name</th>
                <th>Kategorie</th>
                <th>Montage</th>
                <th>Planungsmaß</th>
                <th>Status</th>
                {darf && <th>Aktionen</th>}
              </tr>
            </thead>
            <tbody>
              {eigene.map((t) => (
                <tr key={t.key} data-testid={`geraetetyp-${t.label}`}>
                  <td>
                    <span className="flex items-center gap-2">
                      <Geraetesymbol typ={t} />
                      {t.label}
                    </span>
                  </td>
                  <td>{t.category === "distribution" ? "Verteilung" : KATEGORIE_LABEL[t.category]}</td>
                  <td>{flaechen(t)}</td>
                  <td>
                    {masse.anzeigen(t.width_mm)} × {masse.anzeigen(t.height_mm)}
                  </td>
                  <td>
                    <span className="flex flex-wrap gap-1">
                      <Marke art={t.is_active ? "erfolg" : "neutral"}>{t.is_active ? "aktiv" : "deaktiviert"}</Marke>
                      {istVerwendet(t) && <Marke art="info">verwendet: {verwendungText(t)}</Marke>}
                    </span>
                  </td>
                  {darf && (
                    <td>
                      <span className="flex flex-wrap gap-1">
                        <button type="button" className={knopf("neutral", { klein: true })} onClick={() => setFormular({ titel: "Gerätetyp bearbeiten", stand: t, start: typwerteAus(t, masse) })}>
                          Bearbeiten
                        </button>
                        <button type="button" className={knopf("neutral", { klein: true })} onClick={() => setFormular(kopie(t))}>
                          Als neuen Typ anlegen
                        </button>
                        <button type="button" className={knopf("neutral", { klein: true })} onClick={() => void aktivSchalten(t)}>
                          {t.is_active ? "Deaktivieren" : "Aktivieren"}
                        </button>
                        {!istVerwendet(t) && (
                          <button type="button" className={knopf("neutral", { klein: true })} onClick={() => void entfernen(t)}>
                            Entfernen
                          </button>
                        )}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="m-0 mt-2 text-small text-muted">
        Verwendete Typen: Kategorie und Planungsmaß gesperrt, Entfernen nicht möglich – nur Deaktivieren. Vorhandene Geräte bleiben unverändert.
      </p>
      {system.length > 0 && (
        <details className="mt-2 text-small">
          <summary className="cursor-pointer">Systemtypen von ElektroPlan ({system.length}) – nicht änderbar</summary>
          <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
            {system.map((t) => (
              <li key={t.key} className="flex flex-wrap items-center gap-2">
                <Geraetesymbol typ={t} />
                <span>{t.label}</span>
                <span className="text-muted">· {KATEGORIE_LABEL[t.category]}</span>
                {darf && (
                  <button type="button" className={knopf("einfach", { klein: true })} aria-label={`${t.label} als neuen Typ anlegen`} onClick={() => setFormular(kopie(t))}>
                    Als neuen Typ anlegen
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {formular !== null && (
        <Dialog offen titel={formular.titel} onClose={() => setFormular(null)}>
          <TypFormular
            stand={formular.stand}
            start={formular.start}
            onAbbrechen={() => setFormular(null)}
            onGespeichert={(t) => {
              setFormular(null);
              setMeldung(`Gerätetyp „${t.label}“ gespeichert.`);
            }}
          />
        </Dialog>
      )}
    </section>
  );
}
