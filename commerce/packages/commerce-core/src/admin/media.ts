import type { ProductImage } from "../domain/products.js";

export interface ProductMediaItem {
  id: string;
  filename: string;
  url: string;
  alt?: string;
  mimeType?: string;
}

interface MediaEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string };
}

function mediaField(item: Record<string, unknown>, camel: string, snake: string): unknown {
  return item[camel] ?? item[snake];
}

async function parseResponse<T>(response: Response): Promise<T> {
  let envelope: MediaEnvelope<T>;
  try {
    envelope = await response.json() as MediaEnvelope<T>;
  } catch {
    throw new Error(`EmDash media API returned invalid JSON (${response.status})`);
  }
  if (!response.ok || envelope.success !== true || !("data" in envelope)) {
    throw new Error(envelope.error?.message ?? `EmDash media request failed (${response.status})`);
  }
  return envelope.data as T;
}

function toProductImage(item: Record<string, unknown>, alt: string): ProductImage {
  const id = mediaField(item, "id", "id");
  const storageKey = mediaField(item, "storageKey", "storage_key");
  const url = mediaField(item, "url", "url") ?? (typeof storageKey === "string" ? `/_emdash/api/media/file/${storageKey}` : undefined);
  if (typeof id !== "string" || typeof url !== "string") throw new Error("EmDash media response did not include an id and URL");
  return { mediaId: id, url, alt };
}

function toMediaItem(item: Record<string, unknown>): ProductMediaItem {
  const id = item.id;
  const filename = mediaField(item, "filename", "filename");
  const storageKey = mediaField(item, "storageKey", "storage_key");
  const url = mediaField(item, "url", "url") ?? (typeof storageKey === "string" ? `/_emdash/api/media/file/${storageKey}` : undefined);
  if (typeof id !== "string" || typeof filename !== "string" || typeof url !== "string") throw new Error("EmDash media response item is missing required fields");
  const alt = mediaField(item, "alt", "alt");
  return { id, filename, url, ...(typeof alt === "string" ? { alt } : {}) };
}

export async function uploadProductImage(file: File, alt: string): Promise<ProductImage> {
  const body = new FormData();
  body.append("file", file, file.name);
  body.append("alt", alt);
  const response = await fetch("/_emdash/api/media", {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-EmDash-Request": "1" },
    body,
  });
  const data = await parseResponse<{ item: Record<string, unknown> }>(response);
  return toProductImage(data.item, alt);
}

export async function listProductMedia(): Promise<ProductMediaItem[]> {
  const response = await fetch("/_emdash/api/media?mimeType=image/&limit=100", {
    credentials: "same-origin",
    headers: { "X-EmDash-Request": "1" },
  });
  const data = await parseResponse<{ items: Array<Record<string, unknown>> }>(response);
  return data.items.map(toMediaItem);
}
