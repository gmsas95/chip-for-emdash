# Changelog

All notable changes to the EmDash Commerce workspace (commerce core + contracts + CHIP bridge).

## [Unreleased] — 2026-08-23

### Added
- **WooCommerce-parity audit** of commerce core against WooCommerce; findings drove this cycle.
- **Inventory reservations end-to-end** — stock reserved at checkout (deterministic ids, 60-min TTL), consumed on `payment_paid`, released on failed/cancelled/refunded, stale holds expired via maintenance.
- **Full bridge event handling** — `payment.failed|cancelled|refunded` transition orders and restock; out-of-order events recorded without state damage; webhook always answers 200.
- **Merchant refunds** — `orders/refund` route over the signed `commerce.payment.refund` contract; applies refund or records manual-action request; idempotent replay.
- **Orders admin deep-dive** — status filter, right-side detail drawer (items, addresses, payment meta, transitions with cancel confirmation, refunds, private/customer notes via new `orderNotes` collection).
- **Customers 360** — spend totals (paid statuses only) + last-order columns; drill-down drawer with order history; `customers/detail` route.
- **Inventory management** — inline stock edits (`inventory/update`), active-holds feed (`inventory/holds`), low-stock flagging against configurable threshold.
- **Real dashboard** — `stats` route: revenue/paid-orders/AOV/items-sold tiles, zero-filled 14-day sales chart, recent orders, low-stock alerts.
- **Store settings + transactional emails** — `settings/get|save` (store name/email, default currency, low-stock threshold); `email:send` capability; order confirmation, payment-failed notice, refund receipt (no-op without provider/address).
- **Short order numbers** — sequential `#1001+` assigned at checkout (KV counter); legacy UUIDs render as shortened refs with full id on hover.
- **Legacy backfill** — statusless orders healed to `pending_payment`; runs lazily on first admin list load (cron tasks never persisted in this deployment) and via cron hook elsewhere.
- **Button system** — `commerce-btn` / `-secondary` / `-sm` variants on kumo tokens across all admin pages; row actions as compact secondaries.

### Fixed
- Cart rollback no longer writes literal `undefined` fields rejected by EmDash JSON validation.
- Drawer mutations now refresh the parent list; busy/error feedback moved inline to the Actions bar.
- Customers list crash after spend-enrichment shape change (flat rows).
- Terminal orders (cancelled/completed/refunded) show an explanatory hint and visibly greyed controls.
- Secondary buttons render full borders (shared box styles applied per variant).

### Changed
- Order lines record `variantId`.
- Orders GET supports single-order fetch by id.

## [0.1.x] — earlier

- CHIP for EmDash plugin: hosted-checkout payments, verify-by-query security model, Block Kit settings/payments admin, commerce bridge routes (`commerce/payment/create|status|refund`) with HMAC-signed commands and normalized `commerce.payment.*` events.
- Commerce contracts package: Money, domain snapshots, bridge envelopes, event signing data.
- Commerce core foundation: catalog/cart/checkout public routes, products CRUD, provider registry, memory + EmDash repositories, MCP search/execute tools.
