import { amountUnits, normalizeAmount } from "./amount.js";
import { CheerkitError } from "./errors.js";
import {
  allowKeys,
  optionalBoolean,
  record,
  requiredText,
} from "./validation.js";

export interface CurrencyRulesInput {
  readonly currency: string;
  readonly fractionDigits: number;
  readonly minimum: string;
  readonly maximum?: string;
  readonly suggestedAmounts?: readonly string[];
}

export interface CurrencyRules {
  readonly currency: string;
  readonly fractionDigits: number;
  readonly minimum: string;
  readonly maximum?: string;
  readonly suggestedAmounts: readonly string[];
}

export interface SupportContextInput {
  readonly id: string;
  readonly name: string;
  readonly acceptingContributions?: boolean;
  readonly currencies: readonly CurrencyRulesInput[];
  readonly collectName?: boolean;
  readonly collectMessage?: boolean;
}

export interface SupportContext {
  readonly id: string;
  readonly name: string;
  readonly acceptingContributions: boolean;
  readonly currencies: readonly CurrencyRules[];
  readonly collectName: boolean;
  readonly collectMessage: boolean;
}

export function isWithinRules(amount: string, rules: CurrencyRules): boolean {
  const units = amountUnits(amount);
  return (
    units >= amountUnits(rules.minimum) &&
    (rules.maximum === undefined || units <= amountUnits(rules.maximum))
  );
}

function currencyRules(input: unknown): CurrencyRules {
  const value = record(input);
  allowKeys(value, [
    "currency",
    "fractionDigits",
    "minimum",
    "maximum",
    "suggestedAmounts",
  ]);
  if (
    typeof value.currency !== "string" ||
    !/^[A-Z]{3}$/.test(value.currency)
  ) {
    throw new CheerkitError(
      "INVALID_CONTEXT",
      "Use a three-letter uppercase currency code.",
    );
  }
  if (typeof value.fractionDigits !== "number") {
    throw new CheerkitError(
      "INVALID_CONTEXT",
      "Configure the currency precision explicitly.",
    );
  }
  const fractionDigits = value.fractionDigits;
  const minimum = normalizeAmount(value.minimum, fractionDigits);
  const maximum =
    value.maximum === undefined
      ? undefined
      : normalizeAmount(value.maximum, fractionDigits);
  if (maximum !== undefined && amountUnits(minimum) > amountUnits(maximum)) {
    throw new CheerkitError("INVALID_CONTEXT", "Minimum exceeds maximum.");
  }
  const suggestions: unknown =
    value.suggestedAmounts === undefined ? [] : value.suggestedAmounts;
  if (!Array.isArray(suggestions)) {
    throw new CheerkitError(
      "INVALID_CONTEXT",
      "Suggested amounts must be an array.",
    );
  }
  const rules: CurrencyRules = {
    currency: value.currency,
    fractionDigits,
    minimum,
    ...(maximum === undefined ? {} : { maximum }),
    suggestedAmounts: Object.freeze([
      ...new Set(
        suggestions.map((amount: unknown) =>
          normalizeAmount(amount, fractionDigits),
        ),
      ),
    ]),
  };
  if (rules.suggestedAmounts.some((amount) => !isWithinRules(amount, rules))) {
    throw new CheerkitError(
      "INVALID_CONTEXT",
      "Suggested amounts must be within the configured range.",
    );
  }
  return Object.freeze(rules);
}

/** Validate and copy trusted context configuration; no page or slug is required. */
export function defineSupportContext(
  input: SupportContextInput,
): SupportContext {
  const value = record(input);
  allowKeys(value, [
    "id",
    "name",
    "acceptingContributions",
    "currencies",
    "collectName",
    "collectMessage",
  ]);
  if (!Array.isArray(value.currencies) || value.currencies.length === 0) {
    throw new CheerkitError(
      "INVALID_CONTEXT",
      "Configure at least one contribution currency.",
    );
  }
  const currencies = value.currencies.map(currencyRules);
  if (
    new Set(currencies.map((rules) => rules.currency)).size !==
    currencies.length
  ) {
    throw new CheerkitError(
      "INVALID_CONTEXT",
      "Configure each currency only once.",
    );
  }
  return Object.freeze({
    id: requiredText(value.id, 128),
    name: requiredText(value.name, 200),
    acceptingContributions: optionalBoolean(value.acceptingContributions, true),
    currencies: Object.freeze(currencies),
    collectName: optionalBoolean(value.collectName, false),
    collectMessage: optionalBoolean(value.collectMessage, false),
  });
}
