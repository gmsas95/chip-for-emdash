import type { OrderSnapshot } from "../domain/orders.js";
export interface CatalogResult<T = unknown> {
  items: T[];
  cursor?: string;
  hasMore?: boolean;
}

export interface CartResult {
  id: string;
  currency: string;
  lines: unknown[];
  [key: string]: unknown;
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
  checkoutUrl: string;
  totalMinor: number;
  currency: string;
  [key: string]: unknown;
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
    get(orderId: string): Promise<OrderSnapshot | undefined>;
  };
}
