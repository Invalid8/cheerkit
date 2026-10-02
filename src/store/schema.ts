export const CHEERKIT_SCHEMA_VERSION = 3;

export interface SchemaOptions {
  /** Table name prefix; lower-case letters, digits, and underscores. Defaults to `cheerkit_`. */
  readonly prefix?: string;
}

export interface CheerkitMigration {
  readonly version: number;
  readonly sql: string;
}

export function tablePrefix(prefix: unknown = "cheerkit_"): string {
  if (typeof prefix !== "string" || !/^[a-z][a-z0-9_]{0,30}$/.test(prefix)) {
    throw new TypeError(
      "Table prefix must be lower-case letters, digits, or underscores, starting with a letter.",
    );
  }
  return prefix;
}

/**
 * SQL migrations for the host to apply with its own migration process, in order. Each is valid for both
 * Postgres and SQLite. Cheerkit never changes the schema itself; it only checks the recorded version.
 */
export function cheerkitMigrations(
  options: SchemaOptions = {},
): readonly CheerkitMigration[] {
  const p = tablePrefix(options.prefix);
  return [
    {
      version: 1,
      sql: `
CREATE TABLE ${p}meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  version INTEGER NOT NULL,
  installation TEXT,
  organization TEXT,
  environment TEXT
);
INSERT INTO ${p}meta (singleton, version) VALUES (1, 1);

CREATE TABLE ${p}contexts (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  context TEXT NOT NULL
);

CREATE TABLE ${p}contributions (
  id TEXT PRIMARY KEY,
  submission_key TEXT NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL,
  context_id TEXT NOT NULL,
  context_snapshot TEXT NOT NULL,
  intent TEXT NOT NULL,
  created_at TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'confirmed', 'needs_review')),
  supporter_name TEXT,
  message TEXT,
  metadata TEXT,
  personal_data_removed_at TEXT,
  personal_data_removed_by TEXT CHECK (personal_data_removed_by IN ('retention', 'owner', 'supporter'))
);
CREATE INDEX ${p}contributions_context ON ${p}contributions (context_id, created_at);
CREATE INDEX ${p}contributions_created ON ${p}contributions (created_at);

CREATE TABLE ${p}attempts (
  reference TEXT PRIMARY KEY,
  contribution_id TEXT NOT NULL REFERENCES ${p}contributions (id),
  sequence INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared', 'creating', 'available', 'uncertain', 'rejected')),
  checkout_id TEXT UNIQUE,
  checkout TEXT,
  credential TEXT,
  retry_until BIGINT,
  lease_until BIGINT,
  UNIQUE (contribution_id, sequence)
);

CREATE TABLE ${p}events (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'applied', 'review', 'unsupported', 'dismissed')),
  reason TEXT,
  contribution_id TEXT REFERENCES ${p}contributions (id),
  received_at TEXT NOT NULL,
  note TEXT
);
CREATE INDEX ${p}events_state ON ${p}events (state);
CREATE INDEX ${p}events_contribution ON ${p}events (contribution_id);

CREATE TABLE ${p}event_conflicts (
  event_id TEXT NOT NULL REFERENCES ${p}events (id),
  fingerprint TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (event_id, fingerprint)
);

CREATE TABLE ${p}payments (
  charge_id TEXT PRIMARY KEY,
  contribution_id TEXT NOT NULL REFERENCES ${p}contributions (id),
  checkout_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  first_event_id TEXT NOT NULL REFERENCES ${p}events (id)
);
CREATE INDEX ${p}payments_contribution ON ${p}payments (contribution_id);

CREATE TABLE ${p}refunds (
  refund_id TEXT PRIMARY KEY,
  charge_id TEXT NOT NULL REFERENCES ${p}payments (charge_id),
  status TEXT NOT NULL CHECK (status IN ('processing', 'paid', 'failed')),
  requested_amount TEXT NOT NULL,
  refunded_amount TEXT NOT NULL,
  last_event_id TEXT NOT NULL REFERENCES ${p}events (id)
);
CREATE INDEX ${p}refunds_charge ON ${p}refunds (charge_id);

CREATE TABLE ${p}disputes (
  dispute_id TEXT PRIMARY KEY,
  charge_id TEXT NOT NULL REFERENCES ${p}payments (charge_id),
  status TEXT NOT NULL,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  updated_at TEXT,
  last_event_id TEXT NOT NULL REFERENCES ${p}events (id)
);
CREATE INDEX ${p}disputes_charge ON ${p}disputes (charge_id);

CREATE TABLE ${p}owner_records (
  id TEXT PRIMARY KEY,
  contribution_id TEXT NOT NULL REFERENCES ${p}contributions (id),
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('review_accepted', 'external_return')),
  amount TEXT,
  currency TEXT,
  note TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE (contribution_id, sequence)
);

CREATE TABLE ${p}effects (
  contribution_id TEXT NOT NULL REFERENCES ${p}contributions (id),
  name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'running', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at BIGINT NOT NULL,
  lease_until BIGINT,
  last_error TEXT,
  PRIMARY KEY (contribution_id, name)
);
CREATE INDEX ${p}effects_due ON ${p}effects (state, next_attempt_at);
`,
    },
    {
      version: 2,
      sql: `
CREATE TABLE ${p}payment_statements (
  charge_id TEXT PRIMARY KEY REFERENCES ${p}payments (charge_id),
  status TEXT NOT NULL,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  fee_amount TEXT,
  fee_currency TEXT,
  fee_bearer TEXT CHECK (fee_bearer IN ('merchant', 'customer')),
  retrieved_at TEXT NOT NULL,
  CHECK ((fee_amount IS NULL) = (fee_currency IS NULL))
);
UPDATE ${p}meta SET version = 2 WHERE singleton = 1;
`,
    },
    {
      version: 3,
      sql: `
CREATE TABLE ${p}retired_submissions (
  submission_hash TEXT PRIMARY KEY,
  retired_at TEXT NOT NULL
);

CREATE TABLE ${p}retired_identifiers (
  kind TEXT NOT NULL CHECK (kind IN ('reference', 'checkout', 'charge')),
  identifier_hash TEXT NOT NULL,
  retired_at TEXT NOT NULL,
  PRIMARY KEY (kind, identifier_hash)
);

CREATE TABLE ${p}retired_events (
  event_hash TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  retired_at TEXT NOT NULL
);

CREATE TABLE ${p}retired_event_conflicts (
  event_hash TEXT NOT NULL REFERENCES ${p}retired_events (event_hash),
  fingerprint TEXT NOT NULL,
  PRIMARY KEY (event_hash, fingerprint)
);
UPDATE ${p}meta SET version = 3 WHERE singleton = 1;
`,
    },
  ];
}
