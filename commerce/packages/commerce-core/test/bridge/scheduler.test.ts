import { describe, expect, it } from "vitest";
import { createMemoryOutbox } from "../../src/bridge/outbox.js";
import { runBridgeMaintenance } from "../../src/bridge/scheduler.js";

describe("runBridgeMaintenance", () => {
  it("retries pending bridge deliveries", async () => {
    const outbox = createMemoryOutbox();
    await outbox.record({ deliveryId: "d-3", event: "shipment.created", nextAttemptAt: "2026-08-20T00:00:00.000Z" });

    const summary = await runBridgeMaintenance({
      outbox,
      deliver: async () => ({ ok: true, retryable: false }),
    }, "2026-08-20T00:01:00.000Z");

    expect(summary).toMatchObject({ attempted: 1, delivered: 1 });
  });
});
