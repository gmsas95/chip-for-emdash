import type { OrderSnapshot } from "../domain/orders.js";
import { COMMERCE_COLLECTION_INDEXES, COMMERCE_COLLECTIONS, type CommerceCollectionName } from "./collections.js";
import { assertJsonDocument, cloneJson } from "./json.js";
import type { JsonDocument, JsonValue } from "./json.js";

export type { JsonDocument, JsonPrimitive, JsonValue } from "./json.js";

export interface RangeFilter {
  gt?: number | string;
  gte?: number | string;
  lt?: number | string;
  lte?: number | string;
}

export interface InFilter {
  in: Array<string | number>;
}

export interface StartsWithFilter {
  startsWith: string;
}

export type WhereValue = string | number | boolean | null | RangeFilter | InFilter | StartsWithFilter;
export type QueryWhere = Record<string, WhereValue>;
export type QueryOrder = Record<string, "asc" | "desc">;

export interface QueryOptions {
  where?: QueryWhere;
  orderBy?: QueryOrder;
  limit?: number;
  cursor?: string;
}

export interface QueryItem<T extends object> {
  id: string;
  data: T;
}

export interface QueryResult<T extends object> {
  items: QueryItem<T>[];
  cursor?: string;
  hasMore: boolean;
}

export interface DocumentRepository<T extends object = JsonDocument> {
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

export type StorageCollection<T extends object = JsonDocument> = DocumentRepository<T>;

export type CommerceStorage = {
  [Name in CommerceCollectionName]: StorageCollection<Name extends "orders" ? OrderSnapshot : JsonDocument>;
};

export interface EmDashStorageCollection<T extends object = JsonDocument> {
  get(id: string): Promise<T | null>;
  put(id: string, document: T): Promise<void>;
  delete(id: string): Promise<boolean>;
  query(options?: QueryOptions): Promise<{ items: QueryItem<T>[]; cursor?: string; hasMore: boolean }>;
  count(where?: QueryWhere): Promise<number>;
}

export type EmDashCommerceStorage = {
  [Name in CommerceCollectionName]: EmDashStorageCollection<Name extends "orders" ? OrderSnapshot : JsonDocument>;
};

export class StorageQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageQueryError";
  }
}

function assertIndexed(options: QueryOptions | { where?: QueryWhere }, indexes: readonly string[]): void {
  for (const field of Object.keys(options.where ?? {})) {
    if (!indexes.includes(field)) {
      throw new StorageQueryError(`Cannot query on non-indexed field '${field}'.`);
    }
  }
  if ("orderBy" in options) {
    for (const field of Object.keys(options.orderBy ?? {})) {
      if (!indexes.includes(field)) {
        throw new StorageQueryError(`Cannot order by non-indexed field '${field}'.`);
      }
    }
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesWhereValue(actual: unknown, expected: WhereValue): boolean {
  if (expected === null || typeof expected !== "object") {
    return (actual ?? null) === expected;
  }
  if (!isRecord(expected)) {
    throw new StorageQueryError("Invalid storage where filter");
  }
  if ("in" in expected) {
    if (!Array.isArray(expected.in)) {
      throw new StorageQueryError("Invalid storage in filter");
    }
    return expected.in.includes(actual as string | number);
  }
  if ("startsWith" in expected) {
    if (typeof expected.startsWith !== "string") {
      throw new StorageQueryError("Invalid storage startsWith filter");
    }
    return typeof actual === "string" && actual.startsWith(expected.startsWith);
  }
  const operators = Object.keys(expected);
  if (operators.length === 0 || operators.some((operator) => !["gt", "gte", "lt", "lte"].includes(operator))) {
    throw new StorageQueryError("Invalid storage range filter");
  }
  if (actual === undefined || actual === null || (typeof actual !== "string" && typeof actual !== "number")) {
    return false;
  }
  for (const [operator, bound] of Object.entries(expected)) {
    if (typeof bound !== "string" && typeof bound !== "number") {
      throw new StorageQueryError("Invalid storage range bound");
    }
    const comparison = compareValues(actual, bound);
    if (operator === "gt" && comparison <= 0) return false;
    if (operator === "gte" && comparison < 0) return false;
    if (operator === "lt" && comparison >= 0) return false;
    if (operator === "lte" && comparison > 0) return false;
  }
  return true;
}

function fieldValue(document: object, field: string): unknown {
  return (document as Record<string, unknown>)[field];
}

function matchesWhere(document: object, where: QueryWhere | undefined): boolean {
  return Object.entries(where ?? {}).every(([field, expected]) => matchesWhereValue(fieldValue(document, field), expected));
}

interface CursorPart {
  field: string;
  direction: "asc" | "desc";
  value: string | number | undefined;
}

interface Cursor {
  order: CursorPart[];
  id: string;
}

function orderValue(value: unknown): string | number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  throw new StorageQueryError("Storage order fields must contain strings or numbers");
}

function encodeCursor(cursor: Cursor): string {
  return encodeURIComponent(JSON.stringify(cursor));
}

function decodeCursor(value: string, orderEntries: Array<[string, "asc" | "desc"]>): Cursor {
  try {
    const decoded = JSON.parse(decodeURIComponent(value)) as { order?: unknown; id?: unknown };
    if (!Array.isArray(decoded.order) || typeof decoded.id !== "string" || decoded.order.length !== orderEntries.length) {
      throw new Error("invalid cursor");
    }
    const order = decoded.order.map((part, index) => {
      const expected = orderEntries[index];
      if (!expected || !isRecord(part) || part.field !== expected[0] || part.direction !== expected[1]) {
        throw new Error("invalid cursor");
      }
      return {
        field: expected[0],
        direction: expected[1],
        value: orderValue(part.value),
      };
    });
    return { order, id: decoded.id };
  } catch {
    throw new StorageQueryError("Invalid storage cursor");
  }
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIMIT;
  }
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new StorageQueryError("Storage query limit must be a positive integer");
  }
  return Math.min(limit, MAX_LIMIT);
}

