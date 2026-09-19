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
         * @description Kunden der eigenen Organisation - gefiltert, sortiert, seitenweise.
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
         * Kunde ausblenden
         * @description Blendet den Kunden aus (Soft Delete).
         *
         *     Solange nicht geloeschte Projekte an ihm haengen, wird abgelehnt: Ein
         *     Projekt ohne auffindbaren Kunden waere ein unvollstaendiger Datensatz.
         *
         *     **Sperre, Pruefung und Aenderung liegen in einer Transaktion.** Die
         *     Kundenzeile wird zuerst mit ``SELECT ... FOR UPDATE`` geladen; erst danach
         *     werden die Projekte gezaehlt. Eine gleichzeitige Projektanlage sperrt
         *     dieselbe Zeile und wartet deshalb - ein sichtbares Projekt an einem
         *     ausgeblendeten Kunden kann nicht entstehen (docs/database.md, Abschnitt
         *     "Sperrreihenfolge").
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
    "/api/v1/customers/{customer_id}/anonymize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Kundendaten anonymisieren
         * @description Setzt ein Loeschbegehren um (Art. 17 DSGVO).
         *
         *     Die personenbezogenen Felder werden ueberschrieben; Kundennummer und
         *     Belegzuordnung bleiben erhalten, damit aufbewahrungspflichtige Dokumente
         *     nach HGB/AO zuordenbar bleiben. **Der Vorgang ist nicht umkehrbar.**
         */
        post: operations["anonymizeCustomer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
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
         * @description Projekte der eigenen Organisation - gefiltert, sortiert, seitenweise.
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
         * Projekt ausblenden
         * @description Blendet das Projekt aus (Soft Delete). Gebaeude und Dateien bleiben.
         */
        delete: operations["deleteProject"];
        options?: never;
        head?: never;
        /**
         * Projekt bearbeiten
         * @description Aendert Stammdaten. Status und Projektnummer bleiben unberuehrt.
         */
        patch: operations["updateProject"];
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
         *     muss der eigenen Organisation gehoeren.
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
            /** Anonymized At */
            anonymized_at: string | null;
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
        /** Page[CustomerOut] */
        Page_CustomerOut_: {
            /** Items */
            items: components["schemas"]["CustomerOut"][];
            /** Next Cursor */
            next_cursor?: string | null;
            /**
             * Has More
             * @default false
             */
            has_more: boolean;
        };
        /** Page[ProjectSummary] */
        Page_ProjectSummary_: {
            /** Items */
            items: components["schemas"]["ProjectSummary"][];
            /** Next Cursor */
            next_cursor?: string | null;
            /**
             * Has More
             * @default false
             */
            has_more: boolean;
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
        /** RoleSummary */
        RoleSummary: {
            /** Key */
            key: string;
            /** Name */
            name: string;
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
                    "application/json": components["schemas"]["Page_CustomerOut_"];
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
    anonymizeCustomer: {
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
                /** @description Name, Nummer, Ort, Kunde */
                q?: string | null;
                status?: ("draft" | "active" | "completed" | "archived") | null;
                customer_id?: string | null;
                sort?: "created_at" | "name";
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
                    "application/json": components["schemas"]["Page_ProjectSummary_"];
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
            /** @description Versions- oder Statuskonflikt */
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
            /** @description Versions- oder Statuskonflikt */
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
            /** @description Versions- oder Statuskonflikt */
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
            /** @description Versions- oder Statuskonflikt */
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
            /** @description Versions- oder Statuskonflikt */
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
            /** @description Projekt nicht gefunden */
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
            /** @description Versions- oder Statuskonflikt */
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
            /** @description Versions- oder Statuskonflikt */
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
            /** @description Versions- oder Statuskonflikt */
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
            /** @description Versions- oder Statuskonflikt */
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
