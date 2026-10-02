import { CheerkitError } from "../core/errors.js";
import { BachsError } from "../bachs/errors.js";
import { SupportServiceError } from "./errors.js";
import type { SupportService } from "./index.js";
import type { OwnerService } from "./owner.js";
import {
  CheerkitStoreError,
  type ContributionStatus,
  type StoredEffect,
  type StoredEvent,
} from "./store.js";

export interface OwnerHandlerOptions {
  /** Path prefix the handler is mounted at, such as `/api/support`; owner routes live under `/owner`. */
  readonly basePath: string;
  /** Exact origins (scheme://host[:port]) allowed to send changes and browser requests. */
  readonly allowedOrigins: readonly string[];
  /** Receives server failures as a code and route name only, never request data. */
  readonly onError?: (report: {
    readonly code: string;
    readonly route: string;
  }) => void;
  /** Receives refused requests as route, status, and code only, never request data. */
  readonly onRefusal?: (report: {
    readonly code: string;
    readonly route: string;
    readonly status: number;
  }) => void;
}

export interface SupportHandlerOptions extends OwnerHandlerOptions {
  /**
   * Trusted identity of the caller for rate limiting, such as the socket address or a value set by your own proxy.
   * Never a client-supplied forwarding header your deployment does not overwrite.
   */
  readonly clientKey: (request: Request) => string;
  /** Contribution starts allowed per client per window. Defaults to 10 per 60 seconds. */
  readonly initiationLimit?: {
    readonly requests: number;
    readonly windowSeconds: number;
  };
  readonly now?: () => number;
}

export type SupportHandler = (request: Request) => Promise<Response>;

type Route = [name: string, work: () => Promise<Response>];

const publicBodyLimit = 16 * 1024;
const ownerBodyLimit = 64 * 1024;
const webhookBodyLimit = 1024 * 1024;
const eventStates: readonly StoredEvent["state"][] = [
  "pending",
  "applied",
  "review",
  "unsupported",
  "dismissed",
];
const effectStates: readonly StoredEffect["state"][] = [
  "pending",
  "running",
  "succeeded",
  "failed",
];
const contributionStatuses: readonly ContributionStatus[] = [
  "awaiting_payment",
  "checkout_unresolved",
  "unsuccessful",
  "confirmed",
  "needs_review",
];

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...headers,
    },
  });
}

async function readBody(request: Request, limit: number): Promise<Uint8Array> {
  const declared = request.headers.get("Content-Length");
  if (
    declared !== null &&
    (!/^[0-9]+$/.test(declared) || Number(declared) > limit)
  )
    throw new HttpError(413, "body_too_large");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new HttpError(413, "body_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function readJson(
  request: Request,
  limit: number,
): Promise<Record<string, unknown>> {
  if (
    request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  ) {
    throw new HttpError(415, "unsupported_media_type");
  }
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await readBody(request, limit),
      ),
    );
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_json");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "invalid_json");
  return value as Record<string, unknown>;
}

function errorResponse(error: unknown): { status: number; code: string } {
  if (error instanceof HttpError)
    return { status: error.status, code: error.code };
  if (error instanceof SupportServiceError) {
    if (error.code === "UNAUTHORIZED")
      return { status: 403, code: "forbidden" };
    if (error.code === "INVALID_REQUEST")
      return { status: 400, code: "invalid_request" };
    return { status: 500, code: "server_error" };
  }
  if (error instanceof CheerkitError) {
    if (error.code === "CONTEXT_CLOSED")
      return { status: 409, code: "context_closed" };
    return { status: 400, code: error.code.toLowerCase() };
  }
  if (error instanceof CheerkitStoreError) {
    return {
      CONFLICT: { status: 409, code: "conflict" },
      NOT_FOUND: { status: 404, code: "not_found" },
      INVALID_STATE: { status: 409, code: "invalid_state" },
      STORAGE_FAILURE: { status: 503, code: "retry_later" },
    }[error.code];
  }
  if (error instanceof BachsError) {
    return {
      INVALID_SIGNATURE: { status: 401, code: "invalid_signature" },
      INVALID_EVENT: { status: 400, code: "invalid_event" },
      WRONG_ACCOUNT: { status: 400, code: "wrong_account" },
      RECOVERY_FAILED: { status: 502, code: "recovery_failed" },
      RESEND_FAILED: { status: 502, code: "resend_failed" },
      LOOKUP_FAILED: { status: 502, code: "lookup_failed" },
      INVALID_CHECKOUT: { status: 400, code: "invalid_request" },
      CHECKOUT_REJECTED: { status: 502, code: "provider_error" },
      CHECKOUT_UNCERTAIN: { status: 502, code: "provider_error" },
      INVALID_CONFIGURATION: { status: 500, code: "server_error" },
    }[error.code];
  }
  return { status: 500, code: "server_error" };
}

