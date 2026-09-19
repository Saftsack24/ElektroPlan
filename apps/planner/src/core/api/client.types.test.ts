import { createApiClient } from "@elektroplan/api-client";
import type { AuditEntryOut, MeResponse } from "@elektroplan/api-client";
import { describe, expect, expectTypeOf, it } from "vitest";

/**
 * Compile-Zeit-Tests des API-Clients (Punkt 13).
 *
 * Die Aufrufe in `typpruefungen` werden nie ausgefuehrt - geprueft wird allein
 * durch `tsc --noEmit`. Jeder `@ts-expect-error`-Marker schlaegt fehl, wenn der
 * betreffende Aufruf doch typpruefbar waere.
 */
const api = createApiClient({
  baseUrl: "http://localhost:8000",
  getAccessToken: () => null,
});

function typpruefungen(): void {
  // @ts-expect-error - dieser Pfad existiert nicht im Schema
  void api.get("/api/v1/gibt-es-nicht");

  // @ts-expect-error - Pfadparameter file_id fehlt
  void api.get("/api/v1/files/{file_id}", {});

  // @ts-expect-error - "password" fehlt, "unbekannt" gibt es nicht
  void api.post("/api/v1/auth/login", { body: { unbekannt: 1 } });

  // @ts-expect-error - /api/v1/me kennt keine POST-Methode
  void api.post("/api/v1/me");

  // Gueltige Aufrufe muessen weiterhin uebersetzen.
  void api.get("/api/v1/files/{file_id}", { path: { file_id: "abc" } });
  void api.post("/api/v1/auth/login", { body: { email: "a@b.de", password: "geheim" } });
  void api.get("/api/v1/audit", { query: { limit: 10 } });
  void api.post("/api/v1/auth/logout");

  // Antworttypen stammen aus dem Schema, nicht aus einer Behauptung des
  // Aufrufers. Auch diese Zusicherungen prueft ausschliesslich tsc.
  expectTypeOf(api.get("/api/v1/me")).resolves.toEqualTypeOf<MeResponse>();
  expectTypeOf(api.get("/api/v1/audit", { query: {} }))
    .resolves.toHaveProperty("items")
    .toEqualTypeOf<AuditEntryOut[]>();
}

describe("API-Client-Typen", () => {
  it("prueft Pfade, Parameter, Body und Antworttypen zur Uebersetzungszeit", () => {
    // Der Nachweis liegt in `tsc --noEmit`; zur Laufzeit wird nichts gesendet.
    expect(typeof typpruefungen).toBe("function");
  });
});
