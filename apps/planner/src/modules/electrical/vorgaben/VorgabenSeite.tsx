import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useAuth, usePermission } from "../../../core/auth/AuthProvider";
import { Marke } from "../../../core/ui/Marke";
import { useMasse } from "../../../core/ui/masseinheit";
import { useRueckfrage } from "../../../core/ui/Rueckfrage";
import { KARTENKOPF, KARTENTITEL, TABELLE, TABELLENRAHMEN, karte, knopf, meldungsflaeche } from "../../../core/ui/stil";
import { katalogAbfrage } from "../geraete/katalog";
import { ZUORDENBAR, querschnittAnzeigen } from "../stromkreise/daten";
import type { Kabelvorlage } from "./daten";
import { VORGABEN_RECHT, betriebsstandardAbfrage, prozentAnzeigen, vorlageText, vorlagenAbfrage, vorlagenSchluessel } from "./daten";
import { apiFehlerText } from "./fehler";
import { VorgabenDialog } from "./VorgabenDialog";
import { VorlageDialog } from "./VorlageDialog";

/**
 * „Elektro-Vorgaben“ des Betriebs (Phase 6c, L3, Entwurf §8.1): technische Kabelvorlagen,
 * Betriebsstandard und Vorlage je Gerätetyp. Lesen mit `electrical.plan.read`; ändern nur mit
 * `electrical.defaults.manage`. Anlegen und Bearbeiten in Dialogen. Es gibt keine ausgelieferten
 * Vorlagen oder Standardwerte – was hier steht, hat der Betrieb selbst eingetragen.
 */
