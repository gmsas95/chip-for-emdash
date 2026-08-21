import { describe, expect, it } from "vitest";
import { signBridgePayload, verifyBridgePayload } from "../../src/bridge/signature.js";

describe("CHIP Commerce bridge signatures", () => {
  it("verifies a signature produced for the same timestamp and body", async () => {
    const body = JSON.stringify({ requestId: "r-1", payload: { amountMinor: 5000 } });
    const timestamp = String(Date.now());
    const signature = await signBridgePayload("shared-secret", timestamp, body);

    await expect(verifyBridgePayload("shared-secret", timestamp, body, signature, Date.now())).resolves.toBeUndefined();
  });

  it("rejects a stale signed request", async () => {
    await expect(verifyBridgePayload("shared-secret", String(Date.now() - 900_000), "{}", "bad", Date.now()))
      .rejects.toMatchObject({ code: "BRIDGE_REPLAY_WINDOW" });
  });
});
