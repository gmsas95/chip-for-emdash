import { isISO4217CurrencyCode } from "@emdash-commerce/contracts";
import {
  assertSafeNonNegativeMinorUnit,
  assertSafeQuantity,
  checkedAdd,
  checkedMultiply,
} from "./money.js";

export type CartStatus = "active" | "checked_out" | "abandoned";

export interface CartLine {
  lineId: string;
  productId: string;
  variantId?: string;
  sku?: string;
  name?: string;
  unitAmountMinor: number;
  quantity: number;
  currency: string;
  totalMinor?: number;
}

export interface Cart {
  id?: string;
  currency: string;
  lines: CartLine[];
  status?: CartStatus;
  customerId?: string;
  updatedAt?: string;
}

export interface AddCartLineInput {
  lineId?: string;
  productId: string;
  variantId?: string;
  sku?: string;
  name?: string;
  unitAmountMinor: number;
  quantity: number;
  currency?: string;
}

function lineKey(line: Pick<CartLine, "productId" | "variantId" | "sku">): string {
  return `${line.productId}\u0000${line.variantId ?? ""}\u0000${line.sku ?? ""}`;
}

function createLineId(line: AddCartLineInput): string {
  return line.lineId ?? `${line.productId}-${line.variantId ?? "default"}-${line.sku ?? "line"}`;
}

export function addCartLine(cart: Cart, input: AddCartLineInput): Cart {
  if (cart.status !== undefined && cart.status !== "active") {
    throw new Error("Cannot add a line to an inactive cart");
  }
  if (!isISO4217CurrencyCode(cart.currency)) {
    throw new Error("Invalid cart currency");
  }
  const currency = input.currency ?? cart.currency;
  if (currency !== cart.currency || !isISO4217CurrencyCode(currency)) {
    throw new Error("Cart line currency must match cart currency");
  }
  assertSafeNonNegativeMinorUnit(input.unitAmountMinor, "unitAmountMinor");
  assertSafeQuantity(input.quantity, "quantity");

  const lines = cart.lines.map((line) => {
    if (!isISO4217CurrencyCode(line.currency) || line.currency !== cart.currency) {
      throw new Error("Cart line currency must match cart currency");
    }
    assertSafeNonNegativeMinorUnit(line.unitAmountMinor, "unitAmountMinor");
    assertSafeQuantity(line.quantity, "quantity");
    const totalMinor = checkedMultiply(line.unitAmountMinor, line.quantity, "cart line totalMinor");
    if (line.totalMinor !== undefined && line.totalMinor !== totalMinor) {
      throw new Error("Invalid cart line totalMinor");
    }
    return { ...line, totalMinor };
  });
  const existingIndex = lines.findIndex((line) => (
    lineKey(line) === lineKey(input) &&
    line.unitAmountMinor === input.unitAmountMinor &&
    line.currency === currency
  ));

  if (existingIndex >= 0) {
    const existing = lines[existingIndex];
    if (!existing) {
      throw new Error("Cart line disappeared during update");
    }
    const quantity = checkedAdd(existing.quantity, input.quantity, "cart line quantity");
    existing.quantity = quantity;
    existing.totalMinor = checkedMultiply(existing.unitAmountMinor, quantity, "cart line totalMinor");
    if (input.name !== undefined) existing.name = input.name;
  } else {
    lines.push({
      lineId: createLineId(input),
      productId: input.productId,
      ...(input.variantId === undefined ? {} : { variantId: input.variantId }),
      ...(input.sku === undefined ? {} : { sku: input.sku }),
      ...(input.name === undefined ? {} : { name: input.name }),
      unitAmountMinor: input.unitAmountMinor,
      quantity: input.quantity,
      currency,
      totalMinor: checkedMultiply(input.unitAmountMinor, input.quantity, "cart line totalMinor"),
    });
  }

  return {
    ...cart,
    currency: cart.currency,
    lines,
    ...(cart.updatedAt === undefined ? {} : { updatedAt: cart.updatedAt }),
  };
}
