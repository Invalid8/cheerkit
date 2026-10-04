import { DatabaseSync } from "node:sqlite";
import { createBachsClient } from "@dalgoridim/cheerkit/bachs";
import { openStore } from "@dalgoridim/cheerkit/server";
import { sqliteDatabase } from "@dalgoridim/cheerkit/sqlite";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

const environment = required("CHEERKIT_ENVIRONMENT");
if (environment !== "sandbox" && environment !== "live")
  throw new Error("CHEERKIT_ENVIRONMENT must be sandbox or live.");

const database = new DatabaseSync(required("CHEERKIT_SQLITE_FILE"));
const organizationId = required("BACHS_ORGANIZATION_ID");
const store = await openStore({
  database: sqliteDatabase(database),
  installationId: required("CHEERKIT_INSTALLATION_ID"),
  organizationId,
  environment,
});

export default {
  store,
  bachs: createBachsClient({
    organizationId,
    environment,
    secretKey: required("BACHS_SECRET_KEY"),
  }),
  siteName: process.env.CHEERKIT_SITE_NAME ?? "My site",
  close: () => database.close(),
};
