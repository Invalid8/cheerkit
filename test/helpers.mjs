import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import { postgresDatabase } from "@dalgoridim/cheerkit/postgres";
import { cheerkitMigrations, openStore } from "@dalgoridim/cheerkit/server";
import { sqliteDatabase } from "@dalgoridim/cheerkit/sqlite";

function postgresBin() {
  const root = "/usr/lib/postgresql";
  const versions = existsSync(root)
    ? readdirSync(root)
        .filter((name) => /^\d+$/.test(name))
        .sort((a, b) => Number(b) - Number(a))
    : [];
  for (const version of versions)
    if (existsSync(join(root, version, "bin", "initdb")))
      return join(root, version, "bin");
  return spawnSync("which", ["initdb"]).status === 0 ? "" : null;
}

let cluster;
/** A throwaway Postgres cluster in a temporary directory, listening on a Unix socket only; null when Postgres is not installed. */
export function postgresCluster() {
  if (cluster !== undefined) return cluster;
  const bin = postgresBin();
  if (bin === null) return (cluster = null);
  const tool = (name) => (bin ? join(bin, name) : name);
  const directory = mkdtempSync("/tmp/ckpg-");
  const data = join(directory, "data");
  const init = spawnSync(
    tool("initdb"),
    ["-D", data, "-A", "trust", "-U", "@dalgoridim/cheerkit"],
    { encoding: "utf8" },
  );
  if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`);
  const start = spawnSync(
    tool("pg_ctl"),
    [
      "-D",
      data,
      "-w",
      "-l",
      join(directory, "log"),
      "-o",
      `-p 5432 -k ${directory} -c listen_addresses=''`,
      "start",
    ],
    { encoding: "utf8" },
  );
  if (start.status !== 0)
    throw new Error(`pg_ctl start failed: ${start.stderr}`);
  process.on("exit", () => {
    spawnSync(tool("pg_ctl"), ["-D", data, "-m", "immediate", "stop"]);
    rmSync(directory, { recursive: true, force: true });
  });
  return (cluster = {
    host: directory,
    port: 5432,
    user: "@dalgoridim/cheerkit",
  });
}

export const dialects = () =>
  postgresCluster() ? ["sqlite", "postgres"] : ["sqlite"];

/** The host's side: create a database, apply Cheerkit's migrations with the host's own connection. */
export async function hostDatabase(t, dialect, prefix) {
  const migrations = cheerkitMigrations(prefix === undefined ? {} : { prefix });
  if (dialect === "sqlite") {
    const directory = mkdtempSync(join(tmpdir(), "cheerkit-host-"));
    const filename = join(directory, "app.sqlite");
    const connections = [];
    const connect = () => {
      const raw = new DatabaseSync(filename, { timeout: 5000 });
      raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
      connections.push(raw);
      return { raw, database: sqliteDatabase(raw) };
    };
    const first = connect();
    for (const migration of migrations) first.raw.exec(migration.sql);
    t.after(() => {
      for (const raw of connections) if (raw.isOpen) raw.close();
      rmSync(directory, { recursive: true, force: true });
    });
    return {
      dialect,
      connect,
      filename,
      directory,
      close: (connection) => connection.raw.close(),
    };
  }
  const server = postgresCluster();
  const name = `t_${Math.random().toString(36).slice(2, 12)}`;
  const admin = new pg.Client({ ...server, database: "postgres" });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const pools = [];
  const connect = () => {
    const raw = new pg.Pool({ ...server, database: name, max: 4 });
    pools.push(raw);
    return { raw, database: postgresDatabase(raw) };
  };
  const first = connect();
  for (const migration of migrations) await first.raw.query(migration.sql);
  t.after(async () => {
    for (const pool of pools) if (!pool.ended) await pool.end();
    const cleanup = new pg.Client({ ...server, database: "postgres" });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await cleanup.end();
  });
  return {
    dialect,
    connect,
    connection: { ...server, database: name },
    close: (connection) => connection.raw.end(),
  };
}

export async function testStore(host, connection, options = {}) {
  return openStore({
    database: connection.database,
    installationId: "test-installation",
    organizationId: "acct_owner",
    environment: "sandbox",
    ...options,
  });
}
