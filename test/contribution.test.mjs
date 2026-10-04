import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CheerkitError,
  createContributionIntent,
  defineSupportContext,
} from "cheerkit";

const identity = {
  id: "contribution-1",
  createdAt: "2026-09-23T12:00:00.000Z",
};
const submission = { amount: "2500", currency: "NGN" };
const config = () => ({
  id: "baseband",
  name: "Baseband",
  collectName: true,
  collectMessage: true,
  currencies: [
    {
      currency: "NGN",
      fractionDigits: 2,
      minimum: "100",
      maximum: "50000",
      suggestedAmounts: ["1000", "2500", "5000"],
    },
    {
      currency: "USD",
      fractionDigits: 2,
      minimum: "1",
      maximum: "1000",
      suggestedAmounts: ["5", "10"],
    },
  ],
});
const context = () => defineSupportContext(config());

test("creates an anonymous pending intent under the server-selected context", () => {
  const contribution = createContributionIntent(
    context(),
    submission,
    identity,
  );
  assert.deepEqual(contribution, {
    ...identity,
    contextId: "baseband",
    amount: "2500.00",
    currency: "NGN",
    fractionDigits: 2,
    status: "pending",
  });
  assert.doesNotThrow(() => JSON.stringify(contribution));
  assert.equal(Object.isFrozen(contribution), true);
});

test("supports personal contexts without a page, slug, project URL, or email", () => {
  const personal = defineSupportContext({
    ...config(),
    id: "personal",
    name: "My work",
  });
  assert.equal(
    createContributionIntent(personal, submission, identity).contextId,
    "personal",
  );
});

test("custom amounts are allowed independently of suggested amounts", () => {
  assert.equal(
    createContributionIntent(
      context(),
      { ...submission, amount: "1234.56" },
      identity,
    ).amount,
    "1234.56",
  );
});

test("currency-specific ranges are enforced at their exact inclusive boundaries", () => {
  for (const amount of ["100", "50000"]) {
    assert.doesNotThrow(() =>
      createContributionIntent(context(), { ...submission, amount }, identity),
    );
  }
  for (const amount of ["99.99", "50000.01"]) {
    assert.throws(
      () =>
        createContributionIntent(
          context(),
          { ...submission, amount },
          identity,
        ),
      { code: "AMOUNT_OUT_OF_RANGE" },
    );
  }
  const usd = createContributionIntent(
    context(),
    { currency: "USD", amount: "1" },
    identity,
  );
  assert.equal(usd.currency, "USD");
  assert.equal(usd.amount, "1.00");
});

test("range checks are exact beyond JavaScript's safe integer range", () => {
  const large = defineSupportContext({
    ...config(),
    currencies: [
      {
        currency: "USD",
        fractionDigits: 2,
        minimum: "9007199254740993.01",
        maximum: "9007199254740993.02",
      },
    ],
  });
  assert.doesNotThrow(() =>
    createContributionIntent(
      large,
      { currency: "USD", amount: "9007199254740993.01" },
      identity,
    ),
  );
  for (const amount of ["9007199254740993.00", "9007199254740993.03"]) {
    assert.throws(
      () =>
        createContributionIntent(large, { currency: "USD", amount }, identity),
      { code: "AMOUNT_OUT_OF_RANGE" },
    );
  }
});

test("unsupported currency is rejected without implicit conversion", () => {
  for (const currency of ["EUR", "ngn", " NGN", "__proto__", null, undefined]) {
    assert.throws(
      () =>
        createContributionIntent(
          context(),
          { ...submission, currency },
          identity,
        ),
      { code: "UNSUPPORTED_CURRENCY" },
    );
  }
});

test("non-two-decimal currencies use their configured precision", () => {
  const different = defineSupportContext({
    ...config(),
    currencies: [
      { currency: "JPY", fractionDigits: 0, minimum: "100" },
      { currency: "KWD", fractionDigits: 3, minimum: "0.001" },
    ],
  });
  assert.equal(
    createContributionIntent(
      different,
      { currency: "JPY", amount: "123" },
      identity,
    ).amount,
    "123",
  );
  assert.equal(
    createContributionIntent(
      different,
      { currency: "KWD", amount: "1.234" },
      identity,
    ).amount,
    "1.234",
  );
});

