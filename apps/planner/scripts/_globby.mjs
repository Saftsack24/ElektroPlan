// Minimaler rekursiver Datei-Sammler ohne externe Abhaengigkeit.
// Wird von module-boundaries.mjs benutzt.

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Sammelt alle Dateien unter <root>, deren Endung in <extensions> steht.
 * @param {string} root
 * @param {string[]} extensions
 * @returns {Promise<string[]>}
 */
export async function globby(root, extensions) {
  /** @type {string[]} */
  const result = [];
  await walk(root, extensions, result);
  return result.sort();
}

async function walk(dir, extensions, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      await walk(full, extensions, out);
    } else if (entry.isFile()) {
      if (extensions.some((ext) => entry.name.endsWith(ext))) {
        out.push(full);
      }
    } else {
      // Symlinks etc. via stat, defensiv.
      try {
        const info = await stat(full);
        if (info.isFile()) out.push(full);
      } catch {
        // ignorieren
      }
    }
  }
}
