import { useEffect, useState } from "react";
import { CustomerDetail } from "./CustomerDetail.js";
import { Drawer } from "./Drawer.js";
import { AdminPageShell, DataState, downloadTextFile, formatMinorAmount, requestCommerce, useCommerceData, type AdminPageElement, type AdminPageProps } from "./shared.js";

interface CustomerRow {
  id: string;
  customerId?: string;
  name?: string;
  email?: string;
  phone?: string;
  orderCount?: number;
  status?: string;
  totalSpentMinor?: number;
  lastOrderAt?: string;
}

function formatDate(value?: string): string {
  if (typeof value !== "string" || value === "") return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

export function CustomersPage({ apiBasePath }: AdminPageProps): AdminPageElement {
  const result = useCommerceData<{ items: CustomerRow[] }>("/customers", apiBasePath);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();

  const rows = result.data?.items ?? [];
  const allVisibleSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));

  function toggleRow(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    setSelected(allVisibleSelected ? new Set() : new Set(rows.map((row) => row.id)));
  }

  async function exportCsv(): Promise<void> {
    setExporting(true);
    setExportError(undefined);
    try {
      const params = new URLSearchParams();
      if (selected.size > 0) params.set("ids", [...selected].join(","));
      const data = await requestCommerce<{ filename: string; csv: string }>(
        `/customers/export${params.toString() === "" ? "" : `?${params.toString()}`}`,
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

  return (
    <AdminPageShell title="Customers">
      <div className="commerce-admin-toolbar" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "var(--commerce-muted)", fontSize: 13 }}>
          {selected.size > 0 ? `${selected.size} selected` : "Click a row for details."}
        </span>
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
                <input type="checkbox" aria-label="Select all visible customers" checked={allVisibleSelected} onChange={toggleAll} />
              </th>
              <th scope="col">Customer</th><th scope="col">Email</th><th scope="col">Orders</th><th scope="col">Total spent</th><th scope="col">Last order</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={6}>No customers yet. Customers appear after checkout.</td></tr> : null}
            {rows.map((row) => (
              <tr key={row.id} style={{ cursor: "pointer" }} onClick={() => setSelectedCustomerId(row.id)}>
                <td style={{ width: 36 }} onClick={(event) => event.stopPropagation()}>
                  <input type="checkbox" aria-label={`Select customer ${row.id}`} checked={selected.has(row.id)} onChange={() => toggleRow(row.id)} />
                </td>
                <th scope="row">{row.name ?? row.email ?? row.id}</th>
                <td>{row.email ?? "—"}</td>
                <td>{row.orderCount ?? 0}</td>
                <td>{formatMinorAmount(row.totalSpentMinor ?? 0, "MYR")}</td>
                <td>{formatDate(row.lastOrderAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataState>
      {selectedCustomerId ? (
        <Drawer title="Customer details" ariaLabel={`Customer ${selectedCustomerId} details`} onClose={() => setSelectedCustomerId(undefined)}>
          <CustomerDetail customerId={selectedCustomerId} apiBasePath={apiBasePath} />
        </Drawer>
      ) : null}
    </AdminPageShell>
  );
}
