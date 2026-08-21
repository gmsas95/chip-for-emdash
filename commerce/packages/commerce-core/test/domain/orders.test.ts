import { describe, expect, it } from "vitest";
import type { PaymentCommand } from "@gmsas95/emdash-commerce-contracts";
import { createOrderSnapshot } from "../../src/domain/orders.js";
describe("createOrderSnapshot", () => {
  it("captures the historical line-item price", () => {
    const order = createOrderSnapshot({
      orderId: "o-1",
      productId: "p-1",
      quantity: 1,
      priceMinor: 1000,
      currency: "USD",
    });

    expect(order.lines[0]).toMatchObject({
      productId: "p-1",
      quantity: 1,
      unitAmountMinor: 1000,
      totalMinor: 1000,
      currency: "USD",
    });
    expect(order.totalMinor).toBe(1000);
  });

  it("can be passed to the shared payment bridge contract", () => {
    const order = createOrderSnapshot({
      orderId: "o-bridge",
      currency: "USD",
      productId: "p-1",
      quantity: 1,
      priceMinor: 1000,
    });

    const command: PaymentCommand = { operation: "charge", order };

    expect(command.order.orderId).toBe("o-bridge");
  });

  it("deeply freezes copied order details and totals", () => {
    const customer = { name: "Ada", email: "ada@example.test" };
    const order = createOrderSnapshot({
      orderId: "o-2",
      currency: "USD",
      lines: [{ lineId: "line-1", productId: "p-1", name: "Tea", quantity: 2, unitAmountMinor: 1000 }],
      discountMinor: 200,
      taxMinor: 180,
      shippingMinor: 500,
      customer,
    });

    customer.name = "Changed";

    expect(Object.isFrozen(order)).toBe(true);
    expect(Object.isFrozen(order.lines)).toBe(true);
    expect(order.customer?.name).toBe("Ada");
    expect(order.totalMinor).toBe(2480);
  });
});
