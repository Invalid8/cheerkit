import type { BachsEnvironment } from "./client.js";
import { BachsError } from "./errors.js";
import { readCheckoutResponse } from "./response.js";
import { fail, identifier, object, text } from "./validation.js";

export interface BachsFee {
  readonly amount: string;
  readonly currency: string;
}

/** Bachs's current record of one charge, as retrieved by the owner. It never proves or confirms a payment on its own. */
// REVISIT(bachs): read the net settled amount here if Bachs exposes it; it is dashboard-only today.
export interface BachsPaymentStatement {
  readonly organizationId: string;
  readonly environment: BachsEnvironment;
  readonly chargeId: string;
  readonly checkoutId: string | null;
  /** As Bachs reports it; not interpreted. */
  readonly status: string;
  /** What the payer was charged, in the currency they paid in. */
  readonly amount: string;
  readonly currency: string;
  /** The processing fee in the currency it was taken in; null when Bachs reports that the payment carries none. */
  readonly fee: BachsFee | null;
  readonly feeBearer: "merchant" | "customer" | null;
}

const retrieved = new WeakSet<object>();
export function isPaymentStatement(
  value: unknown,
): value is BachsPaymentStatement {
  return typeof value === "object" && value !== null && retrieved.has(value);
}

const decimal = (value: unknown): string => {
  if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value))
    fail("LOOKUP_FAILED");
  return value;
};
const currencyCode = (value: unknown): string => {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value))
    fail("LOOKUP_FAILED");
  return value;
};

export async function retrievePaymentStatement(
  id: string,
  config: {
    organizationId: string;
    environment: BachsEnvironment;
    secretKey: string;
    endpoint: string;
    timeoutMs: number;
    transport: typeof fetch;
  },
): Promise<BachsPaymentStatement> {
  const chargeId = identifier(id, "INVALID_CHECKOUT");
  // Dot-only path segments are normalized by URL/fetch, even when percent-encoded.
  if (chargeId === "." || chargeId === "..") fail("INVALID_CHECKOUT");
  let payload: unknown;
  try {
    const response = await config.transport(
      `${config.endpoint}/${encodeURIComponent(chargeId)}`,
      {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(config.timeoutMs),
        headers: { Authorization: `Bearer ${config.secretKey}` },
      },
    );
    if (!response.ok)
      throw new BachsError(
        "LOOKUP_FAILED",
        "Bachs did not return the payment.",
        response.status,
      );
    payload = await readCheckoutResponse(response, "LOOKUP_FAILED");
  } catch (error) {
    if (error instanceof BachsError && error.code === "LOOKUP_FAILED")
      throw error;
    throw new BachsError("LOOKUP_FAILED", "Bachs did not return the payment.");
  }
  const result = object(payload, "LOOKUP_FAILED");
  if (result.payment_id !== chargeId || result.account !== undefined)
    fail("LOOKUP_FAILED");
  const fees =
    result.fees == null ? null : object(result.fees, "LOOKUP_FAILED");
  const bearer = result.merchant_bears_cost;
  if (bearer != null && typeof bearer !== "boolean") fail("LOOKUP_FAILED");
  const statement = Object.freeze({
    organizationId: config.organizationId,
    environment: config.environment,
    chargeId,
    checkoutId:
      result.checkout_id == null
        ? null
        : identifier(result.checkout_id, "LOOKUP_FAILED"),
    status: text(result.status, 64, "LOOKUP_FAILED"),
    amount: decimal(result.amount),
    currency: currencyCode(result.currency),
    fee:
      fees === null
        ? null
        : Object.freeze({
            amount: decimal(fees.amount),
            currency: currencyCode(fees.currency),
          }),
    feeBearer:
      bearer == null
        ? null
        : bearer
          ? ("merchant" as const)
          : ("customer" as const),
  });
  retrieved.add(statement);
  return statement;
}
