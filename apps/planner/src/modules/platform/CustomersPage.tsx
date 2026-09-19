import { ApiError } from "@elektroplan/api-client";
import type { CustomerOut } from "@elektroplan/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { useAuth, usePermission } from "../../core/auth/AuthProvider";

type Kind = "private" | "company";

const LEERES_FORMULAR = {
  name: "",
  kind: "private" as Kind,
  contact_person: "",
  email: "",
  phone: "",
  billing_street: "",
  billing_postal_code: "",
  billing_city: "",
};

/** Leere Textfelder werden nicht als "" gesendet, sondern weggelassen. */
function nurGefuellt(werte: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(werte).filter(([, wert]) => wert.trim().length > 0),
  );
}

export default function CustomersPage() {
  const { api } = useAuth();
  const darfSchreiben = usePermission("customer.record.write");
  const queryClient = useQueryClient();

  const [suche, setSuche] = useState("");
  const [formular, setFormular] = useState(LEERES_FORMULAR);
  const [fehler, setFehler] = useState<string | null>(null);

  const liste = useQuery({
    queryKey: ["customers", suche],
    queryFn: () =>
      api.get("/api/v1/customers", {
        query: { sort: "name", limit: 50, ...(suche ? { q: suche } : {}) },
      }),
  });

  const anlegen = useMutation({
    mutationFn: (eingabe: typeof LEERES_FORMULAR) => {
      const { kind, name, ...rest } = eingabe;
      return api.post("/api/v1/customers", {
        // ``billing_country_code`` hat serverseitig einen Standardwert, steht im
        // erzeugten Schema aber als Pflichtfeld - deshalb hier ausgeschrieben.
        body: { kind, name: name.trim(), billing_country_code: "DE", ...nurGefuellt(rest) },
      });
    },
    onSuccess: async () => {
      setFormular(LEERES_FORMULAR);
      setFehler(null);
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (error: unknown) => {
      setFehler(error instanceof ApiError ? error.userMessage : "Anlegen fehlgeschlagen.");
    },
  });

  return (
    <div className="stack">
      <section className="card">
        <h1>Kunden</h1>
        <div className="field">
          <label className="field__label" htmlFor="kundensuche">
            Suche (Name, Kundennummer, Ort)
          </label>
          <input
            id="kundensuche"
            className="field__input"
            value={suche}
            onChange={(event) => setSuche(event.target.value)}
            placeholder="z. B. Schmidt"
          />
        </div>

        {liste.isPending && <p className="muted">Kunden werden geladen ...</p>}
        {liste.isError && (
          <p className="alert alert--error">Die Kundenliste konnte nicht geladen werden.</p>
        )}
        {liste.data && <Kundentabelle kunden={liste.data.items} />}
        {liste.data?.has_more && (
          <p className="muted">
            Es gibt weitere Kunden. Bitte die Suche eingrenzen — die vollständige
            Blätterfunktion folgt mit der Listenansicht in einer späteren Phase.
          </p>
        )}
      </section>

      {darfSchreiben && (
        <section className="card">
          <h2>Neuen Kunden anlegen</h2>
          <p className="muted">
            Die Kundennummer vergibt das System. Nur synthetische Testdaten verwenden —
            echte Kundendaten erst nach Abschluss der DSGVO-Voraussetzungen.
          </p>
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              anlegen.mutate(formular);
            }}
          >
            <Feld
              id="kunde-name"
              label="Name"
              value={formular.name}
              required
              onChange={(name) => setFormular({ ...formular, name })}
            />
            <div className="field">
              <label className="field__label" htmlFor="kunde-kind">
                Art
              </label>
              <select
                id="kunde-kind"
                className="field__input"
                value={formular.kind}
                onChange={(event) =>
                  setFormular({ ...formular, kind: event.target.value as Kind })
                }
              >
                <option value="private">Privatkunde</option>
                <option value="company">Firmenkunde</option>
              </select>
            </div>
            <Feld
              id="kunde-contact"
              label="Ansprechpartner"
              value={formular.contact_person}
              onChange={(contact_person) => setFormular({ ...formular, contact_person })}
            />
            <Feld
              id="kunde-email"
              label="E-Mail"
              type="email"
              value={formular.email}
              onChange={(email) => setFormular({ ...formular, email })}
            />
            <Feld
              id="kunde-phone"
              label="Telefon"
              value={formular.phone}
              onChange={(phone) => setFormular({ ...formular, phone })}
            />
            <Feld
              id="kunde-street"
              label="Straße"
              value={formular.billing_street}
              onChange={(billing_street) => setFormular({ ...formular, billing_street })}
            />
            <Feld
              id="kunde-plz"
              label="PLZ"
              value={formular.billing_postal_code}
              onChange={(billing_postal_code) =>
                setFormular({ ...formular, billing_postal_code })
              }
            />
            <Feld
              id="kunde-ort"
              label="Ort"
              value={formular.billing_city}
              onChange={(billing_city) => setFormular({ ...formular, billing_city })}
            />
            <div className="form-grid__actions">
              {fehler && <p className="alert alert--error">{fehler}</p>}
              <button
                className="button button--primary"
                type="submit"
                disabled={anlegen.isPending || formular.name.trim().length === 0}
              >
                {anlegen.isPending ? "Wird angelegt ..." : "Kunden anlegen"}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

function Kundentabelle({ kunden }: { kunden: CustomerOut[] }) {
  if (kunden.length === 0) {
    return <p className="muted">Keine Kunden gefunden.</p>;
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Nummer</th>
          <th>Name</th>
          <th>Art</th>
          <th>Ort</th>
        </tr>
      </thead>
      <tbody>
        {kunden.map((kunde) => (
          <tr key={kunde.id}>
            <td>
              <code>{kunde.customer_number}</code>
            </td>
            <td>
              <Link to={`/customers/${kunde.id}`}>{kunde.name}</Link>
            </td>
            <td>{kunde.kind === "company" ? "Firma" : "Privat"}</td>
            <td>{kunde.billing_city ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Feld({
  id,
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {required ? " *" : ""}
      </label>
      <input
        id={id}
        className="field__input"
        type={type}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
