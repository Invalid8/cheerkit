import type { SupportContextInput } from "../core/context.js";
import { requiredText } from "../core/validation.js";
import type { BachsClient } from "../bachs/client.js";
import { sendCheckout } from "./dispatch.js";
import { SupportServiceError } from "./errors.js";
import {
  CheerkitStoreError,
  type CheerkitStore,
  type ContributionCursor,
  type ContributionStatus,
  type StoredContext,
  type StoredContribution,
  type StoredEffect,
  type StoredEvent,
  type StoreSummary,
} from "./store.js";

/** Everything the installation holds, for the owner's records or a move to other software. */
export interface ExportedData {
  readonly exportedAt: string;
  readonly contexts: readonly StoredContext[];
  readonly contributions: readonly StoredContribution[];
  readonly events: readonly StoredEvent[];
  readonly effects: readonly StoredEffect[];
}

export interface OwnerServiceOptions {
  readonly store: CheerkitStore;
  readonly bachs: BachsClient;
  /** Must resolve to literally `true` for the owner; anything else, including a thrown error, denies. */
  readonly authorizeOwner: (request: Request) => boolean | Promise<boolean>;
  readonly now?: () => number;
}

/** Owner operations. Each checks `authorizeOwner` before touching storage. */
export interface OwnerService {
  recoverCheckout(
    request: Request,
    contributionId: string,
    checkoutId: string,
  ): Promise<StoredContribution>;
  retryCheckout(
    request: Request,
    contributionId: string,
  ): Promise<StoredContribution>;
  /** Asks Bachs to resend the notices of payments missing settlement or fee facts; returns how many charges were asked for. */
  resendNotices(
    request: Request,
    contributionId: string,
  ): Promise<{ readonly requested: number }>;
  /** Retrieves Bachs's current record of each recorded payment and keeps it beside the notice facts. */
  refreshPaymentDetails(
    request: Request,
    contributionId: string,
  ): Promise<StoredContribution>;
  acceptReview(
    request: Request,
    contributionId: string,
    note: string,
  ): Promise<StoredContribution>;
  recordExternalReturn(
    request: Request,
    contributionId: string,
    amount: string,
    note: string,
  ): Promise<StoredContribution>;
  removePersonalData(
    request: Request,
    contributionId: string,
  ): Promise<StoredContribution>;
  exportData(request: Request): Promise<ExportedData>;
  dismissEvent(
    request: Request,
    eventId: string,
    note: string,
  ): Promise<StoredEvent>;
  reopenEvent(request: Request, eventId: string): Promise<StoredEvent>;
  recheckEvent(request: Request, eventId: string): Promise<StoredEvent>;
  summary(request: Request): Promise<StoreSummary>;
  listEffects(
    request: Request,
    options?: {
      state?: StoredEffect["state"];
      contributionId?: string;
      limit?: number;
    },
  ): Promise<readonly StoredEffect[]>;
  retryEffect(
    request: Request,
    contributionId: string,
    name: string,
  ): Promise<StoredEffect>;
  listContributions(
    request: Request,
    options?: {
      contextId?: string;
      before?: ContributionCursor;
      status?: ContributionStatus;
      limit?: number;
    },
  ): Promise<readonly StoredContribution[]>;
  getContribution(
    request: Request,
    contributionId: string,
  ): Promise<StoredContribution | null>;
  listContexts(request: Request): Promise<readonly StoredContext[]>;
  putContext(
    request: Request,
    context: SupportContextInput,
    expectedRevision: number | null,
  ): Promise<StoredContext>;
  listEvents(
    request: Request,
    options?: {
      state?: StoredEvent["state"];
      contributionId?: string;
      afterId?: string;
      limit?: number;
    },
  ): Promise<readonly StoredEvent[]>;
}

