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

async function seedPaidOrder(repositories: CommerceRepositories): Promise<void> {
  await repositories.orders.put("order-1", {
    id: "order-1",
    orderId: "order-1",
    currency: "USD",
    totalMinor: 2000,
    subtotalMinor: 2000,
    discountMinor: 0,
    taxMinor: 0,
    shippingMinor: 0,
    lines: [],
    items: [],
    status: "paid",
    paymentStatus: "paid",
    createdAt: new Date().toISOString(),
  } as never);
}

function postContext(storage: Record<string, unknown>, input: unknown) {
  return { input, request: new Request("https://commerce.test", { method: "POST" }), storage, requestMeta: {} } as never;
}

function getContext(storage: Record<string, unknown>, input: unknown) {
  return { input, request: new Request("https://commerce.test", { method: "GET" }), storage, requestMeta: {} } as never;
}

describe("Commerce admin order status transitions", () => {
  it("applies an allowed transition and records an audit note", async () => {
    const repositories = createMemoryRepositories();
    await seedPaidOrder(repositories);
    const plugin = createPlugin();

    await plugin.routes["orders/status"].handler(postContext(storageFor(repositories), { orderId: "order-1", command: "fulfillment_processing" }));

    expect(await repositories.orders.get("order-1")).toMatchObject({ status: "processing", fulfillmentStatus: "processing" });
    const notes = await repositories.orderNotes.query({ where: { orderId: "order-1" }, limit: 10 });
    expect(notes.items).toHaveLength(1);
    expect(notes.items[0]?.data).toMatchObject({ type: "private", system: true });
  });

  it("rejects transitions the state machine does not allow", async () => {
    const repositories = createMemoryRepositories();
    await seedPaidOrder(repositories);
    const plugin = createPlugin();
    const storage = storageFor(repositories);

    await expect(plugin.routes["orders/status"].handler(postContext(storage, { orderId: "order-1", command: "complete" }))).rejects.toThrow(/not allowed/i);
    expect(await repositories.orderNotes.count()).toBe(0);
  });

  it("refuses bridge-owned commands", async () => {
    const repositories = createMemoryRepositories();
    await seedPaidOrder(repositories);
    const plugin = createPlugin();

    await expect(plugin.routes["orders/status"].handler(postContext(storageFor(repositories), { orderId: "order-1", command: "payment_paid" }))).rejects.toThrow(/not allowed/i);
  });

  it("restores stock when cancelling a paid order", async () => {
    const repositories = createMemoryRepositories();
    await seedPaidOrder(repositories);
    await repositories.inventory.put("inv-1", { productId: "p-1", sku: "TEA", status: "active", available: 3, reserved: 2, updatedAt: new Date().toISOString() });
    await repositories.reservations.put("res-order-1:line-1", {
      id: "res-order-1:line-1",
      orderId: "order-1",
      sku: "TEA",
      quantity: 2,
      remaining: 0,
      status: "active",
      idempotencyKey: "order-1:line-1",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      inventoryId: "inv-1",
      productId: "p-1",
      lineId: "line-1",
      createdAt: new Date().toISOString(),
    });
    const plugin = createPlugin();

    await plugin.routes["orders/status"].handler(postContext(storageFor(repositories), { orderId: "order-1", command: "cancel" }));

    expect(await repositories.orders.get("order-1")).toMatchObject({ status: "cancelled" });
    expect(await repositories.inventory.get("inv-1")).toMatchObject({ available: 5, reserved: 0 });
  });
});

