import { describe, expect, it } from "vitest";
import { createPlugin } from "../../src/index.js";
import { createMemoryRepositories, type CommerceRepositories } from "../../src/storage/repositories.js";

function storageFor(repositories: CommerceRepositories): Record<string, unknown> {
  return Object.fromEntries(Object.entries(repositories).map(([name, repository]) => [name, {
    get: async (id: string) => (await repository.get(id)) ?? null,
    put: (id: string, data: never) => repository.put(id, data),
    delete: async (id: string) => { await repository.delete(id); return true; },
    query: (options?: never) => repository.query(options),
    count: (where?: never) => repository.count(where),
  }]));
}

function makeKv(values: Map<string, unknown>) {
  return {
    get: async (key: string) => values.get(key),
    set: async (key: string, value: unknown) => { values.set(key, value); },
  };
}

function context(storage: Record<string, unknown>, kv: ReturnType<typeof makeKv>, input: unknown, method = "POST") {
  return { input, request: new Request("https://commerce.test", { method }), storage, requestMeta: {}, kv } as never;
}

describe("Commerce store settings", () => {
  it("returns defaults before any configuration", async () => {
    const repositories = createMemoryRepositories();
    const plugin = createPlugin();

    const settings = await plugin.routes["settings/get"].handler(
      context(storageFor(repositories), makeKv(new Map()), {}, "GET"),
    ) as Record<string, unknown>;

    expect(settings).toMatchObject({ storeName: "", storeEmail: "", defaultCurrency: "MYR", lowStockThreshold: 5 });
  });

  it("persists validated settings and echoes them back", async () => {
    const repositories = createMemoryRepositories();
    const values = new Map<string, unknown>();
    const plugin = createPlugin();
    const kv = makeKv(values);

    const saved = await plugin.routes["settings/save"].handler(
      context(storageFor(repositories), kv, { storeName: "Teh Tarik Co", storeEmail: "hello@tehtarik.test", defaultCurrency: "MYR", lowStockThreshold: 8 }),
    ) as Record<string, unknown>;

    expect(saved).toMatchObject({ storeName: "Teh Tarik Co", lowStockThreshold: 8 });
    expect(values.get("settings:storeName")).toBe("Teh Tarik Co");

    const fetched = await plugin.routes["settings/get"].handler(
      context(storageFor(repositories), kv, {}, "GET"),
    ) as Record<string, unknown>;
    expect(fetched).toMatchObject({ storeEmail: "hello@tehtarik.test" });
  });

  it("rejects invalid values", async () => {
    const repositories = createMemoryRepositories();
    const plugin = createPlugin();
    const kv = makeKv(new Map());

    await expect(plugin.routes["settings/save"].handler(context(storageFor(repositories), kv, { storeName: "" }))).rejects.toThrow(/store name/i);
    await expect(plugin.routes["settings/save"].handler(context(storageFor(repositories), kv, { storeName: "X", storeEmail: "not-an-email" }))).rejects.toThrow(/email/i);
    await expect(plugin.routes["settings/save"].handler(context(storageFor(repositories), kv, { storeName: "X", defaultCurrency: "usd" }))).rejects.toThrow(/currency/i);
    await expect(plugin.routes["settings/save"].handler(context(storageFor(repositories), kv, { storeName: "X", lowStockThreshold: -2 }))).rejects.toThrow(/threshold/i);
  });
});

interface SentMessage { to: string; subject: string; text: string }
type FetchLog = Array<{ url: string; body: Record<string, unknown> }>;
void (0 as unknown as FetchLog);
function makeEmail(sent: SentMessage[]) {
  return { send: async (message: SentMessage) => { sent.push(message); } };
}

async function seedCheckoutFixtures(repositories: CommerceRepositories): Promise<{ plugin: ReturnType<typeof createPlugin>; kv: Map<string, unknown> }> {
  await repositories.products.put("p-1", { id: "p-1", status: "published", name: "Tea", priceMinor: 500, currency: "MYR" });
  const kv = new Map<string, unknown>();
  return { plugin: createPlugin({ paymentProviders: { chip: { createPayment: async () => ({ checkoutUrl: "https://pay.test/x" }) } } }), kv };
}

