export type OrderStatus =
  | "draft"
  | "pending_payment"
  | "paid"
  | "processing"
  | "partially_fulfilled"
  | "fulfilled"
  | "completed"
  | "cancelled"
  | "failed"
  | "refunded";

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";
export type FulfillmentStatus = "unfulfilled" | "processing" | "partially_fulfilled" | "fulfilled";

export interface OrderState {
  [key: string]: unknown;
  status: OrderStatus;
  paymentStatus?: PaymentStatus;
  fulfillmentStatus?: FulfillmentStatus;
}

export type OrderCommand =
  | { type: "payment_pending" }
  | { type: "payment_paid" }
  | { type: "payment_failed" }
  | { type: "payment_refunded" }
  | { type: "fulfillment_processing" }
  | { type: "fulfillment_partially_fulfilled" }
  | { type: "fulfillment_completed" }
  | { type: "complete" }
  | { type: "cancel" };

function invalidTransition(): never {
  throw new Error("Invalid order transition");
}

export function transitionOrder(order: OrderState, command: OrderCommand): OrderState {
  switch (command.type) {
    case "payment_pending":
      if (order.status === "pending_payment") return { ...order, paymentStatus: "pending" };
      if (order.status === "draft" || order.status === "failed") {
        return { ...order, status: "pending_payment", paymentStatus: "pending" };
      }
      return invalidTransition();
    case "payment_paid":
      if (order.status === "paid" || order.paymentStatus === "paid") {
        return { ...order, status: order.status === "pending_payment" ? "paid" : order.status, paymentStatus: "paid" };
      }
      if (order.status === "pending_payment") {
        return { ...order, status: "paid", paymentStatus: "paid" };
      }
      return invalidTransition();
    case "payment_failed":
      if (order.status === "failed") return { ...order, paymentStatus: "failed" };
      if (order.status === "pending_payment") {
        return { ...order, status: "failed", paymentStatus: "failed" };
      }
      return invalidTransition();
    case "payment_refunded":
      if (order.status === "refunded" || order.paymentStatus === "refunded") {
        return { ...order, status: "refunded", paymentStatus: "refunded" };
      }
      if (
        ["paid", "processing", "partially_fulfilled", "fulfilled", "completed"].includes(order.status) ||
        (order.status === "cancelled" && order.paymentStatus === "paid")
      ) {
        return { ...order, status: "refunded", paymentStatus: "refunded" };
      }
      return invalidTransition();
    case "fulfillment_processing":
      if (order.status === "processing") {
        return { ...order, fulfillmentStatus: "processing" };
      }
      if (order.status === "paid") {
        return { ...order, status: "processing", fulfillmentStatus: "processing" };
      }
      return invalidTransition();
    case "fulfillment_partially_fulfilled":
      if (order.status === "partially_fulfilled") {
        return { ...order, fulfillmentStatus: "partially_fulfilled" };
      }
      if (order.status === "processing") {
        return { ...order, status: "partially_fulfilled", fulfillmentStatus: "partially_fulfilled" };
      }
      return invalidTransition();
    case "fulfillment_completed":
      if (order.status === "fulfilled") {
        return { ...order, fulfillmentStatus: "fulfilled" };
      }
      if (order.status === "processing" || order.status === "partially_fulfilled") {
        return { ...order, status: "fulfilled", fulfillmentStatus: "fulfilled" };
      }
      return invalidTransition();
    case "complete":
      if (order.status === "completed") return { ...order };
      if (order.status === "fulfilled") return { ...order, status: "completed" };
      return invalidTransition();
    case "cancel":
      if (order.status === "cancelled") return { ...order };
      if (["draft", "pending_payment", "paid", "failed"].includes(order.status)) {
        return { ...order, status: "cancelled" };
      }
      return invalidTransition();
    default:
      return invalidTransition();
  }
}
