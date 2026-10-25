// GENERIERT - nicht bearbeiten.
// Quelle: apps/backend (OpenAPI). Neu erzeugen mit: npm run generate:api
export interface paths {
    "/api/v1/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Anmelden
         * @description Meldet einen Benutzer an.
         *
         *     Der Access Token steht in der Antwort, der Refresh Token ausschliesslich im
         *     HttpOnly-Cookie. Gehoert das Konto mehreren Betrieben an und wurde keiner
         *     gewaehlt, antwortet der Endpunkt mit ``409`` und der Auswahlliste.
         */
        post: operations["login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sitzung erneuern
         * @description Rotiert den Refresh Token und liefert einen neuen Access Token.
         *
         *     Der Token wird ausschliesslich dem Cookie entnommen - es gibt keinen
         *     Anfragekoerper, in dem er stehen koennte.
         */
        post: operations["refreshSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Abmelden
         * @description Widerruft die Token-Familie serverseitig und loescht das Cookie.
         */
        post: operations["logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/switch-organization": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mandanten wechseln
         * @description Wechselt den aktiven Betrieb gegen eine gepruefte Mitgliedschaft.
         */
        post: operations["switchOrganization"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Angemeldeter Benutzer
         * @description Benutzer, aktiver Mandant, Rollen und Berechtigungen.
         */
        get: operations["getCurrentUser"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/organizations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Eigene Betriebe
         * @description Alle Betriebe, in denen der Benutzer aktiv ist.
         */
        get: operations["listMyOrganizations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Registrierte Module
         * @description Alle im Backend registrierten Module.
         */
        get: operations["listModules"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/modules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Aktive Module
         * @description Module, die fuer den aktuellen Betrieb aktiv sind.
         *
         *     Steuert die Sichtbarkeit im Frontend. Die eigentliche Absicherung bleibt
         *     serverseitig - ein ausgeblendeter Tab ist kein Zugriffsschutz.
         */
        get: operations["listMyModules"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Protokolleintraege
         * @description Protokoll der eigenen Organisation, neueste zuerst.
         */
        get: operations["listAuditEntries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Kunden auflisten
         * @description Kunden der eigenen Organisation - gefiltert, sortiert, nummerierte Seiten.
         *
         *     Eine Seite hinter der letzten liefert die letzte vorhandene Seite; das
         *     Feld ``page`` der Antwort nennt sie (ADR 0017).
         */
        get: operations["listCustomers"];
        put?: never;
        /**
         * Kunden anlegen
         * @description Legt einen Kunden an. Die Kundennummer vergibt der Nummernkreis.
         */
        post: operations["createCustomer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customers/{customer_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Kunde
         * @description Ein Kunde der eigenen Organisation.
         */
        get: operations["getCustomer"];
        put?: never;
        post?: never;
        /**
         * Kunden endgueltig loeschen
         * @description Loescht den Kunden **physisch** aus der operativen Datenbank (ADR 0020).
         *
         *     Nur Administratoren, und nur wenn dem Kunden **kein einziges** Projekt
         *     zugeordnet ist - gleich in welchem Status.
         *     Sonst ``409 customer-has-projects``.
         *
         *     **Sperre, Pruefung und Loeschung liegen in einer Transaktion.** Die
         *     Kundenzeile wird zuerst gesperrt; eine gleichzeitige Projektanlage oder ein
         *     Kundenwechsel sperrt dieselbe Zeile und wartet. Danach findet sie den
         *     Kunden nicht mehr (``404``) - ein Projekt ohne Kunden kann nicht entstehen.
         *
         *     Das Protokoll haelt nur Kunden-ID und Kundennummer fest, keine
         *     personenbezogenen Daten. Die Kundennummer wird nie wiederverwendet.
         *     Backups enthalten den Datensatz bis zum Ablauf ihrer Aufbewahrungsfrist
         *     (docs/security.md, Abschnitt 13).
         */
        delete: operations["deleteCustomer"];
        options?: never;
        head?: never;
        /**
         * Kunde bearbeiten
         * @description Aendert einzelne Felder. Die Kundennummer bleibt unveraendert.
         */
        patch: operations["updateCustomer"];
        trace?: never;
    };
    "/api/v1/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Projekte auflisten
         * @description Projekte der eigenen Organisation - gefiltert, sortiert, nummerierte Seiten.
         *
         *     Eine Seite hinter der letzten liefert die letzte vorhandene Seite; das
         *     Feld ``page`` der Antwort nennt sie (ADR 0017).
         */
        get: operations["listProjects"];
        put?: never;
        /**
         * Projekt anlegen
         * @description Legt ein Projekt an. Die Projektnummer vergibt der Nummernkreis.
         */
        post: operations["createProject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Projekt
         * @description Ein Projekt der eigenen Organisation.
         */
        get: operations["getProject"];
        put?: never;
        post?: never;
        /**
         * Projekt endgueltig loeschen
         * @description Loescht ein Projekt **endgueltig** samt Struktur, Dateien und Planungsdaten.
         *
         *     Nur ``draft`` und ``active``. Ein leeres Projekt duerfen alle mit
         *     ``project.record.delete`` loeschen, ein Projekt mit Inhalt nur, wer
         *     zusaetzlich ``project.record.purge`` hat - und nur mit
         *     ``confirm_project_number``. Alles wird unter der Projektsperre in einer
         *     Transaktion geprueft und geloescht (ADR 0020).
         *
         *     Die Storage-Objekte der Dateien werden in derselben Transaktion zur
         *     Loeschung vorgemerkt und erst **nach** dem Commit entfernt. Scheitert das,
         *     bleibt der Auftrag offen (``python -m app.cli storage-cleanup``); die
         *     Antwort ist trotzdem ``204``, denn das Projekt ist geloescht.
         *
         *     Die Projektnummer wird nie wiederverwendet: Der Nummernkreis zaehlt nur
         *     hoch.
         */
        delete: operations["deleteProject"];
        options?: never;
        head?: never;
        /**
         * Projekt bearbeiten
         * @description Aendert Stammdaten. Status und Projektnummer bleiben unberuehrt.
         *
         *     Ein archiviertes oder abgeschlossenes Projekt ist schreibgeschuetzt und liefert ``409``.
         */
        patch: operations["updateProject"];
        trace?: never;
    };
    "/api/v1/projects/{project_id}/deletion-check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Loeschwirkung eines Projekts pruefen
         * @description Was eine Loeschung bedeuten wuerde - fuer den Bestaetigungsdialog.
         *
         *     **Keine Autorisierung und keine Garantie:** ``DELETE`` prueft Status,
         *     Inhalte und Berechtigung erneut unter der Projektsperre (ADR 0020).
         */
        get: operations["checkProjectDeletion"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project_id}/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Projekt in Bearbeitung nehmen
         * @description Setzt den Status von ``draft`` auf ``active``.
         */
        post: operations["activateProject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project_id}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Projekt abschliessen
         * @description Setzt den Status von ``active`` auf ``completed``.
         */
        post: operations["completeProject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project_id}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Projekt archivieren
         * @description Archiviert das Projekt. Aus ``archived`` fuehrt kein Weg zurueck.
         */
        post: operations["archiveProject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project_id}/reopen": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Abgeschlossenes Projekt wieder in Bearbeitung setzen
         * @description ``completed -> active``. Nur Administratoren; ``archived`` bleibt endgueltig.
         *
         *     Danach gilt das Projekt wieder als laufend und unterliegt allen Regeln
         *     eines aktiven Projekts (ADR 0020).
         */
        post: operations["reopenProject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project_id}/buildings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Gebaeude eines Projekts
         * @description Gebaeude des Projekts, sortiert nach Reihenfolge und Name.
         */
        get: operations["listBuildings"];
        put?: never;
        /**
         * Gebaeude anlegen
         * @description Legt ein Gebaeude im Projekt an.
         */
        post: operations["createBuilding"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/buildings/{building_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Gebaeude loeschen
         * @description Entfernt das Gebaeude samt seiner Geschosse endgueltig.
         */
        delete: operations["deleteBuilding"];
        options?: never;
        head?: never;
        /**
         * Gebaeude bearbeiten
         * @description Aendert Name oder Reihenfolge eines Gebaeudes.
         */
        patch: operations["updateBuilding"];
        trace?: never;
    };
    "/api/v1/buildings/{building_id}/floors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Geschosse eines Gebaeudes
         * @description Geschosse des Gebaeudes, von unten nach oben.
         */
        get: operations["listFloors"];
        put?: never;
        /**
         * Geschoss anlegen
         * @description Legt ein Geschoss an. Je Gebaeude ist jede Ebene nur einmal belegbar.
         */
        post: operations["createFloor"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/floors/{floor_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Geschoss loeschen
         * @description Entfernt das Geschoss endgueltig.
         */
        delete: operations["deleteFloor"];
        options?: never;
        head?: never;
        /**
         * Geschoss bearbeiten
         * @description Aendert Name, Ebene oder Hoehenangaben eines Geschosses.
         *
         *     Eine neue Standard-Deckenhoehe pruefen die Fachmodule vorher (ADR 0022):
         *     Wuerde sie eine vorhandene Oeffnung ungueltig machen, ``422``.
         */
        patch: operations["updateFloor"];
        trace?: never;
    };
    "/api/v1/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Datei hochladen
         * @description Nimmt eine Datei entgegen, prueft sie und legt sie im Storage ab.
         *
         *     Mit ``project_id`` wird die Datei einem Projekt zugeordnet; das Projekt
         *     muss der eigenen Organisation gehoeren und darf weder archiviert noch
         *     abgeschlossen sein.
         *
         *     Der Koerper wird erst nach Anmeldung, Berechtigung und Anfragegrenzen
         *     gelesen; eine zu grosse Anfrage endet mit ``413``, bevor sie vollstaendig
         *     angenommen ist (:mod:`app.core.files.upload_form`).
         */
        post: operations["uploadFile"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project_id}/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Dateien eines Projekts
         * @description Alle Dateien des Projekts, neueste zuerst.
         */
        get: operations["listProjectFiles"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{file_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Dateimetadaten
         * @description Metadaten einer Datei der eigenen Organisation.
         */
        get: operations["getFile"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{file_id}/download-url": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download-Adresse einer Datei
         * @description Liefert die signierte Download-Adresse als JSON.
         *
         *     Warum zusaetzlich zu ``/files/{id}/download``: Der Umleitungsendpunkt
         *     verlangt ``Authorization: Bearer``. Ein einfacher Link im Browser kann
         *     diesen Header nicht setzen, und der Token darf nicht in die URL wandern.
         *     Die Oberflaeche holt deshalb zuerst die Adresse und navigiert dann dorthin.
         */
        get: operations["getFileDownloadUrl"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{file_id}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Datei herunterladen
         * @description Leitet auf eine kurzlebige, autorisierte Download-URL um.
         */
        get: operations["downloadFile"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Feste Systemrollen
         * @description Die ausgelieferten Systemrollen mit Einsatzzweck und Berechtigungen.
         *
         *     Nur lesend: Rollen und die zentrale Permission-Registry sind in dieser
         *     Phase nicht bearbeitbar.
         */
        get: operations["listSystemRoles"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Benutzer des Betriebs
         * @description Mitgliedschaften und offene Einladungen, nach Name sortiert, seitenweise.
         *
         *     Ohne ``status``: aktive und gesperrte Mitglieder sowie offene Einladungen.
         *     ``status=invited`` zeigt nur offene (auch abgelaufene) Einladungen,
         *     ``status=removed`` nur entfernte Konten - neutral, ohne Name und E-Mail.
         */
        get: operations["listMembers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/members/{member_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Mitglied
         * @description Eine Mitgliedschaft im aktuellen Betrieb.
         */
        get: operations["getMember"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Name und E-Mail-Adresse eines Mitglieds aendern
         * @description Aendert Name und/oder E-Mail-Adresse des Kontos.
         *
         *     Nur fuer Konten, die keinem anderen Betrieb angehoeren (``409
         *     account-shared``). Eine neue E-Mail-Adresse beendet jede Sitzung der
         *     Person; anmelden kann sie sich danach nur noch mit der neuen Adresse.
         *     Ist die Adresse bereits einem Konto oder einer offenen Einladung dieses
         *     Betriebs zugeordnet: ``409 email-unavailable``.
         */
        patch: operations["updateMemberProfile"];
        trace?: never;
    };
    "/api/v1/members/{member_id}/suspend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Zugang zu diesem Betrieb sperren
         * @description Sperrt den Zugang des Mitglieds zu **diesem** Betrieb.
         *
         *     Das globale Konto und Mitgliedschaften in anderen Betrieben bleiben
         *     unberuehrt. Jede Sitzung in diesem Betrieb endet sofort: Refresh Tokens
         *     werden widerrufen, und bereits ausgestellte Access Tokens scheitern ab
         *     dem Commit an der Sitzungsversion. Der Koerper ist Pflicht (``{}`` genuegt);
         *     ein Sperrgrund darin ist optional und kurz.
         */
        post: operations["suspendMember"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/members/{member_id}/reactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Zugang zu diesem Betrieb wieder freigeben
         * @description Gibt den Zugang zu diesem Betrieb wieder frei.
         *
         *     Alte Sitzungen bleiben ungueltig; die Person meldet sich neu an. Ein
         *     entferntes Konto laesst sich nicht reaktivieren (``409 member-removed``).
         */
        post: operations["reactivateMember"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/members/{member_id}/password-reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Einmal-Link zum Zuruecksetzen des Passworts erzeugen
         * @description Erzeugt einen Einmal-Link; ein bisher offener Link wird ungueltig.
         *
         *     Kein ``If-Match``: Der Vorgang aendert die Mitgliedschaft nicht, er legt
         *     nur einen neuen Link an. Der Link steht **nur in dieser Antwort**
         *     (``ELEKTROPLAN_PASSWORD_RESET_DELIVERY=admin_link``); er wird nicht
         *     gespeichert, nicht protokolliert und ist spaeter nicht abrufbar. Das
         *     Passwort setzt ausschliesslich die Person selbst.
         */
        post: operations["issueMemberPasswordReset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/members/{member_id}/remove": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mitglied endgueltig entfernen
         * @description Entfernt ein Mitglied endgueltig - ein Tombstone, keine Wiederherstellung.
         *
         *     Bestaetigt wird mit der aktuellen E-Mail-Adresse des Kontos
         *     (``confirm_email``). Rollen, Einstellungen, Reset-Links und Sitzungen
         *     enden; Bearbeiterangaben zeigen danach "Entfernter Benutzer". Gehoert das
         *     Konto keinem anderen Betrieb an, werden Name und E-Mail durch neutrale
         *     Platzhalter ersetzt, und die Adresse ist fuer eine neue Einladung frei.
         *     Eine **offene Einladung** wird nicht hier, sondern ueber ihren Widerruf
         *     entfernt.
         */
        post: operations["removeMember"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/members/{member_id}/permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Rollen und effektive Berechtigungen eines Mitglieds
         * @description Zugewiesene Rollen und daraus folgende Berechtigungen samt Herkunft.
         */
        get: operations["getMemberPermissions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/members/{member_id}/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Rollen eines Mitglieds ersetzen
         * @description Ersetzt die Systemrollen eines Mitglieds als Ganzes - atomar.
         *
         *     ``If-Match`` traegt die Version der Mitgliedschaft. Die Aenderung wirkt ab
         *     der naechsten Anfrage des Mitglieds, ohne erneute Anmeldung.
         */
        put: operations["replaceMemberRoles"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/invitations/policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Rahmen fuer Einladungen
         * @description Gueltigkeit und eingerichteter Zustellweg - fuer Hinweise im Dialog.
         */
        get: operations["getInvitationPolicy"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/invitations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Benutzer einladen
         * @description Laedt eine E-Mail-Adresse mit festen Systemrollen in diesen Betrieb ein.
         *
         *     Verlangt zusaetzlich ``role.assignment.write``: Die Einladung vergibt
         *     Rollen. Ohne eingerichteten Zustellweg wird nichts angelegt (``503``).
         */
        post: operations["createInvitation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/invitations/{invitation_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Einladung
         * @description Eine Einladung dieses Betriebs - ohne Token und ohne Link.
         */
        get: operations["getInvitation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/invitations/{invitation_id}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Einladung widerrufen
         * @description Widerruft eine offene oder abgelaufene Einladung. Das Token wird wertlos.
         */
        post: operations["revokeInvitation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/invitations/{invitation_id}/reissue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Einladung erneut ausstellen
         * @description Stellt eine Einladung mit neuem Token und neuer Frist aus.
         *
         *     Das bisherige Token ist danach ungueltig.
         */
        post: operations["reissueInvitation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/invitation-acceptance/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Einladung pruefen
         * @description Zeigt dem Inhaber eines gueltigen Tokens Betrieb und E-Mail der Einladung.
         *
         *     ``account_exists`` sagt, welcher Annahmeweg gilt. Aendert nichts.
         */
        post: operations["previewInvitation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/invitation-acceptance/new-account": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Einladung mit neuem Konto annehmen
         * @description Legt Konto und Mitgliedschaft in **einer** Transaktion an.
         *
         *     Nur fuer eine E-Mail ohne bestehendes Konto. Es gelten die Passwortregeln
         *     der Anmeldung.
         */
        post: operations["acceptInvitationWithNewAccount"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/invitation-acceptance/existing-account": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Einladung mit bestehendem Konto annehmen
         * @description Nimmt die Einladung mit dem Passwort des bestehenden Kontos an.
         *
         *     Geprueft wird das Konto **der eingeladenen E-Mail**. Das Konto selbst wird
         *     nicht veraendert.
         */
        post: operations["acceptInvitationWithExistingAccount"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/password-reset/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reset-Link pruefen
         * @description Prueft den Link, ohne etwas zu aendern. Verraet nur die Ablaufzeit.
         */
        post: operations["previewPasswordReset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/password-reset/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Neues Passwort mit dem Einmal-Link setzen
         * @description Setzt das Passwort, verbraucht den Link und beendet alle Sitzungen - atomar.
         *
         *     Es gelten die Passwortregeln der Anmeldung. Ein zu schwaches Passwort
         *     verbraucht den Link nicht.
         */
        post: operations["completePasswordReset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Eigene Einstellungen
         * @description Der gespeicherte Stand - oder die Standardwerte mit ``stored=false``.
         *
         *     Bewusst ``200`` statt ``404``: "noch nichts gespeichert" ist der
         *     regulaere Zustand nach der ersten Anmeldung, kein Fehler.
         */
        get: operations["getMyPreferences"];
        /**
         * Eigene Einstellungen aendern
         * @description Ersetzt den Serverstand als Ganzes - nur mit der aktuellen Version.
         */
        put: operations["replaceMyPreferences"];
        /**
         * Eigene Einstellungen erstmalig speichern
         * @description Legt den Serverstand an - nur, solange es noch keinen gibt.
         *
         *     Fuer die einmalige Uebernahme eines alten lokalen Stands und fuer das
         *     erste Speichern. Existiert bereits einer, gewinnt er (``409``).
         */
        post: operations["createMyPreferences"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/floors/{floor_id}/rooms": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Raeume eines Geschosses
         * @description Raeume des Geschosses - nach Raumnummer, dann Name, dann ID sortiert.
         *
         *     Keine Cursor-Pagination: Ein Geschoss hat Raeume in zweistelliger Anzahl.
         *     Eine Seitenmechanik ohne Bedarf waere nur mehr Vertrag zum Pflegen.
         */
        get: operations["listElectricalRooms"];
        put?: never;
        /**
         * Raum anlegen
         * @description Legt einen Raum auf dem Geschoss an. Die Kontur folgt als Waende.
         */
        post: operations["createElectricalRoom"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/rooms/{room_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Raum
         * @description Ein Raum samt berechneter Flaeche, Umfang und Konturzustand.
         */
        get: operations["getElectricalRoom"];
        put?: never;
        post?: never;
        /**
         * Raum loeschen
         * @description Entfernt den Raum endgueltig - samt seiner Waende und Oeffnungen.
         */
        delete: operations["deleteElectricalRoom"];
        options?: never;
        head?: never;
        /**
         * Raum bearbeiten
         * @description Aendert Name, Raumnummer oder Raumhoehe.
         *
         *     Wegpunkte oder Durchfuehrungen ueber einer abgesenkten Hoehe: ``422``. Unterbricht die
         *     Aenderung eine Leitung (etwa Uebergang zur Decke), braucht es ``acknowledged_cable_ids``.
         */
        patch: operations["updateElectricalRoom"];
        trace?: never;
    };
    "/api/v1/modules/electrical/rooms/{room_id}/contour": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Raumkontur pruefen
         * @description Vollstaendige Pruefung der Raumkontur.
         *
         *     Reine Auskunft: Der Aufruf aendert nichts und ist beliebig wiederholbar.
         *     Der Konturzustand ist **abgeleitet** und nicht gespeichert (ADR 0013) -
         *     deshalb gibt es keinen Abschlussvorgang, der ihn festschreibt. Wer wissen
         *     will, warum ein Raum noch im Entwurf steht, liest hier die Einzelfehler.
         */
        get: operations["getElectricalRoomContour"];
        /**
         * Raumkontur als Ganzes speichern
         * @description Ersetzt Waende und Oeffnungen eines Raums **atomar** durch den Zielzustand.
         *
         *     ``If-Match`` traegt die Version des **Raums** - sie ist die Version der
         *     gesamten Raumgeometrie. Die Reihenfolge der Waende ist die Reihenfolge in
         *     der Liste. Bekannte IDs werden geaendert, neue angelegt, fehlende Waende
         *     entfernt. Oeffnungen verschwinden nur, wenn sie in
         *     ``removed_opening_ids`` stehen; Wandkopplungen entfallender Waende nur,
         *     wenn sie in ``removed_wall_link_ids`` stehen (sonst ``409 wall-has-links``).
         *     Jeder Fehler laesst den Raum
         *     unveraendert; bei Erfolg entsteht genau ein ``electrical.plan.updated``
         *     (``walls_changed``).
         *
         *     Der ``GET`` auf derselben Adresse liefert den Pruefbericht dieser Kontur.
         *
         *     **Leitungen (6b.3):** Endgeraete und Waende mit Leitungsbezug werden nicht entfernt
         *     (``409``); eine Oeffnung ueber einer Wandstrecke ist ``422``. Jede andere
         *     Unterbrechung braucht ``acknowledged_cable_ids`` mit **genau** den betroffenen
         *     Leitungen (sonst ``409 cables-would-break``; verlangt ``electrical.route.write``).
         */
        put: operations["replaceElectricalRoomContour"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/floors/{floor_id}/plan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Planungsstand eines Geschosses
         * @description Raeume, Waende und Oeffnungen eines Geschosses in **einer** Antwort.
         *
         *     Fuer den grafischen Editor, der den Stand ohnehin vollstaendig braucht.
         *     Geschossbezogen statt projektweit: Der Editor zeigt genau ein Geschoss,
         *     und die Antwort bleibt damit begrenzt. Die Anzahl der Datenbankabfragen
         *     haengt nicht von der Zahl der Raeume ab. Archivierte Projekte bleiben
         *     lesbar.
         */
        get: operations["getElectricalFloorPlan"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/device-types": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Geraetetypen des Systemkatalogs
         * @description Der ausgelieferte Geraetekatalog (Phase 5) in Katalogreihenfolge.
         *
         *     Global fuer alle Betriebe; deaktivierte Typen stehen mit ``is_active =
         *     false`` dabei, damit vorhandene Geraete benannt werden koennen.
         */
        get: operations["listElectricalDeviceTypes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/rooms/{room_id}/walls": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Waende eines Raums
         * @description Waende in Konturreihenfolge, jede mit ihrer gerundeten Laenge.
         */
        get: operations["listElectricalWalls"];
        put?: never;
        /**
         * Wand anlegen
         * @description Haengt eine Wand hinten an die Kontur des Raums.
         */
        post: operations["createElectricalWall"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/walls/{wall_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Wand loeschen
         * @description Entfernt die Wand. Traegt sie noch Oeffnungen, antwortet der Server ``409``.
         */
        delete: operations["deleteElectricalWall"];
        options?: never;
        head?: never;
        /**
         * Wand bearbeiten
         * @description Aendert Koordinaten oder Wandstaerke.
         *
         *     Wuerde eine vorhandene Oeffnung dadurch ausserhalb der Wand liegen, wird
         *     die Aenderung mit ``422`` abgelehnt - eine Tuer wird nicht stillschweigend
         *     ungueltig.
         */
        patch: operations["updateElectricalWall"];
        trace?: never;
    };
    "/api/v1/modules/electrical/rooms/{room_id}/walls/reorder": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Waende umordnen
         * @description Setzt die Konturreihenfolge neu.
         *
         *     ``If-Match`` traegt die Version des **Raums**: Die Reihenfolge gehoert der
         *     Kontur als Ganzes, nicht einer einzelnen Wand.
         */
        post: operations["reorderElectricalWalls"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/walls/{wall_id}/openings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Oeffnungen einer Wand
         * @description Oeffnungen der Wand, vom Wandanfang aus sortiert.
         */
        get: operations["listElectricalOpenings"];
        put?: never;
        /**
         * Oeffnung anlegen
         * @description Legt Tuer, Fenster oder Durchgang in der Wand an.
         */
        post: operations["createElectricalOpening"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/openings/{opening_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Oeffnung loeschen
         * @description Entfernt die Oeffnung endgueltig.
         */
        delete: operations["deleteElectricalOpening"];
        options?: never;
        head?: never;
        /**
         * Oeffnung bearbeiten
         * @description Aendert Art, Lage oder Abmessungen der Oeffnung.
         */
        patch: operations["updateElectricalOpening"];
        trace?: never;
    };
    "/api/v1/modules/electrical/floors/{floor_id}/wall-links": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Wandkopplungen und Kandidaten eines Geschosses
         * @description Gespeicherte Kopplungen mit Status und ungekoppelte Kandidaten (ADR 0024).
         *
         *     Reine Auskunft: Vorschlaege werden nie automatisch gespeichert.
         */
        get: operations["listElectricalWallLinks"];
        put?: never;
        /**
         * Wandkopplung anlegen
         * @description Ordnet zwei exakt ueberlappende Raumwaende verschiedener Raeume einander zu.
         *
         *     ``shared`` = eine Bauwand, ``separate`` = zwei Bauwaende auf derselben Achse.
         *     Die Raumversion beider Raeume zaehlt weiter. Wuerde ein vorhandenes Geraet
         *     dadurch unzulaessig, antwortet der Server ``422`` und speichert nichts.
         *     Unterbricht sie eine Leitung (Bodenuebergang bei ``separate``), braucht es
         *     ``acknowledged_cable_ids``.
         */
        post: operations["createElectricalWallLink"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/wall-links/{link_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Wandkopplung loesen
         * @description Loest die Kopplung; der Abschnitt ist danach unentschieden (konservativ).
         */
        delete: operations["deleteElectricalWallLink"];
        options?: never;
        head?: never;
        /**
         * Wandkopplung aendern
         * @description Aendert ``shared`` <-> ``separate``; ``If-Match`` traegt die Kopplungsversion.
         *
         *     Mit Durchfuehrung ist ``separate`` nicht moeglich (``422``); ein Bodenuebergang wird
         *     dann einseitig - nur mit ``acknowledged_cable_ids``.
         */
        patch: operations["updateElectricalWallLink"];
        trace?: never;
    };
    "/api/v1/modules/electrical/buildings/{building_id}/risers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Steigwege eines Gebaeudes
         * @description Steigwege mit Halten, Verlauf je Abschnitt und Laengenstatus (ADR 0025).
         *
         *     Verlauf und Laengen werden bei jedem Lesen aus den aktuellen Hoehenlagen
         *     abgeleitet. Vereinfachter Planungsverlauf - keine Aussage ueber bauliche
         *     Machbarkeit, Brandschutz oder Normen.
         */
        get: operations["listElectricalRisers"];
        put?: never;
        /**
         * Steigweg anlegen
         * @description Legt einen benannten Steigweg an - hoechstens ein Halt je Geschoss des Gebaeudes.
         */
        post: operations["createElectricalRiser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/risers/{riser_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Steigweg ersetzen
         * @description Ersetzt Stammdaten und die ganze Halteliste; ``If-Match`` traegt die Steigwegversion.
         *
         *     Halte mit ``id`` behalten ihre ID, fehlende werden entfernt, Halte ohne
         *     ``id`` neu angelegt. Genutzte Halte entfallen nicht (``409 riser-stop-in-use``);
         *     unterbricht ein verschobener Halt eine Leitung, braucht es ``acknowledged_cable_ids``.
         */
        put: operations["replaceElectricalRiser"];
        post?: never;
        /**
         * Steigweg loeschen
         * @description Entfernt den Steigweg samt Uebergabepunkten.
         */
        delete: operations["deleteElectricalRiser"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/buildings/{building_id}/distribution-boards": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Verteilungen eines Gebaeudes
         * @description Verteilungen mit Code, Name und optionaler Lage (Geraet ``distribution_board``).
         */
        get: operations["listElectricalDistributionBoards"];
        put?: never;
        /**
         * Verteilung anlegen
         * @description Legt eine Verteilung an; mehrere je Gebaeude, Code je Gebaeude eindeutig.
         */
        post: operations["createElectricalDistributionBoard"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/distribution-boards/{board_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Verteilung entfernen
         * @description Nur ohne Stromkreise (sonst ``409 board-has-circuits``); das Lagegeraet bleibt.
         */
        delete: operations["deleteElectricalDistributionBoard"];
        options?: never;
        head?: never;
        /**
         * Verteilung aendern
         * @description Aendert Code, Name, Notiz oder Lage; ``If-Match`` traegt die Verteilungsversion.
         */
        patch: operations["updateElectricalDistributionBoard"];
        trace?: never;
    };
    "/api/v1/modules/electrical/distribution-boards/{board_id}/placement": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Verteilung im Plan platzieren oder umsetzen
         * @description Legt das Lagegeraet an bzw. verschiebt oder setzt es um - mit der Verknuepfung **atomar**.
         *
         *     Verlangt ``electrical.circuit.write`` **und** ``electrical.plan.write`` (Entwurf 6c
         *     §10.4). Geschrieben wird nur das Lagegeraet - ein offener Raumentwurf wird nie
         *     mitgespeichert. Je betroffenem Raum ein ``electrical.plan.updated``
         *     (``devices_changed``) nach dem Commit.
         */
        put: operations["placeElectricalDistributionBoard"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/buildings/{building_id}/circuits": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Stromkreise eines Gebaeudes
         * @description Stromkreise aller Verteilungen samt zugeordneten Geraeten.
         *
         *     ``proposed_*`` sind Vorschlaege fuer neue Leitungen, ungeprueft (ADR 0026).
         */
        get: operations["listElectricalCircuits"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/distribution-boards/{board_id}/circuits": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Stromkreis anlegen
         * @description Legt einen Stromkreis an; Bezeichnung je Verteilung eindeutig.
         */
        post: operations["createElectricalCircuit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/circuits/{circuit_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Stromkreis entfernen
         * @description Entfernt den Stromkreis samt Geraetezuordnungen; die Geraete bleiben.
         */
        delete: operations["deleteElectricalCircuit"];
        options?: never;
        head?: never;
        /**
         * Stromkreis aendern
         * @description Aendert Angaben; eine Vorschlagsaenderung aendert keine bestehende Leitung.
         */
        patch: operations["updateElectricalCircuit"];
        trace?: never;
    };
    "/api/v1/modules/electrical/circuits/{circuit_id}/devices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Geraetezuordnung eines Stromkreises ersetzen
         * @description Ersetzt die Geraeteliste (``If-Match`` der Stromkreisversion).
         *
         *     Nur Steckdosen, Schalter, Leuchten und Abzweigdosen desselben Gebaeudes (keine
         *     Datendosen, nicht das Lagegeraet einer Verteilung); ein Geraet eines
         *     anderen Stromkreises liefert ``409 device-assigned-elsewhere`` - es wird nie
         *     still umgehaengt.
         */
        put: operations["replaceElectricalCircuitDevices"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/buildings/{building_id}/cables": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Leitungen eines Gebaeudes
         * @description Leitungen mit Wegpunkten, Teilstrecken, Status, Laenge oder Teilsumme und Befunden.
         *
         *     Nichts davon ist gespeichert: Weg und Laenge berechnet die reine Funktion bei jedem
         *     Lesen. ``length_mm`` nur bei ``confirmed``. Keine Bemessung, keine Normaussage.
         */
        get: operations["listElectricalCables"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/buildings/{building_id}/cabling-summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Mengenuebersicht der Leitungen eines Gebaeudes
         * @description Mengen nach den tatsaechlichen Kabelangaben, Trassen, Durchfuehrungen, Geraete.
         *
         *     Rein lesend und abgeleitet - nichts davon ist gespeichert; ein konsistenter Stand je
         *     Antwort, auch fuer abgeschlossene und archivierte Projekte. Offene und konflikthafte
         *     Leitungen stehen getrennt und nie in der bestaetigten Menge. Kein Material, keine
         *     Preise, keine Bemessung oder Normaussage.
         */
        get: operations["getElectricalCablingSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/circuits/{circuit_id}/cables": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Leitung anlegen
         * @description Legt eine Leitung samt Wegpunkten an; neue Durchfuehrungen entstehen atomar mit ihr.
         *
         *     Endgeraete: das Lagegeraet der Verteilung oder Geraete dieses Stromkreises, im
         *     Gebaeude, nicht aussen montiert. Unvollstaendige Wege werden gespeichert
         *     (``incomplete``), unzulaessige Strecken nicht (``422 cable-route-invalid``). Ohne
         *     Endgeraet: offene Planung (``incomplete``). Werte aus Vorgaben: ``409
         *     planning-defaults-changed`` bei geaendertem Stand. ``assign_devices`` verlangt
         *     zusaetzlich ``electrical.circuit.write``.
         */
        post: operations["createElectricalCable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/cables/{cable_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Leitung ersetzen
         * @description Ersetzt die ganze Leitung samt Wegpunkten (``If-Match`` der Leitungsversion).
         *
         *     Bleiben Weg und Endgeraete unveraendert, blockiert ein bestehender Konflikt das
         *     Aendern der Kabelangaben nicht; ein **neuer** Konflikt wird abgelehnt. Eine reine
         *     Leitungsaenderung aendert keine Geraetezuordnung (``assign_devices`` nur ausdruecklich).
         */
        put: operations["replaceElectricalCable"];
        post?: never;
        /**
         * Leitung entfernen
         * @description Entfernt die Leitung samt Wegpunkten; Durchfuehrungen bleiben sichtbar bestehen.
         */
        delete: operations["deleteElectricalCable"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/cables/{cable_id}/apply-proposal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Stromkreisvorschlag auf eine Leitung uebertragen
         * @description Uebertraegt Typ, Leiterzahl und Querschnitt des Stromkreisvorschlags auf die Leitung.
         *
         *     ``If-Match``: Version der Leitung. ``expected_circuit_version``: Version des
         *     Stromkreises, dessen Vorschlag gesehen wurde. Beide werden unter der Projektsperre
         *     geprueft; bei Abweichung ``409`` (``version-conflict`` bzw.
         *     ``circuit-proposal-changed``) ohne jede Aenderung. Weg, Endgeraete, Zugaben und
         *     Bezeichnung bleiben unveraendert.
         */
        post: operations["applyElectricalCircuitProposal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/floors/{floor_id}/penetrations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Durchfuehrungen eines Geschosses
         * @description Durchfuehrungen mit abgeleiteter Gegenlage, Gueltigkeit und nutzenden Leitungen.
         */
        get: operations["listElectricalPenetrations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/penetrations/{penetration_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Durchfuehrung entfernen
         * @description Nur ungenutzt (sonst ``409 penetration-in-use``).
         */
        delete: operations["deleteElectricalPenetration"];
        options?: never;
        head?: never;
        /**
         * Durchfuehrung aendern
         * @description Aendert Lage, Hoehe oder Notiz; die neue Lage muss gueltig sein (``422``).
         */
        patch: operations["updateElectricalPenetration"];
        trace?: never;
    };
    "/api/v1/modules/electrical/cable-templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Kabelvorlagen des Betriebs
         * @description Alle Kabelvorlagen (auch inaktive) - technische Angaben ohne Preis.
         */
        get: operations["listElectricalCableTemplates"];
        put?: never;
        /**
         * Kabelvorlage anlegen
         * @description Neue Kabelvorlage (``electrical.defaults.manage``); Name je Betrieb eindeutig.
         */
        post: operations["createElectricalCableTemplate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/cable-templates/{template_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Ungenutzte Kabelvorlage loeschen
         * @description Nur ungenutzt, sonst ``409 cable-template-in-use`` - dann deaktivieren.
         */
        delete: operations["deleteElectricalCableTemplate"];
        options?: never;
        head?: never;
        /**
         * Kabelvorlage aendern oder deaktivieren
         * @description Aendert die Vorlage (``If-Match``). Bestehende Leitungen behalten ihre Angaben.
         */
        patch: operations["updateElectricalCableTemplate"];
        trace?: never;
    };
    "/api/v1/modules/electrical/planning-defaults": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Betriebsstandard der Planungsvorgaben
         * @description Gespeicherte Werte; ``null`` = nicht gesetzt, Version ``0`` = nichts gespeichert.
         */
        get: operations["getElectricalPlanningDefaults"];
        /**
         * Betriebsstandard ersetzen
         * @description Ersetzt den Betriebsstandard ganz (``expected_version``, ``0`` = Erstanlage).
         *
         *     Aendert **keine** Leitung und kein Projekt - auch nicht in abgeschlossenen oder
         *     archivierten Projekten. Offene Abschluesse sehen die Aenderung als ``409
         *     planning-defaults-changed`` beim Speichern.
         */
        put: operations["replaceElectricalPlanningDefaults"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/projects/{project_id}/planning-defaults": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Projektvorgabe
         * @description Gespeicherte Projektwerte; ``null`` = Betriebsstandard uebernehmen.
         */
        get: operations["getElectricalProjectPlanningDefaults"];
        /**
         * Projektvorgabe ersetzen
         * @description Ersetzt die Projektvorgabe (``electrical.route.write``, ``expected_version``).
         *
         *     Waehlt nur Betriebsvorlagen. ``409`` bei abgeschlossenem oder archiviertem Projekt.
         *     Aendert keine bestehende Leitung.
         */
        put: operations["replaceElectricalProjectPlanningDefaults"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/electrical/projects/{project_id}/planning-defaults/effective": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Wirksame Planungsvorgaben eines Projekts
         * @description Aufgeloeste Werte, Herkunft und Versionsbasis (``basis`` -> ``defaults_basis``).
         *
         *     Mit ``circuit_id`` (und optional Start-/Endgeraet) zusaetzlich ``for_cable``: genau
         *     die Werte, die eine neue Leitung mit ``*_source = defaults`` erhielte. Lesend, ein
         *     konsistenter Stand, auch fuer abgeschlossene und archivierte Projekte.
         */
        get: operations["getElectricalEffectivePlanningDefaults"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Liveness
         * @description Der Prozess laeuft. Keine Abhaengigkeiten werden geprueft.
         */
        get: operations["healthLive"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Readiness
         * @description Der Prozess kann Anfragen bedienen - inklusive Datenbankverbindung.
         */
        get: operations["healthReady"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** AcceptWithExistingAccount */
        AcceptWithExistingAccount: {
            /** Token */
            token: string;
            /** Password */
            password: string;
        };
        /** AcceptWithNewAccount */
        AcceptWithNewAccount: {
            /** Token */
            token: string;
            /** Full Name */
            full_name: string;
            /** Password */
            password: string;
        };
        /**
         * ActiveModuleInfo
         * @description Modul im Kontext der aktuellen Organisation und des Benutzers.
         */
        ActiveModuleInfo: {
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Version */
            version: string;
            /** Kind */
            kind: string;
            /** Enabled */
            enabled: boolean;
        };
        /**
         * ApplyProposalIn
         * @description Ausdrueckliche Uebernahme des Stromkreisvorschlags auf **eine** Leitung.
         *
         *     ``If-Match`` traegt die Version der Leitung; ``expected_circuit_version`` die
         *     Version des Stromkreises, dessen Vorschlag der Anwender gesehen hat. Weicht eine
         *     von beiden ab: ``409``, nichts geaendert. Uebernommen werden genau
         *     ``cable_type``, ``conductor_count`` und ``cross_section_mm2`` - so, wie sie im
         *     Vorschlag stehen, auch leer. Weg, Endgeraete, Zugaben und Bezeichnung bleiben.
         */
        ApplyProposalIn: {
            /** Expected Circuit Version */
            expected_circuit_version: number;
        };
        /**
         * AreaWaypointIn
         * @description Punkt in der Decke (Raumhoehe) oder im Fussboden (FFB) eines Raums, Geschoss-x/y.
         */
        AreaWaypointIn: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "ceiling" | "floor";
            /**
             * Room Id
             * Format: uuid
             */
            room_id: string;
            /** X Mm */
            x_mm: number;
            /** Y Mm */
            y_mm: number;
        };
        /** AuditEntryOut */
        AuditEntryOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Action */
            action: string;
            /** Entity Type */
            entity_type: string;
            /** Entity Id */
            entity_id: string | null;
            /** Module Id */
            module_id: string;
            /** Summary */
            summary: string;
            /** Actor User Id */
            actor_user_id: string | null;
            /** Request Id */
            request_id: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
        };
        /**
         * BoardPlacementOut
         * @description Verteilung (neue Version), Lagegeraet und betroffene Raeume (Zielraum zuerst).
         */
        BoardPlacementOut: {
            board: components["schemas"]["DistributionBoardOut"];
            device: components["schemas"]["DeviceOut"];
            /** Rooms */
            rooms: components["schemas"]["PlacementRoomOut"][];
        };
        /**
         * BoardPlacementUpdate
         * @description Lage einer Verteilung im Plan setzen oder aendern (Phase 6c, VP, ADR 0028).
         *
         *     ``If-Match`` traegt die Version der **Verteilung**, ``expected_room_version`` die
         *     des Zielraums. Das Lagegeraet sitzt immer auf der Innenseite der Wand; Bezugspunkt
         *     ist seine Mitte (wie bei jedem Wandgeraet). Gleiche Wand: verschieben; andere Wand:
         *     umsetzen - nur ohne Leitungen am Lagegeraet (``409 board-placement-has-cables``).
         */
        BoardPlacementUpdate: {
            /**
             * Room Id
             * Format: uuid
             */
            room_id: string;
            /**
             * Wall Id
             * Format: uuid
             */
            wall_id: string;
            /** Center Offset Mm */
            center_offset_mm: number;
            /** Center Height Mm */
            center_height_mm: number;
            /** Expected Room Version */
            expected_room_version: number;
        };
        /** BuildingCreate */
        BuildingCreate: {
            /** Name */
            name: string;
            /**
             * Sort Order
             * @default 0
             */
            sort_order: number;
        };
        /** BuildingOut */
        BuildingOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Project Id
             * Format: uuid
             */
            project_id: string;
            /** Name */
            name: string;
            /** Sort Order */
            sort_order: number;
            /** Version */
            version: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /** BuildingUpdate */
        BuildingUpdate: {
            /** Name */
            name?: string | null;
            /** Sort Order */
            sort_order?: number | null;
        };
        /**
         * CableIn
         * @description Leitung als Ganzes - anlegen (``POST /circuits/{id}/cables``) oder ersetzen (``PUT``).
         *
         *     Die Kabelangaben stehen an der Leitung. ``start_device_id`` ist leer nur bei einer
         *     Verteilung ohne Lage; ``end_device_id`` leer = bewusst offene Planung ("Endgeraet
         *     fehlt", ``incomplete``, Phase 6c V1). ``waypoints`` ist die vollstaendige Liste in
         *     Leitungsrichtung.
         *
         *     **Herkunft je Wertegruppe** (ADR 0027): Kabelangaben (``spec_source``), Reserve
         *     (``reserve_source``), Anschlusszugaben (``allowance_source``). ``defaults``: Der Server
         *     loest die Vorgabenkette selbst auf, die gesendeten Werte muessen ihr entsprechen, und
         *     ``defaults_basis`` muss dem aktuellen Stand gleichen - sonst ``409
         *     planning-defaults-changed``, nichts gespeichert. ``manual``: ausdruecklich abweichend.
         *     Fehlt die Angabe (bisherige Clients), gelten die Werte als ausdruecklich; eine
         *     unveraenderte Gruppe einer Bestandsleitung behaelt dabei ihre Herkunft ``legacy``.
         *
         *     **Reserve:** ``fixed`` (``reserve_mm``, Bestand) oder ``percent``
         *     (``reserve_percent``, ``reserve_mm`` dann ``0``) - nie beides.
         *
         *     ``assign_devices``: Endgeraete dieser Leitung, die beim Speichern ausdruecklich diesem
         *     Stromkreis zugeordnet werden (zusaetzlich ``electrical.circuit.write``,
         *     ``expected_circuit_version``); nie umgehaengt, atomar mit der Leitung.
         */
        CableIn: {
            /** Label */
            label?: string | null;
            /** Start Device Id */
            start_device_id?: string | null;
            /** End Device Id */
            end_device_id?: string | null;
            /** Cable Type */
            cable_type?: string | null;
            /** Conductor Count */
            conductor_count?: number | null;
            /**
             * Cross Section Mm2
             * @example 1.5
             * @example 2.50
             */
            cross_section_mm2?: string | null;
            /**
             * Start Allowance Mm
             * @default 0
             */
            start_allowance_mm: number;
            /**
             * End Allowance Mm
             * @default 0
             */
            end_allowance_mm: number;
            /**
             * Reserve Mm
             * @default 0
             */
            reserve_mm: number;
            /**
             * Reserve Mode
             * @default fixed
             * @enum {string}
             */
            reserve_mode: "fixed" | "percent";
            /**
             * Reserve Percent
             * @example 20
             */
            reserve_percent?: string | null;
            /** Spec Source */
            spec_source?: ("manual" | "defaults") | null;
            /** Reserve Source */
            reserve_source?: ("manual" | "defaults") | null;
            /** Allowance Source */
            allowance_source?: ("manual" | "defaults") | null;
            defaults_basis?: components["schemas"]["DefaultsBasisIn"] | null;
            /** Assign Devices */
            assign_devices?: string[];
            /** Expected Circuit Version */
            expected_circuit_version?: number | null;
            /** Waypoints */
            waypoints?: (components["schemas"]["WallWaypointIn"] | components["schemas"]["AreaWaypointIn"] | components["schemas"]["PenetrationWaypointIn"] | components["schemas"]["OpeningCrossingWaypointIn"] | components["schemas"]["RiserWaypointIn"])[];
            /** New Penetrations */
            new_penetrations?: components["schemas"]["NewPenetrationIn"][];
        };
        /**
         * CableListOut
         * @description Leitungen eines Gebaeudes (oder einer Uebernahme), nach Stromkreis und Bezeichnung.
         */
        CableListOut: {
            /**
             * Building Id
             * Format: uuid
             */
            building_id: string;
            /** Cables */
            cables: components["schemas"]["CableOut"][];
        };
        /**
         * CableOut
         * @description Leitung samt Kabelangaben, Wegpunkten und berechnetem Weg (nie gespeichert).
         *
         *     ``length_mm`` nur bei ``status = confirmed``; sonst ist ``known_mm`` ausdruecklich
         *     eine **Teilsumme** der gueltigen Teile plus Zugaben. ``deviates_from_proposal``:
         *     die Kabelangaben weichen vom aktuellen Stromkreisvorschlag ab. ``allowance_mm`` =
         *     ``connection_allowance_mm`` + wirksame Reserve (ohne offene Prozentreserve).
         */
        CableOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Circuit Id
             * Format: uuid
             */
            circuit_id: string;
            /** Label */
            label: string | null;
            /** Start Device Id */
            start_device_id: string | null;
            /** End Device Id */
            end_device_id: string | null;
            /** Cable Type */
            cable_type: string | null;
            /** Conductor Count */
            conductor_count: number | null;
            /** Cross Section Mm2 */
            cross_section_mm2: string | null;
            /** Start Allowance Mm */
            start_allowance_mm: number;
            /** End Allowance Mm */
            end_allowance_mm: number;
            /** Reserve Mm */
            reserve_mm: number;
            /**
             * Reserve Mode
             * @enum {string}
             */
            reserve_mode: "fixed" | "percent";
            /** Reserve Percent */
            reserve_percent: string | null;
            /** Reserve Effective Mm */
            reserve_effective_mm: number | null;
            /** Reserve Pending */
            reserve_pending: boolean;
            /** Connection Allowance Mm */
            connection_allowance_mm: number;
            /**
             * Spec Origin
             * @enum {string}
             */
            spec_origin: "legacy" | "manual" | "circuit_override" | "device_type_template" | "default_template" | "project_default" | "office_default" | "none";
            /**
             * Reserve Origin
             * @enum {string}
             */
            reserve_origin: "legacy" | "manual" | "circuit_override" | "device_type_template" | "default_template" | "project_default" | "office_default" | "none";
            /**
             * Allowance Origin
             * @enum {string}
             */
            allowance_origin: "legacy" | "manual" | "circuit_override" | "device_type_template" | "default_template" | "project_default" | "office_default" | "none";
            /** Cable Template Id */
            cable_template_id: string | null;
            /** Cable Template Version */
            cable_template_version: number | null;
            /** Defaults Office Version */
            defaults_office_version: number | null;
            /** Defaults Project Version */
            defaults_project_version: number | null;
            /** Waypoints */
            waypoints: components["schemas"]["CableWaypointOut"][];
            /**
             * Status
             * @enum {string}
             */
            status: "confirmed" | "incomplete" | "conflict";
            /** Geometric Mm */
            geometric_mm: number;
            /** Allowance Mm */
            allowance_mm: number;
            /** Length Mm */
            length_mm: number | null;
            /** Known Mm */
            known_mm: number;
            /** Spec Complete */
            spec_complete: boolean;
            /** Deviates From Proposal */
            deviates_from_proposal: boolean;
            /** Problems */
            problems: components["schemas"]["CableProblemOut"][];
            /** Segments */
            segments: components["schemas"]["CableSegmentOut"][];
            /** Penetration Ids */
            penetration_ids: string[];
            /** Opening Crossings */
            opening_crossings: number;
            /** Version */
            version: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /**
         * CableProblemOut
         * @description Befund: ``conflict`` (ungueltig) oder ``missing`` (fehlt noch), mit Ort und Text.
         *
         *     ``ref``: ``start``/``end`` (Anschluss), ``route`` (Weg), ``w3`` (Wegpunkt) oder
         *     ``w2-w3`` (Strecke zwischen zwei Wegpunkten).
         */
        CableProblemOut: {
            /** Code */
            code: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "conflict" | "missing";
            /** Ref */
            ref: string;
            /** Message */
            message: string;
        };
        /**
         * CableSegmentOut
         * @description Teilstrecke - Laenge aus der reinen Funktion, Punkte nur fuer die Darstellung.
         *
         *     ``points``: Geschoss-x/y und absolute Hoehe ``z`` (gespeicherte Hoehenlage des
         *     Geschosses + lokale Hoehe), ganze mm. ``floor_id`` fehlt bei Steigweg und Schacht.
         */
        CableSegmentOut: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "connection" | "wall" | "corner" | "wall-ceiling" | "wall-floor" | "ceiling" | "floor" | "penetration" | "opening-crossing" | "riser" | "shaft";
            /** Ref */
            ref: string;
            /** Owner Id */
            owner_id: string;
            /** Floor Id */
            floor_id: string | null;
            /** Length Mm */
            length_mm: number | null;
            /** Known Mm */
            known_mm: number;
            /** Points */
            points: components["schemas"]["RiserCoursePointOut"][];
        };
        /**
         * CableTemplateCreate
         * @description Neue Kabelvorlage des Betriebs - technische Angaben, **kein Preis**.
         *
         *     Das Tripel ist vollstaendig (eine Vorlage liefert immer alle drei Werte).
         */
        CableTemplateCreate: {
            /** Name */
            name: string;
            /** Cable Type */
            cable_type: string;
            /** Conductor Count */
            conductor_count: number;
            /**
             * Cross Section Mm2
             * @example 1.5
             */
            cross_section_mm2: string;
            /**
             * Is Active
             * @default true
             */
            is_active: boolean;
            /**
             * Sort Order
             * @default 0
             */
            sort_order: number;
        };
        /**
         * CableTemplateListOut
         * @description Alle Kabelvorlagen des Betriebs nach Sortierung und Name (auch inaktive).
         */
        CableTemplateListOut: {
            /** Templates */
            templates: components["schemas"]["CableTemplateOut"][];
        };
        /** CableTemplateOut */
        CableTemplateOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
            /** Cable Type */
            cable_type: string;
            /** Conductor Count */
            conductor_count: number;
            /** Cross Section Mm2 */
            cross_section_mm2: string;
            /** Is Active */
            is_active: boolean;
            /** Sort Order */
            sort_order: number;
            /** In Use */
            in_use: boolean;
            /** Version */
            version: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /**
         * CableTemplateUpdate
         * @description Teilaenderung (``If-Match``). Deaktivieren statt Loeschen, wenn genutzt.
         *
         *     Eine Aenderung aendert **keine** bestehende Leitung - deren Angaben stehen an ihr.
         */
        CableTemplateUpdate: {
            /** Name */
            name?: string | null;
            /** Cable Type */
            cable_type?: string | null;
            /** Conductor Count */
            conductor_count?: number | null;
            /**
             * Cross Section Mm2
             * @example 1.5
             * @example 2.50
             */
            cross_section_mm2?: string | null;
            /** Is Active */
            is_active?: boolean | null;
            /** Sort Order */
            sort_order?: number | null;
        };
        /**
         * CableWaypointOut
         * @description Gespeicherter Wegpunkt - je Art nur die zugehoerigen Felder gesetzt.
         */
        CableWaypointOut: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "wall" | "ceiling" | "floor" | "penetration" | "opening_crossing" | "riser";
            /** Wall Id */
            wall_id?: string | null;
            /** Offset Mm */
            offset_mm?: number | null;
            /** Height Mm */
            height_mm?: number | null;
            /** Room Id */
            room_id?: string | null;
            /** X Mm */
            x_mm?: number | null;
            /** Y Mm */
            y_mm?: number | null;
            /** Penetration Id */
            penetration_id?: string | null;
            /** Opening Id */
            opening_id?: string | null;
            /** Riser Id */
            riser_id?: string | null;
            /** From Stop Id */
            from_stop_id?: string | null;
            /** From Height Mm */
            from_height_mm?: number | null;
            /** To Stop Id */
            to_stop_id?: string | null;
            /** To Height Mm */
            to_height_mm?: number | null;
        };
        /**
         * CablingBucketOut
         * @description Leitungen eines Status in einer Gruppe.
         *
         *     ``total_mm`` = ``geometric_mm`` + ``allowance_mm``: bei ``confirmed`` die Summe der
         *     Leitungslaengen, sonst ausdruecklich die **Teilsumme** der bekannten Teile.
         */
        CablingBucketOut: {
            /** Count */
            count: number;
            /** Geometric Mm */
            geometric_mm: number;
            /** Allowance Mm */
            allowance_mm: number;
            /** Connection Allowance Mm */
            connection_allowance_mm: number;
            /** Reserve Mm */
            reserve_mm: number;
            /** Reserve Pending Count */
            reserve_pending_count: number;
            /** Total Mm */
            total_mm: number;
            /** Cable Ids */
            cable_ids: string[];
        };
        /**
         * CablingCableOut
         * @description Eine Leitung als Bestandteil der Uebersicht - Aufschluesselung bis zur Leitung.
         */
        CablingCableOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Circuit Id
             * Format: uuid
             */
            circuit_id: string;
            /** Label */
            label: string | null;
            /** Start Device Id */
            start_device_id: string | null;
            /** End Device Id */
            end_device_id: string | null;
            /** Cable Type */
            cable_type: string | null;
            /** Conductor Count */
            conductor_count: number | null;
            /** Cross Section Mm2 */
            cross_section_mm2: string | null;
            /** Missing Spec */
            missing_spec: ("cable_type" | "conductor_count" | "cross_section_mm2")[];
            /**
             * Status
             * @enum {string}
             */
            status: "confirmed" | "incomplete" | "conflict";
            /** Geometric Mm */
            geometric_mm: number;
            /** Allowance Mm */
            allowance_mm: number;
            /** Connection Allowance Mm */
            connection_allowance_mm: number;
            /**
             * Reserve Mode
             * @enum {string}
             */
            reserve_mode: "fixed" | "percent";
            /** Reserve Percent */
            reserve_percent: string | null;
            /** Reserve Effective Mm */
            reserve_effective_mm: number | null;
            /** Reserve Pending */
            reserve_pending: boolean;
            /**
             * Spec Origin
             * @enum {string}
             */
            spec_origin: "legacy" | "manual" | "circuit_override" | "device_type_template" | "default_template" | "project_default" | "office_default" | "none";
            /**
             * Reserve Origin
             * @enum {string}
             */
            reserve_origin: "legacy" | "manual" | "circuit_override" | "device_type_template" | "default_template" | "project_default" | "office_default" | "none";
            /**
             * Allowance Origin
             * @enum {string}
             */
            allowance_origin: "legacy" | "manual" | "circuit_override" | "device_type_template" | "default_template" | "project_default" | "office_default" | "none";
            /** Length Mm */
            length_mm: number | null;
            /** Known Mm */
            known_mm: number;
            /** Problem Codes */
            problem_codes: string[];
        };
        /**
         * CablingCircuitOut
         * @description Geraete eines Stromkreises je Typ; zugeordnete Geraete ohne Leitung gesondert.
         */
        CablingCircuitOut: {
            /**
             * Circuit Id
             * Format: uuid
             */
            circuit_id: string;
            /**
             * Board Id
             * Format: uuid
             */
            board_id: string;
            /** Designation */
            designation: string;
            /** Name */
            name: string;
            /** By Type */
            by_type: components["schemas"]["CablingTypeCountOut"][];
            /** Device Ids */
            device_ids: string[];
            /** Devices Without Cable */
            devices_without_cable: string[];
        };
        /**
         * CablingCrossingOut
         * @description Bodenuebergang an einer Oeffnung: **Nutzungen** je Leitung, kein Bauteil.
         *
         *     ``opening_id = null``: die Oeffnung wurde entfernt (Leitung im Konflikt).
         */
        CablingCrossingOut: {
            /** Opening Id */
            opening_id: string | null;
            /**
             * Wall Id
             * Format: uuid
             */
            wall_id: string;
            /** Cable Ids */
            cable_ids: string[];
            /** Uses */
            uses: number;
        };
        /**
         * CablingGroupOut
         * @description Gruppe gleicher **tatsaechlicher** Kabelangaben (nie der Stromkreisvorschlag).
         */
        CablingGroupOut: {
            /** Cable Type */
            cable_type: string;
            /** Conductor Count */
            conductor_count: number;
            /** Cross Section Mm2 */
            cross_section_mm2: string;
            confirmed: components["schemas"]["CablingBucketOut"];
            incomplete: components["schemas"]["CablingBucketOut"];
            conflict: components["schemas"]["CablingBucketOut"];
        };
        /**
         * CablingPenetrationOut
         * @description Durchfuehrung nach Identitaet - einmal gezaehlt, egal wie viele Leitungen sie nutzen.
         */
        CablingPenetrationOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Used */
            used: boolean;
            /** Cable Ids */
            cable_ids: string[];
            /** Problem Code */
            problem_code: string | null;
        };
        /**
         * CablingSummaryOut
         * @description Mengenuebersicht eines Gebaeudes aus dem **gespeicherten** Stand (Entwurf §6.5).
         *
         *     Abgeleitet bei jedem Lesen, nie gespeichert; ein konsistenter Planungsstand je
         *     Antwort. Laengen in ganzen Millimetern; ``cross_section_mm2`` als Dezimalstring.
         *     "Bestaetigt" heisst vollstaendig im Planungsmodell - keine Normpruefung, keine
         *     Bemessung, keine Aussage ueber Ausfuehrbarkeit. Kein Material, keine Preise.
         */
        CablingSummaryOut: {
            /**
             * Building Id
             * Format: uuid
             */
            building_id: string;
            /** Building Name */
            building_name: string;
            /** Project Status */
            project_status: string;
            /** Groups */
            groups: components["schemas"]["CablingGroupOut"][];
            totals: components["schemas"]["CablingTotalsOut"];
            /** Unspecified */
            unspecified: components["schemas"]["CablingCableOut"][];
            /** Cables */
            cables: components["schemas"]["CablingCableOut"][];
            /** Surfaces */
            surfaces: components["schemas"]["CablingSurfaceOut"][];
            /** Penetrations */
            penetrations: components["schemas"]["CablingPenetrationOut"][];
            /** Crossings */
            crossings: components["schemas"]["CablingCrossingOut"][];
            /** Circuits */
            circuits: components["schemas"]["CablingCircuitOut"][];
            /** Unassigned Device Ids */
            unassigned_device_ids: string[];
        };
        /**
         * CablingSurfaceOut
         * @description Trassen- und Leitungsmeter einer Flaeche.
         *
         *     ``confirmed_*`` nur aus bestaetigten Leitungen; ``all_*`` aus allen gueltigen
         *     Teilstrecken aller Leitungen (einschliesslich vorlaeufiger). Gemeinsam genutzte
         *     Abschnitte zaehlen als Trasse einmal. ``*_complete = false``: mindestens ein
         *     Steigweganteil mit unbekannter senkrechter Laenge - gezaehlt ist nur der bekannte Teil.
         */
        CablingSurfaceOut: {
            /**
             * Surface
             * @enum {string}
             */
            surface: "wall" | "ceiling" | "floor" | "riser" | "shaft";
            /** Confirmed Trace Mm */
            confirmed_trace_mm: number;
            /** Confirmed Cable Mm */
            confirmed_cable_mm: number;
            /** All Trace Mm */
            all_trace_mm: number;
            /** All Cable Mm */
            all_cable_mm: number;
            /** Confirmed Complete */
            confirmed_complete: boolean;
            /** All Complete */
            all_complete: boolean;
        };
        /**
         * CablingTotalsOut
         * @description Summen ueber alle vollstaendig angegebenen Leitungen - je Status getrennt.
         */
        CablingTotalsOut: {
            confirmed: components["schemas"]["CablingBucketOut"];
            incomplete: components["schemas"]["CablingBucketOut"];
            conflict: components["schemas"]["CablingBucketOut"];
        };
        /** CablingTypeCountOut */
        CablingTypeCountOut: {
            /** Type Key */
            type_key: string;
            /** Label */
            label: string;
            /** Count */
            count: number;
        };
        /**
         * CircuitCreate
         * @description Neuer Stromkreis an einer Verteilung.
         */
        CircuitCreate: {
            /** Sort Order */
            sort_order?: number | null;
            /** Proposed Cable Type */
            proposed_cable_type?: string | null;
            /** Proposed Conductor Count */
            proposed_conductor_count?: number | null;
            /**
             * Proposed Cross Section Mm2
             * @example 1.5
             * @example 2.50
             */
            proposed_cross_section_mm2?: string | null;
            /** Protective Device */
            protective_device?: string | null;
            /** Rcd Group */
            rcd_group?: string | null;
            /** Phase Count */
            phase_count?: (1 | 2 | 3) | null;
            /** Note */
            note?: string | null;
            /** Proposal Overrides Templates */
            proposal_overrides_templates?: boolean | null;
            /** Designation */
            designation: string;
            /** Name */
            name: string;
        };
        /**
         * CircuitDevicesUpdate
         * @description Vollstaendige Geraeteliste eines Stromkreises (``If-Match`` der Stromkreisversion).
         */
        CircuitDevicesUpdate: {
            /** Device Ids */
            device_ids?: string[];
        };
        /**
         * CircuitListOut
         * @description Alle Stromkreise eines Gebaeudes, nach Verteilung, Reihenfolge und Bezeichnung.
         */
        CircuitListOut: {
            /**
             * Building Id
             * Format: uuid
             */
            building_id: string;
            /** Circuits */
            circuits: components["schemas"]["CircuitOut"][];
        };
        /**
         * CircuitOut
         * @description Stromkreis samt zugeordneten Geraeten (nach ID sortiert).
         */
        CircuitOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Board Id
             * Format: uuid
             */
            board_id: string;
            /** Designation */
            designation: string;
            /** Name */
            name: string;
            /** Sort Order */
            sort_order: number;
            /** Proposed Cable Type */
            proposed_cable_type: string | null;
            /** Proposed Conductor Count */
            proposed_conductor_count: number | null;
            /** Proposed Cross Section Mm2 */
            proposed_cross_section_mm2: string | null;
            /** Protective Device */
            protective_device: string | null;
            /** Rcd Group */
            rcd_group: string | null;
            /** Phase Count */
            phase_count: number | null;
            /** Note */
            note: string | null;
            /** Proposal Overrides Templates */
            proposal_overrides_templates: boolean;
            /** Device Ids */
            device_ids: string[];
            /** Version */
            version: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /**
         * CircuitUpdate
         * @description Teilaenderung (``If-Match``). Optionale Angaben sind mit ``null`` leerbar.
         *
         *     Eine Aenderung der Vorschlaege aendert **keine** bestehende Leitung.
         */
        CircuitUpdate: {
            /** Sort Order */
            sort_order?: number | null;
            /** Proposed Cable Type */
            proposed_cable_type?: string | null;
            /** Proposed Conductor Count */
            proposed_conductor_count?: number | null;
            /**
             * Proposed Cross Section Mm2
             * @example 1.5
             * @example 2.50
             */
            proposed_cross_section_mm2?: string | null;
            /** Protective Device */
            protective_device?: string | null;
            /** Rcd Group */
            rcd_group?: string | null;
            /** Phase Count */
            phase_count?: (1 | 2 | 3) | null;
            /** Note */
            note?: string | null;
            /** Proposal Overrides Templates */
            proposal_overrides_templates?: boolean | null;
            /** Designation */
            designation?: string | null;
            /** Name */
            name?: string | null;
        };
        /**
         * ContourDeviceIn
         * @description Geraet als Teil des Raumentwurfs (Phase 5, ADR 0023).
         *
         *     ``id`` wie bei Oeffnungen: bekannt heisst aendern, fehlend oder neu heisst
         *     anlegen (clientseitig erzeugte UUID). Montageflaeche und Wand eines
         *     vorhandenen Geraets aendern sich nicht.
         *
         *     Bezugspunkt ist die **Mitte** des Geraets:
         *
         *     * Wand (``wall_interior``/``wall_exterior``): ``wall_id`` (eine Wand dieses
         *       Raums, auch eine im selben Entwurf neu angelegte), ``center_offset_mm``
         *       (Abstand ab Wandanfang der gerichteten Wand) und ``center_height_mm``
         *       (ueber Fertigfussboden),
         *     * Decke (``ceiling``): ``x_mm``/``y_mm`` in Geschosskoordinaten - **ohne**
         *       Hoehe; sie ist immer die effektive Raumhoehe.
         */
        ContourDeviceIn: {
            /** Id */
            id?: string | null;
            /** Device Type Key */
            device_type_key: string;
            /**
             * Mounting Surface
             * @enum {string}
             */
            mounting_surface: "wall_interior" | "wall_exterior" | "ceiling";
            /** Wall Id */
            wall_id?: string | null;
            /** Center Offset Mm */
            center_offset_mm?: number | null;
            /** Center Height Mm */
            center_height_mm?: number | null;
            /** X Mm */
            x_mm?: number | null;
            /** Y Mm */
            y_mm?: number | null;
            /** Label */
            label?: string | null;
        };
        /**
         * ContourOpeningIn
         * @description Oeffnung als Teil einer vollstaendigen Raumkontur.
         *
         *     ``id`` fehlt oder ist neu: Die Oeffnung wird angelegt - mit genau dieser
         *     ID, wenn sie angegeben ist (clientseitig erzeugte UUID, ADR 0007). Ist die
         *     ID bereits eine Oeffnung **dieser** Wand, wird sie geaendert. Eine
         *     Oeffnung wechselt ihre Wand nicht.
         */
        ContourOpeningIn: {
            /** Id */
            id?: string | null;
            /**
             * Kind
             * @enum {string}
             */
            kind: "door" | "window" | "passage";
            /** Offset Mm */
            offset_mm: number;
            /** Width Mm */
            width_mm: number;
            /** Height Mm */
            height_mm: number;
            /**
             * Sill Height Mm
             * @default 0
             */
            sill_height_mm: number;
        };
        /**
         * ContourWallIn
         * @description Wand als Teil einer vollstaendigen Raumkontur.
         *
         *     Die **Position in der Liste** ist die Konturreihenfolge. ``id`` wie bei
         *     :class:`ContourOpeningIn`: bekannt heisst aendern, fehlend oder neu heisst
         *     anlegen. ``openings`` ist die vollstaendige Liste der Oeffnungen dieser
         *     Wand.
         */
        ContourWallIn: {
            /** Id */
            id?: string | null;
            /** X1 Mm */
            x1_mm: number;
            /** Y1 Mm */
            y1_mm: number;
            /** X2 Mm */
            x2_mm: number;
            /** Y2 Mm */
            y2_mm: number;
            /**
             * Thickness Mm
             * @default 115
             */
            thickness_mm: number;
            /** Openings */
            openings?: components["schemas"]["ContourOpeningIn"][];
        };
        /**
         * CustomerCreate
         * @description Neuer Kunde. Die Kundennummer vergibt der Nummernkreis.
         */
        CustomerCreate: {
            /**
             * Kind
             * @default private
             * @enum {string}
             */
            kind: "private" | "company";
            /** Name */
            name: string;
            /** Contact Person */
            contact_person?: string | null;
            /** Email */
            email?: string | null;
            /** Phone */
            phone?: string | null;
            /** Billing Street */
            billing_street?: string | null;
            /** Billing Postal Code */
            billing_postal_code?: string | null;
            /** Billing City */
            billing_city?: string | null;
            /**
             * Billing Country Code
             * @default DE
             */
            billing_country_code: string;
        };
        /** CustomerOut */
        CustomerOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Customer Number */
            customer_number: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "private" | "company";
            /** Name */
            name: string;
            /** Contact Person */
            contact_person: string | null;
            /** Email */
            email: string | null;
            /** Phone */
            phone: string | null;
            /** Billing Street */
            billing_street: string | null;
            /** Billing Postal Code */
            billing_postal_code: string | null;
            /** Billing City */
            billing_city: string | null;
            /** Billing Country Code */
            billing_country_code: string;
            /** Version */
            version: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            created_by: components["schemas"]["UserReference"];
            updated_by: components["schemas"]["UserReference"];
        };
        /**
         * CustomerUpdate
         * @description Teilaenderung. Nicht gesetzte Felder bleiben unveraendert.
         *
         *     Die Kundennummer ist nicht aenderbar: Sie ist der Bezug bestehender
         *     Belege (docs/security.md, Abschnitt 13, Punkt 4).
         */
        CustomerUpdate: {
            /** Kind */
            kind?: ("private" | "company") | null;
            /** Name */
            name?: string | null;
            /** Contact Person */
            contact_person?: string | null;
            /** Email */
            email?: string | null;
            /** Phone */
            phone?: string | null;
            /** Billing Street */
            billing_street?: string | null;
            /** Billing Postal Code */
            billing_postal_code?: string | null;
            /** Billing City */
            billing_city?: string | null;
            /** Billing Country Code */
            billing_country_code?: string | null;
        };
        /**
         * DefaultsBasisIn
         * @description Stand der Vorgaben, den der Client gesehen hat (``effective``-Antwort, ADR 0027 Nr. 8).
         *
         *     ``0`` = zu dem Zeitpunkt keine Vorgabe gespeichert. ``cable_template_*`` nur, wenn die
         *     Kabelangaben aus einer Vorlage stammen; ``circuit_version`` nur bei aktivierter
         *     Stromkreisvorgabe.
         */
        DefaultsBasisIn: {
            /** Office Version */
            office_version: number;
            /** Project Version */
            project_version: number;
            /** Cable Template Id */
            cable_template_id?: string | null;
            /** Cable Template Version */
            cable_template_version?: number | null;
            /** Circuit Version */
            circuit_version?: number | null;
        };
        /**
         * DefaultsBasisOut
         * @description Stand der Vorgaben dieser Antwort - beim Speichern als ``defaults_basis`` mitsenden.
         */
        DefaultsBasisOut: {
            /** Office Version */
            office_version: number;
            /** Project Version */
            project_version: number;
            /** Cable Template Id */
            cable_template_id?: string | null;
            /** Cable Template Version */
            cable_template_version?: number | null;
            /** Circuit Version */
            circuit_version?: number | null;
        };
        /**
         * DeviceOut
         * @description Ein gespeichertes Geraet (Phase 5). Bezugspunkt ist die Geraetemitte.
         */
        DeviceOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Room Id
             * Format: uuid
             */
            room_id: string;
            /** Device Type Key */
            device_type_key: string;
            /**
             * Mounting Surface
             * @enum {string}
             */
            mounting_surface: "wall_interior" | "wall_exterior" | "ceiling";
            /** Wall Id */
            wall_id: string | null;
            /** Center Offset Mm */
            center_offset_mm: number | null;
            /** Center Height Mm */
            center_height_mm: number | null;
            /** X Mm */
            x_mm: number | null;
            /** Y Mm */
            y_mm: number | null;
            /** Label */
            label: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /**
         * DeviceTypeOut
         * @description Ein Geraetetyp des Systemkatalogs.
         *
         *     ``width_mm``/``height_mm`` sind das **Planungsmass** fuer die
         *     Platzierungspruefung (an der Wand Breite x Hoehe, an der Decke in x und y)
         *     - keine Herstellerangabe. ``default_center_height_mm`` ist ein Startwert,
         *     keine Normvorgabe. ``is_active = false``: nicht mehr fuer neue Geraete.
         */
        DeviceTypeOut: {
            /** Key */
            key: string;
            /** Label */
            label: string;
            /**
             * Category
             * @enum {string}
             */
            category: "socket" | "switch" | "light" | "data" | "distribution" | "junction";
            /** Symbol Key */
            symbol_key: string;
            /** Allows Wall Interior */
            allows_wall_interior: boolean;
            /** Allows Wall Exterior */
            allows_wall_exterior: boolean;
            /** Allows Ceiling */
            allows_ceiling: boolean;
            /** Default Center Height Mm */
            default_center_height_mm: number | null;
            /** Width Mm */
            width_mm: number;
            /** Height Mm */
            height_mm: number;
            /** Sort Order */
            sort_order: number;
            /** Is Active */
            is_active: boolean;
        };
        /** DeviceTypeTemplateIn */
        DeviceTypeTemplateIn: {
            /** Device Type Key */
            device_type_key: string;
            /**
             * Cable Template Id
             * Format: uuid
             */
            cable_template_id: string;
        };
        /** DeviceTypeTemplateOut */
        DeviceTypeTemplateOut: {
            /** Device Type Key */
            device_type_key: string;
            /**
             * Cable Template Id
             * Format: uuid
             */
            cable_template_id: string;
        };
        /**
         * DirectoryEntryOut
         * @description Eintrag der Benutzerliste: Mitgliedschaft **oder** offene Einladung.
         *
         *     ``kind`` unterscheidet beides. ``id`` ist je nach Art die ID der
         *     Mitgliedschaft oder der Einladung. Ein entferntes Konto (``removed``)
         *     erscheint nur mit ``status=removed`` und **ohne** Name und E-Mail.
         */
        DirectoryEntryOut: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "member" | "invitation";
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Full Name */
            full_name: string | null;
            /** Email */
            email: string | null;
            /**
             * Status
             * @enum {string}
             */
            status: "active" | "disabled" | "invited" | "removed";
            /** Roles */
            roles: components["schemas"]["RoleRef"][];
            /** Last Login At */
            last_login_at: string | null;
            /** Invitation Expires At */
            invitation_expires_at: string | null;
            /** Invitation Expired */
            invitation_expired: boolean;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Version */
            version: number;
        };
        /**
         * DistributionBoardCreate
         * @description Neue Verteilung eines Gebaeudes (ADR 0026).
         *
         *     ``placement_device_id`` ist optional: ein Geraet des Typs
         *     ``distribution_board`` in diesem Gebaeude, das noch keine andere Verteilung
         *     platziert. Ohne Lage ist die Verteilung zulaessig.
         */
        DistributionBoardCreate: {
            /** Code */
            code: string;
            /** Name */
            name: string;
            /** Note */
            note?: string | null;
            /** Placement Device Id */
            placement_device_id?: string | null;
        };
        /**
         * DistributionBoardListOut
         * @description Alle Verteilungen eines Gebaeudes, nach Code sortiert.
         */
        DistributionBoardListOut: {
            /**
             * Building Id
             * Format: uuid
             */
            building_id: string;
            /** Boards */
            boards: components["schemas"]["DistributionBoardOut"][];
        };
        /** DistributionBoardOut */
        DistributionBoardOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Building Id
             * Format: uuid
             */
            building_id: string;
            /** Code */
            code: string;
            /** Name */
            name: string;
            /** Note */
            note: string | null;
            /** Placement Device Id */
            placement_device_id: string | null;
            /** Version */
            version: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /**
         * DistributionBoardUpdate
         * @description Teilaenderung (``If-Match``). ``note`` und ``placement_device_id`` sind leerbar.
         */
        DistributionBoardUpdate: {
            /** Code */
            code?: string | null;
            /** Name */
            name?: string | null;
            /** Note */
            note?: string | null;
            /** Placement Device Id */
            placement_device_id?: string | null;
        };
        /** EffectiveAllowanceOut */
        EffectiveAllowanceOut: {
            /**
             * Endpoint Kind
             * @enum {string}
             */
            endpoint_kind: "board" | "junction" | "device";
            /** Value Mm */
            value_mm: number;
            /**
             * Origin
             * @enum {string}
             */
            origin: "legacy" | "manual" | "circuit_override" | "device_type_template" | "default_template" | "project_default" | "office_default" | "none";
        };
        /** EffectiveCableAllowancesOut */
        EffectiveCableAllowancesOut: {
            /**
             * Origin
             * @enum {string}
             */
            origin: "legacy" | "manual" | "circuit_override" | "device_type_template" | "default_template" | "project_default" | "office_default" | "none";
            /** Start Mm */
            start_mm: number;
            /** End Mm */
            end_mm: number;
            /**
             * Start Origin
             * @enum {string}
             */
            start_origin: "legacy" | "manual" | "circuit_override" | "device_type_template" | "default_template" | "project_default" | "office_default" | "none";
            /**
             * End Origin
             * @enum {string}
             */
            end_origin: "legacy" | "manual" | "circuit_override" | "device_type_template" | "default_template" | "project_default" | "office_default" | "none";
        };
        /**
         * EffectiveForCableOut
         * @description Vorbelegung fuer eine konkrete neue Leitung - genau das, was der Server mit
         *     ``*_source = defaults`` speichern wuerde.
         */
        EffectiveForCableOut: {
            /**
             * Circuit Id
             * Format: uuid
             */
            circuit_id: string;
            /** Start Device Id */
            start_device_id: string | null;
            /** End Device Id */
            end_device_id: string | null;
            spec: components["schemas"]["EffectiveSpecOut"];
            reserve: components["schemas"]["EffectiveReserveOut"];
            allowances: components["schemas"]["EffectiveCableAllowancesOut"];
            /** Hints */
            hints: components["schemas"]["EffectiveHintOut"][];
            basis: components["schemas"]["DefaultsBasisOut"];
        };
        /**
         * EffectiveHintOut
         * @description Hinweis, nie eine stille Entscheidung: ``template-inactive``,
         *     ``start-template-differs``, ``circuit-proposal-not-activated``,
         *     ``circuit-override-incomplete``.
         */
        EffectiveHintOut: {
            /** Code */
            code: string;
            /** Template Id */
            template_id: string | null;
            /** Device Id */
            device_id: string | null;
        };
        /** EffectivePermissionOut */
        EffectivePermissionOut: {
            /** Key */
            key: string;
            /** Description */
            description: string;
            /** Area */
            area: string;
            /** Granted By */
            granted_by: components["schemas"]["RoleRef"][];
        };
        /**
         * EffectivePlanningDefaultsOut
         * @description Wirksame Vorgaben eines Projekts (aufgeloeste Werte, Herkunft, Versionsbasis).
         *
         *     Ein konsistenter Stand je Antwort (geteilte Projekt- und Vorgabensperre). ``basis`` ist
         *     beim Speichern einer Leitung mit ``*_source = defaults`` als ``defaults_basis`` zu
         *     senden; ``for_cable`` nur mit ``circuit_id`` (optional Start-/Endgeraet).
         */
        EffectivePlanningDefaultsOut: {
            /**
             * Project Id
             * Format: uuid
             */
            project_id: string;
            /** Project Status */
            project_status: string;
            basis: components["schemas"]["DefaultsBasisOut"];
            reserve: components["schemas"]["EffectiveReserveOut"];
            /** Allowances */
            allowances: components["schemas"]["EffectiveAllowanceOut"][];
            default_template: components["schemas"]["EffectiveTemplateChoiceOut"] | null;
            /** Device Type Templates */
            device_type_templates: components["schemas"]["EffectiveTemplateChoiceOut"][];
            /** Templates */
            templates: components["schemas"]["CableTemplateOut"][];
            for_cable: components["schemas"]["EffectiveForCableOut"] | null;
        };
        /** EffectiveReserveOut */
        EffectiveReserveOut: {
            /** Percent */
            percent: string;
            /**
             * Origin
             * @enum {string}
             */
            origin: "legacy" | "manual" | "circuit_override" | "device_type_template" | "default_template" | "project_default" | "office_default" | "none";
        };
        /** EffectiveSpecOut */
        EffectiveSpecOut: {
            /**
             * Origin
             * @enum {string}
             */
            origin: "legacy" | "manual" | "circuit_override" | "device_type_template" | "default_template" | "project_default" | "office_default" | "none";
            /** Cable Type */
            cable_type: string | null;
            /** Conductor Count */
            conductor_count: number | null;
            /** Cross Section Mm2 */
            cross_section_mm2: string | null;
            /** Cable Template Id */
            cable_template_id: string | null;
            /** Level */
            level: ("project" | "office") | null;
            /** Deciding Device Id */
            deciding_device_id: string | null;
        };
        /**
         * EffectiveTemplateChoiceOut
         * @description Vorlagenwahl einer Ebene: Projekt vor Betrieb; ``template`` inklusive Aktivstatus.
         */
        EffectiveTemplateChoiceOut: {
            /** Device Type Key */
            device_type_key: string | null;
            /**
             * Level
             * @enum {string}
             */
            level: "project" | "office";
            template: components["schemas"]["CableTemplateOut"];
        };
        /**
         * FileDownloadUrl
         * @description Kurzlebige Download-Adresse fuer den Browser.
         */
        FileDownloadUrl: {
            /** Url */
            url: string;
            /** Filename */
            filename: string;
            /** Expires In */
            expires_in: number;
        };
        /** FileOut */
        FileOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Filename */
            filename: string;
            /** Content Type */
            content_type: string;
            /** Size Bytes */
            size_bytes: number;
            /** Sha256 */
            sha256: string;
            /** Project Id */
            project_id: string | null;
            /** Entity Type */
            entity_type: string | null;
            /** Entity Id */
            entity_id: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
        };
        /** FloorCreate */
        FloorCreate: {
            /** Name */
            name: string;
            /** Level */
            level: number;
            /**
             * Elevation Mm
             * @default 0
             */
            elevation_mm: number;
            /**
             * Elevation Confirmed
             * @default false
             */
            elevation_confirmed: boolean;
            /**
             * Default Ceiling Height Mm
             * @default 2500
             */
            default_ceiling_height_mm: number;
        };
        /** FloorOut */
        FloorOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Building Id
             * Format: uuid
             */
            building_id: string;
            /** Name */
            name: string;
            /** Level */
            level: number;
            /** Elevation Mm */
            elevation_mm: number;
            /** Elevation Confirmed */
            elevation_confirmed: boolean;
            /** Default Ceiling Height Mm */
            default_ceiling_height_mm: number;
            /** Version */
            version: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /**
         * FloorPlanOut
         * @description Vollstaendiger Planungsstand eines Geschosses in **einer** Antwort.
         *
         *     Bewusst ohne Stammdaten des Geschosses oder Projekts: Die liefert der
         *     Core. Hier steht nur, was das Fachmodul besitzt - und die beiden IDs,
         *     an denen es haengt. Seit Phase 6a gehoeren die Wandkopplungen dazu, damit
         *     Editor, Geraetepruefung und 3D denselben Stand lesen.
         */
        FloorPlanOut: {
            /**
             * Floor Id
             * Format: uuid
             */
            floor_id: string;
            /**
             * Project Id
             * Format: uuid
             */
            project_id: string;
            /** Rooms */
            rooms: components["schemas"]["RoomPlanOut"][];
            /** Wall Links */
            wall_links: components["schemas"]["WallLinkOut"][];
            /** Wall Link Candidates */
            wall_link_candidates: components["schemas"]["WallLinkCandidateOut"][];
        };
        /**
         * FloorUpdate
         * @description Teilaenderung eines Geschosses.
         *
         *     **Bestaetigte Hoehenlage (ADR 0025):** Eine Bestaetigung gilt genau fuer den
         *     gespeicherten Wert. Aendert die Anfrage ``elevation_mm`` tatsaechlich und
         *     sendet nicht zugleich ``elevation_confirmed: true``, faellt die Bestaetigung
         *     weg. Ein unveraenderter Wert laesst sie stehen. ``elevation_confirmed``
         *     allein setzt oder entzieht sie ohne Wertaenderung.
         */
        FloorUpdate: {
            /** Name */
            name?: string | null;
            /** Level */
            level?: number | null;
            /** Elevation Mm */
            elevation_mm?: number | null;
            /** Elevation Confirmed */
            elevation_confirmed?: boolean | null;
            /** Default Ceiling Height Mm */
            default_ceiling_height_mm?: number | null;
        };
        /**
         * GeometryProblemOut
         * @description Ein Geometriefehler mit stabilem Code und deutscher Meldung.
         */
        GeometryProblemOut: {
            /** Code */
            code: string;
            /** Message */
            message: string;
            /** Wall Ids */
            wall_ids?: string[];
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** HealthStatus */
        HealthStatus: {
            /**
             * Status
             * @enum {string}
             */
            status: "ok" | "degraded";
            /**
             * Database
             * @default true
             */
            database: boolean;
        };
        /** InvitationAccepted */
        InvitationAccepted: {
            /** Organization Name */
            organization_name: string;
            /** Email */
            email: string;
        };
        /** InvitationCreate */
        InvitationCreate: {
            /**
             * Email
             * Format: email
             */
            email: string;
            /** Full Name */
            full_name?: string | null;
            /** Role Keys */
            role_keys: string[];
        };
        /**
         * InvitationIssued
         * @description Ergebnis von Anlage und erneuter Ausstellung.
         *
         *     ``development_activation_url`` ist nur gesetzt, wenn der Server mit
         *     ``ELEKTROPLAN_INVITATION_DELIVERY=development_link`` laeuft - nie in
         *     Produktion. Der Link steht **nur in dieser Antwort**; er wird nicht
         *     gespeichert und ist spaeter nicht erneut abrufbar.
         */
        InvitationIssued: {
            invitation: components["schemas"]["InvitationOut"];
            /**
             * Delivery
             * @constant
             */
            delivery: "development_link";
            /** Development Activation Url */
            development_activation_url?: string | null;
        };
        /** InvitationOut */
        InvitationOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Email */
            email: string;
            /** Full Name */
            full_name: string | null;
            /**
             * Status
             * @enum {string}
             */
            status: "pending" | "expired" | "accepted" | "revoked";
            /** Roles */
            roles: components["schemas"]["RoleRef"][];
            /**
             * Expires At
             * Format: date-time
             */
            expires_at: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Version */
            version: number;
        };
        /**
         * InvitationPolicy
         * @description Was die Oberflaeche vor dem Einladen wissen muss.
         */
        InvitationPolicy: {
            /** Valid Hours */
            valid_hours: number;
            /**
             * Delivery
             * @enum {string}
             */
            delivery: "none" | "development_link";
        };
        /** InvitationPreview */
        InvitationPreview: {
            /** Organization Name */
            organization_name: string;
            /** Email */
            email: string;
            /** Full Name */
            full_name: string | null;
            /**
             * Expires At
             * Format: date-time
             */
            expires_at: string;
            /** Account Exists */
            account_exists: boolean;
        };
        /** InvitationTokenIn */
        InvitationTokenIn: {
            /** Token */
            token: string;
        };
        /** LoginRequest */
        LoginRequest: {
            /**
             * Email
             * Format: email
             */
            email: string;
            /** Password */
            password: string;
            /**
             * Organization Id
             * @description Optional, wenn der Benutzer mehreren Betrieben angehoert.
             */
            organization_id?: string | null;
        };
        /**
         * MeResponse
         * @description Benutzer, aktiver Mandant, Rollen und Berechtigungen.
         */
        MeResponse: {
            /**
             * User Id
             * Format: uuid
             */
            user_id: string;
            /** Email */
            email: string;
            /** Full Name */
            full_name: string;
            organization: components["schemas"]["OrganizationSummary"];
            /**
             * Member Id
             * Format: uuid
             */
            member_id: string;
            /** Roles */
            roles: components["schemas"]["RoleSummary"][];
            /** Permissions */
            permissions: string[];
        };
        /**
         * MemberOut
         * @description Eine Mitgliedschaft im aktuellen Betrieb.
         *
         *     Enthaelt vom globalen Konto nur Name und E-Mail. Aenderbar sind sie nur,
         *     wenn das Konto keinem anderen Betrieb angehoert (``account_shared``,
         *     ADR 0021). Bei einem entfernten Konto sind beide ``None``.
         */
        MemberOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Full Name */
            full_name: string | null;
            /** Email */
            email: string | null;
            /**
             * Status
             * @enum {string}
             */
            status: "active" | "disabled" | "removed";
            /** Lock Reason */
            lock_reason: string | null;
            /** Roles */
            roles: components["schemas"]["RoleRef"][];
            /** Is Administrator */
            is_administrator: boolean;
            /** Is Self */
            is_self: boolean;
            /** Is Last Active Administrator */
            is_last_active_administrator: boolean;
            /** Account Shared */
            account_shared: boolean;
            /**
             * Joined At
             * Format: date-time
             */
            joined_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Last Login At */
            last_login_at: string | null;
            /** Version */
            version: number;
        };
        /** MemberPermissionsOut */
        MemberPermissionsOut: {
            /**
             * Member Id
             * Format: uuid
             */
            member_id: string;
            /** Version */
            version: number;
            /** Roles */
            roles: components["schemas"]["RoleRef"][];
            /** Permissions */
            permissions: components["schemas"]["EffectivePermissionOut"][];
        };
        /**
         * MemberProfileUpdate
         * @description Name und/oder E-Mail-Adresse. Mindestens ein Feld.
         */
        MemberProfileUpdate: {
            /** Full Name */
            full_name?: string | null;
            /** Email */
            email?: string | null;
        };
        /**
         * MemberRemove
         * @description Bestaetigung: die aktuelle E-Mail-Adresse des Kontos.
         */
        MemberRemove: {
            /** Confirm Email */
            confirm_email: string;
        };
        /**
         * MemberRolesUpdate
         * @description Vollstaendige Liste der Systemrollen - ersetzt die bisherigen als Ganzes.
         */
        MemberRolesUpdate: {
            /** Role Keys */
            role_keys: string[];
        };
        /**
         * MemberSuspend
         * @description Optionaler, kurzer Sperrgrund - ohne sensible Angaben.
         */
        MemberSuspend: {
            /** Reason */
            reason?: string | null;
        };
        /**
         * ModuleInfo
         * @description Beschreibung eines registrierten Moduls.
         */
        ModuleInfo: {
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Version */
            version: string;
            /** Kind */
            kind: string;
            /** Depends On */
            depends_on: string[];
            /** Permissions */
            permissions: string[];
        };
        /**
         * NewPenetrationIn
         * @description Neue Durchfuehrung, die mit dieser Leitung entsteht (atomar, Entwurf §8.2).
         *
         *     Lage an ``wall_a`` der Kopplung (ab deren Wandanfang); ``key`` verbindet sie
         *     mit dem Wegpunkt ``new_penetration_key``.
         */
        NewPenetrationIn: {
            /** Key */
            key: string;
            /**
             * Wall Link Id
             * Format: uuid
             */
            wall_link_id: string;
            /** Offset Mm */
            offset_mm: number;
            /** Height Mm */
            height_mm: number;
            /** Note */
            note?: string | null;
        };
        /** NumberedPage[CustomerOut] */
        NumberedPage_CustomerOut_: {
            /** Items */
            items: components["schemas"]["CustomerOut"][];
            /**
             * Page
             * @description Tatsaechlich gelieferte Seite, beginnend bei 1. Lag die angefragte Seite hinter der letzten, ist es die letzte vorhandene Seite.
             */
            page: number;
            /** Page Size */
            page_size: number;
            /**
             * Total Items
             * @description Treffer unter allen Filtern, nur eigener Betrieb.
             */
            total_items: number;
            /**
             * Total Pages
             * @description 0 bei leerer Treffermenge.
             */
            total_pages: number;
        };
        /** NumberedPage[ProjectSummary] */
        NumberedPage_ProjectSummary_: {
            /** Items */
            items: components["schemas"]["ProjectSummary"][];
            /**
             * Page
             * @description Tatsaechlich gelieferte Seite, beginnend bei 1. Lag die angefragte Seite hinter der letzten, ist es die letzte vorhandene Seite.
             */
            page: number;
            /** Page Size */
            page_size: number;
            /**
             * Total Items
             * @description Treffer unter allen Filtern, nur eigener Betrieb.
             */
            total_items: number;
            /**
             * Total Pages
             * @description 0 bei leerer Treffermenge.
             */
            total_pages: number;
        };
        /**
         * OpeningCreate
         * @description Neue Oeffnung in einer Wand.
         */
        OpeningCreate: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "door" | "window" | "passage";
            /** Offset Mm */
            offset_mm: number;
            /** Width Mm */
            width_mm: number;
            /** Height Mm */
            height_mm: number;
            /**
             * Sill Height Mm
             * @default 0
             */
            sill_height_mm: number;
        };
        /**
         * OpeningCrossingWaypointIn
         * @description Bodenuebergang: Lage auf der Achse der Wand, an der die Oeffnung gespeichert ist.
         *
         *     ``opening_id`` ist der fachliche Bezug; ``null`` nur bei einer Leitung, deren
         *     Oeffnung bestaetigt entfernt wurde (Konflikt, Entwurf §5.6).
         */
        OpeningCrossingWaypointIn: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "opening_crossing";
            /**
             * Wall Id
             * Format: uuid
             */
            wall_id: string;
            /** Offset Mm */
            offset_mm: number;
            /** Opening Id */
            opening_id: string | null;
        };
        /**
         * OpeningOut
         * @description Eine Oeffnung in ihrer Wand.
         */
        OpeningOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Wall Id
             * Format: uuid
             */
            wall_id: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "door" | "window" | "passage";
            /** Offset Mm */
            offset_mm: number;
            /** Width Mm */
            width_mm: number;
            /** Height Mm */
            height_mm: number;
            /** Sill Height Mm */
            sill_height_mm: number;
            /** Version */
            version: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /**
         * OpeningUpdate
         * @description Teilaenderung einer Oeffnung. Die Wand bleibt unveraendert.
         */
        OpeningUpdate: {
            /** Kind */
            kind?: ("door" | "window" | "passage") | null;
            /** Offset Mm */
            offset_mm?: number | null;
            /** Width Mm */
            width_mm?: number | null;
            /** Height Mm */
            height_mm?: number | null;
            /** Sill Height Mm */
            sill_height_mm?: number | null;
        };
        /**
         * OrganizationChoice
         * @description Auswaehlbarer Betrieb beim Mehrmandanten-Login.
         */
        OrganizationChoice: {
            /** Id */
            id: string;
            /** Name */
            name: string;
        };
        /** OrganizationSummary */
        OrganizationSummary: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
            /** Slug */
            slug: string;
        };
        /** Page[AuditEntryOut] */
        Page_AuditEntryOut_: {
            /** Items */
            items: components["schemas"]["AuditEntryOut"][];
            /** Next Cursor */
            next_cursor?: string | null;
            /**
             * Has More
             * @default false
             */
            has_more: boolean;
        };
        /** Page[DirectoryEntryOut] */
        Page_DirectoryEntryOut_: {
            /** Items */
            items: components["schemas"]["DirectoryEntryOut"][];
            /** Next Cursor */
            next_cursor?: string | null;
            /**
             * Has More
             * @default false
             */
            has_more: boolean;
        };
        /** PasswordResetComplete */
        PasswordResetComplete: {
            /** Token */
            token: string;
            /** Password */
            password: string;
        };
        /**
         * PasswordResetIssued
         * @description Ergebnis eines vom Administrator ausgeloesten Resets.
         *
         *     ``reset_url`` steht **nur in dieser Antwort** - er wird nicht gespeichert
         *     und ist spaeter nicht erneut abrufbar. Ein neuer Link macht ihn ungueltig.
         */
        PasswordResetIssued: {
            /**
             * Member Id
             * Format: uuid
             */
            member_id: string;
            /**
             * Delivery
             * @constant
             */
            delivery: "admin_link";
            /** Reset Url */
            reset_url: string;
            /**
             * Expires At
             * Format: date-time
             */
            expires_at: string;
        };
        /**
         * PasswordResetPreview
         * @description Was der Inhaber eines gueltigen Links erfaehrt: nur die Ablaufzeit.
         */
        PasswordResetPreview: {
            /**
             * Expires At
             * Format: date-time
             */
            expires_at: string;
        };
        /** PasswordResetTokenIn */
        PasswordResetTokenIn: {
            /** Token */
            token: string;
        };
        /** PenetrationListOut */
        PenetrationListOut: {
            /**
             * Floor Id
             * Format: uuid
             */
            floor_id: string;
            /** Penetrations */
            penetrations: components["schemas"]["PenetrationOut"][];
        };
        /**
         * PenetrationOut
         * @description Durchfuehrung an ``wall_a`` der Kopplung samt abgeleiteter Gegenlage an ``wall_b``.
         *
         *     ``problem_code`` ist ``null``, wenn die Durchfuehrung gueltig ist.
         *     ``cable_ids``: Leitungen, die sie nutzen - gezaehlt wird sie einmal.
         */
        PenetrationOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Wall Link Id
             * Format: uuid
             */
            wall_link_id: string;
            /**
             * Wall A Id
             * Format: uuid
             */
            wall_a_id: string;
            /**
             * Wall B Id
             * Format: uuid
             */
            wall_b_id: string;
            /**
             * Floor Id
             * Format: uuid
             */
            floor_id: string;
            /** Offset Mm */
            offset_mm: number;
            /** Height Mm */
            height_mm: number;
            /** Note */
            note: string | null;
            opposite_offset: components["schemas"]["PositionOut"] | null;
            /** Problem Code */
            problem_code: string | null;
            /** Cable Ids */
            cable_ids: string[];
            /** Version */
            version: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /**
         * PenetrationUpdate
         * @description Lage, Hoehe oder Notiz einer Durchfuehrung aendern (``If-Match``).
         *
         *     Die neue Lage muss gueltig sein (``422``). Wuerde eine Leitung dadurch
         *     unterbrochen, braucht es ``acknowledged_cable_ids`` mit genau diesen Leitungen.
         */
        PenetrationUpdate: {
            /** Offset Mm */
            offset_mm?: number | null;
            /** Height Mm */
            height_mm?: number | null;
            /** Note */
            note?: string | null;
            /** Acknowledged Cable Ids */
            acknowledged_cable_ids?: string[];
        };
        /**
         * PenetrationWaypointIn
         * @description Durchfuehrung: vorhandene (``penetration_id``) oder neu im selben Vorgang angelegte
         *     (``new_penetration_key`` aus ``new_penetrations``) - genau eins von beiden.
         */
        PenetrationWaypointIn: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "penetration";
            /** Penetration Id */
            penetration_id?: string | null;
            /** New Penetration Key */
            new_penetration_key?: string | null;
        };
        /** PermissionInfo */
        PermissionInfo: {
            /** Key */
            key: string;
            /** Description */
            description: string;
            /** Area */
            area: string;
        };
        /**
         * PlacementRoomOut
         * @description Ein durch die Platzierung geaenderter Raum mit seiner neuen Version.
         */
        PlacementRoomOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Floor Id
             * Format: uuid
             */
            floor_id: string;
            /** Version */
            version: number;
        };
        /**
         * PlanningDefaultsIn
         * @description Betriebsstandard ersetzen (``electrical.defaults.manage``).
         */
        PlanningDefaultsIn: {
            /** Expected Version */
            expected_version: number;
            /**
             * Reserve Percent
             * @example 20
             * @example null
             */
            reserve_percent: string | null;
            /** Board Allowance Mm */
            board_allowance_mm: number | null;
            /** Junction Allowance Mm */
            junction_allowance_mm: number | null;
            /** Device Allowance Mm */
            device_allowance_mm: number | null;
            /** Default Cable Template Id */
            default_cable_template_id: string | null;
            /** Device Type Templates */
            device_type_templates: components["schemas"]["DeviceTypeTemplateIn"][];
        };
        /**
         * PlanningDefaultsOut
         * @description Betriebsstandard - gespeicherte Werte, ``null`` = nicht gesetzt.
         */
        PlanningDefaultsOut: {
            /** Version */
            version: number;
            /** Reserve Percent */
            reserve_percent: string | null;
            /** Board Allowance Mm */
            board_allowance_mm: number | null;
            /** Junction Allowance Mm */
            junction_allowance_mm: number | null;
            /** Device Allowance Mm */
            device_allowance_mm: number | null;
            /** Default Cable Template Id */
            default_cable_template_id: string | null;
            /** Device Type Templates */
            device_type_templates: components["schemas"]["DeviceTypeTemplateOut"][];
            /** Updated At */
            updated_at: string | null;
        };
        /**
         * PositionOut
         * @description Exakte Lage ``whole + steps * sqrt(m)`` ab Wandanfang und ihr gerundeter Wert.
         */
        PositionOut: {
            /** Whole */
            whole: number;
            /** Steps */
            steps: number;
            /** Rounded Mm */
            rounded_mm: number;
        };
        /**
         * PreferencesIn
         * @description Vollstaendiger Stand - ersetzt den gespeicherten als Ganzes.
         *
         *     Unbekannte Werte und zusaetzliche Felder werden abgelehnt (``422``).
         */
        PreferencesIn: {
            /**
             * Theme Mode
             * @enum {string}
             */
            theme_mode: "system" | "light" | "dark";
            /**
             * Accent
             * @enum {string}
             */
            accent: "blue" | "teal" | "green" | "violet" | "orange";
            /**
             * Length Unit
             * @enum {string}
             */
            length_unit: "mm" | "cm" | "m";
        };
        /**
         * PreferencesOut
         * @description Eigene Einstellungen im aktuellen Betrieb.
         *
         *     ``stored`` sagt, ob es bereits einen Serverstand gibt. Ohne ihn stehen hier
         *     die dokumentierten Standardwerte (``system``, ``blue``, ``cm``) und
         *     ``version`` ist ``0``; der Client darf dann einmalig einen alten lokalen
         *     Stand uebertragen (``POST``). Mit ihm ist der Server die Wahrheit, und
         *     Aenderungen laufen ueber ``PUT`` mit ``If-Match`` (ADR 0021).
         */
        PreferencesOut: {
            /** Stored */
            stored: boolean;
            /**
             * Theme Mode
             * @enum {string}
             */
            theme_mode: "system" | "light" | "dark";
            /**
             * Accent
             * @enum {string}
             */
            accent: "blue" | "teal" | "green" | "violet" | "orange";
            /**
             * Length Unit
             * @enum {string}
             */
            length_unit: "mm" | "cm" | "m";
            /** Version */
            version: number;
        };
        /**
         * ProblemDetail
         * @description Antwortkoerper nach RFC 9457.
         */
        ProblemDetail: {
            /**
             * Type
             * @example https://elektroplan.internal/errors/not-found
             */
            type: string;
            /** Title */
            title: string;
            /** Status */
            status: number;
            /** Detail */
            detail?: string | null;
            /** Instance */
            instance?: string | null;
            /** Request Id */
            request_id?: string | null;
            /** Errors */
            errors?: components["schemas"]["ProblemFieldError"][] | null;
            /** Organizations */
            organizations?: components["schemas"]["OrganizationChoice"][] | null;
        };
        /**
         * ProblemFieldError
         * @description Einzelner Feldfehler innerhalb einer Problemantwort.
         */
        ProblemFieldError: {
            /** Field */
            field: string;
            /** Code */
            code: string;
            /** Message */
            message: string;
            /** Keys */
            keys?: string[] | null;
        };
        /**
         * ProjectContentOut
         * @description Eine erkannte Inhaltsart - aus dem Core oder einem Fachmodul.
         */
        ProjectContentOut: {
            /** Code */
            code: string;
            /** Label */
            label: string;
            /** Count */
            count: number | null;
        };
        /**
         * ProjectCreate
         * @description Neues Projekt. Die Projektnummer vergibt der Nummernkreis.
         */
        ProjectCreate: {
            /**
             * Customer Id
             * Format: uuid
             */
            customer_id: string;
            /** Name */
            name: string;
            /** Site Street */
            site_street?: string | null;
            /** Site Postal Code */
            site_postal_code?: string | null;
            /** Site City */
            site_city?: string | null;
            /**
             * Site Country Code
             * @default DE
             */
            site_country_code: string;
        };
        /**
         * ProjectDeletionCheck
         * @description Vorpruefung einer Projektloeschung (ADR 0020).
         *
         *     **Keine Autorisierung und keine Garantie.** Die Loeschung prueft alles
         *     erneut unter der Projektsperre.
         */
        ProjectDeletionCheck: {
            /**
             * Project Id
             * Format: uuid
             */
            project_id: string;
            /** Project Number */
            project_number: string;
            /** Name */
            name: string;
            /**
             * Status
             * @enum {string}
             */
            status: "draft" | "active" | "completed" | "archived";
            /** Version */
            version: number;
            /** Is Empty */
            is_empty: boolean;
            /** Contents */
            contents: components["schemas"]["ProjectContentOut"][];
            /** Status Allows Deletion */
            status_allows_deletion: boolean;
            /** Can Delete */
            can_delete: boolean;
            /** Requires Admin */
            requires_admin: boolean;
            /** Requires Number Confirmation */
            requires_number_confirmation: boolean;
            /** Blocked Code */
            blocked_code: ("status" | "permission") | null;
            /** Blocked Reason */
            blocked_reason: string | null;
        };
        /** ProjectOut */
        ProjectOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Project Number */
            project_number: string;
            /** Name */
            name: string;
            /**
             * Status
             * @enum {string}
             */
            status: "draft" | "active" | "completed" | "archived";
            /**
             * Customer Id
             * Format: uuid
             */
            customer_id: string;
            /** Site Street */
            site_street: string | null;
            /** Site Postal Code */
            site_postal_code: string | null;
            /** Site City */
            site_city: string | null;
            /** Site Country Code */
            site_country_code: string;
            /** Version */
            version: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            created_by: components["schemas"]["UserReference"];
            updated_by: components["schemas"]["UserReference"];
        };
        /**
         * ProjectPlanningDefaultsIn
         * @description Projektvorgabe ersetzen (``electrical.route.write``) - waehlt nur Betriebsvorlagen.
         */
        ProjectPlanningDefaultsIn: {
            /** Expected Version */
            expected_version: number;
            /**
             * Reserve Percent
             * @example 20
             * @example null
             */
            reserve_percent: string | null;
            /** Board Allowance Mm */
            board_allowance_mm: number | null;
            /** Junction Allowance Mm */
            junction_allowance_mm: number | null;
            /** Device Allowance Mm */
            device_allowance_mm: number | null;
            /** Default Cable Template Id */
            default_cable_template_id: string | null;
            /** Device Type Templates */
            device_type_templates: components["schemas"]["DeviceTypeTemplateIn"][];
        };
        /**
         * ProjectPlanningDefaultsOut
         * @description Projektvorgabe - gespeicherte Werte, ``null`` = Betriebsstandard uebernehmen.
         */
        ProjectPlanningDefaultsOut: {
            /** Version */
            version: number;
            /** Reserve Percent */
            reserve_percent: string | null;
            /** Board Allowance Mm */
            board_allowance_mm: number | null;
            /** Junction Allowance Mm */
            junction_allowance_mm: number | null;
            /** Device Allowance Mm */
            device_allowance_mm: number | null;
            /** Default Cable Template Id */
            default_cable_template_id: string | null;
            /** Device Type Templates */
            device_type_templates: components["schemas"]["DeviceTypeTemplateOut"][];
            /** Updated At */
            updated_at: string | null;
            /**
             * Project Id
             * Format: uuid
             */
            project_id: string;
        };
        /**
         * ProjectSummary
         * @description Listeneintrag - mit dem Kundennamen, damit die Liste ohne
         *     Folgeabfragen lesbar ist.
         */
        ProjectSummary: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Project Number */
            project_number: string;
            /** Name */
            name: string;
            /**
             * Status
             * @enum {string}
             */
            status: "draft" | "active" | "completed" | "archived";
            /**
             * Customer Id
             * Format: uuid
             */
            customer_id: string;
            /** Customer Name */
            customer_name: string;
            /** Site City */
            site_city: string | null;
            /** Version */
            version: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            created_by: components["schemas"]["UserReference"];
            updated_by: components["schemas"]["UserReference"];
        };
        /**
         * ProjectUpdate
         * @description Teilaenderung.
         *
         *     Weder Projektnummer noch Status stehen hier: Die Nummer ist der Bezug
         *     bestehender Belege, und ein Statuswechsel hat Vorbedingungen und laeuft
         *     ueber eigene Endpunkte (docs/api.md, Abschnitt 5).
         */
        ProjectUpdate: {
            /** Customer Id */
            customer_id?: string | null;
            /** Name */
            name?: string | null;
            /** Site Street */
            site_street?: string | null;
            /** Site Postal Code */
            site_postal_code?: string | null;
            /** Site City */
            site_city?: string | null;
            /** Site Country Code */
            site_country_code?: string | null;
        };
        /**
         * RiserCoursePointOut
         * @description Punkt des Verlaufs: Geschosskoordinaten, ``z`` = Hoehenlage ueber Gebaeudebezug.
         */
        RiserCoursePointOut: {
            /** X Mm */
            x_mm: number;
            /** Y Mm */
            y_mm: number;
            /** Z Mm */
            z_mm: number;
        };
        /**
         * RiserCreate
         * @description Neuer Steigweg eines Gebaeudes.
         */
        RiserCreate: {
            /** Name */
            name: string;
            /** Note */
            note?: string | null;
            /**
             * Offset Mode
             * @enum {string}
             */
            offset_mode: "orthogonal" | "direct";
            /** Stops */
            stops?: components["schemas"]["RiserStopIn"][];
        };
        /**
         * RiserListOut
         * @description Alle Steigwege eines Gebaeudes, nach Name sortiert.
         */
        RiserListOut: {
            /**
             * Building Id
             * Format: uuid
             */
            building_id: string;
            /** Risers */
            risers: components["schemas"]["RiserOut"][];
        };
        /**
         * RiserOut
         * @description Steigweg samt Halten (nach Geschossebene), Abschnitten und Laengenstatus.
         *
         *     ``length_mm`` gibt es nur bei ``status = confirmed``. Sonst ist
         *     ``known_length_mm`` ausdruecklich eine **Teilsumme** der bekannten Teile -
         *     nie die Leitungslaenge.
         */
        RiserOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Building Id
             * Format: uuid
             */
            building_id: string;
            /** Name */
            name: string;
            /** Note */
            note: string | null;
            /**
             * Offset Mode
             * @enum {string}
             */
            offset_mode: "orthogonal" | "direct";
            /** Stops */
            stops: components["schemas"]["RiserStopOut"][];
            /** Sections */
            sections: components["schemas"]["RiserSectionOut"][];
            /**
             * Status
             * @enum {string}
             */
            status: "confirmed" | "incomplete" | "conflict" | "single-stop" | "no-stops";
            /** Known Length Mm */
            known_length_mm: number;
            /** Length Mm */
            length_mm: number | null;
            /** Version */
            version: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /**
         * RiserSectionOut
         * @description Abschnitt zwischen zwei aufeinanderfolgenden Halten - vereinfachter Planungsverlauf.
         *
         *     ``course`` ist die einzige Quelle fuer Laenge und Darstellung. Bei
         *     ``elevation-unconfirmed`` ist er **vorlaeufig** (gespeicherte, nicht
         *     bestaetigte Hoehenlagen) und ``vertical_mm``/``length_mm`` fehlen; bei
         *     ``elevation-inconsistent`` ebenso. ``horizontal_mm`` ist immer bekannt.
         *     Keine Aussage ueber bauliche Machbarkeit, Brandschutz oder Normen.
         */
        RiserSectionOut: {
            /**
             * Lower Stop Id
             * Format: uuid
             */
            lower_stop_id: string;
            /**
             * Upper Stop Id
             * Format: uuid
             */
            upper_stop_id: string;
            /**
             * Lower Floor Id
             * Format: uuid
             */
            lower_floor_id: string;
            /**
             * Upper Floor Id
             * Format: uuid
             */
            upper_floor_id: string;
            /** Traversed Floor Ids */
            traversed_floor_ids: string[];
            /**
             * Status
             * @enum {string}
             */
            status: "confirmed" | "elevation-unconfirmed" | "elevation-inconsistent";
            /** Course */
            course: components["schemas"]["RiserCoursePointOut"][];
            /** Vertical Mm */
            vertical_mm: number | null;
            /** Horizontal Mm */
            horizontal_mm: number;
            /** Length Mm */
            length_mm: number | null;
            /** Hints */
            hints: "floor-gap-below-ceiling-height"[];
        };
        /**
         * RiserStopIn
         * @description Uebergabepunkt eines Steigwegs auf einem Geschoss (ADR 0025).
         *
         *     ``id`` weglassen heisst: neuer Halt, der Server vergibt die ID. Eine
         *     angegebene ``id`` muss ein vorhandener Halt **dieses** Steigwegs sein; er
         *     behaelt seine ID (spaetere Leitungswege verweisen darauf) und wechselt nie
         *     das Geschoss. Lage in ganzen Millimetern, Geschosskoordinaten, auf Hoehe
         *     des Fertigfussbodens.
         */
        RiserStopIn: {
            /** Id */
            id?: string | null;
            /**
             * Floor Id
             * Format: uuid
             */
            floor_id: string;
            /** X Mm */
            x_mm: number;
            /** Y Mm */
            y_mm: number;
        };
        /** RiserStopOut */
        RiserStopOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Floor Id
             * Format: uuid
             */
            floor_id: string;
            /** X Mm */
            x_mm: number;
            /** Y Mm */
            y_mm: number;
        };
        /**
         * RiserUpdate
         * @description Steigweg vollstaendig ersetzen (``If-Match`` der Steigwegversion).
         *
         *     Halte, die in ``stops`` fehlen, werden entfernt; Halte mit ``id`` behalten
         *     sie. Ein von einer Leitung genutzter Halt laesst sich nicht entfernen
         *     (``409 riser-stop-in-use``); verschiebt sich ein genutzter Halt so, dass
         *     eine Leitung unterbrochen wuerde, braucht es ``acknowledged_cable_ids``.
         */
        RiserUpdate: {
            /** Name */
            name: string;
            /** Note */
            note?: string | null;
            /**
             * Offset Mode
             * @enum {string}
             */
            offset_mode: "orthogonal" | "direct";
            /** Stops */
            stops?: components["schemas"]["RiserStopIn"][];
            /** Acknowledged Cable Ids */
            acknowledged_cable_ids?: string[];
        };
        /**
         * RiserWaypointIn
         * @description Steigwegnutzung in Leitungsrichtung; Hoehen lokal ueber dem FFB des jeweiligen Halts.
         */
        RiserWaypointIn: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "riser";
            /**
             * Riser Id
             * Format: uuid
             */
            riser_id: string;
            /**
             * From Stop Id
             * Format: uuid
             */
            from_stop_id: string;
            /** From Height Mm */
            from_height_mm: number;
            /**
             * To Stop Id
             * Format: uuid
             */
            to_stop_id: string;
            /** To Height Mm */
            to_height_mm: number;
        };
        /**
         * RoleRef
         * @description Verweis auf eine Systemrolle.
         */
        RoleRef: {
            /** Key */
            key: string;
            /** Name */
            name: string;
        };
        /** RoleSummary */
        RoleSummary: {
            /** Key */
            key: string;
            /** Name */
            name: string;
        };
        /**
         * RoomContourOut
         * @description Pruefbericht zur Raumkontur.
         *
         *     Reine Auskunft: Der Bericht aendert nichts. Der Zustand ``valid`` bedeutet,
         *     dass die Waende in ihrer Reihenfolge einen geschlossenen,
         *     ueberschneidungsfreien Polygonzug mit Flaeche bilden.
         */
        RoomContourOut: {
            /**
             * Room Id
             * Format: uuid
             */
            room_id: string;
            /**
             * Contour Status
             * @enum {string}
             */
            contour_status: "draft" | "valid";
            /** Wall Count */
            wall_count: number;
            /** Area Mm2 */
            area_mm2: number | null;
            /** Area M2 */
            area_m2: string | null;
            /** Perimeter Mm */
            perimeter_mm: number | null;
            /** Problems */
            problems: components["schemas"]["GeometryProblemOut"][];
        };
        /**
         * RoomContourUpdate
         * @description Vollstaendiger Zielzustand des Raumentwurfs (``PUT /rooms/{id}/contour``).
         *
         *     Ein Vorgang, eine Transaktion: Entweder gilt danach genau diese Kontur,
         *     oder es hat sich nichts geaendert. Waende, die in ``walls`` fehlen, werden
         *     entfernt. Oeffnungen verschwinden dagegen **nie** stillschweigend: Eine
         *     vorhandene Oeffnung muss entweder in ``walls`` stehen oder ausdruecklich
         *     in ``removed_opening_ids``. Sonst lehnt der Server ab.
         *
         *     **Geraete (Phase 5):** ``devices`` ist - wenn angegeben - die vollstaendige
         *     Geraeteliste des Raums; fuer Geraete gilt dieselbe Regel wie fuer
         *     Oeffnungen (``removed_device_ids``). Fehlt ``devices`` (``null``), bleiben
         *     die gespeicherten Geraete unveraendert - und werden trotzdem gegen die neue
         *     Geometrie geprueft. Geometrie und Geraete werden immer **gemeinsam**
         *     gespeichert.
         */
        RoomContourUpdate: {
            /** Walls */
            walls: components["schemas"]["ContourWallIn"][];
            /** Removed Opening Ids */
            removed_opening_ids?: string[];
            /** Devices */
            devices?: components["schemas"]["ContourDeviceIn"][] | null;
            /** Removed Device Ids */
            removed_device_ids?: string[];
            /** Removed Wall Link Ids */
            removed_wall_link_ids?: string[];
            /** Acknowledged Cable Ids */
            acknowledged_cable_ids?: string[];
        };
        /**
         * RoomCreate
         * @description Neuer Raum auf einem Geschoss.
         *
         *     ``height_mm`` bleibt leer, wenn die Standardhoehe des Geschosses gilt.
         *
         *     ``walls`` ist optional (Phase 4a): Der grafische Editor legt einen
         *     gezeichneten Raum **samt** Kontur in einem Vorgang an. Ohne diese Angabe
         *     entstuende ein Raum ohne Waende, wenn die zweite Anfrage scheitert. Die
         *     Liste folgt denselben Regeln wie ``PUT /rooms/{id}/contour``; eine leere
         *     Liste ist der bisherige Fall "Raum zuerst, Waende spaeter".
         */
        RoomCreate: {
            /** Name */
            name: string;
            /** Room Number */
            room_number?: string | null;
            /** Height Mm */
            height_mm?: number | null;
            /** Room Type */
            room_type?: ("living_room" | "bedroom" | "children_room" | "kitchen" | "bathroom" | "hallway" | "office" | "utility_room" | "technical_room" | "basement" | "garage" | "other") | null;
            /** Walls */
            walls?: components["schemas"]["ContourWallIn"][];
        };
        /**
         * RoomOut
         * @description Ein Raum samt abgeleiteten Konturwerten.
         *
         *     Flaeche, Umfang, Wandzahl und Konturzustand sind **berechnet** und nicht
         *     gespeichert (ADR 0013). Sie fehlen (``null``), solange die Kontur nicht
         *     geschlossen ist.
         */
        RoomOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Floor Id
             * Format: uuid
             */
            floor_id: string;
            /** Name */
            name: string;
            /** Room Number */
            room_number: string | null;
            /** Height Mm */
            height_mm: number | null;
            /** Effective Height Mm */
            effective_height_mm: number;
            /** Room Type */
            room_type: ("living_room" | "bedroom" | "children_room" | "kitchen" | "bathroom" | "hallway" | "office" | "utility_room" | "technical_room" | "basement" | "garage" | "other") | null;
            /**
             * Contour Status
             * @enum {string}
             */
            contour_status: "draft" | "valid";
            /** Wall Count */
            wall_count: number;
            /** Area Mm2 */
            area_mm2: number | null;
            /** Area M2 */
            area_m2: string | null;
            /** Perimeter Mm */
            perimeter_mm: number | null;
            /** Version */
            version: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /**
         * RoomPlanOut
         * @description Raum im Planungsstand: gespeicherte Werte, berechnete Kontur, Waende.
         *
         *     ``contour_problems`` ist derselbe Befund wie im Pruefbericht
         *     ``GET /rooms/{id}/contour`` - hier gleich mitgeliefert, damit der Editor
         *     die betroffenen Waende markieren kann, ohne je Raum nachzufragen.
         */
        RoomPlanOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Floor Id
             * Format: uuid
             */
            floor_id: string;
            /** Name */
            name: string;
            /** Room Number */
            room_number: string | null;
            /** Height Mm */
            height_mm: number | null;
            /** Effective Height Mm */
            effective_height_mm: number;
            /** Room Type */
            room_type: ("living_room" | "bedroom" | "children_room" | "kitchen" | "bathroom" | "hallway" | "office" | "utility_room" | "technical_room" | "basement" | "garage" | "other") | null;
            /**
             * Contour Status
             * @enum {string}
             */
            contour_status: "draft" | "valid";
            /** Wall Count */
            wall_count: number;
            /** Area Mm2 */
            area_mm2: number | null;
            /** Area M2 */
            area_m2: string | null;
            /** Perimeter Mm */
            perimeter_mm: number | null;
            /** Version */
            version: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Walls */
            walls: components["schemas"]["WallPlanOut"][];
            /** Contour Problems */
            contour_problems: components["schemas"]["GeometryProblemOut"][];
            /** Devices */
            devices: components["schemas"]["DeviceOut"][];
        };
        /**
         * RoomUpdate
         * @description Teilaenderung eines Raums.
         *
         *     Das Geschoss steht nicht hier: Ein Raum wechselt nicht das Geschoss - das
         *     waere ein neuer Raum. ``room_number`` und ``height_mm`` sind ausdruecklich
         *     leerbar (``null``), weil beide optional sind.
         */
        RoomUpdate: {
            /** Name */
            name?: string | null;
            /** Room Number */
            room_number?: string | null;
            /** Height Mm */
            height_mm?: number | null;
            /** Room Type */
            room_type?: ("living_room" | "bedroom" | "children_room" | "kitchen" | "bathroom" | "hallway" | "office" | "utility_room" | "technical_room" | "basement" | "garage" | "other") | null;
            /** Acknowledged Cable Ids */
            acknowledged_cable_ids?: string[];
        };
        /** SwitchOrganizationRequest */
        SwitchOrganizationRequest: {
            /**
             * Organization Id
             * Format: uuid
             */
            organization_id: string;
        };
        /**
         * SystemRoleOut
         * @description Eine feste Systemrolle mit Einsatzzweck und Berechtigungen.
         */
        SystemRoleOut: {
            /** Key */
            key: string;
            /** Name */
            name: string;
            /** Description */
            description: string;
            /** Permissions */
            permissions: components["schemas"]["PermissionInfo"][];
        };
        /**
         * TokenResponse
         * @description Antwort des Webflows.
         *
         *     Enthaelt **keinen** Refresh Token: Der liegt ausschliesslich im
         *     HttpOnly-Cookie und ist fuer JavaScript nicht lesbar. Wuerde er zusaetzlich
         *     im JSON stehen, waere der HttpOnly-Schutz gegen XSS wirkungslos
         *     (docs/security.md, Abschnitt 3).
         *
         *     Die spaetere Baustellen-App erhaelt einen ausdruecklich getrennten mobilen
         *     Tokenflow mit sicherem Geraetespeicher - nicht dieses Schema.
         */
        TokenResponse: {
            /** Access Token */
            access_token: string;
            /**
             * Token Type
             * @default bearer
             */
            token_type: string;
            /** Expires In */
            expires_in: number;
            /**
             * Organization Id
             * Format: uuid
             */
            organization_id: string;
        };
        /**
         * UserReference
         * @description Bearbeiter eines Datensatzes, wie die Oberflaeche ihn zeigen darf.
         */
        UserReference: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "member" | "removed" | "unknown" | "system";
            /** User Id */
            user_id?: string | null;
            /** Display Name */
            display_name?: string | null;
        };
        /** ValidationError */
        ValidationError: {
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
            /** Input */
            input?: unknown;
            /** Context */
            ctx?: Record<string, never>;
        };
        /**
         * WallCreate
         * @description Neue Wand am Ende der Raumkontur.
         *
         *     ``sort_order`` wird **nicht** entgegengenommen: Eine neue Wand haengt sich
         *     hinten an, Umordnen ist ein eigener Vorgang. Damit kann eine Anfrage keine
         *     Luecke und keine Dublette in der Reihenfolge erzeugen.
         */
        WallCreate: {
            /** X1 Mm */
            x1_mm: number;
            /** Y1 Mm */
            y1_mm: number;
            /** X2 Mm */
            x2_mm: number;
            /** Y2 Mm */
            y2_mm: number;
            /**
             * Thickness Mm
             * @default 115
             */
            thickness_mm: number;
        };
        /**
         * WallLinkCandidateOut
         * @description Ein ungekoppeltes, exakt ueberlappendes Wandpaar verschiedener Raeume.
         *
         *     ``suggested``: eindeutig, Vorschlag ``shared`` - es wird **nichts**
         *     automatisch gekoppelt. ``decision-needed``: koppelbar, aber nur
         *     ausdruecklich (``reasons``). ``not-linkable``: mehrdeutig (drei oder mehr
         *     Waende auf einem Stueck).
         */
        WallLinkCandidateOut: {
            /**
             * Wall A Id
             * Format: uuid
             */
            wall_a_id: string;
            /**
             * Wall B Id
             * Format: uuid
             */
            wall_b_id: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "suggested" | "decision-needed" | "not-linkable";
            /** Reasons */
            reasons: ("ambiguous" | "thickness-differs" | "contour-open" | "openings-on-both-sides")[];
        };
        /**
         * WallLinkCreate
         * @description Neue Wandkopplung zweier Raumwaende verschiedener Raeume (ADR 0024).
         *
         *     Die Reihenfolge der beiden Waende ist beliebig; gespeichert wird kanonisch.
         *     ``separate`` wird nie vorgeschlagen - nur ausdruecklich angelegt.
         */
        WallLinkCreate: {
            /**
             * Wall A Id
             * Format: uuid
             */
            wall_a_id: string;
            /**
             * Wall B Id
             * Format: uuid
             */
            wall_b_id: string;
            /**
             * Relation
             * @enum {string}
             */
            relation: "shared" | "separate";
            /** Acknowledged Cable Ids */
            acknowledged_cable_ids?: string[];
        };
        /**
         * WallLinkOut
         * @description Eine gespeicherte Kopplung samt abgeleitetem Status.
         *
         *     ``status``: ``active`` (wirkt), ``ambiguous`` (auf einem Teil liegt eine
         *     dritte Wand - dort konservativ), ``broken`` (unterbrochen: kein gemeinsamer
         *     Abschnitt, wirkt nirgends; bleibt gespeichert und wirkt wieder, sobald die
         *     Geometrie passt). Lage und Laenge werden nie gespeichert.
         */
        WallLinkOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Wall A Id
             * Format: uuid
             */
            wall_a_id: string;
            /**
             * Wall B Id
             * Format: uuid
             */
            wall_b_id: string;
            /**
             * Relation
             * @enum {string}
             */
            relation: "shared" | "separate";
            /**
             * Origin
             * @enum {string}
             */
            origin: "user" | "backfill";
            /**
             * Status
             * @enum {string}
             */
            status: "active" | "ambiguous" | "broken";
            /** Thickness Conflict */
            thickness_conflict: boolean;
            /** Version */
            version: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /**
         * WallLinkOverviewOut
         * @description Kopplungen und Kandidaten eines Geschosses.
         */
        WallLinkOverviewOut: {
            /**
             * Floor Id
             * Format: uuid
             */
            floor_id: string;
            /** Links */
            links: components["schemas"]["WallLinkOut"][];
            /** Candidates */
            candidates: components["schemas"]["WallLinkCandidateOut"][];
        };
        /**
         * WallLinkUpdate
         * @description Entscheidung einer Kopplung aendern (``If-Match`` der Kopplungsversion).
         */
        WallLinkUpdate: {
            /**
             * Relation
             * @enum {string}
             */
            relation: "shared" | "separate";
            /** Acknowledged Cable Ids */
            acknowledged_cable_ids?: string[];
        };
        /**
         * WallOrder
         * @description Neue Reihenfolge der Waende eines Raums.
         *
         *     Die Liste muss **alle** Waende des Raums genau einmal enthalten. Eine
         *     Teilliste waere mehrdeutig: Sie liesse offen, wohin die uebrigen Waende
         *     gehoeren.
         */
        WallOrder: {
            /** Wall Ids */
            wall_ids: string[];
        };
        /**
         * WallOut
         * @description Eine Wand samt ihrer gerundeten Laenge.
         */
        WallOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Room Id
             * Format: uuid
             */
            room_id: string;
            /** Sort Order */
            sort_order: number;
            /** X1 Mm */
            x1_mm: number;
            /** Y1 Mm */
            y1_mm: number;
            /** X2 Mm */
            x2_mm: number;
            /** Y2 Mm */
            y2_mm: number;
            /** Thickness Mm */
            thickness_mm: number;
            /** Length Mm */
            length_mm: number;
            /** Opening Count */
            opening_count: number;
            /** Version */
            version: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /**
         * WallPlanOut
         * @description Wand im Planungsstand - mit ihren Oeffnungen, vom Wandanfang aus.
         */
        WallPlanOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Room Id
             * Format: uuid
             */
            room_id: string;
            /** Sort Order */
            sort_order: number;
            /** X1 Mm */
            x1_mm: number;
            /** Y1 Mm */
            y1_mm: number;
            /** X2 Mm */
            x2_mm: number;
            /** Y2 Mm */
            y2_mm: number;
            /** Thickness Mm */
            thickness_mm: number;
            /** Length Mm */
            length_mm: number;
            /** Opening Count */
            opening_count: number;
            /** Version */
            version: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Openings */
            openings: components["schemas"]["OpeningOut"][];
        };
        /**
         * WallUpdate
         * @description Teilaenderung einer Wand. Der Raum bleibt unveraendert.
         */
        WallUpdate: {
            /** X1 Mm */
            x1_mm?: number | null;
            /** Y1 Mm */
            y1_mm?: number | null;
            /** X2 Mm */
            x2_mm?: number | null;
            /** Y2 Mm */
            y2_mm?: number | null;
            /** Thickness Mm */
            thickness_mm?: number | null;
        };
        /**
         * WallWaypointIn
         * @description Punkt auf der Achse einer Raumwand: Abstand ab Wandanfang, Hoehe ueber FFB.
         */
        WallWaypointIn: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "wall";
            /**
             * Wall Id
             * Format: uuid
             */
            wall_id: string;
            /** Offset Mm */
            offset_mm: number;
            /** Height Mm */
            height_mm: number;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenResponse"];
                };
            };
            /** @description Nicht angemeldet */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Zu viele Versuche */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    refreshSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenResponse"];
                };
            };
            /** @description Nicht angemeldet */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Zu viele Versuche */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    switchOrganization: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SwitchOrganizationRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenResponse"];
                };
            };
            /** @description Nicht angemeldet */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Zu viele Versuche */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    getCurrentUser: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MeResponse"];
                };
            };
        };
    };
    listMyOrganizations: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrganizationSummary"][];
                };
            };
        };
    };
    listModules: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModuleInfo"][];
                };
            };
        };
    };
    listMyModules: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActiveModuleInfo"][];
                };
            };
        };
    };
    listAuditEntries: {
        parameters: {
            query?: {
                action?: string | null;
                entity_type?: string | null;
                limit?: number;
                cursor?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_AuditEntryOut_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    listCustomers: {
        parameters: {
            query?: {
                /** @description Name, Nummer oder Ort */
                q?: string | null;
                kind?: ("private" | "company") | null;
                sort?: "created_at" | "name";
                /** @description Seite, beginnend bei 1 */
                page?: number;
                page_size?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NumberedPage_CustomerOut_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    createCustomer: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CustomerCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    getCustomer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                customer_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    deleteCustomer: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                customer_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Berechtigung fehlt */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt oder dem Kunden sind Projekte zugeordnet */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    updateCustomer: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                customer_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CustomerUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    listProjects: {
        parameters: {
            query?: {
                /** @description Bezeichnung, Projektnummer oder Baustellenort */
                q?: string | null;
                status?: ("draft" | "active" | "completed" | "archived") | null;
                /** @description current = draft + active, closed = completed + archived. Schliesst sich mit status aus. */
                status_group?: ("current" | "closed") | null;
                customer_id?: string | null;
                sort?: "created_at" | "name" | "updated_at";
                /** @description Seite, beginnend bei 1 */
                page?: number;
                page_size?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NumberedPage_ProjectSummary_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    createProject: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProjectCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectOut"];
                };
            };
            /** @description Kunde nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    getProject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    deleteProject: {
        parameters: {
            query?: {
                /** @description Pflicht, wenn das Projekt Inhalte hat: die Projektnummer als ausdrueckliche Bestaetigung des Verlusts. */
                confirm_project_number?: string | null;
            };
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Berechtigung fehlt */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, Projekt abgeschlossen oder archiviert, oder Bestaetigung der Projektnummer fehlt */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Ein Teilnehmer ist gescheitert */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    updateProject: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProjectUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, unzulaessiger Statuswechsel, archiviertes oder abgeschlossenes Projekt */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    checkProjectDeletion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectDeletionCheck"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    activateProject: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, unzulaessiger Statuswechsel, archiviertes oder abgeschlossenes Projekt */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    completeProject: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, unzulaessiger Statuswechsel, archiviertes oder abgeschlossenes Projekt */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    archiveProject: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, unzulaessiger Statuswechsel, archiviertes oder abgeschlossenes Projekt */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    reopenProject: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectOut"];
                };
            };
            /** @description Berechtigung fehlt */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, unzulaessiger Statuswechsel, archiviertes oder abgeschlossenes Projekt */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    listBuildings: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BuildingOut"][];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    createBuilding: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BuildingCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BuildingOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Projekt ist archiviert oder abgeschlossen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    deleteBuilding: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                building_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, unzulaessiger Statuswechsel, archiviertes oder abgeschlossenes Projekt */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    updateBuilding: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                building_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BuildingUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BuildingOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, unzulaessiger Statuswechsel, archiviertes oder abgeschlossenes Projekt */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    listFloors: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                building_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FloorOut"][];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    createFloor: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                building_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FloorCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FloorOut"];
                };
            };
            /** @description Gebaeude nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Projekt ist archiviert oder abgeschlossen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Ebene bereits belegt */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    deleteFloor: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                floor_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, unzulaessiger Statuswechsel, archiviertes oder abgeschlossenes Projekt */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    updateFloor: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                floor_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FloorUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FloorOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, unzulaessiger Statuswechsel, archiviertes oder abgeschlossenes Projekt */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    uploadFile: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    /** Upload */
                    upload: string;
                    /** Project Id */
                    project_id?: string | null;
                    /** Entity Type */
                    entity_type?: string | null;
                    /** Entity Id */
                    entity_id?: string | null;
                };
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileOut"];
                };
            };
            /** @description Projekt nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Projekt ist archiviert oder abgeschlossen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Anfrage groesser als erlaubt */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Dateityp, Inhalt oder Groesse unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Zu viele Uploads */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    listProjectFiles: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileOut"][];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    getFile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                file_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    getFileDownloadUrl: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                file_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileDownloadUrl"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    downloadFile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                file_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            307: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    listSystemRoles: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemRoleOut"][];
                };
            };
        };
    };
    listMembers: {
        parameters: {
            query?: {
                /** @description Name oder E-Mail */
                q?: string | null;
                status?: ("active" | "disabled" | "invited" | "removed") | null;
                limit?: number;
                cursor?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_DirectoryEntryOut_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    getMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                member_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    updateMemberProfile: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                member_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemberProfileUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberOut"];
                };
            };
            /** @description Nicht gefunden (auch fremder Betrieb) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, letzter Administrator (last-administrator), eigenes Konto (self-lockout), entferntes Konto (member-removed), Konto eines weiteren Betriebs (account-shared) oder E-Mail-Adresse vergeben (email-unavailable) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Ungueltige Eingabe oder Bestaetigung */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    suspendMember: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                member_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemberSuspend"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, letzter Administrator (last-administrator), eigene Mitgliedschaft (self-lockout) oder unzulaessiger Zustand */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Unbekannte oder nicht vergebbare Rolle */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    reactivateMember: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                member_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, letzter Administrator (last-administrator), eigene Mitgliedschaft (self-lockout) oder unzulaessiger Zustand */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Unbekannte oder nicht vergebbare Rolle */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    issueMemberPasswordReset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                member_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PasswordResetIssued"];
                };
            };
            /** @description Nicht gefunden (auch fremder Betrieb) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, letzter Administrator (last-administrator), eigenes Konto (self-lockout), entferntes Konto (member-removed), Konto eines weiteren Betriebs (account-shared) oder E-Mail-Adresse vergeben (email-unavailable) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Ungueltige Eingabe oder Bestaetigung */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Zu viele Links in kurzer Zeit */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Kein Zustellweg eingerichtet */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    removeMember: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                member_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemberRemove"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberOut"];
                };
            };
            /** @description Nicht gefunden (auch fremder Betrieb) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, letzter Administrator (last-administrator), eigenes Konto (self-lockout), entferntes Konto (member-removed), Konto eines weiteren Betriebs (account-shared) oder E-Mail-Adresse vergeben (email-unavailable) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Ungueltige Eingabe oder Bestaetigung */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    getMemberPermissions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                member_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberPermissionsOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    replaceMemberRoles: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                member_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemberRolesUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, letzter Administrator (last-administrator), eigene Mitgliedschaft (self-lockout) oder unzulaessiger Zustand */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Unbekannte oder nicht vergebbare Rolle */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    getInvitationPolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvitationPolicy"];
                };
            };
        };
    };
    createInvitation: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InvitationCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvitationIssued"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, letzter Administrator (last-administrator), eigene Mitgliedschaft (self-lockout) oder unzulaessiger Zustand */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Unbekannte oder nicht vergebbare Rolle */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Kein Zustellweg eingerichtet */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    getInvitation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                invitation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvitationOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    revokeInvitation: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                invitation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvitationOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, letzter Administrator (last-administrator), eigene Mitgliedschaft (self-lockout) oder unzulaessiger Zustand */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Unbekannte oder nicht vergebbare Rolle */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    reissueInvitation: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                invitation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvitationIssued"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, letzter Administrator (last-administrator), eigene Mitgliedschaft (self-lockout) oder unzulaessiger Zustand */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Unbekannte oder nicht vergebbare Rolle */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Kein Zustellweg eingerichtet */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    previewInvitation: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InvitationTokenIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvitationPreview"];
                };
            };
            /** @description Einladung ungueltig (invitation-invalid) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Zu viele Versuche */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    acceptInvitationWithNewAccount: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AcceptWithNewAccount"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvitationAccepted"];
                };
            };
            /** @description Einladung ungueltig (invitation-invalid) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Konto existiert bereits (invitation-requires-login) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Passwortregeln nicht erfuellt */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Zu viele Versuche */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    acceptInvitationWithExistingAccount: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AcceptWithExistingAccount"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvitationAccepted"];
                };
            };
            /** @description Anmeldedaten falsch */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Einladung ungueltig (invitation-invalid) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Bereits Mitglied */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Zu viele Versuche */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    previewPasswordReset: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PasswordResetTokenIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PasswordResetPreview"];
                };
            };
            /** @description Link ungueltig (password-reset-invalid) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Zu viele Versuche */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    completePasswordReset: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PasswordResetComplete"];
            };
        };
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Link ungueltig (password-reset-invalid) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Passwortregeln nicht erfuellt */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Zu viele Versuche */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    getMyPreferences: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreferencesOut"];
                };
            };
        };
    };
    replaceMyPreferences: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreferencesIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreferencesOut"];
                };
            };
            /** @description Noch kein Serverstand */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt (anderes Geraet) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Unbekannter Wert */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    createMyPreferences: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreferencesIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreferencesOut"];
                };
            };
            /** @description Es gibt bereits einen Serverstand (preferences-exist) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Unbekannter Wert */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    listElectricalRooms: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                floor_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoomOut"][];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    createElectricalRoom: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                floor_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RoomCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoomOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Projekt ist archiviert oder abgeschlossen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    getElectricalRoom: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                room_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoomOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    deleteElectricalRoom: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                room_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, archiviertes oder abgeschlossenes Projekt oder Wand mit Oeffnungen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    updateElectricalRoom: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                room_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RoomUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoomOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, archiviertes oder abgeschlossenes Projekt oder Wand mit Oeffnungen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    getElectricalRoomContour: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                room_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoomContourOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    replaceElectricalRoomContour: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                room_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RoomContourUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoomPlanOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, archiviertes oder abgeschlossenes Projekt oder Wand mit Oeffnungen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    getElectricalFloorPlan: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                floor_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FloorPlanOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    listElectricalDeviceTypes: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeviceTypeOut"][];
                };
            };
        };
    };
    listElectricalWalls: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                room_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WallOut"][];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    createElectricalWall: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                room_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WallCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WallOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Projekt ist archiviert oder abgeschlossen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    deleteElectricalWall: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                wall_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, archiviertes oder abgeschlossenes Projekt oder Wand mit Oeffnungen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    updateElectricalWall: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                wall_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WallUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WallOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, archiviertes oder abgeschlossenes Projekt oder Wand mit Oeffnungen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    reorderElectricalWalls: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                room_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WallOrder"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WallOut"][];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, archiviertes oder abgeschlossenes Projekt oder Wand mit Oeffnungen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    listElectricalOpenings: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wall_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OpeningOut"][];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    createElectricalOpening: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wall_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OpeningCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OpeningOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Projekt ist archiviert oder abgeschlossen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    deleteElectricalOpening: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                opening_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, archiviertes oder abgeschlossenes Projekt oder Wand mit Oeffnungen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    updateElectricalOpening: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                opening_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OpeningUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OpeningOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, archiviertes oder abgeschlossenes Projekt oder Wand mit Oeffnungen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    listElectricalWallLinks: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                floor_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WallLinkOverviewOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    createElectricalWallLink: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                floor_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WallLinkCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WallLinkOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Projekt schreibgeschuetzt oder Zuordnung besteht bereits */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    deleteElectricalWallLink: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                link_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, archiviertes oder abgeschlossenes Projekt oder Wand mit Oeffnungen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    updateElectricalWallLink: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                link_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WallLinkUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WallLinkOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, archiviertes oder abgeschlossenes Projekt oder Wand mit Oeffnungen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    listElectricalRisers: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                building_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RiserListOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    createElectricalRiser: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                building_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RiserCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RiserOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Projekt ist archiviert oder abgeschlossen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    replaceElectricalRiser: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                riser_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RiserUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RiserOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, archiviertes oder abgeschlossenes Projekt oder Wand mit Oeffnungen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    deleteElectricalRiser: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                riser_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, archiviertes oder abgeschlossenes Projekt oder Wand mit Oeffnungen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    listElectricalDistributionBoards: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                building_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DistributionBoardListOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    createElectricalDistributionBoard: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                building_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DistributionBoardCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DistributionBoardOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Projekt schreibgeschuetzt oder Geraet platziert schon eine Verteilung */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    deleteElectricalDistributionBoard: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                board_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, archiviertes oder abgeschlossenes Projekt oder Wand mit Oeffnungen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    updateElectricalDistributionBoard: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                board_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DistributionBoardUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DistributionBoardOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, archiviertes oder abgeschlossenes Projekt oder Wand mit Oeffnungen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    placeElectricalDistributionBoard: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                board_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BoardPlacementUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BoardPlacementOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Projekt schreibgeschuetzt, Verteilung oder Raum inzwischen geaendert, oder Umsetzen an eine andere Wand mit Leitungen am Lagegeraet */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    listElectricalCircuits: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                building_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CircuitListOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    createElectricalCircuit: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                board_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CircuitCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CircuitOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Projekt ist archiviert oder abgeschlossen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    deleteElectricalCircuit: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                circuit_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, archiviertes oder abgeschlossenes Projekt oder Wand mit Oeffnungen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    updateElectricalCircuit: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                circuit_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CircuitUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CircuitOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, archiviertes oder abgeschlossenes Projekt oder Wand mit Oeffnungen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    replaceElectricalCircuitDevices: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                circuit_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CircuitDevicesUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CircuitOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, archiviertes oder abgeschlossenes Projekt oder Wand mit Oeffnungen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    listElectricalCables: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                building_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CableListOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    getElectricalCablingSummary: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                building_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CablingSummaryOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    createElectricalCable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                circuit_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CableIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CableOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Projekt ist archiviert oder abgeschlossen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    replaceElectricalCable: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                cable_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CableIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CableOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, Projekt schreibgeschuetzt, Bezug in Gebrauch oder Leitung wuerde unterbrochen (cables-would-break) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    deleteElectricalCable: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                cable_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, archiviertes oder abgeschlossenes Projekt oder Wand mit Oeffnungen */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    applyElectricalCircuitProposal: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                cable_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApplyProposalIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CableOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, Projekt schreibgeschuetzt, Bezug in Gebrauch oder Leitung wuerde unterbrochen (cables-would-break) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    listElectricalPenetrations: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                floor_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PenetrationListOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    deleteElectricalPenetration: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                penetration_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, Projekt schreibgeschuetzt, Bezug in Gebrauch oder Leitung wuerde unterbrochen (cables-would-break) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    updateElectricalPenetration: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                penetration_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PenetrationUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PenetrationOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, Projekt schreibgeschuetzt, Bezug in Gebrauch oder Leitung wuerde unterbrochen (cables-would-break) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geometrie oder Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    listElectricalCableTemplates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CableTemplateListOut"];
                };
            };
        };
    };
    createElectricalCableTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CableTemplateCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CableTemplateOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, Vorlage in Gebrauch oder Projekt schreibgeschuetzt */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    deleteElectricalCableTemplate: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                template_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, Vorlage in Gebrauch oder Projekt schreibgeschuetzt */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    updateElectricalCableTemplate: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                template_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CableTemplateUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CableTemplateOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, Vorlage in Gebrauch oder Projekt schreibgeschuetzt */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description If-Match fehlt */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    getElectricalPlanningDefaults: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlanningDefaultsOut"];
                };
            };
        };
    };
    replaceElectricalPlanningDefaults: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlanningDefaultsIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlanningDefaultsOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, Vorlage in Gebrauch oder Projekt schreibgeschuetzt */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    getElectricalProjectPlanningDefaults: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectPlanningDefaultsOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    replaceElectricalProjectPlanningDefaults: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProjectPlanningDefaultsIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectPlanningDefaultsOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Versionskonflikt, Vorlage in Gebrauch oder Projekt schreibgeschuetzt */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Eingabe unzulaessig */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    getElectricalEffectivePlanningDefaults: {
        parameters: {
            query?: {
                circuit_id?: string | null;
                start_device_id?: string | null;
                end_device_id?: string | null;
            };
            header?: never;
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EffectivePlanningDefaultsOut"];
                };
            };
            /** @description Nicht gefunden */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
            /** @description Geraet nicht im Gebaeude des Stromkreises */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetail"];
                };
            };
        };
    };
    healthLive: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthStatus"];
                };
            };
        };
    };
    healthReady: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthStatus"];
                };
            };
        };
    };
}
