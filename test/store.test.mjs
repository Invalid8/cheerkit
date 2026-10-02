import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import test from "node:test";
import { createContributionIntent, defineSupportContext } from "cheerkit";
import {
  createBachsCheckoutClient,
  createBachsWebhookVerifier,
} from "cheerkit/bachs";
import { cheerkitMigrations, openStore } from "cheerkit/server";
import { dialects, hostDatabase, testStore } from "./helpers.mjs";

const time = 1_790_164_800;
const hour = 3_600_000;
const credential = "a".repeat(64);
const client = createBachsCheckoutClient({
  organizationId: "acct_owner",
  secretKey: "sk_sandbox_fixture",
  successUrl: "https://example.com/result",
  cancelUrl: "https://example.com/support",
  fetch: async () => {
    throw new Error("Tests must not perform provider requests.");
  },
});
const context = defineSupportContext({
  id: "work",
  name: "My work",
  collectName: true,
  collectMessage: true,
  currencies: [{ currency: "NGN", fractionDigits: 2, minimum: "100" }],
});

function intent(
  id = "c1",
  submission = { amount: "2500", currency: "NGN", message: "Private note" },
) {
  return createContributionIntent(context, submission, {
    id,
    createdAt: "2026-09-23T12:00:00.000Z",
  });
}
const request = (value) =>
  client.prepareCheckout(value, {
    reference: `attempt-${value.id}`,
    idempotencyKey: `operation-${value.id}`,
  });
const dispatch = (at = time * 1000, overrides = {}) => ({
  credential,
  at,
  retryUntil: at + 23 * hour,
  leaseUntil: at + 15_000,
  ...overrides,
});
const checkout = (id = "c1") => ({
  id: `chk-${id}`,
  reference: `attempt-${id}`,
  url: `https://checkout.bachs.io/c/${id}`,
  status: "open",
  createdAt: "2026-09-23T12:00:00Z",
  expiresAt: "2026-09-23T13:00:00Z",
});

async function event(id = "evt_1", data = {}, type = "collection.succeeded") {
  const raw = new TextEncoder().encode(
    JSON.stringify({
      id,
      type,
      organization_id: "acct_owner",
      created_at: "2026-09-23T12:00:00Z",
      data: {
        checkout_id: "chk-c1",
        reference: "attempt-c1",
        charge_id: "ch_1",
        status: "succeeded",
        amount: "2500.00",
        currency: "NGN",
        settlement_currency: "NGN",
        ...data,
      },
    }),
  );
  const digest = createHmac("sha256", "fixture-secret")
    .update(`${time}.`)
    .update(raw)
    .digest("hex");
  return createBachsWebhookVerifier({
    secret: "fixture-secret",
    organizationId: "acct_owner",
    environment: "sandbox",
    now: () => time * 1000,
  }).verify(raw, { signatureV2: `t=${time},v1=${digest}` });
}

async function fixture(t, dialect, options = {}) {
  const host = await hostDatabase(t, dialect);
  const open = async (extra = options) => {
    const connection = host.connect();
    const store = await testStore(host, connection, extra);
    if (!(await store.getContext(context.id)))
      await store.putContext(context, null);
    return { ...store, connection };
  };
  return { host, open, store: await open() };
}
const reserve = (store, id = "c1", key = "submission-1", metadata) => {
  const value = intent(id);
  return store.reserve(value, request(value), key, metadata);
};
async function ready(store, id = "c1", key = "submission-1") {
  await reserve(store, id, key);
  assert.ok(await store.claimCheckout(id, dispatch()));
  await store.recordCheckout(id, checkout(id));
}
const rows = (store, sql) => store.connection.database.query(sql);

