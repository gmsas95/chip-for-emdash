import { PluginRouteError } from "emdash";
import type { RouteContext } from "emdash";
import {
  isPublishedProduct,
  isPublishedVariant,
  validateInventoryInput,
  validateProductInput,
  validateVariantInput,
} from "../domain/products.js";
import type { InventoryDocument, ProductDocument, VariantDocument } from "../domain/products.js";
import { isRecord } from "../domain/guards.js";
import { createEmDashRepositories } from "../storage/repositories.js";
import type { CommerceRepositories, DocumentRepository, EmDashCommerceStorage, JsonDocument, QueryItem, QueryWhere } from "../storage/repositories.js";

interface StoredItem<T extends object> {
  id: string;
  data: T;
}

function repositoriesFromContext(context: RouteContext): CommerceRepositories {
  return createEmDashRepositories(context.storage as unknown as EmDashCommerceStorage);
}

function requireMethod(context: RouteContext, method: string): void {
  if (context.request.method !== method) {
    throw new PluginRouteError("METHOD_NOT_ALLOWED", `Method ${context.request.method} not allowed; expected ${method}`, 405);
  }
}

function requestBody(context: RouteContext): Record<string, unknown> {
  if (!isRecord(context.input)) throw PluginRouteError.badRequest("Request body must be an object");
  return context.input;
}

function requestedId(context: RouteContext, field: string): string {
  const input = isRecord(context.input) ? context.input[field] : undefined;
  const query = new URL(context.request.url).searchParams.get(field);
  const id = typeof input === "string" ? input : query;
  if (!id || id.trim() === "") throw PluginRouteError.badRequest(`${field} is required`);
  return id;
}

function productData(value: unknown): ProductDocument {
  return validateProductInput(value);
}

function variantData(value: unknown, productId: string): VariantDocument {
  return validateVariantInput(value, productId);
}

function inventoryData(value: unknown, productId: string, variantId?: string): InventoryDocument {
  return validateInventoryInput(value, productId, variantId);
}

async function queryAll(repository: DocumentRepository, where: QueryWhere): Promise<Array<QueryItem<JsonDocument>>> {
  const items: Array<QueryItem<JsonDocument>> = [];
  let cursor: string | undefined;
  do {
    const page = await repository.query({ where, limit: 100, ...(cursor === undefined ? {} : { cursor }) });
    items.push(...page.items);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor !== undefined);
  return items;
}

async function aggregate(repositories: CommerceRepositories, productId: string): Promise<{
  product: StoredItem<ProductDocument>;
  variants: StoredItem<VariantDocument>[];
  inventory: StoredItem<InventoryDocument>[];
}> {
  const product = await repositories.products.get(productId);
  if (!product) throw PluginRouteError.notFound("Product not found");
  const [variants, inventory] = await Promise.all([
    queryAll(repositories.variants, { productId }),
    queryAll(repositories.inventory, { productId }),
  ]);
  return {
    product: { id: productId, data: productData(product) },
    variants: variants.map(({ id, data }) => ({ id, data: variantData(data, productId) })),
    inventory: inventory.map(({ id, data }) => ({
      id,
      data: inventoryData(data, productId, isRecord(data) && typeof data.variantId === "string" ? data.variantId : undefined),
    })),
  };
}

async function archiveOmitted(
  repositories: CommerceRepositories,
  collection: "variants" | "inventory",
  existing: Array<QueryItem<JsonDocument>>,
  seen: Set<string>,
  productId: string,
): Promise<void> {
  await Promise.all(existing.filter(({ id }) => !seen.has(id)).map(async ({ id, data }) => {
    if (collection === "variants") {
      await repositories.variants.put(id, variantData({ ...data, status: "archived", updatedAt: new Date().toISOString() }, productId) as never);
      return;
    }
    const variantId = isRecord(data) && typeof data.variantId === "string" ? data.variantId : undefined;
    await repositories.inventory.put(id, inventoryData({ ...data, status: "disabled", updatedAt: new Date().toISOString() }, productId, variantId) as never);
  }));
}

export async function catalogRoute(context: RouteContext): Promise<unknown> {
  requireMethod(context, "GET");
  const repositories = repositoriesFromContext(context);
  const products = await repositories.products.query({ where: { status: "published" }, limit: 50 });
  const items = await Promise.all(products.items.flatMap(async ({ id, data }) => {
    if (!isPublishedProduct(data)) return [];
    const variants = await queryAll(repositories.variants, { productId: id, status: "published" });
    const product = productData(data);
    return [{
      id,
      data: {
        ...product,
        variants: product.hasVariants ? variants.filter(({ data: variant }) => isPublishedVariant(variant)).map(({ id: variantId, data: variant }) => ({
          id: variantId,
          ...variantData(variant, id),
        })) : [],
      },
    }];
  }));
  return { items: items.flat(), hasMore: products.hasMore, ...(products.cursor === undefined ? {} : { cursor: products.cursor }) };
}

export async function productsRoute(context: RouteContext): Promise<unknown> {
  requireMethod(context, "GET");
  const repositories = repositoriesFromContext(context);
  const input = isRecord(context.input) ? context.input : {};
  const status = typeof input.status === "string" ? input.status : undefined;
  return repositories.products.query({
    ...(status === undefined ? {} : { where: { status } }),
    limit: 100,
  });
}

export async function productDetailRoute(context: RouteContext): Promise<unknown> {
  requireMethod(context, "GET");
  return aggregate(repositoriesFromContext(context), requestedId(context, "productId"));
}

