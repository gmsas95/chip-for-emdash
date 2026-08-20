import { describe, expect, it } from "vitest";
import { calculateTotals } from "../../src/domain/totals.js";

describe("calculateTotals", () => {
  it("calculates discounts, tax, shipping, and grand total in minor units", () => {
    expect(calculateTotals({
      currency: "MYR",
      lines: [{ unitAmountMinor: 1000, quantity: 2 }],
      discountMinor: 200,
      taxMinor: 180,
      shippingMinor: 500,
    })).toEqual({
      subtotalMinor: 2000,
      discountMinor: 200,
      taxMinor: 180,
      shippingMinor: 500,
      totalMinor: 2480,
      currency: "MYR",
    });
  });

  it("preserves a zero total for a free order and a fully discounted order", () => {
    expect(calculateTotals({
      currency: "MYR",
      lines: [{ unitAmountMinor: 0, quantity: 1 }],
      discountMinor: 0,
      taxMinor: 0,
      shippingMinor: 0,
    }).totalMinor).toBe(0);

    expect(calculateTotals({
      currency: "MYR",
      lines: [{ unitAmountMinor: 1000, quantity: 1 }],
      discountMinor: 1000,
      taxMinor: 0,
      shippingMinor: 0,
    }).totalMinor).toBe(0);
  });

  it.each([
    ["zero quantity", { unitAmountMinor: 100, quantity: 0 }],
    ["fractional quantity", { unitAmountMinor: 100, quantity: 1.5 }],
  ])("rejects %s", (_caseName, line) => {
    expect(() => calculateTotals({
      currency: "MYR",
      lines: [line],
      discountMinor: 0,
      taxMinor: 0,
      shippingMinor: 0,
    })).toThrow();
  });

  it.each([
    ["negative price", -1],
    ["fractional price", 10.5],
    ["infinite price", Infinity],
    ["unsafe price", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects a %s", (_caseName, unitAmountMinor) => {
    expect(() => calculateTotals({
      currency: "MYR",
      lines: [{ unitAmountMinor, quantity: 1 }],
      discountMinor: 0,
      taxMinor: 0,
      shippingMinor: 0,
    })).toThrow();
  });

  it("rejects explicitly mixed line currencies", () => {
    expect(() => calculateTotals({
      currency: "MYR",
      lines: [
        { unitAmountMinor: 1000, quantity: 1, currency: "MYR" },
        { unitAmountMinor: 500, quantity: 1, currency: "USD" },
      ],
      discountMinor: 0,
      taxMinor: 0,
      shippingMinor: 0,
    })).toThrow();
  });

  it("rejects a discount greater than the subtotal", () => {
    expect(() => calculateTotals({
      currency: "MYR",
      lines: [{ unitAmountMinor: 1000, quantity: 1 }],
      discountMinor: 1001,
      taxMinor: 0,
      shippingMinor: 0,
    })).toThrow();
  });

  it("rejects arithmetic that produces a non-safe total", () => {
    expect(() => calculateTotals({
      currency: "MYR",
      lines: [
        { unitAmountMinor: Number.MAX_SAFE_INTEGER, quantity: 1 },
        { unitAmountMinor: 1, quantity: 1 },
      ],
      discountMinor: 0,
      taxMinor: 0,
      shippingMinor: 0,
    })).toThrow();
  });
});
