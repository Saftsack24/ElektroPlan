import type {
  EffectivePermissionOut,
  MemberOut,
  MemberPermissionsOut,
  SystemRoleOut,
} from "@elektroplan/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useAuth } from "../../../core/auth/AuthProvider";
import { Bestaetigung } from "../../../core/ui/Bestaetigung";
import { Marke } from "../../../core/ui/Marke";
import { FELD_FEHLER, KARTENKOPF, KENNWERTE, KNOPFZEILE, STAPEL, karte, knopf, meldungsflaeche } from "../../../core/ui/stil";
import { AdminNavigation } from "./AdminNavigation";
import { Kontoaktionen } from "./Kontoaktionen";
import { ENTFERNTER_BENUTZER, STATUS_ART, STATUS_TEXT, datum, verwaltungsfehler } from "./texte";
import { RECHTE_BEREICH_TITEL, RECHTE_LISTE, RECHTE_RASTER, RECHTE_SCHLUESSEL } from "./rechtedarstellung";
import { AKTION } from "../../../core/ui/aktionssymbole";
import { MitSymbol } from "../../../core/ui/Symbol";

const ADMIN_ROLLE = "admin";

/**
 * Detailansicht eines Mitglieds: Konto und Zugang, Rollen, effektive Rechte.
 *
 * Name und E-Mail sind seit Phase 4e hier änderbar - aber nur bei Konten,
 * die keinem anderen Betrieb angehören (ADR 0021). Ein Passwort setzt nie
 * der Administrator, sondern die Person selbst über einen Einmal-Link.
 */
export default function MitgliedPage() {
  const { memberId = "" } = useParams();
  const { api, me, permissions, aktualisieren } = useAuth();
  const queryClient = useQueryClient();
  const darfRollenSehen = permissions.has("role.assignment.read");

  const mitglied = useQuery({
    queryKey: ["members", "detail", memberId],
    queryFn: () => api.get("/api/v1/members/{member_id}", { path: { member_id: memberId } }),
  });
  const rechte = useQuery({
    queryKey: ["members", "rechte", memberId],
    queryFn: () =>
      api.get("/api/v1/members/{member_id}/permissions", { path: { member_id: memberId } }),
    enabled: darfRollenSehen,
  });
  const rollen = useQuery({
    queryKey: ["roles"],
    queryFn: () => api.get("/api/v1/roles"),
    enabled: darfRollenSehen,
  });

  const neuLaden = async () => {
    await queryClient.invalidateQueries({ queryKey: ["members"] });
  };

  return (
    <div className={STAPEL}>
      <section className={karte()}>
        <p className="m-0 text-[0.8rem] tracking-[0.04em] text-muted uppercase">Administration</p>
        <AdminNavigation />
        <p>
          <Link to="/administration/users">
            <MitSymbol icon={AKTION.zurueck}>Zur Benutzerliste</MitSymbol>
          </Link>
        </p>
        {mitglied.isPending && <p className="text-muted">Mitglied wird geladen ...</p>}
        {mitglied.isError && (
          <p className={meldungsflaeche()} role="alert">
            Dieses Mitglied wurde nicht gefunden oder ist nicht mehr erreichbar.
          </p>
        )}
        {mitglied.isSuccess && (
          <Kopf mitglied={mitglied.data} betrieb={me?.organization.name ?? "diesem Betrieb"} />
        )}
      </section>

      {mitglied.isSuccess && (
        <Kontoaktionen
          mitglied={mitglied.data}
          betrieb={me?.organization.name ?? "diesem Betrieb"}
          onGeaendert={neuLaden}
        />
      )}

      {mitglied.isSuccess && darfRollenSehen && mitglied.data.status !== "removed" && (
        <Rollen
          mitglied={mitglied.data}
          rollen={rollen.data}
          onGeaendert={async () => {
            await neuLaden();
            // Eigene Rollen geändert: Navigation und Rechte sofort nachziehen.
            if (mitglied.data.is_self) await aktualisieren();
          }}
        />
      )}

      {darfRollenSehen && rechte.isSuccess && mitglied.data?.status !== "removed" && (
        <EffektiveRechte daten={rechte.data} />
      )}
    </div>
  );
}

