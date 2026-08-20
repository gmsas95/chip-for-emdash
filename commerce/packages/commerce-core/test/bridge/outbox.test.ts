import { describe, expect, it } from "vitest";
import { createMemoryOutbox, retryPendingDeliveries } from "../../src/bridge/outbox.js";

describe("Commerce bridge outbox", () => {
  it("does not deliver the same event twice", async () => {
    const outbox = createMemoryOutbox();
    await outbox.record({ deliveryId: "d-1", event: "payment.paid", idempotencyKey: "idem-1" });
    await outbox.record({ deliveryId: "d-1", event: "payment.paid", idempotencyKey: "idem-1" });

    expect(await outbox.count()).toBe(1);
  });

  it("retries retryable deliveries with bounded attempts", async () => {
    const outbox = createMemoryOutbox();
    await outbox.record({ deliveryId: "d-2", event: "payment.paid", idempotencyKey: "idem-2", nextAttemptAt: "2026-08-20T00:00:00.000Z" });

    const summary = await retryPendingDeliveries(outbox, async () => ({ ok: false, retryable: true, error: "network" }), "2026-08-20T00:01:00.000Z");

    expect(summary).toMatchObject({ attempted: 1, retryable: 1 });
    expect((await outbox.get("d-2"))?.attempts).toBe(1);
  });
});
