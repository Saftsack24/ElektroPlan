import type { UserReference } from "@elektroplan/api-client";

const ZEITPUNKT = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

/**
 * Wer einen Datensatz angelegt oder zuletzt geändert hat - in Worten.
 *
 * Der Server liefert nur den Anzeigenamen von Mitgliedern des eigenen
 * Betriebs, nie eine E-Mail-Adresse. Bestandsdaten ohne Bearbeiter heißen
 * „System/Bestandsdaten"; ein Konto außerhalb des Betriebs bleibt namenlos.
 */
export function bearbeiterText(person: UserReference): string {
  if (person.kind === "member" && person.display_name) return person.display_name;
  if (person.kind === "unknown") return "Unbekannter Benutzer";
  return "System/Bestandsdaten";
}

/** Ruhiger Metadatenbereich für Kunden- und Projektdetail. */
export function Bearbeitungsinfo({
  erstelltVon,
  erstelltAm,
  geaendertVon,
  geaendertAm,
}: {
  erstelltVon: UserReference;
  erstelltAm: string;
  geaendertVon: UserReference;
  geaendertAm: string;
}) {
  return (
    <dl
      className="m-0 mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-label text-muted max-sm:grid-cols-1 [&_dd]:m-0 [&_dd]:text-fg [&_dd]:wrap-anywhere"
      aria-label="Bearbeitungsinformationen"
    >
      <dt>Erstellt von</dt>
      <dd>{bearbeiterText(erstelltVon)}</dd>
      <dt>Erstellt am</dt>
      <dd>
        <time dateTime={erstelltAm}>{ZEITPUNKT.format(new Date(erstelltAm))}</time>
      </dd>
      <dt>Zuletzt geändert von</dt>
      <dd>{bearbeiterText(geaendertVon)}</dd>
      <dt>Zuletzt geändert am</dt>
      <dd>
        <time dateTime={geaendertAm}>{ZEITPUNKT.format(new Date(geaendertAm))}</time>
      </dd>
    </dl>
  );
}
