import { getCommerceEventSigningData } from "@gmsas95/emdash-commerce-contracts";
import { describe, expect, it } from "vitest";
import { signBridgePayload } from "../../src/bridge/signature.js";
import { createPlugin } from "../../src/index.js";
import { createMemoryRepositories, type CommerceRepositories } from "../../src/storage/repositories.js";

interface PaymentEvent {
  eventId: string;
  event: string;
  version: 1;
  occurredAt: string;
  correlationId: string;
  deliveryId: string;
  payload: {
    providerId: string;
    paymentId: string;
    purchaseId: string;
    commerceOrderId: string;
    status: string;
  };
}

function storageFrom(repositories: CommerceRepositories): Record<string, unknown> {
  return Object.fromEntries(Object.entries(repositories).map(([name, repository]) => [name, {
    get: async (id: string) => (await repository.get(id)) ?? null,
    put: (id: string, data: never) => repository.put(id, data),
    delete: async (id: string) => { await repository.delete(id); return true; },
    query: (options?: never) => repository.query(options),
    count: (where?: never) => repository.count(where),
  }]));
}

function paymentEvent(): PaymentEvent {
  return {
    eventId: "event-1",
    event: "commerce.payment.paid",
    version: 1,
    occurredAt: new Date().toISOString(),
    correlationId: "order-1",
    deliveryId: "delivery-1",
    payload: {
      providerId: "chip",
      paymentId: "payment-1",
      purchaseId: "purchase-1",
      commerceOrderId: "order-1",
      status: "paid",
    },
  };
}

async function eventContext(event: PaymentEvent, storage: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const signature = await signBridgePayload("shared-secret", timestamp, getCommerceEventSigningData(event));
  return {
    input: event,
    storage,
    request: new Request("https://commerce.test/_emdash/api/plugins/emdash-commerce/bridge/events", {
      method: "POST",
      headers: {
        "x-emdash-provider-id": "chip",
        "x-emdash-bridge-signature": signature,
        "x-emdash-bridge-timestamp": timestamp,
      },
    }),
    requestMeta: {},
  } as never;
}

describe("Commerce bridge payment events", () => {
  it("transitions a pending order to paid", async () => {
    const repositories = createMemoryRepositories();
    await repositories.orders.put("order-1", { id: "order-1", orderId: "order-1", status: "pending_payment", paymentStatus: "pending" } as never);
    const plugin = createPlugin({ bridgeSecrets: { chip: "shared-secret" } });
    const storage = storageFrom(repositories);

    const result = await plugin.routes["bridge/events"].handler(await eventContext(paymentEvent(), storage));

    expect(result).toEqual({ ok: true, duplicate: false, deliveryId: "delivery-1", eventId: "event-1" });
    expect(await repositories.orders.get("order-1")).toMatchObject({ status: "paid", paymentStatus: "paid" });
  });

  it("does not reapply a duplicate payment event", async () => {
    const repositories = createMemoryRepositories();
    await repositories.orders.put("order-1", { id: "order-1", orderId: "order-1", status: "pending_payment", paymentStatus: "pending" } as never);
    const plugin = createPlugin({ bridgeSecrets: { chip: "shared-secret" } });
    const storage = storageFrom(repositories);
    const event = paymentEvent();

    await plugin.routes["bridge/events"].handler(await eventContext(event, storage));
    const duplicate = await plugin.routes["bridge/events"].handler(await eventContext(event, storage));

    expect(duplicate).toEqual({ ok: true, duplicate: true, deliveryId: "delivery-1" });
    expect(await repositories.orders.get("order-1")).toMatchObject({ status: "paid", paymentStatus: "paid" });
  });
});
