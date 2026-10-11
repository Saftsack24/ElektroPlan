# 0024 — Physische Wandzuordnung als Wandkopplung zweier Raumwände (T10)

Status: **accepted** (2026-10-06) · umgesetzt in Phase 6a.1–6a.3
Datum: 2026-10-04 (Entwurf), 2026-10-06 (angenommen)
Betrifft: Phase 6a (Vorbereitung Leitungsrouting)
Baut auf: [ADR 0013](0013-room-contour-as-ordered-wall-segments.md) (gerichtete Raumwände),
[ADR 0016](0016-derived-3d-view-wall-height-and-coincident-walls.md) (exakte Teilwände, eine
Öffnung als Quelle, Neubewertung T10), [ADR 0022](0022-wall-and-ceiling-view.md) (Wandseite,
Fassade als Ansicht), [ADR 0023](0023-electrical-devices-symbols-room-types.md) (Montagefläche,
Geräteprüfung)
Entwurf: [`docs/phase-6a-design.md`](../phase-6a-design.md) §2.1–2.3, §4.1–4.3, §7.2–7.4,
Umsetzungsstand §10

## Context

Jede Raumwand gehört genau einem Raum; zwei Nachbarräume beschreiben dieselbe Bauwand doppelt.
Gemeinsame Stücke wurden bis Phase 5 nur abgeleitet und von der Geräteprüfung konservativ genutzt.
Leitungswege, Durchführungen und Mengen ohne Doppelzählung (Phase 6b) brauchen eine stabile,
bestätigbare Aussage, ob zwei überlappende Raumwände **eine** Bauwand sind – und in mehrdeutigen
Fällen eine speicherbare Entscheidung, auch die, dass es **zwei** Bauwände sind.

## Decision

1. `electrical_wall_links`: genau zwei exakt kollinear überlappende Raumwände verschiedener Räume
   desselben Geschosses; `relation = shared | separate`; `origin = user | backfill`;
   `created_by_user_id`; versioniert; kanonisch `wall_a_id < wall_b_id`, `UNIQUE` je Paar, FKs
   `CASCADE` (ausdrücklich benannt).
2. **Keine eigene Geometrie** – Bereich, Länge, Gültigkeit werden aus den Raumwänden abgeleitet;
   die Raumwand bleibt einzige Geometriequelle. Positionen auf einer Kopplung liegen an einer
   Eigentümerwand.
3. **Drei Zustände** je überlappendem atomarem Abschnitt. Eine Kopplung wirkt auf einem Abschnitt
   genau dann, wenn **genau ihre beiden Wände** ihn überdecken; liegt eine dritte Wand darauf, ist
   er `undecided`:
   * *unentschieden*: konservativ wie Phase 5 – Nachbaröffnung abgeleitet und blockierend,
     Außenmontage verboten, ein 3D-Körper;
   * *shared*: eine Bauwand – durchgehende Öffnung, blockierend, Außenmontage verboten
     (Innenfläche des Nachbarn), ein 3D-Körper, abweichende Stärke = Konflikt;
   * *separate*: zwei Bauwände – Nachbaröffnung **nicht** übertragen und **nicht** blockierend,
     Außenmontage verboten (**Zwischenfläche**, keine Fassade), zwei vereinfachte 3D-Halbkörper.
4. Server-Geräteprüfung, Editorspiegel, 2D-Topologie, Wandansicht und 3D lesen die Kopplungen
   mit **derselben** Regel (Fixture `testdata/geometry/wandkopplung.v1.json`). Anlegen, Ändern
   und Lösen unterliegen der Regel „keine neuen und keine größeren Gerätekonflikte“ (`422`);
   nichts wird verschoben oder gelöscht.
5. Äußere Seite ohne Partner = „Außenseite – kein modellierter Nachbarraum“ (Außenmontage wie
   Phase 5). Eine weitergehende Kennzeichnung fehlt bewusst (D10).
6. Kopplungen werden nie automatisch angelegt, umgehängt oder geteilt. Eindeutige Fälle werden
   als `shared` **vorgeschlagen** (Kandidaten im Planungsstand) und nur vom ausdrücklich
   gestarteten Backfill-Befehl angelegt; `separate` nur ausdrücklich.
