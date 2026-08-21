# EmDash Commerce Starter

Deployable EmDash Cloudflare starter with Commerce Core and CHIP payments preconfigured.

The starter is derived from EmDash's `templates/starter-cloudflare` and adds:

- `@emdash-commerce/core` as a native plugin.
- `@chip-in-asia/plugin-chip-for-emdash` as a trusted payment plugin.
- Commerce-to-CHIP bridge routes and a shared HMAC secret setting.
- Cloudflare D1, R2, KV sessions, and a five-minute scheduled trigger.

## Requirements

- Node.js 20+
- pnpm 10+ (or `npm exec --yes pnpm@10 -- ...`)
- A Cloudflare account authenticated with Wrangler
- CHIP merchant credentials for test or live mode

## Local development

From the Commerce workspace root:

```sh
pnpm install
pnpm --filter @gmsas95/emdash-commerce-starter dev
```

The EmDash admin setup screen is available at `/_emdash/admin/setup`.

For local bridge configuration, copy `.env.example` to `.env` and set:

```sh
PUBLIC_SITE_URL=http://localhost:4321
COMMERCE_BRIDGE_SECRET=<same secret used by the Commerce bridge>
```

Generate a bridge secret with:

```sh
openssl rand -hex 32
```

## Cloudflare deployment

Authenticate and confirm the target account:

```sh
wrangler login
wrangler whoami
```

Set the build-time site URL and bridge secret. Do not commit this file:

```sh
cp .env.example .env.production
${EDITOR:-vi} .env.production
```

Set `PUBLIC_SITE_URL` to the final HTTPS Worker or custom-domain URL and
`COMMERCE_BRIDGE_SECRET` to a fresh random value. Production builds fail when
either value is missing because the bridge must not silently point at localhost
or run with an empty signing key.

Deploy from this directory or through the workspace filter:

```sh
pnpm --filter @gmsas95/emdash-commerce-starter deploy
```

The first deployment provisions the D1 database, R2 bucket, KV session namespace, and Worker. Review the generated resource names in `wrangler.jsonc` before deploying to a client account; resource IDs and names are customer-owned infrastructure.

After deployment:

1. Open `https://<worker-domain>/_emdash/admin/setup`.
2. Complete EmDash setup and sign in to the admin.
3. Open Commerce → **Products**.
4. Create a product, choose draft/published status, set SKU/currency/pricing,
   add variants, and set inventory counts.
5. Upload product images from the product editor. Uploads use the authenticated
   EmDash media API and are stored in the configured R2 bucket; product records
   store only media references in D1.
6. Publish at least one product and confirm it appears at `/shop`.
7. Open the CHIP settings page directly if the sidebar link is not visible:
   `https://<worker-domain>/_emdash/admin/plugins/chip-for-emdash/settings`.
8. Enter the CHIP secret key and brand ID from the CHIP portal.
9. Set success, failure, and cancel URLs to
   `https://<worker-domain>/checkout/result?status=success`,
   `https://<worker-domain>/checkout/result?status=failure`, and
   `https://<worker-domain>/checkout/result?status=cancel`.
10. Set **Commerce Bridge Secret** to the same `COMMERCE_BRIDGE_SECRET` value.
11. Set **Commerce Event URL** to
    `https://<worker-domain>/_emdash/api/plugins/emdash-commerce/bridge/events`.
12. Use the built-in credential test before enabling live payments.
13. Complete a CHIP test payment from `/checkout`, then verify the order,
    customer, inventory, and payment record in the admin.

The CHIP plugin keeps the secret key server-side, verifies browser returns and callbacks by re-fetching the confirmed CHIP purchase, and uses idempotent Commerce bridge deliveries. Do not put CHIP credentials or the bridge secret in browser code.

## Routes and APIs

Storefront pages:

- `/`
- `/shop`
- `/shop/<slug>`
- `/cart`
- `/checkout`
- `/checkout/result`
- `/orders/<order-id>`
- `/about`
- `/shipping-returns`
- `/privacy`
- `/terms`
- `/contact`

Commerce's storefront client targets:

- `GET /_emdash/api/plugins/emdash-commerce/catalog`
- `POST /_emdash/api/plugins/emdash-commerce/cart`
- `POST /_emdash/api/plugins/emdash-commerce/checkout`
- `POST /_emdash/api/plugins/emdash-commerce/order` with the checkout access token

Commerce admin routes are authenticated:

- `GET /_emdash/api/plugins/emdash-commerce/products`
- `GET /_emdash/api/plugins/emdash-commerce/products/detail`
- `POST /_emdash/api/plugins/emdash-commerce/products/save`
- `POST /_emdash/api/plugins/emdash-commerce/products/archive`
- `GET /_emdash/api/plugins/emdash-commerce/inventory`
- `GET /_emdash/api/plugins/emdash-commerce/orders`
- `GET /_emdash/api/plugins/emdash-commerce/customers`

Product records and orders persist in D1-backed Commerce collections. Product
media persists through EmDash's R2-backed media library.

The CHIP plugin exposes its payment routes under:

- `POST /_emdash/api/plugins/chip-for-emdash/commerce/payment/create`
- `GET /_emdash/api/plugins/chip-for-emdash/return`
- `POST /_emdash/api/plugins/chip-for-emdash/callback`

Commerce signs provider events at:

- `POST /_emdash/api/plugins/emdash-commerce/bridge/events`

The starter does not invent product data or merchant credentials. Those are intentionally configured per deployment so a client owns its catalog, payment account, database, storage, and domain.