test("closing a context prevents new intents without changing existing ones", () => {
  const open = context();
  const existing = createContributionIntent(open, submission, identity);
  const closed = defineSupportContext({
    ...open,
    acceptingContributions: false,
  });
  assert.throws(() => createContributionIntent(closed, submission, identity), {
    code: "CONTEXT_CLOSED",
  });
  assert.equal(existing.status, "pending");
  assert.equal(existing.contextId, "baseband");
});

test("later configuration changes cannot alter an existing intent", () => {
  const mutable = config();
  const defined = defineSupportContext(mutable);
  const existing = createContributionIntent(defined, submission, identity);
  mutable.id = "other";
  mutable.currencies[0].suggestedAmounts.push("9999");
  mutable.currencies[0].fractionDigits = 0;
  assert.equal(defined.id, "baseband");
  assert.deepEqual(defined.currencies[0].suggestedAmounts, [
    "1000.00",
    "2500.00",
    "5000.00",
  ]);
  assert.equal(existing.fractionDigits, 2);
  assert.throws(() => {
    existing.amount = "1.00";
  }, TypeError);
  assert.throws(() => {
    defined.currencies[0].minimum = "0";
  }, TypeError);
  assert.throws(() => defined.currencies.push({}), TypeError);
});

test("serializing and reloading a context preserves behavior", () => {
  const reloaded = JSON.parse(JSON.stringify(context()));
  assert.deepEqual(
    createContributionIntent(reloaded, submission, identity),
    createContributionIntent(context(), submission, identity),
  );
  reloaded.currencies[0].minimum = "0";
  assert.throws(
    () => createContributionIntent(reloaded, submission, identity),
    { code: "INVALID_AMOUNT" },
  );
});

test("supporter data is trimmed and optional blank values are omitted", () => {
  const contribution = createContributionIntent(
    context(),
    { ...submission, supporterName: " Ada ", message: " Thanks for this! " },
    identity,
  );
  assert.equal(contribution.supporterName, "Ada");
  assert.equal(contribution.message, "Thanks for this!");
  const blank = createContributionIntent(
    context(),
    { ...submission, supporterName: " ", message: "\n" },
    identity,
  );
  assert.equal(Object.hasOwn(blank, "supporterName"), false);
  assert.equal(Object.hasOwn(blank, "message"), false);
});

test("name and message are not collected unless the context turns them on", () => {
  const { collectName: _name, collectMessage: _message, ...plain } = config();
  const defaults = defineSupportContext(plain);
  assert.deepEqual(
    [defaults.collectName, defaults.collectMessage],
    [false, false],
  );
  assert.throws(
    () =>
      createContributionIntent(
        defaults,
        { ...submission, message: "Hello" },
        identity,
      ),
    { code: "FIELD_DISABLED" },
  );
});

test("disabled supporter fields cannot be populated by a custom client", () => {
  const disabled = defineSupportContext({
    ...config(),
    collectName: false,
    collectMessage: false,
  });
  for (const fields of [{ supporterName: "Ada" }, { message: "Hello" }]) {
    assert.throws(
      () =>
        createContributionIntent(
          disabled,
          { ...submission, ...fields },
          identity,
        ),
      { code: "FIELD_DISABLED" },
    );
  }
  assert.doesNotThrow(() =>
    createContributionIntent(
      disabled,
      { ...submission, message: " " },
      identity,
    ),
  );
});

test("private text is bounded and never echoed in validation errors", () => {
  for (const fields of [
    { supporterName: "private".repeat(100) },
    { message: "private".repeat(400) },
    { message: null },
    { supporterName: 123 },
  ]) {
    assert.throws(
      () =>
        createContributionIntent(
          context(),
          { ...submission, ...fields },
          identity,
        ),
      (error) => {
        assert.equal(error.code, "INVALID_INPUT");
        assert.equal(error.message.includes("private"), false);
        return true;
      },
    );
  }
});

test("a supporter cannot choose attribution, identity, payment status, or fee policy", () => {
  for (const fields of [
    { contextId: "other" },
    { id: "forged" },
    { createdAt: identity.createdAt },
    { status: "paid" },
    { paidAt: identity.createdAt },
    { feeBearer: "owner" },
    { providerPaymentId: "forged" },
    { metadata: { status: "paid" } },
  ]) {
    assert.throws(
      () =>
        createContributionIntent(
          context(),
          { ...submission, ...fields },
          identity,
        ),
      { code: "INVALID_INPUT" },
    );
  }
});

