# Commerce Storefront and Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persisted WooCommerce-style Commerce admin and a complete Commerce/CHIP storefront in the EmDash Cloudflare starter.

**Architecture:** Commerce Core owns validated product, variant, inventory, order, and provider-status workflows through D1-backed EmDash plugin collections. EmDash's authenticated media API stores product images in the configured R2 adapter and product documents retain media references. The starter renders the storefront in Astro/React and calls the public Commerce client without trusting browser totals or provider secrets.

**Tech Stack:** TypeScript, React, Astro 7 server routes, EmDash native plugins, EmDash Block Kit, Cloudflare D1/R2/KV, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-commerce-storefront-admin-design.md`

## Global Constraints

- Commerce records MUST persist through `context.storage` and the EmDash D1-backed plugin collections.
- Product media MUST use the authenticated EmDash media API and the configured R2 binding.
- Public catalog MUST filter to `status: "published"`.
- Browser code MUST NOT supply authoritative totals, product prices, CHIP secrets, or bridge secrets.
- Product archive MUST be non-destructive; referenced products MUST NOT be hard-deleted.
- Prices MUST be safe integer minor units and currencies MUST be three-letter uppercase ISO codes.
- Existing Commerce cart/checkout/bridge contracts MUST remain compatible.
- Every task MUST add a focused observable test before implementation and run that test before moving on.

---

### Task 1: Add product, variant, and inventory domain contracts

**Files:**
- Create: `packages/commerce-core/src/domain/products.ts`
- Create: `packages/commerce-core/test/domain/products.test.ts`
- Modify: `packages/commerce-core/src/index.ts`
- Modify: `packages/commerce-core/src/storage/json.ts` only if the domain types need a shared JSON guard export.

**Interfaces:**
- Produces `ProductStatus`, `VariantStatus`, `InventoryStatus` string unions.
- Produces `ProductImage`, `ProductDocument`, `VariantDocument`, and `InventoryDocument` interfaces.
- Produces `validateProductInput(input: unknown): ProductDocument`.
- Produces `validateVariantInput(input: unknown, productId: string): VariantDocument`.
- Produces `validateInventoryInput(input: unknown, productId: string, variantId?: string): InventoryDocument`.
- Produces `isPublishedProduct(value: unknown): boolean` and `isPublishedVariant(value: unknown): boolean`.

- [ ] Write failing tests for a valid simple product, valid variant product, integer minor-unit rejection, lower-case currency rejection, empty slug rejection, invalid status rejection, negative inventory rejection, and image reference shape validation.
- [ ] Run `npm exec --yes pnpm@10 -- --filter @emdash-commerce/core vitest run packages/commerce-core/test/domain/products.test.ts` and confirm the new symbols are missing.
- [ ] Implement strict runtime narrowing and normalization. Preserve optional fields only when valid; reject unknown object/array shapes instead of coercing prices or statuses.
- [ ] Export the domain types and validators from `src/index.ts`.
- [ ] Run the focused domain test and then the Commerce package test suite.

---

### Task 2: Implement persisted product CRUD and public catalog normalization

**Files:**
- Modify: `packages/commerce-core/src/plugin.ts`
- Modify: `packages/commerce-core/src/storefront/types.ts`
- Modify: `packages/commerce-core/src/storage/collections.ts` only if additional indexes are required by the route queries.
- Create: `packages/commerce-core/test/plugin/products.test.ts`
- Modify: `packages/commerce-core/test/plugin/routes.test.ts`

**Interfaces:**
- Adds private route `GET /_emdash/api/plugins/emdash-commerce/products` with `{ items, hasMore, cursor }`.
- Adds private route `POST /_emdash/api/plugins/emdash-commerce/products/save` with `{ product, variants, inventory }` input and `{ product, variants, inventory }` output.
- Adds private route `GET /_emdash/api/plugins/emdash-commerce/products/detail` with `{ productId }` input and a complete product aggregate response.
- Adds private route `POST /_emdash/api/plugins/emdash-commerce/products/archive` with `{ productId }` input and `{ productId, status: "archived" }` output.
- Extends public `GET /catalog` items with validated product data, `variants`, and image references while retaining the existing envelope and pagination fields.

- [ ] Write failing route tests that save a draft product through a D1-shaped storage adapter, read it back from the product list/detail routes, publish it, and confirm public catalog includes it only after publication.
- [ ] Add tests for update preserving `createdAt`, archive excluding the product from public catalog, variant `productId` enforcement, inventory persistence, malformed input rejection, and cursor pagination.
- [ ] Run the focused route tests and confirm the new route keys/handlers are absent.
- [ ] Implement route input parsing through `context.input`, validated domain documents, and `repositoriesFromContext(context)`; write product, variants, and inventory documents through the EmDash storage adapter so deployed writes land in D1.
- [ ] Keep create/update/archive operations idempotent by stable IDs and preserve existing cart/checkout behavior.
- [ ] Add route metadata in `createPlugin()` with private admin routes and leave public `catalog` unchanged in visibility.
- [ ] Run focused product tests, existing route tests, and the full Commerce suite.

---

### Task 3: Build WooCommerce-style product administration

**Files:**
- Modify: `packages/commerce-core/src/admin/shared.tsx`
- Replace: `packages/commerce-core/src/admin/ProductsPage.tsx`
- Modify: `packages/commerce-core/src/admin/InventoryPage.tsx`
- Modify: `packages/commerce-core/src/admin/OrdersPage.tsx`
- Modify: `packages/commerce-core/src/admin/CustomersPage.tsx`
- Create: `packages/commerce-core/test/admin/products-page.test.tsx`
- Modify: `packages/commerce-core/src/admin.tsx` only if page exports change.

**Interfaces:**
- Adds `useCommerceMutation<TInput, TOutput>(path, apiBasePath)` in `admin/shared.tsx`, using `POST`, JSON, `X-EmDash-Request: 1`, and the EmDash envelope.
- `ProductsPage` renders list, status filter, create/edit form, variant rows, inventory controls, image references, save, and archive actions.
- `InventoryPage` renders SKU/product/variant rows and links to product editing.
- `OrdersPage` renders order status, currency-formatted totals, line details, and payment references.
- `CustomersPage` renders customer email/name/order count with order links.

- [ ] Write component tests for empty state, list state, create form submission, validation error, edit load/save, variant add/remove, archive confirmation, and loading/error states.
- [ ] Run focused component tests and confirm the new controls are absent.
- [ ] Implement semantic forms and tables with accessible labels, keyboard focus, status badges, and integer minor-unit display formatting.
- [ ] Keep API fetches same-origin and pass `apiBasePath` from EmDash's plugin admin context.
- [ ] Use a product image reference editor that accepts media IDs/URLs returned by the EmDash media API; do not place binary data in Commerce product documents.
- [ ] Run focused admin tests, typecheck, and the Commerce suite.

---

### Task 4: Make CHIP configuration discoverable from Commerce admin

**Files:**
- Modify: `packages/commerce-core/src/plugin.ts`
- Modify: `packages/commerce-core/src/admin/SettingsPage.tsx`
- Modify: `packages/commerce-core/src/admin/CommerceDashboard.tsx`
- Modify: `packages/commerce-core/test/plugin/routes.test.ts`
- Create: `packages/commerce-core/test/admin/settings-page.test.tsx`

**Interfaces:**
- Adds private `GET /provider-status` returning provider-neutral status: `{ providers: [{ id, label, configured, settingsPath, paymentsPath }] }`.
- CHIP status MUST be derived from route/configuration availability only; it MUST NOT read or return the CHIP secret.
- Settings and dashboard pages render a `Configure CHIP Payments` link to `/_emdash/admin/plugins/chip-for-emdash/settings` and a `View CHIP Payments` link to `/_emdash/admin/plugins/chip-for-emdash/payments`.

- [ ] Write failing tests for provider-status shape with no secrets and for visible direct CHIP links.
- [ ] Implement the route and UI card without coupling Commerce to CHIP storage internals.
- [ ] Run focused tests and confirm no secret values appear in rendered output or response objects.

---

### Task 5: Add authenticated media upload and product image references

**Files:**
- Create: `packages/commerce-core/src/admin/media.ts`
- Modify: `packages/commerce-core/src/admin/ProductsPage.tsx`
- Create: `packages/commerce-core/test/admin/media.test.ts`
- Modify: `commerce/apps/commerce-starter/test/smoke.test.ts` if route/config assertions need to cover media.

**Interfaces:**
- `uploadProductImage(file: File, alt: string): Promise<ProductImage>` calls `POST /_emdash/api/media` with `FormData`, same-origin credentials, and the CSRF request header, then maps the returned media item to `{ mediaId, url, alt }`.
- `listProductMedia()` calls `GET /_emdash/api/media?mimeType=image/` and returns media picker entries.
- Product save persists only media references in the D1-backed product document.

- [ ] Write failing tests for successful upload mapping, rejected upload envelopes, MIME/size failures, and product save carrying media references without file bytes.
- [ ] Implement the media API adapter and image picker/upload control.
- [ ] Verify on the deployed Worker that a test image upload creates an EmDash media row and an R2 object, then confirm the product D1 document stores only the media reference.

---

### Task 6: Build the storefront foundation and landing page

**Files:**
- Create: `commerce/apps/commerce-starter/src/lib/commerce.ts`
- Create: `commerce/apps/commerce-starter/src/components/StorefrontShell.tsx`
- Create: `commerce/apps/commerce-starter/src/components/ProductCard.tsx`
- Create: `commerce/apps/commerce-starter/src/components/ProductGallery.tsx`
- Create: `commerce/apps/commerce-starter/src/styles/storefront.css`
- Replace: `commerce/apps/commerce-starter/src/pages/index.astro`
- Create: `commerce/apps/commerce-starter/test/storefront.test.ts`

**Interfaces:**
- `formatMinorAmount(amountMinor, currency)` formats integer minor units with `Intl.NumberFormat`.
- `getCatalog()` uses `createCommerceClient()` and returns normalized catalog data.
- `cartStore` persists only cart ID/line intent in browser storage; server prices remain authoritative.
- `ProductCard` accepts a normalized catalog item and links to `/shop/<slug>`.

- [ ] Write failing tests for landing page sections, empty catalog state, product card price formatting, and missing-image placeholder behavior.
- [ ] Replace the blog homepage with the responsive ecommerce landing page: hero, featured catalog, trust/value section, FAQ, and footer legal links.
- [ ] Add CSS variables for warm-white/ink/orange design tokens, responsive breakpoints, reduced motion, focus states, and semantic layout.
- [ ] Run starter tests and Astro typecheck.

---

### Task 7: Add catalog, cart, checkout, result, order, and trust pages

**Files:**
- Create: `commerce/apps/commerce-starter/src/pages/shop/index.astro`
- Create: `commerce/apps/commerce-starter/src/pages/shop/[slug].astro`
- Create: `commerce/apps/commerce-starter/src/pages/cart.astro`
- Create: `commerce/apps/commerce-starter/src/pages/checkout.astro`
- Create: `commerce/apps/commerce-starter/src/pages/checkout/result.astro`
- Create: `commerce/apps/commerce-starter/src/pages/orders/[id].astro`
- Create: `commerce/apps/commerce-starter/src/pages/about.astro`
- Create: `commerce/apps/commerce-starter/src/pages/shipping-returns.astro`
- Create: `commerce/apps/commerce-starter/src/pages/privacy.astro`
- Create: `commerce/apps/commerce-starter/src/pages/terms.astro`
- Create: `commerce/apps/commerce-starter/src/pages/contact.astro`
- Modify: `commerce/apps/commerce-starter/src/components/StorefrontShell.tsx`
- Modify: `commerce/apps/commerce-starter/src/lib/commerce.ts`
- Modify: `commerce/apps/commerce-starter/test/storefront.test.ts`

**Interfaces:**
- Product detail resolves the published product by slug from the catalog response and supports variant selection.
- Cart calls `client.cart.create` and `client.cart.addLine`; it never calculates authoritative totals.
- Checkout calls `client.checkout.start({ cartId, paymentProvider: "chip", shippingAddress })` and redirects to `checkoutUrl`.
- Result page handles `ok`, `verified`, `status`, and `redirectTo` from CHIP's JSON platform response without assuming HTTP redirects.
- Order page calls `client.orders.get(orderId)` and renders an explicit not-found/error state.

- [ ] Write failing tests for route shell/nav links, product detail unavailable state, cart line addition, checkout redirect, result status mapping, order loading, and legal/contact page rendering.
- [ ] Implement all required pages using shared shell/components and accessible form controls.
- [ ] Add client-side cart state only for the cart identifier and optimistic line intent; reload authoritative cart data from Commerce after mutations.
- [ ] Run starter tests, typecheck, and production build.

---

### Task 8: Verify D1/R2 persistence and deployed flows

**Files:**
- Modify: `commerce/apps/commerce-starter/README.md`
- Modify: `commerce/README.md`
- Create: `commerce/apps/commerce-starter/test/e2e-contract.test.ts`

**Interfaces:**
- The README documents D1 structured collections, R2 media ownership, media upload flow, and the direct CHIP settings route.
- The smoke contract covers catalog, product admin route shape, media API integration assumptions, checkout result transitions, and provider-status links.

- [ ] Write failing smoke assertions for required storefront files, D1/R2 bindings, direct CHIP settings link, and no secret values in source.
- [ ] Implement documentation and smoke assertions.
- [ ] Run Commerce tests, starter tests, Astro typecheck, production build, and the deployed route smoke checks.
- [ ] Create one test product through the authenticated admin flow, verify it appears in D1 and public catalog after publication, upload one image and verify it appears in R2/media API, then exercise checkout until the CHIP hosted URL is returned using the configured test credentials.
- [ ] Commit the implementation in focused commits and update PR #3 with the new commit range and verification output.

### Task 9: Connect storefront content to EmDash CMS

**Files:**
- Create: `apps/commerce-starter/PRODUCT.md`
- Create: `apps/commerce-starter/src/lib/cms.ts`
- Create: `apps/commerce-starter/src/components/CmsPageContent.astro`
- Create: `apps/commerce-starter/src/components/CmsPageRoute.astro`
- Modify: `apps/commerce-starter/src/pages/index.astro`
- Modify: `apps/commerce-starter/src/pages/about.astro`
- Modify: `apps/commerce-starter/src/pages/shipping-returns.astro`
- Modify: `apps/commerce-starter/src/pages/privacy.astro`
- Modify: `apps/commerce-starter/src/pages/terms.astro`
- Modify: `apps/commerce-starter/src/pages/contact.astro`
- Modify: `apps/commerce-starter/src/layouts/Base.astro`
- Modify: `apps/commerce-starter/seed/seed.json`
- Modify: `apps/commerce-starter/test/smoke.test.ts`

**Interfaces:**
- `loadCmsPage(slug)` returns an EmDash page entry and its `cacheHint`.
- `CmsPageContent` renders `PortableText` and forwards `entry.edit` attributes.
- Homepage and trust/legal routes use published EmDash page entries.
- Primary and footer navigation use EmDash menus.

- [ ] Add seeded `home`, `shipping-returns`, `privacy`, `terms`, and `contact` pages plus a footer menu; preserve the existing `about` page.
- [ ] Replace hardcoded marketing/legal page copy with the CMS page loader, Portable Text, cache invalidation, and admin-create empty states.
- [ ] Remove static Shop/About/footer navigation assumptions and render configured EmDash menus.
- [ ] Add smoke assertions proving CMS loaders, cache hints, seeded page slugs, and menu-backed navigation are present.
- [ ] Run seed validation, starter typecheck/tests, and deployed admin-to-frontend edit verification on a clean client deployment.
