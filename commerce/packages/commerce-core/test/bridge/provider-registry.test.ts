import { describe, expect, it } from "vitest";
import { createProviderRegistry } from "../../src/bridge/provider-registry.js";

describe("provider registry", () => {
  it("validates initial connections and capabilities", () => {
    expect(() => createProviderRegistry([{ pluginId: "", basePath: "/", eventPath: "/events", capabilities: [], sharedSecret: "" }])).toThrow("Invalid provider connection");

    const registry = createProviderRegistry();
    registry.register({ pluginId: "chip", basePath: "/chip", eventPath: "/chip/events", capabilities: ["payment.create"], sharedSecret: "secret" });

    expect(registry.require("chip", "payment.create").pluginId).toBe("chip");
  });
});
