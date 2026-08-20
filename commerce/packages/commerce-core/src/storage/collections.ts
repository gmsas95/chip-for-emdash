export const COMMERCE_COLLECTIONS = [
  "products",
  "variants",
  "inventory",
  "reservations",
  "carts",
  "orders",
  "orderEvents",
  "customers",
  "addresses",
  "promotions",
  "taxRules",
  "fulfillments",
] as const;

export type CommerceCollectionName = (typeof COMMERCE_COLLECTIONS)[number];

export const COMMERCE_COLLECTION_INDEXES = {
  products: ["status", "createdAt", "sku"],
  variants: ["status", "createdAt", "productId", "sku"],
  inventory: ["status", "createdAt", "sku"],
  reservations: ["status", "createdAt", "sku", "orderId", "idempotencyKey"],
  carts: ["status", "createdAt", "customerId", "idempotencyKey"],
  orders: ["status", "createdAt", "customerId", "idempotencyKey"],
  orderEvents: ["status", "createdAt", "orderId", "providerId", "idempotencyKey"],
  customers: ["status", "createdAt", "email"],
  addresses: ["customerId", "createdAt"],
  promotions: ["status", "createdAt"],
  taxRules: ["status", "createdAt"],
  fulfillments: ["status", "createdAt", "orderId", "providerId", "idempotencyKey"],
} as const satisfies Record<CommerceCollectionName, readonly string[]>;

export const COMMERCE_STORAGE_DECLARATION = Object.fromEntries(
  COMMERCE_COLLECTIONS.map((name) => [name, { indexes: COMMERCE_COLLECTION_INDEXES[name] }]),
) as {
  [Name in CommerceCollectionName]: { indexes: (typeof COMMERCE_COLLECTION_INDEXES)[Name] };
};
