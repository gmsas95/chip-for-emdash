import { definePlugin, PluginRouteError } from "emdash";
import type { PluginContext, PluginDescriptor, ResolvedPlugin, RouteContext } from "emdash";
import { getCommerceEventSigningData, parseAddressSnapshot } from "@gmsas95/emdash-commerce-contracts";
import type { CommerceEvent, CustomerSnapshot } from "@gmsas95/emdash-commerce-contracts";
import { z } from "zod";
import { addCartLine } from "./domain/cart.js";
import type { Cart } from "./domain/cart.js";
import { createOrderSnapshot } from "./domain/orders.js";
import type { OrderSnapshot } from "./domain/orders.js";
import { transitionOrder } from "./domain/order-state.js";
import type { OrderCommand } from "./domain/order-state.js";
import {
  catalogRoute,
  productArchiveRoute,
  productDetailRoute,
  productSaveRoute,
  productsRoute,
} from "./admin/products-api.js";
import { commerceMcpExecuteInput, commerceMcpExecuteRoute, commerceMcpSearchInput, commerceMcpSearchRoute } from "./mcp.js";
import { createMemoryReplayStore, verifyBridgeSignature } from "./bridge/signature.js";
import type { BridgeReplayStore } from "./bridge/signature.js";
import { sendBridgeCommand } from "./bridge/client.js";
import type { BridgeConnection } from "./bridge/client.js";
import { COMMERCE_COLLECTION_INDEXES } from "./storage/collections.js";
import { createEmDashRepositories } from "./storage/repositories.js";
import type { CommerceRepositories, EmDashCommerceStorage } from "./storage/repositories.js";
import { InsufficientStockError, confirmOrderReservations, expireDueReservations, releaseOrderReservations, reserveOrderStock } from "./storage/reservations.js";
import { addOrderNote, listOrderNotes } from "./storage/order-notes.js";
import type { OrderNoteType } from "./storage/order-notes.js";

const PAYMENT_EVENT_COMMANDS: Record<string, OrderCommand["type"]> = {
  "commerce.payment.paid": "payment_paid",
  "commerce.payment.failed": "payment_failed",
  "commerce.payment.cancelled": "cancel",
  "commerce.payment.refunded": "payment_refunded",
};

const PLUGIN_ID = "emdash-commerce";
const PLUGIN_VERSION = "0.2.0";
const checkoutLocks = new Map<string, Promise<void>>();

export interface CommerceEmailMessage {
  to: string;
  subject: string;
  text: string;
}

export async function sendCommerceEmail(context: unknown, message: CommerceEmailMessage): Promise<boolean> {
  const email = (context as { email?: { send?: (message: CommerceEmailMessage) => Promise<void> } }).email;
  if (!email || typeof email !== "object" || typeof email.send !== "function") return false;
  try {
    await email.send(message);
    return true;
  } catch {
    return false;
  }
}

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

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

interface PreparedCustomer {
  snapshot: CustomerSnapshot;
  id: string;
  previous: Record<string, unknown>;
}

async function prepareCustomer(repositories: CommerceRepositories, input: CustomerSnapshot): Promise<PreparedCustomer> {
  const existing = input.email === undefined
    ? undefined
    : (await repositories.customers.query({ where: { email: input.email }, limit: 1 })).items[0];
  const id = existing?.id ?? `customer-${crypto.randomUUID()}`;
  return {
    snapshot: { ...input, customerId: id },
    id,
    previous: isRecord(existing?.data) ? existing.data : {},
  };
}

