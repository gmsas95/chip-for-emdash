import { describe, expect, it } from "vitest";
import { createCommerceClient } from "../../src/storefront/client.js";
import { calculateTotals } from "../../src/domain/totals.js";

describe("Commerce checkout integration", () => {
  it("starts checkout from server-calculated totals without trusting browser totals", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const client = createCommerceClient(async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requests.push({ url, body });
      if (url.endsWith("/checkout")) {
        const totals = calculateTotals({
          currency: "MYR",
          lines: [{ unitAmountMinor: 1000, quantity: 2 }],
          discountMinor: 200,
          taxMinor: 180,
          shippingMinor: 500,
        });
        return new Response(JSON.stringify({ success: true, data: { checkoutUrl: "https://gate.chip-in.asia/checkout/test", totalMinor: totals.totalMinor, currency: totals.currency } }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    }, "/_emdash/api/plugins/emdash-commerce");

    const result = await client.checkout.start({ cartId: "cart-1", paymentProvider: "chip" });

    expect(result).toEqual({ checkoutUrl: "https://gate.chip-in.asia/checkout/test", totalMinor: 2480, currency: "MYR" });
    expect(requests[0]?.body).not.toHaveProperty("totalMinor");
  });
});
