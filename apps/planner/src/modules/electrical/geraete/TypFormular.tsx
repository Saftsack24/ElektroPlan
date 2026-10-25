import { ApiError } from "@elektroplan/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { KeyboardEvent } from "react";

import { useAuth } from "../../../core/auth/AuthProvider";
import { DialogAktionen } from "../../../core/ui/Dialog";
import { Auswahl, Feld, Schalter } from "../../../core/ui/Feld";
import { Marke } from "../../../core/ui/Marke";
import { useMasse } from "../../../core/ui/masseinheit";
import { useRueckfrage } from "../../../core/ui/Rueckfrage";
import { FELD_FEHLER, FELD_HINWEIS, FORMULARRASTER, FORMULARRASTER_BLOCK, FORMULARRASTER_LEGENDE, knopf, meldungsflaeche } from "../../../core/ui/stil";
import type { Geraetetyp } from "./katalog";
import { EIGENE_KATEGORIEN, FLAECHE_LABEL, KATEGORIE_LABEL, istVerwendet, katalogSchluessel } from "./katalog";
import { Geraetesymbol, SYMBOL_LABEL, WAEHLBARE_SYMBOLE, symbolFuerKategorie } from "./symbole";
import type { EigeneKategorie, Typfehler, Typwerte } from "./typen";
import { alsNeuerTyp, typAenderung, typFehlerText, typFeldfehler, typPruefen, typwerteAus, verwendungText } from "./typen";

/**
 * Eigenen Gerätetyp anlegen oder bearbeiten (Phase 6c, K2, ADR 0030) – im Katalogdialog und
 * auf „Elektro-Vorgaben“ dasselbe Formular.
 *
 * * Symbol nur aus den mitgelieferten Zeichnungen (kein Upload); die Verteilung ist weder
 *   Kategorie noch Symbol eines eigenen Typs.
 * * **Bestandsschutz:** Ist der Typ verwendet, sind Kategorie und Planungsmaß gesperrt; eine
 *   Fläche mit Geräten weist der Server zurück. Ein neues Symbol erscheint bei allen Geräten
 *   des Typs – das bestätigt eine Rückfrage mit deren Anzahl.
 * * „Als neuen Typ anlegen“ übernimmt die Eingaben in einen neuen Typ; der alte bleibt.
 * * Ändern prüft die Version (`If-Match`); bei einem Konflikt bleiben die Eingaben erhalten.
 *
 * Nach dem Speichern wird der Katalog neu geladen – Auswahllisten zeigen den Typ ohne Neuladen.
 */
