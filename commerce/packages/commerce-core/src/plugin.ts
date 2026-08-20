import { definePlugin } from "emdash";
import type { PluginDescriptor, ResolvedPlugin, RouteContext } from "emdash";
import { createOrderSnapshot } from "./domain/orders.js";
import { addCartLine } from "./domain/cart.js";
import { createEmDashRepositories } from "./storage/repositories.js";
import type { CommerceRepositories, EmDashCommerceStorage } from "./storage/repositories.js";
import type { Cart } from "./domain/cart.js";
import { createMemoryReplayStore, verifyBridgeSignature } from "./bridge/signature.js";
import type { BridgeReplayStore } from "./bridge/signature.js";
import { COMMERCE_COLLECTION_INDEXES } from "./storage/collections.js";

const PLUGIN_ID = "emdash-commerce";
const PLUGIN_VERSION = "0.1.0";

export interface CommercePluginOptions {
  enabled?: boolean;
  bridgeSecrets?: Record<string, string>;
}

const ADMIN_PAGES = [
  { path: "/dashboard", label: "Dashboard", icon: "chart-bar" },
  { path: "/products", label: "Products", icon: "package" },
  { path: "/inventory", label: "Inventory", icon: "warehouse" },
  { path: "/orders", label: "Orders", icon: "shopping-cart" },
  { path: "/customers", label: "Customers", icon: "users" },
  { path: "/settings", label: "Settings", icon: "gear" },
] as const;

const STORAGE = Object.fromEntries(
  Object.entries(COMMERCE_COLLECTION_INDEXES).map(([name, indexes]) => [name, { indexes: [...indexes] }]),
) as Record<string, { indexes: string[] }>;

function repositoriesFromContext(context: RouteContext): CommerceRepositories {
  return createEmDashRepositories(context.storage as unknown as EmDashCommerceStorage);
}

async function requestBody(context: RouteContext): Promise<Record<string, unknown>> {
  const body: unknown = await context.request.json();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("Request body must be an object");
  }
  return body as Record<string, unknown>;
}

async function catalogRoute(context: RouteContext): Promise<unknown> {
  return context.storage.products?.query({ limit: 50 });
}

async function inventoryRoute(context: RouteContext): Promise<unknown> {
  return context.storage.inventory?.query({ limit: 50 });
}

async function customersRoute(context: RouteContext): Promise<unknown> {
  return context.storage.customers?.query({ limit: 50 });
}

async function cartRoute(context: RouteContext): Promise<unknown> {
  const body = await requestBody(context);
  const repositories = repositoriesFromContext(context);
  const cartId = typeof body.cartId === "string" ? body.cartId : crypto.randomUUID();
  const existing = await repositories.carts.get(cartId) as unknown as Cart | undefined;
  let cart: Cart = existing ?? {
    id: cartId,
    currency: typeof body.currency === "string" ? body.currency : "MYR",
    lines: [],
    status: "active",
  };
  if (body.line !== undefined) {
    cart = addCartLine(cart, body.line as never);
  }
  await repositories.carts.put(cartId, cart as never);
  return cart;
}

async function checkoutRoute(context: RouteContext): Promise<unknown> {
  const body = await requestBody(context);
  const cartId = body.cartId;
  if (typeof cartId !== "string") {
    throw new Error("cartId is required");
  }
  const repositories = repositoriesFromContext(context);
  const cart = await repositories.carts.get(cartId) as unknown as Cart | undefined;
  if (!cart) {
    throw new Error("Cart not found");
  }
  const order = createOrderSnapshot({
    orderId: typeof body.orderId === "string" ? body.orderId : crypto.randomUUID(),
    currency: cart.currency,
    lines: cart.lines.map((line) => ({
      productId: line.productId,
      name: line.name,
      quantity: line.quantity,
      unitAmountMinor: line.unitAmountMinor,
      currency: line.currency,
      sku: line.sku,
    })),
  });
  await repositories.orders.put(order.id, order);
  return order;
}

async function ordersRoute(context: RouteContext): Promise<unknown> {
  const repositories = repositoriesFromContext(context);
  if (context.request.method === "GET") {
    return repositories.orders.query({ limit: 50 });
  }
  const body = await requestBody(context);
  if (typeof body.orderId !== "string") {
    throw new Error("orderId is required");
  }
  return repositories.orders.get(body.orderId);
}
async function bridgeEventsRoute(
  options: CommercePluginOptions,
  replayStore: BridgeReplayStore,
  context: RouteContext,
): Promise<unknown> {
  const deliveryId = context.request.headers.get("x-emdash-delivery-id");
  const providerId = context.request.headers.get("x-emdash-provider-id");
  const signature = context.request.headers.get("x-emdash-bridge-signature");
  const timestamp = context.request.headers.get("x-emdash-bridge-timestamp");
  const secret = providerId === null ? undefined : options.bridgeSecrets?.[providerId];
  if (!deliveryId || !providerId || !signature || !timestamp || !secret) {
    throw new Error("Missing bridge authentication metadata");
  }
  const rawBody = await context.request.text();
  await verifyBridgeSignature(secret, timestamp, rawBody, signature, Date.now(), replayStore);
  const parsed: unknown = JSON.parse(rawBody);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Bridge event body must be an object");
  }
  const body = parsed as Record<string, unknown>;
  const repositories = repositoriesFromContext(context);
  const existing = await repositories.orderEvents.get(deliveryId);
  if (existing) {
    return { ok: true, duplicate: true, deliveryId };
  }
  await repositories.orderEvents.put(deliveryId, {
    id: deliveryId,
    providerId,
    event: typeof body.event === "string" ? body.event : "unknown",
    status: "received",
    receivedAt: new Date().toISOString(),
  });
  return { ok: true, duplicate: false, deliveryId };
}

export function commercePlugin(options: CommercePluginOptions = {}): PluginDescriptor<CommercePluginOptions> {
  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    entrypoint: "@emdash-commerce/core",
    format: "native",
    options,
    adminEntry: "@emdash-commerce/core/admin",
    adminPages: [...ADMIN_PAGES],
    adminWidgets: [{ id: "commerce-summary", title: "Commerce", size: "third" }],
  };
}

export function createPlugin(options: CommercePluginOptions = {}): ResolvedPlugin {
  const replayStore = createMemoryReplayStore();
  return definePlugin({
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    storage: STORAGE,
    routes: {
      catalog: { public: true, handler: catalogRoute },
      inventory: { public: false, handler: inventoryRoute },
      customers: { public: false, handler: customersRoute },
      cart: { public: true, handler: cartRoute },
      checkout: { public: true, handler: checkoutRoute },
      orders: { public: false, handler: ordersRoute },
      "bridge/events": { public: false, handler: (context) => bridgeEventsRoute(options, replayStore, context) },
    },
    admin: {
      entry: "@emdash-commerce/core/admin",
      pages: [...ADMIN_PAGES],
      widgets: [{ id: "commerce-summary", title: "Commerce", size: "third" }],
    },
    ...(options.enabled === false ? { capabilities: [] } : {}),
  });
}
