import { describe, expect, it } from "vitest";
import { getBridgeSigningData } from "@gmsas95/emdash-commerce-contracts";
import { signBridgePayload } from "../../src/bridge/signature.js";
import chipPlugin, { formatPaymentAmount, formatPaymentDate, formatPaymentStatus } from "../../src/plugin.js";

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

async function signedCreate(customerEmail?: string) {
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
        ...(customerEmail ? { customer: { email: customerEmail } } : {}),
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
  it("reports missing CHIP credentials without hiding the provider reason", async () => {
    const route = chipPlugin.routes["commerce/payment/create"];
    const ctx = baseContext();
    ctx.kv.get = async (key: string) => key === "settings:commerceBridgeSecret" ? "shared-secret" : key === "settings:brandId" ? "brand-1" : undefined;
    const request = await signedCreate();

    const result = await route.handler(context(request, ctx), ctx as never);

    expect(result).toMatchObject({ ok: false, error: { code: "PROVIDER_ERROR", message: "CHIP secret key is not configured" } });
  });
  it("forwards Commerce customer email to CHIP purchase creation", async () => {
    const route = chipPlugin.routes["commerce/payment/create"];
    const ctx = baseContext();
    let purchaseBody: Record<string, unknown> | undefined;
    ctx.http.fetch = async (_url: string, init: RequestInit | undefined) => {
      purchaseBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "purchase-1", checkout_url: "https://payments.example.test/checkout/1" }), { status: 200 });
    };
    const result = await route.handler(context(await signedCreate("customer@example.com"), ctx), ctx as never);

    expect(result).toMatchObject({ ok: true });
    expect(purchaseBody?.client).toEqual({ email: "customer@example.com" });
    expect(String(purchaseBody?.success_redirect)).toMatch(/^https:\/\/chip\.test\/checkout\/result\?token=[^&]+&status=success$/);
    expect(String(purchaseBody?.success_callback)).toMatch(/^https:\/\/chip\.test\/_emdash\/api\/plugins\/chip-for-emdash\/return\?token=[^&]+$/);
  });
});

describe("CHIP Block Kit admin pages", () => {
  it("formats payment values for operator-facing views", () => {
    expect(formatPaymentAmount(5000, "MYR")).toBe("MYR 50.00");
    expect(formatPaymentStatus("failed")).toBe("Needs attention");
    expect(formatPaymentDate("2026-01-02T15:04:05.000Z")).toBe("2026-01-02 15:04 UTC");
  });

  it("renders secret fields as replace-only inputs instead of fake reveal controls", async () => {
    const ctx = baseContext();
    const result = await chipPlugin.routes.admin.handler(context({ type: "page_load", page: "/settings" }, ctx), ctx as never) as { blocks: Array<Record<string, unknown>> };
    const form = result.blocks.find((block) => block.type === "form") as { fields?: Array<Record<string, unknown>> } | undefined;
    expect(form?.fields?.map((field) => field.action_id)).toEqual([
      "secretKey",
      "brandId",
      "publicKey",
      "successUrl",
      "failureUrl",
      "cancelUrl",
      "commerceBridgeSecret",
      "commerceEventUrl",
    ]);
    expect(form?.fields?.find((field) => field.action_id === "secretKey")).toMatchObject({ type: "secret_input", has_value: false });
    expect(result.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "section", text: expect.stringContaining("leave blank to keep the current key") }),
    ]));
  });

  it("renders payments as a table and opens a payment detail component", async () => {
    const ctx = baseContext();
    await ctx.storage.payments.put("payment-1", {
      id: "payment-1",
      purchaseId: "purchase-1",
      returnToken: "return-token",
      reference: "order-1",
      amount: 5000,
      currency: "MYR",
      status: "paid",
      productName: "Tea",
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
    });
    const payments = await chipPlugin.routes.admin.handler(context({ type: "page_load", page: "/payments" }, ctx), ctx as never) as { blocks: Array<Record<string, unknown>> };
    expect(payments.blocks).toEqual(expect.arrayContaining([expect.objectContaining({ type: "table" })]));
    expect(payments.blocks).toEqual(expect.arrayContaining([expect.objectContaining({ type: "form" })]));

    const detail = await chipPlugin.routes.admin.handler(context({ type: "form_submit", action_id: "view_payment", values: { paymentId: "payment-1" } }, ctx), ctx as never) as { blocks: Array<Record<string, unknown>> };
    expect(detail.blocks).toEqual(expect.arrayContaining([expect.objectContaining({ type: "header", text: "Payment detail" })]));
    expect(detail.blocks).toEqual(expect.arrayContaining([expect.objectContaining({ type: "fields" })]));
  });
});

describe("CHIP MCP surface", () => {
  it("does not expose MCP tools or routes", () => {
    expect(chipPlugin.mcp).toBeUndefined();
    expect(chipPlugin.routes["mcp/search"]).toBeUndefined();
    expect(chipPlugin.routes["mcp/execute"]).toBeUndefined();
  });
});
