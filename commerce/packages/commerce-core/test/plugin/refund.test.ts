import { describe, expect, it } from "vitest";
import { createPlugin } from "../../src/index.js";
import { createMemoryRepositories, type CommerceRepositories } from "../../src/storage/repositories.js";

type FetchLog = Array<{ url: string; body: Record<string, unknown> }>;

function storageFor(repositories: CommerceRepositories): Record<string, unknown> {
  return Object.fromEntries(Object.entries(repositories).map(([name, repository]) => [name, {
    get: async (id: string) => (await repository.get(id)) ?? null,
    put: (id: string, data: never) => repository.put(id, data),
    delete: async (id: string) => { await repository.delete(id); return true; },
    query: (options?: never) => repository.query(options),
    count: (where?: never) => repository.count(where),
  }]));
}

function bridgeResponse(log: FetchLog, data: Record<string, unknown>): { fetcher: unknown } {
  return {
    fetcher: async (url: string, init: RequestInit | undefined) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      log.push({ url, body: request });
      return new Response(JSON.stringify({ requestId: request.requestId, ok: true, data }), { status: 200 });
    },
  };
}

async function seedPaidOrder(repositories: CommerceRepositories): Promise<void> {
  await repositories.orders.put("order-1", {
    id: "order-1",
    orderId: "order-1",
    currency: "USD",
    totalMinor: 2000,
    subtotalMinor: 2000,
    discountMinor: 0,
    taxMinor: 0,
    shippingMinor: 0,
    lines: [],
    items: [],
    status: "paid",
    paymentStatus: "paid",
    paymentProviderId: "chip",
    createdAt: new Date().toISOString(),
  } as never);
  await repositories.inventory.put("inv-1", { productId: "p-1", sku: "TEA", status: "active", available: 3, reserved: 2, updatedAt: new Date().toISOString() });
  await repositories.reservations.put("res-order-1:line-1", {
    id: "res-order-1:line-1",
    orderId: "order-1",
    sku: "TEA",
    quantity: 2,
    remaining: 0,
    status: "confirmed",
    idempotencyKey: "order-1:line-1",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    inventoryId: "inv-1",
    productId: "p-1",
    lineId: "line-1",
    createdAt: new Date().toISOString(),
  });
}

function refundContext(storage: Record<string, unknown>, input: unknown) {
  return { input, request: new Request("https://commerce.test", { method: "POST" }), storage, requestMeta: {} } as never;
}

