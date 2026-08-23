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

function postContext(storage: Record<string, unknown>, input: unknown) {
  return { input, request: new Request("https://commerce.test", { method: "POST" }), storage, requestMeta: {} } as never;
}

function getContext(storage: Record<string, unknown>, input: unknown) {
  return { input, request: new Request("https://commerce.test", { method: "GET" }), storage, requestMeta: {} } as never;
}

async function seed(repositories: CommerceRepositories): Promise<void> {
  await repositories.inventory.put("inv-1", { id: "inv-1", productId: "p-1", sku: "TEA", status: "active", available: 5, reserved: 2, updatedAt: "2026-01-01T00:00:00Z" });
  await repositories.reservations.put("r-1", { id: "r-1", orderId: "order-a", sku: "TEA", quantity: 2, remaining: 0, status: "active", idempotencyKey: "k1", inventoryId: "inv-1", createdAt: "2026-02-01T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z" });
  await repositories.reservations.put("r-2", { id: "r-2", orderId: "order-b", sku: "TEA", quantity: 1, remaining: 0, status: "confirmed", idempotencyKey: "k2", inventoryId: "inv-1", createdAt: "2026-03-01T00:00:00Z" });
  await repositories.reservations.put("r-3", { id: "r-3", orderId: "order-c", sku: "TEA", quantity: 9, remaining: 0, status: "released", idempotencyKey: "k3", inventoryId: "inv-1", createdAt: "2026-04-01T00:00:00Z" });
}

describe("Commerce inventory update", () => {
  it("updates stock while preserving identity fields", async () => {
    const repositories = createMemoryRepositories();
    await seed(repositories);
    const plugin = createPlugin();

    await plugin.routes["inventory/update"].handler(postContext(storageFor(repositories), { inventoryId: "inv-1", available: 12 }));

    expect(await repositories.inventory.get("inv-1")).toMatchObject({ productId: "p-1", sku: "TEA", status: "active", available: 12, reserved: 2 });
  });

  it("rejects invalid stock and unknown records", async () => {
    const repositories = createMemoryRepositories();
    await seed(repositories);
    const plugin = createPlugin();
    const storage = storageFor(repositories);

    await expect(plugin.routes["inventory/update"].handler(postContext(storage, { inventoryId: "inv-1", available: -1 }))).rejects.toThrow();
    await expect(plugin.routes["inventory/update"].handler(postContext(storage, { inventoryId: "missing", available: 4 }))).rejects.toThrow("Inventory record not found");
    expect(await repositories.inventory.get("inv-1")).toMatchObject({ available: 5 });
  });
});

describe("Commerce inventory holds feed", () => {
  it("lists only live holds with order references", async () => {
    const repositories = createMemoryRepositories();
    await seed(repositories);
    const plugin = createPlugin();

    const result = await plugin.routes["inventory/holds"].handler(getContext(storageFor(repositories), {})) as { items: Array<{ id: string }> };

    expect(result.items.map((item) => item.id)).toEqual(["r-2", "r-1"]);
  });

  it("includes the configured low-stock threshold on the inventory listing", async () => {
    const repositories = createMemoryRepositories();
    await seed(repositories);
    const kvStore = new Map<string, number>([["settings:lowStockThreshold", 8]]);
    const plugin = createPlugin();
    const context = {
      input: {},
      request: new Request("https://commerce.test", { method: "GET" }),
      storage: storageFor(repositories),
      requestMeta: {},
      kv: {
        get: async (key: string) => kvStore.get(key),
        set: async (key: string, value: number) => { kvStore.set(key, value); },
      },
    } as never;

    const result = await plugin.routes.inventory.handler(context) as { items: unknown[]; lowStockThreshold: number };

    expect(result.lowStockThreshold).toBe(8);
    expect(result.items).toHaveLength(1);
  });
});
