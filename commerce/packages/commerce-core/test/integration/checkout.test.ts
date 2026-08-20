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
    const result = await plugin.routes.checkout.handler(context({ cartId: cart.id, paymentProvider: "payment-provider" }, "POST")) as { checkoutUrl: string; totalMinor: number };

    expect(result.totalMinor).toBe(2000);
    const replay = await plugin.routes.checkout.handler(context({ cartId: cart.id, paymentProvider: "payment-provider" }, "POST"));
    expect(replay).toEqual(result);
    expect(paymentCalls).toBe(1);
    expect(result.checkoutUrl).toMatch(/^https:\/\/payments\.example\.test\/checkout\//);
    await expect(plugin.routes.orders.handler(context({ orderId: "missing" }, "POST"))).rejects.toThrow("Order not found");
  });
});
