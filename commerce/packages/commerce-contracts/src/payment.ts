import type { OrderSnapshot } from "./domain.js";
import type { Money } from "./money.js";

export type PaymentOperation = "authorize" | "capture" | "charge" | "refund" | "void";

export interface PaymentMethodReference {
  type: string;
  token?: string;
}

export interface PaymentCommand {
  operation: PaymentOperation;
  order: OrderSnapshot;
  amount?: Money;
  paymentMethod?: PaymentMethodReference;
  paymentReference?: string;
  metadata?: Record<string, string>;
}
