import { describe, expect, it } from "vitest";
import { createMemoryRepositories, createPlugin, type CommerceRepositories } from "../../src/index.js";

function storageFrom(repositories: CommerceRepositories): Record<string, unknown> {
  return Object.fromEntries(Object.entries(repositories).map(([name, repository]) => [name, {
    get: async (id: string) => (await repository.get(id)) ?? null,
    put: (id: string, data: never) => repository.put(id, data),
    delete: async (id: string) => {
      await repository.delete(id);
      return true;
    },
    query: (options?: never) => repository.query(options),
    count: (where?: never) => repository.count(where),
  }]));
}

function context(storage: ReturnType<typeof storageFrom>, input: unknown, method = "POST") {
  return {
    input,
    request: new Request("https://commerce.test", { method }),
    storage,
    requestMeta: {},
  } as never;
}

describe("Commerce persisted product administration", () => {
  it("saves a product, variant, and inventory record through the storage adapter", async () => {
    const repositories = createMemoryRepositories();
    const plugin = createPlugin({});
    const result = await plugin.routes["products/save"].handler(context(storageFrom(repositories), {
      product: {
        id: "product-1",
        name: "Tea",
        slug: "tea",
        description: "Loose leaf tea",
        status: "draft",
        priceMinor: 1200,
        currency: "MYR",
        images: [],
        hasVariants: true,
      },
      variants: [{
        id: "variant-1",
        name: "Large",
        sku: "TEA-L",
        status: "draft",
        priceMinor: 1500,
        currency: "MYR",
        options: { size: "Large" },
      }],
      inventory: [{
        id: "inventory-1",
        variantId: "variant-1",
        sku: "TEA-L",
        status: "active",
        available: 10,
        reserved: 0,
      }],
    }));

    expect(result).toMatchObject({
      product: { id: "product-1", data: { name: "Tea", status: "draft" } },
      variants: [{ id: "variant-1", data: { productId: "product-1" } }],
      inventory: [{ id: "inventory-1", data: { productId: "product-1", available: 10 } }],
    });
    expect(await repositories.products.get("product-1")).toMatchObject({ name: "Tea" });
    expect(await repositories.variants.get("variant-1")).toMatchObject({ productId: "product-1" });
    expect(await repositories.inventory.get("inventory-1")).toMatchObject({ available: 10 });
  });

  it("keeps draft products out of the public catalog until published", async () => {
    const repositories = createMemoryRepositories();
    const plugin = createPlugin({});
    const storage = storageFrom(repositories);
    await plugin.routes["products/save"].handler(context(storage, {
      product: {
        id: "product-1",
        name: "Tea",
        slug: "tea",
        description: "",
        status: "draft",
        priceMinor: 1200,
        currency: "MYR",
        images: [],
        hasVariants: false,
      },
      variants: [],
      inventory: [],
    }));

    expect(await plugin.routes.catalog.handler(context(storage, undefined, "GET"))).toMatchObject({ items: [] });

    const published = await plugin.routes["products/save"].handler(context(storage, {
      product: { id: "product-1", status: "published" },
      variants: [],
      inventory: [],
    }));
    expect(published).toMatchObject({ product: { id: "product-1", data: { status: "published" } } });
    expect(await plugin.routes.catalog.handler(context(storage, undefined, "GET"))).toMatchObject({
      items: [{ id: "product-1", data: { slug: "tea", status: "published" } }],
    });
  });

  it("archives products without deleting persisted data", async () => {
    const repositories = createMemoryRepositories();
    const plugin = createPlugin({});
    const storage = storageFrom(repositories);
    await repositories.products.put("product-1", {
      name: "Tea",
      slug: "tea",
      description: "",
      status: "published",
      priceMinor: 1200,
      currency: "MYR",
      images: [],
      hasVariants: false,
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
    });

    await plugin.routes["products/archive"].handler(context(storage, { productId: "product-1" }));

    expect(await repositories.products.get("product-1")).toMatchObject({ status: "archived" });
    expect(await plugin.routes.catalog.handler(context(storage, undefined, "GET"))).toMatchObject({ items: [] });
  });
});
