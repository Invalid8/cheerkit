import assert from "node:assert/strict";
import { test } from "node:test";
import { createSupport, safeCheckoutUrl } from "../dist/ui/support.js";
import { readableOn } from "../dist/ui/color.js";

const context = {
  contextId: "coffee",
  acceptingContributions: true,
  currencies: [
    {
      currency: "NGN",
      fractionDigits: 2,
      minimum: "500",
      maximum: "500000",
      suggestedAmounts: ["1500", "3000"],
    },
  ],
  collectName: true,
  collectMessage: true,
  fees: "owner",
};
const submission = {
  amount: "3000",
  currency: "NGN",
  supporterName: "Test Supporter",
  message: "Synthetic test message",
};
const contribution = (outcome, checkoutUrl) => ({
  contributionId: "contribution-1",
  contextId: "coffee",
  outcome,
  amount: "3000",
  currency: "NGN",
  ...(checkoutUrl ? { checkoutUrl } : {}),
});

function memoryStorage() {
  const items = new Map();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
}

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** A fake API: `routes[path]` is a function of (body, call) returning a Response or throwing for a network failure. */
function fakeApi(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const path = new URL(url, "http://localhost").pathname.replace(
      "/api/support",
      "",
    );
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, body });
    const route = routes[path];
    if (!route) return json(404, { error: "not_found" });
    return route(body, calls.length);
  };
  return { fetch, calls };
}

const setup = (routes, options = {}) => {
  const storage = memoryStorage();
  const api = fakeApi(routes);
  const support = createSupport({
    api: "/api/support/",
    contextId: "coffee",
    storage,
    fetch: api.fetch,
    delays: [1],
    ...options,
  });
  return { support, storage, calls: api.calls };
};

test("loading a context gives ready, closed, or unavailable", async () => {
  const ready = setup({ "/contexts/coffee": () => json(200, context) });
  await ready.support.load();
  assert.equal(ready.support.state.status, "ready");
  assert.equal(ready.calls[0].path, "/contexts/coffee");

  const closed = setup({
    "/contexts/coffee": () =>
      json(200, { ...context, acceptingContributions: false }),
  });
  await closed.support.load();
  assert.equal(closed.support.state.status, "closed");

  const offline = setup({
    "/contexts/coffee": () => {
      throw new TypeError("offline");
    },
  });
  await offline.support.load();
  assert.deepEqual(offline.support.state, {
    status: "unavailable",
    error: "network",
  });
});

test("the submission key is stored before sending and access before leaving for checkout", async () => {
  const { support, storage } = setup({
    "/contexts/coffee": () => json(200, context),
    "/contributions": (body) => {
      const saved = JSON.parse(storage.getItem("cheerkit:coffee:submission"));
      assert.equal(saved.key, body.submissionKey);
      assert.equal(storage.getItem("cheerkit:coffee:result"), null);
      return json(201, {
        contribution: contribution(
          "pending",
          "https://checkout.example/session",
        ),
        resultToken: "token-1",
        expiresAt: "2026-11-01T00:00:00.000Z",
      });
    },
  });
  await support.load();
  await support.submit(submission);
  assert.deepEqual(support.state, {
    status: "redirecting",
    checkoutUrl: "https://checkout.example/session",
  });
  assert.deepEqual(JSON.parse(storage.getItem("cheerkit:coffee:result")), {
    contributionId: "contribution-1",
    resultToken: "token-1",
  });
});

test("the browser never stores the supporter's name, message, or amount", async () => {
  const { support, storage } = setup({
    "/contexts/coffee": () => json(200, context),
    "/contributions": () => {
      throw new TypeError("offline");
    },
  });
  await support.load();
  await support.submit(submission);
  assert.deepEqual(
    Object.keys(JSON.parse(storage.getItem("cheerkit:coffee:submission"))),
    ["key"],
  );
  const stored = [...storage.items.values()].join(" ");
  assert.doesNotMatch(stored, /Test Supporter|Synthetic test message|3000/);
});