function configurationError(message: string): never {
  throw new SupportServiceError("INVALID_CONFIGURATION", message);
}

function limitOption(value: unknown, fallback: number, max: number): number {
  const result = value ?? fallback;
  if (
    typeof result !== "number" ||
    !Number.isSafeInteger(result) ||
    result < 1 ||
    result > max
  ) {
    configurationError("Invalid HTTP handler limit.");
  }
  return result;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "invalid_request");
  return value;
}

function oneOf<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | undefined {
  if (value === null) return undefined;
  if (!allowed.includes(value as T))
    throw new HttpError(400, "invalid_request");
  return value as T;
}

function query(url: URL, name: string): { readonly [key: string]: string } {
  const value = url.searchParams.get(name);
  return value === null ? {} : { [name]: value };
}

function limitQuery(url: URL): { readonly limit?: number } {
  const value = url.searchParams.get("limit");
  if (value === null) return {};
  if (!/^[0-9]{1,3}$/.test(value)) throw new HttpError(400, "invalid_request");
  return { limit: Number(value) };
}

function createHandler(
  options: OwnerHandlerOptions,
  route: (request: Request, path: string[], origins: Origins) => Route,
) {
  const basePath = options.basePath.replace(/\/+$/, "");
  if (
    !/^(\/[A-Za-z0-9._~-]+)*$/.test(basePath) ||
    (options.onError !== undefined && typeof options.onError !== "function") ||
    (options.onRefusal !== undefined &&
      typeof options.onRefusal !== "function") ||
    !Array.isArray(options.allowedOrigins) ||
    !options.allowedOrigins.length
  ) {
    configurationError(
      "Provide a base path, allowed origins, and valid callbacks.",
    );
  }
  const origins = new Origins(options.allowedOrigins);
  return async (request: Request): Promise<Response> => {
    let name = "unknown";
    try {
      const pathname = new URL(request.url).pathname;
      if (pathname !== basePath && !pathname.startsWith(`${basePath}/`))
        throw new HttpError(404, "not_found");
      const [routeName, work] = route(
        request,
        pathname.slice(basePath.length).split("/").filter(Boolean),
        origins,
      );
      name = routeName;
      return await work();
    } catch (error) {
      const { status, code } = errorResponse(error);
      if (status >= 500 || name === "webhook")
        options.onError?.({ code, route: name });
      else options.onRefusal?.({ code, route: name, status });
      return json(
        status,
        { error: code },
        status === 503 ? { "Retry-After": "30" } : {},
      );
    }
  };
}

class Origins {
  readonly #allowed: ReadonlySet<string>;

  constructor(origins: readonly string[]) {
    this.#allowed = new Set(
      origins.map((origin) => {
        let url: URL;
        try {
          url = new URL(origin);
        } catch {
          return configurationError(
            "Allowed origins must be absolute origins.",
          );
        }
        if (
          url.origin !== origin ||
          (url.protocol !== "https:" && url.hostname !== "localhost")
        ) {
          configurationError(
            "Allowed origins must be exact HTTPS origins (or localhost).",
          );
        }
        return origin;
      }),
    );
  }

  require(request: Request, optional: boolean): void {
    const origin = request.headers.get("Origin");
    if (origin === null ? !optional : !this.#allowed.has(origin))
      throw new HttpError(403, "origin_not_allowed");
  }
}

