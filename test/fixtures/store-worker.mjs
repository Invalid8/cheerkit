import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import { postgresDatabase } from "cheerkit/postgres";
import { openStore } from "cheerkit/server";
import { sqliteDatabase } from "cheerkit/sqlite";

const [dialect, target, eventId] = process.argv.slice(2);
const connection = JSON.parse(target);
const raw =
  dialect === "sqlite"
    ? new DatabaseSync(connection.filename, { timeout: 5000 })
    : new pg.Pool(connection);
const database =
  dialect === "sqlite" ? sqliteDatabase(raw) : postgresDatabase(raw);
try {
  const store = await openStore({
    database,
    installationId: "test-installation",
    organizationId: "acct_owner",
    environment: "sandbox",
  });
  await store.processEvent(eventId);
} finally {
  if (dialect === "sqlite") raw.close();
  else await raw.end();
}
