import { describe, expect, it } from "vitest";
import { transitionOrder } from "../../src/domain/order-state.js";

describe("transitionOrder", () => {
  it("does not allow a paid order to return to pending payment", () => {
    expect(() => transitionOrder({ status: "paid" }, { type: "payment_pending" })).toThrow("Invalid order transition");
  });

  it("keeps payment and fulfillment state transitions separate", () => {
    const paid = transitionOrder({ status: "pending_payment" }, { type: "payment_paid" });
    const processing = transitionOrder(paid, { type: "fulfillment_processing" });

    expect(paid).toMatchObject({ status: "paid", paymentStatus: "paid" });
    expect(processing).toMatchObject({ status: "processing", paymentStatus: "paid", fulfillmentStatus: "processing" });
  });

  it("treats repeated commands as idempotent", () => {
    const paid = transitionOrder({ status: "pending_payment" }, { type: "payment_paid" });

    expect(transitionOrder(paid, { type: "payment_paid" })).toEqual(paid);
  });
});
