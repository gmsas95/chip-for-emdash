import { describe, expect, it } from "vitest";
import { createProviderRegistry } from "../../src/bridge/provider-registry.js";

describe("provider registry", () => {
  it("validates initial connections and capabilities", () => {
    expect(() => createProviderRegistry([{ pluginId: "", basePath: "/", eventPath: "/events", capabilities: [], sharedSecret: "" }])).toThrow("Invalid provider connection");

    const registry = createProviderRegistry();
    registry.register({ pluginId: "payment-provider", basePath: "/payment", eventPath: "/payment/events", capabilities: ["payment.create"], sharedSecret: "secret" });

    expect(registry.require("payment-provider", "payment.create").pluginId).toBe("payment-provider");
  });
});
