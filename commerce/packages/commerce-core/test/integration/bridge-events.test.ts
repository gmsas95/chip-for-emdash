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

function eventNamed(name: string, status: string): PaymentEvent {
  const base = paymentEvent();
  return { ...base, eventId: `event-${name}`, deliveryId: `delivery-${name}`, event: name, payload: { ...base.payload, status } };
}

async function seedOrderWithReservation(repositories: ReturnType<typeof createMemoryRepositories>, orderStatus: string): Promise<void> {
  await repositories.orders.put("order-1", { id: "order-1", orderId: "order-1", status: orderStatus, paymentStatus: orderStatus === "paid" ? "paid" : "pending", lines: [] } as never);
  await repositories.inventory.put("inv-1", { productId: "p-1", sku: "TEA", status: "active", available: 3, reserved: 2, updatedAt: new Date().toISOString() });
  await repositories.reservations.put("res-order-1:line-1", {
    id: "res-order-1:line-1",
    orderId: "order-1",
    sku: "TEA",
    quantity: 2,
    remaining: 0,
    status: orderStatus === "paid" ? "confirmed" : "active",
    idempotencyKey: "order-1:line-1",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    inventoryId: "inv-1",
    productId: "p-1",
    lineId: "line-1",
    createdAt: new Date().toISOString(),
  });
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

  it("confirms reservations and consumes the hold when payment succeeds", async () => {
    const repositories = createMemoryRepositories();
    await seedOrderWithReservation(repositories, "pending_payment");
    const plugin = createPlugin({ bridgeSecrets: { chip: "shared-secret" } });
    const storage = storageFrom(repositories);

    await plugin.routes["bridge/events"].handler(await eventContext(paymentEvent(), storage));

    expect(await repositories.orders.get("order-1")).toMatchObject({ status: "paid", paymentStatus: "paid" });
    expect(await repositories.inventory.get("inv-1")).toMatchObject({ available: 3, reserved: 0 });
    const reservation = await repositories.reservations.get("res-order-1:line-1");
    expect(reservation).toMatchObject({ status: "confirmed", quantity: 2 });
  });

  it("marks the order failed and restores stock on payment_failed", async () => {
    const repositories = createMemoryRepositories();
    await seedOrderWithReservation(repositories, "pending_payment");
    const plugin = createPlugin({ bridgeSecrets: { chip: "shared-secret" } });
    const storage = storageFrom(repositories);

    const result = await plugin.routes["bridge/events"].handler(await eventContext(eventNamed("commerce.payment.failed", "failed"), storage));

    expect(result).toMatchObject({ ok: true, deliveryId: "delivery-commerce.payment.failed" });
    expect(await repositories.orders.get("order-1")).toMatchObject({ status: "failed", paymentStatus: "failed" });
    expect(await repositories.inventory.get("inv-1")).toMatchObject({ available: 5, reserved: 0 });
    expect(await repositories.reservations.get("res-order-1:line-1")).toMatchObject({ status: "released" });
  });

  it("cancels a pending order on payment_cancelled", async () => {
    const repositories = createMemoryRepositories();
    await seedOrderWithReservation(repositories, "pending_payment");
    const plugin = createPlugin({ bridgeSecrets: { chip: "shared-secret" } });
    const storage = storageFrom(repositories);

    await plugin.routes["bridge/events"].handler(await eventContext(eventNamed("commerce.payment.cancelled", "cancelled"), storage));

    expect(await repositories.orders.get("order-1")).toMatchObject({ status: "cancelled" });
    expect(await repositories.inventory.get("inv-1")).toMatchObject({ available: 5, reserved: 0 });
    expect(await repositories.reservations.get("res-order-1:line-1")).toMatchObject({ status: "released" });
  });

  it("refunds a paid order and restores stock on payment_refunded", async () => {
    const repositories = createMemoryRepositories();
    await seedOrderWithReservation(repositories, "paid");
    const plugin = createPlugin({ bridgeSecrets: { chip: "shared-secret" } });
    const storage = storageFrom(repositories);

    await plugin.routes["bridge/events"].handler(await eventContext(eventNamed("commerce.payment.refunded", "refunded"), storage));

    expect(await repositories.orders.get("order-1")).toMatchObject({ status: "refunded", paymentStatus: "refunded" });
    expect(await repositories.inventory.get("inv-1")).toMatchObject({ available: 5, reserved: 0 });
    expect(await repositories.reservations.get("res-order-1:line-1")).toMatchObject({ status: "released" });
  });

  it("records out-of-order events without corrupting state", async () => {
    const repositories = createMemoryRepositories();
    await seedOrderWithReservation(repositories, "pending_payment");
    const plugin = createPlugin({ bridgeSecrets: { chip: "shared-secret" } });
    const storage = storageFrom(repositories);

    const result = await plugin.routes["bridge/events"].handler(await eventContext(eventNamed("commerce.payment.refunded", "refunded"), storage));

    expect(result).toMatchObject({ ok: true });
    expect(await repositories.orders.get("order-1")).toMatchObject({ status: "pending_payment" });
    expect(await repositories.inventory.get("inv-1")).toMatchObject({ available: 3, reserved: 2 });
  });
});
