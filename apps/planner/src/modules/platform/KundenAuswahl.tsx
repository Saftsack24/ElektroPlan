import type { CustomerOut } from "@elektroplan/api-client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Combobox } from "../../core/ui/Combobox";
import type { Comboboxzustand } from "../../core/ui/Combobox";
import { useEntprellt } from "../../core/ui/useEntprellt";

/** Was die Suche zurückliefert. `weitere` meldet abgeschnittene Treffer. */
export interface Suchergebnis {
  treffer: CustomerOut[];
  weitere: boolean;
}

/** Eindeutige Kurzform: Kundennummer, Name, Ort. */
export function KundeKurz({ kunde }: { kunde: CustomerOut }) {
  return (
    <>
      <code>{kunde.customer_number}</code> {kunde.name}
      {kunde.billing_city !== null && <span className="muted"> · {kunde.billing_city}</span>}
    </>
  );
}

/**
 * Kundensuche mit **serverseitiger** Suche - für die Projektanlage und für
 * den Kundenfilter der Projektliste.
 *
 * * Kein Vorabladen des Kundenstamms und keine 200er-Grenze: Der Server
 *   sucht nach Name, Kundennummer und Ort; `weitere` meldet, wenn es mehr
 *   Treffer gibt als angezeigt.
 * * Entprellt: Ein getipptes Wort erzeugt eine Anfrage, nicht acht.
 * * **Keine veralteten Treffer.** Jeder Suchbegriff ist eine eigene Abfrage
 *   (`queryKey`). Eine langsame Antwort auf einen älteren Begriff landet in
 *   ihrem eigenen Eintrag und überschreibt nie die Treffer des aktuellen.
 * * Welche Kunden angeboten werden, entscheidet der Aufrufer über `suchen`:
 *   Die Projektanlage lässt anonymisierte Kunden weg, der Listenfilter nicht.
 * * Die Auswahl bleibt als erkennbarer Eintrag stehen und lässt sich
 *   entfernen; sie gehört dem Benutzer, nicht der Trefferliste.
 */
export function KundenAuswahl({
  id,
  label = "Kunde",
  zweck,
  gewaehlt,
  onChange,
  suchen,
  fehler,
  disabled = false,
  required = false,
  entfernenLabel = "Anderen Kunden wählen",
  trefferProSeite = 20,
}: {
  id: string;
  label?: string;
  /** Trennt die Treffer-Caches, wenn zwei Auswahlfelder verschieden filtern. */
  zweck: string;
  gewaehlt: CustomerOut | null;
  onChange: (kunde: CustomerOut | null) => void;
  suchen: (begriff: string) => Promise<Suchergebnis>;
  fehler?: string | undefined;
  disabled?: boolean;
  required?: boolean;
  entfernenLabel?: string;
  trefferProSeite?: number;
}) {
  const [begriff, setBegriff] = useState("");
  const entprellt = useEntprellt(begriff.trim());

  const treffer = useQuery({
    queryKey: ["customers", "suche", zweck, entprellt],
    queryFn: () => suchen(entprellt),
    // Solange jemand ausgewählt hat, wird nicht weiter gesucht.
    enabled: gewaehlt === null && !disabled,
  });

  if (gewaehlt !== null) {
    return (
      <div className="field">
        <span className="field__label" id={`${id}-label`}>
          {label}
          {required ? " *" : ""}
        </span>
        <div className="auswahl__chip" role="group" aria-labelledby={`${id}-label`}>
          <span className="auswahl__chip-text" data-testid={`${id}-gewaehlt`}>
            <KundeKurz kunde={gewaehlt} />
          </span>
          <button
            id={`${id}-entfernen`}
            type="button"
            className="button button--ghost"
            disabled={disabled}
            onClick={() => {
              setBegriff("");
              onChange(null);
              // Der Fokus geht zurück in das wieder erscheinende Suchfeld.
              setTimeout(() => document.getElementById(id)?.focus(), 0);
            }}
          >
            {entfernenLabel}
          </button>
        </div>
      </div>
    );
  }

  const tippt = begriff.trim() !== entprellt;
  const zustand: Comboboxzustand =
    treffer.isError ? "fehler" : treffer.isPending || tippt ? "laedt" : "bereit";
  const optionen = treffer.data?.treffer ?? [];

  return (
    <Combobox
      id={id}
      label={label}
      required={required}
      disabled={disabled}
      fehler={fehler}
      eingabe={begriff}
      onEingabe={setBegriff}
      platzhalter="Name, Kundennummer oder Ort"
      zustand={zustand}
      optionen={optionen}
      schluessel={(kunde) => kunde.id}
      darstellen={(kunde) => <KundeKurz kunde={kunde} />}
      onWaehlen={(kunde) => {
        onChange(kunde);
        // Das Suchfeld weicht der Auswahlanzeige - der Fokus geht auf deren
        // Knopf statt verloren.
        setTimeout(() => document.getElementById(`${id}-entfernen`)?.focus(), 0);
      }}
      onErneut={() => void treffer.refetch()}
      fehlerText="Die Kundensuche ist fehlgeschlagen."
      leerText={
        entprellt.length > 0
          ? "Kein Kunde gefunden. Bitte den Suchbegriff ändern."
          : "Es gibt noch keinen Kunden. Bitte zuerst unter Kunden einen anlegen."
      }
      fusszeile={
        treffer.data?.weitere
          ? `Es gibt mehr als ${trefferProSeite} Treffer. Bitte den Suchbegriff eingrenzen.`
          : undefined
      }
    />
  );
}
