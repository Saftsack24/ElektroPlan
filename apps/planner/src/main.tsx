import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App, erzeugeRouter } from "./app/App";
import "./styles.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Element #root fehlt in index.html");
}

// Genau einmal, außerhalb des StrictMode-Renderzyklus: Der Router registriert
// History-Listener, die ein doppelt ausgeführter Initializer zurücklassen könnte.
const router = erzeugeRouter();

createRoot(container).render(
  <StrictMode>
    <App router={router} />
  </StrictMode>,
);
