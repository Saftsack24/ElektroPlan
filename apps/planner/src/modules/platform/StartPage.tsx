import type { ProjectSummary } from "@elektroplan/api-client";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../../core/auth/AuthProvider";
import { Marke } from "../../core/ui/Marke";
import type { MarkenArt } from "../../core/ui/Marke";
import { STATUS_LABEL } from "./status";
import type { ProjectStatus } from "./status";

/** Wie viele Projekte eine Karte der Startseite zeigt. */
const KARTENGROESSE = 5;
/** Obergrenze, bis zu der offene Einladungen gezählt werden. */
const EINLADUNGEN_ZAEHLEN_BIS = 20;

const STATUS_ART: Record<ProjectStatus, MarkenArt> = {
  draft: "neutral",
  active: "info",
  completed: "erfolg",
  archived: "neutral",
};

export function begruessung(stunde: number): string {
  if (stunde < 11) return "Guten Morgen";
  if (stunde < 18) return "Guten Tag";
  return "Guten Abend";
}

/**
 * Arbeitsorientierte Startseite (Phase 4.2).
 *
 * Zeigt, womit man weiterarbeitet - nicht, wie das System gebaut ist. Keine
 * Kennzahlen, die es nicht gibt, keine Modulversionen (die stehen jetzt in
 * „Administration → Systeminformationen"), keine Berechtigungsschlüssel.
 *
 * Jede Karte fragt genau die Seite ab, die sie zeigt: Sortierung und Filter
 * erledigt der Server (`sort=updated_at`, `status=active`, `limit=5`).
 */
export default function StartPage() {
  const { me, permissions } = useAuth();
  const darfProjekteLesen = permissions.has("project.record.read");
  const darfProjektAnlegen = permissions.has("project.record.write");
  const darfKundenLesen = permissions.has("customer.record.read");
  const darfKundeAnlegen = permissions.has("customer.record.write");
  const darfEinladen =
    permissions.has("user.account.write") && permissions.has("role.assignment.write");
  const darfBenutzerSehen = permissions.has("user.account.read");
  const hatArbeitsbereich = darfProjekteLesen || darfKundenLesen;

  return (
    <div className="stack">
      <section className="card begruessung" aria-labelledby="begruessung-titel">
        <div>
          <h1 id="begruessung-titel">
            {begruessung(new Date().getHours())}, {me?.full_name}
          </h1>
          <p className="muted begruessung__betrieb">
            Betrieb: <strong>{me?.organization.name}</strong>
          </p>
        </div>
        {(darfProjektAnlegen || darfKundeAnlegen || darfEinladen) && (
          <div className="schnellaktionen" role="group" aria-label="Schnellaktionen">
            {darfProjektAnlegen && (
              <Link className="button button--primary" to="/projects?neu=1">
                Neues Projekt
              </Link>
            )}
            {darfKundeAnlegen && (
              <Link className="button button--ghost" to="/customers?neu=1">
                Neuer Kunde
              </Link>
            )}
            {darfEinladen && (
              <Link className="button button--ghost" to="/administration/users?einladen=1">
                Benutzer einladen
              </Link>
            )}
          </div>
        )}
      </section>

      {darfBenutzerSehen && <OffeneEinladungen />}

      {darfProjekteLesen && (
        <div className="kacheln">
          <Projektkarte
            titel="Zuletzt geändert"
            beschreibung="Projekte, deren Stammdaten oder Status zuletzt geändert wurden."
            schluessel="zuletzt"
            status={undefined}
            leer={
              <>
                <p>Noch keine Projekte.</p>
                <p className="muted">
                  {darfKundeAnlegen
                    ? "Legen Sie zuerst einen Kunden an, danach das erste Projekt."
                    : "Sobald im Betrieb Projekte angelegt sind, erscheinen sie hier."}
                </p>
              </>
            }
          />
          <Projektkarte
            titel="In Bearbeitung"
            beschreibung="Aktive Projekte, zuletzt geänderte zuerst."
            schluessel="aktiv"
            status="active"
            leer={<p className="muted">Derzeit ist kein Projekt in Bearbeitung.</p>}
          />
        </div>
      )}

      {hatArbeitsbereich ? (
        <nav className="card" aria-labelledby="einstiege-titel">
          <h2 id="einstiege-titel">Weiterarbeiten</h2>
          <ul className="einstiege">
            {darfProjekteLesen && (
              <li>
                <Link to="/projects">Alle Projekte</Link>
                <span className="muted"> - suchen, filtern, Gebäude und Pläne verwalten</span>
              </li>
            )}
            {darfKundenLesen && (
              <li>
                <Link to="/customers">Kunden</Link>
                <span className="muted"> - Kundenstamm und Ansprechpartner</span>
              </li>
            )}
          </ul>
        </nav>
      ) : (
        <section className="card">
          <h2>Ihre Aufgaben</h2>
          <p>
            Für Ihre Rolle ({me?.roles.map((role) => role.name).join(", ") || "keine"}) gibt es in
            ElektroPlan derzeit noch keine eigenen Arbeitsbereiche.
          </p>
          <p className="muted">Bei Fragen zu Ihrem Zugang wenden Sie sich an die Büroleitung.</p>
        </section>
      )}
    </div>
  );
}

