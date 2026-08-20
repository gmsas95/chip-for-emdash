# Contributing to EmDash Commerce Core

## Scope

Commerce Core is provider-neutral. Changes belong in this repository when they affect canonical Commerce contracts, Commerce-owned storage, checkout orchestration, bridge reliability, native admin pages, or storefront-safe helpers.

Provider credentials, provider API payloads, provider diagnostics, and provider-specific persistence belong in the relevant provider plugin instead.

## Setup

```sh
pnpm install
```

## Checks

Run the complete local verification before opening a pull request:

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm --filter @emdash-commerce/core test:consumer
```

Tests must not require live provider credentials. Use deterministic fake bridge providers and fixtures for unit and integration tests.

## Contract rules

- Keep bridge request and event schemas versioned.
- Preserve idempotency and correlation fields on retriable writes.
- Use integer minor-unit money with an explicit ISO currency.
- Recalculate authoritative totals on the server.
- Keep provider storage and credentials outside Commerce collections.
- Prefer documented EmDash APIs over private or undocumented cross-plugin hooks.

## Pull requests

Describe:

- the observable behavior changed;
- affected contract or storage fields;
- migration and compatibility impact;
- verification commands and results;
- whether a provider or starter repository must update separately.
