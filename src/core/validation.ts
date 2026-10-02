import { CheerkitError } from "./errors.js";

export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CheerkitError("INVALID_INPUT", "Expected a plain object.");
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CheerkitError("INVALID_INPUT", "Expected a plain object.");
  }
  return value as Record<string, unknown>;
}

export function allowKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new CheerkitError("INVALID_INPUT", "Unexpected input field.");
  }
}

export function requiredText(value: unknown, limit: number): string {
  if (typeof value !== "string") {
    throw new CheerkitError("INVALID_INPUT", "Expected text.");
  }
  const text = value.trim();
  if (!text || text.length > limit) {
    throw new CheerkitError(
      "INVALID_INPUT",
      "Text is empty or exceeds the length limit.",
    );
  }
  return text;
}

export function optionalBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new CheerkitError("INVALID_INPUT", "Expected a boolean.");
  }
  return value;
}
