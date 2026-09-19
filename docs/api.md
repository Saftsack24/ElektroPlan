# API-Richtlinien

Version: 1.0 (Phase 0)
Basis: FastAPI · OpenAPI 3.1 · JSON

---

## 1. Struktur und Versionierung

```
/api/v1/<resource>                      Core und Shared Business Modules
/api/v1/modules/<module-id>/<resource>  Fachmodule
/health/live  /health/ready             ohne Version
```

Beispiele:

```
GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/{project_id}
GET    /api/v1/materials
POST   /api/v1/offers/{offer_id}/versions
GET    /api/v1/modules/electrical/projects/{project_id}/rooms
POST   /api/v1/modules/electrical/cable-routes/{route_id}/points
```

- `v1` wird geführt, solange es genutzt wird. Brechende Änderungen erzeugen `v2`; beide
  laufen parallel, bis alle Clients migriert sind.
- Additive Änderungen (neues optionales Feld, neuer Endpunkt) sind innerhalb von `v1`
  erlaubt.
- Ressourcen im Plural, Kebab-Case in Pfaden, Snake-Case in JSON-Feldern.

---

## 2. Datentypen über die Leitung

| Typ | Übertragung | Beispiel |
|---|---|---|
| Geld | **String** | `"1234.56"` |
| Menge | **String** | `"45.900"` |
| Prozent | **String** | `"8.000"` |
| Geometrie (mm) | Integer | `3250` |
| ID | UUID-String | `"3f2a…"` |
| Zeitpunkt | ISO 8601 UTC | `"2026-09-18T07:15:00Z"` |
| Datum | ISO 8601 | `"2026-09-30"` |
| Einheit | Enum-String | `"meter"` |

**Begründung String bei Geld und Mengen:** JSON-Zahlen werden in JavaScript zu IEEE-754-
Doubles. Ein im Backend korrekt gerechneter `Decimal` wäre im Browser sofort wieder
ungenau. Siehe [ADR 0005](decisions/0005-money-rounding-and-quantities.md).

Geldfelder tragen immer eine Währung im umgebenden Objekt (`"currency": "EUR"`).

---

## 3. Fehlerformat (RFC 9457)

```json
{
  "type": "https://elektroplan.internal/errors/insufficient-stock",
  "title": "Nicht genügend Bestand",
  "status": 409,
  "detail": "Verfügbar sind 12.500 m, angefordert wurden 45.900 m.",
  "instance": "/api/v1/inventory/reservations",
  "request_id": "01JB3K…",
  "errors": [
    { "field": "quantity", "code": "insufficient", "message": "Menge übersteigt Bestand" }
  ]
}
```

Regeln:

- `Content-Type: application/problem+json`
- `type` ist stabil und maschinenlesbar; Clients werten `type` aus, nicht `title`.
- Keine Stacktraces, keine SQL-Fehler, keine internen Pfade.
- `request_id` in **jeder** Antwort (auch im Erfolgsfall als Header `X-Request-Id`).

| Status | Verwendung |
|---|---|
| 400 | Syntaktisch ungültige Anfrage |
| 401 | Nicht angemeldet / Token ungültig |
| 403 | Angemeldet, aber Permission fehlt |
| 404 | Nicht vorhanden **oder fremder Mandant** (bewusst nicht unterscheidbar) |
| 409 | Fachlicher Konflikt (Versionskonflikt, Bestand, Statuswechsel unzulässig) |
| 422 | Validierungsfehler im Inhalt |
| 429 | Rate Limit |
| 500 | Unerwarteter Fehler (generische Meldung) |

---

## 4. Auflistungen und Pagination

```
GET /api/v1/materials?limit=50&cursor=eyJ…&q=NYM&category_id=…&sort=name
```

```json
{
  "items": [ … ],
  "next_cursor": "eyJ…",
  "has_more": true
}
```

- Cursor-basiert, kein `offset` (stabil bei gleichzeitigen Änderungen).
- `limit` Standard 50, Maximum 200.
- Filter sind explizit definierte Query-Parameter, keine generische Filtersprache.
- Sortierung nur über eine Whitelist von Feldern.

---

## 5. Schreibende Operationen

- `POST` legt an und liefert `201` mit dem vollständigen Objekt.
- `PATCH` ändert teilweise; `PUT` wird nicht verwendet.
- `DELETE` ist Soft Delete, wo fachlich vorgesehen, und liefert `204`.
- Zustandswechsel sind eigene Endpunkte, keine Statusfelder im `PATCH`:

