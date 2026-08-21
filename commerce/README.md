# EmDash Commerce Core

Provider-neutral commerce infrastructure for [EmDash](https://emdash.dev), designed for a WooCommerce-style extension model.

Commerce Core owns the canonical commerce domain: catalog, variants, prices, carts, inventory reservations, checkout totals, orders, customers, fulfillment references, and storefront-safe APIs. Payment and logistics integrations are installed separately and connect through versioned, authenticated bridge contracts.

## Architecture

```text
Astro storefront
      |
      v
Commerce Core  <---- signed bridge ---->  Payment plugin
      |
      +---------- signed bridge -------->  Logistics plugin
```

Commerce never trusts browser-supplied totals. Prices, discounts, tax, shipping, inventory, and order totals are recalculated server-side in integer minor units with an explicit ISO currency.

Provider-specific credentials, response payloads, and diagnostics remain owned by the provider plugin. Commerce stores only normalized references and canonical state.

## Packages

- `@gmsas95/emdash-commerce-contracts` — versioned domain, money, provider, event, and bridge contracts for EmDash.
- `@emdash-commerce/core` — native EmDash plugin, repositories, domain workflows, provider bridge, admin pages, and storefront client.
- `@emdash-commerce/test-fixtures` — reserved workspace package for shared provider fixtures.

Payment and logistics integrations are not bundled in this repository. They are independent EmDash plugins installed alongside Commerce Core.

## Development

Requirements: Node.js 20+ and pnpm 10.

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

The built-package smoke check verifies that a consumer can import the emitted core package and resolve the built contracts package:

```sh
pnpm --filter @emdash-commerce/core test:consumer
```

## Native plugin

Commerce is installed as a native EmDash plugin. It exposes:

- Dashboard, products, inventory, orders, customers, and settings admin pages.
- Storefront routes for catalog, cart, checkout, and orders.
- `POST /bridge/events` for authenticated provider events.
- Scoped indexed storage collections for Commerce-owned records.

The plugin route boundary uses EmDash's parsed route input. Provider events use the canonical `getCommerceEventSigningData()` representation before HMAC signing. Provider event requests include the provider identity and bridge signature headers documented by the bridge client and contracts.

## Checkout and providers

A deployment must configure at least one payment provider before checkout can return a hosted payment URL. Providers may be configured through:

- a runtime provider implementation in trusted tests or host code; or
- a serializable `paymentBridges` connection that reaches an independently installed provider plugin.

Payment commands carry stable idempotency keys. Providers must honor those keys when creating hosted payments or other side effects.

Logistics providers are selected and called through the same versioned bridge boundary. Commerce does not import provider internals or provider storage.

## Security boundaries

- Never send provider secrets or authoritative totals to the browser.
- Public checkout routes reject client-provided totals.
- Money values are safe integer minor units only.
- Bridge signatures use HMAC-SHA-256, canonical payloads, timestamps, replay stores, and delivery IDs.
- Outbox deliveries use idempotency keys, claims, leases, bounded retries, and terminal errors.
- Public catalog results filter to published products.

## Current scope

This repository contains the Commerce Core and Contracts implementation. A complete customer deployment additionally needs:

1. EmDash itself.
2. At least one payment plugin.
3. Optional logistics, tax, or promotion extensions.
4. Customer-owned deployment bindings, domains, database, storage, and secrets.

The standalone provider plugins and an official starter distribution are separate deliverables.

## Deployable starter

`apps/commerce-starter` is a Cloudflare deployment based on EmDash's upstream
`templates/starter-cloudflare`. It registers Commerce Core and the CHIP payment
plugin together, with D1, R2, KV sessions, and the Commerce event scheduler.

```sh
pnpm install
pnpm --filter @gmsas95/emdash-commerce-starter deploy
```

Then open `/_emdash/admin/setup`, configure CHIP credentials and callback URLs
in the CHIP plugin settings, set the Commerce bridge secret, and create a
published product before starting checkout. The full client onboarding and
route checklist is in
[`apps/commerce-starter/README.md`](apps/commerce-starter/README.md).

The starter provisions customer-owned Cloudflare resources. Replace the
example Worker, D1, R2, and KV names/IDs before deploying to a new account.
