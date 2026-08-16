# PRD: CHIP for EmDash — Payment Plugin

> Status: Draft v1 · Target platform: EmDash CMS (Astro) · Author: CHIP Asia
> Build this plugin from scratch as an **open-source EmDash plugin** so any EmDash site owner can accept CHIP payments (FPX, e-wallet, card, DuitNow QR) via a hosted CHIP checkout.

---

## 1. Product Overview

### 1.1 One-liner

An EmDash CMS plugin that lets site owners **create CHIP payment links / payment buttons** on their Astro site, redirect customers to CHIP's hosted checkout, and record the resulting payment status — with a settings page and a payments dashboard in the EmDash admin.

### 1.2 Goals (MVP)

1. Configure CHIP **Collect** credentials (secret key, brand ID, public key) from the EmDash admin.
2. Expose a **public API route** that creates a CHIP purchase and returns a `checkout_url`.
3. Handle the **return redirect** (`success_callback` / `failure_callback`) and the **server-to-server webhook** (`purchase.paid`) so payment status stays accurate even if the customer closes the browser.
4. Persist each payment attempt in plugin storage with a clear status, and list them in an admin page.
5. Ship as a **standard-format plugin** so it works in both trusted (in-process) and sandboxed (Cloudflare isolate) modes, and is publishable to the EmDash marketplace.

### 1.3 Non-goals (MVP)

- Recurring/subscription tokens & saved payment methods (CHIP tokenization). Deferred to v2.
- CHIP Send (payouts) — separate plugin later.
- A full e-commerce/order system. EmDash has no cart/orders; the plugin records *payments*, and the site decides what a payment is for.
- Native (React) admin UI, Portable Text block types, or custom Astro components. Standard-format only.

### 1.4 Why standard format

Standard-format plugins (`emdash-plugin.jsonc` + `src/plugin.ts`) run in both trusted and sandboxed modes, and can be published to the marketplace with one click. Native plugins can't be sandboxed or published. A CHIP plugin is exactly the "third-party extension" use case the marketplace is built for.

---

## 2. Technical Constraints (verified against EmDash source)

These were checked against the current EmDash repo (`packages/core/src/plugins/`) and must drive the design.

### 2.1 Plugin shape (current model)

Author two files (see `packages/plugins/webhook-notifier` as the canonical example):

- **`emdash-plugin.jsonc`** — identity (`slug`, `publisher`), trust contract (`capabilities`, `allowedHosts`, `storage`), and admin profile (`pages`, `widgets`).
- **`src/plugin.ts`** — `export default { hooks, routes } satisfies SandboxedPlugin` imported from `emdash/plugin` (type-only subpath).

Build via `@emdash-cms/plugin-cli` (`npx @emdash-cms/plugin-cli init my-plugin` scaffolds it).

### 2.2 Routes

- Plugin routes mount at `/_emdash/api/plugins/<id>/<route>`.
- A route is `public: true` to skip auth + CSRF (needed for `create`, `return`, `callback`).
- Input validation: Zod via `input` field, or read `routeCtx.input` directly (parsed body for POST/PUT/PATCH; query params for GET).
- Handler signature: `handler: async (routeCtx, ctx) => Promise<unknown>`. `routeCtx.input`, `routeCtx.request`, `ctx.storage`, `ctx.kv`, `ctx.log`, `ctx.http` are available.
- Admin-only routes (settings, payments list) are private by default; the admin UI calls them via `usePluginAPI`.

### 2.3 Storage

- Declared in `emdash-plugin.jsonc` → `storage.payments.indexes`.
- `ctx.storage.payments` → `.get(id)`, `.put(id, data)`, `.delete(id)`, `.query({ where, orderBy, limit, cursor })`, `.count(where)`.
- All data is JSON documents scoped to the plugin. No SQL.

### 2.4 KV (settings)

- `ctx.kv.set("settings:secretKey", v)` / `ctx.kv.get("settings:secretKey")`.
- `settings:*` keys are user-configurable (shown in admin); `state:*` is internal.

