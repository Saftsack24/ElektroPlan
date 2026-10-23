import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { AKTION } from "../../../core/ui/aktionssymbole";
import { Dialog, DialogAktionen } from "../../../core/ui/Dialog";
import { useMasse } from "../../../core/ui/masseinheit";
import { Menue } from "../../../core/ui/Menue";
import { KNOPF_GRUND, knopf } from "../../../core/ui/stil";
import { Symbol } from "../../../core/ui/Symbol";
import { SymbolKnopf } from "../../../core/ui/SymbolKnopf";
import { RASTERGROESSEN_MM } from "../editor/fang";
import { useKompakt } from "./kompakt";

/**
 * Gemeinsame Bausteine der Werkzeugleiste (Phase 6c, L1): Grundriss, Wand und
 * Decke zeigen dieselben Gruppen in derselben Reihenfolge – Auswahl · Raum ·
 * Öffnung · Gerät · Leitung · Verlauf · Ansicht. Seltenes (Fang, Raster, Hilfe,
 * Legende) steht im Menü „Ansicht“.
 *
 * Schmal (unter 60 rem, `useKompakt`) stehen die Werkzeuge als Symbolknöpfe da – Name,
 * Kürzel und Erklärung im Hinweis bei Zeigen und Fokus –, Gruppen mit mehreren
 * gleichartigen Werkzeugen (Raum, Öffnung) als Menü. „Leitung hinzufügen“ bleibt mit
 * Symbol **und** Text oben.
 */

/** Werkzeugknopf: kleiner als ein Formularknopf, gesperrt deutlich blasser. */
export const WERKZEUG = `${KNOPF_GRUND} border-control bg-surface px-2.5 py-[5px] text-small text-fg disabled:cursor-not-allowed disabled:opacity-45`;
export const WERKZEUG_AKTIV = `${KNOPF_GRUND} border-accent bg-accent px-2.5 py-[5px] text-small text-on-accent disabled:cursor-not-allowed disabled:opacity-45`;