```
POST /api/v1/calculations/{id}/finalize
POST /api/v1/offers/{offer_id}/versions/{version_no}/release
POST /api/v1/offers/{offer_id}/versions/{version_no}/mark-sent
POST /api/v1/work-orders/{id}/complete
```

Begründung: Ein Statuswechsel hat Vorbedingungen, Berechtigungen und Nebenwirkungen. Als
Feld in einem generischen `PATCH` wäre er weder prüfbar noch sauber protokollierbar.

### Optimistisches Sperren

Schreibende Anfragen auf versionierte Entitäten senden `If-Match: "<version>"`.
Abweichung → `409` mit `type: …/version-conflict` und der aktuellen Version im Body.

### Idempotenz

Bestandsverändernde Operationen akzeptieren `Idempotency-Key` (bzw. `client_txn_id` im
Body). Gleicher Schlüssel = gleiche Antwort, keine zweite Buchung. Pflicht für alle
Aufrufe der Baustellen-App.

---

## 6. Recompute-Endpunkte

Zu jeder eventgetriebenen Ableitung gehört ein expliziter, idempotenter Endpunkt
(siehe `docs/events.md`):

```
POST /api/v1/projects/{project_id}/material-requirements/recompute
POST /api/v1/calculations/{calculation_id}/check-stale
```

---

## 7. Modul- und Kontextendpunkte

```
GET  /api/v1/me                 Benutzer, aktive Organisation, Permissions
GET  /api/v1/me/organizations   Mitgliedschaften
GET  /api/v1/me/modules         aktive Module inkl. Version
POST /api/v1/auth/login         Anmeldung
POST /api/v1/auth/refresh       Sitzung erneuern (liest das Cookie, kein Body)
POST /api/v1/auth/logout        Abmelden (liest das Cookie, kein Body)
POST /api/v1/auth/switch-organization
```

### Sitzungsendpunkte: Cookie statt Antwortkörper

`TokenResponse` enthält **keinen** Refresh Token. Er verlässt den Server
ausschließlich als `HttpOnly`-Cookie (`Path=/api/v1/auth`, `SameSite=Strict`,
`Secure` in Produktion). Damit kann JavaScript ihn nicht lesen — und ein
XSS-Angriff ebenso wenig.

Folgen für Clients:

- Anfragen an Sitzungsendpunkte brauchen `credentials: "include"`.
- `/auth/refresh` und `/auth/logout` haben **keinen** Anfragekörper.
- Die vier cookiebasierten Endpunkte prüfen zusätzlich `Origin`/`Referer`
  (`403 csrf-validation-failed` bei fremder Herkunft), siehe
  `docs/security.md`, Abschnitt 12.
- Die spätere Baustellen-App erhält einen **getrennten** mobilen Tokenflow; sie
  verwendet dieses Schema nicht.

### Mehrere Betriebe beim Login

Gehört ein Konto mehreren aktiven Betrieben an und wurde keiner gewählt,
antwortet `/auth/login` mit `409` und
`type: …/organization-selection-required`. Das Problem-Dokument enthält dann das
Feld `organizations` mit `id` und `name` zur Auswahl. Ein erneuter Login mit
`organization_id` schließt den Vorgang ab.

`GET /api/v1/me/modules` steuert die Sichtbarkeit im Frontend. Die eigentliche
Absicherung bleibt serverseitig.

---

## 8. OpenAPI und Client-Erzeugung

- Jeder Endpunkt hat `summary`, `description`, `response_model` und `operation_id`.
- `operation_id` ist stabil und sprechend (`listProjects`, `createOfferVersion`) — sie
  wird zum Funktionsnamen im generierten Client.
- `packages/api-client` wird per `openapi-typescript` erzeugt; ein CI-Schritt erzeugt neu
  und bricht bei Abweichung ab (Drift-Check).
- Fehlerantworten werden im Schema deklariert, nicht nur Erfolgsfälle.

---

## 9. Stabilitätszusagen

| Zusage | Bedeutung |
|---|---|
| Feldnamen in `v1` ändern sich nicht | Umbenennung erzeugt `v2` |
| `operation_id` ist stabil | Client-Code bleibt gültig |
| Enum-Werte werden nur ergänzt | Clients behandeln Unbekanntes tolerant |
| `type`-Werte von Fehlern sind stabil | Clients dürfen darauf verzweigen |
| Geld/Menge bleiben Strings | Keine stille Typänderung |
