import type { RecoveredBachsCheckout } from "../bachs/recovery.js";
import type { PendingContribution } from "../core/contribution.js";
import type { ContributionMetadata } from "../core/metadata.js";
import type { SupportContext, SupportContextInput } from "../core/context.js";
import type { BachsCheckout, BachsEnvironment } from "../bachs/client.js";
import type { PreparedBachsCheckout } from "../bachs/request.js";
import type { BachsEvent } from "../bachs/webhook.js";
import type {
  BachsSettlementFacts,
  DisputeStatus,
  RefundStatus,
} from "../bachs/outcomes.js";
import type { BachsPaymentStatement } from "../bachs/payments.js";

export type StoreErrorCode =
  "CONFLICT" | "NOT_FOUND" | "INVALID_STATE" | "STORAGE_FAILURE";
export class CheerkitStoreError extends Error {
  override readonly name = "CheerkitStoreError";
  constructor(
    readonly code: StoreErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Refund amounts are recorded in the charge's currency; Bachs refund events do not state a currency. */
export interface StoredRefund {
  readonly refundId: string;
  readonly status: RefundStatus;
  readonly requestedAmount: string;
  readonly refundedAmount: string;
}

export interface StoredDispute {
  readonly disputeId: string;
  readonly status: DisputeStatus;
  readonly amount: string;
  readonly currency: string;
  readonly updatedAt: string | null;
}

/** Bachs's record of a charge as last retrieved by the owner, with when it was retrieved. */
export type StoredPaymentStatement = Omit<
  BachsPaymentStatement,
  "organizationId" | "environment" | "chargeId" | "checkoutId"
> & { readonly retrievedAt: string };

/**
 * The payment's processing fee, from Bachs's retrieved record when there is one, otherwise from the collection notice.
 * `none`: Bachs reports that the payment carries no fee. `unreported`: neither source states it.
 */
export type PaymentFee =
  | {
      readonly state: "charged";
      readonly amount: string;
      readonly currency: string;
      readonly bearer: "merchant" | "customer" | null;
    }
  | { readonly state: "none" }
  | { readonly state: "unreported" };

export interface StoredPayment {
  readonly chargeId: string;
  readonly amount: string;
  readonly currency: string;
  readonly checkoutId: string;
  /** Credited amount and processing fee from the collection notice; null when Bachs did not report them. */
  readonly settlement: BachsSettlementFacts | null;
  /** Bachs's payment record, when the owner has retrieved it; its fee takes precedence over the notice's. */
  readonly statement: StoredPaymentStatement | null;
  readonly fee: PaymentFee;
  readonly refunds: readonly StoredRefund[];
  readonly disputes: readonly StoredDispute[];
}

export type StoredCheckout = Omit<BachsCheckout, "url"> & {
  readonly url?: string;
};
export type AttemptState =
  "prepared" | "creating" | "available" | "uncertain" | "rejected";

export interface StoredAttempt {
  readonly reference: string;
  readonly state: AttemptState;
  readonly checkout: StoredCheckout | null;
}

/**
 * Where a contribution stands. `awaiting_payment`: its checkout is open. `checkout_unresolved`: the checkout request is not
 * sent yet, in flight, or its answer was lost. `unsuccessful`: Bachs refused the checkout, or it expired or was cancelled,
 * with nothing paid; repeating the submission starts a new attempt.
 */
export type ContributionStatus =
  | "awaiting_payment"
  | "checkout_unresolved"
  | "unsuccessful"
  | "confirmed"
  | "needs_review";

/** `request`, `attemptState`, and `checkout` describe the current attempt; `attempts` lists all, oldest first. */
export interface StoredContribution {
  readonly intent: PendingContribution;
  readonly contextSnapshot: SupportContext;
  readonly request: PreparedBachsCheckout;
  readonly attemptState: AttemptState;
  readonly checkout: StoredCheckout | null;
  readonly attempts: readonly StoredAttempt[];
  readonly outcome: "pending" | "confirmed" | "needs_review";
  readonly status: ContributionStatus;
  /** Private application metadata; never part of public status or the provider request. */
  readonly metadata: ContributionMetadata;
  /** When supporter name, message, and metadata were removed, and why; null while they are kept. */
  readonly personalDataRemoved: {
    readonly at: string;
    readonly by: "retention" | "owner" | "supporter";
  } | null;
  readonly payments: readonly StoredPayment[];
  readonly ownerRecords: readonly StoredOwnerRecord[];
}

export interface StoredEvent {
  readonly event: BachsEvent;
  readonly state:
    "pending" | "applied" | "review" | "unsupported" | "dismissed";
  readonly reason: string | null;
  /** Owner's note when the event was dismissed. */
  readonly note: string | null;
}

/** Owner decisions. An external return is the owner's own record, never a provider-confirmed refund. */
export interface StoredOwnerRecord {
  readonly kind: "review_accepted" | "external_return";
  readonly amount: string | null;
  readonly currency: string | null;
  readonly note: string;
  readonly recordedAt: string;
}

/** Facts recorded when a checkout request is sent. Times are milliseconds since the epoch. */
export interface CheckoutDispatch {
  readonly credential: string;
  readonly at: number;
  /** Persisted on first dispatch only; later dispatches must happen before it. */
  readonly retryUntil: number;
  /** While this lease is unexpired, a `creating` attempt is treated as in flight. */
  readonly leaseUntil: number;
}

export interface CheckoutClaim {
  readonly request: PreparedBachsCheckout;
  /** True when an earlier dispatch of the same request may already have been accepted. */
  readonly retry: boolean;
}

export interface StoredContext {
  readonly context: SupportContext;
  readonly revision: number;
}

/** A post-payment effect scheduled when a contribution first becomes confirmed. */
export interface StoredEffect {
  readonly contributionId: string;
  readonly name: string;
  readonly state: "pending" | "running" | "succeeded" | "failed";
  readonly attempts: number;
  /** Milliseconds since the epoch; 0 means due immediately. */
  readonly nextAttemptAt: number;
  readonly lastError: string | null;
}

export interface EffectClaim {
  readonly contributionId: string;
  readonly name: string;
  readonly attempt: number;
}

export type EffectSettlement =
  | { readonly succeeded: true }
  | {
      readonly succeeded: false;
      readonly error: string;
      readonly retryAt: number | null;
    };

/** Counts for an operator view of work needing attention. */
export interface StoreSummary {
  readonly contributions: Readonly<Record<ContributionStatus, number>>;
  readonly events: Readonly<Record<StoredEvent["state"], number>>;
  readonly openDisputes: number;
  /** Per currency, never combined: payments on confirmed contributions minus paid refunds and recorded external returns. */
  readonly confirmedTotals: Readonly<Record<string, string>>;
  /** Per settlement currency: what Bachs credited for payments on confirmed contributions, as reported by Bachs, before refund adjustments. */
  readonly settledTotals: Readonly<Record<string, string>>;
  /** Per fee currency: each confirmed payment's fee from its retrieved statement, otherwise from its notice. */
  readonly feeTotals: Readonly<Record<string, string>>;
  /** Confirmed payments with no fee from either source; a statement reporting no fee counts as known. */
  readonly unknownFeePayments: number;
  /** Payments on confirmed contributions whose notice did not report a settlement, so they are missing from `settledTotals`. */
  readonly unsettledPayments: number;
  readonly effects: Readonly<Record<StoredEffect["state"], number>>;
}

export interface ContributionCursor {
  readonly createdAt: string;
  readonly id: string;
}

/** Trusted server operations over the host's database. None of them authorizes a visitor or owner. */
export interface CheerkitStore {
  readonly organizationId: string;
  readonly environment: BachsEnvironment;
  /** Effect names scheduled on confirmation; must match the service's handlers. */
  readonly effects: readonly string[];
  putContext(
    context: SupportContextInput,
    expectedRevision: number | null,
  ): Promise<StoredContext>;
  /**
   * For contexts defined in code: creates the context, or updates its rules while keeping the owner's
   * `acceptingContributions`. Writes only when something changed.
   */
  syncContext(context: SupportContextInput): Promise<StoredContext>;
  getContext(contextId: string): Promise<StoredContext | null>;
  listContexts(): Promise<readonly StoredContext[]>;
  /**
   * Submission identity covers context, amount, currency, and metadata; repeating a key with different values
   * conflicts. Supporter name and message are not part of it, so no derivative of them is kept.
   */
  reserve(
    intent: PendingContribution,
    request: PreparedBachsCheckout,
    submissionKey: string,
    metadata?: ContributionMetadata,
  ): Promise<StoredContribution>;
  /**
   * Claims a prepared attempt, or re-claims an uncertain/expired-lease attempt dispatched with the same
   * credential before its retry deadline. Resolves to null when the request must not be sent now.
   */
  claimCheckout(
    contributionId: string,
    dispatch: CheckoutDispatch,
  ): Promise<CheckoutClaim | null>;
  /**
   * Adds a prepared attempt when the current one (identified by `previousReference`) was rejected or its
   * checkout expired/cancelled, no payment exists, and current context rules still accept the intent.
   * If another caller already replaced that attempt, resolves to the contribution unchanged.
   */
  openAttempt(
    contributionId: string,
    request: PreparedBachsCheckout,
    previousReference: string,
  ): Promise<StoredContribution>;
  recordCheckout(
    contributionId: string,
    checkout: BachsCheckout,
  ): Promise<void>;
  recordRecoveredCheckout(
    contributionId: string,
    checkout: RecoveredBachsCheckout,
  ): Promise<void>;
  recordCheckoutFailure(
    contributionId: string,
    outcome: "uncertain" | "rejected",
  ): Promise<void>;
  /** Stores only the fields needed for payment facts; payer identity in the delivery is never written. */
  acceptEvent(
    event: BachsEvent,
  ): Promise<"accepted" | "duplicate" | "conflict">;
  processEvent(eventId: string): Promise<StoredEvent>;
  /**
   * Keeps Bachs's current record of a recorded charge, replacing an earlier one. Refused unless it came from the client's own
   * retrieval and its checkout, collected amount, and currency agree with the charge's first collection notice.
   */
  recordPaymentStatement(
    statement: BachsPaymentStatement,
    at: string,
  ): Promise<void>;
  /** Moves a reviewed contribution with at least one recorded payment to confirmed. */
  acceptReview(
    contributionId: string,
    note: string,
    at: string,
  ): Promise<StoredContribution>;
  /** Records money the owner returned outside Bachs; bounded by recorded payments, never shown as a refund. */
  recordExternalReturn(
    contributionId: string,
    amount: string,
    note: string,
    at: string,
  ): Promise<StoredContribution>;
  /** Takes a pending, review, or unsupported event out of processing, e.g. unrelated account activity. */
  dismissEvent(eventId: string, note: string): Promise<StoredEvent>;
  /** Returns a dismissed event to pending processing. */
  reopenEvent(eventId: string): Promise<StoredEvent>;
  /** Interprets an event in review, or dismissed, again under the current rules; a contribution already in review stays there for the owner to accept. */
  recheckEvent(eventId: string): Promise<StoredEvent>;
  summarize(): Promise<StoreSummary>;
  /** Removes supporter name, message, and metadata from one contribution; payment facts stay. */
  removePersonalData(
    contributionId: string,
    by: "owner" | "supporter",
    at: string,
  ): Promise<StoredContribution>;
  /** Removes supporter name, message, and metadata from settled contributions created before `before`. */
  applyRetention(before: string, at: string): Promise<number>;
  /** Claims one due effect (pending and due, or running with an expired lease) and counts the attempt. */
  claimEffect(now: number, leaseUntil: number): Promise<EffectClaim | null>;
  /** Records an attempt's result; ignored if a newer attempt has claimed the effect since. */
  settleEffect(claim: EffectClaim, settlement: EffectSettlement): Promise<void>;
  listEffects(options?: {
    state?: StoredEffect["state"];
    contributionId?: string;
    limit?: number;
  }): Promise<readonly StoredEffect[]>;
  /** Returns a failed effect to pending, due immediately. */
  retryEffect(contributionId: string, name: string): Promise<StoredEffect>;
  getContribution(contributionId: string): Promise<StoredContribution | null>;
  /** UUID submission keys are compared in lower case. */
  getBySubmissionKey(submissionKey: string): Promise<StoredContribution | null>;
  /** Newest first. `before` continues after the last contribution of the previous page. */
  listContributions(options?: {
    contextId?: string;
    before?: ContributionCursor;
    status?: ContributionStatus;
    limit?: number;
  }): Promise<readonly StoredContribution[]>;
  getEvent(eventId: string): Promise<StoredEvent | null>;
  listEvents(options?: {
    state?: StoredEvent["state"];
    contributionId?: string;
    afterId?: string;
    limit?: number;
  }): Promise<readonly StoredEvent[]>;
}
