import { useState } from "react";

import { useNummerierteListe } from "../../core/api/useNummerierteListe";
import { useAuth } from "../../core/auth/AuthProvider";
import { Seitennavigation } from "../../core/ui/Seitennavigation";
import { KARTENKOPF, KARTENTITEL, karte, knopf, meldungsflaeche } from "../../core/ui/stil";
import { Projekttabelle } from "./Projekttabelle";

const SEITENGROESSE = 25;

type Gruppe = "current" | "closed";

const GRUPPE: Record<Gruppe, { titel: string; leer: string; umschalten: string }> = {
  current: {
    titel: "Laufende Projekte",
    leer: "Keine laufenden Projekte. Entwürfe zählen hier mit.",
    umschalten: "Abgeschlossene & archivierte anzeigen",
  },
  closed: {
    titel: "Abgeschlossene und archivierte Projekte",
    leer: "Keine abgeschlossenen oder archivierten Projekte.",
    umschalten: "Laufende Projekte anzeigen",
  },
};

/**
 * Projekte eines Kunden auf seiner Detailseite.
 *
 * Gefiltert wird **serverseitig** über `customer_id` und die Statusgruppe
 * (`current` = Entwurf + in Bearbeitung, `closed` = abgeschlossen +
 * archiviert) - es werden nie alle Projekte des Betriebs geladen. Wird nur
 * gerendert, wenn der Benutzer Projekte lesen darf; der Server prüft das
 * unabhängig davon.
 *
 * Die Umschaltung zeigt, dass es abgeschlossene oder archivierte Projekte
 * geben kann - sie blockieren auch die Löschung des Kunden (ADR 0020).
 */
export function KundenProjekte({ kundeId }: { kundeId: string }) {
  const { api } = useAuth();
  const [gruppe, setGruppe] = useState<Gruppe>("current");
  const text = GRUPPE[gruppe];

  const liste = useNummerierteListe({
    schluessel: ["projects", "kunde", kundeId, gruppe],
    laden: (seite) =>
      api.get("/api/v1/projects", {
        query: {
          customer_id: kundeId,
          status_group: gruppe,
          sort: "updated_at",
          page: seite,
          page_size: SEITENGROESSE,
        },
      }),
  });

  return (
    <section className={karte()} aria-labelledby="kunde-projekte-titel">
      <div className={KARTENKOPF}>
        <h2 id="kunde-projekte-titel" className={KARTENTITEL}>
          Projekte dieses Kunden
        </h2>
        <button
          type="button"
          className={knopf()}
          aria-pressed={gruppe === "closed"}
          onClick={() => setGruppe(gruppe === "current" ? "closed" : "current")}
        >
          {text.umschalten}
        </button>
      </div>
      <h3 className="mt-2 mb-0 text-[1rem]">{text.titel}</h3>

      {liste.laedt && <p className="text-muted">Projekte werden geladen ...</p>}
      {liste.fehlgeschlagen && (
        <p className={meldungsflaeche()} role="alert">
          Die Projekte dieses Kunden konnten nicht geladen werden.{" "}
          <button type="button" className={knopf()} onClick={liste.erneutVersuchen}>
            Erneut versuchen
          </button>
        </p>
      )}
      {liste.geladen && (
        <Projekttabelle projekte={liste.eintraege} mitKunde={false} mitAenderung leerText={text.leer} />
      )}
      {liste.geladen && (
        <Seitennavigation
          bezeichnung="Seiten der Projekte dieses Kunden"
          seite={liste.seite}
          gesamtSeiten={liste.gesamtSeiten}
          gesamtEintraege={liste.gesamtEintraege}
          wechselt={liste.wechselt}
          onSeite={liste.zuSeite}
        />
      )}
    </section>
  );
}
