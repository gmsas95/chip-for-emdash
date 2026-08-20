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

export function createCommerceClient(
  fetcher: CommerceFetcher = fetch,
  basePath = "/_emdash/api/plugins/emdash-commerce",
): CommerceClient {
  async function request<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
    const response = await fetcher(`${basePath}${path}`, {
      method,
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let envelope: ApiEnvelope<T>;
    try {
      envelope = await response.json() as ApiEnvelope<T>;
    } catch {
      throw new CommerceApiError("Commerce returned invalid JSON", "INVALID_RESPONSE", response.status);
    }
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
      get: (orderId: string) => request<unknown>("/orders", "POST", { orderId }),
    },
  };
}
