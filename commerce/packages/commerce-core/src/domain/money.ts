import {
  CONTRACT_ERROR_CODES,
  CommerceContractError,
  isISO4217CurrencyCode,
} from "@emdash-commerce/contracts";

export type { Money } from "@emdash-commerce/contracts";

export function isSafeNonNegativeMinorUnit(input: unknown): input is number {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0;
}

export function isSafeQuantity(input: unknown): input is number {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 1;
}

export function assertSafeNonNegativeMinorUnit(input: unknown, field: string): asserts input is number {
  if (typeof input !== "number" || !Number.isSafeInteger(input)) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_AMOUNT, `Invalid ${field}`);
  }
  if (input < 0) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.NEGATIVE_AMOUNT, `Negative ${field}`);
  }
}

export function assertSafeQuantity(input: unknown, field: string): asserts input is number {
  if (!isSafeQuantity(input)) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_INPUT, `Invalid ${field}`);
  }
}

export function assertCurrency(input: unknown, field: string): asserts input is string {
  if (!isISO4217CurrencyCode(input)) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_CURRENCY, `Invalid ${field}`);
  }
}

export function checkedAdd(left: number, right: number, field: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_AMOUNT, `Invalid ${field}`);
  }
  return result;
}

export function checkedSubtract(left: number, right: number, field: string): number {
  const result = left - right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_AMOUNT, `Invalid ${field}`);
  }
  return result;
}

export function checkedMultiply(left: number, right: number, field: string): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_AMOUNT, `Invalid ${field}`);
  }
  return result;
}
