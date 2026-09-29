import type { CustomerOut } from "@elektroplan/api-client";

/**
 * Baustellenadresse als **Vorschlag** aus der Rechnungsadresse des Kunden -
 * reine Funktionen, ohne React.
 *
 * Die Projektadresse ist eine unabhängige Momentaufnahme: Übernommen wird
 * einmal beim Ausfüllen des Formulars; eine spätere Änderung der
 * Kundenadresse wirkt nie auf bestehende Projekte. Es gibt keine Verknüpfung.
 *
 * Je Feld wird mitgeführt, ob es noch **automatisch verwaltet** ist:
 *
 * * `kunde` - vom gewählten Kunden übernommen (sichtbar gekennzeichnet),
 * * `standard` - Voreinstellung des Formulars (Ländercode `DE`),
 * * kein Eintrag - vom Benutzer eingegeben; wird nie still überschrieben.
 */
export const ADRESSFELDER = ["site_street", "site_postal_code", "site_city", "site_country_code"] as const;
export type Adressfeld = (typeof ADRESSFELDER)[number];
export type Adresse = Record<Adressfeld, string>;
export type Feldherkunft = Partial<Record<Adressfeld, "kunde" | "standard">>;

export const STANDARD_LAENDERCODE = "DE";

export const ANFANGSHERKUNFT: Feldherkunft = { site_country_code: "standard" };

/** Rechnungsadresse des Kunden als Formularwerte - fehlende Teile bleiben leer. */
export function kundenadresse(kunde: CustomerOut): Adresse {
  return {
    site_street: kunde.billing_street ?? "",
    site_postal_code: kunde.billing_postal_code ?? "",
    site_city: kunde.billing_city ?? "",
    site_country_code: kunde.billing_country_code ?? "",
  };
}

/**
 * Wendet den Adressvorschlag eines Kunden an.
 *
 * * Ohne `erzwingen` (Kunde gewählt oder gewechselt): Leere und noch
 *   automatisch verwaltete Felder erhalten den Wert des Kunden. Fehlt dem
 *   Kunden ein Bestandteil, wird ein automatisch verwaltetes Feld geleert -
 *   sonst entstünde eine Mischadresse aus zwei Kunden. Vom Benutzer
 *   geänderte Felder bleiben unberührt.
 * * Mit `erzwingen` („Kundenadresse übernehmen"): Jeder beim Kunden
 *   vorhandene Bestandteil wird übernommen, auch über eigene Eingaben.
 *   Fehlende Bestandteile lassen das Feld, wie es ist.
 *
 * Der Ländercode fällt nie auf leer: Fehlt er beim Kunden, bleibt `DE`.
 */
export function vorschlagAnwenden(
  werte: Adresse,
  herkunft: Feldherkunft,
  kunde: CustomerOut,
  { erzwingen = false }: { erzwingen?: boolean } = {},
): { werte: Adresse; herkunft: Feldherkunft } {
  const vorschlag = kundenadresse(kunde);
  const neueWerte: Adresse = { ...werte };
  const neueHerkunft: Feldherkunft = { ...herkunft };

  for (const feld of ADRESSFELDER) {
    const vorhanden = vorschlag[feld].trim();
    const verwaltet = herkunft[feld] !== undefined;
    const leer = werte[feld].trim() === "";
    if (vorhanden !== "") {
      if (erzwingen || verwaltet || leer) {
        neueWerte[feld] = vorhanden;
        neueHerkunft[feld] = "kunde";
      }
    } else if (!erzwingen && verwaltet) {
      if (feld === "site_country_code") {
        neueWerte[feld] = STANDARD_LAENDERCODE;
        neueHerkunft[feld] = "standard";
      } else {
        neueWerte[feld] = "";
        delete neueHerkunft[feld];
      }
    }
  }
  return { werte: neueWerte, herkunft: neueHerkunft };
}

/** Der Benutzer hat ein Feld selbst geändert - es ist nicht mehr automatisch. */
export function manuellGeaendert(herkunft: Feldherkunft, feld: Adressfeld): Feldherkunft {
  if (herkunft[feld] === undefined) return herkunft;
  const neu = { ...herkunft };
  delete neu[feld];
  return neu;
}

/** Hat der Kunde überhaupt eine übernehmbare Adresse? */
export function hatAdresse(kunde: CustomerOut): boolean {
  const a = kundenadresse(kunde);
  return a.site_street !== "" || a.site_postal_code !== "" || a.site_city !== "";
}
