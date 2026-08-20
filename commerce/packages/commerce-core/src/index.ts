export {
  calculateTotals,
  type OrderTotals,
  type TotalsInput,
  type TotalsLine,
} from "./domain/totals.js";
export {
  validateCheckout,
  type CheckoutInput,
  type ValidationError,
  type ValidationErrorCode,
  type ValidationResult,
} from "./domain/validation.js";
export {
  assertCurrency,
  assertSafeNonNegativeMinorUnit,
  assertSafeQuantity,
  checkedAdd,
  checkedMultiply,
  checkedSubtract,
  isSafeNonNegativeMinorUnit,
  isSafeQuantity,
  type Money,
} from "./domain/money.js";
