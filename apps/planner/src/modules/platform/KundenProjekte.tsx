import { useState } from "react";

import { useNummerierteListe } from "../../core/api/useNummerierteListe";
import { useAuth } from "../../core/auth/AuthProvider";
import { Seitennavigation } from "../../core/ui/Seitennavigation";
import { Projekttabelle } from "./Projekttabelle";

const SEITENGROESSE = 25;

type Gruppe = "current" | "closed";

const GRUPPE: Record<Gruppe, { titel: string; leer: string; umschalten: string }> = {
  current: {
    titel: "Laufende Projekte",
    leer: "Keine laufenden Projekte. Entwürfe zählen hier mit.",
    umschalten: "Abgeschlossene und archivierte anzeigen",
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
 * Auch ein anonymisierter Kunde zeigt hier seine bestehenden Projekte - die
 * Belegzuordnung bleibt ausdrücklich erhalten.
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
    <section className="card" aria-labelledby="kunde-projekte-titel">
      <div className="card__header">
        <h2 id="kunde-projekte-titel">Projekte dieses Kunden</h2>
        <button
          type="button"
          className="button button--ghost"
          aria-pressed={gruppe === "closed"}
          onClick={() => setGruppe(gruppe === "current" ? "closed" : "current")}
        >
          {text.umschalten}
        </button>
      </div>
      <h3 className="kunde-projekte__gruppe">{text.titel}</h3>

      {liste.laedt && <p className="muted">Projekte werden geladen ...</p>}
      {liste.fehlgeschlagen && (
        <p className="alert alert--error" role="alert">
          Die Projekte dieses Kunden konnten nicht geladen werden.{" "}
          <button type="button" className="button button--ghost" onClick={liste.erneutVersuchen}>
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
