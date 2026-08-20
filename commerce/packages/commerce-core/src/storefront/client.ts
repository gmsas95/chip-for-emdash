import type { OrderSnapshot } from "../domain/orders.js";
import type {
  CartCreateInput,
  CartLineInput,
  CartResult,
  CheckoutResult,
  CheckoutStartInput,
  CommerceClient,
  CatalogResult,
} from "./types.js";

export type CommerceFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export class CommerceApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "CommerceApiError";
  }
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

export function createCommerceClient(
  fetcher: CommerceFetcher = fetch,
  basePath = "/_emdash/api/plugins/emdash-commerce",
): CommerceClient {
  const normalizedBasePath = basePath.replace(/\/+$/, "");

  async function request<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
    const response = await fetcher(`${normalizedBasePath}${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "X-EmDash-Request": "1",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new CommerceApiError("Commerce returned invalid JSON", "INVALID_RESPONSE", response.status);
    }
    if (!isRecord(parsed) || typeof parsed.success !== "boolean") {
      throw new CommerceApiError("Commerce returned an invalid response envelope", "INVALID_RESPONSE", response.status);
    }
    const envelope = parsed as unknown as ApiEnvelope<T>;
    if (!response.ok || envelope.success !== true) {
      throw new CommerceApiError(
        envelope.error?.message ?? `Commerce request failed (${response.status})`,
        envelope.error?.code ?? `HTTP_${response.status}`,
        response.status,
        envelope.error?.details,
      );
    }
    if (!("data" in envelope)) {
      throw new CommerceApiError("Commerce response did not include data", "INVALID_RESPONSE", response.status);
    }
    return envelope.data as T;
  }

  return {
    catalog: {
      list: () => request<CatalogResult>("/catalog", "GET"),
    },
    cart: {
      create: (input: CartCreateInput) => request<CartResult>("/cart", "POST", input),
      addLine: (input: CartLineInput) => request<CartResult>("/cart", "POST", input),
    },
    checkout: {
      start: (input: CheckoutStartInput) => request<CheckoutResult>("/checkout", "POST", input),
    },
    orders: {
      get: (orderId: string) => request<OrderSnapshot | undefined>("/orders", "POST", { orderId }),
    },
  };
}
