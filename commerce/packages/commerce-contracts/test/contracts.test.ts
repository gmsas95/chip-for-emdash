import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CONTRACT_ERROR_CODES,
  CommerceContractError,
  getBridgeSigningData,
  parseBridgeRequest,
  parseMoney,
} from "../src/index.js";
import type {
  BuiltInBridgeRequest,
  LogisticsBridgeRequest,
  PaymentBridgeRequest,
  PaymentCommand,
} from "../src/index.js";

const NOW = "2026-08-20T12:00:00.000Z";

const validOrder = {
  orderId: "order-1",
  currency: "USD",
  items: [
    {
      lineId: "line-1",
      name: "Widget",
      quantity: 1,
      unitPrice: { amountMinor: 5000, currency: "USD" },
      total: { amountMinor: 5000, currency: "USD" },
    },
  ],
  subtotal: { amountMinor: 5000, currency: "USD" },
  total: { amountMinor: 5000, currency: "USD" },
};

const validPaymentPayload = {
  operation: "charge",
  order: validOrder,
  amount: { amountMinor: 5000, currency: "USD" },
};

const validLogisticsPayload = {
  operation: "create",
  order: validOrder,
};

const validBridgeRequest = {
  contract: "commerce.payment.create" as const,
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
    expect(parseMoney({ amountMinor: 5000, currency: "USD" })).toEqual({ amountMinor: 5000, currency: "USD" });
  });

  it("rejects a bridge request with the wrong contract version", () => {
    expect(() => parseBridgeRequest({ contract: "commerce.payment.create", version: 2 })).toThrow("Unsupported contract version");
    expectContractError(
      () => parseBridgeRequest({ contract: "commerce.payment.create", version: 2 }),
      CONTRACT_ERROR_CODES.UNSUPPORTED_CONTRACT_VERSION,
    );
  });

  it("accepts zero-valued money for free orders", () => {
    expect(parseMoney({ amountMinor: 0, currency: "USD" })).toEqual({ amountMinor: 0, currency: "USD" });
  });

  it("accepts the safe integer upper boundary and rejects unsafe amounts", () => {
    expect(parseMoney({ amountMinor: Number.MAX_SAFE_INTEGER, currency: "USD" })).toEqual({
      amountMinor: Number.MAX_SAFE_INTEGER,
      currency: "USD",
    });
    expectContractError(
      () => parseMoney({ amountMinor: Number.MAX_SAFE_INTEGER + 1, currency: "USD" }),
      CONTRACT_ERROR_CODES.INVALID_AMOUNT,
    );
  });

  it("rejects a non-integer amount with a stable error code", () => {
    expectContractError(
      () => parseMoney({ amountMinor: 10.5, currency: "USD" }),
      CONTRACT_ERROR_CODES.INVALID_AMOUNT,
    );
  });

  it("rejects a negative amount with a stable error code", () => {
    expectContractError(
      () => parseMoney({ amountMinor: -1, currency: "USD" }),
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
      () => parseBridgeRequest(requestWithoutAuth, { now: NOW }),
      CONTRACT_ERROR_CODES.INVALID_AUTHENTICATION,
    );
  });

  it("requires key identity, matching timestamp, and signature in bridge authentication metadata", () => {
    const invalidAuthRequests = [
      { ...validBridgeRequest.auth, keyId: "" },
      { ...validBridgeRequest.auth, timestamp: "2026-08-20T12:00:01.000Z" },
      { ...validBridgeRequest.auth, signature: "" },
    ];
    for (const auth of invalidAuthRequests) {
      expectContractError(
        () => parseBridgeRequest({ ...validBridgeRequest, auth }, { now: NOW }),
        CONTRACT_ERROR_CODES.INVALID_AUTHENTICATION,
      );
    }
  });

  it("rejects an unsupported bridge authentication version with a stable error code", () => {
    expectContractError(
      () => parseBridgeRequest({ ...validBridgeRequest, auth: { ...validBridgeRequest.auth, version: 2 } }, { now: NOW }),
      CONTRACT_ERROR_CODES.UNSUPPORTED_AUTH_VERSION,
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

  it("keeps built-in payloads tied to their discriminated contracts", () => {
    const parsedPayment = parseBridgeRequest(validBridgeRequest, { now: NOW });
    expect(parsedPayment.contract).toBe("commerce.payment.create");
    expect(parsedPayment.payload).toEqual(validPaymentPayload);
    expectTypeOf(parsedPayment).toEqualTypeOf<PaymentBridgeRequest>();
    expectTypeOf(parsedPayment.payload).toEqualTypeOf<PaymentCommand>();

    const parsedLogistics = parseBridgeRequest(
      { ...validBridgeRequest, contract: "commerce.logistics.create" as const, payload: validLogisticsPayload },
      { now: NOW },
    );
    expect(parsedLogistics.contract).toBe("commerce.logistics.create");
    expect(parsedLogistics.payload).toEqual(validLogisticsPayload);
    expectTypeOf(parsedLogistics).toEqualTypeOf<LogisticsBridgeRequest>();
  });

  it("does not expose validator overloads for widened or mixed contracts", () => {
    type WidenedContractRequest = Omit<typeof validBridgeRequest, "contract"> & { contract: string };
    type MixedContractRequest = Omit<typeof validBridgeRequest, "contract"> & {
      contract: "commerce.payment.create" | "commerce.custom";
    };
    const widenedRequest: WidenedContractRequest = validBridgeRequest;
    const mixedRequest: MixedContractRequest = validBridgeRequest;
    const unrelatedValidator = (_input: unknown) => ({ unrelated: true as const });

    // @ts-expect-error Built-in parsing does not accept a custom validator for widened contracts.
    parseBridgeRequest(widenedRequest, { now: NOW, payloadParser: unrelatedValidator });
    // @ts-expect-error Built-in parsing does not accept a custom validator for mixed contracts.
    parseBridgeRequest(mixedRequest, { now: NOW, payloadParser: unrelatedValidator });

    const parsedWidened = parseBridgeRequest(widenedRequest, { now: NOW });
    const parsedMixed = parseBridgeRequest(mixedRequest, { now: NOW });
    expectTypeOf(parsedWidened).toEqualTypeOf<BuiltInBridgeRequest>();
    expectTypeOf(parsedMixed).toEqualTypeOf<BuiltInBridgeRequest>();
  });

  it("rejects a stale past bridge request with a stable error code", () => {
    expectContractError(
      () =>
        parseBridgeRequest(
          { ...validBridgeRequest, sentAt: "2026-08-20T11:54:59.000Z", auth: { ...validBridgeRequest.auth, timestamp: "2026-08-20T11:54:59.000Z" } },
          {
            now: NOW,
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
          seenRequestIds: new Set(["request-1"]),
        }),
      CONTRACT_ERROR_CODES.DUPLICATE_REQUEST,
    );
  });

  it("rejects unsupported bridge contracts at the bridge boundary", () => {
    expectContractError(
      () => parseBridgeRequest({ ...validBridgeRequest, contract: "commerce.custom" }, { now: NOW }),
      CONTRACT_ERROR_CODES.INVALID_PAYLOAD,
    );
  });

  it("rejects malformed payment payloads at the bridge boundary", () => {
    expectContractError(
      () =>
        parseBridgeRequest(
          { ...validBridgeRequest, payload: { operation: "charge", order: "not-an-order" } },
          { now: NOW },
        ),
      CONTRACT_ERROR_CODES.INVALID_PAYLOAD,
    );
  });

  it("validates known payment contracts with the built-in schema", () => {
    expectContractError(
      () =>
        parseBridgeRequest(
          { ...validBridgeRequest, payload: { operation: "charge", order: "not-an-order" } },
          { now: NOW },
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
          { now: NOW },
        ),
      CONTRACT_ERROR_CODES.INVALID_PAYLOAD,
    );
  });

  it("rejects malformed logistics payloads at the bridge boundary", () => {
    expectContractError(
      () =>
        parseBridgeRequest(
          { ...validBridgeRequest, contract: "commerce.logistics.create", payload: { operation: "create", order: null } },
          { now: NOW },
        ),
      CONTRACT_ERROR_CODES.INVALID_PAYLOAD,
    );
  });

  it("rejects unknown bridge contracts", () => {
    expectContractError(
      () => parseBridgeRequest({ ...validBridgeRequest, contract: "commerce.custom" }, { now: NOW }),
      CONTRACT_ERROR_CODES.INVALID_PAYLOAD,
    );
  });

  it("rejects an invalid validation clock instead of using wall-clock time", () => {
    expectContractError(
      () => parseBridgeRequest(validBridgeRequest, { now: "not-a-timestamp" }),
      CONTRACT_ERROR_CODES.INVALID_REQUEST,
    );
  });

  it("rejects a stale bridge request with a stable error code", () => {
    expectContractError(
      () =>
        parseBridgeRequest(
          { ...validBridgeRequest, sentAt: "2026-08-20T11:58:59.000Z", auth: { ...validBridgeRequest.auth, timestamp: "2026-08-20T11:58:59.000Z" } },
          {
            now: NOW,
            maxAgeMs: 60_000,
          },
        ),
      CONTRACT_ERROR_CODES.STALE_REQUEST,
    );
  });
});
