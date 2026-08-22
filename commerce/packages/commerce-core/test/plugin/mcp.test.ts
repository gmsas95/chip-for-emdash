import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createMemoryRepositories, createPlugin, type CommerceRepositories } from "../../src/index.js";

function storageFrom(repositories: CommerceRepositories): Record<string, unknown> {
  return Object.fromEntries(Object.entries(repositories).map(([name, repository]) => [name, {
    get: async (id: string) => (await repository.get(id)) ?? null,
    put: (id: string, data: never) => repository.put(id, data),
    delete: async (id: string) => { await repository.delete(id); return true; },
    query: (options?: never) => repository.query(options),
    count: (where?: never) => repository.count(where),
  }]));
}

function context(storage: Record<string, unknown>, input: unknown) {
  return { input, request: new Request("https://commerce.test", { method: "POST" }), storage, requestMeta: {} } as never;
}

describe("Commerce MCP tools", () => {
  it("declares search and execute tools on the single EmDash MCP endpoint", () => {
    const plugin = createPlugin({});
    expect(Object.keys(plugin.mcp?.tools ?? {})).toEqual(["search", "execute"]);
    expect(plugin.mcp?.tools.execute.destructive).toBe(true);
    expect(plugin.routes["mcp/search"]?.permission).toBe("plugins:manage");
    expect(plugin.routes["mcp/execute"]?.permission).toBe("plugins:manage");
  });
  it("provides native Zod schemas for EmDash consent serialization", () => {
    const plugin = createPlugin({});
    expect(() => z.toJSONSchema(plugin.mcp!.tools.search.input)).not.toThrow();
  });

  it("searches persisted product records without exposing secrets", async () => {
    const repositories = createMemoryRepositories();
    await repositories.products.put("product-1", { name: "Tea", slug: "tea", status: "published", sku: "TEA-1", priceMinor: 1200, currency: "MYR", images: [], hasVariants: false });
    const plugin = createPlugin({});
    const result = await plugin.routes["mcp/search"].handler(context(storageFrom(repositories), { query: "tea", scope: "products", limit: 20 })) as { results: Array<Record<string, unknown>> };
    expect(result.results).toEqual([expect.objectContaining({ type: "product", id: "product-1", name: "Tea", slug: "tea" })]);
  });

  it("executes an allowlisted product list operation", async () => {
    const repositories = createMemoryRepositories();
    await repositories.products.put("product-1", { name: "Tea", slug: "tea", status: "draft", priceMinor: 1200, currency: "MYR", images: [], hasVariants: false });
    const plugin = createPlugin({});
    const result = await plugin.routes["mcp/execute"].handler(context(storageFrom(repositories), { operation: "product.list", arguments: {} })) as { items: Array<{ id: string }> };
    expect(result.items).toEqual([{ id: "product-1", data: expect.objectContaining({ name: "Tea" }) }]);
  });
});
