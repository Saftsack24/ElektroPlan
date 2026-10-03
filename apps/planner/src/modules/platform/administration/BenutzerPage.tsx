import type { DirectoryEntryOut } from "@elektroplan/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { alsFormularfehler } from "../../../core/api/fehler";
import { useAuth } from "../../../core/auth/AuthProvider";
import { Bestaetigung } from "../../../core/ui/Bestaetigung";
import { Marke } from "../../../core/ui/Marke";
import { useEntprellt } from "../../../core/ui/useEntprellt";
import { FELD, FELD_BESCHRIFTUNG, FILTERZEILE, KARTENKOPF, STAPEL, TABELLE, TABELLENRAHMEN, eingabefeld, karte, knopf, meldungsflaeche } from "../../../core/ui/stil";
import { AdminNavigation } from "./AdminNavigation";
import { EinladenDialog } from "./EinladenDialog";
import type { EinladungsWerte } from "./EinladenDialog";
import { Entwicklungslink } from "./Entwicklungslink";
import {
  ENTFERNTER_BENUTZER,
  STATUSFILTER,
  STATUS_ART,
  STATUS_TEXT,
  datum,
  istVerzeichnisstatus,
  verwaltungsfehler,
} from "./texte";
import type { Verzeichnisstatus } from "./texte";
import { useSeitenweise } from "./useSeitenweise";
import { AKTION } from "../../../core/ui/aktionssymbole";
import { MitSymbol, Symbol } from "../../../core/ui/Symbol";

export const SEITENGROESSE = 25;

type Einladungsaktion = { art: "widerrufen" | "neu"; eintrag: DirectoryEntryOut };

/**
 * Administration → Benutzer.
 *
 * Eine Liste für Mitglieder **und** offene Einladungen, serverseitig
 * sortiert, gesucht und gefiltert: Aktiv, Gesperrt, Einladungen, Entfernt.
 * Entfernte Konten erscheinen nur in ihrer eigenen Ansicht und neutral, ohne
 * Name und E-Mail. Bearbeitet, gesperrt, zurückgesetzt und entfernt wird in
 * der Detailansicht eines Mitglieds; Einladungen lassen sich hier widerrufen
 * oder neu ausstellen - jeweils nach Rückfrage.
 */