/** Owner operations on their own, for an admin that runs apart from the website: no webhook secret, result secret, or return URLs. */
export function createOwnerService(options: OwnerServiceOptions): OwnerService {
  const { store, bachs, authorizeOwner } = options;
  if (
    !store ||
    !bachs ||
    typeof store.organizationId !== "string" ||
    !store.organizationId ||
    bachs.organizationId !== store.organizationId ||
    bachs.environment !== store.environment ||
    typeof authorizeOwner !== "function" ||
    (options.now !== undefined && typeof options.now !== "function")
  ) {
    throw new SupportServiceError(
      "INVALID_CONFIGURATION",
      "Owner dependencies must use the same owner and environment, with valid callbacks.",
    );
  }
  const now = options.now ?? Date.now;
  const clock = (): number => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0)
      throw new SupportServiceError(
        "INVALID_CONFIGURATION",
        "Invalid host clock.",
      );
    return value;
  };
  const nowIso = () => new Date(clock()).toISOString();
  const requireOwner = async (request: Request): Promise<void> => {
    let authorized = false;
    try {
      authorized = (await authorizeOwner(request)) === true;
    } catch {
      /* Authorization failures must not disclose host error details. */
    }
    if (!authorized)
      throw new SupportServiceError(
        "UNAUTHORIZED",
        "Owner access is required.",
      );
  };
  const everything = async <T>(
    page: (after: T | undefined) => Promise<readonly T[]>,
  ): Promise<T[]> => {
    const all: T[] = [];
    for (
      let batch = await page(undefined);
      batch.length;
      batch = await page(batch.at(-1))
    ) {
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all;
  };

  return Object.freeze({
    async recoverCheckout(
      request: Request,
      id: string,
      checkoutId: string,
    ): Promise<StoredContribution> {
      await requireOwner(request);
      const stored = await store.getContribution(requiredText(id, 128));
      if (!stored)
        throw new CheerkitStoreError(
          "NOT_FOUND",
          "Contribution was not found.",
        );
      if (
        stored.attemptState === "prepared" ||
        stored.attemptState === "rejected"
      ) {
        throw new CheerkitStoreError(
          "INVALID_STATE",
          "Only dispatched attempts can recover a checkout association.",
        );
      }
      if (stored.checkout && stored.checkout.id !== checkoutId)
        throw new CheerkitStoreError(
          "CONFLICT",
          "Checkout association already exists.",
        );
      const recovered = await bachs.retrieveCheckout(
        checkoutId,
        stored.request,
      );
      await store.recordRecoveredCheckout(stored.intent.id, recovered);
      return (await store.getContribution(stored.intent.id))!;
    },
    async resendNotices(request: Request, id: string) {
      await requireOwner(request);
      const stored = await store.getContribution(requiredText(id, 128));
      if (!stored)
        throw new CheerkitStoreError(
          "NOT_FOUND",
          "Contribution was not found.",
        );
      const unsettled = stored.payments.filter(
        (payment) =>
          payment.settlement === null || payment.settlement.fee === null,
      );
      for (const payment of unsettled)
        await bachs.resendChargeNotices(payment.chargeId);
      return Object.freeze({ requested: unsettled.length });
    },
    async refreshPaymentDetails(
      request: Request,
      id: string,
    ): Promise<StoredContribution> {
      await requireOwner(request);
      const stored = await store.getContribution(requiredText(id, 128));
      if (!stored)
        throw new CheerkitStoreError(
          "NOT_FOUND",
          "Contribution was not found.",
        );
      for (const payment of stored.payments)
        await store.recordPaymentStatement(
          await bachs.retrievePayment(payment.chargeId),
          nowIso(),
        );
      return (await store.getContribution(stored.intent.id))!;
    },
    async retryCheckout(
      request: Request,
      id: string,
    ): Promise<StoredContribution> {
      await requireOwner(request);
      const contributionId = requiredText(id, 128);
      if (!(await store.getContribution(contributionId)))
        throw new CheerkitStoreError(
          "NOT_FOUND",
          "Contribution was not found.",
        );
      if (!(await sendCheckout(store, bachs, contributionId, clock()))) {
        throw new CheerkitStoreError(
          "INVALID_STATE",
          "This checkout request cannot be safely sent now; recover it by checkout ID.",
        );
      }
      return (await store.getContribution(contributionId))!;
    },
    async acceptReview(request: Request, id: string, note: string) {
      await requireOwner(request);
      return store.acceptReview(id, note, nowIso());
    },
    async recordExternalReturn(
      request: Request,
      id: string,
      amount: string,
      note: string,
    ) {
      await requireOwner(request);
      return store.recordExternalReturn(id, amount, note, nowIso());
    },
    async removePersonalData(request: Request, id: string) {
      await requireOwner(request);
      return store.removePersonalData(requiredText(id, 128), "owner", nowIso());
    },
    async exportData(request: Request): Promise<ExportedData> {
      await requireOwner(request);
      return Object.freeze({
        exportedAt: nowIso(),
        contexts: await store.listContexts(),
        contributions: await everything<StoredContribution>((last) =>
          store.listContributions({
            limit: 100,
            ...(last === undefined
              ? {}
              : {
                  before: {
                    createdAt: last.intent.createdAt,
                    id: last.intent.id,
                  },
                }),
          }),
        ),
        events: await everything<StoredEvent>((last) =>
          store.listEvents({
            limit: 100,
            ...(last === undefined ? {} : { afterId: last.event.id }),
          }),
        ),
        effects: await store.listEffects({ limit: 100 }),
      });
    },
    async dismissEvent(request: Request, eventId: string, note: string) {
      await requireOwner(request);
      return store.dismissEvent(eventId, note);
    },
    async reopenEvent(request: Request, eventId: string) {
      await requireOwner(request);
      return store.reopenEvent(eventId);
    },
    async recheckEvent(request: Request, eventId: string) {
      await requireOwner(request);
      return store.recheckEvent(eventId);
    },
    async summary(request: Request) {
      await requireOwner(request);
      return store.summarize();
    },
    async listEffects(
      request: Request,
      query?: {
        state?: StoredEffect["state"];
        contributionId?: string;
        limit?: number;
      },
    ) {
      await requireOwner(request);
      return store.listEffects(query);
    },
    async retryEffect(request: Request, contributionId: string, name: string) {
      await requireOwner(request);
      return store.retryEffect(contributionId, name);
    },
    async listContributions(
      request: Request,
      query?: {
        contextId?: string;
        before?: ContributionCursor;
        status?: ContributionStatus;
        limit?: number;
      },
    ) {
      await requireOwner(request);
      return store.listContributions(query);
    },
    async getContribution(request: Request, id: string) {
      await requireOwner(request);
      return store.getContribution(id);
    },
    async listContexts(request: Request) {
      await requireOwner(request);
      return store.listContexts();
    },
    async putContext(
      request: Request,
      context: SupportContextInput,
      expectedRevision: number | null,
    ) {
      await requireOwner(request);
      return store.putContext(context, expectedRevision);
    },
    async listEvents(
      request: Request,
      query?: {
        state?: StoredEvent["state"];
        contributionId?: string;
        afterId?: string;
        limit?: number;
      },
    ) {
      await requireOwner(request);
      return store.listEvents(query);
    },
  });
}
