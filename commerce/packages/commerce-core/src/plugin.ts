import { definePlugin, PluginRouteError } from "emdash";
import type { PluginDescriptor, ResolvedPlugin, RouteContext } from "emdash";
import { getCommerceEventSigningData, parseAddressSnapshot } from "@emdash-commerce/contracts";
import type { CommerceEvent } from "@emdash-commerce/contracts";
import { addCartLine } from "./domain/cart.js";
import type { Cart } from "./domain/cart.js";
import { createOrderSnapshot } from "./domain/orders.js";
import type { OrderSnapshot } from "./domain/orders.js";
import { createMemoryReplayStore, verifyBridgeSignature } from "./bridge/signature.js";
import type { BridgeReplayStore } from "./bridge/signature.js";
import { COMMERCE_COLLECTION_INDEXES } from "./storage/collections.js";
import { createEmDashRepositories } from "./storage/repositories.js";
import type { CommerceRepositories, EmDashCommerceStorage } from "./storage/repositories.js";

const PLUGIN_ID = "emdash-commerce";
const PLUGIN_VERSION = "0.1.0";

export interface CommercePaymentProvider {
  createPayment(input: { order: OrderSnapshot }): Promise<{ checkoutUrl: string; paymentReference?: string }>;
}
export interface CommercePluginOptions {
  enabled?: boolean;
  bridgeSecrets?: Record<string, string>;
  paymentProviders?: Record<string, CommercePaymentProvider>;
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

function requireMethod(context: RouteContext, method: string): void {
  if (context.request.method !== method) {
    throw new PluginRouteError("METHOD_NOT_ALLOWED", `Method ${context.request.method} not allowed; expected ${method}`, 405);
  }
}

function requestBody(context: RouteContext): Record<string, unknown> {
  const body: unknown = context.input;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw PluginRouteError.badRequest("Request body must be an object");
  }
  return body as Record<string, unknown>;
}

async function catalogRoute(context: RouteContext): Promise<unknown> {
  requireMethod(context, "GET");
  return context.storage.products?.query({ where: { status: "published" }, limit: 50 });
}

async function inventoryRoute(context: RouteContext): Promise<unknown> {
  requireMethod(context, "GET");
  return context.storage.inventory?.query({ limit: 50 });
}

async function customersRoute(context: RouteContext): Promise<unknown> {
  requireMethod(context, "GET");
  return context.storage.customers?.query({ limit: 50 });
}

async function cartRoute(context: RouteContext): Promise<unknown> {
  requireMethod(context, "POST");
  const body = requestBody(context);
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
    if (typeof body.line !== "object" || body.line === null || Array.isArray(body.line)) {
      throw PluginRouteError.badRequest("Invalid cart line");
    }
    const lineInput = body.line as Record<string, unknown>;
    const productId = lineInput.productId;
    const quantity = lineInput.quantity;
    if (typeof productId !== "string" || typeof quantity !== "number") {
      throw PluginRouteError.badRequest("Cart line requires productId and quantity");
    }
    const product = await repositories.products.get(productId) as unknown as Record<string, unknown> | undefined;
    if (!product || product.status !== "published") {
      throw PluginRouteError.notFound("Product not found");
    }
    if (typeof product.priceMinor !== "number" || typeof product.currency !== "string") {
      throw PluginRouteError.badRequest("Product price is invalid");
    }
    if (cart.lines.length === 0) {
      cart.currency = product.currency;
    }
    try {
      cart = addCartLine(cart, {
        productId,
        variantId: typeof lineInput.variantId === "string" ? lineInput.variantId : undefined,
        sku: typeof product.sku === "string" ? product.sku : undefined,
        name: typeof product.name === "string" ? product.name : undefined,
        unitAmountMinor: product.priceMinor,
        quantity,
        currency: product.currency,
      });
    } catch (error) {
      throw PluginRouteError.badRequest(error instanceof Error ? error.message : "Invalid cart line");
    }
  }
  await repositories.carts.put(cartId, cart as never);
  return cart;
}

