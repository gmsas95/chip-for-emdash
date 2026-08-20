import {
  CONTRACT_ERROR_CODES,
  CommerceContractError,
  isISO4217CurrencyCode,
  parseMoney,
} from "./money.js";
import type { Money } from "./money.js";

export interface CustomerSnapshot {
  customerId?: string;
  name?: string;
  email?: string;
  phone?: string;
}

export interface AddressSnapshot {
  name?: string;
  company?: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  phone?: string;
}

export interface OrderItem {
  lineId: string;
  name: string;
  quantity: number;
  unitPrice: Money;
  total: Money;
  sku?: string;
}

export interface OrderSnapshot {
  orderId: string;
  currency: string;
  items: OrderItem[];
  subtotal: Money;
  total: Money;
  customer?: CustomerSnapshot;
  billingAddress?: AddressSnapshot;
  shippingAddress?: AddressSnapshot;
  metadata?: Record<string, string>;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function invalidPayload(message: string): never {
  throw new CommerceContractError(CONTRACT_ERROR_CODES.INVALID_PAYLOAD, message);
}

function parseNonEmptyString(input: unknown, field: string): string {
  if (typeof input !== "string" || input.length === 0) {
    return invalidPayload(`Invalid ${field}`);
  }
  return input;
}

function assertCurrency(money: Money, currency: string, field: string): void {
  if (money.currency !== currency) {
    invalidPayload(`${field} currency does not match order currency`);
  }
}

export function parseMetadata(input: unknown): Record<string, string> {
  if (!isRecord(input)) {
    return invalidPayload("Invalid metadata");
  }

  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string") {
      return invalidPayload(`Invalid metadata value for ${key}`);
    }
    metadata[key] = value;
  }
  return metadata;
}

export function parseAddressSnapshot(input: unknown): AddressSnapshot {
  if (!isRecord(input)) {
    return invalidPayload("Invalid address");
  }

  const line1 = parseNonEmptyString(input.line1, "address line1");
  const city = parseNonEmptyString(input.city, "address city");
  const postalCode = parseNonEmptyString(input.postalCode, "address postalCode");
  const country = parseNonEmptyString(input.country, "address country");
  return {
    name: input.name === undefined ? undefined : parseNonEmptyString(input.name, "address name"),
    company: input.company === undefined ? undefined : parseNonEmptyString(input.company, "address company"),
    line1,
    line2: input.line2 === undefined ? undefined : parseNonEmptyString(input.line2, "address line2"),
    city,
    state: input.state === undefined ? undefined : parseNonEmptyString(input.state, "address state"),
    postalCode,
    country,
    phone: input.phone === undefined ? undefined : parseNonEmptyString(input.phone, "address phone"),
  };
}

function parseCustomerSnapshot(input: unknown): CustomerSnapshot {
  if (!isRecord(input)) {
    return invalidPayload("Invalid customer");
  }
  return {
    customerId: input.customerId === undefined ? undefined : parseNonEmptyString(input.customerId, "customerId"),
    name: input.name === undefined ? undefined : parseNonEmptyString(input.name, "customer name"),
    email: input.email === undefined ? undefined : parseNonEmptyString(input.email, "customer email"),
    phone: input.phone === undefined ? undefined : parseNonEmptyString(input.phone, "customer phone"),
  };
}

function parseOrderItem(input: unknown, currency: string): OrderItem {
  if (!isRecord(input)) {
    return invalidPayload("Invalid order item");
  }

  const quantity = input.quantity;
  if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity <= 0) {
    return invalidPayload("Invalid order item quantity");
  }

  const unitPrice = parseMoney(input.unitPrice);
  const total = parseMoney(input.total);
  assertCurrency(unitPrice, currency, "Order item unitPrice");
  assertCurrency(total, currency, "Order item total");
  return {
    lineId: parseNonEmptyString(input.lineId, "order item lineId"),
    name: parseNonEmptyString(input.name, "order item name"),
    quantity,
    unitPrice,
    total,
    sku: input.sku === undefined ? undefined : parseNonEmptyString(input.sku, "order item sku"),
  };
}

export function parseOrderSnapshot(input: unknown): OrderSnapshot {
  if (!isRecord(input)) {
    return invalidPayload("Invalid order");
  }

  const orderId = parseNonEmptyString(input.orderId, "orderId");
  const currency = input.currency;
  if (!isISO4217CurrencyCode(currency)) {
    return invalidPayload("Invalid order currency");
  }
  if (!Array.isArray(input.items)) {
    return invalidPayload("Invalid order items");
  }

  const subtotal = parseMoney(input.subtotal);
  const total = parseMoney(input.total);
  assertCurrency(subtotal, currency, "Order subtotal");
  assertCurrency(total, currency, "Order total");
  return {
    orderId,
    currency,
    items: input.items.map((item) => parseOrderItem(item, currency)),
    subtotal,
    total,
    customer: input.customer === undefined ? undefined : parseCustomerSnapshot(input.customer),
    billingAddress: input.billingAddress === undefined ? undefined : parseAddressSnapshot(input.billingAddress),
    shippingAddress: input.shippingAddress === undefined ? undefined : parseAddressSnapshot(input.shippingAddress),
    metadata: input.metadata === undefined ? undefined : parseMetadata(input.metadata),
  };
}
