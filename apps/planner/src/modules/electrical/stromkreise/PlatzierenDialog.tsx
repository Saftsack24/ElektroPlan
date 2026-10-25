import { useState } from "react";

import { Dialog } from "../../../core/ui/Dialog";
import { Auswahl } from "../../../core/ui/Feld";
import { FORMULARRASTER, KNOPFZEILE, knopf } from "../../../core/ui/stil";

export interface Platzierungsraum {
  readonly id: string;
  readonly name: string;
  /** Geschlossene Kontur mit mindestens einer Wand - sonst gibt es keine Wandansicht. */
  readonly moeglich: boolean;
}

export interface Platzierungsgeschoss {
  readonly id: string;
  readonly name: string;
  readonly raeume: readonly Platzierungsraum[];
}

/**
 * Schritt 1 von „Im Plan platzieren“ bzw. „Position ändern“ (Phase 6c, VP):
 * Geschoss und Raum wählen. Die Wand wählt man danach im Grundriss, gesetzt
 * wird in der Wandansicht. Der Dialog speichert nichts.
 */
export function PlatzierenDialog({
  titel,
  geschosse,
  start,
  onWeiter,
  onClose,
}: {
  titel: string;
  geschosse: readonly Platzierungsgeschoss[];
  start: { floorId: string; raumId: string };
  onWeiter: (floorId: string, raumId: string) => void;
  onClose: () => void;
}) {
  const [floorId, setFloorId] = useState(start.floorId);
  const geschoss = geschosse.find((g) => g.id === floorId);
  const moegliche = geschoss?.raeume.filter((r) => r.moeglich) ?? [];
  const [raumId, setRaumId] = useState(start.raumId);
  const raum = moegliche.find((r) => r.id === raumId) ?? null;
  const ohneKontur = (geschoss?.raeume.length ?? 0) - moegliche.length;

  return (
    <Dialog offen titel={titel} beschreibung="Geschoss und Raum wählen – die Wand wählen Sie danach im Grundriss." onClose={onClose}>
      <form
        className={FORMULARRASTER}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (raum !== null) onWeiter(floorId, raum.id);
        }}
      >
        <Auswahl
          id="platzieren-geschoss"
          label="Geschoss"
          value={floorId}
          onChange={(id) => {
            setFloorId(id);
            setRaumId("");
          }}
        >
          {geschosse.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Auswahl>
        <Auswahl id="platzieren-raum" label="Raum" value={raum?.id ?? ""} onChange={setRaumId}>
          <option value="">Bitte wählen</option>
          {moegliche.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Auswahl>
        <p className="col-span-full m-0 text-label text-muted">
          {moegliche.length === 0
            ? "In diesem Geschoss gibt es keinen Raum mit geschlossener Kontur. Bitte zuerst im 2D-Editor einen Raum anlegen."
            : `Danach: im Grundriss eine Wand des Raums anklicken, in der Wandansicht setzen und „Platzierung speichern“.${
                ohneKontur > 0
                  ? ` ${ohneKontur === 1 ? "Ein Raum ohne geschlossene Kontur ist" : `${ohneKontur} Räume ohne geschlossene Kontur sind`} hier nicht wählbar.`
                  : ""
              }`}
        </p>
        <div className={KNOPFZEILE}>
          <button className={knopf("primaer")} type="submit" disabled={raum === null}>
            Weiter zur Wandwahl
          </button>
          <button className={knopf()} type="button" onClick={onClose}>
            Abbrechen
          </button>
        </div>
      </form>
    </Dialog>
  );
}
