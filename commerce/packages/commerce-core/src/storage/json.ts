export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | ReadonlyArray<JsonValue> | { readonly [key: string]: JsonValue | undefined };
export type JsonDocument = { readonly [key: string]: JsonValue | undefined };

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonValue(value: unknown, seen: WeakSet<object>): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("JSON documents cannot contain non-finite numbers");
    }
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError("JSON documents cannot contain functions, symbols, or undefined values");
  }
  if (seen.has(value)) {
    throw new TypeError("JSON documents cannot contain cycles");
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      assertJsonValue(item, seen);
    }
  } else {
    if (!isPlainObject(value)) {
      throw new TypeError("JSON documents can only contain plain objects and arrays");
    }
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) {
        throw new TypeError(`JSON documents cannot contain undefined field: ${key}`);
      }
      assertJsonValue(item, seen);
    }
  }
  seen.delete(value);
}

export function assertJsonDocument(value: unknown): asserts value is JsonDocument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("JSON document must be a plain object");
  }
  assertJsonValue(value, new WeakSet<object>());
}

export function cloneJson<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJson(item)) as unknown as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item!)])) as T;
  }
  return value;
}
