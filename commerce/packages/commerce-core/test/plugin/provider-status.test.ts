import { describe, expect, it } from "vitest";
import { createPlugin } from "../../src/index.js";

describe("Commerce provider status", () => {
  it("reports CHIP configuration without exposing bridge secrets", async () => {
    const plugin = createPlugin({
      paymentBridges: {
        chip: {
          pluginId: "chip-for-emdash",
          basePath: "https://store.test/chip/create",
          eventPath: "https://store.test/commerce/events",
          capabilities: ["payment.create"],
          sharedSecret: "server-only-secret",
        },
      },
    });
    const response = await plugin.routes["provider-status"].handler({
      input: undefined,
      request: new Request("https://commerce.test", { method: "GET" }),
      storage: {},
      requestMeta: {},
    } as never) as { providers: Array<Record<string, unknown>> };

    expect(response.providers).toContainEqual({
      id: "chip",
      label: "CHIP",
      configured: true,
      settingsPath: "/_emdash/admin/plugins/chip-for-emdash/settings",
      paymentsPath: "/_emdash/admin/plugins/chip-for-emdash/payments",
    });
    expect(JSON.stringify(response)).not.toContain("server-only-secret");
  });
});
