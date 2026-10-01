import { ApiError } from "@elektroplan/api-client";
import type { CustomerOut } from "@elektroplan/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAuth, usePermission } from "../../core/auth/AuthProvider";
import { AKTION } from "../../core/ui/aktionssymbole";
import { Feld } from "../../core/ui/Feld";
import { MitSymbol } from "../../core/ui/Symbol";
import { FORMULARRASTER, FORMULARRASTER_AKTIONEN, STAPEL, karte, knopf, meldungsflaeche } from "../../core/ui/stil";
import { Bearbeitungsinfo } from "./Bearbeitungsinfo";
import { KundeLoeschenDialog } from "./KundeLoeschenDialog";
import { KundenProjekte } from "./KundenProjekte";

type Bearbeitbar = {
  name: string;
  contact_person: string;
  email: string;
  phone: string;
  billing_street: string;
  billing_postal_code: string;
  billing_city: string;
};

function ausKunde(kunde: CustomerOut): Bearbeitbar {
  return {
    name: kunde.name,
    contact_person: kunde.contact_person ?? "",
    email: kunde.email ?? "",
    phone: kunde.phone ?? "",
    billing_street: kunde.billing_street ?? "",
    billing_postal_code: kunde.billing_postal_code ?? "",
    billing_city: kunde.billing_city ?? "",
  };
}

/** Leere Felder werden als `null` gesendet - so lassen sie sich auch leeren. */
function alsAenderung(werte: Bearbeitbar): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(werte).map(([schluessel, wert]) => [
      schluessel,
      wert.trim().length > 0 ? wert.trim() : null,
    ]),
  );
}