function checkoutContext(storage: Record<string, unknown>, kv: Map<string, unknown>, input: unknown, email?: unknown) {
  return { input, request: new Request("https://commerce.test", { method: "POST" }), storage, requestMeta: {}, kv: makeKv(kv), ...(email ? { email } : {}) } as never;
}

describe("Commerce transactional emails", () => {
  it("emails an order confirmation after successful checkout", async () => {
    const repositories = createMemoryRepositories();
    const { plugin, kv } = await seedCheckoutFixtures(repositories);
    const sent: SentMessage[] = [];
    const storage = storageFor(repositories);

    const cart = await plugin.routes.cart.handler(checkoutContext(storage, kv, { line: { productId: "p-1", quantity: 1 } })) as { id: string };
    const result = await plugin.routes.checkout.handler(checkoutContext(storage, kv, { cartId: cart.id, paymentProvider: "chip", customer: { name: "Ada", email: "ada@example.test" } }, makeEmail(sent))) as { orderId: string };

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("ada@example.test");
    expect(sent[0]?.subject).toContain(result.orderId);
  });

  it("stays silent when no email capability is present", async () => {
    const repositories = createMemoryRepositories();
    const { plugin, kv } = await seedCheckoutFixtures(repositories);
    const sent: SentMessage[] = [];
    const storage = storageFor(repositories);

    const cart = await plugin.routes.cart.handler(checkoutContext(storage, kv, { line: { productId: "p-1", quantity: 1 } })) as { id: string };
    await plugin.routes.checkout.handler(checkoutContext(storage, kv, { cartId: cart.id, paymentProvider: "chip", customer: { email: "ada@example.test" } }));

    expect(sent).toHaveLength(0);
  });

  it("does not email guests without an address", async () => {
    const repositories = createMemoryRepositories();
    const { plugin, kv } = await seedCheckoutFixtures(repositories);
    const sent: SentMessage[] = [];
    const storage = storageFor(repositories);

    const cart = await plugin.routes.cart.handler(checkoutContext(storage, kv, { line: { productId: "p-1", quantity: 1 } }, makeEmail(sent))) as { id: string };
    await plugin.routes.checkout.handler(checkoutContext(storage, kv, { cartId: cart.id, paymentProvider: "chip" }, makeEmail(sent)));

    expect(sent).toHaveLength(0);
  });
});

