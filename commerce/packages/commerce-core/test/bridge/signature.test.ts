import { describe, expect, it } from "vitest";
import { createMemoryReplayStore, signBridgePayload, verifyBridgeSignature } from "../../src/bridge/signature.js";

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

  it("rejects replayed signed payloads when a replay store is provided", async () => {
    const timestamp = String(Date.now());
    const signature = await signBridgePayload("secret", timestamp, "{}");
    const replayStore = createMemoryReplayStore();

    await verifyBridgeSignature("secret", timestamp, "{}", signature, Date.now(), replayStore);
    await expect(verifyBridgeSignature("secret", timestamp, "{}", signature, Date.now(), replayStore))
      .rejects.toThrow("Bridge request replayed");
  });
});
