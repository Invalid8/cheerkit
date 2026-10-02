import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import {
  createBachsCheckoutClient,
  createBachsWebhookVerifier,
} from "cheerkit/bachs";
import { DatabaseSync } from "node:sqlite";
import { sqliteDatabase } from "cheerkit/sqlite";
import {
  cheerkitMigrations,
  createSupportHandler,
  createSupportService,
  openStore,
  startPendingWorker,
} from "cheerkit/server";

// Local demonstration only: Bachs is replaced by a fake checkout page, and owner access by a development cookie.
// Cheerkit accepts only HTTPS checkout URLs, so the fake provider issues https://localhost links and this plain-HTTP
// server rewrites them in its own API responses.
const port = Number(process.env.PORT ?? 4173);
const origin = `http://localhost:${port}`;
const secureOrigin = `https://localhost:${port}`;
const scope = { organizationId: "dev-owner", environment: "sandbox" };
const webhookSecret = "local-development-webhook-secret";
const directory = mkdtempSync(join(tmpdir(), "cheerkit-ui-"));
const appDatabase = new DatabaseSync(join(directory, "app.sqlite"));
for (const migration of cheerkitMigrations()) appDatabase.exec(migration.sql);
const store = await openStore({
  ...scope,
  installationId: "ui-example",
  database: sqliteDatabase(appDatabase),
  effects: ["thank-you"],
});
await store.putContext(
  {
    id: "my-work",
    name: "My work",
    collectName: true,
    collectMessage: true,
    currencies: [
      {
        currency: "NGN",
        fractionDigits: 2,
        minimum: "100",
        maximum: "500000",
        suggestedAmounts: ["1000", "2500", "5000"],
      },
      {
        currency: "USD",
        fractionDigits: 2,
        minimum: "1",
        maximum: "1000",
        suggestedAmounts: ["5", "10", "25"],
      },
    ],
  },
  null,
);

const checkouts = new Map();
const charges = new Map();
const checkout = createBachsCheckoutClient({
  ...scope,
  secretKey: "sk_sandbox_local_development",
  successUrl: "https://localhost/result.html",
  cancelUrl: "https://localhost/page.html",
  fetch: async (url, init) => {
    const { pathname } = new URL(url);
    if (init.method === "POST" && pathname === "/v1/checkout-sessions") {
      const body = JSON.parse(init.body);
      const id = `chk_${randomUUID()}`;
      const session = {
        checkout_id: id,
        reference: body.reference,
        amount: body.pricing.amount,
        currency: body.pricing.currency,
        success_url: body.success_url,
        cancel_url: body.cancel_url,
        status: "open",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      };
      checkouts.set(id, session);
      return Response.json({
        ...session,
        checkout_url: `${secureOrigin}/dev/checkout?id=${id}`,
      });
    }
    const [, resource, id] = pathname.match(/^\/v1\/([a-z-]+)\/([^/]+)$/) ?? [];
    const found =
      resource === "checkout-sessions"
        ? checkouts.get(id)
        : resource === "payments"
          ? charges.get(id)
          : undefined;
    return found ? Response.json(found) : new Response(null, { status: 404 });
  },
});
const service = createSupportService({
  store,
  checkout,
  resultSecret: randomUUID() + randomUUID(),
  retention: { supporterDataDays: 30 },
  webhooks: createBachsWebhookVerifier({ ...scope, secret: webhookSecret }),
  authorizeOwner: (request) =>
    /(?:^|;\s*)cheerkit_dev_owner=1(?:;|$)/.test(
      request.headers.get("Cookie") ?? "",
    ),
  effects: {
    handlers: {
      "thank-you": async ({ id }) =>
        console.log(`thank-you effect ran for ${id}`),
    },
    maxAttempts: 3,
    retryDelayMs: 5000,
    leaseMs: 10000,
  },
});
const handler = createSupportHandler(service, {
  basePath: "/api/support",
  allowedOrigins: [origin],
  clientKey: (request) => request.headers.get("X-Client-Address"),
  onError: (report) => console.warn("support error", report),
  onRefusal: (report) => console.info("support request refused", report),
});
const worker = startPendingWorker(service, {
  intervalMs: 2000,
  pageSize: 50,
  maxPages: 5,
  onPass: (counts) => {
    if (
      counts.processed ||
      counts.effects.succeeded ||
      counts.effects.retrying ||
      counts.effects.failed
    )
      console.log("worker pass", counts);
  },
  onError: (report) => console.warn("worker pass failed", report),
});

