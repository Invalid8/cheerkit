import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineSupportContext } from "@dalgoridim/cheerkit";
import {
  createBachsCheckoutClient,
  createBachsWebhookVerifier,
} from "@dalgoridim/cheerkit/bachs";
import { DatabaseSync } from "node:sqlite";
import { sqliteDatabase } from "@dalgoridim/cheerkit/sqlite";
import {
  cheerkitMigrations,
  createSupportService,
  openStore,
} from "@dalgoridim/cheerkit/server";

// Offline demonstration: all provider traffic is replaced with synthetic responses.
const directory = mkdtempSync(join(tmpdir(), "cheerkit-example-"));
const now = Date.parse("2026-09-24T12:00:00Z");
const scope = { organizationId: "example-owner", environment: "sandbox" };
const webhookSecret = "synthetic-webhook-secret";
// The application owns this database; it applies Cheerkit's migrations with its own tooling.
const appDatabase = new DatabaseSync(join(directory, "app.sqlite"));
for (const migration of cheerkitMigrations()) appDatabase.exec(migration.sql);
const store = await openStore({
  ...scope,
  installationId: "independent-example",
  database: sqliteDatabase(appDatabase),
});
try {
  const context = defineSupportContext({
    id: "my-work",
    name: "My work",
    collectMessage: true,
    currencies: [{ currency: "NGN", fractionDigits: 2, minimum: "100" }],
  });
  await store.putContext(context, null);
  const checkout = createBachsCheckoutClient({
    ...scope,
    secretKey: "sk_sandbox_synthetic",
    successUrl: "https://example.test/result",
    cancelUrl: "https://example.test/support",
    fetch: async (_url, request) => {
      const { reference } = JSON.parse(request.body);
      return Response.json({
        checkout_id: "checkout-example",
        reference,
        status: "open",
        checkout_url: "https://checkout.example.test/synthetic",
        created_at: new Date(now).toISOString(),
        expires_at: new Date(now + 3600000).toISOString(),
      });
    },
  });
  const webhooks = createBachsWebhookVerifier({
    ...scope,
    secret: webhookSecret,
    now: () => now,
  });
  const service = createSupportService({
    store,
    checkout,
    webhooks,
    resultSecret: "synthetic-result-secret-for-offline-example",
    retention: { supporterDataDays: 30 },
    now: () => now,
  });
  const access = await service.startContribution(
    context.id,
    { amount: "2500", currency: "NGN", message: "This stays private." },
    randomUUID(),
  );
  assert.equal(access.contribution.outcome, "pending");
  const stored = await store.getContribution(
    access.contribution.contributionId,
  );
  const raw = Buffer.from(
    JSON.stringify({
      id: "event-example",
      type: "collection.succeeded",
      organization_id: scope.organizationId,
      created_at: new Date(now).toISOString(),
      data: {
        checkout_id: stored.checkout.id,
        reference: stored.request.reference,
        charge_id: "charge-example",
        status: "succeeded",
        amount: "2500.00",
        currency: "NGN",
      },
    }),
  );
  const seconds = now / 1000;
  const signature = createHmac("sha256", webhookSecret)
    .update(`${seconds}.`)
    .update(raw)
    .digest("hex");
  await service.acceptWebhook(raw, {
    signatureV2: `t=${seconds},v1=${signature}`,
  });
  const status = await service.getStatus(
    access.contribution.contributionId,
    access.resultToken,
  );
  assert.equal(status.outcome, "confirmed");
  assert.equal("message" in status, false);
  await assert.rejects(
    service.owner.listContexts(new Request("https://example.test/owner")),
    { code: "UNAUTHORIZED" },
  );
  console.log(
    "Offline service example passed: durable confirmation, private status, owner access denied.",
  );
} finally {
  appDatabase.close();
  rmSync(directory, { recursive: true, force: true });
}