/** Eine Gruppe der Werkzeugleiste, optisch durch einen Trennstrich abgesetzt. */
export function Werkzeuggruppe({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1 border-l border-line pl-2 first:border-l-0 first:pl-0" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/** Ein Werkzeug: sichtbarer Kurztext, zugänglicher Name, Kürzel im Hinweis, `aria-pressed`. */
export function Werkzeugknopf({
  label,
  text,
  taste,
  aktiv,
  hinweis,
  icon,
  onClick,
}: {
  label: string;
  /** Sichtbarer Text, wenn kürzer als der Name (etwa „Rechteck“ für „Rechteckraum“). */
  text?: string;
  taste: string;
  aktiv: boolean;
  hinweis?: string;
  /** Symbol für die kompakte Darstellung; ohne Symbol bleibt der Text auch schmal. */
  icon?: LucideIcon;
  onClick: () => void;
}) {
  const kompakt = useKompakt();
  if (kompakt && icon !== undefined) {
    return (
      <SymbolKnopf
        icon={icon}
        label={label}
        {...(hinweis !== undefined ? { beschreibung: hinweis } : {})}
        kuerzel={taste}
        ariaKuerzel={taste}
        gedrueckt={aktiv}
        onClick={onClick}
      />
    );
  }
  return (
    <button
      type="button"
      className={aktiv ? WERKZEUG_AKTIV : WERKZEUG}
      aria-pressed={aktiv}
      aria-label={text === undefined ? undefined : label}
      aria-keyshortcuts={taste}
      title={`${hinweis ?? label} (${taste})`}
      onClick={onClick}
    >
      {text ?? label}
    </button>
  );
}

/** Ein Werkzeug einer `Werkzeugwahl`. */
export interface Werkzeugeintrag {
  readonly label: string;
  readonly text?: string;
  readonly taste: string;
  readonly aktiv: boolean;
  readonly hinweis?: string;
  readonly icon: LucideIcon;
  readonly onClick: () => void;
}

/**
 * Gleichartige Werkzeuge einer Gruppe (Raum: Rechteck/Polygon; Öffnung: Tür/Fenster/Durchgang).
 * Breit stehen sie einzeln da; schmal als ein Menü, dessen Knopf das gewählte Werkzeug zeigt
 * und hervorgehoben ist, solange eines daraus aktiv ist. Kürzel wirken in beiden Fällen.
 */
export function Werkzeugwahl({
  gruppe,
  menueLabel,
  icon,
  werkzeuge,
}: {
  gruppe: string;
  /** Zugänglicher Name des Menüknopfs, etwa „Raum zeichnen“. */
  menueLabel: string;
  icon: LucideIcon;
  werkzeuge: readonly Werkzeugeintrag[];
}) {
  const kompakt = useKompakt();
  if (!kompakt) {
    return (
      <Werkzeuggruppe label={gruppe}>
        {werkzeuge.map((w) => (
          <Werkzeugknopf
            key={w.label}
            label={w.label}
            {...(w.text !== undefined ? { text: w.text } : {})}
            taste={w.taste}
            aktiv={w.aktiv}
            {...(w.hinweis !== undefined ? { hinweis: w.hinweis } : {})}
            onClick={w.onClick}
          />
        ))}
      </Werkzeuggruppe>
    );
  }
  const aktiv = werkzeuge.find((w) => w.aktiv);
  return (
    <Werkzeuggruppe label={gruppe}>
      <Menue
        label={aktiv === undefined ? menueLabel : `${menueLabel}: ${aktiv.label}`}
        icon={aktiv?.icon ?? icon}
        gedrueckt={aktiv !== undefined}
        abschnitte={[{ punkte: werkzeuge.map((w) => ({ art: "wahl" as const, label: w.label, kuerzel: w.taste, gewaehlt: w.aktiv, onWahl: w.onClick })) }]}
      />
    </Werkzeuggruppe>
  );
}

/**
 * „Leitung hinzufügen“ – immer oben auffindbar, ohne vorher ein Gerät zu wählen.
 * L1-Zwischenstand: führt in den **bestehenden** Ablauf (Leitungsliste mit
 * Stromkreiswahl im Eigenschaftenpanel); der neue Zeichenablauf folgt mit L2.
 * Schmal bleibt er mit Symbol und kurzem Text „Leitung“ sichtbar – kein reines Symbol.
 */
export function LeitungHinzufuegenKnopf({ aktiv, gesperrtGrund, onClick }: { aktiv: boolean; gesperrtGrund: string | null; onClick: () => void }) {
  const kompakt = useKompakt();
  return (
    <SymbolKnopf
      icon={AKTION.leitungHinzufuegen}
      label="Leitung hinzufügen"
      text={kompakt ? "Leitung" : "Leitung hinzufügen"}
      kuerzel="L"
      ariaKuerzel="L"
      gedrueckt={aktiv}
      gesperrt={gesperrtGrund !== null}
      {...(gesperrtGrund !== null ? { gesperrtGrund } : {})}
      onClick={onClick}
    />
  );
}

/** Kompakte Ansichtssteuerung: verkleinern, vergrößern, alles zeigen. */
export function Zoomgruppe({ onZoom, onGanz, ganzHinweis }: { onZoom: (faktor: number) => void; onGanz: () => void; ganzHinweis: string }) {
  return (
    <Werkzeuggruppe label="Zoom">
      <button type="button" className={WERKZEUG} aria-label="Verkleinern" title="Verkleinern (−)" onClick={() => onZoom(0.8)}>
        <Symbol icon={AKTION.verkleinern} />
      </button>
      <button type="button" className={WERKZEUG} aria-label="Vergrößern" title="Vergrößern (+)" onClick={() => onZoom(1.25)}>
        <Symbol icon={AKTION.vergroessern} />
      </button>
      <button type="button" className={WERKZEUG} aria-label="Ansicht zurücksetzen" title={`${ganzHinweis} (F)`} onClick={onGanz}>
        <Symbol icon={AKTION.ganzZeigen} />
      </button>
    </Werkzeuggruppe>
  );
}

/** Menü „Ansicht“: Fang, Raster, Hilfe und Legende – seltenere Einstellungen. */
export function AnsichtMenue({
  fangAktiv,
  onFang,
  fangLabel = "Fang",
  rasterMm,
  onRaster,
  onHilfe,
}: {
  fangAktiv: boolean;
  onFang: (aktiv: boolean) => void;
  fangLabel?: string;
  rasterMm: number;
  onRaster: (mm: number) => void;
  onHilfe: () => void;
}) {
  const masse = useMasse();
  const kompakt = useKompakt();
  return (
    <Menue
      label="Ansicht und Hilfe"
      {...(kompakt ? {} : { text: "Ansicht" })}
      icon={AKTION.ansichtEinstellungen}
      amEnde
      abschnitte={[
        { punkte: [{ art: "schalter", label: `${fangLabel} (Alt setzt beim Ziehen aus)`, gewaehlt: fangAktiv, onWahl: () => onFang(!fangAktiv) }] },
        {
          titel: "Raster",
          punkte: RASTERGROESSEN_MM.map((mm) => ({ art: "wahl" as const, label: `Raster ${masse.anzeigen(mm)}`, gewaehlt: rasterMm === mm, onWahl: () => onRaster(mm) })),
        },
        { punkte: [{ label: "Bedienung, Tastenkürzel und Legende …", onWahl: onHilfe }] },
      ]}
    />
  );
}

/**
 * Hilfe zur Fläche im Dialog statt dauerhaft unter der Zeichenfläche.
 *
 * Der Inhalt (Bedienliste, Gerätelegende) entsteht nur, solange der Dialog offen ist:
 * Geschlossen kostete er bei jedem Neuzeichnen der Fläche Zeit, ohne sichtbar zu sein.
 * Der Dialog selbst bleibt eingehängt und regelt Fokus und Rückgabe wie bisher.
 */
export function HilfeDialog({ offen, titel, onClose, children }: { offen: boolean; titel: string; onClose: () => void; children: ReactNode }) {
  return (
    <Dialog offen={offen} titel={titel} onClose={onClose}>
      <div className="text-[0.9rem]">{offen ? children : null}</div>
      <DialogAktionen>
        <button type="button" className={knopf("primaer")} onClick={onClose}>
          Schließen
        </button>
      </DialogAktionen>
    </Dialog>
  );
}
