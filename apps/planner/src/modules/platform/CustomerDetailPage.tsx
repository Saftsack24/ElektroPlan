import { ApiError } from "@elektroplan/api-client";
import type { CustomerOut } from "@elektroplan/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAuth, usePermission } from "../../core/auth/AuthProvider";
import { Feld } from "./CustomersPage";

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
  const darfLoeschen = usePermission("customer.record.delete");
  const darfAnonymisieren = usePermission("customer.record.anonymize");
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [entwurf, setEntwurf] = useState<Bearbeitbar | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  const kunde = useQuery({
    queryKey: ["customer", customerId],
    queryFn: () => api.get("/api/v1/customers/{customer_id}", { path: { customer_id: customerId } }),
  });

  const aktualisieren = async () => {
    await queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
    await queryClient.invalidateQueries({ queryKey: ["customers"] });
  };

  const melden = (error: unknown, standard: string) => {
    setFehler(error instanceof ApiError ? error.userMessage : standard);
    setMeldung(null);
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
    onError: (error: unknown) => melden(error, "Speichern fehlgeschlagen."),
  });

  const ausblenden = useMutation({
    mutationFn: () =>
      api.delete("/api/v1/customers/{customer_id}", {
        path: { customer_id: customerId },
        ifMatch: kunde.data?.version ?? 0,
      }),
    onSuccess: async () => {
      await aktualisieren();
      void navigate("/customers");
    },
    onError: (error: unknown) => melden(error, "Ausblenden fehlgeschlagen."),
  });

  const anonymisieren = useMutation({
    mutationFn: () =>
      api.post("/api/v1/customers/{customer_id}/anonymize", {
        path: { customer_id: customerId },
        ifMatch: kunde.data?.version ?? 0,
      }),
    onSuccess: async () => {
      setEntwurf(null);
      setFehler(null);
      setMeldung("Der Kunde wurde anonymisiert.");
      await aktualisieren();
    },
    onError: (error: unknown) => melden(error, "Anonymisieren fehlgeschlagen."),
  });

  if (kunde.isPending) return <p className="muted">Kunde wird geladen ...</p>;
  if (kunde.isError || !kunde.data) {
    return <p className="alert alert--error">Dieser Kunde ist nicht verfügbar.</p>;
  }

  const werte = entwurf ?? ausKunde(kunde.data);
  const gesperrt = !darfSchreiben || kunde.data.anonymized_at !== null;

  return (
    <div className="stack">
      <section className="card">
        <p className="muted">
          <Link to="/customers">← Alle Kunden</Link>
        </p>
        <h1>{kunde.data.name}</h1>
        <p className="muted">
          Kundennummer <code>{kunde.data.customer_number}</code> · Version{" "}
          {kunde.data.version}
        </p>
        {kunde.data.anonymized_at !== null && (
          <p className="alert alert--error">
            Dieser Kunde wurde anonymisiert. Die personenbezogenen Daten sind entfernt;
            der Datensatz bleibt als Belegzuordnung bestehen und lässt sich nicht mehr
            bearbeiten.
          </p>
        )}
        {meldung && <p className="muted">{meldung}</p>}
        {fehler && <p className="alert alert--error">{fehler}</p>}
      </section>

      <section className="card">
        <h2>Stammdaten</h2>
        <form
          className="form-grid"
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
          <div className="form-grid__actions">
            <button
              className="button button--primary"
              type="submit"
              disabled={gesperrt || speichern.isPending || entwurf === null}
            >
              {speichern.isPending ? "Wird gespeichert ..." : "Speichern"}
            </button>
          </div>
        </form>
      </section>

      {(darfLoeschen || darfAnonymisieren) && (
        <section className="card">
          <h2>Datenschutz und Löschung</h2>
          <p className="muted">
            <strong>Ausblenden</strong> entfernt den Kunden aus Listen; bestehende Belege
            bleiben zuordenbar. <strong>Anonymisieren</strong> setzt ein Löschbegehren nach
            Art. 17 DSGVO um: Die personenbezogenen Felder werden überschrieben, die
            Kundennummer bleibt. Das ist <strong>nicht umkehrbar</strong>.
          </p>
          <div className="button-row">
            {darfLoeschen && (
              <button
                className="button button--ghost"
                type="button"
                disabled={ausblenden.isPending}
                onClick={() => ausblenden.mutate()}
              >
                Kunden ausblenden
              </button>
            )}
            {darfAnonymisieren && kunde.data.anonymized_at === null && (
              <button
                className="button button--ghost"
                type="button"
                disabled={anonymisieren.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      "Die personenbezogenen Daten dieses Kunden werden unwiderruflich " +
                        "überschrieben. Fortfahren?",
                    )
                  ) {
                    anonymisieren.mutate();
                  }
                }}
              >
                Unwiderruflich anonymisieren
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
