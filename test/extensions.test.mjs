import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import { validateMetadata } from "cheerkit";
import {
  createBachsCheckoutClient,
  createBachsWebhookVerifier,
} from "cheerkit/bachs";
import {
  createSupportHandler,
  createSupportService,
  openStore,
} from "cheerkit/server";
import { hostDatabase } from "./helpers.mjs";

const initialTime = Date.parse("2026-09-24T12:00:00Z");
const scope = { organizationId: "acct_owner", environment: "sandbox" };
const context = {
  id: "work",
  name: "My work",
  currencies: [{ currency: "NGN", fractionDigits: 2, minimum: "100" }],
};
const submission = { amount: "2500", currency: "NGN" };
const ownerRequest = new Request("https://site.example/owner");
const retry = { maxAttempts: 2, retryDelayMs: 1000, leaseMs: 5000 };

async function fixture(
  t,
  { handler = async () => {}, effects = ["thank-you"] } = {},
) {
  const host = await hostDatabase(t, "sqlite");
  let time = initialTime;
  const bodies = [];
  const open = async () => {
    const connection = host.connect();
    return {
      ...(await openStore({
        ...scope,
        installationId: "extensions",
        database: connection.database,
        effects,
      })),
      connection,
    };
  };
  const close = (store) => store.connection.raw.close();
  const store = await open();
  await store.putContext(context, null);
  const checkout = createBachsCheckoutClient({
    ...scope,
    secretKey: "sk_sandbox_fixture",
    successUrl: "https://site.example/result",
    cancelUrl: "https://site.example/support",
    fetch: async (_url, init) => {
      bodies.push(init.body);
      const body = JSON.parse(init.body);
      return Response.json({
        checkout_id: `chk_${body.reference}`,
        reference: body.reference,
        checkout_url: "https://checkout.example.test/pay",
        status: "open",
        created_at: new Date(time).toISOString(),
        expires_at: new Date(time + 3600000).toISOString(),
      });
    },
  });
  const webhooks = createBachsWebhookVerifier({
    ...scope,
    secret: "fixture-webhook",
    now: () => time,
  });
  const calls = [];
  const service = (overrides = {}) =>
    createSupportService({
      store,
      checkout,
      webhooks,
      authorizeOwner: () => true,
      resultSecret: "synthetic-result-secret-32-characters",
      retention: { supporterDataDays: 30 },
      now: () => time,
      effects: {
        handlers: Object.fromEntries(
          effects.map((name) => [
            name,
            async (effect) => {
              calls.push(effect);
              await handler(effect);
            },
          ]),
        ),
        ...retry,
      },
      ...overrides,
    });
  return {
    store,
    open,
    close,
    service,
    checkout,
    webhooks,
    bodies,
    calls,
    setTime(value) {
      time = value;
    },
    get time() {
      return time;
    },
  };
}

function delivery(stored, id = "evt_1", data = {}) {
  const raw = Buffer.from(
    JSON.stringify({
      id,
      type: "collection.succeeded",
      organization_id: scope.organizationId,
      created_at: new Date(initialTime).toISOString(),
      data: {
        checkout_id: stored.checkout.id,
        reference: stored.request.reference,
        charge_id: "ch_1",
        status: "succeeded",
        amount: "2500.00",
        currency: "NGN",
        ...data,
      },
    }),
  );
  const timestamp = initialTime / 1000;
  return [
    raw,
    {
      signatureV2: `t=${timestamp},v1=${createHmac("sha256", "fixture-webhook").update(`${timestamp}.`).update(raw).digest("hex")}`,
    },
  ];
}

test("metadata is validated, private, excluded from the provider request, and part of submission identity", async (t) => {
  const f = await fixture(t);
  const service = f.service();
  const key = randomUUID();
  const metadata = {
    entry_point: "modal",
    amount: "999999",
    campaign_week: 3,
    returning: true,
  };
  const access = await service.startContribution(
    "work",
    submission,
    key,
    metadata,
  );
  const stored = await f.store.getBySubmissionKey(key);
  assert.deepEqual(stored.metadata, {
    amount: "999999",
    campaign_week: 3,
    entry_point: "modal",
    returning: true,
  });
  assert.equal(stored.intent.amount, "2500.00");
  assert.equal(
    f.bodies[0].includes("modal") || f.bodies[0].includes("entry_point"),
    false,
  );
  assert.equal(JSON.stringify(access).includes("modal"), false);
  assert.equal(
    JSON.stringify(
      await service.getStatus(
        access.contribution.contributionId,
        access.resultToken,
      ),
    ).includes("modal"),
    false,
  );
  assert.equal(
    (await service.startContribution("work", submission, key, { ...metadata }))
      .contribution.contributionId,
    access.contribution.contributionId,
  );
  await assert.rejects(
    service.startContribution("work", submission, key, { entry_point: "page" }),
    { code: "CONFLICT" },
  );
  for (const invalid of [
    { Bad: 1 },
    { nested: { a: 1 } },
    { list: [1] },
    { value: "x".repeat(501) },
    { n: Infinity },
    "text",
    Object.fromEntries(
      Array.from({ length: 21 }, (_, index) => [`k${index}`, 1]),
    ),
    Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [`k${index}`, "x".repeat(450)]),
    ),
  ]) {
    assert.throws(() => validateMetadata(invalid), { code: "INVALID_INPUT" });
    await assert.rejects(
      service.startContribution("work", submission, randomUUID(), invalid),
      { code: "INVALID_INPUT" },
    );
  }
  assert.equal((await f.store.listContributions()).length, 1);
});