async function persistCustomer(repositories: CommerceRepositories, prepared: PreparedCustomer): Promise<void> {
  const now = new Date().toISOString();
  await repositories.customers.put(prepared.id, {
    ...prepared.previous,
    ...prepared.snapshot,
    status: "active",
    orderCount: typeof prepared.previous.orderCount === "number" ? prepared.previous.orderCount + 1 : 1,
    createdAt: typeof prepared.previous.createdAt === "string" ? prepared.previous.createdAt : now,
    updatedAt: now,
  } as never);
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
      if (!response.ok) {
        const code = response.error?.code ?? "PROVIDER_ERROR";
        const message = response.error?.message ?? "Payment bridge rejected the request";
        throw new Error(`${code}: ${message}`);
      }
      if (!isRecord(response.data) || typeof response.data.checkoutUrl !== "string") {
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

const DASHBOARD_WINDOW_DAYS = 14;

async function statsRoute(context: RouteContext): Promise<unknown> {
  requireMethod(context, "GET");
  const repositories = repositoriesFromContext(context);

  const totals = { revenueMinor: 0, paidOrders: 0, aovMinor: 0, itemsSold: 0 };
  const daily = new Map<string, { revenueMinor: number; orders: number }>();
  const recent: Array<Record<string, unknown>> = [];
  let currency = "MYR";
  let cursor: string | undefined;
  do {
    const page = await repositories.orders.query({ limit: 100, ...(cursor === undefined ? {} : { cursor }) });
    for (const { data } of page.items) {
      if (!isRecord(data)) continue;
      recent.push(data);
      if (typeof data.status !== "string" || !PAID_ORDER_STATUSES.has(data.status)) continue;
      const totalMinor = typeof data.totalMinor === "number" ? data.totalMinor : 0;
      const createdAt = typeof data.createdAt === "string" ? data.createdAt : "";
      totals.revenueMinor += totalMinor;
      totals.paidOrders += 1;
      if (typeof data.currency === "string" && currency === "MYR") currency = data.currency;
      const date = createdAt.slice(0, 10);
      if (date !== "") {
        const bucket = daily.get(date) ?? { revenueMinor: 0, orders: 0 };
        bucket.revenueMinor += totalMinor;
        bucket.orders += 1;
        daily.set(date, bucket);
      }
      if (Array.isArray(data.lines)) {
        for (const line of data.lines) {
          if (isRecord(line) && typeof line.quantity === "number") totals.itemsSold += line.quantity;
        }
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor !== undefined);
  totals.aovMinor = totals.paidOrders > 0 ? Math.round(totals.revenueMinor / totals.paidOrders) : 0;

  const windowStart = new Date();
  windowStart.setUTCDate(windowStart.getUTCDate() - (DASHBOARD_WINDOW_DAYS - 1));
  const series: Array<{ date: string; revenueMinor: number; orders: number }> = [];
  for (let offset = DASHBOARD_WINDOW_DAYS - 1; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    series.push({ date: key, ...(daily.get(key) ?? { revenueMinor: 0, orders: 0 }) });
  }

  recent.sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
  const recentOrders = recent.slice(0, 5)
    .map(({ orderAccessToken: _orderAccessToken, ...safe }) => ({
      id: safe.id,
      orderId: safe.orderId,
      orderNumber: safe.orderNumber,
      status: safe.status,
      currency: safe.currency,
      totalMinor: safe.totalMinor,
      createdAt: safe.createdAt,
    }));

  const thresholdRaw = await context.kv?.get<number>("settings:lowStockThreshold");
  const threshold = typeof thresholdRaw === "number" && Number.isSafeInteger(thresholdRaw) && thresholdRaw > 0 ? thresholdRaw : 5;
  const inventoryPage = await repositories.inventory.query({ limit: 100 });
  const lowStock = inventoryPage.items
    .filter(({ data }) => isRecord(data) && data.status === "active" && typeof data.available === "number" && data.available <= threshold)
    .map(({ data }) => ({ sku: (data as Record<string, unknown>).sku, available: (data as Record<string, unknown>).available }));

  return { currency, totals, daily: series, recentOrders, lowStock };
}

async function inventoryRoute(context: RouteContext): Promise<unknown> {
  requireMethod(context, "GET");
  const repositories = repositoriesFromContext(context);
  const [page, threshold] = await Promise.all([
    repositories.inventory.query({ limit: 100 }),
    context.kv?.get<number>("settings:lowStockThreshold"),
  ]);
  return {
    items: page.items,
    lowStockThreshold: typeof threshold === "number" && Number.isSafeInteger(threshold) && threshold > 0 ? threshold : 5,
  };
}

async function inventoryUpdateRoute(context: RouteContext): Promise<unknown> {
  requireMethod(context, "POST");
  const body = requestBody(context);
  if (typeof body.inventoryId !== "string") {
    throw PluginRouteError.badRequest("inventoryId is required");
  }
  const repositories = repositoriesFromContext(context);
  const existing = await repositories.inventory.get(body.inventoryId);
  if (!isRecord(existing)) {
    throw PluginRouteError.notFound("Inventory record not found");
  }
  let available: unknown = isRecord(existing) ? existing.available : 0;
  if (body.available !== undefined) {
    try {
      available = integerAmountInput(body.available, "available");
    } catch (error) {
      throw PluginRouteError.badRequest(error instanceof Error ? error.message : "Invalid stock");
    }
  }
  const status = body.status === undefined
    ? (typeof existing.status === "string" ? existing.status : "active")
    : body.status;
  if (status !== "active" && status !== "disabled") {
    throw PluginRouteError.badRequest("status must be active or disabled");
  }
  const reserved = typeof existing.reserved === "number" ? existing.reserved : 0;
  if (typeof available === "number" && reserved > available) {
    throw PluginRouteError.conflict(`Available stock cannot drop below the ${reserved} currently reserved`);
  }
  const updated = {
    ...existing,
    ...(body.available === undefined ? {} : { available }),
    status,
    updatedAt: new Date().toISOString(),
  };
  await repositories.inventory.put(body.inventoryId, updated as never);
  return updated;
}

function integerAmountInput(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative whole number`);
  }
  return value;
}

async function inventoryHoldsRoute(context: RouteContext): Promise<unknown> {
  requireMethod(context, "GET");
  const repositories = repositoriesFromContext(context);
  const [active, confirmed] = await Promise.all([
    repositories.reservations.query({ where: { status: "active" }, limit: 100 }),
    repositories.reservations.query({ where: { status: "confirmed" }, limit: 100 }),
  ]);
  const items = [...active.items, ...confirmed.items]
    .map(({ data }) => data)
    .filter(isRecord)
    .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
  return { items };
}

const PAID_ORDER_STATUSES = new Set(["paid", "processing", "partially_fulfilled", "fulfilled", "completed"]);

async function customerSpendIndex(repositories: CommerceRepositories): Promise<Map<string, { totalSpentMinor: number; lastOrderAt?: string }>> {
  const index = new Map<string, { totalSpentMinor: number; lastOrderAt?: string }>();
  let cursor: string | undefined;
  do {
    const page = await repositories.orders.query({ limit: 100, ...(cursor === undefined ? {} : { cursor }) });
    for (const { data } of page.items) {
      if (!isRecord(data)) continue;
      const customerId = typeof data.customerId === "string" ? data.customerId : undefined;
      if (!customerId) continue;
      if (typeof data.status !== "string" || !PAID_ORDER_STATUSES.has(data.status)) continue;
      const totalMinor = typeof data.totalMinor === "number" ? data.totalMinor : 0;
      const createdAt = typeof data.createdAt === "string" ? data.createdAt : undefined;
      const previous = index.get(customerId) ?? { totalSpentMinor: 0 };
      index.set(customerId, {
        totalSpentMinor: previous.totalSpentMinor + totalMinor,
        lastOrderAt: createdAt !== undefined && (previous.lastOrderAt === undefined || createdAt > previous.lastOrderAt) ? createdAt : previous.lastOrderAt,
      });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor !== undefined);
  return index;
}

async function customersRoute(context: RouteContext): Promise<unknown> {
  requireMethod(context, "GET");
  const repositories = repositoriesFromContext(context);
  const [page, spend] = await Promise.all([
    repositories.customers.query({ limit: 50 }),
    customerSpendIndex(repositories),
  ]);
  return {
    items: page.items.map(({ id, data }) => ({
      id,
      ...(isRecord(data) ? data : {}),
      ...(spend.get(id) ?? {}),
    })),
  };
}

async function customersDetailRoute(context: RouteContext): Promise<unknown> {
  requireMethod(context, "GET");
  const input = isRecord(context.input) ? context.input : {};
  if (typeof input.customerId !== "string") {
    throw PluginRouteError.badRequest("customerId is required");
  }
  const repositories = repositoriesFromContext(context);
  const customer = await repositories.customers.get(input.customerId);
  if (!customer) {
    throw PluginRouteError.notFound("Customer not found");
  }
  const page = await repositories.orders.query({ where: { customerId: input.customerId }, limit: 100 });
  const orders = page.items
    .map(({ data }) => (isRecord(data) ? (data as Record<string, unknown>) : ({} as Record<string, unknown>)))
    .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")))
    .map((order) => {
      const { orderAccessToken: _orderAccessToken, ...safeOrder } = order;
      return safeOrder;
    });
  return { customer, orders };
}

function publicCart(cart: Cart): Omit<Cart, "checkoutKey" | "checkoutOrderId" | "checkoutResult"> {
  const { checkoutKey: _checkoutKey, checkoutOrderId: _checkoutOrderId, checkoutResult: _checkoutResult, ...safeCart } = cart;
  return safeCart;
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
  return publicCart(cart);
}

async function revertCartToActive(repositories: CommerceRepositories, cartId: string, cart: Cart): Promise<void> {
  const { checkoutKey: _checkoutKey, checkoutOrderId: _checkoutOrderId, checkoutResult: _checkoutResult, ...reverted } = cart;
  await repositories.carts.put(cartId, { ...reverted, status: "active" } as never);
}

async function nextOrderNumber(context: RouteContext, repositories: CommerceRepositories): Promise<number> {
  if (context.kv) {
    const last = await context.kv.get<number>("state:lastOrderNumber");
    const next = (typeof last === "number" ? last : 1000) + 1;
    await context.kv.set("state:lastOrderNumber", next);
    return next;
  }
  return (await repositories.orders.count()) + 1001;
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
      if (cart.checkoutKey !== checkoutKey || !cart.checkoutResult || !cart.checkoutOrderId) {
        throw PluginRouteError.conflict("Cart has already been checked out");
      }
      const completedOrder = await repositories.orders.get(cart.checkoutOrderId) as OrderSnapshot | undefined;
      if (!completedOrder?.orderAccessToken) throw PluginRouteError.conflict("Completed order access token is unavailable");
      return { ...cart.checkoutResult, orderAccessToken: completedOrder.orderAccessToken };
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
  let preparedCustomer: PreparedCustomer | undefined;
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
        ...(line.variantId === undefined ? {} : { variantId: line.variantId }),
        name: typeof catalog.name === "string" ? catalog.name : line.name,
        quantity: line.quantity,
        unitAmountMinor: catalog.priceMinor,
        currency: catalog.currency,
        sku: typeof catalog.sku === "string" ? catalog.sku : line.sku,
      };
    }));
    const customerInput = parseCustomerInput(body.customer);
    preparedCustomer = customerInput === undefined ? undefined : await prepareCustomer(repositories, customerInput);
    const customer = preparedCustomer?.snapshot;
    const orderNumber = await nextOrderNumber(context, repositories);
    order = createOrderSnapshot({
      orderId: checkoutOrderId,
      orderAccessToken,
      orderNumber,
      currency: cart.currency,
      paymentProviderId: paymentProvider,
      status: "pending_payment",
      paymentStatus: "pending",
      lines,
      customer,
      shippingAddress: body.shippingAddress === undefined ? undefined : withoutUndefined(parseAddressSnapshot(body.shippingAddress)),
    });
  } catch (error) {
    await revertCartToActive(repositories, cartId, cart);
    if (error instanceof PluginRouteError) throw error;
    throw PluginRouteError.badRequest(error instanceof Error ? error.message : "Invalid checkout");
  }
  try {
    await reserveOrderStock(repositories, order);
  } catch (error) {
    await revertCartToActive(repositories, cartId, cart);
    if (error instanceof InsufficientStockError) throw PluginRouteError.conflict(error.message);
    throw error;
  }
  await repositories.orders.put(order.id, order);
  try {
    const { orderAccessToken: _providerOrderAccessToken, ...providerOrder } = order;
    const payment = await provider.createPayment({ order: providerOrder as OrderSnapshot, idempotencyKey: checkoutKey });
    const storedResult = {
      orderId: order.id,
      checkoutUrl: payment.checkoutUrl,
      ...(payment.paymentReference === undefined ? {} : { paymentReference: payment.paymentReference }),
      totalMinor: order.totalMinor,
      currency: order.currency,
    };
    if (preparedCustomer) await persistCustomer(repositories, preparedCustomer);
    cart.status = "checked_out";
    cart.checkoutResult = storedResult;
    await repositories.carts.put(cartId, cart as never);
    const confirmationEmail = preparedCustomer?.snapshot.email
      ? {
          to: preparedCustomer.snapshot.email,
          subject: `Your order ${order.orderId} is confirmed`,
          text: `Thanks for your order!\n\nOrder: ${order.orderId}\nTotal: ${(order.totalMinor / 100).toFixed(2)} ${order.currency}\n\nComplete your payment here: ${payment.checkoutUrl}\n`,
        }
      : undefined;
    if (confirmationEmail) {
      await sendCommerceEmail(context, confirmationEmail);
    }
    const storeEmail = await context.kv?.get<string>("settings:storeEmail");
    if (typeof storeEmail === "string" && storeEmail.includes("@") && storeEmail !== confirmationEmail?.to) {
      const lineSummary = order.lines
        .map((line) => `${line.quantity}× ${line.name}`)
        .join(", ");
      await sendCommerceEmail(context, {
        to: storeEmail,
        subject: `New order ${order.orderId} — ${(order.totalMinor / 100).toFixed(2)} ${order.currency}`,
        text: `A new order was placed.\n\nOrder: ${order.orderId}\nCustomer: ${preparedCustomer?.snapshot.name ?? "Guest"} (${preparedCustomer?.snapshot.email ?? "no email"})\nItems: ${lineSummary}\nTotal: ${(order.totalMinor / 100).toFixed(2)} ${order.currency}\n\nOpen the admin to manage it.`,
      });
    }
    return { ...storedResult, orderAccessToken: order.orderAccessToken };
  } catch (error) {
    try {
      await releaseOrderReservations(repositories, order.id);
    } catch {
      context.log?.warn?.("Failed to release reservations after payment provider error", { orderId: order.id });
    }
    const detail = error instanceof Error ? error.message : "Unknown payment provider error";
    throw new PluginRouteError("PAYMENT_PROVIDER_ERROR", `Payment provider failed: ${detail}`, 502);
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
    const input = isRecord(context.input) ? context.input : {};
    if (typeof input.orderId === "string") {
      const order = await repositories.orders.get(input.orderId);
      if (!order) {
        throw PluginRouteError.notFound("Order not found");
      }
      return order;
    }
    await ensureLegacyOrderStatuses(context);
    const where: Record<string, unknown> = {};
    if (typeof input.status === "string" && input.status !== "") {
      where.status = input.status;
    }
    if (typeof input.email === "string" && input.email !== "") {
      const customer = (await repositories.customers.query({ where: { email: input.email }, limit: 1 })).items[0];
      if (!customer) return { items: [], hasMore: false };
      where.customerId = customer.id;
    }
    const rawLimit = typeof input.limit === "number" ? input.limit : Number.parseInt(String(input.limit ?? ""), 10);
    const limit = Number.isSafeInteger(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, 100) : 50;
    return repositories.orders.query({
      ...(Object.keys(where).length > 0 ? { where: where as Record<string, string> } : {}),
      limit,
      ...(typeof input.cursor === "string" && input.cursor !== "" ? { cursor: input.cursor } : {}),
    });
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

async function orderStatusRoute(context: RouteContext): Promise<unknown> {
  requireMethod(context, "POST");
  const body = requestBody(context);
  if (typeof body.orderId !== "string") {
    throw PluginRouteError.badRequest("orderId is required");
  }
  if (typeof body.command !== "string") {
    throw PluginRouteError.badRequest("command is required");
  }
  const repositories = repositoriesFromContext(context);
  const order = await repositories.orders.get(body.orderId) as OrderSnapshot | undefined;
  if (!order) {
    throw PluginRouteError.notFound("Order not found");
  }
  if (["payment_pending", "payment_paid", "payment_refunded"].includes(body.command)) {
    throw PluginRouteError.conflict(`Command ${body.command} is not allowed from the admin`);
  }
  const currentStatus = typeof order.status === "string" ? order.status : "pending_payment";
  let next: ReturnType<typeof transitionOrder>;
  try {
    next = transitionOrder({ ...order, status: currentStatus }, { type: body.command } as OrderCommand);
  } catch {
    throw PluginRouteError.conflict(`Transition ${body.command} is not allowed for an order in status ${currentStatus}`);
  }
  await repositories.orders.put(order.id, { ...order, ...next, updatedAt: new Date().toISOString() } as never);
  if (body.command === "cancel" || body.command === "payment_failed") {
    try {
      await releaseOrderReservations(repositories, order.id);
    } catch {
      context.log?.warn?.("Failed to release reservations during status change", { orderId: order.id });
    }
  }
  await addOrderNote(repositories, {
    orderId: order.id,
    note: `Order status changed to ${String(next.status)}.`,
    type: "private",
    system: true,
  });
  return next;
}

async function orderNotesRoute(context: RouteContext): Promise<unknown> {
  const repositories = repositoriesFromContext(context);
  if (context.request.method === "GET") {
    const input = isRecord(context.input) ? context.input : {};
    if (typeof input.orderId !== "string") {
      throw PluginRouteError.badRequest("orderId is required");
    }
    return { items: await listOrderNotes(repositories, input.orderId) };
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
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note === "" || note.length > 2000) {
    throw PluginRouteError.badRequest("note must be a non-empty string of at most 2000 characters");
  }
  const type = body.type === undefined ? "private" : body.type;
  if (type !== "private" && type !== "customer") {
    throw PluginRouteError.badRequest("type must be private or customer");
  }
  return addOrderNote(repositories, { orderId: body.orderId, note, type: type as OrderNoteType });
}

async function settingsGetRoute(context: RouteContext): Promise<unknown> {
  requireMethod(context, "GET");
  const [storeName, storeEmail, defaultCurrency, lowStockThreshold] = await Promise.all([
    context.kv?.get<string>("settings:storeName"),
    context.kv?.get<string>("settings:storeEmail"),
    context.kv?.get<string>("settings:defaultCurrency"),
    context.kv?.get<number>("settings:lowStockThreshold"),
  ]);
  return {
    storeName: typeof storeName === "string" ? storeName : "",
    storeEmail: typeof storeEmail === "string" ? storeEmail : "",
    defaultCurrency: typeof defaultCurrency === "string" && /^[A-Z]{3}$/.test(defaultCurrency) ? defaultCurrency : "MYR",
    lowStockThreshold: typeof lowStockThreshold === "number" && Number.isSafeInteger(lowStockThreshold) && lowStockThreshold >= 1 && lowStockThreshold <= 1000
      ? lowStockThreshold
      : 5,
  };
}

async function settingsSaveRoute(context: RouteContext): Promise<unknown> {
  requireMethod(context, "POST");
  const body = requestBody(context);
  const kv = context.kv;
  if (!kv) throw new PluginRouteError("SETTINGS_UNAVAILABLE", "Settings storage is unavailable", 500);

  if (body.storeName !== undefined) {
    const storeName = typeof body.storeName === "string" ? body.storeName.trim() : "";
    if (storeName === "" || storeName.length > 120) {
      throw PluginRouteError.badRequest("store name must be a non-empty string of at most 120 characters");
    }
    await kv.set("settings:storeName", storeName);
  }
  if (body.storeEmail !== undefined) {
    const storeEmail = typeof body.storeEmail === "string" ? body.storeEmail.trim() : "";
    if (storeEmail !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(storeEmail)) {
      throw PluginRouteError.badRequest("store email must be a valid email address");
    }
    await kv.set("settings:storeEmail", storeEmail);
  }
  if (body.defaultCurrency !== undefined) {
    if (typeof body.defaultCurrency !== "string" || !/^[A-Z]{3}$/.test(body.defaultCurrency)) {
      throw PluginRouteError.badRequest("default currency must be a three-letter uppercase ISO code");
    }
    await kv.set("settings:defaultCurrency", body.defaultCurrency);
  }
  if (body.lowStockThreshold !== undefined) {
    if (typeof body.lowStockThreshold !== "number" || !Number.isSafeInteger(body.lowStockThreshold) || body.lowStockThreshold < 1 || body.lowStockThreshold > 1000) {
      throw PluginRouteError.badRequest("low stock threshold must be a whole number between 1 and 1000");
    }
    await kv.set("settings:lowStockThreshold", body.lowStockThreshold);
  }
  return settingsGetRoute({ ...context, request: new Request(context.request.url, { method: "GET" }) } as RouteContext);
}

async function refundOrderRoute(options: CommercePluginOptions, context: RouteContext): Promise<unknown> {
  requireMethod(context, "POST");
  const body = requestBody(context);
  if (typeof body.orderId !== "string") {
    throw PluginRouteError.badRequest("orderId is required");
  }
  const repositories = repositoriesFromContext(context);
  const order = await repositories.orders.get(body.orderId) as OrderSnapshot | undefined;
  if (!order) {
    throw PluginRouteError.notFound("Order not found");
  }
  const publicOrderId = order.orderId ?? order.id;
  const currentStatus = typeof order.status === "string" ? order.status : "pending_payment";
  if (currentStatus === "refunded" || order.paymentStatus === "refunded") {
    return { orderId: publicOrderId, refundStatus: "refunded", message: "Order is already refunded" };
  }
  let refundedOrder: OrderSnapshot;
  try {
    refundedOrder = transitionOrder({ ...order, status: currentStatus }, { type: "payment_refunded" }) as unknown as OrderSnapshot;
  } catch {
    throw PluginRouteError.conflict("Order payment is not refundable");
  }
  const providerId = typeof order.paymentProviderId === "string" ? order.paymentProviderId : "";
  const connection = options.paymentBridges?.[providerId];
  if (!connection) {
    throw PluginRouteError.badRequest(`Payment provider ${providerId || "(unknown)"} does not support refunds`);
  }
  const response = await sendBridgeCommand(connection, {
    contract: "commerce.payment.refund",
    version: 1,
    requestId: `refund-${order.id}`,
    idempotencyKey: `refund:${order.id}`,
    sentAt: new Date().toISOString(),
    payload: { operation: "refund", paymentId: publicOrderId },
  });
  if (!response.ok) {
    const code = response.error?.code ?? "PROVIDER_ERROR";
    const message = response.error?.message ?? "Payment provider rejected the refund";
    throw new PluginRouteError(code, message, code === "NOT_FOUND" ? 404 : 502);
  }
  const data = isRecord(response.data) ? response.data : {};
  const message = typeof data.message === "string" ? data.message : "Refund recorded";
  if (data.status === "MANUAL_PROVIDER_ACTION") {
    await repositories.orders.put(order.id, {
      ...order,
      metadata: { ...(order.metadata ?? {}), commerceRefundRequested: "true", commerceRefundRequestId: String(data.paymentId ?? order.id) },
      updatedAt: new Date().toISOString(),
    } as never);
    return { orderId: publicOrderId, refundStatus: "requested", message };
  }
  if (data.status !== "refunded") {
    throw new PluginRouteError("UNSUPPORTED_REFUND_RESULT", `Unexpected refund result from payment provider: ${String(data.status)}`, 502);
  }
  await repositories.orders.put(order.id, { ...refundedOrder, updatedAt: new Date().toISOString() } as never);
  await releaseOrderReservations(repositories, order.id);
  const customerEmail = order.customer?.email;
  if (customerEmail) {
    await sendCommerceEmail(context, {
      to: customerEmail,
      subject: `Your refund for order ${publicOrderId} is complete`,
      text: `Your refund for order ${publicOrderId} has been processed.\n\nThe amount will be returned via your original payment method.`,
    });
  }
  return { orderId: publicOrderId, refundStatus: "refunded", message };
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
  const payload = isRecord(event.payload) ? event.payload : undefined;
  const commerceOrderId = typeof payload?.commerceOrderId === "string" ? payload.commerceOrderId : undefined;
  const commandType = PAYMENT_EVENT_COMMANDS[event.event];
  if (commandType && commerceOrderId) {
    const order = await repositories.orders.get(commerceOrderId) as OrderSnapshot | undefined;
    if (order) {
      const currentStatus = typeof order.status === "string" ? order.status : "pending_payment";
      let next: ReturnType<typeof transitionOrder>;
      try {
        next = transitionOrder({ ...order, status: currentStatus }, { type: commandType } as OrderCommand);
      } catch {
        next = undefined as unknown as ReturnType<typeof transitionOrder>;
      }
      if (next) {
        await repositories.orders.put(commerceOrderId, { ...order, ...next } as never);
        if (commandType === "payment_paid") {
          await confirmOrderReservations(repositories, commerceOrderId);
        } else {
          await releaseOrderReservations(repositories, commerceOrderId);
        }
        const customerEmail = order.customer?.email;
        if (commandType === "payment_failed" && customerEmail) {
          await sendCommerceEmail(context, {
            to: customerEmail,
            subject: `Payment for order ${commerceOrderId} failed`,
            text: `Unfortunately, the payment for your order ${commerceOrderId} did not go through.\n\nIf you still want these items, please place the order again.`,
          });
        }
      }
    }
  }
  return { ok: true, duplicate: false, deliveryId, eventId };
}

async function backfillLegacyOrderStatuses(context: PluginContext): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await context.storage.orders?.query({ limit: 100, ...(cursor === undefined ? {} : { cursor }) });
    if (!page) return;
    for (const { id, data } of page.items) {
      if (!isRecord(data) || typeof data.status === "string") continue;
      await context.storage.orders?.put(id, {
        ...data,
        status: "pending_payment",
        paymentStatus: "pending",
        updatedAt: new Date().toISOString(),
      });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor !== undefined);
}

let legacyStatusBackfillDone = false;

async function ensureLegacyOrderStatuses(context: RouteContext): Promise<void> {
  if (legacyStatusBackfillDone) return;
  legacyStatusBackfillDone = true;
  try {
    await backfillLegacyOrderStatuses(context as unknown as PluginContext);
  } catch {
    legacyStatusBackfillDone = false;
  }
}

async function migrateOrderAccessTokens(ctx: PluginContext): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await ctx.storage.orders?.query({ limit: 100, ...(cursor === undefined ? {} : { cursor }) });
    if (!page) return;
    for (const { id, data } of page.items) {
      if (!isRecord(data) || typeof data.orderAccessToken === "string") continue;
      await ctx.storage.orders?.put(id, { ...data, orderAccessToken: crypto.randomUUID() });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor !== undefined);
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
      "inventory/update": { public: false, handler: inventoryUpdateRoute },
      "inventory/holds": { public: false, handler: inventoryHoldsRoute },
      "provider-status": { public: false, handler: (context) => providerStatusRoute(options, context) },
      stats: { public: false, handler: statsRoute },
      "settings/get": { public: false, handler: settingsGetRoute },
      "settings/save": { public: false, handler: settingsSaveRoute },
      customers: { public: false, handler: customersRoute },
      "customers/detail": { public: false, handler: customersDetailRoute },
      cart: { public: true, handler: cartRoute },
      checkout: { public: true, handler: (context) => checkoutRoute(options, context) },
      order: { public: true, handler: publicOrderRoute },
      orders: { public: false, handler: ordersRoute },
      "orders/refund": { public: false, handler: (context) => refundOrderRoute(options, context) },
      "orders/status": { public: false, handler: orderStatusRoute },
      "orders/notes": { public: false, handler: orderNotesRoute },
      "mcp/search": { public: false, permission: "plugins:manage", handler: commerceMcpSearchRoute },
      "mcp/execute": { public: false, permission: "plugins:manage", handler: commerceMcpExecuteRoute },
      "bridge/events": { public: true, handler: (context) => bridgeEventsRoute(options, replayStore, context) },
    },
    mcp: {
      tools: {
        search: {
          description: "Search Commerce products, inventory, orders, and customers using one scoped query.",
          route: "mcp/search",
          input: commerceMcpSearchInput,
        },
        execute: {
          description: "Execute an allowlisted Commerce operation such as product.list, product.get, product.save, product.archive, inventory.list, order.list, or customer.list.",
          route: "mcp/execute",
          input: commerceMcpExecuteInput,
          destructive: true,
        },
      },
    },
    hooks: {
      "plugin:install": async (_event, context) => {
        await context.cron?.schedule("order-access-token-migration", { schedule: "*/5 * * * *" });
      },
      "plugin:activate": async (_event, context) => {
        await context.cron?.schedule("order-access-token-migration", { schedule: "*/5 * * * *" });
      },
      cron: async (_event, context) => {
        await migrateOrderAccessTokens(context);
        await backfillLegacyOrderStatuses(context);
        const repositories = createEmDashRepositories(context.storage as unknown as EmDashCommerceStorage);
        await expireDueReservations(repositories);
      },
    },
    capabilities: options.enabled === false ? [] : ["email:send"],
    admin: {
      entry: "@emdash-commerce/core/admin",
      pages: [...ADMIN_PAGES],
      widgets: [{ id: "commerce-summary", title: "Commerce", size: "third" }],
    },
  });
}
