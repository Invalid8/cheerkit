import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import {
  createBachsCheckoutClient,
  createBachsClient,
  createBachsWebhookVerifier,
} from "@dalgoridim/cheerkit/bachs";
import {
  createOwnerHandler,
  createOwnerService,
  createSupportHandler,
  createSupportService,
  openStore,
  runPendingPass,
  startPendingWorker,
} from "@dalgoridim/cheerkit/server";
import { hostDatabase } from "./helpers.mjs";

const initialTime = Date.parse("2026-09-24T12:00:00Z");
const scope = { organizationId: "acct_owner", environment: "sandbox" };
const context = {
  id: "work",
  name: "My work",
  collectMessage: true,
  currencies: [{ currency: "NGN", fractionDigits: 2, minimum: "100" }],
};
const submission = {
  amount: "2500",
  currency: "NGN",
  message: "Private message",
};
const origin = "https://site.example";
const base = "https://site.example/api/support";

async function fixture(
  t,
  {
    authorizeOwner = (request) =>
      request.headers.get("Authorization") === "Bearer owner",
    store: wrap,
  } = {},
) {
  let time = initialTime;
  const host = await hostDatabase(t, "sqlite");
  const store = await openStore({
    ...scope,
    installationId: "http-test",
    database: host.connect().database,
  });
  await store.putContext(context, null);
  const checkout = createBachsCheckoutClient({
    ...scope,
    secretKey: "sk_sandbox_fixture",
    successUrl: "https://site.example/result",
    cancelUrl: "https://site.example/support",
    fetch: async (_url, init) => {
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
  const service = createSupportService({
    store: wrap ? wrap(store) : store,
    checkout,
    webhooks,
    authorizeOwner,
    resultSecret: "synthetic-result-secret-32-characters",
    retention: { supporterDataDays: 30 },
    now: () => time,
  });
  const reports = [];
  const refusals = [];
  const handler = createSupportHandler(service, {
    basePath: "/api/support",
    allowedOrigins: [origin],
    clientKey: (request) => request.headers.get("X-Test-Client") ?? "default",
    onError: (report) => reports.push(report),
    onRefusal: (report) => refusals.push(report),
    now: () => time,
  });
  return {
    store,
    service,
    handler,
    reports,
    refusals,
    setTime(value) {
      time = value;
    },
  };
}

const post = (path, body, headers = {}) =>
  new Request(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const owner = (path, init = {}) =>
  new Request(`${base}/owner${path}`, {
    ...init,
    headers: {
      Authorization: "Bearer owner",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
const start = (f, headers) =>
  f.handler(
    post(
      "/contributions",
      { contextId: "work", submission, submissionKey: randomUUID() },
      headers,
    ),
  );

function webhook(id, data) {
  const raw = JSON.stringify({
    id,
    type: "collection.succeeded",
    organization_id: scope.organizationId,
    created_at: new Date(initialTime).toISOString(),
    data: { status: "succeeded", amount: "2500.00", currency: "NGN", ...data },
  });
  const timestamp = initialTime / 1000;
  const signature = createHmac("sha256", "fixture-webhook")
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  return new Request(`${base}/webhooks/bachs`, {
    method: "POST",
    headers: { "X-Bachs-Signature-V2": `t=${timestamp},v1=${signature}` },
    body: raw,
  });
}

test("contribution start returns access with no-store headers and enforces origin, media type, size, and validation", async (t) => {
  const f = await fixture(t);
  const response = await start(f);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), [
    "contribution",
    "expiresAt",
    "resultToken",
  ]);
  assert.equal(
    (await start(f, { Origin: "https://evil.example" })).status,
    403,
  );
  const serverToServer = post("/contributions", {
    contextId: "work",
    submission,
    submissionKey: randomUUID(),
  });
  serverToServer.headers.delete("Origin");
  assert.equal((await f.handler(serverToServer)).status, 201);
  assert.equal(
    (
      await f.handler(
        post("/contributions", "{}", { "Content-Type": "text/plain" }),
      )
    ).status,
    415,
  );
  assert.equal(
    (await f.handler(post("/contributions", '{"x":', {}))).status,
    400,
  );
  assert.equal(
    (
      await f.handler(
        post("/contributions", JSON.stringify({ padding: "x".repeat(17000) })),
      )
    ).status,
    413,
  );
  assert.equal(
    (
      await f.handler(
        post("/contributions", "{}", { "Content-Length": "999999" }),
      )
    ).status,
    413,
  );
  const invalid = await f.handler(
    post("/contributions", {
      contextId: "work",
      submission: { ...submission, amount: "1.001" },
      submissionKey: randomUUID(),
    }),
  );
  assert.deepEqual(
    [invalid.status, await invalid.json()],
    [400, { error: "invalid_amount" }],
  );
  await f.store.putContext({ ...context, acceptingContributions: false }, 1);
  const closed = await start(f);
  assert.deepEqual(
    [closed.status, await closed.json()],
    [409, { error: "context_closed" }],
  );
  assert.equal((await f.handler(new Request(`${base}/unknown`))).status, 404);
  assert.equal(
    (
      await f.handler(
        new Request("https://site.example/other/contributions", {
          method: "POST",
        }),
      )
    ).status,
    404,
  );
});

test("initiation is rate limited per trusted client key within a window", async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 10; index++)
    assert.equal((await start(f, { "X-Test-Client": "a" })).status, 201);
  const limited = await start(f, { "X-Test-Client": "a" });
  assert.deepEqual(
    [limited.status, await limited.json()],
    [429, { error: "rate_limited" }],
  );
  assert.equal((await start(f, { "X-Test-Client": "b" })).status, 201);
  f.setTime(initialTime + 60000);
  assert.equal((await start(f, { "X-Test-Client": "a" })).status, 201);
});

test("status uses the token from the body and answers identically for unknown and invalid access", async (t) => {
  const f = await fixture(t);
  const access = await (await start(f)).json();
  const found = await f.handler(
    post("/contributions/status", {
      contributionId: access.contribution.contributionId,
      resultToken: access.resultToken,
    }),
  );
  assert.equal(found.status, 200);
  assert.equal((await found.json()).outcome, "pending");
  const wrongToken = await f.handler(
    post("/contributions/status", {
      contributionId: access.contribution.contributionId,
      resultToken: "x",
    }),
  );
  const unknown = await f.handler(
    post("/contributions/status", {
      contributionId: randomUUID(),
      resultToken: access.resultToken,
    }),
  );
  assert.deepEqual(
    [wrongToken.status, await wrongToken.text()],
    [unknown.status, await unknown.text()],
  );
  assert.equal(unknown.status, 404);
});

test("webhooks acknowledge only after durable acceptance and ask for retry when processing fails", async (t) => {
  let failProcessing = true;
  const f = await fixture(t, {
    store: (store) => ({
      ...store,
      processEvent(id) {
        if (failProcessing) throw new Error("private failure");
        return store.processEvent(id);
      },
    }),
  });
  const access = await (await start(f)).json();
  const stored = await f.store.getContribution(
    access.contribution.contributionId,
  );
  const data = {
    checkout_id: stored.checkout.id,
    reference: stored.request.reference,
    charge_id: "ch_1",
  };
  const failed = await f.handler(webhook("evt_1", data));
  assert.equal(failed.status, 500);
  assert.equal((await f.store.getEvent("evt_1")).state, "pending");
  failProcessing = false;
  const retried = await f.handler(webhook("evt_1", data));
  assert.deepEqual(
    [retried.status, await retried.json()],
    [200, { received: "duplicate" }],
  );
  assert.equal(
    (await f.store.getContribution(stored.intent.id)).outcome,
    "confirmed",
  );
  const forged = webhook("evt_2", data);
  const bad = await f.handler(
    new Request(forged.url, {
      method: "POST",
      headers: { "X-Bachs-Signature-V2": "t=1,v1=" + "0".repeat(64) },
      body: await forged.text(),
    }),
  );
  assert.equal(bad.status, 401);
  assert.equal(
    (
      await f.handler(
        new Request(`${base}/webhooks/bachs`, {
          method: "POST",
          body: "x".repeat(1024 * 1024 + 1),
        }),
      )
    ).status,
    413,
  );
  assert.deepEqual(
    f.reports.map((report) => report.route),
    ["webhook", "webhook", "webhook"],
  );
  assert.equal(JSON.stringify(f.reports).includes("private"), false);
});

test("storage failures after acceptance return a retryable 503", async (t) => {
  const { CheerkitStoreError } = await import("@dalgoridim/cheerkit/server");
  const g = await fixture(t, {
    store: (store) => ({
      ...store,
      processEvent() {
        throw new CheerkitStoreError("STORAGE_FAILURE", "private");
      },
    }),
  });
  const access = await (await start(g)).json();
  const stored = await g.store.getContribution(
    access.contribution.contributionId,
  );
  const response = await g.handler(
    webhook("evt_1", {
      checkout_id: stored.checkout.id,
      reference: stored.request.reference,
      charge_id: "ch_1",
    }),
  );
  assert.deepEqual(
    [
      response.status,
      response.headers.get("Retry-After"),
      await response.json(),
    ],
    [503, "30", { error: "retry_later" }],
  );
  assert.equal((await g.store.getEvent("evt_1")).state, "pending");
});

test("owner routes require host authorization and an allowed origin for changes", async (t) => {
  const f = await fixture(t);
  const access = await (await start(f)).json();
  const id = access.contribution.contributionId;
  assert.equal(
    (await f.handler(new Request(`${base}/owner/contributions`))).status,
    403,
  );
  const list = await f.handler(owner("/contributions?contextId=work&limit=5"));
  assert.equal(list.status, 200);
  assert.equal(list.headers.get("Cross-Origin-Resource-Policy"), "same-origin");
  assert.equal((await list.json())[0].intent.message, "Private message");
  const crossSite = await f.handler(
    owner("/summary", { headers: { "Sec-Fetch-Site": "cross-site" } }),
  );
  assert.deepEqual(
    [
      crossSite.status,
      crossSite.headers.get("Cross-Origin-Resource-Policy"),
      await crossSite.json(),
    ],
    [403, "same-origin", { error: "cross_site_request" }],
  );
  assert.equal((await f.handler(owner(`/contributions/${id}`))).status, 200);
  assert.equal((await f.handler(owner("/contributions/missing"))).status, 404);
  const replayPath = `/contributions/${id}/resend-notices`;
  assert.equal(
    (await f.handler(owner(replayPath, { method: "POST" }))).status,
    403,
  );
  assert.equal((await f.handler(post("/owner" + replayPath, {}))).status, 403);
  const replay = await f.handler(
    owner(replayPath, { method: "POST", headers: { Origin: origin } }),
  );
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { requested: 0 });
  const detailsPath = `/contributions/${id}/payment-details`;
  assert.equal(
    (await f.handler(owner(detailsPath, { method: "POST" }))).status,
    403,
  );
  const details = await f.handler(
    owner(detailsPath, { method: "POST", headers: { Origin: origin } }),
  );
  assert.deepEqual(
    [details.status, (await details.json()).payments],
    [200, []],
  );
  assert.equal(
    (await f.handler(owner("/contributions?limit=abc"))).status,
    400,
  );
  assert.equal(
    (await f.handler(owner("/contributions?status=pending"))).status,
    400,
  );
  assert.equal(
    (await f.handler(owner("/contributions?beforeId=x"))).status,
    400,
  );
  assert.equal(
    (
      await (
        await f.handler(owner("/contributions?status=awaiting_payment"))
      ).json()
    ).length,
    1,
  );
  assert.deepEqual(
    await (await f.handler(owner("/contributions?status=confirmed"))).json(),
    [],
  );
  const listed = (await (await f.handler(owner("/contributions"))).json())[0];
  const older = `/contributions?beforeCreatedAt=${encodeURIComponent(listed.intent.createdAt)}&beforeId=${listed.intent.id}`;
  assert.deepEqual(await (await f.handler(owner(older))).json(), []);
  const summary = await (await f.handler(owner("/summary"))).json();
  assert.deepEqual(summary.contributions, {
    awaiting_payment: 1,
    checkout_unresolved: 0,
    unsuccessful: 0,
    confirmed: 0,
    needs_review: 0,
  });

  await f.handler(
    webhook("evt_other", { checkout_id: "chk_elsewhere", charge_id: "other" }),
  );
  const noOrigin = await f.handler(
    owner("/events/evt_other/dismiss", {
      method: "POST",
      body: JSON.stringify({ note: "Other site" }),
    }),
  );
  assert.deepEqual(
    [noOrigin.status, await noOrigin.json()],
    [403, { error: "origin_not_allowed" }],
  );
  const dismissed = await f.handler(
    owner("/events/evt_other/dismiss", {
      method: "POST",
      headers: { Origin: origin },
      body: JSON.stringify({ note: "Other site" }),
    }),
  );
  assert.equal((await dismissed.json()).state, "dismissed");
  assert.equal(
    (await (await f.handler(owner("/events?state=dismissed"))).json()).length,
    1,
  );
  assert.equal((await f.handler(owner("/events?state=bogus"))).status, 400);
  const reopened = await f.handler(
    owner("/events/evt_other/reopen", {
      method: "POST",
      headers: { Origin: origin },
    }),
  );
  assert.equal((await reopened.json()).state, "pending");

  const edit = await f.handler(
    owner("/contexts/work", {
      method: "PUT",
      headers: { Origin: origin },
      body: JSON.stringify({
        context: { ...context, name: "Edited" },
        expectedRevision: 1,
      }),
    }),
  );
  assert.equal((await edit.json()).revision, 2);
  const stale = await f.handler(
    owner("/contexts/work", {
      method: "PUT",
      headers: { Origin: origin },
      body: JSON.stringify({ context, expectedRevision: 1 }),
    }),
  );
  assert.deepEqual(
    [stale.status, await stale.json()],
    [409, { error: "conflict" }],
  );
  const mismatch = await f.handler(
    owner("/contexts/other", {
      method: "PUT",
      headers: { Origin: origin },
      body: JSON.stringify({ context, expectedRevision: 2 }),
    }),
  );
  assert.equal(mismatch.status, 400);
  const retry = await f.handler(
    owner(`/contributions/${id}/retry`, {
      method: "POST",
      headers: { Origin: origin },
    }),
  );
  assert.deepEqual(
    [retry.status, await retry.json()],
    [409, { error: "invalid_state" }],
  );
});

test("errors never serialize messages or private values", async (t) => {
  const f = await fixture(t, {
    authorizeOwner: () => {
      throw new Error("private auth detail");
    },
  });
  const denied = await f.handler(owner("/contributions"));
  assert.deepEqual(
    [denied.status, await denied.text()],
    [403, '{"error":"forbidden"}'],
  );
});

test("pending passes page through all pending events and report counts only", async (t) => {
  const f = await fixture(t);
  for (const id of ["evt_a", "evt_b", "evt_c"])
    await f.handler(webhook(id, { checkout_id: "chk_unknown", charge_id: id }));
  f.store.acceptEvent;
  assert.deepEqual(
    await runPendingPass(f.service, { pageSize: 1, maxPages: 10 }),
    { processed: 3, applied: 0, review: 0, unsupported: 0, stillPending: 3 },
  );
  assert.deepEqual(
    (await runPendingPass(f.service, { pageSize: 2, maxPages: 1 })).processed,
    2,
  );
  await assert.rejects(
    runPendingPass(f.service, { pageSize: 0, maxPages: 1 }),
    { code: "INVALID_CONFIGURATION" },
  );
  assert.throws(
    () =>
      startPendingWorker(f.service, {
        pageSize: 10,
        maxPages: 1,
        intervalMs: 10,
      }),
    { code: "INVALID_CONFIGURATION" },
  );
});

test("the worker backs off after failures, runs effects after each pass, and stops cleanly", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  let calls = 0;
  const reports = [];
  const service = {
    async processPending() {
      calls++;
      if (calls <= 2)
        throw Object.assign(new Error("private"), { code: "STORAGE_FAILURE" });
      return [];
    },
    async runEffects() {
      return { succeeded: 1, retrying: 0, failed: 0 };
    },
    async applyRetention() {
      return 0;
    },
  };
  const worker = startPendingWorker(service, {
    pageSize: 10,
    maxPages: 1,
    intervalMs: 1000,
    onError: (report) => reports.push(report),
    onPass: (result) => reports.push(result.effects.succeeded),
  });
  const advance = async (ms) => {
    t.mock.timers.tick(ms);
    await flush();
  };
  await advance(1000);
  assert.equal(calls, 1);
  await advance(1999);
  assert.equal(calls, 1);
  await advance(1);
  assert.equal(calls, 2);
  await advance(4000);
  assert.equal(calls, 3);
  await advance(1000);
  assert.equal(calls, 4);
  worker.stop();
  await advance(100000);
  assert.equal(calls, 4);
  assert.deepEqual(reports, [
    { name: "Error", code: "STORAGE_FAILURE" },
    { name: "Error", code: "STORAGE_FAILURE" },
    1,
    1,
  ]);
});

test("the public context exposes rendering rules and fee treatment without the tracking name", async (t) => {
  const f = await fixture(t);
  const response = await f.handler(new Request(`${base}/contexts/work`));
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    contextId: "work",
    acceptingContributions: true,
    collectName: false,
    collectMessage: true,
    fees: "owner",
    currencies: [
      {
        currency: "NGN",
        fractionDigits: 2,
        minimum: "100.00",
        suggestedAmounts: [],
      },
    ],
  });
  assert.equal(
    (await f.handler(new Request(`${base}/contexts/missing`))).status,
    404,
  );
  assert.equal(await f.service.getPublicContext("x".repeat(129)), null);
});