function Kopf({ mitglied, betrieb }: { mitglied: MemberOut; betrieb: string }) {
  const entfernt = mitglied.status === "removed";
  return (
    <div className={STAPEL}>
      <div className={KARTENKOPF}>
        <h1 className={entfernt ? "text-muted" : undefined}>{mitglied.full_name ?? ENTFERNTER_BENUTZER}</h1>
        <Marke art={STATUS_ART[mitglied.status]}>{STATUS_TEXT[mitglied.status]}</Marke>
      </div>
      <dl className={KENNWERTE}>
        {!entfernt && (
          <>
            <dt>E-Mail</dt>
            <dd className="wrap-anywhere">{mitglied.email}</dd>
          </>
        )}
        <dt>Mitglied seit</dt>
        <dd>{datum(mitglied.joined_at)}</dd>
        <dt>Zuletzt geändert</dt>
        <dd>{datum(mitglied.updated_at)}</dd>
        {!entfernt && (
          <>
            <dt>Letzte Anmeldung in {betrieb}</dt>
            <dd>{datum(mitglied.last_login_at)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function Rollen({
  mitglied,
  rollen,
  onGeaendert,
}: {
  mitglied: MemberOut;
  rollen: SystemRoleOut[] | undefined;
  onGeaendert: () => Promise<void>;
}) {
  const { api, permissions } = useAuth();
  const darfSchreiben = permissions.has("role.assignment.write");
  const bisher = mitglied.roles.map((rolle) => rolle.key);
  // Die Auswahl gehört zu genau einer Version: Nach einer Änderung (auch
  // durch jemand anderen) beginnt sie wieder beim Serverstand.
  const [auswahl, setAuswahl] = useState<{ version: number; keys: string[] }>({
    version: mitglied.version,
    keys: bisher,
  });
  const gewaehlt = auswahl.version === mitglied.version ? auswahl.keys : bisher;
  const [frage, setFrage] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);

  const hinzu = gewaehlt.filter((key) => !bisher.includes(key));
  const weg = bisher.filter((key) => !gewaehlt.includes(key));
  const geaendert = hinzu.length > 0 || weg.length > 0;
  const name = (key: string) => rollen?.find((rolle) => rolle.key === key)?.name ?? key;

  const umschalten = (key: string, an: boolean) => {
    setMeldung(null);
    setAuswahl({
      version: mitglied.version,
      keys: an ? [...gewaehlt, key] : gewaehlt.filter((wert) => wert !== key),
    });
  };

  const speichern = async () => {
    if (laeuft) return;
    setLaeuft(true);
    setFehler(null);
    try {
      await api.put("/api/v1/members/{member_id}/roles", {
        path: { member_id: mitglied.id },
        ifMatch: mitglied.version,
        body: { role_keys: gewaehlt },
      });
      setFrage(false);
      setMeldung("Die Rollen wurden gespeichert. Sie gelten ab sofort, ohne neue Anmeldung.");
      await onGeaendert();
    } catch (error) {
      setFehler(verwaltungsfehler(error));
      await onGeaendert();
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <section className={karte()} aria-labelledby="rollen-titel">
      <h2 id="rollen-titel">Rollen</h2>
      <p className="text-muted">
        Rollen bündeln feste Berechtigungen. Einzelne Rechte lassen sich nicht vergeben -{" "}
        <Link to="/administration/roles">Übersicht der Rollen</Link>.
      </p>
      {meldung !== null && (
        <p className={meldungsflaeche("erfolg")} role="status">
          {meldung}
        </p>
      )}
      {rollen === undefined ? (
        <p className="text-muted">Rollen werden geladen ...</p>
      ) : (
        <fieldset className="flex flex-col gap-2.5 rounded-ep border border-line p-3" disabled={!darfSchreiben || laeuft}>
          <legend className="sr-only">Rollen von {mitglied.full_name}</legend>
          {rollen.map((rolle) => {
            const id = `rolle-${rolle.key}`;
            const eigeneAdminrolle =
              mitglied.is_self && rolle.key === ADMIN_ROLLE && bisher.includes(ADMIN_ROLLE);
            const letzteAdminrolle =
              !mitglied.is_self &&
              mitglied.is_last_active_administrator &&
              rolle.key === ADMIN_ROLLE &&
              bisher.includes(ADMIN_ROLLE);
            return (
              <div key={rolle.key} className="flex items-start gap-2.5 [&_input]:mt-1">
                <input
                  id={id}
                  type="checkbox"
                  checked={gewaehlt.includes(rolle.key)}
                  disabled={eigeneAdminrolle || letzteAdminrolle}
                  aria-labelledby={`${id}-name`}
                  aria-describedby={`${id}-zweck`}
                  onChange={(event) => umschalten(rolle.key, event.target.checked)}
                />
                <label htmlFor={id} className="flex flex-col">
                  <strong id={`${id}-name`}>{rolle.name}</strong>
                  <span id={`${id}-zweck`} className="text-label text-muted">
                    {eigeneAdminrolle
                      ? "Die eigene Administratorrolle kann hier niemand selbst entfernen."
                      : letzteAdminrolle
                        ? "Einziger aktiver Administrator: Bitte zuerst einem anderen Mitglied die Administratorrolle geben."
                        : rolle.description}
                  </span>
                </label>
              </div>
            );
          })}
        </fieldset>
      )}
      {fehler !== null && !frage && (
        <p className={meldungsflaeche()} role="alert">
          {fehler}
        </p>
      )}
      {darfSchreiben && (
        <div className={KNOPFZEILE}>
          <button
            type="button"
            className={knopf("primaer")}
            disabled={!geaendert || gewaehlt.length === 0 || laeuft}
            onClick={() => {
              setFehler(null);
              setFrage(true);
            }}
          >
            Rollen speichern
          </button>
          {geaendert && (
            <button
              type="button"
              className={knopf()}
              disabled={laeuft}
              onClick={() => setAuswahl({ version: mitglied.version, keys: bisher })}
            >
              Änderungen verwerfen
            </button>
          )}
          {gewaehlt.length === 0 && (
            <span className={FELD_FEHLER}>Mindestens eine Rolle ist nötig.</span>
          )}
        </div>
      )}
      <Bestaetigung
        offen={frage}
        titel="Rollen ändern?"
        bestaetigenLabel="Rollen speichern"
        gefaehrlich={weg.includes(ADMIN_ROLLE)}
        laeuft={laeuft}
        fehler={fehler}
        onBestaetigen={() => void speichern()}
        onAbbrechen={() => setFrage(false)}
      >
        <p>
          Rollen von <strong>{mitglied.full_name}</strong>:
        </p>
        <ul>
          {hinzu.length > 0 && <li>Neu: {hinzu.map(name).join(", ")}</li>}
          {weg.length > 0 && <li>Entfernt: {weg.map(name).join(", ")}</li>}
        </ul>
        <p className="text-muted">Die Änderung gilt sofort, ohne neue Anmeldung.</p>
      </Bestaetigung>
    </section>
  );
}

/** Berechtigungen nach Bereich gruppiert, mit der Herkunft aus den Rollen. */
export function EffektiveRechte({ daten }: { daten: MemberPermissionsOut }) {
  const bereiche = new Map<string, EffectivePermissionOut[]>();
  for (const recht of daten.permissions) {
    bereiche.set(recht.area, [...(bereiche.get(recht.area) ?? []), recht]);
  }
  return (
    <section className={karte()} aria-labelledby="rechte-titel">
      <h2 id="rechte-titel">Was diese Person darf</h2>
      <p className="text-muted">Ergibt sich aus den Rollen. Steht mehr als eine Rolle dahinter, sind alle genannt.</p>
      {daten.permissions.length === 0 ? (
        <p className="py-3 text-muted *:my-1">Keine Berechtigungen - der Person ist keine Rolle zugewiesen.</p>
      ) : (
        <div className={RECHTE_RASTER}>
          {[...bereiche.entries()].map(([bereich, rechte]) => (
            <section key={bereich} aria-label={bereich}>
              <h3 className={RECHTE_BEREICH_TITEL}>{bereich}</h3>
              <ul className={RECHTE_LISTE}>
                {rechte.map((recht) => (
                  <li key={recht.key}>
                    <span>{recht.description || recht.key}</span>
                    <span className="text-label text-muted">
                      {" "}
                      über {recht.granted_by.map((rolle) => rolle.name).join(", ")}
                    </span>
                    <code className={RECHTE_SCHLUESSEL}>{recht.key}</code>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
