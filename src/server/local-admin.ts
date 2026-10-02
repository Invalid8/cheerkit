import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BachsClient } from "../bachs/client.js";
import type { CheerkitStore } from "./store.js";
import { createOwnerService } from "./owner.js";
import { createOwnerHandler } from "./http.js";

const sessionCookie = "cheerkit_local_admin";
const accessLifetimeMs = 5 * 60_000;
const sessionLifetimeMs = 12 * 60 * 60_000;
const maximumBodyBytes = 64 * 1024;

export interface LocalAdminConfig {
  readonly store: CheerkitStore;
  readonly bachs: BachsClient;
  /** Optional label shown in the admin sidebar. Rendered as text. */
  readonly siteName?: string;
  /** Close host-owned database connections when the runner stops. */
  readonly close?: () => void | Promise<void>;
}

export interface LocalAdminOptions {
  /** Loopback port; defaults to an available ephemeral port. */
  readonly port?: number;
}

export interface LocalAdminHandle {
  /** One-use login link. It expires after five minutes and is consumed on first use. */
  readonly accessUrl: string;
  readonly origin: string;
  close(): Promise<void>;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function equalDigest(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "style-src-attr 'none'",
      "img-src 'self' https:",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "require-trusted-types-for 'script'",
      "trusted-types 'none'",
    ].join("; "),
  );
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
}

function sendText(
  response: ServerResponse,
  status: number,
  text: string,
  contentType = "text/plain; charset=utf-8",
): void {
  securityHeaders(response);
  response.statusCode = status;
  response.setHeader("Content-Type", contentType);
  response.end(text);
}

async function readBody(request: IncomingMessage): Promise<Uint8Array> {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > maximumBodyBytes)
    throw new RangeError("body_too_large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > maximumBodyBytes) throw new RangeError("body_too_large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

async function toRequest(
  request: IncomingMessage,
  origin: string,
): Promise<Request> {
  const method = request.method ?? "GET";
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) headers.set(name, value.join(", "));
    else if (value !== undefined) headers.set(name, value);
  }
  const bytes =
    method === "GET" || method === "HEAD" ? undefined : await readBody(request);
  const body = bytes ? new ArrayBuffer(bytes.byteLength) : undefined;
  if (bytes && body) new Uint8Array(body).set(bytes);
  return new Request(new URL(request.url ?? "/", origin), {
    method,
    headers,
    ...(body ? { body } : {}),
  });
}

async function writeFetchResponse(
  response: Response,
  target: ServerResponse,
): Promise<void> {
  securityHeaders(target);
  target.statusCode = response.status;
  response.headers.forEach((value, name) => target.setHeader(name, value));
  if (response.body) target.end(Buffer.from(await response.arrayBuffer()));
  else target.end();
}

/**
 * Runs the shared owner UI beside the host website. The config supplies its existing store and Bachs
 * client; only this loopback process sees those credentials. The printed access URL is one-use.
 */