export function TypFormular({
  stand: anfangsstand,
  start,
  onGespeichert,
  onAbbrechen,
  onEntwurf,
}: {
  /** `null` = neuer Typ. */
  stand: Geraetetyp | null;
  start: Typwerte;
  onGespeichert: (typ: Geraetetyp) => Promise<void> | void;
  onAbbrechen: () => void;
  /** Meldet jede Eingabe – der Katalog bewahrt so den Entwurf, solange er offen ist. */
  onEntwurf?: ((werte: Typwerte) => void) | undefined;
}) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const masse = useMasse();
  const fragen = useRueckfrage();
  const id = useId();
  const [stand, setStand] = useState<Geraetetyp | null>(anfangsstand);
  const [werte, setWerteRoh] = useState<Typwerte>(start);
  const [felder, setFelder] = useState<Typfehler>({});
  const [fehler, setFehler] = useState<string | null>(null);
  const [konflikt, setKonflikt] = useState(false);
  const [laeuft, setLaeuft] = useState(false);

  const verwendet = stand !== null && istVerwendet(stand);
  const gesperrt = laeuft;
  const setWerte = (neu: Typwerte) => {
    setWerteRoh(neu);
    onEntwurf?.(neu);
  };
  const setze = (feld: keyof Typwerte) => (wert: string) => setWerte({ ...werte, [feld]: wert });

  const kategorieWaehlen = (wert: string) => {
    const kategorie = wert as EigeneKategorie | "";
    // Das Symbol folgt der Kategorie, solange es nicht bewusst anders gewählt wurde.
    const folgt = werte.symbol === "" || (werte.kategorie !== "" && werte.symbol === symbolFuerKategorie(werte.kategorie));
    setWerte({ ...werte, kategorie, symbol: folgt && kategorie !== "" ? symbolFuerKategorie(kategorie) : werte.symbol });
  };

  const symbolTaste = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const schritt = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (schritt === 0) return;
    event.preventDefault();
    const ziel = Math.min(Math.max(index + schritt, 0), WAEHLBARE_SYMBOLE.length - 1);
    const key = WAEHLBARE_SYMBOLE[ziel];
    if (key === undefined) return;
    setWerte({ ...werte, symbol: key });
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=radio]")[ziel]?.focus();
  };

  const absenden = async () => {
    if (laeuft) return;
    const geprueft = typPruefen(werte, masse);
    if (!geprueft.ok) {
      setFelder(geprueft.fehler);
      setFehler("Bitte die markierten Angaben prüfen.");
      return;
    }
    setFelder({});
    const body = geprueft.body;
    if (stand !== null && stand.device_count > 0 && body.symbol_key !== stand.symbol_key) {
      const antwort = await fragen({
        titel: "Symbol ändern?",
        text: (
          <p>
            Das neue Symbol erscheint bei {stand.device_count === 1 ? "dem vorhandenen Gerät" : `allen ${stand.device_count} vorhandenen Geräten`} vom Typ „
            {stand.label}“ in Grundriss, Wand-, Decken- und 3D-Ansicht. Lage, Maß und Zuordnung bleiben unverändert.
          </p>
        ),
        bestaetigenLabel: stand.device_count === 1 ? "Symbol für 1 Gerät ändern" : `Symbol für ${stand.device_count} Geräte ändern`,
        abbrechenLabel: "Zurück zum Formular",
      });
      if (antwort !== "bestaetigt") return;
    }
    setLaeuft(true);
    setFehler(null);
    try {
      const gespeichert =
        stand === null
          ? await api.post("/api/v1/modules/electrical/device-types", { body })
          : await api.patch("/api/v1/modules/electrical/device-types/{key}", { path: { key: stand.key }, ifMatch: stand.version, body: typAenderung(stand, body) });
      await queryClient.invalidateQueries({ queryKey: katalogSchluessel() });
      await onGespeichert(gespeichert);
    } catch (error: unknown) {
      setKonflikt(error instanceof ApiError && error.errorType === "version-conflict");
      setFelder(typFeldfehler(error));
      setFehler(typFehlerText(error, "Der Gerätetyp konnte nicht gespeichert werden. Ihre Eingaben sind erhalten."));
    } finally {
      setLaeuft(false);
    }
  };

  const serverstandLaden = async () => {
    if (stand === null) return;
    await queryClient.invalidateQueries({ queryKey: katalogSchluessel() });
    const liste = queryClient.getQueryData<Geraetetyp[]>(katalogSchluessel()) ?? [];
    const frisch = liste.find((t) => t.key === stand.key);
    if (frisch === undefined) {
      setFehler("Diesen Gerätetyp gibt es nicht mehr.");
      return;
    }
    setStand(frisch);
    setWerte(typwerteAus(frisch, masse));
    setKonflikt(false);
    setFehler(null);
    setFelder({});
  };

  const alsNeu = () => {
    setStand(null);
    setWerte(alsNeuerTyp(werte));
    setFelder({});
    setFehler(null);
    setKonflikt(false);
  };

  const sperrhinweis = verwendet ? `Gesperrt – verwendet von ${verwendungText(stand)}.` : undefined;
  const formId = `${id}-typ`;
  return (
    <div className="flex flex-col gap-2" data-testid="typformular">
      <div className="flex flex-wrap items-center gap-2 text-small">
        <Marke art="info">eigener Typ</Marke>
        {stand !== null && <span className="text-muted">{verwendungText(stand)}</span>}
        {stand === null && <span className="text-muted">Neu – Schlüssel vergibt ElektroPlan.</span>}
      </div>
      {verwendet && (
        <p className={meldungsflaeche("schlicht")} role="status" data-testid="typ-bestandsschutz">
          Dieser Typ wird verwendet. Kategorie und Planungsmaß bleiben, damit vorhandene Geräte nicht still ihre Bedeutung oder ihr Maß ändern. Für eine
          Variante „Als neuen Typ anlegen“.
        </p>
      )}
      <form
        id={formId}
        className={FORMULARRASTER}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void absenden();
        }}
      >
        <Feld id={`${id}-name`} label="Name" required value={werte.name} disabled={gesperrt} fehler={felder.name} hinweis="Z. B. „Herdanschluss“." onChange={setze("name")} />
        <Auswahl id={`${id}-kategorie`} label="Kategorie" required value={werte.kategorie} disabled={gesperrt || verwendet} fehler={felder.kategorie} onChange={kategorieWaehlen}>
          <option value="">Bitte wählen …</option>
          {EIGENE_KATEGORIEN.map((k) => (
            <option key={k} value={k}>
              {KATEGORIE_LABEL[k]}
            </option>
          ))}
        </Auswahl>
        <div className="col-span-full">
          <Feld id={`${id}-beschreibung`} label="Beschreibung" value={werte.beschreibung} disabled={gesperrt} fehler={felder.beschreibung} onChange={setze("beschreibung")} />
        </div>
        {verwendet && <p className={`${FELD_HINWEIS} col-span-full m-0`}>{sperrhinweis}</p>}

        <fieldset className={FORMULARRASTER_BLOCK} aria-describedby={felder.symbol !== undefined ? `${id}-symbol-fehler` : undefined}>
          <legend className={FORMULARRASTER_LEGENDE}>Symbol *</legend>
          <div role="radiogroup" aria-label="Symbol" className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-1.5">
            {WAEHLBARE_SYMBOLE.map((key, i) => {
              const gewaehlt = werte.symbol === key;
              const tabbar = gewaehlt || (werte.symbol === "" && i === 0);
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={gewaehlt}
                  tabIndex={tabbar ? 0 : -1}
                  disabled={gesperrt}
                  className={`flex flex-col items-center gap-1 rounded-ep border p-1.5 text-[0.78rem] text-fg ${gewaehlt ? "border-selected bg-selected-soft" : "border-line bg-surface"}`}
                  onClick={() => setWerte({ ...werte, symbol: key })}
                  onKeyDown={(e) => symbolTaste(e, i)}
                  data-testid={`typ-symbol-${key}`}
                >
                  <Geraetesymbol typ={{ symbol_key: key, category: werte.kategorie === "" ? "socket" : werte.kategorie }} groesse={22} />
                  <span>{SYMBOL_LABEL[key] ?? key}</span>
                </button>
              );
            })}
          </div>
          {felder.symbol !== undefined && (
            <span id={`${id}-symbol-fehler`} className={FELD_FEHLER} role="alert">
              {felder.symbol}
            </span>
          )}
          {stand !== null && stand.device_count > 0 && <p className={`${FELD_HINWEIS} m-0 mt-1`}>Ein neues Symbol erscheint bei allen Geräten dieses Typs.</p>}
        </fieldset>

        <fieldset className={FORMULARRASTER_BLOCK}>
          <legend className={FORMULARRASTER_LEGENDE}>Montageflächen *</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Schalter id={`${id}-innen`} label={FLAECHE_LABEL.wall_interior} checked={werte.innen} disabled={gesperrt} onChange={(an) => setWerte({ ...werte, innen: an })} />
            <Schalter id={`${id}-aussen`} label={FLAECHE_LABEL.wall_exterior} checked={werte.aussen} disabled={gesperrt} onChange={(an) => setWerte({ ...werte, aussen: an })} />
            <Schalter id={`${id}-decke`} label={FLAECHE_LABEL.ceiling} checked={werte.decke} disabled={gesperrt} onChange={(an) => setWerte({ ...werte, decke: an })} />
          </div>
          {felder.flaechen !== undefined && (
            <span className={FELD_FEHLER} role="alert">
              {felder.flaechen}
            </span>
          )}
          {verwendet && <p className={`${FELD_HINWEIS} m-0 mt-1`}>Eine Fläche, auf der Geräte dieses Typs sitzen, bleibt erhalten.</p>}
        </fieldset>

        <Feld
          id={`${id}-breite`}
          label={masse.label("Planungsmaß Breite")}
          required
          inputMode="decimal"
          value={werte.breite}
          disabled={gesperrt || verwendet}
          fehler={felder.breite}
          hinweis={verwendet ? "Gesperrt." : "Prüfmaß der Platzierung, keine Herstellerangabe."}
          onChange={setze("breite")}
        />
        <Feld
          id={`${id}-tiefe`}
          label={masse.label("Planungsmaß Höhe")}
          required
          inputMode="decimal"
          value={werte.tiefe}
          disabled={gesperrt || verwendet}
          fehler={felder.tiefe}
          hinweis={verwendet ? "Gesperrt." : "An der Decke: Ausdehnung in y."}
          onChange={setze("tiefe")}
        />
        <Feld
          id={`${id}-hoehe`}
          label={masse.label("Standardhöhe Mitte")}
          inputMode="decimal"
          value={werte.hoehe}
          disabled={gesperrt}
          fehler={felder.hoehe}
          hinweis="Startwert an der Wand – keine Norm. Leer: keine Vorgabe."
          onChange={setze("hoehe")}
        />
        <Feld id={`${id}-reihenfolge`} label="Reihenfolge in Listen" inputMode="numeric" value={werte.reihenfolge} disabled={gesperrt} fehler={felder.reihenfolge} onChange={setze("reihenfolge")} />
        <div className="col-span-full">
          <Schalter id={`${id}-aktiv`} label="Aktiv (für neue Geräte wählbar)" checked={werte.aktiv} disabled={gesperrt} onChange={(an) => setWerte({ ...werte, aktiv: an })} />
        </div>
      </form>
      {fehler !== null && (
        <div className={meldungsflaeche()} role="alert">
          <p className="m-0">{fehler}</p>
          {konflikt && (
            <button type="button" className={`${knopf("neutral", { klein: true })} mt-2`} onClick={() => void serverstandLaden()}>
              Serverstand laden (Eingaben verwerfen)
            </button>
          )}
        </div>
      )}
      <DialogAktionen>
        <button type="submit" form={formId} className={knopf("primaer")} disabled={laeuft}>
          {laeuft ? "Wird gespeichert …" : stand === null ? "Typ anlegen" : "Speichern"}
        </button>
        {stand !== null && (
          <button type="button" className={knopf("neutral")} disabled={laeuft} onClick={alsNeu}>
            Als neuen Typ anlegen
          </button>
        )}
        <button type="button" className={knopf()} disabled={laeuft} onClick={onAbbrechen}>
          Abbrechen
        </button>
      </DialogAktionen>
    </div>
  );
}
