import { createHash, randomUUID } from "node:crypto";
import {
  amountUnits,
  normalizeAmount,
  normalizeNonNegativeAmount,
} from "../core/amount.js";
import {
  createContributionIntent,
  type PendingContribution,
} from "../core/contribution.js";
import {
  defineSupportContext,
  type SupportContextInput,
} from "../core/context.js";
import { CheerkitError } from "../core/errors.js";
import {
  validateMetadata,
  type ContributionMetadata,
} from "../core/metadata.js";
import { requiredText } from "../core/validation.js";
import { isAuthenticated } from "../bachs/authenticated.js";
import type { BachsCheckout, BachsEnvironment } from "../bachs/client.js";
import {
  validatePreparedCheckout,
  type PreparedBachsCheckout,
} from "../bachs/request.js";
import {
  assessAcceptedCollection,
  checkoutPaidAsIntended,
} from "../bachs/collection.js";
import { BachsError } from "../bachs/errors.js";
import {
  minimizedEvent,
  readEventFacts,
  readSettlementFacts,
  type BachsEventFacts,
  type BachsSettlementFacts,
  type DisputeStatus,
  type RefundStatus,
} from "../bachs/outcomes.js";
import {
  isPaymentStatement,
  type BachsPaymentStatement,
} from "../bachs/payments.js";
import {
  isRecoveredCheckout,
  type RecoveredBachsCheckout,
} from "../bachs/recovery.js";
import {
  httpsUrl,
  identifier,
  keys,
  object,
  text,
  timestamp,
} from "../bachs/validation.js";
import type { BachsEvent } from "../bachs/webhook.js";
import {
  CheerkitStoreError,
  type CheckoutClaim,
  type CheckoutDispatch,
  type CheerkitStore,
  type ContributionCursor,
  type ContributionStatus,
  type EffectClaim,
  type EffectSettlement,
  type StoredCheckout,
  type StoredContext,
  type StoredContribution,
  type StoredEffect,
  type StoredEvent,
  type PaymentFee,
  type StoredOwnerRecord,
  type StoredPaymentStatement,
  type StoreSummary,
} from "../server/store.js";
import { fieldCipher } from "./cipher.js";
import type { CheerkitDatabase, Row, SqlExecutor } from "./database.js";
import { CHEERKIT_SCHEMA_VERSION, tablePrefix } from "./schema.js";

export interface StoreOptions {
  /** The host's database, through `postgresDatabase` or `sqliteDatabase`. */
  readonly database: CheerkitDatabase;
  readonly installationId: string;
  readonly organizationId: string;
  readonly environment: BachsEnvironment;
  /** Must match the prefix the migrations were generated with. Defaults to `cheerkit_`. */
  readonly prefix?: string;
  /** Post-payment effect names to schedule on confirmation, such as `["thank-you"]`. */
  readonly effects?: readonly string[];
  /** Optional 32-byte base64url key; supporter name, message, and metadata are then stored encrypted. */
  readonly encryptionKey?: string;
}

type Interpretation =
  | { readonly state: "pending"; readonly reason: string }
  | {
      readonly state: "applied" | "review" | "unsupported";
      readonly reason: string | null;
      readonly contributionId: string | null;
      readonly confirm?: boolean;
    };

const hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const decode = <T>(value: unknown): T => JSON.parse(String(value)) as T;
const conflict = (): never => {
  throw new CheerkitStoreError(
    "CONFLICT",
    "Stored identity conflicts with this operation.",
  );
};
const closedStatuses: readonly string[] = ["expired", "cancelled"];
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validatedIntent(intent: PendingContribution): PendingContribution {
  const input = object(intent, "INVALID_CHECKOUT");
  keys(
    input,
    [
      "id",
      "contextId",
      "amount",
      "currency",
      "fractionDigits",
      "status",
      "createdAt",
      "supporterName",
      "message",
    ],
    "INVALID_CHECKOUT",
  );
  if (
    input.status !== "pending" ||
    typeof input.currency !== "string" ||
    !/^[A-Z]{3}$/.test(input.currency)
  ) {
    throw new BachsError("INVALID_CHECKOUT", "Invalid pending contribution.");
  }
  return Object.freeze({
    id: text(input.id, 128, "INVALID_CHECKOUT"),
    contextId: text(input.contextId, 128, "INVALID_CHECKOUT"),
    amount: normalizeAmount(input.amount, input.fractionDigits as number),
    currency: input.currency,
    fractionDigits: input.fractionDigits as number,
    status: "pending",
    createdAt: timestamp(input.createdAt, "INVALID_CHECKOUT"),
    ...(input.supporterName === undefined
      ? {}
      : { supporterName: text(input.supporterName, 120, "INVALID_CHECKOUT") }),
    ...(input.message === undefined
      ? {}
      : { message: text(input.message, 2000, "INVALID_CHECKOUT") }),
  });
}

function sameDecimal(value: unknown, expected: string): boolean {
  if (typeof value !== "string") return false;
  const digits = Math.max(
    value.split(".")[1]?.length ?? 0,
    expected.split(".")[1]?.length ?? 0,
  );
  try {
    return (
      amountUnits(normalizeNonNegativeAmount(value, digits)) ===
      amountUnits(normalizeNonNegativeAmount(expected, digits))
    );
  } catch {
    return false;
  }
}

function paymentFee(
  settlement: BachsSettlementFacts | undefined,
  statement: StoredPaymentStatement | undefined,
): PaymentFee {
  if (statement)
    return statement.fee
      ? { state: "charged", ...statement.fee, bearer: statement.feeBearer }
      : { state: "none" };
  if (settlement?.fee != null && settlement.feeCurrency !== null) {
    return {
      state: "charged",
      amount: settlement.fee,
      currency: settlement.feeCurrency,
      bearer: settlement.feeBearer,
    };
  }
  return { state: "unreported" };
}

const contributionStatuses: readonly string[] = [
  "awaiting_payment",
  "checkout_unresolved",
  "unsuccessful",
  "confirmed",
  "needs_review",
];

function contributionStatus(
  outcome: unknown,
  attemptState: unknown,
  checkout: unknown,
): ContributionStatus {
  if (outcome === "confirmed" || outcome === "needs_review") return outcome;
  const stored = checkout === null ? null : decode<StoredCheckout>(checkout);
  if (
    attemptState === "rejected" ||
    (stored !== null && closedStatuses.includes(stored.status))
  )
    return "unsuccessful";
  return attemptState === "available"
    ? "awaiting_payment"
    : "checkout_unresolved";
}

/**
 * Connects Cheerkit to tables the host created from `cheerkitMigrations`. The first open binds the tables to this
 * installation, organization, and environment; later opens with different values are refused.
 */
