import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "./Dialog";
import { RueckfrageProvider, useRueckfrage, useVerlassenBestaetigen } from "./Rueckfrage";
import type { Rueckfrageantwort } from "./Rueckfrage";
import { aktiveScrollsperren } from "./scrollsperre";
import { useUngespeicherteAenderungen } from "./ungespeichert";

function Ausloeser({ onAntwort }: { onAntwort: (a: Rueckfrageantwort) => void }) {
  const fragen = useRueckfrage();
  const stellen = () =>
    void fragen({ titel: "Wirklich?", text: <p>Konkrete Situation.</p>, bestaetigenLabel: "Weiter" }).then(onAntwort);
  return (
    <button type="button" onClick={stellen}>
      Fragen
    </button>
  );
}

function Aktion({ aktion, ungespeichert }: { aktion: () => void; ungespeichert: boolean }) {
  useUngespeicherteAenderungen(ungespeichert);
  const verlassen = useVerlassenBestaetigen();
  return (
    <button type="button" onClick={() => void verlassen("Weg?", "Sie gehen.", aktion)}>
      Los
    </button>
  );
}

describe("Eigene Rückfrage", () => {
  it("benennt die Situation, fokussiert die sichere Wahl und antwortet genau einmal", async () => {
    const antworten = vi.fn();
    render(
      <RueckfrageProvider>
        <Ausloeser onAntwort={antworten} />
      </RueckfrageProvider>,
    );
    fireEvent.click(screen.getByText("Fragen"));
    const dialog = await screen.findByRole("dialog", { name: "Wirklich?" });
    expect(within(dialog).getByText("Konkrete Situation.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Abbrechen" })).toHaveFocus();

    const weiter = within(dialog).getByRole("button", { name: "Weiter" });
    fireEvent.click(weiter);
    fireEvent.click(weiter);
    await waitFor(() => expect(antworten).toHaveBeenCalledTimes(1));
    expect(antworten).toHaveBeenCalledWith("bestaetigt");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape bricht ab und gibt den Fokus zurück", async () => {
    const antworten = vi.fn();
    render(
      <RueckfrageProvider>
        <Ausloeser onAntwort={antworten} />
      </RueckfrageProvider>,
    );
    const knopf = screen.getByText("Fragen");
    knopf.focus();
    fireEvent.click(knopf);
    fireEvent(await screen.findByRole("dialog"), new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(antworten).toHaveBeenCalledWith("abgebrochen"));
    expect(knopf).toHaveFocus();
  });

  it("gibt den Fokus auch unter StrictMode an den Auslöser zurück (Browser mit inert-Hintergrund)", async () => {
    // Wie im Browser: Hinter einem modalen Dialog ist die Seite inert und
    // nimmt keinen Fokus an. jsdom setzt das nicht um - hier nachgebildet.
    const echt = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "focus")?.value as (
      this: HTMLElement,
    ) => void;
    const spion = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement) {
      const modal = document.querySelector("dialog[open]");
      if (modal !== null && !modal.contains(this)) return;
      echt.call(this);
    });
    const antworten = vi.fn();
    render(
      <StrictMode>
        <RueckfrageProvider>
          <Ausloeser onAntwort={antworten} />
        </RueckfrageProvider>
      </StrictMode>,
    );
    const knopf = screen.getByText("Fragen");
    knopf.focus();
    fireEvent.click(knopf);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Abbrechen" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(knopf).toHaveFocus());
    spion.mockRestore();
  });

  it("beantwortet eine zweite gleichzeitige Frage sofort mit Abbruch", async () => {
    const antworten = vi.fn();
    render(
      <RueckfrageProvider>
        <Ausloeser onAntwort={antworten} />
      </RueckfrageProvider>,
    );
    fireEvent.click(screen.getByText("Fragen"));
    fireEvent.click(screen.getByText("Fragen", { selector: "button" }));
    await waitFor(() => expect(antworten).toHaveBeenCalledWith("abgebrochen"));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("führt die Aktion ohne ungespeicherte Änderungen sofort und genau einmal aus", async () => {
    const aktion = vi.fn();
    render(
      <RueckfrageProvider>
        <Aktion aktion={aktion} ungespeichert={false} />
      </RueckfrageProvider>,
    );
    fireEvent.click(screen.getByText("Los"));
    await waitFor(() => expect(aktion).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("führt die Aktion mit ungespeicherten Änderungen erst nach Bestätigung genau einmal aus", async () => {
    const aktion = vi.fn();
    render(
      <StrictMode>
        <RueckfrageProvider>
          <Aktion aktion={aktion} ungespeichert />
        </RueckfrageProvider>
      </StrictMode>,
    );
    fireEvent.click(screen.getByText("Los"));
    fireEvent.click(screen.getByText("Los"));
    const dialog = await screen.findByRole("dialog", { name: "Weg?" });
    expect(within(dialog).getByText("Sie gehen.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Änderungen verwerfen und fortfahren" }));
    await waitFor(() => expect(aktion).toHaveBeenCalledTimes(1));
    await act(() => Promise.resolve());
    expect(aktion).toHaveBeenCalledTimes(1);
  });

  it("ohne Provider ist das ein Programmierfehler, kein stilles Weiter", () => {
    const fehler = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Ausloeser onAntwort={vi.fn()} />)).toThrow(/RueckfrageProvider/);
    fehler.mockRestore();
  });
});

function ZweiDialoge() {
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setA(true)}>
        A
      </button>
      <button type="button" onClick={() => setB(true)}>
        B
      </button>
      <Dialog offen={a} titel="Erster" onClose={() => setA(false)}>
        <button type="button" onClick={() => setB(true)}>
          B öffnen
        </button>
      </Dialog>
      <Dialog offen={b} titel="Zweiter" onClose={() => setB(false)}>
        <p>zwei</p>
      </Dialog>
    </>
  );
}

describe("Seiten-Sperre hinter Dialogen", () => {
  it("sperrt die Seite und stellt sie erst nach dem letzten Dialog wieder her", () => {
    document.documentElement.style.overflow = "auto";
    render(
      <StrictMode>
        <ZweiDialoge />
      </StrictMode>,
    );
    fireEvent.click(screen.getByText("A"));
    expect(document.documentElement.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByText("B öffnen"));
    expect(aktiveScrollsperren()).toBe(2);

    fireEvent(screen.getByRole("dialog", { name: "Erster" }), new Event("cancel", { cancelable: true }));
    expect(document.documentElement.style.overflow).toBe("hidden");
    fireEvent(screen.getByRole("dialog", { name: "Zweiter" }), new Event("cancel", { cancelable: true }));
    expect(aktiveScrollsperren()).toBe(0);
    expect(document.documentElement.style.overflow).toBe("auto");
    document.documentElement.style.overflow = "";
  });
});
