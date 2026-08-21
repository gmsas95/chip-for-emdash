import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";

export type AdminPageElement = ReactElement;

export interface AdminPageProps {
  apiBasePath?: string;
}

interface EmDashApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string; details?: unknown };
}

export type CommerceRequestMethod = "GET" | "POST" | "PUT" | "DELETE";

export async function requestCommerce<T>(
  path: string,
  method: CommerceRequestMethod = "GET",
  body?: unknown,
  apiBasePath = "/_emdash/api/plugins/emdash-commerce",
): Promise<T> {
  const response = await fetch(`${apiBasePath}${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      "X-EmDash-Request": "1",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let envelope: EmDashApiEnvelope<T>;
  try {
    envelope = await response.json() as EmDashApiEnvelope<T>;
  } catch {
    throw new Error(`Commerce admin returned invalid JSON (${response.status})`);
  }
  if (!response.ok || envelope.success !== true || !("data" in envelope)) {
    throw new Error(envelope.error?.message ?? `Commerce admin request failed (${response.status})`);
  }
  return envelope.data as T;
}

export function useCommerceData<T>(
  path: string,
  apiBasePath = "/_emdash/api/plugins/emdash-commerce",
): { data: T | undefined; loading: boolean; error: string | undefined; reload: () => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void requestCommerce<T>(path, "GET", undefined, apiBasePath)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Commerce admin request failed");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiBasePath, path, revision]);

  return { data, loading, error, reload };
}

export function useCommerceMutation<TInput, TOutput>(
  path: string,
  apiBasePath = "/_emdash/api/plugins/emdash-commerce",
): { submit: (input: TInput) => Promise<TOutput>; loading: boolean; error: string | undefined } {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const submit = useCallback(async (input: TInput): Promise<TOutput> => {
    setLoading(true);
    setError(undefined);
    try {
      return await requestCommerce<TOutput>(path, "POST", input, apiBasePath);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Commerce admin request failed";
      setError(message);
      throw reason;
    } finally {
      setLoading(false);
    }
  }, [apiBasePath, path]);
  return { submit, loading, error };
}

export function formatMinorAmount(amountMinor: number, currency: string): string {
  const amount = Number.isSafeInteger(amountMinor) && amountMinor >= 0 ? amountMinor : 0;
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

export function AdminPageShell({ title, children }: { title: string; children: ReactNode }): AdminPageElement {
  return (
    <main className="emdash-commerce-admin">
      <header>
        <h1>{title}</h1>
      </header>
      {children}
    </main>
  );
}

export function DataState({ loading, error, children }: { loading: boolean; error?: string; children: ReactNode }): AdminPageElement {
  if (loading) return <p role="status">Loading...</p>;
  if (error) return <p role="alert">{error}</p>;
  return <>{children}</>;
}
