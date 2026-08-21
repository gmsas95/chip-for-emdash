import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION } from "@gmsas95/emdash-commerce-contracts";

describe("Commerce workspace", () => {
  it("exports the initial contract version", () => {
    expect(CONTRACT_VERSION).toBe(1);
  });
});