// Owner changes need an allowed Origin: the CSRF defence for cookie sessions.
function ownerRoute(
  owner: OwnerService,
  request: Request,
  path: string[],
  origins: Origins,
): Route {
  const [, area, id, action, extra] = path;
  const method = request.method;
  const url = new URL(request.url);
  const segments = path.length;
  const body = () => readJson(request, ownerBodyLimit);
  const route = (
    name: string,
    work: () => Promise<unknown>,
    headers?: Record<string, string>,
  ): Route => [
    `owner.${name}`,
    async () => {
      if (method !== "GET") origins.require(request, false);
      return json(200, await work(), headers);
    },
  ];
  const found = (name: string, work: () => Promise<unknown>): Route => [
    `owner.${name}`,
    async () => {
      const value = await work();
      return value ? json(200, value) : json(404, { error: "not_found" });
    },
  ];
  const contributionId = id === undefined ? "" : decodeURIComponent(id);

  if (area === "contributions" && segments === 2 && method === "GET") {
    return route("listContributions", () => {
      const status = oneOf(
        url.searchParams.get("status"),
        contributionStatuses,
      );
      const cursor =
        url.searchParams.has("beforeCreatedAt") ||
        url.searchParams.has("beforeId")
          ? {
              before: {
                createdAt: text(url.searchParams.get("beforeCreatedAt")),
                id: text(url.searchParams.get("beforeId")),
              },
            }
          : {};
      return owner.listContributions(request, {
        ...query(url, "contextId"),
        ...(status ? { status } : {}),
        ...cursor,
        ...limitQuery(url),
      });
    });
  }
  if (area === "contributions" && segments === 3 && method === "GET") {
    return found("getContribution", () =>
      owner.getContribution(request, contributionId),
    );
  }
  if (area === "contributions" && segments === 4 && method === "POST") {
    switch (action) {
      case "recover":
        return route("recoverCheckout", async () =>
          owner.recoverCheckout(
            request,
            contributionId,
            text((await body()).checkoutId),
          ),
        );
      case "retry":
        return route("retryCheckout", () =>
          owner.retryCheckout(request, contributionId),
        );
      case "resend-notices":
        return route("resendNotices", () =>
          owner.resendNotices(request, contributionId),
        );
      case "payment-details":
        return route("refreshPaymentDetails", () =>
          owner.refreshPaymentDetails(request, contributionId),
        );
      case "remove-personal-data":
        return route("removePersonalData", () =>
          owner.removePersonalData(request, contributionId),
        );
      case "accept-review":
        return route("acceptReview", async () =>
          owner.acceptReview(
            request,
            contributionId,
            text((await body()).note),
          ),
        );
      case "external-returns":
        return route("recordExternalReturn", async () => {
          const input = await body();
          return owner.recordExternalReturn(
            request,
            contributionId,
            text(input.amount),
            text(input.note),
          );
        });
    }
  }
  if (area === "contexts" && segments === 2 && method === "GET") {
    return route("listContexts", () => owner.listContexts(request));
  }
  if (area === "contexts" && segments === 3 && method === "PUT") {
    return route("putContext", async () => {
      const input = await body();
      const revision = input.expectedRevision;
      if (revision !== null && typeof revision !== "number")
        throw new HttpError(400, "invalid_request");
      const context = input.context as Record<string, unknown> | undefined;
      if (!context || context.id !== contributionId)
        throw new HttpError(400, "invalid_request");
      return owner.putContext(request, context as never, revision);
    });
  }
  if (area === "events" && segments === 2 && method === "GET") {
    return route("listEvents", () => {
      const state = oneOf(url.searchParams.get("state"), eventStates);
      return owner.listEvents(request, {
        ...(state ? { state } : {}),
        ...query(url, "contributionId"),
        ...query(url, "afterId"),
        ...limitQuery(url),
      });
    });
  }
  if (area === "events" && segments === 4 && method === "POST") {
    switch (action) {
      case "dismiss":
        return route("dismissEvent", async () =>
          owner.dismissEvent(
            request,
            contributionId,
            text((await body()).note),
          ),
        );
      case "reopen":
        return route("reopenEvent", () =>
          owner.reopenEvent(request, contributionId),
        );
      case "recheck":
        return route("recheckEvent", () =>
          owner.recheckEvent(request, contributionId),
        );
    }
  }
  if (area === "effects" && segments === 2 && method === "GET") {
    return route("listEffects", () => {
      const state = oneOf(url.searchParams.get("state"), effectStates);
      return owner.listEffects(request, {
        ...(state ? { state } : {}),
        ...query(url, "contributionId"),
        ...limitQuery(url),
      });
    });
  }
  if (
    area === "effects" &&
    segments === 5 &&
    extra === "retry" &&
    method === "POST"
  ) {
    return route("retryEffect", () =>
      owner.retryEffect(request, contributionId, decodeURIComponent(action!)),
    );
  }
  if (area === "export" && segments === 2 && method === "GET") {
    return route("exportData", () => owner.exportData(request), {
      "Content-Disposition": 'attachment; filename="cheerkit-export.json"',
    });
  }
  if (area === "summary" && segments === 2 && method === "GET") {
    return route("summary", () => owner.summary(request));
  }
  throw new HttpError(404, "not_found");
}

