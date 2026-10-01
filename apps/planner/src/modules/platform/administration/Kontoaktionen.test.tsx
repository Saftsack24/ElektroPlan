import { ApiError } from "@elektroplan/api-client";
import type { MemberOut } from "@elektroplan/api-client";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Konto und Zugang (Phase 4e, ADR 0021): Bearbeiten, Sperren, Passwortreset
 * mit einmaliger Linkanzeige, Entfernen mit E-Mail-Bestätigung - und die
 * Grenzen (eigenes Konto, letzter Administrator, geteiltes Konto, entfernt).
 */
const { api, zustand } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  zustand: { rechte: new Set<string>() },
}));

vi.mock("../../../core/auth/AuthProvider", () => ({
  useAuth: () => ({ api, permissions: zustand.rechte }),
}));

const { Kontoaktionen } = await import("./Kontoaktionen");

const ALLE = ["user.profile.write", "user.account.lock", "user.password.reset", "user.account.remove"];

function mitglied(teil: Partial<MemberOut> = {}): MemberOut {
  return {
    id: "m1",
    full_name: "Paula Prüfer",
    email: "paula@test.example",
    status: "active",
    lock_reason: null,
    roles: [{ key: "planer", name: "Planer" }],
    is_administrator: false,
    is_self: false,
    is_last_active_administrator: false,
    account_shared: false,
    joined_at: "2026-09-01T08:00:00Z",
    updated_at: "2026-09-20T08:00:00Z",
    last_login_at: null,
    version: 7,
    ...teil,
  };
}

function problem(status: number, typ: string, errors?: { field: string; code: string; message: string }[]) {
  return new ApiError(
    status,
    { type: `https://elektroplan.internal/errors/${typ}`, title: "x", status, detail: "Serverdetail", ...(errors ? { errors } : {}) },
    null,
  );
}

const geaendert = vi.fn(() => Promise.resolve());

function zeigen(daten: MemberOut = mitglied()) {
  render(<Kontoaktionen mitglied={daten} betrieb="Elektro Test GmbH" onGeaendert={geaendert} />);
}

const nativ = { alert: vi.fn(), confirm: vi.fn(), prompt: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  zustand.rechte = new Set(ALLE);
  vi.spyOn(window, "alert").mockImplementation(nativ.alert);
  vi.spyOn(window, "confirm").mockImplementation(nativ.confirm);
  vi.spyOn(window, "prompt").mockImplementation(nativ.prompt);
});

