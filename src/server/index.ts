import { amountUnits } from "../core/amount.js";
import { createContributionIntent } from "../core/contribution.js";
import { validateMetadata } from "../core/metadata.js";
import { requiredText } from "../core/validation.js";
import type { SupportContext } from "../core/context.js";
import type { BachsCheckoutClient } from "../bachs/checkout.js";
import type {
  BachsSignatureHeaders,
  BachsWebhookVerifier,
} from "../bachs/webhook.js";
import { SupportServiceError } from "./errors.js";
import { sendCheckout } from "./dispatch.js";
import { createOwnerService, type OwnerService } from "./owner.js";
import {
  CheerkitStoreError,
  type CheerkitStore,
  type StoredContribution,
  type StoredEvent,
} from "./store.js";

export { CheerkitStoreError } from "./store.js";
export { openStore, type StoreOptions } from "../store/index.js";
export {
  cheerkitMigrations,
  CHEERKIT_SCHEMA_VERSION,
  type CheerkitMigration,
  type SchemaOptions,
} from "../store/schema.js";
export type { CheerkitDatabase, SqlExecutor, Row } from "../store/database.js";
export type {
  AttemptState,
  CheerkitStore,
  ContributionStatus,
  PaymentFee,
  ContributionCursor,
  CheckoutClaim,
  CheckoutDispatch,
  StoredAttempt,
  StoredContribution,
  StoredContext,
  StoredDispute,
  StoredEvent,
  StoredOwnerRecord,
  StoreSummary,
  StoredEffect,
  EffectClaim,
  EffectSettlement,
  StoredPayment,
  StoredPaymentStatement,
  StoredRefund,
  StoredCheckout,
  StoreErrorCode,
} from "./store.js";
export type { DisputeStatus, RefundStatus } from "../bachs/outcomes.js";

export { SupportServiceError } from "./errors.js";
export {
  createOwnerService,
  type ExportedData,
  type OwnerService,
  type OwnerServiceOptions,
} from "./owner.js";
export {
  createOwnerHandler,
  createSupportHandler,
  type OwnerHandlerOptions,
  type SupportHandler,
  type SupportHandlerOptions,
} from "./http.js";
export {
  runPendingPass,
  startPendingWorker,
  type PendingPassOptions,
  type PendingPassResult,
  type PendingWorkerOptions,
  type WorkerPassResult,
} from "./worker.js";

export interface PublicContribution {
  readonly contributionId: string;
  readonly contextId: string;
  readonly outcome:
    "pending" | "confirmed" | "refunded" | "needs_review" | "unsuccessful";
  readonly amount: string;
  readonly currency: string;
  readonly checkoutUrl?: string;
}

/** What a custom support UI needs to render a context; excludes the internal tracking name. */
export interface PublicContext {
  readonly contextId: string;
  readonly acceptingContributions: boolean;
  readonly currencies: SupportContext["currencies"];
  readonly collectName: boolean;
  readonly collectMessage: boolean;
  /** Who pays Bachs processing fees: the owner, the supporter (shown at checkout), or the account's default. */
  readonly fees: "owner" | "supporter" | "account_default";
}

export interface ContributionAccess {
  readonly contribution: PublicContribution;
  readonly resultToken: string;
  readonly expiresAt: string;
}

/** Delivered at least once per effect; use `id` to make external side effects idempotent. */
export interface PostPaymentEffect {
  readonly id: string;
  readonly name: string;
  readonly attempt: number;
  readonly contribution: StoredContribution;
}

export interface EffectOptions {
  /** One handler per name in the store's `effects`. A thrown error schedules a retry; it never changes the payment. */
  readonly handlers: Readonly<
    Record<string, (effect: PostPaymentEffect) => Promise<void>>
  >;
  readonly maxAttempts: number;
  /** Delay before the second attempt; it doubles for each later attempt. */
  readonly retryDelayMs: number;
  /** How long an attempt may run before another worker may claim it again. */
  readonly leaseMs: number;
}