/** A Fetch-standard handler for the owner routes alone, for an admin that runs apart from the website. */
export function createOwnerHandler(
  owner: OwnerService,
  options: OwnerHandlerOptions,
): SupportHandler {
  return createHandler(options, (request, path, origins) => {
    if (path[0] !== "owner") throw new HttpError(404, "not_found");
    return ownerRoute(owner, request, path, origins);
  });
}

/** A Fetch-standard handler for the whole service: public, webhook, and owner routes. Mount it on one path prefix. */
export function createSupportHandler(
  service: SupportService,
  options: SupportHandlerOptions,
): SupportHandler {
  if (
    typeof options.clientKey !== "function" ||
    (options.now !== undefined && typeof options.now !== "function")
  ) {
    configurationError("Provide a trusted client key and a valid clock.");
  }
  const requests = limitOption(options.initiationLimit?.requests, 10, 10_000);
  const windowMs =
    limitOption(options.initiationLimit?.windowSeconds, 60, 86_400) * 1000;
  const now = options.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();

  const limit = (request: Request): void => {
    const key = options.clientKey(request);
    if (typeof key !== "string" || !key)
      configurationError("The client key callback must return text.");
    const time = now();
    if (windows.size > 10_000)
      for (const [entry, window] of windows)
        if (time - window.start >= windowMs) windows.delete(entry);
    const window = windows.get(key);
    if (!window || time - window.start >= windowMs)
      windows.set(key, { start: time, count: 1 });
    else if (++window.count > requests)
      throw new HttpError(429, "rate_limited");
  };

  return createHandler(options, (request, path, origins): Route => {
    const [area, id] = path;
    const method = request.method;
    const segments = path.length;
    const publicJson = (
      name: string,
      rateLimited: boolean,
      work: (body: Record<string, unknown>) => Promise<Response>,
    ): Route => [
      name,
      async () => {
        origins.require(request, true);
        if (rateLimited) limit(request);
        return work(await readJson(request, publicBodyLimit));
      },
    ];
    const withResult = (
      name: string,
      work: (id: string, token: string) => Promise<unknown>,
    ): Route =>
      publicJson(name, false, async (body) => {
        const found = await work(
          text(body.contributionId),
          text(body.resultToken),
        );
        return found ? json(200, found) : json(404, { error: "not_found" });
      });

    if (area === "contexts" && segments === 2 && method === "GET") {
      return [
        "context",
        async () => {
          const context = await service.getPublicContext(
            decodeURIComponent(id!),
          );
          return context
            ? json(200, context)
            : json(404, { error: "not_found" });
        },
      ];
    }
    if (area === "contributions" && segments === 1 && method === "POST") {
      return publicJson("start", true, async (body) =>
        json(
          201,
          await service.startContribution(
            text(body.contextId),
            body.submission,
            text(body.submissionKey),
            body.metadata,
          ),
        ),
      );
    }
    if (area === "contributions" && segments === 2 && method === "POST") {
      switch (id) {
        case "resume":
          return publicJson("resume", true, async (body) =>
            json(
              200,
              await service.resumeContribution(text(body.submissionKey)),
            ),
          );
        case "status":
          return withResult("status", (contributionId, token) =>
            service.getStatus(contributionId, token),
          );
        case "data":
          return withResult("ownData", (contributionId, token) =>
            service.getOwnData(contributionId, token),
          );
        case "remove-data":
          return withResult("removeOwnData", (contributionId, token) =>
            service.removeOwnData(contributionId, token),
          );
      }
    }
    if (
      area === "webhooks" &&
      id === "bachs" &&
      segments === 2 &&
      method === "POST"
    ) {
      return [
        "webhook",
        async () => {
          const receipt = await service.acceptWebhook(
            await readBody(request, webhookBodyLimit),
            {
              signatureV2: request.headers.get("X-Bachs-Signature-V2"),
              signature: request.headers.get("X-Bachs-Signature"),
              timestamp: request.headers.get("X-Bachs-Timestamp"),
            },
          );
          return json(200, { received: receipt.receipt });
        },
      ];
    }
    if (area === "owner")
      return ownerRoute(service.owner, request, path, origins);
    throw new HttpError(404, "not_found");
  });
}
