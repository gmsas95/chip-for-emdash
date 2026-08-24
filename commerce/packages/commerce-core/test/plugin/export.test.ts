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

function getContext(storage: Record<string, unknown>, input: Record<string, unknown>) {
  return { input, request: new Request("https://commerce.test", { method: "GET" }), storage, requestMeta: {} } as never;
}

async function seed(repositories: CommerceRepositories): Promise<void> {
  await repositories.customers.put("c-1", { id: "c-1", name: "Ada", email: "ada@example.test", phone: "+60011", status: "active", orderCount: 2 });
  await repositories.customers.put("c-2", { id: "c-2", name: "Ben", email: "ben@example.test", status: "active", orderCount: 0 });
  await repositories.orders.put("o-a", { id: "o-a", orderId: "o-a", customerId: "c-1", status: "paid", paymentStatus: "paid", currency: "MYR", totalMinor: 5000, lines: [{ quantity: 2, name: "Tea" }], items: [], createdAt: "2026-01-01T00:00:00Z", paymentProviderId: "chip" } as never);
  await repositories.orders.put("o-b", { id: "o-b", orderId: "o-b", status: "pending_payment", paymentStatus: "pending", currency: "MYR", totalMinor: 900, lines: [], items: [], createdAt: "2026-01-02T00:00:00Z" } as never);
}

describe("Commerce CSV exports", () => {
  it("exports all orders with headers when no selection", async () => {
    const repositories = createMemoryRepositories();
    await seed(repositories);
    const plugin = createPlugin();

    const result = await plugin.routes["orders/export"].handler(getContext(storageFor(repositories), {})) as { filename: string; csv: string };

    expect(result.filename).toMatch(/orders.*\.csv$/);
    expect(result.csv.split("\n")[0]).toContain("order_ref");
    expect(result.csv).toContain("o-a");
    expect(result.csv).toContain("paid");
    expect(result.csv).toContain("o-b");
  });

  it("honors status filter and id subset", async () => {
    const repositories = createMemoryRepositories();
    await seed(repositories);
    const plugin = createPlugin();
    const storage = storageFor(repositories);

    const paidOnly = await plugin.routes["orders/export"].handler(getContext(storage, { status: "paid" })) as { csv: string };
    expect(paidOnly.csv).toContain("o-a");
    expect(paidOnly.csv).not.toContain("o-b");

    const subset = await plugin.routes["orders/export"].handler(getContext(storage, { ids: "o-b" })) as { csv: string };
    expect(subset.csv).not.toContain("o-a");
    expect(subset.csv).toContain("o-b");
  });

  it("exports customers including computed spend columns", async () => {
    const repositories = createMemoryRepositories();
    await seed(repositories);
    await repositories.orders.put("o-c", { id: "o-c", orderId: "o-c", customerId: "c-1", status: "fulfilled", paymentStatus: "paid", currency: "MYR", totalMinor: 2500, lines: [], items: [], createdAt: "2026-02-01T00:00:00Z" } as never);
    const plugin = createPlugin();

    const result = await plugin.routes["customers/export"].handler(getContext(storageFor(repositories), {})) as { filename: string; csv: string };

    expect(result.filename).toMatch(/customers.*\.csv$/);
    expect(result.csv.split("\n")[0]).toContain("total_spent_minor");
    expect(result.csv).toContain("ada@example.test");
    expect(result.csv).toContain("7500");
    expect(result.csv).toContain("ben@example.test");
  });

  it("escapes commas and quotes in values", async () => {
    const repositories = createMemoryRepositories();
    await repositories.customers.put("c-x", { id: "c-x", name: 'Teh, "Tarik" Co', email: "x@y.test", status: "active" });
    const plugin = createPlugin();

    const result = await plugin.routes["customers/export"].handler(getContext(storageFor(repositories), {})) as { csv: string };

    expect(result.csv).toContain('"Teh, ""Tarik"" Co"');
  });
});
