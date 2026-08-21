import { describe, expect, it } from "vitest";
import { getChipAdminLinks } from "../../src/admin/provider-links.js";

describe("Commerce CHIP admin links", () => {
  it("points operators to the provider-owned settings and payment pages", () => {
    expect(getChipAdminLinks()).toEqual({
      settingsPath: "/_emdash/admin/plugins/chip-for-emdash/settings",
      paymentsPath: "/_emdash/admin/plugins/chip-for-emdash/payments",
    });
  });
});
