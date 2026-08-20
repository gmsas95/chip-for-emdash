import type { OrderSnapshot } from "../domain/orders.js";
import { COMMERCE_COLLECTIONS, type CommerceCollectionName } from "./collections.js";

export type JsonDocument = Record<string, unknown>;
export type QueryWhere = Record<string, unknown>;
export type QueryOrder = Record<string, "asc" | "desc">;

export interface QueryOptions {
  where?: QueryWhere;
  orderBy?: QueryOrder;
  limit?: number;
  cursor?: string;
}

export interface QueryItem<T extends JsonDocument> {
  id: string;
  data: T;
}

export interface QueryResult<T extends JsonDocument> {
  items: QueryItem<T>[];
  cursor?: string;
}

export interface DocumentRepository<T extends JsonDocument = JsonDocument> {
  get(id: string): Promise<T | undefined>;
  put(id: string, document: T): Promise<void>;
  delete(id: string): Promise<void>;
  query(options?: QueryOptions): Promise<QueryResult<T>>;
  count(where?: QueryWhere): Promise<number>;
}

export interface CommerceRepositories {
  products: DocumentRepository;
  variants: DocumentRepository;
  inventory: DocumentRepository;
  reservations: DocumentRepository;
  carts: DocumentRepository;
  orders: DocumentRepository<OrderSnapshot>;
  orderEvents: DocumentRepository;
  customers: DocumentRepository;
  addresses: DocumentRepository;
  promotions: DocumentRepository;
  taxRules: DocumentRepository;
  fulfillments: DocumentRepository;
}

export type StorageCollection<T extends JsonDocument = JsonDocument> = {
  get(id: string): Promise<T | undefined>;
  put(id: string, document: T): Promise<void>;
  delete(id: string): Promise<void>;
  query(options?: QueryOptions): Promise<QueryResult<T>>;
  count(where?: QueryWhere): Promise<number>;
};

export type CommerceStorage = {
  [Name in CommerceCollectionName]: StorageCollection<Name extends "orders" ? OrderSnapshot : JsonDocument>;
};

function clone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => clone(item)) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  }
  return value;
}

function matchesWhere(document: JsonDocument, where: QueryWhere | undefined): boolean {
  if (!where) {
    return true;
  }
  return Object.entries(where).every(([field, expected]) => document[field] === expected);
}

function compareValues(left: unknown, right: unknown): number {
  if (left === right) {
    return 0;
  }
  if (left === undefined || left === null) {
    return -1;
  }
  if (right === undefined || right === null) {
    return 1;
  }
  if (typeof left === "number" && typeof right === "number") {
    return left < right ? -1 : 1;
  }
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : 1;
}

function createMemoryRepository<T extends JsonDocument>(): DocumentRepository<T> {
  const documents = new Map<string, T>();

  return {
    async get(id) {
      const document = documents.get(id);
      return document === undefined ? undefined : clone(document);
    },
    async put(id, document) {
      documents.set(id, clone(document));
    },
    async delete(id) {
      documents.delete(id);
    },
    async query(options = {}) {
      let items = [...documents.entries()]
        .filter(([, document]) => matchesWhere(document, options.where))
        .map(([id, document]) => ({ id, data: clone(document) }));

      if (options.orderBy) {
        const orderEntries = Object.entries(options.orderBy);
        items.sort((left, right) => {
          for (const [field, direction] of orderEntries) {
            const comparison = compareValues(left.data[field], right.data[field]);
            if (comparison !== 0) {
              return direction === "desc" ? -comparison : comparison;
            }
          }
          return left.id.localeCompare(right.id);
        });
      }

      const offset = options.cursor === undefined ? 0 : Number.parseInt(options.cursor, 10);
      const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
      const limit = options.limit === undefined ? items.length : Math.max(0, options.limit);
      const page = items.slice(start, start + limit);
      const nextOffset = start + page.length;

      return {
        items: page,
        ...(nextOffset < items.length ? { cursor: String(nextOffset) } : {}),
      };
    },
    async count(where) {
      let count = 0;
      for (const document of documents.values()) {
        if (matchesWhere(document, where)) {
          count += 1;
        }
      }
      return count;
    },
  };
}

export function createMemoryRepositories(): CommerceRepositories {
  return {
    products: createMemoryRepository(),
    variants: createMemoryRepository(),
    inventory: createMemoryRepository(),
    reservations: createMemoryRepository(),
    carts: createMemoryRepository(),
    orders: createMemoryRepository<OrderSnapshot>(),
    orderEvents: createMemoryRepository(),
    customers: createMemoryRepository(),
    addresses: createMemoryRepository(),
    promotions: createMemoryRepository(),
    taxRules: createMemoryRepository(),
    fulfillments: createMemoryRepository(),
  };
}

export function createCommerceRepositories(storage: CommerceStorage): CommerceRepositories {
  return {
    products: storage.products,
    variants: storage.variants,
    inventory: storage.inventory,
    reservations: storage.reservations,
    carts: storage.carts,
    orders: storage.orders,
    orderEvents: storage.orderEvents,
    customers: storage.customers,
    addresses: storage.addresses,
    promotions: storage.promotions,
    taxRules: storage.taxRules,
    fulfillments: storage.fulfillments,
  };
}

export const createEmDashRepositories = createCommerceRepositories;

export function hasCommerceCollection(name: string): name is CommerceCollectionName {
  return (COMMERCE_COLLECTIONS as readonly string[]).includes(name);
}
