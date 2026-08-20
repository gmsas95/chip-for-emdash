import type { OrderSnapshot } from "../domain/orders.js";
export interface CatalogResult<T = unknown> {
  items: T[];
  cursor?: string;
  hasMore?: boolean;
}

export interface CartResultLine {
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

export interface CartResult {
  id: string;
  currency: string;
  lines: CartResultLine[];
}

export interface CartCreateInput {
  cartId?: string;
  currency: string;
}

export interface CartLineInput {
  cartId: string;
  line: {
    productId: string;
    variantId?: string;
    quantity: number;
  };
}

export interface CheckoutStartInput {
  cartId: string;
  paymentProvider: string;
  shippingAddress?: Record<string, unknown>;
}

export interface CheckoutResult {
  orderId: string;
  checkoutUrl: string;
  paymentReference?: string;
  totalMinor: number;
  currency: string;
}

export interface CommerceClient {
  catalog: {
    list(): Promise<CatalogResult>;
  };
  cart: {
    create(input: CartCreateInput): Promise<CartResult>;
    addLine(input: CartLineInput): Promise<CartResult>;
  };
  checkout: {
    start(input: CheckoutStartInput): Promise<CheckoutResult>;
  };
  orders: {
    get(orderId: string): Promise<OrderSnapshot>;
  };
}
