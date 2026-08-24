import { useEffect, useState } from "react";
import { Drawer } from "./Drawer.js";
import { formatOrderRef, OrderDetail } from "./OrderDetail.js";
import { AdminPageShell, DataState, downloadTextFile, formatMinorAmount, requestCommerce, useCommerceData, type AdminPageElement, type AdminPageProps } from "./shared.js";

interface OrderRow {
  id: string;
  data?: {
    orderId?: string;
    status?: string;
    currency?: string;
    totalMinor?: number;
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

function buildOrdersQuery(statusFilter: string, emailQuery: string, cursor?: string): string {
  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (emailQuery.trim() !== "") params.set("email", emailQuery.trim());
  if (cursor) params.set("cursor", cursor);
  const suffix = params.toString();
  return `/orders${suffix === "" ? "" : `?${suffix}`}`;
}

export function OrdersPage({ apiBasePath }: AdminPageProps): AdminPageElement {
  const [statusFilter, setStatusFilter] = useState("all");
  const [emailInput, setEmailInput] = useState("");
  const [appliedEmail, setAppliedEmail] = useState("");
  const [extraRows, setExtraRows] = useState<OrderRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const [selectedOrderId, setSelectedOrderId] = useState<string>();

  const listPath = buildOrdersQuery(statusFilter, appliedEmail);
  const result = useCommerceData<{ items: OrderRow[]; cursor?: string; hasMore?: boolean }>(listPath, apiBasePath);

  const rows = [...(result.data?.items ?? []), ...extraRows].filter(Boolean);
  const visibleIds = rows.map((row) => row.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  useEffect(() => {
    setExtraRows([]);
    setNextCursor(undefined);
    setSelected(new Set());
  }, [statusFilter, appliedEmail]);

  function toggleRow(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    setSelected(allVisibleSelected ? new Set() : new Set(visibleIds));
  }

  async function loadMore(): Promise<void> {
    const cursor = nextCursor ?? result.data?.cursor;
    if (!cursor) return;
    setLoadingMore(true);
    setLoadError(undefined);
    try {
      const page = await requestCommerce<{ items: OrderRow[]; cursor?: string; hasMore?: boolean }>(
        buildOrdersQuery(statusFilter, appliedEmail, cursor),
        "GET",
        undefined,
        apiBasePath,
      );
      setExtraRows((rows) => [...rows, ...page.items]);
      setNextCursor(page.hasMore ? page.cursor : undefined);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "Could not load more orders");
    } finally {
      setLoadingMore(false);
    }
  }

  async function exportCsv(): Promise<void> {
    setExporting(true);
    setExportError(undefined);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (appliedEmail.trim() !== "") params.set("email", appliedEmail.trim());
      if (selected.size > 0) params.set("ids", [...selected].join(","));
      const data = await requestCommerce<{ filename: string; csv: string }>(
        `/orders/export${params.toString() === "" ? "" : `?${params.toString()}`}`,
        "GET",
        undefined,
        apiBasePath,
      );
      downloadTextFile(data.filename, data.csv);
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  function applyEmail(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setAppliedEmail(emailInput);
  }

  const hasMore = nextCursor !== undefined || (extraRows.length === 0 && result.data?.hasMore === true);

  return (
    <AdminPageShell title="Orders">
      <div className="commerce-admin-toolbar">
        <label>
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {FILTER_OPTIONS.map((option) => (
              <option key={option} value={option}>{option === "all" ? "All statuses" : ORDER_STATUS_LABELS[option]}</option>
            ))}
          </select>
        </label>
        <form onSubmit={(event) => void applyEmail(event)} >
          <label>
            Customer email
            <input
              type="search"
              value={emailInput}
              placeholder="Search by email…"
              onChange={(event) => setEmailInput(event.target.value)}
            />
          </label>
          <button type="submit" className="commerce-btn">Search</button>
        </form>
        <button
          type="button"
          className={`commerce-btn${selected.size > 0 ? "" : "-secondary"}`}
          onClick={() => void exportCsv()}
          disabled={exporting}
        >
          {exporting ? "Preparing…" : `Download CSV${selected.size > 0 ? ` (${selected.size} selected)` : ""}`}
        </button>
      </div>
      {exportError ? <p role="alert">{exportError}</p> : null}
      <DataState {...result}>
        <table>
          <thead>
            <tr>
              <th scope="col" style={{ width: 36 }} onClick={(event) => event.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label="Select all visible orders"
                  checked={allVisibleSelected}
                  onChange={toggleAll}
                />
              </th>
              <th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Total</th><th scope="col">Payment</th><th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={6}>No orders match.</td></tr> : null}
            {rows.map((row) => (
              <tr
                key={row.id}
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedOrderId(row.id)}
              >
                <td style={{ width: 36 }} onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Select order ${row.id}`}
                    checked={selected.has(row.id)}
                    onChange={() => toggleRow(row.id)}
                  />
                </td>
                <th scope="row" title={row.id}>{formatOrderRef({ orderNumber: row.data?.orderNumber, orderId: row.data?.orderId, id: row.id })}</th>
                <td>{row.data?.customer?.name ?? row.data?.customer?.email ?? "Guest"}</td>
                <td>{formatMinorAmount(row.data?.totalMinor ?? 0, row.data?.currency ?? "MYR")}</td>
                <td>{row.data?.paymentProviderId ?? "—"}</td>
                <td>{statusText(row.data?.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {hasMore ? (
          <div className="commerce-admin-toolbar" style={{ justifyContent: "center", marginTop: 12 }}>
            <button type="button" className="commerce-btn-secondary" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        ) : null}
        {loadError ? <p role="alert">{loadError}</p> : null}
      </DataState>
      {selectedOrderId ? (
        <Drawer title="Order details" ariaLabel={`Order ${selectedOrderId} details`} onClose={() => setSelectedOrderId(undefined)}>
          <OrderDetail orderId={selectedOrderId} apiBasePath={apiBasePath} onChanged={result.reload} />
        </Drawer>
      ) : null}
    </AdminPageShell>
  );
}
