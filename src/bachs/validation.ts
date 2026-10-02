import { BachsError, type BachsErrorCode } from "./errors.js";

export function fail(code: BachsErrorCode): never {
  throw new BachsError(code, "Invalid Bachs input or configuration.");
}

export function object(
  value: unknown,
  code: BachsErrorCode,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(code);
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    fail(code);
  return value as Record<string, unknown>;
}

export function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  code: BachsErrorCode,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail(code);
}

export function text(
  value: unknown,
  limit: number,
  code: BachsErrorCode,
): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > limit ||
    value.trim() !== value
  ) {
    fail(code);
  }
  return value;
}

export function identifier(value: unknown, code: BachsErrorCode): string {
  const result = text(value, 128, code);
  if (!/^[A-Za-z0-9_.:-]+$/.test(result)) fail(code);
  return result;
}

export function timestamp(value: unknown, code: BachsErrorCode): string {
  const result = text(value, 64, code);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(
      result,
    ) ||
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString().slice(0, 19) !== result.slice(0, 19)
  )
    fail(code);
  return result;
}

export function httpsUrl(value: unknown, code: BachsErrorCode): string {
  const result = text(value, 2048, code);
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    return fail(code);
  }
  if (url.protocol !== "https:" || url.username || url.password) fail(code);
  return result;
}
