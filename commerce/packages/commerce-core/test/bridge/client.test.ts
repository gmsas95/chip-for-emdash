import { describe, expect, it } from "vitest";
import { parseBridgeRequest } from "@emdash-commerce/contracts";
import { sendBridgeCommand } from "../../src/bridge/client.js";

describe("sendBridgeCommand", () => {
  it("sends a signed request and parses a provider response", async () => {
    let requestBody = "";
    const response = await sendBridgeCommand({
      pluginId: "chip",
      basePath: "https://commerce.test/bridge",
      eventPath: "https://commerce.test/bridge/events",
      capabilities: ["payment.create"],
      sharedSecret: "secret",
      fetcher: async (_url, init) => {
        requestBody = String(init?.body);
        return new Response(JSON.stringify({ requestId: "req-1", ok: true, data: { checkoutUrl: "https://pay.test" } }), { status: 200 });
      },
    }, {
      contract: "commerce.payment.create",
      version: 1,
      requestId: "req-1",
      idempotencyKey: "idem-1",
      sentAt: new Date().toISOString(),
      payload: { operation: "charge", order: { orderId: "o-1", currency: "MYR", items: [], subtotal: { amountMinor: 0, currency: "MYR" }, total: { amountMinor: 0, currency: "MYR" } } },
    });

    expect(response).toEqual({ requestId: "req-1", ok: true, data: { checkoutUrl: "https://pay.test" } });
    expect(JSON.parse(requestBody).auth.signature).toEqual(expect.any(String));
    expect(() => parseBridgeRequest(JSON.parse(requestBody))).not.toThrow();
  });

  it("marks authentication failures as non-retryable", async () => {
    const response = await sendBridgeCommand({
      pluginId: "chip",
      basePath: "https://commerce.test/bridge",
      eventPath: "https://commerce.test/bridge/events",
      capabilities: ["payment.create"],
      sharedSecret: "secret",
      fetcher: async () => new Response("unauthorized", { status: 401 }),
    }, {
      contract: "commerce.payment.create",
      version: 1,
      requestId: "req-2",
      idempotencyKey: "idem-2",
      sentAt: new Date().toISOString(),
      payload: { operation: "charge", order: { orderId: "o-2", currency: "MYR", items: [], subtotal: { amountMinor: 0, currency: "MYR" }, total: { amountMinor: 0, currency: "MYR" } } },
    });

    expect(response.error).toMatchObject({ retryable: false });
  });

  it("keeps malformed transient HTTP failures retryable", async () => {
    const response = await sendBridgeCommand({
      pluginId: "chip",
      basePath: "https://commerce.test/bridge",
      eventPath: "https://commerce.test/bridge/events",
      capabilities: ["payment.create"],
      sharedSecret: "secret",
      fetcher: async () => new Response("temporarily unavailable", { status: 503 }),
    }, {
      contract: "commerce.payment.create",
      version: 1,
      requestId: "req-3",
      idempotencyKey: "idem-3",
      sentAt: new Date().toISOString(),
      payload: { operation: "charge", order: { orderId: "o-3", currency: "MYR", items: [], subtotal: { amountMinor: 0, currency: "MYR" }, total: { amountMinor: 0, currency: "MYR" } } },
    });

    expect(response.error).toMatchObject({ code: "HTTP_503", retryable: true });
  });
});
