import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createContributionIntent, defineSupportContext } from "cheerkit";
import {
  BachsError,
  assessBachsCollection,
  checkoutPaidAsIntended,
  createBachsCheckoutClient,
  createBachsClient,
  createBachsWebhookVerifier,
} from "cheerkit/bachs";

const time = 1_790_164_800;
const secret = "test-endpoint-secret";
const event = {
  id: "evt_example",
  type: "collection.succeeded",
  organization_id: "acct_owner",
  created_at: "2026-09-23T12:00:00.123456+00:00",
  data: {
    charge_id: "ch_example",
    checkout_id: "chk_example",
    amount: "2500.00",
    currency: "NGN",
  },
};
const bytes = (value) =>
  new TextEncoder().encode(
    typeof value === "string" ? value : JSON.stringify(value),
  );
const sign = (body, timestamp = time, key = secret) =>
  createHmac("sha256", key).update(`${timestamp}.`).update(body).digest("hex");
const headers = (body, timestamp = time) => ({
  signatureV2: `t=${timestamp},v1=${sign(body, timestamp)}`,
});
const verifier = (overrides = {}) =>
  createBachsWebhookVerifier({
    secret,
    organizationId: "acct_owner",
    environment: "sandbox",
    now: () => time * 1000,
    ...overrides,
  });
const execute = async (checkout, intent, attempt) =>
  checkout.createCheckout(checkout.prepareCheckout(intent, attempt));
const rejects = (code) => (error) =>
  error instanceof BachsError && error.code === code;

test("webhook authenticates original bytes, scopes owner, and freezes evidence", async () => {
  const body = bytes({
    ...event,
    future: true,
    data: { ...event.data, nested: { list: [1] } },
  });
  const actual = await verifier().verify(body, headers(body));
  assert.equal(actual.id, event.id);
  assert.equal(actual.environment, "sandbox");
  assert.equal(actual.createdAt, event.created_at);
  assert.ok(Object.isFrozen(actual.data.nested.list));
  assert.throws(() => {
    actual.data.amount = "1";
  });
});

test("legacy delivery and every rotation signature are supported", async () => {
  const body = bytes(event);
  await verifier().verify(body, {
    timestamp: String(time),
    signature: sign(body),
  });
  await verifier().verify(body, {
    signatureV2: `t=${time},v1=${"0".repeat(64)},v1=${sign(body)},v2=future`,
  });
});

for (const [name, makeHeaders] of [
  ["missing", () => ({})],
  [
    "wrong key",
    (body) => ({ signatureV2: `t=${time},v1=${sign(body, time, "other")}` }),
  ],
  [
    "duplicate timestamp",
    (body) => ({ signatureV2: `t=${time},t=${time},v1=${sign(body)}` }),
  ],
  ["invalid hex", () => ({ signatureV2: `t=${time},v1=${"z".repeat(64)}` })],
  ["short digest", () => ({ signatureV2: `t=${time},v1=aa` })],
  ["stale", (body) => headers(body, time - 301)],
  ["future", (body) => headers(body, time + 301)],
  [
    "invalid V2 with valid legacy",
    (body) => ({
      signatureV2: "invalid",
      timestamp: String(time),
      signature: sign(body),
    }),
  ],
  ["oversized header", () => ({ signatureV2: "x".repeat(4097) })],
]) {
  test(`webhook rejects ${name}`, async () => {
    const body = bytes(event);
    await assert.rejects(
      verifier().verify(body, makeHeaders(body)),
      rejects("INVALID_SIGNATURE"),
    );
  });
}

test("webhook rejects changed bytes, invalid JSON, and invalid UTF-8", async () => {
  const body = bytes(event);
  await assert.rejects(
    verifier().verify(bytes(JSON.stringify(event, null, 2)), headers(body)),
    rejects("INVALID_SIGNATURE"),
  );
  for (const invalid of [bytes("not json"), new Uint8Array([255])]) {
    await assert.rejects(
      verifier().verify(invalid, headers(invalid)),
      rejects("INVALID_EVENT"),
    );
  }
});