async function checkoutRoute(options: CommercePluginOptions, context: RouteContext): Promise<unknown> {
  requireMethod(context, "POST");
  const body = requestBody(context);
  if ("totalMinor" in body) {
    throw PluginRouteError.badRequest("Client totals are not accepted");
  }
  const paymentProvider = body.paymentProvider;
  if (typeof paymentProvider !== "string") {
    throw PluginRouteError.badRequest("paymentProvider is required");
  }
  const provider = options.paymentProviders?.[paymentProvider];
  if (!provider) {
    throw PluginRouteError.badRequest(`Payment provider ${paymentProvider} is not configured`);
  }
  const cartId = body.cartId;
  if (typeof cartId !== "string") {
    throw PluginRouteError.badRequest("cartId is required");
  }
  const repositories = repositoriesFromContext(context);
  const cart = await repositories.carts.get(cartId) as unknown as Cart | undefined;
  if (!cart) {
    throw PluginRouteError.notFound("Cart not found");
  }
  let order;
  try {
    order = createOrderSnapshot({
      orderId: typeof body.orderId === "string" ? body.orderId : crypto.randomUUID(),
      currency: cart.currency,
      lines: cart.lines.map((line) => ({
        lineId: line.lineId,
        productId: line.productId,
        name: line.name,
        quantity: line.quantity,
        unitAmountMinor: line.unitAmountMinor,
        currency: line.currency,
        sku: line.sku,
      })),
      shippingAddress: body.shippingAddress === undefined ? undefined : parseAddressSnapshot(body.shippingAddress),
    });
  } catch (error) {
    throw PluginRouteError.badRequest(error instanceof Error ? error.message : "Invalid checkout");
  }
  await repositories.orders.put(order.id, order);
  try {
    const payment = await provider.createPayment({ order });
    return {
      orderId: order.id,
      checkoutUrl: payment.checkoutUrl,
      ...(payment.paymentReference === undefined ? {} : { paymentReference: payment.paymentReference }),
      totalMinor: order.totalMinor,
      currency: order.currency,
    };
  } catch (error) {
    throw new PluginRouteError("PAYMENT_PROVIDER_ERROR", error instanceof Error ? error.message : "Payment provider failed", 502);
  }
}

async function ordersRoute(context: RouteContext): Promise<unknown> {
  const repositories = repositoriesFromContext(context);
  if (context.request.method === "GET") {
    return repositories.orders.query({ limit: 50 });
  }
  requireMethod(context, "POST");
  const body = requestBody(context);
  if (typeof body.orderId !== "string") {
    throw PluginRouteError.badRequest("orderId is required");
  }
  return repositories.orders.get(body.orderId);
}

async function bridgeEventsRoute(
  options: CommercePluginOptions,
  replayStore: BridgeReplayStore,
  context: RouteContext,
): Promise<unknown> {
  requireMethod(context, "POST");
  const providerId = context.request.headers.get("x-emdash-provider-id");
  const signature = context.request.headers.get("x-emdash-bridge-signature");
  const timestamp = context.request.headers.get("x-emdash-bridge-timestamp");
  const secret = providerId === null ? undefined : options.bridgeSecrets?.[providerId];
  if (!providerId || !signature || !timestamp || !secret) {
    throw PluginRouteError.unauthorized("Missing bridge authentication metadata");
  }
  const body = requestBody(context);
  const eventId = body.eventId;
  const deliveryId = body.deliveryId;
  if (body.version !== 1 || typeof eventId !== "string" || typeof deliveryId !== "string" || typeof body.event !== "string" || typeof body.occurredAt !== "string" || typeof body.correlationId !== "string" || !("payload" in body)) {
    throw PluginRouteError.badRequest("Invalid Commerce event envelope");
  }
  const event = body as unknown as CommerceEvent<unknown>;
  const rawBody = getCommerceEventSigningData(event);
  try {
    await verifyBridgeSignature(secret, timestamp, rawBody, signature);
  } catch {
    throw PluginRouteError.unauthorized("Invalid bridge signature");
  }
  const repositories = repositoriesFromContext(context);
  const existing = await repositories.orderEvents.get(deliveryId);
  if (existing) {
    return { ok: true, duplicate: true, deliveryId };
  }
  try {
    await verifyBridgeSignature(secret, timestamp, rawBody, signature, Date.now(), replayStore);
  } catch {
    throw PluginRouteError.unauthorized("Bridge event replayed");
  }
  await repositories.orderEvents.put(deliveryId, {
    ...body,
    id: deliveryId,
    providerId,
    status: "received",
    receivedAt: new Date().toISOString(),
  } as never);
  return { ok: true, duplicate: false, deliveryId, eventId };
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
      checkout: { public: true, handler: (context) => checkoutRoute(options, context) },
      orders: { public: false, handler: ordersRoute },
      "bridge/events": { public: true, handler: (context) => bridgeEventsRoute(options, replayStore, context) },
    },
    admin: {
      entry: "@emdash-commerce/core/admin",
      pages: [...ADMIN_PAGES],
      widgets: [{ id: "commerce-summary", title: "Commerce", size: "third" }],
    },
    ...(options.enabled === false ? { capabilities: [] } : {}),
  });
}
