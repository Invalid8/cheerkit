import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import {
  createBachsCheckoutClient,
  createBachsClient,
  createBachsWebhookVerifier,
} from "cheerkit/bachs";
import {
  createOwnerService,
  createSupportService,
  openStore,
} from "cheerkit/server";
import { hostDatabase } from "./helpers.mjs";

const initialTime = Date.parse("2026-09-24T12:00:00Z");
const scope = { organizationId: "acct_owner", environment: "sandbox" };
const context = {
  id: "work",
  name: "My work",
  collectName: true,
  collectMessage: true,
  currencies: [{ currency: "NGN", fractionDigits: 2, minimum: "100" }],
};
const submission = {
  amount: "2500",
  currency: "NGN",
  supporterName: "Private name",
  message: "Private message",
};
const resultSecret = "synthetic-result-secret-32-characters";
const retention = { supporterDataDays: 30 };
const ownerRequest = new Request("https://example.test/owner");

async function fixture(t, transport) {
  const host = await hostDatabase(t, "sqlite");
  let time = initialTime;
  let calls = 0;
  const providerRecords = new Map();
  const methods = [];
  const posts = [];
  const open = async () => {
    const connection = host.connect();
    const store = await openStore({
      ...scope,
      installationId: "service-test",
      database: connection.database,
    });
    if (!(await store.getContext(context.id)))
      await store.putContext(context, null);
    return { ...store, connection };
  };
  const store = await open();
  const client = (secretKey = "sk_sandbox_fixture") =>
    createBachsCheckoutClient({
      ...scope,
      secretKey,
      successUrl: "https://example.test/result",
      cancelUrl: "https://example.test/support",
      fetch: async (_url, init) => {
        methods.push(init.method);
        if (init.method === "GET") {
          const response = providerRecords.get(
            decodeURIComponent(new URL(_url).pathname.split("/").at(-1)),
          );
          return response
            ? Response.json(response)
            : new Response(null, { status: 404 });
        }
        calls++;
        posts.push({ key: init.headers["Idempotency-Key"], body: init.body });
        const body = JSON.parse(init.body);
        const response = {
          checkout_id: `chk_${body.reference}`,
          reference: body.reference,
          checkout_url: "https://checkout.example.test/pay",
          status: "open",
          created_at: new Date(time).toISOString(),
          expires_at: new Date(time + 3600000).toISOString(),
        };
        providerRecords.set(response.checkout_id, {
          ...response,
          amount: body.pricing.amount,
          currency: body.pricing.currency,
          success_url: body.success_url,
          cancel_url: body.cancel_url,
          customer: { email: "private@example.test" },
        });
        return transport ? transport(response, init) : Response.json(response);
      },
    });
  const checkout = client();
  const webhooks = createBachsWebhookVerifier({
    ...scope,
    secret: "fixture-webhook",
    now: () => time,
  });
  const service = (overrides = {}) =>
    createSupportService({
      store,
      checkout,
      webhooks,
      resultSecret,
      retention,
      now: () => time,
      ...overrides,
    });
  return {
    host,
    store,
    open,
    service,
    checkout,
    client,
    webhooks,
    providerRecords,
    methods,
    posts,
    get calls() {
      return calls;
    },
    setTime(value) {
      time = value;
    },
    close(connection) {
      connection.connection.raw.close();
    },
  };
}

function delivery(stored, overrides = {}, id = "evt_1") {
  const raw = Buffer.from(
    JSON.stringify({
      id,
      type: "collection.succeeded",
      organization_id: scope.organizationId,
      created_at: new Date(initialTime).toISOString(),
      data: {
        checkout_id: `chk_${stored.request.reference}`,
        reference: stored.request.reference,
        charge_id: "charge_private",
        status: "succeeded",
        amount: "2500.00",
        currency: "NGN",
        settlement_currency: "NGN",
        payer: { email: "private@example.test" },
        ...overrides,
      },
    }),
  );
  const timestamp = initialTime / 1000;
  const digest = createHmac("sha256", "fixture-webhook")
    .update(`${timestamp}.`)
    .update(raw)
    .digest("hex");
  return [raw, { signatureV2: `t=${timestamp},v1=${digest}` }];
}
function signed(id, type, data, at = initialTime) {
  const raw = Buffer.from(
    JSON.stringify({
      id,
      type,
      organization_id: scope.organizationId,
      created_at: new Date(at).toISOString(),
      data,
    }),
  );
  const timestamp = at / 1000;
  return [
    raw,
    {
      signatureV2: `t=${timestamp},v1=${createHmac("sha256", "fixture-webhook").update(`${timestamp}.`).update(raw).digest("hex")}`,
    },
  ];
}
async function until(condition) {
  for (let tries = 0; !condition(); tries++) {
    if (tries > 500) throw new Error("Condition not reached.");
    await new Promise((resolve) => setImmediate(resolve));
  }
}
const ownerCalls = (owner) => [
  () => owner.listContributions(ownerRequest),
  () => owner.getContribution(ownerRequest, "missing"),
  () => owner.listContexts(ownerRequest),
  () => owner.putContext(ownerRequest, { ...context, name: "Edited" }, 1),
  () => owner.listEvents(ownerRequest),
  () => owner.recoverCheckout(ownerRequest, "missing", "candidate"),
  () => owner.resendNotices(ownerRequest, "missing"),
  () => owner.refreshPaymentDetails(ownerRequest, "missing"),
  () => owner.retryCheckout(ownerRequest, "missing"),
  () => owner.acceptReview(ownerRequest, "missing", "note"),
  () => owner.recordExternalReturn(ownerRequest, "missing", "1", "note"),
  () => owner.dismissEvent(ownerRequest, "missing", "note"),
  () => owner.reopenEvent(ownerRequest, "missing"),
  () => owner.recheckEvent(ownerRequest, "missing"),
  () => owner.summary(ownerRequest),
  () => owner.listEffects(ownerRequest),
  () => owner.retryEffect(ownerRequest, "missing", "thank-you"),
  () => owner.removePersonalData(ownerRequest, "missing"),
  () => owner.exportData(ownerRequest),
];
for (const [name, authorizeOwner] of [
  ["missing", undefined],
  ["false", () => false],
  ["truthy", () => "yes"],
  [
    "throwing",
    () => {
      throw new Error("private auth detail");
    },
  ],
  [
    "rejecting",
    async () => {
      throw new Error("private auth detail");
    },
  ],
]) {
  test(`every owner operation denies ${name} authorization before storage`, async (t) => {
    const f = await fixture(t);
    const store = new Proxy(f.store, {
      get(target, property) {
        if (typeof target[property] === "function")
          return () => assert.fail("Unauthorized storage access");
        return target[property];
      },
    });
    for (const call of ownerCalls(f.service({ store, authorizeOwner }).owner)) {
      await assert.rejects(call, {
        code: "UNAUTHORIZED",
        message: "Owner access is required.",
      });
    }
  });
}