test("malformed request objects fail closed", () => {
  for (const input of [
    null,
    undefined,
    [],
    "2500",
    2500,
    new Date(),
    Object.create({ amount: "2500", currency: "NGN" }),
  ]) {
    assert.throws(() => createContributionIntent(context(), input, identity), {
      code: "INVALID_INPUT",
    });
  }
  const polluted = JSON.parse(
    '{"amount":"2500","currency":"NGN","__proto__":{"status":"paid"}}',
  );
  assert.throws(() => createContributionIntent(context(), polluted, identity), {
    code: "INVALID_INPUT",
  });
});

test("host identity must supply a nonempty id and a real canonical UTC timestamp", () => {
  for (const host of [
    { ...identity, id: " " },
    { ...identity, createdAt: "not a date" },
    { ...identity, createdAt: "2026-02-30T12:00:00.000Z" },
    { ...identity, createdAt: "2026-09-23T12:00:00+00:00" },
    { ...identity, status: "paid" },
    null,
  ]) {
    assert.throws(() => createContributionIntent(context(), submission, host), {
      code: "INVALID_INPUT",
    });
  }
});

test("equal requests with distinct host ids remain distinct intents", () => {
  const first = createContributionIntent(context(), submission, identity);
  const second = createContributionIntent(context(), submission, {
    ...identity,
    id: "contribution-2",
  });
  assert.notEqual(first.id, second.id);
  assert.equal(first.amount, second.amount);
  assert.equal(first.status, "pending");
  assert.equal(second.status, "pending");
});

test("suggestions are normalized and deduplicated without reordering", () => {
  const defined = defineSupportContext({
    ...config(),
    currencies: [
      {
        currency: "USD",
        fractionDigits: 2,
        minimum: "1",
        suggestedAmounts: ["5", "5.00", "10", "1"],
      },
    ],
  });
  assert.deepEqual(defined.currencies[0].suggestedAmounts, [
    "5.00",
    "10.00",
    "1.00",
  ]);
});

test("invalid currency configuration cannot reach contribution creation", () => {
  for (const currencies of [
    [],
    null,
    [null],
    [{ currency: "usd", fractionDigits: 2, minimum: "1" }],
    [{ currency: "USD", minimum: "1" }],
    [{ currency: "USD", fractionDigits: 2, minimum: "2", maximum: "1" }],
    [
      {
        currency: "USD",
        fractionDigits: 2,
        minimum: "1",
        suggestedAmounts: ["0.99"],
      },
    ],
    [
      {
        currency: "USD",
        fractionDigits: 2,
        minimum: "1",
        maximum: "5",
        suggestedAmounts: ["5.01"],
      },
    ],
    [
      {
        currency: "USD",
        fractionDigits: 2,
        minimum: "1",
        suggestedAmounts: null,
      },
    ],
    [config().currencies[0], config().currencies[0]],
  ]) {
    assert.throws(() => defineSupportContext({ ...config(), currencies }));
  }
  assert.throws(
    () =>
      defineSupportContext({ ...config(), acceptingContributions: "false" }),
    { code: "INVALID_INPUT" },
  );
  assert.throws(
    () => defineSupportContext({ ...config(), collectMessage: null }),
    { code: "INVALID_INPUT" },
  );
});

test("a unit is validated, defaulted, and priced within each currency's range", () => {
  const base = {
    id: "coffee",
    name: "Coffee",
    currencies: [
      {
        currency: "NGN",
        fractionDigits: 2,
        minimum: "500",
        maximum: "100000",
        unitPrice: "1500",
      },
    ],
  };
  const context = defineSupportContext({
    ...base,
    unit: { one: "coffee", other: "coffees" },
  });
  assert.deepEqual(context.unit, {
    one: "coffee",
    other: "coffees",
    icon: "coffee",
    start: 1,
    max: 20,
  });
  assert.equal(context.currencies[0].unitPrice, "1500.00");
  const invalid = [
    { unit: { one: "coffee", other: "coffees", icon: "rocket" } },
    { unit: { one: "coffee", other: "coffees", start: 5, max: 3 } },
    { unit: { one: "coffee", other: "coffees", max: 0 } },
    { unit: { one: "", other: "coffees" } },
    { unit: { one: "coffee", other: "coffees", colour: "red" } },
    {
      currencies: [{ ...base.currencies[0], unitPrice: "100" }],
    },
  ];
  for (const change of invalid)
    assert.throws(
      () => defineSupportContext({ ...base, ...change }),
      CheerkitError,
    );
  assert.equal(defineSupportContext(base).unit, undefined);
});
