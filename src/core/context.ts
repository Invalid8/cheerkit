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
  /** Price of one unit in this currency, when the context counts units. */
  readonly unitPrice?: string;
}

export interface CurrencyRules {
  readonly currency: string;
  readonly fractionDigits: number;
  readonly minimum: string;
  readonly maximum?: string;
  readonly suggestedAmounts: readonly string[];
  readonly unitPrice?: string;
}

export const unitIcons = [
  "coffee",
  "sprout",
  "heart",
  "book",
  "radio",
] as const;

export type UnitIcon = (typeof unitIcons)[number];

/** What supporters count instead of typing money, such as coffees. */
export interface SupportUnit {
  readonly one: string;
  readonly other: string;
  readonly icon: UnitIcon;
  /** Count shown first. */
  readonly start: number;
  /** Highest count offered. */
  readonly max: number;
}

export interface SupportUnitInput {
  readonly one: string;
  readonly other: string;
  readonly icon?: UnitIcon;
  readonly start?: number;
  readonly max?: number;
}

export interface SupportContextInput {
  readonly id: string;
  readonly name: string;
  readonly acceptingContributions?: boolean;
  readonly currencies: readonly CurrencyRulesInput[];
  readonly collectName?: boolean;
  readonly collectMessage?: boolean;
  readonly unit?: SupportUnitInput;
}

export interface SupportContext {
  readonly id: string;
  readonly name: string;
  readonly acceptingContributions: boolean;
  readonly currencies: readonly CurrencyRules[];
  readonly collectName: boolean;
  readonly collectMessage: boolean;
  readonly unit?: SupportUnit;
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
    "unitPrice",
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
  const unitPrice =
    value.unitPrice === undefined
      ? undefined
      : normalizeAmount(value.unitPrice, fractionDigits);
  const rules: CurrencyRules = {
    currency: value.currency,
    fractionDigits,
    minimum,
    ...(maximum === undefined ? {} : { maximum }),
    ...(unitPrice === undefined ? {} : { unitPrice }),
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
  if (unitPrice !== undefined && !isWithinRules(unitPrice, rules)) {
    throw new CheerkitError(
      "INVALID_CONTEXT",
      "One unit must cost an amount within the configured range.",
    );
  }
  return Object.freeze(rules);
}

function count(value: unknown, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 100
  ) {
    throw new CheerkitError(
      "INVALID_CONTEXT",
      `The unit ${label} must be a whole number from 1 to 100.`,
    );
  }
  return value as number;
}

function supportUnit(input: unknown): SupportUnit {
  const value = record(input);
  allowKeys(value, ["one", "other", "icon", "start", "max"]);
  const icon = value.icon ?? "coffee";
  if (!unitIcons.includes(icon as UnitIcon)) {
    throw new CheerkitError(
      "INVALID_CONTEXT",
      `Use one of these unit icons: ${unitIcons.join(", ")}.`,
    );
  }
  const max = count(value.max, 20, "maximum");
  const start = count(value.start, 1, "start");
  if (start > max) {
    throw new CheerkitError(
      "INVALID_CONTEXT",
      "The unit start must not exceed its maximum.",
    );
  }
  return Object.freeze({
    one: requiredText(value.one, 40),
    other: requiredText(value.other, 40),
    icon: icon as UnitIcon,
    start,
    max,
  });
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
    "unit",
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
    ...(value.unit === undefined ? {} : { unit: supportUnit(value.unit) }),
  });
}
