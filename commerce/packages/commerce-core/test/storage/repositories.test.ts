import { describe, expect, it } from "vitest";
import { COMMERCE_COLLECTIONS } from "../../src/storage/collections.js";
import { createEmDashRepositories, createMemoryRepositories } from "../../src/storage/repositories.js";

describe("Commerce repositories", () => {
  it("stores JSON documents and returns isolated copies", async () => {
    const repositories = createMemoryRepositories();
    const product = { id: "p-1", name: "Tea", priceMinor: 1000, currency: "MYR" };

    await repositories.products.put(product.id, product);
    product.priceMinor = 1200;

    expect(await repositories.products.get(product.id)).toEqual({
      id: "p-1",
      name: "Tea",
      priceMinor: 1000,
      currency: "MYR",
    });
  });

  it("queries documents through declared commerce indexes", async () => {
    const repositories = createMemoryRepositories();
    await repositories.products.put("p-1", { id: "p-1", status: "published", sku: "tea-1" });
    await repositories.products.put("p-2", { id: "p-2", status: "draft", sku: "coffee-1" });

    const result = await repositories.products.query({ where: { status: { in: ["published"] } } });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].data.id).toBe("p-1");
    expect(await repositories.products.count({ status: "published" })).toBe(1);
  });

  it("matches range and prefix filters and rejects non-indexed fields", async () => {
    const repositories = createMemoryRepositories();
    await repositories.products.put("p-1", { id: "p-1", status: "published", sku: "tea-1", createdAt: "2026-08-20T00:00:00.000Z" });
    await repositories.products.put("p-2", { id: "p-2", status: "published", sku: "tea-2", createdAt: "2026-08-20T01:00:00.000Z" });

    expect((await repositories.products.query({ where: { createdAt: { gte: "2026-08-20T01:00:00.000Z" } } })).items).toHaveLength(1);
    expect((await repositories.products.query({ where: { sku: { startsWith: "tea-" } } })).items).toHaveLength(2);
    await expect(repositories.products.query({ where: { name: "Tea" } })).rejects.toThrow("non-indexed");
  });

  it("uses bounded keyset pagination with an opaque cursor", async () => {
    const repositories = createMemoryRepositories();
    for (let index = 0; index < 51; index += 1) {
      await repositories.products.put(`p-${index}`, {
        id: `p-${index}`,
        status: "published",
        createdAt: `2026-08-20T00:${String(index).padStart(2, "0")}:00.000Z`,
      });
    }

    const firstPage = await repositories.products.query({ orderBy: { createdAt: "asc" } });
    const secondPage = await repositories.products.query({ orderBy: { createdAt: "asc" }, cursor: firstPage.cursor });

    expect(firstPage.items).toHaveLength(50);
    expect(firstPage.hasMore).toBe(true);
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.items[0].id).toBe("p-50");
  });

  it("adapts EmDash null, boolean-delete, and paginated results", async () => {
    const collection = {
      get: async () => null,
      put: async () => undefined,
      delete: async () => true,
      query: async () => ({ items: [{ id: "p-1", data: { id: "p-1" } }], cursor: "next", hasMore: true }),
      count: async () => 1,
    };
    const storage = Object.fromEntries(COMMERCE_COLLECTIONS.map((name) => [name, collection])) as never;
    const repositories = createEmDashRepositories(storage);

    expect(await repositories.products.get("missing")).toBeUndefined();
    await expect(repositories.products.delete("p-1")).resolves.toBeUndefined();
    await expect(repositories.products.query()).resolves.toMatchObject({ hasMore: true, cursor: "next" });
  });

  it("rejects non-JSON values before memory persistence", async () => {
    const repositories = createMemoryRepositories();

    await expect(repositories.products.put("bad", { invalid: new Date() } as never)).rejects.toThrow("JSON");
  });
});