describe("Commerce merchant refunds", () => {
  it("applies a provider-confirmed refund and restores stock", async () => {
    const log: FetchLog = [];
    const repositories = createMemoryRepositories();
    await seedPaidOrder(repositories);
    const plugin = createPlugin({
      paymentBridges: {
        chip: {
          pluginId: "chip-for-emdash",
          basePath: "https://chip.test/bridge/commerce/payment/refund",
          eventPath: "https://commerce.test/events",
          capabilities: ["payment.refund"],
          sharedSecret: "shared-secret",
          ...bridgeResponse(log, { paymentId: "payment-1", status: "refunded", message: "Payment is already refunded" }),
        } as never,
      },
    });

    const result = await plugin.routes["orders/refund"].handler(refundContext(storageFor(repositories), { orderId: "order-1" })) as { orderId: string; refundStatus: string };

    expect(result).toEqual({ orderId: "order-1", refundStatus: "refunded", message: "Payment is already refunded" });
    expect(await repositories.orders.get("order-1")).toMatchObject({ status: "refunded", paymentStatus: "refunded" });
    expect(await repositories.inventory.get("inv-1")).toMatchObject({ available: 5, reserved: 0 });
    expect(await repositories.reservations.get("res-order-1:line-1")).toMatchObject({ status: "released" });
    expect(log[0]?.body.contract).toBe("commerce.payment.refund");
    expect((log[0]?.body.payload as Record<string, unknown>).paymentId).toBe("order-1");
  });

  it("records a refund request when the provider defers to manual reconciliation", async () => {
    const log: FetchLog = [];
    const repositories = createMemoryRepositories();
    await seedPaidOrder(repositories);
    const plugin = createPlugin({
      paymentBridges: {
        chip: {
          pluginId: "chip-for-emdash",
          basePath: "https://chip.test/bridge/commerce/payment/refund",
          eventPath: "https://commerce.test/events",
          capabilities: ["payment.refund"],
          sharedSecret: "shared-secret",
          ...bridgeResponse(log, { paymentId: "payment-1", status: "MANUAL_PROVIDER_ACTION", message: "Refund request recorded for provider reconciliation" }),
        } as never,
      },
    });

    const result = await plugin.routes["orders/refund"].handler(refundContext(storageFor(repositories), { orderId: "order-1" })) as { orderId: string; refundStatus: string };

    expect(result).toMatchObject({ orderId: "order-1", refundStatus: "requested" });
    expect(await repositories.orders.get("order-1")).toMatchObject({ status: "paid", metadata: { commerceRefundRequested: "true" } });
    expect(await repositories.inventory.get("inv-1")).toMatchObject({ available: 3, reserved: 2 });
  });

  it("rejects refunds for orders without a paid payment", async () => {
    const log: FetchLog = [];
    const repositories = createMemoryRepositories();
    await repositories.orders.put("order-2", { id: "order-2", orderId: "order-2", status: "pending_payment", paymentStatus: "pending", paymentProviderId: "chip", lines: [], items: [] } as never);
    const plugin = createPlugin({
      paymentBridges: {
        chip: {
          pluginId: "chip-for-emdash",
          basePath: "https://chip.test/bridge/commerce/payment/refund",
          eventPath: "https://commerce.test/events",
          capabilities: ["payment.refund"],
          sharedSecret: "shared-secret",
          ...bridgeResponse(log, { status: "refunded" }),
        } as never,
      },
    });

    await expect(plugin.routes["orders/refund"].handler(refundContext(storageFor(repositories), { orderId: "order-2" }))).rejects.toThrow(/not refundable/i);
    expect(log).toHaveLength(0);
  });

  it("reports provider refund failures", async () => {
    const repositories = createMemoryRepositories();
    await seedPaidOrder(repositories);
    const plugin = createPlugin({
      paymentBridges: {
        chip: {
          pluginId: "chip-for-emdash",
          basePath: "https://chip.test/bridge/commerce/payment/refund",
          eventPath: "https://commerce.test/events",
          capabilities: ["payment.refund"],
          sharedSecret: "shared-secret",
          fetcher: async (_url: string, init: RequestInit | undefined) => {
            const request = JSON.parse(String(init?.body ?? "{}")) as { requestId?: string };
            return new Response(JSON.stringify({ requestId: request.requestId, ok: false, error: { code: "REFUND_NOT_ELIGIBLE", message: "Payment is not provider-confirmed as paid", retryable: false } }), { status: 200 });
          },
        } as never,
      },
    });

    await expect(plugin.routes["orders/refund"].handler(refundContext(storageFor(repositories), { orderId: "order-1" }))).rejects.toThrow("Payment is not provider-confirmed as paid");
  });

  it("is idempotent when the order is already refunded", async () => {
    const log: FetchLog = [];
    const repositories = createMemoryRepositories();
    await seedPaidOrder(repositories);
    await repositories.orders.put("order-1", { status: "refunded", paymentStatus: "refunded" } as never);
    const plugin = createPlugin({
      paymentBridges: {
        chip: {
          pluginId: "chip-for-emdash",
          basePath: "https://chip.test/bridge/commerce/payment/refund",
          eventPath: "https://commerce.test/events",
          capabilities: ["payment.refund"],
          sharedSecret: "shared-secret",
          ...bridgeResponse(log, { status: "refunded" }),
        } as never,
      },
    });

    const result = await plugin.routes["orders/refund"].handler(refundContext(storageFor(repositories), { orderId: "order-1" })) as { refundStatus: string };

    expect(result).toMatchObject({ refundStatus: "refunded" });
    expect(log).toHaveLength(0);
    expect(await repositories.inventory.get("inv-1")).toMatchObject({ available: 3, reserved: 2 });
  });
});
