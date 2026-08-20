import { CONTRACT_ERROR_CODES, CommerceContractError } from "./money.js";
import { parseAddressSnapshot, parseMetadata, parseOrderSnapshot } from "./domain.js";
import type { AddressSnapshot, OrderSnapshot } from "./domain.js";

export type LogisticsOperation = "quote" | "create" | "cancel" | "track";

export interface ShipmentRequest {
  recipient?: string;
  address?: AddressSnapshot;
  serviceCode?: string;
  packageCount?: number;
  weightGrams?: number;
}

export interface LogisticsCommand {
  operation: LogisticsOperation;
  order: OrderSnapshot;
  shipment?: ShipmentRequest;
  trackingNumber?: string;
  metadata?: Record<string, string>;
}

const LOGISTICS_OPERATIONS: ReadonlySet<string> = new Set(["quote", "create", "cancel", "track"]);

function isLogisticsOperation(input: unknown): input is LogisticsOperation {
  return typeof input === "string" && LOGISTICS_OPERATIONS.has(input);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function invalidPayload(message: string): never {
  throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_PAYLOAD, message);
}

function parseOptionalNonNegativeInteger(input: unknown, field: string): number | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 0) {
    return invalidPayload(`Invalid shipment ${field}`);
  }
  return input;
}

function parseShipmentRequest(input: unknown): ShipmentRequest {
  if (!isRecord(input)) {
    return invalidPayload("Invalid shipment");
  }
  const packageCount = parseOptionalNonNegativeInteger(input.packageCount, "packageCount");
  const weightGrams = parseOptionalNonNegativeInteger(input.weightGrams, "weightGrams");
  if (input.recipient !== undefined &&
    (typeof input.recipient !== "string" || input.recipient.length === 0)) {
    return invalidPayload("Invalid shipment recipient");
  }
  if (input.serviceCode !== undefined &&
    (typeof input.serviceCode !== "string" || input.serviceCode.length === 0)) {
    return invalidPayload("Invalid shipment serviceCode");
  }
  const recipient = input.recipient;
  const serviceCode = input.serviceCode;
  return {
    recipient: typeof recipient === "string" ? recipient : undefined,
    address: input.address === undefined ? undefined : parseAddressSnapshot(input.address),
    serviceCode: typeof serviceCode === "string" ? serviceCode : undefined,
    packageCount,
    weightGrams,
  };
}

export function parseLogisticsCommand(input: unknown): LogisticsCommand {
  if (!isRecord(input) || !isLogisticsOperation(input.operation)) {
    return invalidPayload("Invalid logistics operation");
  }
  const trackingNumber = input.trackingNumber;
  if (trackingNumber !== undefined &&
    (typeof trackingNumber !== "string" || trackingNumber.length === 0)) {
    return invalidPayload("Invalid trackingNumber");
  }
  return {
    operation: input.operation,
    order: parseOrderSnapshot(input.order),
    shipment: input.shipment === undefined ? undefined : parseShipmentRequest(input.shipment),
    trackingNumber: typeof trackingNumber === "string" ? trackingNumber : undefined,
    metadata: input.metadata === undefined ? undefined : parseMetadata(input.metadata),
  };
}