export default function CustomerDetailPage() {
  const { customerId = "" } = useParams();
  const { api } = useAuth();
  const darfSchreiben = usePermission("customer.record.write");
  // Nur Administratoren (ADR 0020). Der Server prüft unabhängig davon.
  const darfLoeschen = usePermission("customer.record.delete");
  const darfProjekteLesen = usePermission("project.record.read");
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [entwurf, setEntwurf] = useState<Bearbeitbar | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [loeschenOffen, setLoeschenOffen] = useState(false);
  // Nach der Löschung nichts mehr nachladen: Der Datensatz existiert nicht mehr.
  const [geloescht, setGeloescht] = useState(false);

  const kunde = useQuery({
    queryKey: ["customer", customerId],
    queryFn: () => api.get("/api/v1/customers/{customer_id}", { path: { customer_id: customerId } }),
    enabled: !geloescht,
  });

  const aktualisieren = async () => {
    await queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
    await queryClient.invalidateQueries({ queryKey: ["customers"] });
  };

  const speichern = useMutation({
    mutationFn: (werte: Bearbeitbar) =>
      api.patch("/api/v1/customers/{customer_id}", {
        path: { customer_id: customerId },
        body: alsAenderung(werte),
        ifMatch: kunde.data?.version ?? 0,
      }),
    onSuccess: async () => {
      setEntwurf(null);
      setFehler(null);
      setMeldung("Gespeichert.");
      await aktualisieren();
    },
    onError: (error: unknown) => {
      setFehler(error instanceof ApiError ? error.userMessage : "Speichern fehlgeschlagen.");
      setMeldung(null);
    },
  });

  if (kunde.isPending) return <p className="text-muted">Kunde wird geladen ...</p>;
  if (kunde.isError || !kunde.data) {
    return <p className={meldungsflaeche()}>Dieser Kunde ist nicht verfügbar.</p>;
  }

  const daten = kunde.data;
  const werte = entwurf ?? ausKunde(daten);
  const gesperrt = !darfSchreiben;

  return (
    <div className={STAPEL}>
      <section className={karte()}>
        <p className="text-muted">
          <Link to="/customers">
            <MitSymbol icon={AKTION.zurueck}>Alle Kunden</MitSymbol>
          </Link>
        </p>
        <h1>{daten.name}</h1>
        <p className="text-muted">
          Kundennummer <code>{daten.customer_number}</code> · Version {daten.version}
        </p>
        <Bearbeitungsinfo
          erstelltVon={daten.created_by}
          erstelltAm={daten.created_at}
          geaendertVon={daten.updated_by}
          geaendertAm={daten.updated_at}
        />
        {meldung && <p className="text-muted">{meldung}</p>}
        {fehler && <p className={meldungsflaeche()}>{fehler}</p>}
      </section>

      <section className={karte()}>
        <h2>Stammdaten</h2>
        <form
          className={FORMULARRASTER}
          onSubmit={(event) => {
            event.preventDefault();
            speichern.mutate(werte);
          }}
        >
          <Feld
            id="detail-name"
            label="Name"
            value={werte.name}
            required
            onChange={(name) => setEntwurf({ ...werte, name })}
          />
          <Feld
            id="detail-contact"
            label="Ansprechpartner"
            value={werte.contact_person}
            onChange={(contact_person) => setEntwurf({ ...werte, contact_person })}
          />
          <Feld
            id="detail-email"
            label="E-Mail"
            type="email"
            value={werte.email}
            onChange={(email) => setEntwurf({ ...werte, email })}
          />
          <Feld
            id="detail-phone"
            label="Telefon"
            value={werte.phone}
            onChange={(phone) => setEntwurf({ ...werte, phone })}
          />
          <Feld
            id="detail-street"
            label="Straße"
            value={werte.billing_street}
            onChange={(billing_street) => setEntwurf({ ...werte, billing_street })}
          />
          <Feld
            id="detail-plz"
            label="PLZ"
            value={werte.billing_postal_code}
            onChange={(billing_postal_code) => setEntwurf({ ...werte, billing_postal_code })}
          />
          <Feld
            id="detail-ort"
            label="Ort"
            value={werte.billing_city}
            onChange={(billing_city) => setEntwurf({ ...werte, billing_city })}
          />
          <div className={FORMULARRASTER_AKTIONEN}>
            <button
              className={knopf("primaer")}
              type="submit"
              disabled={gesperrt || speichern.isPending || entwurf === null}
            >
              <MitSymbol icon={AKTION.speichern}>
                {speichern.isPending ? "Wird gespeichert ..." : "Speichern"}
              </MitSymbol>
            </button>
          </div>
        </form>
      </section>

      {darfProjekteLesen && <KundenProjekte kundeId={daten.id} />}

      {darfLoeschen && (
        <section className={karte()} aria-labelledby="kunde-loeschen-titel">
          <h2 id="kunde-loeschen-titel">Kunden löschen</h2>
          <p className="text-muted">
            Ein Kunde lässt sich nur endgültig löschen, wenn ihm <strong>kein Projekt</strong>{" "}
            zugeordnet ist - auch kein abgeschlossenes oder archiviertes. Die Löschung ist nicht
            umkehrbar; die Kundennummer wird nicht erneut vergeben.
          </p>
          <div className="mt-3">
            <button type="button" className={knopf("gefahr")} onClick={() => setLoeschenOffen(true)}>
              <MitSymbol icon={AKTION.loeschen}>Kunden löschen</MitSymbol>
            </button>
          </div>
        </section>
      )}

      {darfLoeschen && (
        <KundeLoeschenDialog
          offen={loeschenOffen}
          kunde={daten}
          onAbbrechen={() => setLoeschenOffen(false)}
          onGeloescht={async () => {
            setLoeschenOffen(false);
            setGeloescht(true);
            await navigate("/customers", {
              replace: true,
              state: { meldung: `Kunde ${daten.customer_number} wurde endgültig gelöscht.` },
            });
            queryClient.removeQueries({ queryKey: ["customer", customerId] });
            await queryClient.invalidateQueries({ queryKey: ["customers"] });
          }}
        />
      )}
    </div>
  );
}
