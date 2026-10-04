import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  createBachsCheckoutClient,
  createBachsWebhookVerifier,
} from "@dalgoridim/cheerkit/bachs";
import { DatabaseSync } from "node:sqlite";
import { sqliteDatabase } from "@dalgoridim/cheerkit/sqlite";
import {
  cheerkitMigrations,
  createSupportHandler,
  createSupportService,
  openStore,
} from "@dalgoridim/cheerkit/server";

// Offline demonstration: provider traffic is synthetic; the HTTP server is real and listens on localhost only.
const directory = mkdtempSync(join(tmpdir(), "cheerkit-http-example-"));
const scope = { organizationId: "example-owner", environment: "sandbox" };
// The application owns this database; it applies Cheerkit's migrations with its own tooling.
const appDatabase = new DatabaseSync(join(directory, "app.sqlite"));
for (const migration of cheerkitMigrations()) appDatabase.exec(migration.sql);
const store = await openStore({
  ...scope,
  installationId: "http-example",
  database: sqliteDatabase(appDatabase),
});
await store.putContext(
  {
    id: "my-work",
    name: "My work",
    currencies: [{ currency: "NGN", fractionDigits: 2, minimum: "100" }],
  },
  null,
);
const checkout = createBachsCheckoutClient({
  ...scope,
  secretKey: "sk_sandbox_synthetic",
  successUrl: "https://example.test/result",
  cancelUrl: "https://example.test/support",
  fetch: async (_url, request) => {
    const { reference } = JSON.parse(request.body);
    return Response.json({
      checkout_id: `chk_${reference}`,
      reference,
      status: "open",
      checkout_url: "https://checkout.example.test/pay",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    });
  },
});
const service = createSupportService({
  store,
  checkout,
  resultSecret: "synthetic-result-secret-for-offline-example",
  retention: { supporterDataDays: 30 },
  webhooks: createBachsWebhookVerifier({
    ...scope,
    secret: "synthetic-webhook-secret",
  }),
  authorizeOwner: () => false,
});

const origin = "http://localhost";
const handler = createSupportHandler(service, {
  basePath: "/api/support",
  allowedOrigins: [origin],
  clientKey: (request) => request.headers.get("X-Client-Address"),
});

const server = createServer(async (incoming, outgoing) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers))
    if (typeof value === "string") headers.set(name, value);
  // The socket address is trusted; client-supplied forwarding headers are not.
  headers.set("X-Client-Address", incoming.socket.remoteAddress ?? "unknown");
  const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
  const response = await handler(
    new Request(new URL(incoming.url, "http://localhost"), {
      method: incoming.method,
      headers,
      ...(hasBody ? { body: Readable.toWeb(incoming), duplex: "half" } : {}),
    }),
  );
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
});

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/support`;
  const started = await fetch(`${url}/contributions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({
      contextId: "my-work",
      submission: { amount: "2500", currency: "NGN" },
      submissionKey: randomUUID(),
    }),
  });
  assert.equal(started.status, 201);
  const access = await started.json();
  const status = await fetch(`${url}/contributions/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({
      contributionId: access.contribution.contributionId,
      resultToken: access.resultToken,
    }),
  });
  assert.equal((await status.json()).outcome, "pending");
  assert.equal((await fetch(`${url}/owner/contributions`)).status, 403);
  console.log(
    "Node HTTP example passed: start, status by token, owner access denied.",
  );
} finally {
  server.close();
  appDatabase.close();
  rmSync(directory, { recursive: true, force: true });
}
