# 0021 — Benutzerlebenszyklus, Kontosperren, Passwortzurücksetzung und serverseitige Einstellungen

Status: accepted
Datum: 2026-10-01
Betrifft: Phase 4e
Präzisiert: [ADR 0015](0015-membership-administration-and-invitations.md) (Entscheidung 1
und die Passwort-Konsequenz), löst [ADR 0019](0019-personal-display-preferences-local-storage.md)
in der Frage des Speicherorts ab (lokal → Server, lokal nur noch Cache)

## Context

Bis Phase 4d verwaltet ein Betriebsadministrator nur die **Mitgliedschaft**: Status
(`active`/`disabled`) und feste Systemrollen. Name, E-Mail und Passwort gehören dem
**globalen Konto** (`users`), das mehreren Betrieben angehören kann (ADR 0006, ADR 0015).
Persönliche Einstellungen (Theme, Akzent, Maßeinheit) liegen nur im Browser (ADR 0019).

Phase 4e verlangt:

1. Einstellungen serverseitig je Benutzer, geräteübergreifend, mit Maßeinheit `m`.
2. Name und E-Mail durch den Administrator ändern.
3. Sperren mit **sofortiger** Wirkung auf jedes bestehende Token; Entsperren belebt nichts.
4. Passwortzurücksetzung, ausgelöst vom Administrator, das Passwort setzt die Person.
5. Benutzer endgültig entfernen, ohne Bearbeiterreferenzen zu verlieren.
6. Die Regel „mindestens ein aktiver Administrator“ unter jeder Parallelität.

## Problem

* **Kontohoheit.** ADR 0015 verbietet Kontoänderungen durch einen Betrieb, weil ein Konto
  auch einem anderen Betrieb gehören kann (betriebsübergreifende Übernahme). Ohne
  E-Mail-Versand landet der Reset-Link zudem beim Administrator.
* **Zugriffstokens leben weiter.** Access Tokens sind 15 Minuten gültig und tragen keinen
  Zustand. Die Statusprüfung je Anfrage sperrt zwar während der Sperre, aber ein vor der
  Sperre ausgestelltes Token wäre nach dem Entsperren wieder gültig; eine neue E-Mail oder
  ein neues Passwort ändert am Token gar nichts. Eine gleichzeitige Erneuerung kann noch
  einen Nachfolger mit altem Stand ausstellen, den der Widerruf nicht mehr sieht.
* **Entfernen vs. Referenzen.** `created_by_user_id`/`updated_by_user_id` zeigen auf
  `users.id`; ein physisches Löschen ließe „Erstellt von“ ins Leere laufen.
* **Mehrere Geräte.** Eine erstmalige Anlage auf zwei Geräten darf keine zwei Datensätze
  erzeugen, eine Änderung auf zwei Geräten nichts still überschreiben.

## Considered Options

**Kontohoheit** (mit dem Auftraggeber entschieden, 2026-10-01):
(A) Exklusive Konten: Kontoänderungen nur, wenn das Konto keinem anderen Betrieb (nicht
entfernt) angehört. (B) ADR 0015 Punkt 1 aufheben – betriebsübergreifendes
Übernahmerisiko. (C) Mehrfachmitgliedschaft abschaffen – weit über den Phasenumfang.

**Zustand:** (D) neuer Kontostatus an `users` neben `is_active` – zwei Wahrheiten, und ein
Betrieb würde das Konto aller Betriebe sperren. (E) Die bestehende Zustandsmaschine der
Mitgliedschaft um `removed` erweitern.

**Token-Ungültigkeit:** (F) prozesslokale Sperrliste – verboten (eine Instanz, kein
Neustart-Schutz). (G) Kurzlebigere Tokens – verschiebt nur das Fenster. (H) Eine
Sitzungsversion je Mitgliedschaft im Access **und** Refresh Token, je Anfrage verglichen.

**Einstellungen:** (I) JSON-Spalte am Benutzer. (J) Eigene typisierte, versionierte
Tabelle je Mitgliedschaft.

## Decision

### 1. Exklusive Konten (Option A) – Präzisierung von ADR 0015

* **Mitgliedschaftsaktionen** (sperren, entsperren, entfernen, Rollen) bleiben für jede
  Mitgliedschaft des eigenen Betriebs möglich.
