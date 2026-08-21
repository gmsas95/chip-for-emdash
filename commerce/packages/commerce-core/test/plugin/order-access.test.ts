import { describe, expect, it } from "vitest";
import { createMemoryRepositories, createPlugin, type CommerceRepositories } from "../../src/index.js";

function storageFrom(repositories: CommerceRepositories): Record<string, unknown> {
  return Object.fromEntries(Object.entries(repositories).map(([name, repository]) => [name, {
    get: async (id: string) => (await repository.get(id)) ?? null,
    put: (id: string, data: never) => repository.put(id, data),
    delete: async (id: string) => { await repository.delete(id); return true; },
    query: (options?: never) => repository.query(options),
    count: (where?: never) => repository.count(where),
  }]));
}

describe("Commerce public order access", () => {
  it("returns a hosted checkout token and requires it for order lookup", async () => {
    const repositories = createMemoryRepositories();
    await repositories.products.put("p-1", { id: "p-1", status: "published", name: "Tea", priceMinor: 1000, currency: "MYR" });
    const storage = storageFrom(repositories);
    const plugin = createPlugin({ paymentProviders: { chip: { createPayment: async () => ({ checkoutUrl: "https://chip.test/checkout" }) } } });
    const context = (input: unknown, method: string) => ({ input, request: new Request("https://commerce.test", { method }), storage, requestMeta: {} }) as never;
    const cart = await plugin.routes.cart.handler(context({ line: { productId: "p-1", quantity: 1 } }, "POST")) as { id: string };
    const checkout = await plugin.routes.checkout.handler(context({ cartId: cart.id, paymentProvider: "chip", customer: { name: "A. Customer", email: "customer@example.test" }, shippingAddress: { name: "A. Customer", line1: "1 Main Street", city: "Kuala Lumpur", postalCode: "50000", country: "MY" } }, "POST")) as { orderId: string; orderAccessToken: string };
    expect(await repositories.orders.get(checkout.orderId)).toMatchObject({ orderAccessToken: checkout.orderAccessToken });
    expect(await repositories.customers.query({ where: { email: "customer@example.test" }, limit: 1 })).toMatchObject({ items: [{ data: { name: "A. Customer", orderCount: 1 } }] });
    const cartAfterCheckout = await plugin.routes.cart.handler(context({ cartId: cart.id }, "POST")) as { checkoutResult?: Record<string, unknown> };
    expect(cartAfterCheckout).not.toHaveProperty("checkoutResult");

    await expect(plugin.routes.order.handler(context({ orderId: checkout.orderId, orderAccessToken: "wrong" }, "POST"))).rejects.toThrow("Order not found");
    await expect(plugin.routes.order.handler(context({ orderId: checkout.orderId, orderAccessToken: checkout.orderAccessToken }, "POST"))).resolves.toMatchObject({ id: checkout.orderId });
  });
});
