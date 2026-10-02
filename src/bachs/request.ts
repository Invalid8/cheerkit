import { normalizeAmount } from "../core/amount.js";
import type { BachsEnvironment } from "./client.js";
import {
  fail,
  httpsUrl,
  identifier,
  keys,
  object,
  text,
} from "./validation.js";

export interface CheckoutAttemptIdentity {
  readonly reference: string;
  readonly idempotencyKey: string;
}

/** The exact checkout request for one attempt. Persist it before sending; never accept it from a supporter. */
export interface PreparedBachsCheckout {
  readonly environment: BachsEnvironment;
  readonly reference: string;
  readonly idempotencyKey: string;
  readonly fractionDigits: number;
  readonly body: string;
}

export function validatePreparedCheckout(
  value: PreparedBachsCheckout,
): PreparedBachsCheckout {
  const input = object(value, "INVALID_CHECKOUT");
  keys(
    input,
    ["environment", "reference", "idempotencyKey", "fractionDigits", "body"],
    "INVALID_CHECKOUT",
  );
  if (input.environment !== "sandbox" && input.environment !== "live")
    fail("INVALID_CHECKOUT");
  const reference = identifier(input.reference, "INVALID_CHECKOUT");
  const idempotencyKey = identifier(input.idempotencyKey, "INVALID_CHECKOUT");
  const body = text(input.body, 16_384, "INVALID_CHECKOUT");
  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    return fail("INVALID_CHECKOUT");
  }
  const payload = object(decoded, "INVALID_CHECKOUT");
  keys(
    payload,
    [
      "pricing",
      "reference",
      "success_url",
      "cancel_url",
      "customer_bears_fee",
      "payment_method_types",
    ],
    "INVALID_CHECKOUT",
  );
  if (payload.reference !== reference) fail("INVALID_CHECKOUT");
  const pricing = object(payload.pricing, "INVALID_CHECKOUT");
  keys(pricing, ["currency", "amount", "price_type"], "INVALID_CHECKOUT");
  if (
    pricing.price_type !== "fixed" ||
    typeof pricing.currency !== "string" ||
    !/^[A-Z]{3}$/.test(pricing.currency)
  )
    fail("INVALID_CHECKOUT");
  try {
    if (
      normalizeAmount(pricing.amount, input.fractionDigits as number) !==
      pricing.amount
    )
      fail("INVALID_CHECKOUT");
  } catch {
    return fail("INVALID_CHECKOUT");
  }
  httpsUrl(payload.success_url, "INVALID_CHECKOUT");
  httpsUrl(payload.cancel_url, "INVALID_CHECKOUT");
  if (
    payload.customer_bears_fee !== undefined &&
    typeof payload.customer_bears_fee !== "boolean"
  )
    fail("INVALID_CHECKOUT");
  if (
    payload.payment_method_types !== undefined &&
    (!Array.isArray(payload.payment_method_types) ||
      !payload.payment_method_types.length ||
      payload.payment_method_types.length > 32 ||
      payload.payment_method_types.some(
        (method: unknown) =>
          typeof method !== "string" ||
          method.length > 64 ||
          !/^[A-Z][A-Z0-9_]+$/.test(method),
      ))
  )
    fail("INVALID_CHECKOUT");
  return Object.freeze({
    environment: input.environment,
    reference,
    idempotencyKey,
    fractionDigits: input.fractionDigits as number,
    body,
  });
}