test("authorized owner operations receive the request and expose private records with revision checks", async (t) => {
  const f = await fixture(t);
  let authorizations = 0;
  const service = f.service({
    authorizeOwner: async (request) => {
      assert.equal(request, ownerRequest);
      authorizations++;
      return true;
    },
  });
  const access = await service.startContribution(
    "work",
    submission,
    randomUUID(),
  );
  assert.equal(
    (await service.owner.listContributions(ownerRequest))[0].intent.message,
    submission.message,
  );
  assert.equal(
    (
      await service.owner.getContribution(
        ownerRequest,
        access.contribution.contributionId,
      )
    ).intent.supporterName,
    submission.supporterName,
  );
  assert.equal((await service.owner.listContexts(ownerRequest)).length, 1);
  assert.equal(
    (
      await service.owner.putContext(
        ownerRequest,
        { ...context, name: "Edited" },
        1,
      )
    ).revision,
    2,
  );
  assert.deepEqual(await service.owner.listEvents(ownerRequest), []);
  await assert.rejects(service.owner.putContext(ownerRequest, context, 1), {
    code: "CONFLICT",
  });
  assert.equal(authorizations, 6);
});

test("concurrent service instances share one durable request and uppercase UUID retries reuse it", async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, async (response) => {
    await gate;
    return Response.json(response);
  });
  const key = randomUUID();
  const first = f.service().startContribution("work", submission, key);
  await until(() => f.calls === 1);
  const second = await f
    .service({ store: await f.open() })
    .startContribution("work", submission, key.toUpperCase());
  assert.equal(second.contribution.outcome, "pending");
  assert.equal(second.contribution.checkoutUrl, undefined);
  release();
  const ready = await first;
  assert.equal(
    ready.contribution.contributionId,
    second.contribution.contributionId,
  );
  assert.equal(f.calls, 1);
  assert.equal((await f.store.listContributions()).length, 1);
});

test("changed amount or context conflicts; the key keeps its original name and message", async (t) => {
  const f = await fixture(t);
  const service = f.service();
  const key = randomUUID();
  const first = await service.startContribution("work", submission, key);
  assert.equal(
    (
      await service.startContribution(
        "work",
        { ...submission, amount: "2500.00" },
        key,
      )
    ).contribution.contributionId,
    first.contribution.contributionId,
  );
  await assert.rejects(
    service.startContribution("work", { ...submission, amount: "3000" }, key),
    { code: "CONFLICT" },
  );
  assert.equal(
    (
      await service.startContribution(
        "work",
        { ...submission, message: "Changed" },
        key,
      )
    ).contribution.contributionId,
    first.contribution.contributionId,
  );
  assert.equal(
    (await f.store.getBySubmissionKey(key)).intent.message,
    "Private message",
  );
  await assert.rejects(service.startContribution("another", submission, key), {
    code: "CONFLICT",
  });
  assert.equal(f.calls, 1);
});

test("archival and edited rules stop new submissions but preserve retries and confirmation", async (t) => {
  const f = await fixture(t);
  const service = f.service();
  const key = randomUUID();
  const first = await service.startContribution("work", submission, key);
  await f.store.putContext(
    { ...context, acceptingContributions: false, collectMessage: false },
    1,
  );
  assert.deepEqual(
    (await service.startContribution("work", submission, key)).contribution,
    first.contribution,
  );
  await assert.rejects(
    service.startContribution("work", submission, randomUUID()),
    { code: "CONTEXT_CLOSED" },
  );
  await service.acceptWebhook(
    ...delivery(await f.store.getBySubmissionKey(key)),
  );
  assert.equal(
    (
      await service.getStatus(
        first.contribution.contributionId,
        first.resultToken,
      )
    ).outcome,
    "confirmed",
  );
});

for (const [status, state] of [
  [503, "uncertain"],
  [409, "uncertain"],
]) {
  test(`provider ${status} persists ${state}; a retry after restart resends the stored request`, async (t) => {
    const f = await fixture(
      t,
      () => new Response("private provider failure", { status }),
    );
    const key = randomUUID();
    const first = await f.service().startContribution("work", submission, key);
    assert.equal(first.contribution.outcome, "pending");
    assert.equal(first.contribution.checkoutUrl, undefined);
    assert.equal((await f.store.getBySubmissionKey(key)).attemptState, state);
    f.close(f.store);
    const restarted = f.service({ store: await f.open() });
    assert.deepEqual(
      (await restarted.startContribution("work", submission, key)).contribution,
      first.contribution,
    );
    assert.equal(f.calls, 2);
    assert.deepEqual(f.posts[1], f.posts[0]);
  });
}

test("a rejected attempt is shown as unsuccessful and a retry opens a new attempt with a new key", async (t) => {
  let reject = true;
  const f = await fixture(t, (response) =>
    reject
      ? new Response("private provider failure", { status: 422 })
      : Response.json(response),
  );
  const key = randomUUID();
  const first = await f.service().startContribution("work", submission, key);
  assert.equal(first.contribution.outcome, "unsuccessful");
  reject = false;
  f.close(f.store);
  const reopened = await f.open();
  const service = f.service({ store: reopened });
  const retried = await service.startContribution("work", submission, key);
  assert.equal(
    retried.contribution.contributionId,
    first.contribution.contributionId,
  );
  assert.equal(retried.contribution.outcome, "pending");
  assert.equal(
    retried.contribution.checkoutUrl,
    "https://checkout.example.test/pay",
  );
  assert.notEqual(f.posts[1].key, f.posts[0].key);
  assert.deepEqual(
    (await reopened.getBySubmissionKey(key)).attempts.map(
      (attempt) => attempt.state,
    ),
    ["rejected", "available"],
  );
  await service.startContribution("work", submission, key);
  assert.equal(f.calls, 2);
});

test("transport failure remains uncertain", async (t) => {
  const f = await fixture(t, () => {
    throw new Error("private transport detail");
  });
  const key = randomUUID();
  const access = await f.service().startContribution("work", submission, key);
  assert.equal(access.contribution.outcome, "pending");
  assert.equal(
    (await f.store.getBySubmissionKey(key)).attemptState,
    "uncertain",
  );
});

