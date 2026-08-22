import type { ZodType } from "zod";
import { PluginRouteError } from "emdash";
import type { RouteContext } from "emdash";
import { isRecord } from "./domain/guards.js";
import { createEmDashRepositories } from "./storage/repositories.js";
import type { CommerceRepositories, EmDashCommerceStorage } from "./storage/repositories.js";
import { productArchiveRoute, productDetailRoute, productSaveRoute } from "./admin/products-api.js";

const commerceMcpSearchJsonSchema = {
  type: "object",
  properties: {
    query: { type: "string", maxLength: 200 },
    scope: { type: "string", enum: ["all", "products", "inventory", "orders", "customers"] },
    limit: { type: "integer", minimum: 1, maximum: 50 },
  },
  additionalProperties: false,
} as const;

const commerceMcpExecuteJsonSchema = {
  type: "object",
  properties: {
    operation: { type: "string", enum: ["product.list", "product.get", "product.save", "product.archive", "inventory.list", "order.list", "customer.list"] },
    arguments: { type: "object", additionalProperties: true },
  },
  required: ["operation"],
  additionalProperties: false,
} as const;

export const commerceMcpSearchInput = commerceMcpSearchJsonSchema as unknown as ZodType;
export const commerceMcpExecuteInput = commerceMcpExecuteJsonSchema as unknown as ZodType;

type SearchInput = { query: string; scope: "all" | "products" | "inventory" | "orders" | "customers"; limit: number };
type ExecuteInput = { operation: "product.list" | "product.get" | "product.save" | "product.archive" | "inventory.list" | "order.list" | "customer.list"; arguments: Record<string, unknown> };

function repositoriesFromContext(context: RouteContext): CommerceRepositories {
  return createEmDashRepositories(context.storage as unknown as EmDashCommerceStorage);
}

function requestBody(context: RouteContext): Record<string, unknown> {
  if (!isRecord(context.input)) throw PluginRouteError.badRequest("MCP request must be an object");
  return context.input;
}

function parseSearchInput(input: Record<string, unknown>): SearchInput {
  const query = typeof input.query === "string" ? input.query.slice(0, 200) : "";
  const allowedScopes = ["all", "products", "inventory", "orders", "customers"] as const;
  const scope = typeof input.scope === "string" && allowedScopes.includes(input.scope as SearchInput["scope"]) ? input.scope as SearchInput["scope"] : "all";
  const rawLimit = typeof input.limit === "number" ? input.limit : Number(input.limit ?? 20);
  const limit = Number.isSafeInteger(rawLimit) ? Math.max(1, Math.min(50, rawLimit)) : 20;
  return { query, scope, limit };
}

function parseExecuteInput(input: Record<string, unknown>): ExecuteInput {
  const operations = ["product.list", "product.get", "product.save", "product.archive", "inventory.list", "order.list", "customer.list"] as const;
  const operation = input.operation;
  if (typeof operation !== "string" || !operations.includes(operation as ExecuteInput["operation"])) throw PluginRouteError.badRequest("Unsupported Commerce MCP operation");
  const argumentsValue = input.arguments;
  return { operation: operation as ExecuteInput["operation"], arguments: isRecord(argumentsValue) ? argumentsValue : {} };
}

function textMatches(query: string, values: unknown[]): boolean {
  if (!query) return true;
  return values.some((value) => typeof value === "string" && value.toLowerCase().includes(query));
}

function routeContext(context: RouteContext, input: unknown, method: "GET" | "POST"): RouteContext {
  return {
    ...context,
    input,
    request: new Request(context.request.url, { method }),
  } as RouteContext;
}

export async function commerceMcpSearchRoute(context: RouteContext): Promise<unknown> {
  if (context.request.method !== "POST") throw new PluginRouteError("METHOD_NOT_ALLOWED", "MCP search requires POST", 405);
  const body = parseSearchInput(requestBody(context));
  const repositories = repositoriesFromContext(context);
  const results: Array<Record<string, unknown>> = [];
  const query = body.query.trim().toLowerCase();

  if (body.scope === "all" || body.scope === "products") {
    const products = await repositories.products.query({ limit: 100 });
    for (const { id, data } of products.items) {
      if (!isRecord(data) || !textMatches(query, [data.name, data.slug, data.sku, data.status])) continue;
      results.push({ type: "product", id, name: data.name, slug: data.slug, status: data.status, sku: data.sku });
    }
  }
  if (body.scope === "all" || body.scope === "inventory") {
    const inventory = await repositories.inventory.query({ limit: 100 });
    for (const { id, data } of inventory.items) {
      if (!isRecord(data) || !textMatches(query, [data.productId, data.variantId, data.sku, data.status])) continue;
      results.push({ type: "inventory", id, productId: data.productId, variantId: data.variantId, sku: data.sku, status: data.status, available: data.available, reserved: data.reserved });
    }
  }
  if (body.scope === "all" || body.scope === "orders") {
    const orders = await repositories.orders.query({ limit: 100 });
    for (const { id, data } of orders.items) {
      if (!isRecord(data) || !textMatches(query, [id, data.orderId, data.status, isRecord(data.customer) ? data.customer.email : undefined])) continue;
      results.push({ type: "order", id, orderId: data.orderId, status: data.status, totalMinor: data.totalMinor, currency: data.currency });
    }
  }
  if (body.scope === "all" || body.scope === "customers") {
    const customers = await repositories.customers.query({ limit: 100 });
    for (const { id, data } of customers.items) {
      if (!isRecord(data) || !textMatches(query, [id, data.customerId, data.name, data.email, data.phone])) continue;
      results.push({ type: "customer", id, customerId: data.customerId, name: data.name, email: data.email, phone: data.phone, orderCount: data.orderCount });
    }
  }
  return { results: results.slice(0, body.limit) };
}

export async function commerceMcpExecuteRoute(context: RouteContext): Promise<unknown> {
  if (context.request.method !== "POST") throw new PluginRouteError("METHOD_NOT_ALLOWED", "MCP execute requires POST", 405);
  const body = parseExecuteInput(requestBody(context));
  const args = body.arguments;
  const repositories = repositoriesFromContext(context);
  switch (body.operation) {
    case "product.list":
      return repositories.products.query({ ...(typeof args.status === "string" ? { where: { status: args.status } } : {}), limit: 100 });
    case "product.get":
      return productDetailRoute(routeContext(context, { productId: args.productId }, "GET"));
    case "product.save":
      return productSaveRoute(routeContext(context, args, "POST"));
    case "product.archive":
      return productArchiveRoute(routeContext(context, args, "POST"));
    case "inventory.list":
      return repositories.inventory.query({ ...(typeof args.productId === "string" ? { where: { productId: args.productId } } : {}), limit: 100 });
    case "order.list":
      return repositories.orders.query({ ...(typeof args.status === "string" ? { where: { status: args.status } } : {}), limit: 100 });
    case "customer.list":
      return repositories.customers.query({ ...(typeof args.email === "string" ? { where: { email: args.email } } : {}), limit: 100 });
  }
}
