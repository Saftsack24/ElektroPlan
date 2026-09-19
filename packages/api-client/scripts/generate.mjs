#!/usr/bin/env node
// Erzeugt die TypeScript-Typen aus dem OpenAPI-Dokument des Backends.
// Quelle der Wahrheit ist das Backend (ADR 0009) - src/generated.ts wird NIE
// von Hand bearbeitet.
//
//   node scripts/generate.mjs           erzeugt src/generated.ts
//   node scripts/generate.mjs --check   bricht ab, wenn sich etwas geaendert hat
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import openapiTS, { astToString } from "openapi-typescript";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, "../../../apps/backend/openapi.json");
const targetPath = resolve(here, "../src/generated.ts");
const checkOnly = process.argv.includes("--check");

if (!existsSync(schemaPath)) {
  console.error(
    `OpenAPI-Dokument fehlt: ${schemaPath}\n` +
      "Zuerst im Backend erzeugen:  python -m app.cli export-openapi openapi.json",
  );
  process.exit(1);
}

const header =
  "// GENERIERT - nicht bearbeiten.\n" +
  "// Quelle: apps/backend (OpenAPI). Neu erzeugen mit: npm run generate:api\n";

const ast = await openapiTS(pathToFileURL(schemaPath));
const content = header + astToString(ast);

if (checkOnly) {
  const current = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
  if (current !== content) {
    console.error(
      "API-Client ist nicht aktuell (Drift zwischen Backend und packages/api-client).\n" +
        "Beheben mit: npm run generate:api",
    );
    process.exit(1);
  }
  console.log("API-Client ist aktuell.");
} else {
  writeFileSync(targetPath, content, "utf8");
  console.log(`Geschrieben: ${targetPath}`);
}
