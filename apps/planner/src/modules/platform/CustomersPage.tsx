import type { CustomerOut } from "@elektroplan/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { useNummerierteListe } from "../../core/api/useNummerierteListe";
import { useAuth, usePermission } from "../../core/auth/AuthProvider";
import { AKTION } from "../../core/ui/aktionssymbole";
import { Seitennavigation } from "../../core/ui/Seitennavigation";
import { MitSymbol } from "../../core/ui/Symbol";
import { useEntprellt } from "../../core/ui/useEntprellt";
import { CustomerFormDialog } from "./CustomerFormDialog";
import type { KundenWerte } from "./CustomerFormDialog";
import { alsFormularfehler } from "../../core/api/fehler";
import { FELD, FELD_BESCHRIFTUNG, KARTENKOPF, STAPEL, TABELLE, eingabefeld, karte, knopf, meldungsflaeche } from "../../core/ui/stil";

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
  const suchbegriff = useEntprellt(suche.trim());
  const [dialogOffen, setDialogOffen] = useState(false);
  const [parameter, setParameter] = useSearchParams();

  // Schnellaktion der Startseite: "?neu=1" oeffnet den Anlagedialog einmal
  // und verschwindet danach aus der Adresse.
  useEffect(() => {
    if (parameter.get("neu") !== "1") return;
    if (darfSchreiben) setDialogOffen(true);
    const rest = new URLSearchParams(parameter);
    rest.delete("neu");
    setParameter(rest, { replace: true });
  }, [parameter, setParameter, darfSchreiben]);
  const ort = useLocation();
  const navigate = useNavigate();
  // Nach einer Löschung übergibt die Detailseite die Meldung im Verlauf; sie
  // wird einmal gezeigt und danach aus dem Verlaufseintrag genommen.
  const [erfolg, setErfolg] = useState<string | null>(() => {
    const zustand: unknown = ort.state;
    return typeof zustand === "object" && zustand !== null && "meldung" in zustand
      ? String((zustand).meldung)
      : null;
  });
  useEffect(() => {
    const zustand: unknown = ort.state;
    if (typeof zustand !== "object" || zustand === null || !("meldung" in zustand)) return;
    void navigate({ pathname: ort.pathname, search: ort.search }, { replace: true, state: null });
  }, [ort, navigate]);
  const [zuletztAngelegt, setZuletztAngelegt] = useState<string | null>(null);

  // Der Suchbegriff steht im Schluessel: Eine Aenderung beginnt wieder auf
  // Seite 1 (useNummerierteListe).
  const liste = useNummerierteListe({
    schluessel: ["customers", "liste", suchbegriff],
    laden: (seite) =>
      api.get("/api/v1/customers", {
        query: {
          sort: "name",
          page: seite,
          page_size: SEITENGROESSE,
          ...(suchbegriff ? { q: suchbegriff } : {}),
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
    <div className={STAPEL}>
      <section className={karte()}>
        <div className={KARTENKOPF}>
          <h1>Kunden</h1>
          {darfSchreiben && (
            <button
              className={knopf("primaer")}
              type="button"
              onClick={() => {
                setErfolg(null);
                setDialogOffen(true);
              }}
            >
              <MitSymbol icon={AKTION.anlegen}>Neuer Kunde</MitSymbol>
            </button>
          )}
        </div>

        {erfolg !== null && (
          <p className={meldungsflaeche("erfolg")} role="status">
            {erfolg}
          </p>
        )}

        <div className={FELD}>
          <label className={FELD_BESCHRIFTUNG} htmlFor="kundensuche">
            Suche (Name, Kundennummer, Ort)
          </label>
          <input
            id="kundensuche"
            className={eingabefeld()}
            type="search"
            value={suche}
            placeholder="z. B. Schmidt"
            onChange={(event) => {
              setSuche(event.target.value);
              setErfolg(null);
            }}
          />
        </div>

        {liste.laedt && <p className="text-muted">Kunden werden geladen ...</p>}
        {liste.fehlgeschlagen && (
          <p className={meldungsflaeche()} role="alert">
            Die Kundenliste konnte nicht geladen werden.{" "}
            <button
              className={knopf()}
              type="button"
              onClick={liste.erneutVersuchen}
            >
              Erneut versuchen
            </button>
          </p>
        )}
        {liste.geladen && <Kundentabelle kunden={kunden} hervorgehoben={zuletztAngelegt} />}
        {liste.geladen && (
          <Seitennavigation
            bezeichnung="Seiten der Kundenliste"
            seite={liste.seite}
            gesamtSeiten={liste.gesamtSeiten}
            gesamtEintraege={liste.gesamtEintraege}
            wechselt={liste.wechselt}
            onSeite={liste.zuSeite}
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
    return <p className="text-muted">Keine Kunden gefunden.</p>;
  }
  return (
    <table className={TABELLE}>
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
          <tr key={kunde.id} className={kunde.id === hervorgehoben ? "*:bg-selected-soft" : ""}>
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
