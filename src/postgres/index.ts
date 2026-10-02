import type { CheerkitDatabase, Row } from "../store/database.js";

export type { CheerkitDatabase } from "../store/database.js";

export interface PostgresClientLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
  release(): void;
}

/** Structurally compatible with a `pg` `Pool`; Cheerkit has no runtime dependency on `pg`. */
export interface PostgresPoolLike {
  connect(): Promise<PostgresClientLike>;
}

// Cheerkit's locks use the two-key advisory lock space under this class ID ("CHKT"), which Postgres keeps separate
// from single-key locks, so they cannot collide with an application's own `pg_advisory_xact_lock(n)` calls.
const lockClass = 0x43484b54;

function numbered(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

/**
 * Uses the host's Postgres pool. Transactions take a transaction-scoped advisory lock on the lock key, so Cheerkit
 * writes for one installation are serialized the same way SQLite serializes writers.
 */
export function postgresDatabase(pool: PostgresPoolLike): CheerkitDatabase {
  if (!pool || typeof pool.connect !== "function")
    throw new TypeError(
      "postgresDatabase needs a pg Pool or compatible object.",
    );
  const run = async (
    client: PostgresClientLike,
    sql: string,
    params: readonly unknown[] = [],
  ) => (await client.query(numbered(sql), [...params])).rows;
  return Object.freeze({
    dialect: "postgres" as const,
    async query(sql: string, params?: readonly unknown[]) {
      const client = await pool.connect();
      try {
        return await run(client, sql, params);
      } finally {
        client.release();
      }
    },
    async transaction<T>(
      lockKey: string,
      work: (tx: {
        query(sql: string, params?: readonly unknown[]): Promise<Row[]>;
      }) => Promise<T>,
    ): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        try {
          await client.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
            lockClass,
            lockKey,
          ]);
          const result = await work({
            query: (sql, params) => run(client, sql, params),
          });
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined); // Keep the original failure.
          throw error;
        }
      } finally {
        client.release();
      }
    },
  });
}
