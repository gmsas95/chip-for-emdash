import { CommerceContractError, CONTRACT_ERROR_CODES } from "../../../commerce-contracts/src/money.js";
import {
  assertCurrency,
  assertSafeNonNegativeMinorUnit,
  assertSafeQuantity,
  checkedAdd,
  checkedMultiply,
  checkedSubtract,
} from "./money.js";

export interface TotalsLine {
  unitAmountMinor: number;
  quantity: number;
  currency?: string;
}

export interface TotalsInput {
  currency: string;
  lines: TotalsLine[];
  discountMinor: number;
  taxMinor: number;
  shippingMinor: number;
}

export interface OrderTotals {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  shippingMinor: number;
  totalMinor: number;
  currency: string;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function invalidInput(message: string): never {
  throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_INPUT, message);
}

export function calculateTotals(input: TotalsInput): OrderTotals {
  if (!isRecord(input)) {
    return invalidInput("Totals input must be an object");
  }
  assertCurrency(input.currency, "currency");
  if (!Array.isArray(input.lines)) {
    return invalidInput("Invalid lines");
  }

  let subtotalMinor = 0;
  for (const [index, line] of input.lines.entries()) {
    if (!isRecord(line)) {
      return invalidInput(`Invalid line ${index}`);
    }
    assertSafeNonNegativeMinorUnit(line.unitAmountMinor, `line ${index} unitAmountMinor`);
    assertSafeQuantity(line.quantity, `line ${index} quantity`);
    if (line.currency !== undefined) {
      assertCurrency(line.currency, `line ${index} currency`);
      if (line.currency !== input.currency) {
        return invalidInput(`Line ${index} currency does not match order currency`);
      }
    }

    const lineTotalMinor = checkedMultiply(
      line.unitAmountMinor,
      line.quantity,
      `line ${index} totalMinor`,
    );
    subtotalMinor = checkedAdd(subtotalMinor, lineTotalMinor, "subtotalMinor");
  }

  assertSafeNonNegativeMinorUnit(input.discountMinor, "discountMinor");
  assertSafeNonNegativeMinorUnit(input.taxMinor, "taxMinor");
  assertSafeNonNegativeMinorUnit(input.shippingMinor, "shippingMinor");
  if (input.discountMinor > subtotalMinor) {
    return invalidInput("Discount cannot exceed subtotal");
  }

  const discountedSubtotalMinor = checkedSubtract(subtotalMinor, input.discountMinor, "discountedSubtotalMinor");
  const taxedSubtotalMinor = checkedAdd(discountedSubtotalMinor, input.taxMinor, "taxedSubtotalMinor");
  const totalMinor = checkedAdd(taxedSubtotalMinor, input.shippingMinor, "totalMinor");

  return {
    subtotalMinor,
    discountMinor: input.discountMinor,
    taxMinor: input.taxMinor,
    shippingMinor: input.shippingMinor,
    totalMinor,
    currency: input.currency,
  };
}
