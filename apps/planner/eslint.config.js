import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Modulgrenzen im Frontend (docs/modules.md, Abschnitt 8).
 *
 * ESLint uebernimmt hier nur eine schnelle Fruehwarn-Rolle fuer
 * absolute Modul-Alias-Zugriffe. Die verbindliche Pruefung uebernimmt
 * ``scripts/module-boundaries.mjs`` (``npm run check:boundaries``), das
 * Importpfade relativ zur Quelldatei aufloest und den tatsaechlichen
 * Datei-Owner bestimmt. Damit werden auch Umgehungen wie
 * ``../andereModul/…`` erkannt, die sich mit ESLint-Glob-Mustern nicht
 * zuverlaessig fassen lassen.
 */
const denyModuleInternalsFromOutside = [
  {
    group: [
      "@/modules/*",
      "@/modules/*/*",
      "src/modules/*",
      "src/modules/*/*",
      "**/src/modules/*",
      "**/src/modules/*/*",
      "../modules/*",
      "../modules/*/*",
      "../../modules/*",
      "../../modules/*/*",
      "../../../modules/*",
      "../../../modules/*/*",
    ],
    message:
      "Ein anderes Modul wird nur ueber src/modules/index.ts registriert. Die verbindliche Pruefung laeuft ueber npm run check:boundaries.",
  },
];

export default tseslint.config(
  { ignores: ["dist", "node_modules", "scripts"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "no-restricted-imports": ["error", { patterns: denyModuleInternalsFromOutside }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/modules/index.ts", "src/modules/index.tsx"],
    rules: { "no-restricted-imports": "off" },
  },
);
