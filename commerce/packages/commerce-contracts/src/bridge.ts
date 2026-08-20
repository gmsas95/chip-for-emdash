import { CONTRACT_VERSION } from "./version.js";
import {
  CONTRACT_ERROR_CODES,
  CommerceContractError,
} from "./money.js";
import { parseLogisticsCommand } from "./logistics.js";
import { parsePaymentCommand } from "./payment.js";

export const BRIDGE_AUTH_VERSION = 1 as const;

export interface BridgeAuthMetadata {
  version: 1;
  keyId: string;
  timestamp: string;
  signature: string;
}

export type BridgeAuth = BridgeAuthMetadata;

export interface BridgeRequest<T> {
  contract: string;
  version: 1;
  requestId: string;
  idempotencyKey: string;
  sentAt: string;
  auth: BridgeAuthMetadata;
  payload: T;
}

export interface BridgeError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface BridgeResponse<T> {
  requestId: string;
  ok: boolean;
  data?: T;
  error?: BridgeError;
}

export interface CommerceEvent<T> {
  eventId: string;
  event: string;
  version: 1;
  occurredAt: string;
  correlationId: string;
  deliveryId: string;
  payload: T;
}

export interface BridgeSigningEnvelope<T> {
  contract: string;
  version: 1;
  requestId: string;
  idempotencyKey: string;
  sentAt: string;
  auth: {
    version: 1;
    keyId: string;
    timestamp: string;
  };
  payload: T;
}

export type BridgePayloadParser<T> = (input: unknown) => T;

export interface BridgeRequestValidationOptions<T = unknown> {
  now?: string | Date;
  maxAgeMs?: number;
  seenRequestIds?: ReadonlySet<string>;
  seenIdempotencyKeys?: ReadonlySet<string>;
  payloadParser?: BridgePayloadParser<T>;
}

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

const BRIDGE_PAYLOAD_SCHEMAS: Readonly<Record<string, BridgePayloadParser<unknown>>> = {
  "commerce.payment.create": parsePaymentCommand,
  "commerce.logistics.create": parseLogisticsCommand,
};

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function parseNow(value: string | Date | undefined): number | undefined {
  if (value === undefined) {
    return Date.now();
  }

  if (value instanceof Date) {
    const timestamp = value.getTime();
    if (!Number.isNaN(timestamp)) {
      return timestamp;
    }
    return undefined;
  }

  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      return timestamp;
    }
  }

  return undefined;
}

function canonicalize(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(canonicalize);
  }
  if (isRecord(input)) {
    return Object.keys(input)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = canonicalize(input[key]);
        return result;
      }, {});
  }
  return input;
}

/**
 * Returns the canonical JSON string whose UTF-8 bytes Task 6 will HMAC.
 * The envelope includes every request field and auth identity/timestamp,
 * while deliberately excluding auth.signature to avoid circular signing data.
 */
export function getBridgeSigningData<T>(request: BridgeRequest<T>): string {
  const envelope: BridgeSigningEnvelope<T> = {
    contract: request.contract,
    version: request.version,
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    sentAt: request.sentAt,
    auth: {
      version: request.auth.version,
      keyId: request.auth.keyId,
      timestamp: request.auth.timestamp,
    },
    payload: request.payload,
  };
  return JSON.stringify(canonicalize(envelope));
}

export function parseBridgeRequest<T = unknown>(
  input: unknown,
  options?: BridgeRequestValidationOptions<T>,
): BridgeRequest<T>;
export function parseBridgeRequest(
  input: unknown,
  options: BridgeRequestValidationOptions<unknown> = {},
): BridgeRequest<unknown> {
  if (!isRecord(input)) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_INPUT, "Bridge request must be an object");
  }

  if (input.version !== CONTRACT_VERSION) {
    throw new CommerceContractError(
      CONTRACT_ERROR_CODES.UNSUPPORTED_CONTRACT_VERSION,
      "Unsupported contract version",
    );
  }

  if (typeof input.contract !== "string" || input.contract.length === 0) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_REQUEST, "Invalid contract name");
  }
  if (typeof input.requestId !== "string" || input.requestId.length === 0) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_REQUEST, "Invalid requestId");
  }
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length === 0) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_REQUEST, "Invalid idempotencyKey");
  }
  if (!("payload" in input)) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_REQUEST, "Missing payload");
  }

  const sentAtValue = input.sentAt;
  const sentAt = parseTimestamp(sentAtValue);
  if (typeof sentAtValue !== "string" || sentAt === undefined) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_REQUEST, "Invalid sentAt");
  }

  const auth = input.auth;
  if (!isRecord(auth)) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_AUTHENTICATION, "Missing authentication metadata");
  }
  if (auth.version !== BRIDGE_AUTH_VERSION) {
    throw new CommerceContractError(
      CONTRACT_ERROR_CODES.UNSUPPORTED_AUTH_VERSION,
      "Unsupported authentication version",
    );
  }
  if (typeof auth.keyId !== "string" || auth.keyId.length === 0 ||
    typeof auth.timestamp !== "string" || auth.timestamp.length === 0 ||
    typeof auth.signature !== "string" || auth.signature.length === 0 ||
    auth.timestamp !== sentAtValue || parseTimestamp(auth.timestamp) === undefined) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_AUTHENTICATION, "Invalid authentication metadata");
  }

  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_REQUEST, "Invalid maxAgeMs");
  }
  const now = parseNow(options.now);
  if (now === undefined) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_REQUEST, "Invalid validation time");
  }
  const age = now - sentAt;
  if (age > maxAgeMs || age < -maxAgeMs) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.STALE_REQUEST, "Stale bridge request");
  }

  if (
    options.seenRequestIds?.has(input.requestId) ||
    options.seenIdempotencyKeys?.has(input.idempotencyKey)
  ) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.DUPLICATE_REQUEST, "Duplicate bridge request");
  }

  const payloadSchema = BRIDGE_PAYLOAD_SCHEMAS[input.contract];
  if (payloadSchema === undefined && options.payloadParser === undefined) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_PAYLOAD, "A payload parser is required");
  }

  let payload: unknown;
  try {
    // Known Commerce contracts always use their own schema; custom parsers are for future contracts.
    payload = payloadSchema === undefined
      ? options.payloadParser!(input.payload)
      : payloadSchema(input.payload);
  } catch (error) {
    if (error instanceof CommerceContractError) {
      throw error;
    }
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_PAYLOAD, "Invalid bridge payload");
  }

  return {
    contract: input.contract,
    version: CONTRACT_VERSION,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    sentAt: sentAtValue,
    auth: {
      version: BRIDGE_AUTH_VERSION,
      keyId: auth.keyId,
      timestamp: auth.timestamp,
      signature: auth.signature,
    },
    payload,
  };
}
