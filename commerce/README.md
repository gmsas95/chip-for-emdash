# EmDash Commerce Core

Provider-neutral commerce plugin for [EmDash CMS](https://emdashcms.com) — products,
inventory with reservation holds, carts, checkout, orders, customers, and a full admin
surface, designed to mirror the WooCommerce operating model on an Astro-native stack.

Payment collection is delegated to provider plugins over a signed bridge contract.
The reference implementation is **CHIP for EmDash** (`chip-for-emdash`, this repository's
root package), which adds FPX / e-wallet / card / DuitNow QR via hosted checkout.

## Packages

| Package | Purpose |
|---|---|
| `@gmsas95/emdash-commerce-contracts` | Shared domain types (Money, OrderSnapshot, BridgeRequest/Response, CommerceEvent), signing helpers |
| `@emdash-commerce/core` | Native EmDash plugin: domain logic, storage repositories, routes, MCP tools, React admin |

## Format

Native plugin (`format: "native"`): runs in-process, ships React admin pages, registers
via the descriptor factory + `createPlugin()` pair. Storage uses 13 declared document
collections (products, variants, inventory, reservations, carts, orders, orderEvents,
orderNotes, customers, addresses, promotions, taxRules, fulfillments) provisioned
automatically.

## Admin surface (`/_emdash/admin/plugins/emdash-commerce`)

- **Dashboard** — revenue/paid-orders/AOV/items-sold tiles, zero-filled 14-day sales bar
  chart, recent orders, low-stock alerts
- **Products** — CRUD with variants + options, sale price, images, per-SKU inventory levels
- **Inventory** — inline stock editing (reserved-floor guarded), active holds feed
  (held vs confirmed), low-stock highlighting against `settings:lowStockThreshold`
- **Orders** — status filter, right-side detail drawer: line items, addresses, payment
  meta, state-machine transitions (with cancel confirmation), provider refunds,
  private/customer notes
- **Customers** — total spent + last-order columns, drill-down drawer with order history
- **Settings** — store name/email, default currency, low-stock threshold

Buttons follow a two-variant system (`commerce-btn`, `commerce-btn-secondary`,
`commerce-btn-sm`) built on the host's kumo design tokens.

## Storefront routes (public)

| Route | Method | Purpose |
|---|---|---|
| `catalog` | GET | Published products + published variants |
| `cart` | POST | Create cart / add line (server-side pricing only) |
| `checkout` | POST | Idempotent checkout → order snapshot + provider `checkoutUrl`; reserves stock; sends confirmation email when address known |
| `order` | POST | Guest order lookup by `orderId` + `orderAccessToken` |

## Admin routes (session-authenticated)

`products`, `products/detail|save|archive`, `inventory`, `inventory/update`,
`inventory/holds`, `orders`, `orders/status`, `orders/refund`, `orders/notes`,
`customers`, `customers/detail`, `stats`, `settings/get`, `settings/save`,
`provider-status`, plus the signed `bridge/events` webhook for provider events.

## Order lifecycle

`draft → pending_payment → paid → processing → partially_fulfilled → fulfilled → completed`,
with `failed`, `cancelled`, `refunded` branches enforced by a pure state machine
(`transitionOrder`). Admin actions expose only state-changing commands; bridge events own
payment transitions. Stock is reserved at checkout, consumed on payment, released on
failure/cancel/refund, and stale holds expire via maintenance (lazy self-heal + cron hook).

## Emails

With the `email:send` capability and a site email provider configured:
order confirmation (checkout), payment-failed notice (bridge event), refund receipt.
Silently skipped otherwise.

## Payments bridge

Commands are HMAC-signed (`bridge/signature.ts`) versioned envelopes;
`commerce.payment.create|status|refund`. Providers emit normalized
`commerce.payment.*` events with stable delivery IDs; core persists them to
`orderEvents` (idempotent) and applies transitions. See `src/commerce-bridge.ts`
in the CHIP plugin for the provider side.

## Development

```sh
pnpm install
pnpm test        # vitest across contracts + core
pnpm typecheck   # tsc --noEmit
pnpm build       # compile core dist (contracts then core)
```

Deploy the starter site:

```sh
cd apps/commerce-starter
set -a; . ./.env.production; set +a   # PUBLIC_SITE_URL + COMMERCE_BRIDGE_SECRET
pnpm run deploy                        # build + wrangler deploy
```

See [`CHANGELOG.md`](../CHANGELOG.md) for release history.