for (const dialect of dialects()) {
  const it = (name, work) => test(`[${dialect}] ${name}`, (t) => work(t));

  it("Cheerkit leaves the application's own tables, data, and locks alone", async (t) => {
    const host = await hostDatabase(t, dialect);
    const app = host.connect();
    await app.database.query(
      "CREATE TABLE app_users (id TEXT PRIMARY KEY, email TEXT NOT NULL)",
    );
    await app.database.query(
      "CREATE TABLE contributions (id TEXT PRIMARY KEY, note TEXT)",
    );
    await app.database.query(
      "INSERT INTO app_users (id, email) VALUES ('u1', 'owner@example.test')",
    );
    await app.database.query(
      "INSERT INTO contributions (id, note) VALUES ('app-1', 'an application row')",
    );
    const before = JSON.stringify([
      await app.database.query("SELECT * FROM app_users"),
      await app.database.query("SELECT * FROM contributions"),
    ]);
    const statements = [];
    const recorded = (executor) => ({
      query: (sql, params) => {
        statements.push(sql);
        return executor.query(sql, params);
      },
    });
    const database = {
      dialect,
      query: recorded(app.database).query,
      transaction: (key, work) =>
        app.database.transaction(key, (tx) => work(recorded(tx))),
    };
    let hostLock;
    if (dialect === "postgres") {
      hostLock = await app.raw.connect();
      await hostLock.query("BEGIN");
      await hostLock.query("SELECT pg_advisory_xact_lock(72819461)");
      await hostLock.query(
        "SELECT pg_advisory_xact_lock(hashtext('cheerkit_test-installation'))",
      );
    }
    try {
      const store = await openStore({
        database,
        installationId: "test-installation",
        organizationId: "acct_owner",
        environment: "sandbox",
      });
      await store.putContext(context, null);
      await ready(store);
      await store.acceptEvent(await event());
      await store.processEvent("evt_1");
      await store.removePersonalData("c1", "owner", "2026-09-24T12:00:00.000Z");
      await store.applyRetention(
        "2100-01-01T00:00:00.000Z",
        "2100-01-01T00:00:00.000Z",
      );
      assert.equal((await store.getContribution("c1")).outcome, "confirmed");
    } finally {
      if (hostLock) {
        await hostLock.query("ROLLBACK");
        hostLock.release();
      }
    }
    assert.equal(
      JSON.stringify([
        await app.database.query("SELECT * FROM app_users"),
        await app.database.query("SELECT * FROM contributions"),
      ]),
      before,
    );
    for (const sql of statements) {
      assert.doesNotMatch(sql, /\b(DROP|ALTER|TRUNCATE|DELETE|CREATE)\b/i, sql);
      for (const [, table] of sql.matchAll(
        /\b(?:FROM|INTO|(?<!DO )UPDATE|JOIN)\s+([A-Za-z_][\w.]*)/gi,
      ))
        assert.match(table, /^cheerkit_/, sql);
    }
    const clash = await hostDatabase(t, dialect, "app_");
    const clashing = clash.connect();
    const [first] = cheerkitMigrations({ prefix: "app_" });
    await assert.rejects(
      dialect === "sqlite"
        ? (async () => clashing.raw.exec(first.sql))()
        : clashing.raw.query(first.sql),
    );
  });

  it("the store refuses tables that were not migrated, other versions, and another installation", async (t) => {
    const host = await hostDatabase(t, dialect);
    const connection = host.connect();
    await assert.rejects(testStore(host, connection, { prefix: "other_" }), {
      code: "INVALID_STATE",
    });
    await testStore(host, connection);
    await assert.rejects(
      testStore(host, connection, { installationId: "another" }),
      { code: "CONFLICT" },
    );
    await assert.rejects(testStore(host, connection, { environment: "live" }), {
      code: "CONFLICT",
    });
    for (const version of [1, 3]) {
      await connection.database.query("UPDATE cheerkit_meta SET version = ?", [
        version,
      ]);
      await assert.rejects(testStore(host, connection), {
        code: "INVALID_STATE",
      });
    }
    assert.throws(
      () => cheerkitMigrations({ prefix: "Bad-Prefix" }),
      TypeError,
    );
  });

  it("tables can use another prefix beside the host's own tables", async (t) => {
    const host = await hostDatabase(t, dialect, "support_");
    const connection = host.connect();
    await connection.database.query(
      "CREATE TABLE app_users (id TEXT PRIMARY KEY)",
    );
    const store = await testStore(host, connection, { prefix: "support_" });
    await store.putContext(context, null);
    const value = intent();
    await store.reserve(value, request(value), "submission-1");
    assert.equal(
      (
        await connection.database.query(
          "SELECT count(*) AS total FROM support_contributions",
        )
      )[0].total == 1,
      true,
    );
  });

  it("reservation survives reopening; the key keeps its identity while personal text is not part of it", async (t) => {
    const f = await fixture(t, dialect);
    const reserved = await reserve(f.store);
    const second = await f.open();
    assert.deepEqual(await reserve(second, "different-generated-id"), reserved);
    const changedMessage = intent("c3", {
      amount: "2500",
      currency: "NGN",
      message: "Edited later",
    });
    assert.equal(
      (
        await second.reserve(
          changedMessage,
          request(changedMessage),
          "submission-1",
        )
      ).intent.message,
      "Private note",
    );
    const changed = intent("c2", { amount: "3000", currency: "NGN" });
    await assert.rejects(
      second.reserve(changed, request(changed), "submission-1"),
      { code: "CONFLICT" },
    );
    await assert.rejects(
      reserve(second, "c4", "submission-1", { entry: "modal" }),
      { code: "CONFLICT" },
    );
    assert.equal((await second.listContributions()).length, 1);
    const [row] = await rows(
      second,
      "SELECT fingerprint FROM cheerkit_contributions",
    );
    assert.equal(row.fingerprint.includes("Private"), false);
  });

  it("one worker claims checkout; re-dispatch needs the same credential, an expired lease, and the retry window", async (t) => {
    const f = await fixture(t, dialect);
    await reserve(f.store);
    const start = time * 1000;
    assert.deepEqual(await f.store.claimCheckout("c1", dispatch(start)), {
      request: (await f.store.getContribution("c1")).request,
      retry: false,
    });
    const second = await f.open();
    assert.equal(
      await second.claimCheckout("c1", dispatch(start + 14_999)),
      null,
    );
    assert.equal(
      await second.claimCheckout(
        "c1",
        dispatch(start + 15_000, { credential: "b".repeat(64) }),
      ),
      null,
    );
    assert.equal(
      (await second.claimCheckout("c1", dispatch(start + 15_000))).retry,
      true,
    );
    assert.equal(
      await second.claimCheckout("c1", dispatch(start + 16_000)),
      null,
    );
    await second.recordCheckoutFailure("c1", "uncertain");
    assert.equal(
      await second.claimCheckout("c1", dispatch(start + 23 * hour)),
      null,
    );
    const late = dispatch(start + 23 * hour - 1);
    assert.equal(
      (
        await second.claimCheckout("c1", {
          ...late,
          retryUntil: late.at + 23 * hour,
        })
      ).retry,
      true,
    );
    await second.recordCheckout("c1", checkout());
    await second.recordCheckoutFailure("c1", "uncertain");
    assert.equal(
      (await second.getContribution("c1")).attemptState,
      "available",
    );
    assert.equal(
      await second.claimCheckout("c1", dispatch(start + 20_000)),
      null,
    );
    for (const invalid of [
      { credential: "short" },
      { at: 1.5 },
      { retryUntil: start },
      { leaseUntil: start },
      { extra: true },
    ]) {
      await assert.rejects(
        second.claimCheckout("c1", { ...dispatch(start), ...invalid }),
      );
    }
  });

  it("payer identity in a delivery is never stored; the duplicate check still covers the full delivery", async (t) => {
    const f = await fixture(t, dialect);
    await ready(f.store);
    const verified = await event("evt_1", {
      customer: {
        email: "payer@example.test",
        name: "Payer Name",
        phone_number: "+2348000000000",
      },
      customer_details: { email: "payer@example.test" },
      metadata: { note: "private" },
    });
    assert.equal(await f.store.acceptEvent(verified), "accepted");
    const stored = JSON.stringify(
      await rows(f.store, "SELECT * FROM cheerkit_events"),
    );
    for (const secret of [
      "payer@example.test",
      "Payer Name",
      "+2348000000000",
      "private",
    ])
      assert.equal(stored.includes(secret), false);
    assert.equal((await f.store.processEvent("evt_1")).state, "applied");
    assert.equal(await f.store.acceptEvent(verified), "duplicate");
    const changed = await event("evt_1", {
      customer: { email: "someone-else@example.test" },
    });
    assert.equal(await f.store.acceptEvent(changed), "conflict");
    assert.equal(
      JSON.stringify(
        await rows(f.store, "SELECT * FROM cheerkit_event_conflicts"),
      ).includes("someone-else"),
      false,
    );
  });

  it("supporter text and metadata can be encrypted at rest with the host key", async (t) => {
    const key = randomBytes(32).toString("base64url");
    const f = await fixture(t, dialect, { encryptionKey: key });
    await reserve(f.store, "c1", "submission-1", { entry_point: "modal" });
    const [raw] = await rows(
      f.store,
      "SELECT supporter_name, message, metadata FROM cheerkit_contributions",
    );
    assert.match(raw.message, /^enc1\./);
    assert.match(raw.metadata, /^enc1\./);
    assert.equal(
      JSON.stringify(raw).includes("Private note") ||
        JSON.stringify(raw).includes("modal"),
      false,
    );
    const read = await f.store.getContribution("c1");
    assert.equal(read.intent.message, "Private note");
    assert.deepEqual(read.metadata, { entry_point: "modal" });
    const wrongKey = await f.open({
      encryptionKey: randomBytes(32).toString("base64url"),
    });
    await assert.rejects(wrongKey.getContribution("c1"), {
      code: "STORAGE_FAILURE",
    });
    const noKey = await f.open({});
    await assert.rejects(noKey.getContribution("c1"), {
      code: "STORAGE_FAILURE",
    });
    await assert.rejects(f.open({ encryptionKey: "short" }), TypeError);
  });

  it("personal data can be removed on request and by retention, keeping payment facts and deduplication", async (t) => {
    const f = await fixture(t, dialect);
    await reserve(f.store, "c1", "submission-1", { entry_point: "modal" });
    assert.ok(await f.store.claimCheckout("c1", dispatch()));
    await f.store.recordCheckout("c1", checkout("c1"));
    await reserve(f.store, "c2", "submission-2");
    await reserve(f.store, "c3", "submission-3");
    const collected = await event();
    await f.store.acceptEvent(collected);
    await f.store.processEvent("evt_1");
    assert.equal(
      await f.store.applyRetention(
        "2100-01-01T00:00:00.000Z",
        "2100-01-01T00:00:00.000Z",
      ),
      1,
    );
    const retained = await f.store.getContribution("c1");
    assert.equal(retained.intent.message, undefined);
    assert.deepEqual(retained.metadata, {});
    assert.deepEqual(retained.personalDataRemoved, {
      at: "2100-01-01T00:00:00.000Z",
      by: "retention",
    });
    assert.equal(retained.payments.length, 1);
    assert.equal(
      (await f.store.getContribution("c2")).intent.message,
      "Private note",
    );
    const removed = await f.store.removePersonalData(
      "c2",
      "owner",
      "2026-09-24T12:00:00.000Z",
    );
    assert.equal(removed.intent.message, undefined);
    assert.equal(removed.personalDataRemoved.by, "owner");
    assert.equal(
      (
        await f.store.removePersonalData(
          "c2",
          "supporter",
          "2026-09-25T12:00:00.000Z",
        )
      ).personalDataRemoved.by,
      "owner",
    );
    assert.equal(
      JSON.stringify(
        await rows(
          f.store,
          "SELECT * FROM cheerkit_contributions WHERE id IN ('c1', 'c2')",
        ),
      ).includes("Private note"),
      false,
    );
    assert.equal(await f.store.acceptEvent(collected), "duplicate");
    assert.equal(
      (await reserve(f.store, "c9", "submission-1", { entry_point: "modal" }))
        .intent.id,
      "c1",
    );
    assert.equal(
      await f.store.applyRetention(
        "2100-01-01T00:00:00.000Z",
        "2100-01-02T00:00:00.000Z",
      ),
      0,
    );
    await assert.rejects(
      f.store.removePersonalData(
        "missing",
        "owner",
        "2026-09-24T12:00:00.000Z",
      ),
      { code: "NOT_FOUND" },
    );
  });

  it("authenticated inbox acceptance survives reopening and processes without rechecking delivery age", async (t) => {
    const f = await fixture(t, dialect);
    await ready(f.store);
    const verified = await event();
    assert.equal(await f.store.acceptEvent(verified), "accepted");
    const second = await f.open();
    assert.equal((await second.processEvent(verified.id)).state, "applied");
    assert.equal((await second.getContribution("c1")).outcome, "confirmed");
    assert.equal(await second.acceptEvent(verified), "duplicate");
    await second.processEvent(verified.id);
    assert.equal((await second.getContribution("c1")).payments.length, 1);
  });

  it("an event arriving before its association stays pending and is recoverable", async (t) => {
    const { store } = await fixture(t, dialect);
    await reserve(store);
    await store.claimCheckout("c1", dispatch());
    await store.acceptEvent(await event());
    assert.equal((await store.processEvent("evt_1")).state, "pending");
    await store.recordCheckout("c1", checkout());
    assert.equal((await store.processEvent("evt_1")).state, "applied");
  });

  it("distinct events for one charge count once; distinct charges remain visible", async (t) => {
    const { store } = await fixture(t, dialect);
    await ready(store);
    for (const id of ["evt_1", "evt_2"]) {
      await store.acceptEvent(await event(id));
      await store.processEvent(id);
    }
    assert.equal((await store.getContribution("c1")).payments.length, 1);
    await store.acceptEvent(await event("evt_3", { charge_id: "ch_2" }));
    assert.equal(
      (await store.processEvent("evt_3")).reason,
      "multiple_payments",
    );
    assert.equal((await store.getContribution("c1")).outcome, "needs_review");
  });

  it("discrepancies and conflicting event identities keep evidence for review", async (t) => {
    const { store } = await fixture(t, dialect);
    await ready(store);
    await store.acceptEvent(await event("evt_1", { amount: "2499.00" }));
    assert.equal((await store.processEvent("evt_1")).reason, "amount_mismatch");
    assert.equal((await store.getContribution("c1")).payments.length, 0);
    assert.equal(await store.acceptEvent(await event("evt_1")), "conflict");
    assert.equal((await store.getEvent("evt_1")).event.data.amount, "2499.00");
    await store.acceptEvent(await event("evt_2", { charge_id: "ch_2" }));
    await store.acceptEvent(
      await event("evt_2", { charge_id: "ch_2", amount: "9000.00" }),
    );
    assert.equal((await store.processEvent("evt_2")).reason, "event_conflict");
  });

  it("later failure, completion, contradictory expiry, and unsupported events never erase a collection", async (t) => {
    const { store } = await fixture(t, dialect);
    await ready(store);
    await store.acceptEvent(await event());
    await store.processEvent("evt_1");
    for (const [type, data, state, reason] of [
      [
        "collection.failed",
        { status: "failed" },
        "applied",
        "collection_failed",
      ],
      ["checkout.completed", { status: "completed" }, "applied", null],
      [
        "checkout.expired",
        { status: "expired" },
        "review",
        "checkout_conflict",
      ],
      ["payout.paid", {}, "unsupported", "event_type"],
    ]) {
      await store.acceptEvent(await event(`evt_${type}`, data, type));
      assert.deepEqual(
        [
          (await store.processEvent(`evt_${type}`)).state,
          (await store.getEvent(`evt_${type}`)).reason,
        ],
        [state, reason],
      );
    }
    const stored = await store.getContribution("c1");
    assert.deepEqual(
      [stored.checkout.status, stored.payments.length, stored.outcome],
      ["completed", 1, "needs_review"],
    );
    assert.equal((await store.listEvents({ contributionId: "c1" })).length, 4);
  });

  it("expiry closes an attempt; a new attempt keeps history and respects current rules; a late payment still counts", async (t) => {
    const { store } = await fixture(t, dialect);
    await ready(store);
    const value = (await store.getContribution("c1")).intent;
    const next = client.prepareCheckout(value, {
      reference: "attempt-c1-2",
      idempotencyKey: "operation-c1-2",
    });
    await assert.rejects(store.openAttempt("c1", next, "attempt-c1"), {
      code: "INVALID_STATE",
    });
    await store.acceptEvent(
      await event("evt_expired", { status: "expired" }, "checkout.expired"),
    );
    await store.processEvent("evt_expired");
    await assert.rejects(store.openAttempt("c1", next, "unknown"), {
      code: "CONFLICT",
    });
    await store.putContext({ ...context, acceptingContributions: false }, 1);
    await assert.rejects(store.openAttempt("c1", next, "attempt-c1"), {
      code: "CONTEXT_CLOSED",
    });
    await store.putContext(context, 2);
    const reopened = await store.openAttempt("c1", next, "attempt-c1");
    assert.deepEqual(
      reopened.attempts.map((attempt) => [attempt.reference, attempt.state]),
      [
        ["attempt-c1", "available"],
        ["attempt-c1-2", "prepared"],
      ],
    );
    assert.equal(
      (await store.openAttempt("c1", next, "attempt-c1")).attempts.length,
      2,
    );
    await store.acceptEvent(await event("evt_late"));
    assert.equal((await store.processEvent("evt_late")).state, "applied");
    assert.equal((await store.getContribution("c1")).outcome, "confirmed");
  });

  it("underpayment and invalid facts go to review; unknown checkouts wait", async (t) => {
    const { store } = await fixture(t, dialect);
    await ready(store);
    await store.acceptEvent(
      await event(
        "evt_under",
        { status: "underpaid", amount_paid: "1000.00" },
        "collection.underpaid",
      ),
    );
    assert.equal((await store.processEvent("evt_under")).reason, "underpaid");
    await store.acceptEvent(
      await event("evt_bad", { status: "open" }, "checkout.expired"),
    );
    assert.equal(
      (await store.processEvent("evt_bad")).reason,
      "invalid_event_facts",
    );
    await store.acceptEvent(
      await event(
        "evt_other",
        { checkout_id: "chk-unknown", status: "expired" },
        "checkout.expired",
      ),
    );
    assert.equal(
      (await store.processEvent("evt_other")).reason,
      "unassociated_checkout",
    );
  });

  it("a converted collection confirms once a paid completion arrives, in either order (sandbox: USD checkout collected from the payer in NGN)", async (t) => {
    const { store } = await fixture(t, dialect);
    const deliver = async (id, data, type) => {
      await store.acceptEvent(await event(id, data, type));
      return store.processEvent(id);
    };
    const converted = {
      status: "SUCCEEDED",
      amount: "3527179.00",
      currency: "USD",
    };
    const paid = { status: "completed", payment_status: "paid" };

    await ready(store);
    assert.deepEqual(await deliver("evt_col", converted), {
      event: (await store.getEvent("evt_col")).event,
      state: "pending",
      reason: "awaiting_checkout_completion",
      note: null,
    });
    assert.equal((await store.getContribution("c1")).outcome, "pending");
    assert.equal(
      (await deliver("evt_done", paid, "checkout.completed")).state,
      "applied",
    );
    assert.equal((await store.getEvent("evt_col")).state, "applied");
    const first = await store.getContribution("c1");
    assert.deepEqual(
      [
        first.outcome,
        first.payments.map((payment) => [
          payment.chargeId,
          payment.amount,
          payment.currency,
        ]),
      ],
      ["confirmed", [["ch_1", "2500.00", "NGN"]]],
    );
    assert.equal(
      (await store.getEvent("evt_col")).event.data.amount,
      "3527179.00",
    );

    await ready(store, "c2", "submission-2");
    const other = {
      checkout_id: "chk-c2",
      reference: "attempt-c2",
      charge_id: "ch_2",
    };
    assert.equal(
      (await deliver("evt_done_2", { ...paid, ...other }, "checkout.completed"))
        .state,
      "applied",
    );
    assert.equal(
      (await deliver("evt_col_2", { ...converted, ...other })).state,
      "applied",
    );
    assert.equal((await store.getContribution("c2")).outcome, "confirmed");
  });

  it("a converted collection without matching paid evidence never confirms", async (t) => {
    const { store } = await fixture(t, dialect);
    const deliver = async (id, data, type) => {
      await store.acceptEvent(await event(id, data, type));
      return store.processEvent(id);
    };
    await ready(store);
    await deliver("evt_col", { amount: "1.77", currency: "USD" });
    await deliver(
      "evt_done",
      { status: "completed", payment_status: "paid", amount: "2400.00" },
      "checkout.completed",
    );
    assert.deepEqual(
      [
        (await store.getEvent("evt_col")).state,
        (await store.getContribution("c1")).outcome,
      ],
      ["pending", "pending"],
    );

    await ready(store, "c2", "submission-2");
    const other = {
      checkout_id: "chk-c2",
      reference: "attempt-c2",
      charge_id: "ch_2",
    };
    await deliver(
      "evt_unpaid",
      { status: "completed", payment_status: "unpaid", ...other },
      "checkout.completed",
    );
    assert.equal(
      (
        await deliver("evt_col_2", {
          amount: "1.77",
          currency: "USD",
          ...other,
        })
      ).state,
      "pending",
    );
    await deliver(
      "evt_paid",
      { status: "completed", payment_status: "paid", ...other },
      "checkout.completed",
    );
    assert.equal((await store.getContribution("c2")).outcome, "confirmed");
  });

  it("a context defined in code syncs its rules and keeps the owner's pause", async (t) => {
    const { store } = await fixture(t, dialect);
    const code = {
      id: "coffee",
      name: "Coffee",
      currencies: [{ currency: "NGN", fractionDigits: 2, minimum: "1500" }],
    };
    assert.equal((await store.syncContext(code)).revision, 1);
    assert.equal((await store.syncContext(code)).revision, 1);
    const paused = await store.putContext(
      { ...code, acceptingContributions: false },
      1,
    );
    const synced = await store.syncContext({
      ...code,
      currencies: [{ currency: "NGN", fractionDigits: 2, minimum: "2000" }],
    });
    assert.deepEqual(
      [
        paused.revision,
        synced.revision,
        synced.context.acceptingContributions,
        synced.context.currencies[0].minimum,
      ],
      [2, 3, false, "2000.00"],
    );
    await assert.rejects(store.syncContext({ ...code, currencies: [] }), {
      code: "INVALID_CONTEXT",
    });
  });

  it("each contribution reports one status, used for public outcomes, retention, and summary counts", async (t) => {
    const { store } = await fixture(t, dialect);
    const deliver = async (id, data, type) => {
      await store.acceptEvent(await event(id, data, type));
      return store.processEvent(id);
    };
    const status = async (id) => (await store.getContribution(id)).status;
    await reserve(store, "c1", "submission-1");
    assert.equal(await status("c1"), "checkout_unresolved");
    assert.ok(await store.claimCheckout("c1", dispatch()));
    assert.equal(await status("c1"), "checkout_unresolved");
    await store.recordCheckoutFailure("c1", "uncertain");
    assert.equal(await status("c1"), "checkout_unresolved");
    await store.recordCheckout("c1", checkout("c1"));
    assert.equal(await status("c1"), "awaiting_payment");
    await deliver("evt_expired", { status: "expired" }, "checkout.expired");
    assert.equal(await status("c1"), "unsuccessful");

    await reserve(store, "c2", "submission-2");
    assert.ok(await store.claimCheckout("c2", dispatch()));
    await store.recordCheckoutFailure("c2", "rejected");
    assert.equal(await status("c2"), "unsuccessful");
    await ready(store, "c3", "submission-3");
    await ready(store, "c4", "submission-4");
    await deliver("evt_paid", {
      checkout_id: "chk-c4",
      reference: "attempt-c4",
      charge_id: "ch_4",
    });
    assert.equal(await status("c4"), "confirmed");
    await ready(store, "c5", "submission-5");
    await deliver("evt_short", {
      checkout_id: "chk-c5",
      reference: "attempt-c5",
      charge_id: "ch_5",
      amount: "100.00",
    });
    assert.equal(await status("c5"), "needs_review");
    await reserve(store, "c6", "submission-6");

    assert.deepEqual((await store.summarize()).contributions, {
      awaiting_payment: 1,
      checkout_unresolved: 1,
      unsuccessful: 2,
      confirmed: 1,
      needs_review: 1,
    });
    assert.deepEqual(
      (await store.listContributions())
        .map((entry) => [entry.intent.id, entry.status])
        .sort(),
      [
        ["c1", "unsuccessful"],
        ["c2", "unsuccessful"],
        ["c3", "awaiting_payment"],
        ["c4", "confirmed"],
        ["c5", "needs_review"],
        ["c6", "checkout_unresolved"],
      ],
    );
    const ids = async (options) =>
      (await store.listContributions(options)).map((entry) => entry.intent.id);
    assert.deepEqual(await ids({ status: "unsuccessful", limit: 1 }), ["c2"]);
    assert.deepEqual(
      await ids({
        status: "unsuccessful",
        limit: 1,
        before: { createdAt: "2026-09-23T12:00:00.000Z", id: "c2" },
      }),
      ["c1"],
    );
    assert.deepEqual(
      await ids({
        status: "unsuccessful",
        limit: 1,
        before: { createdAt: "2026-09-23T12:00:00.000Z", id: "c1" },
      }),
      [],
    );
    assert.deepEqual(await ids({ status: "confirmed" }), ["c4"]);
    await assert.rejects(store.listContributions({ status: "pending" }), {
      code: "INVALID_STATE",
    });
    assert.equal(
      await store.applyRetention(
        "2100-01-01T00:00:00Z",
        "2100-01-01T00:00:00Z",
      ),
      3,
    );
  });

  it("refund amounts are read only in the payment's settlement currency; other or unreported settlement currencies go to review", async (t) => {
    const { store } = await fixture(t, dialect);
    const deliver = async (id, data, type) => {
      await store.acceptEvent(await event(id, data, type));
      return store.processEvent(id);
    };
    const refund = (charge) => ({
      refund_id: `ref_${charge}`,
      charge_id: charge,
      status: "paid",
      requested_amount: "500.00",
      refunded_amount: "500.00",
    });
    const cases = [
      [
        "c1",
        { currency: "USD", amount: "1.77", settlement_currency: "NGN" },
        "applied",
        null,
      ],
      [
        "c2",
        { settlement_currency: "USD", settlement_amount: "None" },
        "review",
        "refund_currency_unconfirmed",
      ],
      [
        "c3",
        { settlement_currency: undefined },
        "review",
        "refund_currency_unconfirmed",
      ],
    ];
    for (const [id, collection, state, reason] of cases) {
      await ready(store, id, `submission-${id}`);
      const other = {
        checkout_id: `chk-${id}`,
        reference: `attempt-${id}`,
        charge_id: `ch_${id}`,
      };
      await deliver(`evt_col_${id}`, { ...other, ...collection });
      await deliver(
        `evt_done_${id}`,
        { ...other, status: "completed", payment_status: "paid" },
        "checkout.completed",
      );
      assert.equal((await store.getContribution(id)).outcome, "confirmed");
      const processed = await deliver(
        `evt_refund_${id}`,
        refund(`ch_${id}`),
        "refund.paid",
      );
      assert.deepEqual([processed.state, processed.reason], [state, reason]);
      const stored = await store.getContribution(id);
      assert.deepEqual(
        [stored.outcome, stored.payments[0].refunds.length],
        state === "applied" ? ["confirmed", 1] : ["needs_review", 0],
      );
    }
    assert.deepEqual((await store.summarize()).confirmedTotals, {
      NGN: "2000.00",
    });
  });

  it("an event reviewed under older rules can be checked again, recording the payment for the owner to accept", async (t) => {
    const { store } = await fixture(t, dialect);
    const deliver = async (id, data, type) => {
      await store.acceptEvent(await event(id, data, type));
      return store.processEvent(id);
    };
    await ready(store);
    await deliver("evt_col", {
      status: "SUCCEEDED",
      amount: "1.77",
      currency: "USD",
    });
    await rows(
      store,
      "UPDATE cheerkit_events SET state = 'review', reason = 'unrecognized_status' WHERE id = 'evt_col'",
    );
    await rows(
      store,
      "UPDATE cheerkit_contributions SET outcome = 'needs_review' WHERE id = 'c1'",
    );
    await deliver(
      "evt_done",
      { status: "completed", payment_status: "paid" },
      "checkout.completed",
    );
    assert.equal((await store.getEvent("evt_col")).state, "review");
    await assert.rejects(
      store.acceptReview("c1", "Paid in the sandbox", "2026-09-24T19:00:00Z"),
      { code: "INVALID_STATE" },
    );

    await store.dismissEvent("evt_col", "Did not recognize it");
    assert.equal((await store.recheckEvent("evt_col")).state, "applied");
    assert.equal((await store.getEvent("evt_col")).note, null);
    const rechecked = await store.getContribution("c1");
    assert.deepEqual(
      [rechecked.outcome, rechecked.payments.length],
      ["needs_review", 1],
    );
    assert.equal(
      (
        await store.acceptReview(
          "c1",
          "Paid in the sandbox",
          "2026-09-24T19:00:00Z",
        )
      ).outcome,
      "confirmed",
    );
    assert.deepEqual((await store.summarize()).confirmedTotals, {
      NGN: "2500.00",
    });
    await assert.rejects(store.recheckEvent("evt_col"), {
      code: "INVALID_STATE",
    });
    await assert.rejects(store.recheckEvent("missing"), { code: "NOT_FOUND" });
  });

  it("confirmed totals are per currency, exact, and net of paid refunds and external returns", async (t) => {
    const { store } = await fixture(t, dialect);
    const deliver = async (id, data, type) => {
      await store.acceptEvent(await event(id, data, type));
      return store.processEvent(id);
    };
    assert.deepEqual((await store.summarize()).confirmedTotals, {});
    await ready(store);
    await deliver("evt_1", {});
    await ready(store, "c2", "submission-2");
    await deliver("evt_2", {
      checkout_id: "chk-c2",
      reference: "attempt-c2",
      charge_id: "ch_2",
    });
    await ready(store, "c3", "submission-3");
    await deliver("evt_3", {
      checkout_id: "chk-c3",
      reference: "attempt-c3",
      charge_id: "ch_3",
      amount: "2400.00",
    });
    assert.deepEqual((await store.summarize()).confirmedTotals, {
      NGN: "5000.00",
    });
    await deliver(
      "evt_r",
      {
        refund_id: "ref_1",
        charge_id: "ch_2",
        status: "paid",
        requested_amount: "999.99",
        refunded_amount: "999.99",
      },
      "refund.paid",
    );
    await store.recordExternalReturn(
      "c1",
      "0.01",
      "Returned by transfer",
      "2026-09-24T19:00:00Z",
    );
    assert.deepEqual((await store.summarize()).confirmedTotals, {
      NGN: "4000.00",
    });
  });

  it("identical signed replays restore dropped settlement fields without counting payments twice", async (t) => {
    const { store } = await fixture(t, dialect);
    await ready(store);
    const data = {
      settlement_amount: "2462.50",
      settlement_currency: "NGN",
      processing_fee: "37.50",
      processing_fee_currency: "NGN",
      fee_bearer: "merchant",
      payer: { email: "discard@example.test" },
    };
    const original = await event("evt_restore", data);
    await store.acceptEvent(original);
    await store.processEvent(original.id);
    const [stored] = await rows(
      store,
      "SELECT payload FROM cheerkit_events WHERE id = 'evt_restore'",
    );
    const payload = JSON.parse(stored.payload);
    for (const key of Object.keys(data)) delete payload.data[key];
    await store.connection.database.query(
      "UPDATE cheerkit_events SET payload = ? WHERE id = ?",
      [JSON.stringify(payload), original.id],
    );
    assert.equal((await store.summarize()).unsettledPayments, 1);
    assert.equal(await store.acceptEvent(original), "duplicate");
    await store.processEvent(original.id);
    const summary = await store.summarize();
    assert.deepEqual(summary.settledTotals, { NGN: "2462.50" });
    assert.deepEqual(summary.feeTotals, { NGN: "37.50" });
    assert.equal(summary.unknownFeePayments, 0);
    assert.equal((await store.getContribution("c1")).payments.length, 1);
    assert.doesNotMatch(
      JSON.stringify(await rows(store, "SELECT payload FROM cheerkit_events")),
      /discard@example/,
    );
    assert.equal(
      await store.acceptEvent(
        await event("evt_restore", { ...data, processing_fee: "40.00" }),
      ),
      "conflict",
    );
    assert.equal((await store.getContribution("c1")).outcome, "needs_review");
  });

  it("each payment keeps what Bachs credited and its fee, and the summary totals them per settlement currency", async (t) => {
    const { store } = await fixture(t, dialect);
    const deliver = async (id, data, type) => {
      await store.acceptEvent(await event(id, data, type));
      return store.processEvent(id);
    };
    const settled = {
      settlement_amount: "2462.50",
      settlement_currency: "NGN",
      processing_fee: "37.50",
      processing_fee_currency: "NGN",
      fee_bearer: "merchant",
      customer: { id: "cust_1", email: "payer@example.com", name: "Payer" },
    };
    await ready(store);
    await deliver("evt_1", settled);
    await ready(store, "c2", "submission-2");
    await deliver("evt_2", {
      checkout_id: "chk-c2",
      reference: "attempt-c2",
      charge_id: "ch_2",
      settlement_amount: "1.70",
      settlement_currency: "USD",
      processing_fee: null,
    });
    await ready(store, "c3", "submission-3");
    await deliver("evt_3", {
      checkout_id: "chk-c3",
      reference: "attempt-c3",
      charge_id: "ch_3",
      settlement_amount: "None",
      settlement_currency: "USD",
      processing_fee: null,
      processing_fee_currency: null,
    });

    assert.deepEqual(
      (await store.getContribution("c1")).payments[0].settlement,
      {
        amount: "2462.50",
        currency: "NGN",
        fee: "37.50",
        feeCurrency: "NGN",
        feeBearer: "merchant",
      },
    );
    assert.deepEqual(
      (await store.getContribution("c2")).payments[0].settlement,
      {
        amount: "1.70",
        currency: "USD",
        fee: null,
        feeCurrency: null,
        feeBearer: null,
      },
    );
    assert.equal(
      (await store.getContribution("c3")).payments[0].settlement,
      null,
    );
    const summary = await store.summarize();
    assert.deepEqual(
      [
        summary.settledTotals,
        summary.unsettledPayments,
        summary.confirmedTotals,
      ],
      [{ NGN: "2462.50", USD: "1.70" }, 1, { NGN: "7500.00" }],
    );
    const stored = JSON.stringify((await store.getEvent("evt_1")).event);
    assert.ok(
      stored.includes("processing_fee") &&
        !stored.includes("payer@example.com") &&
        !stored.includes("cust_1"),
    );
  });

  it("a retrieved payment statement supplies a deferred fee, is checked against the charge, and is replaced by a newer one", async (t) => {
    const { store } = await fixture(t, dialect);
    const deliver = async (id, data) => {
      await store.acceptEvent(await event(id, data));
      return store.processEvent(id);
    };
    const statement = (record = {}, environment = "sandbox") =>
      createBachsCheckoutClient({
        organizationId: "acct_owner",
        environment,
        secretKey: `sk_${environment}_fixture`,
        successUrl: "https://example.com/result",
        cancelUrl: "https://example.com/support",
        fetch: async () =>
          Response.json({
            payment_id: "ch_1",
            checkout_id: "chk-c1",
            status: "succeeded",
            amount: "2500.00",
            currency: "NGN",
            fees: { amount: "37.50", currency: "NGN" },
            merchant_bears_cost: true,
            customer: { email: "payer@example.test" },
            ...record,
          }),
      }).retrievePayment(record.payment_id ?? "ch_1");
    const at = "2026-09-25T09:00:00.000Z";
    await ready(store);
    await deliver("evt_1", {
      settlement_amount: "None",
      settlement_currency: "USD",
      processing_fee: null,
      processing_fee_currency: null,
    });
    await ready(store, "c2", "submission-2");
    await deliver("evt_2", {
      checkout_id: "chk-c2",
      reference: "attempt-c2",
      charge_id: "ch_2",
      settlement_amount: "2460.00",
      settlement_currency: "NGN",
      processing_fee: "40.00",
      processing_fee_currency: "NGN",
    });
    assert.deepEqual(
      [
        (await store.summarize()).feeTotals,
        (await store.summarize()).unknownFeePayments,
      ],
      [{ NGN: "40.00" }, 1],
    );

    await assert.rejects(
      store.recordPaymentStatement({ ...(await statement()) }, at),
      { code: "LOOKUP_FAILED" },
    );
    await assert.rejects(
      store.recordPaymentStatement(await statement({}, "live"), at),
      { code: "WRONG_ACCOUNT" },
    );
    await assert.rejects(
      store.recordPaymentStatement(
        await statement({ payment_id: "ch_unknown" }),
        at,
      ),
      { code: "NOT_FOUND" },
    );
    for (const contradiction of [
      { checkout_id: "chk-c2" },
      { checkout_id: null },
      { amount: "2400.00" },
      { currency: "USD" },
    ]) {
      await assert.rejects(
        store.recordPaymentStatement(await statement(contradiction), at),
        { code: "CONFLICT" },
      );
    }
    assert.deepEqual(
      await rows(store, "SELECT charge_id FROM cheerkit_payment_statements"),
      [],
    );

    await store.recordPaymentStatement(
      await statement({ amount: "2500.0" }),
      at,
    );
    assert.deepEqual(
      (await store.getContribution("c1")).payments[0].statement,
      {
        status: "succeeded",
        amount: "2500.0",
        currency: "NGN",
        fee: { amount: "37.50", currency: "NGN" },
        feeBearer: "merchant",
        retrievedAt: at,
      },
    );
    await store.recordPaymentStatement(
      await statement({
        payment_id: "ch_2",
        checkout_id: "chk-c2",
        fees: { amount: "41.00", currency: "NGN" },
      }),
      at,
    );
    let summary = await store.summarize();
    assert.deepEqual(
      [
        summary.feeTotals,
        summary.unknownFeePayments,
        summary.settledTotals,
        summary.unsettledPayments,
      ],
      [{ NGN: "78.50" }, 0, { NGN: "2460.00" }, 1],
    );

    const later = "2026-09-26T09:00:00.000Z";
    await store.recordPaymentStatement(
      await statement({
        status: "partially_refunded",
        fees: null,
        merchant_bears_cost: null,
      }),
      later,
    );
    assert.deepEqual(
      (await store.getContribution("c1")).payments[0].statement,
      {
        status: "partially_refunded",
        amount: "2500.00",
        currency: "NGN",
        fee: null,
        feeBearer: null,
        retrievedAt: later,
      },
    );
    summary = await store.summarize();
    assert.deepEqual(
      [summary.feeTotals, summary.unknownFeePayments],
      [{ NGN: "41.00" }, 0],
    );
    assert.equal((await store.getContribution("c1")).outcome, "confirmed");
    assert.doesNotMatch(
      JSON.stringify(
        await rows(store, "SELECT * FROM cheerkit_payment_statements"),
      ),
      /payer@example/,
    );
  });

  it("refunds and disputes are tracked per provider identity with conflicts sent to review", async (t) => {
    const { store } = await fixture(t, dialect);
    await ready(store);
    const refund = (id, status, refunded, requested = "1000.00") => ({
      refund_id: id,
      charge_id: "ch_1",
      status,
      requested_amount: requested,
      refunded_amount: refunded,
    });
    await store.acceptEvent(
      await event(
        "evt_refund_early",
        refund("ref_1", "processing", "0.00"),
        "refund.created",
      ),
    );
    assert.equal(
      (await store.processEvent("evt_refund_early")).reason,
      "unknown_charge",
    );
    await store.acceptEvent(await event());
    await store.processEvent("evt_1");
    assert.equal(
      (await store.processEvent("evt_refund_early")).state,
      "applied",
    );
    const deliver = async (id, data, type) => {
      await store.acceptEvent(await event(id, data, type));
      return store.processEvent(id);
    };
    assert.equal(
      (
        await deliver(
          "evt_r1",
          refund("ref_1", "paid", "1000.00"),
          "refund.paid",
        )
      ).state,
      "applied",
    );
    assert.equal(
      (
        await deliver(
          "evt_r1_stale",
          refund("ref_1", "processing", "0.00"),
          "refund.created",
        )
      ).state,
      "applied",
    );
    assert.equal(
      (
        await deliver(
          "evt_r1_conflict",
          refund("ref_1", "failed", "0.00"),
          "refund.failed",
        )
      ).reason,
      "refund_conflict",
    );
    assert.equal(
      (
        await deliver(
          "evt_r3",
          refund("ref_3", "paid", "1600.00", "1600.00"),
          "refund.paid",
        )
      ).reason,
      "refund_exceeds_payment",
    );
    const dispute = (status, updated, extra = {}) => ({
      dispute_id: "dsp_1",
      charge_id: "ch_1",
      amount: "2500.00",
      currency: "NGN",
      status,
      updated_at: updated,
      ...extra,
    });
    await deliver(
      "evt_d1",
      dispute("needs_response", "2026-09-24T10:00:00Z"),
      "dispute.created",
    );
    await deliver(
      "evt_d3",
      dispute("lost", "2026-09-24T12:00:00Z"),
      "dispute.updated",
    );
    assert.equal(
      (
        await deliver(
          "evt_d2",
          dispute("under_review", "2026-09-24T11:00:00Z"),
          "dispute.updated",
        )
      ).state,
      "applied",
    );
    const payment = (await store.getContribution("c1")).payments[0];
    assert.deepEqual(
      payment.refunds.map((entry) => [entry.refundId, entry.status]),
      [
        ["ref_1", "paid"],
        ["ref_3", "paid"],
      ],
    );
    assert.equal(payment.disputes[0].status, "lost");
    assert.equal((await store.summarize()).openDisputes, 0);
  });

  it("a failed transaction rolls back and leaves the event retryable", async (t) => {
    const f = await fixture(t, dialect);
    await ready(f.store);
    await f.store.acceptEvent(await event());
    let fail = true;
    const database = f.store.connection.database;
    const failing = {
      dialect,
      query: database.query,
      transaction: (key, work) =>
        database.transaction(key, (tx) =>
          work({
            query: (sql, params) =>
              fail && /SET state = \?, reason = \?/.test(sql)
                ? Promise.reject(new Error("injected"))
                : tx.query(sql, params),
          }),
        ),
    };
    const store = await openStore({
      database: failing,
      installationId: "test-installation",
      organizationId: "acct_owner",
      environment: "sandbox",
    });
    await assert.rejects(store.processEvent("evt_1"), {
      code: "STORAGE_FAILURE",
    });
    assert.equal((await store.getEvent("evt_1")).state, "pending");
    assert.equal((await store.getContribution("c1")).payments.length, 0);
    fail = false;
    assert.equal((await store.processEvent("evt_1")).state, "applied");
  });

  it("scope and authenticated evidence boundaries fail closed", async (t) => {
    const { store } = await fixture(t, dialect);
    const verified = await event();
    await assert.rejects(store.acceptEvent({ ...verified }), {
      code: "INVALID_SIGNATURE",
    });
    await assert.rejects(
      store.reserve(
        intent(),
        { ...request(intent()), environment: "live" },
        "one",
      ),
      { code: "CONFLICT" },
    );
  });

  it("checkout associations and charge attribution cannot cross contributions", async (t) => {
    const { store } = await fixture(t, dialect);
    await ready(store);
    await ready(store, "c2", "submission-2");
    await assert.rejects(
      store.recordCheckout("c2", { ...checkout("c2"), id: "chk-c1" }),
      { code: "CONFLICT" },
    );
    await store.acceptEvent(await event());
    await store.processEvent("evt_1");
    await store.acceptEvent(
      await event("evt_2", { checkout_id: "chk-c2", reference: "attempt-c2" }),
    );
    assert.equal(
      (await store.processEvent("evt_2")).reason,
      "payment_conflict",
    );
    assert.equal((await store.getContribution("c2")).payments.length, 0);
  });

  it("separate processes racing on one charge record it once", async (t) => {
    const f = await fixture(t, dialect);
    await ready(f.store);
    await f.store.acceptEvent(await event("evt_1"));
    await f.store.acceptEvent(await event("evt_2"));
    const target = JSON.stringify(
      dialect === "sqlite" ? { filename: f.host.filename } : f.host.connection,
    );
    const worker = (eventId) =>
      new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            new URL("./fixtures/store-worker.mjs", import.meta.url).pathname,
            dialect,
            target,
            eventId,
          ],
          { stdio: ["ignore", "ignore", "pipe"] },
        );
        let errors = "";
        child.stderr.on("data", (chunk) => {
          errors += chunk;
        });
        child.on("close", (code) =>
          code === 0
            ? resolve()
            : reject(new Error(errors || `Worker exited ${code}`)),
        );
      });
    await Promise.all([worker("evt_1"), worker("evt_2"), worker("evt_1")]);
    assert.equal((await f.store.getContribution("c1")).payments.length, 1);
    assert.equal((await f.store.getContribution("c1")).outcome, "confirmed");
  });

  it("pending events page by ID and contributions page newest first", async (t) => {
    const { store } = await fixture(t, dialect);
    for (const id of ["evt_1", "evt_2", "evt_3"])
      await store.acceptEvent(await event(id));
    assert.deepEqual(
      (await store.listEvents({ state: "pending", limit: 2 })).map(
        (entry) => entry.event.id,
      ),
      ["evt_1", "evt_2"],
    );
    assert.deepEqual(
      (await store.listEvents({ state: "pending", afterId: "evt_2" })).map(
        (entry) => entry.event.id,
      ),
      ["evt_3"],
    );
    await assert.rejects(store.listEvents({ limit: 1000 }), {
      code: "INVALID_STATE",
    });
    for (const id of ["a", "b", "c"]) await reserve(store, id, `key-${id}`);
    const first = await store.listContributions({ limit: 2 });
    assert.deepEqual(
      first.map((entry) => entry.intent.id),
      ["c", "b"],
    );
    const last = first.at(-1).intent;
    assert.deepEqual(
      (
        await store.listContributions({
          before: { createdAt: last.createdAt, id: last.id },
        })
      ).map((entry) => entry.intent.id),
      ["a"],
    );
  });

  it("context revisions prevent lost edits; archival stops new work but not existing attempts", async (t) => {
    const { store } = await fixture(t, dialect);
    await ready(store);
    const current = await store.getContext(context.id);
    assert.equal(
      (
        await store.putContext(
          { ...current.context, acceptingContributions: false },
          current.revision,
        )
      ).revision,
      2,
    );
    await assert.rejects(store.putContext(current.context, current.revision), {
      code: "CONFLICT",
    });
    await assert.rejects(reserve(store, "c2", "new-submission"), {
      code: "CONTEXT_CLOSED",
    });
    assert.equal((await reserve(store, "repeat-generated-id")).intent.id, "c1");
    await store.acceptEvent(await event());
    await store.processEvent("evt_1");
    assert.equal((await store.getContribution("c1")).outcome, "confirmed");
  });
}
