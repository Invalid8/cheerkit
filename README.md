# Cheerkit

One-off support payments ("buy me a coffee") inside an application you already run. You build the page and bring your payment provider account; Cheerkit records each contribution, confirms it only from the provider's signed webhooks, and gives the owner the tools to check, recover, and export it.

Supported provider: [Bachs](https://bachs.io). More are planned; see the [overview](docs/overview.md).

- **Your UI.** Cheerkit is headless: a JSON API, plus framework-free examples to copy.
- **Your data.** Tables live in your own Postgres or SQLite database, created by migrations you apply. Payer details from the provider are never stored.
- **Correct payments.** Exact decimal amounts, no double counting, no confirmation from browser redirects, and a review queue for anything that does not match.
- **No service.** Each website runs its own copy with its own provider account. Nothing is sent anywhere else.

## Requirements

- Node.js 24 or later.
- Postgres (through your `pg` pool) or SQLite (`node:sqlite`).
- A payment provider account. For Bachs: an API key with `payments:write` and `payments:read`, and a webhook endpoint with its signing secret.

## Install

```sh
npm install cheerkit
```

## Quick start

1. Apply the migrations with your own migration tool:

   ```ts
   import { cheerkitMigrations } from "cheerkit/server";

   for (const { version, sql } of cheerkitMigrations()) {
     // Save each as a migration file, in order.
   }
   ```

2. Create the service once, on the server:

   ```ts
   import {
     createBachsCheckoutClient,
     createBachsWebhookVerifier,
   } from "cheerkit/bachs";
   import { postgresDatabase } from "cheerkit/postgres";
   import {
     createSupportHandler,
     createSupportService,
     openStore,
     startPendingWorker,
   } from "cheerkit/server";

   const scope = {
     organizationId: env.BACHS_ACCOUNT_ID,
     environment: "live",
   } as const;

   const store = await openStore({
     ...scope,
     installationId: "my-site",
     database: postgresDatabase(pool),
   });
   await store.syncContext({
     id: "coffee",
     name: "Coffee",
     collectName: true,
     collectMessage: true,
     currencies: [
       {
         currency: "NGN",
         fractionDigits: 2,
         minimum: "1500",
         suggestedAmounts: ["1500", "3000"],
       },
     ],
   });

   const service = createSupportService({
     store,
     checkout: createBachsCheckoutClient({
       ...scope,
       secretKey: env.BACHS_SECRET_KEY,
       successUrl: "https://my-site.example/coffee?return=1",
       cancelUrl: "https://my-site.example/coffee",
     }),
     webhooks: createBachsWebhookVerifier({
       ...scope,
       secret: env.BACHS_WEBHOOK_SECRET,
     }),
     resultSecret: env.CHEERKIT_RESULT_SECRET,
     retention: { supporterDataDays: 30 },
   });

   export const handle = createSupportHandler(service, {
     basePath: "/api/support",
     allowedOrigins: ["https://my-site.example"],
     clientKey: (request) => trustedClientAddress(request),
   });

   startPendingWorker(service, {
     intervalMs: 60_000,
     pageSize: 50,
     maxPages: 20,
   });
   ```

3. Route `/api/support/*` to `handle` (it takes a `Request` and returns a `Response`), and register `https://my-site.example/api/support/webhooks/bachs` as the webhook URL in Bachs.

4. From your page, start a contribution and send the supporter to the provider's checkout:

   ```js
   const submissionKey = crypto.randomUUID(); // keep it for retries
   const response = await fetch("/api/support/contributions", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({
       contextId: "coffee",
       submissionKey,
       submission: { amount: "3000", currency: "NGN" },
     }),
   });
   const { contribution, resultToken } = await response.json();
   location.assign(contribution.checkoutUrl);
   ```

   When they come back, poll `POST /api/support/contributions/status` with `{ contributionId, resultToken }` until the outcome is `confirmed`.

`env`, `pool`, and `trustedClientAddress` are yours. A runnable version with a fake Bachs is in [`examples/`](examples/).

## Package

| Import                        | For                                                                                                   | In browsers |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- | ----------- |
| `cheerkit`                    | Contexts, amounts, intents, metadata validation                                                       | Yes         |
| `cheerkit/bachs`              | Bachs provider: clients and webhook verification                                                      | No          |
| `cheerkit/postgres`           | Adapter for a `pg` pool (no dependency on `pg`)                                                       | No          |
| `cheerkit/sqlite`             | Adapter for a `node:sqlite` database                                                                  | No          |
| `cheerkit/server`             | Migrations, store, services, HTTP handlers, background worker                                         | No          |
| `cheerkit/server/local-admin` | Local loopback-only admin runner (`startLocalAdmin`)                                                  | No          |
| `cheerkit/ui`                 | Ready-made templates (`<cheerkit-support>`, `<cheerkit-admin>`), `createSupport`, `createOwnerClient` | Only        |

The `cheerkit-admin` executable starts the local admin from a host-owned config module; see [the guide](docs/guide.md#run-the-same-admin-on-your-computer).

## Documentation

- [Overview](docs/overview.md): what Cheerkit does, where it stands, and what is planned.
- [Guide](docs/guide.md): setting up, taking payments, building an owner admin, and running in production.
- [Reference](docs/reference.md): every export, option, route, status, and error code.
- [Changelog](CHANGELOG.md).

## Licence

[MIT](LICENSE)
