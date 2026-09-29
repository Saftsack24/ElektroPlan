import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tailwind CSS 4 wird als offizielles Vite-Plugin eingebunden (ADR 0018);
  // eine eigene tailwind.config.js gibt es nicht, die Konfiguration steht
  // CSS-first in src/styles.css und src/core/theme/.
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    // Der lazy geladene Chunk der 3D-Ansicht enthält Three.js (~590 kB
    // minifiziert) und wird erst beim Öffnen der 3D-Ansicht geladen
    // (ADR 0016). Die Grenze liegt knapp darüber, damit jeder andere
    // Chunk weiterhin gewarnt wird, sobald er so groß wird.
    chunkSizeWarningLimit: 650,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
