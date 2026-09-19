/**
 * Automatischer Test der Frontend-Modulgrenzen. Nutzt genau die
 * Funktion aus ``scripts/module-boundaries.mjs``, die auch in der
 * Produktion (``npm run check:boundaries``) und in ``tasks.ps1 check``
 * ausgefuehrt wird. So koennen Test und Regel nicht auseinanderlaufen.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Der Import wird von Vitest zur Laufzeit aufgeloest. Sollte die
// Produktivfunktion umziehen, scheitert dieser Test - genau das ist
// gewuenscht.
// @ts-expect-error: Node/ESM-JS-Modul ohne Typdeklaration
import { checkModuleBoundaries as productionCheck } from "../../../scripts/module-boundaries.mjs";

// Enger Aufruf-Wrapper mit Typ, damit ESLint-Type-Checks nicht
// "Unsafe call" melden. Die Funktion wird zur Laufzeit weiter aus dem
// mjs-Modul aufgeloest.
const checkModuleBoundaries = productionCheck as (opts: {
  srcRoot: string;
}) => Promise<Violation[]>;

interface Violation {
  file: string;
  line: number;
  specifier: string;
  reason: string;
  kind: string;
  source: { kind: string; moduleId: string | null };
  target: { kind: string; moduleId: string | null } | null;
}

function fixtureRoot(name: string): string {
  const root = join(tmpdir(), `elektroplan-boundaries-${name}-${Math.random()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function write(root: string, relativePath: string, content: string): void {
  const target = join(root, relativePath);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content, "utf-8");
}

async function run(root: string): Promise<Violation[]> {
  return await checkModuleBoundaries({ srcRoot: root });
}

function violationsFor(vs: Violation[], filename: string): Violation[] {
  const normalized = filename.replaceAll("/", "\\").replaceAll("\\", "/");
  return vs.filter((v) => {
    const normalizedFile = v.file.replaceAll("\\", "/");
    return normalizedFile.endsWith(normalized);
  });
}

// ------------------------------------------------------------- statische Regeln

describe("Frontend-Modulgrenzen: statische Imports", () => {
  it("blockiert Sibling-Import ../andereModul", async () => {
    const root = fixtureRoot("sibling");
    write(root, "modules/electrical/index.ts", "export {};\n");
    write(root, "modules/electrical/PlanPage.tsx", `import x from "../audit";\n`);
    write(root, "modules/audit/index.ts", "export const a = 1;\n");

    const vs = await run(root);
    const filtered = violationsFor(vs, "PlanPage.tsx");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.reason).toMatch(/fremdem Modul 'audit'/);
  });

  it("blockiert Sibling-Import ../anderesModul/internal", async () => {
    const root = fixtureRoot("sibling-internal");
    write(root, "modules/electrical/index.ts", "export {};\n");
    write(root, "modules/electrical/PlanPage.tsx", `import x from "../audit/AuditPage";\n`);
    write(root, "modules/audit/AuditPage.tsx", "export default () => null;\n");

    const vs = await run(root);
    expect(violationsFor(vs, "PlanPage.tsx")).toHaveLength(1);
  });

  it("blockiert Umgehungspfad ../../modules/anderesModul", async () => {
    const root = fixtureRoot("via-modules");
    write(root, "modules/electrical/index.ts", "export {};\n");
    write(
      root,
      "modules/electrical/PlanPage.tsx",
      `import x from "../../modules/audit";\n`,
    );
    write(root, "modules/audit/index.ts", "export const a = 1;\n");

    const vs = await run(root);
    expect(violationsFor(vs, "PlanPage.tsx")).toHaveLength(1);
  });

  it("blockiert Alias @/modules/audit auf fremdes Modul", async () => {
    const root = fixtureRoot("alias");
    write(root, "modules/electrical/index.ts", "export {};\n");
    write(root, "modules/electrical/PlanPage.tsx", `import x from "@/modules/audit";\n`);
    write(root, "modules/audit/index.ts", "export const a = 1;\n");

    const vs = await run(root);
    expect(violationsFor(vs, "PlanPage.tsx")).toHaveLength(1);
  });

  it("blockiert Re-Export eines fremden Moduls", async () => {
    const root = fixtureRoot("reexport");
    write(root, "modules/electrical/index.ts", "export {};\n");
    write(root, "modules/electrical/PlanPage.tsx", `export { a } from "../audit";\n`);
    write(root, "modules/audit/index.ts", "export const a = 1;\n");

    const vs = await run(root);
    expect(violationsFor(vs, "PlanPage.tsx")).toHaveLength(1);
    expect(violationsFor(vs, "PlanPage.tsx")[0]!.kind).toBe("reexport");
  });

  it("blockiert core -> konkretes Modul", async () => {
    const root = fixtureRoot("core-to-module");
    write(root, "modules/audit/index.ts", "export const a = 1;\n");
    write(root, "core/api/client.ts", `import x from "@/modules/audit";\n`);

    const vs = await run(root);
    const filtered = violationsFor(vs, "client.ts");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.reason).toMatch(/core/);
  });

  // ---------- die neuen App-Regeln ----------

  it("blockiert app -> ../modules/audit (oeffentlicher Modul-Index)", async () => {
    const root = fixtureRoot("app-relative-public");
    write(root, "modules/audit/index.ts", "export const a = 1;\n");
    write(root, "app/App.tsx", `import { a } from "../modules/audit";\n`);

    const vs = await run(root);
    const filtered = violationsFor(vs, "App.tsx");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.reason).toMatch(/zentrale Fassade/);
  });

  it("blockiert app -> @/modules/audit (oeffentlicher Modul-Index)", async () => {
    const root = fixtureRoot("app-alias-public");
    write(root, "modules/audit/index.ts", "export const a = 1;\n");
    write(root, "app/App.tsx", `import { a } from "@/modules/audit";\n`);

    const vs = await run(root);
    const filtered = violationsFor(vs, "App.tsx");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.reason).toMatch(/zentrale Fassade/);
  });

  it("blockiert app -> ../modules/audit/AuditPage (Interna)", async () => {
    const root = fixtureRoot("app-internal");
    write(root, "modules/audit/AuditPage.tsx", "export default () => null;\n");
    write(root, "app/App.tsx", `import x from "../modules/audit/AuditPage";\n`);

    const vs = await run(root);
    const filtered = violationsFor(vs, "App.tsx");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.reason).toMatch(/Interna/);
  });

  it("erlaubt app -> ../modules (Composition-Root-Fassade)", async () => {
    const root = fixtureRoot("app-to-root");
    write(root, "modules/index.ts", "export const registry = 1;\n");
    write(root, "app/App.tsx", `import { registry } from "../modules";\n`);

    const vs = await run(root);
    expect(violationsFor(vs, "App.tsx")).toEqual([]);
  });

  it("erlaubt app -> Core", async () => {
    const root = fixtureRoot("app-to-core");
    write(root, "core/auth/AuthProvider.tsx", "export const useAuth = () => null;\n");
    write(root, "app/App.tsx", `import { useAuth } from "../core/auth/AuthProvider";\n`);

    const vs = await run(root);
    expect(violationsFor(vs, "App.tsx")).toEqual([]);
  });

  it("erlaubt Composition Root -> oeffentlicher Modul-Index", async () => {
    const root = fixtureRoot("root-index");
    write(root, "modules/audit/index.ts", "export const a = 1;\n");
    write(root, "modules/index.ts", `import { a } from "./audit";\n`);

    const vs = await run(root);
    expect(violationsFor(vs, "modules/index.ts")).toEqual([]);
  });

  it("blockiert Composition Root -> Modul-Interna", async () => {
    const root = fixtureRoot("root-internals");
    write(root, "modules/audit/AuditPage.tsx", "export default () => null;\n");
    write(root, "modules/index.ts", `import x from "./audit/AuditPage";\n`);

    const vs = await run(root);
    const filtered = violationsFor(vs, "modules/index.ts");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.reason).toMatch(/Interna/);
  });

  it("erlaubt eigenes Modul -> eigene Datei", async () => {
    const root = fixtureRoot("self");
    write(root, "modules/audit/index.ts", `import x from "./AuditPage";\n`);
    write(root, "modules/audit/AuditPage.tsx", "export default () => null;\n");

    const vs = await run(root);
    expect(violationsFor(vs, "modules/audit/index.ts")).toEqual([]);
  });

  it("erlaubt Modul -> Core (../../core/**)", async () => {
    const root = fixtureRoot("module-to-core");
    write(root, "core/auth/AuthProvider.tsx", "export const useAuth = () => null;\n");
    write(
      root,
      "modules/audit/AuditPage.tsx",
      `import { useAuth } from "../../core/auth/AuthProvider";\n`,
    );

    const vs = await run(root);
    expect(violationsFor(vs, "modules/audit/AuditPage.tsx")).toEqual([]);
  });
});

// ------------------------------------------------------------- dynamische Imports

describe("Frontend-Modulgrenzen: dynamische Imports", () => {
  it("blockiert Modul A -> Modul B ueber import('../b')", async () => {
    const root = fixtureRoot("dyn-sibling");
    write(root, "modules/audit/index.ts", "export const a = 1;\n");
    write(
      root,
      "modules/electrical/plan.ts",
      `async function go(){ await import("../audit"); }\nexport{go};\n`,
    );

    const vs = await run(root);
    const filtered = violationsFor(vs, "modules/electrical/plan.ts");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.kind).toBe("dynamic");
    expect(filtered[0]!.reason).toMatch(/fremdem Modul 'audit'/);
  });

  it("blockiert Modul A -> Interna von B ueber import('../b/internal')", async () => {
    const root = fixtureRoot("dyn-internal");
    write(root, "modules/audit/AuditPage.tsx", "export default () => null;\n");
    write(
      root,
      "modules/electrical/plan.ts",
      `export const p = () => import("../audit/AuditPage");\n`,
    );

    const vs = await run(root);
    expect(violationsFor(vs, "modules/electrical/plan.ts")).toHaveLength(1);
  });

  it("blockiert core -> Modul ueber import('@/modules/audit')", async () => {
    const root = fixtureRoot("dyn-core-to-module");
    write(root, "modules/audit/index.ts", "export const a = 1;\n");
    write(
      root,
      "core/api/client.ts",
      `export const load = () => import("@/modules/audit");\n`,
    );

    const vs = await run(root);
    expect(violationsFor(vs, "client.ts")).toHaveLength(1);
  });

  it("blockiert app -> oeffentlichen Modul-Index ueber dynamischen Import", async () => {
    const root = fixtureRoot("dyn-app-public");
    write(root, "modules/audit/index.ts", "export const a = 1;\n");
    write(root, "app/App.tsx", `export const p = () => import("../modules/audit");\n`);

    const vs = await run(root);
    expect(violationsFor(vs, "App.tsx")).toHaveLength(1);
  });

  it("blockiert app -> Modul-Interna ueber lazy(() => import(...))", async () => {
    const root = fixtureRoot("dyn-app-lazy");
    write(root, "modules/audit/AuditPage.tsx", "export default () => null;\n");
    write(
      root,
      "app/App.tsx",
      `const p = /* fake */ () => import("../modules/audit/AuditPage");\nexport{p};\n`,
    );

    const vs = await run(root);
    expect(violationsFor(vs, "App.tsx")).toHaveLength(1);
    expect(violationsFor(vs, "App.tsx")[0]!.kind).toBe("dynamic");
  });

  it("blockiert Composition Root -> Interna ueber dynamischen Import", async () => {
    const root = fixtureRoot("dyn-root-internals");
    write(root, "modules/audit/AuditPage.tsx", "export default () => null;\n");
    write(root, "modules/index.ts", `export const p = () => import("./audit/AuditPage");\n`);

    const vs = await run(root);
    expect(violationsFor(vs, "modules/index.ts")).toHaveLength(1);
  });

  it("meldet dynamischen Template-Ausdruck als dynamic-non-literal", async () => {
    const root = fixtureRoot("dyn-template");
    write(root, "modules/audit/index.ts", "export const a = 1;\n");
    write(
      root,
      "modules/electrical/plan.ts",
      "export const p = (n:string) => import(`../${n}`);\n",
    );

    const vs = await run(root);
    const filtered = violationsFor(vs, "plan.ts");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.kind).toBe("dynamic-non-literal");
  });

  it("meldet dynamischen Variablenimport als dynamic-non-literal", async () => {
    const root = fixtureRoot("dyn-variable");
    write(
      root,
      "modules/electrical/plan.ts",
      "export const p = (target:string) => import(target);\n",
    );

    const vs = await run(root);
    expect(violationsFor(vs, "plan.ts")).toHaveLength(1);
    expect(violationsFor(vs, "plan.ts")[0]!.kind).toBe("dynamic-non-literal");
  });

  // ---------- positive dynamische Faelle ----------

  it("erlaubt eigenes Modul -> eigene Datei ueber dynamischen Import", async () => {
    const root = fixtureRoot("dyn-self");
    write(root, "modules/audit/AuditPage.tsx", "export default () => null;\n");
    write(root, "modules/audit/index.ts", `export const p = () => import("./AuditPage");\n`);

    const vs = await run(root);
    expect(violationsFor(vs, "modules/audit/index.ts")).toEqual([]);
  });

  it("erlaubt Modul -> Core ueber dynamischen Import", async () => {
    const root = fixtureRoot("dyn-module-core");
    write(root, "core/util.ts", "export const x = 1;\n");
    write(
      root,
      "modules/audit/AuditPage.tsx",
      `export const p = () => import("../../core/util");\n`,
    );

    const vs = await run(root);
    expect(violationsFor(vs, "AuditPage.tsx")).toEqual([]);
  });

  it("erlaubt Composition Root -> oeffentlichen Modul-Index ueber dyn Import", async () => {
    const root = fixtureRoot("dyn-root-public");
    write(root, "modules/audit/index.ts", "export const a = 1;\n");
    write(root, "modules/index.ts", `export const p = () => import("./audit");\n`);

    const vs = await run(root);
    expect(violationsFor(vs, "modules/index.ts")).toEqual([]);
  });

  it("erlaubt app -> ../modules-Fassade ueber dynamischen Import", async () => {
    const root = fixtureRoot("dyn-app-root");
    write(root, "modules/index.ts", "export const r = 1;\n");
    write(root, "app/App.tsx", `export const p = () => import("../modules");\n`);

    const vs = await run(root);
    expect(violationsFor(vs, "App.tsx")).toEqual([]);
  });

  it("erlaubt Import eines externen Pakets mit statischem Namen", async () => {
    const root = fixtureRoot("dyn-external");
    write(
      root,
      "modules/audit/index.ts",
      `export const p = () => import("react");\n`,
    );

    const vs = await run(root);
    expect(violationsFor(vs, "modules/audit/index.ts")).toEqual([]);
  });
});

// ------------------------------------------------- geschachtelte index-Dateien

describe("Frontend-Modulgrenzen: nur src/modules/<id>/index ist oeffentlich", () => {
  it("erlaubt Composition Root -> ./audit (Ordner)", async () => {
    const root = fixtureRoot("nested-root-folder");
    write(root, "modules/audit/index.ts", "export const a = 1;\n");
    write(root, "modules/index.ts", `import { a } from "./audit";\n`);

    const vs = await run(root);
    expect(violationsFor(vs, "modules/index.ts")).toEqual([]);
  });

  it("erlaubt Composition Root -> ./audit/index", async () => {
    const root = fixtureRoot("nested-root-index");
    write(root, "modules/audit/index.ts", "export const a = 1;\n");
    write(root, "modules/index.ts", `import { a } from "./audit/index";\n`);

    const vs = await run(root);
    expect(violationsFor(vs, "modules/index.ts")).toEqual([]);
  });

  it("blockiert Composition Root -> ./audit/pages/index (geschachtelter Index)", async () => {
    const root = fixtureRoot("nested-root-pages-index");
    write(root, "modules/audit/pages/index.ts", "export const p = 1;\n");
    write(root, "modules/index.ts", `import { p } from "./audit/pages/index";\n`);

    const vs = await run(root);
    const filtered = violationsFor(vs, "modules/index.ts");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.target?.kind).toBe("module-internal");
    expect(filtered[0]!.reason).toMatch(/Interna/);
  });

  it("blockiert Composition Root -> ./audit/internal/index", async () => {
    const root = fixtureRoot("nested-root-internal-index");
    write(root, "modules/audit/internal/index.ts", "export const q = 2;\n");
    write(root, "modules/index.ts", `import { q } from "./audit/internal/index";\n`);

    const vs = await run(root);
    const filtered = violationsFor(vs, "modules/index.ts");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.target?.kind).toBe("module-internal");
  });

  it("blockiert Composition Root -> ./audit/pages/Page", async () => {
    const root = fixtureRoot("nested-root-page-file");
    write(root, "modules/audit/pages/Page.tsx", "export default () => null;\n");
    write(root, "modules/index.ts", `import p from "./audit/pages/Page";\n`);

    const vs = await run(root);
    const filtered = violationsFor(vs, "modules/index.ts");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.target?.kind).toBe("module-internal");
  });

  it("blockiert App -> ../modules/audit/pages/index", async () => {
    const root = fixtureRoot("app-nested-pages");
    write(root, "modules/audit/pages/index.ts", "export const p = 1;\n");
    write(root, "app/App.tsx", `import { p } from "../modules/audit/pages/index";\n`);

    const vs = await run(root);
    const filtered = violationsFor(vs, "App.tsx");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.target?.kind).toBe("module-internal");
  });

  it("erlaubt Modul -> eigenen verschachtelten pages/index", async () => {
    const root = fixtureRoot("self-nested-index");
    write(root, "modules/audit/pages/index.ts", "export const p = 1;\n");
    write(root, "modules/audit/index.ts", `import { p } from "./pages/index";\n`);

    const vs = await run(root);
    expect(violationsFor(vs, "modules/audit/index.ts")).toEqual([]);
  });

  it("blockiert Modul A -> verschachtelten pages/index von Modul B", async () => {
    const root = fixtureRoot("cross-nested-index");
    write(root, "modules/audit/pages/index.ts", "export const p = 1;\n");
    write(
      root,
      "modules/electrical/PlanPage.tsx",
      `import { p } from "../audit/pages/index";\n`,
    );

    const vs = await run(root);
    const filtered = violationsFor(vs, "PlanPage.tsx");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.target?.kind).toBe("module-internal");
    expect(filtered[0]!.reason).toMatch(/fremdem Modul 'audit'/);
  });

  it("blockiert dynamischen Composition-Root-Import auf pages/index", async () => {
    const root = fixtureRoot("dyn-nested-root");
    write(root, "modules/audit/pages/index.ts", "export const p = 1;\n");
    write(
      root,
      "modules/index.ts",
      `export const load = () => import("./audit/pages/index");\n`,
    );

    const vs = await run(root);
    const filtered = violationsFor(vs, "modules/index.ts");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.kind).toBe("dynamic");
    expect(filtered[0]!.target?.kind).toBe("module-internal");
  });

  it("blockiert dynamischen Cross-Modul-Import auf pages/index", async () => {
    const root = fixtureRoot("dyn-cross-nested");
    write(root, "modules/audit/pages/index.ts", "export const p = 1;\n");
    write(
      root,
      "modules/electrical/plan.ts",
      `export const load = () => import("../audit/pages/index");\n`,
    );

    const vs = await run(root);
    const filtered = violationsFor(vs, "modules/electrical/plan.ts");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.kind).toBe("dynamic");
    expect(filtered[0]!.target?.kind).toBe("module-internal");
  });

  it("erlaubt Modul -> eigenen verschachtelten pages/index ueber dyn Import", async () => {
    const root = fixtureRoot("dyn-self-nested");
    write(root, "modules/audit/pages/index.ts", "export const p = 1;\n");
    write(
      root,
      "modules/audit/index.ts",
      `export const load = () => import("./pages/index");\n`,
    );

    const vs = await run(root);
    expect(violationsFor(vs, "modules/audit/index.ts")).toEqual([]);
  });
});

describe("Frontend-Modulgrenzen: Hilfsverwendung", () => {
  it("nennt fileURLToPath ohne Bedeutung fuer die Modulgrenzen", () => {
    expect(typeof fileURLToPath).toBe("function");
  });
});
