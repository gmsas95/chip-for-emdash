# CHIP for EmDash

A sandboxed payment plugin for [EmDash CMS](https://emdashcms.com). Lets any EmDash
site owner accept **CHIP** (chip-in.asia) payments — **FPX, e-wallet, card, DuitNow QR** —
via CHIP's hosted checkout, and records every payment attempt in plugin storage with a
verified status.

- Creates CHIP purchases from a public API route and returns the hosted `checkout_url`.
- Handles browser returns, CHIP server callbacks, and `purchase.*` webhooks.
- **Verify-by-query** security model: no payment status is ever trusted from a webhook or
  query string — every update is re-confirmed against the CHIP API with the secret key.
- Settings page, payments table, and a dashboard widget in the EmDash admin (Block Kit).
- Runs in both trusted (in-process) and sandboxed (Cloudflare isolate) modes; publishable
  to the EmDash marketplace.

## Requirements

- EmDash `>= 0.15` (an Astro site with the EmDash integration)
- A CHIP Collect account with API keys (Portal → Developer → API keys)

## Install

```sh
npm install @chip-in-asia/plugin-chip-for-emdash
```

Then register the plugin in `astro.config.mjs`. The plugin ships a descriptor module —
pass it into the integration directly (no factory call):

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";
import chipForEmdash from "@chip-in-asia/plugin-chip-for-emdash";

export default defineConfig({
  integrations: [
    emdash({
      // In-process (trusted) mode:
      plugins: [chipForEmdash],
      // Or Cloudflare isolate (sandboxed) mode:
      // sandboxed: [chipForEmdash],
    }),
  ],
});
```

> The plugin can also be installed from the EmDash marketplace with one click.

## Configure

1. Open the EmDash admin → **CHIP Settings**.
2. Paste your CHIP Collect **Secret Key** and **Brand ID** (use **Test Mode** keys while
   testing). The Public Key field is stored for a future raw-body signature-verification
   upgrade.
3. Press **Test CHIP credentials** — it calls `GET /v1/public_key/` and reports whether the
   key is accepted.
4. Optionally set **Success / Failure / Cancel page URLs** — where customers land after the
   hosted checkout. When left empty, customers are returned to your site root.

Settings are stored in plugin KV under `settings:*`. The secret key is never returned by any
route and never logged.

## Accept a payment

Add a pay button anywhere on your site. The snippet calls the plugin's public `create`
route and redirects the customer to CHIP's hosted checkout:

```html
<button onclick="pay()">Pay RM 50</button>
<!-- In an .astro file the script needs `is:inline` so `pay` stays a
     global (Astro bundles plain <script> tags as modules, which scope
     the function and break the inline onclick handler). -->
<script is:inline>
  async function pay() {
    const res = await fetch("/_emdash/api/plugins/chip-for-emdash/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: 5000, // cents — RM 50.00
        currency: "MYR",
        reference: "order-123", // your own order/product reference
        name: "Product", // optional
        email: "customer@example.com", // optional
        // products: [{ name: "Product", price: 5000 }], // optional passthrough
        // metadata: { anything: "you want" }, // optional passthrough
      }),
    });
    // EmDash wraps every plugin route response in { success, data } —
    // unwrap it before reading checkoutUrl.
    const body = await res.json();
    const data = body.data ?? body;
    if (data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
    } else {
      alert(data.error?.message ?? "Could not start payment");
    }
  }
</script>
```

On success the route responds with `{ ok: true, id, purchaseId, checkoutUrl }` inside the
standard `{ success: true, data }` envelope. The `checkoutUrl` is CHIP's hosted checkout
(FPX, e-wallet, card, DuitNow QR). Amounts are in **cents** (`5000` = RM 50.00).

### Webhooks (recommended)

For accurate status even when the customer closes the browser, add a webhook in the CHIP
portal (Portal → Developer → Webhooks):

- **Callback URL:** `https://yoursite.com/_emdash/api/plugins/chip-for-emdash/callback`
- **Events:** subscribe to **all** `purchase.*` and `payment.*` events — at minimum
  `purchase.paid`, `purchase.payment_failure`, `purchase.pending_refund`,
  `purchase.refund_failure`, and `payment.refunded`.

Each webhook is answered with HTTP 200 immediately and re-verified against the CHIP API
before the payment record is updated.

## Commerce integration (optional)

The CHIP plugin can act as a payment extension for the separate EmDash Commerce Core repository. Commerce remains the owner of carts, orders, inventory, and authoritative totals; this plugin owns CHIP credentials, purchases, callbacks, reconciliation, and provider-specific records.

Install the published Commerce Contracts package alongside the plugin when it becomes available:

```sh
npm install @emdash-commerce/contracts
```

Configure the following server-side plugin settings:

- `settings:commerceBridgeSecret` — shared HMAC secret used for versioned Commerce commands.
- `settings:commerceEventUrl` — Commerce `POST /bridge/events` endpoint.

Commerce payment command routes:

| Route | Purpose |
|---|---|
| `commerce/payment/create` | Create an idempotent hosted payment from a signed Commerce order |
| `commerce/payment/status` | Reconcile a payment against the provider API and return normalized state |
| `commerce/payment/refund` | Record a merchant refund request for provider reconciliation |