for (const [name, patch, code] of [
  ["other owner", { organization_id: "acct_other" }, "WRONG_ACCOUNT"],
  ["connected account", { account: "acct_owner" }, "WRONG_ACCOUNT"],
  ["missing ID", { id: undefined }, "INVALID_EVENT"],
  ["array data", { data: [] }, "INVALID_EVENT"],
  ["impossible date", { created_at: "2026-02-30T00:00:00Z" }, "INVALID_EVENT"],
]) {
  test(`webhook rejects ${name}`, async () => {
    const body = bytes({ ...event, ...patch });
    await assert.rejects(verifier().verify(body, headers(body)), rejects(code));
  });
}

test("unknown event type is authenticated without implying success", async () => {
  const body = bytes({ ...event, type: "future.event" });
  assert.equal(
    (await verifier().verify(body, headers(body))).type,
    "future.event",
  );
});

test("body size and clock configuration fail closed", async () => {
  const body = bytes(event);
  await assert.rejects(
    verifier({ maxBodyBytes: 1 }).verify(body, headers(body)),
    rejects("INVALID_EVENT"),
  );
  await assert.rejects(
    verifier({ now: () => NaN }).verify(body, headers(body)),
    rejects("INVALID_SIGNATURE"),
  );
  assert.throws(
    () => verifier({ toleranceSeconds: Infinity }),
    rejects("INVALID_CONFIGURATION"),
  );
  assert.throws(
    () => verifier({ environment: "oops" }),
    rejects("INVALID_CONFIGURATION"),
  );
});

test("caller mutation during asynchronous verification cannot change parsed evidence", async () => {
  const body = bytes(event);
  const pending = verifier().verify(body, headers(body));
  body.fill(0);
  assert.equal((await pending).id, event.id);
});

const intent = createContributionIntent(
  defineSupportContext({
    id: "personal",
    name: "My work",
    collectName: true,
    collectMessage: true,
    currencies: [{ currency: "NGN", fractionDigits: 2, minimum: "100" }],
  }),
  {
    amount: "2500",
    currency: "NGN",
    supporterName: "Private Name",
    message: "Private note",
  },
  {
    id: "contribution-1",
    createdAt: "2026-09-23T12:00:00.000Z",
  },
);
const attempt = {
  reference: "installation-attempt-1",
  idempotencyKey: "operation-1",
};
const checkoutResponse = {
  checkout_id: "chk_example",
  checkout_url: "https://checkout.bachs.io/c/example",
  status: "open",
  reference: attempt.reference,
  created_at: "2026-09-23T12:00:00Z",
  expires_at: "2026-09-23T13:00:00Z",
};
const client = (fetch, overrides = {}) =>
  createBachsCheckoutClient({
    organizationId: "acct_owner",
    secretKey: "sk_sandbox_example",
    successUrl: "https://example.com/support/result",
    cancelUrl: "https://example.com/support",
    fetch,
    ...overrides,
  });

test("checkout sends exact money and stable identity without private supporter text", async () => {
  const requests = [];
  const checkout = client(async (url, options) => {
    requests.push({ url, options });
    return Response.json({ ...checkoutResponse, extra: true }, { status: 201 });
  });
  const result = await execute(checkout, intent, attempt);
  await execute(checkout, intent, attempt);
  assert.equal(result.id, "chk_example");
  assert.ok(Object.isFrozen(result));
  assert.equal(
    requests[0].url,
    "https://sandbox-api.bachs.io/v1/checkout-sessions",
  );
  assert.equal(requests[0].options.body, requests[1].options.body);
  assert.equal(
    requests[0].options.headers["Idempotency-Key"],
    attempt.idempotencyKey,
  );
  assert.equal(requests[0].options.redirect, "error");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    pricing: { currency: "NGN", amount: "2500.00", price_type: "fixed" },
    reference: attempt.reference,
    success_url: "https://example.com/support/result",
    cancel_url: "https://example.com/support",
    customer_bears_fee: false,
  });
});

test("live requires explicit environment with matching credentials", async () => {
  assert.throws(
    () => client(fetch, { secretKey: "sk_live_example" }),
    rejects("INVALID_CONFIGURATION"),
  );
  await execute(
    client(
      async (url) => {
        assert.equal(url, "https://api.bachs.io/v1/checkout-sessions");
        return Response.json(checkoutResponse);
      },
      { environment: "live", secretKey: "sk_live_example" },
    ),
    intent,
    attempt,
  );
});

