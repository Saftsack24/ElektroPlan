import { ApiError } from "@elektroplan/api-client";
import { useState } from "react";

import { useAuth } from "../../../core/auth/AuthProvider";
import { Dialog, DialogAktionen } from "../../../core/ui/Dialog";
import { Feld, Schalter } from "../../../core/ui/Feld";
import { FORMULARRASTER, knopf, meldungsflaeche } from "../../../core/ui/stil";
import { querschnittAlsEingabe, querschnittLesen } from "../stromkreise/daten";
import type { Kabelvorlage } from "./daten";
import { apiFehlerText, fehlerText } from "./fehler";

interface Vorlagenwerte {
  readonly name: string;
  readonly typ: string;
  readonly leiter: string;
  readonly querschnitt: string;
  readonly aktiv: boolean;
  readonly reihenfolge: string;
}

type Feld = "name" | "typ" | "leiter" | "querschnitt" | "reihenfolge";

function werteAus(v: Kabelvorlage | null): Vorlagenwerte {
  return v === null
    ? { name: "", typ: "", leiter: "", querschnitt: "", aktiv: true, reihenfolge: "0" }
    : {
        name: v.name,
        typ: v.cable_type,
        leiter: String(v.conductor_count),
        querschnitt: querschnittAlsEingabe(v.cross_section_mm2),
        aktiv: v.is_active,
        reihenfolge: String(v.sort_order),
      };
}

const SERVERFELD: Record<string, Feld> = {
  name: "name",
  cable_type: "typ",
  conductor_count: "leiter",
  cross_section_mm2: "querschnitt",
  sort_order: "reihenfolge",
};

/**
 * Technische Kabelvorlage anlegen oder bearbeiten (Phase 6c, Entwurf §8.1) – **ohne Preis**,
 * ohne Bemessung. Ändern prüft die Version (`If-Match`); bei einem Konflikt bleiben die
 * Eingaben erhalten, der Serverstand wird nur auf Wunsch geladen. Eine Änderung schreibt keine
 * bestehende Leitung um.
 */