async function deliver(type, data) {
  const raw = JSON.stringify({
    id: `evt_${randomUUID()}`,
    type,
    organization_id: scope.organizationId,
    created_at: new Date().toISOString(),
    data,
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  await handler(
    new Request(`${origin}/api/support/webhooks/bachs`, {
      method: "POST",
      headers: { "X-Bachs-Signature-V2": `t=${timestamp},v1=${signature}` },
      body: raw,
    }),
  );
}

function fakeCheckout(id) {
  const session = checkouts.get(id);
  if (!session) return "<p>Unknown checkout.</p>";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fake checkout</title><link rel="stylesheet" href="/styles.css"></head><body><main class="page">
<h1>Fake Bachs checkout</h1><p>Local development stand-in. Pay ${session.currency} ${session.amount}?</p>
<form method="post" action="/dev/checkout?id=${encodeURIComponent(id)}" class="actions">
<button name="action" value="pay">Pay now</button><button name="action" value="slow">Pay, confirm after 8 seconds</button>
<button name="action" value="expire">Let it expire</button><button name="action" value="cancel">Cancel</button></form></main></body></html>`;
}

async function fakePayment(id, action) {
  const session = checkouts.get(id);
  if (!session) return "/page.html";
  const base = { checkout_id: id, reference: session.reference };
  const collection = {
    ...base,
    charge_id: `ch_${randomUUID()}`,
    status: "succeeded",
    amount: session.amount,
    currency: session.currency,
  };
  charges.set(collection.charge_id, {
    payment_id: collection.charge_id,
    checkout_id: id,
    status: "succeeded",
    amount: session.amount,
    currency: session.currency,
    fees: null,
    merchant_bears_cost: true,
  });
  if (action === "pay") await deliver("collection.succeeded", collection);
  if (action === "slow")
    setTimeout(() => void deliver("collection.succeeded", collection), 8000);
  if (action === "expire")
    await deliver("checkout.expired", { ...base, status: "expired" });
  return action === "cancel" ? "/page.html" : "/result.html";
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};
const files = new Set([
  "page.html",
  "modal.html",
  "result.html",
  "owner.html",
  "support.js",
  "support-form.js",
  "owner.js",
  "styles.css",
  "template.html",
  "template-result.html",
  "admin.html",
  "strict.html",
  "strict.js",
  "strict.css",
]);
const uiFiles = new Set([
  "define.js",
  "element.js",
  "support.js",
  "styles.js",
  "color.js",
  "dom.js",
  "admin.js",
  "admin-styles.js",
  "owner.js",
]);
const strictCsp = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'none'",
  "img-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "require-trusted-types-for 'script'",
  "trusted-types 'none'",
].join("; ");

const server = createServer(async (incoming, outgoing) => {
  const url = new URL(incoming.url, origin);
  const send = (
    status,
    body,
    type = "text/html; charset=utf-8",
    headers = {},
  ) => {
    outgoing.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      ...headers,
    });
    outgoing.end(body);
  };
  if (url.pathname.startsWith("/api/support")) {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers))
      if (typeof value === "string") headers.set(name, value);
    headers.set("X-Client-Address", incoming.socket.remoteAddress ?? "unknown");
    const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
    const response = await handler(
      new Request(url, {
        method: incoming.method,
        headers,
        ...(hasBody ? { body: Readable.toWeb(incoming), duplex: "half" } : {}),
      }),
    );
    outgoing.writeHead(
      response.status,
      Object.fromEntries(
        [...response.headers].filter(([name]) => name !== "content-length"),
      ),
    );
    outgoing.end((await response.text()).replaceAll(secureOrigin, origin));
    return;
  }
  if (url.pathname === "/dev/checkout" && incoming.method === "GET")
    return send(200, fakeCheckout(url.searchParams.get("id")));
  if (url.pathname === "/dev/checkout" && incoming.method === "POST") {
    let body = "";
    for await (const chunk of incoming) body += chunk;
    return send(303, "", "text/plain", {
      Location: await fakePayment(
        url.searchParams.get("id"),
        new URLSearchParams(body).get("action"),
      ),
    });
  }
  if (url.pathname === "/dev/owner-login")
    return send(303, "", "text/plain", {
      Location:
        url.searchParams.get("next") === "/admin.html"
          ? "/admin.html"
          : url.searchParams.get("next") === "/strict.html"
            ? "/strict.html"
            : "/owner.html",
      "Set-Cookie": "cheerkit_dev_owner=1; Path=/; HttpOnly; SameSite=Lax",
    });
  if (url.pathname.startsWith("/ui/")) {
    const file = url.pathname.slice(4);
    if (!uiFiles.has(file)) return send(404, "Not found", "text/plain");
    return send(
      200,
      readFileSync(new URL(`../../dist/ui/${file}`, import.meta.url)),
      types[".js"],
    );
  }
  const name = url.pathname === "/" ? "page.html" : url.pathname.slice(1);
  if (!files.has(name)) return send(404, "Not found", "text/plain");
  send(
    200,
    readFileSync(new URL(name, import.meta.url)),
    types[extname(name)],
    {
      ...(name === "strict.html"
        ? { "Content-Security-Policy": strictCsp }
        : {}),
    },
  );
});

server.listen(port, "localhost", () => {
  console.log(
    `Cheerkit UI example: ${origin}/page.html, ${origin}/modal.html, owner view via ${origin}/dev/owner-login`,
  );
});
const stop = () => {
  worker.stop();
  server.close();
  appDatabase.close();
  rmSync(directory, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
