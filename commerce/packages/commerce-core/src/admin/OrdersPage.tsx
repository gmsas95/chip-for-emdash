import { useEffect, useRef, useState } from "react";
import { OrderDetail } from "./OrderDetail.js";
import { AdminPageShell, DataState, formatMinorAmount, useCommerceData, type AdminPageElement, type AdminPageProps } from "./shared.js";

interface OrderRow {
  id: string;
  data: {
    orderId?: string;
    status?: string;
    currency?: string;
    totalMinor?: number;
    lines?: Array<{ name: string; quantity: number; totalMinor: number }>;
    customer?: { name?: string; email?: string };
    paymentProviderId?: string;
  };
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_payment: "Pending payment",
  paid: "Paid",
  processing: "Processing",
  partially_fulfilled: "Partially fulfilled",
  fulfilled: "Fulfilled",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
  refunded: "Refunded",
};

const FILTER_OPTIONS = ["all", "pending_payment", "paid", "processing", "partially_fulfilled", "fulfilled", "completed", "cancelled", "failed", "refunded"] as const;

function statusText(status?: string): string {
  return (status !== undefined && ORDER_STATUS_LABELS[status]) || status || "created";
}

const DRAWER_CSS = `
.commerce-drawer-root { position: fixed; inset: 0; z-index: 60; }
.commerce-drawer-backdrop {
  position: absolute; inset: 0; border: 0; padding: 0; margin: 0; cursor: default;
  background: color-mix(in srgb, black 45%, transparent);
}
.commerce-drawer-backdrop:hover { background: color-mix(in srgb, black 45%, transparent); }
.commerce-drawer {
  position: absolute; top: 0; right: 0; height: 100%;
  width: min(600px, calc(100vw - 32px));
  display: flex; flex-direction: column;
  background: var(--commerce-surface, var(--color-kumo-base));
  border-left: 1px solid var(--commerce-line);
  box-shadow: -18px 0 48px rgba(0,0,0,.22);
  animation: commerce-drawer-in .18s ease-out;
}
.commerce-drawer-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding: 16px 20px; border-bottom: 1px solid var(--commerce-line);
}
.commerce-drawer-header h2 { margin: 0; font-size: 17px; font-weight: 650; }
.commerce-drawer-close {
  min-width: 36px; min-height: 36px; width: 36px; padding: 0;
  border: 1px solid var(--commerce-line); border-radius: 9px;
  background: var(--commerce-surface-soft); color: inherit; font-size: 14px;
}
.commerce-drawer-body { overflow-y: auto; flex: 1; padding: 4px 20px 28px; }
@keyframes commerce-drawer-in { from { transform: translateX(24px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .commerce-drawer { animation: none; } }
`;

export function OrdersPage({ apiBasePath }: AdminPageProps): AdminPageElement {
  const result = useCommerceData<{ items: OrderRow[] }>("/orders", apiBasePath);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedOrderId, setSelectedOrderId] = useState<string>();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (selectedOrderId === undefined) return;
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedOrderId(undefined);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedOrderId]);

  const items = (result.data?.items ?? []).filter(({ data }) => statusFilter === "all" || data.status === statusFilter);

  return (
    <AdminPageShell title="Orders">
      <div className="commerce-admin-toolbar" style={{ justifyContent: "flex-start" }}>
        <label>
          Filter by status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {FILTER_OPTIONS.map((option) => (
              <option key={option} value={option}>{option === "all" ? "All statuses" : ORDER_STATUS_LABELS[option]}</option>
            ))}
          </select>
        </label>
      </div>
      <DataState {...result}>
        <table>
          <thead><tr><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Total</th><th scope="col">Payment</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {items.length === 0 ? <tr><td colSpan={5}>No orders yet.</td></tr> : null}
            {items.map(({ id, data }) => (
              <tr
                key={id}
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedOrderId(id)}
              >
                <th scope="row">{data.orderId ?? id}</th>
                <td>{data.customer?.name ?? data.customer?.email ?? "Guest"}</td>
                <td>{formatMinorAmount(data.totalMinor ?? 0, data.currency ?? "MYR")}</td>
                <td>{data.paymentProviderId ?? "—"}</td>
                <td>{statusText(data.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataState>
      {selectedOrderId ? (
        <div className="commerce-drawer-root">
          <button type="button" className="commerce-drawer-backdrop" aria-label="Close order details" onClick={() => setSelectedOrderId(undefined)} />
          <aside className="commerce-drawer" role="dialog" aria-modal="true" aria-label={`Order ${selectedOrderId} details`}>
            <header className="commerce-drawer-header">
              <h2>Order details</h2>
              <button ref={closeButtonRef} type="button" className="commerce-drawer-close" aria-label="Close" onClick={() => setSelectedOrderId(undefined)}>✕</button>
            </header>
            <div className="commerce-drawer-body">
              <OrderDetail orderId={selectedOrderId} apiBasePath={apiBasePath} />
            </div>
          </aside>
        </div>
      ) : null}
      <style dangerouslySetInnerHTML={{ __html: DRAWER_CSS }} />
    </AdminPageShell>
  );
}
