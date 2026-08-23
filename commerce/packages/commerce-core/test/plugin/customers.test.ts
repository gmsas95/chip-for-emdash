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

function getContext(storage: Record<string, unknown>, input: unknown) {
  return { input, request: new Request("https://commerce.test", { method: "GET" }), storage, requestMeta: {} } as never;
}

async function seed(repositories: CommerceRepositories): Promise<void> {
  await repositories.customers.put("c-1", { id: "c-1", name: "Ada", email: "ada@example.test", status: "active" });
  await repositories.customers.put("c-2", { id: "c-2", name: "Ben", email: "ben@example.test", status: "active" });
  await repositories.orders.put("o-1", { id: "o-1", orderId: "o-1", customerId: "c-1", currency: "USD", totalMinor: 2000, status: "paid", paymentStatus: "paid", lines: [], items: [], createdAt: "2026-01-01T00:00:00Z" } as never);
  await repositories.orders.put("o-2", { id: "o-2", orderId: "o-2", customerId: "c-1", currency: "USD", totalMinor: 500, status: "processing", paymentStatus: "paid", lines: [], items: [], createdAt: "2026-02-01T00:00:00Z" } as never);
  await repositories.orders.put("o-3", { id: "o-3", orderId: "o-3", customerId: "c-1", currency: "USD", totalMinor: 9000, status: "cancelled", paymentStatus: "pending", lines: [], items: [], createdAt: "2026-03-01T00:00:00Z" } as never);
  await repositories.orders.put("o-4", { id: "o-4", orderId: "o-4", currency: "USD", totalMinor: 7777, status: "paid", lines: [], items: [], createdAt: "2026-04-01T00:00:00Z" } as never);
}

describe("Commerce customers enrichment", () => {
  it("adds paid spend totals and last order date to the list", async () => {
    const repositories = createMemoryRepositories();
    await seed(repositories);
    const plugin = createPlugin();

    const result = await plugin.routes.customers.handler(getContext(storageFor(repositories), {})) as { items: Array<{ id: string; totalSpentMinor?: number; lastOrderAt?: string }> };

    const ada = result.items.find((item) => item.id === "c-1");
    expect(ada?.totalSpentMinor).toBe(2500);
    expect(ada?.lastOrderAt).toBe("2026-02-01T00:00:00Z");
    const ben = result.items.find((item) => item.id === "c-2");
    expect(ben?.totalSpentMinor ?? 0).toBe(0);
  });

  it("returns the profile and newest-first order history on detail", async () => {
    const repositories = createMemoryRepositories();
    await seed(repositories);
    const plugin = createPlugin();

    const detail = await plugin.routes["customers/detail"].handler(getContext(storageFor(repositories), { customerId: "c-1" })) as {
      customer: { id: string };
      orders: Array<{ id: string; orderAccessToken?: string }>;
    };

    expect(detail.customer.id).toBe("c-1");
    expect(detail.orders.map((order) => order.id)).toEqual(["o-3", "o-2", "o-1"]);
    expect(detail.orders.every((order) => order.orderAccessToken === undefined)).toBe(true);
  });

  it("rejects an unknown customer", async () => {
    const repositories = createMemoryRepositories();
    const plugin = createPlugin();
    await expect(plugin.routes["customers/detail"].handler(getContext(storageFor(repositories), { customerId: "missing" }))).rejects.toThrow("Customer not found");
  });
});