export async function productSaveRoute(context: RouteContext): Promise<unknown> {
  requireMethod(context, "POST");
  const body = requestBody(context);
  if (!isRecord(body.product)) throw PluginRouteError.badRequest("product is required");
  const repositories = repositoriesFromContext(context);
  const productId = typeof body.product.id === "string" && body.product.id !== "" ? body.product.id : crypto.randomUUID();
  const existing = await repositories.products.get(productId);
  const now = new Date().toISOString();
  let product: ProductDocument;
  try {
    product = productData({
      ...(existing ?? {}),
      ...body.product,
      ...(existing?.createdAt === undefined ? {} : { createdAt: existing.createdAt }),
      updatedAt: now,
    });
  } catch (error) {
    throw PluginRouteError.badRequest(error instanceof Error ? error.message : "Invalid product");
  }

  const existingVariants = await queryAll(repositories.variants, { productId });
  const variantInputs = Array.isArray(body.variants) ? body.variants : [];
  const variantIds = new Set<string>();
  const preparedVariants: Array<{ id: string; data: VariantDocument }> = [];
  for (const raw of variantInputs) {
    if (!isRecord(raw)) throw PluginRouteError.badRequest("variants must contain objects");
    const variantId = typeof raw.id === "string" && raw.id !== "" ? raw.id : crypto.randomUUID();
    if (variantIds.has(variantId)) throw PluginRouteError.badRequest(`Duplicate variant id: ${variantId}`);
    const storedVariant = await repositories.variants.get(variantId);
    if (storedVariant && (!isRecord(storedVariant) || storedVariant.productId !== productId)) {
      throw PluginRouteError.badRequest(`Variant ${variantId} belongs to another product`);
    }
    const previous = existingVariants.find((item) => item.id === variantId)?.data ?? storedVariant;
    try {
      preparedVariants.push({
        id: variantId,
        data: variantData({
          ...(isRecord(previous) ? previous : {}),
          ...raw,
          productId,
          ...(isRecord(previous) && typeof previous.createdAt === "string" ? { createdAt: previous.createdAt } : {}),
          updatedAt: now,
        }, productId),
      });
    } catch (error) {
      throw PluginRouteError.badRequest(error instanceof Error ? error.message : "Invalid variant");
    }
    variantIds.add(variantId);
  }

  const existingInventory = await queryAll(repositories.inventory, { productId });
  const inventoryInputs = Array.isArray(body.inventory) ? body.inventory : [];
  const inventoryIds = new Set<string>();
  const preparedInventory: Array<{ id: string; data: InventoryDocument }> = [];
  for (const raw of inventoryInputs) {
    if (!isRecord(raw)) throw PluginRouteError.badRequest("inventory must contain objects");
    const inventoryId = typeof raw.id === "string" && raw.id !== "" ? raw.id : crypto.randomUUID();
    if (inventoryIds.has(inventoryId)) throw PluginRouteError.badRequest(`Duplicate inventory id: ${inventoryId}`);
    const storedInventory = await repositories.inventory.get(inventoryId);
    if (storedInventory && (!isRecord(storedInventory) || storedInventory.productId !== productId)) {
      throw PluginRouteError.badRequest(`Inventory ${inventoryId} belongs to another product`);
    }
    const previous = existingInventory.find((item) => item.id === inventoryId)?.data ?? storedInventory;
    const variantId = typeof raw.variantId === "string"
      ? raw.variantId
      : isRecord(previous) && typeof previous.variantId === "string" ? previous.variantId : undefined;
    if (variantId) {
      const storedVariant = await repositories.variants.get(variantId);
      if (storedVariant && (!isRecord(storedVariant) || storedVariant.productId !== productId)) {
        throw PluginRouteError.badRequest(`Variant ${variantId} belongs to another product`);
      }
      if (!storedVariant && !variantIds.has(variantId)) {
        throw PluginRouteError.badRequest(`Inventory references an unknown variant: ${variantId}`);
      }
    }
    try {
      preparedInventory.push({
        id: inventoryId,
        data: inventoryData({
          ...(isRecord(previous) ? previous : {}),
          ...raw,
          updatedAt: now,
          ...(variantId === undefined ? {} : { variantId }),
        }, productId, variantId),
      });
    } catch (error) {
      throw PluginRouteError.badRequest(error instanceof Error ? error.message : "Invalid inventory");
    }
    inventoryIds.add(inventoryId);
  }

  await repositories.products.put(productId, product as never);
  await Promise.all(preparedVariants.map(({ id, data }) => repositories.variants.put(id, data as never)));
  await Promise.all(preparedInventory.map(({ id, data }) => repositories.inventory.put(id, data as never)));
  await archiveOmitted(repositories, "variants", existingVariants, variantIds, productId);
  await archiveOmitted(repositories, "inventory", existingInventory, inventoryIds, productId);
  return aggregate(repositories, productId);
}

export async function productArchiveRoute(context: RouteContext): Promise<unknown> {
  requireMethod(context, "POST");
  const repositories = repositoriesFromContext(context);
  const productId = requestedId(context, "productId");
  const existing = await repositories.products.get(productId);
  if (!existing) throw PluginRouteError.notFound("Product not found");
  await repositories.products.put(productId, productData({ ...existing, status: "archived", updatedAt: new Date().toISOString() }) as never);
  const [variants, inventory] = await Promise.all([
    queryAll(repositories.variants, { productId }),
    queryAll(repositories.inventory, { productId }),
  ]);
  await Promise.all([
    ...variants.map(({ id, data }) => repositories.variants.put(id, variantData({ ...data, status: "archived" }, productId) as never)),
    ...inventory.map(({ id, data }) => repositories.inventory.put(id, inventoryData({ ...data, status: "disabled" }, productId, isRecord(data) && typeof data.variantId === "string" ? data.variantId : undefined) as never)),
  ]);
  return { productId, status: "archived" };
}
