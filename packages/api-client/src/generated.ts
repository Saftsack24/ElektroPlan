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
         *     Ein archiviertes Projekt ist schreibgeschuetzt und liefert ``409``.
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
         *     muss der eigenen Organisation gehoeren und darf nicht archiviert sein.
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
         *     ``status=invited`` zeigt nur offene (auch abgelaufene) Einladungen.
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
        patch?: never;
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
         *     unberuehrt. Offene Sitzungen in diesem Betrieb enden sofort.
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
         */
        post: operations["reactivateMember"];
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
         *     ``removed_opening_ids`` stehen. Jeder Fehler laesst den Raum
         *     unveraendert; bei Erfolg entsteht genau ein ``electrical.plan.updated``
         *     (``walls_changed``).
         *
         *     Der ``GET`` auf derselben Adresse liefert den Pruefbericht dieser Kontur.
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
        /** Body_uploadFile */
        Body_uploadFile: {
            /** Upload */
            upload: string;
            /** Project Id */
            project_id?: string | null;
            /** Entity Type */
            entity_type?: string | null;
            /** Entity Id */
            entity_id?: string | null;
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
         * DirectoryEntryOut
         * @description Eintrag der Benutzerliste: Mitgliedschaft **oder** offene Einladung.
         *
         *     ``kind`` unterscheidet beides. ``id`` ist je nach Art die ID der
         *     Mitgliedschaft oder der Einladung.
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
            email: string;
            /**
             * Status
             * @enum {string}
             */
            status: "active" | "disabled" | "invited";
            /** Roles */
            roles: components["schemas"]["RoleRef"][];
            /** Last Login At */
            last_login_at: string | null;
            /** Invitation Expires At */
            invitation_expires_at: string | null;
            /** Invitation Expired */
            invitation_expired: boolean;
            /** Version */
            version: number;
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
         *     an denen es haengt.
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
        };
        /** FloorUpdate */
        FloorUpdate: {
            /** Name */
            name?: string | null;
            /** Level */
            level?: number | null;
            /** Elevation Mm */
            elevation_mm?: number | null;
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
         *     Enthaelt vom globalen Konto nur Name und E-Mail - beide sind hier nicht
         *     aenderbar (ADR 0015).
         */
        MemberOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Full Name */
            full_name: string;
            /** Email */
            email: string;
            /**
             * Status
             * @enum {string}
             */
            status: "active" | "disabled";
            /** Roles */
            roles: components["schemas"]["RoleRef"][];
            /** Is Administrator */
            is_administrator: boolean;
            /** Is Self */
            is_self: boolean;
            /**
             * Joined At
             * Format: date-time
             */
            joined_at: string;
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
         * MemberRolesUpdate
         * @description Vollstaendige Liste der Systemrollen - ersetzt die bisherigen als Ganzes.
         */
        MemberRolesUpdate: {
            /** Role Keys */
            role_keys: string[];
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
         * @description Vollstaendiger Zielzustand der Raumgeometrie (``PUT /rooms/{id}/contour``).
         *
         *     Ein Vorgang, eine Transaktion: Entweder gilt danach genau diese Kontur,
         *     oder es hat sich nichts geaendert. Waende, die in ``walls`` fehlen, werden
         *     entfernt. Oeffnungen verschwinden dagegen **nie** stillschweigend: Eine
         *     vorhandene Oeffnung muss entweder in ``walls`` stehen oder ausdruecklich
         *     in ``removed_opening_ids``. Sonst lehnt der Server ab.
         */
        RoomContourUpdate: {
            /** Walls */
            walls: components["schemas"]["ContourWallIn"][];
            /** Removed Opening Ids */
            removed_opening_ids?: string[];
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
            kind: "member" | "unknown" | "system";
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
            /** @description Versionskonflikt, unzulaessiger Statuswechsel oder archiviertes Projekt */
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
            /** @description Versionskonflikt, unzulaessiger Statuswechsel oder archiviertes Projekt */
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
            /** @description Versionskonflikt, unzulaessiger Statuswechsel oder archiviertes Projekt */
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
            /** @description Versionskonflikt, unzulaessiger Statuswechsel oder archiviertes Projekt */
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
            /** @description Versionskonflikt, unzulaessiger Statuswechsel oder archiviertes Projekt */
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
            /** @description Projekt ist archiviert */
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
            /** @description Versionskonflikt, unzulaessiger Statuswechsel oder archiviertes Projekt */
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
            /** @description Versionskonflikt, unzulaessiger Statuswechsel oder archiviertes Projekt */
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
            /** @description Projekt ist archiviert */
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
            /** @description Versionskonflikt, unzulaessiger Statuswechsel oder archiviertes Projekt */
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
            /** @description Versionskonflikt, unzulaessiger Statuswechsel oder archiviertes Projekt */
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
                "multipart/form-data": components["schemas"]["Body_uploadFile"];
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
            /** @description Projekt ist archiviert */
            409: {
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
                status?: ("active" | "disabled" | "invited") | null;
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
            /** @description Projekt ist archiviert */
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
            /** @description Versionskonflikt, archiviertes Projekt oder Wand mit Oeffnungen */
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
            /** @description Versionskonflikt, archiviertes Projekt oder Wand mit Oeffnungen */
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
            /** @description Versionskonflikt, archiviertes Projekt oder Wand mit Oeffnungen */
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
            /** @description Projekt ist archiviert */
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
            /** @description Versionskonflikt, archiviertes Projekt oder Wand mit Oeffnungen */
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
            /** @description Versionskonflikt, archiviertes Projekt oder Wand mit Oeffnungen */
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
            /** @description Versionskonflikt, archiviertes Projekt oder Wand mit Oeffnungen */
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
            /** @description Projekt ist archiviert */
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
            /** @description Versionskonflikt, archiviertes Projekt oder Wand mit Oeffnungen */
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
            /** @description Versionskonflikt, archiviertes Projekt oder Wand mit Oeffnungen */
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
