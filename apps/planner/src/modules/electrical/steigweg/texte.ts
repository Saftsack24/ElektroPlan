import type { MarkenArt } from "../../../core/ui/Marke";
import type { Abschnitthinweis, Abschnittstatus, Steigwegstatus, Versatzart } from "./verlauf";

/** Texte der Steigwegverwaltung (Phase 6a.5) - keine technischen Codes in der Oberfläche. */

export const STEIGWEGSTATUS: Record<Steigwegstatus, { label: string; art: MarkenArt }> = {
  confirmed: { label: "Länge bestätigt", art: "erfolg" },
  incomplete: { label: "Unvollständig – Höhenlage nicht bestätigt", art: "warnung" },
  conflict: { label: "Konflikt – Höhenlagen widersprüchlich", art: "gefahr" },
  "single-stop": { label: "Nur ein Übergabepunkt – noch kein Abschnitt", art: "neutral" },
  "no-stops": { label: "Noch kein Übergabepunkt", art: "neutral" },
};

export const ABSCHNITTSTATUS: Record<Abschnittstatus, { label: string; art: MarkenArt }> = {
  confirmed: { label: "bestätigt", art: "erfolg" },
  "elevation-unconfirmed": { label: "Höhenlage nicht bestätigt – vorläufig", art: "warnung" },
  "elevation-inconsistent": { label: "Höhenlage widersprüchlich", art: "gefahr" },
};

export const ABSCHNITTHINWEIS: Record<Abschnitthinweis, string> = {
  "floor-gap-below-ceiling-height":
    "Hinweis: Der Geschossabstand ist kleiner als die lichte Standardhöhe des unteren Geschosses. Bitte die Höhenlagen prüfen – Länge und Status ändern sich dadurch nicht.",
};

export const VERSATZART: Record<Versatzart, { label: string; erklaerung: string }> = {
  orthogonal: {
    label: "Rechtwinklig (zuerst x, dann y)",
    erklaerung: "Der waagerechte Versatz auf dem oberen Geschoss verläuft achsparallel – zuerst entlang x, dann entlang y.",
  },
  direct: {
    label: "Direkt (gerade Linie)",
    erklaerung: "Der waagerechte Versatz auf dem oberen Geschoss ist eine gerade Linie zum oberen Übergabepunkt.",
  },
};

export const PLANUNGSHINWEIS =
  "Vereinfachter Planungsverlauf: senkrecht am unteren Übergabepunkt bis zur Fertigfußbodenebene des oberen Geschosses, danach waagerecht zum oberen Übergabepunkt. Keine Aussage über bauliche Machbarkeit, Brandschutz oder Normkonformität.";

export const STEIGWEG_MELDUNG =
  "In der Steigwegverwaltung gibt es ungespeicherte Änderungen. Wenn Sie fortfahren, gehen sie verloren.";