test("refused requests are reported by route, status, and code only when the host asks", async (t) => {
  const f = await fixture(t);
  const access = await (await start(f)).json();
  const id = access.contribution.contributionId;
  const returned = await f.handler(
    owner(`/contributions/${id}/external-returns`, {
      method: "POST",
      headers: { Origin: origin },
      body: JSON.stringify({ amount: "$5 private", note: "Private note" }),
    }),
  );
  assert.equal(returned.status, 400);
  await f.handler(
    owner(`/contributions/${id}/external-returns`, {
      method: "POST",
      headers: { Origin: origin },
      body: JSON.stringify({ amount: "5", note: "Private note" }),
    }),
  );
  await f.handler(new Request(`${base}/owner/summary`));
  assert.deepEqual(f.refusals, [
    {
      code: "invalid_amount",
      route: "owner.recordExternalReturn",
      status: 400,
    },
    { code: "invalid_state", route: "owner.recordExternalReturn", status: 409 },
    { code: "forbidden", route: "owner.summary", status: 403 },
  ]);
  assert.equal(
    JSON.stringify(f.refusals).includes("Private") ||
      JSON.stringify(f.refusals).includes("$5"),
    false,
  );
  assert.deepEqual(f.reports, []);
  assert.throws(
    () =>
      createSupportHandler(f.service, {
        basePath: "/api",
        allowedOrigins: [origin],
        clientKey: () => "x",
        onRefusal: "yes",
      }),
    { code: "INVALID_CONFIGURATION" },
  );
});