test("public projections exclude private content, payment identities, and unrelated contributions", async (t) => {
  const f = await fixture(t);
  const service = f.service();
  const key = randomUUID();
  const first = await service.startContribution("work", submission, key);
  const other = await service.startContribution(
    "work",
    { amount: "9000", currency: "NGN" },
    randomUUID(),
  );
  assert.deepEqual(Object.keys(first).sort(), [
    "contribution",
    "expiresAt",
    "resultToken",
  ]);
  assert.deepEqual(Object.keys(first.contribution).sort(), [
    "amount",
    "checkoutUrl",
    "contextId",
    "contributionId",
    "currency",
    "outcome",
  ]);
  assert.equal(Object.isFrozen(first.contribution), true);
  assert.deepEqual(
    await service.acceptWebhook(
      ...delivery(await f.store.getBySubmissionKey(key)),
    ),
    { receipt: "accepted", processing: "applied" },
  );
  const result = await service.getStatus(
    first.contribution.contributionId,
    first.resultToken,
  );
  assert.deepEqual(result, {
    contributionId: first.contribution.contributionId,
    contextId: "work",
    amount: "2500.00",
    currency: "NGN",
    outcome: "confirmed",
  });
  for (const privateValue of [
    submission.message,
    submission.supporterName,
    "private@example.test",
    "charge_private",
    other.contribution.contributionId,
    resultSecret,
  ]) {
    assert.equal(JSON.stringify([first, result]).includes(privateValue), false);
  }
  assert.deepEqual(
    await service.acceptWebhook(
      ...delivery(await f.store.getBySubmissionKey(key)),
    ),
    { receipt: "duplicate", processing: "applied" },
  );
  assert.equal((await f.store.getBySubmissionKey(key)).payments.length, 1);
});

test("result tokens enforce tampering, expiry, contribution scope, secret rotation, and malformed input", async (t) => {
  const f = await fixture(t);
  const service = f.service();
  const first = await service.startContribution(
    "work",
    submission,
    randomUUID(),
  );
  const id = first.contribution.contributionId;
  assert.equal(Date.parse(first.expiresAt), initialTime + 30 * 86400000);
  assert.ok(await service.getStatus(id, first.resultToken));
  for (const token of [
    null,
    {},
    "",
    "x".repeat(1000),
    `${first.resultToken}A`,
    first.resultToken.replace(/^./, "9"),
    `${first.resultToken.split(".")[0]}.${"A".repeat(43)}`,
  ]) {
    assert.equal(await service.getStatus(id, token), null);
  }
  for (const wrongId of [null, {}, "", "x".repeat(129), randomUUID()])
    assert.equal(await service.getStatus(wrongId, first.resultToken), null);
  assert.equal(
    await f
      .service({ resultSecret: "different-secret-with-at-least-32-characters" })
      .getStatus(id, first.resultToken),
    null,
  );
  f.setTime(Date.parse(first.expiresAt) - 1);
  assert.ok(await service.getStatus(id, first.resultToken));
  f.setTime(Date.parse(first.expiresAt));
  assert.equal(await service.getStatus(id, first.resultToken), null);
});

test("noncanonical signature encodings are rejected", async (t) => {
  const f = await fixture(t);
  const service = f.service();
  const access = await service.startContribution(
    "work",
    submission,
    randomUUID(),
  );
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const token = access.resultToken;
  const altered =
    token.slice(0, -1) + alphabet[alphabet.indexOf(token.at(-1)) + 1];
  assert.equal(
    await service.getStatus(access.contribution.contributionId, altered),
    null,
  );
});

test("expired checkout URLs disappear without claiming payment failure", async (t) => {
  const f = await fixture(t);
  const service = f.service();
  const access = await service.startContribution(
    "work",
    submission,
    randomUUID(),
  );
  f.setTime(initialTime + 3600000);
  const status = await service.getStatus(
    access.contribution.contributionId,
    access.resultToken,
  );
  assert.equal(status.outcome, "pending");
  assert.equal(status.checkoutUrl, undefined);
});

test("invalid configuration fails before any reservation or provider request", async (t) => {
  const f = await fixture(t);
  for (const overrides of [
    { resultSecret: "" },
    { resultSecret: 42 },
    { resultLifetimeSeconds: 59 },
    { resultLifetimeSeconds: 31536001 },
    { resultLifetimeSeconds: NaN },
    { resultLifetimeSeconds: 60.5 },
    { now: 42 },
    { now: () => NaN },
    { now: () => -1 },
    { now: () => Number.MAX_SAFE_INTEGER },
    { authorizeOwner: true },
    { checkout: { ...f.checkout, environment: "live" } },
    { checkout: { ...f.checkout, organizationId: "other" } },
    { webhooks: { ...f.webhooks, environment: "live" } },
    { webhooks: { ...f.webhooks, organizationId: "other" } },
    { retention: undefined },
    { retention: { supporterDataDays: 0 } },
    { retention: { supporterDataDays: 1.5 } },
  ])
    assert.throws(() => f.service(overrides), {
      code: "INVALID_CONFIGURATION",
    });
  assert.equal(f.calls, 0);
  assert.deepEqual(await f.store.listContributions(), []);
});

test("custom result lifetime and malformed initiation requests", async (t) => {
  const f = await fixture(t);
  const service = f.service({ resultLifetimeSeconds: 60 });
  for (const key of [
    "",
    null,
    "guessable",
    "00000000-0000-0000-0000-000000000000",
  ]) {
    await assert.rejects(service.startContribution("work", submission, key), {
      code: "INVALID_REQUEST",
    });
  }
  await assert.rejects(
    service.startContribution("absent", submission, randomUUID()),
    { code: "NOT_FOUND" },
  );
  const access = await service.startContribution(
    "work",
    submission,
    randomUUID(),
  );
  assert.equal(Date.parse(access.expiresAt), initialTime + 60000);
});

test("early webhook survives restart and reconciles after association through pending processing", async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, async (response) => {
    await gate;
    return Response.json(response);
  });
  const service = f.service();
  const key = randomUUID();
  const pending = service.startContribution("work", submission, key);
  await until(() => f.calls === 1);
  const stored = await f.store.getBySubmissionKey(key);
  assert.deepEqual(await service.acceptWebhook(...delivery(stored)), {
    receipt: "accepted",
    processing: "pending",
  });
  release();
  const access = await pending;
  f.close(f.store);
  const reopened = await f.open();
  const restarted = f.service({ store: reopened });
  assert.equal(
    (await restarted.processPending({ limit: 1 }))[0].state,
    "applied",
  );
  assert.deepEqual(await restarted.processPending(), []);
  assert.equal(
    (
      await restarted.getStatus(
        access.contribution.contributionId,
        access.resultToken,
      )
    ).outcome,
    "confirmed",
  );
});