test("configuration is captured before callers mutate it", async () => {
  const methods = ["NGN_BANK_TRANSFER"];
  const checkout = client(
    async (_, options) => {
      assert.deepEqual(JSON.parse(options.body).payment_method_types, [
        "NGN_BANK_TRANSFER",
      ]);
      return Response.json(checkoutResponse);
    },
    { paymentMethodTypes: methods },
  );
  methods.push("USD_CARD");
  await execute(checkout, intent, attempt);
});

for (const status of [400, 401, 403, 404, 422, 429, 409, 500, 502]) {
  test(`checkout HTTP ${status} has a safe categorized outcome`, async () => {
    let calls = 0;
    const checkout = client(async () => {
      calls++;
      return Response.json({ detail: "private provider response" }, { status });
    });
    await assert.rejects(execute(checkout, intent, attempt), (error) => {
      assert.equal(
        error.code,
        [409, 500, 502].includes(status)
          ? "CHECKOUT_UNCERTAIN"
          : "CHECKOUT_REJECTED",
      );
      assert.equal(error.httpStatus, status);
      assert.ok(!error.message.includes("private"));
      return true;
    });
    assert.equal(calls, 1);
  });
}

test("network failure and malformed success preserve uncertainty", async () => {
  for (const transport of [
    async () => {
      throw new Error("secret network detail");
    },
    async () => new Response("not json"),
    async () => Response.json({ ...checkoutResponse, reference: "different" }),
    async () =>
      Response.json({
        ...checkoutResponse,
        checkout_url: "javascript:alert(1)",
      }),
    async () => Response.json({ ...checkoutResponse, status: "unknown" }),
  ]) {
    await assert.rejects(
      execute(client(transport), intent, attempt),
      rejects("CHECKOUT_UNCERTAIN"),
    );
  }
});

test("invalid trusted inputs are rejected before transport", async () => {
  let called = false;
  const checkout = client(async () => {
    called = true;
    throw new Error();
  });
  for (const invalid of [
    { ...intent, amount: 100 },
    { ...intent, status: "paid" },
    { ...intent, currency: "ngn" },
  ]) {
    await assert.rejects(
      execute(checkout, invalid, attempt),
      rejects("INVALID_CHECKOUT"),
    );
  }
  await assert.rejects(
    execute(checkout, intent, { ...attempt, idempotencyKey: "bad\nheader" }),
    rejects("INVALID_CHECKOUT"),
  );
  assert.equal(called, false);
  assert.throws(
    () => client(fetch, { successUrl: "http://example.com" }),
    rejects("INVALID_CONFIGURATION"),
  );
  assert.throws(
    () => client(fetch, { feeBearer: "automatic" }),
    rejects("INVALID_CONFIGURATION"),
  );
  assert.throws(
    () => client(fetch, { unknownFeeOption: true }),
    rejects("INVALID_CONFIGURATION"),
  );
});

test("fee configuration is explicit and never silently downgraded", async () => {
  for (const [feeBearer, value] of [
    ["merchant", false],
    ["customer", true],
    ["account_default", undefined],
  ]) {
    await execute(
      client(
        async (_, request) => {
          const payload = JSON.parse(request.body);
          assert.equal(payload.customer_bears_fee, value);
          assert.equal(
            Object.hasOwn(payload, "customer_bears_fee"),
            value !== undefined,
          );
          return Response.json(checkoutResponse);
        },
        { feeBearer },
      ),
      intent,
      attempt,
    );
  }
});

const expected = {
  organizationId: "acct_owner",
  environment: "sandbox",
  checkoutId: "chk_example",
  reference: attempt.reference,
  amount: "2500.00",
  currency: "NGN",
  fractionDigits: 2,
};
async function collection(patch = {}, envelope = {}) {
  const body = bytes({
    ...event,
    ...envelope,
    data: {
      ...event.data,
      status: "succeeded",
      reference: attempt.reference,
      settlement_amount: "2400.00",
      settlement_currency: "NGN",
      ...patch,
    },
  });
  return verifier().verify(body, headers(body));
}

test("matched collection uses gross facts and still does not declare durable success", async () => {
  const result = assessBachsCollection(await collection(), expected);
  assert.deepEqual(result, {
    outcome: "matched",
    eventId: event.id,
    chargeId: "ch_example",
    checkoutId: "chk_example",
    amount: "2500.00",
    currency: "NGN",
  });
  assert.ok(Object.isFrozen(result));
  assert.equal(
    assessBachsCollection(
      await collection({ status: "accepted", reference: null }),
      expected,
    ).outcome,
    "matched",
  );
});

