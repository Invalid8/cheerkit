import { normalizeAmount } from "../core/amount.js";
import type { PendingContribution } from "../core/contribution.js";
import {
  clientOptionKeys,
  createBachsClient,
  type BachsClient,
  type BachsClientOptions,
} from "./client.js";
import type {
  CheckoutAttemptIdentity,
  PreparedBachsCheckout,
} from "./request.js";
import {
  fail,
  httpsUrl,
  identifier,
  keys,
  object,
  text,
} from "./validation.js";

export interface BachsCheckoutOptions extends BachsClientOptions {
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly paymentMethodTypes?: readonly string[];
  readonly feeBearer?: "merchant" | "customer" | "account_default";
}

/** The client a website needs: the account client plus preparation of new checkouts with the site's return URLs. */
export interface BachsCheckoutClient extends BachsClient {
  readonly feeBearer: "merchant" | "customer" | "account_default";
  prepareCheckout(
    intent: PendingContribution,
    attempt: CheckoutAttemptIdentity,
  ): PreparedBachsCheckout;
}

export function createBachsCheckoutClient(
  options: BachsCheckoutOptions,
): BachsCheckoutClient {
  const config = object(options, "INVALID_CONFIGURATION");
  keys(
    config,
    [
      ...clientOptionKeys,
      "successUrl",
      "cancelUrl",
      "paymentMethodTypes",
      "feeBearer",
    ],
    "INVALID_CONFIGURATION",
  );
  const {
    successUrl: rawSuccess,
    cancelUrl: rawCancel,
    paymentMethodTypes,
    feeBearer: rawFeeBearer,
    ...clientOptions
  } = options;
  const client = createBachsClient(clientOptions);
  const successUrl = httpsUrl(rawSuccess, "INVALID_CONFIGURATION");
  const cancelUrl = httpsUrl(rawCancel, "INVALID_CONFIGURATION");
  const feeBearer = rawFeeBearer ?? "merchant";
  if (
    feeBearer !== "merchant" &&
    feeBearer !== "customer" &&
    feeBearer !== "account_default"
  )
    fail("INVALID_CONFIGURATION");
  let methods: string[] | undefined;
  if (paymentMethodTypes !== undefined) {
    if (
      !Array.isArray(paymentMethodTypes) ||
      !paymentMethodTypes.length ||
      paymentMethodTypes.length > 32
    )
      fail("INVALID_CONFIGURATION");
    methods = [
      ...new Set(
        paymentMethodTypes.map((value: unknown) => {
          const method = text(value, 64, "INVALID_CONFIGURATION");
          if (!/^[A-Z][A-Z0-9_]+$/.test(method)) fail("INVALID_CONFIGURATION");
          return method;
        }),
      ),
    ];
  }

  return Object.freeze({
    ...client,
    feeBearer,
    prepareCheckout(
      intent: PendingContribution,
      attempt: CheckoutAttemptIdentity,
    ): PreparedBachsCheckout {
      const input = object(intent, "INVALID_CHECKOUT");
      const identity = object(attempt, "INVALID_CHECKOUT");
      keys(identity, ["reference", "idempotencyKey"], "INVALID_CHECKOUT");
      if (input.status !== "pending") fail("INVALID_CHECKOUT");
      text(input.id, 128, "INVALID_CHECKOUT");
      text(input.contextId, 128, "INVALID_CHECKOUT");
      const currency = text(input.currency, 3, "INVALID_CHECKOUT");
      if (!/^[A-Z]{3}$/.test(currency)) fail("INVALID_CHECKOUT");
      let amount: string;
      try {
        amount = normalizeAmount(input.amount, input.fractionDigits as number);
      } catch {
        return fail("INVALID_CHECKOUT");
      }
      const reference = identifier(identity.reference, "INVALID_CHECKOUT");
      const key = identifier(identity.idempotencyKey, "INVALID_CHECKOUT");
      const body = JSON.stringify({
        pricing: { currency, amount, price_type: "fixed" },
        reference,
        success_url: successUrl,
        cancel_url: cancelUrl,
        ...(feeBearer === "account_default"
          ? {}
          : { customer_bears_fee: feeBearer === "customer" }),
        ...(methods === undefined ? {} : { payment_method_types: methods }),
      });
      return Object.freeze({
        environment: client.environment,
        reference,
        idempotencyKey: key,
        fractionDigits: intent.fractionDigits,
        body,
      });
    },
  });
}
