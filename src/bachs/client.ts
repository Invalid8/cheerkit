import { BachsError } from "./errors.js";
import {
  retrievePaymentStatement,
  type BachsPaymentStatement,
} from "./payments.js";
import { retrieveCheckout, type RecoveredBachsCheckout } from "./recovery.js";
import {
  validatePreparedCheckout,
  type PreparedBachsCheckout,
} from "./request.js";
import { readCheckoutResponse } from "./response.js";
import {
  fail,
  httpsUrl,
  identifier,
  keys,
  object,
  text,
  timestamp,
} from "./validation.js";

export type BachsEnvironment = "sandbox" | "live";

export interface BachsClientOptions {
  readonly secretKey: string;
  readonly organizationId: string;
  readonly environment?: BachsEnvironment;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export interface BachsCheckout {
  readonly id: string;
  readonly url: string;
  readonly status: "open" | "completed" | "expired" | "cancelled";
  readonly reference: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/** Everything Cheerkit asks of Bachs with an account's key, apart from preparing new checkouts. */
export interface BachsClient {
  readonly organizationId: string;
  readonly environment: BachsEnvironment;
  readonly timeoutMs: number;
  /** Period after first dispatch in which the same key and body may be resent with the same credential. */
  readonly retryWindowMs: number;
  /** SHA-256 identity of the configured API key; idempotency is scoped per key. Not a secret-equivalent. */
  credentialFingerprint(): Promise<string>;
  /** Sends a stored request once. Persist the request before calling. */
  createCheckout(request: PreparedBachsCheckout): Promise<BachsCheckout>;
  retrieveCheckout(
    checkoutId: string,
    request: PreparedBachsCheckout,
  ): Promise<RecoveredBachsCheckout>;
  /** Reads Bachs's current record of a charge. Read-only; payer details in the response are discarded. */
  retrievePayment(chargeId: string): Promise<BachsPaymentStatement>;
  /** Asks Bachs to deliver a charge's webhook notices again; they arrive through the webhook like any other. */
  resendChargeNotices(chargeId: string): Promise<void>;
}

export const clientOptionKeys: readonly string[] = [
  "secretKey",
  "organizationId",
  "environment",
  "timeoutMs",
  "fetch",
];

// Bachs caches successful responses for 24 hours per API key; keep an hour for clock skew.
const retryWindowMs = 23 * 60 * 60 * 1000;

const apiBase = {
  sandbox: "https://sandbox-api.bachs.io",
  live: "https://api.bachs.io",
} as const;

export function createBachsClient(options: BachsClientOptions): BachsClient {
  const config = object(options, "INVALID_CONFIGURATION");
  keys(config, clientOptionKeys, "INVALID_CONFIGURATION");
  const organizationId = identifier(
    config.organizationId,
    "INVALID_CONFIGURATION",
  );
  const environment = config.environment ?? "sandbox";
  if (environment !== "sandbox" && environment !== "live")
    fail("INVALID_CONFIGURATION");
  const secretKey = text(config.secretKey, 1024, "INVALID_CONFIGURATION");
  if (
    !secretKey.startsWith(`sk_${environment}_`) ||
    /\s/.test(secretKey) ||
    secretKey.length <= `sk_${environment}_`.length
  )
    fail("INVALID_CONFIGURATION");
  const timeoutMs = config.timeoutMs ?? 15_000;
  if (
    typeof timeoutMs !== "number" ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120_000
  )
    fail("INVALID_CONFIGURATION");
  const transport = options.fetch ?? globalThis.fetch;
  if (typeof transport !== "function") fail("INVALID_CONFIGURATION");
  const api = apiBase[environment];
  const checkRequest = (request: PreparedBachsCheckout) => {
    const prepared = validatePreparedCheckout(request);
    if (prepared.environment !== environment) fail("INVALID_CHECKOUT");
    return prepared;
  };
  let fingerprint: Promise<string> | undefined;

  return Object.freeze({
    organizationId,
    environment,
    timeoutMs,
    retryWindowMs,
    credentialFingerprint(): Promise<string> {
      fingerprint ??= crypto.subtle
        .digest("SHA-256", new TextEncoder().encode(secretKey))
        .then((digest) =>
          Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join(""),
        );
      return fingerprint;
    },
    async createCheckout(
      request: PreparedBachsCheckout,
    ): Promise<BachsCheckout> {
      const { reference, idempotencyKey, body } = checkRequest(request);
      let payload: unknown;
      try {
        const response = await transport(`${api}/v1/checkout-sessions`, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            Authorization: `Bearer ${secretKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body,
        });
        if (!response.ok) {
          // A conflict may describe an earlier accepted operation; preserve uncertainty.
          const rejected = [400, 401, 403, 404, 422, 429].includes(
            response.status,
          );
          throw new BachsError(
            rejected ? "CHECKOUT_REJECTED" : "CHECKOUT_UNCERTAIN",
            rejected
              ? "Bachs rejected checkout creation."
              : "Checkout creation requires recovery.",
            response.status,
          );
        }
        payload = await readCheckoutResponse(response);
      } catch (error) {
        if (error instanceof BachsError) throw error;
        throw new BachsError(
          "CHECKOUT_UNCERTAIN",
          "Checkout creation requires recovery.",
        );
      }
      const result = object(payload, "CHECKOUT_UNCERTAIN");
      const status = result.status;
      if (
        status !== "open" &&
        status !== "completed" &&
        status !== "expired" &&
        status !== "cancelled"
      )
        fail("CHECKOUT_UNCERTAIN");
      if (result.reference !== reference) fail("CHECKOUT_UNCERTAIN");
      return Object.freeze({
        id: identifier(result.checkout_id, "CHECKOUT_UNCERTAIN"),
        url: httpsUrl(result.checkout_url, "CHECKOUT_UNCERTAIN"),
        status,
        reference,
        createdAt: timestamp(result.created_at, "CHECKOUT_UNCERTAIN"),
        expiresAt: timestamp(result.expires_at, "CHECKOUT_UNCERTAIN"),
      });
    },
    retrieveCheckout(
      checkoutId: string,
      request: PreparedBachsCheckout,
    ): Promise<RecoveredBachsCheckout> {
      return retrieveCheckout(checkoutId, checkRequest(request), {
        organizationId,
        secretKey,
        endpoint: `${api}/v1/checkout-sessions`,
        timeoutMs,
        transport,
      });
    },
    retrievePayment(chargeId: string): Promise<BachsPaymentStatement> {
      return retrievePaymentStatement(chargeId, {
        organizationId,
        environment,
        secretKey,
        endpoint: `${api}/v1/payments`,
        timeoutMs,
        transport,
      });
    },
    async resendChargeNotices(chargeId: string): Promise<void> {
      const body = JSON.stringify({
        charge_id: identifier(chargeId, "INVALID_CHECKOUT"),
      });
      let response: Response;
      try {
        response = await transport(`${api}/v1/webhooks/replay`, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            Authorization: `Bearer ${secretKey}`,
            "Content-Type": "application/json",
          },
          body,
        });
      } catch {
        throw new BachsError(
          "RESEND_FAILED",
          "Bachs did not accept the resend request.",
        );
      }
      if (!response.ok)
        throw new BachsError(
          "RESEND_FAILED",
          "Bachs did not accept the resend request.",
          response.status,
        );
    },
  });
}