for (const [patch, reason] of [
  [{ charge_id: null }, "missing_payment_identity"],
  [{ reference: "another-attempt" }, "reference_mismatch"],
  [{ amount: "2499.00" }, "amount_mismatch"],
  [{ amount: "2501.00" }, "amount_mismatch"],
  [{ amount: 2500 }, "invalid_payment_facts"],
  [{ currency: "usd" }, "invalid_payment_facts"],
  [{ currency: "USD", amount: "0.00" }, "invalid_payment_facts"],
  [{ currency: "USD", amount: 1.77 }, "invalid_payment_facts"],
  [{ status: "overpaid" }, "unrecognized_status"],
  [{ status: "new_status" }, "unrecognized_status"],
]) {
  test(`collection requires review for ${JSON.stringify(patch)}`, async () => {
    assert.deepEqual(assessBachsCollection(await collection(patch), expected), {
      outcome: "review",
      reason,
      eventId: event.id,
    });
  });
}

test("Bachs's upper-case collection status is recognized (observed in the sandbox)", async () => {
  assert.equal(
    assessBachsCollection(await collection({ status: "SUCCEEDED" }), expected)
      .outcome,
    "matched",
  );
});

test("a collection settled in another currency is converted, never matched directly", async () => {
  assert.deepEqual(
    assessBachsCollection(
      await collection({ currency: "USD", amount: "1.77" }),
      expected,
    ),
    {
      outcome: "converted",
      eventId: event.id,
      chargeId: "ch_example",
      checkoutId: "chk_example",
    },
  );
});

test("only a paid checkout completion for the exact intended amount and currency is conversion evidence", async () => {
  const completion = async (patch = {}) =>
    collection(
      {
        status: "completed",
        payment_status: "paid",
        amount: "2500.00",
        currency: "NGN",
        ...patch,
      },
      { type: "checkout.completed" },
    );
  assert.equal(checkoutPaidAsIntended(await completion(), expected), true);
  assert.equal(
    checkoutPaidAsIntended(
      await completion({ payment_status: "PAID", reference: null }),
      expected,
    ),
    true,
  );
  for (const patch of [
    { payment_status: "unpaid" },
    { payment_status: null },
    { amount: "2499.00" },
    { amount: "2500.001" },
    { currency: "USD" },
    { status: "expired" },
    { checkout_id: "chk_other" },
    { reference: "another-attempt" },
  ]) {
    assert.equal(
      checkoutPaidAsIntended(await completion(patch), expected),
      false,
      JSON.stringify(patch),
    );
  }
  assert.equal(checkoutPaidAsIntended(await collection(), expected), false);
});

test("unrelated checkout and non-collection events cannot match a payment", async () => {
  assert.equal(
    assessBachsCollection(
      await collection({ checkout_id: "chk_other" }),
      expected,
    ).reason,
    "unrelated_checkout",
  );
  for (const type of [
    "checkout.completed",
    "checkout.expired",
    "collection.failed",
    "refund.paid",
  ]) {
    assert.equal(
      assessBachsCollection(await collection({}, { type }), expected).reason,
      "event_type",
    );
  }
});

test("assessment requires original authenticated evidence and matching configured scope", async () => {
  const verified = await collection();
  assert.throws(
    () => assessBachsCollection({ ...verified }, expected),
    rejects("INVALID_SIGNATURE"),
  );
  assert.throws(
    () => assessBachsCollection(verified, { ...expected, environment: "live" }),
    rejects("WRONG_ACCOUNT"),
  );
  assert.throws(
    () => assessBachsCollection(verified, { ...expected, amount: "invalid" }),
    rejects("INVALID_CONFIGURATION"),
  );
});

test("provider response is bounded and timeout signal is passed to transport", async () => {
  await assert.rejects(
    execute(
      client(async () => new Response(" ".repeat(1_048_577))),
      intent,
      attempt,
    ),
    rejects("CHECKOUT_UNCERTAIN"),
  );
  await assert.rejects(
    execute(
      client(
        async (_, request) => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          assert.equal(request.signal.aborted, true);
          request.signal.throwIfAborted();
        },
        { timeoutMs: 1 },
      ),
      intent,
      attempt,
    ),
    rejects("CHECKOUT_UNCERTAIN"),
  );
});

