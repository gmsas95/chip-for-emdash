import { isISO4217CurrencyCode } from "@emdash-commerce/contracts";
import { isSafeQuantity } from "./money.js";
import { calculateSubtotalMinor, calculateTotals } from "./totals.js";
import type { TotalsInput, TotalsLine } from "./totals.js";

export type CheckoutInput = TotalsInput;

export type ValidationErrorCode =
  | "INVALID_INPUT"
  | "INVALID_AMOUNT"
  | "NEGATIVE_AMOUNT"
  | "INVALID_CURRENCY"
  | "INVALID_QUANTITY"
  | "MIXED_CURRENCIES"
  | "DISCOUNT_EXCEEDS_SUBTOTAL"
  | "TOTAL_NOT_SAFE";

export interface ValidationError {
  code: ValidationErrorCode;
  field: string;
  message: string;
}

export type ValidationResult =
  | { valid: true; errors: [] }
  | { valid: false; errors: ValidationError[] };

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function amountError(value: unknown, field: string): ValidationError | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return { code: "INVALID_AMOUNT", field, message: `${field} must be a safe integer` };
  }
  if (value < 0) {
    return { code: "NEGATIVE_AMOUNT", field, message: `${field} cannot be negative` };
  }
  return undefined;
}

function pushAmountError(errors: ValidationError[], value: unknown, field: string): void {
  const error = amountError(value, field);
  if (error) {
    errors.push(error);
  }
}

export function validateCheckout(input: CheckoutInput): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isRecord(input)) {
    return {
      valid: false,
      errors: [{ code: "INVALID_INPUT", field: "input", message: "Checkout input must be an object" }],
    };
  }

  const currency = input.currency;
  const currencyIsValid = isISO4217CurrencyCode(currency);
  if (!currencyIsValid) {
    errors.push({ code: "INVALID_CURRENCY", field: "currency", message: "currency must be an ISO 4217 code" });
  }

  const lines = input.lines;
  const validLines: TotalsLine[] = [];
  if (!Array.isArray(lines)) {
    errors.push({ code: "INVALID_INPUT", field: "lines", message: "lines must be an array" });
  } else {
    for (const [index, line] of lines.entries()) {
      const prefix = `lines[${index}]`;
      if (!isRecord(line)) {
        errors.push({ code: "INVALID_INPUT", field: prefix, message: `${prefix} must be an object` });
        continue;
      }

      const unitAmountField = `${prefix}.unitAmountMinor`;
      const quantityField = `${prefix}.quantity`;
      const unitAmountMinor = line.unitAmountMinor;
      const quantity = line.quantity;
      const amountErrorForLine = amountError(unitAmountMinor, unitAmountField);
      if (amountErrorForLine) {
        errors.push(amountErrorForLine);
      }
      const quantityIsValid = isSafeQuantity(quantity);
      if (!quantityIsValid) {
        errors.push({ code: "INVALID_QUANTITY", field: quantityField, message: `${quantityField} must be at least one safe integer` });
      }

      let lineCurrencyIsValid = true;
      if (line.currency !== undefined) {
        const lineCurrencyField = `${prefix}.currency`;
        if (!isISO4217CurrencyCode(line.currency)) {
          lineCurrencyIsValid = false;
          errors.push({ code: "INVALID_CURRENCY", field: lineCurrencyField, message: `${lineCurrencyField} must be an ISO 4217 code` });
        } else if (currencyIsValid && line.currency !== currency) {
          lineCurrencyIsValid = false;
          errors.push({ code: "MIXED_CURRENCIES", field: lineCurrencyField, message: `${lineCurrencyField} must match currency` });
        }
      }

      if (
        currencyIsValid &&
        amountErrorForLine === undefined &&
        typeof unitAmountMinor === "number" &&
        isSafeQuantity(quantity) &&
        lineCurrencyIsValid
      ) {
        const validLine: TotalsLine = {
          unitAmountMinor,
          quantity,
        };
        if (typeof line.currency === "string") {
          validLine.currency = line.currency;
        }
        validLines.push(validLine);
      }
    }
  }

  const discountError = amountError(input.discountMinor, "discountMinor");
  pushAmountError(errors, input.discountMinor, "discountMinor");
  pushAmountError(errors, input.taxMinor, "taxMinor");
  pushAmountError(errors, input.shippingMinor, "shippingMinor");

  let subtotalMinor: number | undefined;
  if (currencyIsValid && Array.isArray(lines)) {
    try {
      subtotalMinor = calculateSubtotalMinor({ currency, lines: validLines });
    } catch {
      errors.push({ code: "TOTAL_NOT_SAFE", field: "subtotalMinor", message: "subtotalMinor is not a safe integer" });
    }
  }

  if (discountError === undefined && subtotalMinor !== undefined && input.discountMinor > subtotalMinor) {
    errors.push({
      code: "DISCOUNT_EXCEEDS_SUBTOTAL",
      field: "discountMinor",
      message: "discountMinor cannot exceed subtotalMinor",
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  try {
    calculateTotals(input);
  } catch {
    return {
      valid: false,
      errors: [{ code: "TOTAL_NOT_SAFE", field: "totalMinor", message: "Checkout totals are not safe integers" }],
    };
  }

  return { valid: true, errors: [] };
}
