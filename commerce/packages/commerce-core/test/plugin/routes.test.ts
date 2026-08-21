import { describe, expect, it } from "vitest";
import { commercePlugin, createPlugin } from "../../src/index.js";

describe("Commerce native plugin", () => {
  it("declares the Commerce sidebar pages", () => {
    const descriptor = commercePlugin({});

    expect(descriptor.adminPages?.map((page) => page.path)).toEqual([
      "/dashboard",
      "/products",
      "/inventory",
      "/orders",
      "/customers",
      "/settings",
    ]);
  });

  it("exposes authenticated commerce routes including product administration and bridge events", () => {
    const plugin = createPlugin({});

    expect(Object.keys(plugin.routes)).toEqual(expect.arrayContaining([
      "catalog",
      "products",
      "products/detail",
      "products/save",
      "products/archive",
      "cart",
      "checkout",
      "order",
      "orders",
      "bridge/events",
    ]));
    expect(plugin.routes["bridge/events"]?.public).toBe(true);
    expect(plugin.routes.products?.public).toBe(false);
    expect(plugin.routes.order?.public).toBe(true);
    expect(plugin.hooks?.cron).toBeDefined();
    expect(plugin.hooks?.["plugin:install"]).toBeDefined();
    expect(plugin.hooks?.["plugin:activate"]).toBeDefined();
  });
});
