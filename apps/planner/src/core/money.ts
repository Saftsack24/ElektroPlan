import Decimal from "decimal.js-light";

/**
 * Geldbetraege und Mengen kommen als Dezimal-String ueber die API (ADR 0005).
 * Sie werden nie in `number` umgewandelt - JavaScript-Zahlen sind IEEE-754 und
 * wuerden die im Backend erreichte Genauigkeit sofort wieder verlieren.
 */
export function toDecimal(value: string): Decimal {
  return new Decimal(value);
}

/** Formatiert einen Dezimal-String fuer die Anzeige. */
export function formatMoney(value: string, currency = "EUR"): string {
  const amount = toDecimal(value).toFixed(2);
  return `${amount.replace(".", ",")} ${currency === "EUR" ? "€" : currency}`;
}

/** Formatiert eine Menge mit Einheit. */
export function formatQuantity(value: string, unit: string, decimals = 3): string {
  return `${toDecimal(value).toFixed(decimals).replace(".", ",")} ${unit}`;
}

export { Decimal };
