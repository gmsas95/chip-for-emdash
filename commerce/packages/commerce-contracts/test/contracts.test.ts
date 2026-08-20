import { describe, expect, it } from "vitest";
import {
  CONTRACT_ERROR_CODES,
  CommerceContractError,
  getBridgeSigningData,
  parseBridgeRequest,
  parseLogisticsCommand,
  parseMoney,
  parsePaymentCommand,
} from "../src/index.js";

const NOW = "2026-08-20T12:00:00.000Z";

const validOrder = {
  orderId: "order-1",
  currency: "MYR",
  items: [
    {
      lineId: "line-1",
      name: "Widget",
      quantity: 1,
      unitPrice: { amountMinor: 5000, currency: "MYR" },
      total: { amountMinor: 5000, currency: "MYR" },
    },
  ],
  subtotal: { amountMinor: 5000, currency: "MYR" },
  total: { amountMinor: 5000, currency: "MYR" },
};

const validPaymentPayload = {
  operation: "charge",
  order: validOrder,
  amount: { amountMinor: 5000, currency: "MYR" },
};

const validBridgeRequest = {
  contract: "commerce.payment.create",
  version: 1 as const,
  requestId: "request-1",
  idempotencyKey: "idempotency-1",
  sentAt: NOW,
  auth: {
    version: 1 as const,
    keyId: "commerce-key-1",
    timestamp: NOW,
    signature: "signature-not-in-signed-data",
  },
  payload: validPaymentPayload,
};

function expectContractError(action: () => unknown, code: string) {
  let error: unknown;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(CommerceContractError);
  expect((error as CommerceContractError).code).toBe(code);
}