### 2.5 Network

- Requires capability `network:request` + `allowedHosts: ["gate.chip-in.asia"]`.
- Outbound calls use `ctx.http.fetch()` (not global `fetch`) so sandboxed mode works.
- `ctx.http` is only present when the capability is granted; guard with `if (!ctx.http) throw ...`.

### 2.6 CRITICAL — webhook signature verification vs. raw body

**EmDash plugin routes cannot read the raw request body.** EmDash parses the body once and exposes it as `routeCtx.input`, then guards `ctx.request.json()/text()/arrayBuffer()/…` so re-reading throws an actionable error (`packages/core/src/plugins/routes.ts`). CHIP's webhook `X-Signature` is an **RSA PKCS#1 v1.5 + SHA-256 signature over the raw body bytes**, so it cannot be verified inside a plugin route as-is.

**Decision: verify-by-query instead of verify-by-signature (MVP).**

The webhook payload includes the CHIP `purchase.id`. Instead of trusting the signature, the plugin:
1. Reads `purchase.id` from the webhook body (`routeCtx.input`).
2. Calls CHIP `GET /v1/purchases/{id}/` with the configured **secret key**.
3. Only updates the payment record if CHIP confirms the status and the purchase's `reference` matches our stored reference.

This is cryptographically sound: an attacker can't forge a CHIP purchase record or a paid status without the secret key, and we never act on unverified webhook body fields. It mirrors the WooCommerce plugin's own fallback path (`api()->get_payment($payment_id)` when `X-Signature` is absent).

