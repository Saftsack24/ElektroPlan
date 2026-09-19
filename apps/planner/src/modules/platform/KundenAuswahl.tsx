import type { CustomerOut } from "@elektroplan/api-client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useEntprellt } from "../../core/ui/useEntprellt";

/** Was die Suche zurückliefert. `weitere` meldet abgeschnittene Treffer. */
export interface Suchergebnis {
  treffer: CustomerOut[];
  weitere: boolean;
}

/**
 * Kundenauswahl für die Projektanlage — mit **serverseitiger Suche**.
 *
 * Vorher lud das Formular pauschal die ersten 200 Kunden und zeigte sie in
 * einem Auswahlfeld. Ab dem 201. Kunden wäre der gesuchte schlicht nicht
 * dabei gewesen, ohne dass irgendetwas darauf hingewiesen hätte. Jetzt fragt
 * die Oberfläche den Server, lädt nur die Treffer und sagt ausdrücklich,
 * wenn es mehr gibt als angezeigt.
 *
 * Der gewählte Kunde bleibt stehen, auch wenn der Suchbegriff sich ändert
 * und er nicht mehr unter den Treffern wäre — die Auswahl gehört dem
 * Benutzer, nicht der Trefferliste.
 *
 * Die Komponente kennt keine API: `suchen` wird übergeben und ist damit ohne
 * Netzwerk prüfbar.
 */
export function KundenAuswahl({
  gewaehlt,
  onChange,
  suchen,
  fehler,
  disabled = false,
  trefferProSeite = 20,
}: {
  gewaehlt: CustomerOut | null;
  onChange: (kunde: CustomerOut | null) => void;
  suchen: (begriff: string) => Promise<Suchergebnis>;
  fehler?: string | undefined;
  disabled?: boolean;
  trefferProSeite?: number;
}) {
  const [begriff, setBegriff] = useState("");
  const entprellt = useEntprellt(begriff);

  const treffer = useQuery({
    queryKey: ["customers", "suche", entprellt],
    queryFn: () => suchen(entprellt),
    // Solange jemand ausgewählt hat, wird nicht weiter gesucht.
    enabled: gewaehlt === null && !disabled,
  });

  if (gewaehlt !== null) {
    return (
      <div className="field">
        <span className="field__label">Kunde *</span>
        <p className="auswahl__gewaehlt">
          <code>{gewaehlt.customer_number}</code> {gewaehlt.name}
        </p>
        <button
          type="button"
          className="button button--ghost"
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          Anderen Kunden wählen
        </button>
      </div>
    );
  }

  const fehlerId = "projekt-kunde-fehler";
  return (
    <div className="field">
      <label className="field__label" htmlFor="projekt-kunde">
        Kunde *
      </label>
      <input
        id="projekt-kunde"
        className={fehler ? "field__input field__input--fehler" : "field__input"}
        type="search"
        value={begriff}
        disabled={disabled}
        placeholder="Name, Kundennummer oder Ort"
        aria-invalid={fehler ? true : undefined}
        aria-describedby={fehler ? fehlerId : undefined}
        onChange={(event) => setBegriff(event.target.value)}
      />
      {fehler !== undefined && (
        <span id={fehlerId} className="field__fehler" role="alert">
          {fehler}
        </span>
      )}

      {treffer.isPending && <p className="muted">Kunden werden gesucht ...</p>}
      {treffer.isError && (
        <p className="alert alert--error" role="alert">
          Die Kundensuche ist fehlgeschlagen.{" "}
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void treffer.refetch()}
          >
            Erneut versuchen
          </button>
        </p>
      )}
      {treffer.isSuccess && treffer.data.treffer.length === 0 && (
        <p className="muted">
          {begriff.trim().length > 0
            ? "Kein Kunde gefunden. Bitte den Suchbegriff ändern."
            : "Es gibt noch keinen Kunden. Bitte zuerst unter Kunden einen anlegen."}
        </p>
      )}
      {treffer.isSuccess && treffer.data.treffer.length > 0 && (
        <ul className="auswahl__liste">
          {treffer.data.treffer.map((kunde) => (
            <li key={kunde.id}>
              <button
                type="button"
                className="auswahl__eintrag"
                disabled={disabled}
                onClick={() => onChange(kunde)}
              >
                <code>{kunde.customer_number}</code> {kunde.name}
                {kunde.billing_city !== null && <span className="muted"> · {kunde.billing_city}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {treffer.isSuccess && treffer.data.weitere && (
        <p className="muted">
          Es gibt mehr als {trefferProSeite} Treffer. Bitte den Suchbegriff eingrenzen.
        </p>
      )}
    </div>
  );
}
