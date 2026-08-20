import { describe, expect, it } from "vitest";
import { createCommerceClient, CommerceApiError } from "../../src/storefront/client.js";

describe("createCommerceClient", () => {
  it("unwraps the EmDash response envelope for catalog and cart calls", async () => {
    const client = createCommerceClient(async (url, init) => {
      if (url.endsWith("/catalog")) {
        return new Response(JSON.stringify({ success: true, data: { items: [{ id: "p-1" }] } }), { status: 200 });
      }
      expect(url).toContain("/cart");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ success: true, data: { id: "cart-1", currency: "MYR", lines: [] } }), { status: 200 });
    }, "/_emdash/api/plugins/emdash-commerce");

    expect(await client.catalog.list()).toEqual({ items: [{ id: "p-1" }] });
    expect(await client.cart.create({ currency: "MYR" })).toEqual({ id: "cart-1", currency: "MYR", lines: [] });
  });

  it("preserves typed API errors", async () => {
    const client = createCommerceClient(async () => new Response(JSON.stringify({ success: false, error: { code: "INSUFFICIENT_STOCK", message: "No stock" } }), { status: 409 }), "/api");

    await expect(client.checkout.start({ cartId: "cart-1", paymentProvider: "chip" })).rejects.toBeInstanceOf(CommerceApiError);
  });
});
