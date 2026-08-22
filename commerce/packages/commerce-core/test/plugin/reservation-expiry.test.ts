import { describe, expect, it } from "vitest";
import { createPlugin } from "../../src/index.js";
import { createMemoryRepositories, type CommerceRepositories } from "../../src/storage/repositories.js";

function storageFor(repositories: CommerceRepositories): Record<string, unknown> {
  return Object.fromEntries(Object.entries(repositories).map(([name, repository]) => [name, {
    get: async (id: string) => (await repository.get(id)) ?? null,
    put: (id: string, data: never) => repository.put(id, data),
    delete: async (id: string) => { await repository.delete(id); return true; },
    query: (options?: never) => repository.query(options),
    count: (where?: never) => repository.count(where),
  }]));
}

async function seedExpiredReservation(repositories: CommerceRepositories, orderStatus: string): Promise<void> {
  await repositories.orders.put("order-1", { id: "order-1", orderId: "order-1", status: orderStatus, paymentStatus: orderStatus === "paid" ? "paid" : "pending", lines: [] } as never);
  await repositories.inventory.put("inv-1", { productId: "p-1", sku: "TEA", status: "active", available: 3, reserved: 2, updatedAt: new Date().toISOString() });
  await repositories.reservations.put("res-order-1:line-1", {
    id: "res-order-1:line-1",
    orderId: "order-1",
    sku: "TEA",
    quantity: 2,
    remaining: 0,
    status: "active",
    idempotencyKey: "order-1:line-1",
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    inventoryId: "inv-1",
    productId: "p-1",
    lineId: "line-1",
    createdAt: new Date().toISOString(),
  });
}

function cronContext(storage: Record<string, unknown>) {
  return { storage } as never;
}

describe("Commerce reservation expiry", () => {
  it("expires stale holds and restores stock for unpaid orders during cron", async () => {
    const repositories = createMemoryRepositories();
    await seedExpiredReservation(repositories, "pending_payment");
    const plugin = createPlugin();

    await plugin.hooks?.cron?.handler({ name: "commerce-maintenance", scheduledAt: new Date().toISOString() }, cronContext(storageFor(repositories)));;

    expect(await repositories.inventory.get("inv-1")).toMatchObject({ available: 5, reserved: 0 });
    expect(await repositories.reservations.get("res-order-1:line-1")).toMatchObject({ status: "expired" });
  });

  it("leaves expired holds attached to paid orders untouched", async () => {
    const repositories = createMemoryRepositories();
    await seedExpiredReservation(repositories, "paid");
    const plugin = createPlugin();

    await plugin.hooks?.cron?.handler({ name: "commerce-maintenance", scheduledAt: new Date().toISOString() }, cronContext(storageFor(repositories)));;

    expect(await repositories.inventory.get("inv-1")).toMatchObject({ available: 3, reserved: 2 });
    expect(await repositories.reservations.get("res-order-1:line-1")).toMatchObject({ status: "active" });
  });

  it("does not touch holds that have not expired yet", async () => {
    const repositories = createMemoryRepositories();
    await seedExpiredReservation(repositories, "pending_payment");
    const existing = await repositories.reservations.get("res-order-1:line-1");
    await repositories.reservations.put("res-order-1:line-1", { ...existing, expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() } as never);
    const plugin = createPlugin();

    await plugin.hooks?.cron?.handler({ name: "commerce-maintenance", scheduledAt: new Date().toISOString() }, cronContext(storageFor(repositories)));;

    expect(await repositories.inventory.get("inv-1")).toMatchObject({ available: 3, reserved: 2 });
    expect(await repositories.reservations.get("res-order-1:line-1")).toMatchObject({ status: "active" });
  });
});