function cloneDocument<T extends object>(document: T): T {
  assertJsonDocument(document);
  return cloneJson(document as JsonDocument) as T;
}
function createMemoryRepository<T extends object>(indexes: readonly string[]): DocumentRepository<T> {
  const documents = new Map<string, T>();

  return {
    async get(id) {
      const document = documents.get(id);
      return document === undefined ? undefined : cloneDocument(document);
    },
    async put(id, document) {
      documents.set(id, cloneDocument(document));
    },
    async delete(id) {
      documents.delete(id);
    },
    async query(options = {}) {
      assertIndexed(options, indexes);
      const limit = normalizeLimit(options.limit);
      const orderEntries = Object.entries(options.orderBy ?? { createdAt: "asc" as const }) as Array<[string, "asc" | "desc"]>;
      if (orderEntries.length === 0) {
        throw new StorageQueryError("Storage query requires an order field");
      }
      const cursor = options.cursor === undefined ? undefined : decodeCursor(options.cursor, orderEntries);
      let items = [...documents.entries()]
        .filter(([, document]) => matchesWhere(document, options.where))
        .map(([id, document]) => ({ id, data: cloneDocument(document) }));
      items.sort((left, right) => {
        for (const [field, orderDirection] of orderEntries) {
          const comparison = compareValues(fieldValue(left.data, field), fieldValue(right.data, field));
          if (comparison !== 0) {
            return orderDirection === "desc" ? -comparison : comparison;
          }
        }
        return left.id.localeCompare(right.id);
      });

      if (cursor) {
        items = items.filter((item) => {
          for (const [index, [field, direction]] of orderEntries.entries()) {
            const part = cursor.order[index];
            if (!part) {
              throw new StorageQueryError("Invalid storage cursor");
            }
            const comparison = compareValues(fieldValue(item.data, field), part.value);
            if (comparison !== 0) {
              return direction === "desc" ? comparison < 0 : comparison > 0;
            }
          }
          return item.id > cursor.id;
        });
      }

      const hasMore = items.length > limit;
      const page = items.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page,
        hasMore,
        ...(hasMore && last ? {
          cursor: encodeCursor({
            order: orderEntries.map(([field, direction]) => ({
              field,
              direction,
              value: orderValue(fieldValue(last.data, field)),
            })),
            id: last.id,
          }),
        } : {}),
      };
    },
    async count(where) {
      assertIndexed({ where }, indexes);
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

async function collectEmDashDocuments<T extends object>(
  collection: EmDashStorageCollection<T>,
  options: QueryOptions,
): Promise<Array<{ id: string; data: T }>> {
  const requestOptions = { ...options, limit: MAX_LIMIT };
  delete requestOptions.cursor;
  const documents: Array<{ id: string; data: T }> = [];
  let cursor: string | undefined;
  do {
    const result = await collection.query({
      ...requestOptions,
      ...(cursor === undefined ? {} : { cursor }),
    });
    for (const { id, data } of result.items) {
      documents.push({ id, data: cloneDocument(data) });
    }
    if (!result.hasMore) {
      break;
    }
    if (result.cursor === undefined || result.cursor === cursor) {
      throw new StorageQueryError("EmDash storage returned a non-advancing cursor");
    }
    cursor = result.cursor;
  } while (true);
  return documents;
}

function adaptEmDashCollection<T extends object>(
  collection: EmDashStorageCollection<T>,
  indexes: readonly string[],
): DocumentRepository<T> {
  return {
    async get(id) {
      const document = await collection.get(id);
      if (document === null) {
        return undefined;
      }
      return cloneDocument(document);
    },
    async put(id, document) {
      await collection.put(id, cloneDocument(document));
    },
    async delete(id) {
      await collection.delete(id);
    },
    async query(options = {}) {
      assertIndexed(options, indexes);
      normalizeLimit(options.limit);
      const documents = await collectEmDashDocuments(collection, options);
      const memory = createMemoryRepository<T>(indexes);
      for (const { id, data } of documents) {
        await memory.put(id, data);
      }
      return memory.query(options);
    },
    async count(where) {
      assertIndexed({ where }, indexes);
      return collection.count(where);
    },
  };
}

export function createMemoryRepositories(): CommerceRepositories {
  return {
    products: createMemoryRepository(COMMERCE_COLLECTION_INDEXES.products),
    variants: createMemoryRepository(COMMERCE_COLLECTION_INDEXES.variants),
    inventory: createMemoryRepository(COMMERCE_COLLECTION_INDEXES.inventory),
    reservations: createMemoryRepository(COMMERCE_COLLECTION_INDEXES.reservations),
    carts: createMemoryRepository(COMMERCE_COLLECTION_INDEXES.carts),
    orders: createMemoryRepository<OrderSnapshot>(COMMERCE_COLLECTION_INDEXES.orders),
    orderEvents: createMemoryRepository(COMMERCE_COLLECTION_INDEXES.orderEvents),
    customers: createMemoryRepository(COMMERCE_COLLECTION_INDEXES.customers),
    addresses: createMemoryRepository(COMMERCE_COLLECTION_INDEXES.addresses),
    promotions: createMemoryRepository(COMMERCE_COLLECTION_INDEXES.promotions),
    taxRules: createMemoryRepository(COMMERCE_COLLECTION_INDEXES.taxRules),
    fulfillments: createMemoryRepository(COMMERCE_COLLECTION_INDEXES.fulfillments),
  };
}

export function createCommerceRepositories(storage: CommerceStorage): CommerceRepositories {
  return storage;
}

export function createEmDashRepositories(storage: EmDashCommerceStorage): CommerceRepositories {
  return {
    products: adaptEmDashCollection(storage.products, COMMERCE_COLLECTION_INDEXES.products),
    variants: adaptEmDashCollection(storage.variants, COMMERCE_COLLECTION_INDEXES.variants),
    inventory: adaptEmDashCollection(storage.inventory, COMMERCE_COLLECTION_INDEXES.inventory),
    reservations: adaptEmDashCollection(storage.reservations, COMMERCE_COLLECTION_INDEXES.reservations),
    carts: adaptEmDashCollection(storage.carts, COMMERCE_COLLECTION_INDEXES.carts),
    orders: adaptEmDashCollection(storage.orders, COMMERCE_COLLECTION_INDEXES.orders),
    orderEvents: adaptEmDashCollection(storage.orderEvents, COMMERCE_COLLECTION_INDEXES.orderEvents),
    customers: adaptEmDashCollection(storage.customers, COMMERCE_COLLECTION_INDEXES.customers),
    addresses: adaptEmDashCollection(storage.addresses, COMMERCE_COLLECTION_INDEXES.addresses),
    promotions: adaptEmDashCollection(storage.promotions, COMMERCE_COLLECTION_INDEXES.promotions),
    taxRules: adaptEmDashCollection(storage.taxRules, COMMERCE_COLLECTION_INDEXES.taxRules),
    fulfillments: adaptEmDashCollection(storage.fulfillments, COMMERCE_COLLECTION_INDEXES.fulfillments),
  };
}

export function hasCommerceCollection(name: string): name is CommerceCollectionName {
  return (COMMERCE_COLLECTIONS as readonly string[]).includes(name);
}