test("supporter data routes need the result link; owner export and erasure need owner access and origin", async (t) => {
  const f = await fixture(t);
  const key = randomUUID();
  const access = await (
    await f.handler(
      post("/contributions", {
        contextId: "work",
        submission,
        submissionKey: key,
      }),
    )
  ).json();
  const id = access.contribution.contributionId;
  const resumed = await f.handler(
    post("/contributions/resume", { submissionKey: key }),
  );
  assert.equal((await resumed.json()).contribution.contributionId, id);
  const own = await f.handler(
    post("/contributions/data", {
      contributionId: id,
      resultToken: access.resultToken,
    }),
  );
  assert.equal((await own.json()).message, "Private message");
  assert.equal(
    (
      await f.handler(
        post("/contributions/data", {
          contributionId: id,
          resultToken: "wrong",
        }),
      )
    ).status,
    404,
  );
  const removed = await f.handler(
    post("/contributions/remove-data", {
      contributionId: id,
      resultToken: access.resultToken,
    }),
  );
  assert.equal((await removed.json()).personalDataRemoved.by, "supporter");
  const exported = await f.handler(owner("/export"));
  assert.equal(
    exported.headers.get("Content-Disposition"),
    'attachment; filename="cheerkit-export.json"',
  );
  assert.equal((await exported.json()).contributions.length, 1);
  assert.equal(
    (
      await f.handler(
        owner(`/contributions/${id}/remove-personal-data`, { method: "POST" }),
      )
    ).status,
    403,
  );
  const erased = await f.handler(
    owner(`/contributions/${id}/remove-personal-data`, {
      method: "POST",
      headers: { Origin: origin },
    }),
  );
  assert.equal(erased.status, 200);
  assert.equal(
    (await f.handler(new Request(`${base}/owner/export`))).status,
    403,
  );
});