> Flag for later: if EmDash exposes raw-body access to plugin routes, upgrade to full RSA signature verification using the configured public key (the WooCommerce plugin's `openssl_verify` path). Keep the `settings:publicKey` setting now so the upgrade is drop-in.

---

## 3. CHIP Collect API Contract (authoritative source)

Fetch the spec, don't hardcode from memory: **https://docs.chip-in.asia/openapi/chip-collect.yaml**

| Item | Value |
|---|---|
| Base URL | `https://gate.chip-in.asia/api/v1/` |
| Auth | `Authorization: Bearer <SECRET_KEY>` |
| Content-Type | `application/json` |
| Amounts | **cents** (5000 = RM 50.00) |
| Test vs live | separate secret/public keys; Test Mode on in portal |

### Endpoints used in MVP

- `POST /purchases/` → `{ id, checkout_url, status }` — create a payment, get redirect URL.
- `GET /purchases/{id}/` → full purchase incl. `status`, `reference`, `paid_on` — verify-by-query.
- `GET /public_key/` → RSA public key for future signature verification.

### Create-purchase request body (MVP)

```json
{
  "client": { "email": "customer@example.com" },
  "purchase": {
    "currency": "MYR",
    "products": [{ "name": "Order #1234", "price": 5000, "quantity": 1 }]
  },
  "brand_id": "<BRAND_ID>",
  "success_callback": "https://site.com/_emdash/api/plugins/chip-for-emdash/return?status=success",
  "failure_callback": "https://site.com/_emdash/api/plugins/chip-for-emdash/return?status=failure",
  "cancel_callback": "https://site.com/_emdash/api/plugins/chip-for-emdash/return?status=cancel"
}
```

> `success_callback`/`failure_callback`/`cancel_callback` are the return-URLs CHIP redirects the *browser* to. They must be the plugin's public `return` route so the plugin can (a) re-verify by query and (b) then redirect the customer onward to the site's own thank-you/failure page.

### Purchase statuses

`created` → `paid` | `failed` | `cancelled` (plus `hold` for pre-auth), and `refunded` for CHIP-dashboard refunds (webhook-only detection). The plugin stores the latest confirmed status.

---

## 4. Architecture

### 4.1 Plugin id & package

- `slug`: `chip-for-emdash`
- npm name: `@chip-in-asia/plugin-chip-for-emdash` (or `chip-for-emdash` if unscoped)
- version: `0.1.0`

### 4.2 Files

```
chip-for-emdash/
├── emdash-plugin.jsonc      # identity + capabilities + storage + admin
├── package.json             # name, exports (".", "./sandbox"), scripts, peerDep emdash
├── tsconfig.json
├── src/
│   └── plugin.ts            # export default { hooks?, routes } satisfies SandboxedPlugin
├── README.md                # setup + site-integration instructions
├── LICENSE (MIT)
└── (later) icon.png, screenshots/
```

### 4.3 `emdash-plugin.jsonc`

```jsonc
{
  "$schema": "https://docs.emdashcms.com/plugin/schema.json", // confirm exact URL
  "slug": "chip-for-emdash",
  "publisher": "<your atproto DID>", // set at publish time via plugin-cli login
  "license": "MIT",
  "author": { "name": "CHIP Asia" },
  "security": { "url": "https://github.com/CHIPAsia/chip-for-emdash/security/advisories/new" },
  "description": "Accept CHIP payments (FPX, e-wallet, card, DuitNow QR) on any EmDash site via hosted checkout.",

  "capabilities": ["network:request"],
  "allowedHosts": ["gate.chip-in.asia"],

  "storage": {
    "payments": { "indexes": ["status", "reference", "purchaseId", "createdAt"] }
  },

  "admin": {
    "pages": [
      { "path": "/settings", "label": "CHIP Settings", "icon": "settings" },
      { "path": "/payments", "label": "CHIP Payments", "icon": "credit-card" }
    ],
    "widgets": [
      { "id": "chip-summary", "title": "CHIP Payments", "size": "third" }
    ]
  }
}
```

### 4.4 Routes (`src/plugin.ts`)

| Route | Public | Method(s) | Purpose |
|---|---|---|---|
| `create` | yes | POST | Body: `{ amount, currency, reference, name, email, products?, metadata? }`. Calls CHIP `POST /purchases/`, stores payment record, returns `{ id, checkoutUrl }`. |
| `return` | yes | GET | Browser return. Query: `?id=<purchaseId>&status=…`. Verify-by-query, update record, then `Response.redirect` to the site's configured success/failure page. |
| `callback` | yes | POST | Server-to-server webhook. Verify-by-query on `purchase.id`, update record, always return 200 (avoid CHIP retry storms). |
| `payments` | no | GET | Admin list (paginated, filter by status). |
| `payments/detail` | no | GET | Admin detail for one payment. |
| `settings` | no | GET | Return current settings (mask secretKey). |
| `settings/save` | no | POST | Persist `settings:secretKey`, `settings:brandId`, `settings:publicKey`, `settings:successUrl`, `settings:failureUrl`, `settings:cancelUrl`. |
| `admin` | no | POST | Block Kit handler — drives the settings page, payments page, and dashboard widget via `page_load`/`form_submit`/`block_action` interactions. |

### 4.5 Data model — `payments` storage document

```ts
interface PaymentRecord {
  id: string;                 // plugin-generated ULID-ish id
  purchaseId: string;         // CHIP purchase id (set after create; = lookup key)
  reference: string;          // site's own order/product reference
  amount: number;             // cents
  currency: string;
  status: "created" | "paid" | "failed" | "cancelled" | "hold" | "refunded";
  productName: string;
  clientEmail?: string;
  metadata?: Record<string, unknown>; // passthrough for the site
  checkoutUrl?: string;
  createdAt: string;          // ISO
  updatedAt: string;
}
```

### 4.6 Create-purchase flow (route `create`)

1. Read `amount`, `currency`, `reference`, `clientEmail`, `name`, optional `metadata`.
2. Validate: amount > 0, currency present, reference present. Return 400 on failure.
3. Build CHIP payload with `client`, `purchase.products` (single product: `{ name, price: amount, quantity: 1 }`), `brand_id`, and the three callback URLs (from `settings:*`, resolved against the request's origin so they work on any deployment).
4. `ctx.http.fetch("https://gate.chip-in.asia/api/v1/purchases/", { method:"POST", headers, body })`.
5. If CHIP returns `checkout_url`: write `PaymentRecord{ status:"created", purchaseId, checkoutUrl, … }` to `ctx.storage.payments`, return `{ id, checkoutUrl }`.
6. Else: log, return a 502 with CHIP's error message.

### 4.7 Return flow (route `return`)

1. Read `id` (CHIP purchase id) and `status` from query.
2. Load record by `purchaseId` (query index `purchaseId`). If missing, redirect to failure page.
3. **Verify-by-query:** call `GET /v1/purchases/{id}/`. Confirm CHIP's `status`. If CHIP says `paid`, set record `paid` (+ `paidOn`). If CHIP says `failed`/`cancelled`, set accordingly. Do not trust the query `status` param.
4. `return new Response(null, { status: 302, headers: { Location: <successUrl|failureUrl> } })`.

### 4.8 Webhook flow (route `callback`) — verify-by-query

1. Read body (`routeCtx.input`): `{ event_type, object: { id, status } }`. `event_type` like `purchase.paid`.
2. `GET /v1/purchases/{object.id}/` (verify-by-query). If the fetched purchase doesn't exist / differs, log and **return 200 with `{ ok: true }`** (never a non-200, or CHIP retries).
3. Load our record by `purchaseId`. If found and `status` changed, update record.
4. Return `{ ok: true }` (HTTP 200).

Idempotency: status updates are idempotent (only overwrite if different); webhooks can be delivered multiple times.

### 4.9 Block Kit admin

Mirror the patterns in `webhook-notifier`:

- **Settings page** (`page_load` for `/settings`): a `form` block with:
  - `secret_input` — secretKey
  - `text_input` — brandId
  - `text_input` — publicKey
  - `text_input` — successUrl / failureUrl / cancelUrl (site's own thank-you pages)
  - submit → `settings/save` values to KV.
- **Payments page** (`page_load` for `/payments`): a `table` block (columns: reference, amount, currency, status `badge`, created `relative_time`) fed from `ctx.storage.payments.query({ orderBy: { createdAt: "desc" }, limit: 50 })`.
- **Dashboard widget** (`page_load` for `widget:chip-summary`): `stats` block with counts of `paid`, `pending`, `failed`.
- **Test button** (`block_action` `test_chip`): calls `GET /v1/public_key/` (or creates an RM 1.00 test purchase) and returns a `toast` with the result — a one-click "credentials OK?" check.

---

## 5. Security

| Concern | Control |
|---|---|
| Secret key exposure | Stored in KV under `settings:secretKey`; never returned by the `settings` GET route (mask it); never logged. |
| Forged webhooks | Verify-by-query: only act on a CHIP purchase that the secret key can retrieve; never trust webhook body status. |
| Forged return redirect | Same — re-verify status via CHIP API before trusting. |
| CORS | CHIP has no CORS; all CHIP calls are server-side via `ctx.http`. Secret never shipped to the browser. |
| Open `create` route | Public by design (a payment button needs no auth). Validate amount/currency/reference; add optional rate-limiting/`metadata` allow-list later if abuse appears. |
| Sandboxed mode | Capability `network:request` scoped to `gate.chip-in.asia` only; storage auto-scoped to the plugin. |
| Logs | Never log secret key or full webhook bodies containing client PII beyond what's needed. |

---

## 6. Implementation Checklist (for the OMP agent)

Follow the current EmDash plugin model — **do not** follow stale skill examples that put `id`/`version` in `definePlugin()` with a `PluginDescriptor` factory; the current model is `emdash-plugin.jsonc` + `src/plugin.ts`. Reference the real repo examples:

- `packages/plugins/webhook-notifier/emdash-plugin.jsonc`
- `packages/plugins/webhook-notifier/src/plugin.ts` (route + Block Kit patterns)
- `packages/plugins/api-test/src/index.ts` (ctx.http usage)
- `packages/core/src/plugins/types.ts` (authoritative types)

### Steps

1. Scaffold with `npx @emdash-cms/plugin-cli init chip-for-emdash`.
2. Write `emdash-plugin.jsonc` (per §4.3).
3. Implement the CHIP client helper in `src/plugin.ts`:
   - `chipFetch(ctx, path, { method, body })` → `ctx.http.fetch("https://gate.chip-in.asia/api/v1" + path, …)` with Bearer auth; guard `if (!ctx.http)`.
   - `createPurchase(ctx, payload)`, `getPurchase(ctx, id)`, `getPublicKey(ctx)`.
4. Implement routes `create`, `return`, `callback` (verify-by-query), `payments`, `payments/detail`, `settings`, `settings/save`, `admin` (§4.4–4.9).
5. Add idempotent status updates (§4.8) and callback-URL resolution (§4.6 step 3).
6. Write README with: install (`plugins: [chipForEmdash()]` in `astro.config.mjs` or marketplace install), configure credentials in admin, and the site-side usage snippet:

   ```html
   <button onclick="pay()">Pay RM 50</button>
   <script>
   async function pay() {
     const res = await fetch("/_emdash/api/plugins/chip-for-emdash/create", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ amount: 5000, currency: "MYR", reference: "order-123", name: "Product", email: "c@example.com" }),
     });
     const data = await res.json();
     if (data.checkoutUrl) window.location.href = data.checkoutUrl;
   }
   </script>
   ```
7. Add LICENSE (MIT), `.gitignore` (node_modules, dist, .env).
8. Build: `npx @emdash-cms/plugin-cli build`; verify `dist/plugin.mjs`, `dist/manifest.json`, `dist/index.mjs`.
9. Validate: `npx @emdash-cms/plugin-cli validate` (catches manifest schema errors).
10. Typecheck: `tsc --noEmit`.

### Verification (manual)

1. In a local EmDash demo site, add the plugin to `plugins: []`, start dev server, open admin.
2. Settings page: enter **Test Mode** secret key + brand ID (portal → Developers → Test Mode ON). Save.
3. Press the test button → expect "credentials OK".
4. Call `create` (curl or the snippet) → open returned `checkout_url`, complete a sandbox payment.
5. Confirm the payment record flips to `paid` via the admin Payments page *and* via `GET /payments`.
6. Test failure + cancel paths.
7. Deploy to Cloudflare (sandboxed) and repeat to confirm sandbox mode works.

---

## 7. Publishing (later, post-MVP)

```sh
npx @emdash-cms/plugin-cli login        # atproto auth
npx @emdash-cms/plugin-cli bundle        # registry tarball
npx @emdash-cms/plugin-cli publish --url <hosted-tarball-url>
```

Note: `publish` needs a public artifact URL; also add icon + screenshots to the repo for the marketplace listing.

---

## 8. Open Questions / Flags

1. **Raw-body signature verification** — blocked by EmDash plugin-route constraint (§2.6). MVP uses verify-by-query. Confirm with the EmDash team whether raw body access is planned; if yes, add RSA verification using `settings:publicKey`.
2. **Callback URL configuration** — should callback base URLs be auto-derived from the request origin (works everywhere) or explicit settings? Recommended: auto-derive, allow override via settings.
3. **Publisher DID** — needed for marketplace publishing; obtain via `plugin-cli login`.
4. **`emdash-plugin.jsonc` `$schema` URL** — confirm the canonical schema URL from the plugin-cli package.
5. **Rate limiting on public `create`** — consider per-IP/per-minute limits before public launch to prevent abuse.
6. **Currency/amount validation** — enforce allowed currencies from CHIP (e.g. `MYR`, `USD`, `SGD`); fetch supported set via `payment_methods` later.
7. **Test-mode toggle** — CHIP returns different keys for test vs live. Add a `settings:testMode` flag + clear admin labeling so users don't charge real money while testing.

---

## 9. Deliverables

1. `chip-for-emdash/` plugin repo (MIT, open source under CHIPAsia).
2. `src/plugin.ts` implementing routes + Block Kit admin (§4).
3. `emdash-plugin.jsonc` manifest (§4.3).
4. README with setup + site integration.
5. Marketplace-publishable bundle (v0.2+).
