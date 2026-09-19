/**
 * Typisierter Zugriff auf die ElektroPlan-API.
 *
 * Pfade, Methoden, Pfadparameter, Query, Request Body und Response werden aus
 * dem generierten OpenAPI-Schema abgeleitet (ADR 0009). Ein Aufrufer kann
 * daher keine falsche Response-Struktur mehr behaupten - TypeScript kennt sie.
 *
 * Bewusst eine kleine Huelle statt eines zusaetzlichen Frameworks: Sie deckt
 * genau das ab, was diese API braucht.
 */
import type { components, paths } from "./generated";

export type { components, paths };

export type Schemas = components["schemas"];
export type MeResponse = Schemas["MeResponse"];
export type TokenResponse = Schemas["TokenResponse"];
export type OrganizationSummary = Schemas["OrganizationSummary"];
export type ActiveModuleInfo = Schemas["ActiveModuleInfo"];
export type ModuleInfo = Schemas["ModuleInfo"];
export type AuditEntryOut = Schemas["AuditEntryOut"];
export type FileOut = Schemas["FileOut"];
export type FileDownloadUrl = Schemas["FileDownloadUrl"];
export type CustomerOut = Schemas["CustomerOut"];
export type CustomerCreate = Schemas["CustomerCreate"];
export type CustomerUpdate = Schemas["CustomerUpdate"];
export type ProjectOut = Schemas["ProjectOut"];
export type ProjectSummary = Schemas["ProjectSummary"];
export type ProjectCreate = Schemas["ProjectCreate"];
export type ProjectUpdate = Schemas["ProjectUpdate"];
export type BuildingOut = Schemas["BuildingOut"];
export type FloorOut = Schemas["FloorOut"];
export type ProblemDetail = Schemas["ProblemDetail"];