test("a failed Bachs payment lookup answers 502 with a code only", async (t) => {
  const f = await fixture(t);
  const id = (await (await start(f)).json()).contribution.contributionId;
  const { reference } = (await f.store.getContribution(id)).request;
  assert.equal(
    (
      await f.handler(
        webhook("evt_paid", {
          checkout_id: `chk_${reference}`,
          reference,
          charge_id: "ch_fixture",
        }),
      )
    ).status,
    200,
  );
  const response = await f.handler(
    owner(`/contributions/${id}/payment-details`, {
      method: "POST",
      headers: { Origin: origin },
    }),
  );
  assert.deepEqual(
    [response.status, await response.json()],
    [502, { error: "lookup_failed" }],
  );
  assert.deepEqual(f.reports.at(-1), {
    code: "lookup_failed",
    route: "owner.refreshPaymentDetails",
  });
});

test("the owner handler serves owner routes only, with the same origin and error rules", async (t) => {
  const f = await fixture(t);
  const id = (await (await start(f)).json()).contribution.contributionId;
  const bachs = createBachsClient({
    ...scope,
    secretKey: "sk_sandbox_fixture",
  });
  const ownerService = createOwnerService({
    store: f.store,
    bachs,
    authorizeOwner: (request) =>
      request.headers.get("Authorization") === "Bearer owner",
  });
  const refusals = [];
  const handler = createOwnerHandler(ownerService, {
    basePath: "/api/support",
    allowedOrigins: [origin],
    onRefusal: (report) => refusals.push(report),
  });
  assert.equal((await handler(owner(`/contributions/${id}`))).status, 200);
  assert.deepEqual(
    (await (await handler(owner("/summary"))).json()).contributions
      .awaiting_payment,
    1,
  );
  assert.equal(
    (await handler(new Request(`${base}/owner/summary`))).status,
    403,
  );
  assert.equal(
    (
      await handler(
        owner(`/contributions/${id}/remove-personal-data`, { method: "POST" }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handler(
        owner(`/contributions/${id}/remove-personal-data`, {
          method: "POST",
          headers: { Origin: origin },
        }),
      )
    ).status,
    200,
  );
  for (const path of ["/contexts/work", "/webhooks/bachs", "/contributions"]) {
    assert.equal(
      (
        await handler(
          new Request(`${base}${path}`, {
            method: path === "/contexts/work" ? "GET" : "POST",
          }),
        )
      ).status,
      404,
    );
  }
  assert.deepEqual(
    refusals.map((report) => report.route),
    [
      "owner.summary",
      "owner.removePersonalData",
      "unknown",
      "unknown",
      "unknown",
    ],
  );
  assert.throws(
    () =>
      createOwnerHandler(ownerService, {
        basePath: "/api/support",
        allowedOrigins: ["http://site.example"],
      }),
    { code: "INVALID_CONFIGURATION" },
  );
});

test("an owner can price units, and the public context offers them to the template", async (t) => {
  const f = await fixture(t);
  const priced = {
    ...context,
    unit: { one: "coffee", other: "coffees", icon: "coffee", start: 3 },
    currencies: context.currencies.map((rules) => ({
      ...rules,
      unitPrice: "1500",
    })),
  };
  const saved = await f.handler(
    owner("/contexts/work", {
      method: "PUT",
      headers: { Origin: origin },
      body: JSON.stringify({ context: priced, expectedRevision: 1 }),
    }),
  );
  assert.equal(saved.status, 200);
  const shown = await (
    await f.handler(new Request(`${base}/contexts/work`))
  ).json();
  assert.deepEqual(shown.unit, {
    one: "coffee",
    other: "coffees",
    icon: "coffee",
    start: 3,
    max: 20,
  });
  assert.equal(shown.currencies[0].unitPrice, "1500.00");
});
