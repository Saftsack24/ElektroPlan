// Frontend-Modulgrenzen (docs/modules.md, Abschnitt 8).
//
// Diese Datei ist die *einzige* produktive Grenzpruefung im Frontend.
// Sowohl der CLI-Aufruf (npm run check:boundaries -> tasks.ps1 check /
// tasks.ps1 boundaries) als auch der Vitest-Test importieren dieselbe
// Funktion checkModuleBoundaries. Damit koennen Test und Konfiguration
// nicht unbemerkt auseinanderdriften.
//
// Analyse:
//   Die Datei wird mit dem TypeScript-Compiler (bereits in node_modules)
//   in einen AST geparst. Erkannt werden:
//     - statische `import`-Deklarationen
//     - `export ... from "..."` und `export * from "..."` (Re-Exports)
//     - dynamische `import("...")`
//     - `React.lazy(() => import("..."))` bzw. `lazy(() => import("..."))`
//   Reguex-Fallbacks gibt es nicht - der Parser sieht mehrzeilige,
//   in Templates verschachtelte und ge-`await`-te Formen genauso.
//
//   **Nicht statisch bestimmbare** dynamische Imports (Variable oder
//   Template-String mit ${...}) werden ausdruecklich als
//   Architekturverstoss "dynamic-non-literal" gemeldet. So kann eine
//   Modulgrenze nicht via `import(\`../modules/${x}\`)` umgangen werden.
//
// Owner-Modell (fuer Quell- und Zieldatei):
//   modules/<X>/index.ts   -> "module-public"     (moduleId=X)
//   modules/<X>/*          -> "module-internal"   (moduleId=X)
//   modules/index.ts       -> "composition-root"
//   core/**                -> "core"
//   app/**                 -> "app"
//   sonst                  -> "other"
//
// Erlaubte Uebergaenge:
//   module-X -> module-X (eigene Interna)         erlaubt
//   module-X -> core / other                      erlaubt
//   core     -> core / other                      erlaubt
//   core     -> module (public oder internal)     VERBOTEN
//   app      -> composition-root / core / other   erlaubt
//   app      -> module (public oder internal)     VERBOTEN  <-- Punkt 1
//   composition-root -> module-public / core / other  erlaubt
//   composition-root -> module-internal           VERBOTEN
//   module-X -> module-Y (X != Y, egal ob Interna)  VERBOTEN
//   dynamic-non-literal (in modules/app/core)      VERBOTEN

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { globby } from "./_globby.mjs";

const require = createRequire(import.meta.url);
/** @type {import("typescript")} */
const ts = require("typescript");

/** @typedef {"module-public" | "module-internal" | "composition-root" | "core" | "app" | "other"} OwnerKind */
/** @typedef {{ kind: OwnerKind, moduleId: string | null }} Owner */

/**
 * Standard-Aliase fuer das Planner-Projekt.
 * Wird ein neuer Alias eingefuehrt, wird er hier ergaenzt.
 * `@/` und `src/` deuten beide auf <srcRoot>.
 */
const DEFAULT_ALIASES = [{ prefix: "@/" }, { prefix: "src/" }];

/**
 * Sammelt Import-Kanten und Analyse-Verstoesse einer Datei ueber den
 * TypeScript-AST. Rueckgabe: { edges, dynamicNonLiteral } wobei
 * `dynamicNonLiteral` Fundstellen von `import(variable)` /
 * `import(\`.../${x}\`)` beschreibt.
 *
 * @param {string} filePath absoluter Pfad
 * @param {string} sourceText Dateiinhalt
 */
