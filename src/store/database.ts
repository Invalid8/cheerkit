export type Row = Record<string, unknown>;

/** Runs one statement. Placeholders are written as `?`; adapters translate them for their database. */
export interface SqlExecutor {
  query(sql: string, params?: readonly unknown[]): Promise<Row[]>;
}

/**
 * The host application's own database, as Cheerkit sees it. Cheerkit never opens or creates a database;
 * the host passes its connection through an adapter such as `postgresDatabase` or `sqliteDatabase`.
 */
export interface CheerkitDatabase extends SqlExecutor {
  readonly dialect: "postgres" | "sqlite";
  /**
   * Runs `work` in one transaction, serialized with every other transaction that uses the same `lockKey`.
   * A thrown error rolls the transaction back.
   */
  transaction<T>(
    lockKey: string,
    work: (tx: SqlExecutor) => Promise<T>,
  ): Promise<T>;
}