export async function startLocalAdmin(
  config: LocalAdminConfig,
  options: LocalAdminOptions = {},
): Promise<LocalAdminHandle> {
  if (
    !config ||
    !config.store ||
    !config.bachs ||
    (config.siteName !== undefined &&
      (typeof config.siteName !== "string" || config.siteName.length > 120)) ||
    (config.close !== undefined && typeof config.close !== "function") ||
    (options.port !== undefined &&
      (!Number.isSafeInteger(options.port) ||
        options.port < 0 ||
        options.port > 65_535))
  )
    throw new TypeError("Invalid Cheerkit local admin configuration.");

  const accessToken = randomBytes(32).toString("base64url");
  const sessions = new Map<string, number>();
  let accessExpiresAt = Date.now() + accessLifetimeMs;
  let used = false;
  let origin = "";
  let handler: ReturnType<typeof createOwnerHandler> | null = null;
  let closed = false;

  const authorizeOwner = (request: Request): boolean => {
    const cookie = request.headers.get("Cookie") ?? "";
    const token = cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${sessionCookie}=`))
      ?.slice(sessionCookie.length + 1);
    if (!token) return false;
    const key = digest(token).toString("hex");
    const expiresAt = sessions.get(key);
    if (!expiresAt || expiresAt <= Date.now()) {
      sessions.delete(key);
      return false;
    }
    return true;
  };

  const owner = createOwnerService({
    store: config.store,
    bachs: config.bachs,
    authorizeOwner,
  });
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const host = incoming.headers.host;
      const allowedHosts = new Set([
        `127.0.0.1:${new URL(origin).port}`,
        `localhost:${new URL(origin).port}`,
      ]);
      if (!host || !allowedHosts.has(host.toLowerCase())) {
        sendText(outgoing, 421, "Misdirected request.");
        return;
      }
      const url = new URL(incoming.url ?? "/", origin);
      if (
        incoming.headers["sec-fetch-site"] === "cross-site" &&
        url.pathname.startsWith("/api/")
      ) {
        sendText(outgoing, 403, "Forbidden.");
        return;
      }

      if (url.pathname === "/login" && incoming.method === "GET") {
        const candidate = url.searchParams.get("token") ?? "";
        if (
          used ||
          Date.now() > accessExpiresAt ||
          !equalDigest(candidate, accessToken)
        ) {
          sendText(outgoing, 403, "This access link is invalid or expired.");
          return;
        }
        used = true;
        accessExpiresAt = 0;
        const session = randomBytes(32).toString("base64url");
        sessions.set(
          digest(session).toString("hex"),
          Date.now() + sessionLifetimeMs,
        );
        outgoing.setHeader(
          "Set-Cookie",
          `${sessionCookie}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetimeMs / 1000}`,
        );
        outgoing.statusCode = 303;
        outgoing.setHeader("Location", "/");
        securityHeaders(outgoing);
        outgoing.end();
        return;
      }

      if (url.pathname === "/" && incoming.method === "GET") {
        const siteName = config.siteName
          ? ` site-name="${escapeAttribute(config.siteName)}"`
          : "";
        sendText(
          outgoing,
          200,
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cheerkit admin</title></head><body><cheerkit-admin api="/api"${siteName}></cheerkit-admin><script type="module" src="/ui/define.js"></script></body></html>`,
          "text/html; charset=utf-8",
        );
        return;
      }

      const asset = /^\/ui\/([A-Za-z0-9_-]+\.js)$/.exec(url.pathname)?.[1];
      if (asset && incoming.method === "GET") {
        try {
          const uiDirectory = resolve(
            dirname(fileURLToPath(import.meta.url)),
            "../ui",
          );
          const content = await readFile(resolve(uiDirectory, basename(asset)));
          sendText(
            outgoing,
            200,
            content.toString("utf8"),
            "text/javascript; charset=utf-8",
          );
        } catch {
          sendText(outgoing, 404, "Not found.");
        }
        return;
      }

      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        if (!handler) {
          sendText(outgoing, 503, "Unavailable.");
          return;
        }
        try {
          const request = await toRequest(incoming, origin);
          await writeFetchResponse(await handler(request), outgoing);
        } catch (error) {
          sendText(
            outgoing,
            error instanceof RangeError ? 413 : 400,
            error instanceof RangeError
              ? "Request body too large."
              : "Invalid request.",
          );
        }
        return;
      }

      sendText(outgoing, 404, "Not found.");
    })().catch(() => {
      if (!outgoing.headersSent) sendText(outgoing, 500, "Request failed.");
      else outgoing.destroy();
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  const port = options.port ?? 0;
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not bind the local admin server.");
  }
  // The owner handler permits plain HTTP only for the special localhost origin.
  // Binding remains pinned to IPv4 loopback; never listen on a LAN interface.
  origin = `http://localhost:${address.port}`;
  handler = createOwnerHandler(owner, {
    basePath: "/api",
    allowedOrigins: [origin],
  });

  return Object.freeze({
    origin,
    accessUrl: `${origin}/login?token=${accessToken}`,
    async close() {
      if (closed) return;
      closed = true;
      used = true;
      sessions.clear();
      server.close();
      server.closeAllConnections();
      for (const socket of sockets) socket.destroy();
      await config.close?.();
    },
  });
}
