import assert from "node:assert/strict";
import { test } from "node:test";
import { CheerkitError, normalizeAmount } from "cheerkit";

test("decimal input is normalized without rounding", () => {
  assert.equal(normalizeAmount("001000", 2), "1000.00");
  assert.equal(normalizeAmount("0.1", 2), "0.10");
  assert.equal(normalizeAmount("0.01", 2), "0.01");
  assert.equal(normalizeAmount("500", 0), "500");
  assert.equal(normalizeAmount("0.001", 3), "0.001");
  assert.equal(
    normalizeAmount("0.000000000000000001", 18),
    "0.000000000000000001",
  );
});

test("amounts above Number.MAX_SAFE_INTEGER retain every digit", () => {
  assert.equal(
    normalizeAmount("9007199254740993.01", 2),
    "9007199254740993.01",
  );
});

for (const input of [
  1000,
  0.1 + 0.2,
  NaN,
  Infinity,
  1n,
  null,
  undefined,
  {},
  [],
  "",
  "0",
  "000.00",
  "-1",
  "+1",
  "1e3",
  "1,000",
  " 1000",
  "1000 ",
  "1\n",
  ".5",
  "5.",
  "1.2.3",
  "１",
  "١",
  "1_000",
  "0x10",
  "1".repeat(65),
]) {
  test(`rejects invalid decimal input ${String(input)}`, () => {
    assert.throws(
      () => normalizeAmount(input, 2),
      (error) => {
        assert.ok(error instanceof CheerkitError);
        assert.equal(error.code, "INVALID_AMOUNT");
        return true;
      },
    );
  });
}

test("excess precision is rejected even when it would round to an allowed amount", () => {
  for (const amount of ["1.001", "1.000", "0.009"]) {
    assert.throws(() => normalizeAmount(amount, 2), { code: "INVALID_AMOUNT" });
  }
  assert.throws(() => normalizeAmount("1.0", 0), { code: "INVALID_AMOUNT" });
});

test("normalization cannot expand an amount beyond its size limit", () => {
  assert.throws(() => normalizeAmount("1".repeat(64), 2), {
    code: "INVALID_AMOUNT",
  });
});

test("precision must be explicit and within the supported parser range", () => {
  for (const precision of [-1, 1.5, 19, NaN, Infinity, undefined, "2"]) {
    assert.throws(() => normalizeAmount("1", precision), {
      code: "INVALID_AMOUNT",
    });
  }
});
