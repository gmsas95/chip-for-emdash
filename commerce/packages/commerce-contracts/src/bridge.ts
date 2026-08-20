import { CONTRACT_VERSION } from "./version.js";
import {
  CONTRACT_ERROR_CODES,
  CommerceContractError,
} from "./money.js";

export interface BridgeRequest<T> {
  contract: string;
  version: 1;
  requestId: string;
  idempotencyKey: string;
  sentAt: string;
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

export interface BridgeRequestValidationOptions {
  now?: string | Date;
  maxAgeMs?: number;
  seenRequestIds?: ReadonlySet<string>;
  seenIdempotencyKeys?: ReadonlySet<string>;
}

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function parseNow(value: string | Date | undefined): number {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    if (!Number.isNaN(timestamp)) {
      return timestamp;
    }
  }

  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      return timestamp;
    }
  }

  return Date.now();
}

export function parseBridgeRequest<T = unknown>(
  input: unknown,
  options: BridgeRequestValidationOptions = {},
): BridgeRequest<T> {
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

  const sentAt = parseTimestamp(input.sentAt);
  if (sentAt === undefined) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_REQUEST, "Invalid sentAt");
  }

  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = parseNow(options.now);
  if (maxAgeMs < 0 || now - sentAt > maxAgeMs) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.STALE_REQUEST, "Stale bridge request");
  }

  if (
    options.seenRequestIds?.has(input.requestId) ||
    options.seenIdempotencyKeys?.has(input.idempotencyKey)
  ) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.DUPLICATE_REQUEST, "Duplicate bridge request");
  }

  return {
    contract: input.contract,
    version: CONTRACT_VERSION,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    sentAt: input.sentAt as string,
    payload: input.payload as T,
  };
}