describe("Commerce contracts", () => {
  it("accepts positive minor-unit money with a three-letter currency", () => {
    expect(parseMoney({ amountMinor: 5000, currency: "MYR" })).toEqual({ amountMinor: 5000, currency: "MYR" });
  });

  it("rejects a bridge request with the wrong contract version", () => {
    expect(() => parseBridgeRequest({ contract: "commerce.payment.create", version: 2 })).toThrow("Unsupported contract version");
    expectContractError(
      () => parseBridgeRequest({ contract: "commerce.payment.create", version: 2 }),
      CONTRACT_ERROR_CODES.UNSUPPORTED_CONTRACT_VERSION,
    );
  });

  it("accepts zero-valued money for free orders", () => {
    expect(parseMoney({ amountMinor: 0, currency: "MYR" })).toEqual({ amountMinor: 0, currency: "MYR" });
  });

  it("accepts the safe integer upper boundary and rejects unsafe amounts", () => {
    expect(parseMoney({ amountMinor: Number.MAX_SAFE_INTEGER, currency: "MYR" })).toEqual({
      amountMinor: Number.MAX_SAFE_INTEGER,
      currency: "MYR",
    });
    expectContractError(
      () => parseMoney({ amountMinor: Number.MAX_SAFE_INTEGER + 1, currency: "MYR" }),
      CONTRACT_ERROR_CODES.INVALID_AMOUNT,
    );
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

  it("rejects an unassigned currency code with a stable error code", () => {
    expectContractError(
      () => parseMoney({ amountMinor: 1, currency: "ZZZ" }),
      CONTRACT_ERROR_CODES.INVALID_CURRENCY,
    );
  });

  it("rejects an empty currency code with a stable error code", () => {
    expectContractError(
      () => parseMoney({ amountMinor: 1, currency: "" }),
      CONTRACT_ERROR_CODES.INVALID_CURRENCY,
    );
  });

  it("rejects a bridge request without authentication metadata", () => {
    const { auth: _auth, ...requestWithoutAuth } = validBridgeRequest;
    expectContractError(
      () => parseBridgeRequest(requestWithoutAuth, { now: NOW, payloadParser: parsePaymentCommand }),
      CONTRACT_ERROR_CODES.INVALID_AUTHENTICATION,
    );
  });

  it("defines signing data without the circular signature field", () => {
    const signingData = JSON.parse(getBridgeSigningData(validBridgeRequest)) as Record<string, unknown>;
    expect(signingData).toMatchObject({
      contract: validBridgeRequest.contract,
      version: 1,
      requestId: validBridgeRequest.requestId,
      idempotencyKey: validBridgeRequest.idempotencyKey,
      sentAt: NOW,
      payload: validPaymentPayload,
      auth: {
        version: 1,
        keyId: "commerce-key-1",
        timestamp: NOW,
      },
    });
    expect(signingData.auth).not.toHaveProperty("signature");
  });

  it("rejects a stale past bridge request with a stable error code", () => {
    expectContractError(
      () =>
        parseBridgeRequest(
          { ...validBridgeRequest, sentAt: "2026-08-20T11:54:59.000Z", auth: { ...validBridgeRequest.auth, timestamp: "2026-08-20T11:54:59.000Z" } },
          {
            now: NOW,
            payloadParser: parsePaymentCommand,
          },
        ),
      CONTRACT_ERROR_CODES.STALE_REQUEST,
    );
  });

  it("rejects a future-dated bridge request with a stable error code", () => {
    expectContractError(
      () =>
        parseBridgeRequest(
          { ...validBridgeRequest, sentAt: "2026-08-20T12:05:01.000Z", auth: { ...validBridgeRequest.auth, timestamp: "2026-08-20T12:05:01.000Z" } },
          {
            now: NOW,
            payloadParser: parsePaymentCommand,
          },
        ),
      CONTRACT_ERROR_CODES.STALE_REQUEST,
    );
  });

  it("rejects a duplicate bridge request with a stable error code", () => {
    expectContractError(
      () =>
        parseBridgeRequest(validBridgeRequest, {
          now: NOW,
          payloadParser: parsePaymentCommand,
          seenRequestIds: new Set(["request-1"]),
        }),
      CONTRACT_ERROR_CODES.DUPLICATE_REQUEST,
    );
  });

  it("requires a payload parser at the bridge boundary", () => {
    expectContractError(
      () => parseBridgeRequest(validBridgeRequest, { now: NOW }),
      CONTRACT_ERROR_CODES.INVALID_PAYLOAD,
    );
  });

  it("rejects malformed payment payloads at the bridge boundary", () => {
    expectContractError(
      () =>
        parseBridgeRequest(
          { ...validBridgeRequest, payload: { operation: "charge", order: "not-an-order" } },
          { now: NOW, payloadParser: parsePaymentCommand },
        ),
      CONTRACT_ERROR_CODES.INVALID_PAYLOAD,
    );
  });

  it("rejects provider payment tokens at the shared Commerce boundary", () => {
    expectContractError(
      () =>
        parseBridgeRequest(
          {
            ...validBridgeRequest,
            payload: {
              ...validPaymentPayload,
              paymentMethod: { type: "card", token: "provider-secret" },
            },
          },
          { now: NOW, payloadParser: parsePaymentCommand },
        ),
      CONTRACT_ERROR_CODES.INVALID_PAYLOAD,
    );
  });

  it("rejects malformed logistics payloads at the bridge boundary", () => {
    expectContractError(
      () =>
        parseBridgeRequest(
          { ...validBridgeRequest, contract: "commerce.logistics.create", payload: { operation: "create", order: null } },
          { now: NOW, payloadParser: parseLogisticsCommand },
        ),
      CONTRACT_ERROR_CODES.INVALID_PAYLOAD,
    );
  });

  it("rejects a stale bridge request with a stable error code", () => {
    expectContractError(
      () =>
        parseBridgeRequest(
          { ...validBridgeRequest, sentAt: "2026-08-20T11:58:59.000Z", auth: { ...validBridgeRequest.auth, timestamp: "2026-08-20T11:58:59.000Z" } },
          {
            now: NOW,
            payloadParser: parsePaymentCommand,
            maxAgeMs: 60_000,
          },
        ),
      CONTRACT_ERROR_CODES.STALE_REQUEST,
    );
  });
});
