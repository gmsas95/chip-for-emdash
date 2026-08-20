import {
  CONTRACT_ERROR_CODES,
  CommerceContractError,
  parseMoney,
} from "./money.js";
import { parseMetadata, parseOrderSnapshot } from "./domain.js";
import type { OrderSnapshot } from "./domain.js";
import type { Money } from "./money.js";

export type PaymentOperation = "authorize" | "capture" | "charge" | "refund" | "void";

export interface PaymentMethodReference {
  type: string;
  /** Opaque Commerce reference only; never a provider credential or secret. */
  opaqueReference?: string;
}

export interface PaymentCommand {
  operation: PaymentOperation;
  order: OrderSnapshot;
  amount?: Money;
  paymentMethod?: PaymentMethodReference;
  paymentReference?: string;
  metadata?: Record<string, string>;
}

const PAYMENT_OPERATIONS: ReadonlySet<string> = new Set([
  "authorize",
  "capture",
  "charge",
  "refund",
  "void",
]);

function isPaymentOperation(input: unknown): input is PaymentOperation {
  return typeof input === "string" && PAYMENT_OPERATIONS.has(input);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function invalidPayload(message: string): never {
  throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_PAYLOAD, message);
}

export function parsePaymentCommand(input: unknown): PaymentCommand {
  if (!isRecord(input) || !isPaymentOperation(input.operation)) {
    return invalidPayload("Invalid payment operation");
  }

  const paymentMethod = input.paymentMethod;
  let parsedPaymentMethod: PaymentMethodReference | undefined;
  if (paymentMethod !== undefined) {
    if (!isRecord(paymentMethod) || typeof paymentMethod.type !== "string" || paymentMethod.type.length === 0) {
      return invalidPayload("Invalid payment method reference");
    }
    if ("token" in paymentMethod) {
      return invalidPayload("Provider payment tokens are not allowed");
    }
    if (paymentMethod.opaqueReference !== undefined &&
      (typeof paymentMethod.opaqueReference !== "string" || paymentMethod.opaqueReference.length === 0)) {
      return invalidPayload("Invalid opaque payment method reference");
    }
    const opaqueReference = paymentMethod.opaqueReference;
    parsedPaymentMethod = {
      type: paymentMethod.type,
      opaqueReference: typeof opaqueReference === "string" ? opaqueReference : undefined,
    };
  }

  const paymentReference = input.paymentReference;
  if (paymentReference !== undefined &&
    (typeof paymentReference !== "string" || paymentReference.length === 0)) {
    return invalidPayload("Invalid paymentReference");
  }

  return {
    operation: input.operation,
    order: parseOrderSnapshot(input.order),
    amount: input.amount === undefined ? undefined : parseMoney(input.amount),
    paymentMethod: parsedPaymentMethod,
    paymentReference: typeof paymentReference === "string" ? paymentReference : undefined,
    metadata: input.metadata === undefined ? undefined : parseMetadata(input.metadata),
  };
}
