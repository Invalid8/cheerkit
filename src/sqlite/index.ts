import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { CheerkitDatabase, Row, SqlExecutor } from "../store/database.js";

export type { CheerkitDatabase } from "../store/database.js";

const queues = new Map<unknown, Promise<unknown>>();

/**
 * Uses the host's own `node:sqlite` connection. Cheerkit's statements are queued per database file for the whole
 * process: `node:sqlite` blocks the thread while waiting for a lock, so two connections in one process must never
 * interleave asynchronous transactions. `BEGIN IMMEDIATE` serializes writers across processes.
 */
export function sqliteDatabase(db: DatabaseSync): CheerkitDatabase {
  if (!db || typeof db.prepare !== "function")
    throw new TypeError("sqliteDatabase needs a node:sqlite DatabaseSync.");
  const run = (sql: string, params: readonly unknown[] = []): Row[] =>
    db.prepare(sql).all(...(params as SQLInputValue[])) as Row[];
  const direct: SqlExecutor = {
    query: async (sql, params) => run(sql, params),
  };
  const file = db.location() ?? db;
  const queued = <T>(work: () => Promise<T>): Promise<T> => {
    const next = (queues.get(file) ?? Promise.resolve()).then(work);
    queues.set(
      file,
      next.catch(() => undefined),
    );
    return next;
  };
  return Object.freeze({
    dialect: "sqlite" as const,
    query: (sql: string, params?: readonly unknown[]) =>
      queued(async () => run(sql, params)),
    transaction: <T>(
      _lockKey: string,
      work: (tx: SqlExecutor) => Promise<T>,
    ): Promise<T> =>
      queued(async () => {
        db.exec("BEGIN IMMEDIATE");
        try {
          const result = await work(direct);
          db.exec("COMMIT");
          return result;
        } catch (error) {
          try {
            db.exec("ROLLBACK");
          } catch {
            /* Keep the original failure. */
          }
          throw error;
        }
      }),
  });
}