describe("Commerce admin order notes", () => {
  it("adds and lists notes with types, newest first", async () => {
    const repositories = createMemoryRepositories();
    await seedPaidOrder(repositories);
    const plugin = createPlugin();
    const storage = storageFor(repositories);

    await plugin.routes["orders/notes"].handler(postContext(storage, { orderId: "order-1", note: "Customer asked about delivery.", type: "customer" }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await plugin.routes["orders/notes"].handler(postContext(storage, { orderId: "order-1", note: "Checked warehouse stock." }));

    const result = await plugin.routes["orders/notes"].handler(getContext(storage, { orderId: "order-1" })) as { items: Array<{ note: string; type: string }> };

    expect(result.items.map((item) => item.note)).toEqual(["Checked warehouse stock.", "Customer asked about delivery."]);
    expect(result.items[1]?.type).toBe("customer");
    expect(result.items[0]?.type).toBe("private");
  });

  it("validates note content and type", async () => {
    const repositories = createMemoryRepositories();
    await seedPaidOrder(repositories);
    const plugin = createPlugin();
    const storage = storageFor(repositories);

    await expect(plugin.routes["orders/notes"].handler(postContext(storage, { orderId: "order-1", note: "   ", type: "customer" }))).rejects.toThrow();
    await expect(plugin.routes["orders/notes"].handler(postContext(storage, { orderId: "order-1", note: "hi", type: "public" }))).rejects.toThrow();
    expect(await repositories.orderNotes.count()).toBe(0);
  });

  it("requires an existing order", async () => {
    const repositories = createMemoryRepositories();
    const plugin = createPlugin();

    await expect(plugin.routes["orders/notes"].handler(postContext(storageFor(repositories), { orderId: "missing", note: "x" }))).rejects.toThrow("Order not found");
  });
});

describe("Commerce order numbers", () => {
  it("assigns incrementing short numbers at checkout", async () => {
    const repositories = createMemoryRepositories();
    await repositories.products.put("p-1", { id: "p-1", status: "published", name: "Tea", priceMinor: 500, currency: "USD" });
    const plugin = createPlugin({
      paymentProviders: { "payment-provider": { createPayment: async ({ order }) => ({ checkoutUrl: `https://pay.test/${order.orderId}` }) } },
    });
    const kvStore = new Map<string, number>();
    const context = (input: unknown) => ({
      input,
      request: new Request("https://commerce.test", { method: "POST" }),
      storage: storageFor(repositories),
      requestMeta: {},
      kv: {
        get: async (key: string) => kvStore.get(key),
        set: async (key: string, value: number) => { kvStore.set(key, value); },
      },
    }) as never;

    const cart = await plugin.routes.cart.handler(context({ line: { productId: "p-1", quantity: 1 } })) as { id: string };
    const first = await plugin.routes.checkout.handler(context({ cartId: cart.id, paymentProvider: "payment-provider" })) as { orderId: string };
    const secondCart = await plugin.routes.cart.handler(context({ line: { productId: "p-1", quantity: 2 } })) as { id: string };
    const second = await plugin.routes.checkout.handler(context({ cartId: secondCart.id, paymentProvider: "payment-provider" })) as { orderId: string };

    expect(await repositories.orders.get(first.orderId)).toMatchObject({ orderNumber: 1001 });
    expect(await repositories.orders.get(second.orderId)).toMatchObject({ orderNumber: 1002 });
  });

  it("falls back to a count-derived number when kv is unavailable", async () => {
    const repositories = createMemoryRepositories();
    await repositories.products.put("p-1", { id: "p-1", status: "published", name: "Tea", priceMinor: 500, currency: "USD" });
    const plugin = createPlugin({
      paymentProviders: { "payment-provider": { createPayment: async ({ order }) => ({ checkoutUrl: `https://pay.test/${order.orderId}` }) } },
    });
    const context = (input: unknown) => ({ input, request: new Request("https://commerce.test", { method: "POST" }), storage: storageFor(repositories), requestMeta: {} }) as never;
    const cart = await plugin.routes.cart.handler(context({ line: { productId: "p-1", quantity: 1 } })) as { id: string };
    const result = await plugin.routes.checkout.handler(context({ cartId: cart.id, paymentProvider: "payment-provider" })) as { orderId: string };

    expect(await repositories.orders.get(result.orderId)).toMatchObject({ orderNumber: 1001 });
  });
});

describe("Commerce legacy order backfill", () => {
  it("gives statusless legacy orders a pending_payment state during cron", async () => {
    const repositories = createMemoryRepositories();
    await repositories.orders.put("legacy-1", { id: "legacy-1", orderId: "legacy-1", currency: "USD", lines: [], items: [], createdAt: new Date().toISOString() } as never);
    const plugin = createPlugin();

    await plugin.hooks?.cron?.handler({ name: "commerce-maintenance", scheduledAt: new Date().toISOString() }, { storage: storageFor(repositories) } as never);

    expect(await repositories.orders.get("legacy-1")).toMatchObject({ status: "pending_payment", paymentStatus: "pending" });
  });
});

describe("Commerce lazy backfill on admin list", () => {
  it("heals legacy orders when the orders list is loaded", async () => {
    const repositories = createMemoryRepositories();
    await repositories.orders.put("legacy-2", { id: "legacy-2", orderId: "legacy-2", currency: "USD", lines: [], items: [] } as never);
    const plugin = createPlugin();
    const storage = storageFor(repositories);

    await plugin.routes.orders.handler({ input: {}, request: new Request("https://commerce.test", { method: "GET" }), storage, requestMeta: {} } as never);

    expect(await repositories.orders.get("legacy-2")).toMatchObject({ status: "pending_payment", paymentStatus: "pending" });
  });
});

describe("Commerce orders list filtering and paging", () => {
  async function seedOrders(repositories: CommerceRepositories): Promise<void> {
    await repositories.customers.put("c-1", { id: "c-1", name: "Ada", email: "ada@example.test" });
    await repositories.orders.put("o-a", { id: "o-a", orderId: "o-a", customerId: "c-1", status: "paid", currency: "USD", totalMinor: 1000, lines: [], items: [], createdAt: "2026-01-03T00:00:00Z" } as never);
    await repositories.orders.put("o-b", { id: "o-b", orderId: "o-b", customerId: "c-1", status: "pending_payment", currency: "USD", totalMinor: 2000, lines: [], items: [], createdAt: "2026-01-02T00:00:00Z" } as never);
    await repositories.orders.put("o-c", { id: "o-c", orderId: "o-c", status: "paid", currency: "USD", totalMinor: 3000, lines: [], items: [], createdAt: "2026-01-01T00:00:00Z" } as never);
  }

  function listContext(storage: Record<string, unknown>, input: Record<string, unknown>) {
    return { input, request: new Request("https://commerce.test", { method: "GET" }), storage, requestMeta: {} } as never;
  }

  it("filters by status", async () => {
    const repositories = createMemoryRepositories();
    await seedOrders(repositories);
    const plugin = createPlugin();

    const result = await plugin.routes.orders.handler(listContext(storageFor(repositories), { status: "paid" })) as { items: Array<{ id: string }> };

    expect(result.items.map((item) => item.id).sort()).toEqual(["o-a", "o-c"]);
  });

  it("filters by customer email", async () => {
    const repositories = createMemoryRepositories();
    await seedOrders(repositories);
    const plugin = createPlugin();

    const result = await plugin.routes.orders.handler(listContext(storageFor(repositories), { email: "ada@example.test" })) as { items: Array<{ id: string }> };

    expect(result.items.map((item) => item.id).sort()).toEqual(["o-a", "o-b"]);
  });

  it("paginates with cursor", async () => {
    const repositories = createMemoryRepositories();
    await seedOrders(repositories);
    const plugin = createPlugin();
    const storage = storageFor(repositories);

    const page1 = await plugin.routes.orders.handler(listContext(storage, { limit: 2 })) as { items: Array<{ id: string }>; cursor?: string; hasMore: boolean };
    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);

    const page2 = await plugin.routes.orders.handler(listContext(storage, { limit: 2, cursor: page1.cursor })) as { items: Array<{ id: string }> };
    expect([...page1.items, ...page2.items].map((item) => item.id)).toEqual(["o-a", "o-b", "o-c"]);
  });
});