function collectImports(filePath, sourceText) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  /** @type {{ specifier: string, line: number, kind: "static" | "reexport" | "dynamic" }[]} */
  const edges = [];
  /** @type {{ line: number, expression: string }[]} */
  const dynamicNonLiteral = [];

  /**
   * @param {import("typescript").Node} node
   */
  const visit = (node) => {
    // static: import x from "..."
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      edges.push({
        specifier: node.moduleSpecifier.text,
        line: lineOf(sourceFile, node.moduleSpecifier),
        kind: "static",
      });
    }

    // re-export: export { x } from "..." / export * from "..."
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      edges.push({
        specifier: node.moduleSpecifier.text,
        line: lineOf(sourceFile, node.moduleSpecifier),
        kind: "reexport",
      });
    }

    // dynamic: import("...") und lazy(() => import("..."))
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const first = node.arguments[0];
      if (first !== undefined) {
        if (ts.isStringLiteralLike(first)) {
          edges.push({
            specifier: first.text,
            line: lineOf(sourceFile, first),
            kind: "dynamic",
          });
        } else if (
          ts.isTemplateExpression(first) ||
          ts.isIdentifier(first) ||
          ts.isPropertyAccessExpression(first) ||
          ts.isBinaryExpression(first)
        ) {
          dynamicNonLiteral.push({
            line: lineOf(sourceFile, first),
            expression: first.getText(sourceFile),
          });
        } else {
          dynamicNonLiteral.push({
            line: lineOf(sourceFile, first),
            expression: first.getText(sourceFile),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { edges, dynamicNonLiteral };
}

/**
 * @param {import("typescript").SourceFile} sourceFile
 * @param {import("typescript").Node} node
 */
function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/**
 * Loest einen Import auf einen absoluten Pfad innerhalb des src-Baums
 * auf. Rueckgabe null: externes Paket, nicht zu pruefen.
 */
function resolveImport(specifier, fromFile, srcRoot, aliases) {
  if (specifier.startsWith(".")) {
    return resolve(dirname(fromFile), specifier);
  }
  for (const alias of aliases) {
    if (specifier === alias.prefix.replace(/\/$/, "")) {
      return srcRoot;
    }
    if (specifier.startsWith(alias.prefix)) {
      return join(srcRoot, specifier.slice(alias.prefix.length));
    }
  }
  if (isAbsolute(specifier)) {
    return specifier;
  }
  return null;
}

/**
 * @param {string} absolutePath
 * @param {string} srcRoot
 * @returns {Owner}
 */
function ownerOf(absolutePath, srcRoot) {
  const rel = relative(srcRoot, absolutePath).split(sep).join("/");
  if (rel.startsWith("..") || rel === "") return { kind: "other", moduleId: null };
  const segments = rel.split("/");
  const stripped = segments.map((seg) => seg.replace(/\.(tsx?|jsx?|mjs|cjs)$/, ""));

  if (stripped[0] === "modules") {
    // Nur der zentrale Einstieg src/modules/index.ts ist die Composition Root.
    if (stripped.length === 1) {
      return { kind: "composition-root", moduleId: null };
    }
    if (stripped.length === 2 && stripped[1] === "index") {
      return { kind: "composition-root", moduleId: null };
    }
    const moduleId = /** @type {string} */ (stripped[1]);
    // Genau zwei Formen sind der oeffentliche Einstieg eines Moduls:
    //   src/modules/<id>          (Ordner, aufloesbar auf sein index.ts)
    //   src/modules/<id>/index    (die index-Datei selbst)
    // Jede tiefere Datei bleibt intern - auch wenn sie selbst
    // ``index.ts`` oder ``index.tsx`` heisst. Sonst waere ein
    // ``modules/<id>/pages/index`` versehentlich oeffentlich.
    if (stripped.length === 2) {
      return { kind: "module-public", moduleId };
    }
    if (stripped.length === 3 && stripped[2] === "index") {
      return { kind: "module-public", moduleId };
    }
    return { kind: "module-internal", moduleId };
  }
  if (stripped[0] === "core") return { kind: "core", moduleId: null };
  if (stripped[0] === "app") return { kind: "app", moduleId: null };
  return { kind: "other", moduleId: null };
}

/**
 * Verbotenes ist verboten. Alles nicht ausdruecklich verbotene ist erlaubt.
 * Die verbotenen Uebergaenge stehen einzeln aufgelistet - lies das
 * Kopfbild dieser Datei.
 *
 * @param {Owner} source
 * @param {Owner} target
 */
function isAllowed(source, target) {
  const sourceIsModule =
    source.kind === "module-public" || source.kind === "module-internal";
  const targetIsModule =
    target.kind === "module-public" || target.kind === "module-internal";

  // Modul -> anderes Modul (public oder internal) verboten.
  if (sourceIsModule && targetIsModule && source.moduleId !== target.moduleId) {
    return false;
  }
  // Core -> Modul (jeder Art) verboten.
  if (source.kind === "core" && targetIsModule) return false;
  // App darf nur die zentrale Fassade importieren, keine konkreten Module.
  if (source.kind === "app" && targetIsModule) return false;
  // Composition Root darf keine Interna importieren.
  if (source.kind === "composition-root" && target.kind === "module-internal") return false;
  return true;
}

/**
 * @param {Owner} source
 * @param {Owner} target
 */
function reasonFor(source, target) {
  if (source.kind === "core" && (target.kind === "module-public" || target.kind === "module-internal")) {
    return "core/** darf kein konkretes Modul importieren";
  }
  if (source.kind === "app" && target.kind === "module-internal") {
    return "app/** darf keine Modul-Interna importieren";
  }
  if (source.kind === "app" && target.kind === "module-public") {
    return (
      "app/** darf keinen oeffentlichen Modul-Index importieren - " +
      "nur die zentrale Fassade src/modules/index.ts"
    );
  }
  if (
    (source.kind === "module-public" || source.kind === "module-internal") &&
    (target.kind === "module-public" || target.kind === "module-internal") &&
    source.moduleId !== target.moduleId
  ) {
    return (
      `Modul '${source.moduleId}' importiert Datei aus fremdem Modul '${target.moduleId}'. ` +
      "Cross-Module-Imports sind nur ueber src/modules/index.ts erlaubt."
    );
  }
  if (source.kind === "composition-root" && target.kind === "module-internal") {
    return "Auch die Composition Root darf keine Modul-Interna importieren.";
  }
  return "Unzulaessiger Uebergang zwischen Frontend-Bereichen.";
}

/**
 * Prueft alle *.ts/tsx-Dateien unter <srcRoot> gegen die Grenzregeln.
 * Rueckgabe: Array von Verstoessen.
 *
 * @param {Object} options
 * @param {string} options.srcRoot Absoluter Pfad auf ``src``.
 * @param {{prefix: string}[]=} options.aliases zusaetzliche Aliase (Standard @/, src/).
 * @returns {Promise<Array<{file: string, line: number, specifier: string, resolved: string | null, source: Owner, target: Owner | null, reason: string, kind: string}>>}
 */
export async function checkModuleBoundaries({ srcRoot, aliases } = { srcRoot: "" }) {
  if (!srcRoot) throw new Error("srcRoot ist erforderlich");
  const effectiveAliases = aliases ?? DEFAULT_ALIASES;
  const files = await globby(srcRoot, [".ts", ".tsx"]);
  const violations = [];

  for (const file of files) {
    const content = await readFile(file, "utf-8");
    const { edges, dynamicNonLiteral } = collectImports(file, content);

    // Nicht statisch analysierbare dynamische Imports sind ein
    // eigenstaendiger Architekturverstoss - kein "grauer Bereich".
    for (const nl of dynamicNonLiteral) {
      const source = ownerOf(file, srcRoot);
      // Ausserhalb src/modules, src/app, src/core spielt es keine Rolle.
      if (source.kind === "other") continue;
      violations.push({
        file,
        line: nl.line,
        specifier: nl.expression,
        resolved: null,
        source,
        target: null,
        kind: "dynamic-non-literal",
        reason:
          "Dynamisches Importziel ist nicht statisch analysierbar. " +
          "Modulgrenzen koennten so umgangen werden - " +
          "``import()`` muss ein statisches String-Literal enthalten.",
      });
    }

    for (const edge of edges) {
      const resolved = resolveImport(edge.specifier, file, srcRoot, effectiveAliases);
      if (resolved === null) continue;
      const relResolved = relative(srcRoot, resolved).split(sep).join("/");
      if (relResolved.startsWith("..")) continue;

      const source = ownerOf(file, srcRoot);
      const target = ownerOf(resolved, srcRoot);
      if (isAllowed(source, target)) continue;

      violations.push({
        file,
        line: edge.line,
        specifier: edge.specifier,
        resolved,
        source,
        target,
        kind: edge.kind,
        reason: reasonFor(source, target),
      });
    }
  }
  return violations;
}

// -------------------------------------------------------------- CLI
async function main() {
  const srcArg = process.argv[2];
  const srcRoot = srcArg
    ? resolve(srcArg)
    : resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "src");
  const absoluteSrc = resolve(srcRoot);
  const violations = await checkModuleBoundaries({ srcRoot: absoluteSrc });
  if (violations.length === 0) {
    console.log(`Modulgrenzen: OK (${absoluteSrc})`);
    return;
  }
  console.error(`Modulgrenzen: ${violations.length} Verstoss/Verstoesse`);
  for (const v of violations) {
    console.error(
      `  ${relative(process.cwd(), v.file)}:${v.line}  [${v.kind}]  ${JSON.stringify(v.specifier)}`,
    );
    console.error(`    ${v.reason}`);
  }
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(2);
  });
}
