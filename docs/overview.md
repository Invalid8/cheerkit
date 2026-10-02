# Overview

Cheerkit lets people support your work with a one-off payment, from inside the application you already run. It is not a hosted service: you install it, it keeps its records in your database, and it talks only to your payment provider.

## What it does

**For supporters**

- Choose a suggested amount or enter their own, in the currencies you offer.
- Optionally leave a display name and a message; both are off unless you turn them on.
- Pay on the provider's hosted checkout.
- See an honest result: confirmed only when the provider confirms it, never just because they came back from checkout.
- Retry safely after a lost connection or an expired checkout, without paying twice.
- See or remove their own name and message later, with their private result link.

**For the owner**

- Several things to support ("contexts"), each with its own currencies, limits, and suggested amounts, and a switch to pause it.
- A clear status for every contribution: waiting for payment, checkout not confirmed, not completed, confirmed, or needs review.
- Totals of what people paid, per currency, after refunds and returns.
- Each payment's fee and settlement as the provider reports them, and a way to fetch the provider's latest record.
- Tools for the cases that go wrong: accept a reviewed payment, record money returned outside the provider, retry or recover a checkout request, re-check a provider event, dismiss events from other sites.
- Export of everything, and removal of a supporter's personal data on request.
- An owner admin you can run inside your site or as a separate app.

**For the developer**

- A JSON API behind one Fetch-standard handler, for Next.js, Hono, Bun, Deno, SvelteKit, Astro, or plain Node.
- Tables in your own Postgres or SQLite database, created by migrations you apply.
- Framework-free examples of a support page, a modal, a result page, and an owner admin, to copy and restyle.
- Post-payment actions (such as a thank-you email) delivered at least once, without affecting the payment.

## How it keeps payments right

- Payment success comes only from the provider's signed webhooks.
- Amounts are exact decimals; currencies are never converted or added together.
- Each payment, webhook delivery, and submission is recorded once, even with several servers.
- A timed-out checkout request is treated as unknown, never as failed, and is resolved before another is started.
- Anything that does not match exactly (a different amount, several payments, conflicting facts) goes to the owner for review; nothing is refunded or written off automatically.
- Payer details from the provider are never stored; supporter text is removed after the retention period you set.

## Where it stands

Version 0.1 is the first release. It is covered by automated tests on both SQLite and Postgres, and has taken real payments in Bachs's sandbox, including dollar checkouts paid in naira, provider replays, and recovery of payment details.

**Supported today**

| Area              | Supported               |
| ----------------- | ----------------------- |
| Payment providers | Bachs (hosted checkout) |
| Databases         | Postgres, SQLite        |
| Runtime           | Node.js 24 and later    |

**Known limits**

- Rate limiting of contribution starts is per server process.
- Payment records are kept until you remove them; there is no automatic expiry for them yet.
- With Bachs, a payment settled in another currency does not report its settled amount through the API, so Cheerkit shows it as not reported.

## Planned

In rough order; none of these is a promise of a date.

- **More payment providers**, behind the same contribution, status, and owner model.
- **Embedded checkout** on your own page, where the provider supports it.
- **Settled amounts per payment** wherever the provider exposes them.
- **Refunds on payments collected in another currency**, confirmed against real provider behaviour.
- **Shared rate limiting** across several server instances.
- **Retention for payment records**, once the required periods are set per site.