function Projektkarte({
  titel,
  beschreibung,
  schluessel,
  status,
  leer,
}: {
  titel: string;
  beschreibung: string;
  schluessel: string;
  status: "active" | undefined;
  leer: ReactNode;
}) {
  const { api } = useAuth();
  const titelId = `karte-${schluessel}`;
  const abfrage = useQuery({
    queryKey: ["projects", "start", schluessel],
    queryFn: () =>
      api.get("/api/v1/projects", {
        query: { sort: "updated_at", page_size: KARTENGROESSE, ...(status ? { status } : {}) },
      }),
  });

  return (
    <section className="card" aria-labelledby={titelId}>
      <div className="card__header">
        <h2 id={titelId}>{titel}</h2>
        <Link to="/projects">Alle anzeigen</Link>
      </div>
      <p className="muted karte__beschreibung">{beschreibung}</p>
      {abfrage.isPending && <p className="muted">Wird geladen ...</p>}
      {abfrage.isError && (
        <p className="alert alert--error" role="alert">
          Die Projekte konnten nicht geladen werden.{" "}
          <button type="button" className="button button--ghost" onClick={() => void abfrage.refetch()}>
            Erneut versuchen
          </button>
        </p>
      )}
      {abfrage.isSuccess &&
        (abfrage.data.items.length === 0 ? (
          <div className="leer">{leer}</div>
        ) : (
          <ul className="projektliste">
            {abfrage.data.items.map((projekt) => (
              <Projektzeile key={projekt.id} projekt={projekt} />
            ))}
          </ul>
        ))}
    </section>
  );
}

function Projektzeile({ projekt }: { projekt: ProjectSummary }) {
  return (
    <li className="projektliste__eintrag">
      <div>
        <Link to={`/projects/${projekt.id}`} className="projektliste__name">
          {projekt.name}
        </Link>
        <div className="muted projektliste__details">
          <code>{projekt.project_number}</code> · {projekt.customer_name}
          {projekt.site_city ? ` · ${projekt.site_city}` : ""}
        </div>
      </div>
      <div className="projektliste__rechts">
        <Marke art={STATUS_ART[projekt.status]}>{STATUS_LABEL[projekt.status]}</Marke>
        <span className="muted projektliste__zeit">
          geändert {new Date(projekt.updated_at).toLocaleDateString("de-DE")}
        </span>
      </div>
    </li>
  );
}

/**
 * Unaufdringlicher Hinweis für die Verwaltung: Nur sichtbar, wenn es offene
 * Einladungen gibt. Gezählt wird bis zu einer kleinen Obergrenze - die
 * Startseite lädt keine vollständige Liste.
 */
function OffeneEinladungen() {
  const { api } = useAuth();
  const abfrage = useQuery({
    queryKey: ["members", "start", "eingeladen"],
    queryFn: () =>
      api.get("/api/v1/members", { query: { status: "invited", limit: EINLADUNGEN_ZAEHLEN_BIS } }),
  });
  if (!abfrage.isSuccess || abfrage.data.items.length === 0) return null;
  const anzahl = abfrage.data.items.length;
  const abgelaufen = abfrage.data.items.filter((eintrag) => eintrag.invitation_expired).length;
  const mehr = abfrage.data.has_more ? "Mehr als " : "";
  return (
    <p className="hinweisleiste" role="status">
      {mehr}
      {anzahl} {anzahl === 1 && !mehr ? "Einladung ist" : "Einladungen sind"} noch nicht
      angenommen
      {abgelaufen > 0 ? `, davon ${abgelaufen} abgelaufen` : ""}.{" "}
      <Link to="/administration/users?status=invited">Einladungen ansehen</Link>
    </p>
  );
}
