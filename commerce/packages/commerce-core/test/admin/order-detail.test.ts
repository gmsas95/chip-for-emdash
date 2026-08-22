import { describe, expect, it } from "vitest";
import { commandLabel, formatOrderRef, statusLabel, statusTransitionOptions, terminalHint } from "../../src/admin/OrderDetail.js";

describe("Commerce order detail presentation", () => {
  it("labels every order status in operator language", () => {
    expect(statusLabel("pending_payment")).toBe("Pending payment");
    expect(statusLabel("partially_fulfilled")).toBe("Partially fulfilled");
    expect(statusLabel(undefined)).toBe("Unknown");
  });

  it("labels admin transition commands", () => {
    expect(commandLabel("fulfillment_processing")).toBe("Start fulfilment");
    expect(commandLabel("complete")).toBe("Complete order");
    expect(commandLabel("unknown_command")).toBe("unknown_command");
  });

  it("derives the available transitions from the live state machine", () => {
    const paid = statusTransitionOptions({ status: "paid", paymentStatus: "paid" });
    expect(paid.map(({ command }) => command)).toEqual(["fulfillment_processing", "cancel"]);

    const pending = statusTransitionOptions({ status: "pending_payment", paymentStatus: "pending" });
    expect(pending.map(({ command }) => command)).toEqual(["payment_failed", "cancel"]);
  });

  it("offers no transitions for terminal states", () => {
    expect(statusTransitionOptions({ status: "completed", paymentStatus: "paid", fulfillmentStatus: "fulfilled" })).toEqual([]);
    expect(statusTransitionOptions({})).toEqual([]);
  });
});

describe("Commerce order reference formatting", () => {
  it("prefers the short sequential number", () => {
    expect(formatOrderRef({ orderNumber: 1001, id: "whatever" })).toBe("#1001");
  });

  it("shortens long internal ids to a readable reference", () => {
    expect(formatOrderRef({ id: "8738a4d1-bc00-45b1-b6f6-6520f9886816" })).toBe("#8738A4D1");
    expect(formatOrderRef({ orderId: "short-one" })).toBe("#short-one");
  });
});

describe("Commerce terminal-state hints", () => {
  it("explains why no actions are available", () => {
    expect(terminalHint("cancelled")).toMatch(/cancelled/i);
    expect(terminalHint("completed")).toMatch(/completed/i);
    expect(terminalHint("refunded")).toMatch(/refunded/i);
    expect(terminalHint("pending_payment")).toBe("");
    expect(terminalHint(undefined)).toBe("");
  });
});
