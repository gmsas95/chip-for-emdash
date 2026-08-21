import type { InventoryStatus, ProductImage, ProductStatus, VariantStatus } from "../domain/products.js";

export interface VariantEditorDraft {
  id?: string;
  name: string;
  sku: string;
  status: VariantStatus;
  priceMinor: string;
  currency: string;
  optionsText: string;
}

export interface InventoryEditorDraft {
  id?: string;
  variantId?: string;
  sku: string;
  status: InventoryStatus;
  available: string;
  reserved: string;
}

export interface ProductEditorDraft {
  id?: string;
  name: string;
  slug: string;
  description: string;
  status: ProductStatus;
  sku: string;
  priceMinor: string;
  compareAtMinor: string;
  currency: string;
  hasVariants: boolean;
  images: ProductImage[];
  variants: VariantEditorDraft[];
  inventory: InventoryEditorDraft[];
}

export interface ProductSavePayload {
  product: Record<string, unknown>;
  variants: Array<Record<string, unknown>>;
  inventory: Array<Record<string, unknown>>;
}

function parseMinor(value: string, field: string, required: boolean): number | undefined {
  const normalized = value.trim();
  if (normalized === "") {
    if (required) throw new TypeError(`${field} is required`);
    return undefined;
  }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) throw new TypeError(`${field} must be a non-negative amount with up to two decimals`);
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const amount = whole * 100 + fraction;
  if (!Number.isSafeInteger(amount)) throw new TypeError(`${field} exceeds the safe amount limit`);
  return amount;
}

function parseCount(value: string, field: string): number {
  if (!/^\d+$/.test(value.trim())) throw new TypeError(`${field} must be a non-negative integer`);
  const count = Number(value);
  if (!Number.isSafeInteger(count)) throw new TypeError(`${field} exceeds the safe integer limit`);
  return count;
}

function parseOptions(value: string): Record<string, string> {
  const options: Record<string, string> = {};
  for (const line of value.split("\n").map((item) => item.trim()).filter(Boolean)) {
    const separator = line.indexOf("=");
    if (separator <= 0 || separator === line.length - 1) throw new TypeError("Each option must use name=value format");
    const name = line.slice(0, separator).trim();
    const optionValue = line.slice(separator + 1).trim();
    if (!name || !optionValue) throw new TypeError("Each option must use name=value format");
    if (name in options) throw new TypeError(`Duplicate option: ${name}`);
    options[name] = optionValue;
  }
  return options;
}

export function createEmptyProductDraft(): ProductEditorDraft {
  return {
    name: "",
    slug: "",
    description: "",
    status: "draft",
    sku: "",
    priceMinor: "",
    compareAtMinor: "",
    currency: "MYR",
    hasVariants: false,
    images: [],
    variants: [],
    inventory: [],
  };
}

export function serializeProductDraft(draft: ProductEditorDraft): ProductSavePayload {
  const priceMinor = parseMinor(draft.priceMinor, "price", !draft.hasVariants);
  const compareAtMinor = parseMinor(draft.compareAtMinor, "compare-at price", false);
  const product = {
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name.trim(),
    slug: draft.slug.trim(),
    description: draft.description.trim(),
    status: draft.status,
    ...(draft.sku.trim() ? { sku: draft.sku.trim() } : {}),
    ...(priceMinor === undefined ? {} : { priceMinor }),
    ...(compareAtMinor === undefined ? {} : { compareAtMinor }),
    currency: draft.currency.trim(),
    images: draft.images,
    hasVariants: draft.hasVariants,
  };
  return {
    product,
    variants: draft.variants.map((variant) => ({
      ...(variant.id ? { id: variant.id } : {}),
      name: variant.name.trim(),
      sku: variant.sku.trim(),
      status: variant.status,
      priceMinor: parseMinor(variant.priceMinor, "variant price", true),
      currency: variant.currency.trim(),
      options: parseOptions(variant.optionsText),
    })),
    inventory: draft.inventory.map((item) => ({
      ...(item.id ? { id: item.id } : {}),
      ...(item.variantId ? { variantId: item.variantId } : {}),
      sku: item.sku.trim(),
      status: item.status,
      available: parseCount(item.available, "available inventory"),
      reserved: parseCount(item.reserved, "reserved inventory"),
    })),
  };
}