test("provider acceptance followed by failed local association preserves creating across restart", async (t) => {
  const f = await fixture(t);
  const key = randomUUID();
  const store = {
    ...f.store,
    recordCheckout() {
      throw new Error("simulated storage failure");
    },
  };
  await assert.rejects(
    f.service({ store }).startContribution("work", submission, key),
    /simulated storage failure/,
  );
  assert.equal(
    (await f.store.getBySubmissionKey(key)).attemptState,
    "creating",
  );
  f.close(f.store);
  const reopened = await f.open();
  const service = f.service({ store: reopened });
  const access = await service.startContribution("work", submission, key);
  assert.equal(access.contribution.outcome, "pending");
  assert.equal(access.contribution.checkoutUrl, undefined);
  assert.equal(f.calls, 1);
  assert.equal(
    (
      await service.acceptWebhook(
        ...delivery(await reopened.getBySubmissionKey(key)),
      )
    ).processing,
    "pending",
  );
  assert.equal((await reopened.getBySubmissionKey(key)).payments.length, 0);
});

test("processing failure leaves accepted evidence durable for a restarted worker", async (t) => {
  const f = await fixture(t);
  const key = randomUUID();
  await f.service().startContribution("work", submission, key);
  const store = {
    ...f.store,
    processEvent() {
      throw new Error("simulated processing failure");
    },
  };
  await assert.rejects(
    f
      .service({ store })
      .acceptWebhook(...delivery(await f.store.getBySubmissionKey(key))),
    /simulated processing failure/,
  );
  assert.equal((await f.store.getEvent("evt_1")).state, "pending");
  f.close(f.store);
  const restarted = f.service({ store: await f.open() });
  assert.equal((await restarted.processPending())[0].state, "applied");
});

test("invalid signatures never reach durable inbox acceptance", async (t) => {
  const f = await fixture(t);
  const service = f.service();
  const key = randomUUID();
  await service.startContribution("work", submission, key);
  const [raw, headers] = delivery(await f.store.getBySubmissionKey(key));
  await assert.rejects(
    service.acceptWebhook(Buffer.concat([raw, Buffer.from(" ")]), headers),
    { code: "INVALID_SIGNATURE" },
  );
  assert.deepEqual(await f.store.listEvents(), []);
});

test("historical uppercase submission keys reuse their original reservation", async (t) => {
  const f = await fixture(t);
  const service = f.service();
  const key = randomUUID();
  const { createContributionIntent, defineSupportContext } =
    await import("cheerkit");
  const intent = createContributionIntent(
    defineSupportContext(context),
    submission,
    { id: randomUUID(), createdAt: new Date(initialTime).toISOString() },
  );
  const prepared = f.checkout.prepareCheckout(intent, {
    reference: "historical-reference",
    idempotencyKey: "historical-operation",
  });
  await f.store.reserve(intent, prepared, key.toUpperCase());
  const access = await service.startContribution("work", submission, key);
  assert.equal(access.contribution.contributionId, intent.id);
  assert.equal((await f.store.listContributions()).length, 1);
  assert.equal(f.calls, 1);
});

test("owner recovers lost association after restart; only signed collection confirms payment", async (t) => {
  const f = await fixture(t);
  const key = randomUUID();
  const failingStore = {
    ...f.store,
    recordCheckout() {
      throw new Error("lost association");
    },
  };
  await assert.rejects(
    f
      .service({ store: failingStore })
      .startContribution("work", submission, key),
    /lost association/,
  );
  const original = await f.store.getBySubmissionKey(key);
  const candidate = `chk_${original.request.reference}`;
  f.providerRecords.get(candidate).status = "completed";
  f.close(f.store);
  const reopened = await f.open();
  const service = f.service({ store: reopened, authorizeOwner: () => true });
  const recovered = await service.owner.recoverCheckout(
    ownerRequest,
    original.intent.id,
    candidate,
  );
  assert.equal(recovered.outcome, "pending");
  assert.deepEqual(recovered.payments, []);
  assert.equal(recovered.attemptState, "available");
  assert.equal(recovered.checkout.url, undefined);
  assert.equal(
    JSON.stringify(recovered).includes("private@example.test"),
    false,
  );
  assert.deepEqual(f.methods, ["POST", "GET"]);
  assert.equal(
    (await service.acceptWebhook(...delivery(original))).processing,
    "applied",
  );
  f.close(reopened);
  const after = await f.open();
  const restarted = f.service({ store: after, authorizeOwner: () => true });
  assert.equal(
    (await after.getContribution(original.intent.id)).outcome,
    "confirmed",
  );
  await restarted.owner.recoverCheckout(
    ownerRequest,
    original.intent.id,
    candidate,
  );
  assert.equal(
    (await after.getContribution(original.intent.id)).payments.length,
    1,
  );
  assert.equal(
    (await restarted.acceptWebhook(...delivery(original))).receipt,
    "duplicate",
  );
  assert.equal(f.calls, 1);
});

test("recovery failures preserve uncertainty; concurrent recovery unblocks the durable inbox", async (t) => {
  const f = await fixture(t, () => {
    throw new Error("lost provider response");
  });
  const key = randomUUID();
  const access = await f.service().startContribution("work", submission, key);
  const stored = await f.store.getBySubmissionKey(key);
  const candidate = `chk_${stored.request.reference}`;
  const service = f.service({ authorizeOwner: () => true });
  assert.equal(
    (await service.acceptWebhook(...delivery(stored))).processing,
    "pending",
  );
  await assert.rejects(
    service.owner.recoverCheckout(ownerRequest, stored.intent.id, "missing"),
    { code: "RECOVERY_FAILED" },
  );
  const original = f.providerRecords.get(candidate);
  f.providerRecords.set(candidate, {
    ...original,
    reference: "wrong-reference",
  });
  await assert.rejects(
    service.owner.recoverCheckout(ownerRequest, stored.intent.id, candidate),
    { code: "RECOVERY_FAILED" },
  );
  assert.equal(
    (await f.store.getContribution(stored.intent.id)).attemptState,
    "uncertain",
  );
  assert.equal((await f.store.getEvent("evt_1")).state, "pending");
  f.providerRecords.set(candidate, original);
  const second = f.service({
    store: await f.open(),
    authorizeOwner: () => true,
  });
  await Promise.all([
    service.owner.recoverCheckout(ownerRequest, stored.intent.id, candidate),
    second.owner.recoverCheckout(ownerRequest, stored.intent.id, candidate),
  ]);
  assert.equal(
    (await service.getStatus(stored.intent.id, access.resultToken)).checkoutUrl,
    undefined,
  );
  assert.equal((await service.processPending())[0].state, "applied");
  assert.deepEqual(await second.processPending(), []);
  assert.equal(
    (await f.store.getContribution(stored.intent.id)).payments.length,
    1,
  );
  assert.equal(f.calls, 1);
});

