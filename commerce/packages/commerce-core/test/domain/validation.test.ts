import { describe, expect, it } from "vitest";
import { validateCheckout } from "../../src/domain/validation.js";

describe("validateCheckout", () => {
  it("accepts a valid checkout input without errors", () => {
    expect(validateCheckout({
      currency: "MYR",
      lines: [{ unitAmountMinor: 1000, quantity: 2 }],
      discountMinor: 200,
      taxMinor: 180,
      shippingMinor: 500,
    })).toEqual({ valid: true, errors: [] });
  });

  it("returns structured errors instead of throwing for invalid user input", () => {
    const result = validateCheckout({
      currency: "MYR",
      lines: [
        { unitAmountMinor: -1, quantity: 0 },
        { unitAmountMinor: 500, quantity: 1, currency: "USD" },
      ],
      discountMinor: 2000,
      taxMinor: 0,
      shippingMinor: 0,
    });

    expect(result).toEqual({
      valid: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "NEGATIVE_AMOUNT", field: "lines[0].unitAmountMinor" }),
        expect.objectContaining({ code: "INVALID_QUANTITY", field: "lines[0].quantity" }),
        expect.objectContaining({ code: "MIXED_CURRENCIES", field: "lines[1].currency" }),
        expect.objectContaining({ code: "DISCOUNT_EXCEEDS_SUBTOTAL", field: "discountMinor" }),
      ]),
    });
    expect(result.valid).toBe(false);
  });

  it("reports non-safe and non-finite money values", () => {
    const result = validateCheckout({
      currency: "MYR",
      lines: [{ unitAmountMinor: Number.MAX_SAFE_INTEGER + 1, quantity: 1 }],
      discountMinor: NaN,
      taxMinor: Infinity,
      shippingMinor: 0,
    });

    expect(result).toMatchObject({ valid: false });
    if (result.valid) {
      throw new Error("Expected invalid checkout result");
    }
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "INVALID_AMOUNT", field: "lines[0].unitAmountMinor" }),
      expect.objectContaining({ code: "INVALID_AMOUNT", field: "discountMinor" }),
      expect.objectContaining({ code: "INVALID_AMOUNT", field: "taxMinor" }),
    ]));
  });
});
