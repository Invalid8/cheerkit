# Reference

Everything Cheerkit exports, by import path. For how to put it together, see the [guide](guide.md).

- [`cheerkit`](#cheerkit)
- [`cheerkit/bachs`](#cheerkitbachs)
- [`cheerkit/postgres` and `cheerkit/sqlite`](#cheerkitpostgres-and-cheerkitsqlite)
- [`cheerkit/server`](#cheerkitserver): [migrations](#migrations), [store](#store), [support service](#support-service), [owner service](#owner-service), [HTTP handlers](#http-handlers), [routes](#routes), [background work](#background-work)
- [`cheerkit/ui`](#cheerkitui): [`<cheerkit-support>`](#cheerkit-support), [`createSupport`](#createsupportoptions), [`<cheerkit-admin>`](#cheerkit-admin), [`createOwnerClient`](#createownerclientoptions)
- [Contribution status](#contribution-status)
- [Payments: fee, settlement, statement](#payments-fee-settlement-statement)
- [Errors](#errors)

## `cheerkit`

Safe in browsers.

| Export                                                             | Does                                                                                                                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defineSupportContext(input)`                                      | Validates and freezes a context: `id`, `name`, `currencies`, `acceptingContributions` (default `true`), `collectName` and `collectMessage` (default `false`), `unit?` |
| `createContributionIntent(context, submission, { id, createdAt })` | Validates a supporter's submission against the context; returns a pending intent with a normalized amount                                                             |
| `validateMetadata(value)`                                          | Checks application metadata: at most 20 keys matching `^[a-z][a-z0-9_]{0,39}$`, values text (≤ 500 characters), finite numbers, or booleans, ≤ 4 KiB in total         |
| `normalizeAmount(value, fractionDigits)`                           | Normalizes a positive decimal string to the currency's precision; rejects excess precision instead of rounding                                                        |
| `CheerkitError`                                                    | Validation failure with a `code` ([errors](#errors))                                                                                                                  |

**Currency rules:** `{ currency, fractionDigits (0–18), minimum, maximum?, suggestedAmounts?, unitPrice? }`. Amounts are decimal strings; limits are inclusive; suggestions and one unit's price must fall inside them.

**Unit:** `{ one, other, icon? (coffee, sprout, heart, book, radio; default coffee), start? (default 1), max? (default 20) }`. Counts are whole numbers from 1 to 100, and `start` may not exceed `max`. The public context includes the unit, and each currency its `unitPrice`.

**Submission:** `{ amount, currency, supporterName? (≤ 120), message? (≤ 2,000) }`. Anything else is rejected; name and message are refused unless the context collects them.

## `cheerkit/bachs`

Server only.

### `createBachsCheckoutClient(options)`

What a website needs: the account client below, plus preparation of new checkouts.

| Option                    | Meaning                                                               |
| ------------------------- | --------------------------------------------------------------------- |
| `secretKey`               | `sk_sandbox_…` or `sk_live_…`, matching `environment`                 |
| `organizationId`          | The Bachs organization; must match the store and the webhook verifier |
| `environment`             | `"sandbox"` (default) or `"live"`                                     |
| `successUrl`, `cancelUrl` | HTTPS return URLs                                                     |
| `feeBearer`               | `"merchant"` (default), `"customer"`, or `"account_default"`          |
| `paymentMethodTypes`      | Optional list such as `["NGN_BANK_TRANSFER"]`                         |
| `timeoutMs`               | Per request, default 15,000                                           |
| `fetch`                   | Optional transport, for tests or logging response status              |

Adds to the account client: `feeBearer` and `prepareCheckout(intent, { reference, idempotencyKey })`, which builds the exact request without sending it. Only the amount, currency, reference, return URLs, fee setting, and payment methods are sent to Bachs, never the supporter's name, message, or metadata.

### `createBachsClient(options)`

The account-level client, for an owner app: `secretKey`, `organizationId`, `environment`, `timeoutMs`, `fetch`.

| Member                                   | Does                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `createCheckout(prepared)`               | Sends a stored request once; no automatic retry                        |
| `retrieveCheckout(checkoutId, prepared)` | Reads a checkout and verifies it against the stored request (recovery) |
| `retrievePayment(chargeId)`              | Reads Bachs's current record of a charge; payer details are discarded  |
| `resendChargeNotices(chargeId)`          | Asks Bachs to deliver a charge's webhook notices again                 |
| `credentialFingerprint()`                | SHA-256 of the key, used to scope retries                              |
| `retryWindowMs`                          | 23 hours: how long a stored request may be resent with the same key    |

### `createBachsWebhookVerifier(options)`

`{ secret, organizationId, environment, toleranceSeconds? (≤ 300, default 300), maxBodyBytes? (default 1 MiB) }`.

`verify(rawBody, { signatureV2, signature, timestamp })` authenticates the original bytes and returns the event. V2 signatures take precedence; any matching signature passes, which allows key rotation. Events for another organization or a connected account are refused.

### Lower level

`assessBachsCollection(event, expected)` and `checkoutPaidAsIntended(event, expected)` match a verified event to a known checkout without recording anything. The store uses them; you rarely need them.

## `cheerkit/postgres` and `cheerkit/sqlite`

| Export                   | Takes                                                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgresDatabase(pool)` | Anything shaped like a `pg` `Pool`. Each transaction holds a two-key advisory lock that cannot collide with your own `pg_advisory_xact_lock(n)` |
| `sqliteDatabase(db)`     | A `node:sqlite` `DatabaseSync` used only by Cheerkit                                                                                            |

Both return a `CheerkitDatabase`: `query(sql, params)` and `transaction(lockKey, work)`.

## `cheerkit/server`

Server only.

### Migrations

`cheerkitMigrations({ prefix? })` returns `[{ version, sql }]` in order, for your migration tool. `CHEERKIT_SCHEMA_VERSION` is the version this release expects (3).

| Version | Adds                                                                                           |
| ------- | ---------------------------------------------------------------------------------------------- |
| 1       | Contexts, contributions, attempts, events, payments, refunds, disputes, owner records, effects |
| 2       | `payment_statements`: Bachs's payment records retrieved by the owner                           |
| 3       | Hashed tombstones used when optional payment-record retention deletes old contributions        |

### Store

`openStore({ database, installationId, organizationId, environment, prefix?, effects?, encryptionKey? })`.

| Option           | Meaning                                                                             |
| ---------------- | ----------------------------------------------------------------------------------- |
| `installationId` | A fixed ID for this website                                                         |
| `prefix`         | Table prefix used for the migrations, default `cheerkit_`                           |
| `effects`        | Post-payment effect names, such as `["thank-you"]`                                  |
| `encryptionKey`  | 32 random bytes, base64url: name, message, and metadata are stored with AES-256-GCM |

Store methods are trusted operations with no authorization of their own; reach them through the services. The ones you call directly: `syncContext(context)`, `putContext(context, expectedRevision)`, `getContext(id)`, `listContexts()`.

### Support service

`createSupportService(options)`:

| Option                          | Meaning                                                                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store`, `checkout`, `webhooks` | Must share one organization and environment                                                                                                                     |
| `resultSecret`                  | 32+ random characters; signs result tokens                                                                                                                      |
| `retention`                     | `{ supporterDataDays }` (1–3650), required; optional `paymentRecordYears` (1–50) deletes settled financial records while keeping hashed retry/replay tombstones |
| `resultLifetimeSeconds`         | Result token lifetime, default 30 days                                                                                                                          |
| `authorizeOwner`                | `(request) => boolean \| Promise<boolean>`; without it every owner operation is refused                                                                         |
| `effects`                       | `{ handlers, maxAttempts, retryDelayMs, leaseMs }`, one handler per store effect name                                                                           |
| `now`                           | Clock, for tests                                                                                                                                                |

| Method                                                                              | Does                                                                                                |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `getPublicContext(contextId)`                                                       | Rules for rendering: currencies, limits, fields, `fees` (`owner`, `supporter`, `account_default`)   |
| `startContribution(contextId, submission, submissionKey, metadata?)`                | Validates, reserves, sends one checkout request; returns `{ contribution, resultToken, expiresAt }` |
| `resumeContribution(submissionKey)`                                                 | Continues an earlier submission; opens a new attempt after an unsuccessful one                      |
| `getStatus`, `getOwnData`, `removeOwnData` `(contributionId, resultToken)`          | The supporter's view, their own data, and its removal                                               |
| `acceptWebhook(rawBody, headers)`                                                   | Verifies, stores, and processes one delivery                                                        |
| `processPending({ afterId?, limit? })`, `runEffects({ limit })`, `applyRetention()` | Background work                                                                                     |
| `owner`                                                                             | The [owner service](#owner-service)                                                                 |

The same submission key with the same amount, currency, context, and metadata returns the same contribution; a different one conflicts.

### Owner service

`createOwnerService({ store, bachs, authorizeOwner, now? })`, or `service.owner`. Every method takes the `Request` first and checks `authorizeOwner` before touching storage.

| Method                                                                 | Does                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `summary`                                                              | Counts and totals ([below](#summary))                                     |
| `listContributions(request, { contextId?, status?, before?, limit? })` | Newest first, up to 100; `before` is `{ createdAt, id }` of the last item |
| `getContribution(request, id)`                                         | One contribution with payments, attempts, and owner records               |
| `listEvents(request, { state?, contributionId?, afterId?, limit? })`   | Bachs events                                                              |
| `acceptReview(request, id, note)`                                      | Confirms a contribution in review that has a recorded payment             |
| `recordExternalReturn(request, id, amount, note)`                      | Records money returned outside Bachs, up to what was paid                 |
| `retryCheckout(request, id)`                                           | Resends an unresolved checkout request (same key, within 23 hours)        |
| `recoverCheckout(request, id, checkoutId)`                             | Attaches a checkout found in Bachs after verifying it                     |
| `refreshPaymentDetails(request, id)`                                   | Retrieves Bachs's record of each payment and keeps it as its `statement`  |
| `resendNotices(request, id)`                                           | Asks Bachs to resend notices for payments missing settlement or fee facts |
| `removePersonalData(request, id)`                                      | Removes name, message, and metadata; payment facts stay                   |
| `dismissEvent(request, eventId, note)`, `reopenEvent`, `recheckEvent`  | Takes an event out of processing, returns it, or interprets it again      |
| `listContexts`, `putContext(request, context, expectedRevision)`       | Contexts, with revision checks                                            |
| `listEffects`, `retryEffect(request, contributionId, name)`            | Post-payment effects                                                      |
| `exportData(request)`                                                  | Everything, for records or a move                                         |

#### Summary

| Field                                | Meaning                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `contributions`                      | Count per [status](#contribution-status)                                                                                  |
| `confirmedTotals`                    | Per currency: confirmed payments minus paid refunds and recorded returns                                                  |
| `settledTotals`, `unsettledPayments` | Per settlement currency: what Bachs reported crediting, before refunds; and how many confirmed payments it did not report |
| `feeTotals`, `unknownFeePayments`    | Per fee currency: charged fees; and how many confirmed payments have no fee from either source                            |
| `events`                             | Count per event state (`pending`, `applied`, `review`, `unsupported`, `dismissed`)                                        |
| `openDisputes`                       | Disputes needing a response or under review                                                                               |
| `effects`                            | Count per effect state                                                                                                    |

Totals are payment facts, not a Bachs balance: payouts, holds, and other account activity are outside Cheerkit.

### HTTP handlers

Both take a Fetch `Request` and return a `Response`.

`createSupportHandler(service, options)` serves every route. `createOwnerHandler(owner, options)` serves only `/owner/*`.

| Option            | Handlers | Meaning                                                                                      |
| ----------------- | -------- | -------------------------------------------------------------------------------------------- |
| `basePath`        | Both     | Mount path, such as `/api/support`                                                           |
| `allowedOrigins`  | Both     | Exact HTTPS origins (or `localhost`) allowed to call the API                                 |
| `onError`         | Both     | Receives `{ code, route }` for server failures and webhook errors                            |
| `onRefusal`       | Both     | Receives `{ code, route, status }` for refused requests                                      |
| `clientKey`       | Support  | Trusted caller identity for rate limiting                                                    |
| `initiationLimit` | Support  | `{ requests, windowSeconds }` for starts and resumes, default 10 per 60 seconds, per process |

Every response is JSON with `Cache-Control: no-store`, `nosniff`, and `no-referrer`. No CORS headers are sent. Owner responses also use `Cross-Origin-Resource-Policy: same-origin`, and owner routes refuse requests marked `Sec-Fetch-Site: cross-site`. Bodies are limited (16 KiB public, 64 KiB owner, 1 MiB webhook), JSON routes require `application/json`, and owner changes require an allowed `Origin` header.

### Routes

Relative to `basePath`.

| Route                                                                                       | Access                    | Body or query → response                                                                               |
| ------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /contexts/:id`                                                                         | Public                    | Public context                                                                                         |
| `POST /contributions`                                                                       | Public, rate limited      | `{ contextId, submissionKey, submission, metadata? }` → 201 `{ contribution, resultToken, expiresAt }` |
| `POST /contributions/resume`                                                                | Public, rate limited      | `{ submissionKey }` → same                                                                             |
| `POST /contributions/status`                                                                | Result token              | `{ contributionId, resultToken }` → public contribution                                                |
| `POST /contributions/data`, `/contributions/remove-data`                                    | Result token              | Same body → the supporter's own data                                                                   |
| `POST /webhooks/bachs`                                                                      | Bachs signature           | Raw event → `{ received }`                                                                             |
| `GET /owner/summary`                                                                        | Owner                     | Summary                                                                                                |
| `GET /owner/contributions`                                                                  | Owner                     | `?contextId&status&limit&beforeCreatedAt&beforeId` → list                                              |
| `GET /owner/contributions/:id`                                                              | Owner                     | Contribution                                                                                           |
| `POST /owner/contributions/:id/accept-review`                                               | Owner + origin            | `{ note }`                                                                                             |
| `POST /owner/contributions/:id/external-returns`                                            | Owner + origin            | `{ amount, note }`                                                                                     |
| `POST /owner/contributions/:id/retry`, `/recover`                                           | Owner + origin            | `/recover` takes `{ checkoutId }`                                                                      |
| `POST /owner/contributions/:id/payment-details`, `/resend-notices`, `/remove-personal-data` | Owner + origin            | —                                                                                                      |
| `GET /owner/events`                                                                         | Owner                     | `?state&contributionId&afterId&limit`                                                                  |
| `POST /owner/events/:id/dismiss`, `/reopen`, `/recheck`                                     | Owner + origin            | `/dismiss` takes `{ note }`                                                                            |
| `GET /owner/contexts`, `PUT /owner/contexts/:id`                                            | Owner (+ origin for PUT)  | `{ context, expectedRevision }`                                                                        |
| `GET /owner/effects`, `POST /owner/effects/:contributionId/:name/retry`                     | Owner (+ origin for POST) | `?state&contributionId&limit`                                                                          |
| `GET /owner/export`                                                                         | Owner                     | Everything, as a JSON download                                                                         |

The public contribution is `{ contributionId, contextId, outcome, amount, currency, checkoutUrl? }`, with `outcome` one of `pending`, `confirmed`, `refunded`, `needs_review`, `unsuccessful`. It never includes messages, payer details, or evidence.

### Background work

| Export                                                                               | Does                                                                                                                        |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `startPendingWorker(service, { intervalMs, pageSize, maxPages, onPass?, onError? })` | Each pass processes waiting events, runs due effects, and applies retention; backs off after failures. Returns `{ stop() }` |
| `runPendingPass(service, { pageSize, maxPages })`                                    | One pass over waiting events, for scheduled routes                                                                          |

Callbacks receive counts and error codes only.

### Local admin runner

Available from `cheerkit/server/local-admin`:

```ts
const app = await startLocalAdmin(
  { store, bachs, siteName: "My site", close: () => database.close() },
  { port: 0 },
);
console.log(app.accessUrl); // one-use link; expires after five minutes
await app.close();
```

`LocalAdminConfig` requires the existing `store` and `bachs` client; `siteName` and `close` are optional. The runner binds only to `127.0.0.1`, serves the shared `<cheerkit-admin>` UI, and uses an in-memory 12-hour session. It never serializes the store or Bachs client to the browser. The `cheerkit-admin` executable accepts `--config <module.mjs>` and `--port <0–65535>`; port 0 is the default.

## `cheerkit/ui`

Browser only. `cheerkit/ui/define` registers the elements when imported; `cheerkit/ui` exports the classes and helpers without registering anything.

### `<cheerkit-support>`

| Attribute | Values                                                                |
| --------- | --------------------------------------------------------------------- |
| `api`     | Base path of the Cheerkit routes on this site, such as `/api/support` |
| `context` | Context ID                                                            |
| `layout`  | `page` (default), `inline`, or `dialog`                               |
| `view`    | `result` on the page Bachs returns to; otherwise the form             |
| `color`   | Theme colour; text on it is chosen for contrast                       |
| `theme`   | `light` (default), `dark`, or `system`                                |

The `currency` attribute picks the one currency to show (default: the context's first). The `config` property takes `name`, `avatar` (a person's photo) or `logo` (a square logo), both HTTPS or same-site URLs, or `mark` (a built-in square icon), plus `tagline`, `question`, `where`, `locale`, `text` (any of `defaultText`), `appearance.variables`, and `metadata`. Methods: `open()`, `close()`. Event: `cheerkit:state` with the current state in `detail`.

Theme variables (`--ck-<name>`): `color-background`, `color-surface`, `color-text`, `color-text-muted`, `color-border`, `color-primary`, `color-on-primary`, `color-danger`, `color-success`, `color-warning`, `font-family`, `font-size-base`, `radius`, `radius-control`, `border-width`.

Parts: `dialog`, `card`, `header`, `avatar`, `name`, `tagline`, `title`, `description`, `currency`, `amounts`, `amount`, `field`, `label`, `input`, `hint`, `notice`, `button`, `button-secondary`, `fee-note`, `close`, `status-icon`, `summary`, `quote`.

### `createSupport(options)`

`{ api, contextId, metadata?, storage?, fetch?, maxWaitMs?, delays? }` → an object with `state`, `subscribe(listener)`, `load()`, `readContext()`, `submit(submission)`, `checkResult()`, `watchResult(signal?)`, `tryAgain()`, `readOwnData()`, `removeOwnData()`.

| State         | Meaning                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| `loading`     | Reading the context                                                      |
| `unavailable` | The context could not be read (`error` code)                             |
| `closed`      | The context is not taking support                                        |
| `ready`       | The form can be filled in (`error` after a refused or failed submission) |
| `submitting`  | Sending                                                                  |
| `redirecting` | Go to `checkoutUrl` (HTTPS, or HTTP on localhost only)                   |
| `result`      | `contribution` with `checking` while the payment is still being checked  |
| `no-result`   | Nothing saved in this tab                                                |

Also exported: `safeCheckoutUrl(url)`, `readableOn(hexColour)`, `defaultText`, `themeVariables`, `defineCheerkitElements()`.

### `<cheerkit-admin>`

| Attribute | Values                                                                |
| --------- | --------------------------------------------------------------------- |
| `api`     | Base path of the Cheerkit routes on this site, such as `/api/support` |
| `color`   | Theme colour; text on it is chosen for contrast                       |
| `theme`   | `light` (default), `dark`, or `system`                                |

The `config` property takes `siteName`, `logo` (HTTPS or same-site URL), `locale`, `pageSize` (default 25), `screens` (any of `contributions`, `notices`, `contexts`, `effects`, `export`, in order), `text` (any of `defaultAdminText`), and `appearance.variables`. Slot: `sign-in`, shown when the owner routes answer 401 or 403. Parts: `admin`, `sidebar`, `stat`, `table`, `row`, `drawer`, `modal`, `editor`. The theme variables are the same as `<cheerkit-support>`.

### `createOwnerClient(options)`

`{ api, fetch? }` → `summary`, `listContributions({ status?, contextId?, before?, limit? })`, `getContribution`, `acceptReview`, `recordExternalReturn`, `retryCheckout`, `recoverCheckout`, `refreshPaymentDetails`, `resendNotices`, `removePersonalData`, `listEvents`, `dismissEvent`, `reopenEvent`, `recheckEvent`, `listContexts`, `putContext(context, expectedRevision)`, `listEffects`, `retryEffect`, `exportData`. Failures throw `OwnerRequestError` with the server's `code` and HTTP `status` (`network` and `0` when the request didn't reach the server).

Also exported: `defaultAdminText`, `defineCheerkitAdmin()`, `OwnerRequestError`.

## Contribution status

Every stored contribution has one `status`; the public outcome, retention, filters, and summary counts all come from it.

| Status                | Meaning                                                                  | Public outcome            |
| --------------------- | ------------------------------------------------------------------------ | ------------------------- |
| `awaiting_payment`    | A checkout is open                                                       | `pending`                 |
| `checkout_unresolved` | The checkout request is unsent, in flight, or its answer was lost        | `pending`                 |
| `unsuccessful`        | Bachs refused the checkout, or it expired or was cancelled, nothing paid | `unsuccessful`            |
| `confirmed`           | Paid, as verified from Bachs's events                                    | `confirmed` or `refunded` |
| `needs_review`        | Something did not match; the owner decides                               | `needs_review`            |

## Payments: fee, settlement, statement

Each item in `contribution.payments`:

| Field                 | Meaning                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `amount`, `currency`  | What the checkout charged, in its own currency                                                                                                                            |
| `fee`                 | `{ state: "charged", amount, currency, bearer }`, `{ state: "none" }`, or `{ state: "unreported" }`. From the statement when there is one, otherwise from the notice      |
| `settlement`          | `{ amount, currency, fee, feeCurrency, feeBearer }` as the collection notice reported it, or `null`                                                                       |
| `statement`           | Bachs's payment record from the last refresh: `{ status, amount, currency, fee, feeBearer, retrievedAt }`, or `null`. `amount` and `currency` are what the supporter paid |
| `refunds`, `disputes` | As reported by Bachs                                                                                                                                                      |

Cheerkit never converts currencies or computes a net amount. When a payment is collected in another currency than its checkout (a dollar checkout paid by naira transfer), the fee is stated in the collected currency.

## Errors

Validation, from `cheerkit` (`CheerkitError.code`): `INVALID_INPUT`, `INVALID_AMOUNT`, `INVALID_CONTEXT`, `CONTEXT_CLOSED`, `UNSUPPORTED_CURRENCY`, `AMOUNT_OUT_OF_RANGE`, `FIELD_DISABLED`. Messages never echo submitted values.

Bachs (`BachsError.code`): `INVALID_CONFIGURATION`, `INVALID_CHECKOUT`, `CHECKOUT_REJECTED`, `CHECKOUT_UNCERTAIN` (recover; do not assume failure), `RECOVERY_FAILED`, `RESEND_FAILED`, `LOOKUP_FAILED`, `INVALID_SIGNATURE`, `INVALID_EVENT`, `WRONG_ACCOUNT`.

Store (`CheerkitStoreError.code`): `CONFLICT`, `NOT_FOUND`, `INVALID_STATE`, `STORAGE_FAILURE` (retryable).

Services (`SupportServiceError.code`): `UNAUTHORIZED`, `INVALID_CONFIGURATION`, `INVALID_REQUEST`.

HTTP responses are `{ "error": code }`:

| Status   | Codes                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------- |
| 400      | Validation codes in lower case, `invalid_request`, `invalid_json`, `invalid_event`, `wrong_account` |
| 401      | `invalid_signature`                                                                                 |
| 403      | `forbidden`, `origin_not_allowed`                                                                   |
| 404      | `not_found`                                                                                         |
| 409      | `conflict`, `invalid_state`, `context_closed`                                                       |
| 413, 415 | `body_too_large`, `unsupported_media_type`                                                          |
| 429      | `rate_limited`                                                                                      |
| 500      | `server_error`                                                                                      |
| 502      | `recovery_failed`, `resend_failed`, `lookup_failed`, `provider_error`                               |
| 503      | `retry_later`, with `Retry-After`                                                                   |