test("a retry after a network failure reuses the key; a changed form gets a new one", async () => {
  let fail = true;
  const { support, calls } = setup({
    "/contexts/coffee": () => json(200, context),
    "/contributions": () => {
      if (fail) throw new TypeError("offline");
      return json(422, { error: "amount_out_of_range" });
    },
  });
  await support.load();
  await support.submit(submission);
  assert.deepEqual(support.state.error, "network");
  await support.submit(submission);
  const keys = calls
    .filter((call) => call.path === "/contributions")
    .map((call) => call.body.submissionKey);
  assert.equal(keys[0], keys[1]);
  await support.submit({ ...submission, amount: "1500" });
  const changed = calls.at(-1).body.submissionKey;
  assert.notEqual(changed, keys[0]);
  fail = false;
  await support.submit({ ...submission, amount: "1500" });
  assert.equal(support.state.error, "amount_out_of_range");
});

test("a refused submission forgets its key so the next one starts fresh", async () => {
  const { support, storage } = setup({
    "/contexts/coffee": () => json(200, context),
    "/contributions": () => json(422, { error: "invalid_amount" }),
  });
  await support.load();
  await support.submit(submission);
  assert.equal(support.state.error, "invalid_amount");
  assert.equal(storage.getItem("cheerkit:coffee:submission"), null);
});

test("an unsafe checkout link is never navigated to", async () => {
  const { support } = setup({
    "/contexts/coffee": () => json(200, context),
    "/contributions": () =>
      json(201, {
        contribution: contribution("pending", "javascript:alert(1)"),
        resultToken: "token-1",
        expiresAt: "2026-11-01T00:00:00.000Z",
      }),
  });
  await support.load();
  await support.submit(submission);
  assert.equal(support.state.status, "result");
  assert.equal(support.state.checking, true);
});

test("watching a result stops when it settles and forgets the submission", async () => {
  let checks = 0;
  const { support, storage } = setup({
    "/contributions/status": (body) => {
      assert.deepEqual(body, {
        contributionId: "contribution-1",
        resultToken: "token-1",
      });
      checks += 1;
      return json(200, contribution(checks < 3 ? "pending" : "confirmed"));
    },
  });
  storage.setItem(
    "cheerkit:coffee:result",
    JSON.stringify({
      contributionId: "contribution-1",
      resultToken: "token-1",
    }),
  );
  storage.setItem(
    "cheerkit:coffee:submission",
    JSON.stringify({ key: "key-1" }),
  );
  await support.checkResult();
  assert.equal(support.state.checking, true);
  await support.watchResult();
  assert.equal(support.state.contribution.outcome, "confirmed");
  assert.equal(support.state.checking, false);
  assert.equal(checks, 3);
  assert.equal(storage.getItem("cheerkit:coffee:submission"), null);
});

test("watching gives up after the wait and leaves the payment pending", async () => {
  const { support, storage } = setup(
    { "/contributions/status": () => json(200, contribution("pending")) },
    { maxWaitMs: 0 },
  );
  storage.setItem(
    "cheerkit:coffee:result",
    JSON.stringify({
      contributionId: "contribution-1",
      resultToken: "token-1",
    }),
  );
  await support.checkResult();
  await support.watchResult();
  assert.equal(support.state.contribution.outcome, "pending");
  assert.equal(support.state.checking, false);
});

test("no saved result, or one the server no longer knows, shows no result", async () => {
  const empty = setup({});
  await empty.support.checkResult();
  assert.equal(empty.support.state.status, "no-result");

  const unknown = setup({
    "/contributions/status": () => json(404, { error: "not_found" }),
  });
  unknown.storage.setItem(
    "cheerkit:coffee:result",
    JSON.stringify({ contributionId: "gone", resultToken: "token" }),
  );
  await unknown.support.checkResult();
  assert.equal(unknown.support.state.status, "no-result");
  assert.equal(unknown.storage.getItem("cheerkit:coffee:result"), null);
});