afterEach(() => {
  // Keine nativen Browserdialoge - in keinem Ablauf.
  expect(nativ.alert).not.toHaveBeenCalled();
  expect(nativ.confirm).not.toHaveBeenCalled();
  expect(nativ.prompt).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe("Aktionen und Berechtigungen", () => {
  it("zeigt alle vier Aktionen mit Text und Symbol, wenn die Rechte vorhanden sind", () => {
    zeigen();
    for (const name of ["Name und E-Mail bearbeiten", "Sperren", "Passwort zurücksetzen", "Benutzer entfernen"]) {
      const knopf = screen.getByRole("button", { name });
      expect(knopf).toBeEnabled();
      expect(knopf.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    }
  });

  it("zeigt nur die Aktionen, für die ein Recht vorhanden ist", () => {
    zustand.rechte = new Set(["user.account.lock"]);
    zeigen();
    expect(screen.getByRole("button", { name: "Sperren" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /bearbeiten/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Passwort/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /entfernen/ })).toBeNull();
  });

  it("ohne Recht keine Aktion, nur ein Hinweis", () => {
    zustand.rechte = new Set();
    zeigen();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/fehlt Ihnen die Berechtigung/)).toBeInTheDocument();
  });

  it("erklärt beim letzten aktiven Administrator, warum Sperren und Entfernen fehlen", () => {
    zeigen(mitglied({ is_administrator: true, is_last_active_administrator: true }));
    const sperren = screen.getByRole("button", { name: "Sperren" });
    expect(sperren).toBeDisabled();
    expect(screen.getByRole("button", { name: "Benutzer entfernen" })).toBeDisabled();
    const erklaerung = screen.getByText(/Einziger aktiver Administrator/);
    expect(sperren).toHaveAttribute("aria-describedby", erklaerung.id);
    // Bearbeiten und Zurücksetzen bleiben möglich.
    expect(screen.getByRole("button", { name: "Name und E-Mail bearbeiten" })).toBeEnabled();
  });

  it("erklärt bei einem geteilten Konto, warum Name, E-Mail und Passwort hier nicht gehen", () => {
    zeigen(mitglied({ account_shared: true }));
    expect(screen.getByRole("button", { name: "Name und E-Mail bearbeiten" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Passwort zurücksetzen" })).toBeDisabled();
    expect(screen.getByText(/auch in einem anderen Betrieb verwendet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sperren" })).toBeEnabled();
  });

  it("ein entferntes Konto bietet keine Aktion an", () => {
    zeigen(mitglied({ status: "removed", full_name: null, email: null }));
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/lässt sich nicht bearbeiten, entsperren oder wiederherstellen/)).toBeInTheDocument();
  });
});

describe("Name und E-Mail bearbeiten", () => {
  it("sendet nur geänderte Felder mit If-Match und warnt vor dem Sitzungsende", async () => {
    api.patch.mockResolvedValue(mitglied({ email: "paula.neu@test.example", version: 8 }));
    zeigen();
    fireEvent.click(screen.getByRole("button", { name: "Name und E-Mail bearbeiten" }));
    const dialog = screen.getByRole("dialog", { name: "Name und E-Mail bearbeiten" });
    expect(within(dialog).getByLabelText(/^Name/)).toHaveFocus();
    fireEvent.change(within(dialog).getByLabelText(/E-Mail-Adresse/), { target: { value: " Paula.Neu@Test.example " } });
    expect(within(dialog).getByText(/alle Sitzungen dieser Person/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/api/v1/members/{member_id}", {
        path: { member_id: "m1" },
        ifMatch: 7,
        body: { email: "paula.neu@test.example" },
      }),
    );
    expect(await screen.findByText(/nur noch mit der neuen E-Mail-Adresse/)).toBeInTheDocument();
    expect(geaendert).toHaveBeenCalled();
  });

  it("zeigt eine vergebene Adresse am Feld und behält die Eingabe", async () => {
    api.patch.mockRejectedValue(problem(409, "email-unavailable"));
    zeigen();
    fireEvent.click(screen.getByRole("button", { name: "Name und E-Mail bearbeiten" }));
    const dialog = screen.getByRole("dialog", { name: "Name und E-Mail bearbeiten" });
    fireEvent.change(within(dialog).getByLabelText(/E-Mail-Adresse/), { target: { value: "anna@test.example" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(await within(dialog).findByText(/bereits vergeben oder einer offenen Einladung/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/E-Mail-Adresse/)).toHaveValue("anna@test.example");
    expect(within(dialog).getByLabelText(/E-Mail-Adresse/)).toHaveAttribute("aria-invalid", "true");
  });

  it("erklärt einen Versionskonflikt und lädt neu", async () => {
    api.patch.mockRejectedValue(problem(409, "version-conflict"));
    zeigen();
    fireEvent.click(screen.getByRole("button", { name: "Name und E-Mail bearbeiten" }));
    const dialog = screen.getByRole("dialog", { name: "Name und E-Mail bearbeiten" });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: "Paula Neu" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(await within(dialog).findByText(/inzwischen geändert/)).toBeInTheDocument();
    expect(geaendert).toHaveBeenCalled();
  });

  it("prüft leere Felder schon vor dem Senden; Escape schließt ohne Änderung", () => {
    zeigen();
    fireEvent.click(screen.getByRole("button", { name: "Name und E-Mail bearbeiten" }));
    const dialog = screen.getByRole("dialog", { name: "Name und E-Mail bearbeiten" });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: "  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(within(dialog).getByText("Bitte einen Namen angeben.")).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Passwort zurücksetzen", () => {
  const LINK = "http://localhost:5173/passwort-zuruecksetzen#t=geheimes-token";

  function ausloesen() {
    api.post.mockResolvedValue({
      member_id: "m1",
      delivery: "admin_link",
      reset_url: LINK,
      expires_at: "2026-10-01T15:00:00Z",
    });
    zeigen();
    fireEvent.click(screen.getByRole("button", { name: "Passwort zurücksetzen" }));
    const frage = screen.getByRole("dialog", { name: "Passwort zurücksetzen?" });
    expect(within(frage).getByText(/Sie sehen und setzen es nicht/)).toBeInTheDocument();
    expect(within(frage).getByRole("button", { name: "Abbrechen" })).toHaveFocus();
    fireEvent.click(within(frage).getByRole("button", { name: "Link erzeugen" }));
  }

  it("zeigt den Link genau einmal mit Ablaufzeit und Einmal-Hinweis", async () => {
    ausloesen();
    const dialog = await screen.findByRole("dialog", { name: "Link zum Zurücksetzen" });
    expect(api.post).toHaveBeenCalledWith("/api/v1/members/{member_id}/password-reset", { path: { member_id: "m1" } });
    expect(within(dialog).getByLabelText("Einmal-Link")).toHaveValue(LINK);
    expect(within(dialog).getByText(/nur jetzt angezeigt/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Ein neuer Link macht diesen ungültig/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Fertig" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // Nach dem Schließen ist der Link nirgends mehr im Dokument.
    expect(document.body.innerHTML).not.toContain("geheimes-token");
  });

  it("kopiert den Link in die Zwischenablage", async () => {
    const schreiben = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText: schreiben }, configurable: true });
    ausloesen();
    const dialog = await screen.findByRole("dialog", { name: "Link zum Zurücksetzen" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Link kopieren" }));
      await Promise.resolve();
    });
    expect(schreiben).toHaveBeenCalledWith(LINK);
    expect(within(dialog).getByText("Der Link ist in der Zwischenablage.")).toBeInTheDocument();
  });

  it("markiert den Link verständlich, wenn Kopieren nicht möglich ist", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(() => Promise.reject(new Error("verweigert"))) },
      configurable: true,
    });
    ausloesen();
    const dialog = await screen.findByRole("dialog", { name: "Link zum Zurücksetzen" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Link kopieren" }));
      await Promise.resolve();
    });
    expect(within(dialog).getByText(/Kopieren ist hier nicht möglich/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Einmal-Link")).toHaveFocus();
  });

  it("erklärt einen fehlenden Zustellweg", async () => {
    api.post.mockRejectedValue(problem(503, "password-reset-delivery-unavailable"));
    zeigen();
    fireEvent.click(screen.getByRole("button", { name: "Passwort zurücksetzen" }));
    const frage = screen.getByRole("dialog", { name: "Passwort zurücksetzen?" });
    fireEvent.click(within(frage).getByRole("button", { name: "Link erzeugen" }));
    expect(await within(frage).findByText(/noch kein Zustellweg eingerichtet/)).toBeInTheDocument();
  });
});

describe("Benutzer entfernen", () => {
  it("verlangt die E-Mail-Adresse und warnt deutlich vor dem endgültigen Entfernen", async () => {
    api.post.mockResolvedValue(mitglied({ status: "removed", full_name: null, email: null }));
    zeigen();
    fireEvent.click(screen.getByRole("button", { name: "Benutzer entfernen" }));
    const dialog = screen.getByRole("dialog", { name: "Benutzer endgültig entfernen?" });
    expect(within(dialog).getByText("Das lässt sich nicht rückgängig machen.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Abbrechen" })).toHaveFocus();
    const entfernen = within(dialog).getByRole("button", { name: "Endgültig entfernen" });
    expect(entfernen).toBeDisabled();
    const feld = within(dialog).getByLabelText(/Zur Bestätigung die E-Mail-Adresse eingeben/);
    fireEvent.change(feld, { target: { value: "paula@test" } });
    expect(entfernen).toBeDisabled();
    fireEvent.change(feld, { target: { value: " PAULA@test.example " } });
    expect(entfernen).toBeEnabled();
    fireEvent.click(entfernen);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/members/{member_id}/remove", {
        path: { member_id: "m1" },
        ifMatch: 7,
        body: { confirm_email: "PAULA@test.example" },
      }),
    );
    expect(await screen.findByText("Der Benutzer wurde entfernt.")).toBeInTheDocument();
  });

  it("zeigt die Ablehnung des Servers (letzter Administrator) im Dialog", async () => {
    api.post.mockRejectedValue(problem(409, "last-administrator"));
    zeigen();
    fireEvent.click(screen.getByRole("button", { name: "Benutzer entfernen" }));
    const dialog = screen.getByRole("dialog", { name: "Benutzer endgültig entfernen?" });
    fireEvent.change(within(dialog).getByLabelText(/Zur Bestätigung/), { target: { value: "paula@test.example" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Endgültig entfernen" }));
    expect(await within(dialog).findByText(/mindestens einen aktiven Administrator/)).toBeInTheDocument();
  });
});
