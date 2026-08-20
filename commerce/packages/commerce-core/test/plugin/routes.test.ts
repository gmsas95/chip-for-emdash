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

  it("exposes authenticated commerce routes including bridge events", () => {
    const plugin = createPlugin({});

    expect(Object.keys(plugin.routes)).toEqual(expect.arrayContaining([
      "catalog",
      "cart",
      "checkout",
      "orders",
      "bridge/events",
    ]));
    expect(plugin.routes["bridge/events"]?.public).toBe(true);
  });
});
