import { useEffect, useState, type ReactElement, type ReactNode } from "react";

export type AdminPageElement = ReactElement;

export interface AdminPageProps {
  apiBasePath?: string;
}

interface EmDashApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string };
}

export function useCommerceData<T>(path: string, apiBasePath = "/_emdash/api/plugins/emdash-commerce"): { data: T | undefined; loading: boolean; error: string | undefined } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetch(`${apiBasePath}${path}`, {
      credentials: "same-origin",
      headers: { "X-EmDash-Request": "1" },
    })
      .then(async (response) => {
        const envelope = await response.json() as EmDashApiEnvelope<T>;
        if (!response.ok || envelope.success !== true) {
          throw new Error(envelope.error?.message ?? `Commerce admin request failed (${response.status})`);
        }
        return envelope.data;
      })
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
  }, [apiBasePath, path]);
  return { data, loading, error };
}

export function AdminPageShell({ title, children }: { title: string; children: ReactNode }): AdminPageElement {
  return (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  );
}

export function DataState({ loading, error, children }: { loading: boolean; error?: string; children: ReactNode }): AdminPageElement {
  if (loading) return <p>Loading...</p>;
  if (error) return <p role="alert">{error}</p>;
  return <>{children}</>;
}
