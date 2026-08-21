import { definePlugin, PluginRouteError } from "emdash";
import type { PluginDescriptor, ResolvedPlugin, RouteContext } from "emdash";
import { getCommerceEventSigningData, parseAddressSnapshot } from "@gmsas95/emdash-commerce-contracts";
import type { CommerceEvent, CustomerSnapshot } from "@gmsas95/emdash-commerce-contracts";
import { addCartLine } from "./domain/cart.js";
import type { Cart } from "./domain/cart.js";
import { createOrderSnapshot } from "./domain/orders.js";
import type { OrderSnapshot } from "./domain/orders.js";
import {
  catalogRoute,
  productArchiveRoute,
  productDetailRoute,
  productSaveRoute,
  productsRoute,
} from "./admin/products-api.js";
import { createMemoryReplayStore, verifyBridgeSignature } from "./bridge/signature.js";
import type { BridgeReplayStore } from "./bridge/signature.js";
import { sendBridgeCommand } from "./bridge/client.js";
import type { BridgeConnection } from "./bridge/client.js";
import { COMMERCE_COLLECTION_INDEXES } from "./storage/collections.js";
import { createEmDashRepositories } from "./storage/repositories.js";
import type { CommerceRepositories, EmDashCommerceStorage } from "./storage/repositories.js";

const PLUGIN_ID = "emdash-commerce";
const PLUGIN_VERSION = "0.2.0";
const checkoutLocks = new Map<string, Promise<void>>();

export interface CommercePaymentProvider {
  createPayment(input: { order: OrderSnapshot; idempotencyKey: string }): Promise<{ checkoutUrl: string; paymentReference?: string }>;
}
export type CommercePaymentBridgeConfig = Omit<BridgeConnection, "fetcher">;
export interface CommercePluginOptions {
  enabled?: boolean;
  bridgeSecrets?: Record<string, string>;
  paymentBridges?: Record<string, CommercePaymentBridgeConfig>;
  paymentProviders?: Record<string, CommercePaymentProvider>;
}
export type CommercePluginDescriptorOptions = Omit<CommercePluginOptions, "paymentProviders">;
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

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function parseCustomerInput(input: unknown): CustomerSnapshot | undefined {
  if (input === undefined) return undefined;
  if (!isRecord(input)) throw new Error("customer must be an object");
  const customer: CustomerSnapshot = {};
  for (const key of ["name", "email", "phone"] as const) {
    const value = input[key];
    if (value !== undefined && value !== null) {
      if (typeof value !== "string" || value.trim() === "") throw new Error(`customer.${key} must be a non-empty string`);
      customer[key] = value.trim();
    }
  }
  if (!customer.name && !customer.email && !customer.phone) throw new Error("customer requires name, email, or phone");
  return customer;
}

async function persistCustomer(repositories: CommerceRepositories, input: CustomerSnapshot): Promise<CustomerSnapshot> {
  const now = new Date().toISOString();
  const existing = input.email === undefined
    ? undefined
    : (await repositories.customers.query({ where: { email: input.email }, limit: 1 })).items[0];
  const customerId = existing?.id ?? `customer-${crypto.randomUUID()}`;
  const previous = isRecord(existing?.data) ? existing.data : {};
  await repositories.customers.put(customerId, {
    ...previous,
    ...input,
    customerId,
    status: "active",
    orderCount: typeof previous.orderCount === "number" ? previous.orderCount + 1 : 1,
    createdAt: typeof previous.createdAt === "string" ? previous.createdAt : now,
    updatedAt: now,
  } as never);
  return { ...input, customerId };
}