* **Kontoaktionen** (Name, E-Mail, Passwortreset, Bereinigung beim Entfernen) nur, wenn das
  Konto keine **nicht entfernte** Mitgliedschaft in einem anderen Betrieb hat – sonst
  `409 account-shared`. Die Antwort nennt keinen Betrieb. Die Oberfläche zeigt die Aktion
  gesperrt mit Erklärung (`MemberOut.account_shared`).
* Die Exklusivität wird **unter der Kontosperre** geprüft und beim Einlösen eines
  Reset-Links erneut: Tritt das Konto inzwischen einem weiteren Betrieb bei, ist der Link
  ungültig. Die Annahme einer Einladung mit bestehendem Konto sperrt die Kontozeile und
  prüft die E-Mail erneut – so laufen Annahme und Adressänderung nie ineinander.

### 2. Zustandsmaschine an der Mitgliedschaft (Option E)

```
active  ──sperren──▶  disabled
disabled ──entsperren──▶ active
active | disabled ──entfernen──▶ removed   (endgültig, keine Rückkehr)
```

`organization_members.status` ist die einzige Zustandsquelle (CHECK über
`active|invited|disabled|removed`; `invited` ist historisch und ungenutzt). „Einladung
ausstehend“ bleibt ein Datensatz in `member_invitations` – kein halbfertiger Benutzer.
`users.is_active` bleibt der globale Schalter; ihn setzt nur die Bereinigung eines
exklusiven Kontos beim Entfernen auf `false`. Optionaler Sperrgrund `lock_reason`
(≤ 200 Zeichen, CHECK: nur bei `disabled`), beim Entsperren gelöscht, nie im Audit.

### 2a. Neutrale Ablehnung der Anmeldung (Nachkorrektur vor dem Commit)

Eine Sperre darf nicht zum Orakel werden. Bisher antwortete die Anmeldung mit richtigem
Passwort, aber ohne aktive Mitgliedschaft mit `404` „Keine aktive Mitgliedschaft in diesem
Betrieb“ und ein deaktiviertes Konto mit eigener Meldung – beides bestätigte, dass das
Passwort stimmte, und beides zählte nicht als Fehlversuch. Jetzt endet **jeder** abgelehnte
Anmeldeversuch gleich: unbekannte Adresse, falsches Passwort, deaktiviertes Konto, gesperrte,
entfernte oder fehlende Mitgliedschaft, ausdrücklich gewählter Betrieb ohne aktive
Mitgliedschaft → `401 authentication-failed`, Titel „Nicht angemeldet“, Meldung
„Anmeldung nicht möglich. Bitte Zugangsdaten prüfen oder die Administration kontaktieren.“, kein Token, kein Cookie.

* `AuthService.login` fängt „keine aktive Mitgliedschaft“ selbst ab; kein `404` verlässt
  den Login. Jeder Fall zählt als Fehlversuch je normalisierter E-Mail **und** je IP
  (bestehende Grenzen, danach `429`) – auch mit richtigem Passwort. So lässt sich gegen ein
  gesperrtes Konto nicht unbegrenzt prüfen, ob ein Passwort stimmt.
* Bei vorhandenem Konto ein Audit-Eintrag `auth.login_failed` nur mit der Konto-ID und
  „Fehlgeschlagene Anmeldung“; das Log schreibt `login_rejected` ohne E-Mail.
* Mehrere **aktive** Betriebe nach richtigen Zugangsdaten bleiben eine Auswahl
  (`409 organization-selection-required`), kein Fehler.
* Dieselbe Antwort bei der Prüfung bestehender Zugangsdaten in der Einladungsannahme
  (unbekannt, falsch, deaktiviert).
* Unberührt: die `404`-Semantik geschützter Mandantenendpunkte, auch
  `/auth/switch-organization` (dort ist der Aufrufer bereits angemeldet), und die Sperre selbst.

### 3. Sitzungsversion (Option H)

* `organization_members.session_version` (ab 1) steht als Claim `sv` in jedem Access Token
  und als Spalte in jedem Refresh Token. `get_current_user` vergleicht je Anfrage,
  `refresh` vergleicht vor der Rotation; Abweichung → `401`, Familie widerrufen
  (`session_outdated`).
* Hochgezählt (Core-`UPDATE`, ohne `version` zu zählen) bei: Sperren, Entsperren,
  Entfernen, neuer E-Mail, neuem Passwort. Zusätzlich werden offene Refresh Tokens
  widerrufen (`membership_disabled`, `membership_removed`, `credentials_changed`).