test("trying again resumes the same submission and reports the new checkout", async () => {
  const { support, storage, calls } = setup({
    "/contributions/resume": () =>
      json(200, {
        contribution: contribution("pending", "https://checkout.example/two"),
        resultToken: "token-2",
        expiresAt: "2026-11-01T00:00:00.000Z",
      }),
  });
  storage.setItem(
    "cheerkit:coffee:submission",
    JSON.stringify({ key: "key-1" }),
  );
  await support.tryAgain();
  assert.deepEqual(calls[0].body, { submissionKey: "key-1" });
  assert.deepEqual(support.state, {
    status: "redirecting",
    checkoutUrl: "https://checkout.example/two",
  });
});

test("checkout links must be HTTPS, or HTTP on the local machine", () => {
  assert.equal(
    safeCheckoutUrl("https://pay.example/c/1"),
    "https://pay.example/c/1",
  );
  assert.equal(
    safeCheckoutUrl("http://localhost:4173/dev/checkout?id=1"),
    "http://localhost:4173/dev/checkout?id=1",
  );
  for (const unsafe of [
    "http://pay.example/c/1",
    "javascript:alert(1)",
    "https://user:pass@pay.example/",
    "not a url",
  ])
    assert.equal(safeCheckoutUrl(unsafe), null, unsafe);
});

test("text on the theme colour is white or near-black, whichever reads better", () => {
  assert.equal(readableOn("#1c2b4a"), "#ffffff");
  assert.equal(readableOn("#FFD60A"), "#141414");
  assert.equal(readableOn("#fff"), "#141414");
  assert.equal(readableOn("#2f6b3f"), "#ffffff");
  assert.equal(readableOn("oklch(0.6 0.2 260)"), null);
});

test("the owner client calls each owner route with the right path and body", async () => {
  const { createOwnerClient } = await import("../dist/ui/owner.js");
  const calls = [];
  const client = createOwnerClient({
    api: "/api/support/",
    fetch: async (url, init) => {
      calls.push([init.method, url, init.body ? JSON.parse(init.body) : null]);
      return json(200, {});
    },
  });
  await client.listContributions({
    status: "needs_review",
    before: { createdAt: "2026-10-01T00:00:00.000Z", id: "c 1" },
    limit: 25,
  });
  await client.acceptReview("c/1", "Checked in Bachs");
  await client.recordExternalReturn("c1", "1500", "Refunded by transfer");
  await client.dismissEvent("evt_1", "Test notice");
  await client.putContext({ id: "coffee", name: "Coffee", currencies: [] }, 3);
  await client.retryEffect("c1", "thank-you");
  assert.deepEqual(calls, [
    [
      "GET",
      "/api/support/owner/contributions?status=needs_review&limit=25&beforeCreatedAt=2026-10-01T00%3A00%3A00.000Z&beforeId=c+1",
      null,
    ],
    [
      "POST",
      "/api/support/owner/contributions/c%2F1/accept-review",
      { note: "Checked in Bachs" },
    ],
    [
      "POST",
      "/api/support/owner/contributions/c1/external-returns",
      { amount: "1500", note: "Refunded by transfer" },
    ],
    [
      "POST",
      "/api/support/owner/events/evt_1/dismiss",
      { note: "Test notice" },
    ],
    [
      "PUT",
      "/api/support/owner/contexts/coffee",
      {
        context: { id: "coffee", name: "Coffee", currencies: [] },
        expectedRevision: 3,
      },
    ],
    ["POST", "/api/support/owner/effects/c1/thank-you/retry", {}],
  ]);
});

test("owner errors keep the server's code and status; a lost connection is network", async () => {
  const { createOwnerClient, OwnerRequestError } =
    await import("../dist/ui/owner.js");
  const refused = createOwnerClient({
    api: "/api/support",
    fetch: async () => json(403, { error: "forbidden" }),
  });
  await assert.rejects(refused.summary(), (error) => {
    assert.ok(error instanceof OwnerRequestError);
    assert.equal(error.code, "forbidden");
    assert.equal(error.status, 403);
    return true;
  });
  const offline = createOwnerClient({
    api: "/api/support",
    fetch: async () => {
      throw new TypeError("offline");
    },
  });
  await assert.rejects(offline.summary(), { code: "network", status: 0 });
});
