import { CheerkitError } from "./errors.js";
import { record } from "./validation.js";

export type MetadataValue = string | number | boolean;
export type ContributionMetadata = Readonly<Record<string, MetadataValue>>;

const maxEntries = 20;
const maxText = 500;
const maxSerialized = 4096;

/**
 * Validate application metadata: a flat object of at most 20 lower-case keys whose values are short text, finite
 * numbers, or booleans. It is stored privately beside the contribution and never replaces amount, currency,
 * attribution, payment identity, or status.
 */
export function validateMetadata(value: unknown): ContributionMetadata {
  if (value === undefined) return Object.freeze({});

  const input = record(value);
  const entries = Object.entries(input) as [string, MetadataValue][];

  if (entries.length > maxEntries)
    throw new CheerkitError("INVALID_INPUT", "Metadata has too many entries.");

  for (const [key, entry] of entries) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key))
      throw new CheerkitError(
        "INVALID_INPUT",
        "Metadata keys must be short lower-case identifiers.",
      );

    const valid =
      typeof entry === "boolean" ||
      (typeof entry === "number" && Number.isFinite(entry)) ||
      (typeof entry === "string" && entry.length <= maxText);

    if (!valid)
      throw new CheerkitError(
        "INVALID_INPUT",
        "Metadata values must be short text, finite numbers, or booleans.",
      );
  }

  if (JSON.stringify(input).length > maxSerialized)
    throw new CheerkitError("INVALID_INPUT", "Metadata is too large.");

  return Object.freeze(
    Object.fromEntries(
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  );
}
