import { normalizeAmount } from "../core/amount.js";
import type { BachsCheckout, BachsEnvironment } from "./client.js";
import type { PreparedBachsCheckout } from "./request.js";
import { BachsError } from "./errors.js";
import { readCheckoutResponse } from "./response.js";
import { fail, identifier, object, timestamp } from "./validation.js";

export interface RecoveredBachsCheckout extends Omit<BachsCheckout, "url"> {
  readonly organizationId: string;
  readonly environment: BachsEnvironment;
  readonly amount: string;
  readonly currency: string;
}

const retrieved = new WeakSet<object>();
export function isRecoveredCheckout(
  value: unknown,
): value is RecoveredBachsCheckout {
  return typeof value === "object" && value !== null && retrieved.has(value);
}

export async function retrieveCheckout(
  id: string,
  request: PreparedBachsCheckout,
  config: {
    organizationId: string;
    secretKey: string;
    endpoint: string;
    timeoutMs: number;
    transport: typeof fetch;
  },
): Promise<RecoveredBachsCheckout> {
  const checkoutId = identifier(id, "INVALID_CHECKOUT");
  // Dot-only path segments are normalized by URL/fetch, even when percent-encoded.
  if (checkoutId === "." || checkoutId === "..") fail("INVALID_CHECKOUT");
  let payload: unknown;
  try {
    const response = await config.transport(
      `${config.endpoint}/${encodeURIComponent(checkoutId)}`,
      {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(config.timeoutMs),
        headers: { Authorization: `Bearer ${config.secretKey}` },
      },
    );
    if (!response.ok)
      throw new BachsError(
        "RECOVERY_FAILED",
        "Checkout recovery could not be verified.",
        response.status,
      );
    payload = await readCheckoutResponse(response, "RECOVERY_FAILED");
  } catch (error) {
    if (error instanceof BachsError && error.code === "RECOVERY_FAILED")
      throw error;
    throw new BachsError(
      "RECOVERY_FAILED",
      "Checkout recovery could not be verified.",
    );
  }
  const result = object(payload, "RECOVERY_FAILED");
  const expected = JSON.parse(request.body) as {
    pricing: { amount: string; currency: string };
    success_url: string;
    cancel_url: string;
  };
  const status = result.status;
  if (
    result.checkout_id !== checkoutId ||
    result.reference !== request.reference ||
    result.currency !== expected.pricing.currency ||
    result.success_url !== expected.success_url ||
    result.cancel_url !== expected.cancel_url ||
    result.account !== undefined ||
    (result.organization_id !== undefined &&
      result.organization_id !== config.organizationId) ||
    (status !== "open" &&
      status !== "completed" &&
      status !== "expired" &&
      status !== "cancelled")
  )
    fail("RECOVERY_FAILED");
  let amount: string;
  try {
    amount = normalizeAmount(result.amount, request.fractionDigits);
  } catch {
    return fail("RECOVERY_FAILED");
  }
  if (amount !== expected.pricing.amount) fail("RECOVERY_FAILED");
  const createdAt = timestamp(result.created_at, "RECOVERY_FAILED");
  const expiresAt = timestamp(result.expires_at, "RECOVERY_FAILED");
  if (Date.parse(expiresAt) < Date.parse(createdAt)) fail("RECOVERY_FAILED");
  const recovered = Object.freeze({
    id: checkoutId,
    reference: request.reference,
    status,
    createdAt,
    expiresAt,
    organizationId: config.organizationId,
    environment: request.environment,
    amount,
    currency: expected.pricing.currency,
  });
  retrieved.add(recovered);
  return recovered;
}
