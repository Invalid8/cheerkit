# Guide

How to set Cheerkit up, take payments, give the owner an admin, and run it. Every option and route is listed in the [reference](reference.md).

1. [Database](#database)
2. [Bachs account](#bachs-account)
3. [What people can support](#what-people-can-support)
4. [Serving the API](#serving-the-api)
5. [The supporter's page](#the-supporters-page)
6. [Webhooks and background work](#webhooks-and-background-work)
7. [An owner admin](#an-owner-admin)
8. [When something goes wrong](#when-something-goes-wrong)
9. [Personal data](#personal-data)
10. [Going live and running it](#going-live-and-running-it)

## Database

Cheerkit keeps its tables in your application's database and never creates, alters, or drops anything at runtime.

1. Get the migrations and apply them with your own tool, inside its transaction:

   ```ts
   import { cheerkitMigrations } from "cheerkit/server";

   const migrations = cheerkitMigrations({ prefix: "cheerkit_" }); // versions 1–3
   ```

   The SQL runs on both Postgres and SQLite. It has no `IF NOT EXISTS`, so a clash with one of your tables fails instead of taking it over.

2. Pass your connection through an adapter:

   ```ts
   import { postgresDatabase } from "cheerkit/postgres";
   const database = postgresDatabase(pool); // your pg Pool

   import { sqliteDatabase } from "cheerkit/sqlite";
   const database = sqliteDatabase(new DatabaseSync("app.sqlite")); // a DatabaseSync used only by Cheerkit
   ```

   For SQLite, enable `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`, and a busy timeout, and give Cheerkit its own `DatabaseSync` object so your statements never land inside its transactions.

3. Open the store:

   ```ts
   const store = await openStore({
     database,
     installationId: "my-site",
     organizationId,
     environment: "live",
   });
   ```

   The first open binds the tables to that installation, Bachs organization, and environment; opening them with other values is refused. Use a separate database or prefix for sandbox and live.

**Upgrading.** A release that changes the schema adds a migration. Apply the new ones before deploying; `openStore` refuses a database at another version.

## Bachs account

You need, per environment:

| What             | Where it goes                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Organization ID  | `organizationId` everywhere                                                                                                           |
| Secret key       | `createBachsCheckoutClient` or `createBachsClient`. Scopes: `payments:write` (checkouts), `payments:read` (recovery, payment details) |
| Webhook endpoint | `https://your-site/<basePath>/webhooks/bachs`, registered in Bachs                                                                    |
| Webhook secret   | `createBachsWebhookVerifier`                                                                                                          |

Keys start with `sk_sandbox_` or `sk_live_` and must match `environment`. Keep all of them in your host's secret store.

## What people can support

A **context** is one thing people can support, with its own currencies and limits. A contribution records which context it was for.

```ts
await store.syncContext({
  id: "coffee",
  name: "Coffee", // internal name, never shown publicly
  collectName: true, // off by default
  collectMessage: true, // off by default
  currencies: [
    {
      currency: "NGN",
      fractionDigits: 2,
      minimum: "1500",
      maximum: "100000",
      suggestedAmounts: ["1500", "3000", "4500"],
    },
    {
      currency: "USD",
      fractionDigits: 2,
      minimum: "2",
      suggestedAmounts: ["2", "4", "6"],
    },
  ],
});
```

- Amounts are decimal strings, never numbers. Precision is per currency; excess precision is rejected, not rounded.
- Currencies are never converted or added together.
- `syncContext` suits contexts defined in code: it creates the context, or updates its rules while keeping the owner's pause (`acceptingContributions`). Use `putContext` with a revision for edits made elsewhere.

## Serving the API

```ts
const service = createSupportService({
  store,
  checkout,
  webhooks,
  resultSecret,
  retention: { supporterDataDays: 30, paymentRecordYears: 6 },
});
const handle = createSupportHandler(service, {
  basePath: "/api/support",
  allowedOrigins: ["https://my-site.example"],
  clientKey: (request) => trustedClientAddress(request),
});
```

`handle(request: Request): Promise<Response>` works as-is in Fetch-based hosts:

```ts
// Next.js: app/api/support/[...path]/route.ts
export const GET = handle;
export const POST = handle;
export const PUT = handle;
```

On plain Node, convert the incoming request to a `Request` (see `examples/http-node.mjs`).

- `allowedOrigins`: exact HTTPS origins of your site (or `localhost`). Other sites cannot start contributions or send owner changes.
- `clientKey`: the caller's address for rate limiting. Use the socket address, or a header your own proxy overwrites; never a forwarding header the client can set.
- `resultSecret`: 32+ random characters. Rotating it invalidates existing result links.
- `retention.supporterDataDays` removes supporter name, message, and metadata after that many days.
- `retention.paymentRecordYears` is optional. When set, settled payment records older than that many calendar years are deleted. Six years is configured above; omit the option to keep financial records indefinitely.

## The supporter's page

The page needs four calls. `examples/ui` has a full page, a modal, and a result page to copy.

1. **Read the rules**: `GET /contexts/:id` returns currencies, suggested amounts, limits, which fields to show, and who pays the fee.
2. **Start**: `POST /contributions` with `{ contextId, submissionKey, submission: { amount, currency, supporterName?, message? }, metadata? }`. Returns `{ contribution, resultToken, expiresAt }`; send the supporter to `contribution.checkoutUrl`.
3. **Retry safely**: create the `submissionKey` once (a random UUID) and keep it in `sessionStorage`. Repeating the request, or `POST /contributions/resume` with `{ submissionKey }`, continues the same contribution instead of creating another.
4. **Show the result**: `POST /contributions/status` with `{ contributionId, resultToken }` until the outcome is final.

| Outcome        | Show                                                |
| -------------- | --------------------------------------------------- |
| `pending`      | Waiting for confirmation; ask them not to pay again |
| `confirmed`    | Thanks                                              |
| `unsuccessful` | Nothing was paid; offer to try again (resume)       |
| `needs_review` | The payment is being checked                        |
| `refunded`     | Refunded                                            |

Rules to keep in any UI:

- Returning from Bachs is not proof of payment. Only the status call is.
- Keep the result token in the request body, never in a URL.
- Never keep the name or message in browser storage; the submission key is enough to resume.
- Offer "remove my name and message" with `POST /contributions/remove-data`.

## The ready-made support template

If you don't want to build the page yourself, use `<cheerkit-support>`, a web component that works on any site (plain HTML or any framework). It calls the same routes, follows the rules below, and keeps its styles separate from your page's.

```html
<script type="module">
  import "cheerkit/ui/define";
  for (const element of document.querySelectorAll("cheerkit-support"))
    element.config = {
      name: "Kemi Lawal",
      avatar: "/kemi.jpg",
      tagline: "Writes Field Notes, a weekly letter",
      title: "Buy Kemi a coffee",
      description:
        "If a letter helped you, a coffee keeps the next one coming.",
      amountNotes: ["1 coffee", "2 coffees", "5 coffees"],
    };
</script>

<button data-cheerkit-open="coffee">Buy me a coffee</button>
<cheerkit-support
  api="/api/support"
  context="coffee"
  layout="dialog"
  color="#2f6b3f"
></cheerkit-support>
```

- **Loading it:** with a bundler, `import "cheerkit/ui/define"`. Without one, serve the files in `node_modules/cheerkit/dist/ui/` from your site and import `define.js` by its path (`examples/ui/template.html` does this).
- **Where it shows:** `layout="page"` or `"inline"` renders in place; `layout="dialog"` opens from any element with `data-cheerkit-open="<context>"` or from `element.open()`.
- **After checkout:** put `<cheerkit-support … view="result">` on the page your Bachs success URL points to. It checks the payment, thanks the supporter, and lets them remove their name and message.
- **Your colour:** `color="#…"` sets the theme colour; text on it switches between white and near-black to stay readable. `theme="dark"` or `theme="system"` turns on dark mode (light by default). Every colour, the font, corner radius, and border width can also be set from your CSS (`cheerkit-support { --ck-color-primary: …; }`) or `config.appearance.variables`. The browser console warns once if the primary color and its text fall below a 4.5:1 contrast ratio.
- **Your words:** every label and message can be changed through `config.text`; amounts are formatted for `config.locale`.
- **Finer styling:** named parts (`card`, `header`, `avatar`, `title`, `amount`, `input`, `button`, …) can be styled with `::part()`.
- **Your own UI on the same logic:** `createSupport({ api, contextId })` from `cheerkit/ui` gives the state and actions the template uses.

The browser keeps only a random submission key and the result token, in `sessionStorage`, never the name, message, or amount. Currencies, amounts, and which fields appear come from the context on the server, so a context with one currency shows no currency switch.

For a local check under an enforcing Content Security Policy, run `npm run dev` and open `/strict.html`. It loads both templates with external scripts and styles, `style-src-attr 'none'`, and Trusted Types required for script sinks. Check the browser console for policy violations while using the support form and signing into the demo admin.

## Webhooks and background work

Bachs posts payment events to `/webhooks/bachs`. The handler verifies the signature on the original bytes, stores the event, processes it, and answers 200 only after that. Redeliveries are recognised and never counted twice.

Some events arrive before the contribution they belong to is ready, and post-payment effects and retention need regular runs. Choose one:

- **A long-running server:** `startPendingWorker(service, { intervalMs: 60_000, pageSize: 50, maxPages: 20 })`.
- **Serverless:** call `runPendingPass(service, { pageSize, maxPages })`, `service.runEffects({ limit })`, and `service.applyRetention()` from a scheduled route.

The worker applies both retention rules on every pass. Payment records are purged only when the contribution is settled and has no pending/review webhook, processing refund, open dispute, or incomplete post-payment effect. Eligible records are deleted together in one transaction. Cheerkit retains one-way hashes of old submission keys, provider references, checkout IDs, charge IDs, and webhook IDs so retries or replays cannot recreate expired records. These tombstones contain no amounts, supporter data, or raw provider identifiers and stay in the database backups. A webhook that matches a retired identifier is acknowledged as `retired` and not processed again.

**Post-payment effects** (a thank-you email, for example): name them on the store (`effects: ["thank-you"]`) and give the service a handler for each. An effect runs at least once after confirmation, retries with backoff, and never changes the payment. Use its `id` as the idempotency key in the other system.

## An owner admin

Owner operations need the host's own sign-in: `authorizeOwner(request)` must return literally `true`.

**Inside the website.** Pass `authorizeOwner` to `createSupportService`; the same handler then serves `/owner/*`.

**As a separate app** (a local admin, an internal tool): it needs only the store and the account's key.

```ts
import { createBachsClient } from "cheerkit/bachs";
import {
  createOwnerHandler,
  createOwnerService,
  openStore,
} from "cheerkit/server";

const store = await openStore({
  database,
  installationId: "my-site",
  organizationId,
  environment: "live",
});
const owner = createOwnerService({
  store,
  bachs: createBachsClient({ organizationId, environment: "live", secretKey }),
  authorizeOwner: (request) => isSignedInOwner(request),
});
const handle = createOwnerHandler(owner, {
  basePath: "/api/support",
  allowedOrigins: ["http://localhost:4180"],
});
```

No webhook secret, result secret, or return URLs are needed; webhooks keep going to the website. `examples/ui/owner.html` is a complete admin page to copy.

What an admin shows, all from the owner routes:

| Show                    | From                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Totals                  | `GET /owner/summary`: `confirmedTotals` (paid, after refunds and returns), per currency, and counts per status         |
| Contribution list       | `GET /owner/contributions?status=&contextId=&limit=`; page on with `beforeCreatedAt` and `beforeId` from the last item |
| Status                  | `status` on each contribution (see the [reference](reference.md#contribution-status))                                  |
| Fee                     | `payments[].fee`: `charged` with amount and currency, `none`, or `unreported`                                          |
| What Bachs credited     | `payments[].settlement`, when the notice reported it                                                                   |
| What the supporter paid | `payments[].statement.amount` and `currency`, after refreshing payment details                                         |

And the actions, each shown only when it applies:

| Action                               | When                                                    |
| ------------------------------------ | ------------------------------------------------------- |
| Accept (`accept-review`)             | `needs_review` with a recorded payment                  |
| Retry (`retry`), recover (`recover`) | `checkout_unresolved`                                   |
| Refresh payment details              | Any recorded payment                                    |
| Record a return (`external-returns`) | Money returned outside Bachs                            |
| Remove personal data                 | The contribution still has a name, message, or metadata |
| Check an event again (`recheck`)     | An event in review or dismissed                         |
| Dismiss an event                     | An event that belongs to another site                   |
| Pause or resume a context            | `PUT /owner/contexts/:id` with the revision             |

### The ready-made admin

`<cheerkit-admin>` is a complete owner admin for any site: contributions with totals, status filters and a detail panel with every owner action, unmatched notices, contexts, follow-up actions, and export. Put it on a page only the owner can reach; it calls the `/owner/*` routes with the browser's own cookies, and Cheerkit still refuses every request `authorizeOwner` doesn't approve.

It shares the support template's appearance settings and warns once in the browser console if the primary color and its text fall below a 4.5:1 contrast ratio.

```html
<cheerkit-admin api="/api/support" color="#1c2b4a">
  <a slot="sign-in" href="/login">Sign in</a>
</cheerkit-admin>
<script type="module">
  import "cheerkit/ui/define";
  document.querySelector("cheerkit-admin").config = { siteName: "Field Notes" };
</script>
```

- Signed out (401 or 403), it shows a sign-in message and whatever you put in the `sign-in` slot, never data.
- Removing personal data and dismissing a notice ask for confirmation; dismissals and decisions need a note.
- Context edits use the revision check: if someone else saved first, nothing is overwritten and the owner is asked to load the latest settings.
- It uses the same colour, theme, wording (`config.text`), and CSS variables as the support template. `config.screens` chooses which screens appear.
- On narrow screens the navigation becomes a picker and tables become labelled cards.
- To build your own admin instead, `createOwnerClient({ api })` from `cheerkit/ui` gives typed calls for every owner route.

## When something goes wrong

| Situation                                              | Do                                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| The checkout request timed out (`checkout_unresolved`) | Retry within 23 hours with the same key: the exact request is resent and Bachs returns the original checkout |
| Still unresolved after 23 hours or a key change        | Find the checkout ID in Bachs and recover it; Cheerkit checks it against the stored request                  |
| `needs_review`                                         | Check the payment in Bachs, then accept it or record the money you returned                                  |
| An event waits for a checkout that is not here         | Usually another site on the same account: dismiss it with a note (reopen undoes it)                          |
| An event was reviewed under older rules                | Check it again                                                                                               |
| A fee or settlement is missing                         | Refresh payment details; Bachs's payment record often has the fee when the notice did not                    |
| A payment is in Bachs but not here                     | Recover the checkout if needed, then resend the charge's notices from Bachs; replays are deduplicated        |

Never delete an unresolved attempt or start a new submission to clear it.

## Personal data

The site owner is the data controller; Cheerkit sends nothing to its authors.

| Data                                         | Stored                                                            | Kept                                              |
| -------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------- |
| Display name and message (if collected)      | `contributions`                                                   | Until retention, or removal by supporter or owner |
| Your metadata (must not be personal)         | `contributions`                                                   | As above                                          |
| Amount, currency, time, outcome, context     | `contributions`, `attempts`                                       | Life of the installation, or `paymentRecordYears` |
| Bachs identifiers, amounts, fees, settlement | `payments`, `refunds`, `disputes`, `events`, `payment_statements` | Same as above                                     |
| Dedupe hashes after payment-record expiry    | `retired_submissions`, `retired_identifiers`, `retired_events`    | Kept in the database to block old retries/replays |
| Payer email, name, phone, address            | Never: removed before anything is written                         | —                                                 |
| IP addresses                                 | Never: rate limiting is in memory                                 | —                                                 |

- **Retention** (`retention.supporterDataDays`, required) removes name, message, and metadata. Optional `paymentRecordYears` deletes settled payment details after the configured number of calendar years, retaining only irreversible dedupe hashes. Records with open disputes, unresolved events, processing refunds, or unfinished effects wait until resolved.
- **Supporters** read or remove their own name and message with their result token.
- **The owner** removes one contribution's personal data, or exports everything (`GET /owner/export`).
- **Encryption at rest:** pass `encryptionKey` (32 random bytes, base64url) to `openStore` to store name, message, and metadata with AES-256-GCM.

## Going live and running it

**Before the first live payment:**

1. Apply the migrations to the production database.
2. Set the live key, organization ID, webhook secret, result secret, and (if used) encryption key in your host's secrets.
3. Register the live webhook endpoint in Bachs.
4. Schedule background work (worker or cron).
5. Make one small real contribution and check it end to end.

**Routinely** (`GET /owner/summary`): review contributions and events in review, retry or recover unresolved checkouts, respond to open disputes in Bachs, fix and retry failed effects.

**Rotating secrets.** New API key: restart; unresolved attempts from the old key can then only be recovered by checkout ID. Webhook secret: switch when Bachs signs with the new one. Result secret: existing result links stop working.

**Backups.** The tables are part of your database backups. After a restore, resend Bachs events from the backup time; duplicates are ignored.

**Logs.** Cheerkit reports codes and counts only (`onError`, `onRefusal`, worker callbacks). Never log request bodies, tokens, submission keys, messages, metadata, or Bachs responses.
