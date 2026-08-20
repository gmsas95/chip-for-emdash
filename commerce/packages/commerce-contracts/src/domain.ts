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