export async function openStore(options: StoreOptions): Promise<CheerkitStore> {
  const config = object(options, "INVALID_CONFIGURATION");
  keys(
    config,
    [
      "database",
      "installationId",
      "organizationId",
      "environment",
      "prefix",
      "effects",
      "encryptionKey",
    ],
    "INVALID_CONFIGURATION",
  );
  const database = options.database;
  if (
    !database ||
    typeof database.transaction !== "function" ||
    typeof database.query !== "function"
  ) {
    throw new BachsError(
      "INVALID_CONFIGURATION",
      "Pass the host database through postgresDatabase or sqliteDatabase.",
    );
  }
  const effects = config.effects ?? [];
  if (
    !Array.isArray(effects) ||
    effects.length > 10 ||
    new Set(effects).size !== effects.length ||
    effects.some(
      (name) =>
        typeof name !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(name),
    )
  ) {
    throw new BachsError(
      "INVALID_CONFIGURATION",
      "Effect names must be up to ten distinct short lower-case identifiers.",
    );
  }
  const effectNames: readonly string[] = Object.freeze([
    ...effects,
  ] as string[]);
  const installation = identifier(
    config.installationId,
    "INVALID_CONFIGURATION",
  );
  const organization = identifier(
    config.organizationId,
    "INVALID_CONFIGURATION",
  );
  if (config.environment !== "sandbox" && config.environment !== "live")
    throw new BachsError("INVALID_CONFIGURATION", "Invalid environment.");
  const environment: BachsEnvironment = config.environment;
  const p = tablePrefix(config.prefix ?? "cheerkit_");
  const cipher = fieldCipher(config.encryptionKey);
  const lockKey = `${p}${installation}`;

  const transaction = async <T>(
    work: (tx: SqlExecutor) => Promise<T>,
  ): Promise<T> => {
    try {
      return await database.transaction(lockKey, work);
    } catch (error) {
      if (
        error instanceof CheerkitStoreError ||
        error instanceof BachsError ||
        error instanceof CheerkitError
      )
        throw error;
      throw new CheerkitStoreError(
        "STORAGE_FAILURE",
        "The storage operation did not complete.",
      );
    }
  };
  const one = async (
    tx: SqlExecutor,
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<Row | undefined> => (await tx.query(sql, params))[0];

  await transaction(async (tx) => {
    let meta: Row | undefined;
    try {
      meta = await one(tx, `SELECT * FROM ${p}meta WHERE singleton = 1`);
    } catch {
      throw new CheerkitStoreError(
        "INVALID_STATE",
        `Apply the Cheerkit migrations (tables prefixed "${p}") before opening the store.`,
      );
    }
    if (!meta || Number(meta.version) !== CHEERKIT_SCHEMA_VERSION) {
      throw new CheerkitStoreError(
        "INVALID_STATE",
        `Cheerkit expects schema version ${CHEERKIT_SCHEMA_VERSION}; apply the matching migrations.`,
      );
    }
    if (meta.installation === null) {
      await tx.query(
        `UPDATE ${p}meta SET installation = ?, organization = ?, environment = ? WHERE singleton = 1`,
        [installation, organization, environment],
      );
    } else if (
      meta.installation !== installation ||
      meta.organization !== organization ||
      meta.environment !== environment
    ) {
      conflict();
    }
  });

  const currentAttempt = `a.sequence = (SELECT max(sequence) FROM ${p}attempts WHERE contribution_id = c.id)`;
  const contributionRow = (tx: SqlExecutor, id: string) =>
    one(
      tx,
      `SELECT c.*, a.request, a.state AS attempt_state, a.checkout,
    a.checkout_id, a.reference, a.sequence, a.credential, a.retry_until, a.lease_until
    FROM ${p}contributions c JOIN ${p}attempts a ON a.contribution_id = c.id AND ${currentAttempt} WHERE c.id = ?`,
      [id],
    );
  const requiredRow = async (tx: SqlExecutor, id: string): Promise<Row> => {
    const row = await contributionRow(tx, id);
    if (!row)
      throw new CheerkitStoreError("NOT_FOUND", "Contribution was not found.");
    return row;
  };

  // Supporter fields are decrypted only after the transaction ends, so a transaction never waits on anything but the database.
  interface Sealed {
    readonly contribution: StoredContribution;
    readonly name: unknown;
    readonly message: unknown;
    readonly metadata: unknown;
  }
  async function reveal({
    contribution,
    name,
    message,
    metadata,
  }: Sealed): Promise<StoredContribution> {
    const supporterName = await cipher.open(name);
    const text = await cipher.open(message);
    const extra = await cipher.open(metadata);
    return {
      ...contribution,
      intent: {
        ...contribution.intent,
        ...(supporterName === null ? {} : { supporterName }),
        ...(text === null ? {} : { message: text }),
      },
      metadata: Object.freeze(
        extra === null ? {} : decode<ContributionMetadata>(extra),
      ),
    };
  }
  const revealed = async <T extends Sealed | null>(
    work: (tx: SqlExecutor) => Promise<T>,
  ) => {
    const sealed = await transaction(work);
    return (sealed === null ? null : await reveal(sealed)) as T extends null
      ? StoredContribution | null
      : StoredContribution;
  };

  async function snapshot(tx: SqlExecutor, row: Row): Promise<Sealed> {
    const id = String(row.id);
    const payments = await tx.query(
      `SELECT * FROM ${p}payments WHERE contribution_id = ? ORDER BY charge_id`,
      [id],
    );
    const settlements = await settlementsByCharge(tx, [id]);
    const statements = await statementsByCharge(tx, [id]);
    const attempts = await tx.query(
      `SELECT reference, state, checkout FROM ${p}attempts WHERE contribution_id = ? ORDER BY sequence`,
      [id],
    );
    const records = await tx.query(
      `SELECT * FROM ${p}owner_records WHERE contribution_id = ? ORDER BY sequence`,
      [id],
    );
    const contribution: StoredContribution = {
      intent: decode<PendingContribution>(row.intent),
      request: decode(row.request),
      contextSnapshot: defineSupportContext(decode(row.context_snapshot)),
      attemptState: row.attempt_state as StoredContribution["attemptState"],
      checkout: row.checkout === null ? null : decode(row.checkout),
      attempts: attempts.map((attempt) => ({
        reference: String(attempt.reference),
        state: attempt.state as StoredContribution["attemptState"],
        checkout: attempt.checkout === null ? null : decode(attempt.checkout),
      })),
      outcome: row.outcome as StoredContribution["outcome"],
      status: contributionStatus(row.outcome, row.attempt_state, row.checkout),
      metadata: Object.freeze({}),
      personalDataRemoved:
        row.personal_data_removed_at === null
          ? null
          : {
              at: String(row.personal_data_removed_at),
              by: row.personal_data_removed_by as
                "retention" | "owner" | "supporter",
            },
      payments: await Promise.all(
        payments.map(async (payment) => ({
          chargeId: String(payment.charge_id),
          amount: String(payment.amount),
          currency: String(payment.currency),
          checkoutId: String(payment.checkout_id),
          settlement: settlements.get(String(payment.charge_id)) ?? null,
          statement: statements.get(String(payment.charge_id)) ?? null,
          fee: paymentFee(
            settlements.get(String(payment.charge_id)),
            statements.get(String(payment.charge_id)),
          ),
          refunds: (
            await tx.query(
              `SELECT * FROM ${p}refunds WHERE charge_id = ? ORDER BY refund_id`,
              [String(payment.charge_id)],
            )
          ).map((refund) => ({
            refundId: String(refund.refund_id),
            status: refund.status as RefundStatus,
            requestedAmount: String(refund.requested_amount),
            refundedAmount: String(refund.refunded_amount),
          })),
          disputes: (
            await tx.query(
              `SELECT * FROM ${p}disputes WHERE charge_id = ? ORDER BY dispute_id`,
              [String(payment.charge_id)],
            )
          ).map((dispute) => ({
            disputeId: String(dispute.dispute_id),
            status: dispute.status as DisputeStatus,
            amount: String(dispute.amount),
            currency: String(dispute.currency),
            updatedAt: dispute.updated_at as string | null,
          })),
        })),
      ),
      ownerRecords: records.map((record) => ({
        kind: record.kind as StoredOwnerRecord["kind"],
        amount: record.amount as string | null,
        currency: record.currency as string | null,
        note: String(record.note),
        recordedAt: String(record.recorded_at),
      })),
    };
    return {
      contribution,
      name: row.supporter_name,
      message: row.message,
      metadata: row.metadata,
    };
  }
  const eventSnapshot = (row: Row): StoredEvent => ({
    event: decode(row.payload),
    state: row.state as StoredEvent["state"],
    reason: row.reason as string | null,
    note: row.note as string | null,
  });
  const effectSnapshot = (row: Row): StoredEffect => ({
    contributionId: String(row.contribution_id),
    name: String(row.name),
    state: row.state as StoredEffect["state"],
    attempts: Number(row.attempts),
    nextAttemptAt: Number(row.next_attempt_at),
    lastError: row.last_error as string | null,
  });

  async function checkCurrentRules(
    tx: SqlExecutor,
    intent: PendingContribution,
  ): Promise<string> {
    const stored = await one(
      tx,
      `SELECT context FROM ${p}contexts WHERE id = ?`,
      [intent.contextId],
    );
    if (!stored)
      throw new CheerkitStoreError(
        "NOT_FOUND",
        "Support context was not found.",
      );
    createContributionIntent(
      defineSupportContext(decode(stored.context)),
      {
        amount: intent.amount,
        currency: intent.currency,
        ...(intent.supporterName === undefined
          ? {}
          : { supporterName: intent.supporterName }),
        ...(intent.message === undefined ? {} : { message: intent.message }),
      },
      { id: intent.id, createdAt: intent.createdAt },
    );
    return String(stored.context);
  }
  function checkRequest(
    request: PreparedBachsCheckout,
    intent: PendingContribution,
  ): PreparedBachsCheckout {
    const prepared = validatePreparedCheckout(request);
    if (prepared.environment !== environment) conflict();
    const pricing = decode<{ pricing: { amount: string; currency: string } }>(
      prepared.body,
    ).pricing;
    if (
      pricing.amount !== intent.amount ||
      pricing.currency !== intent.currency ||
      prepared.fractionDigits !== intent.fractionDigits
    )
      conflict();
    return prepared;
  }
  async function insertAttempt(
    tx: SqlExecutor,
    contributionId: string,
    sequence: number,
    prepared: PreparedBachsCheckout,
  ): Promise<void> {
    if (
      await one(
        tx,
        `SELECT 1 FROM ${p}attempts WHERE reference = ? OR idempotency_key = ?`,
        [prepared.reference, prepared.idempotencyKey],
      )
    )
      conflict();
    await tx.query(
      `INSERT INTO ${p}attempts (reference, contribution_id, sequence, idempotency_key, request) VALUES (?, ?, ?, ?, ?)`,
      [
        prepared.reference,
        contributionId,
        sequence,
        prepared.idempotencyKey,
        JSON.stringify(prepared),
      ],
    );
  }
  async function confirm(
    tx: SqlExecutor,
    contributionId: string,
    from: StoredContribution["outcome"],
  ): Promise<void> {
    const changed = await tx.query(
      `UPDATE ${p}contributions SET outcome = 'confirmed' WHERE id = ? AND outcome = ? RETURNING id`,
      [contributionId, from],
    );
    if (!changed.length) return;
    for (const name of effectNames) {
      await tx.query(
        `INSERT INTO ${p}effects (contribution_id, name, next_attempt_at) VALUES (?, ?, 0) ON CONFLICT DO NOTHING`,
        [contributionId, name],
      );
    }
  }
  const setReview = (tx: SqlExecutor, contributionId: string) =>
    tx.query(
      `UPDATE ${p}contributions SET outcome = 'needs_review' WHERE id = ?`,
      [contributionId],
    );
  const attemptByCheckout = async (tx: SqlExecutor, checkoutId: unknown) =>
    typeof checkoutId === "string"
      ? one(tx, `SELECT * FROM ${p}attempts WHERE checkout_id = ?`, [
          checkoutId,
        ])
      : undefined;
  const paymentByCharge = (tx: SqlExecutor, chargeId: string) =>
    one(
      tx,
      `SELECT pay.*, c.intent FROM ${p}payments pay
    JOIN ${p}contributions c ON c.id = pay.contribution_id WHERE pay.charge_id = ?`,
      [chargeId],
    );
  const pending = (reason: string): Interpretation => ({
    state: "pending",
    reason,
  });
  const result = (
    state: "applied" | "review",
    reason: string | null,
    contributionId: string,
  ): Interpretation => ({ state, reason, contributionId });

  async function interpretCollection(
    tx: SqlExecutor,
    event: BachsEvent,
  ): Promise<Interpretation> {
    const attempt = await attemptByCheckout(tx, event.data.checkout_id);
    if (!attempt) return pending("unassociated_checkout");
    const contributionId = String(attempt.contribution_id);
    const intent = decode<PendingContribution>(
      (await requiredRow(tx, contributionId)).intent,
    );
    const expected = {
      checkoutId: String(attempt.checkout_id),
      reference: String(attempt.reference),
      amount: intent.amount,
      currency: intent.currency,
      fractionDigits: intent.fractionDigits,
    };
    const assessed = assessAcceptedCollection(event, {
      organizationId: organization,
      environment,
      ...expected,
    });
    if (assessed.outcome === "ignored") return pending(assessed.reason);
    if (assessed.outcome === "review")
      return result("review", assessed.reason, contributionId);
    if (assessed.outcome === "converted") {
      const completions = await tx.query(
        `SELECT payload FROM ${p}events WHERE contribution_id = ? AND state = 'applied'`,
        [contributionId],
      );
      if (
        !completions.some((row) =>
          checkoutPaidAsIntended(decode<BachsEvent>(row.payload), expected),
        )
      )
        return pending("awaiting_checkout_completion");
    }
    const assessment =
      assessed.outcome === "matched"
        ? assessed
        : {
            chargeId: assessed.chargeId,
            checkoutId: assessed.checkoutId,
            amount: intent.amount,
            currency: intent.currency,
          };
    let reason: string | null = null;
    const payment = await one(
      tx,
      `SELECT * FROM ${p}payments WHERE charge_id = ?`,
      [assessment.chargeId],
    );
    if (
      payment &&
      (payment.contribution_id !== contributionId ||
        payment.checkout_id !== assessment.checkoutId ||
        payment.amount !== assessment.amount ||
        payment.currency !== assessment.currency)
    ) {
      reason = "payment_conflict";
      await setReview(tx, String(payment.contribution_id));
    } else if (!payment) {
      await tx.query(
        `INSERT INTO ${p}payments (charge_id, contribution_id, checkout_id, amount, currency, first_event_id) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          assessment.chargeId,
          contributionId,
          assessment.checkoutId,
          assessment.amount,
          assessment.currency,
          event.id,
        ],
      );
    }
    const count = await one(
      tx,
      `SELECT count(*) AS total FROM ${p}payments WHERE contribution_id = ?`,
      [contributionId],
    );
    if (Number(count?.total) > 1) reason ??= "multiple_payments";
    return {
      state: reason ? "review" : "applied",
      reason,
      contributionId,
      confirm: reason === null,
    };
  }

  async function interpretCheckout(
    tx: SqlExecutor,
    facts: Extract<BachsEventFacts, { kind: "checkout" }>,
  ): Promise<Interpretation> {
    const attempt = await attemptByCheckout(tx, facts.checkoutId);
    if (!attempt) return pending("unassociated_checkout");
    const contributionId = String(attempt.contribution_id);
    if (facts.reference !== null && facts.reference !== attempt.reference)
      return result("review", "reference_mismatch", contributionId);
    const checkout = decode<StoredCheckout>(attempt.checkout);
    if (checkout.status === facts.status)
      return result("applied", null, contributionId);
    const contradicts =
      facts.status === "expired"
        ? checkout.status === "completed"
        : closedStatuses.includes(checkout.status);
    if (contradicts)
      return result("review", "checkout_conflict", contributionId);
    await tx.query(`UPDATE ${p}attempts SET checkout = ? WHERE reference = ?`, [
      JSON.stringify({ ...checkout, status: facts.status }),
      String(attempt.reference),
    ]);
    return result("applied", null, contributionId);
  }

  async function interpretRefund(
    tx: SqlExecutor,
    event: BachsEvent,
    facts: Extract<BachsEventFacts, { kind: "refund" }>,
  ): Promise<Interpretation> {
    const payment = await paymentByCharge(tx, facts.chargeId);
    if (!payment) return pending("unknown_charge");
    const contributionId = String(payment.contribution_id);
    const collected = await one(
      tx,
      `SELECT payload FROM ${p}events WHERE id = ?`,
      [String(payment.first_event_id)],
    );
    // Bachs requests and reports refunds in the payment's settlement currency, which refund events do not name.
    // REVISIT(bachs): documented but untested; replace with the event's currency if Bachs adds one.
    if (
      decode<BachsEvent>(collected!.payload).data.settlement_currency !==
      payment.currency
    )
      return result("review", "refund_currency_unconfirmed", contributionId);
    const digits = decode<PendingContribution>(payment.intent).fractionDigits;
    let requested: string;
    let refunded: string;
    try {
      requested = normalizeAmount(facts.requestedAmount, digits);
      refunded =
        facts.refundedAmount == null && facts.status !== "paid"
          ? normalizeNonNegativeAmount("0", digits)
          : normalizeNonNegativeAmount(facts.refundedAmount, digits);
    } catch {
      return result("review", "invalid_payment_facts", contributionId);
    }
    if (
      amountUnits(refunded) > amountUnits(requested) ||
      (facts.status === "paid" && amountUnits(refunded) === 0n)
    ) {
      return result("review", "invalid_payment_facts", contributionId);
    }
    const existing = await one(
      tx,
      `SELECT * FROM ${p}refunds WHERE refund_id = ?`,
      [facts.refundId],
    );
    if (existing) {
      if (existing.charge_id !== facts.chargeId)
        return result("review", "refund_conflict", contributionId);
      if (existing.status !== "processing") {
        if (facts.status === "processing")
          return result("applied", null, contributionId);
        const same =
          existing.status === facts.status &&
          existing.refunded_amount === refunded &&
          existing.requested_amount === requested;
        return result(
          same ? "applied" : "review",
          same ? null : "refund_conflict",
          contributionId,
        );
      }
    }
    await tx.query(
      `INSERT INTO ${p}refunds (refund_id, charge_id, status, requested_amount, refunded_amount, last_event_id)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (refund_id) DO UPDATE SET status = excluded.status,
      requested_amount = excluded.requested_amount, refunded_amount = excluded.refunded_amount, last_event_id = excluded.last_event_id`,
      [
        facts.refundId,
        facts.chargeId,
        facts.status,
        requested,
        refunded,
        event.id,
      ],
    );
    const paid = (
      await tx.query(
        `SELECT refunded_amount FROM ${p}refunds WHERE charge_id = ? AND status = 'paid'`,
        [facts.chargeId],
      )
    ).reduce(
      (total, refund) => total + amountUnits(String(refund.refunded_amount)),
      0n,
    );
    if (paid > amountUnits(String(payment.amount)))
      return result("review", "refund_exceeds_payment", contributionId);
    return result("applied", null, contributionId);
  }

  async function interpretDispute(
    tx: SqlExecutor,
    event: BachsEvent,
    facts: Extract<BachsEventFacts, { kind: "dispute" }>,
  ): Promise<Interpretation> {
    const payment = await paymentByCharge(tx, facts.chargeId);
    if (!payment) return pending("unknown_charge");
    const contributionId = String(payment.contribution_id);
    if (facts.currency !== payment.currency)
      return result("review", "currency_mismatch", contributionId);
    let amount: string;
    try {
      amount = normalizeAmount(
        facts.amount,
        decode<PendingContribution>(payment.intent).fractionDigits,
      );
    } catch {
      return result("review", "invalid_payment_facts", contributionId);
    }
    if (amountUnits(amount) > amountUnits(String(payment.amount)))
      return result("review", "invalid_payment_facts", contributionId);
    const existing = await one(
      tx,
      `SELECT * FROM ${p}disputes WHERE dispute_id = ?`,
      [facts.disputeId],
    );
    if (existing) {
      if (existing.charge_id !== facts.chargeId)
        return result("review", "dispute_conflict", contributionId);
      const previous = existing.updated_at as string | null;
      if (previous !== null && facts.updatedAt !== null) {
        if (Date.parse(facts.updatedAt) < Date.parse(previous))
          return result("applied", null, contributionId);
      } else if (existing.status !== facts.status) {
        return result("review", "dispute_conflict", contributionId);
      }
    }
    await tx.query(
      `INSERT INTO ${p}disputes (dispute_id, charge_id, status, amount, currency, updated_at, last_event_id)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (dispute_id) DO UPDATE SET status = excluded.status, amount = excluded.amount,
      updated_at = excluded.updated_at, last_event_id = excluded.last_event_id`,
      [
        facts.disputeId,
        facts.chargeId,
        facts.status,
        amount,
        String(payment.currency),
        facts.updatedAt,
        event.id,
      ],
    );
    return result("applied", null, contributionId);
  }

  async function interpret(
    tx: SqlExecutor,
    event: BachsEvent,
  ): Promise<Interpretation> {
    const facts = readEventFacts(event);
    switch (facts.kind) {
      case "collection":
        return interpretCollection(tx, event);
      case "checkout":
        return interpretCheckout(tx, facts);
      case "collection_failed":
      case "underpaid": {
        const attempt =
          facts.checkoutId === null
            ? undefined
            : await attemptByCheckout(tx, facts.checkoutId);
        if (!attempt) return pending("unassociated_checkout");
        return facts.kind === "underpaid"
          ? result("review", "underpaid", String(attempt.contribution_id))
          : result(
              "applied",
              "collection_failed",
              String(attempt.contribution_id),
            );
      }
      case "refund":
        return interpretRefund(tx, event, facts);
      case "dispute":
        return interpretDispute(tx, event, facts);
      case "invalid":
        return {
          state: "review",
          reason: "invalid_event_facts",
          contributionId: null,
        };
      case "unsupported":
        return {
          state: "unsupported",
          reason: "event_type",
          contributionId: null,
        };
    }
  }

  async function applyEvent(
    tx: SqlExecutor,
    eventId: string,
    event: BachsEvent,
  ): Promise<StoredEvent> {
    const outcome = await interpret(tx, event);
    if (outcome.state === "pending")
      return { event, state: "pending", reason: outcome.reason, note: null };
    let { state, reason } = outcome;
    const { contributionId } = outcome;
    if (
      contributionId !== null &&
      (await one(tx, `SELECT 1 FROM ${p}event_conflicts WHERE event_id = ?`, [
        eventId,
      ]))
    ) {
      state = "review";
      reason = "event_conflict";
    }
    await tx.query(
      `UPDATE ${p}events SET state = ?, reason = ?, contribution_id = ? WHERE id = ?`,
      [state, reason, contributionId, eventId],
    );
    if (state === "review" && contributionId !== null)
      await setReview(tx, contributionId);
    if (state === "applied" && outcome.confirm)
      await confirm(tx, contributionId!, "pending");
    if (state === "applied" && event.type === "checkout.completed") {
      for (const waiting of await tx.query(
        `SELECT id, payload FROM ${p}events WHERE state = 'pending' ORDER BY id`,
      )) {
        const collection = decode<BachsEvent>(waiting.payload);
        if (
          collection.type === "collection.succeeded" &&
          collection.data.checkout_id === event.data.checkout_id
        ) {
          await applyEvent(tx, String(waiting.id), collection);
        }
      }
    }
    return { event, state, reason, note: null };
  }

  function sumByCurrency(
    entries: readonly { amount: string; currency: string; sign: bigint }[],
  ): Readonly<Record<string, string>> {
    const totals = new Map<string, { units: bigint; digits: number }>();
    for (const { amount, currency, sign } of entries) {
      const digits = amount.split(".")[1]?.length ?? 0;
      const current = totals.get(currency) ?? { units: 0n, digits };
      const scale = Math.max(current.digits, digits);
      const units =
        current.units * 10n ** BigInt(scale - current.digits) +
        sign * amountUnits(amount) * 10n ** BigInt(scale - digits);
      totals.set(currency, { units, digits: scale });
    }
    return Object.freeze(
      Object.fromEntries(
        [...totals]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([currency, { units, digits }]) => {
            const text = units.toString().padStart(digits + 1, "0");
            return [
              currency,
              digits
                ? `${text.slice(0, -digits)}.${text.slice(-digits)}`
                : text,
            ];
          }),
      ),
    );
  }
  const confirmed = `SELECT id FROM ${p}contributions WHERE outcome = 'confirmed'`;
  const signed = (rows: readonly Row[], sign: bigint) =>
    rows.map((row) => ({
      amount: String(row.amount),
      currency: String(row.currency),
      sign,
    }));

  async function confirmedTotals(
    tx: SqlExecutor,
  ): Promise<Readonly<Record<string, string>>> {
    return sumByCurrency([
      ...signed(
        await tx.query(
          `SELECT amount, currency FROM ${p}payments WHERE contribution_id IN (${confirmed})`,
        ),
        1n,
      ),
      ...signed(
        await tx.query(`SELECT r.refunded_amount AS amount, pay.currency FROM ${p}refunds r
        JOIN ${p}payments pay ON pay.charge_id = r.charge_id WHERE r.status = 'paid' AND pay.contribution_id IN (${confirmed})`),
        -1n,
      ),
      ...signed(
        await tx.query(
          `SELECT amount, currency FROM ${p}owner_records WHERE kind = 'external_return' AND contribution_id IN (${confirmed})`,
        ),
        -1n,
      ),
    ]);
  }

  // The newest notice wins: a resent notice may add facts an older version dropped.
  async function settlementsByCharge(
    tx: SqlExecutor,
    contributionIds: readonly string[],
  ) {
    const settlements = new Map<string, BachsSettlementFacts>();
    if (!contributionIds.length) return settlements;
    const rows = await tx.query(
      `SELECT payload FROM ${p}events WHERE state = 'applied' AND contribution_id IN (${contributionIds.map(() => "?").join(", ")})
      ORDER BY received_at DESC, id DESC`,
      contributionIds,
    );
    for (const row of rows) {
      const event = decode<BachsEvent>(row.payload);
      const facts =
        event.type === "collection.succeeded"
          ? readSettlementFacts(event.data)
          : null;
      const chargeId = String(event.data.charge_id);
      if (facts && !settlements.has(chargeId)) settlements.set(chargeId, facts);
    }
    return settlements;
  }

  async function statementsByCharge(
    tx: SqlExecutor,
    contributionIds: readonly string[],
  ) {
    const statements = new Map<string, StoredPaymentStatement>();
    if (!contributionIds.length) return statements;
    const rows = await tx.query(
      `SELECT s.* FROM ${p}payment_statements s JOIN ${p}payments pay ON pay.charge_id = s.charge_id
      WHERE pay.contribution_id IN (${contributionIds.map(() => "?").join(", ")})`,
      contributionIds,
    );
    for (const row of rows) {
      statements.set(String(row.charge_id), {
        status: String(row.status),
        amount: String(row.amount),
        currency: String(row.currency),
        fee:
          row.fee_amount === null
            ? null
            : {
                amount: String(row.fee_amount),
                currency: String(row.fee_currency),
              },
        feeBearer: row.fee_bearer as StoredPaymentStatement["feeBearer"],
        retrievedAt: String(row.retrieved_at),
      });
    }
    return statements;
  }

  async function settledTotals(tx: SqlExecutor) {
    const payments = await tx.query(
      `SELECT charge_id, contribution_id FROM ${p}payments WHERE contribution_id IN (${confirmed})`,
    );
    const contributionIds = [
      ...new Set(payments.map((payment) => String(payment.contribution_id))),
    ];
    const settlements = await settlementsByCharge(tx, contributionIds);
    const statements = await statementsByCharge(tx, contributionIds);
    const credited = payments.flatMap(
      (payment) => settlements.get(String(payment.charge_id)) ?? [],
    );
    const fees = payments.map((payment) =>
      paymentFee(
        settlements.get(String(payment.charge_id)),
        statements.get(String(payment.charge_id)),
      ),
    );
    return {
      settledTotals: sumByCurrency(
        credited.map(({ amount, currency }) => ({
          amount,
          currency,
          sign: 1n,
        })),
      ),
      feeTotals: sumByCurrency(
        fees.flatMap((fee) =>
          fee.state === "charged"
            ? [{ amount: fee.amount, currency: fee.currency, sign: 1n }]
            : [],
        ),
      ),
      unknownFeePayments: fees.filter((fee) => fee.state === "unreported")
        .length,
      unsettledPayments: payments.length - credited.length,
    };
  }

  async function statusCounts(
    tx: SqlExecutor,
  ): Promise<Record<ContributionStatus, number>> {
    const counts: Record<ContributionStatus, number> = {
      awaiting_payment: 0,
      checkout_unresolved: 0,
      unsuccessful: 0,
      confirmed: 0,
      needs_review: 0,
    };
    for (const row of await tx.query(
      `SELECT outcome, count(*) AS total FROM ${p}contributions WHERE outcome <> 'pending' GROUP BY outcome`,
    )) {
      counts[contributionStatus(row.outcome, null, null)] += Number(row.total);
    }
    for (const row of await tx.query(`SELECT c.outcome, a.state, a.checkout FROM ${p}contributions c
      JOIN ${p}attempts a ON a.contribution_id = c.id AND ${currentAttempt} WHERE c.outcome = 'pending'`)) {
      counts[contributionStatus(row.outcome, row.state, row.checkout)]++;
    }
    return counts;
  }

  const removePersonal = (
    tx: SqlExecutor,
    id: string,
    by: "retention" | "owner" | "supporter",
    at: string,
  ) =>
    tx.query(
      `UPDATE ${p}contributions SET supporter_name = NULL, message = NULL, metadata = NULL,
      personal_data_removed_at = ?, personal_data_removed_by = ? WHERE id = ?`,
      [at, by, id],
    );
  const noteText = (note: unknown) => requiredText(note, 2000);
  const nextRecord = async (tx: SqlExecutor, id: string) =>
    Number(
      (
        await one(
          tx,
          `SELECT count(*) AS total FROM ${p}owner_records WHERE contribution_id = ?`,
          [id],
        )
      )?.total,
    ) + 1;
  const time = (value: unknown) => timestamp(value, "INVALID_CHECKOUT");

  return Object.freeze({
    organizationId: organization,
    environment,
    effects: effectNames,
    async putContext(
      input: SupportContextInput,
      expectedRevision: number | null,
    ): Promise<StoredContext> {
      const context = defineSupportContext(input);
      if (
        expectedRevision !== null &&
        (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      ) {
        throw new CheerkitStoreError(
          "INVALID_STATE",
          "Supply a valid context revision or null to create.",
        );
      }
      return transaction(async (tx) => {
        const existing = await one(
          tx,
          `SELECT revision FROM ${p}contexts WHERE id = ?`,
          [context.id],
        );
        if (
          existing
            ? Number(existing.revision) !== expectedRevision
            : expectedRevision !== null
        )
          conflict();
        const revision = expectedRevision === null ? 1 : expectedRevision + 1;
        await tx.query(
          `INSERT INTO ${p}contexts (id, revision, context) VALUES (?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET revision = excluded.revision, context = excluded.context`,
          [context.id, revision, JSON.stringify(context)],
        );
        return { context, revision };
      });
    },
    async syncContext(input: SupportContextInput): Promise<StoredContext> {
      const wanted = defineSupportContext(input);
      return transaction(async (tx) => {
        const existing = await one(
          tx,
          `SELECT revision, context FROM ${p}contexts WHERE id = ?`,
          [wanted.id],
        );
        const accepting = existing
          ? defineSupportContext(decode(existing.context))
              .acceptingContributions
          : wanted.acceptingContributions;
        const context = defineSupportContext({
          ...input,
          acceptingContributions: accepting,
        });
        if (existing && String(existing.context) === JSON.stringify(context))
          return { context, revision: Number(existing.revision) };
        const revision = existing ? Number(existing.revision) + 1 : 1;
        await tx.query(
          `INSERT INTO ${p}contexts (id, revision, context) VALUES (?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET revision = excluded.revision, context = excluded.context`,
          [context.id, revision, JSON.stringify(context)],
        );
        return { context, revision };
      });
    },
    getContext(id: string): Promise<StoredContext | null> {
      return transaction(async (tx) => {
        const row = await one(tx, `SELECT * FROM ${p}contexts WHERE id = ?`, [
          id,
        ]);
        return row
          ? {
              context: defineSupportContext(decode(row.context)),
              revision: Number(row.revision),
            }
          : null;
      });
    },
    listContexts(): Promise<readonly StoredContext[]> {
      return transaction(async (tx) =>
        (await tx.query(`SELECT * FROM ${p}contexts ORDER BY id`)).map(
          (row) => ({
            context: defineSupportContext(decode(row.context)),
            revision: Number(row.revision),
          }),
        ),
      );
    },
    async reserve(
      intent: PendingContribution,
      request: PreparedBachsCheckout,
      submissionKey: string,
      metadata?: ContributionMetadata,
    ): Promise<StoredContribution> {
      const valid = validatedIntent(intent);
      const prepared = checkRequest(request, valid);
      const rawKey = identifier(submissionKey, "INVALID_CHECKOUT");
      const key = uuid.test(rawKey) ? rawKey.toLowerCase() : rawKey;
      const extra = validateMetadata(metadata);
      const {
        id: _id,
        createdAt: _createdAt,
        supporterName,
        message,
        ...financial
      } = valid;
      const fingerprint = hash(
        canonical(
          Object.keys(extra).length
            ? { ...financial, metadata: extra }
            : financial,
        ),
      );
      const sealed = [
        await cipher.seal(supporterName ?? null),
        await cipher.seal(message ?? null),
        await cipher.seal(
          Object.keys(extra).length ? JSON.stringify(extra) : null,
        ),
      ];
      return revealed(async (tx) => {
        const existing = await one(
          tx,
          `SELECT id, fingerprint FROM ${p}contributions WHERE submission_key = ?`,
          [key],
        );
        if (existing) {
          if (existing.fingerprint !== fingerprint) conflict();
          return snapshot(tx, await requiredRow(tx, String(existing.id)));
        }
        const context = await checkCurrentRules(tx, valid);
        if (
          await one(tx, `SELECT 1 FROM ${p}contributions WHERE id = ?`, [
            valid.id,
          ])
        )
          conflict();
        await tx.query(
          `INSERT INTO ${p}contributions (id, submission_key, fingerprint, context_id, context_snapshot, intent, created_at,
          supporter_name, message, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            valid.id,
            key,
            fingerprint,
            valid.contextId,
            context,
            JSON.stringify({
              ...financial,
              id: valid.id,
              createdAt: valid.createdAt,
            }),
            valid.createdAt,
            ...sealed,
          ],
        );
        await insertAttempt(tx, valid.id, 1, prepared);
        return snapshot(tx, await requiredRow(tx, valid.id));
      });
    },
    openAttempt(
      id: string,
      request: PreparedBachsCheckout,
      previousReference: string,
    ): Promise<StoredContribution> {
      return revealed(async (tx) => {
        const row = await requiredRow(tx, id);
        if (
          !(await one(
            tx,
            `SELECT 1 FROM ${p}attempts WHERE reference = ? AND contribution_id = ?`,
            [previousReference, id],
          ))
        )
          conflict();
        if (row.reference !== previousReference) return snapshot(tx, row);
        const checkout =
          row.checkout === null ? null : decode<StoredCheckout>(row.checkout);
        const closed =
          row.attempt_state === "rejected" ||
          (checkout !== null && closedStatuses.includes(checkout.status));
        if (
          !closed ||
          row.outcome !== "pending" ||
          (await one(
            tx,
            `SELECT 1 FROM ${p}payments WHERE contribution_id = ?`,
            [id],
          ))
        ) {
          throw new CheerkitStoreError(
            "INVALID_STATE",
            "Only a closed attempt without payment can be followed by another.",
          );
        }
        const intent = decode<PendingContribution>(row.intent);
        const prepared = checkRequest(request, intent);
        await checkCurrentRules(tx, intent);
        await insertAttempt(tx, id, Number(row.sequence) + 1, prepared);
        return snapshot(tx, await requiredRow(tx, id));
      });
    },
    async claimCheckout(
      id: string,
      dispatch: CheckoutDispatch,
    ): Promise<CheckoutClaim | null> {
      const value = object(dispatch, "INVALID_CHECKOUT");
      keys(
        value,
        ["credential", "at", "retryUntil", "leaseUntil"],
        "INVALID_CHECKOUT",
      );
      const credential = text(value.credential, 64, "INVALID_CHECKOUT");
      const [at, retryUntil, leaseUntil] = [
        value.at,
        value.retryUntil,
        value.leaseUntil,
      ].map((instant) => {
        if (typeof instant !== "number" || !Number.isSafeInteger(instant))
          throw new CheerkitStoreError(
            "INVALID_STATE",
            "Invalid checkout dispatch.",
          );
        return instant;
      }) as [number, number, number];
      if (
        !/^[0-9a-f]{64}$/.test(credential) ||
        retryUntil <= at ||
        leaseUntil <= at
      ) {
        throw new CheerkitStoreError(
          "INVALID_STATE",
          "Invalid checkout dispatch.",
        );
      }
      return transaction(async (tx) => {
        const row = await requiredRow(tx, id);
        if (row.attempt_state === "prepared") {
          await tx.query(
            `UPDATE ${p}attempts SET state = 'creating', credential = ?, retry_until = ?, lease_until = ? WHERE reference = ?`,
            [credential, retryUntil, leaseUntil, String(row.reference)],
          );
          return { request: decode(row.request), retry: false };
        }
        const unresolved =
          row.attempt_state === "uncertain" ||
          (row.attempt_state === "creating" && Number(row.lease_until) <= at);
        if (
          !unresolved ||
          row.credential !== credential ||
          at >= Number(row.retry_until)
        )
          return null;
        await tx.query(
          `UPDATE ${p}attempts SET state = 'creating', lease_until = ? WHERE reference = ?`,
          [leaseUntil, String(row.reference)],
        );
        return { request: decode(row.request), retry: true };
      });
    },
    async recordCheckout(id: string, checkout: BachsCheckout): Promise<void> {
      const value = object(checkout, "INVALID_CHECKOUT");
      const checkoutId = identifier(value.id, "INVALID_CHECKOUT");
      identifier(value.reference, "INVALID_CHECKOUT");
      httpsUrl(value.url, "INVALID_CHECKOUT");
      time(value.createdAt);
      time(value.expiresAt);
      if (
        !["open", "completed", "expired", "cancelled"].includes(
          String(value.status),
        )
      )
        conflict();
      await transaction(async (tx) => {
        const row = await requiredRow(tx, id);
        if (
          row.reference !== checkout.reference ||
          (row.checkout_id !== null && row.checkout_id !== checkoutId)
        )
          conflict();
        const other = await one(
          tx,
          `SELECT contribution_id FROM ${p}attempts WHERE checkout_id = ?`,
          [checkoutId],
        );
        if (other && other.contribution_id !== id) conflict();
        if (
          row.attempt_state === "prepared" ||
          row.attempt_state === "rejected"
        ) {
          throw new CheerkitStoreError(
            "INVALID_STATE",
            "Checkout must be claimed before recording its result.",
          );
        }
        await tx.query(
          `UPDATE ${p}attempts SET state = 'available', checkout_id = ?, checkout = ? WHERE reference = ?`,
          [checkoutId, JSON.stringify(checkout), String(row.reference)],
        );
      });
    },
    async recordRecoveredCheckout(
      id: string,
      checkout: RecoveredBachsCheckout,
    ): Promise<void> {
      if (!isRecoveredCheckout(checkout))
        throw new BachsError(
          "RECOVERY_FAILED",
          "Use original verified checkout retrieval evidence.",
        );
      if (
        checkout.organizationId !== organization ||
        checkout.environment !== environment
      )
        throw new BachsError(
          "WRONG_ACCOUNT",
          "Recovery scope does not match storage.",
        );
      await transaction(async (tx) => {
        const row = await requiredRow(tx, id);
        const intent = decode<PendingContribution>(row.intent);
        if (
          row.reference !== checkout.reference ||
          intent.amount !== checkout.amount ||
          intent.currency !== checkout.currency ||
          (row.checkout_id !== null && row.checkout_id !== checkout.id)
        )
          conflict();
        if (row.checkout_id !== null) return;
        if (
          row.attempt_state !== "creating" &&
          row.attempt_state !== "uncertain"
        ) {
          throw new CheerkitStoreError(
            "INVALID_STATE",
            "Only dispatched attempts can recover a checkout association.",
          );
        }
        if (
          await one(tx, `SELECT 1 FROM ${p}attempts WHERE checkout_id = ?`, [
            checkout.id,
          ])
        )
          conflict();
        const {
          id: checkoutId,
          reference,
          status,
          createdAt,
          expiresAt,
        } = checkout;
        await tx.query(
          `UPDATE ${p}attempts SET state = 'available', checkout_id = ?, checkout = ? WHERE reference = ?`,
          [
            checkoutId,
            JSON.stringify({
              id: checkoutId,
              reference,
              status,
              createdAt,
              expiresAt,
            }),
            String(row.reference),
          ],
        );
      });
    },
    async recordCheckoutFailure(
      id: string,
      outcome: "uncertain" | "rejected",
    ): Promise<void> {
      if (outcome !== "uncertain" && outcome !== "rejected")
        throw new CheerkitStoreError(
          "INVALID_STATE",
          "Invalid creation outcome.",
        );
      await transaction(async (tx) => {
        const row = await requiredRow(tx, id);
        if (row.attempt_state === "available") return;
        if (
          row.attempt_state !== "creating" &&
          row.attempt_state !== "uncertain"
        ) {
          throw new CheerkitStoreError(
            "INVALID_STATE",
            "Checkout is not awaiting a creation result.",
          );
        }
        await tx.query(
          `UPDATE ${p}attempts SET state = ? WHERE reference = ?`,
          [outcome, String(row.reference)],
        );
      });
    },
    async acceptEvent(
      event: BachsEvent,
    ): Promise<"accepted" | "duplicate" | "conflict"> {
      if (!isAuthenticated(event))
        throw new BachsError(
          "INVALID_SIGNATURE",
          "Only authenticated events can be accepted.",
        );
      if (
        event.organizationId !== organization ||
        event.environment !== environment
      )
        throw new BachsError(
          "WRONG_ACCOUNT",
          "Event scope does not match storage.",
        );
      const fingerprint = hash(canonical(event));
      const payload = canonical(minimizedEvent(event));
      return transaction(async (tx) => {
        const existing = await one(
          tx,
          `SELECT fingerprint, payload, contribution_id FROM ${p}events WHERE id = ?`,
          [event.id],
        );
        if (existing) {
          if (existing.fingerprint === fingerprint) {
            await tx.query(
              `UPDATE ${p}events SET payload = ?, fingerprint = ? WHERE id = ?`,
              [payload, fingerprint, event.id],
            );
            return "duplicate";
          }
          await tx.query(
            `INSERT INTO ${p}event_conflicts (event_id, fingerprint, payload) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
            [event.id, fingerprint, payload],
          );
          if (existing.contribution_id !== null) {
            await setReview(tx, String(existing.contribution_id));
            await tx.query(
              `UPDATE ${p}events SET state = 'review', reason = 'event_conflict' WHERE id = ?`,
              [event.id],
            );
          }
          return "conflict";
        }
        await tx.query(
          `INSERT INTO ${p}events (id, payload, fingerprint, received_at) VALUES (?, ?, ?, ?)`,
          [event.id, payload, fingerprint, new Date().toISOString()],
        );
        return "accepted";
      });
    },
    async recordPaymentStatement(
      statement: BachsPaymentStatement,
      at: string,
    ): Promise<void> {
      if (!isPaymentStatement(statement))
        throw new BachsError(
          "LOOKUP_FAILED",
          "Use the client's own payment retrieval.",
        );
      if (
        statement.organizationId !== organization ||
        statement.environment !== environment
      )
        throw new BachsError(
          "WRONG_ACCOUNT",
          "Statement scope does not match storage.",
        );
      const retrievedAt = time(at);
      await transaction(async (tx) => {
        const payment = await one(
          tx,
          `SELECT pay.checkout_id, e.payload FROM ${p}payments pay JOIN ${p}events e ON e.id = pay.first_event_id
          WHERE pay.charge_id = ?`,
          [statement.chargeId],
        );
        if (!payment)
          throw new CheerkitStoreError("NOT_FOUND", "Payment was not found.");
        const notice = decode<BachsEvent>(payment.payload).data;
        if (
          statement.checkoutId !== payment.checkout_id ||
          statement.currency !== notice.currency ||
          !sameDecimal(notice.amount, statement.amount)
        )
          conflict();
        await tx.query(
          `INSERT INTO ${p}payment_statements (charge_id, status, amount, currency, fee_amount, fee_currency, fee_bearer, retrieved_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (charge_id) DO UPDATE SET status = excluded.status, amount = excluded.amount,
          currency = excluded.currency, fee_amount = excluded.fee_amount, fee_currency = excluded.fee_currency,
          fee_bearer = excluded.fee_bearer, retrieved_at = excluded.retrieved_at`,
          [
            statement.chargeId,
            statement.status,
            statement.amount,
            statement.currency,
            statement.fee?.amount ?? null,
            statement.fee?.currency ?? null,
            statement.feeBearer,
            retrievedAt,
          ],
        );
      });
    },
    processEvent(eventId: string): Promise<StoredEvent> {
      return transaction(async (tx) => {
        const row = await one(tx, `SELECT * FROM ${p}events WHERE id = ?`, [
          eventId,
        ]);
        if (!row)
          throw new CheerkitStoreError("NOT_FOUND", "Event was not found.");
        if (row.state !== "pending") return eventSnapshot(row);
        return applyEvent(tx, eventId, decode<BachsEvent>(row.payload));
      });
    },
    async acceptReview(
      id: string,
      note: string,
      at: string,
    ): Promise<StoredContribution> {
      const noteValue = noteText(note);
      const recordedAt = time(at);
      return revealed(async (tx) => {
        const row = await requiredRow(tx, id);
        if (
          row.outcome !== "needs_review" ||
          !(await one(
            tx,
            `SELECT 1 FROM ${p}payments WHERE contribution_id = ?`,
            [id],
          ))
        ) {
          throw new CheerkitStoreError(
            "INVALID_STATE",
            "Only a reviewed contribution with a recorded payment can be accepted.",
          );
        }
        await confirm(tx, id, "needs_review");
        await tx.query(
          `INSERT INTO ${p}owner_records (id, contribution_id, sequence, kind, note, recorded_at) VALUES (?, ?, ?, 'review_accepted', ?, ?)`,
          [randomUUID(), id, await nextRecord(tx, id), noteValue, recordedAt],
        );
        return snapshot(tx, await requiredRow(tx, id));
      });
    },
    async recordExternalReturn(
      id: string,
      amount: string,
      note: string,
      at: string,
    ): Promise<StoredContribution> {
      const noteValue = noteText(note);
      const recordedAt = time(at);
      return revealed(async (tx) => {
        const row = await requiredRow(tx, id);
        const intent = decode<PendingContribution>(row.intent);
        const value = normalizeAmount(amount, intent.fractionDigits);
        const payments = await tx.query(
          `SELECT amount, currency FROM ${p}payments WHERE contribution_id = ?`,
          [id],
        );
        const returned = (
          await tx.query(
            `SELECT amount FROM ${p}owner_records WHERE contribution_id = ? AND kind = 'external_return'`,
            [id],
          )
        ).reduce(
          (total, record) => total + amountUnits(String(record.amount)),
          amountUnits(value),
        );
        const paid = payments
          .filter((payment) => payment.currency === intent.currency)
          .reduce(
            (total, payment) => total + amountUnits(String(payment.amount)),
            0n,
          );
        if (!payments.length || returned > paid)
          throw new CheerkitStoreError(
            "INVALID_STATE",
            "External returns cannot exceed recorded payments.",
          );
        await tx.query(
          `INSERT INTO ${p}owner_records (id, contribution_id, sequence, kind, amount, currency, note, recorded_at)
          VALUES (?, ?, ?, 'external_return', ?, ?, ?, ?)`,
          [
            randomUUID(),
            id,
            await nextRecord(tx, id),
            value,
            intent.currency,
            noteValue,
            recordedAt,
          ],
        );
        return snapshot(tx, await requiredRow(tx, id));
      });
    },
    async dismissEvent(eventId: string, note: string): Promise<StoredEvent> {
      const noteValue = noteText(note);
      return transaction(async (tx) => {
        const row = await one(tx, `SELECT * FROM ${p}events WHERE id = ?`, [
          eventId,
        ]);
        if (!row)
          throw new CheerkitStoreError("NOT_FOUND", "Event was not found.");
        if (row.state === "applied" || row.state === "dismissed")
          throw new CheerkitStoreError(
            "INVALID_STATE",
            "Only unresolved events can be dismissed.",
          );
        await tx.query(
          `UPDATE ${p}events SET state = 'dismissed', note = ? WHERE id = ?`,
          [noteValue, eventId],
        );
        return eventSnapshot(
          (await one(tx, `SELECT * FROM ${p}events WHERE id = ?`, [eventId]))!,
        );
      });
    },
    recheckEvent(eventId: string): Promise<StoredEvent> {
      return transaction(async (tx) => {
        const row = await one(tx, `SELECT * FROM ${p}events WHERE id = ?`, [
          eventId,
        ]);
        if (!row)
          throw new CheerkitStoreError("NOT_FOUND", "Event was not found.");
        if (row.state !== "review" && row.state !== "dismissed") {
          throw new CheerkitStoreError(
            "INVALID_STATE",
            "Only events in review or dismissed can be checked again.",
          );
        }
        await tx.query(
          `UPDATE ${p}events SET state = 'pending', reason = NULL, note = NULL WHERE id = ?`,
          [eventId],
        );
        return applyEvent(tx, eventId, decode<BachsEvent>(row.payload));
      });
    },
    reopenEvent(eventId: string): Promise<StoredEvent> {
      return transaction(async (tx) => {
        const row = await one(tx, `SELECT * FROM ${p}events WHERE id = ?`, [
          eventId,
        ]);
        if (!row)
          throw new CheerkitStoreError("NOT_FOUND", "Event was not found.");
        if (row.state !== "dismissed")
          throw new CheerkitStoreError(
            "INVALID_STATE",
            "Only dismissed events can be reopened.",
          );
        await tx.query(
          `UPDATE ${p}events SET state = 'pending', reason = NULL, note = NULL WHERE id = ?`,
          [eventId],
        );
        return eventSnapshot(
          (await one(tx, `SELECT * FROM ${p}events WHERE id = ?`, [eventId]))!,
        );
      });
    },
    summarize(): Promise<StoreSummary> {
      return transaction(async (tx) => {
        const count = async (sql: string, names: readonly string[]) => {
          const totals = Object.fromEntries(names.map((name) => [name, 0]));
          for (const row of await tx.query(sql))
            totals[String(row.key)] = Number(row.total);
          return totals;
        };
        return {
          contributions: await statusCounts(tx),
          events: (await count(
            `SELECT state AS key, count(*) AS total FROM ${p}events GROUP BY state`,
            ["pending", "applied", "review", "unsupported", "dismissed"],
          )) as Record<StoredEvent["state"], number>,
          openDisputes: Number(
            (
              await one(
                tx,
                `SELECT count(*) AS total FROM ${p}disputes WHERE status IN ('needs_response', 'under_review')`,
              )
            )?.total,
          ),
          confirmedTotals: await confirmedTotals(tx),
          ...(await settledTotals(tx)),
          effects: (await count(
            `SELECT state AS key, count(*) AS total FROM ${p}effects GROUP BY state`,
            ["pending", "running", "succeeded", "failed"],
          )) as Record<StoredEffect["state"], number>,
        };
      });
    },
    async removePersonalData(
      id: string,
      by: "owner" | "supporter",
      at: string,
    ): Promise<StoredContribution> {
      if (by !== "owner" && by !== "supporter")
        throw new CheerkitStoreError(
          "INVALID_STATE",
          "Invalid removal source.",
        );
      const removedAt = time(at);
      return revealed(async (tx) => {
        const row = await requiredRow(tx, id);
        if (row.personal_data_removed_at === null)
          await removePersonal(tx, id, by, removedAt);
        return snapshot(tx, await requiredRow(tx, id));
      });
    },
    async applyRetention(before: string, at: string): Promise<number> {
      const cutoff = time(before);
      const removedAt = time(at);
      return transaction(async (tx) => {
        const rows = await tx.query(
          `SELECT c.id, c.outcome, a.state AS attempt_state, a.checkout FROM ${p}contributions c
          JOIN ${p}attempts a ON a.contribution_id = c.id AND ${currentAttempt}
          WHERE c.personal_data_removed_at IS NULL AND c.created_at < ?`,
          [cutoff],
        );
        const due = rows.filter((row) =>
          ["confirmed", "unsuccessful"].includes(
            contributionStatus(row.outcome, row.attempt_state, row.checkout),
          ),
        );
        for (const row of due)
          await removePersonal(tx, String(row.id), "retention", removedAt);
        return due.length;
      });
    },
    async claimEffect(
      now: number,
      leaseUntil: number,
    ): Promise<EffectClaim | null> {
      if (
        !Number.isSafeInteger(now) ||
        !Number.isSafeInteger(leaseUntil) ||
        leaseUntil <= now
      ) {
        throw new CheerkitStoreError(
          "INVALID_STATE",
          "Invalid effect claim time.",
        );
      }
      if (!effectNames.length) return null;
      return transaction(async (tx) => {
        const row = await one(
          tx,
          `SELECT * FROM ${p}effects WHERE name IN (${effectNames.map(() => "?").join(", ")})
          AND ((state = 'pending' AND next_attempt_at <= ?) OR (state = 'running' AND lease_until <= ?))
          ORDER BY next_attempt_at, contribution_id, name LIMIT 1`,
          [...effectNames, now, now],
        );
        if (!row) return null;
        const attempt = Number(row.attempts) + 1;
        await tx.query(
          `UPDATE ${p}effects SET state = 'running', attempts = ?, lease_until = ? WHERE contribution_id = ? AND name = ?`,
          [attempt, leaseUntil, String(row.contribution_id), String(row.name)],
        );
        return {
          contributionId: String(row.contribution_id),
          name: String(row.name),
          attempt,
        };
      });
    },
    async settleEffect(
      claim: EffectClaim,
      settlement: EffectSettlement,
    ): Promise<void> {
      await transaction(async (tx) => {
        const row = await one(
          tx,
          `SELECT * FROM ${p}effects WHERE contribution_id = ? AND name = ?`,
          [claim.contributionId, claim.name],
        );
        if (!row)
          throw new CheerkitStoreError("NOT_FOUND", "Effect was not found.");
        if (row.state !== "running" || Number(row.attempts) !== claim.attempt)
          return;
        if (settlement.succeeded) {
          await tx.query(
            `UPDATE ${p}effects SET state = 'succeeded', lease_until = NULL, last_error = NULL WHERE contribution_id = ? AND name = ?`,
            [claim.contributionId, claim.name],
          );
          return;
        }
        const error = text(settlement.error, 64, "INVALID_CHECKOUT");
        if (
          settlement.retryAt !== null &&
          !Number.isSafeInteger(settlement.retryAt)
        )
          throw new CheerkitStoreError("INVALID_STATE", "Invalid retry time.");
        await tx.query(
          `UPDATE ${p}effects SET state = ?, next_attempt_at = ?, lease_until = NULL, last_error = ? WHERE contribution_id = ? AND name = ?`,
          [
            settlement.retryAt === null ? "failed" : "pending",
            settlement.retryAt ?? Number(row.next_attempt_at),
            error,
            claim.contributionId,
            claim.name,
          ],
        );
      });
    },
    async listEffects({
      state,
      contributionId,
      limit = 50,
    }: {
      state?: StoredEffect["state"];
      contributionId?: string;
      limit?: number;
    } = {}): Promise<readonly StoredEffect[]> {
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (contributionId !== undefined && typeof contributionId !== "string") ||
        (state !== undefined &&
          !["pending", "running", "succeeded", "failed"].includes(state))
      ) {
        throw new CheerkitStoreError("INVALID_STATE", "Invalid effect query.");
      }
      const filters = [
        "1 = 1",
        ...(state === undefined ? [] : ["state = ?"]),
        ...(contributionId === undefined ? [] : ["contribution_id = ?"]),
      ];
      const values = [
        ...(state === undefined ? [] : [state]),
        ...(contributionId === undefined ? [] : [contributionId]),
      ];
      return transaction(async (tx) =>
        (
          await tx.query(
            `SELECT * FROM ${p}effects WHERE ${filters.join(" AND ")} ORDER BY contribution_id, name LIMIT ?`,
            [...values, limit],
          )
        ).map(effectSnapshot),
      );
    },
    retryEffect(contributionId: string, name: string): Promise<StoredEffect> {
      return transaction(async (tx) => {
        const row = await one(
          tx,
          `SELECT * FROM ${p}effects WHERE contribution_id = ? AND name = ?`,
          [contributionId, name],
        );
        if (!row)
          throw new CheerkitStoreError("NOT_FOUND", "Effect was not found.");
        if (row.state !== "failed")
          throw new CheerkitStoreError(
            "INVALID_STATE",
            "Only failed effects can be retried.",
          );
        await tx.query(
          `UPDATE ${p}effects SET state = 'pending', next_attempt_at = 0 WHERE contribution_id = ? AND name = ?`,
          [contributionId, name],
        );
        return effectSnapshot(
          (await one(
            tx,
            `SELECT * FROM ${p}effects WHERE contribution_id = ? AND name = ?`,
            [contributionId, name],
          ))!,
        );
      });
    },
    getContribution(id: string): Promise<StoredContribution | null> {
      return revealed(async (tx) => {
        const row = await contributionRow(tx, id);
        return row ? snapshot(tx, row) : null;
      });
    },
    getBySubmissionKey(
      submissionKey: string,
    ): Promise<StoredContribution | null> {
      const key =
        typeof submissionKey === "string" && uuid.test(submissionKey)
          ? submissionKey.toLowerCase()
          : submissionKey;
      return revealed(async (tx) => {
        const row = await one(
          tx,
          `SELECT id FROM ${p}contributions WHERE submission_key = ?`,
          [key],
        );
        return row ? snapshot(tx, await requiredRow(tx, String(row.id))) : null;
      });
    },
    async listContributions({
      contextId,
      before,
      status,
      limit = 50,
    }: {
      contextId?: string;
      before?: ContributionCursor;
      status?: ContributionStatus;
      limit?: number;
    } = {}): Promise<readonly StoredContribution[]> {
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (contextId !== undefined && typeof contextId !== "string") ||
        (status !== undefined && !contributionStatuses.includes(status))
      ) {
        throw new CheerkitStoreError(
          "INVALID_STATE",
          "Invalid contribution query.",
        );
      }
      const start =
        before === undefined ? undefined : object(before, "INVALID_CHECKOUT");
      let cursor =
        start === undefined
          ? undefined
          : {
              createdAt: time(start.createdAt),
              id: text(start.id, 128, "INVALID_CHECKOUT"),
            };
      const sealed = await transaction(async (tx) => {
        const result: Sealed[] = [];
        while (result.length < limit) {
          const filters = [
            ...(contextId === undefined ? [] : ["c.context_id = ?"]),
            ...(cursor === undefined
              ? []
              : ["(c.created_at < ? OR (c.created_at = ? AND c.id < ?))"]),
          ];
          const values = [
            ...(contextId === undefined ? [] : [contextId]),
            ...(cursor === undefined
              ? []
              : [cursor.createdAt, cursor.createdAt, cursor.id]),
          ];
          const rows = await tx.query(
            `SELECT c.id, c.created_at, c.outcome, a.state, a.checkout FROM ${p}contributions c
            JOIN ${p}attempts a ON a.contribution_id = c.id AND ${currentAttempt} ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
            ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
            [...values, limit],
          );
          for (const row of rows) {
            if (
              status !== undefined &&
              contributionStatus(row.outcome, row.state, row.checkout) !==
                status
            )
              continue;
            result.push(
              await snapshot(tx, await requiredRow(tx, String(row.id))),
            );
            if (result.length === limit) break;
          }
          if (rows.length < limit) break;
          const last = rows.at(-1)!;
          cursor = { createdAt: String(last.created_at), id: String(last.id) };
        }
        return result;
      });
      const result: StoredContribution[] = [];
      for (const entry of sealed) result.push(await reveal(entry));
      return result;
    },
    getEvent(id: string): Promise<StoredEvent | null> {
      return transaction(async (tx) => {
        const row = await one(tx, `SELECT * FROM ${p}events WHERE id = ?`, [
          id,
        ]);
        return row ? eventSnapshot(row) : null;
      });
    },
    async listEvents({
      state,
      contributionId,
      afterId = "",
      limit = 50,
    }: {
      state?: StoredEvent["state"];
      contributionId?: string;
      afterId?: string;
      limit?: number;
    } = {}): Promise<readonly StoredEvent[]> {
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        typeof afterId !== "string" ||
        (contributionId !== undefined && typeof contributionId !== "string") ||
        (state !== undefined &&
          ![
            "pending",
            "applied",
            "review",
            "unsupported",
            "dismissed",
          ].includes(state))
      ) {
        throw new CheerkitStoreError("INVALID_STATE", "Invalid event query.");
      }
      const filters = [
        "id > ?",
        ...(state === undefined ? [] : ["state = ?"]),
        ...(contributionId === undefined ? [] : ["contribution_id = ?"]),
      ];
      const values = [
        afterId,
        ...(state === undefined ? [] : [state]),
        ...(contributionId === undefined ? [] : [contributionId]),
      ];
      return transaction(async (tx) =>
        (
          await tx.query(
            `SELECT * FROM ${p}events WHERE ${filters.join(" AND ")} ORDER BY id LIMIT ?`,
            [...values, limit],
          )
        ).map(eventSnapshot),
      );
    },
  } satisfies CheerkitStore);
}