export default function BenutzerPage() {
  const { api, permissions } = useAuth();
  const queryClient = useQueryClient();
  const [parameter, setParameter] = useSearchParams();
  const darfSchreiben = permissions.has("user.account.write");
  const darfEinladen = darfSchreiben && permissions.has("role.assignment.write");

  const startstatus = parameter.get("status");
  const [status, setStatus] = useState<Verzeichnisstatus | "">(
    istVerzeichnisstatus(startstatus) ? startstatus : "",
  );
  const [suche, setSuche] = useState("");
  const begriff = useEntprellt(suche.trim());
  const [dialogOffen, setDialogOffen] = useState(false);
  const [ausgestellt, setAusgestellt] = useState<{ text: string; link: string | null } | null>(
    null,
  );
  const [aktion, setAktion] = useState<Einladungsaktion | null>(null);
  const [aktionLaeuft, setAktionLaeuft] = useState(false);
  const [aktionFehler, setAktionFehler] = useState<string | null>(null);

  // Aufruf aus der Startseite: ".../users?einladen=1" öffnet den Dialog.
  useEffect(() => {
    if (parameter.get("einladen") === "1") {
      if (darfEinladen) setDialogOffen(true);
      const rest = new URLSearchParams(parameter);
      rest.delete("einladen");
      setParameter(rest, { replace: true });
    }
  }, [parameter, setParameter, darfEinladen]);

  const liste = useSeitenweise<DirectoryEntryOut>({
    schluessel: ["members", "liste", begriff, status],
    laden: (cursor) =>
      api.get("/api/v1/members", {
        query: {
          limit: SEITENGROESSE,
          ...(begriff ? { q: begriff } : {}),
          ...(status ? { status } : {}),
          ...(cursor ? { cursor } : {}),
        },
      }),
  });

  const rollen = useQuery({
    queryKey: ["roles"],
    queryFn: () => api.get("/api/v1/roles"),
    enabled: dialogOffen,
  });
  const richtlinie = useQuery({
    queryKey: ["invitations", "policy"],
    queryFn: () => api.get("/api/v1/invitations/policy"),
    enabled: dialogOffen,
  });

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["members"] });

  const einladen = async (werte: EinladungsWerte) => {
    try {
      const ergebnis = await api.post("/api/v1/invitations", {
        body: {
          email: werte.email,
          role_keys: werte.rollen,
          ...(werte.name ? { full_name: werte.name } : {}),
        },
      });
      setDialogOffen(false);
      setAusgestellt({
        text: `Einladung für ${ergebnis.invitation.email} wurde erstellt.`,
        link: ergebnis.development_activation_url ?? null,
      });
      await neuLaden();
      return undefined;
    } catch (error) {
      const formular = alsFormularfehler(error, ["email", "full_name", "role_keys"] as const);
      return formular.felder ? formular : { fehler: verwaltungsfehler(error) };
    }
  };

  const aktionAusfuehren = async () => {
    if (aktion === null || aktionLaeuft) return;
    setAktionLaeuft(true);
    setAktionFehler(null);
    try {
      const pfad = { invitation_id: aktion.eintrag.id };
      if (aktion.art === "widerrufen") {
        await api.post("/api/v1/invitations/{invitation_id}/revoke", {
          path: pfad,
          ifMatch: aktion.eintrag.version,
        });
        setAusgestellt({ text: `Die Einladung für ${aktion.eintrag.email} wurde widerrufen.`, link: null });
      } else {
        const ergebnis = await api.post("/api/v1/invitations/{invitation_id}/reissue", {
          path: pfad,
          ifMatch: aktion.eintrag.version,
        });
        setAusgestellt({
          text: `Die Einladung für ${aktion.eintrag.email} wurde neu ausgestellt. Der bisherige Link gilt nicht mehr.`,
          link: ergebnis.development_activation_url ?? null,
        });
      }
      setAktion(null);
      await neuLaden();
    } catch (error) {
      setAktionFehler(verwaltungsfehler(error));
      await neuLaden();
    } finally {
      setAktionLaeuft(false);
    }
  };

  const gefiltert = begriff.length > 0 || status !== "";

  return (
    <div className={STAPEL}>
      <section className={karte()}>
        <div className={KARTENKOPF}>
          <div>
            <p className="m-0 text-[0.8rem] tracking-[0.04em] text-muted uppercase">Administration</p>
            <h1>Benutzer</h1>
          </div>
          {darfEinladen && (
            <button
              type="button"
              className={knopf("primaer")}
              onClick={() => {
                setAusgestellt(null);
                setDialogOffen(true);
              }}
            >
              <MitSymbol icon={AKTION.einladen}>Benutzer einladen</MitSymbol>
            </button>
          )}
        </div>
        <AdminNavigation />

        {ausgestellt !== null && (
          <div className={meldungsflaeche("erfolg")} role="status">
            <p>{ausgestellt.text}</p>
            <Entwicklungslink link={ausgestellt.link} />
            <button type="button" className={knopf()} onClick={() => setAusgestellt(null)}>
              Hinweis schließen
            </button>
          </div>
        )}

        <div className={FILTERZEILE}>
          <div className={FELD}>
            <label className={FELD_BESCHRIFTUNG} htmlFor="benutzersuche">
              Suche (Name oder E-Mail)
            </label>
            <input
              id="benutzersuche"
              className={eingabefeld()}
              type="search"
              value={suche}
              onChange={(event) => setSuche(event.target.value)}
            />
          </div>
          <div className={FELD}>
            <label className={FELD_BESCHRIFTUNG} htmlFor="benutzerstatus">
              Status
            </label>
            <select
              id="benutzerstatus"
              className={eingabefeld()}
              value={status}
              onChange={(event) => {
                const wert = event.target.value;
                setStatus(istVerzeichnisstatus(wert) ? wert : "");
              }}
            >
              {STATUSFILTER.map((filter) => (
                <option key={filter.wert} value={filter.wert}>
                  {filter.text}
                </option>
              ))}
            </select>
          </div>
        </div>

        {liste.laedt && <p className="text-muted">Benutzer werden geladen ...</p>}
        {liste.fehlgeschlagen && (
          <p className={meldungsflaeche()} role="alert">
            Die Benutzerliste konnte nicht geladen werden.{" "}
            <button type="button" className={knopf()} onClick={liste.erneutVersuchen}>
              Erneut versuchen
            </button>
          </p>
        )}
        {liste.geladen &&
          (liste.eintraege.length === 0 ? (
            <p className="py-3 text-muted *:my-1">
              {status === "removed" && begriff.length > 0
                ? "Entfernte Konten lassen sich nicht nach Name oder E-Mail suchen - beides ist nicht mehr gespeichert."
                : gefiltert
                  ? "Keine Treffer für diese Suche oder diesen Filter."
                  : "Noch keine weiteren Benutzer. Laden Sie Kolleginnen und Kollegen ein."}
            </p>
          ) : (
            <Benutzertabelle
              eintraege={liste.eintraege}
              darfSchreiben={darfSchreiben}
              onAktion={(neu) => {
                setAktionFehler(null);
                setAktion(neu);
              }}
            />
          ))}

        {liste.geladen && (liste.hatZurueck || liste.hatWeiter) && (
          <nav className="mt-3 flex flex-wrap items-center gap-3" aria-label="Seiten der Benutzerliste">
            <button
              type="button"
              className={knopf()}
              disabled={!liste.hatZurueck || liste.wechselt}
              onClick={liste.zurueck}
            >
              <MitSymbol icon={AKTION.zurueck}>Zurück</MitSymbol>
            </button>
            <span aria-live="polite">Seite {liste.seite}</span>
            <button
              type="button"
              className={knopf()}
              disabled={!liste.hatWeiter || liste.wechselt}
              onClick={liste.weiter}
            >
              <span className="inline-flex items-center gap-1.5">
                Weiter <Symbol icon={AKTION.weiter} />
              </span>
            </button>
          </nav>
        )}
      </section>

      {darfEinladen && (
        <EinladenDialog
          offen={dialogOffen}
          rollen={rollen.data}
          richtlinie={richtlinie.data}
          onSubmit={einladen}
          onClose={() => setDialogOffen(false)}
        />
      )}

      <Bestaetigung
        offen={aktion !== null}
        titel={aktion?.art === "widerrufen" ? "Einladung widerrufen?" : "Einladung neu ausstellen?"}
        bestaetigenLabel={aktion?.art === "widerrufen" ? "Einladung widerrufen" : "Neu ausstellen"}
        gefaehrlich={aktion?.art === "widerrufen"}
        laeuft={aktionLaeuft}
        fehler={aktionFehler}
        onBestaetigen={() => void aktionAusfuehren()}
        onAbbrechen={() => setAktion(null)}
      >
        {aktion?.art === "widerrufen" ? (
          <p>
            Der Einladungslink für <strong>{aktion.eintrag.email}</strong> wird sofort ungültig.
            Es wird kein Konto angelegt.
          </p>
        ) : (
          <p>
            Für <strong>{aktion?.eintrag.email}</strong> wird ein neuer Link mit neuer Frist
            erzeugt. Der bisherige Link gilt danach nicht mehr.
          </p>
        )}
      </Bestaetigung>
    </div>
  );
}

