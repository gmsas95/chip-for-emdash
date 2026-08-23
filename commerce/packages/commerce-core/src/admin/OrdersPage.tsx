import { useState } from "react";
import { Drawer } from "./Drawer.js";
import { formatOrderRef, OrderDetail } from "./OrderDetail.js";
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
    orderNumber?: number;
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


export function OrdersPage({ apiBasePath }: AdminPageProps): AdminPageElement {
  const result = useCommerceData<{ items: OrderRow[] }>("/orders", apiBasePath);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedOrderId, setSelectedOrderId] = useState<string>();
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
                <th scope="row" title={data.orderId ?? id}>{formatOrderRef({ orderNumber: data.orderNumber, orderId: data.orderId, id })}</th>
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
        <Drawer title="Order details" ariaLabel={`Order ${selectedOrderId} details`} onClose={() => setSelectedOrderId(undefined)}>
          <OrderDetail orderId={selectedOrderId} apiBasePath={apiBasePath} onChanged={result.reload} />
        </Drawer>
      ) : null}
    </AdminPageShell>
  );
}