test("recovery refuses missing, undispatched, rejected, and conflicting contributions before retrieval", async (t) => {
  const f = await fixture(t);
  const service = f.service({ authorizeOwner: () => true });
  await assert.rejects(
    service.owner.recoverCheckout(ownerRequest, "missing", "candidate"),
    { code: "NOT_FOUND" },
  );
  const { createContributionIntent, defineSupportContext } =
    await import("cheerkit");
  const intent = createContributionIntent(
    defineSupportContext(context),
    submission,
    { id: randomUUID(), createdAt: new Date(initialTime).toISOString() },
  );
  await f.store.reserve(
    intent,
    f.checkout.prepareCheckout(intent, {
      reference: "prepared-only",
      idempotencyKey: "prepared-only",
    }),
    randomUUID(),
  );
  await assert.rejects(
    service.owner.recoverCheckout(ownerRequest, intent.id, "candidate"),
    { code: "INVALID_STATE" },
  );
  await f.store.claimCheckout(intent.id, {
    credential: await f.checkout.credentialFingerprint(),
    at: initialTime,
    retryUntil: initialTime + 1,
    leaseUntil: initialTime + 1,
  });
  await f.store.recordCheckoutFailure(intent.id, "rejected");
  await assert.rejects(
    service.owner.recoverCheckout(ownerRequest, intent.id, "candidate"),
    { code: "INVALID_STATE" },
  );
  const access = await service.startContribution(
    "work",
    submission,
    randomUUID(),
  );
  await assert.rejects(
    service.owner.recoverCheckout(
      ownerRequest,
      access.contribution.contributionId,
      "other",
    ),
    { code: "CONFLICT" },
  );
  assert.deepEqual(f.methods, ["POST"]);
});

test("store rejects fabricated or cloned recovery evidence and preserves existing checkout URLs", async (t) => {
  const f = await fixture(t);
  const key = randomUUID();
  await f.service().startContribution("work", submission, key);
  const stored = await f.store.getBySubmissionKey(key);
  const recovered = await f.checkout.retrieveCheckout(
    stored.checkout.id,
    stored.request,
  );
  await assert.rejects(
    f.store.recordRecoveredCheckout(stored.intent.id, { ...recovered }),
    { code: "RECOVERY_FAILED" },
  );
  await f.store.recordRecoveredCheckout(stored.intent.id, recovered);
  assert.equal(
    (await f.store.getContribution(stored.intent.id)).checkout.url,
    stored.checkout.url,
  );
  const other = await f
    .service()
    .startContribution("work", submission, randomUUID());
  await assert.rejects(
    f.store.recordRecoveredCheckout(
      other.contribution.contributionId,
      recovered,
    ),
    { code: "CONFLICT" },
  );
});

test("recovery association rolls back on storage failure and can be retrieved again after restart", async (t) => {
  const f = await fixture(t, () => {
    throw new Error("lost response");
  });
  const key = randomUUID();
  await f.service().startContribution("work", submission, key);
  const stored = await f.store.getBySubmissionKey(key);
  const candidate = `chk_${stored.request.reference}`;
  const database = f.store.connection.raw;
  {
    database.exec(
      "CREATE TRIGGER recovery_failure BEFORE UPDATE OF checkout_id ON cheerkit_attempts BEGIN SELECT RAISE(ABORT, 'injected'); END",
    );
    await assert.rejects(
      f
        .service({ authorizeOwner: () => true })
        .owner.recoverCheckout(ownerRequest, stored.intent.id, candidate),
      { code: "STORAGE_FAILURE" },
    );
    assert.equal(
      (await f.store.getContribution(stored.intent.id)).checkout,
      null,
    );
    assert.equal(
      (await f.store.getContribution(stored.intent.id)).attemptState,
      "uncertain",
    );
    database.exec("DROP TRIGGER recovery_failure");
  }
  f.close(f.store);
  const service = f.service({
    store: await f.open(),
    authorizeOwner: () => true,
  });
  assert.equal(
    (
      await service.owner.recoverCheckout(
        ownerRequest,
        stored.intent.id,
        candidate,
      )
    ).checkout.id,
    candidate,
  );
  assert.equal(f.calls, 1);
});

test("recovery evidence from another declared organization is rejected by storage", async (t) => {
  const f = await fixture(t);
  const key = randomUUID();
  await f.service().startContribution("work", submission, key);
  const stored = await f.store.getBySubmissionKey(key);
  const recovered = await f.checkout.retrieveCheckout(
    stored.checkout.id,
    stored.request,
  );
  const otherHost = await hostDatabase(t, "sqlite");
  const other = await openStore({
    database: otherHost.connect().database,
    installationId: "other",
    organizationId: "another-owner",
    environment: "sandbox",
  });
  await assert.rejects(
    other.recordRecoveredCheckout(stored.intent.id, recovered),
    { code: "WRONG_ACCOUNT" },
  );
});

test("lost checkout response is recovered by resending the same request within the retry window", async (t) => {
  let fail = true;
  const f = await fixture(t, (response) => {
    if (fail) throw new Error("lost response");
    return Response.json(response);
  });
  const key = randomUUID();
  const first = await f.service().startContribution("work", submission, key);
  assert.equal(
    (await f.store.getBySubmissionKey(key)).attemptState,
    "uncertain",
  );
  fail = false;
  f.close(f.store);
  const reopened = await f.open();
  const service = f.service({ store: reopened });
  f.setTime(initialTime + 60000);
  const retried = await service.startContribution("work", submission, key);
  assert.equal(
    retried.contribution.contributionId,
    first.contribution.contributionId,
  );
  assert.equal(
    retried.contribution.checkoutUrl,
    "https://checkout.example.test/pay",
  );
  assert.deepEqual(f.posts[1], f.posts[0]);
  assert.equal(f.calls, 2);
  assert.equal(
    (
      await service.acceptWebhook(
        ...delivery(await reopened.getBySubmissionKey(key)),
      )
    ).processing,
    "applied",
  );
  await service.startContribution("work", submission, key);
  assert.equal(f.calls, 2);
  assert.equal((await reopened.getBySubmissionKey(key)).payments.length, 1);
});