/** What a supporter can see about their own contribution with its result link. */
export interface OwnContributionData {
  readonly contribution: PublicContribution;
  readonly supporterName?: string;
  readonly message?: string;
  readonly personalDataRemoved: StoredContribution["personalDataRemoved"];
}

export interface RetentionOptions {
  /** Days after which a settled contribution's name, message, and metadata are removed (1–3650). */
  readonly supporterDataDays: number;
  /** Calendar years after which settled financial records are deleted. Dedupe tombstones remain. Omit to retain records indefinitely. */
  readonly paymentRecordYears?: number;
}

export interface SupportServiceOptions {
  readonly store: CheerkitStore;
  readonly checkout: BachsCheckoutClient;
  readonly webhooks: BachsWebhookVerifier;
  readonly resultSecret: string;
  readonly resultLifetimeSeconds?: number;
  readonly authorizeOwner?: (request: Request) => boolean | Promise<boolean>;
  readonly now?: () => number;
  readonly effects?: EffectOptions;
  /** How long supporter-provided data is kept; the worker applies it on every pass. */
  readonly retention: RetentionOptions;
}

export interface SupportService {
  /** `metadata` is private application context; it must not contain personal data. */
  startContribution(
    contextId: string,
    submission: unknown,
    submissionKey: string,
    metadata?: unknown,
  ): Promise<ContributionAccess>;
  /** Continues an earlier submission from its key alone, so a browser never has to keep the message for a retry. */
  resumeContribution(submissionKey: string): Promise<ContributionAccess>;
  getStatus(
    contributionId: string,
    resultToken: string,
  ): Promise<PublicContribution | null>;
  /** The supporter's own name and message, with the result link as proof. */
  getOwnData(
    contributionId: string,
    resultToken: string,
  ): Promise<OwnContributionData | null>;
  /** Lets the supporter remove their own name, message, and metadata; payment facts stay. */
  removeOwnData(
    contributionId: string,
    resultToken: string,
  ): Promise<OwnContributionData | null>;
  getPublicContext(contextId: string): Promise<PublicContext | null>;
  acceptWebhook(
    rawBody: Uint8Array,
    headers: BachsSignatureHeaders,
  ): Promise<{
    receipt: "accepted" | "duplicate" | "conflict" | "retired";
    processing: StoredEvent["state"] | "expired";
  }>;
  processPending(options?: {
    afterId?: string;
    limit?: number;
  }): Promise<readonly StoredEvent[]>;
  /** Removes supporter data older than the retention period; returns how many contributions changed. */
  applyRetention(): Promise<number>;
  /** Runs up to `limit` due post-payment effects in sequence. */
  runEffects(options: { limit: number }): Promise<{
    readonly succeeded: number;
    readonly retrying: number;
    readonly failed: number;
  }>;
  readonly owner: OwnerService;
}

function fullyRefunded(stored: StoredContribution): boolean {
  return (
    stored.payments.length > 0 &&
    stored.payments.every(
      (payment) =>
        payment.refunds
          .filter((refund) => refund.status === "paid")
          .reduce(
            (total, refund) => total + amountUnits(refund.refundedAmount),
            0n,
          ) === amountUnits(payment.amount),
    )
  );
}

function subtractUtcYears(date: Date, years: number): Date {
  const result = new Date(date);
  const month = result.getUTCMonth();
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCFullYear(result.getUTCFullYear() - years);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), month + 1, 0),
  ).getUTCDate();
  result.setUTCMonth(month, Math.min(day, lastDay));
  return result;
}

function publicStatus(
  stored: StoredContribution,
  now: number,
): PublicContribution {
  const { status } = stored;
  const outcome =
    status === "confirmed" && fullyRefunded(stored)
      ? "refunded"
      : status === "awaiting_payment" || status === "checkout_unresolved"
        ? "pending"
        : status;
  return Object.freeze({
    contributionId: stored.intent.id,
    contextId: stored.intent.contextId,
    outcome,
    amount: stored.intent.amount,
    currency: stored.intent.currency,
    ...(outcome === "pending" &&
    stored.checkout?.url !== undefined &&
    stored.checkout.status === "open" &&
    Date.parse(stored.checkout.expiresAt) > now
      ? { checkoutUrl: stored.checkout.url }
      : {}),
  });
}

