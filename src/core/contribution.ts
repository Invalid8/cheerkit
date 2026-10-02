import { normalizeAmount } from "./amount.js";
import {
  defineSupportContext,
  isWithinRules,
  type SupportContext,
} from "./context.js";
import { CheerkitError } from "./errors.js";
import { allowKeys, record, requiredText } from "./validation.js";

/** These values come from the trusted host, never from the supporter request. */
export interface ContributionIdentity {
  readonly id: string;
  readonly createdAt: string;
}

export interface PendingContribution {
  readonly id: string;
  readonly contextId: string;
  readonly amount: string;
  readonly currency: string;
  readonly fractionDigits: number;
  readonly status: "pending";
  readonly createdAt: string;
  readonly supporterName?: string;
  readonly message?: string;
}

function optionalText(
  value: unknown,
  limit: number,
  enabled: boolean,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > limit) {
    throw new CheerkitError(
      "INVALID_INPUT",
      "Optional text must be within the length limit.",
    );
  }
  const text = value.trim();
  if (!text) return undefined;
  if (!enabled) {
    throw new CheerkitError(
      "FIELD_DISABLED",
      "This context does not collect that supporter field.",
    );
  }
  return text;
}

/**
 * Validate an untrusted supporter submission against trusted context rules.
 * Returns an immutable pending value. Does not persist, deduplicate, start
 * checkout, verify a provider event, or establish payment success.
 */
export function createContributionIntent(
  context: SupportContext,
  submission: unknown,
  identity: ContributionIdentity,
): PendingContribution {
  // Revalidate deserialized contexts too; TypeScript types are not runtime proof.
  const rules = defineSupportContext(context);
  if (!rules.acceptingContributions) {
    throw new CheerkitError(
      "CONTEXT_CLOSED",
      "This context is not accepting new contributions.",
    );
  }
  const input = record(submission);
  allowKeys(input, ["amount", "currency", "supporterName", "message"]);
  const currency = rules.currencies.find(
    (entry) => entry.currency === input.currency,
  );
  if (!currency) {
    throw new CheerkitError(
      "UNSUPPORTED_CURRENCY",
      "Choose a currency enabled for this context.",
    );
  }
  const amount = normalizeAmount(input.amount, currency.fractionDigits);
  if (!isWithinRules(amount, currency)) {
    throw new CheerkitError(
      "AMOUNT_OUT_OF_RANGE",
      "Choose an amount within the configured range.",
    );
  }

  const host = record(identity);
  allowKeys(host, ["id", "createdAt"]);
  const id = requiredText(host.id, 128);
  const createdAt = host.createdAt;
  if (
    typeof createdAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt) ||
    !Number.isFinite(Date.parse(createdAt)) ||
    new Date(createdAt).toISOString() !== createdAt
  ) {
    throw new CheerkitError(
      "INVALID_INPUT",
      "Use a canonical UTC timestamp from the host clock.",
    );
  }
  const supporterName = optionalText(
    input.supporterName,
    120,
    rules.collectName,
  );
  const message = optionalText(input.message, 2000, rules.collectMessage);
  return Object.freeze({
    id,
    contextId: rules.id,
    amount,
    currency: currency.currency,
    fractionDigits: currency.fractionDigits,
    status: "pending",
    createdAt,
    ...(supporterName === undefined ? {} : { supporterName }),
    ...(message === undefined ? {} : { message }),
  });
}