test("a failed retry stays uncertain; rotated credentials and elapsed windows send nothing", async (t) => {
  let reply = () => {
    throw new Error("lost response");
  };
  const f = await fixture(t, (response) => reply(response));
  const key = randomUUID();
  await f.service().startContribution("work", submission, key);
  await f
    .service({ checkout: f.client("sk_sandbox_rotated") })
    .startContribution("work", submission, key);
  assert.equal(f.calls, 1);
  reply = () => new Response("private rejection", { status: 401 });
  const retried = await f.service().startContribution("work", submission, key);
  assert.equal(retried.contribution.outcome, "pending");
  assert.equal(
    (await f.store.getBySubmissionKey(key)).attemptState,
    "uncertain",
  );
  assert.equal(f.calls, 2);
  reply = (response) => Response.json(response);
  f.setTime(initialTime + 23 * 3600000);
  await f.service().startContribution("work", submission, key);
  assert.equal(f.calls, 2);
  assert.equal(
    (await f.store.getBySubmissionKey(key)).attemptState,
    "uncertain",
  );
});

test("a crashed dispatch is resent only after its in-flight lease expires", async (t) => {
  const f = await fixture(t);
  const key = randomUUID();
  const store = {
    ...f.store,
    recordCheckout() {
      throw new Error("crash after provider acceptance");
    },
  };
  await assert.rejects(
    f.service({ store }).startContribution("work", submission, key),
    /crash after provider acceptance/,
  );
  f.close(f.store);
  const reopened = await f.open();
  const service = f.service({ store: reopened });
  assert.equal(
    (await service.startContribution("work", submission, key)).contribution
      .checkoutUrl,
    undefined,
  );
  assert.equal(f.calls, 1);
  f.setTime(initialTime + f.checkout.timeoutMs);
  assert.equal(
    (await service.startContribution("work", submission, key)).contribution
      .checkoutUrl,
    "https://checkout.example.test/pay",
  );
  assert.deepEqual(f.posts[1], f.posts[0]);
  assert.equal(
    (await reopened.getBySubmissionKey(key)).attemptState,
    "available",
  );
});

test("owner retry discovers a lost checkout without a candidate ID and refuses outside the window", async (t) => {
  let fail = true;
  const f = await fixture(t, (response) => {
    if (fail) throw new Error("lost response");
    return Response.json(response);
  });
  const service = f.service({ authorizeOwner: () => true });
  await assert.rejects(service.owner.retryCheckout(ownerRequest, "missing"), {
    code: "NOT_FOUND",
  });
  const first = await service.startContribution(
    "work",
    submission,
    randomUUID(),
  );
  const late = await service.startContribution(
    "work",
    { amount: "3000", currency: "NGN" },
    randomUUID(),
  );
  fail = false;
  const recovered = await service.owner.retryCheckout(
    ownerRequest,
    first.contribution.contributionId,
  );
  assert.equal(recovered.attemptState, "available");
  assert.equal(recovered.outcome, "pending");
  assert.equal(recovered.checkout.id, `chk_${recovered.request.reference}`);
  await assert.rejects(
    service.owner.retryCheckout(
      ownerRequest,
      first.contribution.contributionId,
    ),
    { code: "INVALID_STATE" },
  );
  f.setTime(initialTime + 23 * 3600000);
  await assert.rejects(
    service.owner.retryCheckout(ownerRequest, late.contribution.contributionId),
    { code: "INVALID_STATE" },
  );
  assert.equal(f.calls, 3);
});

test("provider-confirmed expiry is unsuccessful; retrying opens a fresh checkout while archival blocks it", async (t) => {
  const f = await fixture(t);
  const service = f.service();
  const key = randomUUID();
  const first = await service.startContribution("work", submission, key);
  const stored = await f.store.getBySubmissionKey(key);
  f.setTime(initialTime + 3600000);
  assert.equal(
    (await service.getStatus(stored.intent.id, first.resultToken)).outcome,
    "pending",
  );
  await service.acceptWebhook(
    ...signed(
      "evt_expired",
      "checkout.expired",
      {
        checkout_id: stored.checkout.id,
        reference: stored.request.reference,
        status: "expired",
      },
      initialTime + 3600000,
    ),
  );
  assert.equal(
    (await service.getStatus(stored.intent.id, first.resultToken)).outcome,
    "unsuccessful",
  );
  await f.store.putContext({ ...context, acceptingContributions: false }, 1);
  await assert.rejects(service.startContribution("work", submission, key), {
    code: "CONTEXT_CLOSED",
  });
  await f.store.putContext(context, 2);
  const retried = await service.startContribution("work", submission, key);
  assert.equal(retried.contribution.outcome, "pending");
  assert.equal(
    retried.contribution.checkoutUrl,
    "https://checkout.example.test/pay",
  );
  assert.equal((await f.store.getBySubmissionKey(key)).attempts.length, 2);
  assert.equal(f.calls, 2);
});

test("a fully paid refund is public as refunded; partial refunds and disputes stay private to the owner", async (t) => {
  const f = await fixture(t);
  const service = f.service({ authorizeOwner: () => true });
  const key = randomUUID();
  const access = await service.startContribution("work", submission, key);
  await service.acceptWebhook(
    ...delivery(await f.store.getBySubmissionKey(key)),
  );
  const refund = (id, refundId, amount) =>
    signed(id, "refund.paid", {
      refund_id: refundId,
      charge_id: "charge_private",
      reference: refundId,
      status: "paid",
      requested_amount: amount,
      refunded_amount: amount,
      refund_fee_amount: "0.00",
      fee_bearer: "merchant",
    });
  await service.acceptWebhook(...refund("evt_r1", "ref_1", "1000.00"));
  await service.acceptWebhook(
    ...signed("evt_d1", "dispute.created", {
      dispute_id: "dsp_1",
      charge_id: "charge_private",
      amount: "2500.00",
      currency: "NGN",
      status: "needs_response",
      updated_at: "2026-09-24T12:00:00Z",
    }),
  );
  const partial = await service.getStatus(
    access.contribution.contributionId,
    access.resultToken,
  );
  assert.equal(partial.outcome, "confirmed");
  assert.equal(
    JSON.stringify(partial).includes("ref_1") ||
      JSON.stringify(partial).includes("dsp_1"),
    false,
  );
  await service.acceptWebhook(...refund("evt_r2", "ref_2", "1500.00"));
  assert.equal(
    (
      await service.getStatus(
        access.contribution.contributionId,
        access.resultToken,
      )
    ).outcome,
    "refunded",
  );
  const detail = await service.owner.getContribution(
    ownerRequest,
    access.contribution.contributionId,
  );
  assert.equal(detail.payments[0].refunds.length, 2);
  assert.equal(detail.payments[0].disputes[0].status, "needs_response");
  assert.equal(
    (
      await service.owner.listEvents(ownerRequest, {
        contributionId: access.contribution.contributionId,
      })
    ).length,
    4,
  );
});

