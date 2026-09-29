import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

import { MASSEINHEIT_SCHLUESSEL_ALT, masseinheitZuruecksetzen } from "./core/ui/masseinheit";

// Jeder Test beginnt mit der Standard-Maßeinheit (cm) und ohne angemeldeten
// Benutzer: Die persönliche Wahl liegt im localStorage (je Benutzer) und
// würde sonst in den nächsten Test durchschlagen.
afterEach(() => {
  try {
    for (const schluessel of Object.keys(window.localStorage)) {
      if (schluessel === MASSEINHEIT_SCHLUESSEL_ALT || schluessel.startsWith(`${MASSEINHEIT_SCHLUESSEL_ALT}.`)) {
        window.localStorage.removeItem(schluessel);
      }
    }
  } catch {
    // ohne Speicher gibt es nichts zurückzusetzen
  }
  masseinheitZuruecksetzen();
});

/**
 * Data Router in jsdom (seit Phase 4a.1).
 *
 * In der jsdom-Umgebung stammt `AbortController` aus jsdom, `Request` aber aus
 * Node (undici). Der Data Router erzeugt je Navigation einen `Request` mit
 * dem Signal seines `AbortController` - und undici lehnt das fremde Signal
 * ab. Nur in Tests wird das Signal deshalb weggelassen: Hier gibt es keine
 * Loader, deren Abbruch zu prüfen wäre. Im Browser stammen beide aus derselben
 * Quelle; dort greift nichts hiervon.
 */
const NodeRequest = globalThis.Request;

function nimmtSignalAn(): boolean {
  try {
    new NodeRequest("http://localhost/", { signal: new AbortController().signal });
    return true;
  } catch {
    return false;
  }
}

if (!nimmtSignalAn()) {
  class TestRequest extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      if (init?.signal === undefined || init.signal === null) {
        super(input, init);
      } else {
        const { signal: _fremd, ...rest } = init;
        super(input, rest);
      }
    }
  }
  globalThis.Request = TestRequest;
}