test("an effect is scheduled once on confirmation and delivered with a stable identity", async (t) => {
  const f = await fixture(t);
  const service = f.service();
  const key = randomUUID();
  await service.startContribution("work", submission, key);
  const stored = await f.store.getBySubmissionKey(key);
  assert.deepEqual(await service.runEffects({ limit: 10 }), {
    succeeded: 0,
    retrying: 0,
    failed: 0,
  });
  await service.acceptWebhook(...delivery(stored));
  await service.acceptWebhook(...delivery(stored, "evt_2"));
  assert.equal((await f.store.listEffects()).length, 1);
  assert.deepEqual(await service.runEffects({ limit: 10 }), {
    succeeded: 1,
    retrying: 0,
    failed: 0,
  });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].id, `${stored.intent.id}:thank-you`);
  assert.equal(f.calls[0].contribution.outcome, "confirmed");
  assert.deepEqual(await service.runEffects({ limit: 10 }), {
    succeeded: 0,
    retrying: 0,
    failed: 0,
  });
  assert.equal((await f.store.listEffects())[0].state, "succeeded");
});

test("failed effects retry with backoff, stop at the limit, never change the payment, and each owner retry is one more attempt", async (t) => {
  let failures = 3;
  const f = await fixture(t, {
    handler: async () => {
      if (failures-- > 0)
        throw Object.assign(new Error("private detail"), { code: "MAIL_DOWN" });
    },
  });
  const service = f.service();
  const key = randomUUID();
  const access = await service.startContribution("work", submission, key);
  await service.acceptWebhook(
    ...delivery(await f.store.getBySubmissionKey(key)),
  );
  assert.deepEqual(await service.runEffects({ limit: 10 }), {
    succeeded: 0,
    retrying: 1,
    failed: 0,
  });
  assert.deepEqual(await service.runEffects({ limit: 10 }), {
    succeeded: 0,
    retrying: 0,
    failed: 0,
  });
  f.setTime(initialTime + 1000);
  assert.deepEqual(await service.runEffects({ limit: 10 }), {
    succeeded: 0,
    retrying: 0,
    failed: 1,
  });
  const [failed] = await service.owner.listEffects(ownerRequest, {
    state: "failed",
  });
  assert.deepEqual([failed.attempts, failed.lastError], [2, "MAIL_DOWN"]);
  assert.equal(JSON.stringify(failed).includes("private detail"), false);
  assert.equal(
    (
      await service.getStatus(
        access.contribution.contributionId,
        access.resultToken,
      )
    ).outcome,
    "confirmed",
  );
  assert.equal((await service.owner.summary(ownerRequest)).effects.failed, 1);
  await assert.rejects(
    service.owner.retryEffect(
      ownerRequest,
      access.contribution.contributionId,
      "unknown",
    ),
    { code: "NOT_FOUND" },
  );
  assert.equal(
    (
      await service.owner.retryEffect(
        ownerRequest,
        access.contribution.contributionId,
        "thank-you",
      )
    ).state,
    "pending",
  );
  await assert.rejects(
    service.owner.retryEffect(
      ownerRequest,
      access.contribution.contributionId,
      "thank-you",
    ),
    { code: "INVALID_STATE" },
  );
  assert.deepEqual(await service.runEffects({ limit: 10 }), {
    succeeded: 0,
    retrying: 0,
    failed: 1,
  });
  await service.owner.retryEffect(
    ownerRequest,
    access.contribution.contributionId,
    "thank-you",
  );
  assert.deepEqual(await service.runEffects({ limit: 10 }), {
    succeeded: 1,
    retrying: 0,
    failed: 0,
  });
  assert.deepEqual(
    f.calls.map((call) => call.attempt),
    [1, 2, 3, 4],
  );
});