test("owner review acceptance, external returns, and event dismissal are recorded as owner decisions", async (t) => {
  const f = await fixture(t);
  const service = f.service({ authorizeOwner: () => true });
  const key = randomUUID();
  const access = await service.startContribution("work", submission, key);
  const id = access.contribution.contributionId;
  await assert.rejects(
    service.owner.acceptReview(ownerRequest, id, "Looks fine"),
    { code: "INVALID_STATE" },
  );
  await assert.rejects(
    service.owner.recordExternalReturn(
      ownerRequest,
      id,
      "100",
      "Returned by bank transfer",
    ),
    { code: "INVALID_STATE" },
  );
  await service.acceptWebhook(
    ...delivery(await f.store.getBySubmissionKey(key)),
  );
  await service.acceptWebhook(
    ...delivery(
      await f.store.getBySubmissionKey(key),
      { charge_id: "second_charge" },
      "evt_2",
    ),
  );
  assert.equal(
    (await service.getStatus(id, access.resultToken)).outcome,
    "needs_review",
  );
  await assert.rejects(service.owner.acceptReview(ownerRequest, id, "   "), {
    code: "INVALID_INPUT",
  });
  const accepted = await service.owner.acceptReview(
    ownerRequest,
    id,
    "Supporter paid twice on purpose",
  );
  assert.equal(accepted.outcome, "confirmed");
  assert.deepEqual(accepted.ownerRecords, [
    {
      kind: "review_accepted",
      amount: null,
      currency: null,
      note: "Supporter paid twice on purpose",
      recordedAt: new Date(initialTime).toISOString(),
    },
  ]);
  const returned = await service.owner.recordExternalReturn(
    ownerRequest,
    id,
    "2500",
    "Returned second payment by bank transfer",
  );
  assert.deepEqual(returned.ownerRecords.at(-1), {
    kind: "external_return",
    amount: "2500.00",
    currency: "NGN",
    note: "Returned second payment by bank transfer",
    recordedAt: new Date(initialTime).toISOString(),
  });
  await assert.rejects(
    service.owner.recordExternalReturn(ownerRequest, id, "2500.01", "Too much"),
    { code: "INVALID_STATE" },
  );
  const status = await service.getStatus(id, access.resultToken);
  assert.equal(status.outcome, "confirmed");
  assert.equal(JSON.stringify(status).includes("bank transfer"), false);

  await service.acceptWebhook(
    ...signed("evt_unrelated", "collection.succeeded", {
      checkout_id: "chk_elsewhere",
      charge_id: "other",
      status: "succeeded",
      amount: "1.00",
      currency: "NGN",
    }),
  );
  assert.equal((await service.processPending()).length, 1);
  await assert.rejects(
    service.owner.dismissEvent(ownerRequest, "evt_1", "Applied already"),
    { code: "INVALID_STATE" },
  );
  const dismissed = await service.owner.dismissEvent(
    ownerRequest,
    "evt_unrelated",
    "Payment from another website",
  );
  assert.deepEqual(
    [dismissed.state, dismissed.note],
    ["dismissed", "Payment from another website"],
  );
  assert.deepEqual(await service.processPending(), []);
  assert.equal(
    (await service.owner.listEvents(ownerRequest, { state: "dismissed" }))
      .length,
    1,
  );
  assert.equal(
    (await service.owner.reopenEvent(ownerRequest, "evt_unrelated")).state,
    "pending",
  );
  assert.equal((await service.processPending())[0].state, "pending");
});

test("a submission resumes from its key alone, so the browser never has to keep the message", async (t) => {
  let fail = true;
  const f = await fixture(t, (response) => {
    if (fail) throw new Error("lost response");
    return Response.json(response);
  });
  const service = f.service();
  const key = randomUUID();
  const first = await service.startContribution("work", submission, key);
  assert.equal(first.contribution.checkoutUrl, undefined);
  fail = false;
  const resumed = await service.resumeContribution(key.toUpperCase());
  assert.equal(
    resumed.contribution.contributionId,
    first.contribution.contributionId,
  );
  assert.equal(
    resumed.contribution.checkoutUrl,
    "https://checkout.example.test/pay",
  );
  assert.deepEqual(f.posts[1], f.posts[0]);
  await assert.rejects(service.resumeContribution(randomUUID()), {
    code: "NOT_FOUND",
  });
  await assert.rejects(service.resumeContribution("not-a-uuid"), {
    code: "INVALID_REQUEST",
  });
});

test("supporters see and remove their own data with the result link; payment facts stay", async (t) => {
  const f = await fixture(t);
  const service = f.service({ authorizeOwner: () => true });
  const key = randomUUID();
  const access = await service.startContribution("work", submission, key);
  const id = access.contribution.contributionId;
  const own = await service.getOwnData(id, access.resultToken);
  assert.deepEqual(
    [own.supporterName, own.message, own.personalDataRemoved],
    ["Private name", "Private message", null],
  );
  assert.equal(await service.getOwnData(id, "wrong"), null);
  assert.equal(
    await service.removeOwnData(randomUUID(), access.resultToken),
    null,
  );
  await service.acceptWebhook(
    ...delivery(await f.store.getBySubmissionKey(key)),
  );
  const removed = await service.removeOwnData(id, access.resultToken);
  assert.equal(removed.message, undefined);
  assert.equal(removed.supporterName, undefined);
  assert.equal(removed.personalDataRemoved.by, "supporter");
  assert.equal(removed.contribution.outcome, "confirmed");
  const detail = await service.owner.getContribution(ownerRequest, id);
  assert.equal(detail.payments.length, 1);
  assert.equal(detail.intent.message, undefined);
});

