import { describe, expect, it } from "vitest";
import { confirmReservation, expireReservation, releaseReservation, reserveInventory } from "../../src/domain/inventory.js";

describe("inventory reservations", () => {
  it("reserves only available inventory", () => {
    expect(reserveInventory({ available: 2, requested: 3 })).toEqual({ ok: false, code: "INSUFFICIENT_STOCK" });
  });

  it("makes reservation lifecycle commands idempotent", () => {
    const result = reserveInventory({
      reservationId: "r-1",
      sku: "tea-1",
      available: 3,
      requested: 2,
      idempotencyKey: "key-1",
      expiresAt: "2026-08-20T01:00:00.000Z",
    });
    if (!result.ok) {
      throw new Error("Expected reservation to succeed");
    }

    const confirmed = confirmReservation(result.reservation);
    expect(confirmReservation(confirmed)).toEqual(confirmed);
    expect(releaseReservation(confirmed).status).toBe("released");
    expect(releaseReservation(releaseReservation(confirmed))).toEqual(releaseReservation(confirmed));
  });

  it("expires active reservations at their deadline", () => {
    const result = reserveInventory({
      reservationId: "r-2",
      available: 1,
      requested: 1,
      expiresAt: "2026-08-20T01:00:00.000Z",
    });
    if (!result.ok) {
      throw new Error("Expected reservation to succeed");
    }

    expect(expireReservation(result.reservation, "2026-08-20T01:00:00.000Z").status).toBe("expired");
  });
});
