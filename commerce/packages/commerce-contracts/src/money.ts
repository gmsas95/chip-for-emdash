export const CONTRACT_ERROR_CODES = {
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_AMOUNT: "INVALID_AMOUNT",
  NEGATIVE_AMOUNT: "NEGATIVE_AMOUNT",
  INVALID_CURRENCY: "INVALID_CURRENCY",
  INVALID_REQUEST: "INVALID_REQUEST",
  INVALID_AUTHENTICATION: "INVALID_AUTHENTICATION",
  UNSUPPORTED_AUTH_VERSION: "UNSUPPORTED_AUTH_VERSION",
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
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

// ISO 4217 active currency and fund codes used at the shared Commerce boundary.
export const ISO_4217_CURRENCY_CODES = [
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN",
  "BAM", "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BOV", "BRL", "BSD", "BTN", "BWP", "BYN", "BZD",
  "CAD", "CDF", "CHE", "CHF", "CHW", "CLF", "CLP", "CNY", "COP", "COU", "CRC", "CUP", "CVE", "CZK",
  "DJF", "DKK", "DOP", "DZD",
  "EGP", "ERN", "ETB", "EUR",
  "FJD", "FKP",
  "GBP", "GEL", "GHS", "GIP", "GMD", "GNF", "GTQ", "GYD",
  "HKD", "HNL", "HTG", "HUF",
  "IDR", "ILS", "INR", "IQD", "IRR", "ISK",
  "JMD", "JOD", "JPY",
  "KES", "KGS", "KHR", "KMF", "KPW", "KRW", "KWD", "KYD", "KZT",
  "LAK", "LBP", "LKR", "LRD", "LSL", "LYD",
  "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR", "MWK", "MXN", "MXV", "MYR", "MZN",
  "NAD", "NGN", "NIO", "NOK", "NPR", "NZD",
  "OMR",
  "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG",
  "QAR",
  "RON", "RSD", "RUB", "RWF",
  "SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SHP", "SLE", "SOS", "SRD", "SSP", "STN", "SVC", "SYP", "SZL",
  "THB", "TJS", "TMT", "TND", "TOP", "TRY", "TTD", "TWD", "TZS",
  "UAH", "UGX", "USD", "USN", "UYI", "UYU", "UYW", "UZS",
  "VED", "VES", "VND", "VUV",
  "WST",
  "XAF", "XAG", "XAU", "XBA", "XBB", "XBC", "XBD", "XCD", "XOF", "XPD", "XPF", "XPT", "XSU", "XTS", "XUA", "XXX",
  "YER",
  "ZAR", "ZMW", "ZWL",
] as const;

const ISO_4217_CURRENCY_CODE_SET: ReadonlySet<string> = new Set(ISO_4217_CURRENCY_CODES);

export function isISO4217CurrencyCode(input: unknown): input is string {
  return typeof input === "string" && ISO_4217_CURRENCY_CODE_SET.has(input);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

export function parseMoney(input: unknown): Money {
  if (!isRecord(input)) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_INPUT, "Money must be an object");
  }

  const amountMinor = input.amountMinor;
  if (typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor)) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_AMOUNT, "Invalid amountMinor");
  }
  if (amountMinor < 0) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.NEGATIVE_AMOUNT, "Negative amountMinor");
  }

  const currency = input.currency;
  if (!isISO4217CurrencyCode(currency)) {
    throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_CURRENCY, "Invalid currency");
  }

  return { amountMinor, currency };
}
