import type { CustomerOut } from "@elektroplan/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { useCursorListe } from "../../core/api/useCursorListe";
import { useAuth, usePermission } from "../../core/auth/AuthProvider";
import { WeitereLaden } from "../../core/ui/WeitereLaden";
import { CustomerFormDialog } from "./CustomerFormDialog";
import type { KundenWerte } from "./CustomerFormDialog";
import { alsFormularfehler } from "./fehler";

const SEITENGROESSE = 25;

const KUNDENFELDER = [
  "kind",
  "name",
  "contact_person",
  "email",
  "phone",
  "billing_street",
  "billing_postal_code",
  "billing_city",
] as const;

/** Leere Textfelder werden nicht als "" gesendet, sondern weggelassen. */
function nurGefuellt(werte: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(werte).filter(([, wert]) => wert.trim().length > 0));
}

export default function CustomersPage() {
  const { api } = useAuth();
  const darfSchreiben = usePermission("customer.record.write");
  const queryClient = useQueryClient();

  const [suche, setSuche] = useState("");
  const [dialogOffen, setDialogOffen] = useState(false);
  const [erfolg, setErfolg] = useState<string | null>(null);
  const [zuletztAngelegt, setZuletztAngelegt] = useState<string | null>(null);

  // Der Suchbegriff steht im Query-Key: Eine Aenderung erzeugt eine neue
  // Abfrage, und der Cursor beginnt damit zwangslaeufig von vorn.
  const liste = useCursorListe({
    schluessel: ["customers", "liste", suche],
    laden: (cursor) =>
      api.get("/api/v1/customers", {
        query: {
          sort: "name",
          limit: SEITENGROESSE,
          ...(suche ? { q: suche } : {}),
          ...(cursor ? { cursor } : {}),
        },
      }),
  });

  const kunden = liste.eintraege;

  const anlegen = async (werte: KundenWerte) => {
    const { kind, name, ...rest } = werte;
    try {
      const neu = await api.post("/api/v1/customers", {
        body: { kind, name: name.trim(), billing_country_code: "DE", ...nurGefuellt(rest) },
      });
      setDialogOffen(false);
      setZuletztAngelegt(neu.id);
      setErfolg(`Kunde ${neu.customer_number} — ${neu.name} wurde angelegt.`);
      // Auch die Auswahl auf der Projektseite soll den neuen Kunden kennen.
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      return undefined;
    } catch (error) {
      return alsFormularfehler(error, KUNDENFELDER);
    }
  };

  return (
    <div className="stack">
      <section className="card">
        <div className="card__header">
          <h1>Kunden</h1>
          {darfSchreiben && (
            <button
              className="button button--primary"
              type="button"
              onClick={() => {
                setErfolg(null);
                setDialogOffen(true);
              }}
            >
              Neuer Kunde
            </button>
          )}
        </div>

        {erfolg !== null && (
          <p className="alert alert--erfolg" role="status">
            {erfolg}
          </p>
        )}

        <div className="field">
          <label className="field__label" htmlFor="kundensuche">
            Suche (Name, Kundennummer, Ort)
          </label>
          <input
            id="kundensuche"
            className="field__input"
            value={suche}
            placeholder="z. B. Schmidt"
            onChange={(event) => {
              setSuche(event.target.value);
              setErfolg(null);
            }}
          />
        </div>

        {liste.laedt && <p className="muted">Kunden werden geladen ...</p>}
        {liste.fehlgeschlagen && (
          <p className="alert alert--error" role="alert">
            Die Kundenliste konnte nicht geladen werden.{" "}
            <button
              className="button button--ghost"
              type="button"
              onClick={liste.erneutVersuchen}
            >
              Erneut versuchen
            </button>
          </p>
        )}
        {liste.geladen && <Kundentabelle kunden={kunden} hervorgehoben={zuletztAngelegt} />}
        {liste.geladen && (
          <WeitereLaden
            sichtbar={liste.hatWeitere}
            laedt={liste.laedtWeitere}
            anzahl={kunden.length}
            onLaden={liste.weitereLaden}
          />
        )}
      </section>

      {darfSchreiben && (
        <CustomerFormDialog
          offen={dialogOffen}
          titel="Neuer Kunde"
          absendenLabel="Kunden anlegen"
          onSubmit={anlegen}
          onClose={() => setDialogOffen(false)}
        />
      )}
    </div>
  );
}

function Kundentabelle({
  kunden,
  hervorgehoben,
}: {
  kunden: CustomerOut[];
  hervorgehoben: string | null;
}) {
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
          <tr key={kunde.id} className={kunde.id === hervorgehoben ? "table__zeile--neu" : ""}>
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