export default function VorgabenSeite() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const masse = useMasse();
  const fragen = useRueckfrage();
  const darf = usePermission(VORGABEN_RECHT);
  const vorlagen = useQuery(vorlagenAbfrage(api));
  const betrieb = useQuery(betriebsstandardAbfrage(api));
  const katalog = useQuery(katalogAbfrage(api));
  const [vorlageDialog, setVorlageDialog] = useState<{ vorlage: Kabelvorlage | null } | null>(null);
  const [standardDialog, setStandardDialog] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);

  const liste = vorlagen.data?.templates ?? [];
  const typen = useMemo(
    () => (Array.isArray(katalog.data) ? katalog.data : []).filter((t) => t.is_active && ZUORDENBAR.has(t.category)).sort((a, b) => a.sort_order - b.sort_order),
    [katalog.data],
  );
  const name = (id: string | null | undefined) => {
    const v = liste.find((x) => x.id === id);
    return v === undefined ? "keine" : `${vorlageText(v)}${v.is_active ? "" : " (deaktiviert)"}`;
  };
  const neuLaden = () => queryClient.invalidateQueries({ queryKey: vorlagenSchluessel() });

  const aktivSchalten = async (v: Kabelvorlage) => {
    setMeldung(null);
    try {
      await api.patch("/api/v1/modules/electrical/cable-templates/{template_id}", { path: { template_id: v.id }, ifMatch: v.version, body: { is_active: !v.is_active } });
      setMeldung(v.is_active ? `„${v.name}“ deaktiviert – wird neuen Leitungen nicht mehr vorgeschlagen.` : `„${v.name}“ wieder aktiv.`);
    } catch (error: unknown) {
      setMeldung(apiFehlerText(error, "Die Vorlage konnte nicht geändert werden."));
    }
    await neuLaden();
  };

  const entfernen = async (v: Kabelvorlage) => {
    const antwort = await fragen({
      titel: "Kabelvorlage entfernen?",
      text: <p>Die ungenutzte Vorlage „{v.name}“ wird entfernt.</p>,
      bestaetigenLabel: "Vorlage entfernen",
      abbrechenLabel: "Abbrechen",
      gefaehrlich: true,
    });
    if (antwort !== "bestaetigt") return;
    setMeldung(null);
    try {
      await api.delete("/api/v1/modules/electrical/cable-templates/{template_id}", { path: { template_id: v.id }, ifMatch: v.version });
      setMeldung(`„${v.name}“ entfernt.`);
    } catch (error: unknown) {
      setMeldung(apiFehlerText(error, "Die Vorlage konnte nicht entfernt werden."));
    }
    await neuLaden();
  };

  const b = betrieb.data;
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="m-0">Elektro-Vorgaben</h1>
        <p className="m-0 mt-1 text-muted">
          Technische Vorgaben des Betriebs für neue Leitungen. Planungsangaben – ElektroPlan bemisst nichts und prüft keine Norm.
          Bestehende Leitungen ändern sich durch Vorgaben nicht.
        </p>
        {!darf && (
          <p className={`${meldungsflaeche("schlicht")} mt-2`} role="status" data-testid="vorgaben-nur-lesen">
            Nur Ansicht – Vorgaben ändern dürfen Benutzer mit dem Recht „Elektro-Vorgaben verwalten“.
          </p>
        )}
      </header>
      {meldung !== null && (
        <p className={meldungsflaeche("schlicht")} role="status">
          {meldung}
        </p>
      )}

      <section className={karte()} aria-labelledby="vorlagen-titel">
        <div className={KARTENKOPF}>
          <h2 id="vorlagen-titel" className={KARTENTITEL}>
            Kabelvorlagen
          </h2>
          {darf && (
            <button type="button" className={knopf("primaer")} onClick={() => setVorlageDialog({ vorlage: null })}>
              Kabelvorlage anlegen
            </button>
          )}
        </div>
        {vorlagen.isPending ? (
          <p className="text-muted">Vorlagen werden geladen …</p>
        ) : vorlagen.isError ? (
          <p className={meldungsflaeche()} role="alert">
            Die Vorlagen konnten nicht geladen werden.
          </p>
        ) : liste.length === 0 ? (
          <p className="text-muted">Noch keine Kabelvorlage angelegt.</p>
        ) : (
          <div className={TABELLENRAHMEN}>
            <table className={TABELLE} aria-label="Kabelvorlagen">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Leitungstyp</th>
                  <th>Leiter</th>
                  <th>Querschnitt</th>
                  <th>Status</th>
                  {darf && <th>Aktionen</th>}
                </tr>
              </thead>
              <tbody>
                {liste.map((v) => (
                  <tr key={v.id} data-testid={`vorlage-${v.id}`}>
                    <td>{v.name}</td>
                    <td>{v.cable_type}</td>
                    <td>{v.conductor_count}</td>
                    <td>{querschnittAnzeigen(v.cross_section_mm2)}</td>
                    <td>
                      <span className="flex flex-wrap gap-1">
                        <Marke art={v.is_active ? "erfolg" : "neutral"}>{v.is_active ? "aktiv" : "deaktiviert"}</Marke>
                        {v.in_use && <Marke art="info">in Verwendung</Marke>}
                      </span>
                    </td>
                    {darf && (
                      <td>
                        <span className="flex flex-wrap gap-1">
                          <button type="button" className={knopf("neutral", { klein: true })} onClick={() => setVorlageDialog({ vorlage: v })}>
                            Bearbeiten
                          </button>
                          <button type="button" className={knopf("neutral", { klein: true })} onClick={() => void aktivSchalten(v)}>
                            {v.is_active ? "Deaktivieren" : "Aktivieren"}
                          </button>
                          {!v.in_use && (
                            <button type="button" className={knopf("neutral", { klein: true })} onClick={() => void entfernen(v)}>
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
        <p className="m-0 mt-2 text-small text-muted">Genutzte Vorlagen lassen sich nicht entfernen, nur deaktivieren – bestehende Leitungen bleiben nachvollziehbar.</p>
      </section>

      <section className={karte()} aria-labelledby="standard-titel">
        <div className={KARTENKOPF}>
          <h2 id="standard-titel" className={KARTENTITEL}>
            Betriebsstandard
          </h2>
          <button type="button" className={knopf(darf ? "primaer" : "neutral")} onClick={() => setStandardDialog(true)}>
            {darf ? "Betriebsstandard bearbeiten" : "Betriebsstandard ansehen"}
          </button>
        </div>
        {b === undefined ? (
          <p className="text-muted">{betrieb.isError ? "Der Betriebsstandard konnte nicht geladen werden." : "Wird geladen …"}</p>
        ) : (
          <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-small max-sm:grid-cols-1 max-sm:gap-y-0 [&_dd]:wrap-anywhere max-sm:[&_dd]:mb-1.5" data-testid="betriebsstandard">
            <dt className="text-muted">Reserve</dt>
            <dd className="m-0">{b.reserve_percent === null ? "nicht gesetzt" : prozentAnzeigen(b.reserve_percent)}</dd>
            <dt className="text-muted">Zugabe an einer Verteilung</dt>
            <dd className="m-0">{b.board_allowance_mm === null ? "nicht gesetzt" : masse.anzeigen(b.board_allowance_mm)}</dd>
            <dt className="text-muted">Zugabe an einer Abzweigdose</dt>
            <dd className="m-0">{b.junction_allowance_mm === null ? "nicht gesetzt" : masse.anzeigen(b.junction_allowance_mm)}</dd>
            <dt className="text-muted">Zugabe an einem Gerät</dt>
            <dd className="m-0">{b.device_allowance_mm === null ? "nicht gesetzt" : masse.anzeigen(b.device_allowance_mm)}</dd>
            <dt className="text-muted">Standardvorlage</dt>
            <dd className="m-0">{name(b.default_cable_template_id)}</dd>
            {typen.map((t) => (
              <div key={t.key} className="contents">
                <dt className="text-muted">Gerätetyp {t.label}</dt>
                <dd className="m-0">{name(b.device_type_templates.find((x) => x.device_type_key === t.key)?.cable_template_id)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {vorlageDialog !== null && (
        <VorlageDialog
          vorlage={vorlageDialog.vorlage}
          onClose={() => setVorlageDialog(null)}
          onGespeichert={async (v) => {
            setVorlageDialog(null);
            setMeldung(`Kabelvorlage „${v.name}“ gespeichert.`);
            await neuLaden();
          }}
        />
      )}
      {standardDialog && (
        <VorgabenDialog
          modus="betrieb"
          darfSchreiben={darf}
          sperrgrund={darf ? null : "Nur Ansicht – ändern darf, wer Elektro-Vorgaben verwalten darf."}
          onClose={() => setStandardDialog(false)}
        />
      )}
    </div>
  );
}