test("browser export condition admits core and blocks the provider boundary", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--conditions=browser",
      "--input-type=module",
      "-e",
      `
    await import("cheerkit");
    try { await import("cheerkit/bachs"); process.exit(1); }
    catch (error) { if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error; }
  `,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("persisted prepared checkout retains exact body when configuration changes", async () => {
  const original = client(fetch).prepareCheckout(intent, attempt);
  const restored = JSON.parse(JSON.stringify(original));
  const changed = client(
    async (_, options) => {
      assert.equal(options.body, original.body);
      return Response.json(checkoutResponse);
    },
    { successUrl: "https://example.com/new-result", feeBearer: "customer" },
  );
  await changed.createCheckout(restored);
});

test("prepared request cannot add platform transfers or cross provider environments", async () => {
  let called = false;
  const checkout = client(async () => {
    called = true;
    throw new Error();
  });
  const prepared = checkout.prepareCheckout(intent, attempt);
  const body = JSON.parse(prepared.body);
  await assert.rejects(
    checkout.createCheckout({
      ...prepared,
      body: JSON.stringify({
        ...body,
        transfer_data: { destination: "other" },
      }),
    }),
    rejects("INVALID_CHECKOUT"),
  );
  await assert.rejects(
    checkout.createCheckout({ ...prepared, environment: "live" }),
    rejects("INVALID_CHECKOUT"),
  );
  assert.equal(called, false);
});

const recoveryResponse = {
  ...checkoutResponse,
  amount: "2500.00",
  currency: "NGN",
  success_url: "https://example.com/support/result",
  cancel_url: "https://example.com/support",
  customer: { email: "private@example.test" },
  charge: { status: "succeeded" },
  payment_status: "succeeded",
};

test("retrieval uses one bounded authenticated GET and returns only association evidence without a URL", async () => {
  let calls = 0;
  const checkout = client(async (url, options) => {
    calls++;
    assert.equal(
      url,
      "https://sandbox-api.bachs.io/v1/checkout-sessions/chk_example",
    );
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.body, undefined);
    assert.equal(options.headers["Idempotency-Key"], undefined);
    assert.equal(options.headers.Authorization, "Bearer sk_sandbox_example");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(recoveryResponse);
  });
  const result = await checkout.retrieveCheckout(
    "chk_example",
    checkout.prepareCheckout(intent, attempt),
  );
  assert.deepEqual(result, {
    id: "chk_example",
    reference: attempt.reference,
    status: "open",
    amount: "2500.00",
    currency: "NGN",
    organizationId: "acct_owner",
    environment: "sandbox",
    createdAt: checkoutResponse.created_at,
    expiresAt: checkoutResponse.expires_at,
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(calls, 1);
});

test("retrieval rejects mismatched or malformed association facts", async () => {
  for (const changes of [
    { checkout_id: "other" },
    { reference: "other" },
    { amount: "2499.99" },
    { amount: 2500 },
    { currency: "USD" },
    { success_url: "https://other.test" },
    { cancel_url: null },
    { organization_id: "another-owner" },
    { account: "connected" },
    { status: "unknown" },
    { created_at: "invalid" },
    { expires_at: "2020-01-01T00:00:00Z" },
  ]) {
    const checkout = client(async () =>
      Response.json({ ...recoveryResponse, ...changes }),
    );
    await assert.rejects(
      checkout.retrieveCheckout(
        "chk_example",
        checkout.prepareCheckout(intent, attempt),
      ),
      { code: "RECOVERY_FAILED" },
    );
  }
});

test("retrieval errors never become checkout rejection or leak provider details", async () => {
  for (const transport of [
    async () => new Response("private provider detail", { status: 404 }),
    async () => new Response("private provider detail", { status: 503 }),
    async () => {
      throw new Error("private network detail");
    },
    async () => new Response("bad json"),
    async () => new Response("x".repeat(1_048_577)),
  ]) {
    let calls = 0;
    const checkout = client(async (...args) => {
      calls++;
      return transport(...args);
    });
    await assert.rejects(
      checkout.retrieveCheckout(
        "chk_example",
        checkout.prepareCheckout(intent, attempt),
      ),
      (error) => {
        assert.equal(error.code, "RECOVERY_FAILED");
        assert.equal(error.message.includes("private"), false);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test("retrieval refuses path manipulation and wrong environment before transport", async () => {
  const checkout = client(async () =>
    assert.fail("Unexpected provider request"),
  );
  const prepared = checkout.prepareCheckout(intent, attempt);
  for (const id of ["..", ".", "../checkout", "a?b", "", null]) {
    await assert.rejects(checkout.retrieveCheckout(id, prepared), {
      code: "INVALID_CHECKOUT",
    });
  }
  await assert.rejects(
    async () =>
      checkout.retrieveCheckout("chk_example", {
        ...prepared,
        environment: "live",
      }),
    { code: "INVALID_CHECKOUT" },
  );
});

test("checkout clients expose a per-key credential fingerprint and retry timing without the key", async () => {
  const options = {
    organizationId: "acct_owner",
    successUrl: "https://example.com/result",
    cancelUrl: "https://example.com/support",
    timeoutMs: 2_000,
    fetch: async () => {
      throw new Error("no request expected");
    },
  };
  const first = createBachsCheckoutClient({
    ...options,
    secretKey: "sk_sandbox_first",
  });
  const fingerprint = await first.credentialFingerprint();
  assert.equal(
    fingerprint,
    createHash("sha256").update("sk_sandbox_first").digest("hex"),
  );
  assert.equal(await first.credentialFingerprint(), fingerprint);
  assert.equal(fingerprint.includes("sk_sandbox"), false);
  assert.notEqual(
    await createBachsCheckoutClient({
      ...options,
      secretKey: "sk_sandbox_second",
    }).credentialFingerprint(),
    fingerprint,
  );
  assert.equal(first.timeoutMs, 2_000);
  assert.equal(first.retryWindowMs, 23 * 60 * 60 * 1000);
});

test("notice replay uses a scoped POST and redacts provider failures", async () => {
  const options = {
    organizationId: "acct_owner",
    secretKey: "sk_sandbox_fixture",
    successUrl: "https://example.test/result",
    cancelUrl: "https://example.test/support",
  };
  let calls = 0;
  const client = createBachsCheckoutClient({
    ...options,
    fetch: async (url, init) => {
      calls++;
      assert.equal(url, "https://sandbox-api.bachs.io/v1/webhooks/replay");
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "error");
      assert.deepEqual(JSON.parse(init.body), { charge_id: "ch_fixture" });
      return Response.json({ attempt_id: "fixture" });
    },
  });
  await client.resendChargeNotices("ch_fixture");
  await assert.rejects(
    client.resendChargeNotices(""),
    rejects("INVALID_CHECKOUT"),
  );
  assert.equal(calls, 1);
  for (const status of [403, 429, 500]) {
    const failed = createBachsCheckoutClient({
      ...options,
      fetch: async () => new Response("private provider detail", { status }),
    });
    await assert.rejects(failed.resendChargeNotices("ch_fixture"), (error) => {
      assert.equal(error.code, "RESEND_FAILED");
      assert.doesNotMatch(error.message, /private provider detail/);
      return true;
    });
  }
  await assert.rejects(
    createBachsCheckoutClient({
      ...options,
      fetch: async () => {
        throw new Error("private network detail");
      },
    }).resendChargeNotices("ch_fixture"),
    rejects("RESEND_FAILED"),
  );
});

test("payment retrieval reads Bachs's current record without payer details, validating formats only", async () => {
  const options = {
    organizationId: "acct_owner",
    secretKey: "sk_sandbox_fixture",
    successUrl: "https://example.test/result",
    cancelUrl: "https://example.test/support",
  };
  const record = {
    payment_id: "ch_fixture",
    checkout_id: "chk_fixture",
    status: "a_status_cheerkit_has_never_seen",
    amount: "4500.00",
    currency: "XYZ",
    amount_paid: "4500.00",
    fee_usd: "0.05",
    fees: { amount: "67.50", currency: "XYZ", breakdown: [] },
    merchant_bears_cost: true,
    customer: { name: "Synthetic payer", email: "payer@example.test" },
  };
  const client = (response) =>
    createBachsCheckoutClient({
      ...options,
      fetch: async (url, init) => {
        assert.equal(
          url,
          "https://sandbox-api.bachs.io/v1/payments/ch_fixture",
        );
        assert.equal(init.method, "GET");
        assert.equal(init.redirect, "error");
        assert.equal(init.body, undefined);
        return typeof response === "function"
          ? response()
          : Response.json(response);
      },
    });
  const statement = await client(record).retrievePayment("ch_fixture");
  assert.deepEqual(
    { ...statement },
    {
      organizationId: "acct_owner",
      environment: "sandbox",
      chargeId: "ch_fixture",
      checkoutId: "chk_fixture",
      status: "a_status_cheerkit_has_never_seen",
      amount: "4500.00",
      currency: "XYZ",
      fee: { amount: "67.50", currency: "XYZ" },
      feeBearer: "merchant",
    },
  );
  assert.ok(Object.isFrozen(statement));
  assert.doesNotMatch(JSON.stringify(statement), /payer|0\.05/);
  assert.deepEqual(
    (
      await client({
        ...record,
        fees: null,
        merchant_bears_cost: false,
      }).retrievePayment("ch_fixture")
    ).fee,
    null,
  );
  assert.equal(
    (
      await client({ ...record, merchant_bears_cost: false }).retrievePayment(
        "ch_fixture",
      )
    ).feeBearer,
    "customer",
  );
  assert.equal(
    (
      await client({ ...record, merchant_bears_cost: null }).retrievePayment(
        "ch_fixture",
      )
    ).feeBearer,
    null,
  );

  for (const invalid of [
    { payment_id: "ch_other" },
    { amount: "None" },
    { currency: "usd" },
    { fees: { amount: "None", currency: "XYZ" } },
    { fees: { amount: "1.00" } },
    { merchant_bears_cost: "yes" },
    { status: "" },
    { account: "acct_connected" },
  ]) {
    await assert.rejects(
      client({ ...record, ...invalid }).retrievePayment("ch_fixture"),
      rejects("LOOKUP_FAILED"),
    );
  }
  for (const status of [404, 500]) {
    await assert.rejects(
      client(
        () => new Response("private provider detail", { status }),
      ).retrievePayment("ch_fixture"),
      (error) => {
        assert.equal(error.code, "LOOKUP_FAILED");
        assert.equal(error.httpStatus, status);
        assert.doesNotMatch(error.message, /private provider detail/);
        return true;
      },
    );
  }
  await assert.rejects(
    client(() => {
      throw new Error("private network detail");
    }).retrievePayment("ch_fixture"),
    rejects("LOOKUP_FAILED"),
  );
  for (const id of ["", "..", "ch/other"])
    await assert.rejects(
      client(record).retrievePayment(id),
      rejects("INVALID_CHECKOUT"),
    );
});

test("the account client needs no return URLs and sends a stored request exactly as prepared", async () => {
  const sent = [];
  const transport = async (url, init) => {
    sent.push({ url, body: init.body, key: init.headers["Idempotency-Key"] });
    return Response.json(checkoutResponse, { status: 201 });
  };
  const account = createBachsClient({
    organizationId: "acct_owner",
    secretKey: "sk_sandbox_example",
    fetch: transport,
  });
  const prepared = client(transport).prepareCheckout(intent, attempt);
  const created = await account.createCheckout(prepared);
  assert.deepEqual(sent, [
    {
      url: "https://sandbox-api.bachs.io/v1/checkout-sessions",
      body: prepared.body,
      key: attempt.idempotencyKey,
    },
  ]);
  assert.equal(created.id, checkoutResponse.checkout_id);
  assert.equal("prepareCheckout" in account, false);
  assert.equal(
    await account.credentialFingerprint(),
    await client(transport).credentialFingerprint(),
  );
  for (const extra of [
    { successUrl: "https://example.com/result" },
    { feeBearer: "merchant" },
  ]) {
    assert.throws(
      () =>
        createBachsClient({
          organizationId: "acct_owner",
          secretKey: "sk_sandbox_example",
          ...extra,
        }),
      rejects("INVALID_CONFIGURATION"),
    );
  }
  const live = createBachsClient({
    organizationId: "acct_owner",
    secretKey: "sk_live_example",
    environment: "live",
    fetch: transport,
  });
  await assert.rejects(
    live.createCheckout(prepared),
    rejects("INVALID_CHECKOUT"),
  );
});
