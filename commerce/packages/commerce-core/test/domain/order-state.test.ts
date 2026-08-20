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

  it("supports failed-payment retry and the complete fulfillment lifecycle", () => {
    const failed = transitionOrder({ status: "draft" }, { type: "payment_pending" });
    const retry = transitionOrder(transitionOrder(failed, { type: "payment_failed" }), { type: "payment_pending" });
    const paid = transitionOrder(retry, { type: "payment_paid" });
    const processing = transitionOrder(paid, { type: "fulfillment_processing" });
    const partial = transitionOrder(processing, { type: "fulfillment_partially_fulfilled" });
    const fulfilled = transitionOrder(partial, { type: "fulfillment_completed" });
    const completed = transitionOrder(fulfilled, { type: "complete" });
    const refunded = transitionOrder(completed, { type: "payment_refunded" });

    expect(failed).toMatchObject({ status: "pending_payment", paymentStatus: "pending" });
    expect(retry).toMatchObject({ status: "pending_payment", paymentStatus: "pending" });
    expect(partial).toMatchObject({ status: "partially_fulfilled", fulfillmentStatus: "partially_fulfilled" });
    expect(fulfilled).toMatchObject({ status: "fulfilled", fulfillmentStatus: "fulfilled" });
    expect(completed.status).toBe("completed");
    expect(refunded).toMatchObject({ status: "refunded", paymentStatus: "refunded" });
  });

  it("allows a paid cancellation to reconcile through refund", () => {
    const cancelled = transitionOrder({ status: "paid", paymentStatus: "paid" }, { type: "cancel" });

    expect(transitionOrder(cancelled, { type: "payment_refunded" })).toMatchObject({
      status: "refunded",
      paymentStatus: "refunded",
    });
  });

  it("rejects terminal and unknown commands", () => {
    expect(() => transitionOrder({ status: "cancelled" }, { type: "complete" })).toThrow("Invalid order transition");
    expect(() => transitionOrder({ status: "refunded" }, { type: "payment_paid" })).toThrow("Invalid order transition");
    expect(() => transitionOrder({ status: "paid" }, { type: "unknown" } as never)).toThrow("Invalid order transition");
  });
});