7. **Status einer Kopplung** (abgeleitet, nicht gespeichert): `active`, `ambiguous` (auf einem
   Teil liegt eine dritte Wand – dort konservativ), `broken` („unterbrochen“: kein gemeinsamer
   Abschnitt, wirkt nirgends, bleibt gespeichert und wirkt wieder, sobald die Geometrie passt).
8. Entfernen einer gekoppelten Wand nur mit `removed_wall_link_ids` im Konturspeichern (jede
   betroffene Kopplung genannt, keine unbeteiligte – sonst `409 wall-has-links` bzw.
   `422 wall-link-not-affected`); Einzellöschen einer gekoppelten Wand `409`.
9. **Versionen:** Jede Kopplungsänderung (Anlegen, Ändern, Lösen, Lösen beim Konturspeichern,
   Backfill, Raumlöschung) zählt die **Raumversion beider beteiligten Räume** weiter. Ein bereits
   geöffneter Raumentwurf stößt dadurch beim Speichern auf `409 version-conflict` und kann eine
   neue Zuordnung nicht still übergehen. Reine Geometrieänderungen eines Nachbarraums zählen –
   wie in Phase 5 – nicht.

## Reichweite (bewusst begrenzt)

Das Paarmodell ist eine **Wandzuordnung**, keine allgemeine Bauwandverwaltung.

Gelöst: stabile Referenz zwischen zwei modellierten Räumen, speicherbare Entscheidung, einmalige
Zählung von Öffnung (und ab 6b Durchführung). Teilweise: ungepaarte Außenwand (Raumwand-ID genügt
für Montage, Fläche und Durchführung nach außen, nicht als eine Bauwand hinter mehreren Räumen),
Mengen bei verschiedenen Höhen (je Fläche), Wandteilung (Kopplung bleibt an der ursprünglichen
ID, das neue Stück ist unentschieden), unterbrochene Kopplungen (sichtbar, konservativ,
selbstheilend). Nicht gelöst: eine Bauwandstärke als einzige Größe, Bauwand-Konstruktion,
gleichzeitiges Verschieben beider Raumseiten in einem Schritt, Übertragen einer Kopplung auf ein
neues Teilstück (D11). Die zwei Halbkörper bei `separate` sind eine vereinfachte Darstellung,
keine maßstäbliche Aussage über einen zweischaligen Wandaufbau.

## Considered Options

* **A – nur Ableitung:** keine stabile Referenz, keine speicherbare Entscheidung.
* **B – Kopplung je Raumwandpaar** (gewählt).
* **C′ – physische Referenztabelle ohne eigene Geometrie:** liefert zusätzlich eine Bauwand hinter
  mehreren Räumen; kostet eine Zeile je Bauwand, Mitgliedschaftspflege bei jeder
  Wandbearbeitung und einen Backfill mit den Mehrdeutigkeiten von Fassadengruppen. Kein 6b-Fall
  braucht den Mehrnutzen. Späterer Übergang möglich: jede Kopplung wird zu zwei Mitgliedern.
* **C – physische Wand mit eigener Geometrie:** zwei Geometriequellen.

## Consequences

* Migration `0010_wall_links_and_risers` (Kopplungstabelle; Steigweg-Tabellen nur als
  Schema-Vorbereitung, ADR 0025) und der idempotente Befehl
  `python -m app.cli wall-links-backfill [--project PR-…] [--apply]` (Standard: Probelauf).
  Wände, Öffnungen und Geräte bleiben unverändert.
* API: `GET/POST /floors/{id}/wall-links`, `PATCH/DELETE /wall-links/{id}` (If-Match),
  `removed_wall_link_ids` am Konturspeichern; der Planungsstand liefert `wall_links` (mit Status)
  und `wall_link_candidates`. Event `plan_updated` mit `change_kind = wall_links_changed` je
  beteiligtem Raum.
* Die Geräteprüfung kennt Kopplungen (nur `separate` ändert eine Wirkung: keine Nachbaröffnung).
* 3D: dritte Abschnittslage „getrennt“ mit zwei Halbkörpern und Trennfuge.
* Ergänzt ADR 0016: fachlich maßgeblich ist die Kopplung; die reine Ableitung bleibt der
  konservative Rückfall für unentschiedene Abschnitte.
* Zurückgestellt: D9 (Durchführung durch `separate`), D10 (Kennzeichnung der äußeren Seite),
  D11 (Kopplung auf neues Teilstück übertragen).
