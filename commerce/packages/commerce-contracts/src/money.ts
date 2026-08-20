export const CONTRACT_ERROR_CODES = {
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_AMOUNT: "INVALID_AMOUNT",
  NEGATIVE_AMOUNT: "NEGATIVE_AMOUNT",
  INVALID_CURRENCY: "INVALID_CURRENCY",
  INVALID_REQUEST: "INVALID_REQUEST",
  STALE_REQUEST: "STALE_REQUEST",
  DUPLICATE_REQUEST: "DUPLICATE_REQUEST",
  UNSUPPORTED_CONTRACT_VERSION: "UNSUPPORTED_CONTRACT_VERSION",
} as const;

export type ContractErrorCode = (typeof CONTRACT_ERROR_CODES)[keyof typeof CONTRACT_ERROR_CODES];

export class CommerceContractError extends Error {
  readonly code: ContractErrorCode;

  constructor(code: ContractErrorCode, message: string) {
    super(message);
    this.name = "CommerceContractError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface Money {
  amountMinor: number;
  currency: string;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

export function parseMoney(input: unknown): Money {
  if (!isRecord(input)) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_INPUT, "Money must be an object");
  }

  const amountMinor = input.amountMinor;
  if (typeof amountMinor !== "number" || !Number.isFinite(amountMinor) || !Number.isInteger(amountMinor)) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_AMOUNT, "Invalid amountMinor");
  }
  if (amountMinor < 0) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.NEGATIVE_AMOUNT, "Negative amountMinor");
  }
  if (amountMinor === 0) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_AMOUNT, "amountMinor must be positive");
  }

  const currency = input.currency;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_CURRENCY, "Invalid currency");
  }

  return { amountMinor, currency };
}
