# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Astro server-rendered storefront with EmDash CMS, Commerce Core, CHIP payments, Cloudflare D1, R2, KV sessions, and Workers deployment.

## Users

Independent merchants can configure and operate the store themselves. Web developers and agencies can also build, brand, and hand off deployments to merchant operators. Shoppers browse published products, manage a cart, and complete hosted CHIP checkout.

## Product Purpose

Provide an EmDash-native commerce starter where the same backoffice manages site content, navigation, media, catalog, inventory, orders, customers, and payment configuration. Success means a merchant or agency can deploy, edit, publish, and operate a storefront without editing Astro source for routine content or catalog changes.

## Positioning

EmDash-native commerce: CMS-managed content and media, Commerce Core-managed commercial records, and provider-managed payments joined in one operator workflow.

## Operating Context

- Merchants work in the EmDash admin to edit content, site settings, menus, media, products, variants, inventory, orders, customers, and CHIP settings.
- Agencies may create and brand a deployment before handing it to a merchant.
- Shoppers use the public storefront and CHIP hosted payment flow.
- Cloudflare resources are customer-owned per deployment.

## Capabilities and Constraints

- Public pages must render from published EmDash content and published Commerce products.
- Commerce records persist through D1-backed plugin collections.
- Product and editorial media use EmDash Media backed by R2 in the starter.
- Checkout totals and payment commands remain server-authoritative.
- CHIP credentials and bridge secrets remain server-side.
- Routine content, navigation, media, catalog, and payment configuration changes must not require source edits.

## Brand Commitments

The starter is merchant-neutral and rebrandable. No fictional merchant claims, testimonials, pricing promises, or permanent brand identity should be treated as product truth.

## Evidence on Hand

- Commerce Core product, variant, inventory, order, customer, and bridge contracts.
- CHIP hosted checkout and verified callback integration.
- EmDash pages, menus, site settings, media, and Portable Text APIs.
- No customer testimonials, case studies, or merchant-specific brand assets are available; do not fabricate them.

## Product Principles

- Backoffice truth: what operators publish in EmDash is what shoppers see.
- Clear ownership: CMS content, Commerce records, media, and payment-provider state keep distinct boundaries.
- Safe defaults: draft content and unpublished products never leak into public pages.
- Rebrandable by design: client identity and content are data, not source literals.
- Familiar operations: product, order, customer, inventory, and settings flows should feel immediately usable to WordPress/Shopify operators.

## Accessibility & Inclusion

Public and admin surfaces must use semantic structure, keyboard-accessible controls, visible focus, sufficient contrast, reduced-motion support, readable error/empty states, and text alternatives for media.
