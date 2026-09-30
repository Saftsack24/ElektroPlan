import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App, erzeugeRouter } from "./app/App";
import { darstellungStarten } from "./core/theme/darstellung";
import "./styles.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Element #root fehlt in index.html");
}

// Vor dem ersten Rendern: Wurzelattribute für Farbschema und Akzent setzen
// und Systemschema sowie andere Tabs beobachten (Phase 4c.2). Bis sich ein
// Benutzer anmeldet, gilt der Standard.
darstellungStarten();

// Genau einmal, außerhalb des StrictMode-Renderzyklus: Der Router registriert
// History-Listener, die ein doppelt ausgeführter Initializer zurücklassen könnte.
const router = erzeugeRouter();

createRoot(container).render(
  <StrictMode>
    <App router={router} />
  </StrictMode>,
);
