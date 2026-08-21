import { isRecord } from "./guards.js";

export type ProductStatus = "draft" | "published" | "archived";
export type VariantStatus = ProductStatus;
export type InventoryStatus = "active" | "disabled";

export interface ProductImage {
  mediaId: string;
  url: string;
  alt: string;
}

export interface ProductDocument {
  name: string;
  slug: string;
  description: string;
  status: ProductStatus;
  sku?: string;
  priceMinor?: number;
  compareAtMinor?: number;
  currency: string;
  images: ProductImage[];
  hasVariants: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VariantDocument {
  productId: string;
  name: string;
  sku: string;
  status: VariantStatus;
  priceMinor: number;
  currency: string;
  options: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryDocument {
  productId: string;
  variantId?: string;
  sku: string;
  status: InventoryStatus;
  available: number;
  reserved: number;
  updatedAt: string;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const PRODUCT_STATUSES: Record<ProductStatus, true> = { draft: true, published: true, archived: true };
const INVENTORY_STATUSES: Record<InventoryStatus, true> = { active: true, disabled: true };

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(value, field);
}

function integerAmount(value: unknown, field: string, required: boolean): number | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new TypeError(`${field} is required`);
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function currency(value: unknown, required: boolean): string {
  if (value === undefined || value === null || value === "") {
    if (required) throw new TypeError("currency is required");
    return "";
  }
  const result = requiredString(value, "currency");
  if (!CURRENCY_PATTERN.test(result)) throw new TypeError("currency must be a three-letter uppercase ISO code");
  return result;
}

function timestamp(value: unknown): string {
  return typeof value === "string" && value !== "" ? value : new Date().toISOString();
}

function image(value: unknown, index: number): ProductImage {
  if (!isRecord(value)) throw new TypeError(`images[${index}] must be an object`);
  return {
    mediaId: requiredString(value.mediaId, `images[${index}].mediaId`),
    url: requiredString(value.url, `images[${index}].url`),
    alt: typeof value.alt === "string" ? value.alt.trim() : "",
  };
}

export function validateProductInput(input: unknown): ProductDocument {
  if (!isRecord(input)) throw new TypeError("product must be an object");
  const name = requiredString(input.name, "name");
  const slug = requiredString(input.slug, "slug");
  if (!SLUG_PATTERN.test(slug)) throw new TypeError("slug must contain lowercase letters, numbers, and hyphens only");
  const status = input.status;
  if (typeof status !== "string" || PRODUCT_STATUSES[status as ProductStatus] !== true) {
    throw new TypeError("status must be draft, published, or archived");
  }
  const hasVariants = input.hasVariants === true;
  const priceMinor = integerAmount(input.priceMinor, "priceMinor", !hasVariants);
  const compareAtMinor = integerAmount(input.compareAtMinor, "compareAtMinor", false);
  if (compareAtMinor !== undefined && priceMinor !== undefined && compareAtMinor < priceMinor) {
    throw new TypeError("compareAtMinor cannot be lower than priceMinor");
  }
  if (!Array.isArray(input.images)) throw new TypeError("images must be an array");
  const images = input.images.map(image);
  return {
    name,
    slug,
    description: typeof input.description === "string" ? input.description.trim() : "",
    status: status as ProductStatus,
    ...(optionalString(input.sku, "sku") ? { sku: optionalString(input.sku, "sku") } : {}),
    ...(priceMinor === undefined ? {} : { priceMinor }),
    ...(compareAtMinor === undefined ? {} : { compareAtMinor }),
    currency: currency(input.currency, true),
    images,
    hasVariants,
    createdAt: timestamp(input.createdAt),
    updatedAt: timestamp(input.updatedAt),
  };
}

export function validateVariantInput(input: unknown, productId: string): VariantDocument {
  if (!isRecord(input)) throw new TypeError("variant must be an object");
  const parentId = requiredString(productId, "productId");
  const status = input.status;
  if (typeof status !== "string" || PRODUCT_STATUSES[status as VariantStatus] !== true) {
    throw new TypeError("variant status must be draft, published, or archived");
  }
  if (!isRecord(input.options)) throw new TypeError("variant options must be an object");
  const options = Object.fromEntries(Object.entries(input.options).map(([key, value]) => [requiredString(key, "option name"), requiredString(value, `options.${key}`)]));
  return {
    productId: parentId,
    name: requiredString(input.name, "variant name"),
    sku: requiredString(input.sku, "variant sku"),
    status: status as VariantStatus,
    priceMinor: integerAmount(input.priceMinor, "variant priceMinor", true) as number,
    currency: currency(input.currency, true),
    options,
    createdAt: timestamp(input.createdAt),
    updatedAt: timestamp(input.updatedAt),
  };
}

export function validateInventoryInput(input: unknown, productId: string, variantId?: string): InventoryDocument {
  if (!isRecord(input)) throw new TypeError("inventory must be an object");
  const status = input.status;
  if (typeof status !== "string" || INVENTORY_STATUSES[status as InventoryStatus] !== true) {
    throw new TypeError("inventory status must be active or disabled");
  }
  const available = integerAmount(input.available, "available", true) as number;
  const reserved = integerAmount(input.reserved, "reserved", true) as number;
  if (reserved > available) throw new TypeError("reserved cannot exceed available");
  return {
    productId: requiredString(productId, "productId"),
    ...(variantId === undefined ? {} : { variantId: requiredString(variantId, "variantId") }),
    sku: requiredString(input.sku, "sku"),
    status: status as InventoryStatus,
    available,
    reserved,
    updatedAt: timestamp(input.updatedAt),
  };
}

export function isPublishedProduct(value: unknown): value is ProductDocument {
  return isRecord(value) && value.status === "published";
}

export function isPublishedVariant(value: unknown): value is VariantDocument {
  return isRecord(value) && value.status === "published" && typeof value.productId === "string";
}
