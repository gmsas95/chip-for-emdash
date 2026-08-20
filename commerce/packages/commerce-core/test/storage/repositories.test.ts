import { describe, expect, it } from "vitest";
import { createOrderSnapshot } from "../../src/domain/orders.js";
import { createMemoryRepositories } from "../../src/storage/repositories.js";

describe("Commerce repositories", () => {
  it("stores JSON documents and returns isolated copies", async () => {
    const repositories = createMemoryRepositories();
    const product = { id: "p-1", name: "Tea", priceMinor: 1000, currency: "MYR" };

    await repositories.products.put(product.id, product);
    product.priceMinor = 1200;

    expect(await repositories.products.get(product.id)).toEqual({
      id: "p-1",
      name: "Tea",
      priceMinor: 1000,
      currency: "MYR",
    });
  });

  it("queries documents through declared commerce indexes", async () => {
    const repositories = createMemoryRepositories();
    const paidOrder = createOrderSnapshot({
      orderId: "o-1",
      currency: "MYR",
      productId: "p-1",
      quantity: 1,
      priceMinor: 1000,
      status: "paid",
      customer: { customerId: "c-1" },
    });
    const draftOrder = createOrderSnapshot({
      orderId: "o-2",
      currency: "MYR",
      productId: "p-2",
      quantity: 1,
      priceMinor: 1200,
      status: "draft",
      customer: { customerId: "c-2" },
    });
    await repositories.orders.put(paidOrder.id, paidOrder);
    await repositories.orders.put(draftOrder.id, draftOrder);

    const result = await repositories.orders.query({ where: { status: "paid" } });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].data.orderId).toBe("o-1");
    expect(await repositories.orders.count({ customerId: "c-1" })).toBe(1);
  });
});
