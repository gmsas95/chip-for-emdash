# Commerce Storefront and Admin Design

## Goal

Turn the current Commerce Core route/admin shell into a usable WooCommerce-style commerce surface: operators can create and publish products with variants, inventory, and R2-backed media; customers can browse the catalog, add products to a cart, start CHIP checkout, and inspect order results.

## Problem

Commerce currently exposes sidebar pages and read-only list endpoints, but the product page only renders a bare list and has no create/edit workflow. The checkout routes already recalculate prices server-side, but there is no complete storefront UI around them. Deployments must persist Commerce records in D1 and product media through EmDash's R2-backed media pipeline.

## Architecture

Commerce remains a native EmDash plugin. Structured records use the existing declared Commerce collections through `createEmDashRepositories()`, which maps to EmDash's D1-backed plugin storage. Product images are EmDash media references; the admin uploads them through the authenticated media API and EmDash stores the bytes in the configured R2 binding. Product documents store only media metadata/reference IDs and derived URLs.

The storefront is an Astro/React surface in `apps/commerce-starter`. It calls the public Commerce catalog/cart/checkout/order routes; it never writes authoritative totals or provider credentials. Checkout starts through Commerce with provider `chip`, receives a hosted CHIP URL, and handles the platform's JSON return envelope on a dedicated result page.

## Product and variant data contract

Product documents in the `products` collection:

```ts
interface ProductDocument {
  name: string;
  slug: string;
  description: string;
  status: "draft" | "published" | "archived";
  sku?: string;
  priceMinor?: number;
  compareAtMinor?: number;
  currency: string;
  images: ProductImage[];
  hasVariants: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ProductImage {
  mediaId: string;
  url: string;
  alt: string;
}
```

Variant documents in `variants`:

```ts
interface VariantDocument {
  productId: string;
  name: string;
  sku: string;
  status: "draft" | "published" | "archived";
  priceMinor: number;
  currency: string;
  options: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}
```

Inventory documents in `inventory`:

```ts
interface InventoryDocument {
  productId: string;
  variantId?: string;
  sku: string;
  status: "active" | "disabled";
  available: number;
  reserved: number;
  updatedAt: string;
}
```

Products without variants use `priceMinor`, `currency`, and optional `sku` directly. Products with variants use variant prices/SKUs and expose their variants in the catalog response. All prices are safe integer minor units and all currencies are three-letter uppercase ISO codes.

## Admin API

Add private Commerce routes using the existing EmDash parsed route input:

- `GET /products` — paginated product list with status filter.
- `POST /products/save` — create or update one product, its variants, and inventory records atomically at the application level.
- `POST /products/archive` — archive a product and its variants without destructive deletion.
- `GET /products/detail` — return one product, variants, inventory, and media references.
- `GET /provider-status` — return provider-neutral bridge status and a CHIP settings URL; never return secrets.

The existing public `GET /catalog` route returns only published products and includes normalized public variant data and image references. Existing cart and checkout routes remain the source of truth for availability and totals.

## Admin UI

Replace list-only admin pages with usable data surfaces:

- Products: searchable table, status badges, create/edit form, archive action, variant editor, inventory fields, price/currency validation, and image/media picker.
- Inventory: SKU/product/variant rows, available/reserved counts, and links back to the product editor.
- Orders: order table with status, totals, line details, payment reference, and customer/address snapshots.
- Customers: customer table with email, name, order count, and order links.
- Settings: provider status cards, direct CHIP settings link, Commerce event URL guidance, and no secret inputs.

The Commerce settings page must make CHIP configuration discoverable even if the standard CHIP plugin pages are not visible in the sidebar. CHIP secrets remain editable only in the CHIP plugin's masked Block Kit settings form.

## Storefront routes

Implement the starter as a product-first storefront:

- `/` — hero, featured products, value/trust section, FAQ, and catalog CTA.
- `/shop` — catalog grid with loading, empty, error, and pagination states.
- `/shop/[slug]` — product detail, image gallery, variant selection, quantity, and add-to-cart.
- `/cart` — line editing, remove action, subtotal, and checkout CTA.
- `/checkout` — shipping/contact form and payment-provider start action.
- `/checkout/result` — success/failure/cancelled state based on the CHIP return payload/query.
- `/orders/[id]` — order status, totals, line items, and payment reference.
- `/about`, `/shipping-returns`, `/privacy`, `/terms`, `/contact` — required trust/legal pages.

The visual system uses warm white/ink surfaces with one orange accent, CSS custom properties for merchant rebranding, responsive layouts, accessible labels/focus states, and no invented product data or fake brand assets.

## Persistence and media

- Commerce records are written through `context.storage` and therefore persist in the EmDash D1-backed plugin collections on Cloudflare.
- Product images are uploaded through `POST /_emdash/api/media` with the authenticated admin session and stored by EmDash's configured R2 adapter. Product documents retain `mediaId`, `url`, and `alt` only.
- Tests use `createMemoryRepositories()` only as deterministic unit fixtures; no production path may depend on memory repositories or browser localStorage for authoritative data.
- The starter's existing `DB` and `MEDIA` bindings remain the deployment source of truth.

## Security and failure behavior

- Public catalog exposes published products only.
- Admin mutations require the EmDash authenticated admin route boundary.
- Client totals, product prices, CHIP secrets, and bridge secrets are never trusted from or returned to browser code.
- Invalid product/variant/currency/price input returns a structured bad-request error.
- Archive is preferred over delete for products referenced by carts/orders.
- Missing media references render a safe placeholder and do not break catalog responses.
- Empty catalogs and unavailable products have explicit storefront states.

## Verification contract

- Domain tests cover product/variant validation, slug rules, price/currency invariants, archive behavior, and inventory constraints.
- Route tests cover authenticated product CRUD, public catalog filtering, persistence through a D1-shaped storage adapter, and media-reference round trips.
- Admin component tests cover create/edit/archive and visible CHIP configuration linking.
- Starter tests cover every required route's rendering contract and the checkout redirect/result transitions.
- Run Commerce tests, starter typecheck/build, and browser-drive the deployed storefront/admin routes. A real CHIP hosted checkout remains dependent on the supplied merchant account being configured and a published product existing in D1.

## CMS-backed storefront content

Marketing and trust content MUST be editable through EmDash's existing
published `pages` collection rather than hardcoded in Astro templates. The
frontend loads page entries with `getEmDashEntry` through a shared loader,
calls `Astro.cache.set(cacheHint)`, renders `PortableText`, and spreads
`entry.edit` attributes for logged-in visual editing.

Required seeded page slugs:

- `home`
- `about`
- `shipping-returns`
- `privacy`
- `terms`
- `contact`

The home page keeps Commerce product data live through the public catalog API,
but its hero and editorial content come from the published `home` page. Primary
and footer navigation come from EmDash menus. Embedded page images use EmDash
media objects and therefore persist through the configured R2 media adapter.
Missing pages show an explicit admin-create state rather than silently falling
back to hardcoded marketing copy.
