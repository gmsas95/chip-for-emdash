import type { AddressSnapshot, CustomerSnapshot, Money, OrderItem } from "@emdash-commerce/contracts";
import { calculateTotals } from "./totals.js";

export interface OrderSnapshotLine {
  readonly lineId: string;
  readonly productId?: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitAmountMinor: number;
  readonly totalMinor: number;
  readonly currency: string;
  readonly unitPrice: Money;
  readonly total: Money;
  readonly sku?: string;
}

export interface OrderSnapshot {
  [key: string]: unknown;
  readonly id: string;
  readonly orderId: string;
  readonly currency: string;
  readonly lines: readonly OrderSnapshotLine[];
  readonly items: readonly Readonly<OrderItem>[];
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly taxMinor: number;
  readonly shippingMinor: number;
  readonly totalMinor: number;
  readonly subtotal: Money;
  readonly total: Money;
  readonly customerId?: string;
  readonly customer?: Readonly<CustomerSnapshot>;
  readonly billingAddress?: Readonly<AddressSnapshot>;
  readonly shippingAddress?: Readonly<AddressSnapshot>;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly paymentProviderId?: string;
  readonly fulfillmentProviderId?: string;
  readonly status?: string;
  readonly createdAt: string;
}

export interface OrderSnapshotLineInput {
  lineId?: string;
  productId?: string;
  name?: string;
  quantity: number;
  unitAmountMinor?: number;
  priceMinor?: number;
  currency?: string;
  sku?: string;
}

export interface CreateOrderSnapshotInput {
  id?: string;
  orderId?: string;
  currency: string;
  lines?: OrderSnapshotLineInput[];
  productId?: string;
  quantity?: number;
  priceMinor?: number;
  name?: string;
  sku?: string;
  discountMinor?: number;
  taxMinor?: number;
  shippingMinor?: number;
  customer?: CustomerSnapshot;
  billingAddress?: AddressSnapshot;
  shippingAddress?: AddressSnapshot;
  metadata?: Record<string, string>;
  paymentProviderId?: string;
  fulfillmentProviderId?: string;
  status?: string;
  createdAt?: string;
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => clone(item)) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeLines(input: CreateOrderSnapshotInput, orderId: string): OrderSnapshotLineInput[] {
  if (input.lines !== undefined) {
    return input.lines.map((line) => clone(line));
  }
  if (input.productId === undefined || input.quantity === undefined || input.priceMinor === undefined) {
    throw new Error("Order snapshot requires lines or productId, quantity, and priceMinor");
  }
  return [{
    lineId: `${orderId}-line-1`,
    productId: input.productId,
    name: input.name,
    quantity: input.quantity,
    priceMinor: input.priceMinor,
    sku: input.sku,
    currency: input.currency,
  }];
}

export function createOrderSnapshot(input: CreateOrderSnapshotInput): OrderSnapshot {
  const orderId = input.orderId ?? input.id ?? createId("order");
  const lineInputs = normalizeLines(input, orderId);
  const linesForTotals = lineInputs.map((line, index) => {
    const unitAmountMinor = line.unitAmountMinor ?? line.priceMinor;
    if (unitAmountMinor === undefined) {
      throw new Error(`Order line ${index} requires unitAmountMinor or priceMinor`);
    }
    return {
      unitAmountMinor,
      quantity: line.quantity,
      currency: line.currency ?? input.currency,
    };
  });
  const totals = calculateTotals({
    currency: input.currency,
    lines: linesForTotals,
    discountMinor: input.discountMinor ?? 0,
    taxMinor: input.taxMinor ?? 0,
    shippingMinor: input.shippingMinor ?? 0,
  });

  const lines = lineInputs.map((line, index) => {
    const unitAmountMinor = line.unitAmountMinor ?? line.priceMinor;
    if (unitAmountMinor === undefined) {
      throw new Error(`Order line ${index} requires unitAmountMinor or priceMinor`);
    }
    const totalMinor = unitAmountMinor * line.quantity;
    const lineId = line.lineId ?? `${orderId}-line-${index + 1}`;
    const name = line.name ?? line.productId ?? line.sku ?? lineId;
    return {
      lineId,
      ...(line.productId === undefined ? {} : { productId: line.productId }),
      name,
      quantity: line.quantity,
      unitAmountMinor,
      totalMinor,
      currency: input.currency,
      unitPrice: { amountMinor: unitAmountMinor, currency: input.currency },
      total: { amountMinor: totalMinor, currency: input.currency },
      ...(line.sku === undefined ? {} : { sku: line.sku }),
    } satisfies OrderSnapshotLine;
  });

  const items: Readonly<OrderItem>[] = lines.map((line) => ({
    lineId: line.lineId,
    name: line.name,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    total: line.total,
    ...(line.sku === undefined ? {} : { sku: line.sku }),
  }));

  const snapshot: OrderSnapshot = {
    id: orderId,
    orderId,
    currency: input.currency,
    lines,
    items,
    subtotalMinor: totals.subtotalMinor,
    discountMinor: totals.discountMinor,
    taxMinor: totals.taxMinor,
    shippingMinor: totals.shippingMinor,
    totalMinor: totals.totalMinor,
    subtotal: { amountMinor: totals.subtotalMinor, currency: input.currency },
    total: { amountMinor: totals.totalMinor, currency: input.currency },
    ...(input.customer?.customerId === undefined ? {} : { customerId: input.customer.customerId }),
    ...(input.customer === undefined ? {} : { customer: clone(input.customer) }),
    ...(input.billingAddress === undefined ? {} : { billingAddress: clone(input.billingAddress) }),
    ...(input.shippingAddress === undefined ? {} : { shippingAddress: clone(input.shippingAddress) }),
    ...(input.metadata === undefined ? {} : { metadata: clone(input.metadata) }),
    ...(input.paymentProviderId === undefined ? {} : { paymentProviderId: input.paymentProviderId }),
    ...(input.fulfillmentProviderId === undefined ? {} : { fulfillmentProviderId: input.fulfillmentProviderId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };

  return deepFreeze(snapshot);
}
