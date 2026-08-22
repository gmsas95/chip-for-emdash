import { describe, expect, it } from "vitest";
import { calculateTotals } from "../../src/domain/totals.js";
import { createPlugin } from "../../src/index.js";
import { createCommerceClient } from "../../src/storefront/client.js";
import { createMemoryRepositories } from "../../src/storage/repositories.js";

describe("Commerce checkout integration", () => {
  it("starts checkout from server-calculated totals without trusting browser totals", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const client = createCommerceClient(async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requests.push({ url, body });
      if (url.endsWith("/checkout")) {
        const totals = calculateTotals({
          currency: "USD",
          lines: [{ unitAmountMinor: 1000, quantity: 2 }],
          discountMinor: 200,
          taxMinor: 180,
          shippingMinor: 500,
        });
        return new Response(JSON.stringify({ success: true, data: { orderId: "order-1", checkoutUrl: "https://payments.example.test/checkout/test", totalMinor: totals.totalMinor, currency: totals.currency } }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    }, "/_emdash/api/plugins/emdash-commerce");

    const result = await client.checkout.start({ cartId: "cart-1", paymentProvider: "payment-provider" });

    expect(result).toEqual({ orderId: "order-1", checkoutUrl: "https://payments.example.test/checkout/test", totalMinor: 2480, currency: "USD" });
    expect(requests[0]?.body).not.toHaveProperty("totalMinor");
  });

  it("runs the native checkout route with a fake payment provider and catalog pricing", async () => {
    const repositories = createMemoryRepositories();
    await repositories.products.put("p-1", { id: "p-1", status: "published", name: "Tea", priceMinor: 1000, currency: "USD" });
    const storage = Object.fromEntries(Object.entries(repositories).map(([name, repository]) => [name, {
      get: async (id: string) => (await repository.get(id)) ?? null,
      put: (id: string, data: never) => repository.put(id, data),
      delete: async (id: string) => {
        await repository.delete(id);
        return true;
      },
      query: (options?: never) => repository.query(options),
      count: (where?: never) => repository.count(where),
    }]));
    let paymentCalls = 0;
    const plugin = createPlugin({
      paymentProviders: {
        "payment-provider": {
          createPayment: async ({ order }) => {
            paymentCalls += 1;
            return { checkoutUrl: `https://payments.example.test/checkout/${order.orderId}` };
          },
        },
      },
    });
    const request = (method: string) => new Request("https://commerce.test", { method });
    const context = (input: unknown, method: string) => ({ input, request: request(method), storage, requestMeta: {} }) as never;

    const cart = await plugin.routes.cart.handler(context({ line: { productId: "p-1", quantity: 2 } }, "POST")) as { id: string };
    const result = await plugin.routes.checkout.handler(context({ cartId: cart.id, paymentProvider: "payment-provider" }, "POST")) as { orderId: string; checkoutUrl: string; totalMinor: number };

    expect(result.totalMinor).toBe(2000);
    expect(await repositories.orders.get(result.orderId)).toMatchObject({ status: "pending_payment", paymentStatus: "pending" });
    const replay = await plugin.routes.checkout.handler(context({ cartId: cart.id, paymentProvider: "payment-provider" }, "POST"));
    expect(replay).toEqual(result);
    expect(paymentCalls).toBe(1);
    expect(result.checkoutUrl).toMatch(/^https:\/\/payments\.example\.test\/checkout\//);
    await expect(plugin.routes.orders.handler(context({ orderId: "missing" }, "POST"))).rejects.toThrow("Order not found");
  });
  it("surfaces safe provider configuration details when payment creation fails", async () => {
    const repositories = createMemoryRepositories();
    await repositories.products.put("p-1", { id: "p-1", status: "published", name: "Tea", priceMinor: 1000, currency: "USD" });
    const storage = Object.fromEntries(Object.entries(repositories).map(([name, repository]) => [name, {
      get: async (id: string) => (await repository.get(id)) ?? null,
      put: (id: string, data: never) => repository.put(id, data),
      delete: async (id: string) => { await repository.delete(id); return true; },
      query: (options?: never) => repository.query(options),
      count: (where?: never) => repository.count(where),
    }]));
    const plugin = createPlugin({
      paymentProviders: {
        "payment-provider": {
          createPayment: async () => { throw new Error("BRIDGE_NOT_CONFIGURED: Commerce bridge is not configured"); },
        },
      },
    });
    const context = (input: unknown, method: string) => ({ input, request: new Request("https://commerce.test", { method }), storage, requestMeta: {} }) as never;
    const cart = await plugin.routes.cart.handler(context({ line: { productId: "p-1", quantity: 1 } }, "POST")) as { id: string };

    await expect(plugin.routes.checkout.handler(context({ cartId: cart.id, paymentProvider: "payment-provider" }, "POST"))).rejects.toThrow(
      "Payment provider failed: BRIDGE_NOT_CONFIGURED: Commerce bridge is not configured",
    );
  });
  function storageFor(repositories: ReturnType<typeof createMemoryRepositories>) {
    return Object.fromEntries(Object.entries(repositories).map(([name, repository]) => [name, {
      get: async (id: string) => (await repository.get(id)) ?? null,
      put: (id: string, data: never) => repository.put(id, data),
      delete: async (id: string) => { await repository.delete(id); return true; },
      query: (options?: never) => repository.query(options),
      count: (where?: never) => repository.count(where),
    }]));
  }

  it("reserves inventory during checkout and decrements available stock", async () => {
    const repositories = createMemoryRepositories();
    await repositories.products.put("p-1", { id: "p-1", status: "published", name: "Tea", priceMinor: 1000, currency: "USD" });
    await repositories.inventory.put("inv-1", { productId: "p-1", sku: "TEA", status: "active", available: 3, reserved: 0, updatedAt: new Date().toISOString() });
    const plugin = createPlugin({
      paymentProviders: {
        "payment-provider": {
          createPayment: async ({ order }) => ({ checkoutUrl: `https://payments.example.test/checkout/${order.orderId}` }),
        },
      },
    });
    const context = (input: unknown, method: string) => ({ input, request: new Request("https://commerce.test", { method }), storage: storageFor(repositories), requestMeta: {} }) as never;

    const cart = await plugin.routes.cart.handler(context({ line: { productId: "p-1", quantity: 2 } }, "POST")) as { id: string };
    const result = await plugin.routes.checkout.handler(context({ cartId: cart.id, paymentProvider: "payment-provider" }, "POST")) as { orderId: string };

    expect(await repositories.inventory.get("inv-1")).toMatchObject({ available: 1, reserved: 2 });
    const stored = await repositories.reservations.query({ where: { orderId: result.orderId }, limit: 10 });
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0]?.data).toMatchObject({ orderId: result.orderId, quantity: 2, status: "active" });
    expect(typeof (stored.items[0]?.data as { expiresAt?: string }).expiresAt).toBe("string");
  });

  it("blocks checkout and keeps cart active when stock is insufficient", async () => {
    const repositories = createMemoryRepositories();
    await repositories.products.put("p-1", { id: "p-1", status: "published", name: "Tea", priceMinor: 1000, currency: "USD" });
    await repositories.inventory.put("inv-1", { productId: "p-1", sku: "TEA", status: "active", available: 1, reserved: 0, updatedAt: new Date().toISOString() });
    const plugin = createPlugin({
      paymentProviders: {
        "payment-provider": {
          createPayment: async () => ({ checkoutUrl: "https://payments.example.test/checkout/x" }),
        },
      },
    });
    const context = (input: unknown, method: string) => ({ input, request: new Request("https://commerce.test", { method }), storage: storageFor(repositories), requestMeta: {} }) as never;

    const cart = await plugin.routes.cart.handler(context({ line: { productId: "p-1", quantity: 2 } }, "POST")) as { id: string };
    await expect(plugin.routes.checkout.handler(context({ cartId: cart.id, paymentProvider: "payment-provider" }, "POST"))).rejects.toThrow(/insufficient/i);

    expect(await repositories.orders.count()).toBe(0);
    expect(await repositories.inventory.get("inv-1")).toMatchObject({ available: 1, reserved: 0 });
    expect(await repositories.reservations.count()).toBe(0);
  });

  it("releases reserved stock when the payment provider fails during checkout", async () => {
    const repositories = createMemoryRepositories();
    await repositories.products.put("p-1", { id: "p-1", status: "published", name: "Tea", priceMinor: 1000, currency: "USD" });
    await repositories.inventory.put("inv-1", { productId: "p-1", sku: "TEA", status: "active", available: 3, reserved: 0, updatedAt: new Date().toISOString() });
    const plugin = createPlugin({
      paymentProviders: {
        "payment-provider": {
          createPayment: async () => { throw new Error("BRIDGE_NOT_CONFIGURED: Commerce bridge is not configured"); },
        },
      },
    });
    const context = (input: unknown, method: string) => ({ input, request: new Request("https://commerce.test", { method }), storage: storageFor(repositories), requestMeta: {} }) as never;

    const cart = await plugin.routes.cart.handler(context({ line: { productId: "p-1", quantity: 2 } }, "POST")) as { id: string };
    await expect(plugin.routes.checkout.handler(context({ cartId: cart.id, paymentProvider: "payment-provider" }, "POST"))).rejects.toThrow("Payment provider failed");

    expect(await repositories.inventory.get("inv-1")).toMatchObject({ available: 3, reserved: 0 });
    const reservations = await repositories.reservations.query({ limit: 10 });
    expect(reservations.items).toHaveLength(1);
    expect(reservations.items[0]?.data).toMatchObject({ status: "released" });
  });

  it("surfaces bridge response errors from the configured payment provider", async () => {
    const repositories = createMemoryRepositories();
    await repositories.products.put("p-1", { id: "p-1", status: "published", name: "Tea", priceMinor: 1000, currency: "USD" });
    const storage = Object.fromEntries(Object.entries(repositories).map(([name, repository]) => [name, {
      get: async (id: string) => (await repository.get(id)) ?? null,
      put: (id: string, data: never) => repository.put(id, data),
      delete: async (id: string) => { await repository.delete(id); return true; },
      query: (options?: never) => repository.query(options),
      count: (where?: never) => repository.count(where),
    }]));
    const plugin = createPlugin({
      paymentBridges: {
        chip: {
          pluginId: "chip-for-emdash",
          basePath: "https://chip.test/bridge",
          eventPath: "https://commerce.test/events",
          capabilities: ["payment.create"],
          sharedSecret: "shared-secret",
          fetcher: async (_url: string, init: RequestInit | undefined) => {
            const request = JSON.parse(String(init?.body ?? "{}")) as { requestId?: string };
            return new Response(JSON.stringify({
              requestId: request.requestId,
              ok: false,
              error: { code: "BRIDGE_NOT_CONFIGURED", message: "Commerce bridge is not configured", retryable: false },
            }), { status: 200 });
          },
        } as never,
      },
    });
    const context = (input: unknown, method: string) => ({ input, request: new Request("https://commerce.test", { method }), storage, requestMeta: {} }) as never;
    const cart = await plugin.routes.cart.handler(context({ line: { productId: "p-1", quantity: 1 } }, "POST")) as { id: string };

    await expect(plugin.routes.checkout.handler(context({ cartId: cart.id, paymentProvider: "chip" }, "POST"))).rejects.toThrow(
      "Payment provider failed: BRIDGE_NOT_CONFIGURED: Commerce bridge is not configured",
    );
  });
});
