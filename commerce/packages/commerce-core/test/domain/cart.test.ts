import { describe, expect, it } from "vitest";
import { addCartLine } from "../../src/domain/cart.js";

describe("addCartLine", () => {
  it("merges repeated product lines without mutating the cart", () => {
    const cart = {
      id: "cart-1",
      currency: "MYR",
      lines: [{ lineId: "line-1", productId: "p-1", unitAmountMinor: 1000, quantity: 1, currency: "MYR" }],
    };

    const next = addCartLine(cart, { productId: "p-1", unitAmountMinor: 1000, quantity: 2, currency: "MYR" });

    expect(next.lines).toHaveLength(1);
    expect(next.lines[0].quantity).toBe(3);
    expect(cart.lines[0].quantity).toBe(1);
  });

  it("rejects cart lines in a different currency", () => {
    expect(() => addCartLine({ id: "cart-1", currency: "MYR", lines: [] }, {
      productId: "p-1",
      unitAmountMinor: 1000,
      quantity: 1,
      currency: "USD",
    })).toThrow("currency");
  });
});
