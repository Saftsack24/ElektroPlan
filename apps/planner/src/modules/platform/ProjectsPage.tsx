import type { CustomerOut } from "@elektroplan/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { alsFormularfehler } from "../../core/api/fehler";
import { useNummerierteListe } from "../../core/api/useNummerierteListe";
import { useAuth, usePermission } from "../../core/auth/AuthProvider";
import { Seitennavigation } from "../../core/ui/Seitennavigation";
import { useEntprellt } from "../../core/ui/useEntprellt";
import { FELD, FELD_BESCHRIFTUNG, FILTERZEILE, KARTENKOPF, STAPEL, eingabefeld, karte, knopf, meldungsflaeche } from "../../core/ui/stil";
import { KundenAuswahl } from "./KundenAuswahl";
import { kundenSuchen } from "./kundensuche";
import { ProjectFormDialog } from "./ProjectFormDialog";
import type { ProjektWerte } from "./ProjectFormDialog";
import { Projekttabelle } from "./Projekttabelle";
import { START_EBENE, START_HOEHE_MM, startstrukturAnlegen } from "./startstruktur";
import { STATUS_LABEL } from "./status";
import type { ProjectStatus } from "./status";

const SEITENGROESSE = 25;

const PROJEKTFELDER = [
  "customer_id",
  "name",
  "site_street",
  "site_postal_code",
  "site_city",
  "site_country_code",
] as const;