export function createSupportService(
  options: SupportServiceOptions,
): SupportService {
  if (
    typeof options.resultSecret !== "string" ||
    options.resultSecret.length < 32 ||
    options.resultSecret.length > 1024
  ) {
    throw new SupportServiceError(
      "INVALID_CONFIGURATION",
      "Use a private random result-signing secret of at least 32 characters.",
    );
  }
  const lifetime = options.resultLifetimeSeconds ?? 30 * 24 * 60 * 60;
  if (
    !Number.isSafeInteger(lifetime) ||
    lifetime < 60 ||
    lifetime > 365 * 24 * 60 * 60
  ) {
    throw new SupportServiceError(
      "INVALID_CONFIGURATION",
      "Result lifetime must be between one minute and one year.",
    );
  }
  const { store, checkout, webhooks, authorizeOwner } = options;
  if (
    !store ||
    !checkout ||
    !webhooks ||
    typeof store.organizationId !== "string" ||
    !store.organizationId ||
    !["sandbox", "live"].includes(store.environment) ||
    checkout.organizationId !== store.organizationId ||
    webhooks.organizationId !== store.organizationId ||
    checkout.environment !== store.environment ||
    webhooks.environment !== store.environment ||
    (authorizeOwner !== undefined && typeof authorizeOwner !== "function") ||
    (options.now !== undefined && typeof options.now !== "function")
  ) {
    throw new SupportServiceError(
      "INVALID_CONFIGURATION",
      "Service dependencies must use the same owner and environment, with valid callbacks.",
    );
  }
  const effectOptions = options.effects;
  if (effectOptions !== undefined) {
    const names = Object.keys(effectOptions.handlers ?? {});
    if (
      names.length !== store.effects.length ||
      names.some(
        (name) =>
          !store.effects.includes(name) ||
          typeof effectOptions.handlers[name] !== "function",
      ) ||
      !Number.isSafeInteger(effectOptions.maxAttempts) ||
      effectOptions.maxAttempts < 1 ||
      effectOptions.maxAttempts > 20 ||
      !Number.isSafeInteger(effectOptions.retryDelayMs) ||
      effectOptions.retryDelayMs < 1000 ||
      !Number.isSafeInteger(effectOptions.leaseMs) ||
      effectOptions.leaseMs < 1000
    ) {
      throw new SupportServiceError(
        "INVALID_CONFIGURATION",
        "Effect handlers must match the store's effects, with valid retry settings.",
      );
    }
  } else if (store.effects.length) {
    throw new SupportServiceError(
      "INVALID_CONFIGURATION",
      "The store schedules effects but no handlers were configured.",
    );
  }
  const retentionDays = options.retention?.supporterDataDays;
  const paymentRecordYears = options.retention?.paymentRecordYears;
  if (
    typeof retentionDays !== "number" ||
    !Number.isSafeInteger(retentionDays) ||
    retentionDays < 1 ||
    retentionDays > 3650
  ) {
    throw new SupportServiceError(
      "INVALID_CONFIGURATION",
      "Set retention.supporterDataDays to a whole number of days from 1 to 3650.",
    );
  }
  if (
    paymentRecordYears !== undefined &&
    (!Number.isSafeInteger(paymentRecordYears) ||
      paymentRecordYears < 1 ||
      paymentRecordYears > 50)
  ) {
    throw new SupportServiceError(
      "INVALID_CONFIGURATION",
      "Set retention.paymentRecordYears to a whole number from 1 to 50.",
    );
  }
  const now = options.now ?? Date.now;
  const encoder = new TextEncoder();
  const resultKey = crypto.subtle.importKey(
    "raw",
    encoder.encode(options.resultSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const clock = (): number => {
    const value = now();
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > 8_640_000_000_000_000 - lifetime * 1000
    )
      throw new SupportServiceError(
        "INVALID_CONFIGURATION",
        "Invalid host clock.",
      );
    return value;
  };
  clock();
  const access = async (
    stored: StoredContribution,
  ): Promise<ContributionAccess> => {
    const expires = Math.floor(clock() / 1000) + lifetime;
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await resultKey,
        encoder.encode(`${stored.intent.id}.${expires}`),
      ),
    );
    const encoded = btoa(String.fromCharCode(...signature))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    return Object.freeze({
      contribution: publicStatus(stored, clock()),
      resultToken: `${expires}.${encoded}`,
      expiresAt: new Date(expires * 1000).toISOString(),
    });
  };

  const verified = async (
    id: unknown,
    token: unknown,
  ): Promise<StoredContribution | null> => {
    if (
      typeof id !== "string" ||
      !id.length ||
      id.length > 128 ||
      typeof token !== "string" ||
      token.length > 64
    )
      return null;
    const match = /^([0-9]{1,13})\.([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/.exec(
      token,
    );
    if (!match || Number(match[1]) <= Math.floor(clock() / 1000)) return null;
    const binary = atob(
      match[2]!.replaceAll("-", "+").replaceAll("_", "/") + "=",
    );
    const signature = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        await resultKey,
        signature,
        encoder.encode(`${id}.${match[1]}`),
      ))
    )
      return null;
    return store.getContribution(id);
  };
  const ownData = (stored: StoredContribution): OwnContributionData =>
    Object.freeze({
      contribution: publicStatus(stored, clock()),
      ...(stored.intent.supporterName === undefined
        ? {}
        : { supporterName: stored.intent.supporterName }),
      ...(stored.intent.message === undefined
        ? {}
        : { message: stored.intent.message }),
      personalDataRemoved: stored.personalDataRemoved,
    });
  const submissionKeyOf = (value: unknown): string => {
    if (
      typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    ) {
      throw new SupportServiceError(
        "INVALID_REQUEST",
        "Use a fresh random UUID for the submission key and retain it for retries.",
      );
    }
    return value.toLowerCase();
  };
  const nowIso = () => new Date(clock()).toISOString();

  const proceed = async (
    reserved: StoredContribution,
  ): Promise<ContributionAccess> => {
    let current = reserved;
    if (current.status === "unsuccessful" && !current.payments.length) {
      const next = `ck_${crypto.randomUUID()}`;
      current = await store.openAttempt(
        current.intent.id,
        checkout.prepareCheckout(current.intent, {
          reference: next,
          idempotencyKey: next,
        }),
        current.request.reference,
      );
    }
    await sendCheckout(store, checkout, current.intent.id, clock());
    return access((await store.getContribution(current.intent.id))!);
  };

  return Object.freeze({
    async startContribution(
      contextId: string,
      submission: unknown,
      submissionKey: string,
      metadata?: unknown,
    ): Promise<ContributionAccess> {
      const id = requiredText(contextId, 128);
      const extra = validateMetadata(metadata);
      const key = submissionKeyOf(submissionKey);
      const existing = await store.getBySubmissionKey(key);
      if (existing && existing.intent.contextId !== id)
        throw new CheerkitStoreError(
          "CONFLICT",
          "Submission identity belongs to another context.",
        );
      const context =
        existing?.contextSnapshot ?? (await store.getContext(id))?.context;
      if (!context)
        throw new CheerkitStoreError(
          "NOT_FOUND",
          "Support context was not found.",
        );
      const intent = createContributionIntent(context, submission, {
        id: crypto.randomUUID(),
        createdAt: nowIso(),
      });
      const reference = `ck_${crypto.randomUUID()}`;
      const prepared = checkout.prepareCheckout(intent, {
        reference,
        idempotencyKey: reference,
      });
      return proceed(await store.reserve(intent, prepared, key, extra));
    },
    async resumeContribution(
      submissionKey: string,
    ): Promise<ContributionAccess> {
      const existing = await store.getBySubmissionKey(
        submissionKeyOf(submissionKey),
      );
      if (!existing)
        throw new CheerkitStoreError(
          "NOT_FOUND",
          "No contribution was started with this key.",
        );
      return proceed(existing);
    },
    async getPublicContext(contextId: string): Promise<PublicContext | null> {
      if (typeof contextId !== "string" || !contextId || contextId.length > 128)
        return null;
      const stored = await store.getContext(contextId);
      if (!stored) return null;
      const { context } = stored;
      return Object.freeze({
        contextId: context.id,
        acceptingContributions: context.acceptingContributions,
        currencies: context.currencies,
        collectName: context.collectName,
        collectMessage: context.collectMessage,
        fees:
          checkout.feeBearer === "merchant"
            ? "owner"
            : checkout.feeBearer === "customer"
              ? "supporter"
              : "account_default",
      });
    },
    async getStatus(
      id: string,
      token: string,
    ): Promise<PublicContribution | null> {
      const stored = await verified(id, token);
      return stored ? publicStatus(stored, clock()) : null;
    },
    async getOwnData(
      id: string,
      token: string,
    ): Promise<OwnContributionData | null> {
      const stored = await verified(id, token);
      return stored ? ownData(stored) : null;
    },
    async removeOwnData(
      id: string,
      token: string,
    ): Promise<OwnContributionData | null> {
      const stored = await verified(id, token);
      return stored
        ? ownData(
            await store.removePersonalData(
              stored.intent.id,
              "supporter",
              nowIso(),
            ),
          )
        : null;
    },
    async acceptWebhook(rawBody: Uint8Array, headers: BachsSignatureHeaders) {
      const event = await webhooks.verify(rawBody, headers);
      const receipt = await store.acceptEvent(event);
      if (receipt === "retired")
        return Object.freeze({ receipt, processing: "expired" as const });
      const result = await store.processEvent(event.id);
      return Object.freeze({ receipt, processing: result.state });
    },
    applyRetention(): Promise<number> {
      const now = new Date(clock());
      const personalBefore = new Date(
        now.getTime() - retentionDays * 86_400_000,
      ).toISOString();
      const recordsBefore =
        paymentRecordYears === undefined
          ? undefined
          : subtractUtcYears(now, paymentRecordYears).toISOString();
      return store.applyRetention(personalBefore, nowIso(), recordsBefore);
    },
    async runEffects({ limit }: { limit: number }) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new SupportServiceError(
          "INVALID_REQUEST",
          "Effect limit must be 1–100.",
        );
      const totals = { succeeded: 0, retrying: 0, failed: 0 };
      if (!effectOptions) return totals;
      for (let index = 0; index < limit; index++) {
        const at = clock();
        const claim = await store.claimEffect(at, at + effectOptions.leaseMs);
        if (!claim) break;
        const contribution = (await store.getContribution(
          claim.contributionId,
        ))!;
        try {
          await effectOptions.handlers[claim.name]!({
            id: `${claim.contributionId}:${claim.name}`,
            name: claim.name,
            attempt: claim.attempt,
            contribution,
          });
          await store.settleEffect(claim, { succeeded: true });
          totals.succeeded++;
        } catch (error) {
          const code =
            typeof (error as { code?: unknown })?.code === "string"
              ? (error as { code: string }).code
              : error instanceof Error
                ? error.name
                : "Error";
          const retryAt =
            claim.attempt >= effectOptions.maxAttempts
              ? null
              : clock() + effectOptions.retryDelayMs * 2 ** (claim.attempt - 1);
          await store.settleEffect(claim, {
            succeeded: false,
            error: /^[A-Za-z0-9_.:-]{1,64}$/.test(code) ? code : "Error",
            retryAt,
          });
          if (retryAt === null) totals.failed++;
          else totals.retrying++;
        }
      }
      return totals;
    },
    async processPending({
      afterId,
      limit,
    }: { afterId?: string; limit?: number } = {}): Promise<
      readonly StoredEvent[]
    > {
      const events = await store.listEvents({
        state: "pending",
        ...(afterId === undefined ? {} : { afterId }),
        ...(limit === undefined ? {} : { limit }),
      });
      const processed: StoredEvent[] = [];
      for (const { event } of events)
        processed.push(await store.processEvent(event.id));
      return processed;
    },
    owner: createOwnerService({
      store,
      bachs: checkout,
      authorizeOwner: authorizeOwner ?? (() => false),
      now: clock,
    }),
  });
}