export function VorlageDialog({
  vorlage,
  onGespeichert,
  onClose,
}: {
  /** `null` = neue Vorlage. */
  vorlage: Kabelvorlage | null;
  onGespeichert: (v: Kabelvorlage) => Promise<void> | void;
  onClose: () => void;
}) {
  const { api } = useAuth();
  const [stand, setStand] = useState<Kabelvorlage | null>(vorlage);
  const [werte, setWerte] = useState<Vorlagenwerte>(() => werteAus(vorlage));
  const [felder, setFelder] = useState<Partial<Record<Feld, string>>>({});
  const [fehler, setFehler] = useState<string | null>(null);
  const [konflikt, setKonflikt] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const setze = (feld: keyof Vorlagenwerte) => (wert: string) => setWerte({ ...werte, [feld]: wert });

  const pruefen = () => {
    const f: Partial<Record<Feld, string>> = {};
    if (werte.name.trim() === "") f.name = "Bitte einen Namen angeben.";
    if (werte.typ.trim() === "") f.typ = "Bitte den Leitungstyp angeben.";
    const leiter = Number(werte.leiter.trim());
    if (!/^\d{1,3}$/.test(werte.leiter.trim()) || leiter < 1 || leiter > 100) f.leiter = "Bitte eine ganze Zahl von 1 bis 100.";
    const q = querschnittLesen(werte.querschnitt);
    if (!q.ok) f.querschnitt = q.fehler;
    else if (q.wert === null) f.querschnitt = "Bitte den Querschnitt angeben.";
    const reihe = Number(werte.reihenfolge.trim() === "" ? "0" : werte.reihenfolge.trim());
    if (!Number.isInteger(reihe) || reihe < 0 || reihe > 10_000) f.reihenfolge = "Bitte eine ganze Zahl von 0 bis 10 000.";
    setFelder(f);
    if (Object.keys(f).length > 0 || !q.ok || q.wert === null) return null;
    return { name: werte.name.trim(), cable_type: werte.typ.trim(), conductor_count: leiter, cross_section_mm2: q.wert, is_active: werte.aktiv, sort_order: reihe };
  };

  const absenden = async () => {
    if (laeuft) return;
    const body = pruefen();
    if (body === null) return;
    setLaeuft(true);
    setFehler(null);
    try {
      const gespeichert =
        stand === null
          ? await api.post("/api/v1/modules/electrical/cable-templates", { body })
          : await api.patch("/api/v1/modules/electrical/cable-templates/{template_id}", { path: { template_id: stand.id }, ifMatch: stand.version, body });
      await onGespeichert(gespeichert);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.errorType === "version-conflict") {
        setKonflikt(true);
        setFehler("Diese Vorlage wurde inzwischen an anderer Stelle geändert. Ihre Eingaben sind erhalten und wurden nicht gespeichert.");
      } else {
        const f: Partial<Record<Feld, string>> = {};
        if (error instanceof ApiError) {
          for (const e of error.problem?.errors ?? []) {
            const feld = SERVERFELD[e.field];
            if (feld !== undefined) f[feld] = fehlerText(e.code, e.message);
          }
        }
        setFelder(f);
        setFehler(apiFehlerText(error, "Die Vorlage konnte nicht gespeichert werden."));
      }
    } finally {
      setLaeuft(false);
    }
  };

  const serverstandLaden = async () => {
    if (stand === null) return;
    const liste = await api.get("/api/v1/modules/electrical/cable-templates");
    const frisch = liste.templates.find((t) => t.id === stand.id) ?? null;
    if (frisch === null) {
      setFehler("Die Vorlage gibt es nicht mehr.");
      return;
    }
    setStand(frisch);
    setWerte(werteAus(frisch));
    setKonflikt(false);
    setFehler(null);
  };

  return (
    <Dialog offen titel={vorlage === null ? "Kabelvorlage anlegen" : "Kabelvorlage bearbeiten"} onClose={onClose}>
      <p className="m-0 text-small text-muted">
        Technische Angaben des Betriebs für neue Leitungen – kein Preis, keine Bemessung. Bestehende Leitungen behalten ihre Angaben.
      </p>
      <form
        id="vorlage-formular"
        className={FORMULARRASTER}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void absenden();
        }}
      >
        <Feld id="vorlage-name" label="Name" required value={werte.name} disabled={laeuft} fehler={felder.name} hinweis="Z. B. „Steckdosenkreis“." onChange={setze("name")} />
        <Feld id="vorlage-typ" label="Leitungstyp" required value={werte.typ} disabled={laeuft} fehler={felder.typ} onChange={setze("typ")} />
        <Feld id="vorlage-leiter" label="Leiteranzahl" required inputMode="numeric" value={werte.leiter} disabled={laeuft} fehler={felder.leiter} onChange={setze("leiter")} />
        <Feld id="vorlage-querschnitt" label="Querschnitt in mm²" required inputMode="decimal" value={werte.querschnitt} disabled={laeuft} fehler={felder.querschnitt} onChange={setze("querschnitt")} />
        <Feld id="vorlage-reihenfolge" label="Reihenfolge in Listen" inputMode="numeric" value={werte.reihenfolge} disabled={laeuft} fehler={felder.reihenfolge} onChange={setze("reihenfolge")} />
        <div className="self-end">
          <Schalter id="vorlage-aktiv" label="Aktiv (wird neuen Leitungen vorgeschlagen)" checked={werte.aktiv} disabled={laeuft} onChange={(an) => setWerte({ ...werte, aktiv: an })} />
        </div>
      </form>
      {fehler !== null && (
        <div className={`${meldungsflaeche()} mt-3`} role="alert">
          <p className="m-0">{fehler}</p>
          {konflikt && (
            <button type="button" className={`${knopf("neutral", { klein: true })} mt-2`} onClick={() => void serverstandLaden()}>
              Serverstand laden (Eingaben verwerfen)
            </button>
          )}
        </div>
      )}
      <DialogAktionen>
        <button type="submit" form="vorlage-formular" className={knopf("primaer")} disabled={laeuft}>
          {laeuft ? "Wird gespeichert …" : "Speichern"}
        </button>
        <button type="button" className={knopf()} disabled={laeuft} onClick={onClose}>
          Abbrechen
        </button>
      </DialogAktionen>
    </Dialog>
  );
}