/** Fehlerantwort des Servers im Format RFC 9457. */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetail | null;
  readonly requestId: string | null;

  constructor(status: number, problem: ProblemDetail | null, requestId: string | null) {
    super(problem?.title ?? `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
    this.requestId = requestId;
  }

  /** Stabiler, maschinenlesbarer Fehlerschluessel (z. B. "not-found"). */
  get errorType(): string {
    const type = this.problem?.type;
    return type ? (type.split("/").pop() ?? "unknown") : "unknown";
  }

  /** Text fuer die Oberflaeche - bewusst ohne technische Details. */
  get userMessage(): string {
    return this.problem?.detail ?? this.problem?.title ?? "Es ist ein Fehler aufgetreten.";
  }
}

// --------------------------------------------------------------- Typableitung

type HttpMethod = "get" | "post" | "patch" | "delete";

/** Alle Pfade, die diese Methode anbieten. */
export type PathsWithMethod<M extends HttpMethod> = {
  [P in keyof paths]: paths[P] extends { [K in M]: unknown } ? P : never;
}[keyof paths];

type Operation<P extends keyof paths, M extends HttpMethod> = paths[P] extends {
  [K in M]: infer O;
}
  ? O
  : never;

/** Erfolgskoerper (200/201). Ohne JSON-Antwort: void. */
type SuccessResponse<O> = O extends {
  responses: { 200: { content: { "application/json": infer T } } };
}
  ? T
  : O extends { responses: { 201: { content: { "application/json": infer T } } } }
    ? T
    : void;

type RequestBodyOf<O> = O extends {
  requestBody: { content: { "application/json": infer B } };
}
  ? B
  : undefined;

type QueryOf<O> = O extends { parameters: { query?: infer Q } } ? Q : undefined;
type PathParamsOf<O> = O extends { parameters: { path: infer P } } ? P : undefined;

type RequiredKeys<T> = T extends undefined
  ? never
  : { [K in keyof T]-?: undefined extends T[K] ? never : K }[keyof T];

/** Optionen einer Anfrage - vollstaendig aus der Operation abgeleitet. */
export type RequestOptions<O> = {
  signal?: AbortSignal;
  /**
   * Version der zuvor gelesenen Entitaet. Wird als `If-Match` gesendet
   * (docs/api.md, Abschnitt 5). Aendernde Endpunkte auf versionierten
   * Entitaeten verlangen den Header; ohne ihn antwortet der Server mit 428.
   */
  ifMatch?: number | string;
} & (PathParamsOf<O> extends undefined ? { path?: never } : { path: PathParamsOf<O> }) &
  (QueryOf<O> extends undefined
    ? { query?: never }
    : RequiredKeys<QueryOf<O>> extends never
      ? { query?: QueryOf<O> }
      : { query: QueryOf<O> }) &
  (RequestBodyOf<O> extends undefined ? { body?: never } : { body: RequestBodyOf<O> });

// ------------------------------------------------------------------- Client

export interface ApiClientOptions {
  baseUrl: string;
  /** Liefert den aktuellen Access Token oder null. */
  getAccessToken: () => string | null;
  /**
   * Wird bei 401 genau einmal aufgerufen. Liefert true, wenn die Sitzung
   * erneuert wurde und die Anfrage wiederholt werden soll. Die Implementierung
   * muss Single-Flight sicherstellen.
   */
  onUnauthorized?: () => Promise<boolean>;
}

type QueryValue = string | number | boolean | null | undefined;

function buildPath(template: string, params: Record<string, unknown> | undefined): string {
  if (!params) return template;
  return template.replace(/{([^}]+)}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined || value === null) {
      throw new Error(`Pfadparameter "${name}" fehlt fuer ${template}`);
    }
    return encodeURIComponent(String(value));
  });
}

function buildUrl(
  baseUrl: string,
  path: string,
  query: Record<string, QueryValue> | undefined,
): string {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export interface ApiClient {
  get<P extends PathsWithMethod<"get">>(
    path: P,
    ...options: RequestOptions<Operation<P, "get">> extends { path: unknown } | { body: unknown }
      ? [RequestOptions<Operation<P, "get">>]
      : [RequestOptions<Operation<P, "get">>?]
  ): Promise<SuccessResponse<Operation<P, "get">>>;

  post<P extends PathsWithMethod<"post">>(
    path: P,
    ...options: RequestOptions<Operation<P, "post">> extends { path: unknown } | { body: unknown }
      ? [RequestOptions<Operation<P, "post">>]
      : [RequestOptions<Operation<P, "post">>?]
  ): Promise<SuccessResponse<Operation<P, "post">>>;

  patch<P extends PathsWithMethod<"patch">>(
    path: P,
    options: RequestOptions<Operation<P, "patch">>,
  ): Promise<SuccessResponse<Operation<P, "patch">>>;

  delete<P extends PathsWithMethod<"delete">>(
    path: P,
    options: RequestOptions<Operation<P, "delete">>,
  ): Promise<SuccessResponse<Operation<P, "delete">>>;

  /**
   * Multipart-Upload. Der Browser setzt `Content-Type` samt Boundary selbst -
   * deshalb ein eigener Weg statt `post` mit JSON-Koerper.
   */
  upload<P extends PathsWithMethod<"post">>(
    path: P,
    form: FormData,
    options?: { signal?: AbortSignal },
  ): Promise<SuccessResponse<Operation<P, "post">>>;
}

interface RawOptions {
  path?: Record<string, unknown>;
  query?: Record<string, QueryValue>;
  body?: unknown;
  form?: FormData;
  ifMatch?: number | string;
  signal?: AbortSignal;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  async function send(
    method: HttpMethod,
    template: string,
    raw: RawOptions | undefined,
    allowRetry: boolean,
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = options.getAccessToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (raw?.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (raw?.ifMatch !== undefined) {
      headers["If-Match"] = String(raw.ifMatch);
    }

    const init: RequestInit = {
      method: method.toUpperCase(),
      headers,
      // Refresh-Cookie mitschicken (HttpOnly, SameSite=Strict).
      credentials: "include",
    };
    if (raw?.form !== undefined) {
      // Kein Content-Type setzen: Der Browser ergaenzt die Boundary.
      init.body = raw.form;
    } else if (raw?.body !== undefined) {
      init.body = JSON.stringify(raw.body);
    }
    if (raw?.signal) {
      init.signal = raw.signal;
    }

    const url = buildUrl(options.baseUrl, buildPath(template, raw?.path), raw?.query);
    const response = await fetch(url, init);

    if (response.status === 401 && allowRetry && options.onUnauthorized) {
      const renewed = await options.onUnauthorized();
      if (renewed) {
        // Genau eine Wiederholung - danach nie wieder.
        return send(method, template, raw, false);
      }
    }

    if (!response.ok) {
      let problem: ProblemDetail | null = null;
      try {
        problem = (await response.json()) as ProblemDetail;
      } catch {
        problem = null;
      }
      throw new ApiError(response.status, problem, response.headers.get("X-Request-Id"));
    }

    if (response.status === 204 || response.headers.get("Content-Length") === "0") {
      return undefined;
    }
    return response.json();
  }

  const call =
    (method: HttpMethod) =>
    (path: string, raw?: RawOptions): Promise<never> =>
      send(method, path, raw, true) as Promise<never>;

  const upload = (
    path: string,
    form: FormData,
    uploadOptions?: { signal?: AbortSignal },
  ): Promise<never> =>
    send(
      "post",
      path,
      uploadOptions?.signal ? { form, signal: uploadOptions.signal } : { form },
      true,
    ) as Promise<never>;

  return {
    get: call("get"),
    post: call("post"),
    patch: call("patch"),
    delete: call("delete"),
    upload,
  } as ApiClient;
}