* Damit ist **jedes** vor der Änderung ausgestellte Token wertlos – auch eines, das eine
  gleichzeitige Erneuerung noch mit dem alten Stand ausgestellt hat (Wettlauf ohne
  zusätzliche Sperre geschlossen). Entsperren belebt nichts: Die Version ist bereits weiter.
* Je Mitgliedschaft statt je Konto: Eine Sperre in Betrieb A beendet keine Sitzung in
  Betrieb B (ADR 0015 Punkt 6 bleibt). Kontoänderungen gibt es nur bei exklusiven Konten –
  dort ist „alle Sitzungen des Kontos“ gleich „alle Sitzungen dieser Mitgliedschaft“.
* Access Tokens ohne `sv` (vor 4e ausgestellt) sind ungültig; der Client erneuert einmal
  über das Cookie, die Refresh Tokens im Bestand tragen Version 1.

### 4. Sperrwurzel und Sperrreihenfolge

Die **Organisationszeile** bleibt die Sperrwurzel (ADR 0015 Punkt 5). Jeder Schreibweg auf
Mitgliedschaft, Rollen, Profil, Reset-Link oder Entfernen sperrt in derselben Reihenfolge:

```
organizations → organization_members → users → password_reset_tokens
```

Erst unter der Organisationssperre werden der Handelnde neu geprüft und die aktiven
Administratoren gezählt (aktive Mitgliedschaft, aktives Konto, Rolle `admin`). Die
Einladungsanlage sperrt seit 4e ebenfalls die Organisationszeile (E-Mail-Änderung gegen
Einladung derselben Adresse). Die öffentliche Einlösung eines Reset-Links beginnt ohne
Organisationssperre bei der Mitgliedschaft und folgt ab dort derselben Reihenfolge; kein
Pfad hält eine spätere Zeile und wartet auf eine frühere – kein Deadlock. Die Annahme einer
Einladung sperrt `member_invitations → users` und nie eine Mitgliedschaft oder Organisation.
Gemeinsamer Code: `app/core/members/guard.py`.

Verboten (`409`): sich selbst sperren oder entfernen, sich selbst die Administratorrolle
nehmen (`self-lockout`); den letzten aktiven Administrator sperren, entfernen oder
herabstufen (`last-administrator`); jede Aktion an einem entfernten Konto
(`member-removed`).

### 5. Passwortzurücksetzung

* Eigene Tabelle `password_reset_tokens` (getrennt von Einladungen), höchstens ein offener
  Link je Mitgliedschaft (`UNIQUE member_id`), nur SHA-256-Hash eines Tokens mit 256 Bit
  Zufall (gemeinsame Hilfsfunktion mit Einladungen), Gültigkeit
  `ELEKTROPLAN_PASSWORD_RESET_VALID_MINUTES` (Standard 60).
* Auslösen: `user.password.reset`, nur aktive oder gesperrte, nie entfernte, nur exklusive
  Konten; ein neuer Link löscht den alten; je Mitgliedschaft begrenzt (Standard 5 je
  15 Minuten). Der Administrator legt **nie** ein Passwort fest und sieht keins.
* **Sperre als Sicherheitsstopp (Nachkorrektur vor dem Commit):** Eine Sperre löscht in
  derselben Transaktion jeden zuvor ausgestellten offenen Reset-Link der Mitgliedschaft
  (Reihenfolge `Organisation → Mitgliedschaft → Reset-Link`, kein Konto nötig); Entsperren
  belebt ihn nicht wieder. Ein Administrator darf für das gesperrte Mitglied **bewusst einen
  neuen** Link erzeugen: Das Passwort lässt sich damit setzen, die Sperre bleibt bestehen, und
  anmelden kann sich die Person erst nach dem Entsperren – dann nur mit dem neuen Passwort;
  alte Sitzungen bleiben ungültig. Gleichzeitig mit einer Einlösung entscheidet die
  Mitgliedschaftssperre: Hat die Einlösung zuerst committet, gilt das neue Passwort und die
  Sperre folgt; hat die Sperre zuerst committet, findet die Einlösung keinen Link mehr. Nach
  jeder abgeschlossenen Sperre bleibt kein zuvor ausgestellter Link übrig.
