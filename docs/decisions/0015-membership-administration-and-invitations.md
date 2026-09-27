# 0015 — Mitgliedschaftsverwaltung, Einladungen und die Regel des letzten Administrators

Status: accepted
Datum: 2026-09-27

## Context

Bis Phase 4a entstanden Benutzer ausschließlich über den Seed. Phase 4.2 führt eine
Benutzerverwaltung im Betrieb ein: einladen, sperren, Rollen vergeben. Das Datenmodell
trennt seit ADR 0006 die **globale Identität** (`users`) von der **Mitgliedschaft**
(`organization_members`); Rollen hängen an der Mitgliedschaft. Ein Konto kann mehreren
Betrieben angehören.

Daraus entstehen drei Fragen, die über diese Phase hinaus gelten:

1. Was darf der Administrator eines Betriebs an einem Konto ändern, das womöglich auch
   anderen Betrieben gehört?
2. Wie kommt eine neue Person in den Betrieb, ohne dass ein Administrator ein fremdes
   Konto übernehmen kann?
3. Wie bleibt ein Betrieb unter echter Parallelität nie ohne aktiven Administrator?

## Problem

Ein Administrator verwaltet **seinen** Betrieb. Dürfte er das globale Passwort, die
E-Mail oder `users.is_active` ändern, könnte er ein Konto übernehmen oder aussperren,
das auch in einem anderen Betrieb arbeitet – eine betriebsübergreifende Rechteausweitung.
Ein Einladungslink ist ein Einmal-Geheimnis; landet er im Klartext in der Datenbank,
im Protokoll oder in Logs, ersetzt er für jeden Leser die Anmeldung. Und eine Prüfung
„gibt es noch einen anderen Administrator?“ ohne Sperre besteht bei zwei gleichzeitigen
Anfragen beide Male.

## Considered Options

**Einladung:**
(A) Mitgliedschaft mit Status `invited` sofort anlegen – verlangt ein Konto, das es
noch nicht gibt (`users.password_hash` ist Pflicht). (B) Platzhalterkonto anlegen –
eine Identität ohne Person, deren Passwort später jemand setzt: genau der
Übernahmeweg, der vermieden werden soll. (C) Eigener Einladungsdatensatz je E-Mail;
Konto und Mitgliedschaft entstehen erst bei der Annahme.

**Bestehendes Konto:**
(D) Einladungstoken setzt das Passwort – Übernahme. (E) Annahme nur mit aktiver
Sitzung – scheitert bei einem Konto ohne aktive Mitgliedschaft. (F) Annahme mit den
Anmeldedaten **genau der eingeladenen Adresse**, geprüft wie eine Anmeldung.

**Letzter Administrator:**
(G) Zählen vor der Änderung – unter Parallelität wirkungslos. (H) Datenbanktrigger –
bildet Rollenlogik in SQL nach, schwer nachvollziehbar. (I) Zeilensperre auf der
Organisation als Sperrwurzel, danach zählen.

## Decision

**1. Der Betrieb verwaltet nur die Mitgliedschaft.** Ändern lassen sich Status (`active`
↔ `disabled`) und Systemrollen. Name, E-Mail, Passwort und `users.is_active` gehören
dem Konto und sind über die Verwaltung **nicht** erreichbar – es gibt keinen Endpunkt
dafür. „Sperren“ heißt: Zugang zu **diesem** Betrieb sperren.

**2. Einladungen sind eigene Datensätze (Option C).** `member_invitations` hält E-Mail,
optionalen Namen, vorgesehene Systemrollen (`member_invitation_roles`), Ersteller,
Ablauf, Annahme- oder Widerrufszeitpunkt und **nur den SHA-256-Hash** eines Tokens mit
256 Bit Zufall. Der Zustand (offen/abgelaufen/angenommen/widerrufen) wird abgeleitet.
Je Betrieb und E-Mail gibt es höchstens eine offene Einladung (partieller eindeutiger
Index). Erneut ausstellen ersetzt Hash und Frist – das alte Token findet danach keinen
Datensatz. Die Annahme sperrt die Einladungszeile und legt Konto (falls nötig),
Mitgliedschaft und Rollen in **einer** Transaktion an.

