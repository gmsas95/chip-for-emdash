import { describe, expect, it } from "vitest";
import { signBridgePayload, verifyBridgeSignature } from "../../src/bridge/signature.js";

describe("bridge signatures", () => {
  it("signs and verifies timestamped payloads", async () => {
    const timestamp = String(Date.now());
    const signature = await signBridgePayload("secret", timestamp, "{}");

    await expect(verifyBridgeSignature("secret", timestamp, "{}", signature)).resolves.toBeUndefined();
  });

  it("rejects a bridge payload outside the replay window", async () => {
    await expect(verifyBridgeSignature("secret", String(Date.now() - 900_000), "{}", "bad"))
      .rejects.toThrow("Bridge timestamp expired");
  });
});