* Zustellung wie bei Einladungen (mit dem Auftraggeber entschieden):
  `ELEKTROPLAN_PASSWORD_RESET_DELIVERY=none|admin_link`. Ohne Zustellweg `503`, nichts
  angelegt. `admin_link` gibt den Link **genau einmal** in der Antwort zurück, in
  Produktion verweigert die Konfiguration den Start. Es gibt bewusst **keinen**
  E-Mail-Versand. Das Token steht im URL-Fragment (`#t=`), erreicht also weder
  Zugriffsprotokolle noch `Referer`.
* Einlösen (`/password-reset/preview|complete`, öffentlich): Token im Körper, Herkunfts-
  prüfung wie die Sitzungsendpunkte, Fehlversuche je IP begrenzt, **eine** Antwort für jeden
  ungültigen Link (`404 password-reset-invalid`). Kein Cookie wird gelesen oder gesetzt,
  keine Sitzung ausgestellt – CSRF ist damit auf die Herkunftsprüfung beschränkt, und ein
  fremder Seitenaufruf kann ohne das Token nichts bewirken. Ein zu schwaches Passwort
  verbraucht den Link nicht. Erfolg ist **atomar**: Mitgliedschaft → Konto → Link sperren,
  Link erneut prüfen, Passwort setzen, Link löschen, alle Refresh Tokens widerrufen,
  Sitzungsversion hochzählen – eine Transaktion. Zwei gleichzeitige Einlösungen: genau eine
  gelingt.

### 6. Entfernen als endgültiger Tombstone

„Benutzer entfernen“ ist **kein** wiederherstellbares Soft Delete:

* Status `removed`; Rollen, Einstellungen, offene Reset-Links gelöscht; Sitzungen
  widerrufen, Sitzungsversion hochgezählt; Bestätigung mit der aktuellen E-Mail-Adresse.
* Exklusives Konto: E-Mail → `removed-<user_id>@removed.invalid` (reservierte Domain,
  eindeutig, nicht anmeldbar), Name → „Entfernter Benutzer“, Passworthash → unbrauchbarer
  Marker, `is_active = false`, letzte Anmeldung gelöscht. Keine ursprünglichen Werte bleiben.
* Geteiltes Konto: bleibt für den anderen Betrieb unverändert; in diesem Betrieb erscheint
  es nur noch neutral.
* Die Zeile der Mitgliedschaft bleibt; Bearbeiterreferenzen lösen als
  `UserReference.kind = "removed"` („Entfernter Benutzer“) auf – ohne Name und ohne ID.
* Die frühere Adresse ist frei für eine neue Einladung. Weil die Eindeutigkeit
  `(organization_id, user_id)` nur noch für **nicht entfernte** Mitgliedschaften gilt
  (partieller Index), kann auch ein geteiltes Konto erneut beitreten.
* Eine **offene Einladung** wird nicht entfernt, sondern widerrufen (bestehender Weg).

| Vorgang | Wirkung | Umkehrbar |
|---|---|---|
| Einladung widerrufen | Einladungslink wertlos, kein Konto entsteht | neue Einladung |
| Benutzer sperren | Zugang zu diesem Betrieb endet sofort, alles andere bleibt | Entsperren (neue Anmeldung nötig) |
| Benutzer entfernen | Tombstone, Rollen/Einstellungen/Links weg, ggf. Konto bereinigt | **nein** |

### 7. Einstellungen (Option J)

* Tabelle `user_preferences`: je **Mitgliedschaft** genau ein Datensatz (`UNIQUE
  member_id`, zusammengesetzter Fremdschlüssel, `CASCADE`), `theme_mode`, `accent`,
  `length_unit` mit CHECK über die bekannten Werte, `version` für `If-Match`. Keine
  beliebige JSON-Ablage. Je Mitgliedschaft statt je Konto, weil jede mandantenbezogene
  Tabelle `organization_id` trägt (ADR 0006); ein Konto in zwei Betrieben hat dort
  getrennte Einstellungen (vorher: dieselbe im Browser).
* API ausschließlich für den Anfragenden, ohne ID im Pfad: `GET /me/preferences` (`200` mit
  `stored=false` und Standardwerten statt `404` – „noch nichts gespeichert“ ist kein
  Fehler), `POST` (nur ohne Stand, sonst `409 preferences-exist`), `PUT` mit `If-Match`
  (`428`/`409`). Kein ungeschütztes Upsert. Schreiben verlangt `user.preferences.write`
  (jede Systemrolle); Administratoren haben keinen Weg zu fremden Einstellungen.
