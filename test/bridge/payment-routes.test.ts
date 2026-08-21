import { describe, expect, it } from "vitest";
import { getBridgeSigningData } from "@gmsas95/emdash-commerce-contracts";
import { signBridgePayload } from "../../src/bridge/signature.js";
import chipPlugin from "../../src/plugin.js";

function context(input: unknown, ctx: unknown): never {
  return { input, request: new Request("https://chip.test/commerce/payment/create", { method: "POST" }), requestMeta: {}, ...ctx } as never;
}

function baseContext() {
  const payments = new Map<string, Record<string, unknown>>();
  return {
    kv: { get: async (key: string) => key === "settings:secretKey" ? "provider-secret" : key === "settings:commerceBridgeSecret" ? "shared-secret" : key === "settings:brandId" ? "brand-1" : key === "settings:commerceEventUrl" ? "" : undefined },
    storage: {
      payments: {
        query: async () => ({ items: [...payments.entries()].map(([id, data]) => ({ id, data })), hasMore: false }),
        get: async (id: string) => payments.get(id) ?? null,
        put: async (id: string, data: Record<string, unknown>) => { payments.set(id, data); },
      },
    },
    http: {
      fetch: async () => new Response(JSON.stringify({ id: "purchase-1", checkout_url: "https://payments.example.test/checkout/1" }), { status: 200 }),
    },
    log: { info() {}, warn() {}, error() {} },
  };
}

async function signedCreate() {
  const timestamp = new Date().toISOString();
  const request = {
    contract: "commerce.payment.create",
    version: 1 as const,
    requestId: "payment-1",
    idempotencyKey: "idem-1",
    sentAt: timestamp,
    auth: { version: 1 as const, keyId: "commerce", timestamp, signature: "" },
    payload: {
      operation: "charge",
      order: {
        orderId: "order-1",
        currency: "USD",
        items: [],
        subtotal: { amountMinor: 5000, currency: "USD" },
        total: { amountMinor: 5000, currency: "USD" },
      },
    },
  };
  request.auth.signature = await signBridgePayload("shared-secret", timestamp, getBridgeSigningData(request));
  return request;
}

describe("CHIP Commerce payment routes", () => {
  it("rejects an unsigned Commerce payment request", async () => {
    const route = chipPlugin.routes["commerce/payment/create"];
    const ctx = baseContext();
    const result = await route.handler(context({ contract: "commerce.payment.create", requestId: "r-unsigned", idempotencyKey: "idem", version: 1, sentAt: new Date().toISOString(), payload: {} }, ctx), ctx as never);

    expect(result).toMatchObject({ ok: false, error: { code: "BRIDGE_AUTH_FAILED", retryable: false } });
  });

  it("creates an idempotent hosted payment from a signed Commerce request", async () => {
    const route = chipPlugin.routes["commerce/payment/create"];
    const ctx = baseContext();
    const request = await signedCreate();

    const first = await route.handler(context(request, ctx), ctx as never);
    const second = await route.handler(context(request, ctx), ctx as never);

    expect(first).toMatchObject({ ok: true, data: { checkoutUrl: "https://payments.example.test/checkout/1", status: "created" } });
    expect(second).toEqual(first);
  });
});