function Benutzertabelle({
  eintraege,
  darfSchreiben,
  onAktion,
}: {
  eintraege: DirectoryEntryOut[];
  darfSchreiben: boolean;
  onAktion: (aktion: Einladungsaktion) => void;
}) {
  return (
    <div className={TABELLENRAHMEN}>
      <table className={TABELLE}>
        <caption className="sr-only">Benutzer und offene Einladungen</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">E-Mail</th>
            <th scope="col">Status</th>
            <th scope="col">Rollen</th>
            {/* Auf schmalen Flächen entfallen die Zeitspalten; die Detailansicht zeigt sie. */}
            <th scope="col" className="max-md:hidden">
              Erstellt am
            </th>
            <th scope="col" className="max-md:hidden">
              Zuletzt geändert
            </th>
            <th scope="col" className="max-lg:hidden">
              Letzte Anmeldung
            </th>
            <th scope="col">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {eintraege.map((eintrag) => {
            const entfernt = eintrag.status === "removed";
            const anzeigename = entfernt ? ENTFERNTER_BENUTZER : (eintrag.full_name ?? undefined);
            return (
              <tr key={`${eintrag.kind}-${eintrag.id}`}>
                <td>
                  {eintrag.kind === "member" ? (
                    <Link
                      to={`/administration/users/${eintrag.id}`}
                      className={entfernt ? "text-muted" : undefined}
                    >
                      {anzeigename}
                    </Link>
                  ) : (
                    (eintrag.full_name ?? <span className="text-muted">—</span>)
                  )}
                </td>
                <td className="wrap-anywhere">
                  {entfernt ? (
                    <span className="text-muted">
                      —<span className="sr-only"> (nicht mehr gespeichert)</span>
                    </span>
                  ) : (
                    eintrag.email
                  )}
                </td>
                <td>
                  {eintrag.kind === "invitation" && eintrag.invitation_expired ? (
                    <Marke art="warnung">Einladung abgelaufen</Marke>
                  ) : (
                    <Marke art={STATUS_ART[eintrag.status]}>{STATUS_TEXT[eintrag.status]}</Marke>
                  )}
                </td>
                <td>{eintrag.roles.map((rolle) => rolle.name).join(", ") || "—"}</td>
                <td className="max-md:hidden">{datum(eintrag.created_at)}</td>
                <td className="max-md:hidden">{datum(eintrag.updated_at)}</td>
                <td className="max-lg:hidden">
                  {eintrag.kind === "invitation"
                    ? `gültig bis ${datum(eintrag.invitation_expires_at)}`
                    : datum(eintrag.last_login_at)}
                </td>
                {/* Die Zelle bleibt eine Tabellenzelle (kein Flex direkt am <td>): Sonst fällt
                    sie aus dem Tabellenlayout und ihre Trennlinien liegen versetzt. */}
                <td>
                  <div className="flex flex-wrap gap-1.5 whitespace-nowrap">
                    {eintrag.kind === "member" ? (
                      !entfernt && (
                        <Link to={`/administration/users/${eintrag.id}`}>
                          Verwalten<span className="sr-only"> ({eintrag.full_name})</span>
                        </Link>
                      )
                    ) : (
                      darfSchreiben && (
                        <>
                          <button
                            type="button"
                            className={knopf("neutral", { klein: true })}
                            onClick={() => onAktion({ art: "neu", eintrag })}
                          >
                            Neu ausstellen
                            <span className="sr-only"> ({eintrag.email})</span>
                          </button>
                          <button
                            type="button"
                            className={knopf("neutral", { klein: true })}
                            onClick={() => onAktion({ art: "widerrufen", eintrag })}
                          >
                            Widerrufen<span className="sr-only"> ({eintrag.email})</span>
                          </button>
                        </>
                      )
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
