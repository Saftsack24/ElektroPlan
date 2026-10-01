import type { ProjectSummary } from "@elektroplan/api-client";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../../core/auth/AuthProvider";
import { Marke } from "../../core/ui/Marke";
import type { MarkenArt } from "../../core/ui/Marke";
import { KARTENKOPF, KARTENTITEL, STAPEL, karte, knopf, meldungsflaeche } from "../../core/ui/stil";
import { STATUS_LABEL } from "./status";
import type { ProjectStatus } from "./status";
import { AKTION } from "../../core/ui/aktionssymbole";
import { MitSymbol } from "../../core/ui/Symbol";

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
    <div className={STAPEL}>
      <section
        className={`${karte()} flex flex-wrap items-center justify-between gap-4`}
        aria-labelledby="begruessung-titel"
      >
        <div>
          <h1 id="begruessung-titel" className="m-0 text-[1.5rem]">
            {begruessung(new Date().getHours())}, {me?.full_name}
          </h1>
          <p className="mt-1 mb-0 text-muted">
            Betrieb: <strong>{me?.organization.name}</strong>
          </p>
        </div>
        {(darfProjektAnlegen || darfKundeAnlegen || darfEinladen) && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Schnellaktionen">
            {darfProjektAnlegen && (
              <Link className={knopf("primaer", { link: true })} to="/projects?neu=1">
                <MitSymbol icon={AKTION.anlegen}>Neues Projekt</MitSymbol>
              </Link>
            )}
            {darfKundeAnlegen && (
              <Link className={knopf("neutral", { link: true })} to="/customers?neu=1">
                <MitSymbol icon={AKTION.anlegen}>Neuer Kunde</MitSymbol>
              </Link>
            )}
            {darfEinladen && (
              <Link className={knopf("neutral", { link: true })} to="/administration/users?einladen=1">
                <MitSymbol icon={AKTION.einladen}>Benutzer einladen</MitSymbol>
              </Link>
            )}
          </div>
        )}
      </section>

      {darfBenutzerSehen && <OffeneEinladungen />}

      {darfProjekteLesen && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
          <Projektkarte
            titel="Zuletzt geändert"
            beschreibung="Laufende Projekte, zuletzt bearbeitete zuerst - auch Gebäude, Dateien und Planung zählen."
            schluessel="zuletzt"
            status={undefined}
            leer={
              <>
                <p>Noch keine Projekte.</p>
                <p className="text-muted">
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
            leer={<p className="text-muted">Derzeit ist kein Projekt in Bearbeitung.</p>}
          />
        </div>
      )}

      {hatArbeitsbereich ? (
        <nav className={karte()} aria-labelledby="einstiege-titel">
          <h2 id="einstiege-titel">Weiterarbeiten</h2>
          <ul className="mt-2 mb-0 pl-[18px] *:my-1">
            {darfProjekteLesen && (
              <li>
                <Link to="/projects">Alle Projekte</Link>
                <span className="text-muted"> - suchen, filtern, Gebäude und Pläne verwalten</span>
              </li>
            )}
            {darfKundenLesen && (
              <li>
                <Link to="/customers">Kunden</Link>
                <span className="text-muted"> - Kundenstamm und Ansprechpartner</span>
              </li>
            )}
          </ul>
        </nav>
      ) : (
        <section className={karte()}>
          <h2>Ihre Aufgaben</h2>
          <p>
            Für Ihre Rolle ({me?.roles.map((role) => role.name).join(", ") || "keine"}) gibt es in
            ElektroPlan derzeit noch keine eigenen Arbeitsbereiche.
          </p>
          <p className="text-muted">Bei Fragen zu Ihrem Zugang wenden Sie sich an die Büroleitung.</p>
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
        query: {
          sort: "updated_at",
          page_size: KARTENGROESSE,
          // Abgeschlossene und archivierte Projekte gehören nicht auf die
          // Startseite der laufenden Arbeit (Phase 4d).
          ...(status ? { status } : { status_group: "current" }),
        },
      }),
  });

  return (
    <section className={karte()} aria-labelledby={titelId}>
      <div className={KARTENKOPF}>
        <h2 id={titelId} className={KARTENTITEL}>
          {titel}
        </h2>
        <Link to="/projects">Alle anzeigen</Link>
      </div>
      <p className="mt-1 mb-2 text-[0.88rem] text-muted">{beschreibung}</p>
      {abfrage.isPending && <p className="text-muted">Wird geladen ...</p>}
      {abfrage.isError && (
        <p className={meldungsflaeche()} role="alert">
          Die Projekte konnten nicht geladen werden.{" "}
          <button type="button" className={knopf()} onClick={() => void abfrage.refetch()}>
            Erneut versuchen
          </button>
        </p>
      )}
      {abfrage.isSuccess &&
        (abfrage.data.items.length === 0 ? (
          <div className="py-3 text-muted *:my-1">{leer}</div>
        ) : (
          <ul className="m-0 list-none p-0">
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
    <li className="flex justify-between gap-3 border-b border-line py-2 last:border-b-0 max-sm:flex-col">
      <div>
        <Link to={`/projects/${projekt.id}`} className="font-semibold">
          {projekt.name}
        </Link>
        <div className="text-label text-muted">
          <code>{projekt.project_number}</code> · {projekt.customer_name}
          {projekt.site_city ? ` · ${projekt.site_city}` : ""}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 max-sm:items-start">
        <Marke art={STATUS_ART[projekt.status]}>{STATUS_LABEL[projekt.status]}</Marke>
        <span className="text-[0.8rem] whitespace-nowrap text-muted">
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
    <p
      className="m-0 rounded-ep border border-l-4 border-line border-l-accent bg-surface px-3.5 py-2.5"
      role="status"
    >
      {mehr}
      {anzahl} {anzahl === 1 && !mehr ? "Einladung ist" : "Einladungen sind"} noch nicht
      angenommen
      {abgelaufen > 0 ? `, davon ${abgelaufen} abgelaufen` : ""}.{" "}
      <Link to="/administration/users?status=invited">Einladungen ansehen</Link>
    </p>
  );
}
