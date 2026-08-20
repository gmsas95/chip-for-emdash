import { describe, expect, it } from "vitest";
import { MAX_BRIDGE_DELIVERY_ATTEMPTS } from "@emdash-commerce/core";
import { calculateTotals } from "@emdash-commerce/core/domain/totals";

describe("Commerce core package exports", () => {
  it("resolves the published totals module through its package export", () => {
    expect(calculateTotals({
      currency: "MYR",
      lines: [{ unitAmountMinor: 1000, quantity: 2 }],
      discountMinor: 200,
      taxMinor: 180,
      shippingMinor: 500,
    }).totalMinor).toBe(2480);
    expect(MAX_BRIDGE_DELIVERY_ATTEMPTS).toBe(5);
  });
});