test("the owner can erase one contribution and export everything; retention follows the service clock", async (t) => {
  const f = await fixture(t);
  const service = f.service({ authorizeOwner: () => true });
  const keep = await service.startContribution(
    "work",
    submission,
    randomUUID(),
  );
  const erase = await service.startContribution(
    "work",
    { ...submission, amount: "3000" },
    randomUUID(),
  );
  const erased = await service.owner.removePersonalData(
    ownerRequest,
    erase.contribution.contributionId,
  );
  assert.deepEqual(
    [erased.intent.message, erased.personalDataRemoved.by],
    [undefined, "owner"],
  );
  await service.acceptWebhook(
    ...delivery(
      await f.store.getContribution(keep.contribution.contributionId),
    ),
  );
  const exported = await service.owner.exportData(ownerRequest);
  assert.deepEqual(
    exported.contributions.map((entry) => entry.intent.amount).sort(),
    ["2500.00", "3000.00"],
  );
  assert.equal(exported.events.length, 1);
  assert.equal(exported.contexts.length, 1);
  assert.equal(
    JSON.stringify(exported).includes("private@example.test"),
    false,
  );
  assert.equal(await service.applyRetention(), 0);
  f.setTime(initialTime + 30 * 86_400_000 + 1);
  assert.equal(await service.applyRetention(), 1);
  assert.equal(
    (await f.store.getContribution(keep.contribution.contributionId))
      .personalDataRemoved.by,
    "retention",
  );
  await assert.rejects(
    f.service({ authorizeOwner: () => false }).owner.exportData(ownerRequest),
    { code: "UNAUTHORIZED" },
  );
});

test("owner replay requests only known payments with incomplete fee facts", async (t) => {
  const f = await fixture(t);
  const requested = [];
  const service = f.service({
    authorizeOwner: () => true,
    checkout: {
      ...f.checkout,
      resendChargeNotices: async (id) => {
        requested.push(id);
      },
    },
  });
  await assert.rejects(service.owner.resendNotices(ownerRequest, "missing"), {
    code: "NOT_FOUND",
  });
  const access = await service.startContribution(
    "work",
    submission,
    randomUUID(),
  );
  const id = access.contribution.contributionId;
  assert.deepEqual(await service.owner.resendNotices(ownerRequest, id), {
    requested: 0,
  });
  const stored = await f.store.getContribution(id);
  await service.acceptWebhook(
    ...delivery(stored, {
      settlement_amount: "2462.50",
      settlement_currency: "NGN",
      processing_fee: null,
    }),
  );
  assert.deepEqual(await service.owner.resendNotices(ownerRequest, id), {
    requested: 1,
  });
  assert.deepEqual(requested, ["charge_private"]);
  await service.acceptWebhook(
    ...delivery(
      stored,
      {
        settlement_amount: "2462.50",
        settlement_currency: "NGN",
        processing_fee: "37.50",
        processing_fee_currency: "NGN",
      },
      "evt_final",
    ),
  );
  assert.deepEqual(await service.owner.resendNotices(ownerRequest, id), {
    requested: 0,
  });
});

test("owner payment refresh keeps Bachs's record of each recorded payment and reports lookup failures without changes", async (t) => {
  const f = await fixture(t);
  const service = f.service({ authorizeOwner: () => true });
  await assert.rejects(
    service.owner.refreshPaymentDetails(ownerRequest, "missing"),
    { code: "NOT_FOUND" },
  );
  const access = await service.startContribution(
    "work",
    submission,
    randomUUID(),
  );
  const id = access.contribution.contributionId;
  assert.deepEqual(
    (await service.owner.refreshPaymentDetails(ownerRequest, id)).payments,
    [],
  );
  const stored = await f.store.getContribution(id);
  await service.acceptWebhook(
    ...delivery(stored, {
      settlement_amount: "None",
      settlement_currency: "USD",
      processing_fee: null,
    }),
  );
  await assert.rejects(service.owner.refreshPaymentDetails(ownerRequest, id), {
    code: "LOOKUP_FAILED",
  });
  assert.equal((await f.store.getContribution(id)).payments[0].statement, null);

  f.providerRecords.set("charge_private", {
    payment_id: "charge_private",
    checkout_id: `chk_${stored.request.reference}`,
    status: "succeeded",
    amount: "2500.00",
    currency: "NGN",
    fees: { amount: "37.50", currency: "NGN" },
    merchant_bears_cost: true,
    customer: { email: "private@example.test" },
  });
  const refreshed = await service.owner.refreshPaymentDetails(ownerRequest, id);
  assert.deepEqual(refreshed.payments[0].statement, {
    status: "succeeded",
    amount: "2500.00",
    currency: "NGN",
    fee: { amount: "37.50", currency: "NGN" },
    feeBearer: "merchant",
    retrievedAt: new Date(initialTime).toISOString(),
  });
  assert.equal(refreshed.outcome, "confirmed");
  const summary = await service.owner.summary(ownerRequest);
  assert.deepEqual(
    [summary.feeTotals, summary.unknownFeePayments, summary.unsettledPayments],
    [{ NGN: "37.50" }, 0, 1],
  );
  assert.equal(
    JSON.stringify(await service.owner.exportData(ownerRequest)).includes(
      "private@example.test",
    ),
    false,
  );
});

test("an owner-only service needs no webhook secret, result secret, or return URLs, and still gates every operation", async (t) => {
  const f = await fixture(t);
  const access = await f
    .service()
    .startContribution("work", submission, randomUUID());
  const id = access.contribution.contributionId;
  await f.service().acceptWebhook(
    ...delivery(await f.store.getContribution(id), {
      settlement_amount: "2462.50",
      settlement_currency: "NGN",
      processing_fee: "37.50",
      processing_fee_currency: "NGN",
      fee_bearer: "merchant",
    }),
  );
  const bachs = createBachsClient({
    ...scope,
    secretKey: "sk_sandbox_fixture",
    fetch: async () => {
      throw new Error("no provider call expected");
    },
  });
  const owner = createOwnerService({
    store: f.store,
    bachs,
    authorizeOwner: () => true,
    now: () => initialTime,
  });
  const stored = await owner.getContribution(ownerRequest, id);
  assert.deepEqual(
    [stored.status, stored.payments[0].fee],
    [
      "confirmed",
      {
        state: "charged",
        amount: "37.50",
        currency: "NGN",
        bearer: "merchant",
      },
    ],
  );
  assert.equal((await owner.summary(ownerRequest)).contributions.confirmed, 1);
  const denied = createOwnerService({
    store: f.store,
    bachs,
    authorizeOwner: () => "yes",
  });
  for (const call of ownerCalls(denied))
    await assert.rejects(call, { code: "UNAUTHORIZED" });
  const otherAccount = createBachsClient({
    organizationId: "acct_other",
    environment: "sandbox",
    secretKey: "sk_sandbox_fixture",
  });
  for (const options of [
    { store: f.store, bachs: otherAccount, authorizeOwner: () => true },
    { store: f.store, bachs },
  ]) {
    assert.throws(() => createOwnerService(options), {
      code: "INVALID_CONFIGURATION",
    });
  }
});
