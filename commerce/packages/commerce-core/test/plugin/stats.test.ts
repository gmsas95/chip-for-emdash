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

function getContext(storage: Record<string, unknown>) {
  return { input: {}, request: new Request("https://commerce.test", { method: "GET" }), storage, requestMeta: {}, kv: undefined } as never;
}

function day(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - offsetDays);
  return date.toISOString().slice(0, 10);
}

async function seed(repositories: CommerceRepositories): Promise<void> {
  const base = { currency: "MYR", lines: [], items: [] } as Record<string, unknown>;
  await repositories.orders.put("o-1", { ...base, id: "o-1", orderId: "o-1", status: "paid", paymentStatus: "paid", totalMinor: 5000, createdAt: `${day(0)}T10:00:00Z` } as never);
  await repositories.orders.put("o-2", { ...base, id: "o-2", orderId: "o-2", status: "paid", paymentStatus: "paid", totalMinor: 3000, createdAt: `${day(0)}T12:00:00Z` } as never);
  await repositories.orders.put("o-3", { ...base, id: "o-3", orderId: "o-3", status: "processing", paymentStatus: "paid", totalMinor: 2000, createdAt: `${day(1)}T09:00:00Z` } as never);
  await repositories.orders.put("o-4", { ...base, id: "o-4", orderId: "o-4", status: "pending_payment", paymentStatus: "pending", totalMinor: 9000, createdAt: `${day(2)}T09:00:00Z` } as never);
  await repositories.orders.put("o-5", { ...base, id: "o-5", orderId: "o-5", status: "cancelled", paymentStatus: "pending", totalMinor: 8000, createdAt: `${day(3)}T09:00:00Z` } as never);
  await repositories.inventory.put("inv-low", { productId: "p-1", sku: "LOW", status: "active", available: 1, reserved: 0, updatedAt: new Date().toISOString() });
  await repositories.inventory.put("inv-ok", { productId: "p-2", sku: "OK", status: "active", available: 9, reserved: 0, updatedAt: new Date().toISOString() });
}

describe("Commerce dashboard stats", () => {
  it("aggregates paid revenue, counts, AOV, and excludes unpaid states", async () => {
    const repositories = createMemoryRepositories();
    await seed(repositories);
    const plugin = createPlugin();

    const stats = await plugin.routes.stats.handler(getContext(storageFor(repositories))) as {
      totals: { revenueMinor: number; paidOrders: number; aovMinor: number };
      daily: Array<{ date: string; revenueMinor: number; orders: number }>;
      recentOrders: Array<{ id: string }>;
      lowStock: Array<{ sku: string }>;
    };

    expect(stats.totals.revenueMinor).toBe(10000);
    expect(stats.totals.paidOrders).toBe(3);
    expect(stats.totals.aovMinor).toBe(Math.round(10000 / 3));
    expect(stats.daily).toHaveLength(14);
    const today = stats.daily.find((bucket) => bucket.date === day(0));
    expect(today).toMatchObject({ revenueMinor: 8000, orders: 2 });
    expect(stats.daily.every((bucket) => bucket.date !== day(20))).toBe(true);
  });

  it("lists newest orders first and flags low stock", async () => {
    const repositories = createMemoryRepositories();
    await seed(repositories);
    const plugin = createPlugin();

    const stats = await plugin.routes.stats.handler(getContext(storageFor(repositories))) as {
      recentOrders: Array<{ id: string }>;
      lowStock: Array<{ sku: string }>;
    };

    expect(stats.recentOrders[0]?.id).toBe("o-2");
    expect(stats.recentOrders).toHaveLength(5);
    expect(stats.lowStock).toEqual([{ sku: "LOW", available: 1 }]);
  });
});