The adapter emits normalized `commerce.payment.*` events with stable delivery IDs and preserves provider-specific data only in the CHIP plugin.
## How it works

| Route | Public | Method | Purpose |
|---|---|---|---|
| `create` | yes | POST | Validates `amount`/`currency`/`reference`, creates a CHIP purchase, stores a payment record, returns `{ id, checkoutUrl }` |
| `return` | yes | GET/POST | Browser return + CHIP server callback. Looks the record up by the per-purchase return token (or the purchase id in callback POSTs), re-verifies via the CHIP API, updates the record, returns the destination (`redirectTo`) |
| `callback` | yes | POST | Webhook endpoint. Re-verifies via the CHIP API, updates idempotently, always answers 200 |
| `payments` | no | GET | Admin list (filter by status, paginated) |
| `payments/detail` | no | GET | Admin detail for one payment |
| `settings` | no | GET | Current settings with the secret key masked |
| `settings/save` | no | POST | Persists settings |
| `admin` | no | POST | Block Kit admin: settings form, payments table, widget, test button |

All routes mount under `/_emdash/api/plugins/chip-for-emdash/`.

### Verify-by-query flow

1. `create` sends the customer to CHIP with redirects/callbacks pointing at the plugin's
   `return` route (`success_redirect`/`failure_redirect`/`cancel_redirect`), resolved from
   the request origin so they work on any deployment. Each URL carries a fresh unguessable
   return token — CHIP does not append the purchase id to redirect URLs, so the token is
   how the return route finds the record. A `success_callback` (a server-side POST of the
   Purchase object, which does include the id) also points at `return` — but only when the
   origin uses a standard port (80/443), because CHIP rejects callback URLs on custom ports.
2. When the customer comes back (or CHIP POSTs a callback), the plugin finds the record by
   return token (or purchase id for POSTs).
3. It calls `GET /v1/purchases/{id}/` with the configured secret key and only acts on the
   CHIP-confirmed status. The `status` field in the query string or webhook body is never
   trusted. The purchase's `reference` must match the stored reference.
4. The record is updated only if the status changed (idempotent), and the customer is
   pointed at the site's own success/failure/cancel page.

Why not signature verification? EmDash parses the request body once and exposes it as
`routeCtx.input` — plugin routes cannot read the raw body, so CHIP's RSA `X-Signature`
(computed over the raw body bytes) cannot be verified inside a route. Verify-by-query is
cryptographically equivalent for MVP: an attacker cannot forge a paid status without the
secret key. `settings:publicKey` is stored so a future raw-body upgrade is drop-in.

## Status mapping

CHIP statuses are normalized to the plugin's six-status model:

| CHIP status | Recorded |
|---|---|
| `paid`, `cleared`, `settled` | `paid` |
| `error`, `blocked` | `failed` |
| `cancelled` | `cancelled` |
| `hold` | `hold` |
| `refunded`, `chargeback`, `pending_refund` | `refunded` |
| everything else (`created`, `sent`, `viewed`, `pending_*`, …) | `created` |

## Refunds

Refunds are merchant-initiated in the CHIP portal; the plugin never moves money. When a
purchase is refunded, CHIP sets its status to `refunded` (fully or partially) and emits
`purchase.pending_refund` / `payment.refunded` webhooks. The plugin's webhook handler
accepts both Purchase payloads (top-level `id`) and the `payment.refunded` Payment
payload (purchase id in `related_to`), re-verifies against the CHIP API, and flips the
record to `refunded`. A failed refund (`purchase.refund_failure`) reverts the purchase to
`paid`, which verify-by-query records as such.

> Webhooks are the only channel that can surface a refund — the customer never revisits
> the return route — so subscribe to the refund events listed above or the record will
> keep showing `paid`.

## Platform notes (deviations from the PRD)

These are deliberate, verified against the EmDash source:

- **Routes return JSON, not HTTP redirects or error statuses.** The plugin route
  dispatcher serializes every handler result with `Response.json(...)`
  (`packages/core/src/astro/routes/api/plugins/[pluginId]/[...path].ts`), so a 302
  redirect or a 400/502 status cannot be emitted from a plugin route. Consequences:
  - `return` responds with JSON `{ ok, verified, status, redirectTo }` instead of a 302 —
    `redirectTo` is the machine-readable destination. A future EmDash feature allowing
    `Response` returns makes this a one-line change.
  - Expected failures (validation, CHIP errors) return HTTP 200 with
    `{ ok: false, error: { code, message } }`. Throwing typed errors from a sandboxed
    plugin is not portable across trusted and isolate modes (the in-process adapter maps
    thrown non-`PluginRouteError` values to a generic 500).
- **`failure_callback`/`cancel_callback` don't exist in the CHIP Collect API.** The
  authoritative OpenAPI spec (`POST /purchases/`) defines `success_redirect`,
  `failure_redirect`, `cancel_redirect` (browser) and `success_callback` (server POST).
  The plugin sends exactly those fields.

## Development

```sh
npm install
npm run build       # → dist/plugin.mjs, dist/manifest.json, dist/index.mjs
npm run validate    # manifest schema check (offline)
npm run typecheck   # tsc --noEmit
```

## License

MIT — see [LICENSE](./LICENSE).
