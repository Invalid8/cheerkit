import { normalizeAmount } from "../core/amount.js";
import { isAuthenticated } from "./authenticated.js";
import type { BachsEnvironment } from "./client.js";
import { fail, identifier, object } from "./validation.js";
import type { BachsEvent } from "./webhook.js";

export interface ExpectedBachsCollection {
  readonly organizationId: string;
  readonly environment: BachsEnvironment;
  readonly checkoutId: string;
  readonly reference: string;
  readonly amount: string;
  readonly currency: string;
  readonly fractionDigits: number;
}

export type CollectionReviewReason =
  | "missing_payment_identity"
  | "reference_mismatch"
  | "unrecognized_status"
  | "amount_mismatch"
  | "invalid_payment_facts";

export type BachsCollectionAssessment =
  | {
      readonly outcome: "ignored";
      readonly reason: "event_type" | "unrelated_checkout";
    }
  | {
      readonly outcome: "review";
      readonly reason: CollectionReviewReason;
      readonly eventId: string;
    }
  | {
      readonly outcome: "matched";
      readonly eventId: string;
      readonly chargeId: string;
      readonly checkoutId: string;
      readonly amount: string;
      readonly currency: string;
    }
  | {
      readonly outcome: "converted";
      readonly eventId: string;
      readonly chargeId: string;
      readonly checkoutId: string;
    };

export type ExpectedBachsCheckout = Pick<
  ExpectedBachsCollection,
  "checkoutId" | "reference" | "amount" | "currency" | "fractionDigits"
>;

const statusOf = (value: unknown) =>
  typeof value === "string" ? value.toLowerCase() : null;

/** Match authenticated collection evidence to a trusted stored attempt; does not record payment. */
export function assessBachsCollection(
  event: BachsEvent,
  expected: ExpectedBachsCollection,
): BachsCollectionAssessment {
  if (!isAuthenticated(event)) fail("INVALID_SIGNATURE");
  return assessAcceptedCollection(event, expected);
}

/** Internal: evidence has already been authenticated and accepted into trusted storage. */
export function assessAcceptedCollection(
  event: BachsEvent,
  expected: ExpectedBachsCollection,
): BachsCollectionAssessment {
  const input = object(expected, "INVALID_CONFIGURATION");
  const organizationId = identifier(
    input.organizationId,
    "INVALID_CONFIGURATION",
  );
  const checkoutId = identifier(input.checkoutId, "INVALID_CONFIGURATION");
  const reference = identifier(input.reference, "INVALID_CONFIGURATION");
  if (
    (input.environment !== "sandbox" && input.environment !== "live") ||
    typeof input.currency !== "string" ||
    !/^[A-Z]{3}$/.test(input.currency)
  )
    fail("INVALID_CONFIGURATION");
  let intended: string;
  try {
    intended = normalizeAmount(input.amount, input.fractionDigits as number);
  } catch {
    return fail("INVALID_CONFIGURATION");
  }
  if (
    event.organizationId !== organizationId ||
    event.environment !== input.environment
  )
    fail("WRONG_ACCOUNT");
  if (event.type !== "collection.succeeded")
    return Object.freeze({ outcome: "ignored", reason: "event_type" });
  if (event.data.checkout_id !== checkoutId)
    return Object.freeze({ outcome: "ignored", reason: "unrelated_checkout" });
  const review = (reason: CollectionReviewReason): BachsCollectionAssessment =>
    Object.freeze({
      outcome: "review",
      reason,
      eventId: event.id,
    });
  if (event.data.reference != null && event.data.reference !== reference)
    return review("reference_mismatch");
  let chargeId: string;
  try {
    chargeId = identifier(event.data.charge_id, "INVALID_EVENT");
  } catch {
    return review("missing_payment_identity");
  }
  const status = statusOf(event.data.status);
  if (status !== "succeeded" && status !== "accepted")
    return review("unrecognized_status");
  if (
    typeof event.data.currency !== "string" ||
    !/^[A-Z]{3}$/.test(event.data.currency)
  )
    return review("invalid_payment_facts");
  if (event.data.currency !== input.currency) {
    const received = event.data.amount;
    if (
      typeof received !== "string" ||
      !/^\d+(\.\d+)?$/.test(received) ||
      !/[1-9]/.test(received)
    )
      return review("invalid_payment_facts");
    return Object.freeze({
      outcome: "converted",
      eventId: event.id,
      chargeId,
      checkoutId,
    });
  }
  let amount: string;
  try {
    amount = normalizeAmount(event.data.amount, input.fractionDigits as number);
  } catch {
    return review("invalid_payment_facts");
  }
  if (amount !== intended) return review("amount_mismatch");
  return Object.freeze({
    outcome: "matched",
    eventId: event.id,
    chargeId,
    checkoutId,
    amount,
    currency: input.currency,
  });
}

/** Whether an accepted `checkout.completed` reports the checkout as paid for exactly the intended amount and currency. */
export function checkoutPaidAsIntended(
  event: BachsEvent,
  expected: ExpectedBachsCheckout,
): boolean {
  if (
    event.type !== "checkout.completed" ||
    event.data.checkout_id !== expected.checkoutId
  )
    return false;
  if (
    event.data.reference != null &&
    event.data.reference !== expected.reference
  )
    return false;
  if (
    statusOf(event.data.status) !== "completed" ||
    statusOf(event.data.payment_status) !== "paid"
  )
    return false;
  if (event.data.currency !== expected.currency) return false;
  try {
    return (
      normalizeAmount(event.data.amount, expected.fractionDigits) ===
      normalizeAmount(expected.amount, expected.fractionDigits)
    );
  } catch {
    return false;
  }
}