* **Server ist die Wahrheit.** Der Browser hält nur einen Cache je Mitgliedschaft
  (`elektroplan.einstellungen.<member_id>`, Version 2) für die Darstellung vor der
  Serverantwort; jede Serverantwort ersetzt ihn. Ein Cache eines anderen Benutzers wird nie
  gelesen. **Einmalige Übernahme:** Hat der Server nichts, werden die alten lokalen
  Einträge (`elektroplan.darstellung.<user_id>`, `elektroplan.masseinheit.<user_id>`,
  browserweit `elektroplan.masseinheit`) einmal per `POST` übertragen und danach
  gelöscht; ohne gültigen Altbestand gilt der Standard, angelegt wird beim ersten
  Speichern. Gleichzeitige Anlage auf zwei Geräten: Der Server gewinnt.
* Die Anwendung bleibt zentral: `core/theme/darstellung.ts` (`data-theme`,
  `matchMedia`) und `core/ui/masseinheit.ts` halten nur noch den wirksamen Zustand; den
  Abgleich macht `core/einstellungen/persoenlich.ts`.

### 8. Maßeinheit Meter

`m` neben `mm` und `cm`; intern und in der API bleiben Längen ganzzahlige Millimeter
(ADR 0007). Umgerechnet wird nur in `core/masse.ts`, ohne Fließkomma (Ganzzahl plus
Ziffernfolge). Anzeige: `mm` ohne, `cm` mit höchstens einer nötigen, `m` mit immer drei
Nachkommastellen (`1250 mm` → `1.250 mm`, `125 cm`, `1,250 m`). Eingabe: Komma und Punkt,
Leerzeichen egal, ein angehängtes `mm`/`cm`/`m` gilt vorrangig; `1.250` ist in `mm`/`cm`
mehrdeutig und wird abgelehnt, in `m` ist es 1,25 m.

### 9. Berechtigungen

Neu, ausschließlich Administrator (`ADMIN_ONLY_PERMISSIONS`): `user.profile.write`,
`user.account.lock`, `user.password.reset`, `user.account.remove`. Neu für jede
Systemrolle: `user.preferences.write`. `user.account.write` umfasst nur noch Einladungen;
Sperren verlangt seit 4e `user.account.lock`. Angelegt und zugeordnet werden sie vom
idempotenten Seed (Seeds sind keine Migrationen) – **nach dem Update ist der Seed Pflicht**.

## Consequences

**Positiv**
* Kein Weg, über einen Betrieb ein Konto eines anderen Betriebs zu ändern, zurückzusetzen
  oder zu bereinigen.
* Jede sicherheitsrelevante Änderung beendet jede bestehende Sitzung serverseitig – ohne
  prozesslokale Liste, auch bei mehreren Instanzen, auch im Wettlauf mit einer Erneuerung.
* Keine Klartexttokens in der Datenbank, im Audit, in Logs oder Fehlern.
* Bearbeiterreferenzen bleiben nach dem Entfernen auflösbar, ohne Personendaten.
* Die Anmeldung verrät weder, ob ein Passwort stimmte, noch einen Konto- oder
  Mitgliedschaftszustand; jede Ablehnung zählt für die Begrenzung.
* Einstellungen geräteübergreifend, versioniert, ohne stilles Überschreiben.

**Negativ / Grenzen**
* Ohne E-Mail-Versand übergibt der Administrator den Reset-Link selbst; er könnte ihn
  missbrauchen und das Passwort selbst setzen. Das ist nur außerhalb der Produktion
  zulässig und im Audit sichtbar (`member.password_reset_issued`).
* Die Fehlermeldung `account-shared` verrät einem Administrator, dass ein Mitglied noch
  einem anderen (ungenannten) Betrieb angehört; `email-unavailable` verrät, dass eine
  Adresse vergeben ist. Beides nur mit Administratorrechten; als Restrisiko akzeptiert.
* Ein Konto in mehreren Betrieben hat je Betrieb eigene Einstellungen.
* Ältere Audit-Einträge vor 4e können in der Anmeldezusammenfassung eine E-Mail enthalten
  (`Anmeldung <email>`); sie werden nicht nachträglich verändert (Audit ist unveränderlich).
  Seit 4e steht dort nur „Anmeldung“.
* Downgrade auf `0006`: Einstellungen und Reset-Links gehen verloren; entfernte
  Mitgliedschaften werden zu `disabled`, ein Tombstone neben einer erneuten Mitgliedschaft
  wird gelöscht.