describe("Commerce lifecycle emails", () => {
  it("notifies the customer when a payment fails", async () => {
    const { signBridgePayload } = await import("../../src/bridge/signature.js");
    const { getCommerceEventSigningData } = await import("@gmsas95/emdash-commerce-contracts");
    const repositories = createMemoryRepositories();
    await repositories.orders.put("order-1", { id: "order-1", orderId: "order-1", status: "pending_payment", paymentStatus: "pending", currency: "MYR", totalMinor: 5000, lines: [], items: [], createdAt: new Date().toISOString(), customer: { name: "Ada", email: "ada@example.test" } } as never);
    const sent: SentMessage[] = [];
    const plugin = createPlugin({ bridgeSecrets: { chip: "shared-secret" } });
    const timestamp = new Date().toISOString();
    const event = { eventId: "e-1", event: "commerce.payment.failed", version: 1 as const, occurredAt: timestamp, correlationId: "order-1", deliveryId: "d-1", payload: { providerId: "chip", paymentId: "pay-1", purchaseId: "pu-1", commerceOrderId: "order-1", status: "failed" } };
    const signature = await signBridgePayload("shared-secret", timestamp, getCommerceEventSigningData(event));

    await plugin.routes["bridge/events"].handler({
      input: event,
      storage: storageFor(repositories),
      requestMeta: {},
      request: new Request("https://commerce.test/bridge/events", { method: "POST", headers: { "x-emdash-provider-id": "chip", "x-emdash-bridge-signature": signature, "x-emdash-bridge-timestamp": timestamp } }),
      email: makeEmail(sent),
    } as never);

    expect(await repositories.orders.get("order-1")).toMatchObject({ status: "failed" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("ada@example.test");
    expect(sent[0]?.subject).toContain("order-1");
  });

  it("emails a receipt when a refund completes", async () => {
    const log: FetchLog[] = [];
    const repositories = createMemoryRepositories();
    await repositories.orders.put("order-1", {
      id: "order-1", orderId: "order-1", currency: "USD", totalMinor: 2000, subtotalMinor: 2000, discountMinor: 0, taxMinor: 0, shippingMinor: 0,
      lines: [], items: [], status: "paid", paymentStatus: "paid", paymentProviderId: "chip", createdAt: new Date().toISOString(),
      customer: { name: "Ada", email: "ada@example.test" },
    } as never);
    const sent: SentMessage[] = [];
    const plugin = createPlugin({
      paymentBridges: {
        chip: {
          pluginId: "chip-for-emdash",
          basePath: "https://chip.test/refund",
          eventPath: "https://commerce.test/events",
          capabilities: ["payment.refund"],
          sharedSecret: "shared-secret",
          fetcher: async (_url: string, init: RequestInit | undefined) => {
            const request = JSON.parse(String(init?.body ?? "{}")) as { requestId?: string };
            return new Response(JSON.stringify({ requestId: request.requestId, ok: true, data: { status: "refunded", message: "Refunded" } }), { status: 200 });
          },
        } as never,
      },
    });

    await plugin.routes["orders/refund"].handler({
      input: { orderId: "order-1" },
      storage: storageFor(repositories),
      requestMeta: {},
      request: new Request("https://commerce.test", { method: "POST" }),
      email: makeEmail(sent),
    } as never);

    expect(await repositories.orders.get("order-1")).toMatchObject({ status: "refunded" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toContain("refund");
  });
});

describe("Commerce merchant notifications", () => {
  it("alerts the configured store email about new orders", async () => {
    const repositories = createMemoryRepositories();
    await repositories.products.put("p-1", { id: "p-1", status: "published", name: "Tea", priceMinor: 500, currency: "MYR" });
    const kvValues = new Map<string, unknown>([["settings:storeEmail", "owner@tehtarik.test"]]);
    const sent: SentMessage[] = [];
    const plugin = createPlugin({ paymentProviders: { chip: { createPayment: async () => ({ checkoutUrl: "https://pay.test/x" }) } } });
    const storage = storageFor(repositories);

    const cart = await plugin.routes.cart.handler(checkoutContext(storage, kvValues, { line: { productId: "p-1", quantity: 2 } })) as { id: string };
    await plugin.routes.checkout.handler(checkoutContext(storage, kvValues, { cartId: cart.id, paymentProvider: "chip", customer: { name: "Ada", email: "ada@example.test" } }, makeEmail(sent)));

    expect(sent.map((message) => message.to)).toContain("owner@tehtarik.test");
    const alert = sent.find((message) => message.to === "owner@tehtarik.test");
    expect(alert?.subject).toMatch(/new order/i);
    expect(alert?.text).toContain("ada@example.test");
  });

  it("skips the merchant alert when no store email is configured", async () => {
    const repositories = createMemoryRepositories();
    await repositories.products.put("p-1", { id: "p-1", status: "published", name: "Tea", priceMinor: 500, currency: "MYR" });
    const kvValues = new Map<string, unknown>();
    const sent: SentMessage[] = [];
    const plugin = createPlugin({ paymentProviders: { chip: { createPayment: async () => ({ checkoutUrl: "https://pay.test/x" }) } } });
    const storage = storageFor(repositories);

    const cart = await plugin.routes.cart.handler(checkoutContext(storage, kvValues, { line: { productId: "p-1", quantity: 1 } }, makeEmail(sent))) as { id: string };
    await plugin.routes.checkout.handler(checkoutContext(storage, kvValues, { cartId: cart.id, paymentProvider: "chip" }, makeEmail(sent)));

    expect(sent).toHaveLength(0);
  });
});