function paymentProviderFor(options: CommercePluginOptions, providerId: string): CommercePaymentProvider | undefined {
  const direct = options.paymentProviders?.[providerId];
  if (direct) {
    return direct;
  }
  const connection = options.paymentBridges?.[providerId];
  if (!connection) {
    return undefined;
  }
  return {
    async createPayment({ order, idempotencyKey }) {
      const response = await sendBridgeCommand(connection, {
        contract: "commerce.payment.create",
        version: 1,
        requestId: order.orderId,
        idempotencyKey,
        sentAt: new Date().toISOString(),
        payload: { operation: "charge", order },
      });
      if (!response.ok || !isRecord(response.data) || typeof response.data.checkoutUrl !== "string") {
        throw new Error("Payment bridge did not return a checkout URL");
      }
      return {
        checkoutUrl: response.data.checkoutUrl,
        ...(typeof response.data.paymentReference === "string" ? { paymentReference: response.data.paymentReference } : {}),
      };
    },
  };
}


async function providerStatusRoute(options: CommercePluginOptions, context: RouteContext): Promise<unknown> {
  requireMethod(context, "GET");
  const providerIds = [...new Set([
    ...Object.keys(options.paymentProviders ?? {}),
    ...Object.keys(options.paymentBridges ?? {}),
  ])];
  return {
    providers: providerIds.map((id) => ({
      id,
      label: id === "chip" ? "CHIP" : id,
      configured: Boolean(options.paymentProviders?.[id] || options.paymentBridges?.[id]?.sharedSecret),
      ...(id === "chip" ? {
        settingsPath: "/_emdash/admin/plugins/chip-for-emdash/settings",
        paymentsPath: "/_emdash/admin/plugins/chip-for-emdash/payments",
      } : {}),
    })),
  };
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
    currency: typeof body.currency === "string" ? body.currency : "USD",
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
    const variantId = typeof lineInput.variantId === "string" ? lineInput.variantId : undefined;
    const variant = variantId === undefined
      ? undefined
      : await repositories.variants.get(variantId) as unknown as Record<string, unknown> | undefined;
    if (!product || product.status !== "published" || (variantId !== undefined && (!variant || variant.status !== "published" || variant.productId !== productId))) {
      throw PluginRouteError.notFound("Product or variant not found");
    }
    const catalog = variant ?? product;
    if (catalog.status !== "published" || typeof catalog.priceMinor !== "number" || typeof catalog.currency !== "string") {
      throw PluginRouteError.badRequest("Product price is invalid");
    }
    if (cart.lines.length === 0) {
      cart.currency = catalog.currency;
    }
    try {
      cart = addCartLine(cart, {
        productId,
        variantId,
        sku: typeof catalog.sku === "string" ? catalog.sku : undefined,
        name: typeof catalog.name === "string" ? catalog.name : undefined,
        unitAmountMinor: catalog.priceMinor,
        quantity,
        currency: catalog.currency,
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
  const provider = paymentProviderFor(options, paymentProvider);
  if (!provider) {
    throw PluginRouteError.badRequest(`Payment provider ${paymentProvider} is not configured`);
  }
  const cartId = body.cartId;
  if (typeof cartId !== "string") {
    throw PluginRouteError.badRequest("cartId is required");
  }
  const checkoutKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : cartId;
  const lockKey = cartId;
  const previous = checkoutLocks.get(lockKey);
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  checkoutLocks.set(lockKey, current);
  await previous;
  try {
    const repositories = repositoriesFromContext(context);
    const cart = await repositories.carts.get(cartId) as unknown as Cart | undefined;
    if (!cart) {
      throw PluginRouteError.notFound("Cart not found");
    }
    if (cart.status === "checked_out") {
      if (cart.checkoutKey !== checkoutKey || !cart.checkoutResult) {
        throw PluginRouteError.conflict("Cart has already been checked out");
      }
      return cart.checkoutResult;
    }
    if (cart.status === "checkout_pending" && cart.checkoutKey !== checkoutKey) {
      throw PluginRouteError.conflict("Cart checkout is already in progress");
    }
    const checkoutOrderId = cart.checkoutOrderId ?? `${cartId}-${checkoutKey}`;
    const orderAccessToken = crypto.randomUUID();
    cart.status = "checkout_pending";
    cart.checkoutKey = checkoutKey;
    cart.checkoutOrderId = checkoutOrderId;
    await repositories.carts.put(cartId, cart as never);
  let order;
  try {
    const lines = await Promise.all(cart.lines.map(async (line) => {
      const product = await repositories.products.get(line.productId) as unknown as Record<string, unknown> | undefined;
      const variant = line.variantId === undefined
        ? undefined
        : await repositories.variants.get(line.variantId) as unknown as Record<string, unknown> | undefined;
      const catalog = variant ?? product;
      if (!catalog || catalog.status !== "published" || (line.variantId !== undefined && (!variant || variant.status !== "published" || variant.productId !== line.productId)) || typeof catalog.priceMinor !== "number" || typeof catalog.currency !== "string") {
        throw new Error(`Product ${line.productId} is unavailable`);
      }
      return {
        lineId: line.lineId,
        productId: line.productId,
        name: typeof catalog.name === "string" ? catalog.name : line.name,
        quantity: line.quantity,
        unitAmountMinor: catalog.priceMinor,
        currency: catalog.currency,
        sku: typeof catalog.sku === "string" ? catalog.sku : line.sku,
      };
    }));
    const customerInput = parseCustomerInput(body.customer);
    const customer = customerInput === undefined ? undefined : await persistCustomer(repositories, customerInput);
    order = createOrderSnapshot({
      orderId: checkoutOrderId,
      orderAccessToken,
      currency: cart.currency,
      lines,
      customer,
      shippingAddress: body.shippingAddress === undefined ? undefined : parseAddressSnapshot(body.shippingAddress),
    });
  } catch (error) {
    cart.status = "active";
    cart.checkoutKey = undefined;
    cart.checkoutOrderId = undefined;
    await repositories.carts.put(cartId, cart as never);
    throw PluginRouteError.badRequest(error instanceof Error ? error.message : "Invalid checkout");
  }
  await repositories.orders.put(order.id, order);
  try {
    const payment = await provider.createPayment({ order, idempotencyKey: checkoutKey });
    const result = {
      orderId: order.id,
      orderAccessToken: order.orderAccessToken,
      checkoutUrl: payment.checkoutUrl,
      ...(payment.paymentReference === undefined ? {} : { paymentReference: payment.paymentReference }),
      totalMinor: order.totalMinor,
      currency: order.currency,
    };
    cart.status = "checked_out";
    cart.checkoutResult = result;
    await repositories.carts.put(cartId, cart as never);
    return result;
  } catch (error) {
    throw new PluginRouteError("PAYMENT_PROVIDER_ERROR", "Payment provider failed", 502);
  }
  } finally {
    release();
    if (checkoutLocks.get(lockKey) === current) {
      checkoutLocks.delete(lockKey);
    }
  }
}

async function publicOrderRoute(context: RouteContext): Promise<unknown> {
  requireMethod(context, "POST");
  const body = requestBody(context);
  if (typeof body.orderId !== "string" || typeof body.orderAccessToken !== "string") {
    throw PluginRouteError.notFound("Order not found");
  }
  const repositories = repositoriesFromContext(context);
  const order = await repositories.orders.get(body.orderId) as OrderSnapshot | undefined;
  if (!order || order.orderAccessToken !== body.orderAccessToken) {
    throw PluginRouteError.notFound("Order not found");
  }
  const { orderAccessToken: _orderAccessToken, ...safeOrder } = order;
  return safeOrder;
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
  const order = await repositories.orders.get(body.orderId);
  if (!order) {
    throw PluginRouteError.notFound("Order not found");
  }
  return order;
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

export function commercePlugin(options: CommercePluginDescriptorOptions = {}): PluginDescriptor<CommercePluginDescriptorOptions> {
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
      products: { public: false, handler: productsRoute },
      "products/detail": { public: false, handler: productDetailRoute },
      "products/save": { public: false, handler: productSaveRoute },
      "products/archive": { public: false, handler: productArchiveRoute },
      inventory: { public: false, handler: inventoryRoute },
      "provider-status": { public: false, handler: (context) => providerStatusRoute(options, context) },
      customers: { public: false, handler: customersRoute },
      cart: { public: true, handler: cartRoute },
      checkout: { public: true, handler: (context) => checkoutRoute(options, context) },
      order: { public: true, handler: publicOrderRoute },
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
