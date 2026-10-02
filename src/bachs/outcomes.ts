import type { BachsEvent } from "./webhook.js";
import { identifier, timestamp } from "./validation.js";

export type RefundStatus = "processing" | "paid" | "failed";
export type DisputeStatus =
  "needs_response" | "under_review" | "won" | "lost" | "closed";

/** Facts read from an accepted event. Amounts stay raw until normalized at the charge's precision. */
export type BachsEventFacts =
  | { readonly kind: "collection" }
  | {
      readonly kind: "checkout";
      readonly checkoutId: string;
      readonly reference: string | null;
      readonly status: "expired" | "completed";
    }
  | {
      readonly kind: "collection_failed" | "underpaid";
      readonly checkoutId: string | null;
      readonly chargeId: string;
    }
  | {
      readonly kind: "refund";
      readonly refundId: string;
      readonly chargeId: string;
      readonly status: RefundStatus;
      readonly requestedAmount: unknown;
      readonly refundedAmount: unknown;
    }
  | {
      readonly kind: "dispute";
      readonly disputeId: string;
      readonly chargeId: string;
      readonly status: DisputeStatus;
      readonly amount: unknown;
      readonly currency: unknown;
      readonly updatedAt: string | null;
    }
  | { readonly kind: "invalid" }
  | { readonly kind: "unsupported" };

const refundStatuses: Readonly<Record<string, RefundStatus>> = {
  "refund.created": "processing",
  "refund.paid": "paid",
  "refund.failed": "failed",
};
const disputeStatuses: readonly string[] = [
  "needs_response",
  "under_review",
  "won",
  "lost",
  "closed",
];

const optionalIdentifier = (value: unknown): string | null =>
  value == null ? null : identifier(value, "INVALID_EVENT");

export function readEventFacts(event: BachsEvent): BachsEventFacts {
  const data = event.data;
  try {
    switch (event.type) {
      case "collection.succeeded":
        return { kind: "collection" };
      case "checkout.expired":
      case "checkout.completed": {
        const status =
          event.type === "checkout.expired" ? "expired" : "completed";
        if (data.status !== status) return { kind: "invalid" };
        return {
          kind: "checkout",
          checkoutId: identifier(data.checkout_id, "INVALID_EVENT"),
          reference: optionalIdentifier(data.reference),
          status,
        };
      }
      case "collection.failed":
      case "collection.underpaid":
        return {
          kind:
            event.type === "collection.failed"
              ? "collection_failed"
              : "underpaid",
          checkoutId: optionalIdentifier(data.checkout_id),
          chargeId: identifier(data.charge_id, "INVALID_EVENT"),
        };
      case "refund.created":
      case "refund.paid":
      case "refund.failed": {
        const status = refundStatuses[event.type]!;
        if (data.status !== status) return { kind: "invalid" };
        return {
          kind: "refund",
          refundId: identifier(data.refund_id, "INVALID_EVENT"),
          chargeId: identifier(data.charge_id, "INVALID_EVENT"),
          status,
          requestedAmount: data.requested_amount,
          refundedAmount: data.refunded_amount,
        };
      }
      case "dispute.created":
      case "dispute.updated": {
        if (
          typeof data.status !== "string" ||
          !disputeStatuses.includes(data.status)
        )
          return { kind: "invalid" };
        return {
          kind: "dispute",
          disputeId: identifier(data.dispute_id, "INVALID_EVENT"),
          chargeId: identifier(data.charge_id, "INVALID_EVENT"),
          status: data.status as DisputeStatus,
          amount: data.amount,
          currency: data.currency,
          updatedAt:
            data.updated_at == null
              ? null
              : timestamp(data.updated_at, "INVALID_EVENT"),
        };
      }
      default:
        return { kind: "unsupported" };
    }
  } catch {
    return { kind: "invalid" };
  }
}

export const settlementFields: readonly string[] = [
  "settlement_amount",
  "settlement_currency",
  "processing_fee",
  "processing_fee_currency",
  "fee_bearer",
];

const retainedFields: readonly string[] = [
  "checkout_id",
  "charge_id",
  "reference",
  "status",
  "payment_status",
  "amount",
  "currency",
  "amount_paid",
  "amount_expected",
  "amount_remaining",
  "refund_id",
  "requested_amount",
  "refunded_amount",
  "dispute_id",
  "created_at",
  "updated_at",
  "expires_at",
  "completed_at",
  ...settlementFields,
];

export interface BachsSettlementFacts {
  readonly amount: string;
  readonly currency: string;
  readonly fee: string | null;
  readonly feeCurrency: string | null;
  readonly feeBearer: "merchant" | "customer" | null;
}

const decimal = (value: unknown): value is string =>
  typeof value === "string" && /^\d+(\.\d+)?$/.test(value);
const currencyCode = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value);

/** What a collection credited to the account, as Bachs reports it; null when Bachs did not report a settlement. */
// REVISIT(bachs): Bachs sends the string "None" here and reports USD settlement gross while its docs show net.
export function readSettlementFacts(
  data: BachsEvent["data"],
): BachsSettlementFacts | null {
  if (
    !decimal(data.settlement_amount) ||
    !currencyCode(data.settlement_currency)
  )
    return null;
  const feeKnown =
    decimal(data.processing_fee) && currencyCode(data.processing_fee_currency);
  return {
    amount: data.settlement_amount,
    currency: data.settlement_currency,
    fee: feeKnown ? (data.processing_fee as string) : null,
    feeCurrency: feeKnown ? (data.processing_fee_currency as string) : null,
    feeBearer:
      data.fee_bearer === "merchant" || data.fee_bearer === "customer"
        ? data.fee_bearer
        : null,
  };
}

/**
 * The event reduced to the fields Cheerkit interprets. Payer identity (customer, email, name, phone, address)
 * and provider metadata are dropped, so they are never stored.
 */
export function minimizedEvent(event: BachsEvent): BachsEvent {
  return {
    id: event.id,
    type: event.type,
    createdAt: event.createdAt,
    organizationId: event.organizationId,
    environment: event.environment,
    data: Object.fromEntries(
      Object.entries(event.data).filter(
        ([key, value]) =>
          retainedFields.includes(key) &&
          (value === null || typeof value !== "object"),
      ),
    ),
  };
}