export default function ProjectsPage() {
  const { api } = useAuth();
  const darfSchreiben = usePermission("project.record.write");
  const darfKundenLesen = usePermission("customer.record.read");
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [suche, setSuche] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "">("");
  const [kunde, setKunde] = useState<CustomerOut | null>(null);
  const [dialogOffen, setDialogOffen] = useState(false);
  const [parameter, setParameter] = useSearchParams();
  const suchbegriff = useEntprellt(suche.trim());

  // Schnellaktion der Startseite: "?neu=1" oeffnet den Anlagedialog einmal
  // und verschwindet danach aus der Adresse.
  useEffect(() => {
    if (parameter.get("neu") !== "1") return;
    if (darfSchreiben) setDialogOffen(true);
    const rest = new URLSearchParams(parameter);
    rest.delete("neu");
    setParameter(rest, { replace: true });
  }, [parameter, setParameter, darfSchreiben]);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [hinweisVollstaendig, setHinweisVollstaendig] = useState(true);

  // Suche, Status und Kunde stehen im Schluessel: Jede Aenderung beginnt
  // wieder auf Seite 1 (useNummerierteListe).
  const liste = useNummerierteListe({
    schluessel: ["projects", "liste", suchbegriff, status, kunde?.id ?? null],
    laden: (seite) =>
      api.get("/api/v1/projects", {
        query: {
          page: seite,
          page_size: SEITENGROESSE,
          ...(suchbegriff ? { q: suchbegriff } : {}),
          ...(status ? { status } : {}),
          ...(kunde !== null ? { customer_id: kunde.id } : {}),
        },
      }),
  });

  /**
   * Projekt anlegen und - falls gewuenscht - die Startstruktur nachziehen.
   *
   * Bewusst als **Folgeablauf** und nicht atomar: Eine atomare Anlage haette
   * einen neuen, geschachtelten Endpunkt gebraucht. Das waere eine
   * API-Aenderung fuer eine reine Bedienerleichterung - siehe docs/api.md,
   * Abschnitt "Startstruktur bei der Projektanlage".
   *
   * Ein Teilfehler bleibt nicht unbemerkt: Das Projekt ist dann angelegt, die
   * Meldung benennt genau, was fehlt, und die Oberflaeche **bleibt auf der
   * Liste** stehen. Wuerde sie ins Projekt springen, verschwaende die Warnung
   * mit dem Seitenwechsel.
   */
  const anlegen = async (werte: ProjektWerte) => {
    let projektId: string;
    let projektnummer: string;
    try {
      const projekt = await api.post("/api/v1/projects", {
        body: {
          customer_id: werte.customer_id,
          name: werte.name.trim(),
          site_country_code: werte.site_country_code,
          ...(werte.site_street.trim() ? { site_street: werte.site_street.trim() } : {}),
          ...(werte.site_postal_code.trim()
            ? { site_postal_code: werte.site_postal_code.trim() }
            : {}),
          ...(werte.site_city.trim() ? { site_city: werte.site_city.trim() } : {}),
        },
      });
      projektId = projekt.id;
      projektnummer = projekt.project_number;
    } catch (error) {
      return alsFormularfehler(error, PROJEKTFELDER);
    }

    let meldung = `Projekt ${projektnummer} wurde angelegt.`;
    let vollstaendig = true;
    if (werte.startstruktur) {
      const struktur = await startstrukturAnlegen({
        gebaeudename: werte.gebaeudename.trim(),
        geschossname: werte.geschossname.trim(),
        gebaeudeAnlegen: () =>
          api.post("/api/v1/projects/{project_id}/buildings", {
            path: { project_id: projektId },
            body: { name: werte.gebaeudename.trim(), sort_order: 0 },
          }),
        geschossAnlegen: (gebaeudeId) =>
          api.post("/api/v1/buildings/{building_id}/floors", {
            path: { building_id: gebaeudeId },
            body: {
              name: werte.geschossname.trim(),
              level: START_EBENE,
              elevation_mm: 0,
              default_ceiling_height_mm: START_HOEHE_MM,
            },
          }),
      });
      meldung += ` ${struktur.meldung}`;
      vollstaendig = struktur.vollstaendig;
    }

    setDialogOffen(false);
    setHinweis(meldung);
    setHinweisVollstaendig(vollstaendig);
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
    // Nur bei vollstaendigem Erfolg ins Projekt springen. Blieb etwas offen,
    // wuerde die Warnung beim Seitenwechsel verschwinden - der Teilfehler
    // waere damit unbemerkt, genau das soll er nicht sein.
    if (vollstaendig) {
      void navigate(`/projects/${projektId}`);
    }
    return undefined;
  };

  const gefiltert = suchbegriff !== "" || status !== "" || kunde !== null;

  return (
    <div className={STAPEL}>
      <section className={karte()}>
        <div className={KARTENKOPF}>
          <h1>Projekte</h1>
          {darfSchreiben && darfKundenLesen && (
            <button
              className={knopf("primaer")}
              type="button"
              onClick={() => {
                setHinweis(null);
                setDialogOffen(true);
              }}
            >
              Neues Projekt
            </button>
          )}
        </div>

        {hinweis !== null && (
          <p className={meldungsflaeche(hinweisVollstaendig ? "erfolg" : "fehler")} role="status">
            {hinweis}
          </p>
        )}

        <div className={FILTERZEILE}>
          <div className={FELD}>
            <label className={FELD_BESCHRIFTUNG} htmlFor="projektsuche">
              Suche (Bezeichnung, Projektnummer, Baustellenort)
            </label>
            <input
              id="projektsuche"
              className={eingabefeld()}
              type="search"
              value={suche}
              placeholder="z. B. Neubau"
              onChange={(event) => {
                setSuche(event.target.value);
                setHinweis(null);
              }}
            />
          </div>
          {darfKundenLesen && (
            <KundenAuswahl
              id="projektfilter-kunde"
              label="Kunde"
              zweck="filter"
              gewaehlt={kunde}
              entfernenLabel="Kundenfilter entfernen"
              suchen={(begriff) => kundenSuchen(api, begriff, { nurZuordenbar: false })}
              onChange={(gewaehlt) => {
                setKunde(gewaehlt);
                setHinweis(null);
              }}
            />
          )}
          <div className={FELD}>
            <label className={FELD_BESCHRIFTUNG} htmlFor="projektstatus">
              Status
            </label>
            <select
              id="projektstatus"
              className={eingabefeld()}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as ProjectStatus | "");
                setHinweis(null);
              }}
            >
              <option value="">Alle</option>
              {Object.entries(STATUS_LABEL).map(([wert, label]) => (
                <option key={wert} value={wert}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {liste.laedt && <p className="text-muted">Projekte werden geladen ...</p>}
        {liste.fehlgeschlagen && (
          <p className={meldungsflaeche()} role="alert">
            Die Projektliste konnte nicht geladen werden.{" "}
            <button
              className={knopf()}
              type="button"
              onClick={liste.erneutVersuchen}
            >
              Erneut versuchen
            </button>
          </p>
        )}
        {liste.geladen && (
          <Projekttabelle
            projekte={liste.eintraege}
            leerText={gefiltert ? "Keine Projekte zu diesen Filtern gefunden." : "Noch keine Projekte angelegt."}
          />
        )}
        {liste.geladen && (
          <Seitennavigation
            bezeichnung="Seiten der Projektliste"
            seite={liste.seite}
            gesamtSeiten={liste.gesamtSeiten}
            gesamtEintraege={liste.gesamtEintraege}
            wechselt={liste.wechselt}
            onSeite={liste.zuSeite}
          />
        )}
      </section>

      {darfSchreiben && (
        <ProjectFormDialog
          offen={dialogOffen}
          suchen={(begriff) => kundenSuchen(api, begriff, { nurZuordenbar: true })}
          onSubmit={anlegen}
          onClose={() => setDialogOffen(false)}
        />
      )}
    </div>
  );
}