test("an abandoned effect attempt is reclaimed after its lease and the stale result is ignored", async (t) => {
  const f = await fixture(t);
  const service = f.service();
  const key = randomUUID();
  await service.startContribution("work", submission, key);
  await service.acceptWebhook(
    ...delivery(await f.store.getBySubmissionKey(key)),
  );
  const crashed = await f.store.claimEffect(initialTime, initialTime + 5000);
  assert.equal(crashed.attempt, 1);
  f.close(f.store);
  const reopened = await f.open();
  const restarted = f.service({ store: reopened });
  assert.deepEqual(await restarted.runEffects({ limit: 10 }), {
    succeeded: 0,
    retrying: 0,
    failed: 0,
  });
  f.setTime(initialTime + 5000);
  assert.deepEqual(await restarted.runEffects({ limit: 10 }), {
    succeeded: 1,
    retrying: 0,
    failed: 0,
  });
  await reopened.settleEffect(crashed, {
    succeeded: false,
    error: "LATE",
    retryAt: null,
  });
  assert.deepEqual(
    [
      (await reopened.listEffects())[0].state,
      (await reopened.listEffects())[0].attempts,
    ],
    ["succeeded", 2],
  );
});

test("owner acceptance of a review schedules effects; configuration must match the store", async (t) => {
  const f = await fixture(t);
  const service = f.service();
  const key = randomUUID();
  await service.startContribution("work", submission, key);
  const stored = await f.store.getBySubmissionKey(key);
  await service.acceptWebhook(
    ...delivery(stored, "evt_1", { amount: "2400.00" }),
  );
  await service.acceptWebhook(
    ...delivery(stored, "evt_2", { charge_id: "ch_2" }),
  );
  assert.equal(
    (await f.store.getContribution(stored.intent.id)).outcome,
    "needs_review",
  );
  assert.equal((await f.store.listEffects()).length, 0);
  await service.owner.acceptReview(
    ownerRequest,
    stored.intent.id,
    "Checked in Bachs",
  );
  assert.equal((await f.store.listEffects()).length, 1);
  for (const effects of [
    undefined,
    { ...retry, handlers: {} },
    {
      ...retry,
      handlers: { "thank-you": async () => {}, other: async () => {} },
    },
    { ...retry, handlers: { "thank-you": "no" } },
    { ...retry, maxAttempts: 0, handlers: { "thank-you": async () => {} } },
    { ...retry, retryDelayMs: 10, handlers: { "thank-you": async () => {} } },
  ]) {
    assert.throws(() => f.service({ effects }), {
      code: "INVALID_CONFIGURATION",
    });
  }
  await assert.rejects(
    openStore({
      ...scope,
      installationId: "x",
      database: (await hostDatabase(t, "sqlite")).connect().database,
      effects: ["Bad Name"],
    }),
    { code: "INVALID_CONFIGURATION" },
  );
});

test("HTTP passes browser metadata through validation and exposes owner effect routes", async (t) => {
  const f = await fixture(t, {
    handler: async () => {
      throw new Error("down");
    },
  });
  const service = f.service();
  const handler = createSupportHandler(service, {
    basePath: "/api",
    allowedOrigins: ["https://site.example"],
    clientKey: () => "client",
  });
  const post = (path, body) =>
    handler(
      new Request(`https://site.example/api${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://site.example",
        },
        body: JSON.stringify(body),
      }),
    );
  const bad = await post("/contributions", {
    contextId: "work",
    submission,
    submissionKey: randomUUID(),
    metadata: { nested: {} },
  });
  assert.deepEqual(
    [bad.status, await bad.json()],
    [400, { error: "invalid_input" }],
  );
  const key = randomUUID();
  assert.equal(
    (
      await post("/contributions", {
        contextId: "work",
        submission,
        submissionKey: key,
        metadata: { entry_point: "page" },
      })
    ).status,
    201,
  );
  await service.acceptWebhook(
    ...delivery(await f.store.getBySubmissionKey(key)),
  );
  await service.runEffects({ limit: 1 });
  f.setTime(initialTime + 1000);
  await service.runEffects({ limit: 1 });
  const listed = await (
    await handler(
      new Request("https://site.example/api/owner/effects?state=failed"),
    )
  ).json();
  assert.equal(listed.length, 1);
  const id = (await f.store.getBySubmissionKey(key)).intent.id;
  const retried = await post(`/owner/effects/${id}/thank-you/retry`, {});
  assert.equal((await retried.json()).state, "pending");
});
