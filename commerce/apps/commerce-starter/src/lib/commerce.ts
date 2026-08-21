import type { CatalogResult, CommerceFetcher } from "@emdash-commerce/core";

export const COMMERCE_BASE = "/_emdash/api/plugins/emdash-commerce";

export interface CatalogVariant {
  id: string;
  productId: string;
  name: string;
  sku: string;
  status: "draft" | "published" | "archived";
  priceMinor: number;
  currency: string;
  options: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogProduct {
  name: string;
  slug: string;
  description: string;
  status: "draft" | "published" | "archived";
  sku?: string;
  priceMinor?: number;
  compareAtMinor?: number;
  currency: string;
  images: Array<{ mediaId: string; url: string; alt: string }>;
  hasVariants: boolean;
  createdAt: string;
  updatedAt: string;
  variants: CatalogVariant[];
}

export type StorefrontCatalog = CatalogResult<CatalogProduct>;

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string };
}

export async function commerceRequest<T>(fetcher: CommerceFetcher, path: string, init?: RequestInit): Promise<T> {
  const response = await fetcher(`${COMMERCE_BASE}${path}`, {
    credentials: "same-origin",
    headers: { "X-EmDash-Request": "1", ...(init?.headers ?? {}) },
    ...init,
  });
  let envelope: ApiEnvelope<T>;
  try {
    envelope = await response.json() as ApiEnvelope<T>;
  } catch {
    throw new Error(`Commerce returned invalid JSON (${response.status})`);
  }
  if (!response.ok || envelope.success !== true || !("data" in envelope)) {
    throw new Error(envelope.error?.message ?? `Commerce request failed (${response.status})`);
  }
  return envelope.data as T;
}

export function createServerCommerceFetcher(origin: URL): CommerceFetcher {
  return (input, init) => fetch(new URL(input, origin), init);
}

export function getCatalog(fetcher: CommerceFetcher = fetch): Promise<StorefrontCatalog> {
  return commerceRequest<StorefrontCatalog>(fetcher, "/catalog");
}

export function formatMinorAmount(amountMinor: number, currency: string): string {
  const amount = Number.isSafeInteger(amountMinor) && amountMinor >= 0 ? amountMinor : 0;
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount / 100);
}

export function imageUrl(url: string | undefined): string {
  return url && url.trim() !== "" ? url : "/commerce-placeholder.svg";
}
