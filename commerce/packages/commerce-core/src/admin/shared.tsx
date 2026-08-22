import React, { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";

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

const COMMERCE_ADMIN_CSS = `
.commerce-admin {
  --commerce-ink: #20221f;
  --commerce-muted: #6f746d;
  --commerce-surface: #ffffff;
  --commerce-surface-soft: #f4f6f2;
  --commerce-line: #dfe5de;
  --commerce-accent: #e75b3e;
  max-width: 1180px;
  margin: 0 auto;
  padding: 32px clamp(20px, 4vw, 56px) 64px;
  color: var(--commerce-ink);
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
}
.commerce-admin header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 28px;
}
.commerce-admin header p {
  margin: 0 0 8px;
  color: var(--commerce-muted);
  font-size: 12px;
  font-weight: 750;
  letter-spacing: .12em;
  text-transform: uppercase;
}
.commerce-admin h1 {
  margin: 0;
  font-size: clamp(28px, 4vw, 42px);
  letter-spacing: -.045em;
  line-height: 1;
}
.commerce-admin h2 { margin: 28px 0 14px; font-size: 20px; letter-spacing: -.025em; }
.commerce-admin h3 { margin: 0 0 10px; font-size: 15px; letter-spacing: -.015em; }
.commerce-admin p { line-height: 1.55; }
.commerce-admin table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  overflow: hidden;
  border: 1px solid var(--commerce-line);
  border-radius: 14px;
  background: var(--commerce-surface);
}
.commerce-admin th, .commerce-admin td {
  padding: 14px 16px;
  border-bottom: 1px solid var(--commerce-line);
  text-align: left;
  vertical-align: middle;
  font-size: 13px;
}
.commerce-admin th { color: var(--commerce-muted); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
.commerce-admin tbody tr:last-child th, .commerce-admin tbody tr:last-child td { border-bottom: 0; }
.commerce-admin tbody tr:hover { background: var(--commerce-surface-soft); }
.commerce-admin form, .commerce-admin article, .commerce-admin section {
  margin: 18px 0;
  padding: 22px;
  border: 1px solid var(--commerce-line);
  border-radius: 14px;
  background: var(--commerce-surface);
}
.commerce-admin form { display: grid; gap: 14px; }
.commerce-admin form > label, .commerce-admin fieldset > label {
  display: grid;
  gap: 6px;
  color: var(--commerce-muted);
  font-size: 12px;
  font-weight: 650;
}
.commerce-admin input, .commerce-admin select, .commerce-admin textarea {
  width: 100%;
  min-height: 42px;
  border: 1px solid var(--commerce-line);
  border-radius: 9px;
  padding: 9px 11px;
  background: var(--commerce-surface);
  color: var(--commerce-ink);
  font: inherit;
}
.commerce-admin textarea { min-height: 96px; resize: vertical; }
.commerce-admin input:focus, .commerce-admin select:focus, .commerce-admin textarea:focus {
  border-color: var(--commerce-accent);
  outline: 3px solid color-mix(in srgb, var(--commerce-accent) 22%, transparent);
}
.commerce-admin button {
  min-height: 40px;
  border: 1px solid var(--commerce-ink);
  border-radius: 9px;
  padding: 9px 14px;
  background: var(--commerce-ink);
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}
.commerce-admin button:hover { background: var(--commerce-accent); border-color: var(--commerce-accent); }
.commerce-admin button:disabled { cursor: wait; opacity: .55; }
.commerce-admin button + button { margin-left: 8px; }
.commerce-admin a { color: var(--commerce-accent); font-weight: 700; }
.commerce-admin fieldset { display: grid; gap: 12px; margin: 14px 0; border: 1px solid var(--commerce-line); border-radius: 10px; padding: 16px; }
.commerce-admin legend { padding: 0 6px; font-weight: 750; }
.commerce-admin .commerce-admin-toolbar { display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 14px; }
.commerce-admin [role="alert"] { border: 1px solid #e3a092; border-radius: 10px; padding: 12px 14px; background: #fff3ef; color: #8a2e20; }
.commerce-admin [role="status"] { color: var(--commerce-muted); }
.commerce-admin .commerce-skeleton { height: 72px; border-radius: 12px; background: linear-gradient(90deg, var(--commerce-surface-soft), #fff, var(--commerce-surface-soft)); background-size: 200% 100%; animation: commerce-skeleton 1.2s ease-in-out infinite; }
@keyframes commerce-skeleton { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (max-width: 720px) {
  .commerce-admin { padding: 22px 16px 48px; }
  .commerce-admin header { align-items: flex-start; flex-direction: column; }
  .commerce-admin table { display: block; overflow-x: auto; white-space: nowrap; }
  .commerce-admin form, .commerce-admin article, .commerce-admin section { padding: 16px; }
}
@media (prefers-reduced-motion: reduce) { .commerce-admin .commerce-skeleton { animation: none; } }
`;

export function AdminPageShell({ title, children }: { title: string; children: ReactNode }): AdminPageElement {
  return (
    <main className="commerce-admin">
      <header>
        <h1>{title}</h1>
      </header>
      {children}
      <style dangerouslySetInnerHTML={{ __html: COMMERCE_ADMIN_CSS }} />
    </main>
  );
}

export function DataState({ loading, error, children }: { loading: boolean; error?: string; children: ReactNode }): AdminPageElement {
  if (loading) return <div className="commerce-skeleton" role="status" aria-label="Loading Commerce data" />;
  if (error) return <div role="alert">{error}</div>;
  return <>{children}</>;
}