**3. Bestehende Konten (Option F).** Die Annahme hat zwei ausdrückliche Wege:
*neues Konto* – nur wenn zur E-Mail kein Konto existiert, sonst `409
invitation-requires-login` ohne jede Änderung – und *bestehendes Konto* – mit dem
Passwort des Kontos **der eingeladenen E-Mail**, über dieselbe Prüfung und dieselbe
Begrenzung wie die Anmeldung. Ein bestehendes Konto wird nie verändert. Nur wer das
gültige Token besitzt, erfährt, ob zur Adresse ein Konto existiert – er braucht es für
den richtigen Weg.

**4. Keine vorgetäuschte Zustellung.** Ein E-Mail-Versand existiert noch nicht. Ohne
eingerichteten Zustellweg (`ELEKTROPLAN_INVITATION_DELIVERY=none`, Standard) wird
**keine** Einladung angelegt (`503`). `development_link` gibt den Link einmalig in der
Antwort an den Einladenden zurück; in Produktion verweigert die Konfiguration den Start.
Das Token steht im URL-**Fragment** und erreicht so weder Server-Logs noch `Referer`.

**5. Die Organisation ist die Sperrwurzel der Mitgliedschaften (Option I).** Jede
Änderung an Status oder Rollen einer Mitgliedschaft sperrt zuerst `organizations`
(`SELECT … FOR UPDATE`), dann die Mitgliedschaft. Unter der Sperre wird der Handelnde
erneut geprüft (aktiv, Berechtigung vorhanden) und danach gezählt: Ein aktiver
Administrator ist eine aktive Mitgliedschaft mit Rolle `admin` und aktivem Konto.
Selbstsperre und das Entfernen der eigenen Administratorrolle sind ausgeschlossen
(`409 self-lockout`); bliebe kein Administrator übrig, `409 last-administrator`.
Sperrreihenfolge überall: `Organisation → Mitgliedschaft`.

**6. Sofortige Wirkung ohne Token-Inhalt.** Berechtigungen und Mitgliedsstatus werden
weiterhin pro Anfrage geladen. Eine Sperre widerruft zusätzlich alle offenen Refresh
Tokens **dieser** Mitgliedschaft (`membership_disabled`); Tokens anderer Betriebe
bleiben. Ein Refresh bei gesperrter Mitgliedschaft liefert `401` und widerruft die Familie.

## Consequences

**Positiv**
- Kein Weg, über einen Betrieb ein Konto eines anderen Betriebs zu übernehmen oder
  auszusperren.
- Token nie im Klartext gespeichert, nie im Protokoll, nie in Logs; ungültige Tokens
  erhalten eine einheitliche Antwort.
- Der letzte Administrator ist auch unter Parallelität geschützt – nachgewiesen mit
  einem Paralleltest samt Gegenprobe ohne Sperre (null Administratoren).
- `organization_members.version` macht Status- und Rollenänderungen versioniert
  (`If-Match`), wie alle anderen verwaltbaren Entitäten.

**Negativ**
- Alle Status- und Rollenänderungen eines Betriebs laufen nacheinander. Bei der
  Häufigkeit solcher Änderungen unerheblich.
- Ohne E-Mail-Versand sind Einladungen in Produktion nicht nutzbar. Das ist gewollt
  und sichtbar, nicht verschwiegen.
- Passwortwiederherstellung gibt es nicht; sie wird als eigener, benutzergesteuerter
  Ablauf mit E-Mail-Versand eingeführt – nie als Funktion eines Betriebsadministrators.
- Im Entwicklungsmodus hält der Einladende das Token in der Hand und könnte eine
  Einladung an eine noch kontolose Adresse selbst annehmen. Deshalb ist
  `development_link` in Produktion verboten.
