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

export function useCommerceMutation<TInput, TOutput = unknown>(
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

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const COMMERCE_ADMIN_CSS = `
.commerce-admin {
  --commerce-ink: var(--text-color-kumo-default);
  --commerce-muted: var(--text-color-kumo-subtle);
  --commerce-surface: var(--color-kumo-base);
  --commerce-surface-soft: var(--color-kumo-canvas);
  --commerce-line: var(--color-kumo-line);
  --commerce-accent: var(--color-kumo-brand);
  --commerce-accent-hover: var(--color-kumo-brand-hover);
  --commerce-focus: var(--color-kumo-focus);
  --commerce-danger: var(--color-kumo-danger);
  max-width: 1180px;
  margin: 0 auto;
  padding: 32px clamp(20px, 4vw, 56px) 64px;
  color: var(--commerce-ink);
  font-family: var(--font-emdash, ui-sans-serif, system-ui, -apple-system, sans-serif);
}
.commerce-admin, .commerce-admin *, .commerce-admin *::before, .commerce-admin *::after { box-sizing: border-box; }
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
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -.025em;
  line-height: 1.15;
}
.commerce-admin h2 { margin: 28px 0 14px; font-size: 20px; font-weight: 650; letter-spacing: -.015em; line-height: 1.25; }
.commerce-admin h3 { margin: 0 0 10px; font-size: 15px; font-weight: 650; letter-spacing: 0; line-height: 1.35; }
.commerce-admin p { margin: 0 0 12px; font-size: 14px; line-height: 1.5; }
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
  vertical-align: middle;
  font-size: 14px;
  line-height: 1.45;
  text-align: left;
}
.commerce-admin td { color: var(--commerce-ink); }
.commerce-admin th { color: var(--commerce-muted); font-size: 12px; font-weight: 600; letter-spacing: 0; text-transform: none; }
.commerce-admin .commerce-admin-toolbar { padding: 0; justify-content: space-between; }
.commerce-admin .commerce-check-cell { width: 40px; text-align: center; }
.commerce-admin .commerce-col-money { text-align: right; font-variant-numeric: tabular-nums; }
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
  font-size: 13px;
  font-weight: 500;
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
  border-color: var(--commerce-focus);
  outline: 3px solid color-mix(in srgb, var(--commerce-focus) 22%, transparent);
}
.commerce-admin input[type="checkbox"] {
  width: 16px;
  height: 16px;
  min-height: 0;
  padding: 0;
  margin: 0;
  accent-color: var(--commerce-accent);
}
.commerce-admin .commerce-admin-toolbar form {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.commerce-admin form > button.commerce-btn,
.commerce-admin form > button[type="submit"] {
  justify-self: start;
  width: auto;
}
.commerce-admin select:disabled, .commerce-admin input:disabled, .commerce-admin button:disabled {
  opacity: .5;
  background: var(--commerce-surface-soft);
  color: var(--commerce-muted);
  cursor: not-allowed;
}
.commerce-admin button { cursor: pointer; font: inherit; }
.commerce-admin .commerce-btn,
.commerce-admin .commerce-btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 38px;
  padding: 8px 16px;
  border-radius: 9px;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
  transition: background .12s ease, border-color .12s ease, opacity .12s ease;
}
.commerce-admin .commerce-btn {
  background: var(--commerce-accent);
  border: 1px solid var(--commerce-accent);
  color: var(--text-color-kumo-inverse, #fff);
}
.commerce-admin .commerce-btn:hover { background: var(--commerce-accent-hover); border-color: var(--commerce-accent-hover); }
.commerce-admin .commerce-btn:focus-visible { outline: 3px solid color-mix(in srgb, var(--commerce-focus) 35%, transparent); outline-offset: 1px; }
.commerce-admin .commerce-btn:disabled {
  cursor: not-allowed;
  opacity: .55;
  background: var(--commerce-surface-soft);
  border-color: var(--commerce-line);
  color: var(--commerce-muted);
}
.commerce-admin .commerce-btn-secondary {
  background: var(--commerce-surface);
  border: 1px solid var(--commerce-line);
  color: var(--commerce-ink);
}
.commerce-admin .commerce-btn-secondary:hover { background: var(--commerce-surface-soft); border-color: var(--commerce-muted); }
.commerce-admin .commerce-btn-sm { min-height: 30px; padding: 4px 10px; font-size: 13px; }
.commerce-admin a { color: var(--text-color-kumo-link, var(--commerce-accent)); font-weight: 700; }
.commerce-admin fieldset { display: grid; gap: 12px; margin: 14px 0; border: 1px solid var(--commerce-line); border-radius: 10px; padding: 16px; }
.commerce-admin legend { padding: 0 6px; font-weight: 750; }
.commerce-admin .commerce-admin-toolbar { display: flex; justify-content: flex-start; align-items: flex-end; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.commerce-admin .commerce-admin-toolbar > * { margin: 0; }
.commerce-admin .commerce-admin-toolbar label {
  display: grid;
  gap: 6px;
  color: var(--commerce-muted);
  font-size: 13px;
  font-weight: 500;
}
.commerce-admin .commerce-admin-toolbar select,
.commerce-admin .commerce-admin-toolbar input[type="search"] { min-width: 200px; }
.commerce-admin .commerce-admin-toolbar .commerce-btn { min-height: 42px; }
.commerce-admin .commerce-admin-toolbar [role="status"] { align-self: center; }
.commerce-admin [role="alert"] { border: 1px solid var(--commerce-danger); border-radius: 10px; padding: 12px 14px; background: var(--color-kumo-danger-tint, var(--commerce-surface-soft)); color: var(--text-color-kumo-danger, var(--commerce-danger)); }
.commerce-admin [role="status"] { color: var(--commerce-muted); }
.commerce-admin .commerce-skeleton { height: 72px; border-radius: 12px; background: linear-gradient(90deg, var(--commerce-surface-soft), var(--commerce-surface), var(--commerce-surface-soft)); background-size: 200% 100%; animation: commerce-skeleton 1.2s ease-in-out infinite; }
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
