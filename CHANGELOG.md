# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

First release.

### Added

- Support contexts with per-currency limits and suggestions, optional name and message, and a pause switch; `syncContext` for contexts defined in code.
- Contributions with exact decimal amounts, retry-safe submission keys, and signed result tokens.
- Bachs checkout creation, recovery by checkout ID, webhook verification, payment records, and notice replay.
- Storage in your own Postgres or SQLite database through migrations you apply (schema version 3).
- A status for every contribution, used by the public outcome, retention, filters, and summary counts.
- Payment fees and settlement as reported, with a resolved fee per payment.
- Support service and handler for websites; owner service and handler for admins that run separately.
- Background worker and single-pass functions for serverless hosts; post-payment effects delivered at least once.
- Personal data retention, supporter self-service removal, owner erasure and export, and optional field encryption.
- Optional six-year payment-record retention, with hashed tombstones to block retries and webhook replays after deletion.
- Framework-free examples: support page, modal, result page, and owner admin.
- `cheerkit/ui`: a ready-made support template, `<cheerkit-support>`, for any site (page, dialog, and result views; theme colour, dark mode, wording, and parts adjustable), and `createSupport` for custom interfaces on the same logic.
- `<cheerkit-admin>`: a ready-made owner admin (contributions, detail and actions, unmatched notices, contexts, follow-up actions, export), and `createOwnerClient` with typed calls for every owner route.
- The templates warn in the browser console when configured text on the primary color is below a 4.5:1 contrast ratio. Admin dialogs have accessible names, keyboard focus remains visible and is restored after view changes, and tab-return refreshes avoid interrupting active controls.
- A strict-CSP example exercises both templates without inline scripts or styles and requires Trusted Types for script sinks.
