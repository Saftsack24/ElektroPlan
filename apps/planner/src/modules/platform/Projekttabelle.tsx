import type { ProjectSummary } from "@elektroplan/api-client";
import { Link } from "react-router-dom";

import { TABELLE, TABELLENRAHMEN } from "../../core/ui/stil";
import { STATUS_LABEL } from "./status";

const DATUM = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

/**
 * Projekttabelle der Projektübersicht und der Kundendetailseite.
 *
 * Auf der Kundenseite ist die Kundenspalte überflüssig, dort zählt die
 * letzte Änderung - deshalb zwei Schalter statt zweier Tabellen.
 */
export function Projekttabelle({
  projekte,
  leerText = "Keine Projekte gefunden.",
  mitKunde = true,
  mitAenderung = false,
}: {
  projekte: readonly ProjectSummary[];
  leerText?: string;
  mitKunde?: boolean;
  mitAenderung?: boolean;
}) {
  if (projekte.length === 0) return <p className="text-muted">{leerText}</p>;
  return (
    <div className={TABELLENRAHMEN}>
      <table className={TABELLE}>
        <thead>
          <tr>
            <th>Nummer</th>
            <th>Bezeichnung</th>
            {mitKunde && <th>Kunde</th>}
            <th>Baustellenort</th>
            <th>Status</th>
            {mitAenderung && <th>Letzte Änderung</th>}
          </tr>
        </thead>
        <tbody>
          {projekte.map((projekt) => (
            <tr key={projekt.id}>
              <td>
                <code>{projekt.project_number}</code>
              </td>
              <td>
                <Link to={`/projects/${projekt.id}`}>{projekt.name}</Link>
              </td>
              {mitKunde && <td>{projekt.customer_name}</td>}
              <td>{projekt.site_city ?? "—"}</td>
              <td>{STATUS_LABEL[projekt.status]}</td>
              {mitAenderung && <td>{DATUM.format(new Date(projekt.updated_at))}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
