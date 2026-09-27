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
import { AdminNavigation } from "./AdminNavigation";
import { STATUS_ART, STATUS_TEXT, datum, verwaltungsfehler } from "./texte";

const ADMIN_ROLLE = "admin";

/**
 * Detailansicht eines Mitglieds: Zugang, Rollen, effektive Rechte.
 *
 * Name, E-Mail und Passwort gehören zum persönlichen Konto und sind hier
 * nicht änderbar - ein Betrieb verwaltet nur die Mitgliedschaft bei sich.
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
    <div className="stack">
      <section className="card">
        <p className="bereich">Administration</p>
        <AdminNavigation />
        <p>
          <Link to="/administration/users">← Zur Benutzerliste</Link>
        </p>
        {mitglied.isPending && <p className="muted">Mitglied wird geladen ...</p>}
        {mitglied.isError && (
          <p className="alert alert--error" role="alert">
            Dieses Mitglied wurde nicht gefunden oder ist nicht mehr erreichbar.
          </p>
        )}
        {mitglied.isSuccess && (
          <Kopf mitglied={mitglied.data} betrieb={me?.organization.name ?? "diesem Betrieb"} />
        )}
      </section>

      {mitglied.isSuccess && (
        <Zugang
          mitglied={mitglied.data}
          betrieb={me?.organization.name ?? "diesem Betrieb"}
          onGeaendert={neuLaden}
        />
      )}

      {mitglied.isSuccess && darfRollenSehen && (
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

      {darfRollenSehen && rechte.isSuccess && <EffektiveRechte daten={rechte.data} />}
    </div>
  );
}

function Kopf({ mitglied, betrieb }: { mitglied: MemberOut; betrieb: string }) {
  return (
    <div className="stack">
      <div className="card__header">
        <h1>{mitglied.full_name}</h1>
        <Marke art={STATUS_ART[mitglied.status]}>{STATUS_TEXT[mitglied.status]}</Marke>
      </div>
      <dl className="kennwerte">
        <dt>E-Mail</dt>
        <dd>{mitglied.email}</dd>
        <dt>Mitglied seit</dt>
        <dd>{datum(mitglied.joined_at)}</dd>
        <dt>Letzte Anmeldung in {betrieb}</dt>
        <dd>{datum(mitglied.last_login_at)}</dd>
      </dl>
      <p className="muted">
        Name, E-Mail-Adresse und Passwort gehören zum persönlichen Konto der Person und lassen sich
        hier nicht ändern.
      </p>
    </div>
  );
}

function Zugang({
  mitglied,
  betrieb,
  onGeaendert,
}: {
  mitglied: MemberOut;
  betrieb: string;
  onGeaendert: () => Promise<void>;
}) {
  const { api, permissions } = useAuth();
  const darfSchreiben = permissions.has("user.account.write");
  const [frage, setFrage] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  const aktiv = mitglied.status === "active";

  const ausfuehren = async () => {
    if (laeuft) return;
    setLaeuft(true);
    setFehler(null);
    try {
      const pfad = { member_id: mitglied.id };
      if (aktiv) {
        await api.post("/api/v1/members/{member_id}/suspend", { path: pfad, ifMatch: mitglied.version });
        setMeldung(`Der Zugang von ${mitglied.full_name} zu ${betrieb} ist gesperrt.`);
      } else {
        await api.post("/api/v1/members/{member_id}/reactivate", {
          path: pfad,
          ifMatch: mitglied.version,
        });
        setMeldung(`Der Zugang von ${mitglied.full_name} zu ${betrieb} ist wieder freigegeben.`);
      }
      setFrage(false);
      await onGeaendert();
    } catch (error) {
      setFehler(verwaltungsfehler(error));
      await onGeaendert();
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <section className="card" aria-labelledby="zugang-titel">
      <h2 id="zugang-titel">Zugang zu {betrieb}</h2>
      {meldung !== null && (
        <p className="alert alert--erfolg" role="status">
          {meldung}
        </p>
      )}
      <p className="muted">
        {aktiv
          ? "Eine Sperre gilt nur für diesen Betrieb. Das persönliche Konto und Zugänge zu anderen Betrieben bleiben bestehen."
          : "Der Zugang ist gesperrt. Nach der Freigabe meldet sich die Person neu an."}
      </p>
      {darfSchreiben &&
        (mitglied.is_self ? (
          <p className="muted">Den eigenen Zugang kann niemand selbst sperren.</p>
        ) : (
          <button
            type="button"
            className={aktiv ? "button button--gefahr" : "button button--primary"}
            onClick={() => {
              setFehler(null);
              setMeldung(null);
              setFrage(true);
            }}
          >
            {aktiv ? "Zugang zu diesem Betrieb sperren" : "Zugang wieder freigeben"}
          </button>
        ))}
      <Bestaetigung
        offen={frage}
        titel={aktiv ? "Zugang sperren?" : "Zugang freigeben?"}
        bestaetigenLabel={aktiv ? "Zugang sperren" : "Zugang freigeben"}
        gefaehrlich={aktiv}
        laeuft={laeuft}
        fehler={fehler}
        onBestaetigen={() => void ausfuehren()}
        onAbbrechen={() => setFrage(false)}
      >
        {aktiv ? (
          <>
            <p>
              <strong>{mitglied.full_name}</strong> kann danach nicht mehr in {betrieb} arbeiten.
              Angemeldete Sitzungen in diesem Betrieb enden sofort.
            </p>
            <p className="muted">
              Das persönliche Konto und Zugänge zu anderen Betrieben bleiben bestehen. Die Sperre
              lässt sich jederzeit aufheben.
            </p>
          </>
        ) : (
          <p>
            <strong>{mitglied.full_name}</strong> kann sich danach wieder in {betrieb} anmelden -
            mit den bisherigen Rollen.
          </p>
        )}
      </Bestaetigung>
    </section>
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
    <section className="card" aria-labelledby="rollen-titel">
      <h2 id="rollen-titel">Rollen</h2>
      <p className="muted">
        Rollen bündeln feste Berechtigungen. Einzelne Rechte lassen sich nicht vergeben -{" "}
        <Link to="/administration/roles">Übersicht der Rollen</Link>.
      </p>
      {meldung !== null && (
        <p className="alert alert--erfolg" role="status">
          {meldung}
        </p>
      )}
      {rollen === undefined ? (
        <p className="muted">Rollen werden geladen ...</p>
      ) : (
        <fieldset className="rollenwahl" disabled={!darfSchreiben || laeuft}>
          <legend className="visuell-versteckt">Rollen von {mitglied.full_name}</legend>
          {rollen.map((rolle) => {
            const id = `rolle-${rolle.key}`;
            const eigeneAdminrolle =
              mitglied.is_self && rolle.key === ADMIN_ROLLE && bisher.includes(ADMIN_ROLLE);
            return (
              <div key={rolle.key} className="rollenwahl__eintrag">
                <input
                  id={id}
                  type="checkbox"
                  checked={gewaehlt.includes(rolle.key)}
                  disabled={eigeneAdminrolle}
                  aria-labelledby={`${id}-name`}
                  aria-describedby={`${id}-zweck`}
                  onChange={(event) => umschalten(rolle.key, event.target.checked)}
                />
                <label htmlFor={id}>
                  <strong id={`${id}-name`}>{rolle.name}</strong>
                  <span id={`${id}-zweck`} className="muted rollenwahl__zweck">
                    {eigeneAdminrolle
                      ? "Die eigene Administratorrolle kann hier niemand selbst entfernen."
                      : rolle.description}
                  </span>
                </label>
              </div>
            );
          })}
        </fieldset>
      )}
      {fehler !== null && !frage && (
        <p className="alert alert--error" role="alert">
          {fehler}
        </p>
      )}
      {darfSchreiben && (
        <div className="button-row">
          <button
            type="button"
            className="button button--primary"
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
              className="button button--ghost"
              disabled={laeuft}
              onClick={() => setAuswahl({ version: mitglied.version, keys: bisher })}
            >
              Änderungen verwerfen
            </button>
          )}
          {gewaehlt.length === 0 && (
            <span className="field__fehler">Mindestens eine Rolle ist nötig.</span>
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
        <p className="muted">Die Änderung gilt sofort, ohne neue Anmeldung.</p>
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
    <section className="card" aria-labelledby="rechte-titel">
      <h2 id="rechte-titel">Was diese Person darf</h2>
      <p className="muted">Ergibt sich aus den Rollen. Steht mehr als eine Rolle dahinter, sind alle genannt.</p>
      {daten.permissions.length === 0 ? (
        <p className="leer">Keine Berechtigungen - der Person ist keine Rolle zugewiesen.</p>
      ) : (
        <div className="rechte">
          {[...bereiche.entries()].map(([bereich, rechte]) => (
            <section key={bereich} className="rechte__bereich" aria-label={bereich}>
              <h3>{bereich}</h3>
              <ul className="rechte__liste">
                {rechte.map((recht) => (
                  <li key={recht.key}>
                    <span>{recht.description || recht.key}</span>
                    <span className="muted rechte__herkunft">
                      {" "}
                      über {recht.granted_by.map((rolle) => rolle.name).join(", ")}
                    </span>
                    <code className="rechte__schluessel">{recht.key}</code>
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
