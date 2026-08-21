import { describe, expect, it } from "vitest";
import { formatMinorAmount } from "../../src/admin/shared.js";

describe("Commerce admin formatting", () => {
  it("formats integer minor units with the requested currency", () => {
    expect(formatMinorAmount(12345, "MYR")).toBe("RM 123.45");
  });

  it("renders a safe fallback for invalid amounts", () => {
    expect(formatMinorAmount(-1, "MYR")).toBe("RM 0.00");
  });
});
