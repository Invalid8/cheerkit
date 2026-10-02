import { CheerkitError } from "./errors.js";

/**
 * Normalize a positive decimal string without rounding or floating-point math.
 * Precision is trusted currency configuration, not a currency-support lookup.
 */
export function normalizeAmount(
  value: unknown,
  fractionDigits: number,
): string {
  if (
    !Number.isInteger(fractionDigits) ||
    fractionDigits < 0 ||
    fractionDigits > 18
  ) {
    throw new CheerkitError(
      "INVALID_AMOUNT",
      "Fraction digits must be an integer from 0 to 18.",
    );
  }
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !/^[0-9]+(?:\.[0-9]+)?$/.test(value)
  ) {
    throw new CheerkitError(
      "INVALID_AMOUNT",
      "Use a positive decimal string of at most 64 characters.",
    );
  }

  const [whole = "", fraction = ""] = value.split(".");
  if (fraction.length > fractionDigits) {
    throw new CheerkitError(
      "INVALID_AMOUNT",
      "Amount exceeds the configured currency precision.",
    );
  }
  const normalizedWhole = whole.replace(/^0+(?=[0-9])/, "");
  const normalizedFraction = fraction.padEnd(fractionDigits, "0");
  const normalized =
    fractionDigits === 0
      ? normalizedWhole
      : `${normalizedWhole}.${normalizedFraction}`;
  if (normalized.length > 64 || amountUnits(normalized) === 0n) {
    throw new CheerkitError(
      "INVALID_AMOUNT",
      "Amount must be positive and within the length limit.",
    );
  }
  return normalized;
}

/** Internal exact comparison only; callers must normalize to the same precision. */
export function amountUnits(normalized: string): bigint {
  return BigInt(normalized.replace(".", ""));
}

/** Internal: also accepts zero, for provider-reported amounts such as a refund not yet paid. */
export function normalizeNonNegativeAmount(
  value: unknown,
  fractionDigits: number,
): string {
  if (
    typeof value === "string" &&
    /^0+(?:\.0+)?$/.test(value) &&
    (value.split(".")[1] ?? "").length <= fractionDigits
  ) {
    return fractionDigits === 0 ? "0" : `0.${"0".repeat(fractionDigits)}`;
  }
  return normalizeAmount(value, fractionDigits);
}
