import { describe, expect, it } from "vitest";
import {
  CONTRACT_ERROR_CODES,
  CommerceContractError,
  parseBridgeRequest,
  parseMoney,
} from "../src/index.js";

const validBridgeRequest = {
  contract: "commerce.payment.create",
  version: 1,
  requestId: "request-1",
  idempotencyKey: "idempotency-1",
  sentAt: "2026-08-20T12:00:00.000Z",
  payload: { orderId: "order-1" },
};

function expectContractError(action: () => unknown, code: string) {
  try {
    action();
    throw new Error("Expected a contract error");
  } catch (error) {
    expect(error).toBeInstanceOf(CommerceContractError);
    expect((error as CommerceContractError).code).toBe(code);
  }
}

describe("Commerce contracts", () => {
  it("accepts positive minor-unit money with a three-letter currency", () => {
    expect(parseMoney({ amountMinor: 5000, currency: "MYR" })).toEqual({ amountMinor: 5000, currency: "MYR" });
  });

  it("rejects a bridge request with the wrong contract version", () => {
    expect(() => parseBridgeRequest({ contract: "commerce.payment.create", version: 2 })).toThrow("Unsupported contract version");
  });

  it("rejects a non-integer amount with a stable error code", () => {
    expectContractError(
      () => parseMoney({ amountMinor: 10.5, currency: "MYR" }),
      CONTRACT_ERROR_CODES.INVALID_AMOUNT,
    );
  });

  it("rejects a negative amount with a stable error code", () => {
    expectContractError(
      () => parseMoney({ amountMinor: -1, currency: "MYR" }),
      CONTRACT_ERROR_CODES.NEGATIVE_AMOUNT,
    );
  });

  it("rejects a zero-length currency with a stable error code", () => {
    expectContractError(
      () => parseMoney({ amountMinor: 1, currency: "" }),
      CONTRACT_ERROR_CODES.INVALID_CURRENCY,
    );
  });

  it("rejects a stale bridge request with a stable error code", () => {
    expectContractError(
      () =>
        parseBridgeRequest(validBridgeRequest, {
          now: "2026-08-20T12:10:00.000Z",
          maxAgeMs: 60_000,
        }),
      CONTRACT_ERROR_CODES.STALE_REQUEST,
    );
  });

  it("rejects a duplicate bridge request with a stable error code", () => {
    expectContractError(
      () => parseBridgeRequest(validBridgeRequest, { seenRequestIds: new Set(["request-1"]) }),
      CONTRACT_ERROR_CODES.DUPLICATE_REQUEST,
    );
  });
});
